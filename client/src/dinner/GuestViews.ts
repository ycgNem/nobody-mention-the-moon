// Placeholder guests at the table: figure, name tag, topic bubble, preview arc, tells.
// Everything here only reads the DinnerState; the rules live in shared/src/sim.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  GUEST_TYPES,
  PALETTE,
  TAG_STYLE,
  predictNext,
  type DinnerState,
  type GuestState,
  type LayoutSeat,
} from '@moon/shared';

const SEAT_TOP = 0.47;
const HEAD_Y = 1.5;
const TAG_Y = 1.82;
const BUBBLE_Y = 2.15;
const TELL_SECONDS = 3.2;
const MOVE_SPEED = 3;

interface View {
  root: THREE.Group;
  body: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshStandardMaterial>;
  head: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  tag: HTMLDivElement;
  tagObject: CSS2DObject;
  meter: HTMLElement;
  hunger: HTMLElement;
  type: HTMLElement;
  slip: HTMLElement;
  target: THREE.Vector3;
  targetYaw: number;
  eyeLine: THREE.Line;
}

export class GuestViews {
  private readonly views = new Map<number, View>();
  private readonly bubble: CSS2DObject;
  private readonly bubbleEl: HTMLDivElement;
  private readonly arc: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>;
  private readonly tells: { obj: CSS2DObject; age: number }[] = [];
  private focus: number | null = null;
  private selected: number | null = null;
  showMeters = true;

