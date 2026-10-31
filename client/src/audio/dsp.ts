// Shared Web Audio building blocks: noise buffers, envelopes, one-shot voices (Kit), the positional
// chain (HRTF panner → muffle low-pass → gain) and the master mixer. Everything takes a
// BaseAudioContext, so the same graphs render live or offline (see selftest.ts).

import { makeRng, rr, type Rng } from './rng.ts';

export type Vec3 = readonly [number, number, number];
export type NoiseKind = 'white' | 'brown' | 'crackle';
export type Dest = AudioNode | AudioParam;
export type BusName = 'master' | 'sfx' | 'music' | 'murmur' | 'voice';

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);
export const finite3 = (p: Vec3): boolean =>
  Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);

export function link(src: AudioNode, dst: Dest): void {
  if (dst instanceof AudioParam) src.connect(dst);
  else src.connect(dst);
}

/**
 * Biquad cutoff/Q automation at a-rate makes Chrome recompute filter coefficients every sample;
 * k-rate (once per 128 frames) is plenty for formants, sweeps and muffling, and much cheaper.
 */
export function kRate(f: BiquadFilterNode): BiquadFilterNode {
  try {
    f.frequency.automationRate = 'k-rate';
    f.Q.automationRate = 'k-rate';
  } catch {
    /* older engines: stay a-rate */
  }
  return f;
}

/** A k-rate biquad. */
export function biquad(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  f: number,
  q: number,
): BiquadFilterNode {
  const n = kRate(ctx.createBiquadFilter());
  n.type = type;
  n.frequency.value = Math.min(f, ctx.sampleRate * 0.45);
  n.Q.value = q;
  return n;
}

/** Holds a param at its current value from `t` on, dropping later automation. */
export function cancelHold(p: AudioParam, t: number): void {
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(t);
  } else {
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  }
}

// ---------------------------------------------------------------------------------------------
// Muffling: the stealth system, so it has to read clearly (GDD §11).

const lerpLog = (a: number, b: number, u: number): number =>
  Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * u);

/** Low-pass cutoff for a muffle amount: 0 → 20 kHz, 0.5 → 1.2 kHz, 1 → 400 Hz. */
export function muffleCutoff(m: number): number {
  const x = clamp(m, 0, 1);
  return x <= 0.5 ? lerpLog(20000, 1200, x / 0.5) : lerpLog(1200, 400, (x - 0.5) / 0.5);
}

/** Gain lost through walls and doors on top of the low-pass: 1 → 0.55 (about −5 dB). */
export const muffleGain = (m: number): number => 1 - 0.45 * clamp(m, 0, 1);

// ---------------------------------------------------------------------------------------------
// Noise buffers, built once per context.

const noiseCache = new WeakMap<BaseAudioContext, Record<NoiseKind, AudioBuffer>>();

export function noiseBuffer(ctx: BaseAudioContext, kind: NoiseKind): AudioBuffer {
  let c = noiseCache.get(ctx);
  if (!c) {
    c = buildNoise(ctx);
    noiseCache.set(ctx, c);
  }
  return c[kind];
}

