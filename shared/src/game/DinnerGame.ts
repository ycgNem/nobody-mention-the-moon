// One dinner party, start to finish: the lobby at the van, the dinner rules (shared/src/sim),
// hosts walking the house, loose physics props, the kitchen, and results. Runs on the server
// for online play and in the browser for solo play; clients send Commands and render view().

import type RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, KinematicCharacterController, RigidBody, World } from '@dimforge/rapier3d-compat';
import { DISHES, dishById, isDish, stationSeconds, type Station } from '../content/dishes.ts';
import { APRONS, GUEST_TYPES, HAIRS, HAIR_COLORS, SKIN_TONES } from '../content/guests.ts';
import { buildRoomGraph, inEarshot, roomAt, type RoomGraph } from '../house/rooms.ts';
import { findSocket, ringSeats, socketsWithPrefix, type Layout, type LayoutSeat, type LayoutSocket, type Vec3 } from '../layout.ts';
import {
  buildHouseWorld,
  createCharacterController,
  createPlayerBody,
  firstHit,
  movePlayerToward,
  removePlayerBody,
  teleportPlayer,
  PLAYER_CENTER_OFFSET,
  type PlayerBody,
} from '../physics.ts';
import { OCCASIONS } from '../content/occasions.ts';
import { pickHouse, type HouseSetting } from '../content/houses.ts';
import { hashPick } from '../rng.ts';
import {
  act,
  addPlayer as addSimPlayer,
  createDinner,
  currentMenu,
  isAvailable,
  isDark,
  isServing,
  predictNext,
  step,
  typeOf,
  wantLabel,
} from '../sim/dinner.ts';
import type { Action, DinnerState, GuestState, SimEvent, SimWorld } from '../sim/types.ts';
import { NET, PLAYER, SIM, type SimTuning } from '../tuning.ts';
import { HOUSE_PROPS, PROPS } from './props.ts';
import {
  PARTY_GUESTS,
  type Command,
  type DinnerView,
  type GameEvent,
  type GamePhase,
  type GameView,
  type GuestView,
  type HostLook,
  type NoteView,
  type PartySize,
  type PlayerView,
  type PropKind,
  type PropView,
  type Target,
} from './types.ts';

type Rapier = typeof RAPIER;

const SIM_DT = 0.1;
const SEATED_HEAD = 0.75; // above the seat
const STANDING_HEAD = 1.55;
const GUEST_FOV_COS = Math.cos((115 * Math.PI) / 180);
const CHASE_SPEED = 4.3;
const CATCH_METERS = 0.9;
const ESCAPE_METERS = 2.6;
const RESULTS_SECONDS = 45;
const DOG_SPEED = 1.7;
const THROW_HIT_METERS = 0.45;
/** Extra reach the server allows, for latency between what you aimed at and where it is now. */
const REACH_SLACK = 0.8;

interface Host {
  id: string;
  name: string;
  look: HostLook;
  body: PlayerBody;
  feet: Vec3;
  yaw: number;
  pitch: number;
  crouch: boolean;
  held: number;
  ready: boolean;
  connected: boolean;
  speaking: boolean;
  lastMove: number;
}

interface Prop {
  id: number;
  kind: PropKind;
  body: RigidBody;
  holder: string | null;
  at: string;
  dish: string;
  stage: number;
  progress: number;
  /** Seconds a finished dish has sat on a hot station (it burns, then catches fire). */
  hot: number;
  burnt: boolean;
  plated: boolean;
  fire: boolean;
  /** Seconds left before a served plate is cleared away. */
  linger: number;
  /** The dog: a host has carried it at least once since it got loose. */
  carried: boolean;
}

interface Throw {
  prop: number;
  by: string;
  until: number;
}

interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface GameOptions {
  /** The house the room starts in. */
  layout: Layout;
  /** Every house the party can move to (the lobby's house setting). Defaults to just `layout`. */
  houses?: readonly Layout[];
  /** Fresh dinner seeds (the caller owns randomness: shared code never calls Math.random). */
  newSeed: () => string;
  /** Picks cosmetics for a new player from an index (deterministic in tests). */
  tuning?: Partial<SimTuning>;
}

export class DinnerGame {
  // The house: replaced together by moveHouse() (lobby only).
  layout: Layout;
  graph: RoomGraph;
  seats: LayoutSeat[];
  private world: World;
  private named: Map<string, Collider>;
  private cc: KinematicCharacterController;
  private readonly houses: Map<string, Layout>;
  private readonly R: Rapier;
  private readonly newSeed: () => string;
  private readonly tuningOverrides: Partial<SimTuning>;

  phase: GamePhase = 'lobby';
  roomHost = '';
  size: PartySize = 'dinner';
  seedSetting = '';
  relaxed = false;
  tutorial = false;
  houseSetting: HouseSetting = 'surprise';
  dinner: DinnerState | null = null;
  private resultsTime = 0;
  private readonly hosts = new Map<string, Host>();
  private readonly props = new Map<number, Prop>();
  private nextProp = 1;
  private readonly doors = new Map<string, boolean>();
  private notes: NoteView[] = [];
  private time = 0;
  private simAcc = 0;
  private events: GameEvent[] = [];
  private readonly chasePos = new Map<number, Pose>();
  private throws: Throw[] = [];
  private joinCount = 0;

  constructor(R: Rapier, opts: GameOptions) {
    this.R = R;
    this.layout = opts.layout;
    this.graph = buildRoomGraph(opts.layout);
    this.seats = ringSeats(opts.layout);
    this.newSeed = opts.newSeed;
    this.tuningOverrides = opts.tuning ?? {};
    this.houses = new Map([...(opts.houses ?? []), opts.layout].map((l) => [l.asset, l]));
    const { world, named } = buildHouseWorld(R, opts.layout);
    this.world = world;
    this.named = named;
    this.cc = createCharacterController(world);
    this.resetDoors();
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }

  // --- players ---------------------------------------------------------------------------------

  addPlayer(id: string, name: string, look?: Partial<HostLook>): void {
    if (this.hosts.has(id)) {
      this.setConnected(id, true);
      return;
    }
    const n = this.joinCount++;
    const used = new Set([...this.hosts.values()].map((h) => h.look.apron));
    const spawn = this.freeSpawn();
    const host: Host = {
      id,
      name: name.trim().slice(0, 16) || `Host ${this.hosts.size + 1}`,
      look: {
        apron: APRONS.find((c) => !used.has(c)) ?? APRONS[n % APRONS.length]!,
        hat: 'none',
        skin: SKIN_TONES[(n * 2 + 1) % SKIN_TONES.length]!,
        hair: HAIRS[n % HAIRS.length]!,
        hairColor: HAIR_COLORS[(n * 3) % HAIR_COLORS.length]!,
        ...look,
      },
      body: createPlayerBody(this.R, this.world, spawn.position),
      feet: [...spawn.position],
      yaw: spawn.yaw,
      pitch: 0,
      crouch: false,
      held: -1,
      ready: false,
      connected: true,
      speaking: false,
      lastMove: this.time,
    };
    this.hosts.set(id, host);
    // A newcomer takes over if the room host is gone or still reconnecting.
    if (!this.roomHost || !this.hosts.get(this.roomHost)?.connected) this.roomHost = id;
    if (this.dinner) addSimPlayer(this.dinner, id, host.name);
    this.events.push({ t: 'joined', player: id, name: host.name });
  }

  removePlayer(id: string): void {
    const h = this.hosts.get(id);
    if (!h) return;
    this.dropHeld(h, 0);
    removePlayerBody(this.world, h.body);
    this.hosts.delete(id);
    this.events.push({ t: 'left', player: id, name: h.name });
    if (this.roomHost === id) this.roomHost = this.hosts.keys().next().value ?? '';
  }

