import { describe, expect, it } from 'vitest';
import { DISHES } from '../content/dishes.ts';
import { GUEST_TYPES, type GuestTypeId } from '../content/guests.ts';
import type { TopicTag } from '../content/topics.ts';
import { act, addPlayer, createDinner, eatsDish, guestAtSeat, neighbors, predictNext, speechVocabulary, step } from './dinner.ts';
import { OPEN_WORLD, type Action, type DinnerState, type SimEvent, type SimWorld } from './types.ts';

const P = 'solo';

const QUIET = {
  // Nothing happens on its own: lets a test poke one rule at a time.
  hungerPerSec: 0,
  moonDamagePerBeat: 0,
  moonDamageGrowth: 0,
  mirrorDamagePerBeat: 0,
  ignoredDamagePerBeat: 0,
  darkDamagePerBeat: 0,
  thresholdDamagePerBeat: 0,
  questionEveryBeatsMin: 999,
  questionEveryBeatsMax: 999,
  coverRecoveryPerSec: 0,
  composureRecoveryPerSec: 0,
};

const world = (over: Partial<SimWorld>): SimWorld => ({ ...OPEN_WORLD, ...over });

/** A dinner already in its first course with exactly these guests seated. */
function dinner(guests: [GuestTypeId, number][], tuning: object = QUIET): DinnerState {
  const s = createDinner({ seed: 'TEST', seatCount: 6, tuning, quickStart: true });
  const template = s.guests[0]!;
  s.guests = guests.map(([type, seat], id) => ({ ...template, id, type, seat, where: 'seated', name: `G${id}`, composure: 80, hunger: 0 }));
  s.ledger = [];
  s.schedule = [];
  s.topic = null;
  return s;
}

function setTopic(s: DinnerState, holder: number, tags: TopicTag[], previous: number | null = null) {
  s.topic = { id: 't', label: 'test', tags, holder, previous, age: 0, life: 99 };
}

/** Steps until the next beat has happened. */
function nextBeat(s: DinnerState, w: SimWorld = OPEN_WORLD): SimEvent[] {
  const target = s.beat + 1;
  const ev: SimEvent[] = [];
  while (s.beat < target && s.phase !== 'ended') ev.push(...step(s, 0.1, w));
  return ev;
}

function run(s: DinnerState, seconds: number, w: SimWorld = OPEN_WORLD): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let t = 0; t < seconds && s.phase !== 'ended'; t += 0.1) ev.push(...step(s, 0.1, w));
  return ev;
}

const say = (s: DinnerState, text: string, w: SimWorld = OPEN_WORLD) => act(s, { type: 'say', by: P, text }, w);

describe('setup', () => {
  it('rolls 4 disguised guests, at most two of a type, waiting outside', () => {
    for (const seed of ['A', 'B', 'C', 'MOON-7F3K', 'xyz']) {
      const s = createDinner({ seed, seatCount: 6 });
      expect(s.guests).toHaveLength(4);
      expect(s.phase).toBe('booking');
      expect(s.guests.every((g) => g.where === 'outside' && g.seat === -1)).toBe(true);
      for (const type of ['werewolf', 'vampire', 'ghost']) {
        expect(s.guests.filter((g) => g.type === type).length).toBeLessThanOrEqual(2);
      }
      expect(s.ledger).toHaveLength(1);
      expect(s.players[0]!.hand.every((c) => c !== null)).toBe(true);
    }
  });

  it('is fully determined by the seed', () => {
    expect(JSON.stringify(createDinner({ seed: 'S1', seatCount: 6 }))).toBe(JSON.stringify(createDinner({ seed: 'S1', seatCount: 6 })));
    expect(JSON.stringify(createDinner({ seed: 'S1', seatCount: 6 }))).not.toBe(JSON.stringify(createDinner({ seed: 'S2', seatCount: 6 })));
  });

  it('every course has something each hungry type at the table will eat (or the cellar does)', () => {
    const wine = DISHES.filter((d) => d.course === 'any');
    for (let i = 0; i < 200; i++) {
      const s = createDinner({ seed: `MENU${i}`, seatCount: 8, tuning: { guests: 6 } });
      expect(s.menu).toHaveLength(s.tuning.courses);
      for (const course of s.menu) {
        const dishes = course.map((id) => DISHES.find((d) => d.id === id)!);
        for (const g of s.guests) {
          if (GUEST_TYPES[g.type].eats.length === 0) continue;
          expect([...dishes, ...wine].some((d) => eatsDish(g.type, d)), `${s.seed} ${g.type} ${course.join(',')}`).toBe(true);
        }
      }
    }
  });

  it('more players make beats faster and guests hungrier; relaxed makes it gentler', () => {
    const one = createDinner({ seed: 'X', seatCount: 6 });
    const four = createDinner({ seed: 'X', seatCount: 6, players: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id })) });
    const relaxed = createDinner({ seed: 'X', seatCount: 6, relaxed: true });
    expect(four.tuning.beatSeconds).toBeLessThan(one.tuning.beatSeconds);
    expect(four.tuning.hungerPerSec).toBeGreaterThan(one.tuning.hungerPerSec);
    expect(four.players.map((p) => p.hand.length)).toEqual([3, 3, 3, 3]);
    expect(relaxed.tuning.questionSeconds).toBeGreaterThan(one.tuning.questionSeconds);
  });

  it('speech vocabulary covers trigger words, exposure words and invites', () => {
    const v = speechVocabulary();
    for (const w of ['moon', 'garlic', 'dead', 'mortgage', 'come in']) expect(v).toContain(w);
  });
});

