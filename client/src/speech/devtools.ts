// Dev-only harness for the M5 spike and for checking a real mic. Nothing imports this, so it never
// ships. From the dev server's console:
//
//   const dt = await import('/src/speech/devtools.ts');
//   const stop = await dt.micTest();            // talk; hits are logged with confidence
//   stop();                                     // → { hits }
//   await dt.micTest({ mode: 'fast' });         // compare the low-latency mode
//   await dt.clipTest(['/clips/moon.wav']);     // play WAV clips through the full pipeline
//
// Both use the full spotter (worklet → worker → matcher → debounce), the same path the game uses.

import { KeywordSpotter, type SpeechEngineId, type SpotterOptions, type WordHit } from './index.ts';
import type { VoskStats } from './vosk-engine.ts';

/** Every trigger word and phrase in GDD.md / GUESTS.md today (~45 entries). */
export const SPIKE_VOCABULARY = [
  // werewolf
  'moon', 'dog', 'dogs', 'puppy', 'full',
  // vampire
  'garlic', 'sun', 'sunny', 'sunshine', 'stake', 'steak', 'cross', 'come in',
  // ghost
  'dead', 'died', 'death', 'funeral', 'ghost', 'haunted',
  // fae, doppelganger, gorgon, mummy, zombie
  'thank you', 'thanks', 'who are you', 'be yourself', 'the real you', 'look at me', 'stone', 'snake',
  'wrap', 'unwind', 'egypt', 'dust', 'brain', 'brainstorm', 'head',
  // host-exposure words
  'human', 'normal', 'mortgage', 'taxes', 'gym', 'salad', 'sunscreen', 'dentist', 'my mum',
]; // prettier-ignore

export interface TestOptions extends Partial<SpotterOptions> {
  engine?: SpeechEngineId;
}

function makeSpotter(opts: TestOptions): KeywordSpotter {
  return new KeywordSpotter({
    minConfidence: 0.6,
    debounceMs: 1500,
    ...opts,
    vocabulary: opts.vocabulary ?? SPIKE_VOCABULARY,
    engine: opts.engine ?? 'vosk',
  });
}

/** Listens to the real mic and logs every hit. Returns a stop function. */
export async function micTest(opts: TestOptions = {}): Promise<() => { hits: WordHit[] }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const spotter = makeSpotter(opts);
  const hits: WordHit[] = [];
  spotter.onWord((h) => {
    hits.push(h);
    const lag = Math.round(performance.now() - h.t);
    console.log(
      `[speech] ${h.word}  conf ${h.confidence.toFixed(2)}  reported ${lag} ms after it ended`,
    );
  });
  let last = '';
  spotter.onDebug((d) => {
    if (d.partial !== last) console.debug(`[speech] … ${(last = d.partial)}`);
  });
  const t0 = performance.now();
  await spotter.start(stream);
  console.log(`[speech] listening (${Math.round(performance.now() - t0)} ms to start)`);
  return () => {
    spotter.stop();
    stream.getTracks().forEach((t) => t.stop());
    return { hits };
  };
}

export interface ClipResult {
  url: string;
  /** Hits with `lagMs` = when onWord fired minus when the speech in the clip ended. */
  hits: (WordHit & { firedAt: number; lagMs: number; tErrMs: number })[];
  speechEndMs: number;
  /** Each new partial, with `atMs` relative to the end of the speech in the clip. */
  partials: { text: string; atMs: number }[];
}

/** Loads a WAV padded with silence, and finds where its speech ends. */
async function loadClip(ctx: AudioContext, url: string, leadMs: number, tailMs: number) {
  const decoded = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const lead = Math.round((leadMs / 1000) * ctx.sampleRate);
  const tail = Math.round((tailMs / 1000) * ctx.sampleRate);
  const buf = ctx.createBuffer(1, decoded.length + lead + tail, ctx.sampleRate);
  const src = decoded.getChannelData(0);
  buf.getChannelData(0).set(src, lead);
  // Where the speech ends: last sample above 2% of the peak.
  let peak = 0;
  for (const x of src) peak = Math.max(peak, Math.abs(x));
  let last = src.length - 1;
  while (last > 0 && Math.abs(src[last]!) < peak * 0.02) last--;
  return { buf, speechEndMs: leadMs + (last / ctx.sampleRate) * 1000 };
}

/**
 * Plays each clip through one running spotter (one model load) and reports hits and latency.
 * The engine is warmed up with silence first, as it would be in a dinner.
 */
export async function clipTest(
  urls: string[],
  opts: TestOptions & { leadMs?: number; tailMs?: number } = {},
): Promise<{ initMs: number; results: ClipResult[]; stats: VoskStats | null }> {
  const results: ClipResult[] = [];
  const spotter = makeSpotter(opts);
  // One long-lived "mic" stream that each clip is played into, so the engine stays up between
  // clips, like a mic during a dinner.
  const ctx = new AudioContext();
  if (ctx.state !== 'running') await ctx.resume();
  const mixer = ctx.createMediaStreamDestination();
  let current: ClipResult | null = null;
  let startPerf = 0;
  spotter.onWord((h) => {
    if (!current) return;
    const firedAt = performance.now();
    const endPerf = startPerf + current.speechEndMs;
    current.hits.push({
      ...h,
      firedAt,
      lagMs: Math.round(firedAt - endPerf),
      tErrMs: Math.round(h.t - endPerf),
    });
  });
  spotter.onDebug((d) => {
    if (!current || !d.partial || current.partials.at(-1)?.text === d.partial) return;
    const atMs = Math.round(performance.now() - (startPerf + current.speechEndMs));
    current.partials.push({ text: d.partial, atMs });
  });
  const t0 = performance.now();
  await spotter.start(mixer.stream);
  const initMs = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 500));
  for (const url of urls) {
    const clip = await loadClip(ctx, url, opts.leadMs ?? 500, opts.tailMs ?? 1500);
    const node = ctx.createBufferSource();
    node.buffer = clip.buf;
    node.connect(mixer);
    current = { url, hits: [], speechEndMs: clip.speechEndMs, partials: [] };
    const ended = new Promise((r) => (node.onended = r));
    node.start();
    startPerf = performance.now();
    await ended;
    node.disconnect();
    results.push(current);
    current = null;
  }
  const engine = spotter.engineInstance as { stats?: VoskStats } | null;
  const stats = engine?.stats ? { ...engine.stats } : null;
  spotter.stop();
  void ctx.close();
  return { initMs, results, stats };
}
