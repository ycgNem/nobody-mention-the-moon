// The player you control: predicted locally with the same Rapier code the server uses.

import RAPIER, { type Collider, type KinematicCharacterController, type World } from '@dimforge/rapier3d-compat';
import {
  NET,
  PLAYER,
  PLAYER_CENTER_OFFSET,
  buildHouseWorld,
  createCharacterController,
  createPlayerBody,
  firstHit,
  movePlayer,
  teleportPlayer,
  type DoorView,
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
  private readonly named: Map<string, Collider>;
  private readonly doorOpen = new Map<string, boolean>();
  private disagreeFor = 0;
  crouching = false;
  /** Eye height eases between standing and crouched. */
  eye: number = PLAYER.eyeHeight;
  /** Caught in the chase: you sit at the table and watch. */
  frozen = false;

  constructor(layout: Layout, feet: Vec3) {
    const built = buildHouseWorld(RAPIER, layout, 0);
    this.world = built.world;
    this.named = built.named;
    this.cc = createCharacterController(this.world);
    this.body = createPlayerBody(RAPIER, this.world, feet);
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }

  get feet(): Vec3 {
    const [x, y, z] = this.body.position;
    return [x, y - PLAYER_CENTER_OFFSET, z];
  }

  get grounded(): boolean {
    return this.body.grounded;
  }

  update(dt: number, intent: MoveIntent, jump: boolean): void {
    if (this.frozen) return;
    this.crouching = intent.crouch;
    const speed = intent.crouch ? PLAYER.crouchSpeed : intent.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    if (jump && this.body.grounded && !intent.crouch) {
      this.body.velocityY = PLAYER.jumpSpeed;
      this.body.grounded = false;
    }
    movePlayer(this.cc, this.body, intent.x * speed * dt, intent.z * speed * dt, dt);
    this.world.step();
    const target = intent.crouch ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
    this.eye += (target - this.eye) * Math.min(1, dt * 12);
  }

  /** Matches door leaves to the game, so you can't predict your way through a shut door. */
  syncDoors(doors: DoorView[]): void {
    for (const d of doors) {
      if (this.doorOpen.get(d.id) === d.open) continue;
      this.doorOpen.set(d.id, d.open);
      this.named.get(`col_box_doorleaf_${d.id}`)?.setEnabled(!d.open);
    }
  }

  /** True if nothing solid (walls, furniture, shut doors) is between the two points. */
  canSee(from: Vec3, to: Vec3, slack = 0.15): boolean {
    const hit = firstHit(RAPIER, this.world, from, to, this.body.collider);
    if (!hit) return true;
    return hit.distance >= Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) - slack;
  }

  /** Called with the server's authoritative feet position for us. Returns true if we snapped. */
  reconcile(server: Vec3, dt: number): boolean {
    const [x, y, z] = this.feet;
    const off = Math.hypot(server[0] - x, server[1] - y, server[2] - z);
    this.disagreeFor = off > NET.correctionSnapDistance ? this.disagreeFor + dt : 0;
    if (this.disagreeFor < SNAP_AFTER_S) return false;
    this.teleport(server);
    this.disagreeFor = 0;
    return true;
  }

  teleport(feet: Vec3): void {
    teleportPlayer(this.body, [feet[0], feet[1] + PLAYER_CENTER_OFFSET, feet[2]]);
  }
}
