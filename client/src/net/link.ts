// How the client talks to the game: the same interface whether the game runs on the server
// (NetLink, Colyseus) or right here in the browser (LocalLink, solo play).

import { Client, type Room } from '@colyseus/sdk';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  DinnerGame,
  MSG,
  NET,
  ROOM_NAME,
  emptyDinnerView,
  type Command,
  type GameEvent,
  type GameView,
  type JoinOptions,
  type Layout,
  FIRST_HOUSE,
  type VoiceDelivery,
} from '@moon/shared';

export interface GameLink {
  readonly selfId: string;
  readonly online: boolean;
  readonly code: string;
  /** The latest game state. */
  view(): GameView;
  /** performance.now() when view() last changed. */
  readonly viewTime: number;
  send(cmd: Command): void;
  /** Returns a function that stops the callbacks. */
  onEvents(cb: (events: GameEvent[]) => void): () => void;
  /** Called every frame; the local game ticks here. */
  update(dt: number): void;
  readonly pingMs: number;
  /** WebRTC signaling through the server (online only). */
  sendVoice(to: string, signal: unknown): void;
  onVoice(cb: (from: string, signal: unknown) => void): () => void;
  onLeave(cb: (reason: string) => void): void;
  dispose(): void;
}

const EMPTY_VIEW: GameView = {
  phase: 'lobby',
  roomHost: '',
  size: 'dinner',
  seed: '',
  relaxed: false,
  tutorial: false,
  house: 'surprise',
  asset: '',
  resultsTime: 0,
  players: [],
  props: [],
  doors: [],
  notes: [],
  dinner: emptyDinnerView(),
};

/** Solo: the whole game runs in this tab, exactly as the server would run it. */
export class LocalLink implements GameLink {
  readonly selfId = 'solo';
  readonly online = false;
  readonly code = 'SOLO';
  readonly pingMs = 0;
  readonly game: DinnerGame;
  viewTime = 0;
  private cached: GameView | null = null;
  private listeners: ((events: GameEvent[]) => void)[] = [];
  private acc = 0;

  /** `houses`: every house the party can move to; it starts in FIRST_HOUSE. */
  constructor(houses: readonly Layout[], name: string, newSeed: () => string) {
    const layout = houses.find((l) => l.asset === FIRST_HOUSE) ?? houses[0];
    if (!layout) throw new Error('no houses to play in');
    this.game = new DinnerGame(RAPIER, { layout, houses, newSeed });
    this.game.addPlayer(this.selfId, name || 'You');
  }

  view(): GameView {
    this.cached ??= this.game.view();
    return this.cached;
  }

  send(cmd: Command): void {
    this.game.command(this.selfId, cmd);
    this.cached = null;
  }

  onEvents(cb: (events: GameEvent[]) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  update(dt: number): void {
    this.acc += Math.min(dt, 0.25);
    const step = 1 / NET.tickHz;
    const events: GameEvent[] = [];
    while (this.acc >= step) {
      this.acc -= step;
      events.push(...this.game.tick(step));
    }
    // Commands produce events between ticks too (notes, chat).
    events.push(...this.game.flushEvents());
    this.cached = null;
    this.viewTime = performance.now();
    if (events.length > 0) for (const l of this.listeners) l(events);
  }

  /** Dev helper: fast-forward the game (hidden panes get no animation frames). */
  advance(seconds: number): void {
    const events = this.game.advance(seconds);
    this.cached = null;
    if (events.length > 0) for (const l of this.listeners) l(events);
  }

  /** Dev helper: put yourself somewhere (the client snaps to it). */
  teleport(feet: [number, number, number], yaw?: number): void {
    this.game.teleport(this.selfId, feet, yaw);
    this.cached = null;
  }

  sendVoice(): void {}
  onVoice(): () => void {
    return () => {};
  }
  onLeave(): void {}

  dispose(): void {
    this.game.dispose();
  }
}

type GameRoom = Room<unknown, { toJSON(): GameView }>;

/** Online: the server runs the game; we send commands and decode its state. */
export class NetLink implements GameLink {
  readonly online = true;
  viewTime = 0;
  pingMs = 0;
  private cached: GameView = EMPTY_VIEW;
  private dirty = true;
  private readonly pingTimer: ReturnType<typeof setInterval>;

  private constructor(
    private readonly room: GameRoom,
    readonly code: string,
  ) {
    room.onStateChange(() => {
      this.dirty = true;
      this.viewTime = performance.now();
    });
    // Events can arrive while no client is listening (just after joining, or while a new house
    // loads). Drop them quietly instead of the SDK warning about an unregistered type.
    room.onMessage(MSG.events, () => {});
    this.pingTimer = setInterval(() => room.ping((ms) => (this.pingMs = ms)), 2000);
  }

  static async join(options: JoinOptions): Promise<NetLink> {
    const client = new Client(serverUrl());
    const room = (await client.joinOrCreate(ROOM_NAME, options)) as GameRoom;
    const link = new NetLink(room, options.code);
    await new Promise<void>((resolve) => {
      const check = () => {
        if (link.view().players.some((p) => p.id === room.sessionId)) resolve();
        else setTimeout(check, 30);
      };
      check();
    });
    return link;
  }

  get selfId(): string {
    return this.room.sessionId;
  }

  view(): GameView {
    if (this.dirty) {
      // Before the first full patch the decoded state can be missing fields.
      const json = this.room.state?.toJSON?.() as Partial<GameView> | undefined;
      this.cached = { ...EMPTY_VIEW, ...json, dinner: { ...EMPTY_VIEW.dinner, ...json?.dinner } };
      this.dirty = false;
    }
    return this.cached;
  }

  send(cmd: Command): void {
    this.room.send(MSG.cmd, cmd);
  }

  onEvents(cb: (events: GameEvent[]) => void): () => void {
    return this.room.onMessage(MSG.events, (events: GameEvent[]) => cb(events));
  }

  update(): void {}

  sendVoice(to: string, signal: unknown): void {
    this.room.send(MSG.voice, { to, signal });
  }

  onVoice(cb: (from: string, signal: unknown) => void): () => void {
    return this.room.onMessage(MSG.voice, (m: VoiceDelivery) => cb(m.from, m.signal));
  }

  onLeave(cb: (reason: string) => void): void {
    this.room.onLeave((code) => cb(`code ${code}`));
  }

  dispose(): void {
    clearInterval(this.pingTimer);
    void this.room.leave();
  }
}

export function serverUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  // In production the server also serves the client, so the game socket is on the same host.
  if (!import.meta.env.DEV) return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:${NET.port}`;
}
