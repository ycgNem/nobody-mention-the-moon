// Gibberish dinner-party babble, one voice per guest (GDD §11: "emotional state comes through in
// the sound, content comes through in the bubble icons").
//
// One persistent little graph per guest, no per-syllable nodes:
//   sawtooth → amp (syllable envelope) → 3 formant band-passes (vowel) → sum → SpatialChain
//   looping noise → band-pass → gain (consonants, laughs' breath, growl rasp) → sum
//   LFO → FM depth → sawtooth frequency (the slipping growl)
// Syllables are AudioParam automation scheduled a phrase at a time by the engine's lookahead timer.

import { SpatialChain, biquad, cancelHold, clamp, noiseBuffer, type Vec3 } from './dsp.ts';
import { pick, rr, type Rng } from './rng.ts';

export type MurmurMood = 'calm' | 'chatty' | 'tense' | 'happy' | 'eating' | 'slipping' | 'silent';

type Formants = readonly [number, number, number];
const A: Formants = [800, 1200, 2500];
const E: Formants = [520, 1750, 2500];
const I: Formants = [320, 2250, 2950];
const O: Formants = [480, 860, 2600];
const U: Formants = [350, 760, 2400];
const UH: Formants = [620, 1350, 2500];
const HUM: Formants = [260, 1050, 2300];
const VOWELS: readonly Formants[] = [A, E, I, O, U, UH, A, E, UH, O];

type Cons = 'none' | 'plosive' | 'fricative' | 'breath';
const CONSONANTS: readonly Cons[] = ['plosive', 'fricative', 'plosive', 'breath'];

interface Style {
  syl: readonly [number, number];
  joint: readonly [number, number];
  phrase: readonly [number, number];
  gap: readonly [number, number];
  pitch: number;
  range: number;
  bounce: number;
  question: number;
  cons: number;
}

const STYLES: Record<'calm' | 'chatty' | 'tense' | 'happy', Style> = {
  calm: {
    syl: [0.12, 0.22],
    joint: [0, 0.04],
    phrase: [3, 7],
    gap: [0.7, 1.6],
    pitch: 1,
    range: 0.16,
    bounce: 0,
    question: 0.12,
    cons: 0.55,
  },
  chatty: {
    syl: [0.08, 0.16],
    joint: [0, 0.03],
    phrase: [5, 12],
    gap: [0.18, 0.55],
    pitch: 1.05,
    range: 0.28,
    bounce: 0,
    question: 0.3,
    cons: 0.6,
  },
  tense: {
    syl: [0.06, 0.12],
    joint: [0.04, 0.1],
    phrase: [1, 3],
    gap: [0.9, 2.2],
    pitch: 0.86,
    range: 0.07,
    bounce: 0,
    question: 0.05,
    cons: 0.7,
  },
  happy: {
    syl: [0.08, 0.15],
    joint: [0, 0.05],
    phrase: [3, 8],
    gap: [0.25, 0.7],
    pitch: 1.12,
    range: 0.3,
    bounce: 0.14,
    question: 0.25,
    cons: 0.5,
  },
};

const MOOD_VOL: Record<MurmurMood, number> = {
  calm: 0.8,
  chatty: 0.95,
  tense: 0.62,
  happy: 0.95,
  eating: 0.7,
  slipping: 1,
  silent: 0,
};

/** Overall murmur level, tuned with selftest.ts. */
const LEVEL = 1.2;

export interface MurmurOpts {
  position?: Vec3;
  muffle?: number;
}

