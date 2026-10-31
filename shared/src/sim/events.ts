// The event deck (docs/GUESTS.md "Events"): 2–4 drawn per dinner from weights the occasion
// adjusts, fired at set times during the courses, plus the visitors (Gary, the pizza driver and
// the Monster Hunter). Each event has an announcement and its own tells.

import { EVENTS, EVENT_IDS, type EventId } from '../content/events.ts';
import { OCCASIONS } from '../content/occasions.ts';
import type { Rng } from '../rng.ts';
import {
  changeCover,
  completeObjective,
  dinnerTime,
  halted,
  heal,
  hurt,
  hurtByOf,
  incident,
  isAvailable,
  isServing,
  objective,
  player,
  quirksOf,
  startSlip,
  tell,
  traitsOf,
  triggersOf,
  typeOf,
} from './core.ts';
import type { DinnerState, GuestState, ScheduledEvent, SimEvent, SimWorld } from './types.ts';

// ---------------------------------------------------------------------------------------------
// Rolling the deck

/** The night's events, drawn from the seed. Late guests are added by the caller. */
export function rollSchedule(state: DinnerState, r: Rng): ScheduledEvent[] {
  const tu = state.tuning;
  const occ = OCCASIONS[state.occasion];
  const cs = tu.courseSeconds;
  const span = tu.courses * cs;
  const out: ScheduledEvent[] = [];
  const at = (kind: EventId): number => {
    // The moon rises in the second course; everything else lands anywhere in the courses.
    if (kind === 'moonrise') return Math.min(span - 30, cs + r.int(20, Math.max(21, cs - 60)));
    return r.int(25, Math.max(26, span - 40));
  };
  for (const kind of occ.forcedEvents ?? []) out.push({ kind, at: at(kind), fired: false });

  const count = r.int(tu.eventsMin, tu.eventsMax);
  for (let i = out.length; i < count; i++) {
    const options = EVENT_IDS.filter((id) => !(EVENTS[id].once && out.some((e) => e.kind === id)));
    const weights = options.map((id) => EVENTS[id].weight * (occ.eventWeights[id] ?? 1));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) break;
    let x = r.next() * total;
    let pick = options[0]!;
    for (let j = 0; j < options.length; j++) {
      x -= weights[j]!;
      if (x <= 0) {
        pick = options[j]!;
        break;
      }
    }
    out.push({ kind: pick, at: at(pick), fired: false });
  }
  // Toasts at a wedding go one per family, a while apart.
  const toasts = out.filter((e) => e.kind === 'toast');
  toasts.forEach((e, i) => (e.at = Math.max(e.at, 40 + i * Math.floor(span / Math.max(2, toasts.length + 1)))));
  return out.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------------------------
// Every tick

export function tickEvents(state: DinnerState, dt: number, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const tu = state.tuning;
  if (isServing(state)) {
    const now = dinnerTime(state);
    for (const s of state.schedule) {
      if (s.fired || now < s.at) continue;
      // One toast at a time.
      if (s.kind === 'toast' && state.toast) {
        s.at = now + 10;
        continue;
      }
      s.fired = true;
      fire(state, s.kind, world, r, ev);
      if (halted(state)) return;
    }
  }

  const room = state.room;
  if (room.neighborPresent) {
    room.neighborTimer -= dt;
    if (room.neighborTimer <= 0) {
      room.neighborPresent = false;
      ev.push({ t: 'neighbor', arrived: false, text: 'Gary leaves on his own, looking thoughtful.' });
      changeCover(state, -tu.neighborLeavesCost, 'Gary noticed things', ev);
      if (halted(state)) return;
    }
  }
  if (room.storm > 0) {
    room.storm = Math.max(0, room.storm - dt);
    if (room.storm === 0) ev.push({ t: 'eventEnd', id: 'thunderstorm', text: 'The storm rumbles off into the distance.' });
  }

  tickToast(state, dt, world, r, ev);
  if (halted(state)) return;
  tickVisitor(state, dt, ev);
}

function tickToast(state: DinnerState, dt: number, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const t = state.toast;
  if (!t) return;
  t.timer -= dt;
  if (world.speaking(t.player)) t.spoken += dt;
  if (t.spoken >= t.need) return endToast(state, !t.spoiled, world, r, ev);
  if (t.timer <= 0) endToast(state, false, world, r, ev);
}

