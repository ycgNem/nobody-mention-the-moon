// AudioEngine: owns the AudioContext, the mixer, the lookahead timer, guest murmurs, the record
// player and the Chase loop. Every public method is a safe no-op when Web Audio is missing, the
// context is suspended (autoplay policy, hidden tab) or it's running in tests.

import {
  DEFAULT_VOLUME,
  Kit,
  SpatialChain,
  buildMixer,
  cancelHold,
  clamp,
  createPanner,
  finite3,
  type BusName,
  type Mixer,
  type Vec3,
} from './dsp.ts';
import { MurmurVoice, type MurmurMood } from './murmur.ts';
import { ChaseBand, JazzBand } from './music.ts';
import { makeRng, type Rng } from './rng.ts';
import { playSfx, type SfxName } from './sfx.ts';

export interface SourceOpts {
  /** World position (meters, Three.js axes). Omit for a non-positional sound. */
  position?: Vec3;
  /** 0 = clear, 1 = through two closed doors */
  muffle?: number;
  volume?: number;
}

export interface Murmur {
  setPosition(p: Vec3): void;
  setMood(m: MurmurMood): void;
  setMuffle(m: number): void;
  dispose(): void;
}

export interface RecordPlayer {
  readonly playing: boolean;
  play(): void;
  stop(): void;
  /** 0 calm … 1 everything's on fire: tempo and tension layer rise */
  setTension(t: number): void;
  setPosition(p: Vec3): void;
  setMuffle(m: number): void;
}

/** A positional input other code can feed (e.g. a WebRTC peer's MediaStreamAudioSourceNode). */
export interface SpatialInput {
  readonly input: AudioNode;
  setPosition(p: Vec3): void;
  setMuffle(m: number): void;
  setVolume(v: number): void;
  dispose(): void;
}

const LOOKAHEAD = 0.3;
const LOOKAHEAD_HIDDEN = 1.2;
const TIMER_MS = 50;
const MAX_SFX = 48;
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

const warned = new Set<string>();
function warnOnce(where: string, e: unknown): void {
  if (warned.has(where)) return;
  warned.add(where);
  console.warn(`[audio] ${where} failed; continuing without it.`, e);
}

/** Runs fn, logging (once per site) instead of throwing: audio must never break the game. */
function guard(where: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    warnOnce(where, e);
  }
}

const copy3 = (p: Vec3): Vec3 => [p[0], p[1], p[2]];
/** A function, so TypeScript doesn't keep an old narrowing of `state` across an await. */
const isRunning = (ctx: BaseAudioContext): boolean => ctx.state === 'running';

export class AudioEngine {
  readonly music: RecordPlayer;
  private _ctx: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private readonly rng: Rng = makeRng();
  private readonly volumes: Record<BusName, number> = { ...DEFAULT_VOLUME };
  private listener: { p: Vec3; f: Vec3; u: Vec3 } = { p: [0, 0, 0], f: [0, 0, -1], u: [0, 1, 0] };
  private readonly murmurs = new Set<MurmurHandle>();
  private readonly record: RecordHandle;
  private chase: ChaseBand | null = null;
  private chaseOn = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeSfx = 0;
  private disposed = false;
  private unlockBound = false;
  private readonly readyCbs: ((ctx: AudioContext) => void)[] = [];
  private readonly unlock = (): void => {
    void this.resume();
  };

  constructor() {
    this.record = new RecordHandle(() => this.chaseOn);
    this.music = this.record;
    if (typeof window === 'undefined') return;
    for (const ev of UNLOCK_EVENTS)
      window.addEventListener(ev, this.unlock, { capture: true, passive: true });
    this.unlockBound = true;
    // If the page already had a user gesture, the context may start right away.
    if (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive)
      this.ensureContext();
  }

  get ctx(): AudioContext | null {
    return this._ctx;
  }

  /** Bus for voice chat (WebRTC) so the voice slider works. Null until the context exists. */
  get voiceBus(): AudioNode | null {
    return this.mixer?.voice ?? null;
  }

