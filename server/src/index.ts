import { NET } from '@moon/shared';
import { createGameServer } from './app.ts';

const server = await createGameServer({ devMode: process.env.NODE_ENV !== 'production' });
const port = Number(process.env.PORT ?? NET.port);
await server.listen(port);
console.log(`Nobody Mention the Moon server on ws://localhost:${port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void server.gracefullyShutdown(true));
}
