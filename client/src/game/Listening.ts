// Trigger words from your real voice (M5). Runs the keyword spotter on this device's mic; only
// `{word}` ever leaves the tab (D-006), and only while you're talking to the table (push-to-talk
// held, or open mic), so muttering to someone in the room doesn't count against you.

import { SPEECH, speechVocabulary } from '@moon/shared';
import { DEFAULT_MODEL_URL, KeywordSpotter, type SpotterState, type WordHit } from '../speech/index.ts';
import type { VoiceMesh } from '../voice/index.ts';

export class Listening {
  private spotter: KeywordSpotter | null = null;
  private stream: MediaStream | null = null;
  private off: (() => void) | null = null;
  private reported = false;
  /** The last word heard, whether or not you were talking to the table. Stays on this device. */
  private last: { hit: WordHit; at: number } | null = null;

  constructor(
    private readonly onWord: (word: string) => void,
    private readonly onProblem: (message: string) => void,
  ) {}

  get state(): SpotterState {
    return this.spotter?.state ?? 'off';
  }

  /** Call every frame: starts or stops the spotter to match the setting and the mic. */
  update(enabled: boolean, voice: VoiceMesh | null): void {
    const stream = enabled ? (voice?.micStream ?? null) : null;
    if (stream === this.stream) return;
    this.stop();
    this.stream = stream;
    if (!stream || !voice) return;
    const spotter = new KeywordSpotter({
      vocabulary: speechVocabulary(),
      engine: 'vosk',
      modelUrl: DEFAULT_MODEL_URL,
      minConfidence: SPEECH.minConfidence,
      debounceMs: SPEECH.debounceMs,
      mode: SPEECH.mode,
    });
    this.spotter = spotter;
    this.off = spotter.onWord((hit) => {
      this.last = { hit, at: performance.now() };
      if (voice.transmitting) this.onWord(hit.word);
    });
    spotter.start(stream).catch((err: unknown) => {
      if (this.reported) return;
      this.reported = true;
      this.onProblem(`Trigger-word listening is off: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** For the settings check: is it listening, and what did it last hear? */
  describe(enabled: boolean): string {
    if (!enabled) return 'Turn on "Listen for trigger words" first.';
    if (!this.spotter) return 'Waiting for the microphone (hold V once, or pick open mic).';
    if (this.state !== 'listening') return `Speech model: ${this.state}…`;
    if (!this.last) return 'Listening. Say "moon" and press the check again.';
    const ago = Math.round((performance.now() - this.last.at) / 1000);
    return `Heard "${this.last.hit.word}" (${Math.round(this.last.hit.confidence * 100)}% sure) ${ago}s ago.`;
  }

  stop(): void {
    this.off?.();
    this.off = null;
    this.spotter?.stop();
    this.spotter = null;
    this.stream = null;
  }
}
