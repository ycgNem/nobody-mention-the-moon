import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import houseA from '../../../client/public/models/house_a.layout.json';
import houseB from '../../../client/public/models/house_b.layout.json';
import houseC from '../../../client/public/models/house_c.layout.json';
import { dishById } from '../content/dishes.ts';
import { findSocket, parseLayout, type Vec3 } from '../layout.ts';
import { isCommand } from './commands.ts';
import { DinnerGame } from './DinnerGame.ts';
import type { GameEvent } from './types.ts';

const layout = parseLayout(houseA);
let seeds = 0;

beforeAll(async () => {
  await RAPIER.init();
});

function game(tuning = {}) {
  return new DinnerGame(RAPIER, { layout, newSeed: () => `T${seeds++}`, tuning });
}

/** Walks a player to `feet` in small steps, the way a client would report it. */
function walk(g: DinnerGame, id: string, feet: Vec3, yaw = 0, pitch = 0) {
  for (let i = 0; i < 400; i++) {
    const at = g.feetOf(id)!;
    const d = Math.hypot(feet[0] - at[0], feet[2] - at[2]);
    const stepLen = Math.min(d, 0.15);
    const k = d > 0 ? stepLen / d : 0;
    g.command(id, { c: 'move', x: at[0] + (feet[0] - at[0]) * k, y: feet[1], z: at[2] + (feet[2] - at[2]) * k, yaw, pitch, crouch: false });
    g.tick(1 / 30);
    if (d < 0.05) return;
  }
}

/** Walks via waypoints (straight lines would hit walls). */
function route(g: DinnerGame, id: string, ...points: Vec3[]) {
  for (const p of points) walk(g, id, p);
}

const sock = (id: string): Vec3 => {
  const s = findSocket(layout, id);
  if (!s) throw new Error(id);
  return [s.position[0], 0, s.position[2]];
};

// Waypoints (Three.js space) from the van into the house and around it.
const VAN: Vec3 = [5.5, 0, 7];
const DOORSTEP: Vec3 = [0.5, 0, 6.2];
const INSIDE_FRONT: Vec3 = [0.5, 0, 4.2];
const HALL_MID: Vec3 = [0.5, 0, 2];
const DINING: Vec3 = [-2.2, 0, 2];
const KITCHEN_DOOR_DINING: Vec3 = [-2.5, 0, 0.3];
const KITCHEN: Vec3 = [-2.5, 0, -2];
const KITCHEN_MID: Vec3 = [-4.5, 0, -1.8];

/** From the van, through the front door (opening it if it's shut), into the hall. */
function enter(g: DinnerGame, id: string) {
  walk(g, id, DOORSTEP, Math.PI);
  if (!g.isDoorOpen('front')) g.command(id, { c: 'interact', target: { kind: 'thing', id: 'front' } });
  route(g, id, INSIDE_FRONT, HALL_MID);
}

function startedGame(players = ['ada']) {
  const g = game();
  for (const p of players) g.addPlayer(p, p);
  g.command(players[0]!, { c: 'start' });
  expect(g.phase).toBe('dinner');
  return g;
}

