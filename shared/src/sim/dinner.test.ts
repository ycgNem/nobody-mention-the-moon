import { describe, expect, it } from 'vitest';
import type { GuestTypeId } from '../content/guests.ts';
import type { TopicTag } from '../content/topics.ts';
import { act, createDinner, neighbors, predictNext, step } from './dinner.ts';
import { OPEN_WORLD, type DinnerState, type SimEvent, type SimWorld } from './types.ts';

const QUIET = {
  // Nothing happens on its own: lets a test poke one rule at a time.
  hungerPerSec: 0,
  moonDamagePerBeat: 0,
  moonDamageGrowth: 0,
  mirrorDamagePerBeat: 0,
  ignoredDamagePerBeat: 0,
  darkDamagePerBeat: 0,
  questionEveryBeatsMin: 999,
  questionEveryBeatsMax: 999,
  coverRecoveryPerSec: 0,
  composureRecoveryPerSec: 0,
};

function dinner(guests: [GuestTypeId, number][], tuning: object = QUIET): DinnerState {
  const s = createDinner({ seed: 'TEST', seatCount: 6, tuning });
  const template = s.guests[0]!;
  s.guests = guests.map(([type, seat], id) => ({ ...template, id, type, seat, name: `G${id}`, composure: 80, hunger: 0 }));
  s.ledger = [];
  s.schedule = [];
  s.topic = null;
  return s;
}

function setTopic(s: DinnerState, holder: number, tags: TopicTag[], previous: number | null = null) {
  s.topic = { id: 't', label: 'test', tags, holder, previous, age: 0, life: 99 };
}

/** Steps until the next beat has happened. */
function nextBeat(s: DinnerState, world: SimWorld = OPEN_WORLD): SimEvent[] {
  const target = s.beat + 1;
  const ev: SimEvent[] = [];
  while (s.beat < target && s.phase !== 'ended') ev.push(...step(s, 0.1, world));
  return ev;
}

function run(s: DinnerState, seconds: number, world: SimWorld = OPEN_WORLD): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let t = 0; t < seconds && s.phase !== 'ended'; t += 0.1) ev.push(...step(s, 0.1, world));
  return ev;
}

describe('setup', () => {
  it('seats 4 guests on distinct seats with at most two of a type', () => {
    for (const seed of ['A', 'B', 'C', 'MOON-7F3K', 'xyz']) {
      const s = createDinner({ seed, seatCount: 6 });
      expect(s.guests).toHaveLength(4);
      expect(new Set(s.guests.map((g) => g.seat)).size).toBe(4);
      for (const type of ['werewolf', 'vampire', 'ghost']) {
        expect(s.guests.filter((g) => g.type === type).length).toBeLessThanOrEqual(2);
      }
      expect(s.ledger).toHaveLength(1);
      expect(s.hand.every((c) => c !== null)).toBe(true);
    }
  });

  it('is fully determined by the seed', () => {
    expect(JSON.stringify(createDinner({ seed: 'S1', seatCount: 6 }))).toBe(
      JSON.stringify(createDinner({ seed: 'S1', seatCount: 6 })),
    );
    expect(JSON.stringify(createDinner({ seed: 'S1', seatCount: 6 }))).not.toBe(
      JSON.stringify(createDinner({ seed: 'S2', seatCount: 6 })),
    );
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
    // B: likes family (2) + neighbor (1.5) beats C: likes family (2).
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
    // Werewolf C doesn't like night; vampire D does but hasn't been addressed.
    expect(predictNext(s)).toBe(1); // neighbor wins
    s.guests[3]!.addressedBeats = 2;
    expect(predictNext(s)).toBe(3);
  });

  it('breaks ties clockwise from the holder', () => {
    const s = table();
    s.guests[3]!.addressedBeats = 2;
    setTopic(s, 0, ['romance']);
    // Ghost B (romance + neighbor) and vampire D (romance + neighbor) tie; B is 1 seat clockwise.
    expect(predictNext(s)).toBe(1);
  });

  it('passes on the beat and hurts a guest whose trigger it lands on', () => {
    const s = table();
    // Ghost B holds. Both werewolves neighbor B and like family: a tie, so clockwise wins (C).
    setTopic(s, 1, ['pets', 'family']);
    expect(predictNext(s)).toBe(2);
    const ev = nextBeat(s);
    expect(s.topic?.holder).toBe(2);
    expect(s.guests[2]!.composure).toBe(80 - s.tuning.topicTriggerDamage);
    expect(ev.some((e) => e.t === 'tell' && e.guest === 2 && e.mood === 'bad')).toBe(true);
  });
});

