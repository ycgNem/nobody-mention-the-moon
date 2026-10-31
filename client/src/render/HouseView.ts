// The house, matched to the game's state: lights, doors swinging, curtains, the mirror cover,
// the moon rising, the record spinning, the smoke alarm, Gary from next door, and two drawable
// boards in the kitchen: the Rumor Ledger chalkboard and the guest whiteboard.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { findSocket, ruleById, type GameView, type Layout, type Vec3 } from '@moon/shared';
import { Character } from './Character.ts';
import { prepare, type ModelLibrary } from './models.ts';
import type { Stage } from './stage.ts';

const MOON_RISE_SECONDS = 5;
const MOON_RISE_DROP = 1.0;
const DOOR_SPEED = 6;

interface Door {
  leaf: THREE.Object3D;
  angle: number;
}

interface Board {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  key: string;
}

export class HouseView {
  readonly root: THREE.Object3D;
  private readonly lamp: THREE.PointLight | null = null;
  private readonly roomLights: THREE.PointLight[] = [];
  private readonly lampOn: number;
  private readonly fillOn: number;
  private readonly doors = new Map<string, Door>();
  private readonly curtainsOpen: THREE.Object3D[];
  private readonly curtainClosed?: THREE.Object3D;
  private readonly mirrorCover?: THREE.Object3D;
  private readonly moon?: THREE.Object3D;
  private readonly moonHome: THREE.Vector3;
  private moonRise = 0;
  private readonly disc?: THREE.Object3D;
  private readonly overheadHidden: THREE.Object3D[] = [];
  private readonly alarmLight: THREE.PointLight;
  private readonly neighbor: Character;
  private readonly chalk: Board | null;
  private readonly white: Board | null;
  private time = 0;

  constructor(
    private readonly stage: Stage,
    house: THREE.Object3D,
    layout: Layout,
    lib: ModelLibrary,
  ) {
    this.root = house;
    prepare(house);
    // socket_lamp_light over the table, and socket_room_light_<room> in every other room.
    for (const o of collect(house, (o) => /^socket_(lamp_light|room_light_\w+)$/.test(o.name))) {
      if (o.name.includes('lamp')) {
        const l = new THREE.PointLight(0xffc98a, 9, 12, 1.6);
        l.castShadow = true;
        l.shadow.mapSize.set(1024, 1024);
        l.shadow.bias = -0.002;
        o.add(l);
        this.lamp = l;
      } else if (o.name.includes('room_light')) {
        const l = new THREE.PointLight(0xffd9a8, o.name.includes('cellar') ? 2.2 : 3.2, 9, 1.8);
        o.add(l);
        this.roomLights.push(l);
      }
    }
    this.lampOn = this.lamp?.intensity ?? 0;
    this.fillOn = stage.fill.intensity;

    for (const d of layout.doors) {
      const leaf = house.getObjectByName(`doorleaf_${d.id}`);
      if (leaf) this.doors.set(d.id, { leaf, angle: d.open ? 1 : 0 });
    }
    this.curtainsOpen = ['curtain_l', 'curtain_r'].flatMap((n) => house.getObjectByName(n) ?? []);
    this.curtainClosed = house.getObjectByName('curtain_closed');
    this.mirrorCover = house.getObjectByName('mirror_cover');
    this.moon = house.getObjectByName('moon');
    if (this.moon instanceof THREE.Mesh) {
      const mat = (this.moon.material as THREE.MeshStandardMaterial).clone();
      mat.emissive.set(0xffffff);
      mat.emissiveMap = mat.map;
      mat.emissiveIntensity = 1.5;
      this.moon.material = mat;
      this.moon.castShadow = false;
    }
    this.moonHome = this.moon?.position.clone() ?? new THREE.Vector3();
    this.disc = house.getObjectByName('record_disc');
    // Window glass is modelled with an opaque palette colour; make it see-through so the moon shows.
    for (const o of collect(house, (o) => o.name.endsWith('_glass') && o instanceof THREE.Mesh)) {
      const mesh = o as THREE.Mesh;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mat.transparent = true;
      mat.opacity = 0.18;
      mat.depthWrite = false;
      mesh.material = mat;
      mesh.castShadow = false;
    }
    for (const o of collect(house, (o) => o.name.startsWith('ceiling') || o.name === 'lamp_shade' || o.name === 'lamp_cord')) this.overheadHidden.push(o);

    const kitchen = house.getObjectByName('socket_room_light_kitchen');
    this.alarmLight = new THREE.PointLight(0xff2020, 0, 10, 1.5);
    (kitchen ?? house).add(this.alarmLight);

    this.neighbor = new Character(lib, {
      outfit: 'cardigan',
      color: '#9a9a8a',
      hair: 'short',
      hairColor: '#8a7a6a',
      skin: '#e8c3a0',
      accessory: 'glasses',
      body: 'stout',
    });
    const spot = findSocket(layout, 'neighbor');
    if (spot) {
      this.neighbor.root.position.set(...spot.position);
      this.neighbor.root.rotation.y = spot.yaw;
    }
    const tag = document.createElement('div');
    tag.className = 'nametag neighbor';
    tag.textContent = 'Gary (next door, human)';
    const label = new CSS2DObject(tag);
    label.position.y = 2.05;
    this.neighbor.root.add(label);
    this.neighbor.play('stand_wait');
    stage.scene.add(this.neighbor.root);

    this.chalk = makeBoard(house, 'chalkboard_surface', layout, 'chalkboard', 512, 384);
    this.white = makeBoard(house, 'whiteboard_surface', layout, 'whiteboard', 640, 384);
    stage.scene.add(house);
  }