  /** Disconnected players keep their place for a while (server reconnection window). */
  setConnected(id: string, connected: boolean): void {
    const h = this.hosts.get(id);
    if (!h) return;
    h.connected = connected;
    if (!connected) {
      h.speaking = false;
      if (this.roomHost === id) {
        const next = [...this.hosts.values()].find((x) => x.connected);
        if (next) this.roomHost = next.id;
      }
    }
  }

  get playerCount(): number {
    return this.hosts.size;
  }

  hasPlayer(id: string): boolean {
    return this.hosts.has(id);
  }

  /** Where a host's feet are on the server (for reconnects and tests). */
  feetOf(id: string): Vec3 | null {
    const h = this.hosts.get(id);
    return h ? [...h.feet] : null;
  }

  /** Puts a host somewhere directly (tests, the dev handle and the tutorial). */
  teleport(id: string, feet: Vec3, yaw?: number): void {
    const h = this.hosts.get(id);
    if (!h) return;
    teleportPlayer(h.body, [feet[0], feet[1] + PLAYER_CENTER_OFFSET, feet[2]]);
    h.feet = [...feet];
    if (yaw !== undefined) h.yaw = yaw;
  }

  private freeSpawn(): { position: Vec3; yaw: number } {
    const spawns = this.layout.spawns;
    if (spawns.length === 0) throw new Error(`${this.layout.asset} has no spawn points`);
    const taken = [...this.hosts.values()];
    const clear = spawns.find((s) => taken.every((h) => Math.hypot(h.feet[0] - s.position[0], h.feet[2] - s.position[2]) > PLAYER.radius * 3));
    const s = clear ?? spawns[this.hosts.size % spawns.length]!;
    return { position: [...s.position], yaw: s.yaw };
  }

  // --- commands --------------------------------------------------------------------------------

  command(id: string, cmd: Command): void {
    const h = this.hosts.get(id);
    if (!h) return;
    const d = this.dinner;
    switch (cmd.c) {
      case 'move':
        return this.move(h, cmd);
      case 'look':
        h.look = { ...h.look, ...cmd.look };
        return;
      case 'ready':
        if (this.phase === 'lobby') h.ready = cmd.ready;
        return;
      case 'settings':
        if (id !== this.roomHost || this.phase !== 'lobby') return;
        if (cmd.size) this.size = cmd.size;
        if (cmd.seed !== undefined) this.seedSetting = cmd.seed.trim().toUpperCase().slice(0, 24);
        if (cmd.relaxed !== undefined) this.relaxed = cmd.relaxed;
        if (cmd.tutorial !== undefined) this.tutorial = cmd.tutorial;
        if (cmd.house !== undefined && (cmd.house === 'surprise' || this.houses.has(cmd.house))) {
          this.houseSetting = cmd.house;
          if (cmd.house !== 'surprise') this.moveHouse(cmd.house);
        }
        return;
      case 'start':
        if (id === this.roomHost && this.phase === 'lobby') this.startDinner();
        return;
      case 'back':
        if (id === this.roomHost && this.phase === 'results') this.toLobby();
        return;
      case 'speaking':
        h.speaking = cmd.on;
        return;
      case 'note':
        if (!d || !d.guests[cmd.guest]) return;
        this.notes = this.notes.filter((n) => n.guest !== cmd.guest);
        if (cmd.label) this.notes.push({ guest: cmd.guest, label: cmd.label, by: id });
        return;
      case 'say': {
        const text = cmd.text.trim();
        if (!text) return;
        const head = this.headOf(h);
        this.events.push({ t: 'chat', by: id, name: h.name, text, x: head[0], y: head[1], z: head[2] });
        if (d) this.sim({ type: 'say', by: id, text });
        return;
      }
      case 'heard':
        if (d) this.sim({ type: 'say', by: id, text: cmd.word, voice: true });
        return;
      case 'drop':
        return this.dropHeld(h, 0);
      case 'throw':
        return this.dropHeld(h, Math.max(0, Math.min(1, cmd.power)));
      default:
        break;
    }
    if (!d || this.phase !== 'dinner') {
      if (cmd.c === 'interact') this.interactLobby(h, cmd.target);
      return;
    }
    switch (cmd.c) {
      case 'skip':
        this.sim({ type: 'skip', by: id });
        return;
      case 'smallTalk':
        this.sim({ type: 'smallTalk', by: id, guest: cmd.guest, card: cmd.card });
        return;
      case 'answer':
        this.sim({ type: 'answer', by: id, choice: cmd.choice });
        return;
      case 'reseat':
        this.sim({ type: 'reseat', by: id, guest: cmd.guest, seat: cmd.seat });
        return;
      case 'holdUp': {
        const p = this.props.get(h.held);
        if (p?.kind === 'tea_towel' && d.room.spill) {
          if (!this.reachable(h, this.tableCenter(), 1.2)) return this.note(id, 'Get to the table to mop up the wine.');
          this.sim({ type: 'clean', by: id });
          return;
        }
        const topic = p ? (p.kind === 'bottle' ? 'wine_bottle' : PROPS[p.kind].topic) : null;
        if (!topic) return this.note(id, 'Hold something interesting first (a painting, the candles, a snow globe…).');
        this.sim({ type: 'prop', by: id, prop: topic });
        return;
      }
      case 'take':
        return this.take(h, cmd.from, cmd.dish);
      case 'interact':
        return this.interact(h, cmd.target);
      default:
        return;
    }
  }

  private note(to: string, text: string): void {
    this.events.push({ t: 'note', text, to });
  }

  private sim(action: Action): void {
    if (!this.dinner) return;
    this.simEvents(act(this.dinner, action, this.simWorld()));
  }

  /** Sim events, plus the physical things some of them need (the dog, fallen-off parts). */
  private simEvents(evs: SimEvent[]): void {
    this.events.push(...evs);
    for (const e of evs) {
      if (e.t === 'event' && e.id === 'dog') this.releaseDog();
      else if (e.t === 'eventEnd' && e.id === 'dog') {
        for (const p of [...this.props.values()]) if (p.kind === 'dog') this.removeProp(p);
      } else if (e.t === 'partFell') this.dropPart(e.guest, e.part);
    }
  }

  private tableCenter(): Vec3 {
    const s = this.socket('lamp_light');
    return s ? [s.position[0], 0.8, s.position[2]] : [0, 0.8, 0];
  }

  private releaseDog(): void {
    if ([...this.props.values()].some((p) => p.kind === 'dog')) return;
    const s = this.socket('dog');
    this.spawnProp('dog', { placedAt: s?.position ?? [0, 0, 0], yaw: s?.yaw ?? 0 });
  }

  private dropPart(gid: number, part: string): void {
    const g = this.dinner?.guests[gid];
    const head = g ? this.guestHead(g) : null;
    if (!head) return;
    const p = this.spawnProp('part', { placedAt: [head[0], head[1] - 0.2, head[2]], dish: part });
    p.body.setBodyType(this.R.RigidBodyType.Dynamic, true);
    p.body.setLinvel({ x: 0.6, y: 0.5, z: 0.4 }, true);
  }

