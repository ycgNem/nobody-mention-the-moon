// The player you control: predicted locally with the same Rapier code the server uses.

import RAPIER, { type KinematicCharacterController, type World } from '@dimforge/rapier3d-compat';
import {
  NET,
  PLAYER,
  PLAYER_CENTER_OFFSET,
  buildStaticWorld,
  createCharacterController,
  createPlayerBody,
  movePlayer,
  teleportPlayer,
  type Layout,
  type PlayerBody,
  type Vec3,
} from '@moon/shared';
import type { MoveIntent } from '../input/controls.ts';

/** How long the server must disagree before we snap to it (absorbs normal latency). */
const SNAP_AFTER_S = 0.3;

export class LocalPlayer {
  private readonly world: World;
  private readonly cc: KinematicCharacterController;
  private readonly body: PlayerBody;
  private disagreeFor = 0;

  constructor(layout: Layout, feet: Vec3) {
    this.world = buildStaticWorld(RAPIER, layout);
    this.cc = createCharacterController(this.world);
    this.body = createPlayerBody(RAPIER, this.world, feet);
    this.world.step();
  }

  get feet(): Vec3 {
    const [x, y, z] = this.body.position;
    return [x, y - PLAYER_CENTER_OFFSET, z];
  }

  update(dt: number, intent: MoveIntent): void {
    const speed = intent.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    movePlayer(this.cc, this.body, intent.x * speed * dt, intent.z * speed * dt, dt);
    this.world.step();
  }

  /** Called with the server's authoritative feet position for us. Returns true if we snapped. */
  reconcile(server: Vec3, dt: number): boolean {
    const [x, y, z] = this.feet;
    const off = Math.hypot(server[0] - x, server[1] - y, server[2] - z);
    this.disagreeFor = off > NET.correctionSnapDistance ? this.disagreeFor + dt : 0;
    if (this.disagreeFor < SNAP_AFTER_S) return false;
    teleportPlayer(this.body, [server[0], server[1] + PLAYER_CENTER_OFFSET, server[2]]);
    this.disagreeFor = 0;
    return true;
  }
}
