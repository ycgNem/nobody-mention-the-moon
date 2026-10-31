// The dinner rules (docs/GDD.md §6–8). Deterministic: all randomness comes from state.rngState,
// so the same seed and the same actions at the same times replay the same dinner.
// Functions update the DinnerState in place and return events for the presentation layer.
// core.ts holds the shared queries and meters; guests.ts and events.ts add guest-specific rules
// and the event deck.

import { dishById } from '../content/dishes.ts';
import { EXPOSURE_WORDS, GUEST_TYPES, INVITE_PHRASES } from '../content/guests.ts';
import { QUESTIONS, ruleById, type RuleCheck } from '../content/questions.ts';
import { PROP_TOPICS, TOPICS, topicById, type TopicTag } from '../content/topics.ts';
import { rngOn, type Rng } from '../rng.ts';
import {
  canBeHurt,
  catchPlayer,
  changeCover,
  completeObjective,
  dinnerTime,
  dropTopic,
  failObjective,
  guest,
  guestAtSeat,
  halted,
  heal,
  hurt,
  hurtByOf,
  incident,
  isAvailable,
  isDark,
  isOver,
  isServing,
  likesOf,
  neighbors,
  player,
  predictNext,
  quirksOf,
  resolveSlip,
  strike,
  tell,
  traitsOf,
  triggersOf,
  typeOf,
} from './core.ts';
import {
  beatEvents,
  cleanSpill,
  dogHome,
  fixFuse,
  handleVisitor,
  hunterArrives,
  hunterLeaves,
  interruptCharades,
  tickEvents,
  toastSpoiled,
  toastTyped,
} from './events.ts';
import {
  beatGuests,
  heardWord,
  introduceQuirks,
  preferredSeats,
  propShown,
  reattach,
  reseated,
  served,
  smallTalked,
  thrown,
  tickGaze,
  topicRelationships,
} from './guests.ts';
import { finish } from './results.ts';
import { drawCard, newPlayer } from './setup.ts';
import type { Action, AnswerOption, DinnerState, GuestState, SimEvent, SimPlayer, SimWorld, TopicState } from './types.ts';

export { createDinner, courseKinds, eatsDish, type DinnerOptions } from './setup.ts';
export {
  currentMenu,
  dinnerTime,
  guest,
  guestAtSeat,
  isAvailable,
  isDark,
  isOver,
  isPresent,
  isServing,
  neighbors,
  player,
  predictNext,
  topicPull,
  traitsOf,
  typeOf,
} from './core.ts';
export { wantLabel, nameOf } from './guests.ts';

// ---------------------------------------------------------------------------------------------
// Players

/** Adds a host who joined (or rejoined) the dinner. Returns the existing one if already there. */
export function addPlayer(state: DinnerState, id: string, name: string): SimPlayer {
  const existing = player(state, id);
  if (existing) return existing;
  const p = newPlayer(state, id, name);
  state.players.push(p);
  return p;
}

// ---------------------------------------------------------------------------------------------
// Time