  /** The dog runs for the dining table unless someone is carrying it; set down in the garage, it stays. */
  private tickDog(dt: number): void {
    const d = this.dinner;
    for (const p of this.props.values()) {
      if (p.kind !== 'dog' || p.holder) continue;
      const t = p.body.translation();
      const pos: Vec3 = [t.x, t.y, t.z];
      if (p.carried && roomAt(this.graph, [t.x, t.y + 0.5, t.z]) === 'garage') {
        if (d?.room.dogLoose) this.sim({ type: 'dogHome', by: this.lastCarrier ?? '' });
        return;
      }
      if (p.body.bodyType() !== this.R.RigidBodyType.KinematicPositionBased) {
        if (Math.hypot(p.body.linvel().x, p.body.linvel().z) > 0.3) continue;
        this.setKinematic(p);
      }
      const table = this.tableCenter();
      if (Math.hypot(table[0] - t.x, table[2] - t.z) < 0.9) continue;
      const goal = this.routeToward([pos[0], pos[1] + 0.5, pos[2]], [table[0], 0.5, table[2]]);
      const dx = goal[0] - t.x;
      const dz = goal[2] - t.z;
      const len = Math.hypot(dx, dz) || 1;
      const stepLen = Math.min(len, DOG_SPEED * dt);
      const floor = this.floorBelow([t.x + (dx / len) * stepLen, t.y + 0.6, t.z + (dz / len) * stepLen]);
      p.body.setNextKinematicTranslation({ x: t.x + (dx / len) * stepLen, y: floor, z: t.z + (dz / len) * stepLen });
      p.body.setNextKinematicRotation(yawQuat(Math.atan2(-dx, -dz)));
    }
  }

  private lastCarrier: string | null = null;

  /** Floor height under a point (stairs, the cellar), for things that walk. */
  private floorBelow(p: Vec3): number {
    const hit = firstHit(this.R, this.world, p, [p[0], p[1] - 4, p[2]]);
    return hit ? p[1] - hit.distance : 0;
  }

  /** Thrown props flying across the dining room: what they hit. */
  private tickThrows(): void {
    const d = this.dinner;
    if (!d || this.throws.length === 0) return;
    const keep: Throw[] = [];
    for (const th of this.throws) {
      const p = this.props.get(th.prop);
      if (!p) continue;
      const t = p.body.translation();
      let hit: number | null = null;
      for (const g of d.guests) {
        if (!isAvailable(g)) continue;
        const head = this.guestHead(g);
        if (head && Math.hypot(head[0] - t.x, head[1] - t.y, head[2] - t.z) < THROW_HIT_METERS) hit = g.id;
      }
      if (hit !== null || this.time >= th.until) {
        if (hit !== null || roomAt(this.graph, [t.x, t.y, t.z]) === 'dining') this.sim({ type: 'thrown', by: th.by, hit });
        continue;
      }
      keep.push(th);
    }
    this.throws = keep;
  }

  private move(h: Host, m: Extract<Command, { c: 'move' }>): void {
    const sp = this.dinner?.players.find((p) => p.id === h.id);
    if (sp && sp.stone > 0) return;
    const dt = Math.min(Math.max(this.time - h.lastMove, 1 / 60), 0.25);
    h.lastMove = this.time;
    if (this.dinner?.phase === 'chase' && this.dinner.players.find((p) => p.id === h.id)?.caught) return;
    const maxStep = PLAYER.sprintSpeed * NET.speedTolerance * dt + 0.05;
    h.feet = movePlayerToward(this.cc, h.body, [m.x, m.y, m.z], maxStep);
    h.yaw = m.yaw;
    h.pitch = Math.max(-1.5, Math.min(1.5, m.pitch));
    h.crouch = m.crouch;
  }

  // --- geometry helpers ------------------------------------------------------------------------

  private headOf(h: Host): Vec3 {
    return [h.feet[0], h.feet[1] + (h.crouch ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight), h.feet[2]];
  }

  private forwardOf(h: Host): Vec3 {
    const cp = Math.cos(h.pitch);
    return [-Math.sin(h.yaw) * cp, Math.sin(h.pitch), -Math.cos(h.yaw) * cp];
  }

  private holdPoint(h: Host): Vec3 {
    const eye = this.headOf(h);
    const f = this.forwardOf(h);
    return [eye[0] + f[0] * PLAYER.holdForward, eye[1] + f[1] * PLAYER.holdForward - PLAYER.holdDown, eye[2] + f[2] * PLAYER.holdForward];
  }

