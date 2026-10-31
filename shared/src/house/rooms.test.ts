import { describe, expect, it } from 'vitest';
import { parseLayout, ringSeats, type Vec3 } from '../layout.ts';
import { buildRoomGraph, inEarshot, muffling, roomAt, soundPath } from './rooms.ts';

import houseA from '../../../client/public/models/house_a.layout.json';

const layout = parseLayout(houseA);
const g = buildRoomGraph(layout);
const allOpen = () => true;
const shut = (...ids: string[]) => (id: string) => !ids.includes(id);

// Three.js space: x east, y up, z = -north.
const TABLE: Vec3 = [-5, 1.2, 2];
const KITCHEN: Vec3 = [-6, 1.6, -3];
const HALL: Vec3 = [0.5, 1.6, 0];
const GARAGE: Vec3 = [6, 1.6, 2];
const CELLAR: Vec3 = [-3.5, -0.2, -10];
const OUTSIDE: Vec3 = [5.5, 1.6, 7];

describe('house_a room graph', () => {
  it('knows which room a point is in', () => {
    expect(roomAt(g, TABLE)).toBe('dining');
    expect(roomAt(g, KITCHEN)).toBe('kitchen');
    expect(roomAt(g, HALL)).toBe('hall');
    expect(roomAt(g, GARAGE)).toBe('garage');
    expect(roomAt(g, CELLAR)).toBe('cellar');
    expect(roomAt(g, OUTSIDE)).toBe('outside');
    expect(roomAt(g, [0, 1, 40])).toBeNull();
  });

  it('has eight seats in a ring and the sockets the game needs', () => {
    expect(ringSeats(layout)).toHaveLength(8);
    for (const id of ['guest_door', 'path_0', 'path_2', 'neighbor', 'station_chop', 'station_pass', 'van_rear', 'dog', 'stand_0', 'plate_0']) {
      expect(layout.sockets.some((s) => s.id === id), id).toBe(true);
    }
  });

  it('sound goes through open doors and is stopped by closed ones', () => {
    const open = soundPath(g, KITCHEN, TABLE, allOpen)!;
    expect(open.closed).toBe(0);
    expect(open.hops).toBe(1);
    const closed = soundPath(g, KITCHEN, TABLE, shut('kitchen_dining', 'kitchen_hall'))!;
    expect(closed.closed).toBe(1);
    // With only the dining door shut, sound goes round through the hall instead.
    const round = soundPath(g, KITCHEN, TABLE, shut('kitchen_dining'))!;
    expect(round.closed).toBe(0);
    expect(round.hops).toBe(2);
  });

  it('the kitchen with its doors shut is a safe place to swear about the moon', () => {
    expect(inEarshot(g, [-3, 1.6, -2], TABLE, allOpen, 6)).toBe(true);
    expect(inEarshot(g, [-3, 1.6, -2], TABLE, shut('kitchen_dining', 'kitchen_hall'), 6)).toBe(false);
    expect(inEarshot(g, CELLAR, TABLE, allOpen, 6)).toBe(false);
  });

  it('voices are muffled more through closed doors and more rooms', () => {
    const same = muffling(g, [-4, 1.6, 2], TABLE, allOpen);
    const next = muffling(g, KITCHEN, TABLE, allOpen);
    const shutIn = muffling(g, KITCHEN, TABLE, shut('kitchen_dining', 'kitchen_hall'));
    expect(same.cutoffHz).toBeGreaterThan(next.cutoffHz);
    expect(next.cutoffHz).toBeGreaterThan(shutIn.cutoffHz);
    expect(shutIn.gain).toBeLessThan(next.gain);
    expect(shutIn.muffle).toBeGreaterThan(next.muffle);
  });
});