export function step(state: DinnerState, dt: number, world: SimWorld): SimEvent[] {
  const ev: SimEvent[] = [];
  if (isOver(state) || dt <= 0) return ev;
  const tu = state.tuning;
  const r = rngOn(state);

  state.time += dt;
  state.phaseTime -= dt;

  for (const p of state.players) {
    for (let i = 0; i < p.hand.length; i++) {
      if (p.hand[i] !== null) continue;
      p.handCooldown[i] = Math.max(0, (p.handCooldown[i] ?? 0) - dt);
      if (p.handCooldown[i] === 0) p.hand[i] = drawCard(p, r);
    }
  }

  switch (state.phase) {
    case 'booking':
      if (state.phaseTime <= 0) enterPhase(state, 'prep', ev);
      return ev;
    case 'prep':
      if (state.phaseTime <= 0) enterPhase(state, 'arrivals', ev);
      return ev;
    case 'chase':
      if (state.phaseTime <= 0) {
        for (const p of state.players) if (!p.escaped && !p.caught) catchPlayer(state, p, ev);
        finish(state, 'exposed', ev);
      }
      return ev;
    default:
      break;
  }

  tickArrivals(state, dt, world, r, ev);
  if (halted(state)) return ev;
  tickGaze(state, dt, world, ev);

  const hungerMult = state.room.neighborPresent ? tu.neighborHungerMultiplier : 1;
  const calm = state.room.musicOn ? 1.5 : 1;
  for (const g of state.guests) {
    if (g.eaten || g.where !== 'seated') continue;
    if (g.slipTimer > 0) {
      g.slipTimer -= dt;
      if (g.slipTimer <= 0) resolveSlip(state, g, world, r, ev);
      if (halted(state)) return ev;
    } else {
      g.composure = Math.min(100, g.composure + tu.composureRecoveryPerSec * calm * dt);
    }
    if (isServing(state)) {
      const quirkHunger = quirksOf(g).reduce((m, q) => m * (q.hungerMult ?? 1), 1);
      g.hunger = Math.min(100, g.hunger + traitsOf(state, g).hunger * quirkHunger * tu.hungerPerSec * hungerMult * dt);
    }
  }

  if (isServing(state)) state.cover = Math.min(100, state.cover + tu.coverRecoveryPerSec * dt);

  if (state.question) {
    state.question.timer -= dt;
    if (state.question.timer <= 0) {
      state.question = null;
      ev.push({ t: 'answered', kind: 'silence', text: '…awkward silence.', by: null });
      changeCover(state, -tu.silenceCost, 'You left a question hanging', ev);
      if (halted(state)) return ev;
    }
  }

  tickEvents(state, dt, world, r, ev);
  if (halted(state)) return ev;

  state.beatTimer -= dt;
  while (state.beatTimer <= 0 && !halted(state)) {
    state.beatTimer += tu.beatSeconds;
    doBeat(state, world, r, ev);
  }
  if (halted(state)) return ev;

  if (state.phase === 'arrivals') {
    const settled = state.guests.every((g) => g.where === 'seated' || g.where === 'gone' || g.eaten || g.lateAt >= 0);
    if (settled || state.phaseTime <= 0) {
      seatEveryone(state, r, ev);
      enterPhase(state, 'course', ev);
    }
  } else if (state.phaseTime <= 0) {
    if (state.phase === 'course' && state.course < tu.courses - 1) {
      state.course++;
      state.phaseTime += tu.courseSeconds;
      state.propsUsed = [];
      ev.push({ t: 'phase', phase: 'course', course: state.course });
    } else if (state.phase === 'course') {
      enterPhase(state, 'dessert', ev);
    } else {
      // Objectives nobody managed by the end of the night.
      for (const id of ['birthday_cake', 'book_streak', 'family_toasts'] as const) failObjective(state, id, 'Not this time', ev);
      finish(state, 'survived', ev);
    }
  }
  return ev;
}

function enterPhase(state: DinnerState, phase: DinnerState['phase'], ev: SimEvent[]): void {
  const tu = state.tuning;
  state.phase = phase;
  if (phase === 'prep') state.phaseTime = tu.prepSeconds;
  else if (phase === 'arrivals') state.phaseTime = tu.arrivalsMaxSeconds;
  else if (phase === 'course') {
    state.course = 0;
    state.phaseTime = tu.courseSeconds;
    state.dinnerStart = state.time;
    state.beatTimer = Math.min(state.beatTimer, 3);
    hunterArrives(state, ev);
  } else if (phase === 'dessert') {
    state.phaseTime = tu.dessertSeconds;
    hunterLeaves(state, ev);
    completeObjective(state, 'keep_secret', 'Dessert, and the guest of honor still has no idea. Surprise!', ev);
  }
  ev.push({ t: 'phase', phase, course: state.course });
}

// ---------------------------------------------------------------------------------------------
// Arrivals: doorbell → doorstep → (greet / invite) → walk in → stand → seat

function freeStandSpot(state: DinnerState): number {
  for (let i = 0; i < state.standCount; i++) {
    if (!state.guests.some((g) => (g.where === 'standing' || g.where === 'entering' ? g.standSpot === i : false))) return i;
  }
  return 0;
}

function freeSeats(state: DinnerState): number[] {
  const out: number[] = [];
  for (let s = 0; s < state.seatCount; s++) if (!guestAtSeat(state, s)) out.push(s);
  return out;
}

function goInside(state: DinnerState, g: GuestState, letThemselvesIn: boolean, ev: SimEvent[]): void {
  g.where = 'entering';
  g.whereTime = 0;
  g.standSpot = freeStandSpot(state);
  ev.push({ t: 'entering', guest: g.id, letThemselvesIn });
}

function seatGuest(state: DinnerState, g: GuestState, seat: number, by: string | null, r: Rng, ev: SimEvent[]): void {
  g.where = 'seated';
  g.seat = seat;
  g.whereTime = 0;
  g.standSpot = -1;
  ev.push({ t: 'seated', guest: g.id, seat, by });
  introduceQuirks(g, r, ev);
}

/** Arrivals ran out of time: whoever isn't seated yet is ushered in by the other guests. */
function seatEveryone(state: DinnerState, r: Rng, ev: SimEvent[]): void {
  for (const g of state.guests) {
    if (g.eaten || g.where === 'seated' || g.where === 'gone' || g.lateAt >= 0) continue;
    if (typeOf(g).needsInvite && !g.invited) {
      g.composure = Math.max(5, g.composure - 25);
      tell(g, 'bad', ['*finally let in by another guest, and NOT pleased about it*'], 'threshold', r, ev);
    }
    const seats = freeSeats(state);
    if (seats.length === 0) break;
    seatGuest(state, g, r.pick(preferredSeats(state, g, seats)), null, r, ev);
  }
}