  private reachable(h: Host, p: Vec3, extra = 0): boolean {
    const e = this.headOf(h);
    return Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]) <= PLAYER.reach + REACH_SLACK + extra;
  }

  private interactable(id: string) {
    return this.layout.interactables.find((i) => i.id === id);
  }

  isDoorOpen = (id: string): boolean => this.doors.get(id) ?? true;

  private resetDoors(): void {
    for (const d of this.layout.doors) {
      if (!d.leaf) continue;
      this.setDoor(d.id, d.open);
    }
  }

  private setDoor(id: string, open: boolean): void {
    this.doors.set(id, open);
    this.named.get(`col_box_doorleaf_${id}`)?.setEnabled(!open);
  }

  // --- guests in the house ---------------------------------------------------------------------

  private socket(id: string): LayoutSocket | undefined {
    return findSocket(this.layout, id);
  }

  private seatPose(seat: number): Pose {
    const s = this.seats[seat]!;
    return { x: s.position[0], y: s.position[1] - 0.45, z: s.position[2], yaw: s.yaw };
  }

  private standSockets(): LayoutSocket[] {
    return socketsWithPrefix(this.layout, 'stand_');
  }

  /** Where a guest is right now (floor position + facing), or null if not in the house. */
  guestPose(g: GuestState): Pose | null {
    if (g.eaten || g.where === 'outside' || g.where === 'gone') return null;
    if (this.dinner?.phase === 'chase' || this.chasePos.has(g.id)) {
      const c = this.chasePos.get(g.id);
      if (c) return c;
    }
    const at = (s: LayoutSocket | undefined): Pose => (s ? { x: s.position[0], y: s.position[1], z: s.position[2], yaw: s.yaw } : { x: 0, y: 0, z: 0, yaw: 0 });
    switch (g.where) {
      case 'door':
        return at(this.socket('guest_door'));
      case 'seated':
        return this.seatPose(g.seat);
      case 'standing':
        return at(this.standSockets()[g.standSpot] ?? this.standSockets()[0]);
      case 'entering': {
        const pts = this.entryRoute(this.standSockets()[g.standSpot] ?? this.standSockets()[0]);
        const tu = this.dinner!.tuning;
        return along(pts, Math.min(1, g.whereTime / tu.walkInSeconds));
      }
    }
  }

  /** A guest's walk from the front door to a standing spot, through the house's path sockets. */
  private entryRoute(stand: LayoutSocket | undefined): Vec3[] {
    const ids = ['guest_door', 'path_0', 'path_1', 'path_2'];
    const pts = ids.map((id) => this.socket(id)).filter((s): s is LayoutSocket => !!s).map((s) => s.position);
    const p2 = this.socket('path_2');
    if (stand && p2) {
      const side = this.socket(stand.position[2] > p2.position[2] ? 'path_s' : 'path_n');
      if (side) pts.push(side.position);
      pts.push(stand.position);
    }
    return pts;
  }

  /** Seconds to walk in at SIM.guestWalkSpeed, over this house's average route (null: no route). */
  private walkInSeconds(): number | null {
    const routes = this.standSockets().map((s) => this.entryRoute(s));
    const lengths = routes.map((pts) => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i]![0], p[2] - pts[i]![2]), 0));
    const total = lengths.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    return Math.round((total / lengths.length / (this.tuningOverrides.guestWalkSpeed ?? SIM.guestWalkSpeed)) * 10) / 10;
  }

  private guestHead(g: GuestState): Vec3 | null {
    const p = this.guestPose(g);
    if (!p) return null;
    const seated = g.where === 'seated' && !this.chasePos.has(g.id);
    return [p.x, p.y + (seated ? 0.45 + SEATED_HEAD : STANDING_HEAD), p.z];
  }

  private neighborHead(): Vec3 | null {
    const s = this.socket('neighbor');
    return s ? [s.position[0], s.position[1] + STANDING_HEAD, s.position[2]] : null;
  }

  /** Clear line from eye to target, within the viewer's field of view and the light. */
  private canSee(eye: Vec3, yaw: number | null, target: Vec3, exclude?: Collider): boolean {
    const dx = target[0] - eye[0];
    const dy = target[1] - eye[1];
    const dz = target[2] - eye[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return true;
    const d = this.dinner;
    if (d && isDark(d) && len > d.tuning.darkSightMeters) return false;
    if (yaw !== null) {
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const flat = Math.hypot(dx, dz) || 1;
      if ((fx * dx + fz * dz) / flat < GUEST_FOV_COS) return false;
    }
    return firstHit(this.R, this.world, eye, target, exclude) === null;
  }

  private simWorld(): SimWorld {
    const d = this.dinner!;
    return {
      canHear: (gid, pid) => {
        const h = this.hosts.get(pid);
        const g = d.guests[gid];
        const head = g ? this.guestHead(g) : null;
        if (!h || !h.connected || !head) return false;
        return inEarshot(this.graph, this.headOf(h), head, this.isDoorOpen, d.tuning.earshotMeters);
      },
      sees: (viewer, gid) => {
        const g = d.guests[gid];
        const target = g ? this.guestHead(g) : null;
        if (!target) return false;
        if (viewer === 'neighbor') {
          const eye = this.neighborHead();
          return !!eye && this.canSee(eye, this.socket('neighbor')?.yaw ?? null, target);
        }
        const w = d.guests[viewer];
        const eye = w ? this.guestHead(w) : null;
        const pose = w ? this.guestPose(w) : null;
        return !!eye && !!pose && this.canSee(eye, pose.yaw, target);
      },
      seenBy: (pid) => {
        const h = this.hosts.get(pid);
        if (!h) return false;
        const head = this.headOf(h);
        const target: Vec3 = [head[0], head[1] - 0.15, head[2]];
        return d.guests.some((g) => {
          if (!isAvailable(g)) return false;
          const eye = this.guestHead(g);
          const pose = this.guestPose(g);
          return !!eye && !!pose && this.canSee(eye, pose.yaw, target, h.body.collider);
        });
      },
      blocker: (gid) => {
        const g = d.guests[gid];
        const pose = g ? this.guestPose(g) : null;
        if (!pose) return null;
        let best: string | null = null;
        let bestDist = 1.4;
        for (const h of this.hosts.values()) {
          const dist = Math.hypot(h.feet[0] - pose.x, h.feet[2] - pose.z);
          if (dist < bestDist) {
            best = h.id;
            bestDist = dist;
          }
        }
        return best;
      },
      speaking: (pid) => this.hosts.get(pid)?.speaking ?? false,
      gazeAt: (gid) => {
        const g = d.guests[gid];
        const eye = g ? this.guestHead(g) : null;
        const pose = g ? this.guestPose(g) : null;
        if (!eye || !pose) return [];
        const out: string[] = [];
        for (const h of this.hosts.values()) {
          if (!h.connected) continue;
          if (this.canSee(eye, pose.yaw, this.headOf(h), h.body.collider)) out.push(h.id);
        }
        return out;
      },
      dogAtTable: () => {
        for (const p of this.props.values()) {
          if (p.kind !== 'dog' || p.holder) continue;
          const t = p.body.translation();
          if (roomAt(this.graph, [t.x, t.y + 0.5, t.z]) === 'dining') return true;
        }
        return false;
      },
      partsInView: () => {
        let n = 0;
        for (const p of this.props.values()) {
          if (p.kind !== 'part' || p.holder) continue;
          const t = p.body.translation();
          if (roomAt(this.graph, [t.x, t.y + 0.3, t.z]) === 'dining') n++;
        }
        return n;
      },
    };
  }

  // --- lobby, dinner, results ------------------------------------------------------------------

  private interactLobby(h: Host, target: Target): void {
    if (target.kind === 'prop') return this.grab(h, target.id);
    if (target.kind !== 'thing') return;
    const it = this.interactable(target.id);
    if (!it || !this.reachable(h, it.position, 0.5)) return;
    if (it.kind === 'van' && this.phase === 'lobby') h.ready = !h.ready;
    else if (it.kind === 'door') this.setDoor(it.id, !this.isDoorOpen(it.id));
  }

  startDinner(): void {
    if (this.phase !== 'lobby' || this.hosts.size === 0) return;
    const seed = this.seedSetting || this.newSeed();
    this.moveHouse(this.houseFor(seed));
    const size = this.size === 'surprise' ? (['cozy', 'dinner', 'banquet'] as const)[hashPick(seed, 3)]! : this.size;
    const guests = Math.min(PARTY_GUESTS[size], this.seats.length);
    const walkIn = this.walkInSeconds();
    this.dinner = createDinner({
      seed,
      seatCount: this.seats.length,
      standCount: Math.max(1, this.standSockets().length),
      players: [...this.hosts.values()].map((h) => ({ id: h.id, name: h.name })),
      relaxed: this.relaxed || this.tutorial,
      tutorial: this.tutorial,
      // Guests walk in at the same pace in every house: the manor's long hall takes longer.
      tuning: { ...(walkIn ? { walkInSeconds: walkIn } : {}), ...this.tuningOverrides, guests },
    });
    this.throws = [];
    this.clearProps();
    this.resetDoors();
    this.notes = [];
    this.chasePos.clear();
    for (const kind of HOUSE_PROPS) {
      const home = PROPS[kind].home;
      const s = home ? this.socket(home) : undefined;
      if (s) this.spawnProp(kind, { placedAt: s.position, yaw: s.yaw, at: `home:${home}` });
    }
    for (const h of this.hosts.values()) h.ready = false;
    this.phase = 'dinner';
    this.simAcc = 0;
    this.events.push({ t: 'dinnerStarted', seed });
  }

  /** The house a dinner with this seed happens in: the lobby's pick, or one the seed chooses. */
  houseFor(seed: string): string {
    return this.houseSetting !== 'surprise' ? this.houseSetting : pickHouse(seed, [...this.houses.keys()]);
  }

  /**
   * Moves the party to another house (lobby only): a new physics world from its layout, the props
   * cleared and everyone back at its van. Clients see `asset` change and load the new house.
   */
  private moveHouse(asset: string): void {
    const layout = this.houses.get(asset);
    if (!layout || layout === this.layout || this.phase !== 'lobby') return;
    this.clearProps();
    this.throws = [];
    this.chasePos.clear();
    this.world.free();
    this.layout = layout;
    this.graph = buildRoomGraph(layout);
    this.seats = ringSeats(layout);
    const { world, named } = buildHouseWorld(this.R, layout);
    this.world = world;
    this.named = named;
    this.cc = createCharacterController(world);
    this.doors.clear();
    this.resetDoors();
    const hosts = [...this.hosts.values()];
    for (const h of hosts) h.feet = [Infinity, 0, Infinity]; // so freeSpawn ignores old positions
    for (const h of hosts) {
      const s = this.freeSpawn();
      h.body = createPlayerBody(this.R, world, s.position);
      h.feet = [...s.position];
      h.yaw = s.yaw;
      h.held = -1;
    }
    this.world.step();
  }

  private toLobby(): void {
    this.phase = 'lobby';
    this.dinner = null;
    // The First Shift is played once; the next dinner is a real booking unless they tick it again.
    this.tutorial = false;
    this.chasePos.clear();
    this.clearProps();
    this.resetDoors();
    this.notes = [];
    for (const h of this.hosts.values()) {
      h.held = -1;
      h.ready = false;
      const s = this.freeSpawn();
      teleportPlayer(h.body, [s.position[0], s.position[1] + PLAYER_CENTER_OFFSET, s.position[2]]);
      h.feet = [...s.position];
      h.yaw = s.yaw;
    }
    this.events.push({ t: 'lobby' });
  }

  // --- props -----------------------------------------------------------------------------------

  private spawnProp(kind: PropKind, opts: { placedAt?: Vec3; yaw?: number; at?: string; holder?: Host; dish?: string; plated?: boolean }): Prop {
    const R = this.R;
    const def = PROPS[kind];
    const pos = opts.placedAt ?? (opts.holder ? this.holdPoint(opts.holder) : [0, 1, 0]);
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(pos[0], pos[1], pos[2])
        .setRotation(yawQuat(opts.yaw ?? opts.holder?.yaw ?? 0))
        .setCcdEnabled(true),
    );
    const [hx, hy, hz] = def.half;
    this.world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, hy, 0).setMass(def.mass).setFriction(0.8).setRestitution(0.1),
      body,
    );
    const prop: Prop = {
      id: this.nextProp++,
      kind,
      body,
      holder: opts.holder?.id ?? null,
      at: opts.at ?? '',
      dish: opts.dish ?? '',
      stage: 0,
      progress: 0,
      hot: 0,
      burnt: false,
      plated: opts.plated ?? false,
      fire: false,
      linger: 0,
      carried: false,
    };
    this.props.set(prop.id, prop);
    if (opts.holder) opts.holder.held = prop.id;
    return prop;
  }

  private removeProp(p: Prop): void {
    if (p.holder) {
      const h = this.hosts.get(p.holder);
      if (h) h.held = -1;
    }
    this.world.removeRigidBody(p.body);
    this.props.delete(p.id);
  }

  private clearProps(): void {
    for (const p of [...this.props.values()]) this.removeProp(p);
    for (const h of this.hosts.values()) h.held = -1;
  }

  private setKinematic(p: Prop): void {
    p.body.setBodyType(this.R.RigidBodyType.KinematicPositionBased, true);
  }

  private place(p: Prop, pos: Vec3, yaw: number): void {
    this.setKinematic(p);
    p.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
    p.body.setRotation(yawQuat(yaw), true);
  }

  private grab(h: Host, id: number): void {
    const p = this.props.get(id);
    if (!p || p.holder || h.held !== -1 || p.at.startsWith('guest:')) return;
    const t = p.body.translation();
    if (!this.reachable(h, [t.x, t.y, t.z], 0.3)) return;
    if (p.fire) return this.note(h.id, "It's on fire! Put it out first.");
    p.holder = h.id;
    p.at = '';
    p.hot = 0;
    h.held = p.id;
    if (p.kind === 'dog') {
      p.carried = true;
      this.lastCarrier = h.id;
    }
    this.setKinematic(p);
    this.events.push({ t: 'sfx', name: 'pickup', x: t.x, y: t.y, z: t.z });
    if (p.dish && (dishById(p.dish).tags as readonly string[]).includes('garlic')) this.sim({ type: 'did', by: h.id, what: 'garlic' });
  }

  private dropHeld(h: Host, power: number): void {
    const p = this.props.get(h.held);
    h.held = -1;
    if (!p) return;
    p.holder = null;
    const pos = this.holdPoint(h);
    p.body.setBodyType(this.R.RigidBodyType.Dynamic, true);
    p.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
    if (power > 0) {
      const f = this.forwardOf(h);
      const speed = PLAYER.throwMin + (PLAYER.throwMax - PLAYER.throwMin) * power;
      p.body.setLinvel({ x: f[0] * speed, y: f[1] * speed + 1.2, z: f[2] * speed }, true);
      p.body.setAngvel({ x: speed * 0.6, y: 0.5, z: 0.2 }, true);
      this.events.push({ t: 'sfx', name: 'throw', x: pos[0], y: pos[1], z: pos[2] });
      if (this.dinner) this.throws.push({ prop: p.id, by: h.id, until: this.time + 1.5 });
    } else {
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.events.push({ t: 'sfx', name: 'drop', x: pos[0], y: pos[1], z: pos[2] });
    }
  }

  // --- the kitchen -----------------------------------------------------------------------------

  /** Fridge, cellar or plate stack → a new item in your hands. */
  private take(h: Host, from: 'fridge' | 'cellar' | 'plates', dishId: string): void {
    const d = this.dinner!;
    if (h.held !== -1) return this.note(h.id, 'Your hands are full.');
    const kind = from === 'fridge' ? 'fridge' : from === 'cellar' ? 'wine_rack' : 'plates';
    const it = this.layout.interactables.find((i) => i.kind === kind);
    if (!it || !this.reachable(h, it.position, 0.6)) return;
    if (!isDish(dishId)) return;
    const dish = dishById(dishId);
    if (dish.source !== from) return;
    if (from === 'fridge') {
      const menu = currentMenu(d);
      if (!menu.includes(dishId)) return this.note(h.id, `${dish.label} isn't on this course's menu.`);
    }
    if (from === 'fridge') this.spawnProp('food', { holder: h, dish: dishId });
    else if (from === 'cellar') this.spawnProp('bottle', { holder: h, dish: dishId, plated: true });
    else this.spawnProp('plate', { holder: h, dish: dishId, plated: true });
    this.events.push({ t: 'sfx', name: from === 'fridge' ? 'fridge' : 'pickup', x: it.position[0], y: it.position[1], z: it.position[2] });
  }

  private stationOccupant(id: string): Prop | undefined {
    for (const p of this.props.values()) if (p.at === id) return p;
    return undefined;
  }

  private stationKind(id: string): Station | 'pass' | null {
    const kind = this.interactable(id)?.kind;
    return kind === 'chop' || kind === 'hob' || kind === 'oven' || kind === 'pass' ? kind : null;
  }

  private useStation(h: Host, id: string): void {
    const kind = this.stationKind(id);
    const it = this.interactable(id);
    if (!kind || !it) return;
    const held = this.props.get(h.held);
    const on = this.stationOccupant(id);
    const sfxAt = (name: string) => this.events.push({ t: 'sfx', name, x: it.position[0], y: it.position[1], z: it.position[2] });

    if (on?.fire) {
      on.fire = false;
      this.removeProp(on);
      sfxAt('whoosh');
      this.events.push({ t: 'fire', at: id, on: false });
      if (![...this.props.values()].some((p) => p.fire)) this.sim({ type: 'alarm', on: false });
      return this.note(h.id, 'You smother the flames. The smoke alarm finally stops.');
    }

    if (kind === 'pass') {
      if (!held || held.kind !== 'food') return this.note(h.id, 'Bring cooked food here to plate it.');
      const dish = dishById(held.dish);
      if (held.stage < dish.steps.length && !held.burnt) {
        return this.note(h.id, `That still needs the ${dish.steps[held.stage]}.`);
      }
      held.kind = 'plate';
      held.plated = true;
      this.sim({ type: 'plated', by: h.id });
      sfxAt('plate_clink');
      this.events.push({ t: 'plated', prop: held.id, dish: held.dish, by: h.id });
      return;
    }

    if (held) {
      if (held.kind !== 'food') return this.note(h.id, "That doesn't go there.");
      if (on) return this.note(h.id, 'Something is already there.');
      const dish = dishById(held.dish);
      const next = dish.steps[held.stage];
      if (held.burnt) return this.note(h.id, "It's burnt. Plate it anyway, or bin it.");
      if (next !== kind) {
        return this.note(h.id, next ? `That needs the ${next} next.` : "It's ready. Plate it at the pass.");
      }
      const s = this.socket(`station_${id}`);
      held.holder = null;
      held.at = id;
      held.hot = 0;
      h.held = -1;
      this.place(held, s?.position ?? it.position, 0);
      sfxAt(kind === 'chop' ? 'plate_clink' : 'sizzle');
      return;
    }

    if (!on) return;
    if (kind === 'chop') {
      const dish = dishById(on.dish);
      if (dish.steps[on.stage] === 'chop' && !on.burnt) {
        const strokes = this.dinner!.tuning.chopStrokes;
        on.progress = Math.min(1, on.progress + 1 / strokes);
        sfxAt('chop');
        if (on.progress >= 1 - 1e-6) {
          on.stage++;
          on.progress = 0;
          this.events.push({ t: 'cooked', prop: on.id, dish: on.dish, stage: on.stage });
        }
        return;
      }
    }
    this.grab(h, on.id);
  }

  private tickKitchen(dt: number): void {
    const d = this.dinner;
    if (!d) return;
    const tu = d.tuning;
    for (const p of [...this.props.values()]) {
      if (p.at.startsWith('guest:')) {
        p.linger -= dt;
        if (p.linger <= 0) this.removeProp(p);
        continue;
      }
      if (p.kind !== 'food' || !p.at) continue;
      const kind = this.stationKind(p.at);
      if (kind !== 'hob' && kind !== 'oven') continue;
      const dish = dishById(p.dish);
      const at = p.body.translation();
      if (!p.burnt && dish.steps[p.stage] === kind) {
        p.progress += dt / stationSeconds(kind, tu);
        if (p.progress >= 1) {
          p.stage++;
          p.progress = 0;
          this.events.push({ t: 'cooked', prop: p.id, dish: p.dish, stage: p.stage });
          this.events.push({ t: 'sfx', name: 'oven_ding', x: at.x, y: at.y, z: at.z });
        }
        continue;
      }
      p.hot += dt;
      if (!p.burnt && p.hot >= tu.burnAfter) {
        p.burnt = true;
        this.events.push({ t: 'burnt', prop: p.id, dish: p.dish });
        this.events.push({ t: 'sfx', name: 'burning', x: at.x, y: at.y, z: at.z });
      }
      if (!p.fire && p.hot >= tu.burnAfter + tu.fireAfter) {
        p.fire = true;
        this.events.push({ t: 'fire', at: p.at, on: true });
        this.events.push({ t: 'sfx', name: 'smoke_alarm', x: at.x, y: at.y, z: at.z });
        this.sim({ type: 'alarm', on: true });
      }
    }
  }

  private serve(h: Host, g: GuestState): void {
    const p = this.props.get(h.held);
    if (!p || !(p.plated || p.kind === 'bottle')) return;
    const head = this.guestHead(g);
    if (!head || !this.reachable(h, head, 0.4)) return this.note(h.id, 'Get closer to serve them.');
    if (!isAvailable(g)) return this.note(h.id, "They're in no state to eat.");
    this.sim({ type: 'serve', by: h.id, guest: g.id, dish: p.dish, burnt: p.burnt });
    const seat = this.seats[g.seat];
    const spot = seat ? this.socket(`plate_${seat.id}`) : undefined;
    p.holder = null;
    h.held = -1;
    p.at = `guest:${g.id}`;
    p.linger = this.dinner!.tuning.plateLingerSeconds;
    const pos = spot?.position ?? head;
    this.place(p, pos, spot?.yaw ?? 0);
    this.events.push({ t: 'sfx', name: 'plate_clink', x: pos[0], y: pos[1], z: pos[2] });
  }

  // --- interacting -----------------------------------------------------------------------------

  private interact(h: Host, target: Target): void {
    const d = this.dinner!;
    switch (target.kind) {
      case 'prop':
        return this.grab(h, target.id);
      case 'neighbor':
        this.sim({ type: 'showOut', by: h.id });
        return;
      case 'visitor':
        return this.visitor(h);
      case 'seat':
        return;
      case 'guest': {
        const g = d.guests[target.id];
        if (!g) return;
        if (g.where === 'door') return this.greet(h, g);
        const held = this.props.get(h.held);
        if (held?.kind === 'part') {
          const head = this.guestHead(g);
          if (!head || !this.reachable(h, head, 0.6)) return this.note(h.id, 'Get closer (and be discreet).');
          this.removeProp(held);
          this.sim({ type: 'reattach', by: h.id, guest: g.id });
          return;
        }
        if (g.where === 'seated' && h.held !== -1) return this.serve(h, g);
        return;
      }
      case 'thing':
        break;
    }
    const it = this.interactable(target.id);
    if (!it || !this.reachable(h, it.position, 0.5)) return;
    const sfx = (name: string) => this.events.push({ t: 'sfx', name, x: it.position[0], y: it.position[1], z: it.position[2] });
    switch (it.kind) {
      case 'door': {
        const waiting = it.id === 'front' ? d.guests.find((g) => g.where === 'door') : undefined;
        if (waiting) return this.greet(h, waiting);
        const open = !this.isDoorOpen(it.id);
        this.setDoor(it.id, open);
        sfx(open ? 'door_open' : 'door_close');
        if (open && it.id === 'front') this.sim({ type: 'did', by: h.id, what: 'open_door' });
        return;
      }
      case 'curtain':
        sfx('curtain');
        return this.sim({ type: 'toggle', by: h.id, what: 'curtains' });
      case 'mirror':
        sfx('curtain');
        return this.sim({ type: 'toggle', by: h.id, what: 'mirror' });
      case 'lights':
        sfx('switch');
        return this.sim({ type: 'toggle', by: h.id, what: 'lights' });
      case 'record_player':
        sfx('switch');
        return this.sim({ type: 'toggle', by: h.id, what: 'music' });
      case 'plates':
        return this.take(h, 'plates', 'empty_plate');
      case 'wine_rack':
        return this.take(h, 'cellar', 'red_wine');
      case 'chop':
      case 'hob':
      case 'oven':
      case 'pass':
        return this.useStation(h, it.id);
      case 'van':
        if (d.phase === 'chase') this.escape(h);
        return;
      case 'fuse_box':
        sfx('switch');
        return this.sim({ type: 'fuse', by: h.id });
      default:
        return;
    }
  }

  /** The pizza driver at the door or inside, or the hunter at the table. */
  private visitor(h: Host): void {
    const v = this.dinner?.visitor;
    if (!v) return;
    const spot = this.visitorSpot();
    if (spot && !this.reachable(h, [spot[0], spot[1] + STANDING_HEAD, spot[2]], 1.2)) return this.note(h.id, 'Get closer.');
    this.sim({ type: 'visitor', by: h.id });
  }

  /** Where the visitor stands: on the doorstep, just inside, or by the table (the hunter's act). */
  visitorSpot(): Vec3 | null {
    const v = this.dinner?.visitor;
    if (!v) return null;
    const id = v.kind === 'hunter' ? 'stand_0' : v.where === 'door' ? 'visitor_door' : 'neighbor';
    const s = this.socket(id) ?? this.socket('guest_door');
    return s ? [...s.position] : null;
  }

  private greet(h: Host, g: GuestState): void {
    const head = this.guestHead(g);
    if (!head || !this.reachable(h, head, 1.0)) return this.note(h.id, 'Go to the front door to let them in.');
    if (!this.isDoorOpen('front')) {
      this.setDoor('front', true);
      this.events.push({ t: 'sfx', name: 'door_open', x: head[0], y: head[1], z: head[2] });
    }
    this.sim({ type: g.greeted && typeOf(g).needsInvite ? 'invite' : 'greet', by: h.id, guest: g.id });
  }

  // --- the chase -------------------------------------------------------------------------------

  private escape(h: Host): void {
    const d = this.dinner;
    if (!d || d.phase !== 'chase') return;
    this.sim({ type: 'escaped', player: h.id });
  }

  private tickChase(dt: number): void {
    const d = this.dinner!;
    const van = this.socket('van_rear');
    const runners = [...this.hosts.values()].filter((h) => {
      const sp = d.players.find((p) => p.id === h.id);
      return sp && !sp.caught && !sp.escaped && h.connected;
    });
    for (const h of runners) {
      if (van && Math.hypot(h.feet[0] - van.position[0], h.feet[2] - van.position[2]) <= ESCAPE_METERS) this.escape(h);
    }
    for (const g of d.guests) {
      if (g.eaten || g.where === 'outside' || g.where === 'gone') continue;
      let pos = this.chasePos.get(g.id);
      if (!pos) {
        const start = this.guestPose({ ...g, where: g.where === 'door' ? 'door' : g.where });
        if (!start) continue;
        pos = { ...start };
        this.chasePos.set(g.id, pos);
      }
      let best: Host | null = null;
      let bestDist = Infinity;
      for (const h of runners) {
        const dist = Math.hypot(h.feet[0] - pos.x, h.feet[2] - pos.z);
        if (dist < bestDist) {
          best = h;
          bestDist = dist;
        }
      }
      if (!best || d.phase !== 'chase') continue;
      if (bestDist <= CATCH_METERS) {
        this.sim({ type: 'caught', player: best.id });
        this.dropHeld(best, 0);
        continue;
      }
      const goal = this.routeToward([pos.x, pos.y + 1, pos.z], [best.feet[0], best.feet[1] + 1, best.feet[2]]);
      const dx = goal[0] - pos.x;
      const dz = goal[2] - pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const stepLen = Math.min(len, CHASE_SPEED * dt);
      pos.x += (dx / len) * stepLen;
      pos.z += (dz / len) * stepLen;
      pos.y += (goal[1] - 1 - pos.y) * Math.min(1, dt * 4);
      pos.yaw = Math.atan2(-dx, -dz);
    }
  }

  /** Next point to head for on the way from a to b: b itself, or the doorway toward b's room. */
  private routeToward(a: Vec3, b: Vec3): Vec3 {
    const ra = roomAt(this.graph, a);
    const rb = roomAt(this.graph, b);
    if (!ra || !rb || ra === rb) return b;
    const prev = new Map<string, { room: string; door: Vec3 }>();
    const queue = [ra];
    const seen = new Set([ra]);
    while (queue.length > 0) {
      const room = queue.shift()!;
      if (room === rb) break;
      for (const door of this.graph.exits.get(room) ?? []) {
        const next = door.a === room ? door.b : door.a;
        if (seen.has(next)) continue;
        seen.add(next);
        prev.set(next, { room, door: door.position });
        queue.push(next);
      }
    }
    let room = rb;
    let door: Vec3 = b;
    while (prev.has(room)) {
      const p = prev.get(room)!;
      door = p.door;
      if (p.room === ra) break;
      room = p.room;
    }
    return [door[0], door[1] + 1, door[2]];
  }

  // --- time ------------------------------------------------------------------------------------

  tick(dt: number): GameEvent[] {
    this.time += dt;
    for (const h of this.hosts.values()) {
      const p = this.props.get(h.held);
      if (!p) continue;
      const pos = this.holdPoint(h);
      p.body.setNextKinematicTranslation({ x: pos[0], y: pos[1], z: pos[2] });
      p.body.setNextKinematicRotation(yawQuat(h.yaw));
    }
    this.world.timestep = Math.min(dt, 1 / 20);
    this.world.step();
    this.settleLooseProps();

    const d = this.dinner;
    if (d && this.phase === 'dinner') {
      this.tickKitchen(dt);
      this.tickDog(dt);
      this.tickThrows();
      this.simAcc += dt;
      while (this.simAcc >= SIM_DT && this.phase === 'dinner') {
        this.simAcc -= SIM_DT;
        this.simEvents(step(d, SIM_DT, this.simWorld()));
        if (d.phase === 'chase') this.tickChase(SIM_DT);
        if (d.phase === 'ended') {
          this.phase = 'results';
          this.resultsTime = RESULTS_SECONDS;
        }
      }
    } else if (this.phase === 'results') {
      this.resultsTime -= dt;
      if (this.resultsTime <= 0) this.toLobby();
    } else if (this.phase === 'lobby') {
      const live = [...this.hosts.values()].filter((h) => h.connected);
      if (live.length > 0 && live.every((h) => h.ready)) this.startDinner();
    }
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Props that fall out of the world come back to the kitchen island. */
  private settleLooseProps(): void {
    for (const p of this.props.values()) {
      const t = p.body.translation();
      if (t.y > -6) continue;
      const home = this.socket('station_pass');
      const pos = home?.position ?? [0, 1, 0];
      p.body.setTranslation({ x: pos[0], y: pos[1] + 0.3, z: pos[2] }, true);
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Events produced by commands since the last tick, without advancing time. */
  flushEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Solo/test helper: runs the game for `seconds` in fixed steps. */
  advance(seconds: number, dt = 1 / 30): GameEvent[] {
    const out: GameEvent[] = [];
    for (let t = 0; t < seconds; t += dt) out.push(...this.tick(dt));
    return out;
  }

  // --- the view --------------------------------------------------------------------------------

  view(): GameView {
    return {
      phase: this.phase,
      roomHost: this.roomHost,
      size: this.size,
      seed: this.seedSetting,
      relaxed: this.relaxed,
      tutorial: this.tutorial,
      house: this.houseSetting,
      asset: this.layout.asset,
      resultsTime: r1(Math.max(0, this.resultsTime)),
      players: [...this.hosts.values()].map((h) => this.playerView(h)),
      props: [...this.props.values()].map((p) => propView(p)),
      doors: this.layout.doors.filter((d) => d.leaf).map((d) => ({ id: d.id, open: this.isDoorOpen(d.id) })),
      notes: this.notes.map((n) => ({ ...n })),
      dinner: this.dinnerView(),
    };
  }

  private playerView(h: Host): PlayerView {
    const sp = this.dinner?.players.find((p) => p.id === h.id);
    return {
      id: h.id,
      name: h.name,
      look: { ...h.look },
      x: r2(h.feet[0]),
      y: r2(h.feet[1]),
      z: r2(h.feet[2]),
      yaw: r2(h.yaw),
      pitch: r2(h.pitch),
      crouch: h.crouch,
      held: h.held,
      ready: h.ready,
      connected: h.connected,
      speaking: h.speaking,
      caught: sp?.caught ?? false,
      escaped: sp?.escaped ?? false,
      stone: r1(sp?.stone ?? 0),
      nameTaken: sp?.nameTaken ?? false,
    };
  }

  private dinnerView(): DinnerView {
    const d = this.dinner;
    if (!d) return emptyDinnerView();
    const q = d.question;
    const r = d.result;
    return {
      active: true,
      seed: d.seed,
      phase: d.phase,
      course: d.course,
      courses: d.tuning.courses,
      phaseTime: r1(Math.max(0, d.phaseTime)),
      beatTimer: r1(Math.max(0, d.beatTimer)),
      beatSeconds: r1(d.tuning.beatSeconds),
      cover: Math.round(d.cover),
      strikes: d.strikes,
      maxStrikes: d.tuning.maxStrikes,
      guests: d.guests.map((g) => this.guestView(g)),
      topic: d.topic
        ? { id: d.topic.id, label: d.topic.label, tags: [...d.topic.tags], holder: d.topic.holder, next: predictNext(d) ?? -1 }
        : { id: '', label: '', tags: [], holder: -1, next: -1 },
      hands: d.players.map((p) => ({ player: p.id, cards: p.hand.map((c) => c ?? ''), cooldowns: p.handCooldown.map((c) => Math.ceil(c)) })),
      question: q
        ? {
            asker: q.asker,
            target: q.target,
            text: q.text,
            options: q.options.map((o) => ({ kind: o.kind, text: o.text, rule: o.kind === 'lie' ? o.rule : '' })),
            timer: r1(Math.max(0, q.timer)),
            total: r1(q.total),
          }
        : { asker: -1, target: '', text: '', options: [], timer: 0, total: 0 },
      room: {
        curtainsOpen: d.room.curtainsOpen,
        mirrorCovered: d.room.mirrorCovered,
        lightsOn: d.room.lightsOn,
        musicOn: d.room.musicOn,
        moonUp: d.room.moonUp,
        neighborPresent: d.room.neighborPresent,
        alarm: d.room.alarm,
        powerOn: d.room.powerOn,
        storm: d.room.storm > 0,
        spill: d.room.spill,
        dogLoose: d.room.dogLoose,
      },
      ledger: [...d.ledger],
      menu: d.menu.map((dishes) => ({ dishes: [...dishes] })),
      result: r
        ? {
            outcome: r.outcome,
            tips: r.tips,
            stars: r.stars,
            review: r.review,
            awards: r.awards.map((a) => ({ player: a.player, title: a.title, why: a.why })),
            incidents: r.incidents.map((i) => ({ t: r1(i.t), kind: i.kind, text: i.text, guest: i.guest ?? -1 })),
          }
        : { outcome: '', tips: 0, stars: 0, review: '', awards: [], incidents: [] },
      occasion: d.occasion,
      occasionLabel: OCCASIONS[d.occasion].label,
      objective: d.objective
        ? { label: d.objective.label, status: d.objective.status, progress: d.objective.progress, goal: d.objective.goal }
        : { label: '', status: '', progress: 0, goal: 0 },
      book: [...d.book],
      honoree: d.honoree ?? -1,
      toast: d.toast
        ? { player: d.toast.player, guest: d.toast.guest, timer: r1(Math.max(0, d.toast.timer)), spoken: r1(d.toast.spoken), need: d.toast.need }
        : { player: '', guest: -1, timer: 0, spoken: 0, need: 0 },
      favors: d.favors.map((f) => ({ player: f.player, guest: f.guest, label: wantLabel(f.want), beats: f.beats })),
      visitor: d.visitor ? { kind: d.visitor.kind, where: d.visitor.where, suspicion: Math.round(d.visitor.suspicion) } : { kind: '', where: '', suspicion: 0 },
      charades: d.partyGame ? { actor: d.partyGame.actor, guess: Math.round(Math.min(100, d.partyGame.guess)) } : { actor: -1, guess: 0 },
    };
  }

  private guestView(g: GuestState): GuestView {
    const pose = this.guestPose(g);
    const d = this.dinner!;
    // A shapeshifter wears the look and name of whoever it's copying ("two Bertrams").
    const shown = g.copying !== null ? (d.guests[g.copying] ?? g) : g;
    return {
      id: g.id,
      name: shown.name,
      look: { ...shown.look, accessory: shown.look.accessory ?? '' },
      where: g.where,
      seat: g.seat,
      x: r2(pose?.x ?? 0),
      z: r2(pose?.z ?? 0),
      yaw: r2(pose?.yaw ?? 0),
      composure: Math.round(Math.max(0, g.composure)),
      hunger: Math.round(g.hunger),
      revealed: g.revealed ? g.type : '',
      form: g.slipTimer > 0 || (d.phase === 'chase' && this.chasePos.has(g.id)) ? g.type : '',
      slipping: g.slipTimer > 0,
      eating: g.eatingBeats > 0,
      eyeing: g.eyeing ?? -1,
      suspicious: g.suspicious,
      waitingInvite: g.where === 'door' && g.greeted && GUEST_TYPES[g.type].needsInvite && !g.invited,
      chasing: d.phase === 'chase' && this.chasePos.has(g.id),
    };
  }

  /** Menu dishes the fridge can give right now (prep and arrivals cook for the first course). */
  fridgeMenu(): string[] {
    const d = this.dinner;
    if (!d || !isServing(d) && d.phase !== 'prep' && d.phase !== 'arrivals' && d.phase !== 'booking') return [];
    return currentMenu(d).filter((id) => dishById(id).source === 'fridge');
  }

  /** Every dish the kitchen could ever produce (for preloading food models). */
  static allDishes(): string[] {
    return DISHES.map((d) => d.id);
  }
}

// ---------------------------------------------------------------------------------------------

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/** The point a fraction `f` of the way along a polyline, facing along it. */
function along(points: Vec3[], f: number): Pose {
  if (points.length === 0) return { x: 0, y: 0, z: 0, yaw: 0 };
  if (points.length === 1) return { x: points[0]![0], y: points[0]![1], z: points[0]![2], yaw: 0 };
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
    lens.push(l);
    total += l;
  }
  let dist = f * total;
  for (let i = 0; i < lens.length; i++) {
    const l = lens[i]!;
    const a = points[i]!;
    const b = points[i + 1]!;
    if (dist <= l || i === lens.length - 1) {
      const t = l > 0 ? Math.min(1, dist / l) : 1;
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t, yaw: Math.atan2(-(b[0] - a[0]), -(b[2] - a[2])) };
    }
    dist -= l;
  }
  const last = points[points.length - 1]!;
  return { x: last[0], y: last[1], z: last[2], yaw: 0 };
}

