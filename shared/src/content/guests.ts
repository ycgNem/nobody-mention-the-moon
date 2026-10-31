// Guest types (docs/GUESTS.md). Players never see these directly; they learn them from tells.
// Tells use they/them: disguises are random and we never assume a guest's pronouns.

import type { DishTag } from './dishes.ts';
import type { TopicTag } from './topics.ts';

export type GuestTypeId = 'werewolf' | 'vampire' | 'ghost';

export interface GuestTypeDef {
  id: GuestTypeId;
  label: string;
  likes: readonly TopicTag[];
  triggers: readonly TopicTag[];
  /** Heard within earshot → Composure hit. Lower-case; phrases allowed. */
  words: readonly string[];
  /** Dish tags they eat (Hunger drops). Empty = can't eat at all. */
  eats: readonly DishTag[];
  /** Eats it, but it barely counts (werewolf vs well-done). */
  meh: readonly DishTag[];
  /** Dish tags that hurt when served. */
  hurtBy: readonly DishTag[];
  /** Hunger multiplier; 0 = never hungry. */
  hunger: number;
  /** Can't take a topic until someone addresses them (vampire). */
  needsAddressing: boolean;
  moonSensitive: boolean;
  mirrorSensitive: boolean;
  /** Being served real food reminds them of something (ghost). */
  servingReminds: boolean;
  tells: {
    topic: readonly string[];
    word: readonly string[];
    dish: readonly string[];
    room: readonly string[];
    happy: readonly string[];
    hungry: readonly string[];
  };
  slip: string;
  revealColor: string;
}

export const GUEST_TYPES: Record<GuestTypeId, GuestTypeDef> = {
  werewolf: {
    id: 'werewolf',
    label: 'Werewolf',
    likes: ['food', 'family', 'travel'],
    triggers: ['pets', 'night'],
    words: ['moon', 'dog', 'dogs', 'puppy', 'full'],
    eats: ['raw', 'meat'],
    meh: ['well-done'],
    hurtBy: [],
    hunger: 1.3,
    needsAddressing: false,
    moonSensitive: true,
    mirrorSensitive: false,
    servingReminds: false,
    tells: {
      topic: ['*scratches behind their ear*', '*a low growl under the murmur*', '*sniffs the air*'],
      word: ['*ears twitch*', '*grips the table edge*', '*a sharp intake of breath*'],
      dish: ['*sniffs it, unimpressed*'],
      room: ['*stares at the window, very still*', '*fur bristles at the cuffs*'],
      happy: ['*laughs a bit too loudly*', '*tears into it with their hands*'],
      hungry: ['*licks their lips at the person beside them*'],
    },
    slip: 'Fur bursts out of their collar and they HOWL.',
    revealColor: '#8a6a4a',
  },
  vampire: {
    id: 'vampire',
    label: 'Vampire',
    likes: ['night', 'travel', 'romance'],
    triggers: ['weather', 'health'],
    words: ['garlic', 'sun', 'sunny', 'sunshine', 'stake', 'steak', 'cross'],
    eats: ['wine'],
    meh: [],
    hurtBy: ['garlic'],
    hunger: 0.8,
    needsAddressing: true,
    moonSensitive: false,
    mirrorSensitive: true,
    servingReminds: false,
    tells: {
      topic: ['*flinches*', '*pulls their collar up*', '*very interested in their napkin*'],
      word: ['*hisses, then coughs to cover it*', '*goes even paler*'],
      dish: ['*recoils from the plate*', '*pushes it away with one fingertip*'],
      room: ['*keeps glancing at the mirror*', '*shifts their chair out of the mirror\'s view*'],
      happy: ['*smiles without showing teeth*', '*swirls the glass appreciatively*'],
      hungry: ['*stares at their neighbor\'s neck*'],
    },
    slip: 'Fangs out, cape flare, and a bat bursts from their sleeve.',
    revealColor: '#5b2a4a',
  },
  ghost: {
    id: 'ghost',
    label: 'Ghost',
    likes: ['home', 'family', 'hobbies', 'romance'],
    triggers: ['childhood', 'health'],
    words: ['dead', 'died', 'death', 'funeral', 'ghost', 'haunted'],
    eats: [],
    meh: [],
    hurtBy: [],
    hunger: 0,
    needsAddressing: false,
    moonSensitive: false,
    mirrorSensitive: false,
    servingReminds: true,
    tells: {
      topic: ['*the cutlery near them starts to float*', '*the candles lean away*', '*frost creeps over their glass*'],
      word: ['*flickers, just for a second*', '*a cold draft rolls across the table*'],
      dish: ['*the fork passes straight through the food*', '*"Oh, I\'m never hungry!"*'],
      room: ['*glows faintly in the dark*'],
      happy: ['*hums an old tune*', '*beams, slightly see-through*'],
      hungry: [],
    },
    slip: 'They go fully see-through and every plate on the table floats.',
    revealColor: '#9fc6d6',
  },
};

export const GUEST_TYPE_IDS = Object.keys(GUEST_TYPES) as GuestTypeId[];

/** Said near any guest, these make the hosts sound very human. */
export const EXPOSURE_WORDS = ['human', 'normal', 'mortgage', 'taxes', 'gym', 'sunscreen', 'dentist'] as const;

export const DISGUISE_NAMES = [
  'Mortimer',
  'Beatrix',
  'Cornelius',
  'Delphine',
  'Ambrose',
  'Wilhelmina',
  'Percival',
  'Ottoline',
  'Bartholomew',
  'Clementine',
  'Ignatius',
  'Rosalind',
] as const;

export const DISGUISE_COLORS = ['#6b4c7a', '#3f6b5c', '#8a5a3b', '#4a5d8a', '#7a3f3f', '#5c5c5c', '#8a7a3f', '#3f5c6b'] as const;
