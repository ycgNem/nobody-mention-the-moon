// Guest-specific rules on top of the core table (docs/GUESTS.md): secondary quirks, relationships,
// the newer monsters' signature mechanics (fae debts, shapeshifter copies, gorgon gazes, mummy
// drafts, zombie parts), the guest of honor and the occasion objectives that track the table.
// Every effect has a tell, so the table stays readable.

import { dishById } from '../content/dishes.ts';
import { GUEST_TYPES, type GuestTypeId } from '../content/guests.ts';
import { OCCASIONS, type OccasionId } from '../content/occasions.ts';
import { QUIRKS } from '../content/quirks.ts';
import { RELATIONSHIPS, RELATIONSHIP_IDS, type RelationshipId } from '../content/relationships.ts';
import { PROP_TOPICS, TOPIC_TAGS, type PropTopicId } from '../content/topics.ts';
import type { Rng } from '../rng.ts';
import {
  canBeHurt,
  completeObjective,
  failObjective,
  guest,
  halted,
  hasQuirk,
  heal,
  hurt,
  isAvailable,
  isDark,
  neighbors,
  objective,
  player,
  quirksOf,
  relatedTo,
  tell,
  typeOf,
  changeCover,
  incident,
} from './core.ts';
import type { DinnerState, FavorState, GuestState, SimEvent, SimWorld } from './types.ts';

/** Gratitude words: said near a fae, they put you in their debt instead of rattling them. */
const GRATITUDE = ['thank you', 'thanks', 'cheers'];

// ---------------------------------------------------------------------------------------------
// Setup

/** Quirks, relationships, the guest of honor, families and the book, from the seed. */
export function rollGuestExtras(state: DinnerState, r: Rng): void {
  const occ = OCCASIONS[state.occasion];
  for (const g of state.guests) {
    const pool = r.shuffle(typeOf(g).quirks);
    g.quirks = pool.slice(0, r.next() < 0.4 ? 2 : 1);
  }

  if (occ.honoree) {
    const want = occ.honoree.type;
    const pick = want ? state.guests.find((g) => g.type === want) : r.pick(state.guests);
    state.honoree = pick?.id ?? null;
  }

  if (occ.book) {
    const tags = r.shuffle(TOPIC_TAGS);
    state.book = [tags[0]!, tags[1]!];
  }

  // Relationships: the occasion's, then 0–3 random ones (never two links on the same pair).
  const wanted: RelationshipId[] = [...(occ.relationships ?? [])];
  const extra = r.int(0, state.tuning.relationshipsMax);
  for (let i = wanted.length; i < extra; i++) wanted.push(weightedRelationship(r));
  const free = r.shuffle(state.guests.map((g) => g.id));
  const used = new Set<string>();
  for (const kind of wanted) {
    // Exes use fresh pairs so an Ex Reunion really is two couples.
    const a = kind === 'exes' ? free.shift() : r.pick(state.guests).id;
    const b = kind === 'exes' ? free.shift() : r.pick(state.guests.filter((g) => g.id !== a)).id;
    if (a === undefined || b === undefined || a === b) continue;
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    if (used.has(key)) continue;
    used.add(key);
    state.relationships.push({ kind, a, b });
  }
}

function weightedRelationship(r: Rng): RelationshipId {
  const total = RELATIONSHIP_IDS.reduce((n, id) => n + RELATIONSHIPS[id].weight, 0);
  let x = r.next() * total;
  for (const id of RELATIONSHIP_IDS) {
    x -= RELATIONSHIPS[id].weight;
    if (x <= 0) return id;
  }
  return 'rivals';
}

/** Wedding: two families of one type each. Guest types are rewritten before looks are rolled. */
export function familyTypes(occasion: OccasionId, count: number, r: Rng): GuestTypeId[] | null {
  if (!OCCASIONS[occasion].families) return null;
  const [a, b] = r.shuffle(Object.keys(GUEST_TYPES) as GuestTypeId[]);
  return Array.from({ length: count }, (_, i) => (i % 2 === 0 ? a! : b!));
}

