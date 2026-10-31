// Guest types (docs/GUESTS.md). Players never see these directly; they learn them from tells.
// Tells use they/them: disguises are random and we never assume a guest's pronouns.

import type { SlipMesh } from './characters.ts';
import type { DishTag } from './dishes.ts';
import type { QuirkId } from './quirks.ts';
import type { TopicTag } from './topics.ts';

export type GuestTypeId = 'werewolf' | 'vampire' | 'ghost' | 'fae' | 'shapeshifter' | 'gorgon' | 'mummy' | 'zombie';

/**
 * A type's signature rule beyond triggers and food (docs/GUESTS.md):
 * - debt: saying "thank you" near them puts you in their debt (a Favor, or your name is taken)
 * - mirror: every few beats they copy whoever at the table has had the most attention
 * - gaze: if their sunglasses come off, whoever they're looking at turns to stone
 * - draft: an open window (curtains) makes their wrappings flap
 * - looseParts: a Composure hit can knock a body part off onto the floor
 */
export type GuestMechanic = 'none' | 'debt' | 'mirror' | 'gaze' | 'draft' | 'looseParts';

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
  /** Dish tags they adore: a big Composure boost (and an odd tell). */
  loves: readonly DishTag[];
  /** Hunger multiplier; 0 = never hungry. */
  hunger: number;
  /** Can't take a topic until someone addresses them (vampire). */
  needsAddressing: boolean;
  /** Can't cross the front door until a host invites them in (vampire). */
  needsInvite: boolean;
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
  /** humanoid.glb parts shown while their disguise slips. */
  slipKit: readonly SlipPart[];
  /** Ghostly: drawn see-through while slipping. */
  seeThroughSlip: boolean;
  /** Dinner-murmur voice pitch range (audio). */
  murmur: readonly [number, number];
  mechanic: GuestMechanic;
  /** Secondary quirk pool: 1–2 are rolled per guest per dinner. */
  quirks: readonly QuirkId[];
  /** Part of the disguise every one of them wears (gorgons and their sunglasses). */
  accessory?: Accessory;
}

