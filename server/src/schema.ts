// Network view of the room. Kept tiny in M0: who is here and where they are.

import { schema, t, type SchemaType } from '@colyseus/schema';

export const PlayerState = schema(
  {
    name: t.string(),
    color: t.string(),
    x: t.number(),
    y: t.number(),
    z: t.number(),
    yaw: t.number(),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const DinnerState = schema(
  {
    code: t.string(),
    asset: t.string(),
    players: t.map(PlayerState),
  },
  'DinnerState',
);
export type DinnerState = SchemaType<typeof DinnerState>;
