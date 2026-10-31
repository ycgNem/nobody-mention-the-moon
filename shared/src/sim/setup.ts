// Rolling a new dinner from its seed: guests and disguises, the menu, the starting rumor and the
// event schedule. Everything random comes from the state's own RNG, so a seed replays exactly.

import { DISHES, dishById, type Course, type DishDef } from '../content/dishes.ts';
import {
  ACCESSORIES,
  BODIES,
  DISGUISE_COLORS,
  DISGUISE_NAMES,
  GUEST_TYPES,
  HAIRS,
  HAIR_COLORS,
  OUTFITS,
  SKIN_TONES,
  type GuestTypeId,
  type Look,
} from '../content/guests.ts';
import { OCCASIONS, OCCASION_IDS, type OccasionId } from '../content/occasions.ts';
import { RULES } from '../content/questions.ts';
import { TOPICS } from '../content/topics.ts';
import { hashSeed, rngOn, type Rng } from '../rng.ts';
import { SIM, TUTORIAL, type SimTuning } from '../tuning.ts';
import { rollSchedule } from './events.ts';
import { familyTypes, rollGuestExtras } from './guests.ts';
import type { DinnerState, GuestState, PlayerStats, SimPlayer } from './types.ts';

export interface DinnerOptions {
  seed: string;
  /** Seats around the table, in clockwise order. */
  seatCount: number;
  /** Spots in the dining room where arriving guests wait to be seated. */
  standCount?: number;
  players?: readonly { id: string; name: string }[];
  tuning?: Partial<SimTuning>;
  /** Accessibility: slower beats, longer question timers, less hunger (GDD §12). */
  relaxed?: boolean;
  /** Skip booking, prep and arrivals: everyone is seated and the first course has begun. */
  quickStart?: boolean;
  /** Tonight's occasion; rolled from the seed if not given. */
  occasion?: OccasionId;
  /** First Shift (M8 onboarding): two easy guests, one gentle event, everything slower. */
  tutorial?: boolean;
}

/** The occasion a seed rolls (weighted), so "try seed MOON-7F3K, the wedding is cursed" works. */
export function rollOccasion(r: Rng): OccasionId {
  const total = OCCASION_IDS.reduce((n, id) => n + OCCASIONS[id].weight, 0);
  let x = r.next() * total;
  for (const id of OCCASION_IDS) {
    x -= OCCASIONS[id].weight;
    if (x <= 0) return id;
  }
  return 'dinner_party';
}

/** The menu's course types, in order, for `courses` courses. */
export function courseKinds(courses: number): Course[] {
  const out: Course[] = [];
  for (let i = 0; i < courses; i++) out.push(i === 0 ? 'starter' : i === courses - 1 ? 'pudding' : 'main');
  return out;
}

export function emptyStats(): PlayerStats {
  return {
    lies: 0,
    plated: 0,
    served: 0,
    wordsLanded: 0,
    smallTalk: 0,
    reseats: 0,
    curtains: 0,
    coveredSlips: 0,
    rulesBroken: 0,
    greeted: 0,
    propsShown: 0,
    toasts: 0,
    favors: 0,
    chores: 0,
  };
}

export function newPlayer(state: DinnerState, id: string, name: string): SimPlayer {
  const r = rngOn(state);
  const p: SimPlayer = {
    id,
    name,
    hand: [],
    handCooldown: [],
    stats: emptyStats(),
    caught: false,
    escaped: false,
    caughtAt: null,
    stone: 0,
    nameTaken: false,
  };
  for (let i = 0; i < state.tuning.handSize; i++) {
    p.hand.push(drawCard(p, r));
    p.handCooldown.push(0);
  }
  return p;
}

/** A Small Talk card the player isn't already holding. */
export function drawCard(p: SimPlayer, r: Rng): string {
  const held = new Set(p.hand.filter((x): x is string => x !== null));
  const options = TOPIC_IDS.filter((t) => !held.has(t));
  return r.pick(options.length > 0 ? options : TOPIC_IDS);
}

const TOPIC_IDS = TOPICS.map((t) => t.id);

function rollLook(r: Rng, color: string, type: GuestTypeId): Look {
  const look: Look = {
    outfit: r.pick(OUTFITS),
    color,
    hair: r.pick(HAIRS),
    hairColor: r.pick(HAIR_COLORS),
    skin: r.pick(SKIN_TONES),
    accessory: r.next() < 0.75 ? r.pick(ACCESSORIES) : null,
    body: r.pick(BODIES),
  };
  // Some disguises always include something (gorgons never take their sunglasses off).
  const always = GUEST_TYPES[type].accessory;
  if (always) look.accessory = always;
  return look;
}

