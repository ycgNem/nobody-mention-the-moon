// Loads a house layout from the Blender build output and builds the server's Rapier world.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildStaticWorld, parseLayout, type Layout } from '@moon/shared';

const BLENDER_OUTPUT = fileURLToPath(new URL('../../client/public/models/', import.meta.url));

/** The production server points MODELS_DIR at the built client's models, the files it serves. */
function modelsDir(): string {
  return process.env.MODELS_DIR || BLENDER_OUTPUT;
}

let rapierReady: Promise<void> | undefined;

export function initRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export async function loadLayout(asset: string): Promise<Layout> {
  const text = await readFile(join(modelsDir(), `${asset}.layout.json`), 'utf8');
  return parseLayout(JSON.parse(text));
}

export async function createWorld(asset: string) {
  await initRapier();
  const layout = await loadLayout(asset);
  return { layout, world: buildStaticWorld(RAPIER, layout) };
}
