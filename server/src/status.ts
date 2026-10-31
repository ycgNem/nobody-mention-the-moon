// What GET /healthz answers and what the server logs every few minutes.

import { matchMaker } from '@colyseus/core';

export interface ServerStatus {
  /** False once the server has started shutting down. */
  ok: boolean;
  /** Seconds since the process started. */
  uptime: number;
  /** Dinners (Colyseus rooms) open in this process. */
  rooms: number;
  /** Connected players across all rooms. */
  players: number;
  /** Which deploy is live: BUILD_ID (e.g. a git SHA), else Fly's image reference, when set. */
  build?: string;
}

export function serverStatus(): ServerStatus {
  const build = process.env.BUILD_ID || process.env.FLY_IMAGE_REF;
  return {
    ok: matchMaker.state !== matchMaker.MatchMakerState.SHUTTING_DOWN,
    uptime: Math.round(process.uptime()),
    rooms: matchMaker.stats.local.roomCount,
    players: matchMaker.stats.local.ccu,
    ...(build ? { build } : {}),
  };
}

/** One JSON line: easy to grep in `fly logs` and to parse in any log drain. */
export function logLine(msg: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ time: new Date().toISOString(), msg, ...fields });
}

/** Logs a status line every `seconds` (0 turns it off). Returns a stop function. */
export function startStatusLog(
  seconds: number,
  write: (line: string) => void = console.log,
): () => void {
  if (!(seconds > 0)) return () => {};
  const timer = setInterval(() => {
    const mem = process.memoryUsage();
    write(
      logLine('status', {
        ...serverStatus(),
        rssMb: Math.round(mem.rss / 1048576),
        heapMb: Math.round(mem.heapUsed / 1048576),
      }),
    );
  }, seconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
