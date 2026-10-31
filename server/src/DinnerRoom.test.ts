// End-to-end: a real server and two real SDK clients over WebSockets.
// This is the M0 "done when": two players in room MOON see each other, and the table blocks movement.

import { Client, type Room } from '@colyseus/sdk';
import { MSG, ROOM_NAME, normalizeRoomCode, type MoveMessage } from '@moon/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './app.ts';

type Server = Awaited<ReturnType<typeof createGameServer>>;

interface PlayerView {
  name: string;
  x: number;
  y: number;
  z: number;
}
interface StateView {
  code: string;
  players: { get(id: string): PlayerView | undefined; size: number };
}

const PORT = 25670 + (process.pid % 1000);
let server: Server;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, timeoutMs = 3000) {
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

async function join(name: string, code: string): Promise<Room<unknown, StateView>> {
  const client = new Client(`ws://localhost:${PORT}`);
  return client.joinOrCreate<StateView>(ROOM_NAME, { code, name }) as Promise<Room<unknown, StateView>>;
}

describe('DinnerRoom', () => {
  it('puts two players with the same code in the same room, and they see each other', async () => {
    const ada = await join('Ada', 'MOON');
    const bo = await join('Bo', normalizeRoomCode('moon'));
    try {
      expect(bo.roomId).toBe(ada.roomId);
      await until(() => ada.state.players?.size === 2 && bo.state.players?.size === 2);
      expect(ada.state.players.get(bo.sessionId)?.name).toBe('Bo');
      expect(bo.state.players.get(ada.sessionId)?.name).toBe('Ada');
      expect(ada.state.code).toBe('MOON');
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

  it('stops a player at the table even if the client claims to walk through it', async () => {
    const ada = await join('Ada', 'WALK');
    const bo = await join('Bo', 'WALK');
    try {
      await until(() => ada.state.players?.get(ada.sessionId) !== undefined);
      const start = ada.state.players.get(ada.sessionId)!;
      // A cheating/buggy client: claims to walk straight along z toward and through the table
      // (which spans x -1.2..1.2, z -0.5..0.5) at walking speed.
      const x = 0;
      let z = 2.0;
      // First get to x = 0 on the south side of the table, by walking along z = 2.
      let px = start.x;
      for (let i = 0; i < 60 && Math.abs(px - x) > 0.05; i++) {
        px += Math.sign(x - px) * Math.min(0.16, Math.abs(x - px));
        ada.send(MSG.move, { x: px, y: 0, z, yaw: 0 } satisfies MoveMessage);
        await sleep(50);
      }
      for (let i = 0; i < 60; i++) {
        z -= 0.16;
        ada.send(MSG.move, { x, y: 0, z, yaw: 0 } satisfies MoveMessage);
        await sleep(50);
      }
      await sleep(150);

      const me = ada.state.players.get(ada.sessionId)!;
      // Blocked on the near side of the chairs/table, and never below the floor.
      expect(me.z).toBeGreaterThan(0.5);
      expect(me.y).toBeGreaterThan(-0.05);
      // Bo sees the same blocked position.
      await until(() => Math.abs((bo.state.players.get(ada.sessionId)?.z ?? 99) - me.z) < 0.01);
    } finally {
      await ada.leave();
      await bo.leave();
    }
  }, 15000);
});