function buildNoise(ctx: BaseAudioContext): Record<NoiseKind, AudioBuffer> {
  const rng = makeRng(0x5eed);
  const sr = ctx.sampleRate;

  const n = Math.floor(sr * 2);
  const white = ctx.createBuffer(1, n, sr);
  const w = white.getChannelData(0);
  for (let i = 0; i < n; i++) w[i] = rng() * 2 - 1;

  // Brown (integrated) noise, detrended so the loop point doesn't click, then normalized.
  const brown = ctx.createBuffer(1, n, sr);
  const b = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (rng() * 2 - 1)) / 1.02;
    b[i] = last;
  }
  const drift = (b[n - 1] ?? 0) - (b[0] ?? 0);
  let peak = 1e-6;
  for (let i = 0; i < n; i++) {
    const v = (b[i] ?? 0) - (drift * i) / (n - 1);
    b[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  for (let i = 0; i < n; i++) b[i] = ((b[i] ?? 0) / peak) * 0.9;

  // Vinyl crackle: sparse little pops over a faint hiss.
  const cn = Math.floor(sr * 3);
  const crackle = ctx.createBuffer(1, cn, sr);
  const c = crackle.getChannelData(0);
  let pop = 0;
  for (let i = 0; i < cn; i++) {
    pop *= 0.55;
    if (rng() < 9 / sr) pop = (rng() < 0.5 ? -1 : 1) * rr(rng, 0.25, 1);
    else if (rng() < 120 / sr) pop = (rng() < 0.5 ? -1 : 1) * rr(rng, 0.03, 0.12);
    c[i] = pop + (rng() * 2 - 1) * 0.012;
  }

  return { white, brown, crackle };
}

// ---------------------------------------------------------------------------------------------
// Kit: terse helpers for building one-shot voices. Optionally tracks every node it creates so the
// engine can disconnect a finished sound effect (including feedback loops) in one go.

export interface ToneOpts {
  type?: OscillatorType;
  f: number;
  /** Glide target (exponential) reached after `glide` seconds (default: the whole note). */
  f1?: number;
  glide?: number;
  detune?: number;
  t: number;
  a?: number;
  hold?: number;
  r: number;
  v: number;
  to: Dest;
}

export interface BurstOpts {
  kind?: NoiseKind;
  t: number;
  a?: number;
  hold?: number;
  r: number;
  v: number;
  to: Dest;
  type?: BiquadFilterType;
  f?: number;
  /** Filter sweep target (exponential) reached after `sweep` seconds (default: the whole burst). */
  f1?: number;
  sweep?: number;
  q?: number;
  rate?: number;
}

export class Kit {
  readonly nodes: AudioNode[] = [];

  constructor(
    readonly ctx: BaseAudioContext,
    readonly rng: Rng,
    private readonly track = false,
  ) {}

  rr(a: number, b: number): number {
    return a + (b - a) * this.rng();
  }

  jit(x: number): number {
    return this.rr(-x, x);
  }

  private keep<T extends AudioNode>(n: T): T {
    if (this.track) this.nodes.push(n);
    return n;
  }

  gain(v: number, to: Dest | null): GainNode {
    const g = this.keep(this.ctx.createGain());
    g.gain.value = v;
    if (to) link(g, to);
    return g;
  }

  filter(type: BiquadFilterType, f: number, q: number, to: Dest | null): BiquadFilterNode {
    const n = this.keep(biquad(this.ctx, type, f, q));
    if (to) link(n, to);
    return n;
  }

  osc(type: OscillatorType, f: number, t: number, stop: number, to: Dest | null): OscillatorNode {
    const o = this.keep(this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = f;
    if (to) link(o, to);
    o.start(Math.max(0, t));
    o.stop(Math.max(0, t, stop));
    return o;
  }

  noise(kind: NoiseKind, t: number, stop: number, to: Dest, rate = 1): AudioBufferSourceNode {
    const s = this.keep(this.ctx.createBufferSource());
    const buf = noiseBuffer(this.ctx, kind);
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    link(s, to);
    s.start(Math.max(0, t), this.rng() * (buf.duration - 0.05));
    s.stop(Math.max(0, t, stop));
    return s;
  }

  /** Linear attack to `peak`, hold, then an exponential tail that's ~−40 dB after `r`. */
  env(p: AudioParam, t: number, a: number, peak: number, hold: number, r: number): number {
    const at = Math.max(0.001, a);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + at);
    if (hold > 0) p.setValueAtTime(peak, t + at + hold);
    p.setTargetAtTime(0, t + at + hold, r / 5);
    return t + at + hold + r;
  }

  tone(o: ToneOpts): { end: number; osc: OscillatorNode; g: GainNode } {
    const a = o.a ?? 0.005;
    const hold = o.hold ?? 0;
    const end = o.t + Math.max(0.001, a) + hold + o.r;
    const g = this.gain(0, o.to);
    const osc = this.osc(o.type ?? 'sine', o.f, o.t, end + 0.02, g);
    if (o.detune) osc.detune.value = o.detune;
    if (o.f1 !== undefined) {
      osc.frequency.setValueAtTime(o.f, o.t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), o.t + (o.glide ?? end - o.t));
    }
    this.env(g.gain, o.t, a, o.v, hold, o.r);
    return { end, osc, g };
  }

  burst(o: BurstOpts): { end: number; f: BiquadFilterNode | null; g: GainNode } {
    const a = o.a ?? 0.002;
    const hold = o.hold ?? 0;
    const end = o.t + Math.max(0.001, a) + hold + o.r;
    const g = this.gain(0, o.to);
    let input: AudioNode = g;
    let f: BiquadFilterNode | null = null;
    if (o.type) {
      f = this.filter(o.type, o.f ?? 1000, o.q ?? (o.type === 'bandpass' ? 1 : -3), g);
      if (o.f1 !== undefined) {
        f.frequency.setValueAtTime(o.f ?? 1000, o.t);
        f.frequency.exponentialRampToValueAtTime(o.f1, o.t + (o.sweep ?? end - o.t));
      }
      input = f;
    }
    this.noise(o.kind ?? 'white', o.t, end + 0.02, input, o.rate);
    this.env(g.gain, o.t, a, o.v, hold, o.r);
    return { end, f, g };
  }

  /** Dry + damped feedback echo. Returns the node to feed. */
  echo(to: AudioNode, time: number, fb: number, damp: number, wet: number): GainNode {
    const input = this.gain(1, to);
    const d = this.keep(this.ctx.createDelay(1));
    d.delayTime.value = time;
    const lp = this.filter('lowpass', damp, -3, null);
    input.connect(d);
    d.connect(lp);
    lp.connect(this.gain(fb, d));
    lp.connect(this.gain(wet, to));
    return input;
  }
}