/** Auto-seating picks a seat on their family's side of the table, if there is one free. */
export function preferredSeats(state: DinnerState, g: GuestState, seats: number[]): number[] {
  if (g.family < 0) return seats;
  const half = state.seatCount / 2;
  const side = seats.filter((s) => (s < half ? 0 : 1) === g.family);
  return side.length > 0 ? side : seats;
}

// ---------------------------------------------------------------------------------------------
// Every beat

export function beatGuests(state: DinnerState, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const tu = state.tuning;
  for (const g of state.guests) {
    g.counting = Math.max(0, g.counting - 1);
    if (!isAvailable(g)) continue;
    const type = typeOf(g);

    // Sore about being moved (possessive ghosts, fae mushrooms, creaky mummies).
    if (g.sore > 0) {
      g.sore--;
      const q = quirksOf(g).find((x) => x.reseatSoreBeats);
      hurt(state, g, tu.soreDamagePerBeat, 'sore', q ? [q.tell] : null, world, r, ev);
    }
    // A draft from the open window makes the wrappings flap.
    if (type.mechanic === 'draft' && state.room.curtainsOpen) {
      hurt(state, g, tu.draftDamagePerBeat, 'draft', type.tells.room, world, r, ev);
    }
    // In the dark: night owls relax.
    if (isDark(state)) {
      const owl = quirksOf(g).find((q) => q.darkRecovery);
      if (owl) heal(state, g, tu.darkDamagePerBeat * (owl.darkRecovery ?? 1));
    }
    if (halted(state)) return;
  }

  beatRelationships(state, world, r, ev);
  if (halted(state)) return;
  beatCopies(state, r, ev);
  beatFavors(state, r, ev);
  if (halted(state)) return;

  // Fallen-off parts lying where the table can see them.
  const parts = world.partsInView();
  if (parts > 0) {
    changeCover(state, -tu.partsInViewCost * parts, 'Someone is staring at the ear on the floor', ev);
    if (halted(state)) return;
  }

  beatObjectives(state, world, ev);
}

function beatRelationships(state: DinnerState, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const tu = state.tuning;
  for (const rel of state.relationships) {
    const a = state.guests[rel.a];
    const b = state.guests[rel.b];
    if (!a || !b || !isAvailable(a) || !isAvailable(b)) continue;
    const def = RELATIONSHIPS[rel.kind];
    const say = (g: GuestState, other: GuestState, mood: 'bad' | 'good' | 'neutral') =>
      tell(g, mood, def.tells.map((t) => t.replace('{b}', other.name)), `rel:${rel.kind}`, r, ev);
    switch (rel.kind) {
      case 'exes':
        if (world.sees(a.id, b.id)) {
          hurt(state, a, tu.exesDamagePerBeat, 'exes', null, world, r, ev);
          hurt(state, b, tu.exesDamagePerBeat, 'exes', null, world, r, ev);
          if (r.next() < 0.35) say(a, b, 'bad');
        }
        break;
      case 'crush':
        if (neighbors(state, a).includes(b)) {
          heal(state, a, tu.crushHealPerBeat);
          if (r.next() < 0.25) say(a, b, 'good');
        }
        break;
      case 'siblings':
        if (neighbors(state, a).includes(b) && r.next() < 0.2) say(a, b, 'neutral');
        break;
      case 'rivals':
        if (r.next() < 0.15) say(a, b, 'neutral');
        break;
      case 'owes_money':
        if (r.next() < 0.15) say(a, b, 'bad');
        break;
    }
    if (halted(state)) return;
  }
}

