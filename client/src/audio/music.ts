// The record player's lounge-jazz loop and the Chase loop, both lookahead sequencers: the engine's
// timer calls schedule(until) and they queue notes on the audio clock a few hundred ms ahead.
//
// Every play() builds a fresh Session (an output gain plus the per-session buses and LFOs) and all
// notes go into it, so stop() can fade, and cut() silence, whatever is already queued.

import { Kit, biquad, cancelHold, clamp, midiHz, noiseBuffer } from './dsp.ts';
import { pick, rr, type Rng } from './rng.ts';

const wrap = <T>(arr: readonly T[], i: number): T =>
  arr[((i % arr.length) + arr.length) % arr.length] as T;
const smoothstep = (a: number, b: number, x: number): number => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};

class Session {
  readonly out: GainNode;
  protected readonly sources: AudioScheduledSourceNode[] = [];

  constructor(
    protected readonly ctx: BaseAudioContext,
    dest: AudioNode,
    protected readonly t0: number,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.setValueAtTime(0, t0);
    this.out.gain.linearRampToValueAtTime(1, t0 + 0.02);
    this.out.connect(dest);
  }

  /** A sub-bus, optionally with a tremolo LFO on its gain. */
  protected bus(gain: number, lfoHz = 0, depth = 0, to: AudioNode = this.out): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    g.connect(to);
    if (lfoHz > 0) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = lfoHz;
      const d = this.ctx.createGain();
      d.gain.value = depth;
      lfo.connect(d);
      d.connect(g.gain);
      lfo.start(this.t0);
      this.sources.push(lfo);
    }
    return g;
  }

  protected filter(
    type: BiquadFilterType,
    f: number,
    q: number,
    to: AudioNode = this.out,
  ): BiquadFilterNode {
    const n = biquad(this.ctx, type, f, q);
    n.connect(to);
    return n;
  }

  /** Fade (or, with fade 0, cut dead) and stop the session's own oscillators afterwards. */
  release(now: number, fade: number): void {
    const g = this.out.gain;
    cancelHold(g, now);
    if (fade <= 0) g.setValueAtTime(0, now);
    else g.setTargetAtTime(0, now, fade / 4);
    const end = now + Math.max(0, fade) + 0.1;
    for (const s of this.sources) {
      try {
        s.stop(end);
      } catch {
        /* already stopped */
      }
    }
    if (typeof AudioContext !== 'undefined' && this.ctx instanceof AudioContext) {
      setTimeout(() => this.out.disconnect(), (end - now + 0.5) * 1000);
    }
  }
}

// =============================================================================================
// Lounge jazz: walking bass, brushes and ride, electric-piano comping, a vibes line, in F major.
// ii–V–I-ish changes over 8 bars. Tension adds tempo, tremolo strings and minor-second stabs.

type Quality = 'm7' | '7' | 'maj7';
interface Chord {
  root: number; // pitch class
  q: Quality;
}
const ch = (root: number, q: Quality): Chord => ({ root, q });

const PROG: readonly (readonly Chord[])[] = [
  [ch(7, 'm7')], // Gm7
  [ch(0, '7')], // C7
  [ch(5, 'maj7')], // Fmaj7
  [ch(2, '7')], // D7
  [ch(7, 'm7')], // Gm7
  [ch(0, '7')], // C7
  [ch(9, 'm7'), ch(2, '7')], // Am7 D7
  [ch(7, 'm7'), ch(0, '7')], // Gm7 C7
];
const CHORD_TONES: Record<Quality, readonly number[]> = {
  m7: [0, 3, 7, 10],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
};
const COLOR_TONES: Record<Quality, readonly number[]> = {
  m7: [0, 2, 3, 5, 7, 10],
  '7': [0, 2, 4, 7, 9, 10],
  maj7: [0, 2, 4, 7, 9, 11],
};
/** Rootless voicings (3–7–9 flavors): soft and loungey. */
const VOICING: Record<Quality, readonly number[]> = {
  m7: [3, 7, 10, 14],
  '7': [4, 9, 10, 14],
  maj7: [4, 7, 11, 14],
};

