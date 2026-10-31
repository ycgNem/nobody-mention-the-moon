import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, makeRoomCode } from './rng.ts';

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng('MOON-7F3K');
    const b = createRng('MOON-7F3K');
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('differs between seeds', () => {
    expect(createRng('a').next()).not.toBe(createRng('b').next());
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });

  it('stays in range', () => {
    const r = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const f = r.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });

  it('int covers both ends', () => {
    const r = createRng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(r.int(0, 3));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('shuffle keeps every element', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = createRng('x').shuffle(items);
    expect([...out].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('room codes are 4 unambiguous characters', () => {
    const r = createRng(9);
    for (let i = 0; i < 50; i++) expect(makeRoomCode(r)).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
  });
});
