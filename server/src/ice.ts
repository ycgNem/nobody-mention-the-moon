// ICE servers for voice (WebRTC), handed to clients by GET /ice so TURN credentials can be
// short-lived and the TURN secret never ships in the client bundle. See docs/HOSTING.md.
//
// Sources, first match wins:
//   1. TURN_SECRET + TURN_URLS: coturn's `use-auth-secret` scheme (the "TURN REST API"):
//      username = "<expiry unix seconds>:<id>", credential = base64(HMAC-SHA1(secret, username)).
//   2. CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_KEY_API_TOKEN: Cloudflare Realtime TURN mints them.
//   3. ICE_SERVERS: a static JSON array of RTCIceServer (any provider with fixed credentials).
//   4. Public STUN only.
// STUN_URLS (comma-separated) replaces the default public STUN server in 1, 3 and 4.

import { createHmac, randomBytes } from 'node:crypto';

/** The JSON shape of an RTCIceServer (the DOM type isn't available to the server). */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** The body of GET /ice. */
export interface IceConfig {
  iceServers: IceServer[];
  /** Seconds the credentials stay valid. Fetch again after this (0: no credentials to expire). */
  ttl: number;
  source: 'turn-secret' | 'cloudflare' | 'static' | 'stun';
}

export type IceEnv = Partial<
  Record<
    | 'TURN_SECRET'
    | 'TURN_URLS'
    | 'TURN_TTL'
    | 'STUN_URLS'
    | 'CLOUDFLARE_TURN_KEY_ID'
    | 'CLOUDFLARE_TURN_KEY_API_TOKEN'
    | 'ICE_SERVERS',
    string
  >
>;

export interface IceDeps {
  /** Milliseconds since the epoch. */
  now?: () => number;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
}

const DEFAULT_STUN = ['stun:stun.l.google.com:19302'];
// Credentials must outlive the longest session: browsers refresh TURN allocations with the
// same credentials, and coturn rejects the refresh once the expiry in the username has passed.
const DEFAULT_TTL_S = 24 * 3600;
const CLOUDFLARE_TIMEOUT_MS = 5000;

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** coturn `use-auth-secret` credentials for one client. */
export function turnRestCredentials(secret: string, ttlS: number, nowMs: number, id: string) {
  const username = `${Math.floor(nowMs / 1000) + ttlS}:${id}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

function isIceServer(v: unknown): v is IceServer {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  const urlsOk =
    typeof s.urls === 'string' ||
    (Array.isArray(s.urls) && s.urls.every((u) => typeof u === 'string'));
  const opt = (k: string) => s[k] === undefined || typeof s[k] === 'string';
  return urlsOk && opt('username') && opt('credential');
}

function parseStatic(raw: string | undefined, log: (msg: string) => void): IceServer[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(isIceServer)) return parsed;
  } catch {
    // fall through
  }
  log('ICE_SERVERS is not a JSON array of RTCIceServer objects; ignoring it');
  return [];
}

/** Browsers block port 53, so Cloudflare's alternate-port URL would only time out. */
function withoutPort53(server: IceServer): IceServer {
  const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
    (u) => !/:53(\?|$)/.test(u),
  );
  return { ...server, urls };
}

/**
 * Returns the GET /ice handler's data source. Reads `env` once; secrets stay in this closure.
 * Never rejects: a failing provider falls back to STUN so voice still works on open networks.
 */
export function createIceProvider(
  env: IceEnv = process.env,
  deps: IceDeps = {},
): () => Promise<IceConfig> {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetch ?? fetch;
  const log = deps.log ?? ((msg: string) => console.warn(`[ice] ${msg}`));

  const stun = list(env.STUN_URLS);
  const stunServers: IceServer[] = [{ urls: stun.length > 0 ? stun : DEFAULT_STUN }];
  const ttlS = Math.max(60, Math.floor(Number(env.TURN_TTL) || DEFAULT_TTL_S));
  const fixed = parseStatic(env.ICE_SERVERS, log);
  const fallback = (): IceConfig =>
    fixed.length > 0
      ? { iceServers: [...stunServers, ...fixed], ttl: 0, source: 'static' }
      : { iceServers: stunServers, ttl: 0, source: 'stun' };

  const secret = env.TURN_SECRET;
  const turnUrls = list(env.TURN_URLS);
  if (secret && turnUrls.length > 0) {
    return () => {
      const id = randomBytes(6).toString('hex');
      const creds = turnRestCredentials(secret, ttlS, now(), id);
      return Promise.resolve({
        iceServers: [...stunServers, { urls: turnUrls, ...creds }],
        ttl: ttlS,
        source: 'turn-secret',
      });
    };
  }
  if (secret || turnUrls.length > 0) log('TURN_SECRET and TURN_URLS must both be set; TURN is off');

  const cfKey = env.CLOUDFLARE_TURN_KEY_ID;
  const cfToken = env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  if (cfKey && cfToken) {
    // One credential set is shared by every client until half its life is gone, so a busy
    // (or abused) /ice endpoint doesn't turn into one Cloudflare API call per request.
    let cached: { servers: IceServer[]; expiresMs: number } | undefined;
    let pending: Promise<IceServer[]> | undefined;
    const mint = async (): Promise<IceServer[]> => {
      const res = await doFetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cfKey)}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${cfToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ttl: ttlS }),
          signal: AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS),
        },
      );
      if (!res.ok) throw new Error(`Cloudflare TURN answered ${res.status}`);
      const body = (await res.json()) as { iceServers?: unknown };
      const servers = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
      if (!servers.every(isIceServer)) throw new Error('unexpected Cloudflare TURN response');
      return servers.map(withoutPort53).filter((s) => s.urls.length > 0);
    };
    return async () => {
      const t = now();
      if (!cached || t > cached.expiresMs - (ttlS * 1000) / 2) {
        try {
          pending ??= mint();
          cached = { servers: await pending, expiresMs: t + ttlS * 1000 };
        } catch (err) {
          log(
            `could not get Cloudflare TURN credentials (${String(err)}); handing out the fallback`,
          );
          return fallback();
        } finally {
          pending = undefined;
        }
      }
      return {
        iceServers: [...cached.servers, ...fixed],
        ttl: Math.max(0, Math.floor((cached.expiresMs - t) / 1000)),
        source: 'cloudflare',
      };
    };
  }

  return () => Promise.resolve(fallback());
}
