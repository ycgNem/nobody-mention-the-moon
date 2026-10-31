// Every tunable number lives here (CLAUDE.md). Units: meters, seconds, radians.

export const PLAYER = {
  radius: 0.3,
  /** Half the cylinder part; total capsule height = 2 * (halfHeight + radius) = 1.7 m. */
  halfHeight: 0.55,
  eyeHeight: 1.55,
  crouchEyeHeight: 1.0,
  walkSpeed: 3.2,
  sprintSpeed: 5.4,
  crouchSpeed: 1.6,
  jumpSpeed: 5.2,
  gravity: 18,
  maxFallSpeed: 20,
  stepHeight: 0.25,
  snapToGround: 0.3,
  /** How far you can grab, serve or press things from (eye to target). */
  reach: 2.4,
  /** A held prop sits this far in front of the eyes, and this far below them. */
  holdForward: 0.55,
  holdDown: 0.3,
  /** Throw speed range (m/s) for a tap … a full charge. */
  throwMin: 3,
  throwMax: 11,
  throwChargeSeconds: 0.8,
} as const;

/** Sound through the house (shared/src/house/rooms.ts). Used by voice chat and guest earshot. */
export const SOUND = {
  /** A closed door counts as this many extra meters when finding the quietest route. */
  closedDoorPenalty: 8,
  /** Voice low-pass cutoff by doorways crossed (0, 1, 2, 3+). */
  cutoffPerHop: [20000, 7000, 3000, 1500],
  closedDoorCutoff: 0.16,
  minCutoffHz: 320,
  closedDoorGain: 0.4,
  hopGain: 0.85,
} as const;

/**
 * Dinner rules. Each dinner copies this into its state, so the live tuning panel can change
 * one dinner without touching defaults. Times in seconds; meters are 0–100.
 */
export const SIM = {
  guests: 4,
  bookingSeconds: 10,
  prepSeconds: 120,
  courseSeconds: 180,
  courses: 3,
  dessertSeconds: 60,
  chaseSeconds: 45,

  // Arrivals: the doorbell rings for one guest every `arrivalGap` seconds.
  arrivalGap: 9,
  arrivalsMaxSeconds: 150,
  /** A guest left on the doorstep this long lets themselves in (vampires can't). */
  doorPatience: 18,
  doorLeftCost: 4,
  thresholdDamagePerBeat: 6,
  /** Front door to a standing spot. The game host sets it from the house's route and guestWalkSpeed. */
  walkInSeconds: 7,
  /** Guests walk in at this pace (m/s) in every house. */
  guestWalkSpeed: 1.6,
  /** A guest left standing this long picks a seat for themselves. */
  seatPatience: 16,

  // More players: beats come faster and guests get hungrier (per extra player).
  beatScalePerPlayer: 0.06,
  hungerScalePerPlayer: 0.12,

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
  /** Fewer guests than this left (seated or still to arrive) and the party is over: a loss. */
  minGuests: 2,
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
  /** Asked a question with no host in earshot: "Where have our hosts gone?" */
  emptyTableCost: 6,
  burntDishComposure: 4,
  burntHungerDrop: 30,

  // Kitchen (seconds). Food on a hob/oven cooks, then waits, then burns, then catches fire.
  chopStrokes: 4,
  hobSeconds: 9,
  ovenSeconds: 13,
  burnAfter: 14,
  fireAfter: 10,
  /** Every beat the smoke alarm screams, every guest at the table loses this much. */
  alarmDamagePerBeat: 7,
  /** A plate left at a guest's place disappears after this long. */
  plateLingerSeconds: 20,

  // Events (the deck: content/events.ts)
  neighborStaySeconds: 60,
  eventsMin: 2,
  eventsMax: 4,
  /** Toast: speak this long (voice activity, or typed words) before the timer runs out. */
  toastSeconds: 25,
  toastNeedSeconds: 10,
  /** Typed toasts: seconds of speech each typed word counts for. */
  toastSecondsPerWord: 0.6,
  toastCoverBonus: 8,
  toastComposureBonus: 15,
  toastFailCost: 6,
  powerCutSeconds: 45,
  stormSeconds: 90,
  lightningChancePerBeat: 0.35,
  gustChancePerBeat: 0.3,
  lightningDamage: 10,
  dogTableDamage: 6,
  dogTableCost: 2,
  dogCalmBonus: 6,
  spillDamage: 5,
  spillCost: 1,
  pizzaDoorSeconds: 25,
  pizzaTipBonus: 3,
  pizzaWanderCost: 6,
  pizzaInsideSeconds: 40,
  hunterTrickEveryBeats: 3,
  hunterTrickDamage: 14,
  hunterSuspicionPerSlip: 45,
  hunterSuspicionPerTrigger: 6,
  hunterVolunteerBonus: 4,
  charadesGuessPerBeat: 28,
  charadesTurns: 4,
  charadesInterruptDrop: 60,
  lateGuestMinSeconds: 30,

  // Occasions and relationships
  relationshipsMax: 3,
  exesDamagePerBeat: 3,
  exesRomanceDamage: 18,
  siblingsFamilyExtraLife: 2,
  rivalsPull: 3,
  crushHealPerBeat: 3,
  owesMoneyWorkDamage: 8,
  honoreeSwing: 2,
  bookStreakGoal: 6,
  bookPull: 2,

  // Quirks and guest mechanics
  soreDamagePerBeat: 4,
  favorBeats: 3,
  favorDoneBonus: 12,
  nameTakenCost: 5,
  complimentBonus: 10,
  copyEveryBeats: 3,
  glassesOffSeconds: 6,
  stoneSeconds: 15,
  steamGlassesChance: 0.5,
  draftDamagePerBeat: 5,
  dishLoveBonus: 18,
  partChance: 0.3,
  partsInViewCost: 3,
  reattachBonus: 6,

  /** Guests hear a player within this many meters along an open route (rooms.ts). */
  earshotMeters: 6,
  /** In the dark, guests still see what's this close to them. */
  darkSightMeters: 1.2,
};

