// Voice and proximity-audio numbers. Client-only (the server never touches audio), so they sit
// next to the voice code rather than in shared/tuning.ts. Units: meters, seconds, dBFS.

export const VOICE = {
  // Distance falloff (PannerNode, inverse model).
  refDistance: 1.2,
  rolloffFactor: 1.2,
  maxDistance: 20,
  /** Low-pass range the room graph may ask for; values outside are clamped. */
  cutoffMinHz: 200,
  cutoffMaxHz: 20000,
  /** setTargetAtTime time constants, so muffling and loudness glide instead of clicking. */
  cutoffGlideSec: 0.08,
  gainGlideSec: 0.05,
  /** Top of the per-player volume slider (1 = as received). */
  maxPeerVolume: 2,

  // Level meters (speaking indicators).
  meterIntervalMs: 25,
  meterFftSize: 1024,
  /** RMS dBFS that maps to level 0 and to level 1. */
  levelFloorDb: -60,
  levelCeilDb: -12,
  levelReleaseSec: 0.15,

  // Voice activity detection on the local mic.
  /** Speech must be this far above the tracked noise floor... */
  vadMarginDb: 10,
  /** ...and above this, so breathing in a silent room doesn't count. */
  vadMinDb: -55,
  vadAttackMs: 40,
  vadReleaseMs: 250,
  vadFloorStartDb: -50,
  vadFloorMinDb: -90,
  vadFloorMaxDb: -30,
  /** The floor falls fast to quiet moments and rises slowly, faster when nobody is talking. */
  vadFloorFallSec: 0.3,
  vadFloorRiseSec: 3,
  vadFloorRiseSpeakingSec: 10,

  // Connection upkeep. Only the offerer (smaller id) restarts a link.
  connectTimeoutMs: 15000,
  disconnectGraceMs: 6000,
  retryBaseMs: 1000,
  retryMaxMs: 15000,
  /** How long an offer from a peer that setPeers doesn't list yet waits for the list to catch up. */
  pendingOfferTtlMs: 20000,
  pendingIceMax: 64,
} as const;
