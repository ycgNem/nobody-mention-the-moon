// Server entry. Dev (`npm run dev`): the game server on :2567, with Vite serving the client.
// Production (`npm start`, the Docker image): one process serves the built client, /healthz, /ice
// and the game WebSocket on PORT. See docs/HOSTING.md for every environment variable.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NET } from '@moon/shared';
import { createGameServer } from './app.ts';
import { attachHttp } from './http.ts';
import { createIceProvider } from './ice.ts';
import { logLine, serverStatus, startStatusLog } from './status.ts';

if (process.argv.includes('--production')) process.env.NODE_ENV = 'production';
const production = process.env.NODE_ENV === 'production';
const env = (name: string) => process.env[name] || undefined;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const staticOverride = env('STATIC_DIR');
const staticDir = staticOverride
  ? resolve(staticOverride)
  : production
    ? join(repoRoot, 'client', 'dist')
    : undefined;

if (staticDir && !existsSync(join(staticDir, 'index.html'))) {
  console.error(
    `No built client in ${staticDir}. Run \`npm run build\` first, or point STATIC_DIR at one.`,
  );
  process.exit(1);
}
// Read house layouts from the build the players download, so the server's house is theirs.
if (staticDir && !env('MODELS_DIR')) process.env.MODELS_DIR = join(staticDir, 'models');

const corsEnv = env('CORS_ORIGINS');
const corsOrigins: '*' | string[] =
  corsEnv === '*' ? '*' : corsEnv ? corsEnv.split(',').map((s) => s.trim()) : production ? [] : '*';

const server = await createGameServer({ devMode: !production });
const port = Number(env('PORT') ?? NET.port);
await server.listen(port, env('HOST'));

const httpServer = server.transport.server;
if (!httpServer) throw new Error('The Colyseus transport has no HTTP server');
const ice = createIceProvider();
attachHttp(httpServer, { staticDir, ice, status: serverStatus, corsOrigins });

if (production) {
  console.log(logLine('listening', { port, staticDir, build: env('BUILD_ID') ?? null }));
  void ice().then((c) =>
    console.log(logLine('ice', { source: c.source, servers: c.iceServers.length })),
  );
} else {
  console.log(`Nobody Mention the Moon server on ws://localhost:${port}`);
}
startStatusLog(Number(env('STATUS_LOG_SECONDS') ?? (production ? 300 : 0)));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (production) console.log(logLine('shutdown', { signal, ...serverStatus() }));
    void server.gracefullyShutdown(true);
  });
}
