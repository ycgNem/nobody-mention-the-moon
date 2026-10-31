// Voice activity from a stream of RMS readings. Pure (no audio APIs) so it can be unit tested.

import { VOICE } from './tuning.ts';

/**
 * On after `vadAttackMs` above the threshold, off after `vadReleaseMs` below it. The threshold
 * rides a noise floor that drops quickly to quiet moments (the gaps between words) and creeps up
 * otherwise, so a steady fan stops counting as speech after a few seconds.
 */
export class Vad {
  active = false;
  floorDb: number = VOICE.vadFloorStartDb;
  private aboveMs = 0;
  private belowMs = 0;

  update(db: number, dtMs: number): boolean {
    const threshold = Math.max(this.floorDb + VOICE.vadMarginDb, VOICE.vadMinDb);
    if (db > threshold) {
      this.aboveMs += dtMs;
      this.belowMs = 0;
    } else {
      this.belowMs += dtMs;
      this.aboveMs = 0;
    }
    if (!this.active && this.aboveMs >= VOICE.vadAttackMs) this.active = true;
    else if (this.active && this.belowMs >= VOICE.vadReleaseMs) this.active = false;

    const tau =
      db < this.floorDb
        ? VOICE.vadFloorFallSec
        : this.active
          ? VOICE.vadFloorRiseSpeakingSec
          : VOICE.vadFloorRiseSec;
    this.floorDb += (db - this.floorDb) * (1 - Math.exp(-dtMs / 1000 / tau));
    this.floorDb = Math.min(VOICE.vadFloorMaxDb, Math.max(VOICE.vadFloorMinDb, this.floorDb));
    return this.active;
  }

  reset(): void {
    this.active = false;
    this.floorDb = VOICE.vadFloorStartDb;
    this.aboveMs = 0;
    this.belowMs = 0;
  }
}
