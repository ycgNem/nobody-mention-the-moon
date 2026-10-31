// Rapier setup shared by client prediction and server validation, so both move players identically.
// Rapier is passed in rather than imported so each side controls WASM init.

import type RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, KinematicCharacterController, World } from '@dimforge/rapier3d-compat';
import type { Layout, Vec3 } from './layout.ts';
import { PLAYER } from './tuning.ts';

type Rapier = typeof RAPIER;

/** World with gravity off: players are kinematic and fall via movePlayer(). */
export function buildStaticWorld(R: Rapier, layout: Layout): World {
  return buildHouseWorld(R, layout, 0).world;
}

/** Character movement ignores loose props (dynamic) and held props (kinematic). */
export const PLAYER_MOVE_FILTER = 2 | 4 | 8; // EXCLUDE_KINEMATIC | EXCLUDE_DYNAMIC | EXCLUDE_SENSORS
/** Line of sight: walls, furniture and players block it; loose and held props don't. */
export const SIGHT_FILTER = 2 | 4 | 8;

/**
 * The house's static colliders, by name (door leaves are toggled by name when doors open).
 * `gravity` is for loose props; players are moved kinematically and ignore it.
 */
export function buildHouseWorld(R: Rapier, layout: Layout, gravity = -9.81): { world: World; named: Map<string, Collider> } {
  const world = new R.World({ x: 0, y: gravity, z: 0 });
  const named = new Map<string, Collider>();
  for (const c of layout.colliders) {
    const [qx, qy, qz, qw] = c.rotation;
    const desc =
      c.shape === 'box'
        ? R.ColliderDesc.cuboid(...c.halfExtents)
        : R.ColliderDesc.capsule(c.halfHeight, c.radius);
    desc.setTranslation(...c.center).setRotation({ x: qx, y: qy, z: qz, w: qw });
    named.set(c.name, world.createCollider(desc));
  }
  return { world, named };
}

/** Distance from `from` to the first wall/body along the segment to `to`, or null if clear. */
export function firstHit(R: Rapier, world: World, from: Vec3, to: Vec3, exclude?: Collider): { distance: number; collider: Collider } | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return null;
  const ray = new R.Ray({ x: from[0], y: from[1], z: from[2] }, { x: dx / len, y: dy / len, z: dz / len });
  const hit = world.castRay(ray, len, true, SIGHT_FILTER, undefined, exclude);
  return hit ? { distance: hit.timeOfImpact, collider: hit.collider } : null;
}

export interface PlayerBody {
  collider: Collider;
  /** Capsule center. */
  position: Vec3;
  velocityY: number;
  grounded: boolean;
}

/** Capsule center height above the feet. */
export const PLAYER_CENTER_OFFSET = PLAYER.halfHeight + PLAYER.radius;

export function createCharacterController(world: World): KinematicCharacterController {
  const cc = world.createCharacterController(0.02);
  cc.setUp({ x: 0, y: 1, z: 0 });
  cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
  cc.enableAutostep(PLAYER.stepHeight, 0.2, false);
  cc.enableSnapToGround(PLAYER.snapToGround);
  return cc;
}

/** `feet` is the spawn point on the floor. */
export function createPlayerBody(R: Rapier, world: World, feet: Vec3): PlayerBody {
  const position: Vec3 = [feet[0], feet[1] + PLAYER_CENTER_OFFSET, feet[2]];
  const collider = world.createCollider(
    R.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius).setTranslation(...position),
  );
  return { collider, position, velocityY: 0, grounded: false };
}

export function removePlayerBody(world: World, body: PlayerBody): void {
  world.removeCollider(body.collider, false);
}

/**
 * Moves the capsule by a horizontal delta (already scaled by dt) plus gravity, sliding along
 * level geometry. Mutates and returns `body`.
 */
export function movePlayer(
  cc: KinematicCharacterController,
  body: PlayerBody,
  dx: number,
  dz: number,
  dt: number,
): PlayerBody {
  body.velocityY = body.grounded
    ? -1 // a small push keeps snap-to-ground working on slopes and steps
    : Math.max(body.velocityY - PLAYER.gravity * dt, -PLAYER.maxFallSpeed);

  cc.computeColliderMovement(body.collider, { x: dx, y: body.velocityY * dt, z: dz }, PLAYER_MOVE_FILTER);
  const m = cc.computedMovement();
  body.grounded = cc.computedGrounded();
  if (body.grounded) body.velocityY = 0;

  body.position = [body.position[0] + m.x, body.position[1] + m.y, body.position[2] + m.z];
  body.collider.setTranslation({ x: body.position[0], y: body.position[1], z: body.position[2] });
  return body;
}

/**
 * Server-side: moves the capsule toward where the client says its feet are, through the
 * world's colliders. Vertical motion (jumps, falls) is the client's; the server only checks it
 * doesn't pass through anything. Returns the new feet position.
 */
export function movePlayerToward(cc: KinematicCharacterController, body: PlayerBody, feet: Vec3, maxStep: number): Vec3 {
  let dx = feet[0] - body.position[0];
  let dz = feet[2] - body.position[2];
  const dist = Math.hypot(dx, dz);
  if (dist > maxStep) {
    dx *= maxStep / dist;
    dz *= maxStep / dist;
  }
  const dy = Math.max(-maxStep * 3, Math.min(maxStep, feet[1] + PLAYER_CENTER_OFFSET - body.position[1]));
  cc.computeColliderMovement(body.collider, { x: dx, y: dy, z: dz }, PLAYER_MOVE_FILTER);
  const m = cc.computedMovement();
  body.position = [body.position[0] + m.x, body.position[1] + m.y, body.position[2] + m.z];
  body.collider.setTranslation({ x: body.position[0], y: body.position[1], z: body.position[2] });
  return [body.position[0], body.position[1] - PLAYER_CENTER_OFFSET, body.position[2]];
}

/** Puts the capsule at an exact position (used for server corrections and spawns). */
export function teleportPlayer(body: PlayerBody, center: Vec3): void {
  body.position = [...center];
  body.velocityY = 0;
  body.collider.setTranslation({ x: center[0], y: center[1], z: center[2] });
}
