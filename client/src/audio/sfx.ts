// Synthesized one-shot sound effects. Each recipe builds its voices on a Kit, starting at time `t`,
// into `o`, and returns the time the sound has fully died away. Charming, not harsh: soft attacks
// where possible, nothing piercing, and a per-recipe trim so they sit together in the mix.

import { midiHz, type Kit } from './dsp.ts';

export const SFX_NAMES = [
  'doorbell',
  'knock',
  'door_open',
  'door_close',
  'chop',
  'sizzle',
  'oven_ding',
  'burning',
  'smoke_alarm',
  'crunch',
  'howl',
  'hiss',
  'wail',
  'bat',
  'strike',
  'gasp',
  'murmur_shock',
  'cheer',
  'applause',
  'plate_clink',
  'pickup',
  'drop',
  'throw',
  'thud',
  'switch',
  'curtain',
  'fridge',
  'pour',
  'bark',
  'thunder',
  'power_down',
  'power_up',
  'glass_clink',
  'chase_sting',
  'van_door',
  'engine',
  'tick',
  'ui_click',
  'ui_good',
  'ui_bad',
  'whoosh',
  'footstep',
  'rule',
  'question',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];
/** Engine-internal effects that aren't part of the public SfxName list. */
export type InternalSfx = 'record_scratch';

type Recipe = (k: Kit, o: AudioNode, t: number) => number;
type Partial3 = readonly [ratio: number, amp: number, decayScale?: number];

/** Per-recipe output trim, tuned with selftest.ts so peaks land in a sane band. */
const TRIM: Partial<Record<SfxName | InternalSfx, number>> = {
  applause: 1.5,
  bat: 2.5,
  cheer: 0.72,
  chop: 1.3,
  crunch: 2.1, // a guest just got eaten: it should land
  curtain: 2.1,
  doorbell: 1.15,
  engine: 0.76,
  footstep: 1.3,
  fridge: 1.2,
  gasp: 1.6,
  glass_clink: 2.4,
  howl: 0.8,
  murmur_shock: 0.65,
  oven_ding: 1.75,
  pickup: 2,
  plate_clink: 2.6,
  pour: 1.3,
  power_up: 1.25,
  record_scratch: 1.45,
  rule: 1.4,
  smoke_alarm: 2.6, // loud on purpose (loud things are triggers), still a soft sine
  strike: 1.3,
  switch: 2.4,
  throw: 1.6,
  thunder: 2.1,
  tick: 2.3,
  ui_bad: 0.75,
  ui_click: 1.75,
  van_door: 0.83,
  wail: 0.74,
  whoosh: 1.9,
};

export function playSfx(k: Kit, name: SfxName | InternalSfx, out: AudioNode, t: number): number {
  const o = k.gain(TRIM[name] ?? 1, out);
  return RECIPES[name](k, o, t);
}

// --- shared shapes ---------------------------------------------------------------------------

/** Struck bell, glass or chime: sine partials with their own decay. */
function bell(
  k: Kit,
  o: AudioNode,
  t: number,
  f: number,
  v: number,
  decay: number,
  partials: readonly Partial3[],
): number {
  let end = t;
  for (const [ratio, amp, ds] of partials) {
    end = Math.max(
      end,
      k.tone({ f: f * ratio, t, a: 0.002, r: decay * (ds ?? 1), v: v * amp, to: o }).end,
    );
  }
  return end;
}

/** Envelope shape over 0..1: linear fade in over `a`, fade out over the last `r`. */
const fadeInOut =
  (a: number, r: number) =>
  (u: number): number =>
    Math.max(0, Math.min(1, u / a, (1 - u) / r));

/** Random sparse spikes that decay fast: crackles, claps, chalk grain. */
function spikes(
  k: Kit,
  n: number,
  prob: number,
  lo: number,
  hi: number,
  shape: (u: number) => number,
  decay = 0.35,
): Float32Array {
  const c = new Float32Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    v *= decay;
    if (k.rng() < prob) v = Math.max(v, k.rr(lo, hi));
    c[i] = v * shape(i / (n - 1));
  }
  c[n - 1] = 0;
  return c;
}

/** Smooth random wobble between lo and hi: flame flicker, thunder roll. */
function wobble(
  k: Kit,
  n: number,
  lo: number,
  hi: number,
  shape: (u: number) => number,
): Float32Array {
  const c = new Float32Array(n);
  let v = k.rr(lo, hi);
  let target = v;
  for (let i = 0; i < n; i++) {
    if (k.rng() < 0.15) target = k.rr(lo, hi);
    v += (target - v) * 0.3;
    c[i] = v * shape(i / (n - 1));
  }
  c[n - 1] = 0;
  return c;
}

/** Band-passed noise whose center follows [time, Hz] points: whooshes, swishes. */
function sweep(
  k: Kit,
  o: AudioNode,
  t: number,
  pts: readonly (readonly [number, number])[],
  a: number,
  r: number,
  q: number,
  v: number,
): number {
  const first = pts[0] ?? [0, 1000];
  const b = k.burst({ t, a, r, v, type: 'bandpass', f: first[1], q, to: o });
  const fp = b.f?.frequency;
  if (fp) {
    fp.setValueAtTime(first[1], t);
    for (const [dt, f] of pts.slice(1)) fp.exponentialRampToValueAtTime(f, t + dt);
  }
  return b.end;
}

