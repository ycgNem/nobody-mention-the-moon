// What the player is aiming at: a guest, a thing in the room, or an empty seat.
// First person picks by angle from the view direction; overhead picks by mouse distance.

import * as THREE from 'three';

export type Focus =
  | { kind: 'guest'; id: number; point: THREE.Vector3 }
  | { kind: 'thing'; id: string; what: string; point: THREE.Vector3 }
  | { kind: 'seat'; seat: number; point: THREE.Vector3 }
  | { kind: 'neighbor'; point: THREE.Vector3 };

export interface Candidate {
  focus: Focus;
  /** Rough radius for angular picking. */
  radius: number;
  maxDistance: number;
}

const MIN_ANGLE = THREE.MathUtils.degToRad(5);
const OVERHEAD_PICK_PX = 60;

const forward = new THREE.Vector3();
const toPoint = new THREE.Vector3();
const projected = new THREE.Vector3();

export function pickFirstPerson(camera: THREE.Camera, candidates: Candidate[]): Focus | null {
  camera.updateMatrixWorld(); // the camera was just moved this frame; don't aim with last frame's view
  camera.getWorldDirection(forward);
  let best: Focus | null = null;
  let bestScore = 1;
  for (const c of candidates) {
    toPoint.copy(c.focus.point).sub(camera.position);
    const dist = toPoint.length();
    if (dist > c.maxDistance || dist < 0.01) continue;
    const angle = toPoint.normalize().angleTo(forward);
    const allowed = Math.max(MIN_ANGLE, Math.atan(c.radius / dist));
    const score = angle / allowed;
    if (score < bestScore) {
      bestScore = score;
      best = c.focus;
    }
  }
  return best;
}

export function pickOverhead(
  camera: THREE.Camera,
  candidates: Candidate[],
  mouse: { x: number; y: number },
  size: { width: number; height: number },
): Focus | null {
  camera.updateMatrixWorld();
  let best: Focus | null = null;
  let bestDist = OVERHEAD_PICK_PX;
  for (const c of candidates) {
    projected.copy(c.focus.point).project(camera);
    const sx = ((projected.x + 1) / 2) * size.width;
    const sy = ((1 - projected.y) / 2) * size.height;
    const d = Math.hypot(sx - mouse.x, sy - mouse.y);
    if (d < bestDist) {
      bestDist = d;
      best = c.focus;
    }
  }
  return best;
}

export function sameFocus(a: Focus | null, b: Focus | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'guest' && b.kind === 'guest') return a.id === b.id;
  if (a.kind === 'thing' && b.kind === 'thing') return a.id === b.id;
  if (a.kind === 'seat' && b.kind === 'seat') return a.seat === b.seat;
  return true;
}
