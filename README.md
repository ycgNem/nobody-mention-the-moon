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

🛠️ **M0 (Foundations) done.** Two players can walk around a script-built greybox dining room together. Next up: **M1, Paper Table**, the 2D prototype of the dinner table (see [MILESTONES.md](docs/MILESTONES.md)).

## Docs

| Doc | What's in it |
|---|---|
| [docs/GDD.md](docs/GDD.md) | Game design: pillars, how a session runs, every core system, how fail states and scoring work |
| [docs/GUESTS.md](docs/GUESTS.md) | Content bible: monster roster, tells, trigger words, occasions, events, dishes, topics |
| [docs/TECH.md](docs/TECH.md) | Stack, architecture, netcode, voice and speech, folder layout, conventions |
| [docs/MILESTONES.md](docs/MILESTONES.md) | M0–M8 with checklists and "done when" criteria |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log and open questions |
| [docs/ORIGINAL_PITCH.md](docs/ORIGINAL_PITCH.md) | The first single-player pitch, kept for reference |

## Stack (planned)

TypeScript (strict) · Vite · Three.js · **3D assets built by Blender Python scripts → glTF** · Rapier physics · Colyseus (authoritative Node server) · WebRTC proximity voice · on-device keyword spotting. Details are in [TECH.md](docs/TECH.md).

## Running it

Needs Node 22.12+. Blender 5.2 is only needed to rebuild models, because the built `.glb` files are committed.

```bash
npm install
npm run dev
```

Then open http://localhost:5240/?room=MOON in two browser tabs. Click to look around, WASD to move, Shift to sprint.

| Command | What it does |
|---|---|
| `npm run dev` | Game server (ws://localhost:2567) + Vite client (http://localhost:5240) |
| `npm run art` | Rebuild every model from `blender/assets/**.py` (`npm run art -- greybox` for one) |
| `npm run check` | Typecheck + lint + tests |
| `npm test` | Vitest: shared rules, layout validation, physics, and a two-client server test |

Handy URL params: `?room=CODE&name=Ada&autojoin=1`.