/** A topic lands on a guest: relationship twists on top of the usual reaction. */
export function topicRelationships(state: DinnerState, g: GuestState, tags: readonly string[], world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const tu = state.tuning;
  const t = state.topic;
  const from = t?.previous !== null && t?.previous !== undefined ? state.guests[t.previous] : undefined;
  if (tags.includes('romance') && from && relatedTo(state, g, 'exes').includes(from)) {
    hurt(state, g, tu.exesRomanceDamage, 'exes', [`*goes very quiet: romance, from ${from.name} of all people*`], world, r, ev);
  }
  if (tags.includes('work')) {
    for (const rel of state.relationships) {
      if (rel.kind === 'owes_money' && rel.a === g.id) hurt(state, g, tu.owesMoneyWorkDamage, 'debt', ['*suddenly fascinated by their napkin*'], world, r, ev);
    }
  }
  // Siblings bounce family topics between them: the topic lives longer.
  if (t && tags.includes('family') && from && relatedTo(state, g, 'siblings').includes(from)) t.life += tu.siblingsFamilyExtraLife;
}

/** Shapeshifters copy whoever has had the most (or, if shy, the least) attention. */
function beatCopies(state: DinnerState, r: Rng, ev: SimEvent[]): void {
  for (const g of state.guests) {
    if (!isAvailable(g) || typeOf(g).mechanic !== 'mirror') continue;
    const every = Math.min(state.tuning.copyEveryBeats, ...quirksOf(g).map((q) => q.copyEveryBeats ?? Infinity));
    if (state.beat % every !== 0) continue;
    const others = state.guests.filter((o) => o.id !== g.id && isAvailable(o) && typeOf(o).mechanic !== 'mirror');
    if (others.length === 0) continue;
    const least = hasQuirk(g, (q) => q.copyLeast);
    const sorted = [...others].sort((x, y) => (least ? x.attention - y.attention : y.attention - x.attention) || x.id - y.id);
    const target = sorted[0]!;
    if (g.copying === target.id) continue;
    g.copying = target.id;
    ev.push({ t: 'copy', guest: g.id, of: target.id });
    tell(g, 'neutral', [`*for a moment, there are two ${target.name}s at the table*`, '*their outfit flickers for a frame*'], 'copy', r, ev);
  }
}

function beatFavors(state: DinnerState, r: Rng, ev: SimEvent[]): void {
  for (const f of [...state.favors]) {
    f.beats--;
    if (f.beats > 0) continue;
    state.favors = state.favors.filter((x) => x !== f);
    const p = player(state, f.player);
    const g = guest(state, f.guest);
    ev.push({ t: 'favor', player: f.player, guest: f.guest, want: f.want, kind: 'failed' });
    if (!p || p.nameTaken) continue;
    p.nameTaken = true;
    tell(g, 'neutral', [`*smiles* "Your name is mine now, ${p.name}. Hello, you there."`], 'favor', r, ev);
    changeCover(state, -state.tuning.nameTakenCost, `${g.name} took ${p.name}'s name`, ev);
  }
}

function beatObjectives(state: DinnerState, world: SimWorld, ev: SimEvent[]): void {
  const book = objective(state, 'book_streak');
  if (book) {
    const on = !!state.topic && state.topic.tags.some((t) => state.book.includes(t));
    book.progress = on ? book.progress + 1 : 0;
    if (book.progress >= book.goal) completeObjective(state, 'book_streak', 'The whole table is talking about the book!', ev);
  }
  const apart = objective(state, 'exes_apart');
  if (apart && state.phase === 'course') {
    const main = mainCourse(state);
    if (state.course === main) {
      for (const rel of state.relationships) {
        if (rel.kind !== 'exes') continue;
        const a = state.guests[rel.a];
        const b = state.guests[rel.b];
        if (a && b && isAvailable(a) && isAvailable(b) && world.sees(a.id, b.id)) {
          failObjective(state, 'exes_apart', `${a.name} and ${b.name} locked eyes over the main course`, ev);
          break;
        }
      }
      apart.progress = Math.min(apart.goal, apart.progress + 1);
    } else if (state.course > main) {
      completeObjective(state, 'exes_apart', 'The exes got through the main course without a scene', ev);
    }
  }
}

export function mainCourse(state: DinnerState): number {
  return Math.max(0, Math.min(state.tuning.courses - 1, Math.floor(state.tuning.courses / 2)));
}

// ---------------------------------------------------------------------------------------------
// Hooks from the rest of the rules