function propView(p: Prop): PropView {
  const t = p.body.translation();
  const q = p.body.rotation();
  return {
    id: p.id,
    kind: p.kind,
    x: r2(t.x),
    y: r2(t.y),
    z: r2(t.z),
    qx: r3(q.x),
    qy: r3(q.y),
    qz: r3(q.z),
    qw: r3(q.w),
    holder: p.holder ?? '',
    at: p.at,
    dish: p.dish,
    stage: p.stage,
    progress: r2(p.progress),
    burnt: p.burnt,
    plated: p.plated,
    fire: p.fire,
  };
}

export function emptyDinnerView(): DinnerView {
  return {
    active: false,
    seed: '',
    phase: 'none',
    course: 0,
    courses: 0,
    phaseTime: 0,
    beatTimer: 0,
    beatSeconds: 0,
    cover: 0,
    strikes: 0,
    maxStrikes: 0,
    guests: [],
    topic: { id: '', label: '', tags: [], holder: -1, next: -1 },
    hands: [],
    question: { asker: -1, target: '', text: '', options: [], timer: 0, total: 0 },
    room: {
      curtainsOpen: true,
      mirrorCovered: false,
      lightsOn: true,
      musicOn: false,
      moonUp: false,
      neighborPresent: false,
      alarm: false,
      powerOn: true,
      storm: false,
      spill: false,
      dogLoose: false,
    },
    ledger: [],
    menu: [],
    result: { outcome: '', tips: 0, stars: 0, review: '', awards: [], incidents: [] },
    occasion: '',
    occasionLabel: '',
    objective: { label: '', status: '', progress: 0, goal: 0 },
    book: [],
    honoree: -1,
    toast: { player: '', guest: -1, timer: 0, spoken: 0, need: 0 },
    favors: [],
    visitor: { kind: '', where: '', suspicion: 0 },
    charades: { actor: -1, guess: 0 },
  };
}

export type { SimEvent };
