// `npm run art [-- asset ...]`: builds 3D assets by running blender/build.py in headless Blender.
// Blender is found through BLENDER_PATH, then the usual install locations.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const CANDIDATES = [
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender\\blender.exe',
  'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  '/usr/bin/blender',
];

function findBlender(): string {
  const fromEnv = process.env.BLENDER_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`BLENDER_PATH points to a missing file: ${fromEnv}`);
    return fromEnv;
  }
  const found = CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error('Blender not found. Set BLENDER_PATH to blender.exe.');
  return found;
}

const blender = findBlender();
const assets = process.argv.slice(2);
const result = spawnSync(
  blender,
  ['-b', '--factory-startup', '--python-exit-code', '1', '-P', join(root, 'blender', 'build.py'), '--', ...assets],
  { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, maxBuffer: 64 * 1024 * 1024 },
);

if (result.error) throw result.error;

// The glTF exporter logs every primitive at INFO; keep warnings, errors and our own output.
const NOISE = [/^\d\d:\d\d:\d\d \| INFO:/, /^Blender \d/, /^Read prefs/, /^Blender quit/, /^$/];
const verbose = process.env.ART_VERBOSE === '1';
for (const line of `${result.stdout}${result.stderr}`.split(/\r?\n/)) {
  if (verbose || !NOISE.some((re) => re.test(line))) console.log(line);
}
process.exit(result.status ?? 1);
