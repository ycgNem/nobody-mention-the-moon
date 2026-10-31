// The dinner rules (docs/GDD.md §7). Deterministic: all randomness comes from state.rngState,
// so the same seed and the same actions at the same times replay the same dinner.
// Functions update the DinnerState in place and return events for the presentation layer.

import { dishById } from '../content/dishes.ts';
import {
  DISGUISE_COLORS,
  DISGUISE_NAMES,
  EXPOSURE_WORDS,
  GUEST_TYPES,
  type GuestTypeDef,
  type GuestTypeId,
} from '../content/guests.ts';
import { QUESTIONS, RULES, ruleById, type RuleCheck } from '../content/questions.ts';
import { PROPS, TOPICS, topicById, type PropId, type TopicTag } from '../content/topics.ts';
import { hashSeed, rngOn, type Rng } from '../rng.ts';
import { SIM, type SimTuning } from '../tuning.ts';
import type {
  Action,
  AnswerOption,
  DinnerResult,
  DinnerState,
  GuestState,
  SimEvent,
  SimWorld,
  TopicState,
} from './types.ts';

export interface DinnerOptions {
  seed: string;
  /** Seats around the table, in clockwise order. */
  seatCount: number;
  tuning?: Partial<SimTuning>;
}

// ---------------------------------------------------------------------------------------------
// Setup

export function createDinner(opts: DinnerOptions): DinnerState {
  const tuning: SimTuning = { ...SIM, ...opts.tuning };
  const state: DinnerState = {
    seed: opts.seed,
    rngState: hashSeed(opts.seed),
    tuning,
    seatCount: opts.seatCount,
    time: 0,
    phase: 'course',
    course: 0,
    phaseTime: tuning.courseSeconds,
    beat: 0,
    beatTimer: 3,
    guests: [],
    topic: null,
    nextStarter: null,
    hand: [],
    handCooldown: [],
    dishCooldown: {},
    propsUsed: [],
    cover: tuning.coverStart,
    strikes: 0,
    room: {
      curtainsOpen: true,
      mirrorCovered: false,
      lightsOn: true,
      moonUp: false,
      neighborPresent: false,
      neighborTimer: 0,
    },
    ledger: [],
    question: null,
    questionInBeats: 0,
    recentQuestions: [],
    schedule: [],
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
    result: null,
  };

  const r = rngOn(state);
  const count = Math.min(tuning.guests, opts.seatCount);
  // At most two of any type, so every dinner mixes monsters.
  const typePool = r.shuffle<GuestTypeId>(['werewolf', 'vampire', 'ghost', 'werewolf', 'vampire', 'ghost']);
  const names = r.shuffle(DISGUISE_NAMES);
  const colors = r.shuffle(DISGUISE_COLORS);
  const seats = r.shuffle([...Array(opts.seatCount).keys()]);
  for (let i = 0; i < count; i++) {
    state.guests.push({
      id: i,
      type: typePool[i % typePool.length]!,
      name: names[i % names.length]!,
      color: colors[i % colors.length]!,
      seat: seats[i]!,
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
    });
  }

  for (let i = 0; i < tuning.handSize; i++) {
    state.hand.push(drawCard(state, r));
    state.handCooldown.push(0);
  }

  // The Booking Card's starting rumor: one restrictive rule already on the ledger.
  state.ledger.push(r.pick(RULES.filter((rule) => rule.check !== null)).id);

  const cs = tuning.courseSeconds;
  state.schedule.push({ kind: 'moonrise', at: cs + r.int(20, Math.max(21, cs - 60)), fired: false });
  const neighborCourse = r.pick([0, 2]);
  state.schedule.push({
    kind: 'neighbor',
    at: neighborCourse * cs + r.int(40, Math.max(41, cs - 40)),
    fired: false,
  });
  state.questionInBeats = r.int(tuning.questionEveryBeatsMin, tuning.questionEveryBeatsMax);
  return state;
}

// ---------------------------------------------------------------------------------------------
// Queries

export function typeOf(g: GuestState): GuestTypeDef {
  return GUEST_TYPES[g.type];
}

export function guest(state: DinnerState, id: number): GuestState {
  const g = state.guests[id];
  if (!g) throw new Error(`no guest ${id}`);
  return g;
}

