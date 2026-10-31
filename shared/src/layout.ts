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

export interface Layout {
  version: 1;
  asset: string;
  colliders: LayoutCollider[];
  seats: LayoutSeat[];
  rooms: LayoutRoom[];
  doors: LayoutDoor[];
  interactables: LayoutInteractable[];
  spawns: LayoutSpawn[];
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
  if (o.version !== 1) fail('layout.version', `unsupported version ${String(o.version)}`);
  const list = <T>(key: string, each: (v: unknown, path: string) => T): T[] =>
    arr(o[key], `layout.${key}`).map((v, i) => each(v, `layout.${key}[${i}]`));

  return {
    version: 1,
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
    spawns: list('spawns', (v, p) => {
      const s = obj(v, p);
      return { id: str(s.id, `${p}.id`), position: tuple(s.position, 3, `${p}.position`), yaw: num(s.yaw, `${p}.yaw`) };
    }),
  };
}