/** Can a guest of this type eat (not just tolerate) this dish? */
export function eatsDish(type: GuestTypeId, dish: DishDef): boolean {
  const t = GUEST_TYPES[type];
  if (t.hurtBy.some((x) => (dish.tags as readonly string[]).includes(x))) return false;
  return t.eats.some((x) => (dish.tags as readonly string[]).includes(x));
}

/**
 * 3 dishes per course. Every type at the table that can eat at all must find something it eats
 * on each course (or in the cellar: the "wine" is always there, and so are empty plates).
 */
function makeMenu(types: GuestTypeId[], courses: number, r: Rng, dessert?: string): string[][] {
  const always = DISHES.filter((d) => d.course === 'any');
  const menu = courseKinds(courses).map((kind) => {
    const pool = r.shuffle(DISHES.filter((d) => d.course === kind && d.id !== 'birthday_cake'));
    const picked: DishDef[] = pool.slice(0, 3);
    const fixes = new Set<DishDef>();
    for (const type of new Set(types)) {
      if (GUEST_TYPES[type].eats.length === 0) continue;
      const fed = (list: readonly DishDef[]) => list.some((d) => eatsDish(type, d));
      if (fed(picked) || fed(always)) continue;
      const fix =
        pool.find((d) => !picked.includes(d) && eatsDish(type, d)) ??
        r.shuffle(DISHES.filter((d) => d.course !== 'any' && !picked.includes(d))).find((d) => eatsDish(type, d));
      if (!fix) continue;
      // Swap out a dish nobody else at the table depends on; with none to spare, add it.
      const onlyFood = (d: DishDef) =>
        [...new Set(types)].some((t) => t !== type && eatsDish(t, d) && !always.some((a) => eatsDish(t, a)) && picked.filter((x) => eatsDish(t, x)).length === 1);
      const slot = picked.findIndex((d) => !fixes.has(d) && !onlyFood(d));
      if (slot >= 0) picked[slot] = fix;
      else picked.push(fix);
      fixes.add(fix);
    }
    return picked.map((d) => d.id);
  });
  // Birthday and surprise parties always end with the cake.
  const last = menu[menu.length - 1];
  if (dessert && last && !last.includes(dessert)) last.unshift(dessert);
  return menu;
}

