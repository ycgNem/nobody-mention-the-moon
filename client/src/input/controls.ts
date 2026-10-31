// Keyboard + mouse look. Keys work whenever the page has focus; mouse look needs pointer lock.

const LOOK_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;

export interface MoveIntent {
  /** Unit-length (or zero) direction in world XZ. */
  x: number;
  z: number;
  sprint: boolean;
}

export class Controls {
  yaw = 0;
  pitch = 0;
  private keys = new Set<string>();

  constructor(surface: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    surface.addEventListener('click', () => {
      if (document.pointerLockElement !== surface) void surface.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      document.body.classList.toggle('locked', document.pointerLockElement === surface);
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== surface) return;
      this.yaw -= e.movementX * LOOK_SENSITIVITY;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - e.movementY * LOOK_SENSITIVITY));
    });
  }

  intent(): MoveIntent {
    const f = Number(this.down('KeyW', 'ArrowUp')) - Number(this.down('KeyS', 'ArrowDown'));
    const r = Number(this.down('KeyD', 'ArrowRight')) - Number(this.down('KeyA', 'ArrowLeft'));
    const sprint = this.down('ShiftLeft', 'ShiftRight');
    if (f === 0 && r === 0) return { x: 0, z: 0, sprint };

    // Yaw 0 faces -Z; right is +X.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const x = -sin * f + cos * r;
    const z = -cos * f - sin * r;
    const len = Math.hypot(x, z);
    return { x: x / len, z: z / len, sprint };
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}
