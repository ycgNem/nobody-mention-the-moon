// A dressed humanoid (blender/assets/characters/humanoid.py): outfit, hair, skin tone, accessory,
// apron and hat for hosts, slip reveals for monsters, and animation clips through a mixer.
// Falls back to a placeholder capsule figure if humanoid.glb isn't built.

import * as THREE from 'three';
import {
  ACCESSORY_MESHES,
  CLIPS,
  HAIR_MESHES,
  ONE_SHOT_CLIPS,
  OPTIONAL_MESHES,
  OUTFIT_MESHES,
  type ClipName,
} from '@moon/shared';
import { tint, type ModelLibrary } from './models.ts';

export interface CharacterLook {
  outfit: keyof typeof OUTFIT_MESHES;
  color: string;
  hair: string;
  hairColor: string;
  skin: string;
  accessory: string;
  body: string;
  apron?: string;
  hat?: string;
}

/** Ground speed the walk and run clips were authored at (humanoid.py). */
const WALK_CLIP_SPEED = 1.4;
const RUN_CLIP_SPEED = 2.7;
/**
 * Tall guests are scaled up only while standing. The rig's root bone points forward, so a bone
 * scale can't do it, and a seated tall guest at full scale would hover over the chair and table.
 */
const TALL_STANDING_SCALE = 1.06;

/** Torso widths per body preset. The neck undoes them, so a stout guest doesn't get a stout head. */
const BODY_SCALES: Record<string, [string, THREE.Vector3Tuple][]> = {
  stout: [
    ['spine', [1.18, 1, 1.15]],
    ['chest', [1.12, 1, 1.12]],
  ],
  tall: [],
  slim: [
    ['spine', [0.88, 1, 0.9]],
    ['chest', [0.9, 1, 0.92]],
  ],
  average: [],
};

export class Character {
  readonly root = new THREE.Group();
  /** Where held props go (the right hand, or in front of the chest on the placeholder). */
  readonly hand: THREE.Object3D;
  /** Top of the head, for name tags. */
  readonly headTop: number;
  private readonly mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  private current: ClipName | null = null;
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly parts = new Map<string, THREE.Object3D>();
  private readonly model: THREE.Object3D | null = null;
  private readonly standingScale: number;
  private sunglasses: THREE.Object3D | null = null;
  private seeThrough = false;

