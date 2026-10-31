# Milestones

Each milestone has a **goal**, a **checklist** and a **Done when** test. Don't start the next milestone until the current Done-when passes, except where a milestone is marked *parallel-safe*.

Size guide: **S** ≈ a few sessions · **M** ≈ a week or two · **L** ≈ several weeks.

```
M0 Foundations ─▶ M1 Paper Table ─▶ M2 Solo 3D Dinner ─▶ M3 Multiplayer ─▶ M4 Proximity Voice ─▶ M6 Vertical Slice ─▶ M7 Variety ─▶ M8 Release
                                    M5 Trigger Words spike (parallel-safe from M1 on) ─────────────────┘
```

---

## M0: Foundations · S · ✅ done 2026-10-31

**Goal:** an empty project that builds, runs and syncs two players, so later milestones never fight tooling.

- [x] npm workspaces: `client/`, `server/`, `shared/`
- [x] `tsconfig.base.json` with `strict: true`. Each package extends it.
- [x] Vite client with Three.js (pinned) + `@types/three` (matching)
- [x] Colyseus server with an empty `DinnerRoom`. Join by 4-letter room code.
- [x] `shared/` builds and is imported by both sides. Seeded RNG with tests.
- [x] Rapier loaded in client and server. Same movement code (`shared/src/physics.ts`) for client prediction and server validation.
- [x] ESLint + Prettier + Vitest wired up. `npm run dev` starts client and server together.
- [x] **Blender pipeline:** `blender/build.py` + `lib/` (palette, prims, sockets, layout, validate), `npm run art` running Blender 5.2 headless through `BLENDER_PATH`
- [x] Palette texture + `palette.ts` export
- [x] `build.py` validation: naming prefixes, tri budget, applied transforms
- [x] `.layout.json` type + validator in `shared/`
- [x] Greybox dining room **built by script** (`house/greybox.py`): table, 6 `seat_*`, one door, one window, `col_*` boxes, `room_*` volumes
- [x] Client loads `greybox.glb` with GLTFLoader. Server builds Rapier colliders from `greybox.layout.json`.
- [x] `git init`, `.gitignore`
- [x] First commit
- [x] Record pinned versions in DECISIONS.md (D-009)

*Verified:* `server/src/DinnerRoom.test.ts` runs a real server with two SDK clients. They share room `MOON`, see each other, and the server stops a client that claims to walk through the table. Screenshots showed the script-built room and a second player rendered with a name tag.

**Done when:** `npm run art && npm run dev`, open two tabs, both join room `MOON`, and each sees the other's capsule moving around the script-built greybox room, colliding with the table. Changing the table size in `greybox.py` and rebuilding shows up after a page reload.

---

## M1: Table in the Room (the fun test) · M · 🧪 built 2026-10-31, waiting on a playtest

**Goal:** prove the table puzzle is fun **before** building the rest of the game around it. All rules live in `shared/sim` as deterministic, tested TypeScript. They're played **in the 3D greybox room** from M0, not on a separate 2D board (D-012). Solo: the sim runs in the browser, and moving it to the server is M3.

