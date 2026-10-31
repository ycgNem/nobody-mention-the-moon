// Pure phrase matching for keyword spotting (M5). No DOM, no audio: give it transcripts, get
// vocabulary hits back. The speech engines feed it; the tests drive it directly.
//
// Matching is on whole tokens after normalization, longest phrase first, left to right, with no
// overlaps: "full moon" in the vocabulary wins over "full" + "moon" for the same words.

/** One spoken token, with what the engine knows about it. */
export interface Token {
  text: string;
  /** 0..1. Engines without per-word scores pass 1. */
  conf: number;
  /** performance.now() ms when the token ended, when the engine can tell. */
  t?: number;
}

export interface PhraseMatch {
  /** The vocabulary entry, exactly as normalized from the vocabulary (e.g. "come in"). */
  phrase: string;
  /** Same for every homophone spelling of the phrase ("steak" and "stake" share one). */
  key: string;
  /** Token span [start, end). */
  start: number;
  end: number;
  /** Lowest token confidence in the span. */
  conf: number;
  /** End time of the last token in the span, if known. */
  t?: number;
}

/** Spellings that should count as each other ("steak" said near the vampire is a stake). */
export type HomophoneGroups = readonly (readonly string[])[];

export const DEFAULT_HOMOPHONES: HomophoneGroups = [['stake', 'steak']];

/** Placeholder for anything the engine couldn't place ("[unk]", "<noise>"). Never matches. */
const UNKNOWN = '\u0000';

/** Lower-cases, strips accents and punctuation, splits hyphenated words, drops possessive 's. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const cleaned = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`]/g, "'");
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue;
    if (/^[[<].*[\]>]$/.test(raw)) {
      out.push(UNKNOWN);
      continue;
    }
    for (const part of raw.split(/[-_/]+/)) {
      let w = part.replace(/[^a-z0-9']+/g, '').replace(/^'+|'+$/g, '');
      if (w.endsWith("'s")) w = w.slice(0, -2);
      if (w) out.push(w);
    }
  }
  return out;
}

/** Normalizes one vocabulary entry to its canonical spelling ("Thank-You!" → "thank you"). */
export function normalizePhrase(phrase: string): string {
  return tokenize(phrase)
    .filter((w) => w !== UNKNOWN)
    .join(' ');
}

interface TrieNode {
  next: Map<string, TrieNode>;
  /** Vocabulary phrases that end here, in vocabulary order (several when homophones collide). */
  phrases: { phrase: string; words: string[] }[];
}

export class PhraseMatcher {
  /** Normalized, de-duplicated vocabulary. */
  readonly phrases: readonly string[];
  /**
   * What an engine should listen for: one spelling per phrase, homophones collapsed ("steak"
   * and "stake" become "stake"). They sound the same, and giving a recognizer both would only
   * split its confidence between them.
   */
  readonly listenFor: readonly string[];
  /** Every spelling that counts, homophones included. Never use these as decoys. */
  readonly spellings: readonly string[];
  private readonly canon = new Map<string, string>();
  private readonly root: TrieNode = { next: new Map(), phrases: [] };

  constructor(vocabulary: readonly string[], homophones: HomophoneGroups = DEFAULT_HOMOPHONES) {
    for (const group of homophones) {
      const words = group.map(normalizePhrase).filter((w) => w && !w.includes(' '));
      const head = words[0];
      if (head) for (const w of words) this.canon.set(w, head);
    }
    const phrases = [...new Set(vocabulary.map(normalizePhrase).filter(Boolean))];
    this.phrases = phrases;
    for (const phrase of phrases) {
      const words = phrase.split(' ');
      let node = this.root;
      for (const w of words) {
        const key = this.key(w);
        let child = node.next.get(key);
        if (!child) node.next.set(key, (child = { next: new Map(), phrases: [] }));
        node = child;
      }
      node.phrases.push({ phrase, words });
    }
    this.listenFor = [...new Set(phrases.map((p) => this.phraseKey(p.split(' '))))];
    const all = new Set<string>();
    for (const phrase of phrases) for (const s of this.variants(phrase.split(' '))) all.add(s);
    this.spellings = [...all];
  }

