// Secondary quirks (docs/GUESTS.md): 1–2 rolled per guest per dinner from their type's pool.
// Each one is a small, readable twist on the type's rules, with its own tell, so a group that
// knows werewolves cold still meets a werewolf it hasn't seen before. Effects are plain data;
// shared/src/sim/guests.ts applies them.

import type { DishTag } from './dishes.ts';
import type { TopicTag } from './topics.ts';

export type QuirkId =
  | 'silver_shy'
  | 'squirrel'
  | 'big_appetite'
  | 'dog_person'
  | 'counting'
  | 'old_soul'
  | 'night_owl'
  | 'wrong_decade'
  | 'possessive'
  | 'glowy'
  | 'true_name'
  | 'mushrooms'
  | 'starstruck'
  | 'shy'
  | 'hissing_hat'
  | 'vain'
  | 'creaky'
  | 'dusty'
  | 'butterfingers'
  | 'gym_rat';

export interface QuirkDef {
  id: QuirkId;
  label: string;
  /** What players can notice when it matters. */
  tell: string;
  /** Hunger rate multiplier. */
  hungerMult?: number;
  /** Extra topic tags that hurt / that they like. */
  extraTriggers?: readonly TopicTag[];
  extraLikes?: readonly TopicTag[];
  /** Extra dish tags that hurt when served. */
  hurtByDish?: readonly DishTag[];
  /** Composure recovery multiplier while the lights are off (or the power's out). */
  darkRecovery?: number;
  /** The dog getting loose calms them instead of rattling them. */
  dogCalms?: boolean;
  /** Anything thrown across the dining room rattles them. */
  thrownHurts?: boolean;
  /** Visible in the dark: a slip during a power cut is still seen. */
  glowsInDark?: boolean;
  /** Being moved to another seat keeps hurting for this many beats. */
  reseatSoreBeats?: number;
  /** A wine spill locks them counting drops for this many beats (no topics). */
  spillLockBeats?: number;
  /** Shapeshifter: copy the least-attended guest instead of the most. */
  copyLeast?: boolean;
  /** Shapeshifter: copies come faster. */
  copyEveryBeats?: number;
  /** Zombie: chance a Composure hit knocks a part off (instead of the type's default). */
  partChance?: number;
  /** Bonus Composure when a topic they like lands. */
  likeBonus?: number;
  /** Fae: asks every player's name; answering a question while your name is taken hurts more. */
  nameHunter?: boolean;
  /** Topics they start come from the wrong century (a tell; ×1 trigger on travel). */
  oldTopics?: boolean;
  /** Tells fire more often (louder, easier to read). */
  loud?: boolean;
}

export const QUIRKS: Record<QuirkId, QuirkDef> = {
  // Werewolf
  silver_shy: { id: 'silver_shy', label: 'Silver-shy', tell: '*won\'t touch the silver*', hurtByDish: ['silver'] },
  squirrel: { id: 'squirrel', label: 'Squirrel!', tell: '*eyes track the flying bread roll*', thrownHurts: true },
  big_appetite: { id: 'big_appetite', label: 'Big Appetite', tell: '*finishes everything, then eyes the platter*', hungerMult: 1.5 },
  dog_person: { id: 'dog_person', label: 'Dog Person', tell: '*lights up at the sight of the dog*', dogCalms: true },
  // Vampire
  counting: { id: 'counting', label: 'Counting Compulsion', tell: '*can\'t stop counting the drops*', spillLockBeats: 2 },
  old_soul: { id: 'old_soul', label: 'Old Soul', tell: '*"I was born in 1612… ninety… 1990!"*', extraTriggers: ['childhood'] },
  night_owl: { id: 'night_owl', label: 'Night Owl', tell: '*relaxes visibly in the dark*', darkRecovery: 3 },
  // Ghost
  wrong_decade: { id: 'wrong_decade', label: 'Wrong Decade', tell: '*asks after the Queen. Victoria.*', oldTopics: true },
  possessive: { id: 'possessive', label: 'Possessive', tell: '*glares at whoever took "their" chair*', reseatSoreBeats: 4 },
  glowy: { id: 'glowy', label: 'Glowy', tell: '*glows faintly in the dark*', glowsInDark: true },
  // Fae
  true_name: { id: 'true_name', label: 'True Name', tell: '*"And what was your name again? Your FULL name?"*', nameHunter: true },
  mushrooms: { id: 'mushrooms', label: 'Ring of Mushrooms', tell: '*little mushrooms sprout around their chair*', reseatSoreBeats: 3 },
  // Shapeshifter
  starstruck: { id: 'starstruck', label: 'Starstruck', tell: '*copies people faster, almost eagerly*', copyEveryBeats: 2 },
  shy: { id: 'shy', label: 'Shy', tell: '*copies the quietest person at the table*', copyLeast: true },
  // Gorgon
  hissing_hat: { id: 'hissing_hat', label: 'Hissing Hat', tell: '*the hat hisses at every topic*', loud: true },
  vain: { id: 'vain', label: 'Vain', tell: '*preens at every compliment*', extraLikes: ['romance'], likeBonus: 6 },
  // Mummy
  creaky: { id: 'creaky', label: 'Creaky', tell: '*creeeeak* when they shift in their seat', loud: true, reseatSoreBeats: 2 },
  dusty: { id: 'dusty', label: 'Dusty', tell: '*leaves a little sand wherever they sit*', extraTriggers: ['home'] },
  // Zombie
  butterfingers: { id: 'butterfingers', label: 'Butterfingers', tell: '*keeps checking their ears are still on*', partChance: 0.6 },
  gym_rat: { id: 'gym_rat', label: 'Gym Rat', tell: '*flexes. Something creaks.*', extraLikes: ['sports', 'health'], likeBonus: 4 },
};

export function quirkById(id: QuirkId): QuirkDef {
  return QUIRKS[id];
}