- [x] `DinnerState`, `step()`, beat clock, seeded setup from a dinner seed
- [x] Topic passing with `pull` scoring, plus a next-receiver preview arc
- [x] Guest meters: Composure, Hunger. Slip at 0 Composure. Eating a neighbor at 100 Hunger.
- [x] Team meters: Cover, Strikes. Win at dessert, lose at 3 strikes or Cover 0.
- [x] 3 guest types as data: **werewolf, vampire, ghost** (core triggers only)
- [x] Hidden types + disguises (name and color only)
- [x] Placeholder guests seated at the greybox `seat_*` points: name tag, topic bubble with tag icons, fuse ring, preview arc, tells as floating text
- [x] **Overhead view** toggle (`O`) for reading the whole table, with click-to-target
- [x] Actions by aiming at a guest or object: Small Talk cards (1/2/3), serve a dish (E → menu), swap seats (G), curtains, mirror cover, lights, hold up a prop (painting, candles), show the neighbor out
- [x] Direct questions → Deflect, Truth or Lie → Rumor Ledger Rules (HUD panel)
- [x] Rule-break checks and contradiction detection
- [x] 2 events: Moonrise (the moon actually rises in the window), Doorbell: Neighbor
- [x] Typed "say" box (Enter) that runs the trigger-word matcher with earshot (stands in for voice)
- [x] HUD: Cover, Strikes, course clock, event log. Results screen with tips, stars, review, stats.
- [x] Vitest coverage for topic passing, meters, ledger, contradictions, determinism
- [x] All numbers in `shared/tuning.ts`, copied into each dinner. Live tuning panel (`` ` ``).
- [x] Greybox additions: mirror + cover, light switch, closed-curtain mesh

**Done when:** a 10-minute, 4-guest dinner in the greybox room has **at least 3 "oh no" chain reactions** (one fix causes the next problem), and someone watching you play wants a turn. If it isn't fun, fix the rules here and don't move on.

*Status:* every item is built and covered by `shared/src/sim/dinner.test.ts` (31 tests, including seed replay and a 40-seed bot run), and was checked in the browser. The "Done when" needs a human playtest. A first-pass balance check: an idle player loses in about 3–5 min (usually a hungry werewolf eats someone). A bot that only feeds and answers survives a bit longer, then loses to vampires who were bothered by the uncovered mirror and by being ignored.

---

## M2: Solo 3D Dinner · L · 🧪 built 2026-10-31, waiting on a hands-on run

**Goal:** the whole house and the physical side of a dinner: you cook and carry things instead of picking from menus.

*Moved to M1 (D-012):* seated guests with bubbles, fuse ring and preview arc. Aiming at guests and objects. Question prompt and Rumor Ledger HUD. Cover/Strikes HUD and results screen. Curtains, lights and mirror interactables.

- [x] First-person controller additions: crouch, jump
- [x] Grab, carry, throw, physically hold up a prop (replaces M1's "aim and press E")
- [x] Greybox house **script** (`house/house_a.py`): dining room, kitchen, hallway with front door, garage (dog), bathroom (mirror), cellar
- [x] Room graph (rooms + doors) read from `house_a.layout.json`, used for earshot, visibility and later muffling (replaces M1's distance check)
- [x] Greybox prop scripts: chair, plate, bowl, pot, record player, dog (each with `socket_*`/`interact_*`)
- [x] Placeholder humanoid rig script with `sit_idle`, `eat`, `flinch`, `walk` clips, played through `AnimationMixer`
- [x] Small Talk wheel (RMB) replacing M1's number keys
- [x] Diegetic Rumor Ledger (kitchen chalkboard) alongside the HUD panel
- [x] Simple kitchen: fridge → chop → hob/oven → plate, with dish tags (replaces M1's serve menu with cooldowns)
- [x] Front door + invite (vampire arrivals), record player
- [x] Line of sight from guests' heads (Rapier raycasts) for Slips and Rule breaks (replaces M1's "near the guest or lights off")
- [x] Session flow: Booking → Prep → Arrivals → 3 Courses → Dessert → Results

**Done when:** you can play a full dinner solo in 3D, from Booking Card to Results, cooking and carrying every dish yourself, with guests arriving at the door.

*Status:* everything is built, and each part was checked in the browser by script (`window.__moon`): the lobby at the van, the Booking Card, fridge → station rules, greeting a guest at the door and inviting them in with "come in", courses with seated guests and their tells, the event panels, and the results screen. Nobody has yet played a whole dinner start to finish by hand, which is what the "Done when" asks for. The game host is `shared/src/game/DinnerGame.ts` (D-015). The same code runs solo in the tab and online on the server.

---

## M3: Multiplayer · L · 🧪 built 2026-10-31, waiting on a 4-network test

**Goal:** 2–6 friends in the same dinner over the internet.

- [x] Move the sim to the server inside `DinnerRoom`. Clients send commands.
- [x] Colyseus schema for the network view of `DinnerState`
- [x] Snapshot interpolation for other players, guests and props
- [x] Held-prop ownership + server validation
- [x] Lobby: the van, room code, ready-up, host picks party size, cosmetics (apron color + hat)
- [x] Join and leave in the lobby. Reconnect mid-dinner (seat held for 60 s).
- [x] Direct questions target specific players. Each player's own Small Talk cooldowns.
- [x] Player-count scaling for hunger and beat speed
- [x] Text chat, run through the trigger-word matcher on the server
- [x] Net debug overlay (ping, snapshot age, prop owners)

**Done when:** 4 people on different home networks finish 3 dinners in a row with no desync that breaks the game, and the round-trip from lobby to results to lobby works without reloading.

*Status:* `server/src/DinnerRoom.test.ts` runs real SDK clients against the server: joining by code, the room host's settings, starting a dinner, streaming events, and checking that the decoded client state equals the server's view. Two browser tabs were played together on localhost (chat, a remote host drawn in their apron, a dinner started from the server). Different home networks need people.

---

## M4: Proximity Voice · M · 🧪 built 2026-10-31, waiting on people with mics

**Goal:** talking in the game *is* the game.

- [x] WebRTC mesh with signaling through the Colyseus room
- [x] Web Audio graph per peer: low-pass (room muffling) → HRTF panner → gain
- [x] Muffling from the room graph and door states, the same graph the server uses for earshot
- [x] Push-to-talk (default) / open mic. Per-player mute and volume. Speaking indicator.
- [x] Mic permission flow with a clear no-mic fallback (text only)
- [x] Voice activity detection exposed to the sim (for Toasts and the "whispers only" rumor)

**Done when:** 4 players in a dinner can hear each other with clear direction, talking in the kitchen with the door shut is clearly muffled at the table, and nobody has to explain the muffling to a new player.

*Status:* `client/src/voice/` has a loopback test page that connects two meshes in one tab. Per-player volume and mute are in Settings → Other hosts. ICE servers come from the server's `/ice` (D-013). Real ears on real networks are still to come.

---

## M5: Trigger Words · M · *parallel-safe from M1 on* · 🧪 built 2026-10-31, waiting on a mic test

**Goal:** saying "moon" near the werewolf works, reliably and privately.

- [x] **Spike:** compare Vosk-WASM (grammar-limited) vs Web Speech API vs custom KWS on latency, accuracy, CPU, download size and browser support. Write up in DECISIONS.md. *(D-014, [spike](spikes/M5-keyword-spotting.md))*
- [x] AudioWorklet capture → Web Worker engine → `{word, confidence, t}`
- [x] Vocabulary built from content data (all guest trigger words + host-exposure words + "come in")
- [x] Debounce and confidence threshold in `tuning.ts`. Per-player calibration screen in the lobby ("say: *moon*"). *(the check is Settings → Voice → Check: say "moon", reachable from the lobby)*
- [x] Server earshot check → trigger applied → visible tell, so the speaker knows *why* the guest reacted
- [x] Vampire invite by voice ("come in")
- [x] **Toast** event using VAD + the trigger-word check
- [x] Setting: trigger words on/off, show the trigger list on the HUD

**Done when:** in a quiet room, "moon" said at normal volume near the werewolf triggers **≥ 9 of 10** times; ordinary dinner chatter causes **≤ 1 false trigger per dinner**; CPU stays within the frame budget on a mid laptop; no audio or transcript leaves the device.

*Status:* measured with synthetic speech (28–29 of 30 hits, 0 false hits in 111 s of chatter in confirmed mode, 9% of one core). Real voices in real rooms still need a person with a mic. The 41 MB model is not in the repo: install it locally as described in the spike doc, or let the Docker build fetch it.

---

## M6: Vertical Slice · L

**Goal:** a dinner good enough to show strangers. This is the version that answers "is this a game".

- [x] Art pass on **one house** in `house_a.py` + prop scripts (dining, kitchen, hall, garage, bathroom, cellar): low-poly, candlelit
- [x] Lightmap bake step in the Blender build (Cycles → UV2 → `aoMap` in Three.js): ambient occlusion only, opt-in with `BAKE = "ao"` (D-020)
- [x] `prims.py` upgraded to the final chunky style (bevels, tapers, soft blobs). Palette finalized.
- [x] Character style locked (scripted): hosts (apron and hat variants), 3 guest body presets + disguise kits on sockets, Slip animation clips
- [x] meshopt compression step with gltf-transform, run by `npm run art` after every export (D-020)
- [x] Topic bubble icon set (14 tags), composure aura VFX, hunger tells
- [x] Secondary quirks for werewolf, vampire, ghost
- [x] Occasions: Dinner Party, Birthday, Book Club
- [x] Events: Moonrise, Neighbor, Toast, Dog Got Out, Power Cut, Oven Fire
- [x] Relationships: Exes, Siblings, Rivals
- [x] **The Chase** fail state + van escape
- [x] Full Results: tips, star grade, generated one-line review, awards, incident reel (3 clips) *(the reel is the night's top moments as text, not video)*
- [x] Audio: dinner murmur gibberish per guest, record player music with tension layer, SFX *(all synthesized, D-017)*
- [x] Fridge whiteboard guest polaroids + player scribbles
- [x] Dinner seed display + "play this seed" in the lobby
- [ ] Playtest build hosted somewhere friends can reach it *(ready to deploy: Dockerfile, `fly.toml`, [HOSTING.md](HOSTING.md). Needs an account, D-013)*

**Done when:** **3 separate friend groups** who've never seen the game each play at least 3 dinners, and in at least 2 of the 3 groups someone says "one more" without being asked. Write down the funniest moment from each session. If there isn't one, the slice isn't done.

---

## M7: Variety · L

**Goal:** enough content that dinner 30 still surprises.

- [x] Guests: + **Fae, Shapeshifter, Gorgon, Mummy, Zombie** (8 total)
- [x] Secondary quirk pools for all 8 *(20 quirks, 2–4 per type)*
- [x] Visitors: Monster Hunter, Pizza Driver
- [x] Occasions: + Wedding Rehearsal, Surprise Party, Ex Reunion, Hunter Night (7 total)
- [x] Events: + Thunderstorm, Late Guest, Wine Spill, Party Game (≥ 10 total)
- [x] Relationships: + Crush, Owes Money
- [x] **2 more house scripts** (`house_b.py` city apartment, `house_c.py` country manor) reusing the prop scripts, each with its own room graph in `.layout.json` *(the lobby picks one, or the seed does, D-019; `houses.test.ts` holds all three to one contract)*
- [x] Disguise kit scripts for the 5 new guest types *(wings, melt, snakes, bandages, rot in `humanoid.py`)*
- [x] Bigger disguise pools (names, outfits, accessories). Dish pool ≥ 15. *(18 dishes)*
- [x] Party size Banquet (7 guests). Solo tuning pass. *(the audit bot wins ~90% at 1–4 hosts alike; a human solo run is still worth doing)*
- [x] **Repeatability audit:** generate 1,000 dinner seeds, check the spread of guests, occasions, houses and events, and make sure no single combo is always unwinnable (sim-only bot run) *(`npm run audit`, D-016)*

**Done when:** a group that has played 20+ dinners still runs into something new in most dinners, and the 1,000-seed audit shows no degenerate seeds.

*Status:* the audit half passes. 1,000 seeds play in about 9 s, spread evenly over the three houses, nothing crashes or stalls, and every house, occasion, guest type and event is beaten 86–94% of the time by a careful bot. The 20-dinner group is a human test.

---

## M8: Polish and Release · M

**Goal:** a public link you can send to any group of friends.

- [x] Settings: audio, mic, sensitivity, FOV, mouse sensitivity, keybinds, Relaxed Dinner toggle, trigger list on HUD
- [x] Accessibility pass (GDD §12). Subtitles for all event barks. *(every sound has a log line or toast; larger text; reduce motion and flashing)*
- [x] Controller support (stretch) *(standard-mapping gamepads: sticks, A use, B drop, X hold up, Y move guest, LB talk, RB jump, RT throw, d-pad cards and overhead)*
- [ ] Performance pass: 60 fps on a mid laptop iGPU with 6 players *(not measured on a laptop yet. An 8-guest table in house_a draws 273 calls and ~351k triangles, most of them the dining lamp's six-sided shadow pass over the whole house: limiting shadow casters to the dining room is the first thing to try)*
- [ ] TURN server. Tested on hotspot and restrictive networks. *(`/ice` mints coturn or Cloudflare credentials; the relay itself needs an account and a test, D-013)*
- [ ] Hosting: game server + static client. Basic uptime monitoring. *(one process serves both, with `/healthz` for a monitor; not deployed yet, D-013)*
- [x] Onboarding: a 90-second "First Shift" tutorial dinner (optional, skippable, never required) *(a lobby checkbox; 2 guests, 2 short courses, tips on screen. About 5 minutes, not 90 seconds: cooking takes time)*
- [ ] Trailer-worthy capture of the Chase
- [ ] Store or itch.io page, press kit (screenshots, GIFs, one-paragraph pitch) *(pitch, fact sheet and shot list drafted in [PRESS.md](PRESS.md); captures and the page need a human)*

**Done when:** a friend group with only the link can go from page load to their first dinner in under 2 minutes, with no help.

---

## Parking lot (not scheduled)

- Traitor variant: one player is secretly working for the Monster Hunter
- The Real Hollow Household rare event
- Steam release (Electron or Tauri wrapper) with Steam friends invites
- Spectator mode for streamers + chat-voted events
- Custom dinner editor (choose guests and occasion), seed sharing site
- Additional guest types: Banshee, Swamp Thing, Siren, Imp, Frankenstein's Cousin
