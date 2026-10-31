// M1 has no kitchen: dishes are served from a menu, each with a prep cooldown.

export type DishTag = 'garlic' | 'raw' | 'meat' | 'well-done' | 'veg' | 'sweet' | 'wine' | 'nothing';

export interface DishDef {
  id: string;
  label: string;
  tags: readonly DishTag[];
  /** Seconds before this dish can be served again (stands in for cooking until M2). */
  prep: number;
}

export const DISHES = [
  { id: 'garlic_bread', label: 'Garlic bread', tags: ['garlic', 'veg'], prep: 12 },
  { id: 'tartare', label: 'Steak tartare', tags: ['raw', 'meat'], prep: 20 },
  { id: 'steak', label: 'Well-done steak', tags: ['meat', 'well-done'], prep: 18 },
  { id: 'salad', label: 'Salad', tags: ['veg'], prep: 8 },
  { id: 'red_wine', label: '"Red wine"', tags: ['wine'], prep: 25 },
  { id: 'empty_plate', label: 'An empty plate', tags: ['nothing'], prep: 4 },
] as const satisfies readonly DishDef[];

export type DishId = (typeof DISHES)[number]['id'];

export function dishById(id: string): DishDef {
  const d = DISHES.find((x) => x.id === id);
  if (!d) throw new Error(`unknown dish ${id}`);
  return d;
}