/** Steps on a 12-per-bar triplet grid: beat b is 3b, its swung "and" is 3b + 2. */
const RIDE = new Set([0, 3, 5, 6, 9, 11]);
const COMP_PATTERNS: readonly (readonly number[])[] = [
  [0, 5],
  [2, 8],
  [5, 11],
  [0, 8],
  [3, 9],
  [5, 8],
  [0, 6, 11],
  [2, 5, 9],
];
const MEL_RHYTHMS: readonly (readonly number[])[] = [
  [0, 5, 6],
  [2, 3, 5],
  [0, 3],
  [3, 5, 6, 8],
  [6, 8, 9],
  [0, 2, 3, 5],
  [],
  [9, 11],
  [0, 6],
];

const chordsIn = (bar: number): readonly Chord[] => wrap(PROG, bar);
const chordAt = (bar: number, beat: number): Chord => {
  const cs = chordsIn(bar);
  return wrap(cs, cs.length > 1 && beat >= 2 ? 1 : 0);
};

/** The note with pitch class `pc` nearest to `ref`. */
const nearest = (pc: number, ref: number): number => {
  const d = (((pc - ref) % 12) + 12) % 12;
  return d > 6 ? ref + d - 12 : ref + d;
};
const inRange = (m: number, lo: number, hi: number): number => {
  let n = m;
  while (n < lo) n += 12;
  while (n > hi) n -= 12;
  return n;
};

interface Comp {
  step: number;
  chord: Chord;
  dur: number;
  vel: number;
}
interface Mel {
  step: number;
  midi: number;
  dur: number;
}
interface BarPlan {
  bass: readonly number[];
  comp: readonly Comp[];
  mel: readonly Mel[];
}

/** Output level of each band, tuned with selftest.ts. */
const JAZZ_LEVEL = 1.0;
const CHASE_LEVEL = 0.65;

class JazzSession extends Session {
  readonly ep: GainNode;
  readonly vib: GainNode;
  readonly drums: GainNode;
  readonly bass: GainNode;
  readonly strLp: BiquadFilterNode;
  readonly str: GainNode;
  readonly stab: BiquadFilterNode;

  constructor(ctx: BaseAudioContext, dest: AudioNode, t0: number, rng: Rng) {
    super(ctx, dest, t0);
    this.ep = this.bus(0.8, 4.6, 0.22); // e-piano tremolo
    this.vib = this.bus(0.8, 5.4, 0.3); // vibraphone motor
    this.drums = this.bus(1);
    this.bass = this.bus(1);
    this.strLp = this.filter('lowpass', 1500, 1);
    this.str = this.bus(1, 9.5, 0.6, this.strLp); // tension strings, trembling
    this.stab = this.filter('lowpass', 2400, 1);
    // Vinyl crackle, from the needle drop onwards.
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 'crackle');
    src.loop = true;
    const hp = this.filter('highpass', 900, -3, this.bus(0.35));
    src.connect(hp);
    src.start(t0, rng() * 2);
    this.sources.push(src);
  }
}