function tickArrivals(state: DinnerState, dt: number, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const tu = state.tuning;
  const elapsed = state.phase === 'arrivals' ? tu.arrivalsMaxSeconds - state.phaseTime : Infinity;
  for (const g of state.guests) {
    if (g.eaten) continue;
    switch (g.where) {
      case 'outside': {
        const due = g.lateAt >= 0 ? isServing(state) && dinnerTime(state) >= g.lateAt : state.phase === 'arrivals' && elapsed >= g.arriveAt;
        if (due) {
          g.where = 'door';
          g.whereTime = 0;
          ev.push({ t: 'doorbell', guest: g.id });
          if (g.lateAt >= 0) ev.push({ t: 'event', id: 'late_guest', text: `The doorbell: ${g.name} is fashionably late. Find them a chair!` });
        }
        break;
      }
      case 'door':
        g.whereTime += dt;
        if (g.greeted && (g.invited || !typeOf(g).needsInvite)) goInside(state, g, false, ev);
        else if (!typeOf(g).needsInvite && g.whereTime >= tu.doorPatience) {
          goInside(state, g, true, ev);
          changeCover(state, -tu.doorLeftCost, `Nobody answered the door to ${g.name}`, ev);
        }
        break;
      case 'entering':
        g.whereTime += dt;
        if (g.whereTime >= tu.walkInSeconds) {
          g.where = 'standing';
          g.whereTime = 0;
          ev.push({ t: 'standing', guest: g.id });
        }
        break;
      case 'standing': {
        g.whereTime += dt;
        const seats = freeSeats(state);
        if (g.whereTime >= tu.seatPatience && seats.length > 0) seatGuest(state, g, r.pick(preferredSeats(state, g, seats)), null, r, ev);
        break;
      }
      default:
        break;
    }
    if (isOver(state)) return;
  }
  void world;
}

// ---------------------------------------------------------------------------------------------
// Beats

function doBeat(state: DinnerState, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const tu = state.tuning;
  state.beat++;

  for (const g of state.guests) {
    g.eatingBeats = Math.max(0, g.eatingBeats - 1);
    g.addressedBeats = Math.max(0, g.addressedBeats - 1);
  }

  // Someone stuck on the doorstep, waiting to be invited.
  for (const g of state.guests) {
    if (g.where !== 'door' || !typeOf(g).needsInvite || g.invited) continue;
    hurt(state, g, tu.thresholdDamagePerBeat, 'threshold', ['*hovers at the threshold, waiting to be asked in*'], world, r, ev);
    if (halted(state)) return;
  }

  // The room
  for (const g of state.guests) {
    if (!isAvailable(g)) continue;
    const type = traitsOf(state, g);
    if (type.moonSensitive && state.room.moonUp && state.room.curtainsOpen) {
      hurt(state, g, tu.moonDamagePerBeat + tu.moonDamageGrowth * g.moonBeats, 'moon', type.tells.room, world, r, ev);
      g.moonBeats++;
    } else {
      g.moonBeats = 0;
    }
    if (type.mirrorSensitive && !state.room.mirrorCovered) {
      hurt(state, g, tu.mirrorDamagePerBeat, 'mirror', type.tells.room, world, r, ev);
    }
    if (typeOf(g).needsAddressing && g.addressedBeats === 0 && state.topic?.holder !== g.id) {
      hurt(state, g, tu.ignoredDamagePerBeat, 'ignored', ['*sits in silence, waiting to be asked*'], world, r, ev);
    }
    if (state.room.alarm) {
      hurt(state, g, tu.alarmDamagePerBeat, 'alarm', ['*clamps their hands over their ears*', '*flinches at every beep*'], world, r, ev);
    }
    if (isDark(state)) {
      if (type.id === 'vampire') heal(state, g, tu.darkDamagePerBeat);
      else hurt(state, g, tu.darkDamagePerBeat, 'dark', null, world, r, ev);
    }
    if (halted(state)) return;
  }

  beatGuests(state, world, r, ev);
  if (halted(state)) return;
  beatEvents(state, world, r, ev);
  if (halted(state)) return;

  advanceTopic(state, world, r, ev);
  if (halted(state)) return;
  if (!isServing(state)) return;

  // Hunger: eye a neighbor, then eat them.
  for (const g of state.guests) {
    if (!isAvailable(g) || traitsOf(state, g).hunger === 0) continue;
    if (g.hunger < 100) {
      g.eyeing = null;
      continue;
    }
    const near = neighbors(state, g);
    const target = g.eyeing === null ? undefined : state.guests[g.eyeing];
    if (!target || target.eaten || !near.includes(target)) {
      const prey = near.length > 0 ? r.pick(near) : undefined;
      g.eyeing = prey?.id ?? null;
      g.eyeingBeats = tu.eyeingBeats;
      if (prey) {
        ev.push({ t: 'eyeing', guest: g.id, target: prey.id });
        tell(g, 'bad', traitsOf(state, g).tells.hungry, 'hunger', r, ev);
      }
      continue;
    }
    g.eyeingBeats--;
    if (g.eyeingBeats > 0) continue;
    target.eaten = true;
    target.where = 'gone';
    g.hunger = 0;
    g.eyeing = null;
    ev.push({ t: 'eaten', guest: target.id, by: g.id });
    incident(state, 'eaten', `${g.name} ate ${target.name}.`, g.id, 9);
    if (state.topic?.holder === target.id) dropTopic(state, ev, `${target.name} is no longer with us.`);
    if (state.honoree === target.id) {
      failObjective(state, 'birthday_cake', `${target.name} won't be having any cake`, ev);
      failObjective(state, 'keep_secret', `${target.name} was eaten before the surprise`, ev);
    }
    strike(state, `${target.name} was eaten`, ev);
    if (isOver(state)) return;
    // A dinner party for one isn't a dinner party: whoever's left makes their excuses (D-018).
    const left = state.guests.filter((x) => !x.eaten && x.where !== 'gone').length;
    if (left < tu.minGuests) {
      incident(state, 'strike', 'Hardly anyone was left at the table, so the party broke up.', null, 8);
      finish(state, 'strikes', ev);
      return;
    }
  }

  if (!state.question) {
    state.questionInBeats--;
    if (state.questionInBeats <= 0) {
      openQuestion(state, world, r, ev);
      state.questionInBeats = r.int(tu.questionEveryBeatsMin, tu.questionEveryBeatsMax);
    }
  }
}

