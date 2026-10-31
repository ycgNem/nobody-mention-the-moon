// Shared pieces of the dinner rules: queries, traits (with quirks and shapeshifter copies), and the
// meters (Composure, Cover, Strikes, Slips). dinner.ts runs the evening; events.ts and guests.ts
// add the event deck and the guest-specific rules on top of these.

import { GUEST_TYPES, type GuestTypeDef } from '../content/guests.ts';
import { OCCASIONS } from '../content/occasions.ts';
import { QUIRKS, type QuirkDef } from '../content/quirks.ts';
import type { DishTag } from '../content/dishes.ts';
import type { TopicTag } from '../content/topics.ts';
import type { Rng } from '../rng.ts';
import { finish } from './results.ts';
import type { DinnerState, GuestState, Incident, ObjectiveState, SimEvent, SimPlayer, SimWorld } from './types.ts';

// ---------------------------------------------------------------------------------------------
// Queries

export function typeOf(g: GuestState): GuestTypeDef {
  return GUEST_TYPES[g.type];
}

/** The rules a guest plays by right now: a shapeshifter takes on whoever it's copying. */
export function traitsOf(state: DinnerState, g: GuestState): GuestTypeDef {
  if (g.copying !== null) {
    const copy = state.guests[g.copying];
    if (copy && !copy.eaten) return GUEST_TYPES[copy.type];
  }
  return typeOf(g);
}

export function quirksOf(g: GuestState): QuirkDef[] {
  return g.quirks.map((q) => QUIRKS[q]);
}

export function hasQuirk(g: GuestState, test: (q: QuirkDef) => unknown): boolean {
  return g.quirks.some((q) => !!test(QUIRKS[q]));
}

export function likesOf(state: DinnerState, g: GuestState): TopicTag[] {
  return [...traitsOf(state, g).likes, ...quirksOf(g).flatMap((q) => q.extraLikes ?? [])];
}

export function triggersOf(state: DinnerState, g: GuestState): TopicTag[] {
  return [...traitsOf(state, g).triggers, ...quirksOf(g).flatMap((q) => q.extraTriggers ?? [])];
}

export function hurtByOf(state: DinnerState, g: GuestState): DishTag[] {
  return [...traitsOf(state, g).hurtBy, ...quirksOf(g).flatMap((q) => q.hurtByDish ?? [])];
}

export function guest(state: DinnerState, id: number): GuestState {
  const g = state.guests[id];
  if (!g) throw new Error(`no guest ${id}`);
  return g;
}

export function player(state: DinnerState, id: string): SimPlayer | undefined {
  return state.players.find((p) => p.id === id);
}

export function isPresent(g: GuestState): boolean {
  return !g.eaten && g.where !== 'outside' && g.where !== 'gone';
}

/** At the table and able to take part in conversation right now. */
export function isAvailable(g: GuestState): boolean {
  return g.where === 'seated' && !g.eaten && g.slipTimer <= 0;
}

/** In the house (or on the doorstep) and composed enough to be rattled. */
export function canBeHurt(g: GuestState): boolean {
  return isPresent(g) && g.slipTimer <= 0;
}

export function guestAtSeat(state: DinnerState, seat: number): GuestState | undefined {
  return state.guests.find((g) => !g.eaten && g.where === 'seated' && g.seat === seat);
}

export function isOver(state: DinnerState): boolean {
  return state.phase === 'ended';
}

/** The table has stopped: the dinner ended or the chase is on. */
export function halted(state: DinnerState): boolean {
  return state.phase === 'ended' || state.phase === 'chase';
}

/** Dinner is under way: courses and dessert (not booking, prep, arrivals or the chase). */
export function isServing(state: DinnerState): boolean {
  return state.phase === 'course' || state.phase === 'dessert';
}

/** Seconds since the first course started (0 before). */
export function dinnerTime(state: DinnerState): number {
  return state.dinnerStart === null ? 0 : state.time - state.dinnerStart;
}

/** The current course's menu (dessert keeps the last course's). */
export function currentMenu(state: DinnerState): string[] {
  return state.menu[Math.min(state.course, state.menu.length - 1)] ?? [];
}