export class MurmurVoice {
  readonly chain: SpatialChain;
  private readonly osc: OscillatorNode;
  private readonly lfo: OscillatorNode;
  private readonly fm: GainNode;
  private readonly amp: GainNode;
  private readonly bp: readonly [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];
  private readonly fg: readonly [GainNode, GainNode, GainNode];
  private readonly sum: GainNode;
  private readonly noise: AudioBufferSourceNode;
  private readonly nf: BiquadFilterNode;
  private readonly ng: GainNode;
  private readonly base: number;
  private readonly fscale: number;
  private mood: MurmurMood = 'silent';
  private next = 0;
  private disposed = false;
  /** Silent voices are unplugged from the output so they cost no audio-thread time. */
  private attached = true;
  private silentAt = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    pitch: number,
    private readonly rng: Rng,
    opts: MurmurOpts = {},
  ) {
    const p = clamp(Number.isFinite(pitch) ? pitch : 1, 0.5, 2);
    this.base = 132 * p;
    this.fscale = p ** 0.3; // higher voices: slightly shorter vocal tract
    this.chain = new SpatialChain(ctx, dest, {
      position: opts.position,
      muffle: opts.muffle,
      spatial: true,
    });
    const t = ctx.currentTime;

    this.sum = ctx.createGain();
    this.sum.gain.value = 0;
    this.sum.connect(this.chain.input);

    const band = (q: number): [BiquadFilterNode, GainNode] => {
      const f = biquad(ctx, 'bandpass', 500, q);
      const g = ctx.createGain();
      f.connect(g);
      g.connect(this.sum);
      return [f, g];
    };
    const [b0, g0] = band(4);
    const [b1, g1] = band(7);
    const [b2, g2] = band(9);
    this.bp = [b0, b1, b2];
    this.fg = [g0, g1, g2];
    this.setFormantGains([1, 0.55, 0.22], t, 0);

    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    for (const b of this.bp) this.amp.connect(b);

    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = this.base;
    this.osc.connect(this.amp);

    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 32;
    this.fm = ctx.createGain();
    this.fm.gain.value = 0;
    this.lfo.connect(this.fm);
    this.fm.connect(this.osc.frequency);

    this.nf = biquad(ctx, 'bandpass', 2000, 1);
    this.ng = ctx.createGain();
    this.ng.gain.value = 0;
    this.nf.connect(this.ng);
    this.ng.connect(this.sum);
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuffer(ctx, 'white');
    this.noise.loop = true;
    this.noise.connect(this.nf);

    this.osc.start(t);
    this.lfo.start(t);
    this.noise.start(t, rng() * 1.5);
  }

  setMood(m: MurmurMood): void {
    if (m === this.mood || this.disposed) return;
    this.mood = m;
    const now = this.ctx.currentTime;
    if (m === 'silent') {
      this.silentAt = now;
    } else if (!this.attached) {
      this.sum.connect(this.chain.input);
      this.attached = true;
    }
    // Drop whatever was queued so the new mood is heard within a syllable.
    for (const p of [this.amp.gain, this.ng.gain, this.fm.gain]) {
      cancelHold(p, now);
      p.setTargetAtTime(0, now, 0.03);
    }
    for (const p of [
      this.osc.frequency,
      this.nf.frequency,
      this.nf.Q,
      ...this.bp.map((b) => b.frequency),
    ]) {
      cancelHold(p, now);
    }
    this.sum.gain.setTargetAtTime(MOOD_VOL[m] * LEVEL, now, 0.12);
    this.setFormantGains(
      m === 'eating' ? [1, 0.1, 0.03] : m === 'tense' ? [1, 0.45, 0.2] : [1, 0.55, 0.22],
      now,
      0.05,
    );
    this.next = now + 0.08 + this.rng() * 0.25;
  }

  /** Queue phrases up to `until` (context time). Called by the lookahead timer. */
  schedule(until: number): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    if (this.mood === 'silent') {
      if (this.attached && now - this.silentAt > 0.8) {
        this.sum.disconnect();
        this.attached = false;
      }
      return;
    }
    if (this.next < now) this.next = now + 0.05 + this.rng() * 0.2; // timer was throttled
    for (let guard = 0; this.next < until && guard < 64; guard++) this.next = this.utter(this.next);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const t = this.ctx.currentTime + 0.05;
    for (const s of [this.osc, this.lfo, this.noise]) {
      try {
        s.stop(t);
      } catch {
        /* never started or already stopped */
      }
    }
    this.chain.dispose();
  }

  // --- phrase builders -----------------------------------------------------------------------

  private utter(t: number): number {
    switch (this.mood) {
      case 'eating':
        return this.eat(t);
      case 'slipping':
        return this.slip(t);
      case 'happy':
        return this.rng() < 0.28 ? this.laugh(t) : this.phrase(t, STYLES.happy);
      case 'calm':
      case 'chatty':
      case 'tense':
        return this.phrase(t, STYLES[this.mood]);
      case 'silent':
        return t + 1;
    }
  }

  private phrase(t: number, s: Style): number {
    const rng = this.rng;
    const n = Math.round(rr(rng, s.phrase[0], s.phrase[1]));
    const f = this.base * s.pitch * rr(rng, 0.95, 1.05);
    const stress = Math.floor(rng() * n);
    const question = rng() < s.question;
    let at = t;
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0;
      const last = i === n - 1;
      // Declination: phrases start high and drift down, with a little jitter and one stressed syllable.
      let f0 = f * (1 + s.range * (0.45 - 0.75 * u)) * (1 + s.range * 0.35 * (rng() * 2 - 1));
      if (i === stress) f0 *= 1 + s.range * 0.5;
      if (s.bounce && i % 2 === 1) f0 *= 1 + s.bounce;
      const f1 = last
        ? f0 * (question ? 1 + s.range * 1.4 : 1 - s.range * 0.4)
        : f0 * (1 + s.range * 0.2 * (rng() * 2 - 1));
      const dur = rr(rng, s.syl[0], s.syl[1]) * (last ? 1.5 : 1) * (i === stress ? 1.25 : 1);
      const peak = i === stress ? 1 : rr(rng, 0.55, 0.85);
      const cons = rng() < s.cons ? pick(rng, CONSONANTS) : 'none';
      const v = pick(rng, VOWELS);
      const v2 = rng() < 0.25 ? pick(rng, VOWELS) : null;
      at = this.syllable(at, dur, f0, f1, v, v2, peak, cons) + rr(rng, s.joint[0], s.joint[1]);
    }
    return at + rr(rng, s.gap[0], s.gap[1]);
  }

  private laugh(t: number): number {
    const rng = this.rng;
    const n = 4 + Math.floor(rng() * 3);
    const f = this.base * 1.45;
    let at = t;
    for (let i = 0; i < n; i++) {
      const f0 = f * (1 - i * 0.05);
      at =
        this.syllable(
          at,
          rr(rng, 0.06, 0.085),
          f0,
          f0 * 0.93,
          A,
          null,
          i === 0 ? 1 : 0.8,
          'breath',
        ) + rr(rng, 0.035, 0.06);
    }
    return at + rr(rng, 0.3, 0.7);
  }

  /** "Mm-mm!" hums with a closed mouth, and some chewing. */
  private eat(t: number): number {
    const rng = this.rng;
    let at = t;
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const f0 = this.base * rr(rng, 0.95, 1.1) * (i === 0 ? 1.05 : 1.15);
      const up = i % 2 === 0;
      at = this.syllable(
        at,
        rr(rng, 0.16, 0.3),
        up ? f0 : f0 * 1.12,
        up ? f0 * 1.15 : f0 * 0.88,
        HUM,
        null,
        rr(rng, 0.7, 1),
        'none',
      );
      at += rr(rng, 0.05, 0.12);
    }
    if (rng() < 0.6) {
      const chews = 2 + Math.floor(rng() * 3);
      for (let c = 0; c < chews; c++)
        this.consonant(at + c * 0.22, rr(rng, 380, 520), 1, 0.06, 0.3);
      at += chews * 0.22;
    }
    return at + rr(rng, 0.5, 1.3);
  }

  /** A sentence or two that drops into a rough growl: the disguise is slipping. */
  private slip(t: number): number {
    const rng = this.rng;
    let at = t;
    const n = Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const f0 = this.base * rr(rng, 1, 1.1);
      at =
        this.syllable(
          at,
          rr(rng, 0.1, 0.18),
          f0,
          f0 * 0.95,
          pick(rng, VOWELS),
          null,
          0.7,
          rng() < 0.5 ? 'plosive' : 'none',
        ) + 0.02;
    }
    const d = rr(rng, 0.6, 1.2);
    const f0 = this.base * rr(rng, 0.6, 0.75);
    const f1 = this.base * rr(rng, 0.38, 0.48);
    const fm = this.fm.gain;
    fm.setValueAtTime(f0 * 0.35, at);
    fm.linearRampToValueAtTime(f1 * 0.45, at + d);
    fm.setValueAtTime(0, at + d);
    this.lfo.frequency.setValueAtTime(rr(rng, 28, 40), at);
    this.nf.frequency.setValueAtTime(700, at);
    this.nf.Q.setValueAtTime(0.8, at);
    const ng = this.ng.gain;
    ng.setValueAtTime(0, at);
    ng.linearRampToValueAtTime(0.2, at + 0.1);
    ng.linearRampToValueAtTime(0.12, at + d - 0.1);
    ng.linearRampToValueAtTime(0, at + d);
    at = this.syllable(at, d, f0, f1, O, U, 1, 'none');
    return at + rr(rng, 0.3, 0.9);
  }

  // --- low-level automation ------------------------------------------------------------------

  private consonant(t: number, f: number, q: number, d: number, v: number): void {
    this.nf.frequency.setValueAtTime(f, t);
    this.nf.Q.setValueAtTime(q, t);
    const g = this.ng.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(v, t + 0.006);
    g.linearRampToValueAtTime(0, t + d);
  }

  private syllable(
    t: number,
    dur: number,
    f0: number,
    f1: number,
    v: Formants,
    v2: Formants | null,
    peak: number,
    cons: Cons,
  ): number {
    let tv = t;
    if (cons !== 'none') {
      const rng = this.rng;
      const d = cons === 'plosive' ? 0.025 : cons === 'fricative' ? 0.06 : 0.05;
      if (cons === 'plosive') this.consonant(t, rr(rng, 1800, 3600), 1.2, d, 0.5);
      else if (cons === 'fricative') this.consonant(t, rr(rng, 4500, 7000), 1.5, d, 0.28);
      else this.consonant(t, rr(rng, 1100, 1600), 0.6, d, 0.22);
      tv = t + d * 0.7;
    }
    const end = tv + dur;
    const o = this.osc.frequency;
    o.setValueAtTime(f0, tv);
    o.linearRampToValueAtTime(f1, end);
    const s = this.fscale;
    const [b0, b1, b2] = this.bp;
    b0.frequency.setValueAtTime(v[0] * s, tv);
    b1.frequency.setValueAtTime(v[1] * s, tv);
    b2.frequency.setValueAtTime(v[2] * s, tv);
    if (v2) {
      b0.frequency.linearRampToValueAtTime(v2[0] * s, end);
      b1.frequency.linearRampToValueAtTime(v2[1] * s, end);
      b2.frequency.linearRampToValueAtTime(v2[2] * s, end);
    }
    const a = this.amp.gain;
    const att = Math.min(0.025, dur * 0.3);
    const rel = Math.min(0.06, dur * 0.4);
    a.setValueAtTime(0, tv);
    a.linearRampToValueAtTime(peak, tv + att);
    a.linearRampToValueAtTime(peak * 0.7, end - rel);
    a.linearRampToValueAtTime(0, end);
    return end;
  }

  private setFormantGains(g: readonly [number, number, number], t: number, tc: number): void {
    const [g0, g1, g2] = this.fg;
    if (tc <= 0) {
      g0.gain.value = g[0];
      g1.gain.value = g[1];
      g2.gain.value = g[2];
      return;
    }
    g0.gain.setTargetAtTime(g[0], t, tc);
    g1.gain.setTargetAtTime(g[1], t, tc);
    g2.gain.setTargetAtTime(g[2], t, tc);
  }
}
