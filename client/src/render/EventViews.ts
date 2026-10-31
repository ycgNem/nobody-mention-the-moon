// What events bring into the house: the pizza driver and the Monster Hunter, the red wine stain on
// the tablecloth, lightning flashes, and the stone tint when a gorgon catches your eye.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { findSocket, type GameView, type Layout } from '@moon/shared';
import { Character } from './Character.ts';
import type { ModelLibrary } from './models.ts';
import type { Stage } from './stage.ts';

/** The stain sits this far to the side of the table's centre line, on the white cloth (not the runner). */
const STAIN_OFFSET = 0.3;
/** The tablecloth's thickness above the table collider. */
const CLOTH = 0.015;
const FLASH_SECONDS = 0.35;

interface Visitor {
  kind: string;
  character: Character;
  tag: HTMLDivElement;
}

export class EventViews {
  private visitor: Visitor | null = null;
  private readonly stain: THREE.Mesh;
  private readonly lightning: THREE.DirectionalLight;
  private flashT = 0;

  constructor(
    private readonly stage: Stage,
    private readonly lib: ModelLibrary,
    private readonly layout: Layout,
  ) {
    // The dining table's collider gives its top and its long axis.
    const table = layout.colliders.find((c) => c.name === 'col_box_table');
    const lamp = findSocket(layout, 'lamp_light');
    const top = table && table.shape === 'box' ? table.center[1] + table.halfExtents[1] : 0.75;
    const alongX = !table || table.shape !== 'box' || table.halfExtents[0] >= table.halfExtents[2];
    this.stain = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 20),
      new THREE.MeshStandardMaterial({ color: 0x5a0820, roughness: 0.35, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.stain.rotation.x = -Math.PI / 2;
    const cx = table?.center[0] ?? lamp?.position[0] ?? 0;
    const cz = table?.center[2] ?? lamp?.position[2] ?? 0;
    this.stain.position.set(alongX ? cx + 0.3 : cx + STAIN_OFFSET, top + CLOTH, alongX ? cz + STAIN_OFFSET : cz - 0.3);
    this.stain.scale.set(alongX ? 1.5 : 0.8, alongX ? 0.8 : 1.5, 1);
    this.stain.visible = false;
    stage.scene.add(this.stain);
    this.lightning = new THREE.DirectionalLight(0xcfe0ff, 0);
    this.lightning.position.set(0, 10, -8);
    stage.scene.add(this.lightning);
  }

  /** A lightning flash (the 'lightning' event). Skipped with "Reduce motion and flashing" on. */
  flash(): void {
    if (document.body.classList.contains('reduce-motion')) return;
    this.flashT = FLASH_SECONDS;
  }

  update(v: GameView, dt: number): void {
    const d = v.dinner;
    this.stain.visible = d.active && d.room.spill;
    this.flashT = Math.max(0, this.flashT - dt);
    // Two quick pulses, like real lightning.
    const k = this.flashT / FLASH_SECONDS;
    this.lightning.intensity = this.flashT > 0 ? 6 * (k > 0.6 || (k > 0.2 && k < 0.4) ? 1 : 0.1) : 0;
    this.syncVisitor(v, dt);
  }

  private syncVisitor(v: GameView, dt: number): void {
    const vis = v.dinner.visitor;
    const kind = v.dinner.active ? vis.kind : '';
    if (this.visitor && this.visitor.kind !== kind) {
      this.visitor.tag.remove();
      this.visitor.character.dispose();
      this.visitor = null;
    }
    if (!kind) return;
    if (!this.visitor) this.visitor = this.spawn(kind);
    const spotId = kind === 'hunter' ? 'stand_0' : vis.where === 'door' ? 'visitor_door' : 'neighbor';
    const spot = findSocket(this.layout, spotId) ?? findSocket(this.layout, 'guest_door');
    const c = this.visitor.character;
    if (spot) {
      c.root.position.set(...spot.position);
      c.root.rotation.y = spot.yaw;
    }
    const label = visitorLabel(kind, vis.suspicion);
    if (this.visitor.tag.textContent !== label) this.visitor.tag.textContent = label;
    c.play(kind === 'hunter' ? 'wave' : 'stand_wait');
    c.update(dt);
  }

  private spawn(kind: string): Visitor {
    const hunter = kind === 'hunter';
    const character = new Character(this.lib, {
      outfit: hunter ? 'suit' : 'cardigan',
      color: hunter ? '#2a2a33' : '#c0392b',
      hair: hunter ? 'slick' : 'short',
      hairColor: hunter ? '#a8a8a8' : '#5a3a22',
      skin: hunter ? '#e0b48f' : '#c99a6e',
      accessory: hunter ? 'moustache' : '',
      body: hunter ? 'tall' : 'average',
      hat: hunter ? 'top' : 'flatcap',
    });
    this.stage.scene.add(character.root);
    const tag = document.createElement('div');
    tag.className = 'nametag neighbor';
    tag.textContent = visitorLabel(kind, 0);
    const label = new CSS2DObject(tag);
    label.position.y = character.headTop + 0.3;
    character.root.add(label);
    return { kind, character, tag };
  }

  dispose(): void {
    if (this.visitor) {
      this.visitor.tag.remove();
      this.visitor.character.dispose();
    }
    this.stage.scene.remove(this.stain, this.lightning);
  }
}

/** Name tag text: the hunter's shows how much he has noticed, so players can read the danger. */
function visitorLabel(kind: string, suspicion: number): string {
  if (kind !== 'hunter') return 'Pizza driver (human)';
  return `"The Great Van Helsing-ish" (Monster Hunter)${suspicion > 0 ? ` · suspicion ${Math.round(suspicion)}%` : ''}`;
}
