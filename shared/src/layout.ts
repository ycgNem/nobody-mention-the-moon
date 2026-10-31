// Gameplay data exported by the Blender build next to each .glb (see docs/TECH.md "Art pipeline").
// Coordinates are already converted to glTF/Three.js space: Y up, meters.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface BoxCollider {
  name: string;
  shape: 'box';
  center: Vec3;
  halfExtents: Vec3;
  rotation: Quat;
}

export interface CapsuleCollider {
  name: string;
  shape: 'capsule';
  center: Vec3;
  halfHeight: number;
  radius: number;
  rotation: Quat;
}

export type LayoutCollider = BoxCollider | CapsuleCollider;

export interface LayoutSeat {
  id: string;
  position: Vec3;
  /** Yaw in radians; 0 faces -Z (Three.js forward). */
  yaw: number;
}

export interface LayoutRoom {
  id: string;
  center: Vec3;
  halfExtents: Vec3;
}

export interface LayoutDoor {
  id: string;
  a: string;
  b: string;
  position: Vec3;
  /** Has a door leaf that opens and shuts (mesh + collider `doorleaf_<id>`); false = archway. */
  leaf: boolean;
  /** State when a dinner starts. */
  open: boolean;
}

export interface LayoutInteractable {
  id: string;
  kind: string;
  position: Vec3;
}

export interface LayoutSpawn {
  id: string;
  position: Vec3;
  yaw: number;
}

/** A named anchor point (`socket_*` empty without a parent): prop homes, plate spots, paths. */
export interface LayoutSocket {
  id: string;
  position: Vec3;
  yaw: number;
}

export interface Layout {
  version: 2;
  asset: string;
  colliders: LayoutCollider[];
  seats: LayoutSeat[];
  rooms: LayoutRoom[];
  doors: LayoutDoor[];
  interactables: LayoutInteractable[];
  spawns: LayoutSpawn[];
  sockets: LayoutSocket[];
}

export class LayoutError extends Error {}

type Obj = Record<string, unknown>;

function fail(path: string, msg: string): never {
  throw new LayoutError(`${path}: ${msg}`);
}

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected object');
  return v as Obj;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'expected array');
  return v;
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected finite number');
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(path, 'expected non-empty string');
  return v;
}

function tuple<N extends 3 | 4>(v: unknown, n: N, path: string): N extends 3 ? Vec3 : Quat {
  const a = arr(v, path);
  if (a.length !== n) fail(path, `expected ${n} numbers`);
  return a.map((x, i) => num(x, `${path}[${i}]`)) as N extends 3 ? Vec3 : Quat;
}

function collider(v: unknown, path: string): LayoutCollider {
  const o = obj(v, path);
  const base = {
    name: str(o.name, `${path}.name`),
    center: tuple(o.center, 3, `${path}.center`),
    rotation: tuple(o.rotation, 4, `${path}.rotation`),
  };
  if (o.shape === 'box') {
    return { ...base, shape: 'box', halfExtents: tuple(o.halfExtents, 3, `${path}.halfExtents`) };
  }
  if (o.shape === 'capsule') {
    return {
      ...base,
      shape: 'capsule',
      halfHeight: num(o.halfHeight, `${path}.halfHeight`),
      radius: num(o.radius, `${path}.radius`),
    };
  }
  return fail(`${path}.shape`, `unknown shape ${String(o.shape)}`);
}

/** Validates untrusted JSON (fetched or read from disk) into a Layout. Throws LayoutError. */
export function parseLayout(json: unknown): Layout {
  const o = obj(json, 'layout');
  if (o.version !== 1 && o.version !== 2) fail('layout.version', `unsupported version ${String(o.version)}`);
  const list = <T>(key: string, each: (v: unknown, path: string) => T): T[] =>
    arr(o[key], `layout.${key}`).map((v, i) => each(v, `layout.${key}[${i}]`));

  const anchor = (v: unknown, p: string): LayoutSocket => {
    const s = obj(v, p);
    return { id: str(s.id, `${p}.id`), position: tuple(s.position, 3, `${p}.position`), yaw: num(s.yaw, `${p}.yaw`) };
  };
  return {
    version: 2,
    asset: str(o.asset, 'layout.asset'),
    colliders: list('colliders', collider),
    seats: list('seats', (v, p) => {
      const s = obj(v, p);
      return { id: str(s.id, `${p}.id`), position: tuple(s.position, 3, `${p}.position`), yaw: num(s.yaw, `${p}.yaw`) };
    }),
    rooms: list('rooms', (v, p) => {
      const r = obj(v, p);
      return {
        id: str(r.id, `${p}.id`),
        center: tuple(r.center, 3, `${p}.center`),
        halfExtents: tuple(r.halfExtents, 3, `${p}.halfExtents`),
      };
    }),
    doors: list('doors', (v, p) => {
      const d = obj(v, p);
      return {
        id: str(d.id, `${p}.id`),
        a: str(d.a, `${p}.a`),
        b: str(d.b, `${p}.b`),
        position: tuple(d.position, 3, `${p}.position`),
        leaf: d.leaf === true,
        open: d.open !== false,
      };
    }),
    interactables: list('interactables', (v, p) => {
      const it = obj(v, p);
      return {
        id: str(it.id, `${p}.id`),
        kind: str(it.kind, `${p}.kind`),
        position: tuple(it.position, 3, `${p}.position`),
      };
    }),
    spawns: list('spawns', anchor),
    // Version 1 layouts (M0 greybox) had no sockets.
    sockets: o.version === 1 ? [] : list('sockets', anchor),
  };
}

/** Seats sorted into a clockwise ring as seen from above (north at the top). Sim seat i = ring[i]. */
export function ringSeats(layout: Layout): LayoutSeat[] {
  const seats = layout.seats;
  if (seats.length === 0) return [];
  const cx = seats.reduce((s, x) => s + x.position[0], 0) / seats.length;
  const cz = seats.reduce((s, x) => s + x.position[2], 0) / seats.length;
  return [...seats].sort(
    (a, b) => Math.atan2(a.position[2] - cz, a.position[0] - cx) - Math.atan2(b.position[2] - cz, b.position[0] - cx),
  );
}

export function findSocket(layout: Layout, id: string): LayoutSocket | undefined {
  return layout.sockets.find((s) => s.id === id);
}

export function requireSocket(layout: Layout, id: string): LayoutSocket {
  const s = findSocket(layout, id);
  if (!s) throw new LayoutError(`${layout.asset}: missing socket_${id}`);
  return s;
}

/** Sockets whose id starts with `prefix`, sorted by id. */
export function socketsWithPrefix(layout: Layout, prefix: string): LayoutSocket[] {
  return layout.sockets.filter((s) => s.id.startsWith(prefix)).sort((a, b) => a.id.localeCompare(b.id));
}