  /** Runs `cb` once the AudioContext exists (immediately if it already does). Returns an unsubscribe. */
  onReady(cb: (ctx: AudioContext) => void): () => void {
    if (this._ctx) {
      cb(this._ctx);
      return () => {};
    }
    this.readyCbs.push(cb);
    return () => {
      const i = this.readyCbs.indexOf(cb);
      if (i >= 0) this.readyCbs.splice(i, 1);
    };
  }

  /** Call from a user gesture (click/keydown) to start audio. Also hooked to the first gesture automatically. */
  async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx || isRunning(ctx) || ctx.state === 'closed') return;
    try {
      // Without a gesture Chrome leaves this promise pending, so don't wait forever.
      await Promise.race([ctx.resume(), new Promise<void>((r) => setTimeout(r, 1000))]);
    } catch {
      /* not allowed yet; the next gesture will try again */
    }
    if (isRunning(ctx)) this.onRunning();
  }

  setVolume(bus: BusName, v: number): void {
    if (!Number.isFinite(v)) return;
    this.volumes[bus] = clamp(v, 0, 2);
    const mx = this.mixer;
    const ctx = this._ctx;
    if (mx && ctx) mx[bus].gain.setTargetAtTime(this.volumes[bus], ctx.currentTime, 0.03);
  }

  /** Camera position and facing, in the same world space as every source position. */
  setListener(position: Vec3, forward: Vec3, up: Vec3 = [0, 1, 0]): void {
    if (!finite3(position) || !finite3(forward) || !finite3(up)) return;
    this.listener = { p: copy3(position), f: copy3(forward), u: copy3(up) };
    this.applyListener();
  }

  sfx(name: SfxName, opts: SourceOpts = {}): void {
    const ctx = this._ctx;
    const mx = this.mixer;
    if (!ctx || !mx || ctx.state !== 'running' || this.activeSfx >= MAX_SFX) return;
    try {
      const pos = opts.position && finite3(opts.position) ? opts.position : undefined;
      const chain = new SpatialChain(ctx, mx.sfx, {
        position: pos,
        muffle: opts.muffle,
        volume: opts.volume,
      });
      const kit = new Kit(ctx, this.rng, true);
      const t = ctx.currentTime + 0.005;
      const end = playSfx(kit, name, chain.input, t);
      this.activeSfx++;
      setTimeout(
        () => {
          this.activeSfx--;
          guard('sfx cleanup', () => {
            chain.dispose();
            for (const n of kit.nodes) n.disconnect();
          });
        },
        (end - t + 0.5) * 1000,
      );
    } catch (e) {
      warnOnce(`sfx(${name})`, e);
    }
  }

  /** Tiny UI blips for menus (non-positional). */
  ui(name: 'ui_click' | 'ui_good' | 'ui_bad'): void {
    this.sfx(name);
  }

  /** Gibberish dinner-party babble, one per guest. pitch: 0.7 (deep) – 1.5 (high). Starts 'calm'. */
  createMurmur(pitch: number): Murmur {
    const h = new MurmurHandle(pitch, (x) => this.murmurs.delete(x));
    this.murmurs.add(h);
    const ctx = this._ctx;
    const mx = this.mixer;
    if (ctx && mx) this.attachMurmur(h, ctx, mx);
    return h;
  }

  /** A positional input on any bus, using the same panner and muffle curve as everything else. */
  createSpatialInput(
    bus: Exclude<BusName, 'master'> = 'voice',
    opts: SourceOpts = {},
  ): SpatialInput | null {
    const ctx = this._ctx;
    const mx = this.mixer;
    if (!ctx || !mx) return null;
    try {
      const chain = new SpatialChain(ctx, mx[bus], {
        position: opts.position,
        muffle: opts.muffle,
        volume: opts.volume,
        spatial: true,
      });
      return {
        input: chain.input,
        setPosition: (p) => chain.setPosition(p),
        setMuffle: (m) => chain.setMuffle(m),
        setVolume: (v) => chain.setVolume(v),
        dispose: () => chain.dispose(),
      };
    } catch (e) {
      warnOnce('createSpatialInput', e);
      return null;
    }
  }

  /** Chase mode: music and murmurs cut dead, a record scratch, then the chase loop until stopChase(). */
  startChase(): void {
    if (this.chaseOn) return;
    this.chaseOn = true;
    const ctx = this._ctx;
    const mx = this.mixer;
    if (!ctx || !mx) return;
    try {
      const now = ctx.currentTime;
      this.record.cut();
      cancelHold(mx.murmurDuck.gain, now);
      mx.murmurDuck.gain.setValueAtTime(0, now);
      if (ctx.state === 'running')
        playSfx(new Kit(ctx, this.rng), 'record_scratch', mx.sfx, now + 0.005);
      this.chase ??= new ChaseBand(ctx, mx.music, this.rng);
      this.chase.play(now + 0.45);
      this.tick();
    } catch (e) {
      warnOnce('startChase', e);
    }
  }

  stopChase(): void {
    if (!this.chaseOn) return;
    this.chaseOn = false;
    const ctx = this._ctx;
    const mx = this.mixer;
    if (!ctx || !mx) return;
    try {
      const now = ctx.currentTime;
      this.chase?.stop(1.5);
      cancelHold(mx.murmurDuck.gain, now);
      mx.murmurDuck.gain.setTargetAtTime(1, now, 0.3);
      this.record.afterChase();
    } catch (e) {
      warnOnce('stopChase', e);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeUnlock();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const m of [...this.murmurs]) m.dispose();
    this.record.detach();
    this.chase = null;
    const ctx = this._ctx;
    this._ctx = null;
    this.mixer = null;
    if (ctx) void ctx.close().catch(() => {});
  }

  // --- internals -----------------------------------------------------------------------------

  private ensureContext(): AudioContext | null {
    if (this._ctx || this.disposed) return this._ctx;
    if (typeof AudioContext === 'undefined') return null;
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const mx = buildMixer(ctx, this.volumes);
      this._ctx = ctx;
      this.mixer = mx;
      this.applyListener();
      createPanner(ctx); // warm up the HRTF database so the first positional sound isn't silent
      for (const h of this.murmurs) this.attachMurmur(h, ctx, mx);
      this.record.attach(ctx, mx.music, this.rng);
      if (this.chaseOn) {
        mx.murmurDuck.gain.value = 0;
        this.chase = new ChaseBand(ctx, mx.music, this.rng);
        this.chase.play();
      }
      ctx.addEventListener('statechange', () => {
        if (ctx.state === 'running') this.onRunning();
      });
      this.timer = setInterval(() => this.tick(), TIMER_MS);
      for (const cb of this.readyCbs.splice(0)) {
        try {
          cb(ctx);
        } catch (e) {
          warnOnce('onReady callback', e);
        }
      }
      return ctx;
    } catch (e) {
      warnOnce('AudioContext', e);
      return null;
    }
  }

  private attachMurmur(h: MurmurHandle, ctx: AudioContext, mx: Mixer): void {
    try {
      h.attach(ctx, mx.murmur, this.rng);
    } catch (e) {
      warnOnce('createMurmur', e);
    }
  }

  private onRunning(): void {
    this.removeUnlock();
    this.tick();
  }

  private removeUnlock(): void {
    if (!this.unlockBound || typeof window === 'undefined') return;
    for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, this.unlock, { capture: true });
    this.unlockBound = false;
  }

  private tick(): void {
    const ctx = this._ctx;
    if (!ctx || ctx.state !== 'running') return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const until = ctx.currentTime + (hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD);
    try {
      for (const m of this.murmurs) m.voice?.schedule(until);
      this.record.band?.schedule(until);
      this.chase?.schedule(until);
    } catch (e) {
      warnOnce('scheduler', e);
    }
  }

  private applyListener(): void {
    const ctx = this._ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const { p, f, u } = this.listener;
    try {
      if (l.positionX !== undefined) {
        l.positionX.value = p[0];
        l.positionY.value = p[1];
        l.positionZ.value = p[2];
        l.forwardX.value = f[0];
        l.forwardY.value = f[1];
        l.forwardZ.value = f[2];
        l.upX.value = u[0];
        l.upY.value = u[1];
        l.upZ.value = u[2];
      } else {
        l.setPosition(p[0], p[1], p[2]);
        l.setOrientation(f[0], f[1], f[2], u[0], u[1], u[2]);
      }
    } catch (e) {
      warnOnce('setListener', e);
    }
  }
}