describe('slips and strikes', () => {
  it('a slip everyone sees is a strike and rattles the witnesses', () => {
    const s = dinner([
      ['werewolf', 0],
      ['ghost', 2],
    ]);
    s.guests[0]!.composure = 5;
    act(s, { type: 'say', text: 'what a lovely full moon' }, OPEN_WORLD);
    expect(s.guests[0]!.slipTimer).toBeGreaterThan(0);
    const ev = run(s, s.tuning.slipSeconds + 0.2);
    expect(ev.some((e) => e.t === 'slipSeen')).toBe(true);
    expect(s.strikes).toBe(1);
    expect(s.guests[1]!.composure).toBeLessThan(80);
  });

  it('a player standing in the way hides the slip', () => {
    const s = dinner([
      ['werewolf', 0],
      ['ghost', 2],
    ]);
    s.guests[0]!.composure = 1;
    act(s, { type: 'say', text: 'moon' }, OPEN_WORLD);
    const blocking: SimWorld = { canHear: () => true, isBlocking: (id) => id === 0 };
    const ev = run(s, s.tuning.slipSeconds + 0.2, blocking);
    expect(ev.some((e) => e.t === 'slipHidden')).toBe(true);
    expect(s.strikes).toBe(0);
    expect(s.guests[0]!.composure).toBe(s.tuning.slipRecoverTo);
  });

  it('lights off hides a slip too', () => {
    const s = dinner([
      ['werewolf', 0],
      ['ghost', 2],
    ]);
    act(s, { type: 'toggle', what: 'lights' }, OPEN_WORLD);
    s.guests[0]!.composure = 1;
    act(s, { type: 'say', text: 'dog' }, OPEN_WORLD);
    run(s, s.tuning.slipSeconds + 0.2);
    expect(s.strikes).toBe(0);
  });

  it('three strikes ends the dinner', () => {
    const s = dinner([
      ['werewolf', 0],
      ['ghost', 2],
    ]);
    for (let i = 0; i < 3 && s.phase !== 'ended'; i++) {
      s.guests[0]!.composure = 1;
      act(s, { type: 'say', text: 'moon' }, OPEN_WORLD);
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
    act(s, { type: 'serve', guest: 0, dish: 'tartare' }, OPEN_WORLD);
    expect(s.guests[0]!.hunger).toBeLessThan(100);
    expect(s.guests[0]!.eyeing).toBeNull();
    for (let i = 0; i < 3; i++) nextBeat(s);
    expect(s.guests[1]!.eaten).toBe(false);
  });
});

describe('serving', () => {
  it('garlic hurts a vampire, and breaks the garlic rule', () => {
    const s = dinner([['vampire', 0]]);
    s.ledger = ['no_garlic'];
    const ev = act(s, { type: 'serve', guest: 0, dish: 'garlic_bread' }, OPEN_WORLD);
    expect(s.guests[0]!.composure).toBeLessThan(80);
    expect(ev.some((e) => e.t === 'ruleBroken' && e.rule === 'no_garlic')).toBe(true);
    expect(s.cover).toBe(s.tuning.coverStart - s.tuning.ruleBreakCost);
  });

  it('a ghost served real food is reminded; an empty plate is perfect', () => {
    const s = dinner([['ghost', 0]]);
    act(s, { type: 'serve', guest: 0, dish: 'salad' }, OPEN_WORLD);
    expect(s.guests[0]!.composure).toBe(80 - s.tuning.dishRemindDamage);
    act(s, { type: 'serve', guest: 0, dish: 'empty_plate' }, OPEN_WORLD);
    expect(s.guests[0]!.composure).toBe(80 - s.tuning.dishRemindDamage + s.tuning.dishLikeBonus);
  });

  it('dishes need time before they can be served again', () => {
    const s = dinner([['werewolf', 0]]);
    act(s, { type: 'serve', guest: 0, dish: 'tartare' }, OPEN_WORLD);
    const ev = act(s, { type: 'serve', guest: 0, dish: 'tartare' }, OPEN_WORLD);
    expect(ev).toEqual([{ t: 'note', text: "Steak tartare isn't ready yet." }]);
  });

  it('serving the guest who holds the topic interrupts it', () => {
    const s = dinner([
      ['werewolf', 0],
      ['ghost', 2],
    ]);
    setTopic(s, 0, ['food']);
    const ev = act(s, { type: 'serve', guest: 0, dish: 'tartare' }, OPEN_WORLD);
    expect(s.topic).toBeNull();
    expect(s.nextStarter).toBe(1);
    expect(ev.some((e) => e.t === 'topicDropped')).toBe(true);
  });
});

describe('rumor ledger', () => {
  function ask(s: DinnerState, questionLies: string[]) {
    s.question = {
      id: 'q',
      text: '?',
      asker: 0,
      options: questionLies.map((rule) => ({ kind: 'lie' as const, rule, text: rule })),
      timer: 9,
      total: 9,
    };
  }

  it('a lie becomes a rule, and breaking it costs cover', () => {
    const s = dinner([['werewolf', 0]]);
    act(s, { type: 'toggle', what: 'curtains' }, OPEN_WORLD); // close them
    ask(s, ['sleep_days']);
    act(s, { type: 'answer', choice: 0 }, OPEN_WORLD);
    expect(s.ledger).toEqual(['sleep_days']);
    const ev = act(s, { type: 'toggle', what: 'curtains' }, OPEN_WORLD); // open again
    expect(ev.some((e) => e.t === 'ruleBroken')).toBe(true);
    expect(s.cover).toBe(s.tuning.coverStart - s.tuning.ruleBreakCost);
  });

  it('contradicting yourself makes the asker suspicious', () => {
    const s = dinner([['ghost', 0]]);
    ask(s, ['sleep_days']);
    act(s, { type: 'answer', choice: 0 }, OPEN_WORLD);
    ask(s, ['love_brunch']);
    const ev = act(s, { type: 'answer', choice: 0 }, OPEN_WORLD);
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

  it('small talk about pets breaks "we can\'t stand dogs"', () => {
    const s = dinner([['ghost', 0]]);
    s.ledger = ['hate_dogs'];
    s.hand[0] = 'pets';
    const ev = act(s, { type: 'smallTalk', guest: 0, card: 0 }, OPEN_WORLD);
    expect(ev.some((e) => e.t === 'ruleBroken' && e.rule === 'hate_dogs')).toBe(true);
    expect(s.hand[0]).toBeNull();
  });
});

describe('trigger words', () => {
  it('only guests in earshot react', () => {
    const s = dinner([
      ['werewolf', 0],
      ['werewolf', 3],
    ]);
    const world: SimWorld = { canHear: (id) => id === 0, isBlocking: () => false };
    act(s, { type: 'say', text: 'I walked the DOG!' }, world);
    expect(s.guests[0]!.composure).toBe(80 - s.tuning.wordDamage);
    expect(s.guests[1]!.composure).toBe(80);
  });

  it('matches whole words only', () => {
    const s = dinner([['werewolf', 0]]);
    act(s, { type: 'say', text: 'dogmatic honeymoon' }, OPEN_WORLD);
    expect(s.guests[0]!.composure).toBe(80);
  });

  it('human-sounding words cost cover when a guest can hear', () => {
    const s = dinner([['ghost', 0]]);
    act(s, { type: 'say', text: 'ugh, my mortgage' }, { canHear: () => false, isBlocking: () => false });
    expect(s.cover).toBe(s.tuning.coverStart);
    act(s, { type: 'say', text: 'ugh, my mortgage' }, OPEN_WORLD);
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
    act(s, { type: 'toggle', what: 'curtains' }, OPEN_WORLD);
    const before = s.guests[0]!.composure;
    nextBeat(s);
    expect(s.guests[0]!.composure).toBeGreaterThanOrEqual(before);
  });

  it('swapping seats moves both guests', () => {
    const s = dinner([
      ['werewolf', 0],
      ['ghost', 3],
    ]);
    act(s, { type: 'reseat', guest: 0, seat: 3 }, OPEN_WORLD);
    expect(s.guests[0]!.seat).toBe(3);
    expect(s.guests[1]!.seat).toBe(0);
    act(s, { type: 'reseat', guest: 0, seat: 5 }, OPEN_WORLD);
    expect(s.guests[0]!.seat).toBe(5);
  });
});

describe('a whole dinner', () => {
  it('runs through three courses and dessert to a result', () => {
    const s = dinner(
      [
        ['werewolf', 0],
        ['ghost', 2],
        ['vampire', 4],
      ],
      { ...QUIET, topicTriggerDamage: 0 },
    );
    const phases: string[] = [];
    const ev = run(s, 700);
    for (const e of ev) if (e.t === 'phase') phases.push(`${e.phase}${e.course}`);
    expect(phases).toEqual(['course1', 'course2', 'dessert2']);
    expect(s.result?.outcome).toBe('survived');
    expect(s.result?.stars).toBeGreaterThanOrEqual(1);
  });

  it('cover hitting zero exposes you', () => {
    const s = dinner([['ghost', 0]]);
    for (let i = 0; i < 10 && s.phase !== 'ended'; i++) act(s, { type: 'say', text: 'taxes' }, OPEN_WORLD);
    expect(s.result?.outcome).toBe('exposed');
    expect(s.result?.tips).toBe(0);
  });

  it('replays identically from the same seed and actions', () => {
    const play = () => {
      const s = createDinner({ seed: 'REPLAY', seatCount: 6 });
      const log: SimEvent[] = [];
      for (let i = 0; i < 4000 && s.phase !== 'ended'; i++) {
        log.push(...step(s, 0.1, OPEN_WORLD));
        if (i % 97 === 0) log.push(...act(s, { type: 'smallTalk', guest: i % 4, card: i % 3 }, OPEN_WORLD));
        if (i % 151 === 0) log.push(...act(s, { type: 'serve', guest: (i + 1) % 4, dish: 'tartare' }, OPEN_WORLD));
        if (s.question && i % 5 === 0) log.push(...act(s, { type: 'answer', choice: 0 }, OPEN_WORLD));
      }
      return JSON.stringify({ s, log });
    };
    expect(play()).toBe(play());
  });

  it('never crashes or stalls across many seeds with a clumsy bot', () => {
    for (let seed = 0; seed < 40; seed++) {
      const s = createDinner({ seed: `BOT${seed}`, seatCount: 6 });
      for (let i = 0; i < 7000 && s.phase !== 'ended'; i++) {
        step(s, 0.1, OPEN_WORLD);
        if (i % 60 === 0) act(s, { type: 'smallTalk', guest: i % 4, card: i % 3 }, OPEN_WORLD);
        if (i % 90 === 0) act(s, { type: 'serve', guest: (i / 90) % 4, dish: ['tartare', 'red_wine', 'empty_plate'][i % 3]! }, OPEN_WORLD);
        if (s.question && i % 20 === 0) act(s, { type: 'answer', choice: i % 4 }, OPEN_WORLD);
        if (i % 400 === 0) act(s, { type: 'toggle', what: 'curtains' }, OPEN_WORLD);
      }
      expect(s.phase, `seed BOT${seed}`).toBe('ended');
      expect(s.result).not.toBeNull();
    }
  });
});
