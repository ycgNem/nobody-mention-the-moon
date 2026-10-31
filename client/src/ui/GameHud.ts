// Screen-space UI for the whole game: the lobby at the van, the Booking Card, the dinner bar,
// tonight's occasion and whatever event is going on, your Small Talk hand and wheel, questions
// aimed at you, the ledger, the fridge, guest notes, the chat log, results with awards, and the
// network overlay. Everything renders from the
// GameView; the HUD never decides anything, it only sends Commands through callbacks.

import {
  APRONS,
  EXPOSURE_WORDS,
  GUEST_TYPES,
  HAIRS,
  HAIR_COLORS,
  HATS,
  HOUSES,
  HOUSE_IDS,
  HUD,
  NET,
  OCCASIONS,
  SKIN_TONES,
  TAG_STYLE,
  dishById,
  isDish,
  ruleById,
  topicById,
  type Command,
  type DinnerView,
  type GameView,
  type GuestView,
  type HandView,
  type HouseSetting,
  type OccasionId,
  type PartySize,
  type PlayerView,
  type TopicTag,
} from '@moon/shared';
import { formatClock, h, renderIfChanged } from './dom.ts';

const LOG_LINES = 9;
const NOTE_LABELS = ['', ...Object.values(GUEST_TYPES).map((t) => `${t.label}?`), 'Human?', 'Hungry!', 'Careful'];

export type LogKind = 'info' | 'bad' | 'good' | 'big' | 'chat';

export interface HudCallbacks {
  send(cmd: Command): void;
  /** Local-only UI that changes how the client behaves (closing panels, etc.). */
  closePanels(): void;
}

export class GameHud {
  readonly root = h('div.dinner-hud');
  private readonly bar = h('div.dh-bar');
  private readonly hand = h('div.dh-hand');
  private readonly prompt = h('div.dh-prompt');
  private readonly question = h('div.dh-question.dh-panel');
  private readonly asking = h('div.dh-asking');
  private readonly ledger = h('div.dh-ledger.dh-panel');
  private readonly logEl = h('div.dh-log');
  private readonly toastEl = h('div.dh-toast');
  private readonly charge = h('div.dh-charge', null, h('i'));
  private readonly booking = h('div.dh-booking.dh-panel');
  private readonly lobby = h('div.dh-lobby.dh-panel');
  private readonly fridge = h('div.dh-fridge.dh-panel');
  private readonly notes = h('div.dh-notes.dh-panel');
  private readonly wheel = h('div.dh-wheel');
  private readonly results = h('div.dh-results.dh-panel');
  private readonly netEl = h('div.dh-net');
  private readonly status = h('div.dh-status');
  private readonly events = h('div.dh-events');
  private readonly triggers = h('div.dh-triggers.dh-panel');
  private readonly sayWrap = h('form.dh-say');
  private readonly sayInput = h('input', { maxlength: '140', placeholder: 'Say something out loud… (Enter to say, Esc to cancel)' });
  private toastTimer = 0;
  private onSay: ((text: string) => void) | null = null;
  ledgerOpen = false;
  fridgeOpen = false;
  notesOpen = false;
  netOpen = false;
  /** Show every trigger word (a settings assist). */
  showTriggers = false;
  /** Where this house's fuse box is, for the power cut line ("in the garage"). */
  fuseWhere = '';
  /** Index of the highlighted wheel card, or -1. */
  wheelPick = -1;

