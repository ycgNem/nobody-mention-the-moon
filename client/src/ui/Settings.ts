// The pause/settings menu: volumes, mouse, field of view, voice, accessibility and key bindings.
// Stored per device in localStorage. These are preferences, not progress (D-003): nothing here
// changes what a dinner is.

import type { AudioEngine, BusName } from '../audio/index.ts';
import { ACTIONS, saveBindings, type ActionName, type Controls } from '../input/controls.ts';
import { h } from './dom.ts';

const STORAGE = 'moon.settings';

export interface SettingsValues {
  volume: Record<BusName, number>;
  sensitivity: number;
  invertY: boolean;
  fov: number;
  voiceMode: 'ptt' | 'open';
  /** Composure meters over guests (an assist). */
  meters: boolean;
  /** Bigger HUD text and tags. */
  largeText: boolean;
  /** Calmer camera and fewer flashing effects. */
  reduceMotion: boolean;
  /** Listen for trigger words on this device (M5). Off until the player turns it on. */
  speech: boolean;
  /** Show every guest type's trigger words on the HUD (a gentler game, GDD §12). */
  triggers: boolean;
}

export const DEFAULT_SETTINGS: SettingsValues = {
  volume: { master: 0.9, sfx: 1, music: 0.8, murmur: 0.8, voice: 1 },
  sensitivity: 1,
  invertY: false,
  fov: 75,
  voiceMode: 'ptt',
  meters: false,
  largeText: false,
  reduceMotion: false,
  speech: false,
  triggers: false,
};

export function loadSettings(): SettingsValues {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? '{}') as Partial<SettingsValues>;
    return { ...DEFAULT_SETTINGS, ...saved, volume: { ...DEFAULT_SETTINGS.volume, ...(saved.volume ?? {}) } };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function save(s: SettingsValues): void {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(s));
  } catch {
    // storage unavailable: settings last for this visit
  }
}

/** Another host's voice, as this player has set it. Not saved: it's for this dinner. */
export interface VoicePeer {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
}

export interface SettingsHooks {
  apply(s: SettingsValues): void;
  testMic?(): Promise<string>;
  /** What the trigger-word listener is doing and the last word it heard (the "say: moon" check). */
  speechCheck?(): string;
  voices?(): VoicePeer[];
  setVoice?(id: string, change: Partial<Pick<VoicePeer, 'volume' | 'muted'>>): void;
  leave?(): void;
}

const ACTION_LABELS: Partial<Record<ActionName, string>> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Move left',
  right: 'Move right',
  sprint: 'Sprint',
  crouch: 'Crouch',
  jump: 'Jump',
  interact: 'Use / serve / greet',
  drop: 'Drop',
  holdUp: 'Hold it up (show the table)',
  reseat: 'Move a guest',
  talk: 'Push to talk',
  chat: 'Say something (text)',
  ledger: 'Rumor Ledger',
  overhead: 'Overhead view',
  ready: 'Ready (lobby)',
  skip: 'Ring the bell early',
  netDebug: 'Network overlay',
};

export class SettingsMenu {
  readonly root = h('div.settings.dh-panel');
  values: SettingsValues;
  private rebinding: ActionName | null = null;

