// All game audio, synthesized with the Web Audio API: no audio files, nothing downloaded.
// See engine.ts for the AudioEngine, sfx.ts for the effects, murmur.ts for guest babble and
// music.ts for the record player and the Chase loop. selftest.ts renders it all offline.

export { AudioEngine } from './engine.ts';
export type { Murmur, RecordPlayer, SourceOpts, SpatialInput } from './engine.ts';
export type { MurmurMood } from './murmur.ts';
export { SFX_NAMES } from './sfx.ts';
export type { SfxName } from './sfx.ts';
export { muffleCutoff, muffleGain } from './dsp.ts';
export type { BusName, Vec3 } from './dsp.ts';
