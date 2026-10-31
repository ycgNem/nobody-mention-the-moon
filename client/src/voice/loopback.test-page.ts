// Manual browser check for the voice mesh, not imported by the game. Two meshes in one page,
// signaling through an in-memory relay, each with a fake mic. From the dev server's console:
//   const m = await import('/src/voice/loopback.test-page.ts'); await m.voiceLoopbackTest()

import { LevelMeter, createAnalyser, dbToLevel } from './meter.ts';
import type { VoiceSignal } from './types.ts';
import { VoiceMesh } from './VoiceMesh.ts';

export interface LoopbackResult {
  connected: boolean;
  states: { a: Record<string, string>; b: Record<string, string> };
  contexts: [AudioContextState, AudioContextState];
  /** B's meter on A's voice, and A's on B's (B's mic only starts after connecting). */
  levelAtB: number;
  levelAtA: number;
  /** What B's voice bus carries from A: clear, muted, behind a 400 Hz low-pass. */
  clearLevel: number;
  mutedLevel: number;
  muffledLevel: number;
  /**
   * Bus power above 1 kHz, clear vs muffled (relative dB). Voices keep most of their energy
   * below 500 Hz, so muffling shows here far more than in the broadband level.
   */
  clearHighDb: number;
  muffledHighDb: number;
  /** B's meter on A with A in push-to-talk: key up, then key down. */
  pttUpLevel: number;
  pttDownLevel: number;
  /** A's own VAD while talking, and how many speaking changes it reported. */
  speakingA: boolean;
  speakingChangesA: number;
  ms: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const round = (v: number) => Math.round(v * 1000) / 1000;

interface Bus {
  input: GainNode;
  meter: LevelMeter;
}

/** A voice bus that is metered and pulled by the destination but silent. */
function makeBus(ctx: AudioContext): Bus {
  const input = new GainNode(ctx);
  const analyser = createAnalyser(ctx);
  input
    .connect(analyser)
    .connect(new GainNode(ctx, { gain: 0 }))
    .connect(ctx.destination);
  return { input, meter: new LevelMeter(analyser) };
}

/** Power above 1 kHz in the bus's latest window, in dB. Only meaningful compared to itself. */
function highBandDb(bus: Bus): () => number {
  const an = bus.meter.analyser;
  const spectrum = new Float32Array(an.frequencyBinCount);
  const firstBin = Math.ceil(1000 / (an.context.sampleRate / an.fftSize));
  return () => {
    an.getFloatFrequencyData(spectrum);
    let power = 0;
    for (const db of spectrum.subarray(firstBin)) power += 10 ** (db / 10);
    return 10 * Math.log10(power + 1e-20);
  };
}

/** Max of each probe over `ms`, sampled every 50 ms (or as often as a hidden tab allows). */
async function peak(ms: number, probes: (() => number)[]): Promise<number[]> {
  const best = probes.map(() => -Infinity);
  const end = performance.now() + ms;
  while (performance.now() < end) {
    probes.forEach((p, i) => (best[i] = Math.max(best[i] ?? -Infinity, p())));
    await sleep(50);
  }
  return best.map(round);
}

export async function voiceLoopbackTest(): Promise<LoopbackResult> {
  const t0 = performance.now();
  const ctxA = new AudioContext();
  const ctxB = new AudioContext();
  await Promise.race([Promise.all([ctxA.resume(), ctxB.resume()]), sleep(1500)]);
  const busA = makeBus(ctxA);
  const busB = makeBus(ctxB);

  const meshes = new Map<string, VoiceMesh>();
  const relay = (from: string) => (to: string, signal: VoiceSignal) => {
    const wire = JSON.stringify(signal); // what the server would carry
    setTimeout(() => meshes.get(to)?.handleSignal(from, JSON.parse(wire) as VoiceSignal), 5);
  };
  const a = new VoiceMesh({
    selfId: 'a',
    send: relay('a'),
    iceServers: [],
    context: ctxA,
    output: busA.input,
  });
  const b = new VoiceMesh({
    selfId: 'b',
    send: relay('b'),
    iceServers: [],
    context: ctxB,
    output: busB.input,
  });
  meshes.set('a', a);
  meshes.set('b', b);

  let speakingChangesA = 0;
  a.onSpeakingChange(() => speakingChangesA++);
  // The bus is read unsmoothed, so a muted peer reads 0 rather than the meter's release tail.
  const busLevel = (bus: Bus) => () => {
    bus.meter.sample(0);
    return dbToLevel(bus.meter.db);
  };

  for (const m of [a, b]) {
    m.setMode('open');
    m.setListener([0, 1.5, 0], [0, 0, -1]);
  }
  a.useFakeMic(); // A has a mic from the start; B's arrives after connecting (replaceTrack path)
  a.updatePeer('b', { position: [0.8, 1.5, -1.2], cutoffHz: 20000, gain: 1 });
  b.updatePeer('a', { position: [-0.8, 1.5, -1.2], cutoffHz: 20000, gain: 1 });
  a.setPeers(['a', 'b']);
  b.setPeers(['b', 'a']);

  const deadline = performance.now() + 10_000;
  const bothConnected = () => a.peerStates().b === 'connected' && b.peerStates().a === 'connected';
  while (!bothConnected() && performance.now() < deadline) await sleep(100);
  const connected = bothConnected();
  b.useFakeMic();
  await sleep(800);

  const [levelAtB = 0, levelAtA = 0, clearLevel = 0, clearHighDb = 0] = await peak(2500, [
    () => b.peerLevel('a'),
    () => a.peerLevel('b'),
    busLevel(busB),
    highBandDb(busB),
  ]);
  const speakingA = a.speaking;

  b.setPeerMuted('a', true);
  await sleep(500);
  const [mutedLevel = 0] = await peak(2000, [busLevel(busB)]);
  b.setPeerMuted('a', false);

  b.updatePeer('a', { position: [-0.8, 1.5, -1.2], cutoffHz: 400, gain: 1 });
  await sleep(600);
  const [muffledLevel = 0, muffledHighDb = 0] = await peak(2000, [
    busLevel(busB),
    highBandDb(busB),
  ]);

  a.setMode('ptt');
  a.setTalking(false);
  await sleep(1200); // peerLevel is smoothed (0.15 s release): let it settle
  const [pttUpLevel = 0] = await peak(1500, [() => b.peerLevel('a')]);
  a.setTalking(true);
  await sleep(300);
  const [pttDownLevel = 0] = await peak(1500, [() => b.peerLevel('a')]);

  const result: LoopbackResult = {
    connected,
    states: { a: a.peerStates(), b: b.peerStates() },
    contexts: [ctxA.state, ctxB.state],
    levelAtB,
    levelAtA,
    clearLevel,
    mutedLevel,
    muffledLevel,
    clearHighDb: Math.round(clearHighDb * 10) / 10,
    muffledHighDb: Math.round(muffledHighDb * 10) / 10,
    pttUpLevel,
    pttDownLevel,
    speakingA,
    speakingChangesA,
    ms: Math.round(performance.now() - t0),
  };
  a.dispose();
  b.dispose();
  await Promise.all([ctxA.close(), ctxB.close()]);
  return result;
}
