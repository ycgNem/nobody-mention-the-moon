// A synthetic talker for dev and tests: a buzzy vowel that "talks" in syllables, delivered as a
// MediaStream like a real mic. Never silent, so level checks don't depend on timing.

export interface FakeVoice {
  stream: MediaStream;
  stop(): void;
}

export function createFakeVoice(ctx: AudioContext): FakeVoice {
  const out = new MediaStreamAudioDestinationNode(ctx, { channelCount: 1 });
  const voice = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 140 });
  const vibrato = new OscillatorNode(ctx, { type: 'sine', frequency: 5 });
  const vibratoDepth = new GainNode(ctx, { gain: 8 });
  const formant = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 900, Q: 1.2 });
  // Syllables: amplitude swings 0.1..1 a few times a second.
  const syllables = new GainNode(ctx, { gain: 0.55 });
  const syllableLfo = new OscillatorNode(ctx, { type: 'sine', frequency: 3.5 });
  const syllableDepth = new GainNode(ctx, { gain: 0.45 });
  const level = new GainNode(ctx, { gain: 0.5 });

  vibrato.connect(vibratoDepth).connect(voice.frequency);
  syllableLfo.connect(syllableDepth).connect(syllables.gain);
  voice.connect(formant).connect(syllables).connect(level).connect(out);

  const oscillators = [voice, vibrato, syllableLfo];
  for (const o of oscillators) o.start();
  return {
    stream: out.stream,
    stop() {
      for (const o of oscillators) o.stop();
      for (const n of [...oscillators, vibratoDepth, formant, syllables, syllableDepth, level]) {
        n.disconnect();
      }
      for (const t of out.stream.getTracks()) t.stop();
    },
  };
}
