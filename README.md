# Nobody Mention the Moon

**A chaotic co-op dinner party for 1–6 friends. You and your friends are the only humans in the house. The guests are all monsters pretending to be human, and every one of them thinks *you* are a legendary monster in disguise.**

Cook the food, seat the guests and steer the small talk. Above all, watch what you say near the table, because the guests can hear you.

> Say "moon" near the werewolf and you'll find out why it's the title.

---

## The pitch in 30 seconds

- **Co-op, first person, physics-heavy, proximity voice chat.** One dinner takes about 15 minutes. Then you laugh about it and start another.
- **The guests are disguised.** You don't know who the vampire is until somebody serves the garlic bread.
- **Your voice is a controller.** Some words set guests off, and saying one within earshot of the right guest counts, whether or not you meant to.
- **Lies become house rules.** Tell the ghost you "don't do mirrors either", and now *nobody* on your team can go near the bathroom.
- **If you're found out, it isn't a game-over screen. It's a chase.** Run for the van.
- **No progression.** No XP, no unlocks, no grind. Everything is available from the first dinner. Each dinner is generated fresh and nothing carries over.

## Status

🧪 **M1–M8 built, waiting on people.** The whole game is in: three houses to cook in and carry things around (a family house, a city flat and a country manor), 1–6 hosts online or solo, proximity voice with room muffling, on-device trigger words, 8 monster types with quirks and relationships, 7 occasions, 10 events, visitors, the Chase, results with awards, a First Shift tutorial and settings. A rules-aware bot plays 1,000 seeds clean (`npm run audit`). Hosting is ready but not deployed.

What's left needs humans: every milestone's "Done when" is a playtest (friend groups, home networks, real mics), plus a hosting account, a TURN relay, a performance check on a mid laptop, a trailer and a store page. See [MILESTONES.md](docs/MILESTONES.md).

## Docs

| Doc | What's in it |
|---|---|
| [docs/GDD.md](docs/GDD.md) | Game design: pillars, how a session runs, every core system, how fail states and scoring work |
| [docs/GUESTS.md](docs/GUESTS.md) | Content bible: monster roster, tells, trigger words, occasions, events, dishes, topics |
| [docs/TECH.md](docs/TECH.md) | Stack, architecture, netcode, voice and speech, folder layout, conventions |
| [docs/MILESTONES.md](docs/MILESTONES.md) | M0–M8 with checklists and "done when" criteria |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log and open questions |
| [docs/HOSTING.md](docs/HOSTING.md) | Deploying: Docker, Fly.io, TURN, the speech model, monitoring |
| [docs/PRESS.md](docs/PRESS.md) | Press kit draft: pitch, fact sheet, shot list |
| [docs/ORIGINAL_PITCH.md](docs/ORIGINAL_PITCH.md) | The first single-player pitch, kept for reference |

## Stack

TypeScript (strict) · Vite · Three.js · **3D assets built by Blender Python scripts → glTF** · Rapier physics · Colyseus (authoritative Node server) · WebRTC proximity voice · on-device keyword spotting. Details are in [TECH.md](docs/TECH.md).

## Running it

Needs Node 22.12+. Blender 5.2 is only needed to rebuild models, because the built `.glb` files are committed.

```bash
npm install
npm run dev
```

Then open http://localhost:5240/ and press **Play solo** for a dinner (no server needed), or **Join dinner** to walk around with friends in the same room code.

**Playing a dinner:** gather round the van, ready up (**R**), and the Booking Card tells you the occasion, the menu and what the guests believe about you. Tick **First Shift** in the lobby for a short, gentle first dinner with tips.

- **Cook:** open the fridge (**E**), take a dish, and follow its steps: chopping board → hob or oven → plate it at the pass. Carry plates to guests and **E** to serve.
- **Host:** answer the front door and invite guests in (**E**, or say "come in"), and show them a seat (**G**). Right-click a guest (or **1 2 3**) to play a Small Talk card. Answer their questions with **1 2 3**: lies become house rules on the Rumor Ledger (**Tab**).
- **Hands:** pick things up with **E**, drop with **Q**, hold click to throw, **F** to hold something up for the table. **Space** jumps, **C** crouches.
- **Talk:** hold **V** for proximity voice, or **Enter** to say something out loud by text. Guests in earshot hear both, so don't say "moon" near the werewolf.
- **O** toggles an overhead view, **F3** the network overlay, **Esc** settings (volumes, voice, trigger words, accessibility, key bindings). Gamepads work too.

| Command | What it does |
|---|---|
| `npm run dev` | Game server (ws://localhost:2567) + Vite client (http://localhost:5240) |
| `npm run art` | Rebuild every model from `blender/assets/**.py` (`npm run art -- greybox` for one) |
| `npm run check` | Typecheck + lint + tests |
| `npm run audit` | Play 1,000 dinner seeds with a rules-aware bot and report the spread (`npm run audit -- 200` for fewer) |
| `npm test` | Vitest: rules and content, the game host, layout validation, physics, voice, speech matching, and real-client server tests |

Handy URL params: `?solo=1&seed=MOON-TEST` (replay a dinner), `?room=CODE&name=Ada&autojoin=1`.

## Hosting

In production one Node process serves the built client, the game WebSocket, `/healthz` and `/ice` (voice TURN credentials) on one port. It ships as a Docker image to a single Fly.io machine. Not deployed yet.

```bash
npm run build            # typecheck + build the client into client/dist
PORT=8090 npm start      # the production server: http://localhost:8090
fly deploy --ha=false    # after `fly launch` once; always one machine
```

Setup, TURN, the speech model, monitoring and every environment variable: [docs/HOSTING.md](docs/HOSTING.md).
