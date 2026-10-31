// Screen-space UI for a dinner: meters, Small Talk hand, prompts, questions, ledger, log,
// serve menu, say box, results and the live tuning panel.

import {
  DISHES,
  SIM,
  TAG_STYLE,
  ruleById,
  topicById,
  type DinnerState,
  type SimTuning,
} from '@moon/shared';
import { formatClock, h, renderIfChanged } from './dom.ts';

const LOG_LINES = 8;

export type LogKind = 'info' | 'bad' | 'good' | 'big';

export class DinnerHud {
  readonly root: HTMLDivElement;
  private readonly bar = h('div.dh-bar');
  private readonly hand = h('div.dh-hand');
  private readonly prompt = h('div.dh-prompt');
  private readonly question = h('div.dh-question.dh-panel');
  private readonly serve = h('div.dh-serve.dh-panel');
  private readonly ledger = h('div.dh-ledger.dh-panel');
  private readonly logEl = h('div.dh-log');
  private readonly toastEl = h('div.dh-toast');
  private readonly results = h('div.dh-results.dh-panel');
  private readonly tuning = h('div.dh-tuning.dh-panel');
  private readonly sayWrap = h('form.dh-say');
  private readonly sayInput = h('input', { maxlength: '140', placeholder: 'Say something out loud… (Enter to say, Esc to cancel)' });
  private toastTimer = 0;
  private onSay: ((text: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = h('div.dinner-hud');
    this.sayWrap.append(this.sayInput);
    this.sayWrap.hidden = true;
    this.question.hidden = true;
    this.serve.hidden = true;
    this.results.hidden = true;
    this.tuning.hidden = true;
    this.root.append(
      this.bar,
      this.ledger,
      this.logEl,
      this.toastEl,
      this.prompt,
      this.hand,
      this.question,
      this.serve,
      this.sayWrap,
      this.results,
      this.tuning,
    );
    parent.append(this.root);

    this.sayWrap.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.sayInput.value.trim();
      const cb = this.onSay;
      this.closeSay();
      if (text && cb) cb(text);
    });
    this.sayInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeSay();
      e.stopPropagation();
    });
  }

  dispose(): void {
    this.root.remove();
  }

  // --- per frame -------------------------------------------------------------------------------

  render(state: DinnerState, prompt: string, dt: number): void {
    this.renderBar(state);
    this.renderHand(state);
    this.renderLedger(state);
    this.renderQuestion(state);
    renderIfChanged(this.prompt, prompt, () => [prompt]);
    this.prompt.hidden = prompt === '';
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }

  private renderBar(state: DinnerState): void {
    const t = state.tuning;
    const phase =
      state.phase === 'dessert'
        ? 'Dessert'
        : state.phase === 'ended'
          ? 'Over'
          : `Course ${state.course + 1}/${t.courses}`;
    const cover = Math.round(state.cover);
    const key = `${phase}|${Math.ceil(state.phaseTime)}|${cover}|${state.strikes}`;
    renderIfChanged(this.bar, key, () => {
      const strikes = Array.from({ length: t.maxStrikes }, (_, i) =>
        h(i < state.strikes ? 'span.strike.on' : 'span.strike', null, i < state.strikes ? '✖' : '○'),
      );
      const meter = h('div.cover-meter', null, h('i', { style: `width:${cover}%` }));
      meter.classList.toggle('low', cover < 35);
      return [
        h('span.phase', null, `${phase} · ${formatClock(state.phaseTime)}`),
        h('span.cover', null, 'Cover ', meter, ` ${cover}`),
        h('span.strikes', null, 'Strikes ', ...strikes),
      ];
    });
  }

  private renderHand(state: DinnerState): void {
    const key = state.hand.map((c, i) => c ?? `cd${Math.ceil(state.handCooldown[i] ?? 0)}`).join('|');
    renderIfChanged(this.hand, key, () =>
      state.hand.map((card, i) => {
        if (!card) {
          return h('div.card.cooling', null, h('b', null, String(i + 1)), `back in ${Math.ceil(state.handCooldown[i] ?? 0)}s`);
        }
        const topic = topicById(card);
        return h(
          'div.card',
          null,
          h('b', null, String(i + 1)),
          h('div.chips', null, ...topic.tags.map((tag) => h('span.chip', { style: `background:${TAG_STYLE[tag].color}` }, `${TAG_STYLE[tag].icon} ${tag}`))),
          h('div.label', null, topic.label),
        );
      }),
    );
  }

  private renderLedger(state: DinnerState): void {
    renderIfChanged(this.ledger, state.ledger.join('|'), () => [
      h('h3', null, 'Rumor Ledger'),
      ...state.ledger.map((id, i) => {
        const r = ruleById(id);
        return h(
          'div.rule',
          null,
          h('div.rule-text', null, r.check ? `⚠ ${r.rule}` : r.rule),
          h('div.claim', null, i === 0 ? `Booking rumor: ${r.claim}` : r.claim),
        );
      }),
    ]);
  }

  private renderQuestion(state: DinnerState): void {
    const q = state.question;
    this.question.hidden = !q;
    if (!q) return;
    const asker = state.guests[q.asker]!;
    renderIfChanged(this.question, `${q.id}|${q.asker}|${q.options.length}`, () => [
      h('div.asker', null, `${asker.name} turns to you${asker.suspicious ? ' (suspicious!)' : ''}:`),
      h('div.qtext', null, `“${q.text}”`),
      ...q.options.map((o, i) => {
        const hint = o.kind === 'lie' ? `adds rule: ${ruleById(o.rule).rule}` : o.kind === 'truth' ? 'honest… and very human' : 'a clumsy dodge';
        return h(`div.option.${o.kind}`, null, h('b', null, String(i + 1)), h('span', null, o.text), h('small', null, hint));
      }),
      h('div.timer', null, h('i')),
    ]);
    const bar = this.question.querySelector<HTMLElement>('.timer i');
    if (bar) bar.style.width = `${(q.timer / q.total) * 100}%`;
  }

  // --- serve menu ------------------------------------------------------------------------------

  showServe(state: DinnerState, guestName: string | null): void {
    this.serve.hidden = guestName === null;
    if (guestName === null) return;
    const key = `${guestName}|${DISHES.map((d) => Math.ceil(state.dishCooldown[d.id] ?? 0)).join(',')}`;
    renderIfChanged(this.serve, key, () => [
      h('h3', null, `Serve ${guestName}…`),
      ...DISHES.map((d, i) => {
        const cd = Math.ceil(state.dishCooldown[d.id] ?? 0);
        return h(cd > 0 ? 'div.option.cooling' : 'div.option', null, h('b', null, String(i + 1)), h('span', null, d.label), h('small', null, cd > 0 ? `ready in ${cd}s` : d.tags.join(', ')));
      }),
      h('small.hint', null, 'Esc or E to close'),
    ]);
  }

  // --- say box ---------------------------------------------------------------------------------

  get sayOpen(): boolean {
    return !this.sayWrap.hidden;
  }

  openSay(onSay: (text: string) => void): void {
    this.onSay = onSay;
    this.sayWrap.hidden = false;
    this.sayInput.value = '';
    this.sayInput.focus();
  }

  closeSay(): void {
    this.onSay = null;
    this.sayWrap.hidden = true;
    this.sayInput.blur();
  }

  // --- log and toasts --------------------------------------------------------------------------

  log(text: string, kind: LogKind = 'info'): void {
    this.logEl.append(h(`div.line.${kind}`, null, text));
    while (this.logEl.childElementCount > LOG_LINES) this.logEl.firstElementChild?.remove();
  }

  toast(text: string, kind: LogKind = 'big', seconds = 3.5): void {
    this.toastEl.textContent = text;
    this.toastEl.className = `dh-toast show ${kind}`;
    this.toastTimer = seconds;
  }

  // --- results ---------------------------------------------------------------------------------

  showResults(state: DinnerState): void {
    const r = state.result;
    if (!r) return;
    const title =
      r.outcome === 'survived' ? 'You got through dinner!' : r.outcome === 'strikes' ? 'They made their excuses.' : 'EXPOSED. They know you are human.';
    const s = state.stats;
    this.results.hidden = false;
    this.results.replaceChildren(
      h('h2', null, title),
      h('div.stars', null, '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars)),
      h('div.tips', null, `Tips: $${r.tips}`),
      h('blockquote', null, `“${r.review}”`),
      h(
        'div.stats',
        null,
        ...(
          [
            ['Small talk', s.smallTalk],
            ['Dishes served', s.servings],
            ['Lies told', s.rulesAdded],
            ['Rules broken', s.rulesBroken],
            ['Contradictions', s.contradictions],
            ['Slips', s.slips],
            ['Slips hidden', s.slipsHidden],
            ['Words that landed', s.wordsHeard],
            ['Reseats', s.reseats],
          ] as const
        ).map(([k, v]) => h('div', null, h('span', null, k), h('b', null, String(v)))),
      ),
      h('div.again', null, h('b', null, 'R'), ' new dinner · ', h('b', null, 'Shift+R'), ` replay seed ${state.seed}`),
    );
  }

  hideResults(): void {
    this.results.hidden = true;
  }

  // --- tuning ----------------------------------------------------------------------------------

  get tuningOpen(): boolean {
    return !this.tuning.hidden;
  }

  toggleTuning(state: DinnerState, overrides: Partial<SimTuning>, showMeters: { value: boolean }): void {
    this.tuning.hidden = !this.tuning.hidden;
    if (this.tuning.hidden) return;
    const meters = h('input', { type: 'checkbox' });
    meters.checked = showMeters.value;
    meters.addEventListener('change', () => (showMeters.value = meters.checked));
    const rows = (Object.keys(SIM) as (keyof SimTuning)[]).map((key) => {
      const input = h('input', { type: 'number', step: 'any', value: String(state.tuning[key]) });
      input.classList.toggle('changed', state.tuning[key] !== SIM[key]);
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (!Number.isFinite(v)) return;
        state.tuning[key] = v;
        overrides[key] = v;
        input.classList.toggle('changed', v !== SIM[key]);
      });
      input.addEventListener('keydown', (e) => e.stopPropagation());
      return h('label', null, h('span', null, key), input);
    });
    this.tuning.replaceChildren(
      h('h3', null, 'Tuning (this dinner, and the next ones)'),
      h('label.meters', null, meters, h('span', null, 'Show composure meters')),
      ...rows,
      h('small.hint', null, 'Changes apply live. Guest count and course lengths apply from the next dinner. ` to close.'),
    );
  }
}
