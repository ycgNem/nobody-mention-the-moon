# Nobody Mention the Moon: Game Design Doc

*Living doc. Last updated 2026-10-30.*

## 1. One-liner

A co-op, first-person, proximity-voice party game where 1–6 friends cater a dinner party for monsters who are all pretending to be human. Every guest believes the hosts are a legendary monster family. Keep everyone fed, calm, uneaten and convinced, until dessert.

## 2. Premise

You and your friends run **Hollow & Co.**, a cheap catering-and-hosting crew. Through a misunderstanding nobody has had the nerve to correct, the local monster community believes Hollow & Co. is *the Hollow Household*: ancient, terrifying, and very particular about etiquette. Monsters book you for their most delicate social events, the ones where they have to act human in front of other monsters who are *also* acting human.

Nobody at the table knows what anyone else is. Everyone is bluffing. You're the only ones with nothing underneath.

## 3. Pillars

1. **Your mouth is a controller.** Proximity voice chat isn't only for talking to your friends. The guests are listening too. Talking is both your best tool and your biggest risk.
2. **Small rescues, big messes.** Every fix creates a new constraint. Lies become house rules, serving one guest offends another, moving a chair breaks up a friendship. A good dinner is a chain of reactions.
3. **Readable chaos.** The table runs on rules players can learn: topics travel along predictable paths and every reaction has a tell. When it goes wrong, it was funny *and* you can see why.
4. **Every dinner is new, and nothing carries over.** No progression of any kind. You can join cold, sit down and play. Replay value comes from randomization and from players getting better, not from unlocks.

## 4. Audience and session shape

- **Players:** 1–6, tuned for 3–4. Solo works but is the harder way to play.
- **Session:** one dinner takes 12–18 minutes, with lobby to results in under 20.
- **Who it's for:** friend groups who play Lethal Company, R.E.P.O., Content Warning or Overcooked and want something that's more about talking than shooting.
- **Platform:** desktop browser (Chrome, Edge, Firefox). Join by room code. No accounts.

## 5. Explicit non-goals

- ❌ No XP, levels, unlocks, persistent currency, battle pass or meta-progression.
- ❌ No campaign or story mode. Each dinner is one standalone episode.
- ❌ No dialogue trees with "correct" options.
- ❌ No guest bios up front. You learn guests by watching them.
- ❌ No public matchmaking with strangers at launch. Friends join by code.
- ❌ No mobile or console at launch.

What *is* allowed: all cosmetics (aprons, hats, voice pitch) available from the start, a shareable **dinner seed**, and a results screen people want to screenshot.

---

## 6. Session flow

```
LOBBY → BOOKING → PREP → ARRIVALS → COURSE 1 → COURSE 2 → COURSE 3 → DESSERT & GOODBYES → RESULTS → LOBBY
                                     └──── at any point: Cover hits 0 → THE CHASE → RESULTS
```

| Phase | Length | What happens |
|---|---|---|
| **Lobby** | as long as you like | The catering van with the doors open. Players join by code, pick apron, hat and voice pitch, and goof around with physics props. The room host picks a size (Cozy, Dinner, Banquet) or Surprise Me. |
| **Booking** | ~30 s | The **Booking Card** fades in: occasion, guest count, the menu, and **one rumor already on the Rumor Ledger** ("The Hollow Household never eat before sundown"). The seed is shown. |
| **Prep** | ~2 min | The guests haven't arrived. Learn the house, start the starter, set places, check curtains, mirrors and the dog. You don't know who's coming, so you're preparing on a hunch. |
| **Arrivals** | ~1.5 min | The doorbell rings and guests arrive one by one, in disguise. Greet them at the door, take their coats and seat them. Some can't come in until they're invited. Where they sit matters. |
| **Courses ×3** | ~3–4 min each | The main game: topics travel round the table, food gets cooked and served, events fire, lies pile up. |
| **Dessert & Goodbyes** | ~1 min | One last stretch. Guests leave one at a time. Anything that goes wrong now still counts. |
| **Results** | ~45 s | Tips earned, the party grade, guest reviews, **awards** for each player, and an incident replay reel. Then back to the lobby. |