export class JazzBand {
  private readonly output: GainNode;
  private readonly kit: Kit;
  private s: JazzSession | null = null;
  private tension = 0;
  private bpm = 96;
  private next = 0;
  private step = 0;
  private bar = 0;
  private plan: BarPlan = { bass: [], comp: [], mel: [] };
  private lastBass = 43;
  private lastMel = 77;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    private readonly rng: Rng,
  ) {
    this.kit = new Kit(ctx, rng);
    // A little record-player speaker: no sub rumble, no fizz.
    const lp = biquad(ctx, 'lowpass', 7000, -3);
    lp.connect(dest);
    const hp = biquad(ctx, 'highpass', 55, -3);
    hp.connect(lp);
    this.output = ctx.createGain();
    this.output.gain.value = JAZZ_LEVEL;
    this.output.connect(hp);
  }

  get playing(): boolean {
    return this.s !== null;
  }

  get currentBpm(): number {
    return this.bpm;
  }

  /** `fromBar` lets the self-test skip the 8-bar rhythm-section intro. */
  play(at = 0, fromBar = 0): void {
    if (this.s) return;
    const t = Math.max(at, this.ctx.currentTime);
    this.s = new JazzSession(this.ctx, this.output, t, this.rng);
    this.step = 0;
    this.bar = fromBar;
    this.bpm = this.targetBpm();
    this.next = t + 0.6; // a moment of needle crackle before the band comes in
  }

  /** Fade out over `fade` seconds. */
  stop(fade = 1.2): void {
    const s = this.s;
    if (!s) return;
    this.s = null;
    s.release(this.ctx.currentTime, fade);
  }

  /** Cut dead (the Chase). */
  cut(): void {
    this.stop(0);
  }

  setTension(t: number): void {
    if (Number.isFinite(t)) this.tension = clamp(t, 0, 1);
  }

  schedule(until: number): void {
    const s = this.s;
    if (!s) return;
    const now = this.ctx.currentTime;
    if (this.next < now) this.next = now + 0.03; // the timer was throttled: skip ahead, don't cram
    for (let guard = 0; this.next < until && guard < 512; guard++) {
      this.bpm += (this.targetBpm() - this.bpm) * 0.08;
      this.playStep(s, this.step, this.next);
      this.next += this.stepDur();
      this.step = (this.step + 1) % 12;
      if (this.step === 0) this.bar++;
    }
  }

  private targetBpm(): number {
    return 96 + 32 * this.tension;
  }

  private stepDur(): number {
    return 60 / this.bpm / 3;
  }

  private playStep(s: JazzSession, step: number, t: number): void {
    const k = this.kit;
    const T = this.tension;
    const sd = this.stepDur();
    const beatDur = sd * 3;
    const bar = this.bar;
    if (step === 0) this.plan = this.planBar(bar, sd);
    const beat = Math.floor(step / 3);
    const sub = step % 3;

    // Drums: brush swirl and a feathered kick on every beat, ride "ding, ding-a-ding", brush slap on 2 & 4.
    if (sub === 0) {
      k.burst({
        t,
        a: beatDur * 0.45,
        r: beatDur * 0.6,
        v: 0.02 + 0.012 * T,
        type: 'bandpass',
        f: 4200,
        q: 0.6,
        to: s.drums,
      });
      k.tone({ f: 72, f1: 46, t, a: 0.003, r: 0.16, v: 0.1 + 0.3 * T * T, to: s.drums });
    }
    if (RIDE.has(step) || (T > 0.55 && sub !== 1)) {
      const acc = sub === 0 && beat % 2 === 1 ? 1 : 0.7;
      k.burst({ t, r: 0.3, v: 0.04 * acc, type: 'bandpass', f: 8200, q: 1.1, to: s.drums });
      k.tone({ f: 5170, t, a: 0.001, r: 0.4, v: 0.006 * acc, to: s.drums });
    }
    if (step === 3 || step === 9) {
      k.burst({ t, r: 0.03, v: 0.05, type: 'highpass', f: 6500, to: s.drums });
      k.burst({
        t,
        a: 0.003,
        r: 0.14,
        v: 0.07 + 0.05 * T,
        type: 'bandpass',
        f: 2300,
        q: 0.8,
        to: s.drums,
      });
    }
    if (T > 0.75 && bar % 8 === 7 && (step === 6 || step === 8 || step === 9 || step === 11)) {
      const f = step === 6 ? 190 : step === 8 ? 160 : step === 9 ? 135 : 110;
      k.tone({ f, f1: f * 0.7, t, a: 0.002, r: 0.22, v: 0.22, to: s.drums });
    }

    if (sub === 0) this.bassNote(s, wrap(this.plan.bass, beat), t, beatDur);
    for (const c of this.plan.comp) if (c.step === step) this.epChord(s, c.chord, t, c.dur, c.vel);
    for (const m of this.plan.mel) if (m.step === step) this.vibes(s, m.midi, t, m.dur);

    // Tension layer.
    if (step === 0 && T > 0.12) this.strings(s, chordAt(bar, 0), t, sd * 12, T);
    if (T > 0.35 && (step === 11 || (T > 0.7 && step === 5)) && this.rng() < T) {
      this.stab(s, step === 11 ? chordAt(bar + 1, 0) : chordAt(bar, beat), t, T);
    }
  }

  private planBar(bar: number, sd: number): BarPlan {
    const rng = this.rng;
    const two = chordsIn(bar).length > 1;

    // Walking bass: root on chord changes, chord tones between, chromatic or scale approach into the next root.
    const bass: number[] = [];
    for (let b = 0; b < 4; b++) {
      const c = chordAt(bar, b);
      const nextC = b === 3 ? chordAt(bar + 1, 0) : chordAt(bar, b + 1);
      let n: number;
      if (b === 0 || (two && b === 2)) {
        n = nearest(c.root, this.lastBass);
      } else if (b === 3 || (two && b === 1)) {
        n = nearest(nextC.root, this.lastBass) + pick(rng, [-1, 1, -1, 2, -2]);
      } else {
        n = nearest((c.root + pick(rng, CHORD_TONES[c.q].slice(1))) % 12, this.lastBass);
      }
      n = inRange(n, 36, 55);
      this.lastBass = n;
      bass.push(n);
    }

    // Comping: one of a few swung rhythms; make sure a two-chord bar hits both chords.
    const pat = [...pick(rng, COMP_PATTERNS)];
    if (two && !pat.some((st) => st >= 6 && st < 11)) pat.push(6);
    pat.sort((a, b) => a - b);
    const comp: Comp[] = pat.map((st, i) => ({
      step: st,
      chord: st === 11 ? chordAt(bar + 1, 0) : chordAt(bar, Math.floor(st / 3)),
      dur: Math.min(((pat[i + 1] ?? 13) - st) * sd * 0.9, sd * 5),
      vel: rr(rng, 0.75, 1),
    }));

    // Vibes: the first 8 bars are rhythm section only, then two choruses with a line, and repeat.
    const mel: Mel[] = [];
    if (Math.floor(bar / 8) % 3 !== 0) {
      const rh = pick(rng, MEL_RHYTHMS);
      rh.forEach((st, i) => {
        const c = chordAt(bar, Math.floor(st / 3));
        const tones = st % 3 === 0 ? CHORD_TONES[c.q] : COLOR_TONES[c.q];
        let best = this.lastMel;
        let bestScore = -Infinity;
        for (let m = 70; m <= 86; m++) {
          if (!tones.includes((((m - c.root) % 12) + 12) % 12)) continue;
          const dist = Math.abs(m - this.lastMel);
          if (dist === 0 || dist > 5) continue;
          const score = -dist * 0.6 + rng() * 2.5;
          if (score > bestScore) {
            bestScore = score;
            best = m;
          }
        }
        this.lastMel = best;
        mel.push({ step: st, midi: best, dur: ((rh[i + 1] ?? 12) - st) * sd });
      });
    }
    return { bass, comp, mel };
  }

  private bassNote(s: JazzSession, m: number, t: number, beatDur: number): void {
    const k = this.kit;
    const f = midiHz(m);
    const end = t + beatDur * 0.95;
    const lp = k.filter('lowpass', 1100, 2, s.bass);
    lp.frequency.setValueAtTime(1100, t);
    lp.frequency.exponentialRampToValueAtTime(380, t + 0.15);
    const g = k.gain(0, lp);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.008);
    g.gain.setTargetAtTime(0.16, t + 0.008, 0.18);
    g.gain.setTargetAtTime(0, end, 0.04);
    k.osc('triangle', f, t, end + 0.25, g);
    k.osc('sine', f, t, end + 0.25, k.gain(0.6, g));
    k.burst({ t, r: 0.03, v: 0.03, type: 'lowpass', f: 700, to: s.bass }); // finger on the string
  }

  private epChord(s: JazzSession, c: Chord, t: number, dur: number, vel: number): void {
    const offs = VOICING[c.q];
    const base = inRange(48 + c.root + (offs[0] ?? 0), 53, 64) - (offs[0] ?? 0);
    for (const o of offs) this.epNote(s, midiHz(base + o), t, dur, vel);
  }

  /** Sine + a little triangle, a quick bell "tine" on the attack, natural decay, then the damper. */
  private epNote(s: JazzSession, f: number, t: number, dur: number, vel: number): void {
    const k = this.kit;
    const v = 0.05 * vel;
    const g = k.gain(0, s.ep);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.006);
    g.gain.setTargetAtTime(v * 0.35, t + 0.006, 0.5);
    g.gain.setTargetAtTime(0, t + dur, 0.07);
    const end = t + dur + 0.4;
    k.osc('sine', f, t, end, g);
    k.osc('triangle', f, t, end, k.gain(0.35, g)).detune.value = 4;
    k.tone({ f: f * 4, t, a: 0.002, r: 0.12, v: v * 0.25, to: s.ep });
  }

  private vibes(s: JazzSession, m: number, t: number, dur: number): void {
    const f = midiHz(m);
    this.kit.tone({ f, t, a: 0.002, r: clamp(dur * 2, 0.6, 1.8), v: 0.1, to: s.vib });
    this.kit.tone({ f: f * 4, t, a: 0.001, r: 0.15, v: 0.02, to: s.vib });
  }

  /** Tremolo strings rubbing a minor second (5th against flat 6th), plus a flat 9 when it's bad. */
  private strings(s: JazzSession, c: Chord, t: number, barDur: number, T: number): void {
    const lvl = 0.022 * smoothstep(0.12, 1, T);
    const notes = [inRange(60 + c.root + 7, 67, 80), inRange(60 + c.root + 8, 68, 81)];
    if (T > 0.6) notes.push(inRange(60 + c.root + 1, 61, 72));
    for (const m of notes) {
      for (const det of [-6, 6]) {
        this.kit.tone({
          type: 'sawtooth',
          f: midiHz(m),
          detune: det,
          t,
          a: barDur * 0.3,
          hold: barDur * 0.5,
          r: barDur * 0.5,
          v: lvl,
          to: s.str,
        });
      }
    }
    s.strLp.frequency.setTargetAtTime(1200 + 2600 * T, t, 0.5);
  }

  private stab(s: JazzSession, c: Chord, t: number, T: number): void {
    const m = inRange(48 + c.root, 50, 61);
    for (const x of [m, m + 1, m + 12]) {
      this.kit.tone({
        type: 'sawtooth',
        f: midiHz(x),
        t,
        a: 0.004,
        r: 0.16,
        v: 0.035 * T,
        to: s.stab,
      });
    }
  }
}

