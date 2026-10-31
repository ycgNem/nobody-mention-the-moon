// Tiny local PRNG for audio variety (syllables, jitter, walking bass). Audio isn't game state, so it
// doesn't use the sim's seeded RNG, but this keeps Math.random out of the codebase all the same.

export type Rng = () => number;

let streams = 0;

/** mulberry32. Seeded from the clock plus a counter, so every voice gets its own stream. */
export function makeRng(seed?: number): Rng {
  let s =
    (seed ?? Date.now() ^ Math.floor(performance.now() * 1000) ^ (++streams * 0x9e3779b9)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rr = (rng: Rng, a: number, b: number): number => a + (b - a) * rng();

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  // Callers only pass non-empty constant tables.
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))] as T;
}