describe('arrivals', () => {
  const fresh = (tuning: object = {}) => {
    const s = createDinner({ seed: 'ARRIVE', seatCount: 6, tuning: { ...QUIET, ...tuning } });
    act(s, { type: 'skip', by: P }, OPEN_WORLD); // booking → prep
    act(s, { type: 'skip', by: P }, OPEN_WORLD); // prep → arrivals
    expect(s.phase).toBe('arrivals');
    return s;
  };
  const first = (s: DinnerState) => s.guests.slice().sort((a, b) => a.arriveAt - b.arriveAt)[0]!;

  it('the doorbell rings, a greeted guest walks in, and a host shows them to a seat', () => {
    const s = fresh();
    const g = first(s);
    g.type = 'werewolf';
    const ev = run(s, g.arriveAt + 0.2);
    expect(ev.some((e) => e.t === 'doorbell' && e.guest === g.id)).toBe(true);
    expect(g.where).toBe('door');
    act(s, { type: 'greet', by: P, guest: g.id }, OPEN_WORLD);
    run(s, 0.2);
    expect(g.where).toBe('entering');
    run(s, s.tuning.walkInSeconds);
    expect(g.where).toBe('standing');
    act(s, { type: 'reseat', by: P, guest: g.id, seat: 4 }, OPEN_WORLD);
    expect(g.where).toBe('seated');
    expect(guestAtSeat(s, 4)?.id).toBe(g.id);
    expect(s.players[0]!.stats.greeted).toBe(1);
  });

  it('a vampire waits at the threshold until invited, by button or by saying "come in"', () => {
    const s = fresh({ thresholdDamagePerBeat: 6 });
    const g = first(s);
    g.type = 'vampire';
    run(s, g.arriveAt + 0.2);
    const ev = act(s, { type: 'greet', by: P, guest: g.id }, OPEN_WORLD);
    expect(ev.some((e) => e.t === 'threshold')).toBe(true);
    run(s, s.tuning.doorPatience + 5);
    expect(g.where).toBe('door'); // vampires never let themselves in
    expect(g.composure).toBeLessThan(s.tuning.composureStart);
    say(s, 'oh do come in!', world({ canHear: (id) => id === g.id }));
    run(s, 0.2);
    expect(g.where).toBe('entering');
  });

  it('a guest left on the doorstep lets themselves in, and that costs cover', () => {
    const s = fresh();
    const g = first(s);
    g.type = 'ghost';
    run(s, g.arriveAt + s.tuning.doorPatience + 0.5);
    expect(g.where).toBe('entering');
    expect(s.cover).toBe(s.tuning.coverStart - s.tuning.doorLeftCost);
  });

  it('greeting with "never opens a door" on the ledger breaks the rule', () => {
    const s = fresh();
    s.ledger = ['no_doors'];
    const g = first(s);
    run(s, g.arriveAt + 0.2);
    const ev = act(s, { type: 'greet', by: P, guest: g.id }, OPEN_WORLD);
    expect(ev.some((e) => e.t === 'ruleBroken' && e.rule === 'no_doors')).toBe(true);
  });

  it('standing guests seat themselves, and the first course starts once everyone is seated', () => {
    const s = fresh();
    const ev = run(s, s.tuning.arrivalsMaxSeconds + 1);
    expect(s.phase).toBe('course');
    expect(s.guests.every((g) => g.where === 'seated')).toBe(true);
    expect(new Set(s.guests.map((g) => g.seat)).size).toBe(s.guests.length);
    expect(ev.some((e) => e.t === 'phase' && e.phase === 'course')).toBe(true);
    expect(s.dinnerStart).not.toBeNull();
  });
});

