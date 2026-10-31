// Vosk (Kaldi compiled to WASM) in a Web Worker. The recognizer's grammar is restricted to the
// game vocabulary, a list of decoy words (decoys.ts) and "[unk]". Only loaded by dynamic import
// from index.ts.
//
// We talk to the worker shipped by @lichess-org/vosk-browser directly over its message protocol
// instead of using the package's VoskClient, because VoskClient never settles when the model
// fails to load. Nothing here touches the network except fetching the model and the WASM from
// our own origin; audio and transcripts stay inside this tab.

import voskWorkerUrl from '@lichess-org/vosk-browser/dist/vosk.worker.js?url';
import voskWasmUrl from '@lichess-org/vosk-browser/dist/vosk.wasm?url';
import type { ClientMessage, ServerMessage } from '@lichess-org/vosk-browser';
import { SPEECH_RATE, startCapture, type Capture } from './capture.ts';
import { VOSK_DECOYS } from './decoys.ts';
import type { EngineConfig, EngineFactory, EngineSink, SpeechEngine } from './engine.ts';
import type { Token } from './matcher.ts';

const MODEL_HELP = 'See docs/spikes/M5-keyword-spotting.md for how to install the speech model.';
/** Audio per message to the worker. 50 ms measured no faster: Kaldi decodes in its own steps. */
const CHUNK_MS = 100;
/** How many recent chunks we remember for mapping audio time back to performance.now(). */
const CLOCK_HISTORY = 600;
let recognizerCount = 0;

interface VoskWord {
  word: string;
  conf: number;
  start: number;
  end: number;
}

/** Engine statistics for the spike and the dev harness. */
export interface VoskStats {
  /** ms from start() to listening (worker boot, WASM, model download/unpack, recognizer). */
  initMs: number;
  chunks: number;
  audioMs: number;
  /** Time the worker spent on audio, measured from post to reply (includes messaging). */
  busyMs: number;
  /** busyMs / audioMs: fraction of one core the recognizer needs. */
  rtf: number;
}

/** The grammar: what to listen for, then decoys that don't collide with any spelling, then [unk]. */
export function voskGrammar(config: Pick<EngineConfig, 'listenFor' | 'reserved'>): string[] {
  const reserved = new Set([...config.reserved, ...config.listenFor]);
  return [...new Set(config.listenFor)].concat(
    VOSK_DECOYS.filter((d) => !reserved.has(d)),
    '[unk]',
  );
}

export class VoskEngine implements SpeechEngine {
  private worker: Worker | null = null;
  private capture: Capture | null = null;
  private readonly recognizerId = `moon-${++recognizerCount}`;
  private samplesSent = 0;
  private readonly clock: { endSample: number; perf: number }[] = [];
  private readonly pending: number[] = [];
  private lastReply = 0;
  private stopped = false;
  private abortLoad: ((err: Error) => void) | null = null;
  readonly stats: VoskStats = { initMs: 0, chunks: 0, audioMs: 0, busyMs: 0, rtf: 0 };

  constructor(
    private readonly config: EngineConfig,
    private readonly sink: EngineSink,
  ) {}

  async start(stream: MediaStream): Promise<void> {
    const t0 = performance.now();
    const modelUrl = new URL(this.config.modelUrl, location.href).href;
    await preflight(modelUrl);
    if (this.stopped) throw new Error('Stopped.');

    const worker = new Worker(voskWorkerUrl, { type: 'module', name: 'moon-vosk' });
    this.worker = worker;
    await new Promise<void>((resolve, reject) => {
      this.abortLoad = reject;
      worker.onerror = (e) =>
        reject(new Error(`Speech worker failed to start: ${e.message || 'unknown error'}`));
      worker.onmessage = (e: MessageEvent<ServerMessage>) => {
        const msg = e.data as ServerMessage | undefined;
        if (!msg) return;
        if (msg.event === 'load') {
          if (msg.result) resolve();
          else reject(new Error(`Speech model failed to load. ${MODEL_HELP}`));
        } else if (msg.event === 'error') {
          reject(new Error(describeLoadError(msg.error, modelUrl)));
        }
      };
      this.post({ action: 'set', key: 'logLevel', value: -1 });
      this.post({ action: 'load', modelUrl, wasmUrl: new URL(voskWasmUrl, location.href).href });
    });
    this.abortLoad = null;
    if (this.stopped) throw new Error('Stopped.');

    worker.onerror = (e) =>
      this.sink.fail(`Speech worker crashed: ${e.message || 'unknown error'}`);
    worker.onmessage = (e: MessageEvent<ServerMessage>) => this.onMessage(e.data);
    this.post({
      action: 'create',
      recognizerId: this.recognizerId,
      sampleRate: SPEECH_RATE,
      grammar: JSON.stringify(voskGrammar(this.config)),
    });
    // Word output gives per-word confidence and timing, but the worker also switches partial
    // results to word mode, and those trail plain partials by about a second. So 'fast' mode
    // goes without and reads the plain partial text.
    if (this.config.mode === 'confirmed') {
      this.post({ action: 'set', recognizerId: this.recognizerId, key: 'words', value: true });
    }

    this.capture = await startCapture(
      stream,
      {
        onLevel: (level) => this.sink.level(level),
        onSamples: (samples, endPerf) => this.send(samples, endPerf),
      },
      CHUNK_MS,
    );
    if (this.stopped) {
      this.capture.stop();
      throw new Error('Stopped.');
    }
    this.stats.initMs = performance.now() - t0;
  }

