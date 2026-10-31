import { describe, expect, it } from 'vitest';
import {
  Debouncer,
  PhraseMatcher,
  UtteranceTracker,
  normalizePhrase,
  toTokens,
  tokenize,
  type Token,
} from './matcher.ts';

const VOCAB = [
  'moon',
  'dog',
  'full',
  'garlic',
  'sun',
  'stake',
  'steak',
  'come in',
  'thank you',
  'thanks',
  'my mum',
];
const phrases = (m: PhraseMatcher, text: string) => m.matchText(text).map((h) => h.phrase);

describe('tokenize', () => {
  it('lower-cases and strips punctuation', () => {
    expect(tokenize('The MOON, tonight!')).toEqual(['the', 'moon', 'tonight']);
  });

  it('splits hyphens and drops possessives', () => {
    expect(tokenize("Thank-you for the moon's light")).toEqual([
      'thank',
      'you',
      'for',
      'the',
      'moon',
      'light',
    ]);
    expect(tokenize('moon’s')).toEqual(['moon']);
  });

  it('keeps contractions and strips accents', () => {
    expect(tokenize("don't café")).toEqual(["don't", 'cafe']);
  });

  it('turns engine placeholders into a token that never matches', () => {
    const toks = tokenize('come [unk] in');
    expect(toks).toHaveLength(3);
    expect(toks[1]).not.toBe('unk');
  });

  it('normalizes vocabulary entries the same way', () => {
    expect(normalizePhrase('  Come-In! ')).toBe('come in');
  });
});

describe('PhraseMatcher', () => {
  const m = new PhraseMatcher(VOCAB);

  it('matches single words on word boundaries only', () => {
    expect(phrases(m, 'look at the moon')).toEqual(['moon']);
    expect(phrases(m, 'honeymoon moonlight sundae')).toEqual([]);
  });

  it('matches multi-word phrases', () => {
    expect(phrases(m, 'oh do come in please')).toEqual(['come in']);
    expect(phrases(m, 'come and sit in')).toEqual([]);
    expect(phrases(m, 'Thank you so much, thanks!')).toEqual(['thank you', 'thanks']);
  });

  it('does not join words across an unknown token', () => {
    expect(phrases(m, 'come [unk] in')).toEqual([]);
  });

  it('reports every occurrence in order', () => {
    const hits = m.matchText('moon dog moon');
    expect(hits.map((h) => [h.phrase, h.start, h.end])).toEqual([
      ['moon', 0, 1],
      ['dog', 1, 2],
      ['moon', 2, 3],
    ]);
  });

  it('prefers the longest phrase and never overlaps', () => {
    const m2 = new PhraseMatcher(['full', 'moon', 'full moon']);
    expect(phrases(m2, 'a full moon rising')).toEqual(['full moon']);
    expect(phrases(m2, "I'm so full")).toEqual(['full']);
    const m3 = new PhraseMatcher(['full', 'moon']);
    expect(phrases(m3, 'a full moon rising')).toEqual(['full', 'moon']);
  });

  it('counts homophones as each other, preferring the exact spelling', () => {
    expect(phrases(m, 'a nice steak')).toEqual(['steak']);
    expect(phrases(m, 'a wooden stake')).toEqual(['stake']);
    const onlyStake = new PhraseMatcher(['stake']);
    expect(phrases(onlyStake, 'medium rare steak')).toEqual(['stake']);
    const onlySteak = new PhraseMatcher(['steak']);
    expect(phrases(onlySteak, 'a wooden stake')).toEqual(['steak']);
  });

  it('gives engines one spelling per homophone group, and lists every spelling', () => {
    const onlyStake = new PhraseMatcher(['stake', 'Come In', 'come in']);
    expect(onlyStake.phrases).toEqual(['stake', 'come in']);
    expect(onlyStake.listenFor).toEqual(['stake', 'come in']);
    expect([...onlyStake.spellings].sort()).toEqual(['come in', 'stake', 'steak']);
    const both = new PhraseMatcher(['steak', 'stake', 'moon']);
    expect(both.listenFor).toEqual(['stake', 'moon']);
    // The engine hears the collapsed spelling; the matcher still reports a vocabulary entry.
    expect(phrases(new PhraseMatcher(['steak']), 'stake')).toEqual(['steak']);
  });

  it('gives homophone spellings the same key', () => {
    expect(m.matchText('steak stake').map((h) => h.key)).toEqual(['stake', 'stake']);
    expect(m.matchText('come in')[0]!.key).toBe('come in');
  });

  it('accepts custom homophone groups, including none', () => {
    const none = new PhraseMatcher(['stake'], []);
    expect(phrases(none, 'steak')).toEqual([]);
    const sun = new PhraseMatcher(['sun'], [['sun', 'son']]);
    expect(phrases(sun, 'my son')).toEqual(['sun']);
  });

  it('uses the lowest token confidence and the last token time', () => {
    const toks: Token[] = [
      { text: 'come', conf: 0.9, t: 100 },
      { text: 'in', conf: 0.6, t: 300 },
    ];
    expect(m.match(toks)).toEqual([
      { phrase: 'come in', key: 'come in', start: 0, end: 2, conf: 0.6, t: 300 },
    ]);
  });

  it('handles a vocabulary of ~60 entries without fuss', () => {
    const big = new PhraseMatcher([
      ...VOCAB,
      ...Array.from({ length: 50 }, (_, i) => `word${i}`),
      'who are you',
      'be yourself',
    ]);
    expect(phrases(big, 'so who are you really, word7? be yourself')).toEqual([
      'who are you',
      'word7',
      'be yourself',
    ]);
  });
});