// =============================================================================================
// The Chase: 168 bpm, D minor, driving drums, octave bass, offbeat stabs and a theremin lead.
// i – i – VI – V7, four bars, looped.

interface ChaseBar {
  bass: number;
  walk: readonly number[];
  triad: readonly number[];
}
const CHASE_BARS: readonly ChaseBar[] = [
  { bass: 38, walk: [0, 0, 12, 0, 0, 12, 0, 10], triad: [62, 65, 69] }, // Dm
  { bass: 38, walk: [0, 0, 12, 0, 0, 12, 0, 12], triad: [62, 65, 69] }, // Dm
  { bass: 34, walk: [0, 0, 12, 0, 0, 12, 0, 12], triad: [62, 65, 70] }, // Bb
  { bass: 33, walk: [0, 0, 12, 0, 0, 12, 3, 4], triad: [61, 64, 67] }, // A7, walking up into D
];
/** Theremin line: [bar, step, midi, length in 16ths]. */
const LEAD: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 74, 4],
  [0, 4, 77, 2],
  [0, 6, 76, 2],
  [0, 8, 74, 4],
  [0, 12, 69, 4],
  [1, 0, 70, 3],
  [1, 3, 69, 3],
  [1, 6, 68, 2],
  [1, 8, 69, 6],
  [2, 0, 74, 2],
  [2, 2, 77, 2],
  [2, 4, 82, 4],
  [2, 8, 81, 2],
  [2, 10, 79, 2],
  [2, 12, 77, 4],
  [3, 0, 76, 4],
  [3, 4, 73, 4],
  [3, 8, 76, 2],
  [3, 10, 79, 2],
  [3, 12, 81, 4],
];