describe('topic passing', () => {
  // Seats 0..5 clockwise. A=werewolf@0, B=ghost@1, C=werewolf@3, D=vampire@4.
  const table = (): DinnerState =>
    dinner([
      ['werewolf', 0],
      ['ghost', 1],
      ['werewolf', 3],
      ['vampire', 4],
    ]);

  it('finds neighbors across empty seats', () => {
    const s = table();
    expect(neighbors(s, s.guests[0]!).map((g) => g.id)).toEqual([1, 3]);
  });

  it('prefers guests who like the tags, plus seat neighbors', () => {
    const s = table();
    setTopic(s, 0, ['family']);
    expect(predictNext(s)).toBe(1);
  });

  it('avoids handing the topic straight back', () => {
    const s = table();
    setTopic(s, 0, ['family'], 1);
    expect(predictNext(s)).toBe(2);
  });

  it('skips a vampire nobody has addressed, until someone does', () => {
    const s = table();
    setTopic(s, 0, ['night']);
    expect(predictNext(s)).toBe(1);
    s.guests[3]!.addressedBeats = 2;
    expect(predictNext(s)).toBe(3);
  });

  it('breaks ties clockwise from the holder', () => {
    const s = table();
    s.guests[3]!.addressedBeats = 2;
    setTopic(s, 0, ['romance']);
    expect(predictNext(s)).toBe(1);
  });

  it('passes on the beat and hurts a guest whose trigger it lands on', () => {
    const s = table();
    setTopic(s, 1, ['pets', 'family']);
    expect(predictNext(s)).toBe(2);
    const ev = nextBeat(s);
    expect(s.topic?.holder).toBe(2);
    expect(s.guests[2]!.composure).toBe(80 - s.tuning.topicTriggerDamage);
    expect(ev.some((e) => e.t === 'tell' && e.guest === 2 && e.mood === 'bad')).toBe(true);
  });
});

describe('slips and strikes', () => {
  const pair = () =>
    dinner([
      ['werewolf', 0],
      ['ghost', 2],
    ]);

  it('a slip another guest sees is a strike and rattles the witness', () => {
    const s = pair();
    s.guests[0]!.composure = 5;
    say(s, 'what a lovely full moon');
    expect(s.guests[0]!.slipTimer).toBeGreaterThan(0);
    const ev = run(s, s.tuning.slipSeconds + 0.2);
    expect(ev.some((e) => e.t === 'slipSeen')).toBe(true);
    expect(s.strikes).toBe(1);
    expect(s.guests[1]!.composure).toBeLessThan(80);
  });

  it('nobody with a line of sight means it stays hidden, and the blocker gets the credit', () => {
    const s = pair();
    s.guests[0]!.composure = 1;
    say(s, 'moon');
    const ev = run(s, s.tuning.slipSeconds + 0.2, world({ sees: () => false, blocker: () => P }));
    expect(ev.some((e) => e.t === 'slipHidden' && e.by === P)).toBe(true);
    expect(s.strikes).toBe(0);
    expect(s.guests[0]!.composure).toBe(s.tuning.slipRecoverTo);
    expect(s.players[0]!.stats.coveredSlips).toBe(1);
  });

  it('lights off hides a slip too', () => {
    const s = pair();
    act(s, { type: 'toggle', by: P, what: 'lights' }, OPEN_WORLD);
    s.guests[0]!.composure = 1;
    say(s, 'dog');
    run(s, s.tuning.slipSeconds + 0.2);
    expect(s.strikes).toBe(0);
  });

  it('Gary seeing a slip is a strike even if no guest does', () => {
    const s = pair();
    s.room.neighborPresent = true;
    s.room.neighborTimer = 999;
    s.guests[0]!.composure = 1;
    say(s, 'moon');
    const ev = run(s, s.tuning.slipSeconds + 0.2, world({ sees: (viewer) => viewer === 'neighbor' }));
    expect(ev.some((e) => e.t === 'slipSeen' && e.witness === 'neighbor')).toBe(true);
    expect(s.strikes).toBe(1);
  });

  it('three strikes ends the dinner', () => {
    const s = pair();
    for (let i = 0; i < 3 && s.phase !== 'ended'; i++) {
      s.guests[0]!.composure = 1;
      say(s, 'moon');
      run(s, s.tuning.slipSeconds + 0.2);
    }
    expect(s.phase).toBe('ended');
    expect(s.result?.outcome).toBe('strikes');
  });
});

