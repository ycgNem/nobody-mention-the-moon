// AudioWorklet: mic → 16 kHz mono chunks for the speech engine, plus an RMS level per chunk.
// Runs on the audio rendering thread, so it only filters, resamples and copies. Bundled on its
// own through `?worker&url` (see capture.ts) and never imported by the main bundle.
//
// Resampling: a 4th-order Butterworth low-pass at 7 kHz (two biquads), then linear interpolation
// at the target rate. Good enough for ASR features, which stop below 8 kHz.

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(
  name: string,
  ctor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

export interface CaptureOptions {
  /** The AudioContext's sample rate. */
  inputRate: number;
  outputRate: number;
  /** Samples per posted chunk at outputRate. */
  chunkSize: number;
  /** false: only post levels (engines that capture audio themselves). */
  samples: boolean;
}

/** Posted to the main thread for every chunk. `samples` is absent in level-only mode. */
export interface CaptureChunk {
  samples?: Float32Array;
  /** RMS of the chunk, 0..1. */
  level: number;
}

class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;

  constructor(rate: number, cutoff: number, q: number) {
    const w = (2 * Math.PI * Math.min(cutoff, rate * 0.45)) / rate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = (1 - cos) / 2 / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = (1 - cos) / 2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  run(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

class CaptureProcessor extends AudioWorkletProcessor {
  private readonly opts: CaptureOptions;
  private readonly step: number;
  private readonly lp1: Biquad;
  private readonly lp2: Biquad;
  private readonly passthrough: boolean;
  /** Position of the next output sample, in input samples relative to `prev`. */
  private pos = 0;
  private prev = 0;
  private buf: Float32Array;
  private fill = 0;
  private sumSq = 0;
  private count = 0;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    this.opts = options.processorOptions as CaptureOptions;
    this.step = this.opts.inputRate / this.opts.outputRate;
    this.passthrough = this.opts.inputRate === this.opts.outputRate;
    // Butterworth Q values for a 4th-order cascade.
    this.lp1 = new Biquad(this.opts.inputRate, 7000, 0.5412);
    this.lp2 = new Biquad(this.opts.inputRate, 7000, 1.3066);
    this.buf = new Float32Array(this.opts.chunkSize);
  }

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const n = channels[0]!.length;
    const inv = 1 / channels.length;
    for (let i = 0; i < n; i++) {
      let x = 0;
      for (const ch of channels) x += ch[i]!;
      x *= inv;
      if (this.passthrough) {
        this.push(x);
        continue;
      }
      x = this.lp2.run(this.lp1.run(x));
      // Emit every output sample that falls between the previous input sample and this one.
      while (this.pos <= 1) {
        this.push(this.prev + (x - this.prev) * this.pos);
        this.pos += this.step;
      }
      this.pos -= 1;
      this.prev = x;
    }
    return true;
  }

  private push(y: number): void {
    this.sumSq += y * y;
    this.count++;
    if (this.opts.samples) this.buf[this.fill] = y;
    if (++this.fill < this.opts.chunkSize) return;
    const msg: CaptureChunk = { level: Math.sqrt(this.sumSq / this.count) };
    if (this.opts.samples) {
      msg.samples = this.buf;
      this.port.postMessage(msg, [this.buf.buffer]);
      this.buf = new Float32Array(this.opts.chunkSize);
    } else {
      this.port.postMessage(msg);
    }
    this.fill = 0;
    this.sumSq = 0;
    this.count = 0;
  }
}

registerProcessor('moon-speech-capture', CaptureProcessor);
