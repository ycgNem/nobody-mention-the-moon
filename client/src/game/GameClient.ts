// One player's view of the game. Owns nothing authoritative: it predicts your own movement,
// draws everyone else from interpolated snapshots, works out what you're aiming at, turns input
// into Commands, and turns events into log lines, tells and sounds. The same code runs against
// the server (NetLink) and against the game running in this tab (LocalLink).

import * as THREE from 'three';
import {
  NET,
  PLAYER,
  SIM,
  buildRoomGraph,
  dishById,
  findSocket,
  isDish,
  muffling,
  ringSeats,
  roomAt,
  ruleById,
  type Command,
  type GameEvent,
  type GameView,
  type GuestView,
  type Layout,
  type LayoutSeat,
  type PlayerView,
  type PropView,
  type RoomGraph,
  type Target,
  type Vec3,
  type VisitorView,
} from '@moon/shared';
import type { AudioEngine } from '../audio/index.ts';
import type { ActionName, Controls } from '../input/controls.ts';
import { Tracks } from '../net/interp.ts';
import { serverUrl, type GameLink } from '../net/link.ts';
import { LocalPlayer } from '../players/LocalPlayer.ts';
import { EventViews } from '../render/EventViews.ts';
import { GuestViews } from '../render/GuestViews.ts';
import { HouseView } from '../render/HouseView.ts';
import type { ModelLibrary } from '../render/models.ts';
import { PlayerViews } from '../render/PlayerViews.ts';
import { PropViews } from '../render/PropViews.ts';
import type { Stage } from '../render/stage.ts';
import { GameHud, phaseLabel, type LogKind } from '../ui/GameHud.ts';
import { VoiceMesh, isVoiceSignal } from '../voice/index.ts';
import { Listening } from './Listening.ts';
import { SoundDirector } from './SoundDirector.ts';
import { pickFirstPerson, pickOverhead, sameFocus, type Candidate, type Focus } from './Targeting.ts';

const STILL = { x: 0, z: 0, sprint: false, crouch: false };
const STATION_LABEL: Record<string, string> = { chop: 'chopping board', hob: 'hob', oven: 'oven', pass: 'pass' };
const THING_RADIUS: Record<string, number> = { door: 0.5, van: 1.3, curtain: 0.7, chalkboard: 0.5, whiteboard: 0.4, fridge: 0.45, wine_rack: 0.4 };
/** Below this the throw button just tosses it gently. */
const TAP_SECONDS = 0.12;
/**
 * Gamepad buttons (standard mapping) → the same actions as the keyboard. RT is the left mouse
 * button (use, or hold to throw); the d-pad's left, down and right play Small Talk cards 1–3.
 * L3/R3 sprint and crouch through Controls.pollGamepad.
 */
const PAD_ACTIONS: Partial<Record<number, ActionName>> = { 0: 'interact', 1: 'drop', 2: 'holdUp', 3: 'reseat', 4: 'talk', 5: 'jump', 8: 'ledger', 9: 'settings', 12: 'overhead' };
const PAD_CARDS: Partial<Record<number, number>> = { 14: 0, 13: 1, 15: 2 };
const PAD_MOUSE_LEFT = 7;

export interface Prefs {
  voiceMode: 'ptt' | 'open';
  /** On-device trigger-word listening (M5). */
  speech: boolean;
  fov: number;
  /** Show composure meters over guests (an assist; off by default). */
  meters: boolean;
  /** Show every trigger word on the HUD (GDD §12). */
  triggers: boolean;
}

export interface ClientOptions {
  stage: Stage;
  lib: ModelLibrary;
  layout: Layout;
  house: THREE.Object3D;
  link: GameLink;
  controls: Controls;
  audio: AudioEngine;
  hudParent: HTMLElement;
  prefs: Prefs;
  /** Esc with nothing to close: the pause/settings menu. */
  onMenu(): void;
}

export class GameClient {
  /** The house this client was built for (main.ts builds a new client when the game moves house). */
  readonly asset: string;
  readonly hud: GameHud;
  readonly house: HouseView;
  readonly events: EventViews;
  readonly guests: GuestViews;
  readonly players: PlayerViews;
  readonly props: PropViews;
  readonly local: LocalPlayer;
  readonly sound: SoundDirector;
  voice: VoiceMesh | null = null;
  readonly listening: Listening;
  readonly link: GameLink;
  private readonly stage: Stage;
  private readonly layout: Layout;
  private readonly controls: Controls;
  private readonly graph: RoomGraph;
  private readonly seats: LayoutSeat[];
  private readonly things: { id: string; kind: string; point: THREE.Vector3 }[];
  private readonly neighborPoint: THREE.Vector3 | null;
  private readonly tableCenter: THREE.Vector3;
  private readonly marker: THREE.Mesh;
  private readonly tracks = { players: new Tracks<string>([3]), guests: new Tracks<number>([2]), props: new Tracks<number>() };
  private readonly playerPoses = new Map<string, number[]>();
  private readonly guestPoses = new Map<number, number[]>();
  private readonly propPoses = new Map<number, number[]>();
  private lastViewTime = -1;
  private focus: Focus | null = null;
  private overhead = false;
  private reseatGuest: number | null = null;
  private wheelGuest: number | null = null;
  private wheelVec = { x: 0, y: 0 };
  private charging: number | null = null;
  private padWas: boolean[] = [];
  private sendAcc = 0;
  private snaps = 0;
  private fps = 60;
  private mouse = { x: 0, y: 0 };
  private disposed = false;
  private readonly cleanups: (() => void)[] = [];
  /** Volume and mute you've set for each other host, for this dinner. */
  private readonly peerVoice = new Map<string, { volume: number; muted: boolean }>();
  prefs: Prefs;