describe('DinnerGame', () => {
  it('starts when everyone at the van is ready, with house props in place', () => {
    const g = game();
    g.addPlayer('ada', 'Ada');
    g.addPlayer('bo', 'Bo');
    expect(g.view().roomHost).toBe('ada');
    g.command('bo', { c: 'settings', size: 'banquet' });
    expect(g.view().size).toBe('dinner'); // only the room host picks
    g.command('ada', { c: 'settings', size: 'cozy' });
    g.command('ada', { c: 'ready', ready: true });
    g.tick(1 / 30);
    expect(g.phase).toBe('lobby');
    g.command('bo', { c: 'ready', ready: true });
    const ev = g.tick(1 / 30);
    expect(g.phase).toBe('dinner');
    expect(ev.some((e) => e.t === 'dinnerStarted')).toBe(true);
    const v = g.view();
    // Cozy is 3 at the table; a Late Guest event adds one more who rings during the courses.
    expect(v.dinner.guests.length).toBeGreaterThanOrEqual(3);
    expect(v.dinner.guests.length).toBeLessThanOrEqual(4);
    expect(v.dinner.phase).toBe('booking');
    expect(v.props.map((p) => p.kind)).toContain('painting');
    expect(v.dinner.hands.map((h) => h.player)).toEqual(['ada', 'bo']);
    expect(v.doors.find((d) => d.id === 'front')?.open).toBe(false);
  });

  it('validates network commands', () => {
    expect(isCommand({ c: 'move', x: 1, y: 0, z: 2, yaw: 0, pitch: 0, crouch: false })).toBe(true);
    expect(isCommand({ c: 'move', x: 'a' })).toBe(false);
    expect(isCommand({ c: 'interact', target: { kind: 'guest', id: 2 } })).toBe(true);
    expect(isCommand({ c: 'interact', target: { kind: 'nope' } })).toBe(false);
    expect(isCommand({ c: 'say', text: 'x'.repeat(500) })).toBe(false);
    expect(isCommand({ c: 'look', look: { hat: 'crown' } })).toBe(false);
    expect(isCommand(null)).toBe(false);
  });

  it('a host greets a guest at the front door and they walk in to the dining room', () => {
    const g = startedGame();
    g.command('ada', { c: 'skip' });
    g.command('ada', { c: 'skip' });
    expect(g.dinner!.phase).toBe('arrivals');
    route(g, 'ada', DOORSTEP);
    const first = g.dinner!.guests.slice().sort((a, b) => a.arriveAt - b.arriveAt)[0]!;
    first.type = 'ghost';
    const ev: GameEvent[] = g.advance(first.arriveAt + 0.5);
    expect(ev.some((e) => e.t === 'doorbell')).toBe(true);
    const at = g.view().dinner.guests[first.id]!;
    expect(at.where).toBe('door');
    expect(Math.hypot(at.x - DOORSTEP[0], at.z - DOORSTEP[2])).toBeLessThan(1);
    g.command('ada', { c: 'interact', target: { kind: 'guest', id: first.id } });
    expect(g.view().doors.find((d) => d.id === 'front')?.open).toBe(true);
    g.advance(g.dinner!.tuning.walkInSeconds + 0.5);
    const inside = g.view().dinner.guests[first.id]!;
    expect(inside.where).toBe('standing');
    expect(inside.x).toBeLessThan(-1); // in the dining room
  });

  it('cooks a dish from the fridge through the stations, plates it and serves it at the table', () => {
    const g = startedGame();
    g.command('ada', { c: 'skip' }); // booking → prep
    enter(g, 'ada');
    route(g, 'ada', DINING, KITCHEN_DOOR_DINING, KITCHEN, KITCHEN_MID);
    const menu = g.fridgeMenu();
    const dishId = menu.find((id) => dishById(id).steps.length > 0) ?? menu[0]!;
    const dish = dishById(dishId);
    walk(g, 'ada', [-7.6, 0, -3.6], -Math.PI / 2);
    g.command('ada', { c: 'take', from: 'fridge', dish: dishId });
    let held = g.view().players[0]!.held;
    expect(held).toBeGreaterThan(0);
    for (const station of dish.steps) {
      const id = station === 'hob' ? 'hob_0' : station;
      const it = layout.interactables.find((i) => i.id === id)!;
      walk(g, 'ada', [it.position[0], 0, it.position[2] + 0.9], 0, -0.6);
      g.command('ada', { c: 'interact', target: { kind: 'thing', id } });
      expect(g.view().props.find((p) => p.id === held)?.at).toBe(id);
      if (station === 'chop') for (let i = 0; i < g.dinner!.tuning.chopStrokes; i++) g.command('ada', { c: 'interact', target: { kind: 'thing', id } });
      else g.advance(g.dinner!.tuning[station === 'hob' ? 'hobSeconds' : 'ovenSeconds'] + 0.5);
      g.command('ada', { c: 'interact', target: { kind: 'thing', id } }); // pick it back up
      expect(g.view().players[0]!.held).toBe(held);
    }
    expect(g.view().props.find((p) => p.id === held)?.stage).toBe(dish.steps.length);
    const pass = layout.interactables.find((i) => i.id === 'pass')!;
    walk(g, 'ada', [pass.position[0], 0, pass.position[2] - 0.9], Math.PI, -0.5);
    g.command('ada', { c: 'interact', target: { kind: 'thing', id: 'pass' } });
    const plate = g.view().props.find((p) => p.id === held)!;
    expect(plate.kind).toBe('plate');
    expect(plate.plated).toBe(true);

    // Get everyone seated, then take it to someone.
    g.command('ada', { c: 'skip' });
    for (const guest of g.dinner!.guests) {
      guest.where = 'seated';
      guest.seat = guest.id;
      guest.greeted = guest.invited = true;
    }
    g.advance(0.5);
    route(g, 'ada', KITCHEN_MID, KITCHEN, KITCHEN_DOOR_DINING, [-2.6, 0, 1.5]);
    const seat0 = g.seats[0]!;
    walk(g, 'ada', [seat0.position[0] + 0.6, 0, seat0.position[2] + 0.6]);
    held = g.view().players[0]!.held;
    g.command('ada', { c: 'interact', target: { kind: 'guest', id: 0 } });
    const ev = g.advance(0.2);
    expect(ev.some((e) => e.t === 'served' && e.guest === 0 && e.dish === dishId)).toBe(true);
    expect(g.view().players[0]!.held).toBe(-1);
    expect(g.view().props.find((p) => p.id === held)?.at).toBe('guest:0');
  });

  it('food left on the hob burns, then catches fire and sets off the smoke alarm', () => {
    const g = startedGame();
    g.command('ada', { c: 'skip' });
    enter(g, 'ada');
    route(g, 'ada', DINING, KITCHEN_DOOR_DINING, KITCHEN, KITCHEN_MID);
    const d = g.dinner!;
    d.menu[0] = ['steak', 'salad', 'oysters'];
    walk(g, 'ada', [-7.6, 0, -3.6]);
    g.command('ada', { c: 'take', from: 'fridge', dish: 'steak' });
    const hob = layout.interactables.find((i) => i.id === 'hob_1')!;
    walk(g, 'ada', [hob.position[0], 0, hob.position[2] + 0.9], 0, -0.6);
    g.command('ada', { c: 'interact', target: { kind: 'thing', id: 'hob_1' } });
    const ev = g.advance(d.tuning.hobSeconds + d.tuning.burnAfter + d.tuning.fireAfter + 1);
    expect(ev.some((e) => e.t === 'burnt')).toBe(true);
    expect(ev.some((e) => e.t === 'fire' && e.on)).toBe(true);
    expect(d.room.alarm).toBe(true);
    g.command('ada', { c: 'interact', target: { kind: 'thing', id: 'hob_1' } });
    expect(d.room.alarm).toBe(false);
  });

  it('guests hear the kitchen only while its doors are open', () => {
    const g = startedGame();
    const d = g.dinner!;
    for (const guest of d.guests) {
      guest.where = 'seated';
      guest.seat = guest.id;
      guest.type = 'werewolf';
      guest.composure = 80;
    }
    d.phase = 'course';
    d.dinnerStart = d.time;
    enter(g, 'ada');
    route(g, 'ada', DINING, KITCHEN_DOOR_DINING, [-2.6, 0, -1.5]);
    g.command('ada', { c: 'say', text: 'moon' });
    expect(g.flushEvents().some((e) => e.t === 'heard' && e.word === 'moon')).toBe(true);
    walk(g, 'ada', [-4.5, 0, -2.5]);
    for (const id of ['kitchen_dining', 'kitchen_hall']) if (g.isDoorOpen(id)) g.command('ada', { c: 'interact', target: { kind: 'thing', id } });
    // The doors are a few meters away: walk to each to close it.
    walk(g, 'ada', [-2.5, 0, -1.6]);
    if (g.isDoorOpen('kitchen_dining')) g.command('ada', { c: 'interact', target: { kind: 'thing', id: 'kitchen_dining' } });
    walk(g, 'ada', [-1.8, 0, -3]);
    if (g.isDoorOpen('kitchen_hall')) g.command('ada', { c: 'interact', target: { kind: 'thing', id: 'kitchen_hall' } });
    expect(g.isDoorOpen('kitchen_dining')).toBe(false);
    expect(g.isDoorOpen('kitchen_hall')).toBe(false);
    walk(g, 'ada', [-4.5, 0, -2.5]);
    g.command('ada', { c: 'say', text: 'what a full moon, said the dog' });
    const ev = g.flushEvents();
    expect(ev.some((e) => e.t === 'chat')).toBe(true);
    expect(ev.some((e) => e.t === 'heard')).toBe(false);
  });

  it('guests at the table see a host in the dining room but not one in the hall behind a wall', () => {
    const g = startedGame();
    const d = g.dinner!;
    d.ledger = ['sleep_days', 'no_doors'];
    for (const guest of d.guests) {
      guest.where = 'seated';
      guest.seat = guest.id;
    }
    d.phase = 'course';
    d.dinnerStart = d.time;
    d.room.curtainsOpen = false;
    // Opening the front door from the doorstep: the table can't see that far round the corner.
    enter(g, 'ada');
    expect(g.isDoorOpen('front')).toBe(true);
    const hidden = d.stats.rulesBroken;
    expect(hidden).toBe(0);
    route(g, 'ada', DINING, [-5, 0, 4.4]);
    g.command('ada', { c: 'interact', target: { kind: 'thing', id: 'curtain' } });
    expect(d.room.curtainsOpen).toBe(true);
    expect(d.stats.rulesBroken).toBe(hidden + 1);
  });

  it('the chase: guests come for you, and reaching the van gets you away', () => {
    const g = startedGame(['ada', 'bo']);
    const d = g.dinner!;
    for (const guest of d.guests) {
      guest.where = 'seated';
      guest.seat = guest.id;
    }
    d.phase = 'course';
    d.dinnerStart = d.time;
    enter(g, 'bo');
    route(g, 'bo', DINING, [-3, 0, 3.5]);
    for (let i = 0; i < 20 && d.phase === 'course'; i++) g.command('bo', { c: 'say', text: 'my mortgage and my taxes' });
    expect(d.phase).toBe('chase');
    walk(g, 'ada', VAN);
    g.advance(8);
    expect(d.players.find((p) => p.id === 'ada')?.escaped).toBe(true);
    expect(d.players.find((p) => p.id === 'bo')?.caught).toBe(true);
    expect(g.phase).toBe('results');
    expect(g.view().dinner.result.outcome).toBe('exposed');
    g.command('ada', { c: 'back' });
    expect(g.phase).toBe('lobby');
    expect(g.view().props).toHaveLength(0);
  });

  it('runs a whole dinner with idle hosts without errors, and returns to the lobby', () => {
    const g = startedGame(['ada']);
    const ev = g.advance(1100, 1 / 10);
    expect(ev.some((e) => e.t === 'ended')).toBe(true);
    expect(g.phase).toBe('lobby');
    expect(sock('van_rear')[2]).toBeGreaterThan(5);
  });
});

