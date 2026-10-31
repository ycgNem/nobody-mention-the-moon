// Every house against the contract the game relies on (docs/TECH.md "Art pipeline", house_a.py):
// the rooms, doors, interactables and sockets it needs; everything inside a room; a connected room
// graph; a guest route over open floor; a host who can walk from the van through the front door
// to the table and cook at every kitchen station; and a whole idle dinner.

import RAPIER from '@dimforge/rapier3d-compat';
import type { World } from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import houseA from '../../../client/public/models/house_a.layout.json';
import houseB from '../../../client/public/models/house_b.layout.json';
import houseC from '../../../client/public/models/house_c.layout.json';
import { dishById } from '../content/dishes.ts';
import { buildRoomGraph, roomAt, type RoomGraph } from '../house/rooms.ts';
import { findSocket, parseLayout, ringSeats, socketsWithPrefix, type Layout, type LayoutRoom, type Vec3 } from '../layout.ts';
import { buildHouseWorld, firstHit } from '../physics.ts';
import { PLAYER } from '../tuning.ts';
import { DinnerGame } from './DinnerGame.ts';

const HOUSES: { name: string; layout: Layout }[] = [
  { name: 'house_a', layout: parseLayout(houseA) },
  { name: 'house_b', layout: parseLayout(houseB) },
  { name: 'house_c', layout: parseLayout(houseC) },
];

const REQUIRED_ROOMS = ['dining', 'kitchen', 'hall', 'outside'];

/** Interactable id → kind. Leaf doors add one `door` each (id = door id). */
const REQUIRED_THINGS: Record<string, string> = {
  chalkboard: 'chalkboard',
  chop: 'chop',
  curtain: 'curtain',
  fridge: 'fridge',
  fuse_box: 'fuse_box',
  hob_0: 'hob',
  hob_1: 'hob',
  lights: 'lights',
  mirror: 'mirror',
  oven: 'oven',
  pass: 'pass',
  plates: 'plates',
  record_player: 'record_player',
  van: 'van',
  whiteboard: 'whiteboard',
  wine_rack: 'wine_rack',
};

const STANDS = Array.from({ length: 8 }, (_, i) => `stand_${i}`);
const REQUIRED_SOCKETS = [
  'dog',
  'guest_door',
  'lamp_light',
  'neighbor',
  'path_0',
  'path_1',
  'path_2',
  'path_n',
  'path_s',
  'prop_candelabra',
  'prop_painting',
  'prop_pan',
  'prop_photo_frame',
  'prop_pot',
  'prop_record',
  'prop_snow_globe',
  'prop_tea_towel',
  'room_light_kitchen',
  'room_light_porch',
  ...STANDS,
  'station_chop',
  'station_hob_0',
  'station_hob_1',
  'station_oven',
  'station_pass',
  'van_rear',
  'visitor_door',
];

/** Which room each of these must be in. */
const ROOM_OF: Record<string, string> = {
  lamp_light: 'dining',
  prop_candelabra: 'dining',
  path_2: 'dining',
  path_n: 'dining',
  path_s: 'dining',
  ...Object.fromEntries(STANDS.map((s) => [s, 'dining'])),
  path_0: 'hall',
  path_1: 'hall',
  guest_door: 'outside',
  visitor_door: 'outside',
  van_rear: 'outside',
  room_light_kitchen: 'kitchen',
  station_chop: 'kitchen',
  station_hob_0: 'kitchen',
  station_hob_1: 'kitchen',
  station_oven: 'kitchen',
  station_pass: 'kitchen',
};
const THING_ROOM: Record<string, string> = {
  curtain: 'dining',
  mirror: 'dining',
  lights: 'dining',
  record_player: 'dining',
  fridge: 'kitchen',
  chop: 'kitchen',
  hob_0: 'kitchen',
  hob_1: 'kitchen',
  oven: 'kitchen',
  pass: 'kitchen',
  plates: 'kitchen',
  chalkboard: 'kitchen',
  whiteboard: 'kitchen',
  van: 'outside',
};

beforeAll(async () => {
  await RAPIER.init();
});

const flat = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const up = (p: Vec3, dy: number): Vec3 => [p[0], p[1] + dy, p[2]];

function sock(layout: Layout, id: string): Vec3 {
  const s = findSocket(layout, id);
  if (!s) throw new Error(`${layout.asset}: no socket_${id}`);
  return s.position;
}

function thing(layout: Layout, id: string): Vec3 {
  const it = layout.interactables.find((i) => i.id === id);
  if (!it) throw new Error(`${layout.asset}: no interact_${id}`);
  return it.position;
}

