# Hosting

How the playtest build gets onto the internet: one Node process, one Docker image, one Fly.io machine. Why it's set up this way is in [DECISIONS.md D-013](DECISIONS.md).

## What runs where

In production one process serves everything on one port, so the browser only ever talks to one origin. The client already connects its game socket to `wss://<the page's host>` in production builds (`serverUrl()` in `client/src/net/link.ts`).

| Path | What | Caching |
|---|---|---|
| `/`, any path without a file extension | `client/dist/index.html` (SPA fallback) | `no-cache`: every load picks up a new deploy |
| `/assets/*` | Vite output; every name carries a content hash | 1 year, `immutable` |
| `/models/*.glb`, `*.layout.json` | Blender output, copied into `client/dist/models` by Vite | `no-cache` + ETag (a 304 when unchanged). `?v=<anything>` in the URL makes it 1 year `immutable` |
| `/speech/*` | the Vosk model, if the image has it | 1 year `immutable` (the file name changes whenever the archive does) |
| other files | anything else in `client/public` | 1 hour |
| `/matchmake/*` | Colyseus matchmaking (HTTP POST), then the WebSocket upgrade on the same port | not cached |
| `/healthz` | `{"ok":true,"uptime":812,"rooms":2,"players":7,"build":"3fa9c1e"}`. 503 with `ok:false` while shutting down | `no-store` |
| `/ice` | ICE servers for voice, with short-lived TURN credentials ([below](#voice-turn)) | `no-store` |

A missing file with an extension is a 404, never the app page. The speech-model check in `client/src/speech` relies on that.

Text, JSON, WASM and `.glb` files are compressed (Brotli or gzip) the first time they're requested and kept in memory. `.tar.gz` goes out as plain bytes with `Content-Type: application/gzip`, because the Vosk worker unpacks the archive itself.

The code: `server/src/index.ts` (entry), `http.ts` (files, `/healthz`, `/ice`), `ice.ts`, `status.ts`. Tests: `server/src/http.test.ts`, `ice.test.ts`.

## Run the production build locally

```bash
npm run build                 # typecheck + Vite build into client/dist
PORT=8090 npm start           # PowerShell: $env:PORT=8090; npm start
```

Open http://localhost:8090. Without `PORT` the server takes 2567, which clashes with `npm run dev`.

With Docker (not installed on the dev machine yet):

```bash
docker build -t moon .                              # downloads the speech model
docker build -t moon --build-arg SPEECH_MODEL=0 .   # without it
docker run --rm -p 8080:8080 moon                   # http://localhost:8080
```

## Environment

Runtime (set with `fly secrets set` for secrets, `[env]` in `fly.toml` for the rest):

| Variable | Default | What |
|---|---|---|
| `NODE_ENV` | | `production` serves the client and logs JSON. `npm start` passes `--production`, which sets it. |
| `PORT` / `HOST` | 2567 / all interfaces | The image sets `PORT=8080`. |
| `STATIC_DIR` | `client/dist` | The built client. In production the server refuses to start without `index.html` in it. |
| `MODELS_DIR` | `$STATIC_DIR/models` in production, `client/public/models` in dev | Where the server reads `*.layout.json`, so it runs the same house the players downloaded. |
| `STATUS_LOG_SECONDS` | 300 in production, 0 in dev | Interval of the JSON status line. 0 turns it off. |
| `BUILD_ID` | Fly's `FLY_IMAGE_REF` | Shown as `build` in `/healthz`. Pass it as a build arg (below). |
| `CORS_ORIGINS` | `*` in dev, none in production | Origins allowed to call `/ice` and `/healthz` from another origin: `*` or a comma list. Only needed if the client is hosted elsewhere. |
| `TURN_SECRET`, `TURN_URLS`, `TURN_TTL`, `STUN_URLS` | | coturn TURN, see [Voice](#voice-turn). |
| `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_KEY_API_TOKEN` | | Cloudflare TURN, see [Voice](#voice-turn). |
| `ICE_SERVERS` | | A fixed JSON array of `RTCIceServer`, added to what `/ice` returns. |

Docker build args:

| Arg | Default | What |
|---|---|---|
| `SPEECH_MODEL` | `1` | `0` builds without the 41 MB speech model. |
| `BUILD_ID` | empty | A version label (git SHA). Becomes `BUILD_ID` at runtime and `VITE_BUILD_ID` in the client build. |
| `VITE_ICE_SERVERS` | empty | Build-time fallback ICE list for the client. Prefer `/ice`. |
| `NODE_VERSION` | `22.20.0` | Node 22 LTS, Alpine. |

## Deploy to Fly.io

Needs a Fly.io account with a payment method, and `flyctl` ([install](https://fly.io/docs/flyctl/install/)). Nothing here has been deployed yet.

```bash
fly auth login
fly launch --no-deploy --copy-config --name <your-app> --region <region>   # once; region list: fly platform regions
fly deploy --ha=false --build-arg BUILD_ID=$(git rev-parse --short HEAD)   # works in bash and PowerShell
curl https://<your-app>.fly.dev/healthz
```

- **Exactly one machine.** Dinners live in the server's memory. A second machine would put friends with the same room code into two different dinners. `fly deploy` adds a standby machine unless you pass `--ha=false`. If `fly status` ever shows two, run `fly scale count 1`.
- **A deploy ends every dinner in progress.** The machine is replaced, and clients see the connection drop. Deploy between sessions.
- `auto_stop_machines = "off"` keeps the machine running when nobody's connected, so the first player of the evening doesn't wait for a cold start.
- Fly's own health check calls `/healthz` every 30 s. `fly deploy` waits for it and reports a failed deploy if the new machine never passes.
- Logs: `fly logs`. The status line is one JSON object every five minutes: `fly logs | grep '"msg":"status"'`.
- Size: `shared-cpu-1x` with 512 MB. The server idled at ~120 MB RSS in a local test. Check Fly's pricing page for the current cost.
- Own domain: `fly certs add moon.example.com`, then the DNS records it prints.

### Anywhere else

The image runs on any host that supports WebSockets, runs exactly one instance and doesn't sleep when idle. Scale-to-zero and free tiers that sleep (Render's free tier, for example) lose the dinners. On a plain VPS:

```bash
docker run -d --restart unless-stopped -p 127.0.0.1:8080:8080 --env-file moon.env moon
caddy reverse-proxy --from moon.example.com --to localhost:8080   # TLS; proxies WebSockets as-is
```

### Client and server on different hosts

Not the plan, but possible: build the client with `VITE_SERVER_URL=wss://game.example.com` and set `CORS_ORIGINS=https://client.example.com` on the server. Colyseus matchmaking already allows any origin. The static host must not cap file size below 41 MB if it serves the speech model (see below).

## Voice: TURN

STUN is enough for most home networks. Phones on mobile data or a hotspot (carrier-grade NAT), and office, school or hotel networks that block UDP, need a TURN relay. Restrictive networks often allow only TCP 443, so the relay should listen there too.

**How the client gets its ICE servers:**

1. **`GET /ice` (runtime, preferred).** The server returns STUN plus TURN with credentials that expire, so the TURN secret never ships in the client bundle. *To be wired in `client/src` (see the contract below).*
2. **`VITE_ICE_SERVERS` (build time, fallback).** A JSON array baked into the bundle: `--build-arg 'VITE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]'`. Anything in it is public, so never put long-lived TURN credentials there.
3. **Public STUN** (`stun:stun.l.google.com:19302`) if neither is set.

### The `/ice` contract

`GET /ice` on the game server's HTTP origin (same origin in production; `http://<host>:2567` in dev, where CORS allows any origin). Always 200, never rejects; a provider failure falls back to STUN.

```ts
interface IceConfig {
  iceServers: RTCIceServer[];   // pass straight to new RTCPeerConnection({ iceServers })
  ttl: number;                  // seconds the credentials stay valid; 0 = nothing expires
  source: 'turn-secret' | 'cloudflare' | 'static' | 'stun';
}
```

The server picks the first source that's configured:

| Source | Configure with | Notes |
|---|---|---|
| `turn-secret` | `TURN_SECRET`, `TURN_URLS` (comma list), optional `TURN_TTL` (default 86400), `STUN_URLS` | coturn's `use-auth-secret` scheme: username `<expiry>:<random id>`, credential `base64(HMAC-SHA1(secret, username))`. New credentials per request. |
| `cloudflare` | `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_KEY_API_TOKEN`, optional `TURN_TTL` | Minted through Cloudflare's API and shared by every client until half their life is used up. Port-53 URLs are dropped (browsers block them). |
| `static` | `ICE_SERVERS` | Fixed credentials. Also appended to the two above. |
| `stun` | nothing | `STUN_URLS` or Google's public STUN. |

Credentials last 24 hours by default because browsers refresh TURN allocations with the same credentials, and the relay drops a call once they've expired. Anyone can call `/ice`, as with any WebRTC app. The limits are the expiry and the relay's quotas.

### Option A: Cloudflare Realtime TURN (nothing to run)

1. In the Cloudflare dashboard's Realtime section (formerly Calls), create a TURN key. Note its ID and API token.
2. `fly secrets set CLOUDFLARE_TURN_KEY_ID=<id> CLOUDFLARE_TURN_KEY_API_TOKEN=<token>`
3. `curl https://<your-app>.fly.dev/ice` should show `"source":"cloudflare"` and `turn.cloudflare.com` URLs, including TCP and TLS on 443.

Cloudflare charges per GB relayed beyond a free allowance; check their pricing. Voice is light (a few tens of kbit/s per stream), and only the players who need a relay use it.

### Option B: coturn on a small VPS

TURN doesn't belong on the Fly machine: a relay needs a wide UDP port range and its own public address to advertise, and UDP on Fly goes through its proxy (a dedicated IPv4 and a special bind address). Any small VPS with a public IPv4 address is simpler (Hetzner, for example), with a DNS name like `turn.example.com` pointing at it.

```bash
sudo apt install coturn certbot
sudo certbot certonly --standalone -d turn.example.com   # make the cert readable by the turnserver user
openssl rand -hex 32                                     # the shared secret
```

`/etc/turnserver.conf`:

```ini
listening-port=3478
# TURN over TLS on 443 gets through networks that only allow HTTPS.
tls-listening-port=443
realm=turn.example.com
server-name=turn.example.com
fingerprint
use-auth-secret
static-auth-secret=<the secret>
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
min-port=49152
max-port=65535
# A 6-player mesh is ~15 allocations per player. Cap the total so a leaked credential can't run up a bill.
total-quota=600
stale-nonce=600
no-cli
no-tlsv1
no-tlsv1_1
no-multicast-peers
# Never relay into private networks.
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
# Only behind NAT (AWS, GCP): external-ip=<public ip>/<private ip>
```

Open the firewall for 3478 UDP+TCP, 443 TCP and 49152–65535 UDP. If coturn can't bind 443, give it the capability: `sudo setcap cap_net_bind_service=+ep /usr/bin/turnserver`. Then:

```bash
fly secrets set TURN_SECRET=<the secret> \
  TURN_URLS="turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:443?transport=tcp" \
  STUN_URLS="stun:turn.example.com:3478"
```

### Testing it (the M8 checkbox)

1. `curl https://<your-app>.fly.dev/ice`, paste one TURN URL, username and credential into WebRTC's [Trickle ICE sample](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/), and gather candidates. A `relay` candidate means the relay works and the credentials are accepted.
2. Join a dinner from a phone hotspot and from a network that blocks UDP (a guest or office network, or a firewall rule that blocks outbound UDP for the browser). In `chrome://webrtc-internals` the selected candidate pair should be `relay`, and players should hear each other.
3. A client option that forces `iceTransportPolicy: 'relay'` (a dev URL param, say) makes step 2 testable on any network.

## Speech model

The Vosk model (`vosk-model-small-en-us-0.15`, 41 MB) isn't in the repo ([spike](spikes/M5-keyword-spotting.md#installing-the-model)). The Docker build fetches it in its own stage, so it's cached between builds:

1. Downloads `https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip`.
2. Checks SHA-256 `30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498` and fails the build on a mismatch.
3. Applies the spike's faster endpointer settings to `conf/model.conf` and fails if any edit didn't apply.
4. Repacks it as `vosk-model-small-en-us-0.15.tar.gz` and copies it to `client/dist/speech/`, served at `/speech/vosk-model-small-en-us-0.15.tar.gz` (`DEFAULT_MODEL_URL`).

`--build-arg SPEECH_MODEL=0` (or `SPEECH_MODEL = "0"` in `fly.toml`) leaves it out. The spotter then reports the missing model and typed chat still triggers guests (D-007). A local copy in `client/public/speech` is never sent to the Docker build (`.dockerignore`), so every image gets the checked download.

The other way is a Fly volume mounted at `/app/client/dist/speech` with the archive copied onto it once (`fly ssh sftp shell`). That keeps the image 41 MB smaller but pins the machine to one host. Baking it in is simpler.

**If the client is ever put on a static host instead**, check the per-file limit:

| Host | Per-file limit | Notes |
|---|---|---|
| This server (Fly) | none | |
| Cloudflare Pages | 25 MiB | The model doesn't fit. Serve it from somewhere else, with CORS. |
| itch.io (HTML5 zip) | 200 MB per file, 500 MB and 1,000 files in total | Detects gzip by content and sends `Content-Encoding: gzip`. Per the spike, the worker handles that too. |
| GitHub Pages | 100 MiB (GitHub's push limit) | |

After changing the archive, change its file name too: the worker caches the unpacked model in IndexedDB under its URL.

## Uptime monitoring

- **External check:** [UptimeRobot](https://uptimerobot.com)'s free plan (50 monitors, 5-minute interval). Add a *Keyword* monitor for `https://<your-app>.fly.dev/healthz` that alerts when `"ok":true` is missing, with email alerts. A keyword monitor also catches the 503 sent during shutdown and a proxy error page served with a 200.
- **Fly:** the `/healthz` check in `fly.toml` shows in `fly status` and the dashboard.
- **Logs:** a status line every five minutes, which also shows memory growth over a long evening:

  ```json
  {"time":"2026-10-31T08:09:05.041Z","msg":"status","ok":true,"uptime":20,"rooms":1,"players":0,"rssMb":119,"heapMb":30}
  ```

## Owner checklist

- [ ] Fly.io account with a payment method, `flyctl` installed, app name and region picked (`fly launch`).
- [ ] First deploy with `--ha=false`. Check `/healthz`, play a dinner with two browsers.
- [ ] TURN: a Cloudflare TURN key, or a VPS + domain for coturn. Set the secrets. Wire `/ice` in the client.
- [ ] Test voice on a hotspot and a UDP-blocking network.
- [ ] UptimeRobot keyword monitor on `/healthz`.
- [ ] Optional: own domain (`fly certs add`).
