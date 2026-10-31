// One dinner in the 3D room (M1: solo, the sim runs here in the browser).
// Steps the shared sim at a fixed rate, turns aiming + keys into sim actions, and feeds
// sim events to the guest views, room view and HUD.

import * as THREE from 'three';
import {
  DISHES,
  GUEST_TYPES,
  act,
  createDinner,
  ruleById,
  step,
  type Action,
  type DinnerState,
  type Layout,
  type LayoutSeat,
  type SimEvent,
  type SimTuning,
  type SimWorld,
  type Vec3,
} from '@moon/shared';
import type { Controls } from '../input/controls.ts';
import type { House, Stage } from '../render/stage.ts';
import { DinnerHud } from '../ui/DinnerHud.ts';
import { GuestViews } from './GuestViews.ts';
import { NEIGHBOR_SPOT, RoomView } from './RoomView.ts';
import { pickFirstPerson, pickOverhead, sameFocus, type Candidate, type Focus } from './Targeting.ts';

const SIM_DT = 0.1;
const OVERHEAD_POS = new THREE.Vector3(0, 7.4, 0.9);

const THING_LABEL: Record<string, string> = {
  curtain: 'curtains',
  mirror: 'mirror',
  lights: 'lights',
  prop_painting: 'painting',
  prop_candles: 'candles',
  door: 'front door',
};

/** Sorts the layout's seats into a clockwise ring as seen from above (north at the top). */
export function ringSeats(layout: Layout): LayoutSeat[] {
  const seats = layout.seats;
  const cx = seats.reduce((s, x) => s + x.position[0], 0) / seats.length;
  const cz = seats.reduce((s, x) => s + x.position[2], 0) / seats.length;
  return [...seats].sort(
    (a, b) => Math.atan2(a.position[2] - cz, a.position[0] - cx) - Math.atan2(b.position[2] - cz, b.position[0] - cx),
  );
}

export function newSeed(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `MOON-${[...bytes].map((b) => chars[b % chars.length]).join('')}`;
}