/** Distance from a point to a room box (0 inside). */
function toBox(r: LayoutRoom, p: Vec3): number {
  const d = [0, 1, 2].map((k) => Math.max(0, Math.abs(p[k]! - r.center[k]!) - r.halfExtents[k]!));
  return Math.hypot(d[0]!, d[1]!, d[2]!);
}

/** The static house with the front door open and the other leaf doors as a dinner starts (or all open). */
function openHouse(layout: Layout, everyDoor = false): World {
  const { world, named } = buildHouseWorld(RAPIER, layout, 0);
  for (const d of layout.doors) if (d.leaf && (everyDoor || d.open || d.id === 'front')) named.get(`col_box_doorleaf_${d.id}`)?.setEnabled(false);
  world.step();
  return world;
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/** Does an upright capsule with its bottom at `feet` touch anything? */
function blocked(world: World, feet: Vec3, radius: number, height: number, lift = 0.06): boolean {
  const half = Math.max(0.01, height / 2 - radius);
  const shape = new RAPIER.Capsule(half, radius);
  return world.intersectionWithShape({ x: feet[0], y: feet[1] + lift + radius + half, z: feet[2] }, IDENTITY, shape) !== null;
}

// --- walking: floor nodes on every level (stairs are ramps), A*, then the character controller -

const CELL = 0.1;
const STEP_UP = 0.15; // most a floor may rise between neighboring nodes
// Gap under the capsule when testing a node: a 0.31 m capsule needs ~0.06 m just to clear a 33° ramp
// (the manor's cellar stairs), and the controller steps over anything under 0.25 m anyway.
const CLEARANCE = 0.15;

interface NavNode {
  i: number;
  j: number;
  y: number;
}

class NavGrid {
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly nodes: NavNode[] = [];
  private readonly cells = new Map<number, number[]>();

  /** A node wherever a player fits on a floor inside a room box. `world` should have its doors open. */
  constructor(
    readonly world: World,
    readonly graph: RoomGraph,
  ) {
    const rooms = graph.rooms;
    this.x0 = Math.min(...rooms.map((r) => r.center[0] - r.halfExtents[0]));
    this.z0 = Math.min(...rooms.map((r) => r.center[2] - r.halfExtents[2]));
    this.nx = Math.ceil((Math.max(...rooms.map((r) => r.center[0] + r.halfExtents[0])) - this.x0) / CELL) + 1;
    this.nz = Math.ceil((Math.max(...rooms.map((r) => r.center[2] + r.halfExtents[2])) - this.z0) / CELL) + 1;
    const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    const height = 2 * (PLAYER.halfHeight + PLAYER.radius);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const [x, , z] = this.at(i, j, 0);
        const found: number[] = [];
        for (const r of rooms) {
          if (Math.abs(x - r.center[0]) > r.halfExtents[0] || Math.abs(z - r.center[2]) > r.halfExtents[2]) continue;
          const bottom = r.center[1] - r.halfExtents[1];
          const top = r.center[1] + r.halfExtents[1];
          // A stairwell box reaches from below the ground floor to above it: its floor is the ramp.
          const highest = bottom < -0.5 && top > 0.5 ? top : bottom + 0.12;
          // Every upward-facing surface down the column (a ray starting inside a solid reports its exit).
          let y = top - 0.02;
          for (let n = 0; n < 10 && y > bottom - 0.3; n++) {
            ray.origin = { x, y, z };
            const hit = world.castRayAndGetNormal(ray, y - bottom + 0.3, false);
            if (!hit) break;
            const fy = y - hit.timeOfImpact;
            const floor = hit.normal.y > 0.7 && fy >= bottom - 0.15 && fy <= highest;
            if (floor && !found.some((f) => Math.abs(f - fy) < 0.3) && !blocked(world, [x, fy, z], PLAYER.radius + 0.01, height, CLEARANCE)) found.push(fy);
            y = fy - 0.02;
          }
        }
        for (const fy of found) {
          const key = j * this.nx + i;
          const list = this.cells.get(key) ?? [];
          list.push(this.nodes.length);
          this.cells.set(key, list);
          this.nodes.push({ i, j, y: fy });
        }
      }
    }
  }

  at(i: number, j: number, y: number): Vec3 {
    return [this.x0 + i * CELL, y, this.z0 + j * CELL];
  }

  pos(n: number): Vec3 {
    const node = this.nodes[n]!;
    return this.at(node.i, node.j, node.y);
  }

  /** The node in cell (i, j) whose floor is within `tol` of height `y`, or -1. */
  find(i: number, j: number, y: number, tol: number): number {
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    for (const n of this.cells.get(j * this.nx + i) ?? []) if (Math.abs(this.nodes[n]!.y - y) <= tol) return n;
    return -1;
  }

  /** The node nearest `p` across the floor (within `max`), standing at most `below` under it. */
  nearest(p: Vec3, max: number, below = 0.3): number {
    const ci = Math.round((p[0] - this.x0) / CELL);
    const cj = Math.round((p[2] - this.z0) / CELL);
    const r = Math.ceil(max / CELL);
    let best = -1;
    let bestD = Infinity;
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        for (const n of this.cells.get(j * this.nx + i) ?? []) {
          const q = this.pos(n);
          const d = flat(q, p);
          if (d <= max && d < bestD && q[1] >= p[1] - below && q[1] <= p[1] + 0.3) {
            best = n;
            bestD = d;
          }
        }
      }
    }
    return best;
  }

  /** A* over the nodes (8-way, no corner cutting, small steps up and down): the raw node path. */
  path(from: Vec3, goal: number): number[] | null {
    const start = this.nearest(from, 0.5);
    if (start < 0) return null;
    const g = new Float64Array(this.nodes.length).fill(Infinity);
    const prev = new Int32Array(this.nodes.length).fill(-1);
    const done = new Uint8Array(this.nodes.length);
    const end = this.pos(goal);
    const h = (n: number) => {
      const q = this.pos(n);
      return Math.hypot(q[0] - end[0], q[1] - end[1], q[2] - end[2]) / CELL;
    };
    const open: { n: number; f: number }[] = [{ n: start, f: h(start) }];
    g[start] = 0;
    while (open.length > 0) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k]!.f < open[bi]!.f) bi = k;
      const { n } = open[bi]!;
      open[bi] = open[open.length - 1]!;
      open.pop();
      if (done[n]) continue;
      done[n] = 1;
      if (n === goal) break;
      const { i, j, y } = this.nodes[n]!;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const m = this.find(i + di, j + dj, y, di && dj ? STEP_UP * Math.SQRT2 : STEP_UP);
          if (m < 0) continue;
          if (di && dj && (this.find(i + di, j, y, STEP_UP) < 0 || this.find(i, j + dj, y, STEP_UP) < 0)) continue;
          const cost = g[n]! + (di && dj ? Math.SQRT2 : 1);
          if (cost < g[m]!) {
            g[m] = cost;
            prev[m] = n;
            open.push({ n: m, f: cost + h(m) });
          }
        }
      }
    }
    if (!done[goal]) return null;
    const out: number[] = [];
    for (let n = goal; n !== -1; n = prev[n]!) out.push(n);
    return out.reverse();
  }

  /** Waypoints along a node path: from each point, the farthest one still in a clear line. */
  straighten(path: number[]): Vec3[] {
    const pts = path.map((n) => this.pos(n));
    const out: Vec3[] = [pts[0]!];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.clear(pts[a]!, pts[b]!)) b--;
      out.push(pts[b]!);
      a = b;
    }
    return out;
  }

  private clear(a: Vec3, b: Vec3): boolean {
    const n = Math.ceil(flat(a, b) / (CELL / 2));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const i = Math.round((a[0] + (b[0] - a[0]) * t - this.x0) / CELL);
      const j = Math.round((a[2] + (b[2] - a[2]) * t - this.z0) / CELL);
      if (this.find(i, j, a[1] + (b[1] - a[1]) * t, 0.2) < 0) return false;
    }
    return true;
  }
}

