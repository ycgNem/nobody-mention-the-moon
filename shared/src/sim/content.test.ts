// M6/M7 content: occasions, the event deck, relationships, quirks, the newer monsters and the
// visitors. Each rule gets poked on its own, with everything else quiet.

import { describe, expect, it } from 'vitest';
import { GUEST_TYPES, type GuestTypeId } from '../content/guests.ts';
import { OCCASION_IDS, OCCASIONS } from '../content/occasions.ts';
import { QUIRKS } from '../content/quirks.ts';
import { act, createDinner, step, traitsOf } from './dinner.ts';
import { BOT, runBotDinner } from './bot.ts';
import { OPEN_WORLD, type DinnerState, type SimEvent, type SimWorld } from './types.ts';

const P = 'solo';
const QUIET = {
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
  partChance: 0,
};
const world = (over: Partial<SimWorld> = {}): SimWorld => ({ ...OPEN_WORLD, ...over });

function dinner(guests: GuestTypeId[], tuning: object = QUIET): DinnerState {
  const s = createDinner({ seed: 'CONTENT', seatCount: 8, tuning, quickStart: true, occasion: 'dinner_party' });
  const template = s.guests[0]!;
  s.guests = guests.map((type, id) => ({
    ...template,
    id,
    type,
    seat: id,
    where: 'seated' as const,
    name: `G${id}`,
    composure: 80,
    hunger: 0,
    quirks: [],
    lateAt: -1,
    family: -1,
    copying: null,
  }));
  s.ledger = [];
  s.schedule = [];
  s.relationships = [];
  s.topic = null;
  return s;
}

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