Party size scales the guest count: Cozy has 3 guests, Dinner 5, Banquet 7. Player count scales the hunger rate and how often topics move.

---

## 7. Core systems

### 7.1 Guests and disguises

Each guest has:
- A **monster type** (werewolf, vampire, ghost…), **hidden** from players.
- A **disguise**: a random human name, outfit and accessory from shared pools. The disguise never gives the type away directly, though bad disguises are funny (a fake moustache stuck on over fur).
- **Core tells**, which are always the same for that type, so players learn them across dinners.
- **1–2 secondary quirks**, rolled from that type's pool each dinner, so knowing the type never solves the dinner by itself.
- Three meters: **Composure**, **Hunger** and **Interest** (see 7.4).

**Deduction is part of play.** Early in the dinner players are working out who's who: *"Blue cardigan flinched at the garlic, and she hasn't touched her wine."* The **fridge whiteboard** in the kitchen holds polaroids of each guest taken on arrival. Players can stick labels and scribble guesses on them. These notes are just for the players and have no effect on the game.

### 7.2 The table: topics and beats

The dining table is a ring of seats. Conversation runs on **beats**, roughly every 12–15 seconds, faster with more players.

- A **Topic** is a token carrying 1–2 **tags**: Family, Work, Pets, Weather, Night, Food, Travel, Health, Childhood, Romance, Home, Hobbies, Religion, Sports.
- One guest **holds** the topic and shows it as an icon bubble above their head. A **fuse ring** around the bubble counts down to the next beat.
- On each beat the topic **passes** to the guest with the highest *pull*:
  - `pull = interest(tags) + seat-adjacency bonus + relationship modifier + "was just mentioned" bonus`
  - Ties go clockwise.
- When a topic lands on a guest whose **trigger tags** match, their Composure drops and they show a tell. When it lands on a guest whose **interest tags** match, Composure recovers a little.
- Guests sometimes **start a new topic** themselves (weighted by their interests and the occasion) or **ask a host a direct question** (see 7.6).
- **Topic preview:** the next likely receiver gets a faint dotted arc, so players can see trouble coming one beat ahead. This is what keeps the table readable rather than random.

This system is the original pitch's "changing social board", running in real time with several hands on it at once.

### 7.3 Ways to manipulate the table

| Tool | How you do it | What it does |
|---|---|---|
| **Small talk** | Hold RMB for the **Small Talk wheel**: 3 topic cards that refill over time. Aim at a guest and pick one. | That guest takes your topic now. Each card has a cooldown per player, so everyone needs to chip in. |
| **Change the subject** | Pick up a prop (painting, cat, snow globe, record) and **hold it up** where the table can see it. | The current topic is replaced by the prop's tag. Props wear out: a guest won't fall for the same snow globe twice. |
| **Serve** | Put a plate in front of a guest. | That guest eats for 1–2 beats and skips passing the topic. Also lowers Hunger. But **dish tags can trigger** them (garlic, silver, raw, iron pan, holy water brine…). |
| **Reseat** | Stand behind a guest and ask them to move ("Would you mind switching?" option), or pick up their chair with them in it (fast, rude, small Cover hit). | Changes who sits next to whom, which changes topic flow and relationship effects. |
| **Room control** | Curtains, lights, dimmers, record player, the dog (in the garage), mirrors (cover them with a tea towel), the front door. | Changes what the whole table can see and hear. Plenty of triggers are about the room, not the conversation. |
| **Lie** | Answer a direct question using the Lie wheel (7.6). | Fixes the problem in front of you and adds a **Rule** to the Rumor Ledger. |
| **Cover-up** | Get between a guest and a Slip: throw a tablecloth, kill the lights, start a toast, put on loud music. | Stops other guests noticing a Slip (7.5). |

