// Seeded RNG. All sim randomness goes through this so a dinner seed reproduces a dinner.

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates; returns a new array. */
  shuffle<T>(items: readonly T[]): T[];
}

/** FNV-1a, 32-bit. Turns a seed string like "MOON-7F3K" into a number. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: string | number): Rng {
  return rngOn({ rngState: typeof seed === 'string' ? hashSeed(seed) : seed >>> 0 });
}

/**
 * An Rng whose state lives on `holder.rngState`, so a plain serializable object (like a
 * DinnerState) carries its own random stream and can be saved, copied or replayed.
 */
export function rngOn(holder: { rngState: number }): Rng {
  // mulberry32
  const next = (): number => {
    holder.rngState = (holder.rngState + 0x6d2b79f5) >>> 0;
    let t = holder.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));

  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick() on empty array');
      return items[int(0, items.length - 1)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    },
  };
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 4-character room code without look-alike characters (no I/O/0/1). */
export function makeRoomCode(rng: Rng): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += rng.pick([...CODE_CHARS]);
  return code;
}
