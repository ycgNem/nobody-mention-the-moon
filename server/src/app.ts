import { defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@moon/shared';
import { DinnerRoom } from './DinnerRoom.ts';
import { initRapier } from './world.ts';

export async function createGameServer(opts: { devMode?: boolean } = {}) {
  await initRapier();
  return defineServer({
    // Dev mode restores rooms and reconnects clients when `tsx watch` restarts the server.
    devMode: opts.devMode ?? false,
    greet: false,
    gracefullyShutdown: false,
    transport: new WebSocketTransport(),
    rooms: {
      // Same code → same room; a new code creates a new dinner.
      [ROOM_NAME]: defineRoom(DinnerRoom).filterBy(['code']),
    },
  });
}