  constructor(
    parent: HTMLElement,
    private readonly controls: Controls,
    private readonly audio: AudioEngine,
    private readonly hooks: SettingsHooks,
  ) {
    this.values = loadSettings();
    this.root.hidden = true;
    parent.append(this.root);
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.rebinding) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code !== 'Escape') {
          this.controls.bindings[this.rebinding] = [e.code];
          saveBindings(this.controls.bindings);
        }
        this.rebinding = null;
        this.build();
      },
      { capture: true },
    );
    this.apply();
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  toggle(open = !this.open): void {
    this.root.hidden = !open;
    if (open) {
      document.exitPointerLock();
      this.build();
    }
  }

  private apply(): void {
    const s = this.values;
    for (const [bus, v] of Object.entries(s.volume)) this.audio.setVolume(bus as BusName, v);
    this.controls.sensitivity = 0.0022 * s.sensitivity;
    this.controls.invertY = s.invertY;
    document.body.classList.toggle('large-text', s.largeText);
    document.body.classList.toggle('reduce-motion', s.reduceMotion);
    this.hooks.apply(s);
    save(s);
  }

  private build(): void {
    const s = this.values;
    const slider = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void) => {
      const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
      const out = h('output', null, value.toFixed(step < 1 ? 2 : 0));
      input.addEventListener('input', () => {
        set(Number(input.value));
        out.textContent = Number(input.value).toFixed(step < 1 ? 2 : 0);
        this.apply();
      });
      return h('label.range', null, h('span', null, label), input, out);
    };
    const check = (label: string, value: boolean, set: (v: boolean) => void) => {
      const input = h('input', { type: 'checkbox' });
      input.checked = value;
      input.addEventListener('change', () => {
        set(input.checked);
        this.apply();
      });
      return h('label.check', null, input, h('span', null, label));
    };
    const voice = h('select');
    for (const [v, label] of [
      ['ptt', 'Push to talk (V)'],
      ['open', 'Open mic'],
    ] as const) {
      const o = h('option', { value: v }, label);
      o.selected = s.voiceMode === v;
      voice.append(o);
    }
    voice.addEventListener('change', () => {
      s.voiceMode = voice.value as 'ptt' | 'open';
      this.apply();
    });
    const micOut = h('span.mic-result');
    const micButton = h('button.secondary', null, 'Test microphone');
    micButton.addEventListener('click', () => {
      micOut.textContent = '…';
      void this.hooks.testMic?.().then((r) => (micOut.textContent = r));
    });
    const speechOut = h('span.mic-result');
    const speechButton = h('button.secondary', null, 'Check: say "moon"');
    speechButton.addEventListener('click', () => {
      speechOut.textContent = this.hooks.speechCheck?.() ?? '';
    });
    const peers = this.hooks.voices?.() ?? [];
    const voices = peers.map((p) => {
      const vol = h('input', { type: 'range', min: '0', max: '1.5', step: '0.05', value: String(p.volume) });
      vol.addEventListener('input', () => this.hooks.setVoice?.(p.id, { volume: Number(vol.value) }));
      const mute = h('input', { type: 'checkbox' });
      mute.checked = p.muted;
      mute.addEventListener('change', () => this.hooks.setVoice?.(p.id, { muted: mute.checked }));
      return h('label.range', null, h('span', null, p.name), vol, h('label.check.inline', null, mute, h('span', null, 'mute')));
    });
    const keys = h(
      'div.keys',
      null,
      ...(Object.keys(ACTIONS) as ActionName[])
        .filter((a) => ACTION_LABELS[a])
        .map((a) => {
          const b = h('button.tx', null, this.rebinding === a ? 'press a key…' : this.controls.bindings[a].map(keyName).join(' / '));
          b.addEventListener('click', () => {
            this.rebinding = a;
            this.build();
          });
          return h('label', null, h('span', null, ACTION_LABELS[a]!), b);
        }),
    );
    const reset = h('button.secondary', null, 'Reset keys');
    reset.addEventListener('click', () => {
      for (const a of Object.keys(ACTIONS) as ActionName[]) this.controls.bindings[a] = [...ACTIONS[a]];
      saveBindings(this.controls.bindings);
      this.build();
    });
    const close = h('button', null, 'Back to dinner');
    close.addEventListener('click', () => this.toggle(false));
    const leave = h('button.secondary', null, 'Leave');
    leave.hidden = !this.hooks.leave;
    leave.addEventListener('click', () => this.hooks.leave?.());

    this.root.replaceChildren(
      h('h3', null, 'Settings'),
      h('h4', null, 'Sound'),
      slider('Master', s.volume.master, 0, 1, 0.05, (v) => (s.volume.master = v)),
      slider('Effects', s.volume.sfx, 0, 1, 0.05, (v) => (s.volume.sfx = v)),
      slider('Music', s.volume.music, 0, 1, 0.05, (v) => (s.volume.music = v)),
      slider('Guests', s.volume.murmur, 0, 1, 0.05, (v) => (s.volume.murmur = v)),
      slider('Voice chat', s.volume.voice, 0, 1.5, 0.05, (v) => (s.volume.voice = v)),
      h('h4', null, 'Voice'),
      h('label', null, h('span', null, 'Mode'), voice),
      h('div.row', null, micButton, micOut),
      check('Listen for trigger words on this device (nothing is sent but the word)', s.speech, (v) => (s.speech = v)),
      h('div.row', null, speechButton, speechOut),
      ...(voices.length > 0 ? [h('h4', null, 'Other hosts'), ...voices] : []),
      h('h4', null, 'Controls'),
      slider('Mouse sensitivity', s.sensitivity, 0.2, 3, 0.05, (v) => (s.sensitivity = v)),
      check('Invert mouse Y', s.invertY, (v) => (s.invertY = v)),
      slider('Field of view', s.fov, 60, 100, 1, (v) => (s.fov = v)),
      h('h4', null, 'Accessibility'),
      check('Larger text', s.largeText, (v) => (s.largeText = v)),
      check('Reduce motion and flashing', s.reduceMotion, (v) => (s.reduceMotion = v)),
      check('Show guest composure meters (assist)', s.meters, (v) => (s.meters = v)),
      check('Show every trigger word on screen (a gentler game)', s.triggers, (v) => (s.triggers = v)),
      h('h4', null, 'Keys (click to rebind)'),
      keys,
      h('div.lb-buttons', null, close, reset, leave),
    );
  }
}

function keyName(code: string): string {
  if (code.startsWith('Arrow')) return `${code.slice(5)} arrow`;
  return code.replace(/^(Key|Digit)/, '').replace(/(Left|Right)$/, '');
}