  constructor(private readonly opts: ClientOptions) {
    const { stage, lib, layout, house, link, controls, audio } = opts;
    this.stage = stage;
    this.layout = layout;
    this.asset = layout.asset;
    this.link = link;
    this.controls = controls;
    this.prefs = opts.prefs;
    this.graph = buildRoomGraph(layout);
    this.seats = ringSeats(layout);
    this.things = layout.interactables.map((i) => ({ id: i.id, kind: i.kind, point: new THREE.Vector3(...i.position) }));
    const n = findSocket(layout, 'neighbor');
    this.neighborPoint = n ? new THREE.Vector3(n.position[0], n.position[1] + 1.5, n.position[2]) : null;

    this.house = new HouseView(stage, house, layout, lib);
    this.tableCenter = this.house.tableCenter(layout);
    this.events = new EventViews(stage, lib, layout);
    this.guests = new GuestViews(stage.scene, lib);
    this.guests.showMeters = this.prefs.meters;
    this.players = new PlayerViews(stage.scene, lib);
    this.props = new PropViews(stage.scene, lib);
    this.sound = new SoundDirector(audio, this.graph, layout);
    this.hud = new GameHud(opts.hudParent, {
      send: (cmd) => this.send(cmd),
      closePanels: () => this.closePanels(),
    });
    this.hud.fuseWhere = fuseWhere(layout, this.graph);

    const me = link.view().players.find((p) => p.id === link.selfId);
    const spawn: Vec3 = me ? [me.x, me.y, me.z] : (layout.spawns[0]?.position ?? [0, 0, 0]);
    this.local = new LocalPlayer(layout, spawn);
    controls.yaw = me?.yaw ?? layout.spawns[0]?.yaw ?? 0;
    controls.pitch = 0;
    controls.lookEnabled = true;

    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.34, 24), new THREE.MeshBasicMaterial({ color: 0xffd27a, side: THREE.DoubleSide }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    stage.scene.add(this.marker);

    this.listening = new Listening(
      (word) => this.send({ c: 'heard', word }),
      (message) => this.hud.log(message, 'bad'),
    );
    this.cleanups.push(link.onEvents((events) => this.onEvents(events)));
    this.listen();
    this.setupVoice();
  }

  // --- input -----------------------------------------------------------------------------------

