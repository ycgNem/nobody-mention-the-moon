# Tech Plan

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript, `strict: true`**, everywhere | House rule. One language across client, server and shared rules. |
| Client build | **Vite** | House standard. Fast HMR. |
| Rendering | **Three.js** (pinned) + matching `@types/three` | House standard for 3D |
| 3D assets | **Blender 5.2 LTS, driven by Python (`bpy`) build scripts** → `.glb` + `.layout.json` | Every model is rebuilt from code: easy to diff, tweak and regenerate. See [Art pipeline](#art-pipeline-blender-python--threejs). |
| Physics | **Rapier** (`@dimforge/rapier3d-compat`) | WASM, deterministic-ish, runs the same on client and Node, good TS types |
| Multiplayer | **Colyseus** (Node, TypeScript) | Room-based authoritative server with schema state sync and built-in reconnection. A lobby code maps to a room. |
| Voice | **WebRTC mesh** (≤6 peers) with signaling through the Colyseus room | No media server needed at this player count. |
| Proximity audio | **Web Audio**: `PannerNode` per remote player plus a room-occlusion low-pass | Kitchen and dining room muffling is a core mechanic |
| Keyword spotting | **On-device**, engine chosen in the M5 spike (see below) | Privacy, works offline, small fixed vocabulary |
| Tests | **Vitest** | Rules in `shared/` are pure and tested |
| Lint/format | ESLint (typescript-eslint) + Prettier | |

Exact versions get pinned in M0 and recorded in DECISIONS.md.

## Architecture

```
┌──────────────── client (browser) ────────────────┐        ┌────────── server (Node) ──────────┐
│ Three.js scene ← interpolated snapshots          │        │ Colyseus DinnerRoom                │
│ Input → local prediction (own body, held prop)   │──cmds─▶│  ├─ shared/sim  (rules, 10 Hz beats│
│ Rapier (prediction only)                         │        │  │   & meters, deterministic)       │
│ UI: wheel, ledger, HUD, results                  │◀─state─│  ├─ Rapier world (props, 30 Hz)     │
│ Voice: WebRTC mesh + Web Audio proximity         │        │  ├─ guest AI (seat, head-look, LOS) │
│ KWS: mic → keyword events {word,t} ──────────────│──────▶ │  └─ earshot check → trigger         │
└──────────────────────────────────────────────────┘        └────────────────────────────────────┘
                     ▲  WebRTC audio (peer-to-peer, never via server) ▲
```

### The game host (D-015)
`shared/src/game/DinnerGame.ts` is the whole authoritative game: lobby, players, Rapier props, doors, the kitchen, guests walking about, and the dinner sim. It takes `Command`s and produces a `GameView` plus events.
- **Online**, `server/src/DinnerRoom.ts` runs it and copies the view into a Colyseus schema (`server/src/schema.ts`) that mirrors `GameView` field for field. `''` or `-1` means "none"; nothing is optional.
- **Solo**, `client/src/net/link.ts` `LocalLink` runs the same class in the tab. The client only talks to a `GameLink` (`LocalLink` or `NetLink`), so solo and online share all client code.
- `client/src/game/GameClient.ts` is one player's view of it: prediction, interpolation, aiming, prompts, input → commands, and events → log lines, tells and sounds.

### Authority model
- **Server is authoritative** for everything that matters to rules: guest state, meters, topics, the Rumor Ledger, Rule checks, event deck, prop positions.
- **Clients predict** their own movement and any prop they're **holding** (the holder owns it, and the server validates the position within a speed bound). Everything else is interpolated from snapshots (~100 ms buffer).
- Physics on the server at 30 Hz. Game sim tick at 10 Hz. Topic beats are driven by the sim clock.
- Co-op game, friends only: anti-cheat isn't a goal. Keep validation cheap and aimed at stopping desyncs, not cheaters.

### The sim (`shared/sim`)
- Pure functions over a plain `DinnerState` object: `step(state, dt, world)` and `act(state, action, world)` update it in place and return events (D-012). No Three.js, no DOM, no `Math.random`.
- Split by concern (D-016): `setup.ts` (seeded dinner creation), `core.ts` (queries and meters), `guests.ts` (quirks, relationships, monster mechanics, objectives), `events.ts` (the event deck and visitors), `dinner.ts` (the evening and actions), `results.ts`, and `bot.ts` (the rules-aware bot behind `npm run audit`).
- **Seeded RNG** (e.g. sfc32 or mulberry32) from the dinner seed. The same seed and inputs give the same dinner, which we need for the seed-sharing feature, for debugging and for the incident reel.
- Solo play runs this exact sim in the browser with no server. Balance questions run it headless over many seeds (`npm run audit`, or `createDinner` + `step`/`act`).
- **Line-of-sight, earshot and darkness** are queries the sim asks through an injected `SimWorld` interface. The game host backs it with Rapier raycasts and the room graph; tests use `OPEN_WORLD`, where everyone sees and hears everything.

### Voice
- Each client opens a WebRTC peer connection to every other client (mesh). Signaling (offer/answer/ICE) goes through Colyseus room messages.
- Each remote stream → `MediaStreamSource` → `BiquadFilter` (low-pass for muffling) → `PannerNode` (HRTF, position from the remote player's interpolated head) → gain → destination.
- **Muffling** uses a **room graph** (kitchen, dining, hallway, garage, cellar, bathroom, garden) with door states. Distance in the room graph and closed doors set the low-pass cutoff and the gain. The server uses the *same* room graph for guest earshot, so what players hear lines up with what guests hear.
- **NAT traversal:** STUN (public) is enough for most home networks. Some need **TURN**. Online clients fetch ICE servers from the game server's `/ice`, which mints short-lived coturn or Cloudflare credentials (D-013); `VITE_ICE_SERVERS` and public STUN are the fallbacks.
- Push-to-talk default with open mic as an option. Per-player mute and volume (Settings → Other hosts). A speaking indicator above heads.

### Keyword spotting (D-014)
**Vosk in WASM** with its grammar restricted to the trigger vocabulary plus ~340 decoy words, in a Web Worker. Words fire once Vosk has scored them (`SPEECH.mode = 'confirmed'`, about 0.5 s after the word, almost no false hits). Web Speech is an opt-in fallback only, because Chrome and Edge send its audio off the device. Measurements: [spikes/M5-keyword-spotting.md](spikes/M5-keyword-spotting.md).

The pipeline: `getUserMedia` → AudioWorklet (16 kHz mono) → engine in a **Web Worker** → `{word, confidence, t}` → debounce → `{c: 'heard', word}` to the game host, only while you're talking to the table (push-to-talk held, or open mic). **Raw audio and transcripts never leave the device** (D-006). `client/src/game/Listening.ts` runs it; the 41 MB model is git-ignored and lives in `client/public/speech/`.

Typed chat runs through the same matcher on the server, so mic-less players hit the same triggers.

## Art pipeline: Blender Python → Three.js

**Every 3D asset is made by a Python script run in Blender.** The scripts are the source of truth. The `.glb` files are build output. Nobody hand-edits a `.blend` and then forgets how they made it. To change the chair, change `chair.py` and rebuild.

```
blender/assets/props/chair.py ──┐
blender/lib/*.py (palette,      ├─▶ blender -b -P blender/build.py -- chair ─▶ client/public/models/chair.glb
  prims, sockets, export)  ─────┘                                          └─▶ client/public/models/chair.layout.json (only if it has gameplay data)
```

### How it runs
- **Headless:** `blender -b --factory-startup -P blender/build.py -- <asset|all>`. `--factory-startup` keeps the user's Blender prefs and add-ons from changing the output.
- **npm wrappers:** `npm run art` (build all) and `npm run art -- chair` (one asset). The script finds Blender through the `BLENDER_PATH` env var. On this machine that's the Steam install: `C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe` (5.2.3 LTS).
- **Live iteration:** the Blender MCP can run the same asset script in an open Blender to eyeball it and take screenshots. The headless build is still what produces the shipped file.
- Vite serves `client/public/models/` as-is. In dev, rebuilding an asset and reloading the page shows the change.
- Built `.glb`/`.json` files **are committed**, so the game runs on a machine without Blender.

### Script contract
Each asset script exposes one function:

```python
def build(ctx: BuildContext) -> None:
    """Create the asset's objects in the (empty) scene. build.py handles reset + export."""
```

`build.py` resets the scene, calls `build()`, validates the result (naming, tri budget, transforms applied), then exports. Every script is deterministic: no unseeded `random`, so rebuilding unchanged code gives the same file.

### `blender/lib/` (shared helpers)
- `palette.py`: **one shared palette texture** (a small color-swatch atlas). Every mesh UV-maps its faces onto swatches, so the whole game can share 1–2 materials and draw calls stay low. Palette colors are named (`wood_dark`, `cloth_red`, `skin_werewolf`…) and also exported to `shared/src/content/palette.ts` for the client to use.
- `prims.py`: low-poly building blocks (beveled box, tapered cylinder, rounded blob, plank, cushion) tuned to the chunky style.
- `sockets.py`: helpers for adding empties (`socket_*`, `seat_*`, `col_*`, `room_*`, `door_*`, `interact_*`).
- `export.py`: glTF export with fixed settings (GLB, +Y up, apply modifiers, **custom properties exported as extras**, animations from NLA tracks).

### Naming conventions (read by the game)
| Prefix | What it is | Used by |
|---|---|---|
| *(none)* | Visible mesh | Client render |
| `col_box_*`, `col_capsule_*` | Simple collider shape (hidden at export) | Rapier on server and client |
| `socket_*` | Attach point (hat, held prop, plate spot) | Client |
| `seat_*` | A table seat: position + facing | Sim (seat ring), client |
| `room_*` | Room volume (box) with `room_id` custom prop | Room graph: earshot, muffling, LOS |
| `door_*` | Door between two rooms (`a`, `b` custom props) | Room graph |
| `interact_*` | Interactable with `kind` prop (`curtain`, `light`, `mirror`, `record_player`…) | Sim + client |

Custom properties on objects come through to Three.js as `object.userData` (glTF extras).

### Two outputs per gameplay asset
- **`.glb`**: what the client renders.
- **`.layout.json`**: gameplay data pulled from the same scene (colliders, seats, rooms, doors, interactables), with a type in `shared/src/types.ts` and runtime validation. The **server and the M1 2D debug board read this JSON and never parse glTF.** That way the house the players see and the house the rules run on can't drift apart.

### Characters and animation
- Hosts and guests share **one simple humanoid rig** built by script (~15 bones). Guest types are a body-shape preset plus a disguise kit of meshes attached to `socket_*`.
- Animations are keyframed in Python (sit-idle, eat, flinch, slip variants, walk, carry) as named actions pushed to NLA tracks, exported as glTF clips, and played with `THREE.AnimationMixer`. Clip names are a shared constant list so TS gets a type error on a typo.
- Wobble and sway are procedural in Three.js, not baked.

### Budgets (validated in `build.py`)
- Props ≤ 500 tris, a whole house ≤ 60k. `humanoid.glb` holds every outfit, hair, accessory and slip kit in one file (≤ 10.5k); a dressed guest shows about 3.3k of it.
- Transforms applied, origin at the base center, meters, no N-gons in the export.
- Lighting (M6): ambient occlusion (not light, which changes at runtime) is baked in Blender (Cycles) into a second UV set for an asset with `BAKE = "ao"` (`blender/lib/bake.py`), saved as `<asset>_ao.webp`. The client uses it as `aoMap` (D-020), and dynamic candle lights stay few and small.

### Compression
`npm run art` meshopt-compresses every `.glb` it just exported (gltf-transform in `tools/art.ts`), without quantizing positions so pivots stay put (D-020).

## Folder layout

```
nobody-mention-the-moon/
├─ package.json            # npm workspaces: client, server, shared
├─ tsconfig.base.json      # strict, shared compiler options
├─ client/
│  ├─ index.html
│  └─ src/
│     ├─ main.ts           # loading, the join form, settings, the dev handle (window.__moon)
│     ├─ game/             # GameClient (one player's view), Targeting, SoundDirector, Listening
│     ├─ net/              # GameLink: LocalLink (solo) and NetLink (Colyseus), interpolation
│     ├─ players/          # LocalPlayer: Rapier prediction for your own body
│     ├─ render/           # stage, house, characters, guests, props, event visuals
│     ├─ input/            # keyboard, mouse, gamepad, bindings
│     ├─ ui/               # GameHud (lobby, booking, HUD, fridge, notes, wheel, results), Settings
│     ├─ audio/            # synthesized SFX, murmurs, music, mixer (D-017)
│     ├─ voice/            # WebRTC mesh, proximity audio graph, VAD
│     └─ speech/           # keyword spotting: worklet, Vosk worker, matcher
├─ server/
│  └─ src/
│     ├─ index.ts          # Colyseus bootstrap + production HTTP (static client, /healthz, /ice)
│     ├─ DinnerRoom.ts     # runs a DinnerGame per room code
│     ├─ schema.ts         # Colyseus schema mirroring GameView
│     └─ http.ts, ice.ts, status.ts, world.ts
├─ shared/
│  └─ src/
│     ├─ game/             # DinnerGame (the authoritative host), commands, props, view types
│     ├─ sim/              # pure rules (see "The sim")
│     ├─ content/          # guests, quirks, dishes, topics, occasions, events, relationships, characters
│     ├─ house/            # room graph: earshot, visibility, muffling
│     ├─ layout.ts         # .layout.json type + validator
│     ├─ physics.ts        # shared movement for prediction and validation
│     ├─ rng.ts
│     └─ tuning.ts         # every tunable number
├─ blender/                # Python (bpy) asset build scripts, the ONLY non-TS code (D-008)
│  ├─ build.py             # entry: reset scene → build() → validate → export
│  ├─ lib/                 # palette, prims, char_prims, rig, sockets, layout, validate, furniture/
│  └─ assets/              # house/, props/, characters/
├─ client/public/models/   # build output: *.glb + *.layout.json + baked *_ao.webp (committed)
├─ tools/
│  ├─ art.ts               # `npm run art`: finds Blender, runs build.py headless, meshopt-compresses
│  └─ audit.ts             # `npm run audit`: the 1,000-seed repeatability audit
└─ docs/
```

## Conventions

- `strict: true` from the first commit. No `any` without a `// why:` comment.
- **Content is data:** a guest type is a `GuestDef` object (interests, triggers[], eats[], tells[], slip, quirkPool[]). Trigger kinds form a discriminated union (`{kind: 'word', words: [...]} | {kind: 'dish', tags: [...]} | …`), so adding a kind is a compile-time-checked change.
- All tuning lives in `shared/tuning.ts`.
- Sim functions take state and return new state. They're tested with fixed seeds.
- Client rendering never decides rules. If the client needs to know something, it reads it from server state.

## Hosting (D-013)

- One Node process serves the built client, the game WebSocket, `/healthz` and `/ice` on one port, as a Docker image on a single Fly.io machine (rooms live in memory, so exactly one).
- TURN runs elsewhere (coturn on a small VPS, or Cloudflare's TURN service); the game server only mints credentials.
- No accounts and no database. Nothing is persisted, by design (D-003).
- Setup and every environment variable: [HOSTING.md](HOSTING.md).

## Main technical risks

| Risk | Mitigation |
|---|---|
| Keyword spotting accuracy or CPU cost | Spike early (M5 is independent of M2–M4 and can run in parallel). Typed fallback is always there. Trigger words are a *spice*, not a required mechanic. |
| WebRTC connectivity | TURN by M8. Test on mobile hotspot and a corporate-ish network. |
| Physics sync jitter with 6 players and lots of props | Hold-ownership model. Sleep props aggressively. Cap live props. |
| Scripted modeling looks too boxy | Invest early in `prims.py` (bevels, tapers, soft blobs) and a strong palette. Judge from screenshots on the Blender MCP before exporting. The chunky style suits generated geometry. |
| Topic system not fun | M1's rules live in `shared/sim` with no netcode, played in the greybox (D-012). Playtest before piling on content. |
| Browser performance (Three.js + Rapier + KWS + 5 audio streams) | Budget: 60 fps on a mid laptop iGPU. KWS in a worker. Instanced props. Baked lighting. |