export class DinnerSession {
  state: DinnerState;
  private readonly seats: LayoutSeat[];
  private readonly guests: GuestViews;
  private readonly room: RoomView;
  readonly hud: DinnerHud;
  private accumulator = 0;
  private focus: Focus | null = null;
  private serveTarget: number | null = null;
  private reseatGuest: number | null = null;
  private overhead = false;
  private mouse = { x: 0, y: 0 };
  private readonly showMeters = { value: true };
  private readonly tuningOverrides: Partial<SimTuning> = {};
  private readonly playerFeet = new THREE.Vector3();
  /** You, as seen from overhead (first person has no body). */
  private readonly marker: THREE.Mesh;
  /** Hidden in the overhead view so they don't block the table. */
  private readonly overheadHidden: THREE.Object3D[];
  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e);
  private readonly onMouse = (e: MouseEvent) => (this.mouse = { x: e.clientX, y: e.clientY });

  constructor(
    private readonly stage: Stage,
    house: House,
    private readonly layout: Layout,
    private readonly controls: Controls,
    hudParent: HTMLElement,
    seed: string,
  ) {
    this.seats = ringSeats(layout);
    this.guests = new GuestViews(stage.scene, this.seats);
    this.room = new RoomView(stage, house);
    this.hud = new DinnerHud(hudParent);
    this.marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.05, 20),
      new THREE.MeshBasicMaterial({ color: 0x7fd1ff }),
    );
    this.marker.visible = false;
    stage.scene.add(this.marker);
    this.overheadHidden = ['lamp_shade', 'lamp_cord'].flatMap((n) => house.byName(n) ?? []);
    this.state = this.begin(seed);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('mousemove', this.onMouse);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('mousemove', this.onMouse);
    this.guests.dispose();
    this.hud.dispose();
    this.stage.scene.remove(this.marker);
    this.setOverhead(false);
  }

  get isOverhead(): boolean {
    return this.overhead;
  }

  private begin(seed: string): DinnerState {
    const state = createDinner({ seed, seatCount: this.seats.length, tuning: this.tuningOverrides });
    const url = new URL(location.href);
    url.searchParams.set('seed', seed);
    history.replaceState(null, '', url);
    const rumor = ruleById(state.ledger[0]!);
    this.hud.log(`Booking: dinner for ${state.guests.length}. Seed ${seed}.`, 'big');
    this.hud.log(`Word is, the Hollows say ${rumor.claim} → ${rumor.rule}`, 'info');
    this.hud.toast(`Dinner for ${state.guests.length}. Rumor has it: ${rumor.rule}`, 'big', 5);
    return state;
  }

  private restart(seed: string): void {
    this.guests.dispose();
    this.hud.hideResults();
    this.accumulator = 0;
    this.serveTarget = null;
    this.reseatGuest = null;
    this.state = this.begin(seed);
  }

  // --- per frame -------------------------------------------------------------------------------

  /** `feet` is the local player's position. Call after the camera has been placed. */
  update(dt: number, feet: Vec3): void {
    this.playerFeet.set(...feet);
    const world = this.world();

    this.accumulator += dt;
    while (this.accumulator >= SIM_DT) {
      this.accumulator -= SIM_DT;
      this.handleEvents(step(this.state, SIM_DT, world));
    }

    if (this.overhead) {
      this.stage.camera.position.copy(OVERHEAD_POS);
      this.stage.camera.lookAt(0, 0, 0);
    }
    this.marker.position.copy(this.playerFeet).setY(this.playerFeet.y + 0.03);

    this.guests.showMeters = this.showMeters.value;
    this.guests.sync(this.state, dt);
    this.room.update(this.state.room, dt);
    this.updateFocus();
    this.hud.render(this.state, this.promptText(), dt);
    const serveGuest = this.serveTarget !== null ? this.state.guests[this.serveTarget] : undefined;
    this.hud.showServe(this.state, serveGuest && !serveGuest.eaten ? serveGuest.name : null);
  }

  /** Advances the sim without a frame (dev/test helper: hidden browser panes get no frames). */
  advance(seconds: number): void {
    for (let t = 0; t < seconds; t += SIM_DT) this.handleEvents(step(this.state, SIM_DT, this.world()));
  }

  private world(): SimWorld {
    const t = this.state.tuning;
    const head = this.playerFeet.clone().setY(this.playerFeet.y + 1.55);
    return {
      canHear: (id) => this.guests.headPosition(id).distanceTo(head) <= t.earshotMeters,
      isBlocking: (id) => {
        const p = this.guests.headPosition(id).setY(this.playerFeet.y);
        return p.distanceTo(this.playerFeet) <= t.blockMeters;
      },
    };
  }

  // --- aiming ----------------------------------------------------------------------------------

  private candidates(): Candidate[] {
    const out: Candidate[] = [];
    for (const g of this.state.guests) {
      if (g.eaten) continue;
      out.push({ focus: { kind: 'guest', id: g.id, point: this.guests.headPosition(g.id) }, radius: 0.35, maxDistance: 5 });
    }
    if (this.reseatGuest !== null) {
      this.seats.forEach((s, seat) => {
        if (this.state.guests.some((g) => !g.eaten && g.seat === seat)) return;
        out.push({
          focus: { kind: 'seat', seat, point: new THREE.Vector3(s.position[0], 0.8, s.position[2]) },
          radius: 0.35,
          maxDistance: 5,
        });
      });
      return out;
    }
    for (const it of this.layout.interactables) {
      if (it.kind === 'door' && !this.state.room.neighborPresent) continue;
      out.push({
        focus: { kind: 'thing', id: it.id, what: it.kind, point: new THREE.Vector3(...it.position) },
        radius: 0.3,
        maxDistance: 3.2,
      });
    }
    if (this.state.room.neighborPresent) {
      out.push({ focus: { kind: 'neighbor', point: NEIGHBOR_SPOT.clone().setY(1.3) }, radius: 0.4, maxDistance: 4 });
    }
    return out;
  }

  private updateFocus(): void {
    const c = this.candidates();
    const canvas = this.stage.renderer.domElement;
    const next = this.overhead
      ? pickOverhead(this.stage.camera, c, this.mouse, { width: canvas.clientWidth, height: canvas.clientHeight })
      : pickFirstPerson(this.stage.camera, c);
    if (!sameFocus(next, this.focus)) this.focus = next;
    this.guests.setFocus(this.focus?.kind === 'guest' ? this.focus.id : null);
    this.guests.setSelected(this.reseatGuest);
  }

  private promptText(): string {
    const s = this.state;
    if (s.phase === 'ended') return '';
    const f = this.focus;
    if (this.reseatGuest !== null) {
      const who = s.guests[this.reseatGuest]!.name;
      if (f?.kind === 'seat') return `[G] Move ${who} here · [Esc] cancel`;
      if (f?.kind === 'guest' && f.id !== this.reseatGuest) return `[G] Swap ${who} with ${s.guests[f.id]!.name} · [Esc] cancel`;
      return `Moving ${who}: aim at another guest or an empty seat, then [G] · [Esc] cancel`;
    }
    if (!f) return '';
    if (f.kind === 'guest') {
      const g = s.guests[f.id]!;
      return `${g.name}: [1][2][3] Small Talk · [E] Serve · [G] Move seat`;
    }
    if (f.kind === 'neighbor') return '[E] Show Gary out';
    if (f.kind === 'seat') return '';
    const r = s.room;
    switch (f.what) {
      case 'curtain':
        return `[E] ${r.curtainsOpen ? 'Close' : 'Open'} the curtains`;
      case 'mirror':
        return `[E] ${r.mirrorCovered ? 'Uncover' : 'Cover'} the mirror`;
      case 'lights':
        return `[E] Lights ${r.lightsOn ? 'off' : 'on'}`;
      case 'door':
        return '[E] Show Gary out';
      default:
        return `[E] Hold up the ${THING_LABEL[f.what] ?? f.what} to change the subject`;
    }
  }

  // --- input -----------------------------------------------------------------------------------

  private handleKey(e: KeyboardEvent): void {
    if (this.hud.sayOpen || e.target instanceof HTMLInputElement) return;
    const s = this.state;

    if (e.code === 'Backquote') {
      this.hud.toggleTuning(s, this.tuningOverrides, this.showMeters);
      return;
    }
    if (e.code === 'KeyO') {
      this.setOverhead(!this.overhead);
      return;
    }
    if (s.phase === 'ended') {
      if (e.code === 'KeyR') this.restart(e.shiftKey ? s.seed : newSeed());
      return;
    }
    if (e.code === 'Enter') {
      e.preventDefault();
      this.hud.openSay((text) => {
        this.hud.log(`You: “${text}”`, 'info');
        this.dispatch({ type: 'say', text });
      });
      return;
    }
    if (e.code === 'Escape') {
      this.serveTarget = null;
      this.reseatGuest = null;
      return;
    }

    const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
    const n = digit ? Number(digit) - 1 : -1;

    if (s.question && n >= 0) {
      if (n < s.question.options.length) this.dispatch({ type: 'answer', choice: n });
      return;
    }
    if (this.serveTarget !== null) {
      if (n >= 0 && n < DISHES.length) {
        this.dispatch({ type: 'serve', guest: this.serveTarget, dish: DISHES[n]!.id });
        this.serveTarget = null;
      } else if (e.code === 'KeyE') {
        this.serveTarget = null;
      }
      return;
    }

    const f = this.focus;
    if (e.code === 'KeyG') {
      this.handleReseat(f);
      return;
    }
    if (n >= 0 && n < s.hand.length && f?.kind === 'guest') {
      this.dispatch({ type: 'smallTalk', guest: f.id, card: n });
      return;
    }
    if (e.code !== 'KeyE' || !f) return;
    if (f.kind === 'guest') this.serveTarget = f.id;
    else if (f.kind === 'neighbor') this.dispatch({ type: 'showOut' });
    else if (f.kind === 'thing') {
      if (f.what === 'curtain') this.dispatch({ type: 'toggle', what: 'curtains' });
      else if (f.what === 'mirror') this.dispatch({ type: 'toggle', what: 'mirror' });
      else if (f.what === 'lights') this.dispatch({ type: 'toggle', what: 'lights' });
      else if (f.what === 'door') this.dispatch({ type: 'showOut' });
      else if (f.what.startsWith('prop_')) this.dispatch({ type: 'prop', prop: f.what.slice(5) });
    }
  }

  private handleReseat(f: Focus | null): void {
    if (this.reseatGuest === null) {
      if (f?.kind === 'guest') this.reseatGuest = f.id;
      return;
    }
    const who = this.reseatGuest;
    if (f?.kind === 'seat') this.dispatch({ type: 'reseat', guest: who, seat: f.seat });
    else if (f?.kind === 'guest' && f.id !== who) this.dispatch({ type: 'reseat', guest: who, seat: this.state.guests[f.id]!.seat });
    this.reseatGuest = null;
  }

  private setOverhead(on: boolean): void {
    this.overhead = on;
    this.controls.lookEnabled = !on;
    this.marker.visible = on;
    for (const o of this.overheadHidden) o.visible = !on;
    if (on) document.exitPointerLock();
    document.body.classList.toggle('overhead', on);
  }

  dispatch(action: Action): void {
    this.handleEvents(act(this.state, action, this.world()));
  }

  // --- events ----------------------------------------------------------------------------------

  private handleEvents(events: SimEvent[]): void {
    const s = this.state;
    const name = (id: number) => s.guests[id]?.name ?? '?';
    for (const e of events) {
      switch (e.t) {
        case 'tell':
          this.guests.showTell(e.guest, e.text, e.mood);
          if (e.mood === 'bad') this.hud.log(`${name(e.guest)} ${e.text}`, 'bad');
          break;
        case 'topic':
          if (e.kind === 'start') this.hud.log(`${name(e.guest)}: “${e.text}”`, 'info');
          break;
        case 'topicDropped':
          this.hud.log(e.text, 'info');
          break;
        case 'slip':
          this.guests.showTell(e.guest, 'SLIP!', 'bad');
          this.hud.toast(`${name(e.guest)} is slipping! ${e.text}`, 'bad', 4);
          this.hud.log(`${name(e.guest)}: ${e.text}`, 'bad');
          break;
        case 'slipHidden':
          this.hud.log(`Nobody saw ${name(e.guest)}. Phew.`, 'good');
          break;
        case 'slipSeen':
          this.hud.log(`Everyone saw ${name(e.guest)} — a ${GUEST_TYPES[s.guests[e.guest]!.type].label.toLowerCase()}!`, 'bad');
          break;
        case 'strike':
          this.hud.toast(`STRIKE ${e.strikes}: ${e.reason}`, 'bad', 4);
          this.hud.log(`Strike ${e.strikes}: ${e.reason}`, 'bad');
          break;
        case 'eaten':
          this.hud.log(`${name(e.by)} ate ${name(e.guest)}. Crunch.`, 'bad');
          break;
        case 'eyeing':
          this.hud.log(`${name(e.guest)} is eyeing ${name(e.target)}… feed them!`, 'bad');
          break;
        case 'served':
          this.hud.log(e.text, 'info');
          break;
        case 'question':
          this.hud.log(`${name(e.guest)} has a question for you.`, 'info');
          break;
        case 'answered':
          this.hud.log(e.kind === 'silence' ? e.text : `You: ${e.text}`, e.kind === 'lie' ? 'info' : 'bad');
          break;
        case 'rule':
          this.hud.log(`New rule: ${ruleById(e.rule).rule}`, 'big');
          break;
        case 'ruleBroken':
          this.hud.toast(`You broke your own rule: ${ruleById(e.rule).rule}`, 'bad');
          break;
        case 'contradiction':
          this.hud.toast(`${name(e.guest)} narrows their eyes. That contradicts what you said before.`, 'bad', 4.5);
          break;
        case 'cover':
          this.hud.log(`${e.delta > 0 ? '+' : ''}${e.delta} cover: ${e.reason}`, e.delta > 0 ? 'good' : 'bad');
          break;
        case 'moonrise':
          this.hud.toast('The full moon is rising. Nobody mention it.', 'big', 5);
          this.hud.log('The moon rises behind the curtains.', 'big');
          break;
        case 'neighbor':
          this.hud.toast(e.text, 'big', 4.5);
          this.hud.log(e.text, e.arrived ? 'big' : 'info');
          break;
        case 'reseat':
          this.hud.log(`${name(e.guest)} moves seats${e.swappedWith !== null ? ` with ${name(e.swappedWith)}` : ''}.`, 'info');
          break;
        case 'phase':
          this.hud.toast(e.phase === 'dessert' ? 'Dessert! Nearly there.' : `Course ${e.course + 1}`, 'big');
          break;
        case 'note':
          this.hud.log(e.text, 'info');
          break;
        case 'ended':
          this.hud.showResults(s);
          this.serveTarget = null;
          this.reseatGuest = null;
          break;
        case 'room':
          break;
      }
    }
  }
}