### 7.4 Meters

**Per guest**
- **Composure** (0–100): drops on triggers and recovers on interests, food they like and calm beats. At 0 the guest **Slips**.
- **Hunger** (0–100): goes up over time and goes down when they're served food they'll eat. At 100 the guest starts **eyeing a neighbor**, with a visible tell (licking lips, staring). If nobody feeds them within ~2 beats, they **eat the neighbor**: a crunch off-screen, and the chair is empty. That's a **Strike**.
- **Interest**: hidden weights per tag. Drives where topics go.

**Team**
- **Cover** (0–100): how convinced the guests are that you're the Hollow Household. It drops when players break Rules in sight of guests, say a **host-exposure word** near the table ("human", "normal", "mortgage", "taxes"), dodge a direct question, or act very un-monstrous (yelling about a spider). It recovers slowly when the dinner is going well.
- **Strikes** (0/3): one is added when a guest is eaten, or when a Slip isn't covered and the table sees it. Three strikes and the guests "make their excuses". The dinner ends early with a poor grade, but no chase.

### 7.5 Slips (reveals)

When a guest's Composure hits 0 they **Slip**: the werewolf starts sprouting fur, the vampire's fangs come out, the ghost goes see-through and the cutlery floats. A Slip lasts ~8 seconds and shows as a big red pulse on the minimap.

- If **no other guest has line of sight** to the slipping guest by the end, it's hidden. The guest recovers to 30 Composure, a little embarrassed.
- If another guest **sees** it, that's a **Strike**, and the witness's Composure takes a hit too. Monsters panicking at monsters can chain into more Slips.
- Line of sight is real: it uses guest head direction and occlusion. Players can physically block it with their bodies, with lights out, or by dragging the guest into the hallway.

### 7.6 Direct questions and the Rumor Ledger

Sometimes a guest turns to **a specific player** and asks them something: *"And what do YOU do during the day?"* That player gets a prompt and ~6 seconds:

- **Deflect** (Small Talk card) costs a little Cover and hands the topic on.
- **Truth** ("I work in accounting") costs a lot of Cover.
- **Lie** comes from a contextual wheel of 3 lies. A lie gives no Cover loss and maybe a bonus, but adds a **Rule**.
- **Silence**: no answer within 6 seconds costs Cover.

**Rules** go on the **Rumor Ledger**, which shows in two places: the kitchen chalkboard (diegetic) and a slim HUD strip (Tab to expand). For example:

| Lie | Rule it creates |
|---|---|
| "Garlic is poison to us too." | Hosts can't touch garlic dishes where guests can see. |
| "We sleep through the day." | Hosts can't open curtains while guests are in the room. (Nice for the vampire, bad when the werewolf needs it dark…) |
| "Silver burns us." | Hosts can't hold silver cutlery where guests can see. Try serving soup now. |
| "We don't cast reflections." | Hosts can't be in a mirror's view while guests are looking at it. |
| "We never eat in front of guests." | Hosts can't eat. *(Only matters if a guest offers you food. They will.)* |

**Breaking a Rule where a guest can see it costs Cover.** Rules apply to the whole team, so one player's lie limits everyone, and that's half the comedy.

**Contradictions:** some lies carry contradiction tags. If the Ledger ever holds two lies that contradict each other (e.g. "We sleep all day" + "We adore brunch"), the guest who heard the second lie gets a **Suspicious** status. Their next direct question to a host is harder: only 2 lie options and a shorter timer.

Each dinner starts with **one random rumor** already on the Ledger (from the Booking Card), so even the first minute has a constraint in play.

### 7.7 Trigger words (voice)

Every guest type has 1–3 **trigger words**. There's also a shared list of **host-exposure words**.