export type SlipPart = SlipMesh;

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
    loves: [],
    hunger: 1.3,
    needsAddressing: false,
    needsInvite: false,
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
    slipKit: ['slip_fur', 'slip_eyes'],
    seeThroughSlip: false,
    murmur: [0.7, 0.95],
    mechanic: 'none',
    quirks: ['silver_shy', 'squirrel', 'big_appetite', 'dog_person'],
  },
  vampire: {
    id: 'vampire',
    label: 'Vampire',
    likes: ['night', 'travel', 'romance'],
    triggers: ['weather', 'health'],
    words: ['garlic', 'sun', 'sunny', 'sunshine', 'stake', 'steak', 'cross'],
    eats: ['wine'],
    meh: [],
    hurtBy: ['garlic', 'blessed'],
    loves: [],
    hunger: 0.8,
    needsAddressing: true,
    needsInvite: true,
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
    slipKit: ['slip_fangs', 'slip_cape', 'slip_eyes'],
    seeThroughSlip: false,
    murmur: [0.85, 1.15],
    mechanic: 'none',
    quirks: ['counting', 'old_soul', 'night_owl'],
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
    loves: [],
    hunger: 0,
    needsAddressing: false,
    needsInvite: false,
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
    slipKit: [],
    seeThroughSlip: true,
    murmur: [1.1, 1.45],
    mechanic: 'none',
    quirks: ['wrong_decade', 'possessive', 'glowy'],
  },
  fae: {
    id: 'fae',
    label: 'Fae',
    likes: ['romance', 'weather', 'hobbies', 'home'],
    triggers: ['religion'],
    words: ['thank you', 'thanks', 'cheers', 'iron'],
    eats: ['sweet', 'veg'],
    meh: [],
    hurtBy: ['iron', 'blessed'],
    loves: ['sweet'],
    hunger: 0.7,
    needsAddressing: false,
    needsInvite: false,
    moonSensitive: false,
    mirrorSensitive: false,
    servingReminds: false,
    tells: {
      topic: ['*the flowers on the table wilt a little*', '*glitter drifts off their sleeve*'],
      word: ['*eyes light up* "Oh? You\'re thankful, are you?"', '*smiles with slightly too many teeth*'],
      dish: ["*won't let the fork touch their lips*", '*counts the cutlery, twice*'],
      room: ['*hums along with something nobody else can hear*'],
      happy: ['*birdsong, from nowhere*', '*licks honey off a finger, delighted*'],
      hungry: ['*eyes the sugar bowl hungrily*'],
    },
    slip: 'The glamour flickers off: wings, far too many teeth and a burst of birdsong.',
    revealColor: '#b7e07a',
    slipKit: ['slip_wings'],
    seeThroughSlip: false,
    murmur: [1.2, 1.5],
    mechanic: 'debt',
    quirks: ['true_name', 'mushrooms'],
  },
  shapeshifter: {
    id: 'shapeshifter',
    label: 'Shapeshifter',
    likes: ['hobbies', 'travel'],
    triggers: ['family'],
    words: ['who are you', 'be yourself', 'the real you', 'identity'],
    eats: ['meat', 'veg'],
    meh: [],
    hurtBy: [],
    loves: [],
    hunger: 1.0,
    needsAddressing: false,
    needsInvite: false,
    moonSensitive: false,
    mirrorSensitive: false,
    servingReminds: false,
    tells: {
      topic: ['*answers half a second after everyone else*', '*eats with the wrong hand*'],
      word: ['*their outfit flickers for a frame*', '*face goes briefly blank*'],
      dish: ['*copies exactly how their neighbor holds the fork*'],
      room: ['*glances at the mirror, then at their copy*'],
      happy: ['*laughs exactly like someone else at the table*'],
      hungry: ["*mimics their neighbor's chewing*"],
    },
    slip: 'They melt into a puddle of everyone they copied tonight.',
    revealColor: '#c9a3d9',
    slipKit: ['slip_melt', 'slip_eyes'],
    seeThroughSlip: false,
    murmur: [0.8, 1.3],
    mechanic: 'mirror',
    quirks: ['starstruck', 'shy'],
  },
  gorgon: {
    id: 'gorgon',
    label: 'Gorgon',
    likes: ['home', 'hobbies', 'travel', 'romance'],
    triggers: ['pets'],
    words: ['look at me', 'stone', 'snake', 'snakes'],
    eats: ['meat'],
    meh: ['raw'],
    hurtBy: [],
    loves: [],
    hunger: 1.0,
    needsAddressing: false,
    needsInvite: false,
    moonSensitive: false,
    mirrorSensitive: true,
    servingReminds: false,
    tells: {
      topic: ['*their hat hisses*', '*refuses to make eye contact*'],
      word: ['*pushes their sunglasses up their nose, fast*', '*something under the hat rustles*'],
      dish: ['*the steam fogs their sunglasses*'],
      room: ['*turns away from the mirror, sharply*'],
      happy: ['*a pleased hiss*', '*the hat wriggles happily*'],
      hungry: ['*glances toward the cellar, where the mousetrap is*'],
    },
    slip: 'The hat bursts open with snakes and the sunglasses slide down…',
    revealColor: '#5f8f4f',
    slipKit: ['slip_snakes', 'slip_eyes'],
    seeThroughSlip: false,
    murmur: [0.9, 1.2],
    mechanic: 'gaze',
    quirks: ['hissing_hat', 'vain'],
    accessory: 'sunglasses',
  },
  mummy: {
    id: 'mummy',
    label: 'Mummy',
    likes: ['travel', 'religion', 'home'],
    triggers: ['weather'],
    words: ['wrap', 'unwind', 'egypt', 'dust', 'pyramid'],
    eats: ['salty', 'dry'],
    meh: ['meat'],
    hurtBy: [],
    loves: ['salty'],
    hunger: 0.6,
    needsAddressing: false,
    needsInvite: false,
    moonSensitive: false,
    mirrorSensitive: false,
    servingReminds: false,
    tells: {
      topic: ['*creaks when they nod*', '*very stiff small talk*'],
      word: ['*a puff of dust from their collar*', '*clutches their sleeve cuff*'],
      dish: ['*leaves a little sand on the plate*'],
      room: ['*a loose strip flaps in the draft*', '*holds their cuffs down against the breeze*'],
      happy: ['*a dry, rattling chuckle*', '*smacks their lips at the salt*'],
      hungry: ['*licks the salt shaker*'],
    },
    slip: 'They start unravelling, bandages snagging on every chair.',
    revealColor: '#d9c89a',
    slipKit: ['slip_bandages'],
    seeThroughSlip: false,
    murmur: [0.75, 1.0],
    mechanic: 'draft',
    quirks: ['creaky', 'dusty'],
  },
  zombie: {
    id: 'zombie',
    label: 'Zombie',
    likes: ['work', 'sports', 'food'],
    triggers: ['health'],
    words: ['brain', 'brains', 'brainstorm', 'head'],
    eats: ['raw', 'meat'],
    meh: ['well-done'],
    hurtBy: [],
    loves: ['raw'],
    hunger: 1.8,
    needsAddressing: false,
    needsInvite: false,
    moonSensitive: false,
    mirrorSensitive: false,
    servingReminds: false,
    tells: {
      topic: ['*"Braaaav… bravo!"*', '*eyes one notch too wide*'],
      word: ['*a long, low moan, turned into a cough*', '*stares at the nearest head*'],
      dish: ['*sniffs it, then shrugs*'],
      room: ['*sways gently in their seat*'],
      happy: ['*"Mmmmm. Meat."*', '*chews with great dedication*'],
      hungry: ["*leans toward their neighbor's head*"],
    },
    slip: 'A full shamble and a moan, arms reaching for the nearest head.',
    revealColor: '#7a8f5a',
    slipKit: ['slip_rot'],
    seeThroughSlip: false,
    murmur: [0.65, 0.9],
    mechanic: 'looseParts',
    quirks: ['butterfingers', 'gym_rat'],
  },
};

