# Nobody Mention the Moon: project notes for Claude

Co-op party game for 1–6 players, browser-based, 3D first person. Friends host a dinner for disguised monsters. Read [README.md](README.md) first, then the doc for whatever you're working on:

- Design questions → [docs/GDD.md](docs/GDD.md)
- Guest, event, dish or topic content → [docs/GUESTS.md](docs/GUESTS.md)
- Code structure, netcode, voice → [docs/TECH.md](docs/TECH.md)
- What to build next → [docs/MILESTONES.md](docs/MILESTONES.md). Tick checkboxes as items land.
- Why something is the way it is → [docs/DECISIONS.md](docs/DECISIONS.md). Add an entry when a real decision is made.

## Hard rules

- **TypeScript only, `"strict": true`, built with Vite.** Never add plain `.js` source files. Pin `three` and install the matching `@types/three`.
- **No progression systems.** No XP, unlocks, persistent currency, levels or account-bound rewards. Every dinner is self-contained. Cosmetics are all available from the start. If a feature needs a save file to be fun, it doesn't belong here (D-003).
- **Game rules live in `shared/` as pure, deterministic functions** (seeded RNG, no `Math.random`, no DOM, no Three.js). The server runs them. The client only predicts and renders. Rules get Vitest tests.
- **Content is data.** Guests, topics, dishes, events and occasions are typed data in `shared/content/`. Adding a guest shouldn't need engine changes beyond any new trigger kind.
- **The table must stay readable.** Any guest reaction has a visible or audible tell. Never add hidden rolls that players can't learn to read.
- **3D assets come from Blender Python scripts** in `blender/` (D-008). Never hand-model and commit a `.blend`, and never hand-edit a `.glb`. Change the script, run `npm run art -- <asset>`, and commit the script and its output together. Follow the naming prefixes in TECH.md (`col_`, `seat_`, `room_`, `door_`, `socket_`, `interact_`). `blender/` is the only place Python is allowed.
- **Speech never leaves the device.** Keyword spotting runs locally on each client, and only `{word, time}` events go to the server (D-006).

## Commands

- `npm run dev`: server on :2567 + client on **:5240** (not 5173, which other projects use; D-010)
- `npm run art [-- asset]`: rebuild models headless with Blender 5.2 (Steam install, or `BLENDER_PATH`)
- `npm run check`: typecheck + lint + tests. Run it before saying something works.
- In dev builds, `window.__moon` exposes `{ controls, local, room, client, session, stage, audio, renderOnce }` for scripted browser testing. `room` is the `GameLink` (solo: `room.game` is the `DinnerGame`, and `room.game.dinner` the live `DinnerState`). `session` has `advance(seconds)`, `state` (the `GameView`), `send(command)` and `teleport(feet, yaw)`. A hidden in-app browser pane gets no animation frames, so drive it by hand: `__moon.session.advance(seconds)` steps the game, and `__moon.renderOnce()` updates the views and HUD and draws one frame. Screenshots of a hidden pane can show a stale frame, so check state through the DOM or `session.state` as well, or take screenshots with the Playwright browser, which renders for real.
- Balance questions: run the sim headless (`createDinner` + `step`/`act` from `@moon/shared`) over many seeds rather than eyeballing one dinner. `npm run audit` plays 1,000 seeds with the rules-aware bot (`shared/src/sim/bot.ts`) and fails if any occasion or guest type is never beaten.

## Conventions

- npm workspaces: `client/`, `server/`, `shared/`.
- Tuning numbers live in `shared/tuning.ts`, never inline.
- Use the names from the GDD in code: `Cover`, `Composure`, `Hunger`, `Strike`, `Topic`, `Beat`, `RumorLedger`, `Rule`, `Slip`.