/** Is the room dark (lights off, or a power cut)? */
export function isDark(state: DinnerState): boolean {
  return !state.room.lightsOn || !state.room.powerOn;
}

/** Nearest seated guests clockwise and counter-clockwise. Empty seats are skipped. */
export function neighbors(state: DinnerState, g: GuestState): GuestState[] {
  const n = state.seatCount;
  const found: GuestState[] = [];
  if (g.where !== 'seated') return found;
  for (const dir of [1, -1]) {
    for (let step = 1; step < n; step++) {
      const other = guestAtSeat(state, (((g.seat + dir * step) % n) + n) % n);
      if (other && other.id !== g.id) {
        if (!found.includes(other)) found.push(other);
        break;
      }
    }
  }
  return found;
}

export function relatedTo(state: DinnerState, g: GuestState, kind: string): GuestState[] {
  const out: GuestState[] = [];
  for (const r of state.relationships) {
    if (r.kind !== kind) continue;
    const other = r.a === g.id ? state.guests[r.b] : r.b === g.id ? state.guests[r.a] : undefined;
    if (other) out.push(other);
  }
  return out;
}

export function canReceiveTopic(g: GuestState): boolean {
  if (!isAvailable(g) || g.eatingBeats > 0 || g.counting > 0) return false;
  return !(typeOf(g).needsAddressing && g.addressedBeats === 0);
}

export function topicPull(state: DinnerState, g: GuestState): number {
  const t = state.topic;
  if (!t) return 0;
  const tu = state.tuning;
  const holder = guest(state, t.holder);
  const likes = likesOf(state, g);
  let pull = t.tags.filter((tag) => likes.includes(tag)).length * tu.pullPerLikedTag;
  if (neighbors(state, holder).includes(g)) pull += tu.pullNeighbor;
  if (g.id === t.previous) pull += tu.pullPreviousHolder;
  // Rivals steer topics at each other, toward whatever rattles the rival.
  if (relatedTo(state, holder, 'rivals').includes(g) && t.tags.some((tag) => triggersOf(state, g).includes(tag))) pull += tu.rivalsPull;
  // Book Club: the book keeps pulling the conversation back.
  if (state.book.length > 0 && t.tags.some((tag) => state.book.includes(tag))) pull += tu.bookPull * 0.5;
  return pull;
}

/**
 * Who the topic goes to on the next beat: highest pull, ties broken clockwise from the holder.
 * This is what the preview arc shows, so it must be the exact rule `step` uses.
 */