describe('hunger', () => {
  it('a starving guest eyes a neighbor, then eats them', () => {
    const s = dinner([
      ['werewolf', 0],
      ['ghost', 1],
    ]);
    s.guests[0]!.hunger = 100;
    const first = nextBeat(s);
    expect(first.some((e) => e.t === 'eyeing' && e.guest === 0 && e.target === 1)).toBe(true);
    const all: SimEvent[] = [];
    for (let i = 0; i < s.tuning.eyeingBeats; i++) all.push(...nextBeat(s));
    expect(all.some((e) => e.t === 'eaten' && e.guest === 1)).toBe(true);
    expect(s.guests[1]!.eaten).toBe(true);
    expect(s.strikes).toBe(1);
  });

  it('feeding them in time calls it off', () => {
    const s = dinner([
      ['werewolf', 0],
      ['ghost', 1],
    ]);
    s.guests[0]!.hunger = 100;
    nextBeat(s);
    act(s, { type: 'serve', by: P, guest: 0, dish: 'tartare' }, OPEN_WORLD);
    expect(s.guests[0]!.hunger).toBeLessThan(100);
    expect(s.guests[0]!.eyeing).toBeNull();
    for (let i = 0; i < 3; i++) nextBeat(s);
    expect(s.guests[1]!.eaten).toBe(false);
  });
});

describe('serving', () => {
  it('garlic hurts a vampire, and breaks the garlic rule when seen', () => {
    const s = dinner([['vampire', 0]]);
    s.ledger = ['no_garlic'];
    const ev = act(s, { type: 'serve', by: P, guest: 0, dish: 'garlic_bread' }, OPEN_WORLD);
    expect(s.guests[0]!.composure).toBeLessThan(80);
    expect(ev.some((e) => e.t === 'ruleBroken' && e.rule === 'no_garlic')).toBe(true);
    expect(s.cover).toBe(s.tuning.coverStart - s.tuning.ruleBreakCost);
  });

  it('a ghost served real food is reminded; an empty plate is perfect', () => {
    const s = dinner([['ghost', 0]]);
    act(s, { type: 'serve', by: P, guest: 0, dish: 'salad' }, OPEN_WORLD);
    expect(s.guests[0]!.composure).toBe(80 - s.tuning.dishRemindDamage);
    act(s, { type: 'serve', by: P, guest: 0, dish: 'empty_plate' }, OPEN_WORLD);
    expect(s.guests[0]!.composure).toBe(80 - s.tuning.dishRemindDamage + s.tuning.dishLikeBonus);
  });

  it('burnt food still feeds, but less, and it shows', () => {
    const s = dinner([['werewolf', 0]]);
    s.guests[0]!.hunger = 90;
    act(s, { type: 'serve', by: P, guest: 0, dish: 'steak', burnt: true }, OPEN_WORLD);
    expect(s.guests[0]!.hunger).toBe(90 - s.tuning.burntHungerDrop);
    expect(s.guests[0]!.composure).toBe(80 - s.tuning.burntDishComposure);
  });

  it('serving the guest who holds the topic interrupts it', () => {
    const s = dinner([
      ['werewolf', 0],
      ['ghost', 2],
    ]);
    setTopic(s, 0, ['food']);
    const ev = act(s, { type: 'serve', by: P, guest: 0, dish: 'tartare' }, OPEN_WORLD);
    expect(s.topic).toBeNull();
    expect(s.nextStarter).toBe(1);
    expect(ev.some((e) => e.t === 'topicDropped')).toBe(true);
    expect(s.players[0]!.stats.served).toBe(1);
  });
});

