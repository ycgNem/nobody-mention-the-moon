import './style.css';
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
} from '@moon/shared';
import { Controls } from './input/controls.ts';
import { joinDinner, type DinnerRoom, type PlayerView } from './net/connection.ts';
import { LocalPlayer } from './players/LocalPlayer.ts';
import { RemotePlayers } from './players/RemotePlayers.ts';
import { createStage, loadHouse } from './render/stage.ts';

const HOUSE = 'greybox';
const NAME_KEY = 'moon.name';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const joinForm = $<HTMLFormElement>('join');
const nameInput = $<HTMLInputElement>('join-name');
const codeInput = $<HTMLInputElement>('join-code');
const joinError = $<HTMLParagraphElement>('join-error');
const hud = $<HTMLDivElement>('hud');

const stage = createStage($('game'));
const controls = new Controls(stage.renderer.domElement);
const remotes = new RemotePlayers(stage.scene);

// Start loading everything we can before the player hits Join.
const ready: Promise<Layout> = Promise.all([
  RAPIER.init(),
  loadHouse(stage.scene, HOUSE),
  fetch(`/models/${HOUSE}.layout.json`).then((r) => r.json()),
]).then(([, , json]) => parseLayout(json));

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

async function join() {
  const name = nameInput.value.trim();
  const code = normalizeRoomCode(codeInput.value) || DEFAULT_ROOM_CODE;
  const button = joinForm.querySelector('button')!;
  button.disabled = true;
  joinError.hidden = true;
  try {
    const layout = await ready;
    const room = await joinDinner({ code, name });
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // storage unavailable (private window); the name just isn't remembered
    }
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    history.replaceState(null, '', url);
    await startPlaying(room, layout);
  } catch (err) {
    console.error(err);
    joinError.textContent = `Couldn't join: ${err instanceof Error ? err.message : String(err)}. Is the server running?`;
    joinError.hidden = false;
    button.disabled = false;
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

async function startPlaying(room: DinnerRoom, layout: Layout) {
  const me = await waitForSelf(room);
  const local = new LocalPlayer(layout, [me.x, me.y, me.z]);
  controls.yaw = me.yaw;
  controls.pitch = 0;

  orbiting = false;
  joinForm.hidden = true;
  hud.hidden = false;
  $('room-badge').textContent = `Room ${room.state.code}`;

  let pingMs = 0;
  let snaps = 0;
  const pingTimer = setInterval(() => room.ping((ms) => (pingMs = ms)), 2000);

  room.onLeave((code) => {
    clearInterval(pingTimer);
    running = false;
    hud.hidden = true;
    joinForm.hidden = false;
    joinForm.querySelector('button')!.disabled = false;
    joinError.textContent = `Disconnected from the dinner (code ${code}).`;
    joinError.hidden = false;
    remotes.sync([], room.sessionId);
    document.exitPointerLock();
    orbiting = true;
    requestAnimationFrame(orbit);
  });

  if (import.meta.env.DEV) {
    // Dev-only handle for scripted testing from the console: __moon.controls.yaw = 1.2
    (window as unknown as { __moon: object }).__moon = { controls, local, room };
  }

  let running = true;
  let last = performance.now();
  let sendAccumulator = 0;
  let rosterKey = '';

  const frame = (now: number) => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    local.update(dt, controls.intent());

    const players: [string, PlayerView][] = [];
    room.state.players.forEach((p, id) => players.push([id, p]));
    const self = room.state.players.get(room.sessionId);
    if (self && local.reconcile([self.x, self.y, self.z], dt)) snaps++;

    sendAccumulator += dt;
    if (sendAccumulator >= 1 / NET.sendRateHz) {
      sendAccumulator = 0;
      const [x, y, z] = local.feet;
      room.send(MSG.move, { x, y, z, yaw: controls.yaw } satisfies MoveMessage);
    }

    remotes.sync(players, room.sessionId);
    remotes.update(dt);

    const [fx, fy, fz] = local.feet;
    stage.camera.position.set(fx, fy + PLAYER.eyeHeight, fz);
    stage.camera.rotation.set(controls.pitch, controls.yaw, 0);
    stage.render();

    const key = players.map(([id, p]) => `${id}:${p.name}:${p.color}`).join('|');
    if (key !== rosterKey) {
      rosterKey = key;
      renderRoster(players, room.sessionId);
    }
    $('net').textContent =
      `${players.length}/${NET.maxPlayers} hosts · ping ${pingMs} ms · snaps ${snaps} · ` +
      `pos ${fx.toFixed(2)}, ${fz.toFixed(2)}`;

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
  if (params.get('autojoin') === '1' && nameInput.value) void join();
  else (nameInput.value ? codeInput : nameInput).focus();
}