class ChaseSession extends Session {
  readonly drums: GainNode;
  readonly bass: GainNode;
  readonly stab: BiquadFilterNode;
  readonly lead: OscillatorNode;
  readonly leadGain: GainNode;

  constructor(ctx: BaseAudioContext, dest: AudioNode, t0: number, kit: Kit) {
    super(ctx, dest, t0);
    this.drums = this.bus(1);
    this.bass = this.bus(1);
    this.stab = this.filter('lowpass', 1900, 1);
    this.leadGain = ctx.createGain();
    this.leadGain.gain.value = 0;
    this.leadGain.connect(kit.echo(this.out, 0.21, 0.32, 2500, 0.35));
    this.lead = ctx.createOscillator();
    this.lead.frequency.value = midiHz(74);
    this.lead.connect(this.leadGain);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6.2;
    const depth = ctx.createGain();
    depth.gain.value = 6;
    vib.connect(depth);
    depth.connect(this.lead.frequency);
    this.lead.start(t0);
    vib.start(t0);
    this.sources.push(this.lead, vib);
  }
}

export class ChaseBand {
  private readonly output: GainNode;
  private readonly kit: Kit;
  private s: ChaseSession | null = null;
  private next = 0;
  private step = 0;
  private bar = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    rng: Rng,
  ) {
    this.kit = new Kit(ctx, rng);
    this.output = ctx.createGain();
    this.output.gain.value = CHASE_LEVEL;
    this.output.connect(dest);
  }

  get playing(): boolean {
    return this.s !== null;
  }

  play(at = 0): void {
    if (this.s) return;
    const t = Math.max(at, this.ctx.currentTime);
    this.s = new ChaseSession(this.ctx, this.output, t, this.kit);
    this.step = 0;
    this.bar = 0;
    this.next = t;
  }

  stop(fade = 1.5): void {
    const s = this.s;
    if (!s) return;
    this.s = null;
    s.release(this.ctx.currentTime, fade);
  }

  schedule(until: number): void {
    const s = this.s;
    if (!s) return;
    const now = this.ctx.currentTime;
    if (this.next < now) this.next = now + 0.03;
    const sd = 60 / 168 / 4;
    for (let guard = 0; this.next < until && guard < 512; guard++) {
      this.playStep(s, this.step, this.next, sd);
      this.next += sd;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  private playStep(s: ChaseSession, step: number, t: number, sd: number): void {
    const k = this.kit;
    const b = this.bar % 4;
    const cb = wrap(CHASE_BARS, b);

    const kicks = b === 3 ? [0, 6, 8, 10, 12, 14] : [0, 6, 8];
    if (kicks.includes(step)) {
      k.tone({ f: 150, f1: 45, glide: 0.12, t, a: 0.002, r: 0.18, v: 0.6, to: s.drums });
      k.burst({ t, r: 0.006, v: 0.1, type: 'highpass', f: 3000, to: s.drums });
    }
    if (step === 4 || step === 12 || (b === 3 && step >= 14)) {
      k.burst({ t, a: 0.001, r: 0.13, v: 0.3, type: 'bandpass', f: 1900, q: 0.9, to: s.drums });
      k.tone({ type: 'triangle', f: 200, f1: 160, t, a: 0.001, r: 0.07, v: 0.2, to: s.drums });
    }
    if (step % 2 === 0 || (b === 3 && step > 8)) {
      const open = step === 14 && b % 2 === 0;
      k.burst({ t, r: open ? 0.2 : 0.03, v: 0.06, type: 'highpass', f: 7500, to: s.drums });
    }

    if (step % 2 === 0) {
      const m = cb.bass + wrap(cb.walk, step / 2);
      const lp = k.filter('lowpass', 900, 3, s.bass);
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(260, t + 0.1);
      k.tone({
        type: 'sawtooth',
        f: midiHz(m),
        t,
        a: 0.003,
        hold: sd * 0.8,
        r: 0.08,
        v: 0.22,
        to: lp,
      });
    }
    if (step % 4 === 2) {
      for (const m of cb.triad)
        k.tone({ type: 'sawtooth', f: midiHz(m), t, a: 0.003, r: 0.07, v: 0.045, to: s.stab });
    }

    for (const [lb, ls, lm, len] of LEAD) {
      if (lb !== b || ls !== step) continue;
      const end = t + len * sd;
      s.lead.frequency.setTargetAtTime(midiHz(lm), t, 0.02); // theremin portamento
      s.leadGain.gain.setTargetAtTime(0.09, t, 0.01);
      s.leadGain.gain.setTargetAtTime(0, end - 0.015, 0.03);
    }
  }
}
