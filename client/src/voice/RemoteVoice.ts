// One remote voice in the house: source → low-pass (muffling) → HRTF panner → gain → voice bus.

import { LevelMeter, createAnalyser } from './meter.ts';
import { VOICE } from './tuning.ts';

/** Everything that decides how one peer sounds here. The mesh keeps one per peer id. */
export interface PeerMix {
  x: number;
  y: number;
  z: number;
  cutoffHz: number;
  roomGain: number;
  volume: number;
  muted: boolean;
}

export class RemoteVoice {
  /** Tapped straight off the source: shows they're talking, wherever they are and however loud. */
  readonly meter: LevelMeter;
  private readonly el: HTMLAudioElement;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly filter: BiquadFilterNode;
  private readonly panner: PannerNode;
  private readonly gain: GainNode;
  private cutoff = -1;
  private level = -1;

  constructor(
    private readonly ctx: AudioContext,
    track: MediaStreamTrack,
    output: AudioNode,
  ) {
    const stream = new MediaStream([track]);
    // Chrome only feeds a remote WebRTC stream into Web Audio while a media element is playing
    // it. Muted, so the sound only comes out through the graph below. Held on `this` so it lives.
    this.el = new Audio();
    this.el.muted = true;
    this.el.autoplay = true;
    this.el.setAttribute('playsinline', '');
    this.el.srcObject = stream;
    this.el.play().catch(() => {
      // Muted autoplay is always allowed; if a browser refuses anyway, Web Audio still plays.
    });

    this.source = new MediaStreamAudioSourceNode(ctx, { mediaStream: stream });
    this.filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: this.maxCutoff, Q: 0 });
    this.panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: VOICE.refDistance,
      rolloffFactor: VOICE.rolloffFactor,
      maxDistance: VOICE.maxDistance,
    });
    this.gain = new GainNode(ctx, { gain: 0 });
    this.meter = new LevelMeter(createAnalyser(ctx));
    this.source.connect(this.filter).connect(this.panner).connect(this.gain).connect(output);
    this.source.connect(this.meter.analyser);
  }

  private get maxCutoff(): number {
    return Math.min(VOICE.cutoffMaxHz, this.ctx.sampleRate / 2);
  }

  apply(m: PeerMix): void {
    this.panner.positionX.value = m.x;
    this.panner.positionY.value = m.y;
    this.panner.positionZ.value = m.z;
    const t = this.ctx.currentTime;
    const cutoff = Math.min(this.maxCutoff, Math.max(VOICE.cutoffMinHz, m.cutoffHz));
    if (cutoff !== this.cutoff) {
      this.cutoff = cutoff;
      this.filter.frequency.setTargetAtTime(cutoff, t, VOICE.cutoffGlideSec);
    }
    const level = m.muted ? 0 : Math.min(1, Math.max(0, m.roomGain)) * m.volume;
    if (level !== this.level) {
      this.level = level;
      this.gain.gain.setTargetAtTime(level, t, VOICE.gainGlideSec);
    }
  }

  dispose(): void {
    for (const n of [this.source, this.filter, this.panner, this.gain, this.meter.analyser]) {
      n.disconnect();
    }
    this.el.pause();
    this.el.srcObject = null;
  }
}
