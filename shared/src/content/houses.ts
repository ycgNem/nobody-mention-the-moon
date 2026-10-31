// The houses a dinner can happen in (blender/assets/house/*.py). Each is a .glb plus a
// .layout.json with its own rooms, doors and sockets; shared/src/game/houses.test.ts checks every
// one against the contract the game relies on. The lobby picks one, or the dinner seed does.

import { hashPick } from '../rng.ts';

export const HOUSES = {
  house_a: { label: 'The family house', blurb: 'Dining room, kitchen, a garage for the dog and a cellar for the wine.' },
  house_b: { label: 'The city flat', blurb: 'Small and close: the kitchen is three steps from the table, so mind your voice.' },
  house_c: { label: 'The country manor', blurb: 'Big and drafty: the kitchen is a long walk away, and nobody at the table can hear it.' },
} as const;

export type HouseId = keyof typeof HOUSES;
export const HOUSE_IDS = Object.keys(HOUSES) as HouseId[];
/** Where a new room (and the menu screen) starts. */
export const FIRST_HOUSE: HouseId = 'house_a';

/** The lobby's house setting: one house, or let the dinner seed pick. */
export type HouseSetting = HouseId | 'surprise';

export function isHouseId(id: string): id is HouseId {
  return id in HOUSES;
}

/** The house a "surprise me" dinner with this seed happens in, out of the houses available. */
export function pickHouse(seed: string, available: readonly string[] = HOUSE_IDS): string {
  const options = available.filter(isHouseId).sort();
  return options[hashPick(`${seed}/house`, options.length)] ?? available[0] ?? FIRST_HOUSE;
}
