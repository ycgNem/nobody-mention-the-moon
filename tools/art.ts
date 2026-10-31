// `npm run art [-- asset ...]`: builds 3D assets by running blender/build.py in headless Blender,
// then meshopt-compresses every .glb the run wrote. Blender is found through BLENDER_PATH, then
// the usual install locations.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = join(root, 'client', 'public', 'models');

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

/**
 * Meshopt compression (EXT_meshopt_compression, decoded by the client's GLTFLoader). This is the
 * gltf-transform `meshopt` recipe minus POSITION quantization: quantizing positions moves each
 * mesh into a unit box and puts the inverse into its node's transform, which would shift the
 * pivots the client relies on (door leaves swing about their origin, kit parts are placed at
 * position 0). Normals still get the octahedral filter, UVs/joints/weights are quantized.
 */
async function compress(
  io: NodeIO,
  path: string,
): Promise<{ before: number; after: number } | null> {
  const before = statSync(path).size;
  const doc = await io.read(path);
  if (
    doc
      .getRoot()
      .listExtensionsUsed()
      .some((e) => e.extensionName === EXTMeshoptCompression.EXTENSION_NAME)
  )
    return null;
  await doc.transform(
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({
      pattern: /^(TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/,
      patternTargets: /^(TEXCOORD|JOINTS|WEIGHTS|COLOR|NORMAL|TANGENT)(_\d+)?$/,
      quantizeTexcoord: 14, // lightmap UVs on a 2048 atlas want better than 12 bits
    }),
  );
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await io.write(path, doc);
  return { before, after: statSync(path).size };
}

const blender = findBlender();
const assets = process.argv.slice(2);
const started = Date.now();
const result = spawnSync(
  blender,
  [
    '-b',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '-P',
    join(root, 'blender', 'build.py'),
    '--',
    ...assets,
  ],
  {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 64 * 1024 * 1024,
  },
);

if (result.error) throw result.error;

// The glTF exporter logs every primitive at INFO; keep warnings, errors and our own output.
const NOISE = [
  /^\d\d:\d\d:\d\d \| INFO:/,
  /^Blender \d/,
  /^Read prefs/,
  /^Blender quit/,
  /^$/,
  /^Info: Baking map saved/,
  /^INFO (Draco|MeshOptimizer) is available/,
];
const verbose = process.env.ART_VERBOSE === '1';
for (const line of `${result.stdout}${result.stderr}`.split(/\r?\n/)) {
  if (verbose || !NOISE.some((re) => re.test(line))) console.log(line);
}

// Compress what this run exported (a failed asset leaves its old, already compressed file).
const written = readdirSync(modelsDir).filter(
  (f) => f.endsWith('.glb') && statSync(join(modelsDir, f)).mtimeMs >= started - 1000,
);
if (written.length) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO()
    .setLogger(new Logger(Logger.Verbosity.WARN))
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  for (const file of written.sort()) {
    const r = await compress(io, join(modelsDir, file));
    console.log(
      r
        ? `meshopt ${file}: ${kb(r.before)} → ${kb(r.after)}`
        : `meshopt ${file}: already compressed`,
    );
  }
}
process.exit(result.status ?? 1);
