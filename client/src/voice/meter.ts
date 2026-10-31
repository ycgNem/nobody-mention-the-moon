// RMS level metering over an AnalyserNode, for speaking indicators and voice activity.

import { VOICE } from './tuning.ts';

export function createAnalyser(ctx: BaseAudioContext): AnalyserNode {
  return new AnalyserNode(ctx, { fftSize: VOICE.meterFftSize, smoothingTimeConstant: 0 });
}

/** Maps RMS dBFS onto the 0..1 range the speaking indicators use. */
export function dbToLevel(db: number): number {
  const t = (db - VOICE.levelFloorDb) / (VOICE.levelCeilDb - VOICE.levelFloorDb);
  return Math.min(1, Math.max(0, t));
}

/** Reads the analyser's latest window on each sample(): instant attack, smooth release. */
export class LevelMeter {
  /** Smoothed, 0..1. */
  level = 0;
  /** RMS of the last window read, dBFS. */
  db = -120;
  private readonly buf: Float32Array<ArrayBuffer>;

  constructor(readonly analyser: AnalyserNode) {
    this.buf = new Float32Array(analyser.fftSize);
  }

  sample(dtSec: number): void {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const s of this.buf) sum += s * s;
    const rms = Math.sqrt(sum / this.buf.length);
    this.db = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
    const target = dbToLevel(this.db);
    const k = 1 - Math.exp(-dtSec / VOICE.levelReleaseSec);
    this.level = target >= this.level ? target : this.level + (target - this.level) * k;
  }

  reset(): void {
    this.level = 0;
    this.db = -120;
  }
}
