// Names in humanoid.glb (blender/assets/characters/humanoid.py) that code relies on.
// A typo here is a type error instead of a T-posing guest.

export const CLIPS = [
  'idle',
  'walk',
  'run',
  'crouch',
  'stand_wait',
  'sit_idle',
  'sit_talk',
  'sit_eat',
  'sit_flinch',
  'slip',
  'carry',
  'hold_up',
  'wave',
] as const;
export type ClipName = (typeof CLIPS)[number];

/** One-shot clips: play once and hold the last frame (the caller then returns to a loop). */
export const ONE_SHOT_CLIPS: readonly ClipName[] = ['sit_flinch', 'slip'];

export const OUTFIT_MESHES = { suit: 'outfit_suit', dress: 'outfit_dress', cardigan: 'outfit_cardigan', host: 'host_shirt' } as const;
export const HAIR_MESHES = { short: 'hair_short', long: 'hair_long', bun: 'hair_bun', slick: 'hair_slick' } as const;
export const ACCESSORY_MESHES = {
  glasses: 'acc_glasses',
  sunglasses: 'acc_sunglasses',
  moustache: 'acc_moustache',
  monocle: 'acc_monocle',
  bowtie: 'acc_bowtie',
  pearls: 'acc_pearls',
  scarf: 'acc_scarf',
} as const;
export const SLIP_MESHES = [
  'slip_fur', // werewolf
  'slip_fangs', // vampire
  'slip_cape', // vampire
  'slip_eyes', // werewolf, gorgon, shapeshifter
  'slip_wings', // fae: gauzy wings from the shoulder blades
  'slip_snakes', // gorgon: hair becomes snakes
  'slip_bandages', // mummy: wrappings unravelling from sleeves and collar
  'slip_rot', // zombie: grey-green patches, a loose jaw
  'slip_melt', // shapeshifter: the face slides, features doubled
] as const;
export type SlipMesh = (typeof SLIP_MESHES)[number];
/** Every optional part; the client hides all of them, then shows what a look asks for. */
export const OPTIONAL_MESHES = [
  ...Object.values(OUTFIT_MESHES),
  ...Object.values(HAIR_MESHES),
  ...Object.values(ACCESSORY_MESHES),
  ...SLIP_MESHES,
  'apron',
] as const;