// ---------------------------------------------------------------------------------------------
// Positional chain: PannerNode (HRTF, inverse distance) → muffle low-pass → gain → bus.

export const PANNER = { refDistance: 1.5, maxDistance: 25, rolloffFactor: 1 } as const;

export function createPanner(ctx: BaseAudioContext): PannerNode {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = PANNER.refDistance;
  p.maxDistance = PANNER.maxDistance;
  p.rolloffFactor = PANNER.rolloffFactor;
  return p;
}

export interface ChainOpts {
  position?: Vec3 | undefined;
  muffle?: number | undefined;
  volume?: number | undefined;
  /** Force a panner even without a starting position (persistent sources that move later). */
  spatial?: boolean;
}

export class SpatialChain {
  readonly input: AudioNode;
  private readonly panner: PannerNode | null;
  private readonly lp: BiquadFilterNode;
  private readonly out: GainNode;
  private vol: number;
  private muf: number;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    o: ChainOpts = {},
  ) {
    this.vol = clamp(o.volume ?? 1, 0, 4);
    this.muf = clamp(o.muffle ?? 0, 0, 1);
    this.out = ctx.createGain();
    this.out.gain.value = this.vol * muffleGain(this.muf);
    this.out.connect(dest);
    this.lp = biquad(ctx, 'lowpass', this.cutoff(this.muf), -3); // Q in dB: Butterworth, no bump
    this.lp.connect(this.out);
    if (o.spatial || o.position !== undefined) {
      this.panner = createPanner(ctx);
      this.panner.connect(this.lp);
      this.input = this.panner;
      if (o.position) this.setPosition(o.position);
    } else {
      this.panner = null;
      this.input = this.lp;
    }
  }

  private cutoff(m: number): number {
    return Math.min(muffleCutoff(m), this.ctx.sampleRate * 0.45);
  }

  setPosition(p: Vec3): void {
    const pn = this.panner;
    if (!pn || !finite3(p)) return;
    if (pn.positionX !== undefined) {
      pn.positionX.value = p[0];
      pn.positionY.value = p[1];
      pn.positionZ.value = p[2];
    } else {
      pn.setPosition(p[0], p[1], p[2]);
    }
  }

  setMuffle(m: number, tc = 0.08): void {
    if (!Number.isFinite(m)) return;
    const next = clamp(m, 0, 1);
    if (Math.abs(next - this.muf) < 0.004) return;
    this.muf = next;
    const now = this.ctx.currentTime;
    this.lp.frequency.setTargetAtTime(this.cutoff(next), now, tc);
    this.out.gain.setTargetAtTime(this.vol * muffleGain(next), now, tc);
  }

  setVolume(v: number): void {
    if (!Number.isFinite(v)) return;
    this.vol = clamp(v, 0, 4);
    this.out.gain.setTargetAtTime(this.vol * muffleGain(this.muf), this.ctx.currentTime, 0.03);
  }

  dispose(): void {
    this.panner?.disconnect();
    this.lp.disconnect();
    this.out.disconnect();
  }
}

// ---------------------------------------------------------------------------------------------
// Mixer: sfx / music / voice / murmur(→ chase duck) → mix → compressor → master → destination.

export interface Mixer {
  sfx: GainNode;
  music: GainNode;
  murmur: GainNode;
  voice: GainNode;
  /** Murmur duck for the Chase: 0 cuts every guest voice instantly. */
  murmurDuck: GainNode;
  comp: DynamicsCompressorNode;
  master: GainNode;
}

/** Default bus volumes (the settings sliders' starting points). */
export const DEFAULT_VOLUME: Readonly<Record<BusName, number>> = {
  master: 0.9,
  sfx: 1,
  music: 0.8,
  murmur: 0.9,
  voice: 1,
};

export function buildMixer(
  ctx: BaseAudioContext,
  volumes: Readonly<Record<BusName, number>> = DEFAULT_VOLUME,
): Mixer {
  const master = ctx.createGain();
  master.gain.value = volumes.master;
  master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  comp.connect(master);
  const mix = ctx.createGain();
  mix.gain.value = 0.75;
  mix.connect(comp);
  const bus = (to: AudioNode, v = 1): GainNode => {
    const g = ctx.createGain();
    g.gain.value = v;
    g.connect(to);
    return g;
  };
  const murmurDuck = bus(mix);
  return {
    sfx: bus(mix, volumes.sfx),
    music: bus(mix, volumes.music),
    voice: bus(mix, volumes.voice),
    murmur: bus(murmurDuck, volumes.murmur),
    murmurDuck,
    comp,
    master,
  };
}
