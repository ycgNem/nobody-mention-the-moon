// Rapier setup shared by client prediction and server validation, so both move players identically.
// Rapier is passed in rather than imported so each side controls WASM init.

import type RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, KinematicCharacterController, World } from '@dimforge/rapier3d-compat';
import type { Layout, Vec3 } from './layout.ts';
import { PLAYER } from './tuning.ts';

type Rapier = typeof RAPIER;

/** World with gravity off: players are kinematic and fall via movePlayer(). */
export function buildStaticWorld(R: Rapier, layout: Layout): World {
  const world = new R.World({ x: 0, y: 0, z: 0 });
  for (const c of layout.colliders) {
    const [qx, qy, qz, qw] = c.rotation;
    const desc =
      c.shape === 'box'
        ? R.ColliderDesc.cuboid(...c.halfExtents)
        : R.ColliderDesc.capsule(c.halfHeight, c.radius);
    desc.setTranslation(...c.center).setRotation({ x: qx, y: qy, z: qz, w: qw });
    world.createCollider(desc);
  }
  return world;
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

  cc.computeColliderMovement(body.collider, { x: dx, y: body.velocityY * dt, z: dz });
  const m = cc.computedMovement();
  body.grounded = cc.computedGrounded();
  if (body.grounded) body.velocityY = 0;

  body.position = [body.position[0] + m.x, body.position[1] + m.y, body.position[2] + m.z];
  body.collider.setTranslation({ x: body.position[0], y: body.position[1], z: body.position[2] });
  return body;
}

/** Puts the capsule at an exact position (used for server corrections and spawns). */
export function teleportPlayer(body: PlayerBody, center: Vec3): void {
  body.position = [...center];
  body.velocityY = 0;
  body.collider.setTranslation({ x: center[0], y: center[1], z: center[2] });
}