  /** Takes out the house and what this view added beside it (Gary), and restores the stage fill. */
  dispose(): void {
    this.neighbor.root.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.remove();
    });
    this.neighbor.dispose();
    this.stage.fill.intensity = this.fillOn;
    this.stage.scene.remove(this.root);
  }

  /** Where the dining lamp is: the overhead camera looks down past it at the table. */
  tableCenter(layout: Layout): THREE.Vector3 {
    const s = findSocket(layout, 'lamp_light');
    return s ? new THREE.Vector3(s.position[0], 0, s.position[2]) : new THREE.Vector3();
  }

  setOverhead(on: boolean): void {
    for (const o of this.overheadHidden) o.visible = !on;
  }

  update(v: GameView, dt: number): void {
    this.time += dt;
    const d = v.dinner;
    const room = d.room;
    const powered = !d.active || room.powerOn;
    const lightsOn = powered && (!d.active || room.lightsOn);
    // A power cut kills every room light, not just the dining lamp.
    for (const l of this.roomLights) l.intensity = ((l.userData.on as number | undefined) ?? (l.userData.on = l.intensity)) * (powered ? 1 : 0);

    for (const c of this.curtainsOpen) c.visible = !d.active || room.curtainsOpen;
    if (this.curtainClosed) this.curtainClosed.visible = d.active && !room.curtainsOpen;
    if (this.mirrorCover) this.mirrorCover.visible = d.active && room.mirrorCovered;

    if (this.moon) {
      const up = d.active && room.moonUp;
      this.moonRise = up ? Math.min(1, this.moonRise + dt / MOON_RISE_SECONDS) : 0;
      this.moon.visible = up;
      const eased = 1 - (1 - this.moonRise) ** 3;
      this.moon.position.copy(this.moonHome).y -= (1 - eased) * MOON_RISE_DROP;
    }

    if (this.lamp) this.lamp.intensity = lightsOn ? this.lampOn : 0;
    this.stage.fill.intensity = this.fillOn * (lightsOn ? 1 : 0.25);
    if (this.disc && d.active && room.musicOn) this.disc.rotation.y += dt * 3.5;

    for (const door of v.doors) {
      const dv = this.doors.get(door.id);
      if (!dv) continue;
      const target = door.open ? 1 : 0;
      dv.angle += Math.sign(target - dv.angle) * Math.min(Math.abs(target - dv.angle), dt * DOOR_SPEED * 0.5);
      dv.leaf.rotation.y = (dv.angle * Math.PI) / 2;
    }

    this.alarmLight.intensity = d.active && room.alarm ? 4 * (Math.sin(this.time * 12) > 0 ? 1 : 0.15) : 0;
    const gary = d.active && room.neighborPresent;
    this.neighbor.root.traverse((o) => (o.visible = gary));
    this.neighbor.update(dt);

    if (this.chalk) this.drawLedger(this.chalk, d.active ? d.ledger : []);
    if (this.white) this.drawWhiteboard(this.white, v);
  }

  private drawLedger(b: Board, ledger: string[]): void {
    const key = ledger.join('|');
    if (b.key === key) return;
    b.key = key;
    const ctx = b.canvas.getContext('2d')!;
    const { width: w, height: h } = b.canvas;
    ctx.fillStyle = '#2b3a32';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8e8e0';
    ctx.font = 'bold 34px "Comic Sans MS", "Segoe Print", cursive';
    ctx.fillText('House Rules', 24, 46);
    ctx.font = '22px "Comic Sans MS", "Segoe Print", cursive';
    let y = 88;
    for (const id of ledger) {
      const r = ruleById(id);
      for (const line of wrap(ctx, `• ${r.rule}`, w - 48)) {
        ctx.fillText(line, 24, y);
        y += 28;
      }
      y += 6;
      if (y > h - 20) break;
    }
    if (ledger.length === 0) {
      ctx.globalAlpha = 0.6;
      ctx.fillText('(none yet — keep it that way)', 24, y);
      ctx.globalAlpha = 1;
    }
    b.texture.needsUpdate = true;
  }

  /** Polaroids of each guest, with whatever the hosts scribbled under them. Notes only. */
  private drawWhiteboard(b: Board, v: GameView): void {
    const d = v.dinner;
    const guests = d.guests.filter((g) => g.where !== 'outside');
    const key = guests.map((g) => `${g.id}:${g.revealed}:${g.where === 'gone'}`).join('|') + '#' + v.notes.map((n) => `${n.guest}=${n.label}`).join('|');
    if (b.key === key) return;
    b.key = key;
    const ctx = b.canvas.getContext('2d')!;
    const { width: w, height: h } = b.canvas;
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3a3a5a';
    ctx.font = 'bold 28px "Comic Sans MS", "Segoe Print", cursive';
    ctx.fillText('Who is who?', 20, 38);
    const cols = Math.max(4, Math.ceil(guests.length / 2));
    const cw = (w - 20) / cols;
    guests.forEach((g, i) => {
      const x = 14 + (i % cols) * cw;
      const y = 56 + Math.floor(i / cols) * 160;
      ctx.save();
      ctx.translate(x + cw / 2, y + 70);
      ctx.rotate(((i * 37) % 11) / 100 - 0.05);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-cw / 2 + 6, -64, cw - 12, 132);
      ctx.fillStyle = g.look.color;
      ctx.fillRect(-cw / 2 + 14, -56, cw - 28, 74);
      ctx.fillStyle = g.look.skin;
      ctx.beginPath();
      ctx.arc(0, -26, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.font = '18px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(g.name, 0, 38);
      const note = v.notes.find((n) => n.guest === g.id)?.label ?? (g.revealed ? g.revealed.toUpperCase() : '?');
      ctx.fillStyle = g.revealed ? '#b02020' : '#2040a0';
      ctx.font = 'bold 18px "Comic Sans MS", "Segoe Print", cursive';
      ctx.fillText(g.where === 'gone' ? 'EATEN' : note, 0, 60);
      ctx.restore();
    });
    b.texture.needsUpdate = true;
  }
}

function collect(root: THREE.Object3D, pick: (o: THREE.Object3D) => boolean): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (pick(o)) out.push(o);
  });
  return out;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = `  ${w}`;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Replaces a flat board mesh with a plane carrying a canvas, facing its interactable (which
 * sits just in front of the board).
 */
function makeBoard(house: THREE.Object3D, meshName: string, layout: Layout, interact: string, w: number, h: number): Board | null {
  const mesh = house.getObjectByName(meshName);
  const it = layout.interactables.find((i) => i.id === interact);
  if (!mesh || !it) return null;
  house.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const toward = new THREE.Vector3(...(it.position as Vec3)).sub(center);
  const thinX = size.x < size.z;
  const width = thinX ? size.z : size.x;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, size.y), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }));
  const normal = thinX ? new THREE.Vector3(Math.sign(toward.x) || 1, 0, 0) : new THREE.Vector3(0, 0, Math.sign(toward.z) || 1);
  plane.position.copy(center).addScaledVector(normal, 0.012);
  plane.lookAt(plane.position.clone().add(normal));
  house.add(plane);
  mesh.visible = false;
  return { canvas, texture, key: '\u0000' };
}