describe('toTokens', () => {
  it('splits engine words and keeps their scores', () => {
    expect(toTokens([{ text: 'Thank-you', conf: 0.5, t: 10 }])).toEqual([
      { text: 'thank', conf: 0.5, t: 10 },
      { text: 'you', conf: 0.5, t: 10 },
    ]);
  });
});

describe('UtteranceTracker', () => {
  const m = new PhraseMatcher(VOCAB);

  it('reports each spoken hit once while the engine revises the utterance', () => {
    const tr = new UtteranceTracker();
    const seen: string[] = [];
    for (const partial of ['the', 'the full', 'the full moon', 'a full moon', 'a full moon full']) {
      for (const { hit, id } of tr.fresh(m.matchText(partial))) {
        tr.mark(id);
        seen.push(hit.phrase);
      }
    }
    expect(seen).toEqual(['full', 'moon', 'full']);
  });

  it('treats a homophone flip in a revision as the same hit', () => {
    const tr = new UtteranceTracker();
    const seen: string[] = [];
    for (const partial of ['a steak', 'a stake', 'a stake please']) {
      for (const { hit, id } of tr.fresh(m.matchText(partial))) {
        tr.mark(id);
        seen.push(hit.phrase);
      }
    }
    expect(seen).toEqual(['steak']);
  });

  it('starts fresh after reset', () => {
    const tr = new UtteranceTracker();
    const first = tr.fresh(m.matchText('moon'));
    first.forEach((f) => tr.mark(f.id));
    expect(tr.fresh(m.matchText('moon'))).toHaveLength(0);
    tr.reset();
    expect(tr.fresh(m.matchText('moon'))).toHaveLength(1);
  });

  it('does not remember hits that were not marked', () => {
    const tr = new UtteranceTracker();
    expect(tr.fresh(m.matchText('garlic'))).toHaveLength(1);
    expect(tr.fresh(m.matchText('garlic'))).toHaveLength(1);
  });
});

describe('Debouncer', () => {
  it('ignores the same word inside the window, per word', () => {
    const d = new Debouncer(1000);
    expect(d.accept('moon', 0)).toBe(true);
    expect(d.accept('moon', 500)).toBe(false);
    expect(d.accept('dog', 500)).toBe(true);
    expect(d.accept('moon', 1000)).toBe(true);
    expect(d.accept('moon', 1999)).toBe(false);
  });

  it('a zero window lets everything through', () => {
    const d = new Debouncer(0);
    expect(d.accept('moon', 0)).toBe(true);
    expect(d.accept('moon', 0)).toBe(true);
  });
});
