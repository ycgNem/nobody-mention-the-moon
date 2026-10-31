// The guests: dressed humanoids in their disguises, name tags, the topic bubble with its fuse
// ring, the preview arc to whoever gets the topic next, composure auras, hunger glances and
// floating tells. Reads only the view; the rules live in shared/src/sim.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GUEST_TYPES, HUD, TAG_STYLE, type ClipName, type DinnerView, type GuestTypeId, type GuestView, type TopicTag } from '@moon/shared';
import { Character } from './Character.ts';
import type { ModelLibrary } from './models.ts';

const SEATED_HEAD = 1.2;
const STANDING_HEAD = 1.6;
const TELL_SECONDS = 3.2;

interface View {
  g: GuestView;
  character: Character;
  tag: HTMLDivElement;
  tagObject: CSS2DObject;
  meter: HTMLElement;
  hunger: HTMLElement;
  type: HTMLElement;
  slip: HTMLElement;
  aura: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  eyeLine: THREE.Line;
  flinch: number;
  pose: { x: number; z: number; yaw: number };
}

export class GuestViews {
  private readonly views = new Map<number, View>();
  private readonly bubble: CSS2DObject;
  private readonly bubbleEl: HTMLDivElement;
  private readonly arc: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>;
  private readonly tells: { obj: CSS2DObject; age: number }[] = [];
  private focus: number | null = null;
  private selected: number | null = null;
  private time = 0;
  showMeters = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly lib: ModelLibrary,
  ) {
    this.bubbleEl = document.createElement('div');
    this.bubbleEl.className = 'bubble';
    this.bubble = new CSS2DObject(this.bubbleEl);
    this.bubble.visible = false;
    scene.add(this.bubble);
    this.arc = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0xf2e6c8, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.75 }),
    );
    this.arc.visible = false;
    scene.add(this.arc);
  }

  headPosition(id: number): THREE.Vector3 | null {
    const v = this.views.get(id);
    if (!v || !v.character.root.visible) return null;
    return v.character.root.position.clone().setY(this.headY(v.g));
  }

  private headY(g: GuestView): number {
    return g.where === 'seated' && !g.chasing ? SEATED_HEAD : STANDING_HEAD;
  }

  setFocus(id: number | null): void {
    this.focus = id;
  }

  setSelected(id: number | null): void {
    this.selected = id;
  }

  showTell(id: number, text: string, mood: 'bad' | 'good' | 'neutral'): void {
    const v = this.views.get(id);
    if (!v) return;
    if (mood === 'bad') v.flinch = 0.7;
    const el = document.createElement('div');
    el.className = `tell tell-${mood}`;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(0, this.headY(v.g) + 0.9, 0);
    v.character.root.add(obj);
    this.tells.push({ obj, age: 0 });
  }

  /** `poses` are interpolated positions by guest id (x, z, yaw). */
  sync(d: DinnerView, poses: Map<number, number[]>, dt: number): void {
    this.time += dt;
    const seen = new Set<number>();
    for (const g of d.guests) {
      seen.add(g.id);
      let v = this.views.get(g.id);
      if (!v) {
        v = this.create(g);
        this.views.set(g.id, v);
      }
      v.g = g;
      const p = poses.get(g.id);
      if (p) v.pose = { x: p[0]!, z: p[1]!, yaw: p[2]! };
      this.update(v, d, dt);
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      this.remove(v);
      this.views.delete(id);
    }
    this.updateBubble(d);
    this.updateArc(d);
    this.updateEyeing(d);
    this.ageTells(dt);
  }

  dispose(): void {
    for (const v of this.views.values()) this.remove(v);
    this.views.clear();
    for (const t of this.tells) t.obj.element.remove();
    this.bubbleEl.remove();
    this.scene.remove(this.bubble, this.arc);
  }

  private remove(v: View): void {
    v.character.root.traverse((o) => o instanceof CSS2DObject && o.element.remove());
    v.character.dispose();
    this.scene.remove(v.aura, v.eyeLine);
  }

  private create(g: GuestView): View {
    const character = new Character(this.lib, {
      outfit: g.look.outfit as 'suit',
      color: g.look.color,
      hair: g.look.hair,
      hairColor: g.look.hairColor,
      skin: g.look.skin,
      accessory: g.look.accessory,
      body: g.look.body,
    });
    this.scene.add(character.root);

    const tag = document.createElement('div');
    tag.className = 'guest-tag';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = g.name;
    const type = document.createElement('span');
    type.className = 'type';
    const hunger = document.createElement('span');
    hunger.className = 'hunger';
    hunger.textContent = '🍖';
    const slip = document.createElement('div');
    slip.className = 'slip';
    const meterWrap = document.createElement('div');
    meterWrap.className = 'meter';
    const meter = document.createElement('i');
    meterWrap.append(meter);
    tag.append(name, type, hunger, meterWrap, slip);
    tag.style.borderBottomColor = g.look.color;
    const tagObject = new CSS2DObject(tag);
    character.root.add(tagObject);

    const aura = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.56, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    aura.rotation.x = -Math.PI / 2;
    this.scene.add(aura);

    const eyeLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xff4d3d }),
    );
    eyeLine.visible = false;
    this.scene.add(eyeLine);
    return { g, character, tag, tagObject, meter, hunger, type, slip, aura, eyeLine, flinch: 0, pose: { x: g.x, z: g.z, yaw: g.yaw } };
  }

  private update(v: View, d: DinnerView, dt: number): void {
    const g = v.g;
    const present = g.where !== 'outside' && g.where !== 'gone';
    const root = v.character.root;
    root.visible = present;
    v.tagObject.visible = present;
    v.aura.visible = present && !g.chasing;
    if (!present) return;

    root.position.set(v.pose.x, 0, v.pose.z);
    root.rotation.y = v.pose.yaw;
    v.tagObject.position.y = this.headY(g) + 0.35;

    // Animation from what they're doing.
    v.flinch = Math.max(0, v.flinch - dt);
    let clip: ClipName = 'stand_wait';
    if (g.chasing) clip = 'run';
    else if (g.where === 'entering') clip = 'walk';
    else if (g.where === 'seated') clip = g.slipping ? 'slip' : v.flinch > 0 ? 'sit_flinch' : g.eating ? 'sit_eat' : d.topic.holder === g.id ? 'sit_talk' : 'sit_idle';
    v.character.play(clip, clip === 'sit_flinch' || clip === 'slip' ? 0.1 : 0.3);
    v.character.update(dt);

    const type = g.form ? GUEST_TYPES[g.form as GuestTypeId] : null;
    const showMonster = type !== null;
    v.character.setSlip(type?.slipKit ?? [], type?.seeThroughSlip ?? false, showMonster);

    // Composure as an aura, not a bar: calm = nothing, jittery = amber pulse, crackling = red flicker.
    const stress = 1 - g.composure / 100;
    const t = this.time;
    const mat = v.aura.material;
    v.aura.position.set(v.pose.x, 0.02, v.pose.z);
    if (g.slipping) {
      mat.color.set(0xff3030);
      mat.opacity = 0.7 + 0.3 * Math.sin(t * 20);
    } else if (stress > 0.7) {
      mat.color.set(0xff5a3a);
      mat.opacity = 0.35 + 0.35 * Math.abs(Math.sin(t * 13 + g.id));
    } else if (stress > 0.45) {
      mat.color.set(0xffc04a);
      mat.opacity = 0.18 + 0.12 * Math.sin(t * 4 + g.id);
    } else {
      mat.opacity = 0;
    }
    const jitter = g.slipping ? 0.03 : stress > 0.7 ? 0.012 : 0;
    root.position.x += jitter * Math.sin(t * 41 + g.id);
    // A gentle procedural sway so nobody looks frozen.
    root.rotation.z = Math.sin(t * 1.3 + g.id * 1.7) * 0.015;

    const focused = g.id === this.focus || g.id === this.selected;
    v.character.setGlow(focused ? 0.18 : stress > 0.6 ? (stress - 0.6) * 0.5 : 0, focused ? 0.14 : 0, focused ? 0.04 : 0);

    v.meter.style.width = `${Math.max(0, g.composure)}%`;
    v.meter.className = g.composure < 25 ? 'low' : g.composure < 50 ? 'mid' : '';
    v.meter.parentElement!.hidden = !this.showMeters;
    const known = g.revealed ? GUEST_TYPES[g.revealed as GuestTypeId] : null;
    v.hunger.hidden = !(g.hunger > HUD.hungryShownAt && known?.hunger !== 0);
    v.hunger.classList.toggle('urgent', g.eyeing >= 0);
    v.type.textContent = known ? ` · ${known.label.toLowerCase()}` : '';
    v.tag.classList.toggle('focus', g.id === this.focus);
    v.tag.classList.toggle('selected', g.id === this.selected);
    v.tag.classList.toggle('suspicious', g.suspicious);
    v.slip.textContent = g.slipping
      ? 'SLIP! Block the view or kill the lights'
      : g.waitingInvite
        ? '…waiting to be invited in'
        : g.where === 'standing'
          ? 'waiting for a seat'
          : '';
  }

  private updateBubble(d: DinnerView): void {
    const topic = d.topic;
    const holder = topic.holder >= 0 ? this.views.get(topic.holder) : undefined;
    this.bubble.visible = !!holder && holder.character.root.visible;
    if (!holder) return;
    this.bubble.position.copy(holder.character.root.position).setY(this.headY(holder.g) + 0.75);
    const fuse = d.beatSeconds > 0 ? Math.max(0, Math.min(1, d.beatTimer / d.beatSeconds)) : 0;
    const key = `${topic.id}|${topic.holder}`;
    if (this.bubbleEl.dataset.key !== key) {
      this.bubbleEl.dataset.key = key;
      this.bubbleEl.replaceChildren();
      const ring = document.createElement('div');
      ring.className = 'fuse';
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const tag of topic.tags) {
        const style = TAG_STYLE[tag as TopicTag];
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.style.background = style?.color ?? '#666';
        chip.textContent = `${style?.icon ?? ''} ${tag}`;
        chips.append(chip);
      }
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = topic.label;
      this.bubbleEl.append(ring, chips, label);
      this.bubbleEl.classList.remove('pop');
      void this.bubbleEl.offsetWidth; // restart the pop animation
      this.bubbleEl.classList.add('pop');
    }
    this.bubbleEl.style.setProperty('--fuse', String(fuse));
  }

  private updateArc(d: DinnerView): void {
    const from = d.topic.holder >= 0 ? this.views.get(d.topic.holder) : undefined;
    const to = d.topic.next >= 0 ? this.views.get(d.topic.next) : undefined;
    this.arc.visible = !!from && !!to;
    if (!from || !to) return;
    const a = from.character.root.position.clone().setY(this.headY(from.g) + 0.25);
    const b = to.character.root.position.clone().setY(this.headY(to.g) + 0.25);
    const mid = a.clone().add(b).multiplyScalar(0.5).setY(Math.max(a.y, b.y) + 0.9);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    this.arc.geometry.dispose();
    this.arc.geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
    this.arc.computeLineDistances();
  }

  private updateEyeing(d: DinnerView): void {
    for (const g of d.guests) {
      const v = this.views.get(g.id);
      if (!v) continue;
      const target = g.eyeing >= 0 ? this.views.get(g.eyeing) : undefined;
      v.eyeLine.visible = !!target;
      if (!target) continue;
      const pos = v.eyeLine.geometry.attributes.position as THREE.BufferAttribute;
      const a = v.character.root.position;
      const b = target.character.root.position;
      pos.setXYZ(0, a.x, SEATED_HEAD, a.z);
      pos.setXYZ(1, b.x, SEATED_HEAD, b.z);
      pos.needsUpdate = true;
    }
  }

  private ageTells(dt: number): void {
    for (let i = this.tells.length - 1; i >= 0; i--) {
      const t = this.tells[i]!;
      t.age += dt;
      t.obj.position.y += dt * 0.12;
      t.obj.element.style.opacity = String(Math.max(0, 1 - Math.max(0, t.age - TELL_SECONDS * 0.6) / (TELL_SECONDS * 0.4)));
      if (t.age >= TELL_SECONDS) {
        t.obj.removeFromParent();
        t.obj.element.remove();
        this.tells.splice(i, 1);
      }
    }
  }
}
