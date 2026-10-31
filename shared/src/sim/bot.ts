// A competent host bot for headless balance runs (CLAUDE.md: "run the sim headless over many
// seeds"). It cheats (it reads every guest's type) because its job is to answer "can this seed be
// won at all?", not to play like a person. Used by tests and `npm run audit`.

import { dishById } from '../content/dishes.ts';
import { ruleById } from '../content/questions.ts';
import { PROP_TOPICS, topicById, type PropTopicId } from '../content/topics.ts';
import { eatsDish } from './setup.ts';
import { act, currentMenu, guestAtSeat, isAvailable, isServing, step, traitsOf, typeOf } from './dinner.ts';
import { hurtByOf, likesOf, triggersOf } from './core.ts';
import { OPEN_WORLD, type Action, type DinnerState, type SimEvent, type SimWorld } from './types.ts';

export const BOT = 'bot';

/** The world as the bot sees it: open house, and it talks when it's toasting. */
export function botWorld(state: DinnerState, base: SimWorld = OPEN_WORLD): SimWorld {
  return { ...base, speaking: (p) => state.toast?.player === p };
}

/** What the bot does this moment (call every half second or so). */
export function botActions(s: DinnerState, tick: number, by = BOT): Action[] {
  const out: Action[] = [];
  if (s.phase === 'booking' || s.phase === 'prep') return [{ type: 'skip', by }];
  if (s.phase === 'chase' || s.phase === 'ended') return out;

  // Arrivals
  for (const g of s.guests) {
    if (g.where === 'door') out.push({ type: g.greeted ? 'invite' : 'greet', by, guest: g.id });
    if (g.where === 'standing') {
      const free = [...Array(s.seatCount).keys()].filter((seat) => !guestAtSeat(s, seat));
      const half = s.seatCount / 2;
      const side = free.find((seat) => g.family < 0 || (seat < half ? 0 : 1) === g.family) ?? free[0];
      if (side !== undefined) out.push({ type: 'reseat', by, guest: g.id, seat: side });
    }
  }

  // The room
  const present = s.guests.filter((g) => g.where === 'seated' && !g.eaten);
  const room = s.room;
  if (room.curtainsOpen && !s.ledger.some((id) => ruleById(id).check === 'open_curtains') && (room.moonUp || present.some((g) => typeOf(g).mechanic === 'draft')))
    out.push({ type: 'toggle', by, what: 'curtains' });
  if (!room.mirrorCovered && present.some((g) => traitsOf(s, g).mirrorSensitive)) out.push({ type: 'toggle', by, what: 'mirror' });
  if (!room.powerOn) out.push({ type: 'fuse', by });
  if (room.spill) out.push({ type: 'clean', by });
  if (room.dogLoose && tick % 20 === 0) out.push({ type: 'dogHome', by });
  if (room.neighborPresent) out.push({ type: 'showOut', by });
  if (s.visitor?.kind === 'pizza') out.push({ type: 'visitor', by });
  if (s.visitor?.kind === 'hunter' && s.visitor.trickIn <= 1) out.push({ type: 'visitor', by });

  // Questions: lie when it's safe, otherwise dodge.
  const q = s.question;
  if (q && q.target === by) {
    const lie = q.options.findIndex((o) => o.kind === 'lie' && !ruleById(o.rule).contradicts.some((c) => s.ledger.includes(c)) && ruleById(o.rule).check === null);
    out.push({ type: 'answer', by, choice: lie >= 0 ? lie : q.options.findIndex((o) => o.kind === 'deflect') });
  }

  if (!isServing(s)) return out;

  // Favors and loose parts.
  for (const f of s.favors) {
    if (f.player !== by) continue;
    if (f.want.startsWith('prop:')) out.push({ type: 'prop', by, prop: f.want.slice(5) as PropTopicId });
    else out.push({ type: 'serve', by, guest: f.guest, dish: f.want });
  }
  for (const g of present) if (g.partsOff > 0) out.push({ type: 'reattach', by, guest: g.id });

  // Feed whoever is getting hungry with something they'll eat and that won't hurt them.
  if (tick % 3 === 0) {
    const hungry = present.filter((g) => isAvailable(g) && g.hunger > 45).sort((a, b) => b.hunger - a.hunger)[0];
    if (hungry) {
      const menu = [...currentMenu(s), 'red_wine'];
      const dish = menu.find((id) => {
        const d = dishById(id);
        return eatsDish(traitsOf(s, hungry).id, d) && !hurtByOf(s, hungry).some((t) => (d.tags as readonly string[]).includes(t));
      });
      if (dish) out.push({ type: 'serve', by, guest: hungry.id, dish });
    }
  }

  // Small Talk: a liked, harmless card to whoever needs it most (or the charades actor).
  const p = s.players.find((x) => x.id === by);
  if (p && tick % 4 === 0) {
    const actor = s.partyGame && s.partyGame.guess > 40 ? s.guests[s.partyGame.actor] : undefined;
    const needy = actor && isAvailable(actor) ? actor : present.filter(isAvailable).sort((a, b) => a.composure - b.composure)[0];
    if (needy) {
      const likes = likesOf(s, needy);
      const triggers = triggersOf(s, needy);
      let best = -1;
      let bestScore = -Infinity;
      p.hand.forEach((card, i) => {
        if (!card) return;
        const tags = topicById(card).tags;
        if (tags.some((t) => triggers.includes(t))) return;
        const score = tags.filter((t) => likes.includes(t)).length;
        if (score > bestScore) {
          best = i;
          bestScore = score;
        }
      });
      if (best >= 0 && (needy.composure < 75 || typeOf(needy).needsAddressing || actor)) out.push({ type: 'smallTalk', by, guest: needy.id, card: best });
    }
  }
  return out;
}

export interface BotRun {
  state: DinnerState;
  events: SimEvent[];
}

/** Plays a whole dinner with the bot. Steps 0.1 s; the bot acts every half second. */
export function runBotDinner(state: DinnerState, maxSeconds = 1500): BotRun {
  const events: SimEvent[] = [];
  const world = botWorld(state);
  for (let i = 0; i < maxSeconds * 10 && state.phase !== 'ended'; i++) {
    events.push(...step(state, 0.1, world));
    if (state.phase === 'chase') {
      if (i % 30 === 0) for (const p of state.players) act(state, { type: 'escaped', player: p.id }, world);
      continue;
    }
    if (i % 5 === 0) for (const p of state.players) for (const a of botActions(state, i / 5, p.id)) events.push(...act(state, a, world));
  }
  return { state, events };
}

export const PROP_IDS = Object.keys(PROP_TOPICS) as PropTopicId[];
