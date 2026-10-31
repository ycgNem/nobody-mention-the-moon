// Keyword spotting (M5): mic → AudioWorklet (16 kHz mono) → engine in a Web Worker →
// {word, confidence, t} → phrase matcher → debounce → onWord.
//
// D-006: speech never leaves the device. This module never sends anything anywhere. Callers send
// only `{word, t}` from onWord hits; onDebug's partial text is for the local calibration screen
// and must never be networked. The 'webspeech' engine is the exception the player has to opt
// into: engineSupport('webspeech').leavesDevice is true.
//
// This file (and the small matcher) is the only part that should be imported statically. The
// engines, the worklet, the Vosk worker and its WASM all load lazily on start().

import type { EngineFactory, EngineSink, Hypothesis, SpeechEngine, SpotterMode } from './engine.ts';
import {
  Debouncer,
  PhraseMatcher,
  UtteranceTracker,
  toTokens,
  type HomophoneGroups,
} from './matcher.ts';

export { PhraseMatcher, tokenize, DEFAULT_HOMOPHONES, type HomophoneGroups } from './matcher.ts';
export type { SpotterMode } from './engine.ts';

export interface WordHit {
  /** The vocabulary entry heard, normalized ("come in", "steak"). */
  word: string;
  /**
   * 0..1. 'confirmed' + Vosk: the recognizer's lowest per-word confidence in the phrase.
   * 'fast' mode and Web Speech interim results have no score and report 1.
   */
  confidence: number;
  /**
   * performance.now() ms when the phrase was spoken (its last word ended), where the engine gives
   * word timings ('confirmed' + Vosk). Otherwise the time it was detected.
   */
  t: number;
}

export type SpeechEngineId = 'vosk' | 'webspeech';

export interface SpotterOptions {
  /** Lower-case words and short phrases ("come in", "thank you") built from game content. */
  vocabulary: string[];
  engine: SpeechEngineId;
  /** Where the Vosk model archive is served from (e.g. '/speech/vosk-model-small-en-us-0.15.tar.gz'). */
  modelUrl?: string;
  /** Hits scored below this are dropped. Only 'confirmed' mode has scores; spike suggests 0.6. */
  minConfidence?: number; // default from the caller's tuning
  debounceMs?: number; // same word again within this window is ignored
  /** Default 'confirmed'. See SpotterMode. */
  mode?: SpotterMode;
  /** Spellings that count as each other. Defaults to DEFAULT_HOMOPHONES (stake/steak). */
  homophones?: HomophoneGroups;
}

export const DEFAULT_MODEL_URL = `${import.meta.env.BASE_URL}speech/vosk-model-small-en-us-0.15.tar.gz`;
const DEFAULT_DEBOUNCE_MS = 1500;

export type SpotterState = 'off' | 'loading' | 'listening' | 'error';
export interface SpotterDebug {
  partial: string;
  level: number;
}

export class KeywordSpotter {
  private _state: SpotterState = 'off';
  private _error: string | null = null;
  private engine: SpeechEngine | null = null;
  private readonly matcher: PhraseMatcher;
  private readonly tracker = new UtteranceTracker();
  private readonly debouncer: Debouncer;
  private readonly mode: SpotterMode;
  private readonly wordListeners = new Set<(hit: WordHit) => void>();
  private readonly debugListeners = new Set<(d: SpotterDebug) => void>();
  private partial = '';
  private level = 0;
  /** Bumped on every start/stop so a slow start() can tell it was superseded. */
  private generation = 0;

  constructor(private readonly opts: SpotterOptions) {
    this.matcher = new PhraseMatcher(opts.vocabulary, opts.homophones);
    this.debouncer = new Debouncer(opts.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.mode = opts.mode ?? 'confirmed';
  }

  get state(): SpotterState {
    return this._state;
  }

  get error(): string | null {
    return this._error;
  }

  /** The normalized vocabulary (what onWord can report). */
  get vocabulary(): readonly string[] {
    return this.matcher.phrases;
  }

  /** The running engine, for the dev harness (stats). */
  get engineInstance(): SpeechEngine | null {
    return this.engine;
  }

  /**
   * Starts listening to a mic stream (the voice module's processed mic). Resolves when the engine
   * is ready; rejects with a readable message if it can't run. If stop() is called meanwhile, it
   * resolves quietly with the spotter 'off'.
   */
  async start(stream: MediaStream): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    this._state = 'loading';
    this._error = null;
    try {
      const support = engineSupport(this.opts.engine);
      if (!support.ok)
        throw new Error(support.reason ?? 'This speech engine is not supported here.');
      if (this.matcher.phrases.length === 0) throw new Error('The speech vocabulary is empty.');
      if (stream.getAudioTracks().length === 0)
        throw new Error('The mic stream has no audio track.');
      const create = await loadEngine(this.opts.engine);
      if (gen !== this.generation) return;
      const sink: EngineSink = {
        hypothesis: (h) => gen === this.generation && this.onHypothesis(h),
        level: (l) => gen === this.generation && this.onLevel(l),
        fail: (m) => gen === this.generation && this.fail(m),
      };
      const engine = create(
        {
          listenFor: this.matcher.listenFor,
          reserved: this.matcher.spellings,
          modelUrl: this.opts.modelUrl ?? DEFAULT_MODEL_URL,
          mode: this.mode,
        },
        sink,
      );
      this.engine = engine;
      await engine.start(stream);
      if (gen !== this.generation) return;
      this._state = 'listening';
    } catch (err) {
      if (gen !== this.generation) return;
      this.fail(err instanceof Error ? err.message : String(err));
      throw new Error(this._error ?? 'Speech failed to start.', { cause: err });
    }
  }

