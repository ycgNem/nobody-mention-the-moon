// `npm run audit [-- seeds]`: the M7 repeatability audit. Rolls many dinner seeds and reports the
// spread of houses, occasions, guests, quirks, relationships and events, then plays every seed with
// the rules-aware bot (shared/src/sim/bot.ts) to find combos that can't be won. Each seed is set
// in the house a "surprise me" lobby would pick for it, with that house's seats. Exits non-zero if
// some house, occasion or guest type is never beaten, or a seed crashes or stalls.

import { readFileSync } from 'node:fs';
import {
  BOT,
  HOUSE_IDS,
  OCCASION_IDS,
  createDinner,
  parseLayout,
  pickHouse,
  ringSeats,
  runBotDinner,
  socketsWithPrefix,
  type DinnerState,
  type GuestTypeId,
  type OccasionId,
} from '@moon/shared';

const houses = new Map(
  HOUSE_IDS.map((id) => {
    const layout = parseLayout(JSON.parse(readFileSync(new URL(`../client/public/models/${id}.layout.json`, import.meta.url), 'utf8')));
    return [id as string, { seats: ringSeats(layout).length, stands: socketsWithPrefix(layout, 'stand_').length }] as const;
  }),
);

const seeds = Number(process.argv[2] ?? 1000);
const tally = <K extends string>() => new Map<K, { n: number; wins: number }>();
const byHouse = tally<string>();
const byOccasion = tally<OccasionId>();
const byType = tally<GuestTypeId>();
const byEvent = tally<string>();
const byPlayers = tally<string>();
const quirks = new Map<string, number>();
const relationships = new Map<string, number>();
const outcomes = new Map<string, number>();
const failures: string[] = [];
let totalSeconds = 0;

const bump = <K extends string>(m: Map<K, { n: number; wins: number }>, k: K, won: boolean) => {
  const v = m.get(k) ?? { n: 0, wins: 0 };
  v.n++;
  if (won) v.wins++;
  m.set(k, v);
};

const started = Date.now();
for (let i = 0; i < seeds; i++) {
  const seed = `AUDIT-${i}`;
  const players = 1 + (i % 4);
  const house = pickHouse(seed);
  const { seats, stands } = houses.get(house)!;
  let state: DinnerState;
  try {
    state = createDinner({
      seed,
      seatCount: seats,
      standCount: Math.max(1, stands),
      players: Array.from({ length: players }, (_, k) => ({ id: k === 0 ? BOT : `${BOT}${k}`, name: `Bot ${k + 1}` })),
      tuning: { guests: Math.min(seats, 3 + (i % 5)) },
    });
    for (const g of state.guests) for (const q of g.quirks) quirks.set(q, (quirks.get(q) ?? 0) + 1);
    for (const r of state.relationships) relationships.set(r.kind, (relationships.get(r.kind) ?? 0) + 1);
    runBotDinner(state);
  } catch (err) {
    failures.push(`${seed}: crashed: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (state.phase !== 'ended' || !state.result) {
    failures.push(`${seed}: stalled in ${state.phase}`);
    continue;
  }
  const won = state.result.outcome === 'survived';
  totalSeconds += state.time;
  outcomes.set(state.result.outcome, (outcomes.get(state.result.outcome) ?? 0) + 1);
  bump(byHouse, house, won);
  bump(byOccasion, state.occasion, won);
  bump(byPlayers, `${players} host${players > 1 ? 's' : ''}`, won);
  for (const t of new Set(state.guests.map((g) => g.type))) bump(byType, t, won);
  for (const e of new Set(state.schedule.map((s) => s.kind))) bump(byEvent, e, won);
}

const pct = (a: number, b: number) => `${b === 0 ? 0 : Math.round((100 * a) / b)}%`;
const table = (title: string, m: Map<string, { n: number; wins: number }>) => {
  console.log(`\n${title}`);
  for (const [k, v] of [...m].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(16)} ${String(v.n).padStart(5)} dinners   won ${pct(v.wins, v.n).padStart(4)}`);
};

console.log(`Audited ${seeds} seeds in ${((Date.now() - started) / 1000).toFixed(1)} s (avg dinner ${(totalSeconds / Math.max(1, seeds) / 60).toFixed(1)} sim-minutes).`);
console.log('Outcomes:', Object.fromEntries(outcomes));
table('By house', byHouse);
table('By occasion', byOccasion);
table('By guest type at the table', byType);
table('By event', byEvent);
table('By number of hosts', byPlayers);
console.log('\nQuirks rolled:', Object.fromEntries([...quirks].sort((a, b) => b[1] - a[1])));
console.log('Relationships:', Object.fromEntries(relationships));

const neverWon = [
  ...HOUSE_IDS.filter((h) => (byHouse.get(h)?.wins ?? 0) === 0).map((h) => `house ${h}`),
  ...OCCASION_IDS.filter((o) => (byOccasion.get(o)?.wins ?? 0) === 0).map((o) => `occasion ${o}`),
  ...[...byType].filter(([, v]) => v.wins === 0).map(([k]) => `guest type ${k}`),
];
if (failures.length > 0) console.log(`\n${failures.length} broken seeds:\n  ${failures.slice(0, 20).join('\n  ')}`);
if (neverWon.length > 0) console.log(`\nNever won: ${neverWon.join(', ')}`);
if (failures.length > 0 || neverWon.length > 0) process.exit(1);
console.log('\nNo degenerate seeds: every house, occasion and guest type was beaten, and nothing crashed or stalled.');
