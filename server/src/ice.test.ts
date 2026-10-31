import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createIceProvider, turnRestCredentials, type IceServer } from './ice.ts';

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const now = () => NOW;
const quiet = { now, log: () => {} };

describe('turnRestCredentials (coturn use-auth-secret)', () => {
  it('puts the expiry in the username and signs it with HMAC-SHA1', () => {
    const { username, credential } = turnRestCredentials('s3cret', 3600, NOW, 'abc');
    expect(username).toBe(`${NOW / 1000 + 3600}:abc`);
    expect(credential).toBe(createHmac('sha1', 's3cret').update(username).digest('base64'));
  });
});

describe('createIceProvider', () => {
  it('hands out public STUN only when nothing is configured', async () => {
    const cfg = await createIceProvider({}, quiet)();
    expect(cfg).toEqual({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
      ttl: 0,
      source: 'stun',
    });
  });

  it('mints fresh coturn credentials per request from TURN_SECRET', async () => {
    const ice = createIceProvider(
      {
        TURN_SECRET: 'k',
        TURN_URLS:
          'turn:turn.example.com:3478?transport=udp, turns:turn.example.com:443?transport=tcp',
        STUN_URLS: 'stun:turn.example.com:3478',
      },
      quiet,
    );
    const a = await ice();
    const b = await ice();
    expect(a.source).toBe('turn-secret');
    expect(a.ttl).toBe(86400);
    expect(a.iceServers[0]).toEqual({ urls: ['stun:turn.example.com:3478'] });
    const turn = a.iceServers[1] as Required<IceServer>;
    expect(turn.urls).toEqual([
      'turn:turn.example.com:3478?transport=udp',
      'turns:turn.example.com:443?transport=tcp',
    ]);
    expect(turn.username).toMatch(new RegExp(`^${NOW / 1000 + 86400}:[0-9a-f]{12}$`));
    expect(turn.credential).toBe(createHmac('sha1', 'k').update(turn.username).digest('base64'));
    expect((b.iceServers[1] as IceServer).username).not.toBe(turn.username);
  });

  it('needs both TURN_SECRET and TURN_URLS', async () => {
    const log = vi.fn();
    const cfg = await createIceProvider({ TURN_SECRET: 'k' }, { now, log })();
    expect(cfg.source).toBe('stun');
    expect(log).toHaveBeenCalledOnce();
  });

  it('passes a static ICE_SERVERS list through and ignores a malformed one', async () => {
    const list = [{ urls: 'turn:relay.example.com:3478', username: 'u', credential: 'p' }];
    const ok = await createIceProvider({ ICE_SERVERS: JSON.stringify(list) }, quiet)();
    expect(ok.source).toBe('static');
    expect(ok.iceServers.slice(1)).toEqual(list);

    const log = vi.fn();
    const bad = await createIceProvider({ ICE_SERVERS: '{"urls": 5}' }, { now, log })();
    expect(bad.source).toBe('stun');
    expect(log).toHaveBeenCalledOnce();
  });

  it('gets Cloudflare credentials, drops port 53, and reuses them for half their life', async () => {
    let t = NOW;
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json(
        {
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
            {
              urls: [
                'turn:turn.cloudflare.com:3478?transport=udp',
                'turn:turn.cloudflare.com:53?transport=udp',
              ],
              username: 'cf-user',
              credential: 'cf-pass',
            },
          ],
        },
        { status: 201 },
      ),
    );
    const ice = createIceProvider(
      { CLOUDFLARE_TURN_KEY_ID: 'key', CLOUDFLARE_TURN_KEY_API_TOKEN: 'token', TURN_TTL: '7200' },
      { now: () => t, fetch: fetchFn as typeof fetch, log: () => {} },
    );
    const first = await ice();
    expect(first.source).toBe('cloudflare');
    expect(first.ttl).toBe(7200);
    expect(first.iceServers).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      {
        urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
        username: 'cf-user',
        credential: 'cf-pass',
      },
    ]);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/key/credentials/generate-ice-servers',
    );
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ ttl: 7200 });
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token');

    t += 3000 * 1000;
    expect((await ice()).ttl).toBe(4200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    t += 1000 * 1000; // past half the TTL: mint again
    expect((await ice()).ttl).toBe(7200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('falls back to STUN when Cloudflare fails', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 401 }));
    const log = vi.fn();
    const cfg = await createIceProvider(
      { CLOUDFLARE_TURN_KEY_ID: 'key', CLOUDFLARE_TURN_KEY_API_TOKEN: 'bad' },
      { now, fetch: fetchFn as typeof fetch, log },
    )();
    expect(cfg.source).toBe('stun');
    expect(log).toHaveBeenCalledOnce();
  });
});
