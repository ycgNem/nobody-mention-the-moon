// Dishes and their recipes (docs/GUESTS.md "Dishes"). Ingredients come out of the fridge (or the
// cellar, or the plate stack), go through 2–3 steps at the stations, and are plated at the pass.
// Dish tags decide who will eat a dish and who it upsets.

export type DishTag =
  | 'garlic'
  | 'raw'
  | 'meat'
  | 'well-done'
  | 'veg'
  | 'sweet'
  | 'wine'
  | 'nothing'
  | 'salty'
  | 'blessed'
  | 'iron'
  | 'silver'
  | 'dry'
  | 'burnt';

export type Station = 'chop' | 'hob' | 'oven';
export type DishSource = 'fridge' | 'cellar' | 'plates';
export type Course = 'starter' | 'main' | 'pudding' | 'any';

export interface DishDef {
  id: string;
  label: string;
  tags: readonly DishTag[];
  /** Stations in order. Plating at the pass comes after the last one (except bottles). */
  steps: readonly Station[];
  /** Food mesh (food.glb) after 0, 1, … steps. Length = steps.length + 1. */
  looks: readonly string[];
  source: DishSource;
  course: Course;
  /** Served as it comes (the wine bottle), not on a plate. */
  bottle?: boolean;
}

export const DISHES = [
  { id: 'garlic_bread', label: 'Garlic bread', tags: ['garlic', 'veg'], steps: ['chop', 'oven'], looks: ['food_loaf', 'food_bread_slices', 'food_bread_slices'], source: 'fridge', course: 'starter' },
  { id: 'salad', label: 'Salad', tags: ['veg'], steps: ['chop'], looks: ['food_lettuce', 'food_salad'], source: 'fridge', course: 'starter' },
  { id: 'oysters', label: 'Oysters', tags: ['raw', 'salty'], steps: [], looks: ['food_oysters'], source: 'fridge', course: 'starter' },
  { id: 'holy_olives', label: 'Holy-water-brined olives', tags: ['blessed', 'salty'], steps: [], looks: ['food_olives'], source: 'fridge', course: 'starter' },
  { id: 'leek_soup', label: 'Leek soup', tags: ['veg', 'salty'], steps: ['chop', 'hob'], looks: ['food_leeks', 'food_leeks_chopped', 'food_soup'], source: 'fridge', course: 'starter' },
  { id: 'canapes', label: 'Canapés on the silver platter', tags: ['silver', 'salty', 'meat'], steps: [], looks: ['food_canapes'], source: 'fridge', course: 'starter' },
  { id: 'tartare', label: 'Steak tartare', tags: ['raw', 'meat'], steps: ['chop'], looks: ['food_steak_raw', 'food_tartare'], source: 'fridge', course: 'main' },
  { id: 'steak', label: 'Well-done steak', tags: ['meat', 'well-done'], steps: ['hob'], looks: ['food_steak_raw', 'food_steak_cooked'], source: 'fridge', course: 'main' },
  { id: 'roast_chicken', label: 'Roast chicken', tags: ['meat', 'salty'], steps: ['oven'], looks: ['food_chicken_raw', 'food_chicken_roast'], source: 'fridge', course: 'main' },
  { id: 'lamb_chops', label: 'Iron-pan lamb chops', tags: ['meat', 'iron'], steps: ['hob'], looks: ['food_chops_raw', 'food_chops_cooked'], source: 'fridge', course: 'main' },
  { id: 'risotto', label: 'Mushroom risotto', tags: ['veg'], steps: ['chop', 'hob'], looks: ['food_mushrooms', 'food_mushrooms', 'food_risotto'], source: 'fridge', course: 'main' },
  { id: 'jerky', label: 'Dried beef', tags: ['meat', 'dry', 'salty'], steps: [], looks: ['food_jerky'], source: 'fridge', course: 'main' },
  { id: 'honey_cake', label: 'Honey cake', tags: ['sweet'], steps: ['chop', 'oven'], looks: ['food_batter', 'food_batter', 'food_cake'], source: 'fridge', course: 'pudding' },
  { id: 'sorbet', label: 'Blood-orange sorbet', tags: ['sweet'], steps: [], looks: ['food_sorbet'], source: 'fridge', course: 'pudding' },
  { id: 'cheese_board', label: 'Cheese board', tags: ['salty', 'dry'], steps: [], looks: ['food_cheese'], source: 'fridge', course: 'pudding' },
  { id: 'birthday_cake', label: 'Birthday cake', tags: ['sweet'], steps: [], looks: ['food_birthday_cake'], source: 'fridge', course: 'pudding' },
  { id: 'red_wine', label: '"Red wine"', tags: ['wine'], steps: [], looks: [], source: 'cellar', course: 'any', bottle: true },
  { id: 'empty_plate', label: 'An empty plate', tags: ['nothing'], steps: [], looks: [], source: 'plates', course: 'any' },
] as const satisfies readonly DishDef[];

export type DishId = (typeof DISHES)[number]['id'];

const BY_ID = new Map<string, DishDef>(DISHES.map((d) => [d.id, d]));

export function dishById(id: string): DishDef {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`unknown dish ${id}`);
  return d;
}

export function isDish(id: string): boolean {
  return BY_ID.has(id);
}

/** Seconds a station takes to do its step (chopping is strokes, not seconds). */
export function stationSeconds(station: Station, t: { hobSeconds: number; ovenSeconds: number }): number {
  return station === 'hob' ? t.hobSeconds : station === 'oven' ? t.ovenSeconds : 0;
}
