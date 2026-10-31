import './style.css';
import './dinner.css';
import RAPIER from '@dimforge/rapier3d-compat';
import { DEFAULT_ROOM_CODE, FIRST_HOUSE, HOUSE_IDS, isHouseId, HOUSES, normalizeRoomCode, parseLayout, type Layout } from '@moon/shared';
import { AudioEngine } from './audio/index.ts';
import { GameClient } from './game/GameClient.ts';
import { Controls } from './input/controls.ts';
import { LocalLink, NetLink, type GameLink } from './net/link.ts';
import { ModelLibrary } from './render/models.ts';
import { PROP_MODELS } from './render/PropViews.ts';
import { createStage } from './render/stage.ts';
import { SettingsMenu, type SettingsValues } from './ui/Settings.ts';

const NAME_KEY = 'moon.name';
/** A static build with no game server (GitHub Pages): solo only. Set VITE_SOLO_ONLY=1 at build time. */
const SOLO_ONLY = (import.meta.env.VITE_SOLO_ONLY as string | undefined) === '1';
/** Loaded up front: the menu's house and everything every dinner needs. Other houses load on the way. */
const MODELS = [FIRST_HOUSE, 'humanoid', 'hats', ...PROP_MODELS];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const joinForm = $<HTMLFormElement>('join');
const nameInput = $<HTMLInputElement>('join-name');
const codeInput = $<HTMLInputElement>('join-code');
const joinError = $<HTMLParagraphElement>('join-error');
const soloButton = $<HTMLButtonElement>('join-solo');
const hud = $<HTMLDivElement>('hud');
const loading = $<HTMLParagraphElement>('join-loading');

const stage = createStage($('game'));
const controls = new Controls(stage.renderer.domElement);
const audio = new AudioEngine();
const lib = new ModelLibrary();
const layouts = new Map<string, Layout>();
let client: GameClient | null = null;
let link: GameLink | null = null;

const settings: SettingsMenu = new SettingsMenu(document.body, controls, audio, {
  apply: (s) => applySettings(s),
  testMic: async () => {
    const voice = client?.voice;
    if (!voice) return 'Join a dinner first (and click once so the browser allows sound).';
    const r = await voice.enableMic();
    return r === 'ok' ? 'Microphone on. Hold V to talk.' : r === 'denied' ? 'The browser blocked the microphone.' : r === 'insecure' ? 'Voice needs https (or localhost).' : 'No microphone found.';
  },
  speechCheck: (): string => client?.listening.describe(settings.values.speech) ?? 'Join a dinner first.',
  voices: () => client?.voicePeers() ?? [],
  setVoice: (id, change) => client?.setPeerVoice(id, change),
  leave: () => leave('You left the dinner.'),
});
$('settings-button').addEventListener('click', () => settings.toggle());

function prefsFrom(s: SettingsValues): GameClient['prefs'] {
  return { voiceMode: s.voiceMode, fov: s.fov, meters: s.meters, speech: s.speech, triggers: s.triggers };
}

function applySettings(s: SettingsValues): void {
  if (!client) return;
  client.prefs = prefsFrom(s);
  client.voice?.setMode(s.voiceMode);
  // Listening needs the mic; ask for it when the player turns the setting on.
  if (s.speech && client.voice?.micState === 'off') void client.voice.enableMic();
}

// Start loading everything we can before the player hits Join. Every house's layout is small and
// loads now (solo play needs them all to move house); the houses' models load when they're needed.
loading.hidden = false;
const ready: Promise<Layout[]> = Promise.all([
  RAPIER.init(),
  lib.preload(MODELS),
  Promise.all(HOUSE_IDS.map((id) => fetch(`${import.meta.env.BASE_URL}models/${id}.layout.json`).then(async (r) => parseLayout(await r.json())))),
]).then(([, , all]) => {
  loading.hidden = true;
  for (const l of all) layouts.set(l.asset, l);
  const house = menuHouse();
  if (house) stage.scene.add(house);
  return all;
});

function menuHouse() {
  return lib.get(FIRST_HOUSE)?.scene ?? null;
}

// A slow orbit around the house behind the join panel.
let orbiting = true;
const orbitStart = performance.now();
function orbit(now: number) {
  if (!orbiting) return;
  const t = (now - orbitStart) / 1000;
  stage.camera.position.set(-3 + Math.sin(t * 0.08) * 14, 6, 2 + Math.cos(t * 0.08) * 14);
  stage.camera.lookAt(-3, 0.5, 0);
  stage.render();
  requestAnimationFrame(orbit);
}
requestAnimationFrame(orbit);

if (SOLO_ONLY) {
  // No server to join here: keep the solo button and say where online play lives.
  for (const el of [codeInput.closest('label'), joinForm.querySelector('button[type="submit"]')]) el?.remove();
  const note = document.createElement('p');
  note.className = 'tag';
  note.textContent = 'This build is solo only. Online dinners need the game server (see docs/HOSTING.md).';
  soloButton.after(note);
  soloButton.classList.remove('secondary');
  soloButton.textContent = 'Play solo';
}
prefillJoin();

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  void start(SOLO_ONLY);
});
soloButton.addEventListener('click', () => void start(true));

function setBusy(busy: boolean) {
  for (const b of joinForm.querySelectorAll('button')) b.disabled = busy;
  joinError.hidden = true;
}

