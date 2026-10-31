"""Window for a hole in a wall: lined reveal, a painted frame with glazing bars, glass, and sills
inside (+Y) and out. `location` is on the floor under the opening's center, in the middle of the
wall's thickness; the opening spans local x -width/2..width/2 and z sill..sill+height.

Params: width (1.2), height (1.3), sill (0.9), wall_t (0.2), panes ((cols, rows) = (2, 3)),
frame, sill_color (palette colors).
Meshes: {prefix}_body; {prefix}_glass (all the glass, one thin slab in the middle of the wall:
give it a see-through material; the night and the moon go outside).
Collider: one box filling the opening (nobody climbs out of the window).
"""

from __future__ import annotations

import bpy

from ._piece import Piece


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    width: float = 1.2,
    height: float = 1.3,
    sill: float = 0.9,
    wall_t: float = 0.2,
    panes: tuple[int, int] = (2, 3),
    frame: str = "cloth_white",
    sill_color: str = "wood_light",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    top = sill + height
    cz = sill + height / 2.0
    lining = 0.02
    for s in (-1, 1):
        p.box((lining, wall_t, height), (s * (width / 2.0 - lining / 2.0), 0.0, cz), frame)
    p.box((width, wall_t, lining), (0.0, 0.0, top - lining / 2.0), frame)

    fw, fd = 0.06, 0.07
    for s in (-1, 1):
        p.box((width - 2 * lining, fd, fw), (0.0, 0.0, cz + s * (height / 2.0 - fw / 2.0)), frame, bevel=0.01)
        p.box((fw, fd, height - 2 * fw), (s * (width / 2.0 - lining - fw / 2.0), 0.0, cz), frame, bevel=0.01)
    cols, rows = panes
    inner_w = width - 2 * lining - 2 * fw
    inner_h = height - 2 * fw
    bar = 0.03
    for c in range(1, cols):
        x = -inner_w / 2.0 + c * inner_w / cols
        p.box((bar, fd - 0.02, inner_h), (x, 0.0, cz), frame)
    for r in range(1, rows):
        z = sill + fw + r * inner_h / rows
        p.box((inner_w, fd - 0.02, bar), (0.0, 0.0, z), frame)

    p.box((width + 0.14, 0.2, 0.04), (0.0, wall_t / 2.0 - 0.02, sill - 0.02), sill_color, bevel=0.012)
    p.box((width + 0.1, 0.14, 0.04), (0.0, -wall_t / 2.0 - 0.02, sill - 0.04), "stone", bevel=0.01)

    glass = p.group("glass")
    glass.box((inner_w + 0.02, 0.008, inner_h + 0.02), (0.0, 0.0, cz), "glass")

    p.collider((0.0, 0.0, cz), (width, wall_t, height))
    return p.finish()
