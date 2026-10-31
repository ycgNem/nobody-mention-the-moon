// Keyboard + mouse. Movement keys are polled; actions are rebindable (settings) and arrive as
// events. Mouse look needs pointer lock; while the Small Talk wheel is open, mouse movement
// steers the wheel instead of the camera.

const MAX_PITCH = Math.PI / 2 - 0.05;

export const ACTIONS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC', 'ControlLeft'],
  jump: ['Space'],
  interact: ['KeyE'],
  drop: ['KeyQ'],
  holdUp: ['KeyF'],
  reseat: ['KeyG'],
  talk: ['KeyV'],
  chat: ['Enter'],
  ledger: ['Tab'],
  overhead: ['KeyO'],
  ready: ['KeyR'],
  skip: ['KeyB'],
  netDebug: ['F3'],
  settings: ['Escape'],
} as const satisfies Record<string, readonly string[]>;
export type ActionName = keyof typeof ACTIONS;

const KEYS_STORAGE = 'moon.keys';

export function loadBindings(): Record<ActionName, string[]> {
  const out = Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, [...v]])) as Record<ActionName, string[]>;
  try {
    const saved = JSON.parse(localStorage.getItem(KEYS_STORAGE) ?? '{}') as Partial<Record<ActionName, string[]>>;
    for (const [k, v] of Object.entries(saved)) if (k in out && Array.isArray(v) && v.length > 0) out[k as ActionName] = v;
  } catch {
    // storage unavailable or corrupt: defaults
  }
  return out;
}

export function saveBindings(b: Record<ActionName, string[]>): void {
  try {
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(b));
  } catch {
    // storage unavailable
  }
}

export interface MoveIntent {
  /** Unit-length (or zero) direction in world XZ. */
  x: number;
  z: number;
  sprint: boolean;
  crouch: boolean;
}

export class Controls {
  yaw = 0;
  pitch = 0;
  sensitivity = 0.0022;
  invertY = false;
  /** False in the overhead view and in menus: clicks don't grab the mouse. */
  lookEnabled = true;
  /** While set, mouse movement goes here instead of the camera (the Small Talk wheel). */
  steer: ((dx: number, dy: number) => void) | null = null;
  bindings = loadBindings();
  private keys = new Set<string>();
  private jumpQueued = false;
  private actionListeners: ((a: ActionName, down: boolean, e: KeyboardEvent) => void)[] = [];
  private buttonListeners: ((button: number, down: boolean) => void)[] = [];

  constructor(private readonly surface: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code === 'F3') e.preventDefault();
      if (!e.repeat) {
        this.keys.add(e.code);
        if (this.bound('jump', e.code)) this.jumpQueued = true;
      }
      const a = this.actionFor(e.code);
      if (a && !e.repeat) for (const l of this.actionListeners) l(a, true, e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const a = this.actionFor(e.code);
      if (a) for (const l of this.actionListeners) l(a, false, e);
    });
    window.addEventListener('blur', () => this.keys.clear());

    surface.addEventListener('mousedown', (e) => {
      if (this.lookEnabled && document.pointerLockElement !== surface) {
        void surface.requestPointerLock();
        return;
      }
      for (const l of this.buttonListeners) l(e.button, true);
    });
    window.addEventListener('mouseup', (e) => {
      for (const l of this.buttonListeners) l(e.button, false);
    });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      document.body.classList.toggle('locked', document.pointerLockElement === surface);
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== surface) return;
      if (this.steer) {
        this.steer(e.movementX, e.movementY);
        return;
      }
      this.yaw -= e.movementX * this.sensitivity;
      const dy = e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy));
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.surface;
  }

  onAction(cb: (a: ActionName, down: boolean, e: KeyboardEvent) => void): void {
    this.actionListeners.push(cb);
  }

  onButton(cb: (button: number, down: boolean) => void): void {
    this.buttonListeners.push(cb);
  }

  bound(action: ActionName, code: string): boolean {
    return this.bindings[action].includes(code);
  }

  held(action: ActionName): boolean {
    return this.bindings[action].some((c) => this.keys.has(c));
  }

  private actionFor(code: string): ActionName | null {
    for (const [a, codes] of Object.entries(this.bindings)) if (codes.includes(code)) return a as ActionName;
    return null;
  }

  /** True once per press of the jump key. */
  /** Queues a jump (the gamepad's jump button). */
  jumpNext(): void {
    this.jumpQueued = true;
  }

  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  intent(): MoveIntent {
    const f = Number(this.held('forward')) - Number(this.held('back'));
    const r = Number(this.held('right')) - Number(this.held('left'));
    const sprint = this.held('sprint');
    const crouch = this.held('crouch');
    if (f === 0 && r === 0) return { x: 0, z: 0, sprint, crouch };

    // Yaw 0 faces -Z; right is +X.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const x = -sin * f + cos * r;
    const z = -cos * f - sin * r;
    const len = Math.hypot(x, z);
    return { x: x / len, z: z / len, sprint, crouch };
  }

  /** Gamepad: left stick moves, right stick looks (buttons are mapped in GameClient). Call once per frame. */
  pollGamepad(dt: number): { x: number; y: number; buttons: boolean[] } | null {
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (!pad) return null;
    const dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    this.yaw -= dead(pad.axes[2] ?? 0) * 2.6 * dt;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dead(pad.axes[3] ?? 0) * 2 * dt * (this.invertY ? -1 : 1)));
    return { x: dead(pad.axes[0] ?? 0), y: dead(pad.axes[1] ?? 0), buttons: pad.buttons.map((b) => b.pressed) };
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}
