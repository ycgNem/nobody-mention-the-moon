// Loose props: plates, food at every stage of its recipe, bottles, paintings, candelabras…
// Drawn from the view (interpolated), except the one in your own hands, which follows your
// camera with no lag. Cooking progress, burnt smoke and kitchen fires show here too, as do the
// neighbour's dog and whatever a zombie guest just dropped.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PROPS, dishById, foodLook, isDish, type PropView } from '@moon/shared';
import type { ModelLibrary } from './models.ts';

interface View {
  root: THREE.Group;
  key: string;
  progress: HTMLDivElement;
  progressObj: CSS2DObject;
  fire: THREE.Group | null;
  flames: THREE.Object3D[];
}

/** Every glb a prop can need. */
export const PROP_MODELS = ['plate', 'wine_bottle', 'painting', 'candelabra', 'snow_globe', 'photo_frame', 'record', 'pot', 'pan', 'tea_towel', 'food', 'dog'];

export class PropViews {
  private readonly views = new Map<number, View>();
  private time = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly lib: ModelLibrary,
  ) {}

  object(id: number): THREE.Object3D | null {
    return this.views.get(id)?.root ?? null;
  }

  /** `poses`: interpolated [x, y, z, qx, qy, qz, qw] by prop id. `heldBySelf` is placed by the caller. */
  sync(props: PropView[], poses: Map<number, number[]>, heldBySelf: number, dt: number): void {
    this.time += dt;
    const seen = new Set<number>();
    for (const p of props) {
      seen.add(p.id);
      const key = `${p.kind}|${p.dish}|${p.burnt}|${p.plated}|${Math.min(p.stage, 9)}`;
      let v = this.views.get(p.id);
      if (v && v.key !== key) {
        this.remove(v);
        v = undefined;
      }
      if (!v) {
        v = this.build(p, key);
        this.views.set(p.id, v);
      }
      if (p.id !== heldBySelf) {
        const pose = poses.get(p.id) ?? [p.x, p.y, p.z, p.qx, p.qy, p.qz, p.qw];
        v.root.position.set(pose[0]!, pose[1]!, pose[2]!);
        v.root.quaternion.set(pose[3]!, pose[4]!, pose[5]!, pose[6]!).normalize();
      }
      // Cooking progress over items on a station (chopping strokes, hob, oven).
      const cooking = p.at !== '' && !p.at.startsWith('guest:') && !p.at.startsWith('home:') && p.kind === 'food';
      const showBar = cooking && (p.progress > 0 || p.burnt || p.fire);
      v.progressObj.visible = showBar;
      if (showBar) {
        const steps = isDish(p.dish) ? dishById(p.dish).steps : [];
        const done = p.stage >= steps.length;
        v.progress.className = `cook-bar${p.burnt ? ' burnt' : done ? ' done' : ''}`;
        v.progress.style.setProperty('--p', String(done ? 1 : p.progress));
        v.progress.dataset.label = p.fire ? 'FIRE!' : p.burnt ? 'burnt' : done ? 'ready' : (steps[p.stage] ?? '');
      }
      this.setFire(v, p.fire);
      for (const f of v.flames) f.scale.setScalar(0.85 + 0.25 * Math.sin(this.time * 17 + f.id));
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      this.remove(v);
      this.views.delete(id);
    }
  }

  private build(p: PropView, key: string): View {
    const root = new THREE.Group();
    const add = (o: THREE.Object3D | null, y = 0) => {
      if (!o) return;
      o.position.y = y;
      root.add(o);
    };
    const looks = isDish(p.dish) ? dishById(p.dish).looks : [];
    const food = () => {
      const name = foodLook(looks, p.stage, p.burnt);
      return name ? this.lib.part('food', name) : null;
    };
    if (p.kind === 'food') add(food() ?? fallbackBox(0.16, 0.06, 0.16, '#b0835a'));
    else if (p.kind === 'plate') {
      add(this.lib.instance('plate') ?? fallbackBox(0.26, 0.025, 0.26, '#f1ece0'));
      add(food(), 0.009);
    } else if (p.kind === 'part') {
      // A zombie's ear, finger or nose: small, grey-green, unmistakable once you look.
      const part = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshStandardMaterial({ color: '#8fa07a', roughness: 0.9 }));
      part.scale.set(1, 0.6, 1.4);
      part.position.y = 0.025;
      part.castShadow = true;
      root.add(part);
    } else {
      add(this.lib.instance(PROPS[p.kind].model) ?? fallbackBox(0.2, 0.2, 0.2, '#c8c8cc'));
    }
    const flames: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (o.name.startsWith('flame_')) flames.push(o);
      if (o.name === 'snow_globe_glass' && o instanceof THREE.Mesh) {
        const m = (o.material as THREE.MeshStandardMaterial).clone();
        m.transparent = true;
        m.opacity = 0.3;
        m.depthWrite = false;
        o.material = m;
      }
    });
    if (p.kind === 'candelabra') {
      const light = new THREE.PointLight(0xff9a3c, 0.8, 4, 2);
      light.position.y = 0.4;
      root.add(light);
    }
    const progress = document.createElement('div');
    progress.className = 'cook-bar';
    const progressObj = new CSS2DObject(progress);
    progressObj.position.y = 0.35;
    progressObj.visible = false;
    root.add(progressObj);
    this.scene.add(root);
    return { root, key, progress, progressObj, fire: null, flames };
  }

  private setFire(v: View, on: boolean): void {
    if (on && !v.fire) {
      const fire = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const flame = new THREE.Mesh(
          new THREE.ConeGeometry(0.06 + i * 0.01, 0.25 + (i % 2) * 0.1, 6),
          new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff6a1a : 0xffb347, transparent: true, opacity: 0.85 }),
        );
        flame.position.set(Math.sin(i * 2.4) * 0.07, 0.15, Math.cos(i * 2.4) * 0.07);
        fire.add(flame);
      }
      const light = new THREE.PointLight(0xff5a1a, 2.5, 5, 2);
      light.position.y = 0.4;
      fire.add(light);
      v.root.add(fire);
      v.fire = fire;
    } else if (!on && v.fire) {
      v.fire.removeFromParent();
      v.fire = null;
    }
    if (v.fire) {
      v.fire.children.forEach((c, i) => {
        c.scale.y = 0.8 + 0.4 * Math.abs(Math.sin(this.time * (9 + i) + i));
      });
    }
  }

  private remove(v: View): void {
    v.progress.remove();
    this.scene.remove(v.root);
  }

  dispose(): void {
    for (const v of this.views.values()) this.remove(v);
    this.views.clear();
  }
}

function fallbackBox(x: number, y: number, z: number, color: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), new THREE.MeshStandardMaterial({ color }));
  m.geometry.translate(0, y / 2, 0);
  m.castShadow = true;
  return m;
}