  stop(): void {
    this.generation++;
    this.engine?.stop();
    this.engine = null;
    this.tracker.reset();
    this.partial = '';
    this.level = 0;
    this._state = 'off';
    this._error = null;
  }

  onWord(cb: (hit: WordHit) => void): () => void {
    this.wordListeners.add(cb);
    return () => this.wordListeners.delete(cb);
  }

  /** For the lobby calibration screen ("say: moon"): the latest partial text and mic level. */
  onDebug(cb: (d: SpotterDebug) => void): () => void {
    this.debugListeners.add(cb);
    return () => this.debugListeners.delete(cb);
  }

  private fail(message: string): void {
    this.engine?.stop();
    this.engine = null;
    this._state = 'error';
    this._error = message;
  }

  private onHypothesis(h: Hypothesis): void {
    const tokens = toTokens(h.tokens);
    const text = tokens.map((t) => t.text).join(' ');
    if (text !== this.partial) {
      this.partial = text;
      this.emitDebug();
    }
    // 'confirmed' only reports what the recognizer has scored or committed to.
    if (this.mode === 'fast' || h.final || h.scored) {
      const now = performance.now();
      const minConf = h.scored ? (this.opts.minConfidence ?? 0) : 0;
      for (const { hit, id } of this.tracker.fresh(this.matcher.match(tokens))) {
        // Not confident yet: leave it unmarked so a later, surer hypothesis can still report it.
        if (hit.conf < minConf) continue;
        this.tracker.mark(id);
        const t = hit.t ?? now;
        if (!this.debouncer.accept(hit.key, t)) continue;
        const out: WordHit = { word: hit.phrase, confidence: hit.conf, t };
        for (const cb of this.wordListeners) cb(out);
      }
    }
    if (h.final) this.tracker.reset();
  }

  private onLevel(level: number): void {
    this.level = level;
    this.emitDebug();
  }

  private emitDebug(): void {
    const d: SpotterDebug = { partial: this.partial, level: this.level };
    for (const cb of this.debugListeners) cb(d);
  }
}

async function loadEngine(id: SpeechEngineId): Promise<EngineFactory> {
  return id === 'vosk'
    ? (await import('./vosk-engine.ts')).createEngine
    : (await import('./webspeech-engine.ts')).createEngine;
}

/** Is this engine usable in this browser at all (feature detection only, no permissions)? */
export function engineSupport(id: SpeechEngineId): {
  ok: boolean;
  reason?: string;
  leavesDevice: boolean;
} {
  const g = globalThis as unknown as Record<string, unknown>;
  const secure = g.isSecureContext === true;
  if (id === 'webspeech') {
    const ok =
      typeof g.SpeechRecognition === 'function' || typeof g.webkitSpeechRecognition === 'function';
    // Even where on-device recognition exists we can't know it's installed without asking,
    // so this engine is always reported as sending audio off the device.
    if (!ok)
      return {
        ok,
        leavesDevice: true,
        reason: "This browser doesn't have Web Speech recognition.",
      };
    if (!secure)
      return {
        ok: false,
        leavesDevice: true,
        reason: 'Speech needs a secure page (https or localhost).',
      };
    return { ok, leavesDevice: true };
  }
  const missing = [
    typeof g.WebAssembly !== 'object' && 'WebAssembly',
    typeof g.Worker !== 'function' && 'Web Workers',
    typeof g.AudioWorkletNode !== 'function' && 'AudioWorklet',
    typeof g.indexedDB !== 'object' && 'IndexedDB',
  ].filter(Boolean);
  if (missing.length > 0)
    return {
      ok: false,
      leavesDevice: false,
      reason: `This browser is missing ${missing.join(', ')}.`,
    };
  if (!secure)
    return {
      ok: false,
      leavesDevice: false,
      reason: 'Speech needs a secure page (https or localhost).',
    };
  return { ok: true, leavesDevice: false };
}