describe('rumor ledger', () => {
  function ask(s: DinnerState, questionLies: string[], target = P) {
    s.question = {
      id: 'q',
      text: '?',
      asker: 0,
      target,
      options: questionLies.map((rule) => ({ kind: 'lie' as const, rule, text: rule })),
      timer: 9,
      total: 9,
    };
  }

  it('a lie becomes a rule, and breaking it where a guest can see costs cover', () => {
    const s = dinner([['werewolf', 0]]);
    act(s, { type: 'toggle', by: P, what: 'curtains' }, OPEN_WORLD);
    ask(s, ['sleep_days']);
    act(s, { type: 'answer', by: P, choice: 0 }, OPEN_WORLD);
    expect(s.ledger).toEqual(['sleep_days']);
    expect(s.players[0]!.stats.lies).toBe(1);
    const unseen = act(s, { type: 'toggle', by: P, what: 'curtains' }, world({ seenBy: () => false }));
    expect(unseen.some((e) => e.t === 'ruleBroken')).toBe(false);
    act(s, { type: 'toggle', by: P, what: 'curtains' }, OPEN_WORLD); // closed again: fine
    const ev = act(s, { type: 'toggle', by: P, what: 'curtains' }, OPEN_WORLD); // opened in view
    expect(ev.some((e) => e.t === 'ruleBroken')).toBe(true);
    expect(s.cover).toBe(s.tuning.coverStart - s.tuning.ruleBreakCost);
  });

  it('only the host who was asked can answer', () => {
    const s = dinner([['ghost', 0]]);
    addPlayer(s, 'other', 'Bo');
    ask(s, ['sleep_days'], 'other');
    const ev = act(s, { type: 'answer', by: P, choice: 0 }, OPEN_WORLD);
    expect(s.question).not.toBeNull();
    expect(ev.some((e) => e.t === 'note' && e.to === P)).toBe(true);
    act(s, { type: 'answer', by: 'other', choice: 0 }, OPEN_WORLD);
    expect(s.ledger).toEqual(['sleep_days']);
  });

  it('contradicting yourself makes the asker suspicious', () => {
    const s = dinner([['ghost', 0]]);
    ask(s, ['sleep_days']);
    act(s, { type: 'answer', by: P, choice: 0 }, OPEN_WORLD);
    ask(s, ['love_brunch']);
    const ev = act(s, { type: 'answer', by: P, choice: 0 }, OPEN_WORLD);
    expect(ev.some((e) => e.t === 'contradiction')).toBe(true);
    expect(s.guests[0]!.suspicious).toBe(true);
    expect(s.cover).toBe(s.tuning.coverStart - s.tuning.contradictionCost);
  });

  it('leaving a question unanswered costs cover', () => {
    const s = dinner([['ghost', 0]]);
    ask(s, ['sleep_days']);
    run(s, 9.5);
    expect(s.question).toBeNull();
    expect(s.cover).toBe(s.tuning.coverStart - s.tuning.silenceCost);
  });

  it('guests only ask hosts in earshot; an empty table costs cover instead', () => {
    const s = dinner([['ghost', 0]], { ...QUIET, questionEveryBeatsMin: 1, questionEveryBeatsMax: 1 });
    s.questionInBeats = 1;
    const ev = nextBeat(s, world({ canHear: () => false }));
    expect(s.question).toBeNull();
    expect(ev.some((e) => e.t === 'cover' && e.delta === -s.tuning.emptyTableCost)).toBe(true);
    s.questionInBeats = 1;
    nextBeat(s);
    expect(s.question?.target).toBe(P);
  });

  it('small talk about pets breaks "we can\'t stand dogs"', () => {
    const s = dinner([['ghost', 0]]);
    s.ledger = ['hate_dogs'];
    s.players[0]!.hand[0] = 'pets';
    const ev = act(s, { type: 'smallTalk', by: P, guest: 0, card: 0 }, OPEN_WORLD);
    expect(ev.some((e) => e.t === 'ruleBroken' && e.rule === 'hate_dogs')).toBe(true);
    expect(s.players[0]!.hand[0]).toBeNull();
  });

  it('each host has their own hand', () => {
    const s = dinner([['ghost', 0]]);
    const bo = addPlayer(s, 'bo', 'Bo');
    act(s, { type: 'smallTalk', by: P, guest: 0, card: 1 }, OPEN_WORLD);
    expect(s.players[0]!.hand[1]).toBeNull();
    expect(bo.hand[1]).not.toBeNull();
  });
});