function advanceTopic(state: DinnerState, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const t = state.topic;
  if (!t || !isAvailable(guest(state, t.holder))) {
    const starter = pickStarter(state, r);
    if (starter) startTopic(state, starter, r, ev);
    return;
  }
  t.age++;
  if (t.age >= t.life) {
    startTopic(state, guest(state, t.holder), r, ev);
    return;
  }
  const next = predictNext(state);
  if (next === null) return;
  const g = guest(state, next);
  t.previous = t.holder;
  t.holder = next;
  ev.push({ t: 'topic', guest: next, kind: 'pass', text: t.label });
  react(state, g, t.tags, world, r, ev);
}

function pickStarter(state: DinnerState, r: Rng): GuestState | undefined {
  if (state.nextStarter !== null) {
    const g = state.guests[state.nextStarter];
    state.nextStarter = null;
    if (g && isAvailable(g) && g.counting === 0) return g;
  }
  const options = state.guests.filter((g) => isAvailable(g) && g.counting === 0 && !typeOf(g).needsAddressing);
  const pool = options.length > 0 ? options : state.guests.filter(isAvailable);
  return pool.length > 0 ? r.pick(pool) : undefined;
}

function startTopic(state: DinnerState, starter: GuestState, r: Rng, ev: SimEvent[]): void {
  const current = state.topic?.id;
  // Book Club: half the time, conversation drifts back to the book.
  const wanted: readonly TopicTag[] = state.book.length > 0 && r.next() < 0.5 ? state.book : likesOf(state, starter);
  const liked = TOPICS.filter((t) => t.id !== current && t.tags.some((tag) => wanted.includes(tag)));
  const def = r.pick(liked.length > 0 ? liked : TOPICS.filter((t) => t.id !== current));
  const old = quirksOf(starter).find((q) => q.oldTopics);
  state.topic = {
    id: def.id,
    label: old ? `${def.label} (as they said in 1847)` : def.label,
    tags: [...def.tags],
    holder: starter.id,
    previous: null,
    age: 0,
    life: r.int(state.tuning.topicLifeMin, state.tuning.topicLifeMax),
  };
  ev.push({ t: 'topic', guest: starter.id, kind: 'start', text: state.topic.label });
  if (old && r.next() < 0.5) tell(starter, 'neutral', [old.tell], 'quirk', r, ev);
}