/** A band-passed sawtooth "voice" (two formants) whose envelope and pitch the caller shapes. */
function formantVoice(
  k: Kit,
  o: AudioNode,
  t: number,
  d: number,
  f: number,
  f1: number,
  f2: number,
  q1 = 5,
  q2 = 8,
) {
  const g = k.gain(0, o);
  const b1 = k.filter('bandpass', f1, q1, g);
  const b2 = k.filter('bandpass', f2, q2, g);
  const split = k.gain(1, b1);
  split.connect(b2);
  const osc = k.osc('sawtooth', f, t, t + d + 0.05, split);
  return { g, b1, b2, osc, split };
}

function claps(k: Kit, o: AudioNode, t: number, d: number, v: number): number {
  for (const [f, q] of [
    [1200, 0.8],
    [2500, 1.0],
  ] as const) {
    const g = k.gain(0, o);
    k.noise('white', t, t + d, k.filter('bandpass', f, q, g));
    g.gain.setValueCurveAtTime(
      spikes(k, Math.ceil(d * 400), 0.065, 0.45 * v, v, fadeInOut(0.12, 0.4)),
      t,
      d,
    );
  }
  return t + d;
}

/** Brassy saw chord through a closing low-pass, with a timpani thump under it. */
function stab(
  k: Kit,
  o: AudioNode,
  t: number,
  notes: readonly number[],
  hold: number,
  r: number,
  v: number,
): number {
  const lp = k.filter('lowpass', 3200, 1, o);
  lp.frequency.setValueAtTime(3200, t);
  lp.frequency.exponentialRampToValueAtTime(800, t + hold + r);
  let end = t;
  for (const m of notes) {
    for (const det of [-8, 8]) {
      end = k.tone({
        type: 'sawtooth',
        f: midiHz(m),
        detune: det,
        t,
        a: 0.008,
        hold,
        r,
        v,
        to: lp,
      }).end;
    }
  }
  k.tone({ f: 78, f1: 60, t, a: 0.003, r: 0.6, v: 0.5, to: o });
  k.burst({ kind: 'brown', t, r: 0.25, v: 0.35, type: 'lowpass', f: 260, to: o });
  return end;
}

// --- recipes ---------------------------------------------------------------------------------

