// Direct questions guests ask the hosts, and the lies that answer them.
// Every lie adds a Rule to the Rumor Ledger. Some rules restrict the hosts; some are claims
// that only matter if they contradict another claim.

/** Host actions a rule can forbid. They only count when a guest can see you do them. */
export type RuleCheck =
  | 'open_curtains'
  | 'garlic'
  | 'uncover_mirror'
  | 'lights_on'
  | 'talk_pets'
  | 'talk_family'
  | 'play_music'
  | 'open_door';

export interface RuleDef {
  id: string;
  /** What you said. */
  claim: string;
  /** What it means for the team, shown on the ledger. */
  rule: string;
  check: RuleCheck | null;
  contradicts: readonly string[];
}

export const RULES: readonly RuleDef[] = [
  {
    id: 'sleep_days',
    claim: '"We sleep through the day."',
    rule: "Don't open the curtains.",
    check: 'open_curtains',
    contradicts: ['love_brunch'],
  },
  {
    id: 'love_brunch',
    claim: '"Brunch, mostly. We adore brunch."',
    rule: 'You claimed to be up for brunch.',
    check: null,
    contradicts: ['sleep_days', 'no_light'],
  },
  {
    id: 'no_garlic',
    claim: '"Garlic is poison to us too."',
    rule: "Don't touch garlic where guests can see.",
    check: 'garlic',
    contradicts: [],
  },
  {
    id: 'no_reflection',
    claim: '"We don\'t cast reflections."',
    rule: 'Keep the mirror covered.',
    check: 'uncover_mirror',
    contradicts: ['vain'],
  },
  {
    id: 'vain',
    claim: '"Only by candlelight. We\'re terribly vain."',
    rule: 'You claimed to admire yourselves in mirrors.',
    check: null,
    contradicts: ['no_reflection'],
  },
  {
    id: 'no_light',
    claim: '"Bright light hurts our eyes."',
    rule: "Don't turn the lights on.",
    check: 'lights_on',
    contradicts: ['love_brunch'],
  },
  {
    id: 'hate_dogs',
    claim: '"We can\'t stand dogs."',
    rule: "Don't bring up pets.",
    check: 'talk_pets',
    contradicts: ['raven'],
  },
  {
    id: 'raven',
    claim: '"Just a raven. And a few dogs."',
    rule: 'You claimed to keep dogs.',
    check: null,
    contradicts: ['hate_dogs'],
  },
  {
    id: 'no_family',
    claim: '"We don\'t speak of the family."',
    rule: "Don't bring up family.",
    check: 'talk_family',
    contradicts: ['big_family'],
  },
  {
    id: 'big_family',
    claim: '"Oh, hundreds of cousins. All over the world."',
    rule: 'You claimed a huge family.',
    check: null,
    contradicts: ['no_family'],
  },
  {
    id: 'no_music',
    claim: "They say the Hollows can't abide music.",
    rule: "Don't touch the record player where guests can see.",
    check: 'play_music',
    contradicts: [],
  },
  {
    id: 'no_doors',
    claim: 'A Hollow never opens a door for themselves.',
    rule: "Don't open the front door where guests can see.",
    check: 'open_door',
    contradicts: [],
  },
  {
    id: 'never_eat',
    claim: '"We never eat in front of guests."',
    rule: 'You claimed never to eat in company.',
    check: null,
    contradicts: ['love_brunch'],
  },
];

export interface QuestionDef {
  id: string;
  text: string;
  lies: readonly string[];
  truth: string;
}

export const QUESTIONS: readonly QuestionDef[] = [
  {
    id: 'daytime',
    text: 'So what do you do during the day?',
    lies: ['sleep_days', 'love_brunch', 'no_light'],
    truth: '"I work in accounting."',
  },
  {
    id: 'not_eating',
    text: "You're not eating?",
    lies: ['never_eat', 'no_garlic', 'vain'],
    truth: '"I had a big lunch."',
  },
  {
    id: 'grew_up',
    text: 'Where did your family come from, originally?',
    lies: ['no_family', 'big_family', 'sleep_days'],
    truth: '"Leeds."',
  },
  {
    id: 'mirror',
    text: 'You always look so put-together. What\'s the secret?',
    lies: ['no_reflection', 'vain', 'no_light'],
    truth: '"Moisturiser."',
  },
  {
    id: 'pets',
    text: 'Do you keep any animals?',
    lies: ['hate_dogs', 'raven', 'big_family'],
    truth: '"A goldfish called Kevin."',
  },
  {
    id: 'weekend',
    text: 'Any plans for the weekend?',
    lies: ['love_brunch', 'sleep_days', 'no_garlic'],
    truth: '"Probably the gym."',
  },
];

export function ruleById(id: string): RuleDef {
  const r = RULES.find((x) => x.id === id);
  if (!r) throw new Error(`unknown rule ${id}`);
  return r;
}

export function questionById(id: string): QuestionDef {
  const q = QUESTIONS.find((x) => x.id === id);
  if (!q) throw new Error(`unknown question ${id}`);
  return q;
}