export function predictNext(state: DinnerState): number | null {
  const t = state.topic;
  if (!t) return null;
  const holder = guest(state, t.holder);
  const n = state.seatCount;
  let best: GuestState | null = null;
  let bestPull = -Infinity;
  let bestDist = Infinity;
  for (const g of state.guests) {
    if (g.id === holder.id || !canReceiveTopic(g)) continue;
    const pull = topicPull(state, g);
    const dist = (g.seat - holder.seat + n) % n;
    if (pull > bestPull || (pull === bestPull && dist < bestDist)) {
      best = g;
      bestPull = pull;
      bestDist = dist;
    }
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// Meters

export function tell(
  g: GuestState,
  mood: 'bad' | 'good' | 'neutral',
  pool: readonly string[] | null,
  cause: string,
  r: Rng,
  ev: SimEvent[],
): void {
  if (!pool || pool.length === 0) return;
  ev.push({ t: 'tell', guest: g.id, mood, text: r.pick(pool), cause });
}

/** The guest of honor's nerves swing twice as hard (Birthday). */
function swing(state: DinnerState, g: GuestState): number {
  if (state.honoree !== g.id) return 1;
  return OCCASIONS[state.occasion].honoree?.doubleSwings ? state.tuning.honoreeSwing : 1;
}

export function heal(state: DinnerState, g: GuestState, amount: number): void {
  if (g.slipTimer > 0 || g.eaten) return;
  g.composure = Math.min(100, g.composure + amount * swing(state, g));
}

const PARTS = ['an ear', 'a hand', 'their nose', 'a finger', 'the other ear'];

export function hurt(
  state: DinnerState,
  g: GuestState,
  amount: number,
  cause: string,
  tells: readonly string[] | null,
  world: SimWorld,
  r: Rng,
  ev: SimEvent[],
): void {
  if (!canBeHurt(g) || amount <= 0) return;
  g.composure -= amount * swing(state, g);
  state.stats.triggers++;
  tell(g, 'bad', tells, cause, r, ev);
  if (state.visitor?.kind === 'hunter' && state.visitor.where === 'inside' && g.where === 'seated') {
    noticeHunter(state, state.tuning.hunterSuspicionPerTrigger, ev);
  }
  // Zombies: a big enough jolt and something falls off.
  if (typeOf(g).mechanic === 'looseParts' && g.where === 'seated' && amount >= 5 && g.partsOff < PARTS.length) {
    const chance = Math.max(state.tuning.partChance, ...quirksOf(g).map((q) => q.partChance ?? 0));
    if (r.next() < chance) {
      const part = PARTS[g.partsOff]!;
      g.partsOff++;
      ev.push({ t: 'partFell', guest: g.id, part });
      tell(g, 'bad', [`*${part} drops off and rolls under the table*`], 'part', r, ev);
    }
  }
  if (g.composure <= 0) startSlip(state, g, world, r, ev);
}

export function startSlip(state: DinnerState, g: GuestState, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  g.composure = 0;
  g.revealed = true;
  g.eyeing = null;
  state.stats.slips++;
  ev.push({ t: 'slip', guest: g.id, text: typeOf(g).slip });
  incident(state, 'slip', `${g.name} slipped: ${typeOf(g).slip}`, g.id, 6);
  if (state.topic?.holder === g.id) dropTopic(state, ev, `${g.name} is… indisposed.`);
  if (typeOf(g).mechanic === 'gaze') g.glassesOff = Math.max(g.glassesOff, state.tuning.glassesOffSeconds);
  if (g.copying !== null) {
    g.copying = null;
    ev.push({ t: 'copy', guest: g.id, of: -1 });
  }
  if (state.partyGame?.actor === g.id) state.partyGame.guess = 0;
  // Occasions that a slip spoils.
  failObjective(state, 'family_toasts', `${g.name} slipped at the wedding rehearsal`, ev);
  if (state.honoree === g.id && state.phase !== 'dessert') failObjective(state, 'keep_secret', `${g.name} realized`, ev);
  if (g.where === 'seated') {
    g.slipTimer = state.tuning.slipSeconds;
  } else {
    // Slipping on the doorstep or in the hall: over quickly, and the table can't see it.
    g.composure = state.tuning.slipRecoverTo;
    state.stats.slipsHidden++;
    ev.push({ t: 'slipHidden', guest: g.id, by: null });
  }
  void world;
  void r;
}

export function resolveSlip(state: DinnerState, g: GuestState, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const tu = state.tuning;
  g.slipTimer = 0;
  g.composure = tu.slipRecoverTo;
  const witnesses: (number | 'neighbor')[] = [];
  const visible = !isDark(state) || hasQuirk(g, (q) => q.glowsInDark);
  if (visible) {
    for (const w of state.guests) if (w.id !== g.id && isAvailable(w) && world.sees(w.id, g.id)) witnesses.push(w.id);
    const humanInside = state.room.neighborPresent || (state.visitor?.kind === 'pizza' && state.visitor.where === 'inside');
    if (humanInside && world.sees('neighbor', g.id)) witnesses.push('neighbor');
    if (state.visitor?.kind === 'hunter' && state.visitor.where === 'inside') noticeHunter(state, tu.hunterSuspicionPerSlip, ev);
  }
  if (halted(state)) return;
  if (witnesses.length === 0) {
    const by = world.blocker(g.id);
    state.stats.slipsHidden++;
    if (by) {
      const p = player(state, by);
      if (p) p.stats.coveredSlips++;
    }
    ev.push({ t: 'slipHidden', guest: g.id, by });
    return;
  }
  ev.push({ t: 'slipSeen', guest: g.id, witness: witnesses[0]! });
  for (const w of witnesses) {
    if (w === 'neighbor') continue;
    hurt(state, guest(state, w), tu.witnessDamage, 'witness', ['*stares*', '*drops their fork*'], world, r, ev);
    if (halted(state)) return;
  }
  strike(state, witnesses.includes('neighbor') ? `A real human saw ${g.name}` : `Everyone saw ${g.name}`, ev);
}

/** The Monster Hunter notices something. At 100 he knows: a strike, and the objective is lost. */
export function noticeHunter(state: DinnerState, amount: number, ev: SimEvent[]): void {
  const v = state.visitor;
  if (!v || v.kind !== 'hunter' || v.suspicion >= 100) return;
  v.suspicion = Math.min(100, v.suspicion + amount);
  if (v.suspicion < 100) return;
  failObjective(state, 'hunter_fooled', 'The hunter worked it out', ev);
  ev.push({ t: 'visitor', kind: 'hunter', arrived: false, text: 'The "magician" narrows his eyes, packs his silver and leaves. He KNOWS.' });
  state.visitor = null;
  strike(state, 'The Monster Hunter saw through you', ev);
}

export function dropTopic(state: DinnerState, ev: SimEvent[], text: string): void {
  const t = state.topic;
  if (!t) return;
  const holder = guest(state, t.holder);
  state.topic = null;
  const n = state.seatCount;
  // The next seated guest clockwise picks up the conversation on the next beat.
  for (let step = 1; step <= n; step++) {
    const g = guestAtSeat(state, (holder.seat + step) % n);
    if (g && g.id !== holder.id && isAvailable(g)) {
      state.nextStarter = g.id;
      break;
    }
  }
  ev.push({ t: 'topicDropped', guest: holder.id, text });
}

export function incident(state: DinnerState, kind: Incident['kind'], text: string, g: number | null, drama: number): void {
  state.incidents.push({ t: dinnerTime(state), kind, text, guest: g, drama });
}

export function strike(state: DinnerState, reason: string, ev: SimEvent[]): void {
  if (halted(state)) return;
  state.strikes++;
  ev.push({ t: 'strike', strikes: state.strikes, reason });
  incident(state, 'strike', reason, null, 5 + state.strikes);
  if (state.strikes >= state.tuning.maxStrikes) finish(state, 'strikes', ev);
}

export function changeCover(state: DinnerState, delta: number, reason: string, ev: SimEvent[]): void {
  if (halted(state) || delta === 0) return;
  state.cover = Math.max(0, Math.min(100, state.cover + delta));
  ev.push({ t: 'cover', delta, reason });
  if (state.cover <= 0) startChase(state, ev);
}

/** Cover hit zero: the guests realize together. Run for the van (GDD §7.11). */
export function startChase(state: DinnerState, ev: SimEvent[]): void {
  state.chaseTips = finish(state, 'exposed', [], { dryRun: true }).tips;
  state.phase = 'chase';
  state.phaseTime = state.tuning.chaseSeconds;
  state.question = null;
  state.topic = null;
  state.toast = null;
  state.partyGame = null;
  for (const g of state.guests) {
    if (!isPresent(g)) continue;
    g.revealed = true;
    g.slipTimer = 0;
    g.copying = null;
  }
  for (const p of state.players) p.stone = 0;
  ev.push({ t: 'chase' });
  incident(state, 'chase', 'They realized. Everyone ran for the van.', null, 10);
}

export function catchPlayer(state: DinnerState, p: SimPlayer, ev: SimEvent[]): void {
  if (p.caught || p.escaped) return;
  p.caught = true;
  p.caughtAt = state.time;
  ev.push({ t: 'caught', player: p.id });
}

// ---------------------------------------------------------------------------------------------
// The occasion's objective

export function objective(state: DinnerState, id: ObjectiveState['id']): ObjectiveState | null {
  const o = state.objective;
  return o && o.id === id && o.status === 'pending' ? o : null;
}

export function completeObjective(state: DinnerState, id: ObjectiveState['id'], text: string, ev: SimEvent[]): void {
  const o = objective(state, id);
  if (!o) return;
  o.status = 'done';
  o.progress = o.goal;
  ev.push({ t: 'objective', status: 'done', text });
  incident(state, 'objective', text, null, 4);
}

export function failObjective(state: DinnerState, id: ObjectiveState['id'], text: string, ev: SimEvent[]): void {
  const o = objective(state, id);
  if (!o) return;
  o.status = 'failed';
  ev.push({ t: 'objective', status: 'failed', text });
}