  private listen(): void {
    this.controls.onAction((a, down) => {
      if (!this.disposed) this.onAction(a, down);
    });
    this.controls.onButton((b, down) => {
      if (!this.disposed) this.onButton(b, down);
    });
    const onKey = (e: KeyboardEvent) => {
      if (this.disposed || this.hud.sayOpen || e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m) this.pickNumber(Number(m[1]) - 1);
    };
    window.addEventListener('keydown', onKey);
    const canvas = this.stage.renderer.domElement;
    const onMouse = (e: MouseEvent) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    };
    canvas.addEventListener('mousemove', onMouse);
    this.cleanups.push(() => window.removeEventListener('keydown', onKey), () => canvas.removeEventListener('mousemove', onMouse));
  }

  private onAction(a: ActionName, down: boolean): void {
    if (this.hud.sayOpen) return;
    const v = this.link.view();
    if (a === 'talk') {
      if (down && this.voice && this.voice.micState === 'off') void this.voice.enableMic();
      this.voice?.setTalking(down);
      return;
    }
    if (!down) return;
    switch (a) {
      case 'chat':
        this.hud.openSay((text) => this.send({ c: 'say', text }));
        return;
      case 'interact':
        return this.interact();
      case 'drop':
        return this.send({ c: 'drop' });
      case 'holdUp':
        return this.send({ c: 'holdUp' });
      case 'reseat':
        return this.reseat();
      case 'ledger':
        this.hud.ledgerOpen = !this.hud.ledgerOpen;
        return;
      case 'overhead':
        return this.setOverhead(!this.overhead);
      case 'ready':
        if (v.phase === 'lobby') this.send({ c: 'ready', ready: !v.players.find((p) => p.id === this.link.selfId)?.ready });
        return;
      case 'skip':
        if (v.phase === 'dinner' && (v.dinner.phase === 'booking' || v.dinner.phase === 'prep')) this.send({ c: 'skip' });
        return;
      case 'netDebug':
        this.hud.netOpen = !this.hud.netOpen;
        return;
      case 'settings':
        if (!this.closePanels()) this.opts.onMenu();
        return;
      default:
        return;
    }
  }

  private onButton(button: number, down: boolean): void {
    const v = this.link.view();
    const me = this.me(v);
    if (button === 0) {
      if (down) {
        if (me && me.held >= 0 && !this.overhead) this.charging = 0;
        else this.interact();
      } else if (this.charging !== null) {
        const power = this.charging < TAP_SECONDS ? 0.1 : Math.min(1, this.charging / PLAYER.throwChargeSeconds);
        this.charging = null;
        this.hud.setCharge(null);
        this.send({ c: 'throw', power });
      }
      return;
    }
    if (button === 2) {
      if (down) {
        const g = this.focus?.kind === 'guest' ? v.dinner.guests.find((x) => x.id === (this.focus as { id: number }).id) : undefined;
        if (!g || g.where !== 'seated' || v.phase !== 'dinner') return;
        this.wheelGuest = g.id;
        this.wheelVec = { x: 0, y: 0 };
        this.hud.openWheel(v.dinner.hands.find((x) => x.player === this.link.selfId), g);
        this.controls.steer = (dx, dy) => {
          this.wheelVec.x = clamp(this.wheelVec.x + dx, -80, 80);
          this.wheelVec.y = clamp(this.wheelVec.y + dy, -80, 80);
          this.hud.steerWheel(this.wheelVec.x, this.wheelVec.y);
        };
      } else if (this.hud.wheelOpen) {
        const pick = this.hud.closeWheel();
        this.controls.steer = null;
        if (pick >= 0 && this.wheelGuest !== null) this.send({ c: 'smallTalk', guest: this.wheelGuest, card: pick });
        this.wheelGuest = null;
      }
    }
  }

  /** Turns gamepad button edges into the same actions as keys and mouse buttons. */
  private padButtons(buttons: boolean[]): void {
    buttons.forEach((down, i) => {
      if (down === (this.padWas[i] ?? false)) return;
      const action = PAD_ACTIONS[i];
      if (action === 'jump') {
        if (down) this.controls.jumpNext();
      } else if (action) this.onAction(action, down);
      else if (i === PAD_MOUSE_LEFT) this.onButton(0, down);
      else if (down && PAD_CARDS[i] !== undefined) this.pickNumber(PAD_CARDS[i]);
    });
    this.padWas = buttons;
  }

  /** 1–9: answer a question aimed at you, take from the fridge, or play a Small Talk card. */
  private pickNumber(i: number): void {
    const v = this.link.view();
    const d = v.dinner;
    if (v.phase !== 'dinner') return;
    if (d.question.asker >= 0 && d.question.target === this.link.selfId) {
      if (i < d.question.options.length) this.send({ c: 'answer', choice: i });
      return;
    }
    if (this.hud.fridgeOpen) {
      this.hud.takeFromFridge(d, i);
      return;
    }
    const f = this.focus;
    if (f?.kind === 'guest' && i < 3) this.send({ c: 'smallTalk', guest: f.id, card: i });
  }

  private interact(): void {
    if (this.hud.fridgeOpen || this.hud.notesOpen) {
      this.closePanels();
      return;
    }
    const f = this.focus;
    if (!f) return;
    const v = this.link.view();
    if (f.kind === 'seat') {
      if (this.reseatGuest !== null) this.send({ c: 'reseat', guest: this.reseatGuest, seat: f.seat });
      this.setReseat(null);
      return;
    }
    if (f.kind === 'thing') {
      if (f.what === 'fridge' && v.phase === 'dinner') {
        this.hud.openFridge();
        this.releaseMouse();
        return;
      }
      if (f.what === 'whiteboard' && v.phase === 'dinner') {
        this.hud.openNotes();
        this.releaseMouse();
        return;
      }
      if (f.what === 'chalkboard') {
        this.hud.ledgerOpen = !this.hud.ledgerOpen;
        return;
      }
    }
    const target = toTarget(f);
    if (target) this.send({ c: 'interact', target });
  }

  private reseat(): void {
    const f = this.focus;
    if (this.reseatGuest !== null) {
      if (f?.kind === 'seat') this.send({ c: 'reseat', guest: this.reseatGuest, seat: f.seat });
      this.setReseat(null);
      return;
    }
    if (f?.kind !== 'guest') return;
    const g = this.link.view().dinner.guests.find((x) => x.id === f.id);
    if (!g || (g.where !== 'seated' && g.where !== 'standing')) return;
    this.setReseat(g.id);
    this.hud.log(`Pick a seat for ${g.name} (G or E on a chair, Esc to cancel).`);
  }

  private setReseat(id: number | null): void {
    this.reseatGuest = id;
    this.guests.setSelected(id);
  }

  /** Closes whatever is open. True if something was. */
  closePanels(): boolean {
    let closed = false;
    if (this.hud.fridgeOpen) {
      this.hud.closeFridge();
      closed = true;
    }
    if (this.hud.notesOpen) {
      this.hud.closeNotes();
      closed = true;
    }
    if (this.hud.wheelOpen) {
      this.hud.closeWheel();
      this.controls.steer = null;
      closed = true;
    }
    if (this.reseatGuest !== null) {
      this.setReseat(null);
      closed = true;
    }
    if (this.hud.ledgerOpen) {
      this.hud.ledgerOpen = false;
      closed = true;
    }
    this.controls.lookEnabled = !this.overhead;
    return closed;
  }

  private releaseMouse(): void {
    this.controls.lookEnabled = false;
    document.exitPointerLock();
  }

  setOverhead(on: boolean): void {
    this.overhead = on;
    this.controls.lookEnabled = !on;
    this.marker.visible = on;
    this.house.setOverhead(on);
    if (on) document.exitPointerLock();
    document.body.classList.toggle('overhead', on);
  }

  send(cmd: Command): void {
    this.link.send(cmd);
  }

  /** The other hosts you can hear, for the settings menu. */
  voicePeers(): { id: string; name: string; volume: number; muted: boolean }[] {
    if (!this.link.online) return [];
    return this.link
      .view()
      .players.filter((p) => p.id !== this.link.selfId)
      .map((p) => ({ id: p.id, name: p.name, ...(this.peerVoice.get(p.id) ?? { volume: 1, muted: false }) }));
  }

  setPeerVoice(id: string, change: { volume?: number; muted?: boolean }): void {
    this.peerVoice.set(id, { ...(this.peerVoice.get(id) ?? { volume: 1, muted: false }), ...change });
  }

  private me(v: GameView): PlayerView | undefined {
    return v.players.find((p) => p.id === this.link.selfId);
  }

  // --- voice -----------------------------------------------------------------------------------

  private setupVoice(): void {
    this.cleanups.push(
      this.link.onVoice((from, signal) => {
        if (isVoiceSignal(signal)) this.voice?.handleSignal(from, signal);
      }),
    );
    const off = this.opts.audio.onReady((ctx) => {
      const output = this.opts.audio.voiceBus;
      if (!output || this.disposed) return;
      void fetchIceServers(this.link.online).then((ice) => {
        if (this.disposed) return;
        const voice = new VoiceMesh({
          selfId: this.link.selfId,
          send: (to, signal) => this.link.sendVoice(to, signal),
          iceServers: ice,
          context: ctx,
          output,
        });
        voice.setMode(this.prefs.voiceMode);
        voice.onSpeakingChange((on) => this.send({ c: 'speaking', on }));
        this.voice = voice;
      });
    });
    this.cleanups.push(off);
  }

  // --- frame -----------------------------------------------------------------------------------

  /** One frame. `tick` false redraws without advancing the game (the dev renderOnce). */
  frame(dtRaw: number, tick = true): void {
    if (this.disposed) return;
    const dt = Math.min(dtRaw, 0.1);
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    if (tick) this.link.update(dt);
    const v = this.link.view();
    const now = performance.now();
    if (this.link.viewTime !== this.lastViewTime) {
      this.lastViewTime = this.link.viewTime;
      this.pushSnapshots(v, this.link.viewTime || now);
    }
    const renderT = now - (this.link.online ? NET.interpolationDelayMs : 0);
    this.samplePoses(renderT);

    const me = this.me(v);
    this.local.syncDoors(v.doors);
    this.move(v, me, dt);
    this.placeCamera();
    this.target(v, me);

    // Throw charge.
    if (this.charging !== null) {
      if (!me || me.held < 0) {
        this.charging = null;
        this.hud.setCharge(null);
      } else {
        this.charging += dt;
        this.hud.setCharge(Math.min(1, this.charging / PLAYER.throwChargeSeconds));
      }
    }

    // The world.
    const d = v.dinner;
    this.house.update(v, dt);
    this.events.update(v, dt);
    this.guests.showMeters = this.prefs.meters;
    this.guests.sync(v.phase === 'dinner' ? d : { ...d, guests: [] }, this.guestPoses, dt);
    this.players.sync(v.players, this.link.selfId, this.playerPoses, (id) => this.voice?.peerLevel(id) ?? 0, dt);
    this.props.sync(v.props, this.propPoses, me?.held ?? -1, dt);
    this.placeHeld(me);
    this.marker.position.set(this.local.feet[0], this.local.feet[1] + 0.03, this.local.feet[2]);

    // Sound and voice.
    const head = this.stage.camera.position;
    const fwd = new THREE.Vector3();
    this.stage.camera.getWorldDirection(fwd);
    const listener: Vec3 = this.overhead ? [this.local.feet[0], this.local.feet[1] + this.local.eye, this.local.feet[2]] : [head.x, head.y, head.z];
    this.sound.update(v, listener, [fwd.x, fwd.y, fwd.z], this.guestPoses, dt);
    this.updateVoice(v, listener, [fwd.x, fwd.y, fwd.z]);
    this.listening.update(this.prefs.speech, this.voice);

    // HUD.
    this.hud.showTriggers = this.prefs.triggers;
    this.hud.render(v, this.link.selfId, this.promptFor(v, me), dt);
    this.hud.renderNet(v, {
      online: this.link.online,
      code: this.link.code,
      ping: this.link.pingMs,
      snapshotAge: now - this.link.viewTime,
      fps: this.fps,
      snaps: this.snaps,
    });
    if (this.hud.wantsMouse && this.controls.locked) document.exitPointerLock();
    this.stage.render();
  }

  private pushSnapshots(v: GameView, t: number): void {
    const p = new Set<string>();
    for (const pl of v.players) {
      p.add(pl.id);
      this.tracks.players.push(t, pl.id, [pl.x, pl.y, pl.z, pl.yaw]);
    }
    this.tracks.players.retain(p);
    const g = new Set<number>();
    for (const gu of v.dinner.guests) {
      g.add(gu.id);
      this.tracks.guests.push(t, gu.id, [gu.x, gu.z, gu.yaw]);
    }
    this.tracks.guests.retain(g);
    const pr = new Set<number>();
    for (const x of v.props) {
      pr.add(x.id);
      this.tracks.props.push(t, x.id, [x.x, x.y, x.z, x.qx, x.qy, x.qz, x.qw]);
    }
    this.tracks.props.retain(pr);
  }

  private samplePoses(t: number): void {
    const v = this.link.view();
    this.playerPoses.clear();
    for (const p of v.players) {
      const s = this.tracks.players.get(p.id)?.sample(t);
      if (s) this.playerPoses.set(p.id, s);
    }
    this.guestPoses.clear();
    for (const g of v.dinner.guests) {
      const s = this.tracks.guests.get(g.id)?.sample(t);
      if (s) this.guestPoses.set(g.id, s);
    }
    this.propPoses.clear();
    for (const p of v.props) {
      const s = this.tracks.props.get(p.id)?.sample(t);
      if (s) this.propPoses.set(p.id, s);
    }
  }

  private move(v: GameView, me: PlayerView | undefined, dt: number): void {
    const busy = this.hud.sayOpen || this.hud.fridgeOpen || this.hud.notesOpen;
    const out = !!me && (me.caught || me.escaped);
    // Turned to stone by a gorgon: you can still look around, just not move.
    this.local.frozen = out || (me?.stone ?? 0) > 0;
    let intent = busy ? STILL : this.controls.intent();
    const pad = this.controls.pollGamepad(dt);
    if (pad) this.padButtons(pad.buttons);
    if (pad && !busy && intent.x === 0 && intent.z === 0 && (pad.x !== 0 || pad.y !== 0)) {
      const sin = Math.sin(this.controls.yaw);
      const cos = Math.cos(this.controls.yaw);
      const f = -pad.y;
      const r = pad.x;
      const x = -sin * f + cos * r;
      const z = -cos * f - sin * r;
      const len = Math.max(1, Math.hypot(x, z));
      intent = { x: x / len, z: z / len, sprint: !!pad.buttons[10], crouch: !!pad.buttons[11] };
    }
    const jump = !busy && this.controls.consumeJump();
    this.local.update(dt, intent, jump);
    if (me && this.local.reconcile([me.x, me.y, me.z], dt)) this.snaps++;
    if (out && me) this.local.teleport([me.x, me.y, me.z]);

    this.sendAcc += dt;
    if (this.sendAcc >= 1 / NET.sendRateHz && !out) {
      this.sendAcc = 0;
      const [x, y, z] = this.local.feet;
      this.send({ c: 'move', x: r3(x), y: r3(y), z: r3(z), yaw: r3(this.controls.yaw), pitch: r3(this.controls.pitch), crouch: this.local.crouching });
    }
    void v;
  }

  private placeCamera(): void {
    const cam = this.stage.camera;
    if (cam.fov !== this.prefs.fov) {
      cam.fov = this.prefs.fov;
      cam.updateProjectionMatrix();
    }
    if (this.overhead) {
      const c = this.tableCenter;
      cam.position.set(c.x, 8.5, c.z + 3.2);
      cam.lookAt(c.x, 0, c.z);
      return;
    }
    const [fx, fy, fz] = this.local.feet;
    cam.position.set(fx, fy + this.local.eye, fz);
    cam.rotation.set(this.controls.pitch, this.controls.yaw, 0);
  }

  private placeHeld(me: PlayerView | undefined): void {
    if (!me || me.held < 0) return;
    const o = this.props.object(me.held);
    if (!o) return;
    const cam = this.stage.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    if (this.overhead) {
      const [x, y, z] = this.local.feet;
      o.position.set(x - Math.sin(this.controls.yaw) * PLAYER.holdForward, y + this.local.eye - PLAYER.holdDown, z - Math.cos(this.controls.yaw) * PLAYER.holdForward);
    } else {
      o.position.copy(cam.position).addScaledVector(fwd, PLAYER.holdForward);
      o.position.y -= PLAYER.holdDown;
    }
    o.quaternion.setFromAxisAngle(new THREE.Object3D().up, this.controls.yaw);
  }

  private updateVoice(v: GameView, listener: Vec3, forward: Vec3): void {
    const voice = this.voice;
    if (!voice) return;
    const remotes = this.link.online ? v.players.filter((p) => p.id !== this.link.selfId) : [];
    voice.setPeers(remotes.map((p) => p.id));
    for (const [id, pv] of this.peerVoice) {
      voice.setPeerVolume(id, pv.volume);
      voice.setPeerMuted(id, pv.muted);
    }
    const doors = new Map(v.doors.map((d) => [d.id, d.open]));
    const isOpen = (id: string) => doors.get(id) ?? true;
    for (const p of remotes) {
      const pose = this.playerPoses.get(p.id) ?? [p.x, p.y, p.z];
      const at: Vec3 = [pose[0]!, pose[1]! + (p.crouch ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight), pose[2]!];
      const m = muffling(this.graph, at, listener, isOpen);
      voice.updatePeer(p.id, { position: at, cutoffHz: m.cutoffHz, gain: m.gain });
    }
    voice.setListener(listener, forward);
  }

  // --- targeting -------------------------------------------------------------------------------

  private target(v: GameView, me: PlayerView | undefined): void {
    let candidates = this.candidates(v, me);
    if (!this.overhead) {
      const eye = this.stage.camera.position;
      const from: Vec3 = [eye.x, eye.y, eye.z];
      // Things sit on or in furniture, so allow a little slack past whatever the ray hits.
      candidates = candidates.filter((c) => this.local.canSee(from, [c.focus.point.x, c.focus.point.y, c.focus.point.z], c.radius + 0.25));
    }
    const next = this.overhead
      ? pickOverhead(this.stage.camera, candidates, this.mouse, { width: window.innerWidth, height: window.innerHeight })
      : pickFirstPerson(this.stage.camera, candidates);
    if (!sameFocus(next, this.focus)) this.focus = next;
    else if (next && this.focus) this.focus.point.copy(next.point);
    this.guests.setFocus(this.focus?.kind === 'guest' ? this.focus.id : null);
  }

  private candidates(v: GameView, me: PlayerView | undefined): Candidate[] {
    const out: Candidate[] = [];
    const reach = PLAYER.reach;
    const far = this.overhead ? 40 : 0;
    const d = v.dinner;
    if (v.phase === 'dinner') {
      for (const g of d.guests) {
        if (g.where === 'gone' || g.where === 'outside') continue;
        const head = this.guests.headPosition(g.id);
        if (head) out.push({ focus: { kind: 'guest', id: g.id, point: head }, radius: 0.4, maxDistance: far || SIM.earshotMeters });
      }
      if (this.reseatGuest !== null) {
        const taken = new Set(d.guests.filter((g) => g.where === 'seated').map((g) => g.seat));
        this.seats.forEach((s, i) => {
          if (taken.has(i)) return;
          out.push({ focus: { kind: 'seat', seat: i, point: new THREE.Vector3(s.position[0], s.position[1] + 0.6, s.position[2]) }, radius: 0.35, maxDistance: far || 10 });
        });
      }
      if (d.room.neighborPresent && this.neighborPoint) out.push({ focus: { kind: 'neighbor', point: this.neighborPoint }, radius: 0.4, maxDistance: far || reach + 1 });
      const visitor = visitorHead(this.layout, d.visitor);
      if (visitor) out.push({ focus: { kind: 'visitor', point: visitor }, radius: 0.4, maxDistance: far || reach + 1 });
    }
    for (const p of v.props) {
      if (p.holder !== '' || p.at.startsWith('guest:') || p.id === me?.held) continue;
      if (p.at !== '' && !p.at.startsWith('home:')) continue; // on a station: aim at the station
      const o = this.props.object(p.id);
      if (!o) continue;
      out.push({ focus: { kind: 'prop', id: p.id, point: o.position.clone().setY(o.position.y + 0.08) }, radius: 0.2, maxDistance: far || reach + 0.3 });
    }
    for (const t of this.things) {
      out.push({ focus: { kind: 'thing', id: t.id, what: t.kind, point: t.point }, radius: THING_RADIUS[t.kind] ?? 0.3, maxDistance: far || reach + (t.kind === 'van' ? 2.5 : 0.6) });
    }
    return out;
  }

  // --- prompts ---------------------------------------------------------------------------------

  private promptFor(v: GameView, me: PlayerView | undefined): string {
    if (!me) return '';
    if (me.caught || me.escaped) return '';
    if (me.stone > 0) return `You've been turned to stone! (${Math.ceil(me.stone)}s)`;
    const held = me.held >= 0 ? v.props.find((p) => p.id === me.held) : undefined;
    const holding = held ? ` · Q drop · hold click to throw${heldHint(v, held)}` : '';
    const f = this.focus;
    if (this.reseatGuest !== null) {
      const g = v.dinner.guests.find((x) => x.id === this.reseatGuest);
      return f?.kind === 'seat' ? `E: seat ${g?.name ?? 'them'} here` : `Aim at an empty chair for ${g?.name ?? 'them'} · Esc cancels`;
    }
    if (!f) return held ? `Holding ${propLabel(held)}${holding}` : '';
    const text = this.focusPrompt(v, f, held);
    return text + holding;
  }

  private focusPrompt(v: GameView, f: Focus, held: PropView | undefined): string {
    const d = v.dinner;
    switch (f.kind) {
      case 'guest': {
        const g = d.guests.find((x) => x.id === f.id);
        if (!g) return '';
        if (g.where === 'door') return g.waitingInvite ? `E: invite ${g.name} in (or say "come in")` : `E: answer the door to ${g.name}`;
        if (g.where === 'standing') return `${g.name} · G: show them to a seat`;
        if (g.where === 'entering') return g.name;
        if (held?.kind === 'part') return `E: discreetly give ${g.name} back ${held.dish || 'that'}`;
        if (held && (held.plated || held.kind === 'bottle')) return `E: serve ${propLabel(held)} to ${g.name}`;
        return `${g.name} · right-click or 1–3: Small Talk · G: move seat`;
      }
      case 'prop': {
        const p = v.props.find((x) => x.id === f.id);
        if (!p) return '';
        if (held) return propLabel(p);
        return p.kind === 'dog' ? 'E: grab the dog (shut it in the garage)' : `E: pick up ${propLabel(p)}`;
      }
      case 'neighbor':
        return 'E: politely show Gary out';
      case 'visitor':
        return visitorPrompt(d.visitor);
      case 'seat':
        return '';
      case 'thing':
        return this.thingPrompt(v, f.id, f.what, held);
    }
  }

  private thingPrompt(v: GameView, id: string, kind: string, held: PropView | undefined): string {
    const d = v.dinner;
    const r = d.room;
    const dinner = v.phase === 'dinner';
    switch (kind) {
      case 'door': {
        const open = v.doors.find((x) => x.id === id)?.open ?? true;
        if (id === 'front' && dinner && d.guests.some((g) => g.where === 'door')) return 'E: answer the front door';
        return `E: ${open ? 'close' : 'open'} the door`;
      }
      case 'van':
        if (v.phase === 'lobby') return `E: ${this.me(v)?.ready ? 'not ready yet' : "I'm ready"} (R)`;
        return dinner && d.phase === 'chase' ? 'E: JUMP IN THE VAN!' : 'The catering van';
      case 'fridge':
        return dinner ? 'E: open the fridge' : 'Fridge';
      case 'plates':
        return 'E: take a clean plate';
      case 'wine_rack':
        return 'E: take a bottle of red';
      case 'curtain':
        return dinner ? `E: ${r.curtainsOpen ? 'close' : 'open'} the curtains` : 'Curtains';
      case 'mirror':
        return dinner ? `E: ${r.mirrorCovered ? 'uncover' : 'cover'} the mirror` : 'Mirror';
      case 'lights':
        return dinner ? `E: lights ${r.lightsOn ? 'off' : 'on'}` : 'Light switch';
      case 'record_player':
        return dinner ? `E: music ${r.musicOn ? 'off' : 'on'}` : 'Record player';
      case 'chalkboard':
        return 'E: read the Rumor Ledger';
      case 'fuse_box':
        return dinner && !r.powerOn ? 'E: flip the breaker back on' : 'Fuse box';
      case 'whiteboard':
        return dinner ? 'E: write guest notes' : 'Whiteboard';
      case 'chop':
      case 'hob':
      case 'oven':
      case 'pass':
        return dinner ? this.stationPrompt(v, id, kind, held) : STATION_LABEL[kind]!;
      default:
        return kind.replace(/_/g, ' ');
    }
  }

  private stationPrompt(v: GameView, id: string, kind: string, held: PropView | undefined): string {
    const on = v.props.find((p) => p.at === id);
    const where = STATION_LABEL[kind]!;
    if (on?.fire) return 'E: PUT OUT THE FIRE!';
    if (kind === 'pass') return held?.kind === 'food' ? `E: plate up ${propLabel(held)}` : 'The pass: bring cooked food here to plate it';
    if (held) {
      if (held.kind !== 'food') return `That doesn't go on the ${where}`;
      const next = isDish(held.dish) ? dishById(held.dish).steps[held.stage] : undefined;
      if (held.burnt) return "It's burnt: plate it anyway at the pass, or bin it";
      if (next === kind) return on ? `The ${where} is busy` : `E: put ${propLabel(held)} on the ${where}`;
      return next ? `That needs the ${STATION_LABEL[next]} next` : "That's ready: plate it at the pass";
    }
    if (!on) return `The ${where}: bring food from the fridge`;
    const steps = isDish(on.dish) ? dishById(on.dish).steps : [];
    if (kind === 'chop' && steps[on.stage] === 'chop' && !on.burnt) {
      const strokes = v.dinner.active ? SIM.chopStrokes : 4;
      return `E: chop (${Math.round(on.progress * strokes)}/${strokes})`;
    }
    return `E: take ${propLabel(on)} off`;
  }

  // --- events ----------------------------------------------------------------------------------

  private onEvents(events: GameEvent[]): void {
    const v = this.link.view();
    const self = this.link.selfId;
    const guest = (id: number) => v.dinner.guests.find((g) => g.id === id)?.name ?? 'A guest';
    const player = (id: string | null | undefined) => (id === self ? 'You' : (v.players.find((p) => p.id === id)?.name ?? 'Someone'));
    const log = (text: string, kind: LogKind = 'info') => this.hud.log(text, kind);
    this.sound.onEvents(events, v, self, this.guestPoses);
    for (const e of events) {
      switch (e.t) {
        case 'tell':
          this.guests.showTell(e.guest, e.text, e.mood);
          if (e.mood === 'bad') log(`${guest(e.guest)} ${e.text}`, 'bad');
          break;
        case 'topic':
          if (e.kind === 'start') log(`${guest(e.guest)}: “${e.text}”`);
          else if (e.kind === 'smallTalk' || e.kind === 'prop') log(`${player(e.by)} → ${guest(e.guest)}: “${e.text}”`);
          break;
        case 'topicDropped':
          log(e.text);
          break;
        case 'slip':
          this.guests.showTell(e.guest, 'SLIP!', 'bad');
          this.hud.toast(`${guest(e.guest)} is slipping! ${e.text}`, 'bad', 4);
          log(`${guest(e.guest)}: ${e.text}`, 'bad');
          break;
        case 'slipHidden':
          log(e.by ? `${player(e.by)} covered for ${guest(e.guest)}. Phew.` : `Nobody saw ${guest(e.guest)}. Phew.`, 'good');
          break;
        case 'slipSeen':
          log(`${e.witness === 'neighbor' ? 'Gary' : guest(e.witness)} saw ${guest(e.guest)} slip!`, 'bad');
          break;
        case 'strike':
          this.hud.toast(`STRIKE ${e.strikes}: ${e.reason}`, 'bad', 4);
          log(`Strike ${e.strikes}: ${e.reason}`, 'bad');
          break;
        case 'eaten':
          log(`${guest(e.by)} ate ${guest(e.guest)}. Crunch.`, 'bad');
          break;
        case 'eyeing':
          log(`${guest(e.guest)} is eyeing ${guest(e.target)}… feed them!`, 'bad');
          break;
        case 'served':
          log(e.text, e.ate ? 'good' : 'info');
          break;
        case 'question':
          if (e.target === self) this.hud.toast(`${guest(e.guest)} has a question for you! (1–3)`, 'big', 3);
          else log(`${guest(e.guest)} is asking ${player(e.target)} something.`);
          break;
        case 'answered':
          log(e.kind === 'silence' ? e.text : `${player(e.by)}: “${e.text}”`, e.kind === 'lie' ? 'info' : 'bad');
          break;
        case 'rule':
          log(`New rule (${player(e.by)}): ${ruleById(e.rule).rule}`, 'big');
          break;
        case 'ruleBroken':
          if (e.by === self) this.hud.toast(`You broke your own rule: ${ruleById(e.rule).rule}`, 'bad');
          log(`${player(e.by)} broke a rule: ${ruleById(e.rule).rule}`, 'bad');
          break;
        case 'contradiction':
          this.hud.toast(`${guest(e.guest)} narrows their eyes. That contradicts what you said before.`, 'bad', 4.5);
          break;
        case 'cover':
          if (Math.abs(e.delta) >= 3) log(`${e.delta > 0 ? '+' : ''}${e.delta} cover: ${e.reason}`, e.delta > 0 ? 'good' : 'bad');
          break;
        case 'moonrise':
          this.hud.toast('The full moon is rising. Nobody mention it.', 'big', 5);
          break;
        case 'neighbor':
          this.hud.toast(e.text, 'big', 4.5);
          break;
        case 'doorbell':
          this.hud.toast(`Ding dong! ${guest(e.guest)} is at the front door.`, 'big', 3);
          break;
        case 'greeted':
          log(`${player(e.by)} greeted ${guest(e.guest)}.`, 'good');
          break;
        case 'threshold':
          log(`${guest(e.guest)} hovers on the doorstep, waiting to be invited in…`, 'bad');
          break;
        case 'entering':
          if (e.letThemselvesIn) log(`${guest(e.guest)} got tired of waiting and let themselves in.`, 'bad');
          break;
        case 'standing':
          log(`${guest(e.guest)} is waiting to be shown a seat (G).`);
          break;
        case 'seated':
          log(e.by ? `${player(e.by)} seated ${guest(e.guest)}.` : `${guest(e.guest)} found a seat on their own.`);
          break;
        case 'reseat':
          log(`${guest(e.guest)} moves seats${e.swappedWith !== null ? ` with ${guest(e.swappedWith)}` : ''}.`);
          break;
        case 'heard':
          this.guests.showTell(e.guest, `“${e.word}”!`, 'bad');
          log(`${guest(e.guest)} heard ${player(e.by)} say “${e.word}”.`, 'bad');
          break;
        case 'phase':
          if (e.phase !== 'ended') this.hud.toast(phaseLabel({ ...v.dinner, phase: e.phase, course: e.course }), 'big', 2.5);
          break;
        case 'chase':
          this.hud.toast('THEY KNOW. Run to the van!', 'bad', 5);
          break;
        case 'caught':
          log(`${player(e.player)} ${e.player === self ? 'were' : 'was'} caught!`, 'bad');
          break;
        case 'escaped':
          log(`${player(e.player)} made it to the van!`, 'good');
          break;
        case 'ended':
          this.setReseat(null);
          this.closePanels();
          break;
        case 'note':
          if (e.to === undefined || e.to === self) log(e.text);
          break;
        case 'chat':
          this.chat(e);
          break;
        case 'joined':
          log(`${e.name} joined.`, 'good');
          break;
        case 'left':
          log(`${e.name} left.`);
          break;
        case 'cooked': {
          const dish = isDish(e.dish) ? dishById(e.dish) : null;
          if (dish && e.stage >= dish.steps.length) log(`${dish.label} is ready to plate.`, 'good');
          break;
        }
        case 'burnt':
          log(`The ${isDish(e.dish) ? dishById(e.dish).label : 'food'} is burning!`, 'bad');
          break;
        case 'fire':
          if (e.on) this.hud.toast('FIRE in the kitchen! Smother it (E) before the alarm ruins dinner.', 'bad', 4);
          break;
        case 'plated':
          log(`${player(e.by)} plated ${isDish(e.dish) ? dishById(e.dish).label : 'a dish'}.`);
          break;
        case 'lobby':
          this.setOverhead(false);
          log('Back at the van.');
          break;
        case 'dinnerStarted':
          this.hud.toast(`Tonight's booking is in. Seed ${e.seed}`, 'big', 3);
          break;
        case 'event':
          this.hud.toast(e.text, 'big', 4.5);
          log(e.text, 'big');
          break;
        case 'eventEnd':
          log(e.text, 'good');
          break;
        case 'lightning':
          this.events.flash();
          break;
        case 'toast':
          if (e.kind === 'start') {
            if (e.player === self) this.hud.toast(`${guest(e.guest)} wants a speech from you! Hold V and talk (or type with Enter). Mind your words.`, 'big', 5);
            else log(`${player(e.player)} is giving a toast. Let them talk.`);
          } else {
            log(e.kind === 'done' ? `${player(e.player)} gave a lovely toast.` : `${player(e.player)}'s toast fell flat.`, e.kind === 'done' ? 'good' : 'bad');
          }
          break;
        case 'favor':
          if (e.kind === 'asked') {
            if (e.player === self) this.hud.toast(`${guest(e.guest)} asks you a little favor: ${e.want}`, 'big', 4.5);
            log(`${guest(e.guest)} asked ${player(e.player)} for a favor: ${e.want}.`);
          } else {
            log(e.kind === 'done' ? `${player(e.player)} did ${guest(e.guest)} a favor. The debt is paid.` : `${player(e.player)} let ${guest(e.guest)} down. Fae don't forget.`, e.kind === 'done' ? 'good' : 'bad');
          }
          break;
        case 'stone':
          if (e.player === self) this.hud.toast(`${guest(e.guest)} looked you in the eye. You're stone!`, 'bad', 3);
          log(`${player(e.player)} ${e.player === self ? 'were' : 'was'} turned to stone by ${guest(e.guest)}'s gaze.`, 'bad');
          break;
        case 'partFell':
          this.hud.toast(`${guest(e.guest)} dropped ${e.part}! Pick it up and slip it back.`, 'bad', 4);
          log(`${guest(e.guest)}'s ${e.part.replace(/^(an?|their|the) /, '')} fell off.`, 'bad');
          break;
        case 'copy':
          // The copier now shows the copied guest's name and look, so there are two of them.
          log(`Wait… there are two ${guest(e.of)}s at the table now.`, 'bad');
          break;
        case 'objective':
          this.hud.toast(e.text, e.status === 'done' ? 'good' : 'bad', 4);
          log(e.text, e.status === 'done' ? 'good' : 'bad');
          break;
        case 'visitor':
          if (e.arrived) this.hud.toast(e.text, 'big', 4);
          log(e.text, e.arrived ? 'info' : 'good');
          break;
        case 'charades':
          log(e.guess >= 100 ? `The table guessed ${guest(e.guest)}'s charade!` : `${guest(e.guest)} acts something out… the table is ${e.guess}% of the way there.`);
          break;
        default:
          break;
      }
    }
  }

  /** Typed chat is "said out loud": muffled through walls, unheard far away. */
  private chat(e: Extract<GameEvent, { t: 'chat' }>): void {
    const v = this.link.view();
    const me = this.local.feet;
    const ear: Vec3 = [me[0], me[1] + this.local.eye, me[2]];
    const doors = new Map(v.doors.map((d) => [d.id, d.open]));
    const m = e.by === this.link.selfId ? { muffle: 0 } : muffling(this.graph, [e.x, e.y, e.z], ear, (id) => doors.get(id) ?? true);
    if (m.muffle >= 0.95) return;
    const text = m.muffle > 0.15 ? garble(e.text, m.muffle) : e.text;
    this.hud.log(`${e.name}${m.muffle > 0.15 ? ' (muffled)' : ''}: ${text}`, 'chat');
  }

  dispose(): void {
    this.disposed = true;
    for (const c of this.cleanups) c();
    this.controls.steer = null;
    this.listening.stop();
    this.voice?.dispose();
    this.sound.dispose();
    this.events.dispose();
    this.guests.dispose();
    this.players.dispose();
    this.props.dispose();
    this.hud.dispose();
    this.house.dispose();
    this.local.dispose();
    this.stage.scene.remove(this.marker);
    document.body.classList.remove('overhead');
  }
}