class MurmurHandle implements Murmur {
  voice: MurmurVoice | null = null;
  private pos: Vec3 = [0, 0, 0];
  private mood: MurmurMood = 'calm';
  private muffle = 0;
  private disposed = false;

  constructor(
    private readonly pitch: number,
    private readonly onDispose: (h: MurmurHandle) => void,
  ) {}

  attach(ctx: BaseAudioContext, dest: AudioNode, rng: Rng): void {
    if (this.disposed || this.voice) return;
    this.voice = new MurmurVoice(ctx, dest, this.pitch, rng, {
      position: this.pos,
      muffle: this.muffle,
    });
    this.voice.setMood(this.mood);
  }

  setPosition(p: Vec3): void {
    if (!finite3(p)) return;
    this.pos = copy3(p);
    guard('murmur.setPosition', () => this.voice?.chain.setPosition(p));
  }

  setMood(m: MurmurMood): void {
    this.mood = m;
    guard('murmur.setMood', () => this.voice?.setMood(m));
  }

  setMuffle(m: number): void {
    if (!Number.isFinite(m)) return;
    this.muffle = clamp(m, 0, 1);
    guard('murmur.setMuffle', () => this.voice?.chain.setMuffle(this.muffle));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    guard('murmur.dispose', () => this.voice?.dispose());
    this.voice = null;
    this.onDispose(this);
  }
}

