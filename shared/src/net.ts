// Wire contract between client and server. State schema lives in server/src/schema.ts.

export const ROOM_NAME = 'dinner';

export const DEFAULT_ROOM_CODE = 'MOON';

export interface JoinOptions {
  /** 4-letter room code; rooms are matched by this. */
  code: string;
  name: string;
}

/** Client → server: where the client's own prediction put it. The server validates. */
export interface MoveMessage {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export const MSG = {
  move: 'move',
} as const;

export function normalizeRoomCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
}

export function isMoveMessage(v: unknown): v is MoveMessage {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return (['x', 'y', 'z', 'yaw'] as const).every(
    (k) => typeof m[k] === 'number' && Number.isFinite(m[k]),
  );
}