function showError(message: string) {
  joinError.textContent = message;
  joinError.hidden = false;
  setBusy(false);
}

function rememberName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // storage unavailable (private window); the name just isn't remembered
  }
}

export function newSeed(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `MOON-${[...bytes].map((b) => chars[b % chars.length]).join('')}`;
}

async function start(solo: boolean) {
  const name = nameInput.value.trim() || 'Host';
  const code = normalizeRoomCode(codeInput.value) || DEFAULT_ROOM_CODE;
  setBusy(true);
  try {
    const all = await ready;
    void audio.resume();
    let next: GameLink;
    if (solo) {
      const local = new LocalLink(all, name, newSeed);
      const seed = new URLSearchParams(location.search).get('seed');
      if (seed) local.send({ c: 'settings', seed });
      next = local;
    } else {
      next = await NetLink.join({ code, name });
    }
    rememberName(name);
    const url = new URL(location.href);
    if (solo) {
      url.searchParams.set('solo', '1');
      url.searchParams.delete('room');
    } else {
      url.searchParams.set('room', code);
      url.searchParams.delete('solo');
    }
    history.replaceState(null, '', url);
    await play(next);
  } catch (err) {
    console.error(err);
    showError(
      solo
        ? `Couldn't start: ${err instanceof Error ? err.message : String(err)}`
        : `Couldn't join: ${err instanceof Error ? err.message : String(err)}. Is the server running? You can still play solo.`,
    );
  }
}

async function play(next: GameLink) {
  link = next;
  next.onLeave((reason) => {
    if (link === next) leave(`Disconnected from the dinner (${reason}).`);
  });
  await enterHouse(next, next.view().asset || FIRST_HOUSE);
  orbiting = false;
  const menu = menuHouse();
  if (menu) stage.scene.remove(menu);
  joinForm.hidden = true;
  hud.hidden = false;
  if (import.meta.env.DEV) exposeDevHandle(next);

  // The game can move house (the lobby's pick, or the dinner seed's): follow it.
  let moving = false;
  let last = performance.now();
  const frame = (now: number) => {
    if (link !== next) return;
    const dt = (now - last) / 1000;
    last = now;
    const c = client;
    // While the next house loads, the old one holds still (solo pauses; online catches up after).
    if (c && !moving) c.frame(dt);
    const asset = next.view().asset;
    if (!moving && asset && c?.asset !== asset) {
      moving = true;
      void enterHouse(next, asset).finally(() => (moving = false));
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Builds the client for one house (loading its model first), replacing the previous one. */
async function enterHouse(forLink: GameLink, asset: string): Promise<void> {
  const name = isHouseId(asset) ? HOUSES[asset].label : asset;
  if (client) client.hud.toast(`Off to ${name.toLowerCase()}…`, 'big', 2);
  await lib.preload([asset]);
  const layout = layouts.get(asset);
  const house = lib.instance(asset);
  if (!layout || !house) throw new Error(`${asset} didn't load`);
  if (link !== forLink) return;
  client?.dispose();
  client = new GameClient({
    stage,
    lib,
    layout,
    house,
    link: forLink,
    controls,
    audio,
    hudParent: hud,
    prefs: prefsFrom(settings.values),
    onMenu: () => settings.toggle(),
  });
}

/** Dev-only handle for scripted testing, e.g. __moon.session.advance(30); __moon.renderOnce() */
function exposeDevHandle(l: GameLink) {
  (window as unknown as { __moon: object }).__moon = {
    controls,
    get local() {
      return client?.local;
    },
    room: l,
    get client() {
      return client;
    },
    session: {
      advance: (seconds: number) => (l instanceof LocalLink ? l.advance(seconds) : undefined),
      get state() {
        return l.view();
      },
      send: (cmd: Parameters<GameLink['send']>[0]) => l.send(cmd),
      /** Moves you there now (solo only), e.g. teleport([-5, 0, 0.5], Math.PI). */
      teleport: (feet: [number, number, number], yaw?: number) => {
        if (!(l instanceof LocalLink)) return;
        l.teleport(feet, yaw);
        client?.local.teleport(feet);
        if (yaw !== undefined) controls.yaw = yaw;
      },
    },
    stage,
    audio,
    renderOnce: () => client?.frame(1 / 60, false),
  };
}

function leave(message: string) {
  const c = client;
  const l = link;
  client = null;
  link = null;
  c?.dispose();
  l?.dispose();
  settings.toggle(false);
  hud.hidden = true;
  joinForm.hidden = false;
  showError(message);
  document.exitPointerLock();
  const menu = menuHouse();
  if (menu) stage.scene.add(menu);
  orbiting = true;
  requestAnimationFrame(orbit);
}

function prefillJoin() {
  const params = new URLSearchParams(location.search);
  let saved = '';
  try {
    saved = localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    // storage unavailable
  }
  nameInput.value = params.get('name') ?? saved;
  codeInput.value = normalizeRoomCode(params.get('room') ?? '') || DEFAULT_ROOM_CODE;
  if (params.get('solo') === '1') void start(true);
  else if (!SOLO_ONLY && params.get('autojoin') === '1' && nameInput.value) void start(false);
  else (nameInput.value && !SOLO_ONLY ? codeInput : nameInput).focus();
}
