// End-to-end: a real server and real SDK clients over WebSockets.

import { Client, type Room } from '@colyseus/sdk';
import { MSG, ROOM_NAME, normalizeRoomCode, type Command, type GameEvent, type GameView, type VoiceDelivery } from '@moon/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app.ts';
import { GameState, syncInto } from './schema.ts';

type Server = Awaited<ReturnType<typeof createGameServer>>;

interface StateView {
  code: string;
  phase: string;
  players: { id: string; name: string; x: number; y: number; z: number; connected: boolean }[];
  dinner: { active: boolean; phase: string; guests: unknown[] };
  toJSON(): GameView & { code: string; asset: string };
}

const PORT = 25670 + (process.pid % 1000);
let server: Server;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await sleep(20);
  }
}

beforeAll(async () => {
  server = await createGameServer();
  await server.listen(PORT);
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

type GameRoom = Room<unknown, StateView>;

async function join(name: string, code: string): Promise<GameRoom> {
  const client = new Client(`ws://localhost:${PORT}`);
  return client.joinOrCreate<StateView>(ROOM_NAME, { code, name }) as Promise<GameRoom>;
}

const me = (r: GameRoom) => r.state.players?.find((p) => p.id === r.sessionId);
const cmd = (r: GameRoom, c: Command) => r.send(MSG.cmd, c);

describe('DinnerRoom', () => {
  it('puts two players with the same code in the same room, and they see each other', async () => {
    const ada = await join('Ada', 'MOON');
    const bo = await join('Bo', normalizeRoomCode('moon'));
    try {
      expect(bo.roomId).toBe(ada.roomId);
      await until(() => ada.state.players?.length === 2 && bo.state.players?.length === 2);
      expect(ada.state.players.find((p) => p.id === bo.sessionId)?.name).toBe('Bo');
      expect(bo.state.players.find((p) => p.id === ada.sessionId)?.name).toBe('Ada');
      expect(ada.state.code).toBe('MOON');
      expect(ada.state.phase).toBe('lobby');
    } finally {
      await ada.leave();
      await bo.leave();
    }
  });

  it('rejects codes that are not normalized instead of opening a stray room', async () => {
    await expect(join('Cy', 'moon')).rejects.toThrow(/invalid room code/);
    await expect(join('Cy', 'TOOLONG')).rejects.toThrow(/invalid room code/);
  });

  it('keeps different codes in different rooms', async () => {
    const a = await join('A', 'AAAA');
    const b = await join('B', 'BBBB');
    try {
      expect(a.roomId).not.toBe(b.roomId);
    } finally {
      await a.leave();
      await b.leave();
    }
  });

  it('stops a player at the house wall even if the client claims to walk through it', async () => {
    const ada = await join('Ada', 'WALK');
    try {
      await until(() => me(ada) !== undefined);
      const start = me(ada)!;
      // A buggy client walks straight north (-z) from the van into the garage wall (z ≈ 5.1).
      let z = start.z;
      for (let i = 0; i < 40; i++) {
        z -= 0.15;
        cmd(ada, { c: 'move', x: start.x, y: 0, z, yaw: 0, pitch: 0, crouch: false });
        await sleep(40);
      }
      await sleep(150);
      expect(me(ada)!.z).toBeGreaterThan(5);
      expect(me(ada)!.y).toBeGreaterThan(-0.05);
    } finally {
      await ada.leave();
    }
  }, 15000);

  it('starts a dinner for the room and streams events', async () => {
    const ada = await join('Ada', 'DINE');
    const bo = await join('Bo', 'DINE');
    const events: GameEvent[] = [];
    bo.onMessage(MSG.events, (ev: GameEvent[]) => events.push(...ev));
    try {
      await until(() => ada.state.players?.length === 2);
      cmd(bo, { c: 'start' }); // not the room host: ignored
      await sleep(150);
      expect(ada.state.phase).toBe('lobby');
      cmd(ada, { c: 'settings', size: 'cozy' });
      cmd(ada, { c: 'start' });
      // Cozy is 3 guests, plus one more if tonight's schedule has a late guest.
      await until(() => bo.state.phase === 'dinner' && (bo.state.dinner?.guests?.length ?? 0) >= 3);
      await until(() => events.some((e) => e.t === 'dinnerStarted'));
      cmd(bo, { c: 'skip' });
      await until(() => bo.state.dinner.phase === 'prep');
    } finally {
      await ada.leave();
      await bo.leave();
    }
  });

  it('the decoded client state is exactly the server view', async () => {
    const ada = await join('Ada', 'SYNC');
    try {
      await until(() => me(ada) !== undefined);
      cmd(ada, { c: 'start' });
      await until(() => ada.state.dinner?.active === true);
      await sleep(200);
      const json = ada.state.toJSON();
      expect(Object.keys(json).sort()).toEqual(['asset', 'code', 'dinner', 'doors', 'house', 'notes', 'phase', 'players', 'props', 'relaxed', 'resultsTime', 'tutorial', 'roomHost', 'seed', 'size'].sort());
      expect(json.dinner.guests.length).toBeGreaterThan(0);
      expect(typeof json.dinner.guests[0]!.look.outfit).toBe('string');
      expect(json.dinner.topic.holder).toBeTypeOf('number');
    } finally {
      await ada.leave();
    }
  });

  it('relays voice signals to one peer, stamped with the sender', async () => {
    const ada = await join('Ada', 'TALK');
    const bo = await join('Bo', 'TALK');
    const got: VoiceDelivery[] = [];
    bo.onMessage(MSG.voice, (m: VoiceDelivery) => got.push(m));
    try {
      await until(() => ada.state.players?.length === 2);
      ada.send(MSG.voice, { to: bo.sessionId, signal: { kind: 'bye' } });
      ada.send(MSG.voice, { to: ada.sessionId, signal: { kind: 'bye' } }); // to self: dropped
      await until(() => got.length === 1);
      expect(got[0]).toEqual({ from: ada.sessionId, signal: { kind: 'bye' } });
    } finally {
      await ada.leave();
      await bo.leave();
    }
  });

  it('holds a dropped player’s place and lets them reconnect', async () => {
    const ada = await join('Ada', 'BACK');
    const bo = await join('Bo', 'BACK');
    try {
      await until(() => bo.state.players?.length === 2);
      const id = ada.sessionId;
      ada.reconnection.minUptime = 0;
      ada.reconnection.minDelay = 50;
      const reconnected = new Promise<void>((resolve) => ada.onReconnect(() => resolve()));
      void ada.leave(false); // drop the socket without consent: the SDK reconnects on its own
      await until(() => bo.state.players.find((p) => p.id === id)?.connected === false);
      await reconnected;
      await until(() => bo.state.players.find((p) => p.id === id)?.connected === true);
      expect(bo.state.players.filter((p) => p.id === id)).toHaveLength(1);
      await ada.leave();
    } finally {
      await bo.leave();
    }
  }, 15000);
});

describe('schema sync', () => {
  it('mirrors a GameView exactly, through changes in array lengths', async () => {
    const { DinnerGame, parseLayout } = await import('@moon/shared');
    const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
    await RAPIER.init();
    const { loadLayout } = await import('./world.ts');
    const layout = parseLayout(await loadLayout('house_a'));
    let n = 0;
    const game = new DinnerGame(RAPIER, { layout, newSeed: () => `S${n++}` });
    game.addPlayer('a', 'Ada');
    game.addPlayer('b', 'Bo');
    const state = new GameState();
    const check = () => {
      const view = game.view();
      syncInto(state, view as unknown as Record<string, unknown>);
      const json = state.toJSON() as unknown as Record<string, unknown>;
      expect({ ...json, code: undefined, asset: undefined }).toEqual({ ...view, code: undefined, asset: undefined });
    };
    check();
    game.command('a', { c: 'start' });
    game.advance(1);
    check();
    game.removePlayer('b');
    game.command('a', { c: 'skip' });
    game.command('a', { c: 'skip' });
    game.advance(40);
    check();
  });
});
