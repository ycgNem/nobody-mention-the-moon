"""Small round pedestal side table with a lace doily.

Params: radius (0.27), height (0.62, top surface), wood, doily (palette color, None = no doily).
Meshes: {prefix}_body. Things set on it sit at `height` (+ 0.004 on the doily).
Collider: one box.
"""

from __future__ import annotations

import bpy

from ._piece import Piece


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    radius: float = 0.27,
    height: float = 0.62,
    wood: str = "wood_mid",
    doily: str | None = "cloth_cream",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    top_t = 0.04
    p.lathe([(0.19, 0.0), (0.19, 0.03), (0.12, 0.055), (0.0, 0.065)], (0.0, 0.0, 0.0), wood, segments=8)
    col_top = height - top_t
    p.lathe(
        [(0.05, 0.05), (0.03, 0.14), (0.042, col_top - 0.2), (0.026, col_top - 0.08), (0.06, col_top)],
        (0.0, 0.0, 0.0),
        "wood_dark",
        segments=6,
    )
    p.cylinder(radius, top_t, (0.0, 0.0, col_top), wood, segments=10, bevel=0.012)
    if doily:
        p.cylinder(radius * 0.6, 0.004, (0.0, 0.0, height), doily, segments=10)

    p.collider((0.0, 0.0, height / 2.0), (radius * 1.7, radius * 1.7, height))
    return p.finish()