/** Walks a player to `feet` in small steps, the way a client would report it. */
function walk(g: DinnerGame, id: string, feet: Vec3) {
  for (let i = 0; i < 600; i++) {
    const at = g.feetOf(id)!;
    const d = flat(feet, at);
    if (d < 0.05) return;
    const k = Math.min(d, 0.15) / d;
    const y = at[1] + (feet[1] - at[1]) * k;
    g.command(id, { c: 'move', x: at[0] + (feet[0] - at[0]) * k, y, z: at[2] + (feet[2] - at[2]) * k, yaw: 0, pitch: 0, crouch: false });
    g.tick(1 / 30);
  }
}

const use = (g: DinnerGame, id: string) => g.command('ada', { c: 'interact', target: { kind: 'thing', id } });

/**
 * Walks from wherever the player is to a node the way a player would: along the grid's path,
 * stopping to open any shut door on the way. Returns where they end up.
 */
function goTo(g: DinnerGame, nav: NavGrid, layout: Layout, goal: number, what: string): Vec3 {
  for (let opened = 0; opened <= layout.doors.length; opened++) {
    const path = nav.path(g.feetOf('ada')!, goal);
    expect(path, `no way to ${what}`).not.toBeNull();
    const shut = (n: number) => {
      const p = nav.pos(n);
      return layout.doors.find((d) => d.leaf && !g.isDoorOpen(d.id) && flat(p, d.position) < 0.4 && Math.abs(p[1] - d.position[1]) < 0.5);
    };
    const k = path!.findIndex((n) => shut(n) !== undefined);
    if (k < 0) {
      for (const p of nav.straighten(path!)) walk(g, 'ada', p);
      break;
    }
    // Walk up to the door, open it, carry on.
    const door = shut(path![k]!)!;
    for (const p of nav.straighten(path!.slice(0, Math.max(1, k - 5)))) walk(g, 'ada', p);
    use(g, door.id);
    expect(g.isDoorOpen(door.id), `opened the ${door.id} door on the way to ${what}`).toBe(true);
  }
  const end = g.feetOf('ada')!;
  const target = nav.pos(goal);
  expect(flat(end, target) + Math.abs(end[1] - target[1]), `stuck on the way to ${what} at ${end.map((v) => v.toFixed(2)).join(', ')}`).toBeLessThan(0.25);
  return end;
}

