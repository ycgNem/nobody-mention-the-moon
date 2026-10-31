// Offline self-test: renders every sound through the real mixer (buses → compressor → master) with
// an OfflineAudioContext and reports linear peak and RMS levels. In a dev build's console:
//   const m = await import('/src/audio/selftest.ts'); await m.audioSelfTest()
//   await m.audioCpuBench()

import { Kit, SpatialChain, buildMixer, type Mixer, type Vec3 } from './dsp.ts';
import { MurmurVoice, type MurmurMood } from './murmur.ts';
import { ChaseBand, JazzBand } from './music.ts';
import { makeRng, type Rng } from './rng.ts';
import { SFX_NAMES, playSfx, type InternalSfx, type SfxName } from './sfx.ts';

const SR = 48000;
/** About 2.5 m away, front right of a listener at the origin facing −Z. */
const POS: Vec3 = [1.5, 0, -2];
const AUDIBLE_MOODS: readonly MurmurMood[] = [
  'calm',
  'chatty',
  'tense',
  'happy',
  'eating',
  'slipping',
];

interface Level {
  peak: number;
  rms: number;
}

const round = (x: number): number => Math.round(x * 1e4) / 1e4;

function measure(buf: AudioBuffer, seconds: number): Level {
  const n = Math.max(1, Math.min(buf.length, Math.ceil(seconds * buf.sampleRate)));
  let peak = 0;
  let sum = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const x = d[i] ?? 0;
      const a = Math.abs(x);
      if (a > peak) peak = a;
      sum += x * x;
    }
  }
  return { peak, rms: Math.sqrt(sum / (n * buf.numberOfChannels)) };
}

/** Render `seconds` of whatever `build` sets up; levels are measured up to the time it returns. */
async function render(
  seconds: number,
  build: (ctx: OfflineAudioContext, mx: Mixer) => number,
): Promise<Level> {
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(seconds * SR),
    sampleRate: SR,
  });
  const mx = buildMixer(ctx);
  const active = build(ctx, mx);
  const buf = await ctx.startRendering();
  return measure(buf, Math.min(seconds, active));
}

function sfxInto(
  ctx: BaseAudioContext,
  mx: Mixer,
  rng: Rng,
  name: SfxName | InternalSfx,
  pos: Vec3 | undefined,
  muffle: number,
): number {
  const chain = new SpatialChain(ctx, mx.sfx, { position: pos, muffle });
  return playSfx(new Kit(ctx, rng), name, chain.input, 0.01);
}

function murmurInto(
  ctx: BaseAudioContext,
  mx: Mixer,
  rng: Rng,
  mood: MurmurMood,
  pitch: number,
  seconds: number,
  pos: Vec3 = POS,
): MurmurVoice {
  const v = new MurmurVoice(ctx, mx.murmur, pitch, rng, { position: pos });
  v.setMood(mood);
  v.schedule(seconds);
  return v;
}

function jazzInto(
  ctx: BaseAudioContext,
  mx: Mixer,
  rng: Rng,
  tension: number,
  seconds: number,
): JazzBand {
  const chain = new SpatialChain(ctx, mx.music, { position: [3, 1, -4] });
  const band = new JazzBand(ctx, chain.input, rng);
  band.setTension(tension);
  band.play(0, 8); // skip the rhythm-section-only intro so the vibes are heard too
  band.schedule(seconds);
  return band;
}

/**
 * Renders every SfxName, a few seconds of each murmur mood, the record player (calm and tense), the
 * Chase loop and a busy dinner. Returns `<label>.peak` / `<label>.rms` (linear, full scale = 1).
 * Every entry should have rms > 0 and peak < 1.
 */