function react(state: DinnerState, g: GuestState, tags: readonly TopicTag[], world: SimWorld, r: Rng, ev: SimEvent[]): void {
  g.attention++;
  const type = traitsOf(state, g);
  const triggers = triggersOf(state, g);
  const loud = quirksOf(g).some((q) => q.loud);
  topicRelationships(state, g, tags, world, r, ev);
  if (halted(state)) return;
  const triggered = tags.filter((tag) => triggers.includes(tag));
  if (triggered.length > 0) {
    hurt(state, g, state.tuning.topicTriggerDamage * triggered.length, `topic:${triggered.join('+')}`, type.tells.topic, world, r, ev);
    return;
  }
  const likes = likesOf(state, g);
  const liked = tags.filter((tag) => likes.includes(tag)).length;
  if (liked > 0) {
    const bonus = quirksOf(g).reduce((n, q) => n + (q.likeBonus ?? 0), 0);
    heal(state, g, state.tuning.topicLikeBonus * liked + bonus);
    if (loud || r.next() < 0.4) tell(g, 'good', type.tells.happy, 'topic', r, ev);
  }
}

// ---------------------------------------------------------------------------------------------
// Rumor Ledger

/** A host did something a rule on the ledger forbids. Only counts if a guest saw it. */
function breaksRule(state: DinnerState, check: RuleCheck, by: string, world: SimWorld, ev: SimEvent[]): boolean {
  let broke = false;
  for (const id of state.ledger) {
    if (ruleById(id).check !== check) continue;
    if (!world.seenBy(by)) continue;
    broke = true;
    state.stats.rulesBroken++;
    const p = player(state, by);
    if (p) p.stats.rulesBroken++;
    ev.push({ t: 'ruleBroken', rule: id, by });
    changeCover(state, -state.tuning.ruleBreakCost, `Broke your own rule: ${ruleById(id).rule}`, ev);
  }
  return broke;
}

function addRule(state: DinnerState, id: string, asker: GuestState, by: string, ev: SimEvent[]): void {
  if (state.ledger.includes(id)) return;
  state.ledger.push(id);
  state.stats.rulesAdded++;
  const p = player(state, by);
  if (p) p.stats.lies++;
  ev.push({ t: 'rule', rule: id, by });
  for (const other of ruleById(id).contradicts) {
    if (!state.ledger.includes(other)) continue;
    asker.suspicious = true;
    state.stats.contradictions++;
    ev.push({ t: 'contradiction', a: id, b: other, guest: asker.id });
    incident(state, 'contradiction', `${asker.name} caught you contradicting yourselves.`, asker.id, 4);
    changeCover(state, -state.tuning.contradictionCost, `${asker.name} noticed a contradiction`, ev);
  }
}

function openQuestion(state: DinnerState, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const askers = state.guests.filter((g) => isAvailable(g) && g.eatingBeats === 0);
  if (askers.length === 0) return;
  const asker = r.pick(askers);
  const near = state.players.filter((p) => !p.caught && !p.escaped && p.stone <= 0 && world.canHear(asker.id, p.id));
  if (near.length === 0) {
    changeCover(state, -state.tuning.emptyTableCost, `${asker.name} wonders where the hosts have got to`, ev);
    tell(asker, 'neutral', ['*looks around for the hosts*'], 'empty', r, ev);
    return;
  }
  const target = r.pick(near);
  const fresh = QUESTIONS.filter((q) => !state.recentQuestions.includes(q.id));
  const q = r.pick(fresh.length > 0 ? fresh : QUESTIONS);
  state.recentQuestions = [...state.recentQuestions, q.id].slice(-3);
  // A host whose name a fae took can't lie at all.
  const lieIds = target.nameTaken ? [] : asker.suspicious ? r.shuffle(q.lies).slice(0, 2) : [...q.lies];
  const options: AnswerOption[] = [
    ...lieIds.map((rule): AnswerOption => ({ kind: 'lie', rule, text: ruleById(rule).claim })),
    { kind: 'truth', text: q.truth },
    { kind: 'deflect', text: '"Enough about me! Tell us about you."' },
  ];
  const seconds = asker.suspicious ? state.tuning.suspiciousQuestionSeconds : state.tuning.questionSeconds;
  state.question = { id: q.id, text: q.text, asker: asker.id, target: target.id, options, timer: seconds, total: seconds };
  ev.push({ t: 'question', guest: asker.id, target: target.id });
}

// ---------------------------------------------------------------------------------------------
// Words

