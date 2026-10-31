// The other hosts: dressed humanoids in their aprons and hats, name tags with a speaking
// indicator, animated from how fast they move. Positions are interpolated snapshots.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { ClipName, PlayerView } from '@moon/shared';
import { Character } from './Character.ts';
import type { ModelLibrary } from './models.ts';

interface Remote {
  character: Character;
  tag: HTMLDivElement;
  tagObject: CSS2DObject;
  lookKey: string;
  last: THREE.Vector3;
  speed: number;
}

export class PlayerViews {
  private readonly remotes = new Map<string, Remote>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly lib: ModelLibrary,
  ) {}

  /** Where a host's right hand is (for their held prop), or null. */
  hand(id: string): THREE.Object3D | null {
    return this.remotes.get(id)?.character.hand ?? null;
  }

  sync(players: PlayerView[], selfId: string, poses: Map<string, number[]>, levels: (id: string) => number, dt: number): void {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === selfId) continue;
      seen.add(p.id);
      const lookKey = JSON.stringify(p.look);
      let r = this.remotes.get(p.id);
      if (r && r.lookKey !== lookKey) {
        this.remove(r);
        r = undefined;
      }
      if (!r) {
        r = this.spawn(p, lookKey);
        this.remotes.set(p.id, r);
      }
      const pose = poses.get(p.id) ?? [p.x, p.y, p.z, p.yaw];
      const root = r.character.root;
      root.position.set(pose[0]!, pose[1]!, pose[2]!);
      root.rotation.y = pose[3]!;
      const moved = root.position.distanceTo(r.last) / Math.max(dt, 1e-3);
      r.speed += (moved - r.speed) * Math.min(1, dt * 8);
      r.last.copy(root.position);
      let clip: ClipName = r.speed > 4 ? 'run' : r.speed > 0.4 ? 'walk' : 'idle';
      if (p.crouch) clip = 'crouch';
      if (p.held >= 0 && clip === 'idle') clip = 'carry';
      if (p.caught) clip = 'sit_idle';
      r.character.play(clip);
      r.character.setSpeed(r.speed);
      r.character.update(dt);
      const talking = p.speaking || levels(p.id) > 0.08;
      r.tag.classList.toggle('speaking', talking);
      r.tag.classList.toggle('away', !p.connected);
      r.tag.dataset.status = p.caught ? ' (caught!)' : p.escaped ? ' (in the van)' : !p.connected ? ' (reconnecting…)' : '';
    }
    for (const [id, r] of this.remotes) {
      if (seen.has(id)) continue;
      this.remove(r);
      this.remotes.delete(id);
    }
  }

  private spawn(p: PlayerView, lookKey: string): Remote {
    const character = new Character(this.lib, {
      outfit: 'host',
      color: p.look.apron,
      hair: p.look.hair,
      hairColor: p.look.hairColor,
      skin: p.look.skin,
      accessory: '',
      body: 'average',
      apron: p.look.apron,
      hat: p.look.hat,
    });
    character.root.position.set(p.x, p.y, p.z);
    this.scene.add(character.root);
    const tag = document.createElement('div');
    tag.className = 'nametag host';
    tag.textContent = p.name;
    tag.style.borderBottom = `2px solid ${p.look.apron}`;
    const tagObject = new CSS2DObject(tag);
    tagObject.position.y = character.headTop + 0.3;
    character.root.add(tagObject);
    return { character, tag, tagObject, lookKey, last: character.root.position.clone(), speed: 0 };
  }

  private remove(r: Remote): void {
    r.tag.remove();
    r.character.dispose();
  }

  dispose(): void {
    for (const r of this.remotes.values()) this.remove(r);
    this.remotes.clear();
  }
}
