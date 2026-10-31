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

### Authority model
- **Server is authoritative** for everything that matters to rules: guest state, meters, topics, the Rumor Ledger, Rule checks, event deck, prop positions.
- **Clients predict** their own movement and any prop they're **holding** (the holder owns it, and the server validates the position within a speed bound). Everything else is interpolated from snapshots (~100 ms buffer).
- Physics on the server at 30 Hz. Game sim tick at 10 Hz. Topic beats are driven by the sim clock.
- Co-op game, friends only: anti-cheat isn't a goal. Keep validation cheap and aimed at stopping desyncs, not cheaters.

### The sim (`shared/sim`)
- Pure functions over a plain `DinnerState` object: `step(state, inputs, dt) → state`. No Three.js, no DOM, no `Math.random`.
- **Seeded RNG** (e.g. sfc32 or mulberry32) from the dinner seed. The same seed and inputs give the same dinner, which we need for the seed-sharing feature, for debugging and for the incident reel.
- The M1 **2D debug board** runs this exact sim in the browser with no server, so rule tuning happens there.
- **Line-of-sight and earshot** are queries the sim asks through an injected `World` interface. On the server it's backed by Rapier raycasts and room graph distances. In the debug board it's a simple 2D approximation.

### Voice
- Each client opens a WebRTC peer connection to every other client (mesh). Signaling (offer/answer/ICE) goes through Colyseus room messages.
- Each remote stream → `MediaStreamSource` → `BiquadFilter` (low-pass for muffling) → `PannerNode` (HRTF, position from the remote player's interpolated head) → gain → destination.
- **Muffling** uses a **room graph** (kitchen, dining, hallway, garage, cellar, bathroom, garden) with door states. Distance in the room graph and closed doors set the low-pass cutoff and the gain. The server uses the *same* room graph for guest earshot, so what players hear lines up with what guests hear.
- **NAT traversal:** STUN (public) is enough for most home networks. Some need **TURN**. Plan for a cheap hosted TURN (or coturn on the same box as the game server) by M8.
- Push-to-talk default with open mic as an option. Per-player mute and volume. A speaking indicator above heads.

### Keyword spotting (M5 spike)
Requirements: on-device, a fixed vocabulary of ~60 words and phrases, under 300 ms latency, works in Chrome, Edge and Firefox, low CPU alongside Three.js.

Candidates to compare in the spike:
1. **Vosk (WASM, grammar-restricted)**: restricting it to our word list should keep false positives down and runs in all browsers. Model download size is the main cost.
2. **Web Speech API**: zero download, but Chromium-only, may send audio to a cloud service (breaks D-006), and works on continuous dictation rather than keywords. **Fallback only**, behind an explicit opt-in.
3. **A small custom keyword-spotting model** (TF.js / ONNX Runtime Web): best latency and size, but needs training data for every word. Only if 1 fails.

The pipeline is the same whichever engine wins: `getUserMedia` → AudioWorklet (16 kHz mono) → engine in a **Web Worker** → `{word, confidence, t}` → debounce → send to server. **Raw audio and transcripts never leave the device**. Only matched vocabulary words are sent.

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
- Props ≤ 500 tris, characters ≤ 3k, a whole house ≤ 60k.
- Transforms applied, origin at the base center, meters, no N-gons in the export.
- Lighting (M6): a lightmap is baked in Blender (Cycles) to a second UV set for the house. The client uses `lightMap`, and dynamic candle lights stay few and small.

### Optional post-step (M6+)
Compress the `.glb` files (meshopt) with `@gltf-transform/cli` in an npm script, which keeps that step in the TS/Node toolchain.

## Folder layout (target after M0)

```
nobody-mention-the-moon/
├─ package.json            # npm workspaces: client, server, shared
├─ tsconfig.base.json      # strict, shared compiler options
├─ client/
│  ├─ index.html
│  ├─ vite.config.ts
│  └─ src/
│     ├─ main.ts
│     ├─ net/              # Colyseus client, snapshot interpolation
│     ├─ render/           # Three.js scene, house, characters, VFX
│     ├─ physics/          # Rapier prediction for own body + held props
│     ├─ input/            # keyboard/mouse, wheel, push-to-talk
│     ├─ ui/               # HUD, small-talk wheel, ledger, results (DOM overlay)
│     ├─ voice/            # WebRTC mesh, proximity audio graph
│     ├─ speech/           # KWS worker + matcher
│     └─ debug/            # M1 2D debug board (kept forever as a dev tool)
├─ server/
│  └─ src/
│     ├─ index.ts          # Colyseus server bootstrap
│     ├─ rooms/DinnerRoom.ts
│     ├─ world/            # Rapier world, house colliders, LOS & earshot
│     └─ schema/           # Colyseus schema (network view of DinnerState)
├─ shared/
│  └─ src/
│     ├─ sim/              # pure rules: beats, topics, meters, ledger, events
│     ├─ content/          # guests, dishes, topics, occasions, events, rumors (typed data)
│     ├─ rng.ts
│     ├─ tuning.ts         # every tunable number
│     └─ types.ts
├─ blender/                # Python (bpy) asset build scripts — the ONLY non-TS code (D-008)
│  ├─ build.py             # entry: reset scene → build() → validate → export
│  ├─ lib/                 # palette, prims, sockets, export helpers
│  └─ assets/
│     ├─ props/            # chair.py, table.py, plate.py, curtain.py, …
│     ├─ house/            # house_a.py (rooms, doors, seats, interactables)
│     └─ characters/       # rig.py, host.py, guest_body.py, disguises/
├─ client/public/models/   # build output: *.glb + *.layout.json (committed)
├─ tools/art.ts            # `npm run art`: finds Blender, runs build.py headless, filters exporter noise
├─ assets/audio/           # sound and music sources
└─ docs/
```

## Conventions

- `strict: true` from the first commit. No `any` without a `// why:` comment.
- **Content is data:** a guest type is a `GuestDef` object (interests, triggers[], eats[], tells[], slip, quirkPool[]). Trigger kinds form a discriminated union (`{kind: 'word', words: [...]} | {kind: 'dish', tags: [...]} | …`), so adding a kind is a compile-time-checked change.
- All tuning lives in `shared/tuning.ts`.
- Sim functions take state and return new state. They're tested with fixed seeds.
- Client rendering never decides rules. If the client needs to know something, it reads it from server state.

## Hosting (decide by M8)

- Game server: a single small VPS or container host (Fly.io, Railway, Hetzner). Colyseus rooms are cheap. TURN on the same box.
- Client: static hosting (itch.io HTML5 page, Cloudflare Pages or Netlify).
- No accounts and no database. Nothing is persisted, by design (D-003).

## Main technical risks

| Risk | Mitigation |
|---|---|
| Keyword spotting accuracy or CPU cost | Spike early (M5 is independent of M2–M4 and can run in parallel). Typed fallback is always there. Trigger words are a *spice*, not a required mechanic. |
| WebRTC connectivity | TURN by M8. Test on mobile hotspot and a corporate-ish network. |
| Physics sync jitter with 6 players and lots of props | Hold-ownership model. Sleep props aggressively. Cap live props. |
| Scripted modeling looks too boxy | Invest early in `prims.py` (bevels, tapers, soft blobs) and a strong palette. Judge from screenshots on the Blender MCP before exporting. The chunky style suits generated geometry. |
| Topic system not fun | That's why M1 is a 2D sim with no netcode. Don't build 3D until the board is fun. |
| Browser performance (Three.js + Rapier + KWS + 5 audio streams) | Budget: 60 fps on a mid laptop iGPU. KWS in a worker. Instanced props. Baked lighting. |