export function isPresent(g: GuestState): boolean {
  return !g.eaten;
}

/** Can take part in conversation right now. */
export function isAvailable(g: GuestState): boolean {
  return !g.eaten && g.slipTimer <= 0;
}

export function guestAtSeat(state: DinnerState, seat: number): GuestState | undefined {
  return state.guests.find((g) => !g.eaten && g.seat === seat);
}

/** Nearest present guests clockwise and counter-clockwise. Empty seats are skipped. */
export function neighbors(state: DinnerState, g: GuestState): GuestState[] {
  const n = state.seatCount;
  const found: GuestState[] = [];
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

function canReceiveTopic(g: GuestState): boolean {
  if (!isAvailable(g) || g.eatingBeats > 0) return false;
  return !(typeOf(g).needsAddressing && g.addressedBeats === 0);
}

export function topicPull(state: DinnerState, g: GuestState): number {
  const t = state.topic;
  if (!t) return 0;
  const tu = state.tuning;
  const type = typeOf(g);
  let pull = t.tags.filter((tag) => type.likes.includes(tag)).length * tu.pullPerLikedTag;
  if (neighbors(state, guest(state, t.holder)).includes(g)) pull += tu.pullNeighbor;
  if (g.id === t.previous) pull += tu.pullPreviousHolder;
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

export function isOver(state: DinnerState): boolean {
  return state.phase === 'ended';
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

  for (let i = 0; i < state.hand.length; i++) {
    if (state.hand[i] !== null) continue;
    state.handCooldown[i] = Math.max(0, (state.handCooldown[i] ?? 0) - dt);
    if (state.handCooldown[i] === 0) state.hand[i] = drawCard(state, r);
  }
  for (const id of Object.keys(state.dishCooldown)) {
    state.dishCooldown[id] = Math.max(0, (state.dishCooldown[id] ?? 0) - dt);
  }

  const hungerMult = state.room.neighborPresent ? tu.neighborHungerMultiplier : 1;
  for (const g of state.guests) {
    if (g.eaten) continue;
    if (g.slipTimer > 0) {
      g.slipTimer -= dt;
      if (g.slipTimer <= 0) resolveSlip(state, g, world, r, ev);
      if (isOver(state)) return ev;
    } else {
      g.composure = Math.min(100, g.composure + tu.composureRecoveryPerSec * dt);
    }
    g.hunger = Math.min(100, g.hunger + typeOf(g).hunger * tu.hungerPerSec * hungerMult * dt);
  }

  state.cover = Math.min(100, state.cover + tu.coverRecoveryPerSec * dt);

  if (state.question) {
    state.question.timer -= dt;
    if (state.question.timer <= 0) {
      state.question = null;
      ev.push({ t: 'answered', kind: 'silence', text: '…awkward silence.' });
      changeCover(state, -tu.silenceCost, 'You left a question hanging', ev);
      if (isOver(state)) return ev;
    }
  }

  for (const s of state.schedule) {
    if (s.fired || state.time < s.at) continue;
    s.fired = true;
    if (s.kind === 'moonrise') {
      state.room.moonUp = true;
      ev.push({ t: 'moonrise' });
    } else {
      state.room.neighborPresent = true;
      state.room.neighborTimer = tu.neighborStaySeconds;
      ev.push({ t: 'neighbor', arrived: true, text: 'Ding-dong. Gary from next door "just popped round". He is very human.' });
    }
  }
  if (state.room.neighborPresent) {
    state.room.neighborTimer -= dt;
    if (state.room.neighborTimer <= 0) {
      state.room.neighborPresent = false;
      ev.push({ t: 'neighbor', arrived: false, text: 'Gary leaves on his own, looking thoughtful.' });
      changeCover(state, -tu.neighborLeavesCost, 'Gary noticed things', ev);
      if (isOver(state)) return ev;
    }
  }

  state.beatTimer -= dt;
  while (state.beatTimer <= 0 && !isOver(state)) {
    state.beatTimer += tu.beatSeconds;
    doBeat(state, r, ev);
  }
  if (isOver(state)) return ev;

  if (state.phaseTime <= 0) {
    if (state.phase === 'course' && state.course < tu.courses - 1) {
      state.course++;
      state.phaseTime += tu.courseSeconds;
      state.propsUsed = [];
      ev.push({ t: 'phase', phase: 'course', course: state.course });
    } else if (state.phase === 'course') {
      state.phase = 'dessert';
      state.phaseTime += tu.dessertSeconds;
      ev.push({ t: 'phase', phase: 'dessert', course: state.course });
    } else {
      end(state, 'survived', ev);
    }
  }
  return ev;
}

function doBeat(state: DinnerState, r: Rng, ev: SimEvent[]): void {
  const tu = state.tuning;
  state.beat++;

  for (const g of state.guests) {
    g.eatingBeats = Math.max(0, g.eatingBeats - 1);
    g.addressedBeats = Math.max(0, g.addressedBeats - 1);
  }

  // The room
  for (const g of state.guests) {
    if (!isAvailable(g)) continue;
    const type = typeOf(g);
    if (type.moonSensitive && state.room.moonUp && state.room.curtainsOpen) {
      hurt(state, g, tu.moonDamagePerBeat + tu.moonDamageGrowth * g.moonBeats, 'moon', type.tells.room, r, ev);
      g.moonBeats++;
    } else {
      g.moonBeats = 0;
    }
    if (type.mirrorSensitive && !state.room.mirrorCovered) {
      hurt(state, g, tu.mirrorDamagePerBeat, 'mirror', type.tells.room, r, ev);
    }
    if (type.needsAddressing && g.addressedBeats === 0 && state.topic?.holder !== g.id) {
      hurt(state, g, tu.ignoredDamagePerBeat, 'ignored', ['*sits in silence, waiting to be asked*'], r, ev);
    }
    if (!state.room.lightsOn) {
      if (type.id === 'vampire') heal(g, tu.darkDamagePerBeat);
      else hurt(state, g, tu.darkDamagePerBeat, 'dark', null, r, ev);
    }
    if (isOver(state)) return;
  }

  advanceTopic(state, r, ev);
  if (isOver(state)) return;

  // Hunger: eye a neighbor, then eat them.
  for (const g of state.guests) {
    if (!isAvailable(g) || typeOf(g).hunger === 0) continue;
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
        tell(g, 'bad', typeOf(g).tells.hungry, 'hunger', r, ev);
      }
      continue;
    }
    g.eyeingBeats--;
    if (g.eyeingBeats > 0) continue;
    target.eaten = true;
    g.hunger = 0;
    g.eyeing = null;
    ev.push({ t: 'eaten', guest: target.id, by: g.id });
    if (state.topic?.holder === target.id) dropTopic(state, ev, `${target.name} is no longer with us.`);
    strike(state, `${target.name} was eaten`, ev);
    if (isOver(state)) return;
  }

  if (!state.question) {
    state.questionInBeats--;
    if (state.questionInBeats <= 0) {
      openQuestion(state, r, ev);
      state.questionInBeats = r.int(tu.questionEveryBeatsMin, tu.questionEveryBeatsMax);
    }
  }
}