function endToast(state: DinnerState, good: boolean, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const t = state.toast!;
  const tu = state.tuning;
  state.toast = null;
  ev.push({ t: 'toast', player: t.player, guest: t.guest, kind: good ? 'done' : 'failed' });
  if (!good) {
    changeCover(state, -tu.toastFailCost, t.spoiled ? 'That speech had a word in it it should not have had' : 'An awkward non-speech', ev);
    return;
  }
  const p = player(state, t.player);
  if (p) p.stats.toasts++;
  incident(state, 'toast', `${p?.name ?? 'A host'} gave a lovely toast.`, t.guest, 3);
  changeCover(state, tu.toastCoverBonus, 'A lovely toast!', ev);
  for (const g of state.guests) if (isAvailable(g) && (t.family < 0 || g.family === t.family)) heal(state, g, tu.toastComposureBonus);
  const o = objective(state, 'family_toasts');
  if (o && t.family >= 0) {
    o.progress++;
    if (o.progress >= o.goal) completeObjective(state, 'family_toasts', 'Both families toasted, and nobody slipped!', ev);
  }
  void world;
  void r;
}

function tickVisitor(state: DinnerState, dt: number, ev: SimEvent[]): void {
  const v = state.visitor;
  if (!v || v.kind !== 'pizza') return;
  const tu = state.tuning;
  v.timer -= dt;
  if (v.timer > 0) return;
  if (v.where === 'door') {
    v.where = 'inside';
    v.timer = tu.pizzaInsideSeconds;
    ev.push({ t: 'visitor', kind: 'pizza', arrived: true, text: 'The pizza driver lets themselves in: "Hello? Pizza for… anyone?"' });
    changeCover(state, -tu.pizzaWanderCost, 'The pizza driver wandered in', ev);
  } else {
    state.visitor = null;
    ev.push({ t: 'visitor', kind: 'pizza', arrived: false, text: 'The pizza driver gives up and leaves, very confused.' });
  }
}

/** A typed toast counts toward the speech (text-mode players). */
export function toastTyped(state: DinnerState, by: string, text: string): void {
  const t = state.toast;
  if (!t || t.player !== by) return;
  t.spoken += text.trim().split(/\s+/).filter(Boolean).length * state.tuning.toastSecondsPerWord;
}

/** A trigger word from the toasting player spoils the toast. */
export function toastSpoiled(state: DinnerState, by: string): void {
  if (state.toast?.player === by) state.toast.spoiled = true;
}

// ---------------------------------------------------------------------------------------------
// Firing

function fire(state: DinnerState, kind: EventId, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const tu = state.tuning;
  const def = EVENTS[kind];
  const announce = () => {
    ev.push({ t: 'event', id: kind, text: def.announce });
    incident(state, 'event', def.label, null, 2);
  };
  switch (kind) {
    case 'moonrise':
      state.room.moonUp = true;
      ev.push({ t: 'moonrise' });
      incident(state, 'moonrise', 'The full moon rose.', null, 3);
      return;
    case 'neighbor':
      state.room.neighborPresent = true;
      state.room.neighborTimer = tu.neighborStaySeconds;
      ev.push({ t: 'neighbor', arrived: true, text: def.announce });
      incident(state, 'neighbor', 'Gary from next door popped round.', null, 3);
      return;
    case 'toast': {
      const fam = familyForToast(state);
      const callers = state.guests.filter((g) => isAvailable(g) && (fam < 0 || g.family === fam));
      const hosts = state.players.filter((p) => !p.caught && !p.escaped && p.stone <= 0);
      if (callers.length === 0 || hosts.length === 0) return;
      const caller = r.pick(callers);
      const host = r.pick(hosts);
      state.toast = { player: host.id, guest: caller.id, timer: tu.toastSeconds, spoken: 0, need: tu.toastNeedSeconds, spoiled: false, family: fam };
      ev.push({ t: 'toast', player: host.id, guest: caller.id, kind: 'start' });
      tell(caller, 'neutral', [`*taps a glass* "Speech! Speech! ${host.nameTaken ? 'You there' : host.name}!"`], 'toast', r, ev);
      return;
    }
    case 'dog':
      state.room.dogLoose = true;
      announce();
      return;
    case 'power_cut':
      state.room.powerOn = false;
      announce();
      return;
    case 'thunderstorm':
      state.room.storm = tu.stormSeconds;
      announce();
      return;
    case 'late_guest':
      // The late guest was created at setup with `lateAt`; arrivals ring the bell for them.
      return;
    case 'pizza':
      if (state.visitor) return;
      state.visitor = { kind: 'pizza', where: 'door', timer: tu.pizzaDoorSeconds, suspicion: 0, trickIn: 0 };
      ev.push({ t: 'visitor', kind: 'pizza', arrived: true, text: def.announce });
      return;
    case 'wine_spill':
      state.room.spill = true;
      announce();
      for (const g of state.guests) {
        const lock = quirksOf(g).find((q) => q.spillLockBeats);
        if (lock && isAvailable(g)) {
          g.counting = lock.spillLockBeats ?? 0;
          tell(g, 'neutral', [lock.tell], 'counting', r, ev);
        }
      }
      return;
    case 'party_game': {
      const actors = state.guests.filter(isAvailable);
      if (actors.length === 0) return;
      state.partyGame = { actor: r.pick(actors).id, guess: 0, turns: tu.charadesTurns };
      announce();
      return;
    }
  }
}

