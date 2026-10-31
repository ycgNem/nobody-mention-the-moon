import { describe, expect, it } from 'vitest';
import { VOICE } from './tuning.ts';
import { Vad } from './Vad.ts';

const TICK = 25;

function run(vad: Vad, db: number, ms: number): boolean[] {
  const out: boolean[] = [];
  for (let t = 0; t < ms; t += TICK) out.push(vad.update(db, TICK));
  return out;
}

describe('Vad', () => {
  it('needs the attack time above threshold before it turns on', () => {
    const vad = new Vad();
    run(vad, -80, 2000); // settle the floor in a quiet room
    expect(vad.update(-30, TICK)).toBe(false);
    expect(run(vad, -30, VOICE.vadAttackMs).at(-1)).toBe(true);
  });

  it('holds through short gaps and releases after the hangover', () => {
    const vad = new Vad();
    run(vad, -80, 2000);
    run(vad, -30, 500);
    expect(run(vad, -80, VOICE.vadReleaseMs - TICK).every(Boolean)).toBe(true);
    expect(run(vad, -80, TICK * 2).at(-1)).toBe(false);
  });

  it('ignores sounds below the absolute minimum', () => {
    const vad = new Vad();
    run(vad, -90, 2000);
    expect(run(vad, VOICE.vadMinDb - 3, 1000).some(Boolean)).toBe(false);
  });

  it('learns a steady noise and stops calling it speech', () => {
    const vad = new Vad();
    run(vad, -80, 2000);
    expect(run(vad, -40, 500).at(-1)).toBe(true); // a fan switches on: looks like speech at first
    run(vad, -40, 30_000);
    expect(vad.active).toBe(false);
    expect(run(vad, -22, 200).at(-1)).toBe(true); // talking over the fan still counts
  });
});
