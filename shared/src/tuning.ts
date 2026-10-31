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