/** A word reached a guest. True if a mechanic handled it (so it isn't a plain trigger). */
export function heardWord(state: DinnerState, g: GuestState, word: string, by: string, r: Rng, ev: SimEvent[]): boolean {
  if (typeOf(g).mechanic !== 'debt' || !GRATITUDE.includes(word)) return false;
  askFavor(state, g, by, r, ev);
  return true;
}

function askFavor(state: DinnerState, g: GuestState, by: string, r: Rng, ev: SimEvent[]): void {
  const p = player(state, by);
  if (!p || state.favors.some((f) => f.player === by)) return;
  const sweet = state.menu.flat().filter((id) => {
    const tags = dishById(id).tags as readonly string[];
    return tags.includes('sweet') || tags.includes('veg');
  });
  const props = Object.keys(PROP_TOPICS).filter((k) => !state.propsUsed.includes(k)) as PropTopicId[];
  const want = sweet.length > 0 && (props.length === 0 || r.next() < 0.5) ? r.pick(sweet) : `prop:${r.pick(props.length > 0 ? props : ['candelabra'])}`;
  const f: FavorState = { player: by, guest: g.id, want, beats: state.tuning.favorBeats };
  state.favors.push(f);
  ev.push({ t: 'favor', player: by, guest: g.id, want, kind: 'asked' });
  tell(g, 'neutral', [`*"Thanks? Then you owe me. Bring me ${wantLabel(want)}."*`], 'favor', r, ev);
}

export function wantLabel(want: string): string {
  if (want.startsWith('prop:')) {
    const id = want.slice(5) as PropTopicId;
    return `the ${PROP_TOPICS[id]?.label.toLowerCase().replace(/^(a|an|the) /, '') ?? id}`;
  }
  return dishById(want).label.toLowerCase();
}

function settleFavor(state: DinnerState, g: GuestState, by: string, want: string, r: Rng, ev: SimEvent[]): boolean {
  const f = state.favors.find((x) => x.guest === g.id && x.player === by && x.want === want);
  if (!f) return false;
  state.favors = state.favors.filter((x) => x !== f);
  const p = player(state, by);
  if (p) p.stats.favors++;
  heal(state, g, state.tuning.favorDoneBonus);
  ev.push({ t: 'favor', player: by, guest: g.id, want, kind: 'done' });
  tell(g, 'good', ['*claps, delighted: "A deal is a deal."*'], 'favor', r, ev);
  return true;
}

/** Small Talk aimed at a guest. */
export function smallTalked(state: DinnerState, g: GuestState, topicId: string, by: string, r: Rng, ev: SimEvent[]): void {
  g.attention++;
  if (topicId === 'compliment') {
    if (typeOf(g).mechanic === 'debt') {
      heal(state, g, state.tuning.complimentBonus);
      askFavor(state, g, by, r, ev);
    }
    const vain = quirksOf(g).find((q) => q.likeBonus && q.extraLikes?.includes('romance'));
    if (vain) heal(state, g, vain.likeBonus ?? 0);
  }
}

/** A prop held up where the table can see it (favors can ask for one). */
export function propShown(state: DinnerState, prop: PropTopicId, by: string, r: Rng, ev: SimEvent[]): void {
  for (const f of [...state.favors]) {
    if (f.player === by && f.want === `prop:${prop}`) settleFavor(state, guest(state, f.guest), by, f.want, r, ev);
  }
}

