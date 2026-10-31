// Renderer, camera and base lighting. Houses and props load through render/models.ts.

import * as THREE from 'three';
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
