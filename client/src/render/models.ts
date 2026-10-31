// Loads the Blender-built models once and hands out clones.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF | null>>();

/** How much of the baked AO also darkens direct light (Three's aoMap only touches indirect). */
const AO_DIRECT = 0.6;

/** models/<name>.glb (with its baked AO applied), or null if it doesn't exist (yet). Cached. */
export function loadModel(name: string): Promise<GLTF | null> {
  let p = cache.get(name);
  if (!p) {
    p = loader
      .loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`)
      .then(async (gltf) => {
        await applyBakedAo(gltf);
        return gltf;
      })
      .catch((err: unknown) => {
        console.warn(`[models] ${name}.glb unavailable`, err);
        return null;
      });
    cache.set(name, p);
  }
  return p;
}

/**
 * Baked ambient occlusion (blender/lib/bake.py): the glb names its texture in scene extras
 * (`aoMap`), and meshes with lightmap UVs (TEXCOORD_1, `uv1` here) carry `userData.lightmap`.
 * AO doesn't depend on any light, so it stays right while the game switches lights on and off.
 * Meshes without lightmap UVs (things that move, hide or glow) keep their plain material.
 */
async function applyBakedAo(gltf: GLTF): Promise<void> {
  const file: unknown = gltf.scene.userData.aoMap;
  if (typeof file !== 'string') return;
  const tex = await new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}models/${file}`).catch((err: unknown) => {
    console.warn(`[models] ${file} unavailable`, err);
    return null;
  });
  if (!tex) return;
  tex.flipY = false; // glTF UV convention
  tex.channel = 1;
  tex.colorSpace = THREE.NoColorSpace;
  // No mipmaps: an atlas of thousands of small islands bleeds between them when minified.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  const withAo = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.userData.lightmap || !o.geometry.getAttribute('uv1'))
      return;
    if (!(o.material instanceof THREE.MeshStandardMaterial)) return;
    let m = withAo.get(o.material);
    if (!m) {
      m = aoMaterial(o.material, tex);
      withAo.set(o.material, m);
    }
    o.material = m;
  });
}

function aoMaterial(
  src: THREE.MeshStandardMaterial,
  ao: THREE.Texture,
): THREE.MeshStandardMaterial {
  const m = src.clone();
  m.aoMap = ao;
  m.aoMapIntensity = 1;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.aoDirect = { value: AO_DIRECT };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float aoDirect;\nvoid main() {')
      .replace(
        '#include <aomap_fragment>',
        '#include <aomap_fragment>\n#ifdef USE_AOMAP\n\treflectedLight.directDiffuse *= mix( 1.0, ambientOcclusion, aoDirect );\n#endif',
      );
  };
  m.customProgramCacheKey = () => 'ao-direct';
  return m;
}

/** Loaded models by name, for synchronous lookups after preloading. */
export class ModelLibrary {
  private readonly loaded = new Map<string, GLTF | null>();

  async preload(names: string[]): Promise<void> {
    await Promise.all(names.map(async (n) => this.loaded.set(n, await loadModel(n))));
  }

  get(name: string): GLTF | null {
    return this.loaded.get(name) ?? null;
  }

  /** A fresh copy of a whole model, with shadows on. */
  instance(name: string): THREE.Object3D | null {
    const g = this.get(name);
    if (!g) return null;
    const o = cloneSkinned(g.scene);
    prepare(o);
    return o;
  }

  /** A copy of one named top-level object from a kit (food.glb, hats.glb). */
  part(kit: string, name: string): THREE.Object3D | null {
    const g = this.get(kit);
    const src = g?.scene.getObjectByName(name);
    if (!src) return null;
    const o = src.clone(true);
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    prepare(o);
    return o;
  }
}

/** Shadows, and glowing flames (meshes named flame_*). */
export function prepare(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (o.name.startsWith('flame_')) {
      const mat = (o.material as THREE.MeshStandardMaterial).clone();
      mat.emissive.set(0xffffff);
      mat.emissiveMap = mat.map;
      mat.emissiveIntensity = 1.6;
      o.material = mat;
      o.castShadow = false;
    }
  });
}

/** Gives a mesh its own material copy tinted by `color` (palette bases are white). */
export function tint(mesh: THREE.Object3D, color: string): void {
  mesh.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map((m: THREE.Material) => {
      const c = m.clone() as THREE.MeshStandardMaterial;
      c.color.set(color);
      return c;
    });
    if (o.material.length === 1) o.material = o.material[0]!;
  });
}