// ---------------------------------------------------------------------------------------------

function toTarget(f: Focus): Target | null {
  switch (f.kind) {
    case 'guest':
      return { kind: 'guest', id: f.id };
    case 'thing':
      return { kind: 'thing', id: f.id };
    case 'prop':
      return { kind: 'prop', id: f.id };
    case 'neighbor':
      return { kind: 'neighbor' };
    case 'visitor':
      return { kind: 'visitor' };
    case 'seat':
      return null;
  }
}

/** "in the garage": where this house keeps its fuse box, for the power cut. */
function fuseWhere(layout: Layout, graph: RoomGraph): string {
  const box = layout.interactables.find((i) => i.kind === 'fuse_box');
  const room = box ? roomAt(graph, box.position) : null;
  if (!room) return '';
  return room === 'outside' ? 'out by the front door' : `in the ${room}`;
}

/** What else you can do with what you're holding. */
function heldHint(v: GameView, held: PropView): string {
  if (held.kind === 'tea_towel' && v.dinner.room.spill) return ' · F mop up the wine (at the table)';
  if (held.kind === 'dog') return ' · carry it to the garage';
  if (held.kind === 'food' || held.kind === 'plate' || held.kind === 'part') return '';
  return ' · F hold it up';
}

/** Where the visitor's head is: the same sockets the game uses (DinnerGame.visitorSpot). */
function visitorHead(layout: Layout, v: VisitorView): THREE.Vector3 | null {
  if (!v.kind) return null;
  const id = v.kind === 'hunter' ? 'stand_0' : v.where === 'door' ? 'visitor_door' : 'neighbor';
  const s = findSocket(layout, id) ?? findSocket(layout, 'guest_door');
  return s ? new THREE.Vector3(s.position[0], s.position[1] + 1.5, s.position[2]) : null;
}