describe('trigger words', () => {
  it('only guests in earshot of the speaker react', () => {
    const s = dinner([
      ['werewolf', 0],
      ['werewolf', 3],
    ]);
    say(s, 'I walked the DOG!', world({ canHear: (id) => id === 0 }));
    expect(s.guests[0]!.composure).toBe(80 - s.tuning.wordDamage);
    expect(s.guests[1]!.composure).toBe(80);
    expect(s.players[0]!.stats.wordsLanded).toBe(1);
  });

  it('matches whole words only', () => {
    const s = dinner([['werewolf', 0]]);
    say(s, 'dogmatic honeymoon');
    expect(s.guests[0]!.composure).toBe(80);
  });

  it('human-sounding words cost cover when a guest can hear', () => {
    const s = dinner([['ghost', 0]]);
    say(s, 'ugh, my mortgage', world({ canHear: () => false }));
    expect(s.cover).toBe(s.tuning.coverStart);
    say(s, 'ugh, my mortgage');
    expect(s.cover).toBe(s.tuning.coverStart - s.tuning.exposureWordCost);
  });
});

describe('room', () => {
  it('the moon through open curtains hurts a werewolf more every beat', () => {
    const s = dinner([['werewolf', 0]], { ...QUIET, moonDamagePerBeat: 5, moonDamageGrowth: 5 });
    s.room.moonUp = true;
    nextBeat(s);
    expect(s.guests[0]!.composure).toBeCloseTo(80 - 5, 0);
    nextBeat(s);
    expect(s.guests[0]!.composure).toBeCloseTo(80 - 5 - 10, 0);
    act(s, { type: 'toggle', by: P, what: 'curtains' }, OPEN_WORLD);
    const before = s.guests[0]!.composure;
    nextBeat(s);
    expect(s.guests[0]!.composure).toBeGreaterThanOrEqual(before);
  });

  it('music calms the table, and breaks "can\'t abide music" when seen', () => {
    const s = dinner([['ghost', 0]], { ...QUIET, composureRecoveryPerSec: 1 });
    s.ledger = ['no_music'];
    const ev = act(s, { type: 'toggle', by: P, what: 'music' }, OPEN_WORLD);
    expect(s.room.musicOn).toBe(true);
    expect(ev.some((e) => e.t === 'ruleBroken' && e.rule === 'no_music')).toBe(true);
    s.guests[0]!.composure = 50;
    run(s, 1);
    expect(s.guests[0]!.composure).toBeCloseTo(51.5, 0);
  });

  it('swapping seats moves both guests', () => {
    const s = dinner([
      ['werewolf', 0],
      ['ghost', 3],
    ]);
    act(s, { type: 'reseat', by: P, guest: 0, seat: 3 }, OPEN_WORLD);
    expect(s.guests[0]!.seat).toBe(3);
    expect(s.guests[1]!.seat).toBe(0);
    act(s, { type: 'reseat', by: P, guest: 0, seat: 5 }, OPEN_WORLD);
    expect(s.guests[0]!.seat).toBe(5);
  });

  it('holding up a prop only works where the table can see it, and only once', () => {
    const s = dinner([['ghost', 0]]);
    setTopic(s, 0, ['childhood']);
    const hidden = act(s, { type: 'prop', by: P, prop: 'painting' }, world({ seenBy: () => false }));
    expect(hidden.some((e) => e.t === 'note')).toBe(true);
    act(s, { type: 'prop', by: P, prop: 'painting' }, OPEN_WORLD);
    expect(s.topic?.id).toBe('prop_painting');
    act(s, { type: 'prop', by: P, prop: 'painting' }, OPEN_WORLD);
    expect(s.cover).toBe(s.tuning.coverStart - s.tuning.propRepeatCost);
  });
});

