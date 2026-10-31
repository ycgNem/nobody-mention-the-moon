import { describe, expect, it } from 'vitest';
import { LayoutError, parseLayout } from './layout.ts';

export const minimalLayout = {
  version: 1,
  asset: 'test',
  colliders: [
    { name: 'col_box_floor', shape: 'box', center: [0, -0.1, 0], halfExtents: [5, 0.1, 5], rotation: [0, 0, 0, 1] },
    { name: 'col_box_table', shape: 'box', center: [0, 0.4, 0], halfExtents: [1, 0.4, 0.5], rotation: [0, 0, 0, 1] },
  ],
  seats: [{ id: 'seat_0', position: [0, 0, 1], yaw: 0 }],
  rooms: [{ id: 'dining', center: [0, 1.5, 0], halfExtents: [5, 1.5, 5] }],
  doors: [{ id: 'door_hall', a: 'dining', b: 'hall', position: [5, 0, 0] }],
  interactables: [{ id: 'interact_curtain', kind: 'curtain', position: [0, 1, -5] }],
  spawns: [{ id: 'spawn_0', position: [-3, 0, 0], yaw: 0 }],
};

describe('parseLayout', () => {
  it('accepts a valid layout', () => {
    const l = parseLayout(minimalLayout);
    expect(l.colliders).toHaveLength(2);
    expect(l.seats[0]?.id).toBe('seat_0');
  });

  it('rejects a bad version', () => {
    expect(() => parseLayout({ ...minimalLayout, version: 3 })).toThrow(LayoutError);
  });

  it('reads version 2 sockets and gives version 1 none', () => {
    expect(parseLayout(minimalLayout).sockets).toEqual([]);
    const v2 = { ...minimalLayout, version: 2, sockets: [{ id: 'plate_0', position: [0, 0.77, 0.6], yaw: 0 }] };
    expect(parseLayout(v2).sockets[0]?.id).toBe('plate_0');
    expect(() => parseLayout({ ...minimalLayout, version: 2 })).toThrow(/layout\.sockets/);
  });

  it('rejects unknown collider shapes with a path', () => {
    const bad = { ...minimalLayout, colliders: [{ ...minimalLayout.colliders[0], shape: 'mesh' }] };
    expect(() => parseLayout(bad)).toThrow(/layout\.colliders\[0\]\.shape/);
  });

  it('rejects malformed vectors', () => {
    const bad = { ...minimalLayout, spawns: [{ id: 's', position: [0, 0], yaw: 0 }] };
    expect(() => parseLayout(bad)).toThrow(/spawns\[0\]\.position/);
  });

  it('rejects non-finite numbers', () => {
    const bad = { ...minimalLayout, seats: [{ id: 's', position: [0, 0, 0], yaw: Number.NaN }] };
    expect(() => parseLayout(bad)).toThrow(LayoutError);
  });
});