  constructor(
    parent: HTMLElement,
    private readonly cb: HudCallbacks,
  ) {
    this.sayWrap.append(this.sayInput);
    for (const el of [this.sayWrap, this.question, this.fridge, this.notes, this.results, this.booking, this.lobby, this.wheel, this.netEl, this.charge]) el.hidden = true;
    this.root.append(
      this.bar,
      this.events,
      this.status,
      this.ledger,
      this.logEl,
      this.toastEl,
      this.prompt,
      this.asking,
      this.hand,
      this.question,
      this.booking,
      this.lobby,
      this.fridge,
      this.notes,
      this.wheel,
      this.charge,
      this.sayWrap,
      this.results,
      this.netEl,
      this.triggers,
    );
    parent.append(this.root);

    this.sayWrap.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.sayInput.value.trim();
      const done = this.onSay;
      this.closeSay();
      if (text && done) done(text);
    });
    this.sayInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeSay();
      e.stopPropagation();
    });
  }

  dispose(): void {
    this.root.remove();
  }

  /** Any panel that wants the mouse (pointer lock released). */
  get wantsMouse(): boolean {
    return this.fridgeOpen || this.notesOpen || !this.lobby.hidden || !this.results.hidden;
  }

  // --- per frame -------------------------------------------------------------------------------

  render(v: GameView, selfId: string, prompt: string, dt: number): void {
    const d = v.dinner;
    const inDinner = v.phase === 'dinner' && d.active;
    this.bar.hidden = !inDinner;
    this.hand.hidden = !inDinner || !isTalking(d);
    this.events.hidden = !inDinner || d.phase === 'booking' || d.phase === 'ended';
    // The Booking Card shows the rumor itself before guests arrive.
    this.ledger.hidden = !inDinner || d.ledger.length === 0 || d.phase === 'booking' || d.phase === 'prep';
    if (inDinner) {
      this.renderBar(d);
      this.renderHand(d.hands.find((x) => x.player === selfId));
      this.renderLedger(d);
      this.renderEvents(v, selfId);
      this.renderQuestion(v, selfId);
    } else {
      this.question.hidden = true;
      this.asking.hidden = true;
    }
    this.renderBooking(v, selfId);
    this.renderLobby(v, selfId);
    this.renderResults(v, selfId);
    if (this.fridgeOpen) this.renderFridge(d);
    if (this.notesOpen) this.renderNotes(v);
    this.renderStatus(v, selfId);
    this.triggers.hidden = !this.showTriggers || !inDinner;
    if (!this.triggers.hidden) this.renderTriggers();
    renderIfChanged(this.prompt, prompt, () => [prompt]);
    this.prompt.hidden = prompt === '';
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }

  private renderBar(d: DinnerView): void {
    const label = phaseLabel(d);
    const cover = Math.round(d.cover);
    const key = `${label}|${Math.ceil(d.phaseTime)}|${cover}|${d.strikes}|${d.room.alarm}`;
    renderIfChanged(this.bar, key, () => {
      const strikes = Array.from({ length: d.maxStrikes }, (_, i) => h(i < d.strikes ? 'span.strike.on' : 'span.strike', null, i < d.strikes ? '✖' : '○'));
      const meter = h('div.cover-meter', null, h('i', { style: `width:${cover}%` }));
      meter.classList.toggle('low', cover < 35);
      const timed = d.phase !== 'ended';
      return [
        h('span.phase', null, timed ? `${label} · ${formatClock(d.phaseTime)}` : label),
        h('span.cover', null, 'Cover ', meter, ` ${cover}`),
        h('span.strikes', null, 'Strikes ', ...strikes),
        d.room.alarm ? h('span.alarm', null, '🔥 Smoke alarm!') : null,
      ];
    });
  }

  private renderHand(hand: HandView | undefined): void {
    if (!hand) {
      this.hand.hidden = true;
      return;
    }
    const key = hand.cards.map((c, i) => c || `cd${Math.ceil(hand.cooldowns[i] ?? 0)}`).join('|');
    renderIfChanged(this.hand, key, () =>
      hand.cards.map((card, i) => {
        if (!card) return h('div.card.cooling', null, h('b', null, String(i + 1)), `back in ${Math.ceil(hand.cooldowns[i] ?? 0)}s`);
        const topic = topicById(card);
        return h('div.card', null, h('b', null, String(i + 1)), chips(topic.tags), h('div.label', null, topic.label));
      }),
    );
  }

  private renderLedger(d: DinnerView): void {
    const key = `${d.ledger.join('|')}|${this.ledgerOpen}`;
    this.ledger.classList.toggle('open', this.ledgerOpen);
    renderIfChanged(this.ledger, key, () => [
      h('h3', null, `Rumor Ledger${this.ledgerOpen ? '' : ' (Tab)'}`),
      ...d.ledger.map((id, i) => {
        const r = ruleById(id);
        return h('div.rule', null, h('div.rule-text', null, r.check ? `⚠ ${r.rule}` : r.rule), this.ledgerOpen || i === d.ledger.length - 1 ? h('div.claim', null, i === 0 ? `Booking rumor: ${r.claim}` : r.claim) : null);
      }),
    ]);
  }

  /** Tonight's occasion and objective, the room's troubles, and any toast, favor, visitor or game. */
  private renderEvents(v: GameView, selfId: string): void {
    const d = v.dinner;
    const o = d.objective;
    const r = d.room;
    const me = v.players.find((p) => p.id === selfId);
    const guest = (id: number) => d.guests.find((g) => g.id === id)?.name ?? 'a guest';
    const host = (id: string) => (id === selfId ? 'You' : (v.players.find((p) => p.id === id)?.name ?? 'A host'));
    const key = JSON.stringify([
      d.occasionLabel,
      o,
      d.book,
      d.honoree,
      d.toast.player,
      Math.round(d.toast.spoken),
      Math.ceil(d.toast.timer),
      d.favors,
      d.visitor.kind,
      d.visitor.where,
      Math.round(d.visitor.suspicion),
      d.charades.actor,
      d.charades.guess,
      [r.powerOn, r.storm, r.spill, r.dogLoose],
      me?.nameTaken,
      v.tutorial && firstShiftTip(v, selfId),
    ]);
    renderIfChanged(this.events, key, () => {
      const out: (HTMLElement | null)[] = [];
      const objective = !o.status
        ? ''
        : o.status === 'done'
          ? `✔ ${o.label}`
          : o.status === 'failed'
            ? `✖ ${o.label}`
            : `${o.label}${o.goal > 1 ? ` (${o.progress}/${o.goal})` : ''}`;
      out.push(h('div.ev-occasion', null, h('b', null, v.tutorial ? 'First Shift' : d.occasionLabel), objective ? h(`span.obj.${o.status}`, null, objective) : null));
      const tip = v.tutorial ? firstShiftTip(v, selfId) : '';
      if (tip) out.push(h('div.ev.tip', null, `💡 ${tip}`));
      if (d.honoree >= 0) out.push(h('div.ev', null, `🎂 Guest of honor: ${guest(d.honoree)} (every reaction counts double)`));
      if (d.book.length > 0) out.push(h('div.ev', null, '📖 The book: ', chips(d.book)));
      if (!r.powerOn) out.push(h('div.ev.bad', null, `⚡ Power cut! Fix the fuse box${this.fuseWhere ? ` ${this.fuseWhere}` : ''}`));
      if (r.storm) out.push(h('div.ev', null, '⛈ Thunderstorm: lightning lights up the room'));
      if (r.spill) out.push(h('div.ev.bad', null, '🍷 Wine on the tablecloth: grab the tea towel, F at the table'));
      if (r.dogLoose) out.push(h('div.ev.bad', null, '🐕 The dog is loose! Carry it to the garage'));
      if (d.toast.player) {
        const mine = d.toast.player === selfId;
        const pct = Math.min(100, Math.round((d.toast.spoken / Math.max(d.toast.need, 0.01)) * 100));
        out.push(
          h(
            mine ? 'div.ev.toast.mine' : 'div.ev.toast',
            null,
            mine ? `🥂 Your toast! Hold V and talk, or type with Enter · ${Math.ceil(d.toast.timer)}s` : `🥂 ${host(d.toast.player)} is giving a toast`,
            h('div.ev-bar', null, h('i', { style: `width:${pct}%` })),
          ),
        );
      }
      for (const f of d.favors) out.push(h(f.player === selfId ? 'div.ev.favor.mine' : 'div.ev.favor', null, `🧚 ${guest(f.guest)} asked ${host(f.player)}: ${f.label} · ${f.beats} beats`));
      if (d.visitor.kind === 'hunter') {
        const s = Math.round(d.visitor.suspicion);
        out.push(h('div.ev.hunter', null, `🗡 The Monster Hunter is at the table · suspicion ${s}%`, h('div.ev-bar.danger', null, h('i', { style: `width:${s}%` }))));
      } else if (d.visitor.kind === 'pizza') {
        out.push(h('div.ev.bad', null, d.visitor.where === 'door' ? '🍕 Pizza driver at the front door' : '🍕 The pizza driver is wandering around inside!'));
      }
      if (d.charades.actor >= 0) out.push(h('div.ev', null, `🎭 ${guest(d.charades.actor)} is acting out a charade · ${d.charades.guess}% guessed`));
      if (me?.nameTaken) out.push(h('div.ev.bad', null, "🪪 The fae took your name: you can't lie to anyone tonight"));
      return out;
    });
  }

  /** Every type's trigger words, plus the ones that give the hosts away. Not who is which type. */
  private renderTriggers(): void {
    renderIfChanged(this.triggers, 'all', () => [
      h('h3', null, 'Trigger words'),
      ...Object.values(GUEST_TYPES).map((t) => h('div.tw', null, h('b', null, t.label), ` ${t.words.join(', ')}`)),
      h('div.tw.human', null, h('b', null, 'Sounds human'), ` ${EXPOSURE_WORDS.join(', ')}`),
    ]);
  }

  private renderQuestion(v: GameView, selfId: string): void {
    const d = v.dinner;
    const q = d.question;
    const asker = q.asker >= 0 ? d.guests.find((g) => g.id === q.asker) : undefined;
    const mine = !!asker && q.target === selfId;
    this.question.hidden = !mine;
    this.asking.hidden = !asker || mine;
    if (!asker) return;
    if (!mine) {
      const who = v.players.find((p) => p.id === q.target)?.name ?? 'someone';
      renderIfChanged(this.asking, `${q.asker}|${q.target}`, () => [`${asker.name} is asking ${who} something…`]);
      return;
    }
    renderIfChanged(this.question, `${q.asker}|${q.text}|${q.options.length}`, () => [
      h('div.asker', null, `${asker.name} turns to you${asker.suspicious ? ' (suspicious!)' : ''}:`),
      h('div.qtext', null, `“${q.text}”`),
      ...q.options.map((o, i) => {
        const hint = o.kind === 'lie' && o.rule ? `adds rule: ${ruleById(o.rule).rule}` : o.kind === 'truth' ? 'honest… and very human' : 'a clumsy dodge';
        return h(`div.option.${o.kind}`, null, h('b', null, String(i + 1)), h('span', null, o.text), h('small', null, hint));
      }),
      h('div.timer', null, h('i')),
    ]);
    const bar = this.question.querySelector<HTMLElement>('.timer i');
    if (bar) bar.style.width = `${(q.timer / Math.max(q.total, 0.01)) * 100}%`;
  }

  private renderStatus(v: GameView, selfId: string): void {
    const me = v.players.find((p) => p.id === selfId);
    let text = '';
    if (v.phase === 'dinner' && me?.caught) text = 'Caught! Sit tight and cheer for the others.';
    else if (v.phase === 'dinner' && me?.escaped) text = 'You made it to the van. Keep the engine running…';
    else if (v.phase === 'dinner' && v.dinner.phase === 'chase') text = 'RUN to the van out front!';
    else if (v.phase === 'dinner' && me && me.stone > 0) text = `Turned to stone! ${Math.ceil(me.stone)}s… (don't meet a gorgon's eyes)`;
    renderIfChanged(this.status, text, () => [text]);
    this.status.hidden = text === '';
  }

  // --- the Booking Card (before guests arrive) -------------------------------------------------

  private renderBooking(v: GameView, selfId: string): void {
    const d = v.dinner;
    const show = v.phase === 'dinner' && (d.phase === 'booking' || d.phase === 'prep');
    this.booking.hidden = !show;
    if (!show) return;
    const rumor = d.ledger[0] ? ruleById(d.ledger[0]).claim : '';
    const key = `${d.phase}|${d.seed}|${d.guests.length}|${rumor}|${v.roomHost === selfId}|${d.occasion}|${v.tutorial}|${v.asset}`;
    const house = v.asset in HOUSES ? HOUSES[v.asset as keyof typeof HOUSES] : null;
    const occasion = d.occasion in OCCASIONS ? OCCASIONS[d.occasion as OccasionId] : null;
    renderIfChanged(this.booking, key, () => [
      h('h3', null, d.phase === 'booking' ? (v.tutorial ? 'Booking Card: your First Shift' : 'Booking Card') : 'Prep: get the kitchen going'),
      house ? h('div.bk-row', null, h('span', null, 'Where'), h('b', null, house.label)) : null,
      occasion ? h('div.bk-row', null, h('span', null, 'Occasion'), h('b', null, occasion.label)) : null,
      occasion ? h('div.bk-blurb', null, occasion.blurb) : null,
      occasion?.objective ? h('div.bk-row', null, h('span', null, 'Bonus'), h('b', null, `${occasion.objective.label} (+$${occasion.objective.tips})`)) : null,
      d.book.length > 0 ? h('div.bk-row', null, h('span', null, 'The book'), chips(d.book)) : null,
      h('div.bk-row', null, h('span', null, 'Party of'), h('b', null, `${d.guests.length} guests`)),
      h('div.bk-row', null, h('span', null, 'Rumor'), h('b', null, rumor || '—')),
      h(
        'div.bk-menu',
        null,
        ...d.menu.map((c, i) =>
          h('div', null, h('span', null, i === d.menu.length - 1 ? 'Dessert' : `Course ${i + 1}`), c.dishes.map((id) => (isDish(id) ? dishById(id).label : id)).join(', ')),
        ),
      ),
      h('div.bk-seed', null, `Seed ${d.seed}`),
      h(
        'small.hint',
        null,
        v.tutorial && d.phase === 'booking'
          ? 'Two guests, one rumor, all the time in the world. Follow the 💡 tips on the left as you go.'
          : d.phase === 'booking'
          ? 'Read it, then get cooking. Ingredients are in the fridge; the wine is in the cellar.'
          : 'Start the first course: fridge → chop → hob/oven → pass. B rings the bell early.',
      ),
    ]);
  }

  // --- lobby at the van ------------------------------------------------------------------------

  private renderLobby(v: GameView, selfId: string): void {
    const show = v.phase === 'lobby';
    this.lobby.hidden = !show;
    if (!show) return;
    const me = v.players.find((p) => p.id === selfId);
    const isHost = v.roomHost === selfId;
    const key = JSON.stringify([v.players.map((p) => [p.id, p.name, p.ready, p.look, p.connected]), v.size, v.seed, v.relaxed, v.tutorial, v.house, isHost]);
    renderIfChanged(this.lobby, key, () => {
      const players = h(
        'ul.lb-players',
        null,
        ...v.players.map((p) =>
          h(
            'li',
            null,
            h('span.swatch', { style: `background:${p.look.apron}` }),
            `${p.name}${p.id === selfId ? ' (you)' : ''}${p.id === v.roomHost ? ' ★' : ''}`,
            h(p.ready ? 'b.ready' : 'b.notready', null, p.ready ? 'ready' : p.connected ? '…' : 'away'),
          ),
        ),
      );
      const size = h('select');
      size.disabled = !isHost;
      for (const [value, label] of [
        ['cozy', 'Cozy (3 guests)'],
        ['dinner', 'Dinner (5 guests)'],
        ['banquet', 'Banquet (7 guests)'],
        ['surprise', 'Surprise me'],
      ] as const) {
        const o = h('option', { value }, label);
        o.selected = v.size === value;
        size.append(o);
      }
      size.addEventListener('change', () => this.cb.send({ c: 'settings', size: size.value as PartySize }));
      const house = h('select');
      house.disabled = !isHost;
      for (const [value, label] of [['surprise', 'Surprise me (the seed picks)'], ...HOUSE_IDS.map((id) => [id, HOUSES[id].label])] as const) {
        const o = h('option', { value }, label);
        o.selected = v.house === value;
        house.append(o);
      }
      house.addEventListener('change', () => this.cb.send({ c: 'settings', house: house.value as HouseSetting }));
      const seed = h('input', { placeholder: 'random', maxlength: '24', value: v.seed });
      seed.disabled = !isHost;
      seed.addEventListener('change', () => this.cb.send({ c: 'settings', seed: seed.value }));
      seed.addEventListener('keydown', (e) => e.stopPropagation());
      const relaxed = h('input', { type: 'checkbox' });
      relaxed.checked = v.relaxed;
      relaxed.disabled = !isHost;
      relaxed.addEventListener('change', () => this.cb.send({ c: 'settings', relaxed: relaxed.checked }));
      const tutorial = h('input', { type: 'checkbox' });
      tutorial.checked = v.tutorial;
      tutorial.disabled = !isHost;
      tutorial.addEventListener('change', () => this.cb.send({ c: 'settings', tutorial: tutorial.checked }));
      const ready = h('button', null, me?.ready ? 'Not ready' : 'Ready (R)');
      ready.addEventListener('click', () => this.cb.send({ c: 'ready', ready: !me?.ready }));
      const start = h('button.secondary', null, 'Start now');
      start.hidden = !isHost;
      start.addEventListener('click', () => this.cb.send({ c: 'start' }));
      return [
        h('h3', null, 'Round the back of the catering van'),
        players,
        h('label', null, h('span', null, 'Party size'), size),
        h('label', null, h('span', null, 'House'), house),
        h('label', null, h('span', null, 'Seed'), seed),
        h('label.check', null, relaxed, h('span', null, 'Relaxed (slower guests, kinder timers)')),
        h('label.check', null, tutorial, h('span', null, 'First Shift (a gentle first dinner with hints)')),
        h('div.lb-look', null, ...this.lookControls(me)),
        h('div.lb-buttons', null, ready, start),
        h('small.hint', null, isHost ? 'Everyone ready starts the dinner. Or press E at the van.' : 'Waiting for everyone to get ready. The room host picks the party.'),
      ];
    });
  }

  private lookControls(me: PlayerView | undefined): HTMLElement[] {
    if (!me) return [];
    const row = (label: string, values: readonly string[], current: string, apply: (v: string) => Command, swatch: boolean) =>
      h(
        'div.lb-row',
        null,
        h('span', null, label),
        ...values.map((value) => {
          const b = h(swatch ? 'button.sw' : 'button.tx', { title: value }, swatch ? '' : value);
          if (swatch) b.style.background = value;
          b.classList.toggle('on', value === current);
          b.addEventListener('click', () => this.cb.send(apply(value)));
          return b;
        }),
      );
    return [
      row('Apron', APRONS, me.look.apron, (apron) => ({ c: 'look', look: { apron } }), true),
      row('Hat', HATS, me.look.hat, (hat) => ({ c: 'look', look: { hat: hat as (typeof HATS)[number] } }), false),
      row('Hair', HAIRS, me.look.hair, (hair) => ({ c: 'look', look: { hair: hair as (typeof HAIRS)[number] } }), false),
      row('Hair colour', HAIR_COLORS, me.look.hairColor, (hairColor) => ({ c: 'look', look: { hairColor } }), true),
      row('Skin', SKIN_TONES, me.look.skin, (skin) => ({ c: 'look', look: { skin } }), true),
    ];
  }

  // --- kitchen: the fridge ---------------------------------------------------------------------

  openFridge(): void {
    this.fridgeOpen = true;
    this.fridge.hidden = false;
    delete this.fridge.dataset.key;
  }

  closeFridge(): void {
    this.fridgeOpen = false;
    this.fridge.hidden = true;
  }

  /** Dishes the fridge offers right now (the current course; prep cooks for course one). */
  fridgeDishes(d: DinnerView): string[] {
    if (!d.active || d.menu.length === 0 || d.phase === 'ended' || d.phase === 'chase') return [];
    const idx = d.phase === 'dessert' ? d.menu.length - 1 : Math.min(d.course, d.menu.length - 1);
    return (d.menu[idx]?.dishes ?? []).filter((id) => isDish(id) && dishById(id).source === 'fridge');
  }

  private renderFridge(d: DinnerView): void {
    const dishes = this.fridgeDishes(d);
    renderIfChanged(this.fridge, dishes.join('|'), () => [
      h('h3', null, 'Fridge'),
      ...(dishes.length === 0
        ? [h('div', null, 'Nothing on the menu right now.')]
        : dishes.map((id, i) => {
            const dish = dishById(id);
            const row = h('div.option', null, h('b', null, String(i + 1)), h('span', null, dish.label), h('small', null, dish.steps.join(' → ') || 'ready to plate'));
            row.addEventListener('click', () => this.takeFromFridge(d, i));
            return row;
          })),
      h('small.hint', null, '1–9 or click to take one · E or Esc to close'),
    ]);
  }

  takeFromFridge(d: DinnerView, index: number): boolean {
    const id = this.fridgeDishes(d)[index];
    if (!id) return false;
    this.cb.send({ c: 'take', from: 'fridge', dish: id });
    this.closeFridge();
    this.cb.closePanels();
    return true;
  }

  // --- the whiteboard: guest notes -------------------------------------------------------------

  openNotes(): void {
    this.notesOpen = true;
    this.notes.hidden = false;
    delete this.notes.dataset.key;
  }

  closeNotes(): void {
    this.notesOpen = false;
    this.notes.hidden = true;
  }

  private renderNotes(v: GameView): void {
    const d = v.dinner;
    const key = JSON.stringify([d.guests.map((g) => [g.id, g.name, g.revealed]), v.notes]);
    renderIfChanged(this.notes, key, () => [
      h('h3', null, 'Whiteboard: who is what?'),
      ...(d.guests.length === 0
        ? [h('div', null, 'No guests yet.')]
        : d.guests.map((g) => {
            const current = v.notes.find((n) => n.guest === g.id)?.label ?? '';
            const sel = h('select');
            for (const label of NOTE_LABELS) {
              const o = h('option', { value: label }, label || '(no note)');
              o.selected = label === current;
              sel.append(o);
            }
            sel.addEventListener('change', () => this.cb.send({ c: 'note', guest: g.id, label: sel.value }));
            return h('label', null, h('span', null, `${g.name}${g.revealed ? ` (${typeLabel(g.revealed)})` : ''}`), sel);
          })),
      h('small.hint', null, 'Everyone sees the board. E or Esc to close.'),
    ]);
  }

  // --- the Small Talk wheel --------------------------------------------------------------------

  openWheel(hand: HandView | undefined, guest: GuestView): void {
    this.wheel.hidden = false;
    this.wheelPick = -1;
    const cards = hand?.cards ?? [];
    this.wheel.replaceChildren(
      h('div.wh-guest', null, `Small talk with ${guest.name}`),
      ...cards.map((card, i) => {
        const el = h(`div.wh-card.wh-${i}`, null);
        if (!card) {
          el.classList.add('cooling');
          el.append(`back in ${Math.ceil(hand?.cooldowns[i] ?? 0)}s`);
        } else {
          const t = topicById(card);
          el.append(chips(t.tags), h('div.label', null, t.label));
        }
        return el;
      }),
    );
  }

  /** Mouse movement while the wheel is open picks a card by direction. */
  steerWheel(x: number, y: number): void {
    if (Math.hypot(x, y) < 18) return;
    // Three slots: up-left (0), up (1), up-right (2); below the middle cancels.
    const a = Math.atan2(y, x);
    this.wheelPick = y > 25 ? -1 : a < -2.2 || a > 2.6 ? 0 : a > -0.9 ? 2 : 1;
    this.wheel.querySelectorAll('.wh-card').forEach((el, i) => el.classList.toggle('pick', i === this.wheelPick));
  }

  closeWheel(): number {
    this.wheel.hidden = true;
    const pick = this.wheelPick;
    this.wheelPick = -1;
    return pick;
  }

  get wheelOpen(): boolean {
    return !this.wheel.hidden;
  }

  // --- throwing --------------------------------------------------------------------------------

  setCharge(power: number | null): void {
    this.charge.hidden = power === null;
    if (power !== null) (this.charge.firstElementChild as HTMLElement).style.width = `${Math.round(power * 100)}%`;
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

  private renderResults(v: GameView, selfId: string): void {
    const show = v.phase === 'results' && v.dinner.result.outcome !== '';
    this.results.hidden = !show;
    if (!show) return;
    const r = v.dinner.result;
    const isHost = v.roomHost === selfId;
    renderIfChanged(this.results, `${v.dinner.seed}|${r.outcome}|${isHost}|${Math.ceil(v.resultsTime)}`, () => {
      const title =
        r.outcome === 'survived' ? 'You got through dinner!' : r.outcome === 'strikes' ? 'They made their excuses and left.' : 'EXPOSED. They know you are human.';
      const name = (id: string) => v.players.find((p) => p.id === id)?.name ?? 'A host';
      const back = h('button', null, 'Back to the van');
      back.hidden = !isHost;
      back.addEventListener('click', () => this.cb.send({ c: 'back' }));
      const again = h('button.secondary', null, 'Play this seed again');
      again.hidden = !isHost;
      again.addEventListener('click', () => {
        this.cb.send({ c: 'settings', seed: v.dinner.seed });
        this.cb.send({ c: 'back' });
      });
      return [
        h('h2', null, title),
        h('div.stars', null, '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars)),
        h('div.tips', null, `Tips: $${r.tips}`),
        h('blockquote', null, `“${r.review}”`),
        r.incidents.length > 0 ? h('h3', null, 'Highlights') : null,
        r.incidents.length > 0 ? h('ol.incidents', null, ...r.incidents.map((i) => h('li', null, `${formatClock(i.t)} · ${i.text}`))) : null,
        h('h3', null, 'Awards'),
        h('div.awards', null, ...r.awards.map((a) => h('div.award', null, h('b', null, a.title), h('span', null, name(a.player)), h('small', null, a.why)))),
        h('div.again', null, `Seed ${v.dinner.seed}`),
        h('div.lb-buttons', null, back, again),
        h('small.hint', null, `Back at the van in ${Math.ceil(v.resultsTime)}s.`),
      ];
    });
  }

  // --- network overlay (F3) --------------------------------------------------------------------

  renderNet(v: GameView, info: { online: boolean; code: string; ping: number; snapshotAge: number; fps: number; snaps: number }): void {
    this.netEl.hidden = !this.netOpen;
    if (!this.netOpen) return;
    const held = v.props.filter((p) => p.holder !== '');
    this.netEl.replaceChildren(
      h('div', null, info.online ? `Room ${info.code} · ping ${info.ping} ms · snapshot ${Math.round(info.snapshotAge)} ms old` : 'Solo (game runs in this tab)'),
      h('div', null, `${v.players.length}/${NET.maxPlayers} hosts · ${v.props.length} props · ${Math.round(info.fps)} fps · ${info.snaps} corrections`),
      ...held.map((p) => h('div', null, `prop ${p.id} (${p.kind}) held by ${v.players.find((x) => x.id === p.holder)?.name ?? p.holder}`)),
    );
  }
}

// ---------------------------------------------------------------------------------------------

export function phaseLabel(d: DinnerView): string {
  switch (d.phase) {
    case 'booking':
      return 'Booking';
    case 'prep':
      return 'Prep';
    case 'arrivals':
      return 'Arrivals';
    case 'course':
      return `Course ${d.course + 1}/${d.courses}`;
    case 'dessert':
      return 'Dessert';
    case 'chase':
      return 'RUN!';
    case 'ended':
      return 'Over';
    default:
      return '';
  }
}

/** The First Shift's running advice: one line for whatever matters most right now. */
export function firstShiftTip(v: GameView, selfId: string): string {
  const d = v.dinner;
  const mine = d.question.asker >= 0 && d.question.target === selfId;
  if (mine) return 'A guest asked you something. Answer with 1–3: a lie adds a rule to the Rumor Ledger, and you must keep it.';
  if (d.guests.some((g) => g.eyeing >= 0)) return 'A guest is eyeing someone hungrily. Feed them now: plated food, E on the guest.';
  if (d.guests.some((g) => g.slipping)) return 'Someone is slipping! Stand between them and the others, or distract the table with Small Talk.';
  switch (d.phase) {
    case 'booking':
      return 'The rumor on the Booking Card is what the guests believe about you. Cook the menu, keep the rumor true, and nobody mentions the moon.';
    case 'prep':
      return 'Open the fridge (E), take a dish, then follow its steps: chopping board → hob or oven → plate it at the pass.';
    case 'arrivals':
      if (d.guests.some((g) => g.where === 'door')) return 'Someone is at the front door. Answer it (E), and some guests need inviting in.';
      if (d.guests.some((g) => g.where === 'standing')) return 'A guest is standing about. Aim at them, press G, then pick an empty chair.';
      return 'Guests are arriving. Get the first course cooking while you wait.';
    case 'course':
      if (d.room.moonUp && d.room.curtainsOpen) return 'The moon is up and the curtains are open. Close them (E on the curtains) before the werewolf looks outside.';
      if (d.guests.some((g) => g.where === 'seated' && g.hunger > HUD.hungryShownAt)) return 'Hungry guests get dangerous. Plate a dish they can eat and serve it (E on the guest).';
      if (d.topic.holder >= 0) return 'Watch the tells over each guest. When one gets tense, aim at them and play a Small Talk card (right-click or 1–3).';
      return 'Keep the food coming and the talk flowing. Tab shows the Rumor Ledger.';
    case 'dessert':
      return 'Last stretch: serve dessert and keep everyone calm until the clock runs out.';
    default:
      return '';
  }
}

function isTalking(d: DinnerView): boolean {
  return d.phase === 'arrivals' || d.phase === 'course' || d.phase === 'dessert';
}

function chips(tags: readonly string[]): HTMLElement {
  return h('div.chips', null, ...tags.map((tag) => {
    const style = TAG_STYLE[tag as TopicTag];
    return h('span.chip', { style: `background:${style.color}` }, `${style.icon} ${tag}`);
  }));
}

function typeLabel(id: string): string {
  return id in GUEST_TYPES ? GUEST_TYPES[id as keyof typeof GUEST_TYPES].label : id;
}