  /** Matches tokenized speech. Unknown tokens break phrases ("come [unk] in" is not "come in"). */
  match(tokens: readonly Token[]): PhraseMatch[] {
    const hits: PhraseMatch[] = [];
    let i = 0;
    while (i < tokens.length) {
      let node: TrieNode | undefined = this.root;
      let best: { end: number; node: TrieNode } | null = null;
      for (let j = i; j < tokens.length && node; j++) {
        const tok = tokens[j]!.text;
        node = tok === UNKNOWN ? undefined : node.next.get(this.key(tok));
        if (node && node.phrases.length > 0) best = { end: j + 1, node };
      }
      if (!best) {
        i++;
        continue;
      }
      const span = tokens.slice(i, best.end);
      // Prefer the entry spelled exactly as heard; otherwise the first in vocabulary order.
      const exact = best.node.phrases.find((p) => p.words.every((w, k) => w === span[k]!.text));
      const entry = exact ?? best.node.phrases[0]!;
      const last = span[span.length - 1]!;
      const hit: PhraseMatch = {
        phrase: entry.phrase,
        key: this.phraseKey(entry.words),
        start: i,
        end: best.end,
        conf: Math.min(...span.map((s) => s.conf)),
      };
      if (last.t !== undefined) hit.t = last.t;
      hits.push(hit);
      i = best.end;
    }
    return hits;
  }

  /** Convenience for plain text (typed chat, tests): every token gets confidence 1. */
  matchText(text: string): PhraseMatch[] {
    return this.match(tokenize(text).map((w) => ({ text: w, conf: 1 })));
  }

  private key(word: string): string {
    return this.canon.get(word) ?? word;
  }

  private phraseKey(words: readonly string[]): string {
    return words.map((w) => this.key(w)).join(' ');
  }

  private variants(words: readonly string[]): string[] {
    let acc = [''];
    for (const w of words) {
      const head = this.key(w);
      const alts = [...this.canon].filter(([, h]) => h === head).map(([v]) => v);
      const options = alts.length > 0 ? alts : [w];
      acc = acc.flatMap((prefix) => options.map((o) => (prefix ? `${prefix} ${o}` : o)));
    }
    return acc;
  }
}

/** Turns engine words into matcher tokens, splitting "thank-you" style words and keeping scores. */
export function toTokens(words: readonly Token[]): Token[] {
  const out: Token[] = [];
  for (const w of words) {
    for (const text of tokenize(w.text)) {
      const tok: Token = { text, conf: w.conf };
      if (w.t !== undefined) tok.t = w.t;
      out.push(tok);
    }
  }
  return out;
}

/**
 * Streaming engines keep revising the current utterance ("the" → "the full" → "the full moon").
 * This remembers which hits of the current utterance were already reported, so a word is
 * reported once per time it is said. Identity is (phrase key, nth occurrence in the utterance),
 * which survives the engine rewriting earlier words or flipping "steak" to "stake".
 */
export class UtteranceTracker {
  private readonly seen = new Set<string>();

  /** Hits of this hypothesis not reported yet. Call `mark` for the ones you report. */
  fresh(hits: readonly PhraseMatch[]): { hit: PhraseMatch; id: string }[] {
    const counts = new Map<string, number>();
    const out: { hit: PhraseMatch; id: string }[] = [];
    for (const hit of hits) {
      const n = counts.get(hit.key) ?? 0;
      counts.set(hit.key, n + 1);
      const id = `${hit.key}#${n}`;
      if (!this.seen.has(id)) out.push({ hit, id });
    }
    return out;
  }

  mark(id: string): void {
    this.seen.add(id);
  }

  /** The engine closed the utterance; the next one starts fresh. */
  reset(): void {
    this.seen.clear();
  }
}

/** The same word again within `windowMs` is ignored. Times are performance.now() ms. */
export class Debouncer {
  private readonly last = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  accept(word: string, t: number): boolean {
    const prev = this.last.get(word);
    if (prev !== undefined && Math.abs(t - prev) < this.windowMs) return false;
    this.last.set(word, t);
    return true;
  }

  clear(): void {
    this.last.clear();
  }
}
