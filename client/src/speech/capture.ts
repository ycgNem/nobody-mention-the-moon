// Main-thread side of mic capture: MediaStream → AudioWorklet → 16 kHz mono chunks.
// Each chunk carries the performance.now() it arrived at, so engines can turn "sample N" back
// into a wall-clock time for WordHit.t.

import captureWorkletUrl from './capture.worklet.ts?worker&url';
import type { CaptureChunk, CaptureOptions } from './capture.worklet.ts';

export const SPEECH_RATE = 16000;

export interface Capture {
  readonly context: AudioContext;
  stop(): void;
}

export interface CaptureCallbacks {
  /** 16 kHz mono samples in [-1, 1]. `endPerf` ≈ performance.now() of the chunk's last sample. */
  onSamples?(samples: Float32Array, endPerf: number): void;
  onLevel(level: number): void;
}

/** Starts capturing `stream`. `chunkMs` trades latency for message count (100 ms default). */
export async function startCapture(
  stream: MediaStream,
  cb: CaptureCallbacks,
  chunkMs = 100,
): Promise<Capture> {
  if (stream.getAudioTracks().length === 0) throw new Error('The mic stream has no audio track.');
  if (typeof AudioWorkletNode === 'undefined')
    throw new Error('This browser has no AudioWorklet support.');
  const context = new AudioContext({ latencyHint: 'interactive' });
  try {
    await context.audioWorklet.addModule(captureWorkletUrl);
    const opts: CaptureOptions = {
      inputRate: context.sampleRate,
      outputRate: SPEECH_RATE,
      chunkSize: Math.round((SPEECH_RATE * chunkMs) / 1000),
      samples: cb.onSamples !== undefined,
    };
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'moon-speech-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCountMode: 'explicit',
      channelCount: 1,
      processorOptions: opts,
    });
    node.port.onmessage = (e: MessageEvent<CaptureChunk>) => {
      const now = performance.now();
      cb.onLevel(e.data.level);
      if (e.data.samples) cb.onSamples?.(e.data.samples, now);
    };
    source.connect(node);
    // Autoplay rules can leave a new context suspended until a user gesture; the caller starts
    // speech from a click, so this normally resolves at once.
    if (context.state !== 'running') await context.resume();
    return {
      context,
      stop() {
        node.port.onmessage = null;
        source.disconnect();
        void context.close();
      },
    };
  } catch (err) {
    void context.close();
    throw err;
  }
}