  stop(): void {
    this.stopped = true;
    this.abortLoad?.(new Error('Stopped.'));
    this.abortLoad = null;
    this.capture?.stop();
    this.capture = null;
    // Terminating the worker frees the whole WASM heap, model included.
    this.worker?.terminate();
    this.worker = null;
  }

  private post(msg: ClientMessage, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  private send(samples: Float32Array, endPerf: number): void {
    // Vosk wants 16-bit PCM range in a float buffer.
    const data = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) data[i] = samples[i]! * 32768;
    this.samplesSent += samples.length;
    this.clock.push({ endSample: this.samplesSent, perf: endPerf });
    if (this.clock.length > CLOCK_HISTORY) this.clock.shift();
    this.pending.push(performance.now());
    this.post(
      { action: 'audioChunk', recognizerId: this.recognizerId, data, sampleRate: SPEECH_RATE },
      [data.buffer],
    );
  }

  private onMessage(msg: ServerMessage | undefined): void {
    // The worker also posts bare messages of its own (no payload); ignore them.
    if (!msg) return;
    if (msg.event === 'error') {
      this.sink.fail(`Speech recognizer error: ${msg.error}`);
      return;
    }
    if (msg.event !== 'partialresult' && msg.event !== 'result') return;
    // One reply per audio chunk.
    const posted = this.pending.shift();
    if (posted !== undefined) {
      const now = performance.now();
      this.stats.busyMs += now - Math.max(posted, this.lastReply);
      this.lastReply = now;
      this.stats.chunks++;
      this.stats.audioMs = (this.samplesSent / SPEECH_RATE) * 1000;
      this.stats.rtf = this.stats.busyMs / Math.max(1, this.stats.audioMs);
    }
    const final = msg.event === 'result';
    const words = (final ? msg.result.result : msg.result.partial_result) as VoskWord[] | undefined;
    if (words) {
      this.sink.hypothesis({ tokens: words.map((w) => this.token(w)), final, scored: true });
    } else {
      const text = final ? msg.result.text : msg.result.partial;
      this.sink.hypothesis({ tokens: textTokens(text), final, scored: false });
    }
  }

  /** Vosk word times are seconds since the recognizer started; map them onto performance.now(). */
  private token(w: VoskWord): Token {
    const endSample = w.end * SPEECH_RATE;
    const rec =
      this.clock.find((c) => c.endSample >= endSample) ?? this.clock[this.clock.length - 1];
    const tok: Token = { text: w.word, conf: w.conf };
    if (rec) tok.t = rec.perf - ((rec.endSample - endSample) / SPEECH_RATE) * 1000;
    return tok;
  }
}

function textTokens(text: string | undefined): Token[] {
  return (text ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ text: w, conf: 1 }));
}

/** Catches a missing model up front, with a readable message, before the worker downloads it. */
async function preflight(modelUrl: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(modelUrl, { method: 'HEAD', cache: 'no-store' });
  } catch {
    // Offline or blocked: the worker may still have the model cached in IndexedDB. Let it try.
    return;
  }
  if (res.status === 404)
    throw new Error(`Speech model not found at ${modelUrl} (HTTP 404). ${MODEL_HELP}`);
  if (!res.ok)
    throw new Error(`Speech model unavailable at ${modelUrl} (HTTP ${res.status}). ${MODEL_HELP}`);
  // Dev servers with an SPA fallback answer missing files with index.html and a 200.
  if ((res.headers.get('content-type') ?? '').includes('text/html')) {
    throw new Error(
      `Speech model not found at ${modelUrl} (the server sent a web page instead). ${MODEL_HELP}`,
    );
  }
}

function describeLoadError(error: string, modelUrl: string): string {
  const status = /status:\s*(\d+)/.exec(error)?.[1];
  if (status === '404') return `Speech model not found at ${modelUrl} (HTTP 404). ${MODEL_HELP}`;
  if (status) return `Speech model unavailable at ${modelUrl} (HTTP ${status}). ${MODEL_HELP}`;
  return `Speech model failed to load (${error || 'unknown error'}). ${MODEL_HELP}`;
}

export const createEngine: EngineFactory = (config: EngineConfig, sink: EngineSink) =>
  new VoskEngine(config, sink);