/** A dish reached a guest. Returns extra handling the serve code should know about. */
export function served(state: DinnerState, g: GuestState, dishId: string, by: string, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const tu = state.tuning;
  const dish = dishById(dishId);
  settleFavor(state, g, by, dishId, r, ev);
  const tags = dish.tags as readonly string[];
  if (typeOf(g).loves.some((t) => tags.includes(t))) {
    heal(state, g, tu.dishLoveBonus);
    tell(g, 'good', typeOf(g).tells.happy, 'dish', r, ev);
  }
  // Steam off the soup fogs a gorgon's glasses: they come off for a wipe.
  if (typeOf(g).mechanic === 'gaze' && dishId === 'leek_soup' && r.next() < tu.steamGlassesChance) {
    g.glassesOff = Math.max(g.glassesOff, tu.glassesOffSeconds * 0.5);
    tell(g, 'bad', ['*takes off their fogged-up sunglasses to wipe them…*'], 'steam', r, ev);
  }
  if (dishId === 'birthday_cake' && state.honoree === g.id) {
    if (objective(state, 'birthday_cake')) {
      if (g.composure >= 50) completeObjective(state, 'birthday_cake', `${g.name} blows out the candles. Happy birthday!`, ev);
      else tell(g, 'bad', ['*too rattled to blow out the candles*'], 'cake', r, ev);
    }
    if (state.occasion === 'surprise' && state.phase !== 'dessert') {
      hurt(state, g, 30, 'candles', ['*counts the candles… all two hundred of them*'], world, r, ev);
    }
  }
}

/** A guest was moved to another seat. */
export function reseated(state: DinnerState, g: GuestState): void {
  const q = quirksOf(g).find((x) => x.reseatSoreBeats);
  if (q) g.sore = Math.max(g.sore, q.reseatSoreBeats ?? 0);
}

/** Gorgons with their glasses off turn whoever they're looking at to stone. Every tick. */
export function tickGaze(state: DinnerState, dt: number, world: SimWorld, ev: SimEvent[]): void {
  for (const p of state.players) p.stone = Math.max(0, p.stone - dt);
  for (const g of state.guests) {
    if (g.glassesOff <= 0) continue;
    g.glassesOff = Math.max(0, g.glassesOff - dt);
    if (!canBeHurt(g) && g.slipTimer <= 0) continue;
    for (const id of world.gazeAt(g.id)) {
      const p = player(state, id);
      if (!p || p.stone > 0 || p.caught || p.escaped) continue;
      p.stone = state.tuning.stoneSeconds;
      ev.push({ t: 'stone', player: id, guest: g.id });
      incident(state, 'stone', `${p.name} was turned to stone by ${g.name}.`, g.id, 7);
    }
  }
}

/** Something was thrown across the dining room. */
export function thrown(state: DinnerState, hit: number | null, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  for (const g of state.guests) {
    if (!isAvailable(g)) continue;
    const squirrel = quirksOf(g).find((q) => q.thrownHurts);
    if (squirrel) hurt(state, g, 6, 'thrown', [squirrel.tell], world, r, ev);
  }
  if (hit === null) return;
  const g = state.guests[hit];
  if (!g || !isAvailable(g)) return;
  hurt(state, g, 8, 'hit', ['*"OW."*', '*something bounces off their head*'], world, r, ev);
  if (typeOf(g).mechanic === 'gaze') {
    g.glassesOff = Math.max(g.glassesOff, state.tuning.glassesOffSeconds);
    tell(g, 'bad', ['*the sunglasses go flying*'], 'glasses', r, ev);
  }
}

/** A host put a fallen-off part back on (stood behind the zombie and interacted). */
export function reattach(state: DinnerState, g: GuestState, by: string, r: Rng, ev: SimEvent[]): boolean {
  if (g.partsOff <= 0) return false;
  g.partsOff--;
  heal(state, g, state.tuning.reattachBonus);
  const p = player(state, by);
  if (p) p.stats.chores++;
  tell(g, 'good', ['*"Oh! Thank you, I\'d lose my head if it wasn\'t screwed on."*'], 'part', r, ev);
  return true;
}

/** Whether a quirk tell is worth showing when the guest is first seated (readability). */
export function introduceQuirks(g: GuestState, r: Rng, ev: SimEvent[]): void {
  for (const q of g.quirks) if (r.next() < 0.5) tell(g, 'neutral', [QUIRKS[q].tell], `quirk:${q}`, r, ev);
}

/** Guest names as other guests say them: a taken name is just "you there". */
export function nameOf(state: DinnerState, playerId: string): string {
  const p = player(state, playerId);
  return p?.nameTaken ? 'you there' : (p?.name ?? 'someone');
}