export type SimTuning = typeof SIM;

/** The First Shift tutorial (M8): a short, gentle dinner. Applied on top of SIM by createDinner. */
export const TUTORIAL = {
  guests: 2,
  /** A starter and a pudding (the last course is always pudding, and dessert serves it). */
  courses: 2,
  prepSeconds: 75,
  courseSeconds: 90,
  dessertSeconds: 30,
  /** The one event: the moon rises this many seconds into the course. */
  moonriseAt: 40,
  beatMultiplier: 1.5,
  questionMultiplier: 2,
  hungerMultiplier: 0.5,
} as const;

/** On-device keyword spotting (M5, docs/spikes/M5-keyword-spotting.md). Client-only. */
export const SPEECH = {
  /** Vosk word confidence below this is ignored ('confirmed' mode). */
  minConfidence: 0.7,
  /** The same word again within this window counts once. */
  debounceMs: 1500,
  /** 'confirmed' waits for Vosk's final result (~0.5–0.8 s) but almost never misfires. */
  mode: 'confirmed' as 'confirmed' | 'fast',
} as const;

/** What the HUD and guest tags show. Client-only, never read by the rules. */
export const HUD = {
  /** Hunger at which a guest's 🍖 icon (and the First Shift's feeding tip) appears. */
  hungryShownAt: 70,
} as const;

export const NET = {
  port: 2567,
  /** Client → server movement updates per second. */
  sendRateHz: 20,
  /** Server accepts this much more distance than walking speed allows, to absorb jitter. */
  speedTolerance: 1.5,
  /** If the server's position differs from the client's by more than this, the client snaps. */
  correctionSnapDistance: 0.75,
  /** Remote players, guests and props are drawn this far behind the newest snapshot. */
  interpolationDelayMs: 100,
  maxPlayers: 6,
  /** Server game loop rate (physics, kitchen; the dinner rules step at 10 Hz inside it). */
  tickHz: 30,
  /** State patches sent to clients per second. */
  patchRateHz: 20,
  /** A dropped player's seat is held this long. */
  reconnectSeconds: 60,
} as const;
