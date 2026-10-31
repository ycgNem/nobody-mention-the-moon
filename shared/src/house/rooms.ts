// The house as a graph of rooms joined by doorways (docs/TECH.md "Voice"). The same graph decides
// which guests hear a player (earshot) and how muffled players sound to each other, so what you
// hear lines up with what the guests hear. Pure functions over the layout: no physics.

import type { Layout, LayoutDoor, LayoutRoom, Vec3 } from '../layout.ts';
import { SOUND } from '../tuning.ts';

export interface RoomGraph {
  rooms: LayoutRoom[];
  doors: LayoutDoor[];
  /** room id → doorways leading out of it. */
  exits: Map<string, LayoutDoor[]>;
}

/** Which doors are open right now (archways are always open). */
export type DoorState = (doorId: string) => boolean;

export function buildRoomGraph(layout: Layout): RoomGraph {
  const exits = new Map<string, LayoutDoor[]>();
  for (const r of layout.rooms) exits.set(r.id, exits.get(r.id) ?? []);
  for (const d of layout.doors) {
    for (const id of [d.a, d.b]) {
      const list = exits.get(id) ?? [];
      list.push(d);
      exits.set(id, list);
    }
  }
  return { rooms: layout.rooms, doors: layout.doors, exits };
}

function inBox(r: LayoutRoom, p: Vec3, pad: number): boolean {
  return (
    Math.abs(p[0] - r.center[0]) <= r.halfExtents[0] + pad &&
    Math.abs(p[1] - r.center[1]) <= r.halfExtents[1] + pad &&
    Math.abs(p[2] - r.center[2]) <= r.halfExtents[2] + pad
  );
}

/** The room containing `p` (smallest box wins where volumes touch), or null outside every room. */
export function roomAt(g: RoomGraph, p: Vec3): string | null {
  let best: LayoutRoom | null = null;
  let bestVolume = Infinity;
  for (const r of g.rooms) {
    if (!inBox(r, p, 0.05)) continue;
    const v = r.halfExtents[0] * r.halfExtents[1] * r.halfExtents[2];
    if (v < bestVolume) {
      best = r;
      bestVolume = v;
    }
  }
  return best?.id ?? null;
}

export interface SoundPath {
  /** Walking distance through doorways, in meters. */
  distance: number;
  /** Doorways crossed. */
  hops: number;
  /** Closed doors crossed. */
  closed: number;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Door empties sit on the threshold; sound goes through at head height. */
const DOOR_EAR_HEIGHT = 1.4;
const through = (d: LayoutDoor): Vec3 => [d.position[0], d.position[1] + DOOR_EAR_HEIGHT, d.position[2]];

/**
 * Cheapest sound path from `a` to `b`: straight line inside one room, otherwise via doorways.
 * Closed doors are passable but cost `SOUND.closedDoorPenalty` meters each, so sound prefers
 * open routes. Returns null if the rooms aren't connected or either point is outside the house.
 */
export function soundPath(g: RoomGraph, a: Vec3, b: Vec3, isOpen: DoorState): SoundPath | null {
  const ra = roomAt(g, a);
  const rb = roomAt(g, b);
  if (ra === null || rb === null) return null;
  if (ra === rb) return { distance: dist(a, b), hops: 0, closed: 0 };

  // Dijkstra over doorways. Node = a door we are standing in, entered from some room.
  interface Node {
    door: LayoutDoor;
    room: string;
    cost: number;
    distance: number;
    hops: number;
    closed: number;
  }
  const best = new Map<string, number>();
  const open: Node[] = [];
  const push = (door: LayoutDoor, from: Vec3, room: string, prev: Omit<Node, 'door' | 'room'>) => {
    const shut = door.leaf && !isOpen(door.id);
    const step = dist(from, through(door));
    const next: Node = {
      door,
      room: door.a === room ? door.b : door.a,
      distance: prev.distance + step,
      hops: prev.hops + 1,
      closed: prev.closed + (shut ? 1 : 0),
      cost: prev.cost + step + (shut ? SOUND.closedDoorPenalty : 0),
    };
    const key = `${door.id}>${next.room}`;
    if ((best.get(key) ?? Infinity) <= next.cost) return;
    best.set(key, next.cost);
    open.push(next);
  };
  for (const d of g.exits.get(ra) ?? []) push(d, a, ra, { cost: 0, distance: 0, hops: 0, closed: 0 });

  let result: SoundPath | null = null;
  let resultCost = Infinity;
  while (open.length > 0) {
    open.sort((x, y) => x.cost - y.cost);
    const n = open.shift()!;
    if (n.cost >= resultCost) break;
    if (n.room === rb) {
      const last = dist(through(n.door), b);
      if (n.cost + last < resultCost) {
        resultCost = n.cost + last;
        result = { distance: n.distance + last, hops: n.hops, closed: n.closed };
      }
      continue;
    }
    for (const d of g.exits.get(n.room) ?? []) {
      if (d.id !== n.door.id) push(d, through(n.door), n.room, n);
    }
  }
  return result;
}

/**
 * Can a guest at `listener` make out a player speaking at `speaker`? Open-route distance within
 * `earshot`, and no closed door in the way: the kitchen with its door shut is a safe place to
 * swear about the moon.
 */
export function inEarshot(g: RoomGraph, speaker: Vec3, listener: Vec3, isOpen: DoorState, earshot: number): boolean {
  const p = soundPath(g, speaker, listener, isOpen);
  return p !== null && p.closed === 0 && p.distance <= earshot;
}

export interface Muffling {
  /** Low-pass cutoff for voice chat, Hz. */
  cutoffHz: number;
  /** 0..1 extra gain on top of distance falloff (the panner handles plain distance). */
  gain: number;
  /** 0 clear … 1 through two closed doors: the same scale the audio engine's `muffle` uses. */
  muffle: number;
}

/** How one player sounds to another (or a sound source to a listener) through the house. */
export function muffling(g: RoomGraph, source: Vec3, listener: Vec3, isOpen: DoorState): Muffling {
  const p = soundPath(g, source, listener, isOpen);
  if (p === null) {
    // One of you is outside every room volume (e.g. mid-ramp): treat as next door.
    return { cutoffHz: SOUND.cutoffPerHop[1] ?? 2500, gain: 0.6, muffle: 0.35 };
  }
  const hopCut = SOUND.cutoffPerHop[Math.min(p.hops, SOUND.cutoffPerHop.length - 1)] ?? 20000;
  const cutoffHz = Math.max(SOUND.minCutoffHz, hopCut * SOUND.closedDoorCutoff ** p.closed);
  const gain = Math.max(0.05, SOUND.closedDoorGain ** p.closed * SOUND.hopGain ** p.hops);
  const muffle = Math.min(1, p.closed * 0.5 + p.hops * 0.12);
  return { cutoffHz, gain, muffle };
}