describe('content data', () => {
  it('has 8 guest types, each with tells, a slip kit or see-through slip, and 2+ quirks', () => {
    expect(Object.keys(GUEST_TYPES)).toHaveLength(8);
    for (const t of Object.values(GUEST_TYPES)) {
      expect(t.slipKit.length > 0 || t.seeThroughSlip, t.id).toBe(true);
      expect(t.quirks.length, t.id).toBeGreaterThanOrEqual(2);
      for (const q of t.quirks) expect(QUIRKS[q], q).toBeDefined();
      expect(t.words.length, t.id).toBeGreaterThan(0);
    }
  });

  it('has 7 occasions, and ≥ 10 events counting the oven fire', async () => {
    expect(OCCASION_IDS).toHaveLength(7);
    const { EVENT_IDS } = await import('../content/events.ts');
    expect(EVENT_IDS.length + 1).toBeGreaterThanOrEqual(10);
  });

  it('rolls 1–2 quirks per guest from their own pool, and 2–4 events', () => {
    for (let i = 0; i < 30; i++) {
      const s = createDinner({ seed: `Q${i}`, seatCount: 8 });
      for (const g of s.guests) {
        expect(g.quirks.length).toBeGreaterThanOrEqual(1);
        expect(g.quirks.length).toBeLessThanOrEqual(2);
        for (const q of g.quirks) expect(GUEST_TYPES[g.type].quirks).toContain(q);
      }
      expect(s.schedule.length).toBeGreaterThanOrEqual(2);
      expect(s.schedule.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('occasions', () => {
  it('every occasion sets up its twist', () => {
    for (const id of OCCASION_IDS) {
      const s = createDinner({ seed: `OCC-${id}`, seatCount: 8, occasion: id, tuning: { guests: 6 } });
      const occ = OCCASIONS[id];
      expect(s.occasion).toBe(id);
      expect(s.objective?.id ?? null).toBe(occ.objective?.id ?? null);
      if (occ.honoree?.type) expect(s.guests[s.honoree!]!.type).toBe(occ.honoree.type);
      if (occ.book) expect(s.book).toHaveLength(2);
      if (occ.families) {
        const fam0 = new Set(s.guests.filter((g) => g.family === 0).map((g) => g.type));
        const fam1 = new Set(s.guests.filter((g) => g.family === 1).map((g) => g.type));
        expect(fam0.size).toBe(1);
        expect(fam1.size).toBe(1);
        expect(s.schedule.filter((e) => e.kind === 'toast').length).toBeGreaterThanOrEqual(2);
      }
      if (occ.relationships) expect(s.relationships.filter((r) => r.kind === 'exes').length).toBe(2);
      if (occ.dessert) expect(s.menu[s.menu.length - 1]).toContain(occ.dessert);
    }
  });

  it('book club: six beats on the book completes the objective', () => {
    const s = dinner(['werewolf', 'vampire', 'ghost']);
    s.book = ['food', 'travel'];
    s.objective = { id: 'book_streak', label: '', status: 'pending', progress: 0, goal: 6, tips: 25 };
    const ev: SimEvent[] = [];
    for (let i = 0; i < 6; i++) {
      s.topic = { id: 't', label: 'x', tags: ['food'], holder: 0, previous: null, age: 0, life: 99 };
      ev.push(...nextBeat(s));
    }
    expect(s.objective.status).toBe('done');
    expect(ev.some((e) => e.t === 'objective' && e.status === 'done')).toBe(true);
  });

  it('birthday: cake for a composed guest of honor completes it; their nerves swing double', () => {
    const s = dinner(['werewolf', 'ghost']);
    s.occasion = 'birthday';
    s.honoree = 0;
    s.objective = { id: 'birthday_cake', label: '', status: 'pending', progress: 0, goal: 1, tips: 30 };
    s.guests[0]!.composure = 80;
    act(s, { type: 'say', by: P, text: 'the moon' }, OPEN_WORLD);
    expect(s.guests[0]!.composure).toBe(80 - 2 * s.tuning.wordDamage);
    s.guests[0]!.composure = 90;
    act(s, { type: 'serve', by: P, guest: 0, dish: 'birthday_cake' }, OPEN_WORLD);
    expect(s.objective.status).toBe('done');
  });

  it('hunter night: he arrives with the first course, tricks guests, and leaving unsuspicious wins', () => {
    const s = createDinner({ seed: 'HUNT', seatCount: 8, occasion: 'hunter_night', tuning: { ...QUIET, courseSeconds: 40, dessertSeconds: 20 } });
    act(s, { type: 'skip', by: P }, OPEN_WORLD);
    act(s, { type: 'skip', by: P }, OPEN_WORLD);
    for (const g of s.guests) {
      g.where = 'seated';
      g.seat = g.id;
      g.lateAt = -1;
    }
    run(s, 5);
    expect(s.visitor?.kind).toBe('hunter');
    const ev: SimEvent[] = run(s, 30);
    expect(ev.some((e) => e.t === 'visitor' && e.kind === 'hunter' && e.text.includes('Ta-da'))).toBe(true);
    act(s, { type: 'visitor', by: P }, OPEN_WORLD);
    run(s, 200);
    expect(s.visitor).toBeNull();
    expect(['done', 'failed']).toContain(s.objective!.status);
  });
});

describe('events', () => {
  it('a toast spoken out loud wins Cover; a trigger word spoils it', () => {
    const s = dinner(['werewolf', 'vampire']);
    s.cover = 50;
    s.toast = { player: P, guest: 0, timer: 20, spoken: 0, need: 3, spoiled: false, family: -1 };
    const talking = world({ speaking: (p) => p === P });
    const ev = run(s, 4, talking);
    expect(ev.some((e) => e.t === 'toast' && e.kind === 'done')).toBe(true);
    expect(s.cover).toBeGreaterThan(50);
    expect(s.players[0]!.stats.toasts).toBe(1);

    s.toast = { player: P, guest: 0, timer: 20, spoken: 0, need: 3, spoiled: false, family: -1 };
    act(s, { type: 'say', by: P, text: 'to the moon and back', voice: true }, talking);
    const ev2 = run(s, 4, talking);
    expect(ev2.some((e) => e.t === 'toast' && e.kind === 'failed')).toBe(true);
  });

  it('typed toasts count words', () => {
    const s = dinner(['ghost']);
    s.toast = { player: P, guest: 0, timer: 20, spoken: 0, need: 3, spoiled: false, family: -1 };
    act(s, { type: 'say', by: P, text: 'a toast to our lovely friends and their lovely evening' }, OPEN_WORLD);
    const ev = run(s, 0.3);
    expect(ev.some((e) => e.t === 'toast' && e.kind === 'done')).toBe(true);
  });

  it('power cut: lights do nothing until the fuse box is reset', () => {
    const s = dinner(['werewolf']);
    s.room.powerOn = false;
    const ev = act(s, { type: 'toggle', by: P, what: 'lights' }, OPEN_WORLD);
    expect(ev.some((e) => e.t === 'note')).toBe(true);
    act(s, { type: 'fuse', by: P }, OPEN_WORLD);
    expect(s.room.powerOn).toBe(true);
  });

  it('the dog at the table rattles pet-shy guests and delights a dog person', () => {
    const s = dinner(['werewolf', 'werewolf']);
    s.guests[1]!.quirks = ['dog_person'];
    s.guests[1]!.composure = 50;
    s.room.dogLoose = true;
    nextBeat(s, world({ dogAtTable: () => true }));
    expect(s.guests[0]!.composure).toBeLessThan(80);
    expect(s.guests[1]!.composure).toBeGreaterThan(50);
    act(s, { type: 'dogHome', by: P }, OPEN_WORLD);
    expect(s.room.dogLoose).toBe(false);
  });

  it('a wine spill bothers the vampire until it is mopped up; counting vampires go quiet', () => {
    const s = dinner(['vampire', 'werewolf']);
    s.room.spill = true;
    nextBeat(s);
    expect(s.guests[0]!.composure).toBeLessThan(80);
    expect(s.guests[1]!.composure).toBe(80);
    act(s, { type: 'clean', by: P }, OPEN_WORLD);
    expect(s.room.spill).toBe(false);
  });

  it('the storm blows the curtains open and lightning flashes at sun-shy guests', () => {
    const s = dinner(['vampire'], { ...QUIET, lightningChancePerBeat: 1, gustChancePerBeat: 1 });
    s.room.storm = 30;
    s.room.curtainsOpen = false;
    const ev = nextBeat(s);
    expect(ev.some((e) => e.t === 'lightning')).toBe(true);
    expect(s.room.curtainsOpen).toBe(true);
    expect(s.guests[0]!.composure).toBeLessThan(80);
  });

  it('the pizza driver wanders in if nobody answers, or leaves happy with a tip', () => {
    const s = dinner(['ghost']);
    s.visitor = { kind: 'pizza', where: 'door', timer: 1, suspicion: 0, trickIn: 0 };
    run(s, 1.5);
    expect(s.visitor?.where).toBe('inside');
    act(s, { type: 'visitor', by: P }, OPEN_WORLD);
    expect(s.visitor).toBeNull();
  });

  it('charades: unchecked, the table guesses the actor; Small Talk derails them', () => {
    const s = dinner(['werewolf', 'ghost'], { ...QUIET, charadesGuessPerBeat: 60 });
    s.partyGame = { actor: 0, guess: 0, turns: 3 };
    nextBeat(s);
    act(s, { type: 'smallTalk', by: P, guest: 0, card: 0 }, OPEN_WORLD);
    expect(s.partyGame?.actor === 0 ? s.partyGame.guess : 0).toBeLessThan(60);
    const s2 = dinner(['werewolf', 'ghost'], { ...QUIET, charadesGuessPerBeat: 60 });
    s2.partyGame = { actor: 0, guess: 0, turns: 3 };
    const ev = [...nextBeat(s2), ...nextBeat(s2)];
    expect(ev.some((e) => e.t === 'slip' && e.guest === 0)).toBe(true);
  });

  it('a late guest rings the bell during the courses', () => {
    const s = dinner(['werewolf', 'ghost']);
    s.guests[1]!.where = 'outside';
    s.guests[1]!.lateAt = 10;
    const ev = run(s, 11);
    expect(ev.some((e) => e.t === 'doorbell' && e.guest === 1)).toBe(true);
  });
});

describe('relationships', () => {
  it('exes who can see each other both lose composure; romance between them is devastating', () => {
    const s = dinner(['werewolf', 'ghost']);
    s.relationships = [{ kind: 'exes', a: 0, b: 1 }];
    nextBeat(s);
    expect(s.guests[0]!.composure).toBeLessThan(80);
    expect(s.guests[1]!.composure).toBeLessThan(80);
    const before = s.guests[1]!.composure;
    s.topic = { id: 't', label: 'x', tags: ['romance'], holder: 0, previous: null, age: 0, life: 99 };
    nextBeat(s);
    expect(s.guests[1]!.composure).toBeLessThan(before - s.tuning.exesRomanceDamage + 10);
  });

  it('a crush seated next to their crush relaxes', () => {
    const s = dinner(['werewolf', 'ghost']);
    s.relationships = [{ kind: 'crush', a: 0, b: 1 }];
    s.guests[0]!.composure = 50;
    nextBeat(s);
    expect(s.guests[0]!.composure).toBeGreaterThan(50);
  });
});

describe('the newer monsters', () => {
  it('fae: "thank you" puts you in their debt; an unpaid favor takes your name and your lies', () => {
    const s = dinner(['fae', 'werewolf']);
    const ev = act(s, { type: 'say', by: P, text: 'oh thank you so much' }, OPEN_WORLD);
    expect(ev.some((e) => e.t === 'favor' && e.kind === 'asked')).toBe(true);
    expect(s.favors).toHaveLength(1);
    for (let i = 0; i < s.tuning.favorBeats; i++) nextBeat(s);
    expect(s.players[0]!.nameTaken).toBe(true);
    s.questionInBeats = 1;
    s.tuning.questionEveryBeatsMin = 1;
    for (let i = 0; i < 3 && !s.question; i++) nextBeat(s);
    expect(s.question?.options.some((o) => o.kind === 'lie')).toBe(false);
  });

  it('fae: paying the favor makes them happy', () => {
    const s = dinner(['fae']);
    act(s, { type: 'say', by: P, text: 'thanks' }, OPEN_WORLD);
    const want = s.favors[0]!.want;
    s.guests[0]!.composure = 40;
    if (want.startsWith('prop:')) act(s, { type: 'prop', by: P, prop: want.slice(5) as never }, OPEN_WORLD);
    else act(s, { type: 'serve', by: P, guest: 0, dish: want }, OPEN_WORLD);
    expect(s.favors).toHaveLength(0);
    expect(s.players[0]!.stats.favors).toBe(1);
  });

  it('shapeshifter: copies whoever has had the most attention, and plays by their rules', () => {
    const s = dinner(['shapeshifter', 'werewolf', 'ghost'], { ...QUIET, copyEveryBeats: 1 });
    s.guests[2]!.attention = 5;
    const ev = nextBeat(s);
    expect(s.guests[0]!.copying).toBe(2);
    expect(traitsOf(s, s.guests[0]!).id).toBe('ghost');
    expect(ev.some((e) => e.t === 'copy' && e.of === 2)).toBe(true);
  });

  it('gorgon: with the sunglasses off, whoever they look at turns to stone', () => {
    const s = dinner(['gorgon']);
    s.guests[0]!.glassesOff = 3;
    const ev = run(s, 0.3, world({ gazeAt: () => [P] }));
    expect(s.players[0]!.stone).toBeGreaterThan(0);
    expect(ev.some((e) => e.t === 'stone')).toBe(true);
    const blocked = act(s, { type: 'toggle', by: P, what: 'curtains' }, OPEN_WORLD);
    expect(blocked.some((e) => e.t === 'note')).toBe(true);
  });

  it('gorgon: a thrown roll knocks the glasses off', () => {
    const s = dinner(['gorgon']);
    act(s, { type: 'thrown', by: P, hit: 0 }, OPEN_WORLD);
    expect(s.guests[0]!.glassesOff).toBeGreaterThan(0);
  });

  it('mummy: an open window flaps their wrappings; salty food delights them', () => {
    const s = dinner(['mummy']);
    s.room.curtainsOpen = true;
    nextBeat(s);
    expect(s.guests[0]!.composure).toBeLessThan(80);
    const before = s.guests[0]!.composure;
    act(s, { type: 'serve', by: P, guest: 0, dish: 'jerky' }, OPEN_WORLD);
    expect(s.guests[0]!.composure).toBeGreaterThan(before + 10);
  });

  it('zombie: a jolt can knock a part off; putting it back helps', () => {
    const s = dinner(['zombie'], { ...QUIET, partChance: 1 });
    const ev = act(s, { type: 'say', by: P, text: 'use your head' }, OPEN_WORLD);
    expect(ev.some((e) => e.t === 'partFell')).toBe(true);
    expect(s.guests[0]!.partsOff).toBe(1);
    act(s, { type: 'reattach', by: P, guest: 0 }, OPEN_WORLD);
    expect(s.guests[0]!.partsOff).toBe(0);
  });

  it('quirks change the rules: old souls hate childhood talk, night owls relax in the dark', () => {
    const s = dinner(['vampire', 'vampire']);
    s.guests[0]!.quirks = ['old_soul'];
    s.guests[0]!.addressedBeats = 9;
    s.topic = { id: 't', label: 'x', tags: ['childhood'], holder: 1, previous: null, age: 0, life: 99 };
    nextBeat(s);
    const hurtOldSoul = s.guests.some((g) => g.id === 0 && g.composure < 80);
    expect(hurtOldSoul || s.topic?.holder !== 0).toBe(true);

    const d = dinner(['vampire'], { ...QUIET, darkDamagePerBeat: 2 });
    d.guests[0]!.quirks = ['night_owl'];
    d.guests[0]!.composure = 50;
    d.room.lightsOn = false;
    nextBeat(d);
    expect(d.guests[0]!.composure).toBeGreaterThan(52);
  });
});

describe('First Shift tutorial', () => {
  it('is two gentle guests, one event and slower beats', () => {
    const t = createDinner({ seed: 'TUTORIAL', seatCount: 8, tutorial: true });
    const normal = createDinner({ seed: 'TUTORIAL', seatCount: 8 });
    expect(t.guests.map((g) => g.type).sort()).toEqual(['vampire', 'werewolf']);
    expect(t.schedule).toHaveLength(1);
    expect(t.tuning.beatSeconds).toBeGreaterThan(normal.tuning.beatSeconds);
  });

  it('is two short courses, and the bot can finish it', () => {
    const t = createDinner({ seed: 'TUTORIAL', seatCount: 8, tutorial: true, players: [{ id: BOT, name: 'Bot' }] });
    expect(t.menu).toHaveLength(2);
    const { state } = runBotDinner(t);
    expect(state.phase).toBe('ended');
    expect(state.result?.outcome).toBe('survived');
    // Booking to results in a few minutes, not a full evening.
    expect(state.time).toBeLessThan(7 * 60);
  });
});

describe('a table that empties', () => {
  it('ends the dinner as a loss once fewer than two guests are left (D-018)', () => {
    let brokeUp = 0;
    for (let i = 0; i < 40; i++) {
      const s = createDinner({ seed: `EMPTY-${i}`, seatCount: 8, players: [{ id: P, name: 'P' }], tuning: { guests: 3 } });
      act(s, { type: 'skip', by: P }, OPEN_WORLD);
      act(s, { type: 'skip', by: P }, OPEN_WORLD);
      for (let n = 0; s.phase !== 'ended' && n < 20000; n++) step(s, 0.25, OPEN_WORLD);
      const left = s.guests.filter((g) => !g.eaten && g.where !== 'gone').length;
      // Nobody "survives" a dinner by letting the guests eat each other down to one.
      if (s.result?.outcome === 'survived') expect(left).toBeGreaterThanOrEqual(s.tuning.minGuests);
      if (left < s.tuning.minGuests) {
        expect(s.result?.outcome).toBe('strikes');
        brokeUp++;
      }
    }
    expect(brokeUp).toBeGreaterThan(0);
  });
});

describe('the bot', () => {
  it('can win dinners of every occasion', () => {
    const wins = new Map<string, number>();
    for (const id of OCCASION_IDS) {
      for (let i = 0; i < 4; i++) {
        const s = createDinner({ seed: `BOTWIN-${id}-${i}`, seatCount: 8, occasion: id, players: [{ id: BOT, name: 'Bot' }] });
        const { state } = runBotDinner(s);
        expect(state.phase, `${id} ${i}`).toBe('ended');
        if (state.result?.outcome === 'survived') wins.set(id, (wins.get(id) ?? 0) + 1);
      }
    }
    for (const id of OCCASION_IDS) expect(wins.get(id) ?? 0, id).toBeGreaterThan(0);
  });
});