/** Wedding toasts alternate families; anywhere else a toast is for everyone. */
function familyForToast(state: DinnerState): number {
  if (!OCCASIONS[state.occasion].families) return -1;
  const done = state.schedule.filter((s) => s.kind === 'toast' && s.fired).length - 1;
  return Math.max(0, done) % 2;
}

// ---------------------------------------------------------------------------------------------
// Every beat

export function beatEvents(state: DinnerState, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const tu = state.tuning;
  const room = state.room;

  // The dog under the table.
  if (room.dogLoose && world.dogAtTable()) {
    changeCover(state, -tu.dogTableCost, 'The dog is under the table', ev);
    for (const g of state.guests) {
      if (!isAvailable(g)) continue;
      if (quirksOf(g).some((q) => q.dogCalms)) {
        heal(state, g, tu.dogCalmBonus);
        tell(g, 'good', ['*scratches the dog behind the ears, beaming*'], 'dog', r, ev);
      } else if (triggersOf(state, g).includes('pets')) {
        hurt(state, g, tu.dogTableDamage, 'dog', ['*goes rigid as the dog sniffs their ankles*', '*the dog growls at them*'], world, r, ev);
      }
      if (halted(state)) return;
    }
  }

  // Wine on the tablecloth: whoever drinks "wine" can't stop staring.
  if (room.spill) {
    changeCover(state, -tu.spillCost, 'The tablecloth is still soaked', ev);
    for (const g of state.guests) {
      if (!isAvailable(g) || !traitsOf(state, g).eats.includes('wine')) continue;
      hurt(state, g, tu.spillDamage, 'spill', ['*stares at the red stain, very interested*', '*dabs a finger in it*'], world, r, ev);
      if (halted(state)) return;
    }
  }

  // The storm: lightning counts as a flash of sunlight; gusts blow the curtains open.
  if (room.storm > 0) {
    if (r.next() < tu.lightningChancePerBeat) {
      ev.push({ t: 'lightning' });
      for (const g of state.guests) {
        if (!isAvailable(g) || !traitsOf(state, g).words.includes('sun')) continue;
        hurt(state, g, tu.lightningDamage, 'lightning', ['*shrieks at the flash, then laughs it off*'], world, r, ev);
        if (halted(state)) return;
      }
    }
    if (!room.curtainsOpen && r.next() < tu.gustChancePerBeat) {
      room.curtainsOpen = true;
      ev.push({ t: 'room', what: 'curtains', on: true, by: '' });
    }
  }

  beatHunter(state, world, r, ev);
  if (halted(state)) return;
  beatCharades(state, world, r, ev);
}

function beatHunter(state: DinnerState, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const v = state.visitor;
  if (!v || v.kind !== 'hunter' || v.where !== 'inside') return;
  const tu = state.tuning;
  v.trickIn--;
  if (v.trickIn > 0) return;
  v.trickIn = tu.hunterTrickEveryBeats;
  const marks = state.guests.filter(isAvailable);
  if (marks.length === 0) return;
  const mark = r.pick(marks);
  const trick = r.pick([
    { tag: 'silver', text: 'pulls a silver coin from behind' },
    { tag: 'garlic', text: 'produces a string of garlic from the ear of' },
    { tag: 'blessed', text: 'flicks "magic water" at' },
    { tag: 'iron', text: 'links iron rings around the wrist of' },
  ] as const);
  ev.push({ t: 'visitor', kind: 'hunter', arrived: true, text: `The "magician" ${trick.text} ${mark.name}! "Ta-da!"` });
  if (hurtByOf(state, mark).includes(trick.tag)) {
    hurt(state, mark, tu.hunterTrickDamage, 'trick', ['*recoils from the trick, then forces a laugh*'], world, r, ev);
  } else {
    tell(mark, 'neutral', ['*claps politely*'], 'trick', r, ev);
  }
}

function beatCharades(state: DinnerState, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const pg = state.partyGame;
  if (!pg) return;
  const tu = state.tuning;
  const actor = state.guests[pg.actor];
  if (!actor || !isAvailable(actor)) {
    nextActor(state, r, ev);
    return;
  }
  pg.guess += tu.charadesGuessPerBeat;
  ev.push({ t: 'charades', guest: actor.id, guess: Math.min(100, pg.guess) });
  tell(actor, 'neutral', typeOf(actor).tells.topic, 'charades', r, ev);
  if (pg.guess < 100) return;
  // The table guessed it.
  tell(actor, 'bad', ['*the whole table shouts the answer at once*'], 'charades', r, ev);
  startSlip(state, actor, world, r, ev);
  if (halted(state)) return;
  nextActor(state, r, ev);
}

