// The HTTP side of the game server: the built client, /healthz and /ice on the same port as the
// Colyseus WebSocket, so a deploy is one process on one origin (docs/HOSTING.md).
//
// Colyseus binds its own `request` listener (matchmaking, CORS) when it starts listening.
// attachHttp() takes that listener over and only forwards Colyseus' own paths to it.
// (Colyseus' router can't serve files: its response writer ends the response after one chunk.)

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, RequestListener, Server, ServerResponse } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import type { IceConfig } from './ice.ts';
import type { ServerStatus } from './status.ts';

export interface HttpOptions {
  /** The built client (client/dist). Omit to serve no files, as in dev where Vite serves the client. */
  staticDir?: string;
  ice: () => Promise<IceConfig>;
  status: () => ServerStatus;
  /** Origins that may call /ice and /healthz from another origin: '*' or an exact list. */
  corsOrigins: '*' | readonly string[];
}

/** Paths Colyseus answers itself. */
const COLYSEUS_PATHS = ['/matchmake/', '/__healthcheck'];

/** Call right after the Colyseus server's `listen()` resolves, with its HTTP server. */
export function attachHttp(server: Server | HttpsServer, opts: HttpOptions): void {
  const colyseus = server.listeners('request') as RequestListener[];
  if (colyseus.length === 0)
    throw new Error('attachHttp: the Colyseus server must be listening first');
  server.removeAllListeners('request');
  const files = opts.staticDir ? new StaticFiles(opts.staticDir) : undefined;

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return sendText(res, req, 400, 'Bad request');
    }
    if (COLYSEUS_PATHS.some((p) => url.pathname.startsWith(p))) {
      for (const listener of colyseus) listener.call(server, req, res);
      return;
    }
    handle(req, res, url, opts, files).catch((err: unknown) => {
      console.error('[http]', req.method, url.pathname, err);
      if (!res.headersSent) sendText(res, req, 500, 'Internal server error');
      else res.destroy();
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  opts: HttpOptions,
  files: StaticFiles | undefined,
): Promise<void> {
  const method = req.method ?? 'GET';
  if (url.pathname === '/healthz' || url.pathname === '/ice') {
    const cors = corsHeaders(req, opts.corsOrigins);
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }
    if (method !== 'GET' && method !== 'HEAD')
      return sendText(res, req, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    if (url.pathname === '/healthz') {
      const status = opts.status();
      return sendJson(res, req, status.ok ? 200 : 503, status, cors);
    }
    return sendJson(res, req, 200, await opts.ice(), cors);
  }
  if (!files) {
    if (url.pathname === '/')
      return sendText(
        res,
        req,
        200,
        'Nobody Mention the Moon game server. In dev the client is on :5240.',
      );
    return sendText(res, req, 404, 'Not found');
  }
  return files.serve(req, res, url);
}

function corsHeaders(
  req: IncomingMessage,
  allowed: '*' | readonly string[],
): Record<string, string> {
  const origin = req.headers.origin;
  if (!origin) return {};
  if (allowed === '*') return { 'Access-Control-Allow-Origin': '*' };
  return allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}

function sendJson(
  res: ServerResponse,
  req: IncomingMessage,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

function sendText(
  res: ServerResponse,
  req: IncomingMessage,
  status: number,
  text: string,
  headers: Record<string, string> = {},
): void {
  const data = Buffer.from(text);
  res.writeHead(status, {
    ...headers,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

// --- static files -------------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.ktx2': 'image/ktx2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  // The speech model (.tar.gz) goes out as plain gzip bytes, not Content-Encoding: the Vosk
  // worker unpacks the archive itself.
  '.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.zip': 'application/zip',
};

/** Worth compressing on the fly (text, WASM and glTF; images, audio and archives already are). */
const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.map',
  '.webmanifest',
  '.txt',
  '.svg',
  '.wasm',
  '.glb',
  '.gltf',
  '.bin',
]);
const MIN_COMPRESS_BYTES = 1024;
const MAX_COMPRESS_BYTES = 32 * 1048576;
/** Compressed copies are kept in memory; the built client is a few MB, so this is a safety cap. */
const MAX_CACHED_BYTES = 128 * 1048576;

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * - index.html (and the SPA fallback): always revalidate, so a deploy shows up on the next load.
 * - /assets/: Vite puts a content hash in every name, so they never change.
 * - /speech/: the Vosk model; its file name changes whenever the archive does (the worker caches by URL).
 * - /models/: names carry no hash, and the client's layout must match the server's, so revalidate
 *   (an ETag makes that a 304) unless the URL is versioned with ?v=, which caches for a year.
 */
export function cacheControl(urlPath: string, search: URLSearchParams, isHtml: boolean): string {
  if (isHtml) return 'no-cache';
  if (urlPath.startsWith('/assets/') || urlPath.startsWith('/speech/')) return IMMUTABLE;
  if (urlPath.startsWith('/models/')) return search.has('v') ? IMMUTABLE : 'no-cache';
  return 'public, max-age=3600';
}

type Encoding = 'br' | 'gzip';

function pickEncoding(header: string | undefined): Encoding | undefined {
  if (!header) return undefined;
  const q = new Map<string, number>();
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    if (name) q.set(name, qParam ? Number(qParam.slice(2)) : 1);
  }
  if ((q.get('br') ?? 0) > 0) return 'br';
  if ((q.get('gzip') ?? 0) > 0) return 'gzip';
  return undefined;
}

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

class StaticFiles {
  private readonly root: string;
  private readonly compressed = new Map<string, Promise<Buffer>>();
  private cachedBytes = 0;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  async serve(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, req, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    }
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return sendText(res, req, 400, 'Bad request');
    }
    const segments = path.split('/').filter((s) => s.length > 0);
    // No dotfiles, no "..", no backslashes or NULs that the OS path functions might interpret.
    if (segments.some((s) => s.startsWith('.') || s.includes('\\') || s.includes('\0'))) {
      return sendText(res, req, 404, 'Not found');
    }

    let file = join(this.root, ...segments);
    if (file !== this.root && !file.startsWith(this.root + sep))
      return sendText(res, req, 404, 'Not found');
    let info = await statOrNull(file);
    if (info?.isDirectory()) {
      file = join(file, 'index.html');
      info = await statOrNull(file);
    }
    if (!info?.isFile()) {
      // A missing asset is a 404 (the speech model check relies on it); only page routes get the app.
      if (extname(segments.at(-1) ?? '') !== '') return sendText(res, req, 404, 'Not found');
      file = join(this.root, 'index.html');
      info = await statOrNull(file);
      if (!info?.isFile()) return sendText(res, req, 404, 'Not found');
    }

    const ext = extname(file).toLowerCase();
    const isHtml = ext === '.html';
    const encoding =
      COMPRESSIBLE.has(ext) && info.size >= MIN_COMPRESS_BYTES && info.size <= MAX_COMPRESS_BYTES
        ? pickEncoding(req.headers['accept-encoding'] as string | undefined)
        : undefined;
    const version = `${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}`;
    // Compressed once per file version and kept, so a later 304 or HEAD costs nothing.
    const body = encoding ? await this.compressedCopy(file, version, encoding) : undefined;
    const etag = `W/"${version}${body && encoding ? `-${encoding}` : ''}"`;
    const headers: Record<string, string | number> = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': cacheControl(url.pathname, url.searchParams, isHtml),
      ETag: etag,
      'Last-Modified': info.mtime.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
    };
    if (COMPRESSIBLE.has(ext)) headers.Vary = 'Accept-Encoding';

    if (notModified(req, etag, info.mtime)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    if (body && encoding) {
      headers['Content-Encoding'] = encoding;
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    headers['Content-Length'] = info.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    pipeline(createReadStream(file), res, (err) => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE')
        console.error('[http] stream', file, err.message);
    });
  }

  /** The compressed file, made once per file version; undefined if the cache is full. */
  private compressedCopy(
    file: string,
    version: string,
    encoding: Encoding,
  ): Promise<Buffer> | undefined {
    const key = `${encoding}:${file}:${version}`;
    let entry = this.compressed.get(key);
    if (!entry) {
      if (this.cachedBytes >= MAX_CACHED_BYTES) return undefined;
      entry = readFile(file).then((raw) =>
        encoding === 'br'
          ? brotli(raw, {
              params: {
                [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
                [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
              },
            })
          : gzipAsync(raw, { level: 9 }),
      );
      entry.then(
        (buf) => (this.cachedBytes += buf.length),
        () => this.compressed.delete(key),
      );
      this.compressed.set(key, entry);
    }
    return entry;
  }
}

function notModified(req: IncomingMessage, etag: string, mtime: Date): boolean {
  const inm = req.headers['if-none-match'];
  if (inm) {
    const weak = (t: string) => t.trim().replace(/^W\//, '');
    return inm === '*' || inm.split(',').some((t) => weak(t) === weak(etag));
  }
  const ims = req.headers['if-modified-since'];
  if (ims) {
    const since = Date.parse(ims);
    return !Number.isNaN(since) && Math.floor(mtime.getTime() / 1000) <= Math.floor(since / 1000);
  }
  return false;
}

async function statOrNull(file: string) {
  try {
    return await stat(file);
  } catch {
    return null;
  }
}