export function createDinner(opts: DinnerOptions): DinnerState {
  const tuning: SimTuning = { ...SIM, ...opts.tuning };
  const players = opts.players ?? [{ id: 'solo', name: 'You' }];
  const extra = Math.max(0, players.length - 1);
  tuning.beatSeconds *= Math.max(0.6, 1 - tuning.beatScalePerPlayer * extra);
  tuning.hungerPerSec *= 1 + tuning.hungerScalePerPlayer * extra;
  if (opts.relaxed) {
    tuning.beatSeconds *= 1.4;
    tuning.questionSeconds *= 1.6;
    tuning.suspiciousQuestionSeconds *= 1.6;
    tuning.hungerPerSec *= 0.8;
  }

  if (opts.tutorial) {
    tuning.beatSeconds *= TUTORIAL.beatMultiplier;
    tuning.questionSeconds *= TUTORIAL.questionMultiplier;
    tuning.hungerPerSec *= TUTORIAL.hungerMultiplier;
    tuning.guests = TUTORIAL.guests;
    tuning.courses = TUTORIAL.courses;
    tuning.prepSeconds = TUTORIAL.prepSeconds;
    tuning.courseSeconds = TUTORIAL.courseSeconds;
    tuning.dessertSeconds = TUTORIAL.dessertSeconds;
    tuning.eventsMin = 1;
    tuning.eventsMax = 1;
    tuning.relationshipsMax = 0;
  }

  const state: DinnerState = {
    seed: opts.seed,
    rngState: hashSeed(opts.seed),
    tuning,
    seatCount: opts.seatCount,
    standCount: Math.max(1, opts.standCount ?? opts.seatCount),
    time: 0,
    phase: 'booking',
    course: 0,
    phaseTime: tuning.bookingSeconds,
    dinnerStart: null,
    beat: 0,
    beatTimer: 3,
    guests: [],
    players: [],
    topic: null,
    nextStarter: null,
    propsUsed: [],
    menu: [],
    cover: tuning.coverStart,
    strikes: 0,
    room: {
      curtainsOpen: true,
      mirrorCovered: false,
      lightsOn: true,
      musicOn: false,
      moonUp: false,
      neighborPresent: false,
      neighborTimer: 0,
      alarm: false,
      powerOn: true,
      storm: 0,
      spill: false,
      dogLoose: false,
    },
    ledger: [],
    question: null,
    questionInBeats: 0,
    recentQuestions: [],
    schedule: [],
    occasion: 'dinner_party',
    objective: null,
    book: [],
    honoree: null,
    relationships: [],
    toast: null,
    favors: [],
    visitor: null,
    partyGame: null,
    stats: {
      triggers: 0,
      wordsHeard: 0,
      slips: 0,
      slipsHidden: 0,
      rulesAdded: 0,
      rulesBroken: 0,
      contradictions: 0,
      servings: 0,
      reseats: 0,
      smallTalk: 0,
      questionsAnswered: 0,
    },
    incidents: [],
    chaseTips: 0,
    result: null,
  };

  const r = rngOn(state);
  state.occasion = opts.tutorial ? 'dinner_party' : (opts.occasion ?? rollOccasion(r));
  const occ = OCCASIONS[state.occasion];
  if (occ.objective) {
    const goal = occ.objective.id === 'book_streak' ? tuning.bookStreakGoal : occ.objective.id === 'family_toasts' ? 2 : 1;
    state.objective = { id: occ.objective.id, label: occ.objective.label, status: 'pending', progress: 0, goal, tips: occ.objective.tips };
  }
  state.schedule = opts.tutorial ? [{ kind: 'moonrise', at: TUTORIAL.moonriseAt, fired: false }] : rollSchedule(state, r);
  const late = state.schedule.find((e) => e.kind === 'late_guest');
  const count = Math.min(tuning.guests + (late ? 1 : 0), opts.seatCount);
  // At most two of any type, so every dinner mixes monsters (the wedding is two families).
  const types = Object.keys(GUEST_TYPES) as GuestTypeId[];
  const typePool = opts.tutorial
    ? (['werewolf', 'vampire'] as GuestTypeId[])
    : (familyTypes(state.occasion, count, r) ?? r.shuffle([...types, ...types]));
  // The surprise party is for a ghost who doesn't know.
  if (occ.honoree?.type && !typePool.slice(0, count).includes(occ.honoree.type)) typePool[0] = occ.honoree.type;
  const names = r.shuffle(DISGUISE_NAMES);
  const colors = r.shuffle(DISGUISE_COLORS);
  for (let i = 0; i < count; i++) {
    const type = typePool[i % typePool.length]!;
    const g: GuestState = {
      id: i,
      type,
      name: names[i % names.length]!,
      look: rollLook(r, colors[i % colors.length]!, type),
      seat: -1,
      where: 'outside',
      arriveAt: 2 + i * tuning.arrivalGap + r.int(0, 3),
      whereTime: 0,
      standSpot: -1,
      greeted: false,
      invited: false,
      composure: tuning.composureStart,
      hunger: tuning.hungerStart + r.int(0, 15),
      eaten: false,
      revealed: false,
      slipTimer: 0,
      eatingBeats: 0,
      addressedBeats: 0,
      eyeing: null,
      eyeingBeats: 0,
      suspicious: false,
      moonBeats: 0,
      quirks: [],
      attention: 0,
      copying: null,
      glassesOff: 0,
      partsOff: 0,
      sore: 0,
      counting: 0,
      family: occ.families ? i % 2 : -1,
      lateAt: -1,
    };
    state.guests.push(g);
  }
  // The late guest is whoever was added for the event; they ring during the courses.
  if (late && count > tuning.guests) {
    const g = state.guests[count - 1]!;
    g.lateAt = Math.max(tuning.lateGuestMinSeconds, late.at);
    g.arriveAt = Number.MAX_SAFE_INTEGER;
  }
  rollGuestExtras(state, r);

  for (const p of players) state.players.push(newPlayer(state, p.id, p.name));

  state.menu = makeMenu(
    state.guests.map((g) => g.type),
    tuning.courses,
    r,
    occ.dessert,
  );
  for (const course of state.menu) for (const id of course) dishById(id);

  // The Booking Card's starting rumor: one restrictive rule already on the ledger.
  state.ledger.push(r.pick(RULES.filter((rule) => rule.check !== null)).id);

  const cs = tuning.courseSeconds;
  state.questionInBeats = r.int(tuning.questionEveryBeatsMin, tuning.questionEveryBeatsMax);

  if (opts.quickStart) {
    const seats = r.shuffle([...Array(opts.seatCount).keys()]);
    state.guests.forEach((g, i) => {
      if (g.lateAt >= 0) return;
      g.where = 'seated';
      g.seat = seats[i]!;
      g.greeted = true;
      g.invited = true;
    });
    state.phase = 'course';
    state.phaseTime = cs;
    state.dinnerStart = 0;
  }
  return state;
}
