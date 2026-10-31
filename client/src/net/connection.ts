import { Client, type Room } from '@colyseus/sdk';
import { NET, ROOM_NAME, type JoinOptions } from '@moon/shared';

/** Decoded shape of server/src/schema.ts as seen by the client. */
export interface PlayerView {
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface DinnerView {
  code: string;
  asset: string;
  players: {
    get(id: string): PlayerView | undefined;
    forEach(cb: (player: PlayerView, id: string) => void): void;
    readonly size: number;
  };
}

export type DinnerRoom = Room<unknown, DinnerView>;

function serverUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:${NET.port}`;
}

export async function joinDinner(options: JoinOptions): Promise<DinnerRoom> {
  const client = new Client(serverUrl());
  return client.joinOrCreate<DinnerView>(ROOM_NAME, options) as Promise<DinnerRoom>;
}