export async function audioSelfTest(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const rng = makeRng(1234);
  const put = (label: string, l: Level): void => {
    out[`${label}.peak`] = round(l.peak);
    out[`${label}.rms`] = round(l.rms);
  };

  for (const name of SFX_NAMES) {
    const pos = name.startsWith('ui_') ? undefined : POS;
    put(`sfx.${name}`, await render(5, (ctx, mx) => sfxInto(ctx, mx, rng, name, pos, 0)));
  }
  put(
    'sfx.record_scratch',
    await render(2, (ctx, mx) => sfxInto(ctx, mx, rng, 'record_scratch', undefined, 0)),
  );
  for (const m of [0, 0.5, 1]) {
    put(
      `muffle.${m}.doorbell`,
      await render(3, (ctx, mx) => sfxInto(ctx, mx, rng, 'doorbell', POS, m)),
    );
  }

  for (const mood of AUDIBLE_MOODS) {
    put(`murmur.${mood}`, await render(6, (ctx, mx) => (murmurInto(ctx, mx, rng, mood, 1, 6), 6)));
  }
  for (const pitch of [0.7, 1.5]) {
    put(
      `murmur.chatty.pitch${pitch}`,
      await render(4, (ctx, mx) => (murmurInto(ctx, mx, rng, 'chatty', pitch, 4), 4)),
    );
  }
  const silent = await render(3, (ctx, mx) => (murmurInto(ctx, mx, rng, 'silent', 1, 3), 3));
  if (silent.peak > 0) console.warn('[audio selftest] a silent murmur made sound', silent);

  put('music.calm', await render(10, (ctx, mx) => (jazzInto(ctx, mx, rng, 0, 10), 10)));
  put('music.tense', await render(10, (ctx, mx) => (jazzInto(ctx, mx, rng, 1, 10), 10)));
  put(
    'music.chase',
    await render(8, (ctx, mx) => {
      const c = new ChaseBand(ctx, mx.music, rng);
      c.play(0);
      c.schedule(8);
      return 8;
    }),
  );

  // A loud moment: eight guests talking, the record on, and a handful of effects on top.
  put(
    'mix.busy',
    await render(8, (ctx, mx) => {
      const moods: readonly MurmurMood[] = [
        'chatty',
        'happy',
        'chatty',
        'calm',
        'slipping',
        'happy',
        'eating',
        'chatty',
      ];
      moods.forEach((mood, i) => {
        const a = (i / moods.length) * Math.PI * 2;
        murmurInto(ctx, mx, rng, mood, 0.7 + i * 0.1, 8, [
          Math.cos(a) * 1.4,
          0,
          Math.sin(a) * 1.4 - 2,
        ]);
      });
      jazzInto(ctx, mx, rng, 0.6, 8);
      const loud: readonly SfxName[] = [
        'smoke_alarm',
        'strike',
        'thunder',
        'applause',
        'crunch',
        'howl',
        'van_door',
      ];
      loud.forEach((name, i) => {
        const chain = new SpatialChain(ctx, mx.sfx, { position: [0.5, 0, -1.2] });
        playSfx(new Kit(ctx, rng), name, chain.input, 0.3 + i * 0.9);
      });
      return 8;
    }),
  );

  const bad = Object.keys(out).filter(
    (k) =>
      (k.endsWith('.rms') && !((out[k] ?? 0) > 0)) || (k.endsWith('.peak') && (out[k] ?? 1) >= 1),
  );
  if (bad.length > 0) console.warn('[audio selftest] out of range:', bad);
  return out;
}

/**
 * Estimates audio-thread cost: renders `seconds` of a busy dinner (8 HRTF murmurs, the record
 * player at tension 0.5, a positional effect every 0.25 s) offline, scheduling progressively like
 * the live timer does, and compares against an empty graph with the same suspend/resume pattern.
 */
export async function audioCpuBench(seconds = 20): Promise<Record<string, number>> {
  const run = async (busy: boolean): Promise<{ renderMs: number; jsMs: number }> => {
    const ctx = new OfflineAudioContext({
      numberOfChannels: 2,
      length: seconds * SR,
      sampleRate: SR,
    });
    const mx = buildMixer(ctx);
    const rng = makeRng(99);
    const murmurs: MurmurVoice[] = [];
    let band: JazzBand | null = null;
    let jsMs = 0;
    if (busy) {
      const moods: readonly MurmurMood[] = [
        'chatty',
        'happy',
        'calm',
        'chatty',
        'tense',
        'eating',
        'chatty',
        'slipping',
      ];
      moods.forEach((mood, i) => {
        const a = (i / moods.length) * Math.PI * 2;
        const v = new MurmurVoice(ctx, mx.murmur, 0.7 + i * 0.1, rng, {
          position: [Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4 - 3],
        });
        v.setMood(mood);
        murmurs.push(v);
      });
      const chain = new SpatialChain(ctx, mx.music, { position: [3, 1, -4] });
      band = new JazzBand(ctx, chain.input, rng);
      band.setTension(0.5);
      band.play(0, 8);
    }
    let n = 0;
    const tick = (t: number): void => {
      const t0 = performance.now();
      for (const m of murmurs) m.schedule(t + 0.5);
      band?.schedule(t + 0.5);
      if (busy) {
        const name = SFX_NAMES[n++ % SFX_NAMES.length] ?? 'tick';
        const chain = new SpatialChain(ctx, mx.sfx, { position: [rng() * 6 - 3, 0, -rng() * 6] });
        playSfx(new Kit(ctx, rng), name, chain.input, t + 0.01);
      }
      jsMs += performance.now() - t0;
    };
    tick(0);
    for (let t = 0.25; t < seconds - 0.05; t += 0.25) {
      const at = t;
      void ctx.suspend(at).then(() => {
        tick(at);
        return ctx.resume();
      });
    }
    const t0 = performance.now();
    await ctx.startRendering();
    return { renderMs: performance.now() - t0, jsMs };
  };

  const empty = await run(false);
  const busy = await run(true);
  const per10ms = (ms: number): number => round(ms / (seconds * 100));
  return {
    'cpu.empty.renderMs': round(empty.renderMs),
    'cpu.busy.renderMs': round(busy.renderMs),
    'cpu.busy.msPer10msAudio': per10ms(busy.renderMs),
    'cpu.busyMinusEmpty.msPer10msAudio': per10ms(busy.renderMs - empty.renderMs),
    'cpu.busy.realtimeFactor': round((seconds * 1000) / busy.renderMs),
    'cpu.busy.schedulingJsMsPerSecond': round(busy.jsMs / seconds),
  };
}