/** Walks up to an interactable and checks it is within reach and in plain sight from there. */
function goToThing(g: DinnerGame, nav: NavGrid, layout: Layout, id: string): Vec3 {
  const p = thing(layout, id);
  const goal = nav.nearest(p, 1.5, 2.2);
  expect(goal, `nowhere to stand by ${id}`).toBeGreaterThanOrEqual(0);
  const feet = goTo(g, nav, layout, goal, id);
  const eye = up(feet, PLAYER.eyeHeight);
  const len = Math.hypot(eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]);
  expect(len, `${id} out of reach`).toBeLessThanOrEqual(PLAYER.reach);
  const hit = firstHit(RAPIER, nav.world, eye, p);
  expect(hit === null || hit.distance > len - 0.12, `${id} hidden behind something`).toBe(true);
  return feet;
}

const heldProp = (g: DinnerGame) => {
  const held = g.view().players[0]!.held;
  return g.view().props.find((p) => p.id === held);
};

// ---------------------------------------------------------------------------------------------

describe.each(HOUSES)('$name', ({ layout }) => {
  const graph = buildRoomGraph(layout);
  const roomIds = new Set(layout.rooms.map((r) => r.id));

  it('has the rooms, doors, interactables, sockets, seats and spawns the game uses', () => {
    for (const id of REQUIRED_ROOMS) expect(roomIds, `room ${id}`).toContain(id);

    const front = layout.doors.find((d) => d.id === 'front');
    expect(front).toBeDefined();
    expect([front!.a, front!.b].sort()).toEqual(['hall', 'outside']);
    expect(front!.leaf).toBe(true);
    expect(front!.open).toBe(false);
    expect(new Set(layout.doors.map((d) => d.id)).size).toBe(layout.doors.length);
    const colliders = new Set(layout.colliders.map((c) => c.name));
    for (const d of layout.doors) {
      expect(roomIds, `door ${d.id} a`).toContain(d.a);
      expect(roomIds, `door ${d.id} b`).toContain(d.b);
      expect(d.a).not.toBe(d.b);
      if (!d.leaf) continue;
      expect(layout.interactables.find((i) => i.id === d.id)?.kind, `interact_${d.id}`).toBe('door');
      expect(colliders, `col_box_doorleaf_${d.id}`).toContain(`col_box_doorleaf_${d.id}`);
    }
    for (const it of layout.interactables.filter((i) => i.kind === 'door')) {
      expect(layout.doors.find((d) => d.id === it.id)?.leaf, `door interactable ${it.id} has a leaf door`).toBe(true);
    }

    for (const [id, kind] of Object.entries(REQUIRED_THINGS)) {
      expect(layout.interactables.find((i) => i.id === id)?.kind, `interact_${id}`).toBe(kind);
    }
    for (const id of REQUIRED_SOCKETS) expect(findSocket(layout, id), `socket_${id}`).toBeDefined();
    for (const s of socketsWithPrefix(layout, 'room_light_')) {
      const room = s.id.slice('room_light_'.length);
      expect(room === 'porch' || roomIds.has(room), `${s.id} names a room`).toBe(true);
    }

    expect(layout.seats).toHaveLength(8);
    for (const seat of layout.seats) {
      const plate = sock(layout, `plate_${seat.id}`);
      expect(flat(plate, seat.position), `plate_${seat.id} in front of its seat`).toBeLessThan(0.8);
      expect(plate[1]).toBeGreaterThan(0.6);
      expect(plate[1]).toBeLessThan(1.0);
    }
    expect(ringSeats(layout)).toHaveLength(8);

    expect(layout.spawns.length).toBeGreaterThanOrEqual(6);
    for (const [i, s] of layout.spawns.entries()) {
      for (const o of layout.spawns.slice(i + 1)) expect(flat(s.position, o.position), `spawns ${s.id} and ${o.id}`).toBeGreaterThan(PLAYER.radius * 3);
    }
  });

  it('puts every seat, socket, interactable and spawn inside a room (and the right one)', () => {
    const where = (p: Vec3) => roomAt(graph, up(p, 0.02));
    for (const s of layout.seats) expect(where(s.position), `seat_${s.id}`).toBe('dining');
    for (const s of layout.spawns) expect(where(s.position), `spawn_${s.id}`).toBe('outside');
    for (const s of layout.sockets) expect(where(s.position), `socket_${s.id}`).not.toBeNull();
    for (const i of layout.interactables) expect(where(i.position), `interact_${i.id}`).not.toBeNull();
    for (const [id, room] of Object.entries(ROOM_OF)) expect(where(sock(layout, id)), `socket_${id}`).toBe(room);
    for (const [id, room] of Object.entries(THING_ROOM)) expect(where(thing(layout, id)), `interact_${id}`).toBe(room);
  });

  it('joins the rooms only through doorways, into one connected graph', () => {
    for (const d of layout.doors) {
      for (const id of [d.a, d.b]) {
        const near = Math.min(...layout.rooms.filter((r) => r.id === id).map((r) => toBox(r, d.position)));
        expect(near, `door ${d.id} on the edge of ${id}`).toBeLessThan(0.3);
      }
    }
    // Different rooms only share walls: no box reaches more than a wall's thickness into another.
    for (const [i, r] of layout.rooms.entries()) {
      for (const o of layout.rooms.slice(i + 1)) {
        if (o.id === r.id) continue;
        const overlap = [0, 1, 2].map((k) => r.halfExtents[k]! + o.halfExtents[k]! - Math.abs(r.center[k]! - o.center[k]!));
        expect(Math.min(...overlap), `${r.id} and ${o.id} overlap`).toBeLessThan(0.3);
      }
    }
    const seen = new Set(['outside']);
    const queue = ['outside'];
    while (queue.length > 0) {
      for (const d of graph.exits.get(queue.shift()!) ?? []) {
        for (const next of [d.a, d.b]) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].sort()).toEqual([...roomIds].sort());
  });

  it('walks guests from the front door to every standing spot over open floor', () => {
    const world = openHouse(layout);
    const p2 = sock(layout, 'path_2');
    for (const stand of STANDS) {
      const at = sock(layout, stand);
      // The same route DinnerGame.guestPose follows (south of path_2 goes via path_s).
      const pts = ['guest_door', 'path_0', 'path_1', 'path_2', at[2] > p2[2] ? 'path_s' : 'path_n'].map((id) => sock(layout, id));
      pts.push(at);
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1]!;
        const b = pts[k]!;
        const n = Math.max(1, Math.ceil(flat(a, b) / 0.1));
        for (let s = 0; s <= n; s++) {
          const t = s / n;
          const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          const where = `${stand} route at ${p.map((v) => v.toFixed(2)).join(', ')}`;
          expect(roomAt(graph, up(p, 0.1)), where).not.toBeNull();
          expect(blocked(world, p, 0.2, 1.7), `${where} runs into something`).toBe(false);
        }
      }
    }
    world.free();
  });

  it('a host walks from the van through the front door to the table, cooks at every station and fetches the wine', () => {
    const g = new DinnerGame(RAPIER, { layout, newSeed: () => 'WALK1' });
    g.addPlayer('ada', 'Ada');
    g.command('ada', { c: 'start' });
    g.command('ada', { c: 'skip' }); // booking → prep
    const d = g.dinner!;
    for (let i = 0; i < d.menu.length; i++) d.menu[i] = ['garlic_bread', 'steak', 'salad'];
    const world = openHouse(layout, true);
    const nav = new NavGrid(world, graph);
    const node = (p: Vec3, what: string) => {
      const n = nav.nearest(p, 0.6);
      expect(n, `room to stand at ${what}`).toBeGreaterThanOrEqual(0);
      return n;
    };

    // Van → doorstep → open the front door → into the dining room.
    goTo(g, nav, layout, node(sock(layout, 'guest_door'), 'the doorstep'), 'the doorstep');
    expect(g.isDoorOpen('front')).toBe(false);
    use(g, 'front');
    expect(g.isDoorOpen('front')).toBe(true);
    const inDining = goTo(g, nav, layout, node(sock(layout, 'path_2'), 'path_2'), 'the dining room');
    expect(roomAt(graph, up(inDining, 0.1))).toBe('dining');

    // Garlic bread: fridge → chop → oven → pass.
    goToThing(g, nav, layout, 'fridge');
    g.command('ada', { c: 'take', from: 'fridge', dish: 'garlic_bread' });
    const bread = heldProp(g);
    expect(bread?.dish).toBe('garlic_bread');
    for (const station of dishById('garlic_bread').steps) {
      goToThing(g, nav, layout, station);
      use(g, station);
      expect(g.view().props.find((p) => p.id === bread!.id)?.at, `placed on ${station}`).toBe(station);
      if (station === 'chop') for (let i = 0; i < d.tuning.chopStrokes; i++) use(g, station);
      else g.advance(d.tuning.ovenSeconds + 0.5);
      use(g, station); // pick it back up
      expect(heldProp(g)?.id).toBe(bread!.id);
    }
    goToThing(g, nav, layout, 'pass');
    use(g, 'pass');
    expect(heldProp(g)?.plated, 'plated at the pass').toBe(true);
    g.command('ada', { c: 'drop' });

    // A steak on each burner.
    goToThing(g, nav, layout, 'fridge');
    g.command('ada', { c: 'take', from: 'fridge', dish: 'steak' });
    const steak = heldProp(g)!;
    for (const hob of ['hob_0', 'hob_1']) {
      goToThing(g, nav, layout, hob);
      use(g, hob);
      expect(g.view().props.find((p) => p.id === steak.id)?.at, `placed on ${hob}`).toBe(hob);
      use(g, hob);
      expect(heldProp(g)?.id).toBe(steak.id);
    }
    g.command('ada', { c: 'drop' });

    // A clean plate off the stack.
    goToThing(g, nav, layout, 'plates');
    use(g, 'plates');
    expect(heldProp(g)?.kind).toBe('plate');
    g.command('ada', { c: 'drop' });

    // A bottle from the wine rack (down the cellar stairs, where there is a cellar).
    const atRack = goToThing(g, nav, layout, 'wine_rack');
    expect(roomAt(graph, up(atRack, 0.1))).toBe(roomAt(graph, thing(layout, 'wine_rack')));
    use(g, 'wine_rack');
    expect(heldProp(g)?.kind).toBe('bottle');
    g.dispose();
    world.free();
  });

  it('runs a whole idle dinner: guests let themselves in, stand, then sit', () => {
    const g = new DinnerGame(RAPIER, { layout, newSeed: () => 'IDLE1' });
    g.addPlayer('ada', 'Ada');
    g.command('ada', { c: 'start' });
    expect(g.phase).toBe('dinner');
    const stands = STANDS.map((s) => sock(layout, s));
    const seats = ringSeats(layout).map((s) => s.position);
    let stood = 0;
    let sat = 0;
    for (let t = 0; t < 900; t += 1) {
      g.advance(1, 1 / 10);
      for (const gv of g.view().dinner.guests) {
        if (gv.where === 'outside' || gv.where === 'gone' || gv.chasing) continue;
        const p: Vec3 = [gv.x, 0.1, gv.z];
        expect(roomAt(graph, p), `guest ${gv.id} (${gv.where}) at ${gv.x}, ${gv.z} is inside the house`).not.toBeNull();
        if (gv.where === 'standing') {
          expect(Math.min(...stands.map((s) => flat(s, p)))).toBeLessThan(0.05);
          stood++;
        } else if (gv.where === 'seated') {
          expect(Math.min(...seats.map((s) => flat(s, p)))).toBeLessThan(0.05);
          sat++;
        }
      }
    }
    expect(stood, 'guests reached their standing spots').toBeGreaterThan(0);
    expect(sat, 'guests sat down').toBeGreaterThan(0);
    g.dispose();
  });
});
