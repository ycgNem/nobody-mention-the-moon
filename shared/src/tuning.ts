// Every tunable number lives here (CLAUDE.md). Units: meters, seconds, radians.

export const PLAYER = {
  radius: 0.3,
  /** Half the cylinder part; total capsule height = 2 * (halfHeight + radius) = 1.7 m. */
  halfHeight: 0.55,
  eyeHeight: 1.55,
  walkSpeed: 3.2,
  sprintSpeed: 5.4,
  gravity: 18,
  maxFallSpeed: 20,
  stepHeight: 0.25,
  snapToGround: 0.3,
} as const;

/**
 * Dinner rules. Each dinner copies this into its state, so the live tuning panel can change
 * one dinner without touching defaults. Times in seconds; meters are 0–100.
 */
export const SIM = {
  guests: 4,
  courseSeconds: 180,
  courses: 3,
  dessertSeconds: 60,

  beatSeconds: 13,
  /** A topic lives this many beats (rolled per topic) before its holder starts a new one. */
  topicLifeMin: 3,
  topicLifeMax: 5,

  // Topic pull: who the topic goes to next.
  pullPerLikedTag: 2,
  pullNeighbor: 1.5,
  pullPreviousHolder: -2,

  // Composure
  composureStart: 85,
  composureRecoveryPerSec: 0.35,
  topicTriggerDamage: 18,
  topicLikeBonus: 5,
  wordDamage: 14,
  dishHurtDamage: 22,
  dishRemindDamage: 10,
  dishLikeBonus: 6,
  moonDamagePerBeat: 14,
  moonDamageGrowth: 6,
  mirrorDamagePerBeat: 6,
  ignoredDamagePerBeat: 4,
  darkDamagePerBeat: 2,
  witnessDamage: 15,
  reseatDamage: 3,

  // Hunger
  hungerStart: 25,
  hungerPerSec: 0.45,
  neighborHungerMultiplier: 1.5,
  eatHungerDrop: 65,
  mehHungerDrop: 20,
  eyeingBeats: 2,

  // Slips
  slipSeconds: 8,
  slipRecoverTo: 30,
  addressedBeats: 3,

  // Cover (team) and strikes
  coverStart: 80,
  coverRecoveryPerSec: 0.08,
  maxStrikes: 3,
  ruleBreakCost: 15,
  exposureWordCost: 10,
  truthCost: 20,
  deflectCost: 5,
  silenceCost: 10,
  contradictionCost: 10,
  reseatCost: 2,
  propRepeatCost: 3,
  neighborLeavesCost: 10,
  neighborShownOutBonus: 8,

  // Questions
  questionEveryBeatsMin: 4,
  questionEveryBeatsMax: 6,
  questionSeconds: 9,
  suspiciousQuestionSeconds: 5,

  // Small Talk
  handSize: 3,
  cardCooldown: 8,

  // Events
  neighborStaySeconds: 60,

  // Earshot for the typed "say" box until the room graph lands (M2).
  earshotMeters: 4.5,
  /** Players this close to a slipping guest block the others' view of it. */
  blockMeters: 1.1,
};

export type SimTuning = typeof SIM;

export const NET = {
  port: 2567,
  /** Client → server movement updates per second. */
  sendRateHz: 20,
  /** Server accepts this much more distance than walking speed allows, to absorb jitter. */
  speedTolerance: 1.5,
  /** If the server's position differs from the client's by more than this, the client snaps. */
  correctionSnapDistance: 0.75,
  /** Remote players are drawn this far behind the newest snapshot for smoothness. */
  interpolationDelayMs: 100,
  maxPlayers: 6,
} as const;