- Each player's mic is run through **on-device keyword spotting** (the audio never leaves the machine; see TECH.md). When a trigger word is detected, the client sends `{word, time}` to the server.
- The server checks which guests were **in earshot** of that player (distance, plus muffling through walls and doors) and applies the trigger.
- The kitchen is a safe place to swear about the moon. The dining room isn't.
- **Fallback for no mic or no speech support:** typed chat counts the same way, and the Small Talk wheel still covers everything else. Nobody *needs* a mic to play. Voice just adds risk and laughs.
- **Toasts:** an event where a guest stands up and shouts *"Speech! Speech!"* at a random player. That player has to talk for 10 seconds (detected by voice activity) **without saying a single trigger word.** Doing it well restores Cover and a lot of Composure. Text-mode players type a toast instead.

Signature trigger-word gags (full list in GUESTS.md):
- Werewolf: *moon*, *dog*, *full*. "I'm so full" is a disaster.
- Vampire: *garlic*, *sun*, *stake*. And yes, *steak* sounds the same. On purpose.
- Fae: *thank you*. Thanking her puts you in her debt.

### 7.8 Kitchen and food

The kitchen is light, Overcooked-style, and physics-first:
- **Stations:** fridge, chopping board, stove (2 hobs), oven, sink, plating counter. Everything is carried by hand.
- **Recipes** are 2–3 steps (chop → cook → plate). Each course has a set **menu** of 2–3 dishes from the Booking Card, plus an **improvise** option: any cooked item on a plate counts as food, at a satisfaction penalty.
- **Dish tags** decide who will eat a dish and who it triggers: `garlic`, `raw`, `well-done`, `silver-served`, `iron-cooked`, `blessed`, `salty`, `sweet`, `meat`, `veg`, `nothing` (an empty plate, which is fine for the ghost if nobody points it out).
- **Disasters:** dishes left on the hob burn and start a small oven fire, which sets off the smoke alarm. That's loud, and loud things have their own triggers.
- The kitchen is muffled from the dining room, so it's where players can talk freely. Leaving the table empty is risky.

### 7.9 Events

Random events fire during courses, 2–4 per dinner, drawn from a deck weighted by occasion. Full list in GUESTS.md. A few:
- **Moonrise.** At a set point the full moon comes up behind the dining room curtains. Close them before it climbs. *Nobody mention the moon.*
- **Doorbell.** A pizza delivery driver, a nosy neighbor or a late guest. A real human in the house adds a second set of eyes to hide things from, and a snack.
- **Power Cut.** Dark rooms: nice for some guests, a problem for others. The ghost glows.
- **The Dog Got Out.** Catch it before it reaches the dining room.
- **Toast.** See 7.7.
- **Thunderstorm.** Curtains blow open now and then, and lightning flashes count as "sunlight" for half a second.

### 7.10 Hosts (the players)

- First person, simple movement (walk, sprint, crouch, jump), grab and throw with physics, hold up props.
- Players can be **"seated"**: a guest grabs you to sit and chat for a beat ("Oh, you must join us!"). That takes you out of the kitchen for a while. Seated players can still use Small Talk and can't run.
- Players **can't die in a normal dinner**. The danger is to the dinner, not your life, until the Chase.
- **Comedy ragdolls:** tripping on the dog, getting hit by a thrown roast, slipping on spilled soup. These cost nothing, unless a guest sees you do something very human.

### 7.11 The Chase (fail state)

If **Cover hits 0**, the guests realize together that you're human. The lights go red, the music cuts, and every guest drops their disguise.

- **45 seconds.** Get from wherever you are to **the van** in the driveway.
- Guests chase you. Grabbed players get "dragged to the table" and become spectators with a bib on.
- Any player who escapes **keeps the tips earned so far**. If nobody escapes, the dinner scores 0 tips but still gets awards.
- The Chase should be the funniest 45 seconds in the game, so that losing is something people talk about, not something that makes them quit.

---

## 8. Scoring and results

Nothing is saved between dinners. Results exist to give the group something to laugh about and screenshot.

