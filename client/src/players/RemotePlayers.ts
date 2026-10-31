// Other hosts, drawn as placeholder capsules with an apron-colored body and a name tag.
// M0 smooths toward the latest server position; real snapshot interpolation lands in M3.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PALETTE, PLAYER, PLAYER_CENTER_OFFSET } from '@moon/shared';
import type { PlayerView } from '../net/connection.ts';

const SMOOTHING = 14; // higher = snappier

interface Remote {
  root: THREE.Group;
  target: THREE.Vector3;
  targetYaw: number;
  color: string;
}

export class RemotePlayers {
  private remotes = new Map<string, Remote>();

  constructor(private readonly scene: THREE.Scene) {}

  get count(): number {
    return this.remotes.size;
  }

  /** Adds, updates and removes remotes to match server state. */
  sync(players: Iterable<[string, PlayerView]>, selfId: string): void {
    const seen = new Set<string>();
    for (const [id, p] of players) {
      if (id === selfId) continue;
      seen.add(id);
      let r = this.remotes.get(id);
      if (!r) {
        r = this.spawn(p);
        this.remotes.set(id, r);
      }
      r.target.set(p.x, p.y, p.z);
      r.targetYaw = p.yaw;
    }
    for (const [id, r] of this.remotes) {
      if (seen.has(id)) continue;
      this.scene.remove(r.root);
      r.root.traverse((o) => {
        if (o instanceof CSS2DObject) o.element.remove();
      });
      this.remotes.delete(id);
    }
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-SMOOTHING * dt);
    for (const r of this.remotes.values()) {
      r.root.position.lerp(r.target, k);
      let d = r.targetYaw - r.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      r.root.rotation.y += d * k;
    }
  }

  private spawn(p: PlayerView): Remote {
    const root = new THREE.Group();
    root.position.set(p.x, p.y, p.z);
    root.rotation.y = p.yaw;

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.halfHeight * 2, 6, 12),
      new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.8 }),
    );
    body.position.y = PLAYER_CENTER_OFFSET;
    body.castShadow = true;
    root.add(body);

    // A face plate so you can tell which way they're looking (forward is -Z).
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.16, 0.08),
      new THREE.MeshStandardMaterial({ color: PALETTE.skin_host, roughness: 0.6 }),
    );
    face.position.set(0, PLAYER.eyeHeight - 0.05, -PLAYER.radius + 0.02);
    root.add(face);

    const tag = document.createElement('div');
    tag.className = 'nametag';
    tag.textContent = p.name;
    tag.style.borderBottom = `2px solid ${p.color}`;
    const label = new CSS2DObject(tag);
    label.position.y = PLAYER.eyeHeight + 0.45;
    root.add(label);

    this.scene.add(root);
    return { root, target: root.position.clone(), targetYaw: p.yaw, color: p.color };
  }
}