function nextActor(state: DinnerState, r: Rng, ev: SimEvent[]): void {
  const pg = state.partyGame;
  if (!pg) return;
  pg.turns--;
  const actors = state.guests.filter((g) => isAvailable(g) && g.id !== pg.actor);
  if (pg.turns <= 0 || actors.length === 0) {
    state.partyGame = null;
    ev.push({ t: 'eventEnd', id: 'party_game', text: 'Charades fizzles out. Thank goodness.' });
    return;
  }
  pg.actor = r.pick(actors).id;
  pg.guess = 0;
}

/** Small Talk aimed at the current charades actor derails their turn. */
export function interruptCharades(state: DinnerState, g: GuestState, r: Rng, ev: SimEvent[]): void {
  const pg = state.partyGame;
  if (!pg || pg.actor !== g.id) return;
  pg.guess = Math.max(0, pg.guess - state.tuning.charadesInterruptDrop);
  if (pg.guess === 0) nextActor(state, r, ev);
}

// ---------------------------------------------------------------------------------------------
// Occasions with visitors

/** Hunter Night: he arrives with the first course and leaves when dessert starts. */
export function hunterArrives(state: DinnerState, ev: SimEvent[]): void {
  if (!OCCASIONS[state.occasion].hunter || state.visitor) return;
  state.visitor = { kind: 'hunter', where: 'inside', timer: 0, suspicion: 0, trickIn: state.tuning.hunterTrickEveryBeats };
  ev.push({ t: 'visitor', kind: 'hunter', arrived: true, text: 'The entertainment has arrived: "The Great Van Helsing-ish!" He has a lot of silver.' });
}

export function hunterLeaves(state: DinnerState, ev: SimEvent[]): void {
  const v = state.visitor;
  if (!v || v.kind !== 'hunter') return;
  state.visitor = null;
  ev.push({ t: 'visitor', kind: 'hunter', arrived: false, text: 'The magician takes a bow and leaves, none the wiser.' });
  if (v.suspicion < 100) completeObjective(state, 'hunter_fooled', 'The hunter left without noticing a thing', ev);
}

// ---------------------------------------------------------------------------------------------
// Player chores

export function fixFuse(state: DinnerState, by: string, ev: SimEvent[]): boolean {
  if (state.room.powerOn) return false;
  state.room.powerOn = true;
  const p = player(state, by);
  if (p) p.stats.chores++;
  ev.push({ t: 'eventEnd', id: 'power_cut', text: 'The lights flicker back on.' });
  return true;
}

export function dogHome(state: DinnerState, by: string, ev: SimEvent[]): boolean {
  if (!state.room.dogLoose) return false;
  state.room.dogLoose = false;
  const p = player(state, by);
  if (p) p.stats.chores++;
  ev.push({ t: 'eventEnd', id: 'dog', text: 'The dog is back in the garage. Good dog.' });
  return true;
}

export function cleanSpill(state: DinnerState, by: string, ev: SimEvent[]): boolean {
  if (!state.room.spill) return false;
  state.room.spill = false;
  const p = player(state, by);
  if (p) p.stats.chores++;
  ev.push({ t: 'eventEnd', id: 'wine_spill', text: 'The tablecloth is (mostly) clean again.' });
  return true;
}

/** Dealing with the visitor: tip the pizza driver at the door, steer them out, or join the act. */
export function handleVisitor(state: DinnerState, by: string, world: SimWorld, ev: SimEvent[]): string | null {
  const v = state.visitor;
  const tu = state.tuning;
  const p = player(state, by);
  if (!v) return 'Nobody to deal with.';
  if (v.kind === 'pizza') {
    state.visitor = null;
    if (p) p.stats.chores++;
    if (v.where === 'door') {
      ev.push({ t: 'visitor', kind: 'pizza', arrived: false, text: 'You sign for a pizza nobody ordered and tip generously. "Enjoy your… party?"' });
      changeCover(state, tu.pizzaTipBonus, 'Pizza driver handled', ev);
    } else {
      ev.push({ t: 'visitor', kind: 'pizza', arrived: false, text: 'You steer the pizza driver back out of the front door.' });
    }
    return null;
  }
  if (!world.seenBy(by)) return 'Join the act at the table, where everyone can see you.';
  v.trickIn = tu.hunterTrickEveryBeats;
  v.suspicion = Math.max(0, v.suspicion - 5);
  if (p) p.stats.chores++;
  ev.push({ t: 'visitor', kind: 'hunter', arrived: true, text: `${p?.name ?? 'A host'} volunteers for the next trick! It is much less dangerous now.` });
  changeCover(state, tu.hunterVolunteerBonus, 'Stole the show', ev);
  return null;
}

