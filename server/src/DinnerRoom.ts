// One dinner = one room, matched by its 4-letter code.
// M0: players walk around the greybox; the server re-runs each reported move through Rapier
// so nobody walks through the table, and broadcasts the corrected positions.

import { Room, type Client } from '@colyseus/core';
import RAPIER, { type KinematicCharacterController, type World } from '@dimforge/rapier3d-compat';
import {
  DEFAULT_ROOM_CODE,
  MSG,
  NET,
  PALETTE,
  PLAYER,
  PLAYER_CENTER_OFFSET,
  createCharacterController,
  createPlayerBody,
  isMoveMessage,
  movePlayer,
  normalizeRoomCode,
  removePlayerBody,
  type JoinOptions,
  type Layout,
  type MoveMessage,
  type PlayerBody,
} from '@moon/shared';
import { DinnerState, PlayerState } from './schema.ts';
import { createWorld } from './world.ts';

const HOUSE = 'greybox';
const APRONS = [
  PALETTE.apron_teal,
  PALETTE.apron_mustard,
  PALETTE.apron_coral,
  PALETTE.apron_lilac,
  PALETTE.apron_sage,
  PALETTE.apron_navy,
];
const MAX_MOVE_DT = 0.25;

interface Host {
  body: PlayerBody;
  lastMoveAt: number;
}

export class DinnerRoom extends Room<{ state: DinnerState }> {
  override maxClients = NET.maxPlayers;
  override state = new DinnerState();

  private world!: World;
  private cc!: KinematicCharacterController;
  private layout!: Layout;
  private hosts = new Map<string, Host>();

  override async onCreate(options: Partial<JoinOptions>) {
    // Matchmaking filters on the raw `code` option, so a non-normalized code ("moon") would
    // silently create a second dinner. Clients must normalize; anything else is rejected.
    const code = options.code ?? DEFAULT_ROOM_CODE;
    if (code !== normalizeRoomCode(code) || code.length !== 4) {
      throw new Error(`invalid room code "${code}"`);
    }
    this.state.code = code;
    this.state.asset = HOUSE;

    const { layout, world } = await createWorld(HOUSE);
    this.layout = layout;
    this.world = world;
    this.cc = createCharacterController(world);
    this.world.step(); // builds the query pipeline before the first move

    this.onMessage(MSG.move, (client, message: unknown) => {
      if (isMoveMessage(message)) this.handleMove(client, message);
    });
    this.setFixedTimestep(() => this.world.step(), 30);
    console.log(`[room ${this.state.code}] created`);
  }

  override onJoin(client: Client, options: Partial<JoinOptions>) {
    const feet = this.freeSpawn();
    const body = createPlayerBody(RAPIER, this.world, feet.position);
    this.hosts.set(client.sessionId, { body, lastMoveAt: Date.now() });

    const used = new Set([...this.state.players.values()].map((p) => p.color));
    const color = APRONS.find((c) => !used.has(c)) ?? APRONS[0]!;
    const name = (options.name ?? '').trim().slice(0, 16) || `Host ${this.clients.length}`;

    this.state.players.set(
      client.sessionId,
      new PlayerState().assign({
        name,
        color,
        x: feet.position[0],
        y: feet.position[1],
        z: feet.position[2],
        yaw: feet.yaw,
      }),
    );
    console.log(`[room ${this.state.code}] ${name} joined (${this.clients.length}/${this.maxClients})`);
  }

  override onLeave(client: Client) {
    const host = this.hosts.get(client.sessionId);
    if (host) removePlayerBody(this.world, host.body);
    this.hosts.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  override onDispose() {
    this.world.free();
    console.log(`[room ${this.state.code}] disposed`);
  }

  /** Accepts the client's predicted position as an intent, then moves there through physics. */
  private handleMove(client: Client, msg: MoveMessage) {
    const host = this.hosts.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!host || !player) return;

    const now = Date.now();
    const dt = Math.min((now - host.lastMoveAt) / 1000, MAX_MOVE_DT);
    host.lastMoveAt = now;
    if (dt <= 0) return;

    let dx = msg.x - host.body.position[0];
    let dz = msg.z - host.body.position[2];
    const allowed = PLAYER.sprintSpeed * NET.speedTolerance * dt + 0.05;
    const dist = Math.hypot(dx, dz);
    if (dist > allowed) {
      dx *= allowed / dist;
      dz *= allowed / dist;
    }

    movePlayer(this.cc, host.body, dx, dz, dt);
    player.x = host.body.position[0];
    player.y = host.body.position[1] - PLAYER_CENTER_OFFSET;
    player.z = host.body.position[2];
    player.yaw = msg.yaw;
  }

  private freeSpawn() {
    const spawns = this.layout.spawns;
    if (spawns.length === 0) throw new Error(`${HOUSE} has no spawn points`);
    const taken = [...this.state.players.values()];
    const clear = spawns.find((s) =>
      taken.every((p) => Math.hypot(p.x - s.position[0], p.z - s.position[2]) > PLAYER.radius * 3),
    );
    return clear ?? spawns[this.clients.length % spawns.length]!;
  }
}