function advanceTopic(state: DinnerState, r: Rng, ev: SimEvent[]): void {
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
  react(state, g, t.tags, r, ev);
}

function pickStarter(state: DinnerState, r: Rng): GuestState | undefined {
  if (state.nextStarter !== null) {
    const g = state.guests[state.nextStarter];
    state.nextStarter = null;
    if (g && isAvailable(g)) return g;
  }
  const options = state.guests.filter((g) => isAvailable(g) && !typeOf(g).needsAddressing);
  const pool = options.length > 0 ? options : state.guests.filter(isAvailable);
  return pool.length > 0 ? r.pick(pool) : undefined;
}

function startTopic(state: DinnerState, starter: GuestState, r: Rng, ev: SimEvent[]): void {
  const likes = typeOf(starter).likes;
  const current = state.topic?.id;
  const liked = TOPICS.filter((t) => t.id !== current && t.tags.some((tag) => likes.includes(tag)));
  const def = r.pick(liked.length > 0 ? liked : TOPICS.filter((t) => t.id !== current));
  state.topic = {
    id: def.id,
    label: def.label,
    tags: [...def.tags],
    holder: starter.id,
    previous: null,
    age: 0,
    life: r.int(state.tuning.topicLifeMin, state.tuning.topicLifeMax),
  };
  ev.push({ t: 'topic', guest: starter.id, kind: 'start', text: def.label });
}