describe('houses', () => {
  const houses = [layout, parseLayout(houseB), parseLayout(houseC)];
  const nearSpawn = (l: typeof layout, x: number, z: number) => l.spawns.some((sp) => Math.hypot(sp.position[0] - x, sp.position[2] - z) < 0.5);

  it('moves the party to the house the room host picks, back at its van', () => {
    const g = new DinnerGame(RAPIER, { layout, houses, newSeed: () => 'HOUSES-1' });
    g.addPlayer('ada', 'Ada');
    g.addPlayer('bo', 'Bo');
    g.command('bo', { c: 'settings', house: 'house_c' }); // not the room host: ignored
    expect(g.view().asset).toBe('house_a');
    g.command('ada', { c: 'settings', house: 'house_c' });
    const v = g.view();
    expect(v.asset).toBe('house_c');
    expect(v.house).toBe('house_c');
    for (const p of v.players) expect(nearSpawn(houses[2]!, p.x, p.z), p.name).toBe(true);
    // Players walk on the new house's floor.
    for (let i = 0; i < 30; i++) g.tick(1 / 30);
    expect(g.view().players.every((p) => p.y > -0.5)).toBe(true);
  });

  it('"surprise" lets the dinner seed pick the house, the same house every time', () => {
    const g = new DinnerGame(RAPIER, { layout, houses, newSeed: () => 'HOUSES-2' });
    g.addPlayer('ada', 'Ada');
    g.command('ada', { c: 'settings', house: 'surprise', seed: 'SAME-SEED' });
    const picked = g.houseFor('SAME-SEED');
    expect(new DinnerGame(RAPIER, { layout, houses, newSeed: () => 'x' }).houseFor('SAME-SEED')).toBe(picked);
    g.command('ada', { c: 'start' });
    expect(g.view().asset).toBe(picked);
    expect(g.view().dinner.active).toBe(true);
    for (let i = 0; i < 60; i++) g.tick(1 / 30);
    expect(g.phase).toBe('dinner');
  });

  it('spreads seeds across every house', () => {
    const g = new DinnerGame(RAPIER, { layout, houses, newSeed: () => 'x' });
    const seen = new Set(Array.from({ length: 60 }, (_, i) => g.houseFor(`SPREAD-${i}`)));
    expect([...seen].sort()).toEqual(['house_a', 'house_b', 'house_c']);
  });
});
