# Content Bible: Guests, Occasions, Events, Dishes, Topics

Everything here becomes typed data in `shared/content/`. Numbers are first guesses. Tune them in M1.

**Tier key:** 🟢 MVP (M1–M6) · 🟡 Launch (M7) · ⚪ Parking lot

---

## Guest types

Each type has **core tells** (always the same, so players learn them over many dinners) and a **secondary quirk pool** (1–2 rolled per dinner).
Trigger kinds: `topic` (tag lands on them), `dish` (dish tag served), `room` (state of the room), `word` (heard via voice or chat), `sight` (something in their line of sight), `seat` (who they sit next to).

### 🟢 Werewolf
- **Likes (interest tags):** Food, Sports, Family, Pets (complicated)
- **Core triggers:**
  - `word`: *moon*, *dog*, *full*
  - `room`: curtains open while the moon is up (big Composure hit, with a growing hit each beat)
  - `topic`: Pets (small hit, and a strong tell)
- **Eats:** `raw`, `meat`. Disappointed by `well-done` (no Hunger drop). Won't touch `veg`.
- **Tells:** scratches behind the ear, sniffs the air, growls under the murmur, eats with their hands.
- **Slip:** fur bursts out of cuffs and collar, howls (loud: triggers nearby guests' `sound` quirks).
- **Secondary quirk pool:** *Silver-shy* (`dish: silver-served` trigger) · *Squirrel!* (chases anything thrown across the room) · *Big Appetite* (Hunger +50% rate) · *Dog Person* (when the dog gets out it calms them instead)

### 🟢 Vampire
- **Likes:** Night, Travel, Romance, History
- **Core triggers:**
  - **Invitation:** can't cross the front door until a player **says "come in"** (voice), or uses the Invite interaction. Also can't *take a topic* unless a player or guest addresses them directly (Small Talk aimed at them counts). They sit in silence otherwise, and silence slowly lowers Composure.
  - `word`: *garlic*, *sun*/*sunny*, *stake*/*steak*
  - `dish`: `garlic`, `blessed`
  - `sight`: sees a mirror with no reflection of themselves while another guest is looking at it
  - `room`: lightning or sunlight flash
- **Eats:** nothing on the menu. Pretends to. Hunger only drops from the "red wine" (it isn't). Players can figure out there's a bottle in the cellar.
- **Tells:** doesn't touch food, pushes it around the plate, avoids mirrors, freezes at the threshold.
- **Slip:** fangs out and a cape-flare, and a bat bursts out of their sleeve and flaps around the room.
- **Secondary quirk pool:** *Counting Compulsion* (spilled salt or rice locks them in place counting for 2 beats) · *Old Soul* (Childhood topics also trigger: "I was born in 1612... *ninety*... 1990!") · *Night Owl* (Composure recovers faster with the lights low)

### 🟢 Ghost
- **Likes:** Home, Family, Hobbies, Romance
- **Core triggers:**
  - `topic`: Childhood (objects within 2 m start to **float**, visible to everyone, and that's a Slip risk even before Composure hits 0)
  - `word`: *dead*, *funeral*, *ghost*, *died*
  - `sight`: someone walks through the space where her chair is (she isn't solid)
- **Eats:** can't. Serving her food *reminds her*: a small Composure hit and the food drops straight through her. An empty plate (`nothing`) is perfect, as long as nobody comments on it.
- **Tells:** cold spot (frost on her glass), the candles near her lean, she sometimes says she's "not hungry, never am!"
- **Slip:** goes see-through and wails, and the whole room's props float for the duration.
- **Secondary quirk pool:** *Wrong Decade* (starts Topics about events from the 1800s) · *Possessive* (if a player sits in "her" chair, Composure drops every beat) · *Glowy* (very visible during Power Cut)

### 🟡 Fae
- **Likes:** Romance, Nature (Weather), Hobbies, Music
- **Core triggers:**
  - `word`: *thank you*, *thanks*. Gratitude puts the speaker **in her debt**: she'll ask that player for a **Favor** next beat (fetch a specific prop, bring a specific dish, give up your hat). If the Favor isn't done in 3 beats, that player's **name is taken**: their nametag goes blank and other guests now address them as "you there", and their direct questions lose the Lie option.
  - **Compliments are contracts:** Small Talk "Compliment" cards aimed at her make her offer a trade. Accepting gives a big Composure boost to her *and* a Favor.
  - `dish`: `iron-cooked`. `room`: iron cutlery set at her place.
- **Eats:** `sweet`, `veg`. Loves honey.
- **Tells:** never says thank you herself, counts the cutlery, lots of glitter on her chair.
- **Slip:** glamour flickers off: wings, too many teeth, a short burst of birdsong.
- **Secondary quirk pool:** *True Name* (asks every player's name. Players' real display names are fine, and the comedy is in the panic) · *Ring of Mushrooms* (mushrooms grow on her chair. If they're cleared away, Composure drops)

### 🟡 Shapeshifter
- **Likes:** whatever the guest with the most attention likes.
- **Core mechanic: Mirror.** Every 3 beats it **copies** whichever guest (or player!) has received the most topics or attention. It takes on their disguise and triggers. Two "Uncle Bertrams" at the table means double triggers and confused guests.
  - If it copies a **player**, a fake host now walks around the dining room, and any Rule-breaking *it* does counts against your Cover.
- **Core triggers:** `word`: *who are you*, *be yourself*, *the real you*. `topic`: Family (it doesn't have one).
- **Tells:** a slight lag behind whoever it copied, wrong-handed at the table, the outfit flickers for a frame.
- **Slip:** melts into a puddle of everyone it has copied.
- **Secondary quirk pool:** *Starstruck* (always copies a player if one is seated) · *Shy* (copies the guest with the *least* attention instead)

### 🟡 Gorgon
- **Likes:** Gardens, Art, Travel, Romance
- **Core mechanic:** wears sunglasses. If they come off (Slip, a thrown object hitting her, steam from the soup), whoever she's looking at **turns to stone for 15 s**. Players too. A stone player is a statue until it wears off.
- **Core triggers:** `word`: *look at me*, *stone*, *snake*. `sight`: her own reflection in a mirror. `topic`: Hair/Beauty compliments (a Romance sub-tag)
- **Eats:** `meat`, mice (there's a mouse trap in the cellar…).
- **Tells:** sunglasses indoors at night, her hat hisses, she refuses eye contact.
- **Slip:** the hat bursts open with snakes and the glasses slide down.

### 🟡 Mummy
- **Likes:** History, Travel, Religion, Home
- **Core triggers:** `word`: *wrap*, *unwind*, *Egypt*, *dust*. `room`: an open window (a draft makes the bandages flap) or the vacuum cleaner running. `dish`: `salty` (actually likes it: big Composure recovery, but an odd tell).
- **Eats:** `salty`, `dry`.
- **Tells:** sand on the seat, creaks when sitting, very stiff small talk.
- **Slip:** starts unravelling, and the bandages catch on chairs and drag them around.

### 🟡 Zombie (high-functioning)
- **Likes:** Work, Sports, Food, Health (ironically)
- **Core triggers:** `word`: *brain*, *brainstorm*, *head*. `topic`: Health
- **Eats:** `raw` meat in large amounts. Hunger rises fastest of all guests.
- **Core mechanic: Loose Parts.** On a Composure hit, a body part may **fall off** (hand, ear, nose) as a physics prop. If another guest sees it on the floor, that's suspicion. Players have to pick it up and **discreetly reattach** it (stand behind the zombie and interact).
- **Tells:** greyish complexion explained away as "a cold", eyes one bit too wide, says "braaaav… bravo!"
- **Slip:** loud moaning and a full shamble, and they reach toward the nearest head.

### ⚪ Banshee · ⚪ Swamp Thing · ⚪ Frankenstein's Cousin · ⚪ Siren · ⚪ Imp

---

## Special visitors

Visitors aren't guests at the table. They're brought in by events or occasions.

- 🟢 **Real Human Neighbor (Gary):** doorbell event. A *genuine* human who wanders in and wants to stay for "just one drink". If any guest Slips in his line of sight, that's a Strike. Every monster's Hunger goes up while he's in the room. Getting him out the door politely gives a big Cover boost.
- 🟡 **Monster Hunter:** Hunter Night occasion. Arrives thinking he's the hired *entertainment* (a magician act). Carries silver, garlic and holy water as "props". He'll do a "trick" every 3 beats that triggers someone, unless a player takes over the act (Small Talk "Volunteer!").
- 🟡 **Pizza Driver:** doorbell. Wants a signature and a tip. Leaving them on the doorstep too long sends them in to look for you.
- ⚪ **The Real Hollow Household:** a very rare event where the actual legendary monsters turn up for dessert. ⚪ Parking lot until the core game is fun.

---

## Relationships (rolled 0–3 per dinner)

| Link | Effect |
|---|---|
| **Exes** | Each beat they're in each other's line of sight, both lose Composure. Romance topics between them are devastating. |
| **Siblings** | Seated together, Family topics bounce between them for extra beats (a topic loop). |
| **Rivals** | Will pass topics *to* each other on purpose to cause trouble (pull bonus toward the rival's triggers). |
| **Crush** | One guest's Composure goes up near the other. If the crush is the shapeshifter's current copy… chaos. |
| **Owes Money** | The debtor avoids Work topics, and the lender brings them up constantly. |

Relationships are revealed by tells (glares, laughs, nudges), not by UI.

---

## Occasions

Each occasion changes the starting rumor pool, event weights and seating, and adds one **special objective** worth bonus tips.

| Occasion | Tier | Twist | Special objective |
|---|---|---|---|
| **Dinner Party** | 🟢 | None. The baseline. | None |
| **Birthday** | 🟢 | Cake with candles (fire, and singing is loud). Birthday guest has double Composure swings. | Serve the cake and get through "Happy Birthday" (a sing-along event) with no triggers |
| **Book Club** | 🟢 | Topics come from "the book" (a random tag pair the whole night) | Keep the book topic going for 6 beats in a row |
| **Wedding Rehearsal** | 🟡 | Two families on two sides of the table. Each family is all one monster type, and neither knows what the other is. | A toast from each family without a Slip |
| **Surprise Party** | 🟡 | The guest of honor is the ghost, who has been dead 200 years and doesn't know. Hide the "200" candles. | Keep the ghost from realizing until dessert |
| **Ex Reunion** | 🟡 | Guaranteed 2 pairs of exes | Seat both pairs out of each other's line of sight for the whole main course |
| **Hunter Night** | 🟡 | The Monster Hunter is the "entertainment" | Get the hunter to leave without having noticed anything |
| **Wake** | ⚪ | For someone who isn't dead. They're at the table. | — |

---

## Events (deck)

| Event | Tier | What happens |
|---|---|---|
| **Moonrise** | 🟢 | The moon climbs behind the dining room curtains over 2 beats. Curtains must be closed. *Nobody mention the moon.* |
| **Doorbell: Neighbor** | 🟢 | Gary arrives (see Special visitors) |
| **Toast** | 🟢 | A guest calls "Speech!" at a random player (GDD 7.7) |
| **The Dog Got Out** | 🟢 | The dog runs for the dining room. Catch it and carry it back to the garage. |
| **Power Cut** | 🟢 | The house goes dark for ~45 s. Fuse box in the cellar. |
| **Oven Fire** | 🟢 | Fires on its own if a hob is left cooking too long. Smoke alarm (loud). |
| **Thunderstorm** | 🟡 | Curtains blow open now and then. Lightning counts as a sunlight flash. |
| **Late Guest** | 🟡 | One more guest arrives mid-course and needs a chair (find one). |
| **Doorbell: Pizza** | 🟡 | See Special visitors |
| **Wine Spill** | 🟡 | Red wine on the tablecloth. The vampire is *very* interested. |
| **Party Game** | 🟡 | A guest suggests charades. Every guest acts out their own monster. Keep the others from guessing. |
| **Fire Drill** | ⚪ | — |
| **Séance** | ⚪ | — |

---

## Dishes (starter pool)

| Dish | Tags | Steps | Notes |
|---|---|---|---|
| Garlic Bread | `garlic`, `veg` | chop → oven | Everyone loves it, except one guest who *really* doesn't |
| Steak Tartare | `raw`, `meat` | chop → plate | Werewolf heaven. Gorgon is happy too. |
| Well-done Steak | `meat`, `well-done` | hob → plate | Safe and boring |
| Roast Chicken | `meat`, `salty` | oven → carve | Carving uses the *silver* carving knife unless you find the steel one |
| Leek Soup | `veg`, `salty` | chop → hob → bowl | Steam (gorgon's glasses) |
| Honey Cake | `sweet` | mix → oven | Fae favorite |
| Salad | `veg` | chop → plate | Fast, nobody's excited about it |
| Holy Water Brined Olives | `blessed`, `salty` | jar → plate | Why does the pantry have these? |
| "Nothing" (an empty plate) | `nothing` | plate | Perfect for the ghost. Suspicious for everyone else. |

---

## Topics and tags

Core tags (14): **Family, Work, Pets, Weather, Night, Food, Travel, Health, Childhood, Romance, Home, Hobbies, Religion, Sports**
Sub-tags (only used for quirks): History (Travel), Music (Hobbies), Art (Hobbies), Beauty (Romance), Gardens (Home)

Example Small Talk cards: *"How do you two know each other?"* (Romance + Family: the grenade) · *"Been anywhere nice lately?"* (Travel) · *"Lovely weather tonight!"* (Weather + Night) · *"What do you do for work?"* (Work) · *"Any pets?"* (Pets) · *"Compliment their outfit"* (Romance/Beauty, special for the fae) · *"Tell us about where you grew up"* (Childhood + Home)

---

## Host-exposure words (all guests)

*human, normal, mortgage, taxes, gym, salad* (it's a joke, tune it), *sunscreen, dentist, my mum*

Said within earshot of any guest: −Cover. The list is visible in settings for gentle groups.

---

## Starting rumors (Booking Card pool)

- "The Hollow Household never eat before sundown." → Hosts can't eat during Course 1.
- "They say the Hollows can't abide music." → Hosts can't touch the record player where guests can see.
- "A Hollow never opens a door for themselves." → Hosts must not open the front door with guests in the hallway. (Someone has to *kick* it?)
- "The Hollows don't sit." → Hosts can't sit down, and "seated" events become direct questions instead.
- "The Hollows only speak in whispers at table." → Shouting (voice level) near the table costs Cover.