describe('the chase', () => {
  it('cover hitting zero starts a chase; escapees keep the tips', () => {
    const s = dinner([['ghost', 0]]);
    addPlayer(s, 'bo', 'Bo');
    for (let i = 0; i < 10 && s.phase === 'course'; i++) say(s, 'taxes');
    expect(s.phase).toBe('chase');
    expect(s.guests[0]!.revealed).toBe(true);
    expect(s.chaseTips).toBeGreaterThan(0);
    act(s, { type: 'escaped', player: P }, OPEN_WORLD);
    expect(s.phase).toBe('chase');
    act(s, { type: 'caught', player: 'bo' }, OPEN_WORLD);
    expect(s.result?.outcome).toBe('exposed');
    expect(s.result?.tips).toBe(s.chaseTips);
    const titles = s.result!.awards.map((a) => `${a.player}:${a.title}`);
    expect(titles).toContain('bo:Snack');
    expect(titles).toContain(`${P}:Getaway Driver`);
  });

  it('nobody escaping before the clock runs out scores nothing', () => {
    const s = dinner([['ghost', 0]]);
    for (let i = 0; i < 10 && s.phase === 'course'; i++) say(s, 'taxes');
    run(s, s.tuning.chaseSeconds + 1);
    expect(s.result?.outcome).toBe('exposed');
    expect(s.result?.tips).toBe(0);
    expect(s.players[0]!.caught).toBe(true);
  });
});

describe('a whole dinner', () => {
  it('runs through three courses and dessert to a result, with awards for everyone', () => {
    const s = dinner(
      [
        ['werewolf', 0],
        ['ghost', 2],
        ['vampire', 4],
      ],
      { ...QUIET, topicTriggerDamage: 0 },
    );
    addPlayer(s, 'bo', 'Bo');
    const phases: string[] = [];
    const ev = run(s, 700);
    for (const e of ev) if (e.t === 'phase') phases.push(`${e.phase}${e.course}`);
    expect(phases).toEqual(['course1', 'course2', 'dessert2']);
    expect(s.result?.outcome).toBe('survived');
    expect(s.result?.stars).toBeGreaterThanOrEqual(1);
    expect(new Set(s.result!.awards.map((a) => a.player))).toEqual(new Set([P, 'bo']));
  });

  /** A bot host: answers the door, invites, seats, chats, feeds and answers. */
  function bot(s: DinnerState, i: number): Action[] {
    const out: Action[] = [];
    if (s.phase === 'booking' || s.phase === 'prep') out.push({ type: 'skip', by: P });
    for (const g of s.guests) {
      if (g.where === 'door') out.push({ type: g.greeted ? 'invite' : 'greet', by: P, guest: g.id });
      if (g.where === 'standing' && i % 30 === 0) {
        const free = [...Array(s.seatCount).keys()].find((seat) => !guestAtSeat(s, seat));
        if (free !== undefined) out.push({ type: 'reseat', by: P, guest: g.id, seat: free });
      }
    }
    if (s.phase === 'course' || s.phase === 'dessert') {
      if (i % 60 === 0) out.push({ type: 'smallTalk', by: P, guest: i % 4, card: i % 3 });
      if (i % 90 === 0) out.push({ type: 'serve', by: P, guest: (i / 90) % 4, dish: ['tartare', 'red_wine', 'empty_plate'][i % 3]! });
      if (s.question && i % 20 === 0) out.push({ type: 'answer', by: P, choice: i % 4 });
      if (i % 400 === 0) out.push({ type: 'toggle', by: P, what: 'curtains' });
    }
    return out;
  }

  it('replays identically from the same seed and actions', () => {
    const play = () => {
      const s = createDinner({ seed: 'REPLAY', seatCount: 6 });
      const log: SimEvent[] = [];
      for (let i = 0; i < 9000 && s.phase !== 'ended'; i++) {
        log.push(...step(s, 0.1, OPEN_WORLD));
        for (const a of bot(s, i)) log.push(...act(s, a, OPEN_WORLD));
      }
      return JSON.stringify({ s, log });
    };
    expect(play()).toBe(play());
  });

  it('never crashes or stalls across many seeds with a clumsy bot', () => {
    for (let seed = 0; seed < 40; seed++) {
      const s = createDinner({ seed: `BOT${seed}`, seatCount: 6 });
      for (let i = 0; i < 9500 && s.phase !== 'ended'; i++) {
        step(s, 0.1, OPEN_WORLD);
        for (const a of bot(s, i)) act(s, a, OPEN_WORLD);
        if (s.phase === 'chase' && i % 50 === 0) act(s, { type: 'escaped', player: P }, OPEN_WORLD);
      }
      expect(s.phase, `seed BOT${seed}`).toBe('ended');
      expect(s.result).not.toBeNull();
    }
  });
});
