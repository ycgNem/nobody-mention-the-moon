// Makes the greybox room match the dinner's room state: curtains, mirror cover, lights,
// the moon rising, and Gary from next door standing in the doorway.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PALETTE, PLAYER, type RoomState } from '@moon/shared';
import type { House, Stage } from '../render/stage.ts';

const MOON_RISE_SECONDS = 5;
const MOON_RISE_DROP = 0.9;
/** Where Gary stands: just inside the front door (Three.js space). */
export const NEIGHBOR_SPOT = new THREE.Vector3(3.3, 0, -1.5);

export class RoomView {
  private readonly curtainsOpen: THREE.Object3D[];
  private readonly curtainClosed?: THREE.Object3D;
  private readonly mirrorCover?: THREE.Object3D;
  private readonly moon?: THREE.Object3D;
  private readonly moonHome: THREE.Vector3;
  private moonRise = 0;
  private readonly neighbor: THREE.Group;
  private readonly lampOn: number;
  private readonly fillOn: number;

  constructor(
    private readonly stage: Stage,
    private readonly house: House,
  ) {
    this.curtainsOpen = ['curtain_l', 'curtain_r'].flatMap((n) => house.byName(n) ?? []);
    this.curtainClosed = house.byName('curtain_closed');
    this.mirrorCover = house.byName('mirror_cover');
    this.moon = house.byName('moon');
    this.moonHome = this.moon?.position.clone() ?? new THREE.Vector3();
    this.lampOn = house.lamp?.intensity ?? 0;
    this.fillOn = stage.fill.intensity;
    this.neighbor = makeNeighbor();
    this.neighbor.visible = false;
    stage.scene.add(this.neighbor);
  }

  update(room: RoomState, dt: number): void {
    for (const c of this.curtainsOpen) c.visible = room.curtainsOpen;
    if (this.curtainClosed) this.curtainClosed.visible = !room.curtainsOpen;
    if (this.mirrorCover) this.mirrorCover.visible = room.mirrorCovered;

    if (this.moon) {
      this.moonRise = room.moonUp ? Math.min(1, this.moonRise + dt / MOON_RISE_SECONDS) : 0;
      this.moon.visible = room.moonUp;
      const eased = 1 - (1 - this.moonRise) ** 3;
      this.moon.position.copy(this.moonHome).y -= (1 - eased) * MOON_RISE_DROP;
    }

    const lights = room.lightsOn ? 1 : 0.12;
    if (this.house.lamp) this.house.lamp.intensity = this.lampOn * (room.lightsOn ? 1 : 0);
    this.stage.fill.intensity = this.fillOn * lights;

    // CSS2D labels only check their own `visible`, not their parents'.
    this.neighbor.traverse((o) => (o.visible = room.neighborPresent));
  }

  get neighborVisible(): boolean {
    return this.neighbor.visible;
  }
}

function makeNeighbor(): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(NEIGHBOR_SPOT);
  g.rotation.y = Math.PI / 2; // facing into the room (-X)
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.halfHeight * 2, 6, 12),
    new THREE.MeshStandardMaterial({ color: '#c9c3b5', roughness: 0.9 }),
  );
  body.position.y = PLAYER.halfHeight + PLAYER.radius;
  body.castShadow = true;
  g.add(body);
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.16, 0.08),
    new THREE.MeshStandardMaterial({ color: PALETTE.skin_host }),
  );
  face.position.set(0, PLAYER.eyeHeight - 0.05, -PLAYER.radius + 0.02);
  g.add(face);
  const tag = document.createElement('div');
  tag.className = 'nametag neighbor';
  tag.textContent = 'Gary (next door, human)';
  const label = new CSS2DObject(tag);
  label.position.y = PLAYER.eyeHeight + 0.45;
  g.add(label);
  return g;
}
