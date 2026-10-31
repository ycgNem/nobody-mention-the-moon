// One dinner party = one room, matched by its 4-letter code. The server runs the whole game
// (shared/src/game/DinnerGame.ts): clients send commands, the server simulates, and the
// schema (a mirror of GameView) plus a stream of events go back out.

import { randomInt } from 'node:crypto';
import { Room, type Client } from '@colyseus/core';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  DEFAULT_ROOM_CODE,
  DinnerGame,
  FIRST_HOUSE,
  HOUSE_IDS,
  MSG,
  NET,
  isCommand,
  normalizeRoomCode,
  type GameEvent,
  type JoinOptions,
  type VoiceRelay,
} from '@moon/shared';
import { GameState, syncInto } from './schema.ts';
import { initRapier, loadLayout } from './world.ts';

const SEED_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Voice signals are SDP and ICE candidates: a few KB at most. */
const MAX_SIGNAL_BYTES = 16 * 1024;

export function randomSeed(): string {
  let s = 'MOON-';
  for (let i = 0; i < 4; i++) s += SEED_CHARS[randomInt(SEED_CHARS.length)];
  return s;
}

export class DinnerRoom extends Room<{ state: GameState }> {
  override maxClients = NET.maxPlayers;
  override state = new GameState();
  override patchRate = 1000 / NET.patchRateHz;

  game: DinnerGame | undefined;

  override async onCreate(options: Partial<JoinOptions>) {
    // Matchmaking filters on the raw `code` option, so a non-normalized code ("moon") would
    // silently create a second dinner. Clients must normalize; anything else is rejected.
    const code = options.code ?? DEFAULT_ROOM_CODE;
    if (code !== normalizeRoomCode(code) || code.length !== 4) {
      throw new Error(`invalid room code "${code}"`);
    }
    await initRapier();
    const houses = await Promise.all(HOUSE_IDS.map((id) => loadLayout(id)));
    const layout = houses.find((l) => l.asset === FIRST_HOUSE) ?? houses[0]!;
    this.game = new DinnerGame(RAPIER, { layout, houses, newSeed: randomSeed });
    this.state.code = code;
    this.syncState();

    const game = this.game;
    this.onMessage(MSG.cmd, (client, message: unknown) => {
      if (isCommand(message)) game.command(client.sessionId, message);
    });
    this.onMessage(MSG.voice, (client, message: unknown) => this.relayVoice(client, message));
    this.setFixedTimestep((ctx) => this.sendEvents(game.tick(ctx.dt)), NET.tickHz);
    console.log(`[room ${code}] created`);
  }

  override onBeforePatch() {
    this.syncState();
  }

  /** Copies the game's view into the schema; Colyseus sends only what changed. */
  syncState() {
    // Patches can start before onCreate finishes loading the house.
    if (this.game) syncInto(this.state, this.game.view() as unknown as Record<string, unknown>);
  }

  override onJoin(client: Client, options: Partial<JoinOptions>) {
    this.game?.addPlayer(client.sessionId, (options.name ?? '').trim());
    this.syncState();
    console.log(`[room ${this.state.code}] ${options.name ?? '?'} joined (${this.clients.length}/${this.maxClients})`);
  }

  override async onDrop(client: Client) {
    // Dropped (not left on purpose): hold their place for a minute.
    this.game?.setConnected(client.sessionId, false);
    await this.allowReconnection(client, NET.reconnectSeconds);
  }

  override onReconnect(client: Client) {
    this.game?.setConnected(client.sessionId, true);
  }

  override onLeave(client: Client) {
    this.game?.removePlayer(client.sessionId);
  }

  override onDispose() {
    this.game?.dispose();
    console.log(`[room ${this.state.code}] disposed`);
  }

  private sendEvents(events: GameEvent[]) {
    if (events.length === 0) return;
    const shared: GameEvent[] = [];
    const personal = new Map<string, GameEvent[]>();
    for (const e of events) {
      if (e.t === 'note' && e.to) {
        const list = personal.get(e.to) ?? [];
        list.push(e);
        personal.set(e.to, list);
      } else {
        shared.push(e);
      }
    }
    if (shared.length > 0) this.broadcast(MSG.events, shared);
    for (const [id, list] of personal) this.clients.getById(id)?.send(MSG.events, list);
  }

  /** WebRTC signaling: forward `{ to, signal }` to that one client as `{ from, signal }`. */
  private relayVoice(client: Client, message: unknown) {
    if (typeof message !== 'object' || message === null) return;
    const { to, signal } = message as Partial<VoiceRelay>;
    if (typeof to !== 'string' || to === client.sessionId || signal === undefined) return;
    if (JSON.stringify(signal).length > MAX_SIGNAL_BYTES) return;
    this.clients.getById(to)?.send(MSG.voice, { from: client.sessionId, signal });
  }
}
