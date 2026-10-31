// Loads a house layout from the Blender build output and builds the server's Rapier world.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildStaticWorld, parseLayout, type Layout } from '@moon/shared';

const MODELS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'public', 'models');

let rapierReady: Promise<void> | undefined;

export function initRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export async function loadLayout(asset: string): Promise<Layout> {
  const text = await readFile(join(MODELS_DIR, `${asset}.layout.json`), 'utf8');
  return parseLayout(JSON.parse(text));
}

export async function createWorld(asset: string) {
  await initRapier();
  const layout = await loadLayout(asset);
  return { layout, world: buildStaticWorld(RAPIER, layout) };
}