function visitorPrompt(v: VisitorView): string {
  if (v.kind === 'pizza') return v.where === 'door' ? 'E: sign for the pizza (and tip)' : 'E: steer the pizza driver back out';
  return `E: volunteer for his next trick${v.suspicion > 0 ? ` · suspicion ${Math.round(v.suspicion)}%` : ''}`;
}

function propLabel(p: PropView): string {
  const dish = isDish(p.dish) ? dishById(p.dish).label : '';
  if (p.kind === 'food') return `${p.burnt ? 'burnt ' : ''}${dish || 'food'}`;
  if (p.kind === 'plate') return dish && p.dish !== 'empty_plate' ? `a plate of ${p.burnt ? 'burnt ' : ''}${dish}` : 'a plate';
  if (p.kind === 'bottle') return 'the red wine';
  if (p.kind === 'part') return p.dish || 'something squishy';
  return `the ${p.kind.replace(/_/g, ' ')}`;
}

/** Hides a share of letters (deterministically) so muffled speech reads as muffled. */
export function garble(text: string, muffle: number): string {
  let h = 2166136261;
  let out = '';
  for (const ch of text) {
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    out += /[a-z]/i.test(ch) && (h % 1000) / 1000 < muffle ? '·' : ch;
  }
  return out;
}

/** TURN/STUN servers: the game server's /ice when online (D-013), else the build-time list. */
async function fetchIceServers(online: boolean): Promise<RTCIceServer[]> {
  if (online) {
    try {
      const res = await fetch(`${serverUrl().replace(/^ws/, 'http')}/ice`, { cache: 'no-store' });
      if (res.ok) {
        const body = (await res.json()) as { iceServers?: RTCIceServer[] };
        if (body.iceServers && body.iceServers.length > 0) return body.iceServers;
      }
    } catch {
      // An older server without /ice: fall through.
    }
  }
  return iceServers();
}

function iceServers(): RTCIceServer[] {
  const raw = import.meta.env.VITE_ICE_SERVERS as string | undefined;
  if (raw) {
    try {
      return JSON.parse(raw) as RTCIceServer[];
    } catch {
      console.warn('[voice] VITE_ICE_SERVERS is not valid JSON; using public STUN only');
    }
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type { GuestView };
