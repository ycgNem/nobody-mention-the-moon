// Relationships between guests (docs/GUESTS.md), 0–3 per dinner. Never shown in the UI: players
// read them from tells (glares, nudges, laughs), so each has its own.

export type RelationshipId = 'exes' | 'siblings' | 'rivals' | 'crush' | 'owes_money';

export interface RelationshipDef {
  id: RelationshipId;
  label: string;
  /** a's tells about b. `{b}` is replaced with b's name. */
  tells: readonly string[];
  /** Does it read the same both ways? */
  mutual: boolean;
  weight: number;
}

export const RELATIONSHIPS: Record<RelationshipId, RelationshipDef> = {
  exes: {
    id: 'exes',
    label: 'Exes',
    tells: ['*glares across the table at {b}*', '*very pointedly not looking at {b}*', '*"Oh. {b}. You came."*'],
    mutual: true,
    weight: 2,
  },
  siblings: {
    id: 'siblings',
    label: 'Siblings',
    tells: ['*nudges {b} under the table*', '*"Mum would LOVE this, {b}"*', '*finishes {b}\'s sentence*'],
    mutual: true,
    weight: 2,
  },
  rivals: {
    id: 'rivals',
    label: 'Rivals',
    tells: ['*smirks at {b}*', '*"Isn\'t that right, {b}?"* (it isn\'t)', '*raises a glass at {b}, coldly*'],
    mutual: true,
    weight: 1.5,
  },
  crush: {
    id: 'crush',
    label: 'Crush',
    tells: ['*laughs a little too hard at {b}\'s joke*', '*keeps sneaking glances at {b}*', '*blushes when {b} speaks*'],
    mutual: false,
    weight: 1.5,
  },
  owes_money: {
    id: 'owes_money',
    label: 'Owes Money',
    tells: ['*avoids {b}\'s eye*', '*"About that loan, {b}…"*', '*pats their empty pockets near {b}*'],
    mutual: false,
    weight: 1,
  },
};

export const RELATIONSHIP_IDS = Object.keys(RELATIONSHIPS) as RelationshipId[];
