// The local microphone (real or synthetic): the track peers receive, plus level and voice activity.

import { LevelMeter, createAnalyser } from './meter.ts';
import { Vad } from './Vad.ts';

export class LocalMic {
  /** The capture stream as the browser processed it (echo cancellation, noise suppression, AGC). */
  stream: MediaStream | null = null;
  /** A clone of the capture track that every peer connection sends; disabled while not transmitting. */
  sendTrack: MediaStreamTrack | null = null;
  vadActive = false;
  private source: MediaStreamAudioSourceNode | null = null;
  private stopSynth: (() => void) | null = null;
  private readonly meter: LevelMeter;
  private readonly vad = new Vad();

  /** `onEnded` fires when the device goes away (unplugged, revoked), not on release(). */
  constructor(
    private readonly ctx: AudioContext,
    private readonly onEnded: () => void,
  ) {
    this.meter = new LevelMeter(createAnalyser(ctx));
  }

  get on(): boolean {
    return this.sendTrack !== null;
  }

  /** Raw mic level, 0..1, whether or not we're transmitting. */
  get level(): number {
    return this.meter.level;
  }

  /** Takes over `stream`. `stopSynth` tears down whatever generated it (fake mic). */
  use(stream: MediaStream, stopSynth: (() => void) | null = null): boolean {
    this.release();
    const track = stream.getAudioTracks()[0];
    if (!track) {
      for (const t of stream.getTracks()) t.stop();
      stopSynth?.();
      return false;
    }
    this.stream = stream;
    this.stopSynth = stopSynth;
    this.sendTrack = track.clone();
    this.sendTrack.enabled = false;
    track.addEventListener('ended', this.handleEnded);
    this.source = new MediaStreamAudioSourceNode(this.ctx, { mediaStream: stream });
    this.source.connect(this.meter.analyser);
    return true;
  }

  setTransmitting(on: boolean): void {
    if (this.sendTrack) this.sendTrack.enabled = on;
  }

  sample(dtMs: number): void {
    if (!this.on) return;
    this.meter.sample(dtMs / 1000);
    this.vadActive = this.vad.update(this.meter.db, dtMs);
  }

  release(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        t.removeEventListener('ended', this.handleEnded);
        t.stop();
      }
    }
    this.sendTrack?.stop();
    this.source?.disconnect();
    this.stopSynth?.();
    this.stream = null;
    this.sendTrack = null;
    this.source = null;
    this.stopSynth = null;
    this.meter.reset();
    this.vad.reset();
    this.vadActive = false;
  }

  private readonly handleEnded = (): void => {
    this.release();
    this.onEnded();
  };
}