const RECIPES: Record<SfxName | InternalSfx, Recipe> = {
  doorbell: (k, o, t) => {
    const ding = (at: number, f: number): number => {
      k.burst({ t: at, r: 0.04, v: 0.08, type: 'lowpass', f: 900, to: o }); // the hammer
      return bell(k, o, at, f, 0.24, 1.8, [
        [1, 1],
        [2, 0.3, 0.6],
        [3, 0.12, 0.4],
        [4.17, 0.06, 0.25],
      ]);
    };
    ding(t, 659.25); // E5
    return ding(t + 0.55, 523.25); // C5
  },

  knock: (k, o, t) => {
    let end = t;
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.2 + k.rr(0, 0.03);
      const vel = (i === 2 ? 1 : 0.85) * k.rr(0.85, 1);
      k.burst({
        t: at,
        r: 0.07,
        v: 0.45 * vel,
        type: 'bandpass',
        f: k.rr(330, 420),
        q: 1.4,
        to: o,
      });
      k.burst({ t: at, r: 0.012, v: 0.1 * vel, type: 'highpass', f: 2500, to: o });
      end = k.tone({ f: 150, f1: 70, t: at, a: 0.002, r: 0.1, v: 0.55 * vel, to: o }).end;
    }
    return end;
  },

  door_open: (k, o, t) => {
    k.burst({ t, r: 0.03, v: 0.2, type: 'bandpass', f: 2600, q: 2, to: o }); // latch
    k.tone({ type: 'square', f: 1400, t, r: 0.015, v: 0.03, to: o });
    // Creak: a slow sawtooth whose every cycle "ticks" two high-Q resonances.
    const start = t + 0.08;
    const d = 0.75;
    const g = k.gain(0, o);
    const b1 = k.filter('bandpass', 950, 9, g);
    const split = k.gain(1, b1);
    split.connect(k.filter('bandpass', 2300, 12, g));
    const saw = k.osc('sawtooth', 28, start, start + d + 0.05, split);
    const curve = new Float32Array(32);
    for (let i = 0; i < 32; i++) curve[i] = 22 + 26 * Math.sin((Math.PI * i) / 31) + k.jit(6);
    saw.frequency.setValueCurveAtTime(curve, start, d);
    b1.frequency.setValueAtTime(850, start);
    b1.frequency.linearRampToValueAtTime(1300, start + d);
    k.env(g.gain, start, 0.08, 1.6, 0.42, 0.25);
    k.burst({
      t: start,
      a: 0.2,
      hold: 0.2,
      r: 0.3,
      v: 0.06,
      type: 'bandpass',
      f: 500,
      q: 0.7,
      to: o,
    }); // air
    return start + d + 0.05;
  },

  door_close: (k, o, t) => {
    k.burst({ t, a: 0.08, r: 0.12, v: 0.1, type: 'bandpass', f: 420, f1: 200, q: 0.8, to: o }); // air push
    const st = t + 0.12;
    k.tone({ f: 95, f1: 45, t: st, a: 0.002, r: 0.28, v: 0.65, to: o });
    k.burst({ t: st, r: 0.18, v: 0.45, type: 'lowpass', f: 320, to: o });
    k.burst({ t: st + 0.03, r: 0.025, v: 0.22, type: 'bandpass', f: 3000, q: 3, to: o }); // latch
    k.tone({ type: 'square', f: 1800, t: st + 0.03, r: 0.015, v: 0.025, to: o });
    return st + 0.32;
  },

  chop: (k, o, t) => {
    const p = k.rr(0.92, 1.08);
    k.burst({ t, r: 0.04, v: 0.5, type: 'bandpass', f: 1700 * p, q: 1.3, to: o });
    k.burst({ t, r: 0.01, v: 0.18, type: 'highpass', f: 4500, to: o });
    return k.tone({ f: 340 * p, f1: 170 * p, t, a: 0.001, r: 0.08, v: 0.45, to: o }).end;
  },

  sizzle: (k, o, t) => {
    const d = 1.6;
    k.burst({ t, a: 0.08, hold: d - 0.5, r: 0.4, v: 0.09, type: 'highpass', f: 3200, to: o });
    const g = k.gain(0, o);
    k.noise('white', t, t + d, k.filter('bandpass', 4200, 0.8, g));
    g.gain.setValueCurveAtTime(spikes(k, 640, 0.09, 0.25, 0.7, fadeInOut(0.05, 0.25)), t, d);
    return t + d;
  },

  oven_ding: (k, o, t) => {
    bell(k, o, t, 2093, 0.18, 1.5, [
      [1, 1],
      [2.42, 0.35, 0.5],
      [5.1, 0.12, 0.25],
    ]);
    return bell(k, o, t + 0.11, 2093, 0.06, 1.0, [
      [1, 1],
      [2.42, 0.3, 0.5],
    ]);
  },

  burning: (k, o, t) => {
    const d = 2.5;
    k.burst({
      kind: 'brown',
      t,
      a: 0.35,
      hold: d - 0.95,
      r: 0.6,
      v: 0.6,
      type: 'lowpass',
      f: 320,
      to: o,
    });
    const fg = k.gain(0, o); // flame flutter
    k.noise('white', t, t + d, k.filter('bandpass', 750, 0.8, fg));
    fg.gain.setValueCurveAtTime(wobble(k, 120, 0.04, 0.14, fadeInOut(0.15, 0.25)), t, d);
    const cg = k.gain(0, o); // crackles
    k.noise('white', t, t + d, k.filter('bandpass', 2000, 1.1, cg));
    cg.gain.setValueCurveAtTime(spikes(k, 1000, 0.03, 0.3, 0.9, fadeInOut(0.1, 0.2)), t, d);
    return t + d;
  },

  smoke_alarm: (k, o, t) => {
    // Two groups of three beeps (~3 s). A sine with a soft sub-octave, so it's loud but not shrill.
    let at = t;
    let end = t;
    for (let group = 0; group < 2; group++) {
      for (let i = 0; i < 3; i++) {
        k.tone({ f: 3100, t: at, a: 0.006, hold: 0.3, r: 0.03, v: 0.1, to: o });
        end = k.tone({
          type: 'triangle',
          f: 1550,
          t: at,
          a: 0.006,
          hold: 0.3,
          r: 0.03,
          v: 0.06,
          to: o,
        }).end;
        at += 0.48;
      }
      at += 0.45;
    }
    return end;
  },

  crunch: (k, o, t) => {
    k.tone({ f: 190, f1: 80, t, a: 0.003, r: 0.14, v: 0.5, to: o });
    k.burst({ kind: 'brown', t, r: 0.22, v: 0.5, type: 'lowpass', f: 700, to: o });
    let end = t;
    const bite = (start: number, n: number, v: number): void => {
      for (let i = 0; i < n; i++) {
        const at = start + i * 0.032 + k.rr(0, 0.02);
        const b = k.burst({
          t: at,
          r: k.rr(0.025, 0.06),
          v: v * k.rr(0.5, 1),
          type: 'bandpass',
          f: k.rr(900, 3400),
          q: 1.6,
          to: o,
        });
        end = Math.max(end, b.end);
      }
    };
    bite(t, 8, 0.55);
    bite(t + 0.42, 5, 0.35);
    return end;
  },

  howl: (k, o, t) => {
    const d = 2.4;
    const lp = k.filter('lowpass', 2400, -3, o);
    const v = formantVoice(k, lp, t, d, 230, 330, 760, 4, 6);
    const fq = v.osc.frequency;
    fq.setValueAtTime(230, t);
    fq.exponentialRampToValueAtTime(500, t + 0.45);
    fq.linearRampToValueAtTime(545, t + 1.55);
    fq.exponentialRampToValueAtTime(300, t + d);
    const lfo = k.osc('sine', 5.2, t, t + d + 0.05, null); // vibrato that widens as it holds
    const depth = k.gain(0, fq);
    lfo.connect(depth);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(4, t + 0.5);
    depth.gain.linearRampToValueAtTime(16, t + 1.8);
    v.b1.frequency.setValueAtTime(330, t);
    v.b1.frequency.linearRampToValueAtTime(560, t + 0.6); // "oo" opening to "ow"
    v.b1.frequency.linearRampToValueAtTime(380, t + d);
    v.b2.frequency.setValueAtTime(760, t);
    v.b2.frequency.linearRampToValueAtTime(1050, t + 0.6);
    v.b2.frequency.linearRampToValueAtTime(800, t + d);
    k.env(v.g.gain, t, 0.3, 1, 1.45, 0.65);
    k.burst({ t, a: 0.3, hold: 1.4, r: 0.6, v: 0.04, type: 'bandpass', f: 1300, q: 0.8, to: o }); // breath
    return t + d + 0.05;
  },

  hiss: (k, o, t) => {
    const hp = k.filter('highpass', 2400, -3, o);
    return k.burst({
      t,
      a: 0.05,
      hold: 0.5,
      r: 0.35,
      v: 0.35,
      type: 'bandpass',
      f: 5200,
      q: 0.8,
      to: hp,
    }).end;
  },

  wail: (k, o, t) => {
    const d = 2.4;
    const wet = k.echo(o, 0.27, 0.4, 2200, 0.5);
    const g = k.gain(0, wet);
    const s = k.osc('sine', 360, t, t + d + 0.05, g);
    const fifth = k.osc('triangle', 540, t, t + d + 0.05, k.gain(0.12, g));
    const lfo = k.osc('sine', 6, t, t + d + 0.05, null);
    for (const [osc, ratio] of [
      [s, 1],
      [fifth, 1.5],
    ] as const) {
      const f = osc.frequency;
      f.setValueAtTime(360 * ratio, t);
      f.exponentialRampToValueAtTime(720 * ratio, t + 0.75);
      f.exponentialRampToValueAtTime(520 * ratio, t + 1.3);
      f.exponentialRampToValueAtTime(300 * ratio, t + d);
      lfo.connect(k.gain(10 * ratio, f));
    }
    k.env(g.gain, t, 0.45, 0.5, 1.2, 0.75);
    k.burst({ t, a: 0.5, hold: 1, r: 0.8, v: 0.035, type: 'bandpass', f: 1500, q: 0.7, to: wet });
    return t + d + 1.2; // echo tail
  },

  bat: (k, o, t) => {
    let at = t;
    let end = t;
    for (let i = 0; i < 14; i++) {
      const v = 0.35 * (1 - i / 16) * k.rr(0.7, 1);
      end = k.burst({
        t: at,
        a: 0.006,
        r: 0.04,
        v,
        type: 'lowpass',
        f: k.rr(700, 1300),
        q: 1.5,
        to: o,
      }).end;
      at += k.rr(0.045, 0.065);
    }
    for (let i = 0; i < 3; i++) {
      const f = k.rr(6500, 8500);
      k.tone({ f, f1: f * 1.25, t: t + k.rr(0.05, 0.7), a: 0.004, r: 0.035, v: 0.05, to: o });
    }
    return end;
  },

  strike: (k, o, t) => {
    k.tone({ f: 120, f1: 38, t, a: 0.003, r: 0.55, v: 0.8, to: o });
    k.burst({ kind: 'brown', t, r: 0.35, v: 0.55, type: 'lowpass', f: 380, to: o });
    // The sting: a minor second and a tritone, softened through a low-pass.
    const st = t + 0.04;
    const lp = k.filter('lowpass', 1700, 1, o);
    let end = st;
    for (const m of [60, 61, 66]) {
      for (const det of [-7, 7]) {
        end = k.tone({
          type: 'sawtooth',
          f: midiHz(m),
          detune: det,
          t: st,
          a: 0.012,
          hold: 0.18,
          r: 1.0,
          v: 0.06,
          to: lp,
        }).end;
      }
    }
    k.tone({ f: midiHz(84), t: st, a: 0.01, r: 1.3, v: 0.03, to: o });
    k.tone({ f: midiHz(85), t: st, a: 0.01, r: 1.3, v: 0.03, to: o });
    return end;
  },

  gasp: (k, o, t) => {
    let end = t;
    for (let i = 0; i < 6; i++) {
      const at = t + k.rr(0, 0.08);
      const g = k.gain(0, o);
      const split = k.gain(1, k.filter('bandpass', k.rr(600, 900), 3, g));
      split.connect(k.filter('bandpass', k.rr(1100, 1600), 4, g));
      k.noise('white', at, at + 0.5, split);
      g.gain.setValueAtTime(0, at); // a sharp inhale that rises, then cuts
      g.gain.linearRampToValueAtTime(k.rr(0.25, 0.4), at + k.rr(0.16, 0.22));
      g.gain.setTargetAtTime(0, at + 0.24, 0.03);
      if (k.rng() < 0.5) {
        const f = k.rr(160, 260);
        k.tone({
          type: 'sawtooth',
          f,
          f1: f * 1.15,
          t: at + 0.12,
          a: 0.03,
          hold: 0.06,
          r: 0.06,
          v: 0.08,
          to: split,
        });
      }
      end = Math.max(end, at + 0.42);
    }
    return end;
  },

  murmur_shock: (k, o, t) => {
    // The whole table goes "ooooh!"
    let end = t;
    for (let i = 0; i < 5; i++) {
      const at = t + k.rr(0, 0.15);
      const f = k.rr(105, 240);
      const d = k.rr(0.9, 1.2);
      const v = formantVoice(k, o, at, d, f, 450, 820, 5, 7);
      const fq = v.osc.frequency;
      fq.setValueAtTime(f * 0.92, at);
      fq.linearRampToValueAtTime(f * 1.28, at + 0.3);
      fq.linearRampToValueAtTime(f * 0.85, at + d);
      k.env(v.g.gain, at, 0.12, k.rr(0.6, 0.9), d - 0.5, 0.38);
      end = Math.max(end, at + d);
    }
    return end;
  },

  cheer: (k, o, t) => {
    let end = t;
    for (let i = 0; i < 6; i++) {
      const at = t + k.rr(0, 0.2);
      const f = k.rr(150, 320);
      const d = k.rr(0.7, 1.1);
      const v = formantVoice(k, o, at, d, f, 700, 1300, 5, 8);
      const fq = v.osc.frequency;
      fq.setValueAtTime(f, at);
      fq.exponentialRampToValueAtTime(f * 1.45, at + 0.22);
      fq.linearRampToValueAtTime(f * 1.3, at + d);
      v.b1.frequency.setValueAtTime(700, at); // "yaaay"
      v.b1.frequency.linearRampToValueAtTime(500, at + d);
      v.b2.frequency.setValueAtTime(1300, at);
      v.b2.frequency.linearRampToValueAtTime(1900, at + d);
      k.env(v.g.gain, at, 0.05, k.rr(0.6, 0.9), d - 0.35, 0.3);
      end = Math.max(end, at + d);
    }
    const w = k.tone({ f: 1200, t: t + 0.15, a: 0.05, hold: 0.3, r: 0.25, v: 0.04, to: o }); // someone whistles
    w.osc.frequency.setValueAtTime(1200, t + 0.15);
    w.osc.frequency.exponentialRampToValueAtTime(1900, t + 0.35);
    w.osc.frequency.exponentialRampToValueAtTime(1600, t + 0.7);
    return Math.max(end, claps(k, o, t + 0.1, 1.4, 0.25));
  },

  applause: (k, o, t) => claps(k, o, t, 2.6, 0.5),

  plate_clink: (k, o, t) => {
    const p = k.rr(0.94, 1.06);
    k.burst({ t, r: 0.012, v: 0.18, type: 'highpass', f: 3000, to: o });
    return bell(k, o, t, 2150 * p, 0.09, 0.28, [
      [1, 1],
      [1.59, 0.7, 0.7],
      [2.43, 0.4, 0.5],
      [3.62, 0.2, 0.35],
    ]);
  },

  pickup: (k, o, t) => {
    k.burst({ t, a: 0.02, r: 0.06, v: 0.06, type: 'bandpass', f: 1200, f1: 2600, q: 1.2, to: o });
    return k.tone({ type: 'triangle', f: 300, f1: 620, t, a: 0.01, r: 0.1, v: 0.2, to: o }).end;
  },

  drop: (k, o, t) => {
    let end = t;
    for (const [dt, v] of [
      [0, 1],
      [0.17, 0.45],
      [0.29, 0.2],
    ] as const) {
      k.tone({ f: 170, f1: 65, t: t + dt, a: 0.002, r: 0.14, v: 0.55 * v, to: o });
      end = k.burst({ t: t + dt, r: 0.08, v: 0.35 * v, type: 'lowpass', f: 1100, to: o }).end;
    }
    for (const dt of [0.34, 0.39])
      k.burst({ t: t + dt, r: 0.012, v: 0.05, type: 'highpass', f: 3500, to: o });
    return end;
  },

  throw: (k, o, t) =>
    sweep(
      k,
      o,
      t,
      [
        [0, 500],
        [0.15, 2600],
        [0.42, 900],
      ],
      0.12,
      0.3,
      1.8,
      0.35,
    ),

  thud: (k, o, t) => {
    k.burst({ t, r: 0.04, v: 0.18, type: 'lowpass', f: 1600, to: o });
    k.burst({ kind: 'brown', t, r: 0.22, v: 0.6, type: 'lowpass', f: 350, to: o });
    return k.tone({ f: 105, f1: 42, t, a: 0.002, r: 0.38, v: 0.8, to: o }).end;
  },

  switch: (k, o, t) => {
    k.burst({ t, r: 0.008, v: 0.3, type: 'highpass', f: 2500, to: o });
    k.tone({ f: 1150, t, a: 0.001, r: 0.025, v: 0.1, to: o });
    return k.burst({ t: t + 0.014, r: 0.01, v: 0.12, type: 'bandpass', f: 4000, q: 2, to: o }).end;
  },

  curtain: (k, o, t) => {
    const end = sweep(
      k,
      o,
      t,
      [
        [0, 1500],
        [0.35, 3200],
        [0.75, 1400],
      ],
      0.2,
      0.55,
      0.75,
      0.18,
    );
    for (let i = 0; i < 7; i++) {
      const at = t + 0.04 + i * k.rr(0.07, 0.11); // curtain rings sliding along the rod
      bell(k, o, at, k.rr(2600, 3400), 0.025, 0.09, [
        [1, 1],
        [1.51, 0.6],
        [2.1, 0.3],
      ]);
    }
    return end;
  },

  fridge: (k, o, t) => {
    k.tone({ f: 75, f1: 120, t, a: 0.004, r: 0.09, v: 0.4, to: o }); // seal pop
    k.burst({ t, r: 0.06, v: 0.2, type: 'lowpass', f: 700, to: o });
    const ht = t + 0.1;
    k.tone({ f: 60, t: ht, a: 0.15, hold: 0.8, r: 0.35, v: 0.07, to: o }); // hum
    k.tone({ type: 'triangle', f: 120, t: ht, a: 0.15, hold: 0.8, r: 0.35, v: 0.04, to: o });
    k.burst({
      t: ht,
      a: 0.15,
      hold: 0.5,
      r: 0.45,
      v: 0.04,
      type: 'bandpass',
      f: 2600,
      q: 0.5,
      to: o,
    }); // cold air
    bell(k, o, t + 0.24, 1850, 0.06, 0.18, [
      [1, 1],
      [1.52, 0.5],
      [2.7, 0.25],
    ]); // bottles
    bell(k, o, t + 0.31, 2380, 0.045, 0.16, [
      [1, 1],
      [1.52, 0.5],
    ]);
    return ht + 1.3;
  },

  pour: (k, o, t) => {
    const d = 1.4;
    const s = k.burst({
      t,
      a: 0.08,
      hold: d - 0.33,
      r: 0.25,
      v: 0.12,
      type: 'bandpass',
      f: 900,
      f1: 1900,
      q: 1.1,
      to: o,
    });
    let at = t + 0.04;
    for (let i = 0; at < t + d - 0.1; i++) {
      const f = k.rr(330, 520) * (1 + i * 0.045); // glugs climb as the glass fills
      k.tone({
        f,
        f1: f * 2.1,
        glide: 0.045,
        t: at,
        a: 0.003,
        r: 0.06,
        v: 0.13 * k.rr(0.6, 1),
        to: o,
      });
      at += k.rr(0.06, 0.11);
    }
    return s.end;
  },

  bark: (k, o, t) => {
    let end = t;
    const p = k.rr(0.9, 1.1);
    for (const dt of [0, 0.3]) {
      const at = t + dt + k.rr(0, 0.04);
      const v = formantVoice(k, o, at, 0.2, 430 * p, 650 * p, 1250 * p, 3, 5);
      v.osc.frequency.setValueAtTime(430 * p, at);
      v.osc.frequency.exponentialRampToValueAtTime(250 * p, at + 0.13);
      k.env(v.g.gain, at, 0.008, 1, 0.04, 0.09);
      end = k.burst({ t: at, r: 0.07, v: 0.15, type: 'bandpass', f: 1600, q: 1, to: o }).end;
    }
    return end + 0.1;
  },

  thunder: (k, o, t) => {
    const d = 3.6;
    const roll = (u: number): number =>
      u < 0.03 ? u / 0.03 : Math.exp(-(u - 0.03) * 2.6) * Math.sqrt(1 - u);
    k.burst({ t, a: 0.004, r: 0.35, v: 0.45, type: 'highpass', f: 900, to: o }); // crack
    const g = k.gain(0, o);
    k.noise('brown', t, t + d, k.filter('lowpass', 200, -3, g));
    g.gain.setValueCurveAtTime(wobble(k, 90, 0.35, 1.0, roll), t, d);
    const g2 = k.gain(0, o);
    k.noise('white', t + 0.05, t + d, k.filter('lowpass', 650, -3, g2));
    g2.gain.setValueCurveAtTime(wobble(k, 140, 0, 0.2, roll), t + 0.05, d - 0.05);
    return t + d;
  },

  power_down: (k, o, t) => {
    k.tone({ f: 130, f1: 50, t, a: 0.002, r: 0.22, v: 0.5, to: o }); // clunk
    k.burst({ t, r: 0.1, v: 0.25, type: 'lowpass', f: 600, to: o });
    const lp = k.filter('lowpass', 1500, 1.2, o);
    lp.frequency.setValueAtTime(1500, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 1.3);
    k.tone({ type: 'sawtooth', f: 440, f1: 35, t, a: 0.01, hold: 0.9, r: 0.4, v: 0.13, to: lp }); // whine winds down
    return k.tone({ f: 60, f1: 42, t, a: 0.01, hold: 0.25, r: 0.7, v: 0.12, to: o }).end;
  },

  power_up: (k, o, t) => {
    k.burst({ t, r: 0.01, v: 0.25, type: 'highpass', f: 2500, to: o }); // switch
    const lp = k.filter('lowpass', 300, 1.2, o);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.8);
    k.tone({
      type: 'sawtooth',
      f: 45,
      f1: 480,
      glide: 0.8,
      t,
      a: 0.12,
      hold: 0.55,
      r: 0.3,
      v: 0.12,
      to: lp,
    });
    const bg = k.gain(0, o); // fluorescent tubes flickering on
    k.osc('square', 100, t, t + 1.1, k.filter('bandpass', 400, 2, bg));
    const c = new Float32Array(60);
    for (let i = 0; i < 60; i++)
      c[i] = i < 36 ? (k.rng() < 0.5 ? 0.06 : 0) : 0.04 * (1 - (i - 36) / 23);
    bg.gain.setValueCurveAtTime(c, t + 0.05, 1.0);
    bell(k, o, t + 0.75, 1250, 0.035, 0.25, [
      [1, 1],
      [2.7, 0.3],
    ]);
    return t + 1.15;
  },

  glass_clink: (k, o, t) => {
    bell(k, o, t, 2640, 0.07, 1.3, [
      [1, 1],
      [2.32, 0.35, 0.55],
      [3.9, 0.12, 0.3],
    ]);
    bell(k, o, t + 0.012, 2640 * 1.017, 0.06, 1.2, [
      [1, 1],
      [2.32, 0.3, 0.55],
    ]); // the other glass
    k.burst({ t, r: 0.01, v: 0.1, type: 'highpass', f: 5000, to: o });
    return t + 1.4;
  },

  chase_sting: (k, o, t) => {
    // dun, dun, DUNNN
    stab(k, o, t, [50, 53, 57], 0.1, 0.12, 0.05);
    stab(k, o, t + 0.3, [50, 53, 57], 0.1, 0.12, 0.05);
    k.burst({ t: t + 0.1, a: 0.5, r: 0.05, v: 0.08, type: 'highpass', f: 5000, to: o }); // cymbal swell
    return stab(k, o, t + 0.6, [49, 52, 55, 58], 0.7, 0.9, 0.055);
  },

  van_door: (k, o, t) => {
    k.burst({
      kind: 'brown',
      t,
      a: 0.08,
      hold: 0.42,
      r: 0.1,
      v: 0.45,
      type: 'lowpass',
      f: 450,
      to: o,
    }); // rolling
    k.burst({
      t,
      a: 0.1,
      hold: 0.35,
      r: 0.1,
      v: 0.035,
      type: 'bandpass',
      f: 2200,
      f1: 2900,
      q: 6,
      to: o,
    }); // rollers
    const st = t + 0.6;
    k.tone({ f: 90, f1: 40, t: st, a: 0.002, r: 0.4, v: 0.85, to: o });
    k.burst({ t: st, r: 0.2, v: 0.45, type: 'lowpass', f: 800, to: o });
    bell(k, o, st, 310, 0.06, 0.3, [
      [1, 1],
      [1.52, 0.8],
      [2.37, 0.6],
      [3.65, 0.4],
    ]); // metal clank
    return st + 0.45;
  },

  engine: (k, o, t) => {
    // Starter motor: a square LFO chugs a low rumble, with a little whine on top.
    const sg = k.gain(0, o);
    const slp = k.filter('lowpass', 380, 1, sg);
    k.noise('brown', t, t + 0.75, slp);
    k.osc('square', 8.5, t, t + 0.75, null).connect(k.gain(0.25, sg.gain));
    sg.gain.setValueAtTime(0.3, t);
    sg.gain.setValueAtTime(0.3, t + 0.65);
    sg.gain.linearRampToValueAtTime(0, t + 0.72);
    k.tone({ type: 'sawtooth', f: 190, f1: 240, t, a: 0.02, hold: 0.6, r: 0.08, v: 0.03, to: slp });
    // It catches, revs once and idles.
    const ct = t + 0.7;
    const lp = k.filter('lowpass', 260, 2.5, o);
    lp.frequency.setValueAtTime(260, ct);
    lp.frequency.linearRampToValueAtTime(820, ct + 0.35);
    lp.frequency.linearRampToValueAtTime(300, ct + 1.0);
    const e = k.tone({
      type: 'sawtooth',
      f: 36,
      t: ct,
      a: 0.02,
      hold: 1.1,
      r: 0.55,
      v: 0.45,
      to: lp,
    });
    e.osc.frequency.setValueAtTime(36, ct);
    e.osc.frequency.linearRampToValueAtTime(74, ct + 0.35);
    e.osc.frequency.linearRampToValueAtTime(40, ct + 1.0);
    return e.end;
  },

  tick: (k, o, t) => {
    k.burst({ t, r: 0.008, v: 0.12, type: 'highpass', f: 4000, to: o });
    k.tone({ f: 1300, t, a: 0.001, r: 0.035, v: 0.12, to: o });
    return k.tone({ f: 2600, t, a: 0.001, r: 0.02, v: 0.12, to: o }).end;
  },

  ui_click: (k, o, t) => {
    k.tone({ f: 700, t, a: 0.001, r: 0.02, v: 0.05, to: o });
    return k.tone({ type: 'triangle', f: 1500, t, a: 0.001, r: 0.03, v: 0.12, to: o }).end;
  },

  ui_good: (k, o, t) => {
    bell(k, o, t, 1046.5, 0.12, 0.3, [
      [1, 1],
      [2, 0.25, 0.5],
    ]);
    return bell(k, o, t + 0.085, 1568, 0.12, 0.4, [
      [1, 1],
      [2, 0.25, 0.5],
    ]);
  },

  ui_bad: (k, o, t) => {
    const lp = k.filter('lowpass', 1400, -3, o);
    k.tone({ type: 'triangle', f: 330, f1: 315, t, a: 0.005, hold: 0.05, r: 0.15, v: 0.2, to: lp });
    return k.tone({
      type: 'triangle',
      f: 262,
      f1: 235,
      t: t + 0.12,
      a: 0.005,
      hold: 0.08,
      r: 0.22,
      v: 0.2,
      to: lp,
    }).end;
  },

  whoosh: (k, o, t) =>
    sweep(
      k,
      o,
      t,
      [
        [0, 300],
        [0.25, 2800],
        [0.55, 600],
      ],
      0.22,
      0.3,
      1.4,
      0.3,
    ),

  footstep: (k, o, t) => {
    const p = k.rr(0.85, 1.15);
    k.tone({ f: 95 * p, f1: 55, t, a: 0.003, r: 0.08, v: 0.4, to: o });
    k.burst({ t, a: 0.002, r: 0.05, v: 0.22, type: 'lowpass', f: 900 * p, to: o });
    return k.burst({ t: t + 0.035, r: 0.03, v: 0.08, type: 'lowpass', f: 1400 * p, to: o }).end;
  },

  rule: (k, o, t) => {
    // Chalk scratches a new Rule onto the ledger...
    for (const [dt, d] of [
      [0, 0.13],
      [0.17, 0.1],
      [0.31, 0.16],
    ] as const) {
      const g = k.gain(0, o);
      k.noise('white', t + dt, t + dt + d, k.filter('bandpass', k.rr(2400, 3200), 2.2, g));
      g.gain.setValueCurveAtTime(
        spikes(k, 48, 0.55, 0.2, 0.5, fadeInOut(0.15, 0.3), 0.6),
        t + dt,
        d,
      );
    }
    // ...and a music-box "uh-oh".
    const box: readonly Partial3[] = [
      [1, 1],
      [3, 0.18, 0.4],
      [4.1, 0.07, 0.25],
    ];
    bell(k, o, t + 0.55, midiHz(79), 0.11, 0.8, box);
    return bell(k, o, t + 0.73, midiHz(76), 0.11, 1.0, box);
  },

  question: (k, o, t) => {
    // Two plucks, the second bending up: "hm?"
    const pluck = (at: number, m: number, bend: number): number => {
      const lp = k.filter('lowpass', 3200, 1, o);
      lp.frequency.setValueAtTime(3200, at);
      lp.frequency.exponentialRampToValueAtTime(600, at + 0.3);
      const tn = k.tone({
        type: 'triangle',
        f: midiHz(m),
        t: at,
        a: 0.003,
        r: 0.35,
        v: 0.3,
        to: lp,
      });
      if (bend) {
        tn.osc.frequency.setValueAtTime(midiHz(m), at + 0.06);
        tn.osc.frequency.exponentialRampToValueAtTime(midiHz(m + bend), at + 0.22);
      }
      return tn.end;
    };
    pluck(t, 67, 0);
    return pluck(t + 0.14, 74, 1);
  },

  record_scratch: (k, o, t) => {
    const g = k.gain(0, o);
    const bp = k.filter('bandpass', 1800, 2.5, g);
    k.noise('white', t, t + 0.5, bp);
    const f = bp.frequency;
    f.setValueAtTime(3000, t);
    f.exponentialRampToValueAtTime(700, t + 0.13);
    f.setValueAtTime(900, t + 0.16);
    f.exponentialRampToValueAtTime(2600, t + 0.26);
    f.exponentialRampToValueAtTime(400, t + 0.45);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.01);
    g.gain.linearRampToValueAtTime(0.25, t + 0.13);
    g.gain.linearRampToValueAtTime(0.02, t + 0.15);
    g.gain.linearRampToValueAtTime(0.45, t + 0.17);
    g.gain.linearRampToValueAtTime(0, t + 0.45);
    const lp = k.filter('lowpass', 1200, 2, o); // the record winding down: "vwoop"
    k.tone({
      type: 'sawtooth',
      f: 220,
      f1: 50,
      glide: 0.4,
      t,
      a: 0.005,
      hold: 0.25,
      r: 0.15,
      v: 0.12,
      to: lp,
    });
    return t + 0.5;
  },
};
