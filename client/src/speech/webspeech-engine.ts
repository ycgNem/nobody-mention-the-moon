// Web Speech API engine. FALLBACK ONLY, behind an explicit opt-in: in Chrome and Edge the audio
// is streamed to Google's / Microsoft's servers (Safari: Apple's), which breaks D-006 unless the
// player chose it. engineSupport('webspeech') reports leavesDevice: true for that reason.
//
// Where the browser offers on-device recognition (`processLocally`, newer Chromium with the
// language pack installed) we ask for it, so the audio stays local when it can. We never install
// the pack ourselves. Only loaded by dynamic import from index.ts.

import { startCapture, type Capture } from './capture.ts';
import type { EngineConfig, EngineFactory, EngineSink, SpeechEngine } from './engine.ts';
import { toTokens } from './matcher.ts';

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  phrases?: unknown;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  /** Newer engines take the track to listen to; older ones ignore it and open the default mic. */
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
  available?(opts: { langs: string[]; processLocally: boolean }): Promise<string>;
}

type PhraseCtor = new (phrase: string, boost: number) => unknown;

export function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = globalThis as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const FATAL: Record<string, string> = {
  'not-allowed': 'Microphone permission was denied for speech recognition.',
  'service-not-allowed': 'The browser refused to run speech recognition here.',
  network: "Web Speech couldn't reach the browser's speech service (it needs to be online).",
  'language-not-supported': "This browser's speech recognition doesn't support English (en-US).",
  'audio-capture': 'Speech recognition could not open the microphone.',
};

export class WebSpeechEngine implements SpeechEngine {
  private rec: SpeechRecognitionLike | null = null;
  private capture: Capture | null = null;
  private stopped = false;
  private track: MediaStreamTrack | null = null;
  private restarts: number[] = [];
  /** True when the browser agreed to recognize on-device for this session. */
  onDevice = false;

  constructor(
    private readonly config: EngineConfig,
    private readonly sink: EngineSink,
  ) {}

  async start(stream: MediaStream): Promise<void> {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) throw new Error('This browser has no Web Speech recognition.');
    this.track = stream.getAudioTracks()[0] ?? null;
    const rec = new Ctor();
    this.rec = rec;
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    await this.preferOnDevice(Ctor, rec);

    // Level meter for the calibration screen. The recognizer does its own capture.
    this.capture = await startCapture(stream, { onLevel: (l) => this.sink.level(l) });

    await new Promise<void>((resolve, reject) => {
      rec.onstart = () => resolve();
      rec.onerror = (e) =>
        reject(new Error(FATAL[e.error] ?? `Speech recognition failed (${e.error}).`));
      this.begin();
    });
    if (this.stopped) throw new Error('Stopped.');
    rec.onerror = (e) => {
      const fatal = FATAL[e.error];
      if (fatal) {
        this.stopped = true;
        this.sink.fail(fatal);
      }
      // 'no-speech' and 'aborted' just end the session; onend restarts it.
    };
    rec.onend = () => {
      if (this.stopped) return;
      // Chromium ends continuous sessions after silence or about a minute; keep going, unless
      // it keeps dying straight away.
      const now = performance.now();
      this.restarts = [...this.restarts.filter((t) => now - t < 10_000), now];
      if (this.restarts.length > 5) {
        this.stopped = true;
        this.sink.fail('Speech recognition keeps stopping. Try the built-in (Vosk) engine.');
        return;
      }
      this.begin();
    };
    rec.onresult = (e) => this.onResult(e);
  }

  stop(): void {
    this.stopped = true;
    if (this.rec) {
      this.rec.onend = null;
      this.rec.onresult = null;
      this.rec.onerror = null;
      this.rec.abort();
    }
    this.rec = null;
    this.capture?.stop();
    this.capture = null;
  }

  private begin(): void {
    try {
      if (this.track) this.rec?.start(this.track);
      else this.rec?.start();
    } catch (err) {
      this.sink.fail(`Speech recognition failed to start: ${(err as Error).message}`);
    }
  }

  private async preferOnDevice(
    Ctor: SpeechRecognitionCtor,
    rec: SpeechRecognitionLike,
  ): Promise<void> {
    if (!Ctor.available || !('processLocally' in rec)) return;
    try {
      const status = await Ctor.available({ langs: ['en-US'], processLocally: true });
      if (status !== 'available') return;
      rec.processLocally = true;
      this.onDevice = true;
      // Contextual biasing towards our words, where supported (on-device only in Chromium).
      const Phrase = (globalThis as unknown as { SpeechRecognitionPhrase?: PhraseCtor })
        .SpeechRecognitionPhrase;
      if (Phrase) rec.phrases = this.config.listenFor.map((p) => new Phrase(p, 5));
    } catch {
      // Feature half-present; fall back to the default (cloud) recognizer the player opted into.
    }
  }

  private onResult(e: SpeechRecognitionEvent): void {
    // Everything from resultIndex on is the still-open part of the session: one hypothesis.
    let final = true;
    let scored = true;
    const words: { text: string; conf: number }[] = [];
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i]!;
      const alt = result[0];
      if (!alt) continue;
      final &&= result.isFinal;
      // Interim results carry no score (Chromium reports 0): a placeholder 1, marked unscored.
      const hasScore = result.isFinal && alt.confidence > 0;
      scored &&= hasScore;
      const conf = hasScore ? alt.confidence : 1;
      for (const w of alt.transcript.split(/\s+/)) if (w) words.push({ text: w, conf });
    }
    // A final result without a score is still committed; 'confirmed' mode accepts it as final.
    this.sink.hypothesis({ tokens: toTokens(words), final, scored: scored && words.length > 0 });
  }
}

export const createEngine: EngineFactory = (config: EngineConfig, sink: EngineSink) =>
  new WebSpeechEngine(config, sink);