function dropTopic(state: DinnerState, ev: SimEvent[], text: string): void {
  const t = state.topic;
  if (!t) return;
  const holder = guest(state, t.holder);
  state.topic = null;
  const n = state.seatCount;
  // The next present guest clockwise picks up the conversation on the next beat.
  for (let step = 1; step <= n; step++) {
    const g = guestAtSeat(state, (holder.seat + step) % n);
    if (g && g.id !== holder.id && isAvailable(g)) {
      state.nextStarter = g.id;
      break;
    }
  }
  ev.push({ t: 'topicDropped', guest: holder.id, text });
}

function react(state: DinnerState, g: GuestState, tags: readonly TopicTag[], r: Rng, ev: SimEvent[]): void {
  const type = typeOf(g);
  const triggered = tags.filter((tag) => type.triggers.includes(tag));
  if (triggered.length > 0) {
    hurt(state, g, state.tuning.topicTriggerDamage * triggered.length, `topic:${triggered.join('+')}`, type.tells.topic, r, ev);
    return;
  }
  const liked = tags.filter((tag) => type.likes.includes(tag)).length;
  if (liked > 0) {
    heal(g, state.tuning.topicLikeBonus * liked);
    if (r.next() < 0.4) tell(g, 'good', type.tells.happy, 'topic', r, ev);
  }
}

// ---------------------------------------------------------------------------------------------
// Meters

