// Wire contract between client and server. The state schema mirrors GameView
// (shared/src/game/types.ts); see server/src/schema.ts.

export const ROOM_NAME = 'dinner';

export const DEFAULT_ROOM_CODE = 'MOON';

export interface JoinOptions {
  /** 4-letter room code; rooms are matched by this. */
  code: string;
  name: string;
}

export const MSG = {
  /** Client → server: a Command. */
  cmd: 'cmd',
  /** Server → client: GameEvent[] (shared ones broadcast, private notes to one player). */
  events: 'ev',
  /** Both ways: WebRTC signaling. Client sends VoiceRelay, receives VoiceDelivery. */
  voice: 'voice',
} as const;

export interface VoiceRelay {
  to: string;
  signal: unknown;
}

export interface VoiceDelivery {
  from: string;
  signal: unknown;
}

export function normalizeRoomCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
}