/** Lower-case words separated by single spaces, padded so ` word ` matches whole words only. */
export function normalizeSpeech(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/** Every trigger word, exposure word and invite phrase the game listens for (speech vocabulary). */
export function speechVocabulary(): string[] {
  const words = new Set<string>();
  for (const t of Object.values(GUEST_TYPES)) for (const w of t.words) words.add(w);
  for (const w of EXPOSURE_WORDS) words.add(w);
  for (const w of INVITE_PHRASES) words.add(w);
  return [...words].sort();
}

function hear(state: DinnerState, by: string, text: string, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const tu = state.tuning;
  const padded = normalizeSpeech(text);
  let anyoneHeard = false;
  for (const g of state.guests) {
    if (!canBeHurt(g) || !world.canHear(g.id, by)) continue;
    anyoneHeard = true;
    if (g.where === 'door' && INVITE_PHRASES.some((w) => padded.includes(` ${w} `))) {
      g.greeted = true;
      g.invited = true;
      ev.push({ t: 'greeted', guest: g.id, by });
      continue;
    }
    const hit = traitsOf(state, g).words.find((w) => padded.includes(` ${w} `)) ?? typeOf(g).words.find((w) => padded.includes(` ${w} `));
    if (!hit) continue;
    if (heardWord(state, g, hit, by, r, ev)) continue;
    state.stats.wordsHeard++;
    const p = player(state, by);
    if (p) p.stats.wordsLanded++;
    toastSpoiled(state, by);
    ev.push({ t: 'heard', guest: g.id, word: hit, by });
    hurt(state, g, tu.wordDamage, `word:${hit}`, traitsOf(state, g).tells.word, world, r, ev);
    if (halted(state)) return;
  }
  const exposed = EXPOSURE_WORDS.find((w) => padded.includes(` ${w} `));
  if (anyoneHeard && exposed) {
    toastSpoiled(state, by);
    changeCover(state, -tu.exposureWordCost, `"${exposed}"? Very human of you`, ev);
  }
}

// ---------------------------------------------------------------------------------------------
// Player actions

export function act(state: DinnerState, action: Action, world: SimWorld): SimEvent[] {
  const ev: SimEvent[] = [];
  if (isOver(state)) return ev;
  const tu = state.tuning;
  const r = rngOn(state);
  const by = 'by' in action ? action.by : null;
  const p = by === null ? undefined : player(state, by);
  const note = (text: string) => ev.push(by === null ? { t: 'note', text } : { t: 'note', text, to: by });

  if (state.phase === 'chase') {
    if (action.type === 'caught' || action.type === 'escaped') {
      const target = player(state, action.player);
      if (!target || target.caught || target.escaped) return ev;
      if (action.type === 'caught') catchPlayer(state, target, ev);
      else {
        target.escaped = true;
        ev.push({ t: 'escaped', player: target.id });
      }
      if (state.players.every((x) => x.caught || x.escaped)) finish(state, 'exposed', ev);
    }
    return ev;
  }

  // Statues can't do much.
  if (p && p.stone > 0 && action.type !== 'say' && action.type !== 'answer') {
    note("You're stone. Give it a moment.");
    return ev;
  }

  switch (action.type) {
    case 'skip': {
      if (state.phase === 'booking' || state.phase === 'prep') {
        enterPhase(state, state.phase === 'booking' ? 'prep' : 'arrivals', ev);
      }
      return ev;
    }

    case 'greet': {
      const g = state.guests[action.guest];
      if (!g || g.where !== 'door') return ev;
      breaksRule(state, 'open_door', action.by, world, ev);
      if (halted(state)) return ev;
      if (!g.greeted && p) p.stats.greeted++;
      g.greeted = true;
      ev.push({ t: 'greeted', guest: g.id, by: action.by });
      if (typeOf(g).needsInvite && !g.invited) {
        ev.push({ t: 'threshold', guest: g.id });
        tell(g, 'neutral', ['*stops dead at the threshold* "…May I come in?"'], 'threshold', r, ev);
      }
      return ev;
    }

    case 'invite': {
      const g = state.guests[action.guest];
      if (!g || g.where !== 'door') return ev;
      if (!g.greeted && p) p.stats.greeted++;
      g.greeted = true;
      g.invited = true;
      ev.push({ t: 'greeted', guest: g.id, by: action.by });
      return ev;
    }

    case 'smallTalk': {
      if (!p) return ev;
      const topicId = p.hand[action.card];
      const g = state.guests[action.guest];
      if (!topicId) return note('That card is still coming back to you.'), ev;
      if (!g || !isAvailable(g)) return note("They can't talk right now."), ev;
      if (g.counting > 0) return note(`${g.name} is busy counting wine drops.`), ev;
      const def = topicById(topicId);
      if (def.tags.includes('pets')) breaksRule(state, 'talk_pets', action.by, world, ev);
      if (def.tags.includes('family')) breaksRule(state, 'talk_family', action.by, world, ev);
      if (halted(state)) return ev;
      state.topic = {
        id: def.id,
        label: def.label,
        tags: [...def.tags],
        holder: g.id,
        previous: state.topic?.holder ?? null,
        age: 0,
        life: r.int(tu.topicLifeMin, tu.topicLifeMax),
      } satisfies TopicState;
      state.beatTimer = tu.beatSeconds;
      g.addressedBeats = tu.addressedBeats;
      p.hand[action.card] = null;
      p.handCooldown[action.card] = tu.cardCooldown;
      p.stats.smallTalk++;
      state.stats.smallTalk++;
      ev.push({ t: 'topic', guest: g.id, kind: 'smallTalk', text: def.label, by: action.by });
      smallTalked(state, g, topicId, action.by, r, ev);
      interruptCharades(state, g, r, ev);
      react(state, g, def.tags, world, r, ev);
      return ev;
    }

    case 'serve': {
      const g = state.guests[action.guest];
      const dish = dishById(action.dish);
      if (!g || !isAvailable(g)) return note("They're in no state to eat."), ev;
      state.stats.servings++;
      if (p) p.stats.served++;
      const tags = dish.tags as readonly string[];
      if (tags.includes('garlic')) breaksRule(state, 'garlic', action.by, world, ev);
      if (halted(state)) return ev;
      g.addressedBeats = Math.max(g.addressedBeats, 1);

      const type = traitsOf(state, g);
      let eating = false;
      let text = `${g.name} is served ${dish.label.toLowerCase()}.`;
      if (tags.includes('nothing')) {
        if (type.servingReminds) {
          heal(state, g, tu.dishLikeBonus);
          tell(g, 'good', ['*smiles at the empty plate, very content*'], 'dish', r, ev);
        } else {
          hurt(state, g, 3, 'dish', ['*stares at the empty plate*'], world, r, ev);
          changeCover(state, -3, 'You served an empty plate', ev);
        }
      } else if (type.servingReminds) {
        hurt(state, g, tu.dishRemindDamage, 'dish', type.tells.dish, world, r, ev);
      } else if (hurtByOf(state, g).some((t) => tags.includes(t))) {
        hurt(state, g, tu.dishHurtDamage, 'dish', type.tells.dish, world, r, ev);
      } else if (type.eats.some((t) => tags.includes(t))) {
        if (action.burnt) {
          g.hunger = Math.max(0, g.hunger - tu.burntHungerDrop);
          hurt(state, g, tu.burntDishComposure, 'dish', ['*chews the burnt bits… bravely*'], world, r, ev);
          text = `${g.name} gamely eats the burnt ${dish.label.toLowerCase()}.`;
        } else {
          g.hunger = Math.max(0, g.hunger - tu.eatHungerDrop);
          heal(state, g, tu.dishLikeBonus);
          tell(g, 'good', type.tells.happy, 'dish', r, ev);
        }
        eating = true;
      } else if (type.meh.some((t) => tags.includes(t))) {
        g.hunger = Math.max(0, g.hunger - tu.mehHungerDrop);
        tell(g, 'neutral', type.tells.dish, 'dish', r, ev);
        eating = true;
      } else {
        text = `${g.name} doesn't touch the ${dish.label.toLowerCase()}.`;
      }
      ev.push({ t: 'served', guest: g.id, dish: dish.id, by: action.by, text, ate: eating });
      served(state, g, dish.id, action.by, world, r, ev);
      if (halted(state)) return ev;
      if (eating) {
        g.eatingBeats = 1;
        g.eyeing = null;
        if (state.topic?.holder === g.id) dropTopic(state, ev, `${g.name} is busy eating.`);
      }
      return ev;
    }

    case 'toggle': {
      const room = state.room;
      const what = action.what;
      if (what === 'curtains') {
        room.curtainsOpen = !room.curtainsOpen;
        if (p) p.stats.curtains++;
        ev.push({ t: 'room', what, on: room.curtainsOpen, by: action.by });
        if (room.curtainsOpen) breaksRule(state, 'open_curtains', action.by, world, ev);
      } else if (what === 'mirror') {
        room.mirrorCovered = !room.mirrorCovered;
        ev.push({ t: 'room', what, on: room.mirrorCovered, by: action.by });
        if (!room.mirrorCovered) breaksRule(state, 'uncover_mirror', action.by, world, ev);
      } else if (what === 'lights') {
        if (!room.powerOn) return note('Nothing happens. The power is out: check the fuse box.'), ev;
        room.lightsOn = !room.lightsOn;
        ev.push({ t: 'room', what, on: room.lightsOn, by: action.by });
        if (room.lightsOn) breaksRule(state, 'lights_on', action.by, world, ev);
      } else {
        if (!room.powerOn) return note('The record player needs power.'), ev;
        room.musicOn = !room.musicOn;
        ev.push({ t: 'room', what, on: room.musicOn, by: action.by });
        breaksRule(state, 'play_music', action.by, world, ev);
      }
      return ev;
    }

    case 'prop': {
      const prop = PROP_TOPICS[action.prop];
      if (!prop) return note('Nothing interesting about that.'), ev;
      if (!world.seenBy(action.by)) return note('Nobody at the table can see that from here.'), ev;
      propShown(state, action.prop, action.by, r, ev);
      if (state.propsUsed.includes(action.prop)) {
        changeCover(state, -tu.propRepeatCost, 'You already showed them that', ev);
        return ev;
      }
      const holder = state.topic ? guest(state, state.topic.holder) : pickStarter(state, r);
      if (!holder || !isAvailable(holder)) return note('Nobody is looking.'), ev;
      state.propsUsed.push(action.prop);
      if (p) p.stats.propsShown++;
      state.topic = {
        id: `prop_${action.prop}`,
        label: prop.label,
        tags: [...prop.tags],
        holder: holder.id,
        previous: state.topic?.previous ?? null,
        age: 0,
        life: r.int(tu.topicLifeMin, tu.topicLifeMax),
      };
      state.beatTimer = tu.beatSeconds;
      ev.push({ t: 'topic', guest: holder.id, kind: 'prop', text: prop.label, by: action.by });
      react(state, holder, prop.tags, world, r, ev);
      return ev;
    }

    case 'answer': {
      const q = state.question;
      const opt = q?.options[action.choice];
      if (!q || !opt) return ev;
      if (q.target !== action.by) return note(`${guest(state, q.asker).name} asked someone else.`), ev;
      const asker = guest(state, q.asker);
      state.question = null;
      state.stats.questionsAnswered++;
      ev.push({ t: 'answered', kind: opt.kind, text: opt.text, by: action.by });
      if (opt.kind === 'lie') addRule(state, opt.rule, asker, action.by, ev);
      else if (opt.kind === 'truth') changeCover(state, -tu.truthCost, 'That sounded very human', ev);
      else changeCover(state, -tu.deflectCost, 'A clumsy dodge', ev);
      return ev;
    }

    case 'say': {
      if (!action.voice) toastTyped(state, action.by, action.text);
      hear(state, action.by, action.text, world, r, ev);
      return ev;
    }

    case 'reseat': {
      const g = state.guests[action.guest];
      if (!g || g.eaten) return ev;
      if (action.seat < 0 || action.seat >= state.seatCount) return ev;
      const other = guestAtSeat(state, action.seat);
      if (g.where === 'standing' || g.where === 'entering') {
        if (other) return note('Someone is already sitting there.'), ev;
        seatGuest(state, g, action.seat, action.by, r, ev);
        return ev;
      }
      if (!isAvailable(g)) return note("They won't move right now."), ev;
      if (action.seat === g.seat) return ev;
      if (other && !isAvailable(other)) return note("That seat's occupant won't budge."), ev;
      const from = g.seat;
      g.seat = action.seat;
      if (other) other.seat = from;
      g.eyeing = null;
      if (other) other.eyeing = null;
      state.stats.reseats++;
      if (p) p.stats.reseats++;
      ev.push({ t: 'reseat', guest: g.id, seat: action.seat, swappedWith: other?.id ?? null, by: action.by });
      reseated(state, g);
      if (other) reseated(state, other);
      hurt(state, g, tu.reseatDamage, 'reseat', null, world, r, ev);
      if (other) hurt(state, other, tu.reseatDamage, 'reseat', null, world, r, ev);
      changeCover(state, -tu.reseatCost, '"Would you mind terribly switching seats?"', ev);
      return ev;
    }

    case 'showOut': {
      if (state.room.neighborPresent) {
        state.room.neighborPresent = false;
        ev.push({ t: 'neighbor', arrived: false, text: 'You steer Gary back out of the front door. "Lovely to see you!"' });
        changeCover(state, tu.neighborShownOutBonus, 'Gary is gone', ev);
        return ev;
      }
      if (state.visitor?.kind === 'pizza') {
        const why = handleVisitor(state, action.by, world, ev);
        if (why) note(why);
        return ev;
      }
      return note('Nobody to show out.'), ev;
    }

    case 'visitor': {
      const why = handleVisitor(state, action.by, world, ev);
      if (why) note(why);
      return ev;
    }

    case 'did': {
      breaksRule(state, action.what, action.by, world, ev);
      return ev;
    }

    case 'plated': {
      if (p) p.stats.plated++;
      return ev;
    }

    case 'alarm': {
      state.room.alarm = action.on;
      return ev;
    }

    case 'fuse': {
      if (!fixFuse(state, action.by, ev)) note('The fuses are fine.');
      return ev;
    }

    case 'dogHome': {
      dogHome(state, action.by, ev);
      return ev;
    }

    case 'clean': {
      if (!cleanSpill(state, action.by, ev)) note('Nothing to clean up.');
      return ev;
    }

    case 'reattach': {
      const g = state.guests[action.guest];
      if (!g || !reattach(state, g, action.by, r, ev)) note("They aren't missing anything. Probably.");
      return ev;
    }

    case 'thrown': {
      thrown(state, action.hit, world, r, ev);
      return ev;
    }

    case 'caught':
    case 'escaped':
      return ev;
  }
}