function tell(
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

function heal(g: GuestState, amount: number): void {
  if (g.slipTimer > 0 || g.eaten) return;
  g.composure = Math.min(100, g.composure + amount);
}

function hurt(
  state: DinnerState,
  g: GuestState,
  amount: number,
  cause: string,
  tells: readonly string[] | null,
  r: Rng,
  ev: SimEvent[],
): void {
  if (!isAvailable(g) || amount <= 0) return;
  g.composure -= amount;
  state.stats.triggers++;
  tell(g, 'bad', tells, cause, r, ev);
  if (g.composure <= 0) startSlip(state, g, ev);
}

function startSlip(state: DinnerState, g: GuestState, ev: SimEvent[]): void {
  g.composure = 0;
  g.slipTimer = state.tuning.slipSeconds;
  g.revealed = true;
  g.eyeing = null;
  state.stats.slips++;
  ev.push({ t: 'slip', guest: g.id, text: typeOf(g).slip });
  if (state.topic?.holder === g.id) dropTopic(state, ev, `${g.name} is… indisposed.`);
}

function resolveSlip(state: DinnerState, g: GuestState, world: SimWorld, r: Rng, ev: SimEvent[]): void {
  const tu = state.tuning;
  g.slipTimer = 0;
  g.composure = tu.slipRecoverTo;
  if (!state.room.lightsOn || world.isBlocking(g.id)) {
    state.stats.slipsHidden++;
    ev.push({ t: 'slipHidden', guest: g.id });
    return;
  }
  ev.push({ t: 'slipSeen', guest: g.id });
  for (const w of state.guests) {
    if (w.id !== g.id) hurt(state, w, tu.witnessDamage, 'witness', ['*stares*', '*drops their fork*'], r, ev);
    if (isOver(state)) return;
  }
  strike(state, `Everyone saw ${g.name}`, ev);
}

function strike(state: DinnerState, reason: string, ev: SimEvent[]): void {
  if (isOver(state)) return;
  state.strikes++;
  ev.push({ t: 'strike', strikes: state.strikes, reason });
  if (state.strikes >= state.tuning.maxStrikes) end(state, 'strikes', ev);
}

function changeCover(state: DinnerState, delta: number, reason: string, ev: SimEvent[]): void {
  if (isOver(state) || delta === 0) return;
  state.cover = Math.max(0, Math.min(100, state.cover + delta));
  ev.push({ t: 'cover', delta, reason });
  if (state.cover <= 0) end(state, 'exposed', ev);
}

// ---------------------------------------------------------------------------------------------
// Rumor Ledger

function breaksRule(state: DinnerState, check: RuleCheck, ev: SimEvent[]): boolean {
  let broke = false;
  for (const id of state.ledger) {
    if (ruleById(id).check !== check) continue;
    broke = true;
    state.stats.rulesBroken++;
    ev.push({ t: 'ruleBroken', rule: id });
    changeCover(state, -state.tuning.ruleBreakCost, `Broke your own rule: ${ruleById(id).rule}`, ev);
  }
  return broke;
}

function addRule(state: DinnerState, id: string, asker: GuestState, ev: SimEvent[]): void {
  if (state.ledger.includes(id)) return;
  state.ledger.push(id);
  state.stats.rulesAdded++;
  ev.push({ t: 'rule', rule: id });
  for (const other of ruleById(id).contradicts) {
    if (!state.ledger.includes(other)) continue;
    asker.suspicious = true;
    state.stats.contradictions++;
    ev.push({ t: 'contradiction', a: id, b: other, guest: asker.id });
    changeCover(state, -state.tuning.contradictionCost, `${asker.name} noticed a contradiction`, ev);
  }
}

function openQuestion(state: DinnerState, r: Rng, ev: SimEvent[]): void {
  const askers = state.guests.filter((g) => isAvailable(g) && g.eatingBeats === 0);
  if (askers.length === 0) return;
  const asker = r.pick(askers);
  const fresh = QUESTIONS.filter((q) => !state.recentQuestions.includes(q.id));
  const q = r.pick(fresh.length > 0 ? fresh : QUESTIONS);
  state.recentQuestions = [...state.recentQuestions, q.id].slice(-3);
  const lieIds = asker.suspicious ? r.shuffle(q.lies).slice(0, 2) : [...q.lies];
  const options: AnswerOption[] = [
    ...lieIds.map((rule): AnswerOption => ({ kind: 'lie', rule, text: ruleById(rule).claim })),
    { kind: 'truth', text: q.truth },
    { kind: 'deflect', text: '"Enough about me! Tell us about you."' },
  ];
  const seconds = asker.suspicious ? state.tuning.suspiciousQuestionSeconds : state.tuning.questionSeconds;
  state.question = { id: q.id, text: q.text, asker: asker.id, options, timer: seconds, total: seconds };
  ev.push({ t: 'question', guest: asker.id });
}

// ---------------------------------------------------------------------------------------------
// Player actions

export function act(state: DinnerState, action: Action, world: SimWorld): SimEvent[] {
  const ev: SimEvent[] = [];
  if (isOver(state)) return ev;
  const tu = state.tuning;
  const r = rngOn(state);
  const note = (text: string) => ev.push({ t: 'note', text });

  switch (action.type) {
    case 'smallTalk': {
      const topicId = state.hand[action.card];
      const g = state.guests[action.guest];
      if (!topicId) return note('That card is still coming back to you.'), ev;
      if (!g || !isAvailable(g)) return note("They can't talk right now."), ev;
      const def = topicById(topicId);
      if (def.tags.includes('pets')) breaksRule(state, 'talk_pets', ev);
      if (def.tags.includes('family')) breaksRule(state, 'talk_family', ev);
      if (isOver(state)) return ev;
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
      state.hand[action.card] = null;
      state.handCooldown[action.card] = tu.cardCooldown;
      state.stats.smallTalk++;
      ev.push({ t: 'topic', guest: g.id, kind: 'smallTalk', text: def.label });
      react(state, g, def.tags, r, ev);
      return ev;
    }

    case 'serve': {
      const g = state.guests[action.guest];
      const dish = dishById(action.dish);
      if ((state.dishCooldown[dish.id] ?? 0) > 0) return note(`${dish.label} isn't ready yet.`), ev;
      if (!g || !isAvailable(g)) return note("They're in no state to eat."), ev;
      state.dishCooldown[dish.id] = dish.prep;
      state.stats.servings++;
      ev.push({ t: 'served', guest: g.id, dish: dish.id, text: `You serve ${g.name} ${dish.label.toLowerCase()}.` });
      if (dish.tags.includes('garlic')) breaksRule(state, 'serve_garlic', ev);
      if (isOver(state)) return ev;
      g.addressedBeats = Math.max(g.addressedBeats, 1);

      const type = typeOf(g);
      const tags = dish.tags as readonly string[];
      let eating = false;
      if (tags.includes('nothing')) {
        if (type.servingReminds) {
          heal(g, tu.dishLikeBonus);
          tell(g, 'good', ['*smiles at the empty plate, very content*'], 'dish', r, ev);
        } else {
          hurt(state, g, 3, 'dish', ['*stares at the empty plate*'], r, ev);
          changeCover(state, -3, 'You served an empty plate', ev);
        }
      } else if (type.servingReminds) {
        hurt(state, g, tu.dishRemindDamage, 'dish', type.tells.dish, r, ev);
      } else if (type.hurtBy.some((t) => tags.includes(t))) {
        hurt(state, g, tu.dishHurtDamage, 'dish', type.tells.dish, r, ev);
      } else if (type.eats.some((t) => tags.includes(t))) {
        g.hunger = Math.max(0, g.hunger - tu.eatHungerDrop);
        heal(g, tu.dishLikeBonus);
        tell(g, 'good', type.tells.happy, 'dish', r, ev);
        eating = true;
      } else if (type.meh.some((t) => tags.includes(t))) {
        g.hunger = Math.max(0, g.hunger - tu.mehHungerDrop);
        tell(g, 'neutral', type.tells.dish, 'dish', r, ev);
        eating = true;
      } else {
        note(`${g.name} doesn't touch it.`);
      }
      if (eating) {
        g.eatingBeats = 1;
        g.eyeing = null;
        if (state.topic?.holder === g.id) dropTopic(state, ev, `${g.name} is busy eating.`);
      }
      return ev;
    }

    case 'toggle': {
      const room = state.room;
      if (action.what === 'curtains') {
        room.curtainsOpen = !room.curtainsOpen;
        ev.push({ t: 'room', what: 'curtains', on: room.curtainsOpen });
        if (room.curtainsOpen) breaksRule(state, 'open_curtains', ev);
      } else if (action.what === 'mirror') {
        room.mirrorCovered = !room.mirrorCovered;
        ev.push({ t: 'room', what: 'mirror', on: room.mirrorCovered });
        if (!room.mirrorCovered) breaksRule(state, 'uncover_mirror', ev);
      } else {
        room.lightsOn = !room.lightsOn;
        ev.push({ t: 'room', what: 'lights', on: room.lightsOn });
        if (room.lightsOn) breaksRule(state, 'lights_on', ev);
      }
      return ev;
    }

    case 'prop': {
      const prop = PROPS[action.prop as PropId];
      if (!prop) return note('Nothing interesting about that.'), ev;
      if (state.propsUsed.includes(action.prop)) {
        changeCover(state, -tu.propRepeatCost, 'You already showed them that', ev);
        return ev;
      }
      state.propsUsed.push(action.prop);
      const holder = state.topic ? guest(state, state.topic.holder) : pickStarter(state, r);
      if (!holder || !isAvailable(holder)) return note('Nobody is looking.'), ev;
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
      ev.push({ t: 'topic', guest: holder.id, kind: 'prop', text: prop.label });
      react(state, holder, prop.tags, r, ev);
      return ev;
    }

    case 'answer': {
      const q = state.question;
      const opt = q?.options[action.choice];
      if (!q || !opt) return ev;
      const asker = guest(state, q.asker);
      state.question = null;
      state.stats.questionsAnswered++;
      ev.push({ t: 'answered', kind: opt.kind, text: opt.text });
      if (opt.kind === 'lie') addRule(state, opt.rule, asker, ev);
      else if (opt.kind === 'truth') changeCover(state, -tu.truthCost, 'That sounded very human', ev);
      else changeCover(state, -tu.deflectCost, 'A clumsy dodge', ev);
      return ev;
    }

    case 'say': {
      const padded = ` ${action.text.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
      let anyoneHeard = false;
      for (const g of state.guests) {
        if (!isAvailable(g) || !world.canHear(g.id)) continue;
        anyoneHeard = true;
        const hit = typeOf(g).words.find((w) => padded.includes(` ${w} `));
        if (hit) {
          state.stats.wordsHeard++;
          hurt(state, g, tu.wordDamage, `word:${hit}`, typeOf(g).tells.word, r, ev);
          if (isOver(state)) return ev;
        }
      }
      const exposed = EXPOSURE_WORDS.find((w) => padded.includes(` ${w} `));
      if (anyoneHeard && exposed) changeCover(state, -tu.exposureWordCost, `"${exposed}"? Very human of you`, ev);
      return ev;
    }

    case 'reseat': {
      const g = state.guests[action.guest];
      if (!g || !isAvailable(g)) return note("They won't move right now."), ev;
      if (action.seat < 0 || action.seat >= state.seatCount || action.seat === g.seat) return ev;
      const other = guestAtSeat(state, action.seat);
      if (other && !isAvailable(other)) return note("That seat's occupant won't budge."), ev;
      const from = g.seat;
      g.seat = action.seat;
      if (other) other.seat = from;
      g.eyeing = null;
      if (other) other.eyeing = null;
      state.stats.reseats++;
      ev.push({ t: 'reseat', guest: g.id, seat: action.seat, swappedWith: other?.id ?? null });
      hurt(state, g, tu.reseatDamage, 'reseat', null, r, ev);
      if (other) hurt(state, other, tu.reseatDamage, 'reseat', null, r, ev);
      changeCover(state, -tu.reseatCost, '"Would you mind terribly switching seats?"', ev);
      return ev;
    }

    case 'showOut': {
      if (!state.room.neighborPresent) return note('Nobody to show out.'), ev;
      state.room.neighborPresent = false;
      ev.push({ t: 'neighbor', arrived: false, text: 'You steer Gary back out of the front door. "Lovely to see you!"' });
      changeCover(state, tu.neighborShownOutBonus, 'Gary is gone', ev);
      return ev;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Ending

const STAR_WORDS = ['Zero stars', 'One star', 'Two stars', 'Three stars', 'Four stars', 'Five stars'];

function end(state: DinnerState, outcome: DinnerResult['outcome'], ev: SimEvent[]): void {
  if (isOver(state)) return;
  state.phase = 'ended';
  state.question = null;
  const tu = state.tuning;
  const present = state.guests.filter(isPresent);
  const eaten = state.guests.filter((g) => g.eaten);
  const avgComposure = present.length > 0 ? present.reduce((s, g) => s + g.composure, 0) / present.length : 0;
  const fed = present.filter((g) => typeOf(g).hunger === 0 || g.hunger < 60).length;
  const coursesDone = outcome === 'survived' ? tu.courses : state.course;

  let tips = 0;
  let stars = 0;
  if (outcome !== 'exposed') {
    tips = Math.max(
      0,
      Math.round(
        coursesDone * 40 +
          (outcome === 'survived' ? 30 : 0) +
          avgComposure * 0.4 +
          fed * 8 -
          state.strikes * 25 -
          state.stats.rulesBroken * 5,
      ),
    );
    stars =
      outcome === 'strikes'
        ? 1
        : Math.max(
            1,
            5 -
              state.strikes -
              (state.cover < 40 ? 1 : 0) -
              (avgComposure < 40 ? 1 : 0) -
              (state.stats.rulesBroken > 2 ? 1 : 0),
          );
  }

  const lines: string[] = [];
  if (outcome === 'exposed') lines.push('Our hosts were HUMAN. We had to leave.');
  else if (outcome === 'strikes') lines.push('We made our excuses before dessert.');
  if (state.stats.servings === 0) lines.push('We were never fed.');
  else if (fed === present.length && present.length > 0) lines.push('Lovely food.');
  for (const g of eaten.slice(0, 2)) lines.push(`${g.name} was eaten.`);
  if (state.stats.contradictions > 0) lines.push('The hosts kept contradicting themselves.');
  if (state.stats.slipsHidden > 0 && eaten.length === 0) lines.push('Something odd happened with the lights.');
  if (lines.length === 0) lines.push('A perfectly normal evening.');
  lines.push(`${STAR_WORDS[stars]}.`);

  state.result = { outcome, tips, stars, review: lines.join(' ') };
  ev.push({ t: 'ended', result: state.result });
}

function drawCard(state: DinnerState, r: Rng): string {
  const held = new Set(state.hand.filter((x): x is string => x !== null));
  const options = TOPICS.filter((t) => !held.has(t.id));
  return r.pick(options.length > 0 ? options : TOPICS).id;
}
