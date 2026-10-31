import './style.css';
import './dinner.css';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  DEFAULT_ROOM_CODE,
  MSG,
  NET,
  PLAYER,
  normalizeRoomCode,
  parseLayout,
  type Layout,
  type MoveMessage,
  type Vec3,
} from '@moon/shared';
import { DinnerSession, newSeed } from './dinner/DinnerSession.ts';
import { Controls } from './input/controls.ts';
import { joinDinner, type DinnerRoom, type PlayerView } from './net/connection.ts';
import { LocalPlayer } from './players/LocalPlayer.ts';
import { RemotePlayers } from './players/RemotePlayers.ts';
import { createStage, loadHouse, type House } from './render/stage.ts';

const HOUSE = 'greybox';
const NAME_KEY = 'moon.name';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const joinForm = $<HTMLFormElement>('join');
const nameInput = $<HTMLInputElement>('join-name');
const codeInput = $<HTMLInputElement>('join-code');
const joinError = $<HTMLParagraphElement>('join-error');
const soloButton = $<HTMLButtonElement>('join-solo');
const hud = $<HTMLDivElement>('hud');

const stage = createStage($('game'));
const controls = new Controls(stage.renderer.domElement);
const remotes = new RemotePlayers(stage.scene);

// Start loading everything we can before the player hits Join.
const ready: Promise<{ layout: Layout; house: House }> = Promise.all([
  RAPIER.init(),
  loadHouse(stage.scene, HOUSE),
  fetch(`/models/${HOUSE}.layout.json`).then((r) => r.json()),
]).then(([, house, json]) => ({ house, layout: parseLayout(json) }));

// A slow orbit behind the join panel.
let orbiting = true;
const orbitStart = performance.now();
function orbit(now: number) {
  if (!orbiting) return;
  const t = (now - orbitStart) / 1000;
  stage.camera.position.set(Math.sin(t * 0.1) * 3, 2.2, Math.cos(t * 0.1) * 2.2);
  stage.camera.lookAt(0, 0.8, 0);
  stage.render();
  requestAnimationFrame(orbit);
}
requestAnimationFrame(orbit);

prefillJoin();

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  void join();
});
soloButton.addEventListener('click', () => void playSolo());

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

async function join() {
  const name = nameInput.value.trim();
  const code = normalizeRoomCode(codeInput.value) || DEFAULT_ROOM_CODE;
  setBusy(true);
  try {
    const { layout, house } = await ready;
    const room = await joinDinner({ code, name });
    rememberName(name);
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    url.searchParams.delete('solo');
    history.replaceState(null, '', url);
    const me = await waitForSelf(room);
    startPlaying({ layout, house, room, spawn: [me.x, me.y, me.z], yaw: me.yaw });
  } catch (err) {
    console.error(err);
    showError(`Couldn't join: ${err instanceof Error ? err.message : String(err)}. Is the server running? You can still play solo.`);
  }
}

async function playSolo() {
  setBusy(true);
  try {
    const { layout, house } = await ready;
    rememberName(nameInput.value.trim());
    const url = new URL(location.href);
    url.searchParams.set('solo', '1');
    history.replaceState(null, '', url);
    const spawn = layout.spawns[0];
    if (!spawn) throw new Error(`${HOUSE} has no spawn points`);
    startPlaying({ layout, house, room: null, spawn: spawn.position, yaw: spawn.yaw });
  } catch (err) {
    console.error(err);
    showError(`Couldn't start: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function waitForSelf(room: DinnerRoom): Promise<PlayerView> {
  return new Promise((resolve) => {
    const check = () => {
      const me = room.state.players?.get(room.sessionId);
      if (me) {
        room.onStateChange.remove(check);
        resolve(me);
      }
    };
    room.onStateChange(check);
    check();
  });
}

interface PlayOptions {
  layout: Layout;
  house: House;
  /** null = solo, no server. */
  room: DinnerRoom | null;
  spawn: Vec3;
  yaw: number;
}

function startPlaying({ layout, house, room, spawn, yaw }: PlayOptions) {
  const local = new LocalPlayer(layout, spawn);
  controls.yaw = yaw;
  controls.pitch = 0;

  orbiting = false;
  joinForm.hidden = true;
  hud.hidden = false;
  $('room-badge').textContent = room ? `Room ${room.state.code} · dinner is local to you until M3` : 'Solo dinner';

  const seed = new URLSearchParams(location.search).get('seed') ?? newSeed();
  const session = new DinnerSession(stage, house, layout, controls, hud, seed);

  let pingMs = 0;
  let snaps = 0;
  let running = true;
  const pingTimer = room ? setInterval(() => room.ping((ms) => (pingMs = ms)), 2000) : undefined;

  if (import.meta.env.DEV) {
    // Dev-only handle for scripted testing from the console, e.g. __moon.session.advance(30)
    (window as unknown as { __moon: object }).__moon = {
      controls,
      local,
      room,
      session,
      stage,
      renderOnce: () => {
        session.update(0, local.feet);
        stage.render();
      },
    };
  }

  room?.onLeave((code) => {
    clearInterval(pingTimer);
    running = false;
    session.dispose();
    hud.hidden = true;
    joinForm.hidden = false;
    showError(`Disconnected from the dinner (code ${code}).`);
    remotes.sync([], room.sessionId);
    document.exitPointerLock();
    orbiting = true;
    requestAnimationFrame(orbit);
  });

  let last = performance.now();
  let sendAccumulator = 0;
  let rosterKey = '';

  const frame = (now: number) => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    local.update(dt, controls.intent());
    const [fx, fy, fz] = local.feet;

    const players: [string, PlayerView][] = [];
    if (room) {
      room.state.players.forEach((p, id) => players.push([id, p]));
      const self = room.state.players.get(room.sessionId);
      if (self && local.reconcile([self.x, self.y, self.z], dt)) snaps++;
      sendAccumulator += dt;
      if (sendAccumulator >= 1 / NET.sendRateHz) {
        sendAccumulator = 0;
        room.send(MSG.move, { x: fx, y: fy, z: fz, yaw: controls.yaw } satisfies MoveMessage);
      }
      remotes.sync(players, room.sessionId);
      remotes.update(dt);
    }

    stage.camera.position.set(fx, fy + PLAYER.eyeHeight, fz);
    stage.camera.rotation.set(controls.pitch, controls.yaw, 0);
    session.update(dt, local.feet);
    stage.render();

    const key = players.map(([id, p]) => `${id}:${p.name}:${p.color}`).join('|');
    if (key !== rosterKey) {
      rosterKey = key;
      renderRoster(players, room?.sessionId ?? '');
    }
    $('net').textContent = room
      ? `${players.length}/${NET.maxPlayers} hosts · ping ${pingMs} ms · snaps ${snaps}`
      : `solo · seed ${session.state.seed}`;

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function renderRoster(players: [string, PlayerView][], selfId: string) {
  const list = $('roster');
  list.replaceChildren(
    ...players.map(([id, p]) => {
      const li = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = p.color;
      li.append(swatch, `${p.name}${id === selfId ? ' (you)' : ''}`);
      return li;
    }),
  );
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
  if (params.get('solo') === '1') void playSolo();
  else if (params.get('autojoin') === '1' && nameInput.value) void join();
  else (nameInput.value ? codeInput : nameInput).focus();
}