- **Tips ($)**: base pay per course survived, plus satisfaction (guests fed, average Composure, no strikes), plus a toast bonus, minus strikes.
- **Party grade:** a 1–5 star rating from the hosts of the occasion, with a one-line review generated from what happened ("Lovely soup. Bertram was eaten. Three stars.").
- **Awards**, 3–5 per dinner, picked from what happened. Every player gets at least one if possible:
  - *Liar Liar* (most Rules added) · *Kitchen Gremlin* (most dishes plated) · *Loose Lips* (most trigger words said) · *The Diplomat* (best toast) · *Furniture Mover* (most reseats) · *Curtain Call* (most curtain toggles) · *Witness Protection* (most Slips covered) · *Snack* (got dragged first in the Chase)
- **Incident reel:** the 3 most dramatic moments (strikes, Slips, contradictions) replayed as quick camera cuts from a recording kept on the server.
- **Dinner seed:** shown so groups can challenge each other ("try seed `MOON-7F3K`, the wedding is cursed").

---

## 9. Variety and replayability (no progression)

How each dinner stays new:

| Thing that varies | How |
|---|---|
| Guest roster | 3–7 drawn from 8 types at launch. Duplicates allowed (two vampires who are exes). |
| Secondary quirks | 1–2 per guest from that type's pool |
| Disguises | Name, outfit, accessory pools; personalities by voice pitch |
| Relationships | 0–3 random links: exes, siblings, rivals, crushes, owes-money-to |
| Occasion | Changes the seating rules, starting topics, event weights and one special win condition |
| House | 3 layouts at launch, with random prop placement and dog location |
| Menu | 2–3 dishes per course from a pool, tags rolled |
| Events | 2–4 from a deck weighted by occasion |
| Starting rumor | 1 random Rule on the Ledger |

Players improve, the game doesn't. A group on their 30th dinner should spot the werewolf in one beat and still get wrecked by a wedding with two vampire families and a thunderstorm.

---

## 10. Controls (keyboard and mouse)

| Input | Action |
|---|---|
| WASD / Shift / Ctrl / Space | Move / sprint / crouch / jump |
| E | Grab or interact (doors, curtains, lights, record player) |
| LMB (holding) | Throw. Hold to charge. |
| F (holding) | Hold up a prop to the table |
| RMB | Small Talk wheel (aimed at a guest) |
| 1/2/3 during a question | Pick an answer |
| V | Push-to-talk (or open mic in settings) |
| Enter | Text chat (counts toward triggers) |
| Tab | Expand Rumor Ledger and guest notes |

Controller support is a stretch goal for M8.

---

## 11. Art and audio direction

- **Look:** chunky low-poly, warm candlelight, a slightly storybook palette. Think *Untitled Goose Game* meets an old Hammer horror set. Characters are soft, rounded and a bit wobbly (light procedural sway), with physics props everywhere.
- **Disguises read as bad on purpose:** fur sticking out of cuffs, sunglasses indoors, a sheet with eyeholes worn as a "shawl".
- **Readability:** topic bubbles are big, flat icons with a color per tag. Composure shows as a subtle aura (calm → jittery → crackling), not a health bar. Hunger shows as glances and drool.
- **Guest voices:** gibberish "dinner murmur" vocalizations with pitch per guest. Emotional state comes through in the sound, and content comes through in the bubble icons. No voice acting needed.
- **Music:** a lounge-jazz record that players can swap. The tempo tightens as Cover drops, and it cuts dead at the Chase.
- **Muffling:** the kitchen sounds muffled from the table and the other way round. That *is* the stealth system, so it has to be clear to hear.

## 12. Accessibility

- Every audio cue has a visual one (tells, Slip pulse, events).
- No-mic mode is fully supported (text triggers and the toast typed).
- Topic tags are shown as **icon and color**. Never color alone.
- Optional: slower beats, longer question timers ("Relaxed Dinner"). This is a lobby toggle, not a separate mode.
- The trigger-word list can be shown on the HUD for groups that want a gentler game.

## 13. Open design questions

Tracked in [DECISIONS.md](DECISIONS.md#open-questions).