  constructor(lib: ModelLibrary, look: CharacterLook) {
    const model = lib.instance('humanoid');
    this.standingScale = look.body === 'tall' ? TALL_STANDING_SCALE : 1;
    if (model) {
      this.model = model;
      this.root.add(model);
      for (const name of OPTIONAL_MESHES) {
        const o = model.getObjectByName(name);
        if (o) {
          o.visible = false;
          this.parts.set(name, o);
        }
      }
      const show = (name: string | undefined, color?: string) => {
        if (!name) return;
        const o = model.getObjectByName(name);
        if (!o) return;
        o.visible = true;
        if (color) tint(o, color);
      };
      show(OUTFIT_MESHES[look.outfit], look.outfit === 'host' ? undefined : look.color);
      show(HAIR_MESHES[look.hair as keyof typeof HAIR_MESHES], look.hairColor);
      // The moustache is modelled white so it can take the hair colour.
      show(ACCESSORY_MESHES[look.accessory as keyof typeof ACCESSORY_MESHES], look.accessory === 'moustache' ? look.hairColor : undefined);
      if (look.accessory === 'sunglasses') this.sunglasses = model.getObjectByName(ACCESSORY_MESHES.sunglasses) ?? null;
      if (look.apron) show('apron', look.apron);
      const skin = model.getObjectByName('skin');
      if (skin) tint(skin, look.skin);
      let wide = 1;
      let deep = 1;
      for (const [bone, scale] of BODY_SCALES[look.body] ?? []) {
        model.getObjectByName(bone)?.scale.set(...scale);
        wide *= scale[0];
        deep *= scale[2];
      }
      model.getObjectByName('neck')?.scale.set(1 / wide, 1, 1 / deep);
      if (look.hat && look.hat !== 'none') {
        const hat = lib.part('hats', `hat_${look.hat}`);
        const socket = model.getObjectByName('socket_hat');
        if (hat && socket) socket.add(hat);
      }
      this.hand = model.getObjectByName('socket_hand_r') ?? this.root;
      // The hat socket sits on the crown (the bounding box would include hidden fur ears).
      model.updateMatrixWorld(true);
      const crown = model.getObjectByName('socket_hat')?.getWorldPosition(new THREE.Vector3());
      this.headTop = crown ? crown.y + 0.05 : 1.75;
      const gltf = lib.get('humanoid')!;
      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) {
        if (!(CLIPS as readonly string[]).includes(clip.name)) continue;
        const action = this.mixer.clipAction(clip);
        if (ONE_SHOT_CLIPS.includes(clip.name as ClipName)) {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        this.actions.set(clip.name as ClipName, action);
      }
    } else {
      this.hand = placeholder(this.root, look);
      this.headTop = 1.75;
    }
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const own = mats.map((m: THREE.Material) => (this.materials.includes(m as THREE.MeshStandardMaterial) ? m : m.clone()) as THREE.MeshStandardMaterial);
      o.material = own.length === 1 ? own[0]! : own;
      this.materials.push(...own);
      o.castShadow = true;
    });
    this.play('idle');
  }

  get animated(): boolean {
    return this.mixer !== null;
  }

  play(name: ClipName, fade = 0.25): void {
    if (this.current === name) return;
    // Seated clips (and the slip, played in the chair) keep normal size; see TALL_STANDING_SCALE.
    this.model?.scale.setScalar(name.startsWith('sit_') || name === 'slip' ? 1 : this.standingScale);
    const next = this.actions.get(name);
    if (!next) {
      this.current = name;
      return;
    }
    const prev = this.current ? this.actions.get(this.current) : undefined;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    prev?.fadeOut(fade);
    this.current = name;
  }

  get clip(): ClipName | null {
    return this.current;
  }

  /** Shows a monster's slip parts (fur, fangs, cape, eyes) and/or makes them see-through. */
  setSlip(parts: readonly string[], seeThrough: boolean, on: boolean): void {
    for (const name of parts) {
      const p = this.parts.get(name);
      if (p) p.visible = on;
    }
    // "The sunglasses slide down…": the eyes underneath are the gorgon's tell.
    if (this.sunglasses) this.sunglasses.visible = !(on && parts.includes('slip_eyes'));
    const ghost = seeThrough && on;
    if (ghost === this.seeThrough) return;
    this.seeThrough = ghost;
    for (const m of this.materials) {
      m.transparent = ghost;
      m.opacity = ghost ? 0.35 : 1;
      m.depthWrite = !ghost;
    }
  }

  /** Emissive glow for focus/selection, or a red stress glow. */
  setGlow(r: number, g: number, b: number): void {
    for (const m of this.materials) m.emissive?.setRGB(r, g, b);
  }

  setTint(color: THREE.ColorRepresentation | null): void {
    for (const m of this.materials) {
      const base = (m.userData.baseColor as THREE.Color | undefined) ?? m.color.clone();
      m.userData.baseColor = base;
      if (color === null) m.color.copy(base);
      else m.color.copy(base).lerp(new THREE.Color(color), 0.6);
    }
  }

  /** Matches the walk/run cycle to ground speed (m/s) so feet don't slide. */
  setSpeed(speed: number): void {
    const walk = this.actions.get('walk');
    const run = this.actions.get('run');
    if (walk) walk.timeScale = Math.max(0.5, Math.min(1.8, speed / WALK_CLIP_SPEED));
    if (run) run.timeScale = Math.max(0.6, Math.min(1.6, speed / RUN_CLIP_SPEED));
  }

  update(dt: number): void {
    this.mixer?.update(dt);
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }
}

/** Capsule body, round head, a nose to show facing (-Z). Returns the hand anchor. */
function placeholder(root: THREE.Group, look: CharacterLook): THREE.Object3D {
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, 0.7, 6, 12),
    new THREE.MeshStandardMaterial({ color: look.apron ?? look.color, roughness: 0.8 }),
  );
  body.position.y = 0.6;
  root.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.6 }));
  head.position.y = 1.5;
  root.add(head);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.08), head.material);
  nose.position.set(0, 1.5, -0.16);
  root.add(nose);
  const hand = new THREE.Object3D();
  hand.position.set(0.2, 1.1, -0.35);
  root.add(hand);
  return hand;
}