  constructor(
    private readonly scene: THREE.Scene,
    /** Layout seats in ring order: ringSeats[i] is the sim's seat i. */
    private readonly ringSeats: readonly LayoutSeat[],
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

  seatPosition(seat: number): THREE.Vector3 {
    const s = this.ringSeats[seat];
    if (!s) throw new Error(`no ring seat ${seat}`);
    return new THREE.Vector3(s.position[0], 0, s.position[2]);
  }

  headPosition(guestId: number): THREE.Vector3 {
    const v = this.views.get(guestId);
    return v ? v.root.position.clone().setY(HEAD_Y) : new THREE.Vector3();
  }

  setFocus(id: number | null): void {
    this.focus = id;
  }

  setSelected(id: number | null): void {
    this.selected = id;
  }

  /** Floating tell text above a guest. */
  showTell(guestId: number, text: string, mood: 'bad' | 'good' | 'neutral'): void {
    const v = this.views.get(guestId);
    if (!v) return;
    const el = document.createElement('div');
    el.className = `tell tell-${mood}`;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(0, BUBBLE_Y + 0.35, 0);
    v.root.add(obj);
    this.tells.push({ obj, age: 0 });
  }

  /** Builds views on first call; then keeps them in step with the state every frame. */
  sync(state: DinnerState, dt: number): void {
    for (const g of state.guests) {
      let v = this.views.get(g.id);
      if (!v) {
        v = this.create(g);
        this.views.set(g.id, v);
      }
      this.updateGuest(g, v, dt);
    }
    this.updateBubble(state);
    this.updateArc(state);
    this.updateEyeing(state);
    this.ageTells(dt);
  }

  dispose(): void {
    for (const v of this.views.values()) {
      this.scene.remove(v.root, v.eyeLine);
      v.root.traverse((o) => o instanceof CSS2DObject && o.element.remove());
    }
    for (const t of this.tells) t.obj.element.remove();
    this.bubbleEl.remove();
    this.scene.remove(this.bubble, this.arc);
    this.views.clear();
  }

  private create(g: GuestState): View {
    const root = new THREE.Group();
    const pos = this.seatPosition(g.seat);
    root.position.copy(pos);
    root.rotation.y = this.ringSeats[g.seat]!.yaw;

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.2, 0.5, 6, 12),
      new THREE.MeshStandardMaterial({ color: g.color, roughness: 0.8 }),
    );
    body.position.y = SEAT_TOP + 0.45;
    body.castShadow = true;
    root.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 16, 12),
      new THREE.MeshStandardMaterial({ color: PALETTE.skin_host, roughness: 0.6 }),
    );
    head.position.y = HEAD_Y;
    head.castShadow = true;
    root.add(head);

    // A nose, so you can see which way they face (forward is -Z).
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.08), head.material);
    nose.position.set(0, HEAD_Y, -0.16);
    root.add(nose);

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
    tag.style.borderBottomColor = g.color;
    const tagObject = new CSS2DObject(tag);
    tagObject.position.y = TAG_Y;
    root.add(tagObject);

    const eyeLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xff4d3d }),
    );
    eyeLine.visible = false;
    this.scene.add(root, eyeLine);

    return {
      root,
      body,
      head,
      tag,
      tagObject,
      meter,
      hunger,
      type,
      slip,
      target: pos.clone(),
      targetYaw: root.rotation.y,
      eyeLine,
    };
  }

  private updateGuest(g: GuestState, v: View, dt: number): void {
    const present = !g.eaten;
    v.root.traverse((o) => (o.visible = present));
    if (!present) return;

    // Slide to a new seat after a reseat.
    v.target.copy(this.seatPosition(g.seat));
    v.targetYaw = this.ringSeats[g.seat]!.yaw;
    const d = v.target.clone().sub(v.root.position);
    const stepLen = MOVE_SPEED * dt;
    if (d.length() <= stepLen) v.root.position.copy(v.target);
    else v.root.position.addScaledVector(d.normalize(), stepLen);
    let yawDiff = v.targetYaw - v.root.rotation.y;
    yawDiff = Math.atan2(Math.sin(yawDiff), Math.cos(yawDiff));
    v.root.rotation.y += yawDiff * Math.min(1, dt * 8);

    const type = GUEST_TYPES[g.type];
    const slipping = g.slipTimer > 0;
    const t = performance.now() / 1000;

    // Composure shows as a jitter and a warm-to-red glow, not a bar (the bar is a debug aid).
    const stress = 1 - g.composure / 100;
    v.body.material.color.set(slipping ? type.revealColor : g.color);
    v.body.material.emissive.setRGB(stress > 0.5 ? (stress - 0.5) * 1.2 : 0, 0, 0);
    if (g.id === this.focus || g.id === this.selected) v.body.material.emissive.setRGB(0.25, 0.2, 0.05);
    const jitter = slipping ? 0.04 : stress > 0.65 ? 0.012 : 0;
    v.body.position.x = jitter * Math.sin(t * 40);
    const pulse = slipping ? 1 + 0.12 * Math.sin(t * 12) : 1;
    v.body.scale.setScalar(pulse);
    v.head.scale.setScalar(pulse);

    v.meter.style.width = `${Math.max(0, g.composure)}%`;
    v.meter.className = g.composure < 25 ? 'low' : g.composure < 50 ? 'mid' : '';
    v.meter.parentElement!.hidden = !this.showMeters;
    v.hunger.hidden = !(type.hunger > 0 && g.hunger > 70);
    v.hunger.classList.toggle('urgent', g.eyeing !== null);
    v.type.textContent = g.revealed ? ` · ${type.label.toLowerCase()}` : '';
    v.tag.classList.toggle('focus', g.id === this.focus);
    v.tag.classList.toggle('selected', g.id === this.selected);
    v.tag.classList.toggle('suspicious', g.suspicious);
    v.slip.textContent = slipping ? `SLIP! ${Math.ceil(g.slipTimer)}s — block the view or kill the lights` : '';
  }

  private updateBubble(state: DinnerState): void {
    const topic = state.topic;
    const holder = topic ? this.views.get(topic.holder) : undefined;
    this.bubble.visible = !!holder && !!topic;
    if (!holder || !topic) return;
    this.bubble.position.copy(holder.root.position).setY(BUBBLE_Y);
    const fuse = Math.max(0, Math.min(1, state.beatTimer / state.tuning.beatSeconds));
    const key = `${topic.id}|${topic.holder}`;
    if (this.bubbleEl.dataset.key !== key) {
      this.bubbleEl.dataset.key = key;
      this.bubbleEl.replaceChildren();
      const ring = document.createElement('div');
      ring.className = 'fuse';
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const tag of topic.tags) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.style.background = TAG_STYLE[tag].color;
        chip.textContent = `${TAG_STYLE[tag].icon} ${tag}`;
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

  private updateArc(state: DinnerState): void {
    const topic = state.topic;
    const next = predictNext(state);
    const from = topic ? this.views.get(topic.holder) : undefined;
    const to = next !== null ? this.views.get(next) : undefined;
    this.arc.visible = !!from && !!to;
    if (!from || !to) return;
    const a = from.root.position.clone().setY(HEAD_Y + 0.25);
    const b = to.root.position.clone().setY(HEAD_Y + 0.25);
    const mid = a.clone().add(b).multiplyScalar(0.5).setY(HEAD_Y + 0.9);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    this.arc.geometry.dispose();
    this.arc.geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
    this.arc.computeLineDistances();
  }

  private updateEyeing(state: DinnerState): void {
    for (const g of state.guests) {
      const v = this.views.get(g.id);
      if (!v) continue;
      const target = g.eyeing !== null && !g.eaten ? this.views.get(g.eyeing) : undefined;
      v.eyeLine.visible = !!target;
      if (!target) continue;
      const pos = v.eyeLine.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, v.root.position.x, HEAD_Y, v.root.position.z);
      pos.setXYZ(1, target.root.position.x, HEAD_Y, target.root.position.z);
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
