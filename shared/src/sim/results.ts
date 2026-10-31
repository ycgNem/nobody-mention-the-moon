// The end of a dinner (GDD §8): tips, the party grade, a one-line review, awards and the
// incident reel. Nothing here is saved anywhere: it's for laughing at and screenshotting.

import { GUEST_TYPES } from '../content/guests.ts';
import type { ObjectiveId } from '../content/occasions.ts';
import type { Award, DinnerResult, DinnerState, PlayerStats, SimEvent, SimPlayer } from './types.ts';

const STAR_WORDS = ['Zero stars', 'One star', 'Two stars', 'Three stars', 'Four stars', 'Five stars'];

const OBJECTIVE_PRAISE: Record<ObjectiveId, string> = {
  birthday_cake: 'The cake was a triumph.',
  book_streak: 'Finally, a book club that discussed the book.',
  family_toasts: 'Both families toasted the happy couple.',
  keep_secret: 'What a surprise!',
  exes_apart: 'Seating plan: inspired.',
  hunter_fooled: 'The magician was a bit odd.',
};
const OBJECTIVE_GRUMBLE: Record<ObjectiveId, string> = {
  birthday_cake: 'Nobody sang.',
  book_streak: 'Nobody had read the book.',
  family_toasts: 'The wedding is off.',
  keep_secret: 'The guest of honor has had quite a shock.',
  exes_apart: 'Who seated the exes together?',
  hunter_fooled: 'The magician asked a lot of questions.',
};

interface AwardDef {
  id: string;
  title: string;
  /** Higher is better; awards go to the top player when the best score is above zero. */
  score(p: SimPlayer, state: DinnerState): number;
  why(n: number): string;
}

const stat = (k: keyof PlayerStats) => (p: SimPlayer) => p.stats[k];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const AWARDS: readonly AwardDef[] = [
  { id: 'snack', title: 'Snack', score: (p, s) => (p.caught && p.caughtAt === firstCaught(s) ? 1 : 0), why: () => 'Dragged back to the table first.' },
  { id: 'liar', title: 'Liar Liar', score: stat('lies'), why: (n) => `Told ${plural(n, 'lie')} that became house rules.` },
  { id: 'gremlin', title: 'Kitchen Gremlin', score: stat('plated'), why: (n) => `Plated ${plural(n, 'dish', 'dishes')}.` },
  { id: 'loose_lips', title: 'Loose Lips', score: stat('wordsLanded'), why: (n) => `Said ${plural(n, 'trigger word')} within earshot.` },
  { id: 'witness', title: 'Witness Protection', score: stat('coveredSlips'), why: (n) => `Blocked the view of ${plural(n, 'slip')}.` },
  { id: 'mover', title: 'Furniture Mover', score: stat('reseats'), why: (n) => `Moved guests ${plural(n, 'time')}.` },
  { id: 'curtain', title: 'Curtain Call', score: stat('curtains'), why: (n) => `Worked the curtains ${plural(n, 'time')}.` },
  { id: 'waiter', title: 'Silver Service', score: stat('served'), why: (n) => `Served ${plural(n, 'plate')}.` },
  { id: 'doorman', title: 'The Doorman', score: stat('greeted'), why: (n) => `Greeted ${plural(n, 'guest')} at the door.` },
  { id: 'show_tell', title: 'Show and Tell', score: stat('propsShown'), why: (n) => `Changed the subject with ${plural(n, 'prop')}.` },
  { id: 'chatterbox', title: 'Chatterbox', score: stat('smallTalk'), why: (n) => `Started ${plural(n, 'conversation')}.` },
  { id: 'rule_breaker', title: 'Rules Are For Guests', score: stat('rulesBroken'), why: (n) => `Broke your own rules ${plural(n, 'time')}.` },
  { id: 'escapee', title: 'Getaway Driver', score: (p) => (p.escaped ? 1 : 0), why: () => 'Made it to the van.' },
  { id: 'diplomat', title: 'The Diplomat', score: stat('toasts'), why: (n) => `Gave ${plural(n, 'lovely toast')}.` },
  { id: 'fae_debt', title: 'Paid in Full', score: stat('favors'), why: (n) => `Settled ${plural(n, 'fae debt')}.` },
  { id: 'odd_jobs', title: 'Odd Jobs', score: stat('chores'), why: (n) => `Fixed fuses, caught dogs and mopped up ${plural(n, 'time')}.` },
];

function firstCaught(state: DinnerState): number | null {
  const times = state.players.map((p) => p.caughtAt).filter((t): t is number => t !== null);
  return times.length > 0 ? Math.min(...times) : null;
}

