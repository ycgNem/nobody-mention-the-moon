// Conversation topics. Tags drive where a topic travels (likes) and who it hurts (triggers).

export const TOPIC_TAGS = [
  'family',
  'work',
  'pets',
  'weather',
  'night',
  'food',
  'travel',
  'health',
  'childhood',
  'romance',
  'home',
  'hobbies',
] as const;
export type TopicTag = (typeof TOPIC_TAGS)[number];

/** Icon + color per tag. Icons are never the only signal: the label is always shown too. */
export const TAG_STYLE: Record<TopicTag, { icon: string; color: string }> = {
  family: { icon: '👪', color: '#d9665b' },
  work: { icon: '💼', color: '#8f7cc2' },
  pets: { icon: '🐕', color: '#c9a227' },
  weather: { icon: '☀️', color: '#e8c547' },
  night: { icon: '🌙', color: '#5b6fc2' },
  food: { icon: '🍽️', color: '#7fa36b' },
  travel: { icon: '🧳', color: '#2f7f7a' },
  health: { icon: '🩺', color: '#5bb3c9' },
  childhood: { icon: '🧸', color: '#e38fb5' },
  romance: { icon: '💕', color: '#c94f7c' },
  home: { icon: '🏠', color: '#b0835a' },
  hobbies: { icon: '🎨', color: '#46a07a' },
};

export interface TopicDef {
  id: string;
  label: string;
  tags: readonly TopicTag[];
}

export const TOPICS: readonly TopicDef[] = [
  { id: 'how_know', label: 'So how do you two know each other?', tags: ['romance', 'family'] },
  { id: 'travel', label: 'Been anywhere nice lately?', tags: ['travel'] },
  { id: 'weather', label: 'Lovely weather tonight!', tags: ['weather', 'night'] },
  { id: 'work', label: 'What do you do for work?', tags: ['work'] },
  { id: 'pets', label: 'Any pets?', tags: ['pets', 'home'] },
  { id: 'grew_up', label: 'Where did you grow up?', tags: ['childhood', 'home'] },
  { id: 'food', label: 'Have you tried that new bistro?', tags: ['food'] },
  { id: 'gym', label: "I've been getting into fitness.", tags: ['health', 'hobbies'] },
  { id: 'kids', label: 'How are the little ones?', tags: ['family', 'childhood'] },
  { id: 'garden', label: 'The garden must be lovely at night.', tags: ['home', 'night'] },
  { id: 'dating', label: 'Seeing anyone special?', tags: ['romance'] },
  { id: 'hobby', label: 'Taken up anything new?', tags: ['hobbies'] },
  { id: 'holiday', label: 'Any holiday plans?', tags: ['travel', 'weather'] },
  { id: 'doctor', label: "My doctor says I'm very pale.", tags: ['health'] },
  { id: 'dog_walk', label: 'I walk the dog every evening.', tags: ['pets', 'night'] },
  { id: 'recipes', label: 'Grandma had the best recipes.', tags: ['food', 'family', 'childhood'] },
];

export const PROPS = {
  painting: { label: 'Have you seen this painting?', tags: ['hobbies'] },
  candles: { label: 'Such lovely candlelight.', tags: ['romance', 'night'] },
} as const satisfies Record<string, { label: string; tags: readonly TopicTag[] }>;
export type PropId = keyof typeof PROPS;

export function topicById(id: string): TopicDef {
  const t = TOPICS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown topic ${id}`);
  return t;
}