export const GUEST_TYPE_IDS = Object.keys(GUEST_TYPES) as GuestTypeId[];

/** Said near any guest, these make the hosts sound very human. */
export const EXPOSURE_WORDS = ['human', 'normal', 'mortgage', 'taxes', 'gym', 'sunscreen', 'dentist', 'my mum'] as const;

/** Said near the door, this invites a waiting guest in (it's how vampires get past the threshold). */
export const INVITE_PHRASES = ['come in', 'come on in', 'please come in', 'do come in'] as const;

// --- Disguises: random per guest, never tied to the monster underneath -----------------------

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
  'Barnaby',
  'Hortense',
  'Leopold',
  'Marguerite',
  'Fitzgerald',
  'Prudence',
  'Thaddeus',
  'Philippa',
  'Augustin',
  'Henrietta',
  'Quentin',
  'Seraphina',
] as const;

export const DISGUISE_COLORS = [
  '#6b4c7a',
  '#3f6b5c',
  '#8a5a3b',
  '#4a5d8a',
  '#7a3f3f',
  '#5c5c5c',
  '#8a7a3f',
  '#3f5c6b',
  '#9a5a7a',
  '#5a7a3f',
  '#2f4f6f',
  '#8a4a2a',
] as const;

export const OUTFITS = ['suit', 'dress', 'cardigan'] as const;
export type Outfit = (typeof OUTFITS)[number];
export const HAIRS = ['short', 'long', 'bun', 'slick'] as const;
export type Hair = (typeof HAIRS)[number];
export const HAIR_COLORS = ['#1e1a1a', '#5a3a22', '#d9b25f', '#a3402a', '#a8a8a8', '#e8e8e8'] as const;
export const SKIN_TONES = ['#f0d2b8', '#e0b48f', '#c99a6e', '#8d5a3b', '#5a3825'] as const;
export const ACCESSORIES = ['glasses', 'sunglasses', 'moustache', 'monocle', 'bowtie', 'pearls', 'scarf'] as const;
export type Accessory = (typeof ACCESSORIES)[number];
export const BODIES = ['average', 'stout', 'tall', 'slim'] as const;
export type Body = (typeof BODIES)[number];

/** How a guest (or a host) looks. Pure data; the client turns it into a dressed humanoid. */
export interface Look {
  outfit: Outfit;
  color: string;
  hair: Hair;
  hairColor: string;
  skin: string;
  accessory: Accessory | null;
  body: Body;
}

// --- Hosts: cosmetics, all available from the start (D-003) -----------------------------------

export const APRONS = ['#2f7f7a', '#c9a227', '#d9665b', '#8f7cc2', '#7fa36b', '#2c3e66', '#9e2f2f', '#e8dcc0'] as const;
export const HATS = ['none', 'chef', 'beret', 'bowler', 'party', 'flatcap', 'top', 'beanie', 'flower'] as const;
export type HatId = (typeof HATS)[number];
