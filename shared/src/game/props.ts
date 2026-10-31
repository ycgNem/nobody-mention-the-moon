// Loose physics props: what they look like (model in client/public/models), their collision
// shape, and whether holding one up changes the subject at the table.

import type { PropTopicId } from '../content/topics.ts';
import type { PropKind } from './types.ts';

export interface PropDef {
  /** glb name (models/<model>.glb); food uses its dish's look from food.glb instead. */
  model: string;
  /** Box half extents (x, y, z), meters. The shape's base sits on the prop's origin. */
  half: [number, number, number];
  mass: number;
  /** Holding it up where the table can see changes the subject to this. */
  topic: PropTopicId | null;
  /** Layout socket it starts on (`socket_prop_<home>`), if it has one. */
  home: string | null;
}

export const PROPS: Record<PropKind, PropDef> = {
  food: { model: 'plate', half: [0.1, 0.05, 0.1], mass: 0.5, topic: null, home: null },
  plate: { model: 'plate', half: [0.13, 0.03, 0.13], mass: 0.6, topic: null, home: null },
  bottle: { model: 'wine_bottle', half: [0.04, 0.16, 0.04], mass: 1.0, topic: 'wine_bottle', home: null },
  painting: { model: 'painting', half: [0.25, 0.2, 0.025], mass: 1.5, topic: 'painting', home: 'prop_painting' },
  candelabra: { model: 'candelabra', half: [0.12, 0.18, 0.06], mass: 1.2, topic: 'candelabra', home: 'prop_candelabra' },
  snow_globe: { model: 'snow_globe', half: [0.06, 0.075, 0.06], mass: 0.6, topic: 'snow_globe', home: 'prop_snow_globe' },
  photo_frame: { model: 'photo_frame', half: [0.09, 0.11, 0.03], mass: 0.4, topic: 'photo_frame', home: 'prop_photo_frame' },
  record: { model: 'record', half: [0.155, 0.155, 0.01], mass: 0.3, topic: 'record', home: 'prop_record' },
  pot: { model: 'pot', half: [0.14, 0.08, 0.14], mass: 1.5, topic: null, home: 'prop_pot' },
  pan: { model: 'pan', half: [0.13, 0.03, 0.2], mass: 1.2, topic: null, home: 'prop_pan' },
  tea_towel: { model: 'tea_towel', half: [0.15, 0.01, 0.1], mass: 0.1, topic: null, home: 'prop_tea_towel' },
  dog: { model: 'dog', half: [0.15, 0.22, 0.3], mass: 8, topic: null, home: null },
  part: { model: '', half: [0.04, 0.03, 0.04], mass: 0.1, topic: null, home: null },
};

/** Props placed around the house when a dinner starts. */
export const HOUSE_PROPS: readonly PropKind[] = ['painting', 'candelabra', 'snow_globe', 'photo_frame', 'record', 'pot', 'pan', 'tea_towel'];

/** Food mesh (food.glb) for a dish after `stage` steps, or the burnt lump. */
export function foodLook(looks: readonly string[], stage: number, burnt: boolean): string | null {
  if (burnt) return 'food_burnt';
  if (looks.length === 0) return null;
  return looks[Math.min(stage, looks.length - 1)] ?? null;
}
