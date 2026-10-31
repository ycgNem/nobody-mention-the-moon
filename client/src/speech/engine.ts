// The contract between KeywordSpotter and a speech engine. Engines live in their own modules
// (vosk-engine.ts, webspeech-engine.ts) and are only loaded by dynamic import.

import type { Token } from './matcher.ts';

/**
 * 'confirmed': report a word once the recognizer has scored or committed it (~0.4–0.7 s after
 * it's said with Vosk, false triggers rare). 'fast': report it from the first partial guess
 * (~0.1–0.3 s, more false triggers, no confidence). See docs/spikes/M5-keyword-spotting.md.
 */
export type SpotterMode = 'confirmed' | 'fast';

/** What an engine reports: its current guess at the utterance, and whether it's settled. */
export interface Hypothesis {
  tokens: Token[];
  /** true: the utterance is over and won't be revised; the next hypothesis starts a new one. */
  final: boolean;
  /** true: token confidences are real scores, not a placeholder 1. */
  scored: boolean;
}

export interface EngineSink {
  hypothesis(h: Hypothesis): void;
  /** Mic level 0..1, about ten times a second. */
  level(level: number): void;
  /** The engine stopped working after it had started. */
  fail(message: string): void;
}

export interface EngineConfig {
  /** One spelling per phrase to listen for (homophones collapsed). */
  listenFor: readonly string[];
  /** Every spelling that counts; engines must not use these as decoys. */
  reserved: readonly string[];
  modelUrl: string;
  mode: SpotterMode;
}

export interface SpeechEngine {
  /** Resolves once listening; rejects with a readable Error if the engine can't run. */
  start(stream: MediaStream): Promise<void>;
  stop(): void;
}

export type EngineFactory = (config: EngineConfig, sink: EngineSink) => SpeechEngine;
