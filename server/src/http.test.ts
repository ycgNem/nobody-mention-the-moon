// The production HTTP layer on a real Colyseus server: static files next to matchmaking.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@colyseus/sdk';
import { ROOM_NAME } from '@moon/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app.ts';
import { attachHttp } from './http.ts';
import { createIceProvider } from './ice.ts';
import { serverStatus } from './status.ts';

const PORT = 26670 + (process.pid % 1000);
const BASE = `http://localhost:${PORT}`;
const BUNDLE = `console.log(${JSON.stringify('dinner '.repeat(400))});\n`;

let server: Awaited<ReturnType<typeof createGameServer>>;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'moon-http-'));
  const dist = join(root, 'dist');
  for (const dir of ['assets', 'models', 'speech'])
    await mkdir(join(dist, dir), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>Moon</title>');
  await writeFile(join(dist, 'assets', 'index-AbC123.js'), BUNDLE);
  await writeFile(join(dist, 'models', 'chair.glb'), Buffer.from('glTF\x02\x00\x00\x00'));
  await writeFile(join(dist, 'speech', 'model.tar.gz'), Buffer.from([0x1f, 0x8b, 8, 0]));
  await writeFile(join(root, 'moon-secret.txt'), 'outside the static dir');

  server = await createGameServer();
  await server.listen(PORT);
  const http = server.transport.server;
  if (!http) throw new Error('no http server');
  attachHttp(http, {
    staticDir: join(root, 'dist'),
    ice: createIceProvider({}),
    status: serverStatus,
    corsOrigins: [],
  });
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
  await rm(root, { recursive: true, force: true });
});

const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  fetch(`${BASE}${path}`, { method, headers });

describe('production HTTP', () => {
  it('reports health as JSON', async () => {
    const res = await get('/healthz');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, rooms: 0, players: 0 });
    expect(typeof body.uptime).toBe('number');
    expect((await get('/healthz', {}, 'HEAD')).status).toBe(200);
  });

  it('serves the app shell uncached, with an SPA fallback for page routes only', async () => {
    for (const path of ['/', '/index.html', '/lobby/ABCD']) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(await res.text()).toContain('<title>Moon</title>');
    }
    expect((await get('/assets/missing-123.js')).status).toBe(404);
    expect((await get('/speech/missing.tar.gz', {}, 'HEAD')).status).toBe(404);
  });

  it('caches hashed assets forever, compresses them, and answers revalidation with 304', async () => {
    const res = await get('/assets/index-AbC123.js', { 'accept-encoding': 'gzip, br' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('content-encoding')).toBe('br');
    expect(Number(res.headers.get('content-length'))).toBeLessThan(BUNDLE.length / 4);
    expect(await res.text()).toBe(BUNDLE);

    const etag = res.headers.get('etag') ?? '';
    const again = await get('/assets/index-AbC123.js', {
      'accept-encoding': 'gzip, br',
      'if-none-match': etag,
    });
    expect(again.status).toBe(304);

    const plain = await get('/assets/index-AbC123.js', { 'accept-encoding': 'identity' });
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(Number(plain.headers.get('content-length'))).toBe(BUNDLE.length);
  });

  it('revalidates unversioned models and caches versioned ones', async () => {
    const res = await get('/models/chair.glb');
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('etag')).toBeTruthy();
    expect((await get('/models/chair.glb?v=abc')).headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('sends the speech model as plain gzip bytes', async () => {
    const res = await get('/speech/model.tar.gz', { 'accept-encoding': 'gzip, br' });
    expect(res.headers.get('content-type')).toBe('application/gzip');
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x1f, 0x8b, 8, 0]));
  });

  it('never serves files outside the build or dotfiles', async () => {
    for (const path of [
      '/../moon-secret.txt',
      '/%2e%2e/moon-secret.txt',
      '/assets/..%2f..%2fmoon-secret.txt',
      '/.env',
    ]) {
      expect((await get(path)).status, path).toBe(404);
    }
    expect((await get('/index.html', {}, 'POST')).status).toBe(405);
  });

  it('hands out ICE servers', async () => {
    const res = await get('/ice');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({
      source: 'stun',
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
    });
  });

  it('still matchmakes and connects players over the same port', async () => {
    const mm = await fetch(`${BASE}/matchmake/joinOrCreate/${ROOM_NAME}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'HTTP', name: 'Probe' }),
    });
    expect(mm.status).toBe(200);
    expect(await mm.json()).toMatchObject({ name: ROOM_NAME, sessionId: expect.any(String) });

    const room = await new Client(`ws://localhost:${PORT}`).joinOrCreate(ROOM_NAME, {
      code: 'HTTQ',
      name: 'Ada',
    });
    try {
      const health = (await (await get('/healthz')).json()) as { rooms: number; players: number };
      expect(health.rooms).toBeGreaterThanOrEqual(1);
      expect(health.players).toBe(1);
    } finally {
      await room.leave();
    }
  });
});