/** 3–5 awards, each to its top player; then every player who has none gets their best one. */
export function pickAwards(state: DinnerState): Award[] {
  const out: Award[] = [];
  const given = new Set<string>();
  for (const def of AWARDS) {
    if (out.length >= 5) break;
    let best: SimPlayer | null = null;
    let bestScore = 0;
    for (const p of state.players) {
      const s = def.score(p, state);
      if (s > bestScore) {
        best = p;
        bestScore = s;
      }
    }
    if (!best) continue;
    out.push({ player: best.id, id: def.id, title: def.title, why: def.why(bestScore) });
    given.add(best.id);
  }
  for (const p of state.players) {
    if (given.has(p.id)) continue;
    let pick: { def: AwardDef; n: number } | null = null;
    for (const def of AWARDS) {
      const n = def.score(p, state);
      if (n > 0 && (!pick || n > pick.n) && !out.some((a) => a.id === def.id && a.player === p.id)) pick = { def, n };
    }
    out.push(
      pick
        ? { player: p.id, id: pick.def.id, title: pick.def.title, why: pick.def.why(pick.n) }
        : { player: p.id, id: 'moral_support', title: 'Moral Support', why: 'Was there. That counts.' },
    );
    given.add(p.id);
  }
  return out;
}

export function finish(
  state: DinnerState,
  outcome: DinnerResult['outcome'],
  ev: SimEvent[],
  opts: { dryRun?: boolean } = {},
): DinnerResult {
  const tu = state.tuning;
  const present = state.guests.filter((g) => !g.eaten && g.where !== 'outside');
  const eaten = state.guests.filter((g) => g.eaten);
  const avgComposure = present.length > 0 ? present.reduce((s, g) => s + g.composure, 0) / present.length : 0;
  const fed = present.filter((g) => GUEST_TYPES[g.type].hunger === 0 || g.hunger < 60).length;
  const coursesDone = outcome === 'survived' ? tu.courses : state.dinnerStart === null ? 0 : state.course;

  let tips = Math.max(
    0,
    Math.round(
      coursesDone * 40 +
        (outcome === 'survived' ? 30 : 0) +
        avgComposure * 0.4 +
        fed * 8 -
        state.strikes * 25 -
        state.stats.rulesBroken * 5 +
        (state.objective?.status === 'done' ? state.objective.tips : 0),
    ),
  );
  let stars =
    outcome === 'strikes'
      ? 1
      : Math.max(
          1,
          5 -
            state.strikes -
            (state.cover < 40 ? 1 : 0) -
            (avgComposure < 40 ? 1 : 0) -
            (state.stats.rulesBroken > 2 ? 1 : 0),
        );
  if (outcome === 'exposed' && !opts.dryRun) {
    const escaped = state.players.filter((p) => p.escaped).length;
    tips = escaped > 0 ? state.chaseTips : 0;
    stars = 0;
  }

  const lines: string[] = [];
  if (outcome === 'exposed') lines.push('Our hosts were HUMAN. We chased them to their van.');
  else if (outcome === 'strikes') lines.push('We made our excuses before dessert.');
  if (state.stats.servings === 0) lines.push('We were never fed.');
  else if (fed === present.length && present.length > 0) lines.push('Lovely food.');
  for (const g of eaten.slice(0, 2)) lines.push(`${g.name} was eaten.`);
  if (state.stats.contradictions > 0) lines.push('The hosts kept contradicting themselves.');
  if (state.stats.slipsHidden > 0 && eaten.length === 0) lines.push('Something odd happened with the lights.');
  if (state.objective?.status === 'done') lines.push(OBJECTIVE_PRAISE[state.objective.id]);
  else if (state.objective?.status === 'failed') lines.push(OBJECTIVE_GRUMBLE[state.objective.id]);
  if (lines.length === 0) lines.push('A perfectly normal evening.');
  lines.push(`${STAR_WORDS[stars]}.`);

  const incidents = [...state.incidents].sort((a, b) => b.drama - a.drama || a.t - b.t).slice(0, 3).sort((a, b) => a.t - b.t);
  const result: DinnerResult = {
    outcome,
    tips,
    stars,
    review: lines.join(' '),
    awards: opts.dryRun ? [] : pickAwards(state),
    incidents,
  };
  if (opts.dryRun) return result;

  state.phase = 'ended';
  state.question = null;
  state.result = result;
  ev.push({ t: 'ended', result });
  return result;
}
