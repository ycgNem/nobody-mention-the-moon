// Renderer, camera, lighting, and loading Blender-built models.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Ambient fill; dimmed when the dinner's lights go off. */
  fill: THREE.HemisphereLight;
  render(): void;
}

export interface House {
  root: THREE.Object3D;
  /** The pendant lamp over the table (on the light switch). */
  lamp: THREE.PointLight | null;
  byName(name: string): THREE.Object3D | undefined;
}

export function createStage(container: HTMLElement): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.style.position = 'fixed';
  labels.domElement.style.inset = '0';
  labels.domElement.style.pointerEvents = 'none';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0a10);
  scene.fog = new THREE.Fog(0x0c0a10, 12, 30);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 100);
  camera.rotation.order = 'YXZ';

  // Low warm fill so corners aren't pitch black; real light comes from the house's sockets.
  const fill = new THREE.HemisphereLight(0xffe2b8, 0x2a1c14, 0.7);
  scene.add(fill);
  // Moonlight through the north window (-Z). Nobody mention it.
  const moon = new THREE.DirectionalLight(0x8fa8ff, 0.35);
  moon.position.set(0.5, 3, -6);
  scene.add(moon);

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  return {
    renderer,
    labels,
    scene,
    camera,
    fill,
    render() {
      renderer.render(scene, camera);
      labels.render(scene, camera);
    },
  };
}

const loader = new GLTFLoader();

/** Meshes whose names start with these glow (emissive copy of the palette material). */
const GLOWING = ['flame_', 'moon'];

/**
 * Loads a model built by `npm run art`, turns `socket_*_light` empties into lights,
 * and sets up shadows.
 */
export async function loadHouse(scene: THREE.Scene, asset: string): Promise<House> {
  const gltf = await loader.loadAsync(`/models/${asset}.glb`);
  const root = gltf.scene;

  const lightSockets: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (GLOWING.some((p) => obj.name.startsWith(p))) {
        const mat = (obj.material as THREE.MeshStandardMaterial).clone();
        mat.emissive.set(0xffffff);
        mat.emissiveMap = mat.map;
        mat.emissiveIntensity = 1.5;
        obj.material = mat;
        obj.castShadow = false;
      }
    } else if (obj.name.startsWith('socket_') && obj.name.endsWith('_light')) {
      lightSockets.push(obj);
    }
  });

  let lamp: THREE.PointLight | null = null;
  for (const socket of lightSockets) {
    const isLamp = socket.name.includes('lamp');
    const light = isLamp
      ? new THREE.PointLight(0xffc98a, 9, 12, 1.6)
      : new THREE.PointLight(0xff9a3c, 0.6, 4, 2);
    if (isLamp) {
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.002;
      lamp = light;
    }
    socket.add(light);
  }

  scene.add(root);
  return { root, lamp, byName: (name) => root.getObjectByName(name) };
}
