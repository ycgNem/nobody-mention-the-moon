import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseLayout } from './layout.ts';
import { minimalLayout } from './layout.test.ts';
import {
  PLAYER_CENTER_OFFSET,
  buildStaticWorld,
  createCharacterController,
  createPlayerBody,
  movePlayer,
} from './physics.ts';

beforeAll(async () => {
  await RAPIER.init();
});

function setup() {
  const world = buildStaticWorld(RAPIER, parseLayout(minimalLayout));
  const cc = createCharacterController(world);
  return { world, cc };
}

const DT = 1 / 60;

describe('player movement', () => {
  it('falls onto the floor and stays there', () => {
    const { world, cc } = setup();
    const body = createPlayerBody(RAPIER, world, [-3, 1, 0]);
    for (let i = 0; i < 120; i++) {
      movePlayer(cc, body, 0, 0, DT);
      world.step();
    }
    expect(body.grounded).toBe(true);
    expect(body.position[1]).toBeCloseTo(PLAYER_CENTER_OFFSET, 1);
  });

  it('cannot walk through the table', () => {
    const { world, cc } = setup();
    const body = createPlayerBody(RAPIER, world, [-3, 0, 0]);
    // Walk +X for 3 s at 3 m/s straight into the table (which spans x = -1..1).
    for (let i = 0; i < 180; i++) {
      movePlayer(cc, body, 3 * DT, 0, DT);
      world.step();
    }
    expect(body.position[0]).toBeLessThan(-1);
    expect(body.position[0]).toBeGreaterThan(-1.5);
  });
});