class RecordHandle implements RecordPlayer {
  band: JazzBand | null = null;
  private chain: SpatialChain | null = null;
  private want = false;
  private tension = 0;
  private pos: Vec3 = [0, 0, 0];
  private muffle = 0;

  constructor(private readonly chaseActive: () => boolean) {}

  get playing(): boolean {
    return this.want;
  }

  attach(ctx: BaseAudioContext, dest: AudioNode, rng: Rng): void {
    try {
      this.chain = new SpatialChain(ctx, dest, {
        position: this.pos,
        muffle: this.muffle,
        spatial: true,
      });
      this.band = new JazzBand(ctx, this.chain.input, rng);
      this.band.setTension(this.tension);
      if (this.want && !this.chaseActive()) this.band.play();
    } catch (e) {
      warnOnce('record player', e);
    }
  }

  play(): void {
    this.want = true;
    if (!this.chaseActive()) guard('music.play', () => this.band?.play());
  }

  stop(): void {
    this.want = false;
    guard('music.stop', () => this.band?.stop(1.2));
  }

  /** The Chase: dead stop, and it stays off until someone plays it again. */
  cut(): void {
    this.want = false;
    guard('music.cut', () => this.band?.cut());
  }

  /** The engine is shutting down: forget the old context's nodes. */
  detach(): void {
    this.band = null;
    this.chain = null;
  }

  /** play() was called during the Chase: start now. */
  afterChase(): void {
    if (this.want) guard('music.play', () => this.band?.play());
  }

  setTension(t: number): void {
    if (!Number.isFinite(t)) return;
    this.tension = clamp(t, 0, 1);
    this.band?.setTension(this.tension);
  }

  setPosition(p: Vec3): void {
    if (!finite3(p)) return;
    this.pos = copy3(p);
    guard('music.setPosition', () => this.chain?.setPosition(p));
  }

  setMuffle(m: number): void {
    if (!Number.isFinite(m)) return;
    this.muffle = clamp(m, 0, 1);
    guard('music.setMuffle', () => this.chain?.setMuffle(this.muffle));
  }
}
