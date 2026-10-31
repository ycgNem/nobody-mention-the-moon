"""Flat patterned rug: a border, a field, an oval medallion and fringes on the short ends.
Length runs along X. About 2 cm thick in total.

Params: length (2.4), width (1.6), field, border, medallion, fringe (palette colors).
Meshes: {prefix}_body. No collider (players walk over it).
"""

from __future__ import annotations

import bpy

from .. import prims
from ._piece import Piece


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    length: float = 2.4,
    width: float = 1.6,
    field: str = "carpet_red",
    border: str = "rug",
    medallion: str = "cloth_mustard",
    fringe: str = "cloth_cream",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    t = 0.012
    p.box((length, width, t), (0.0, 0.0, t / 2.0), border)
    p.box((length - 0.18, width - 0.18, t), (0.0, 0.0, t / 2.0 + 0.003), field)
    r = min(length, width) * 0.24
    m = p.cylinder(r, 0.004, (0.0, 0.0, t + 0.002), medallion, segments=10)
    prims.stretch(m, (length / width, 1.0, 1.0))
    p.cylinder(r * 0.5, 0.004, (0.0, 0.0, t + 0.004), border, segments=8)
    for s in (-1, 1):
        p.box((0.05, width - 0.12, 0.005), (s * (length / 2.0 + 0.025), 0.0, 0.0025), fringe)
    return p.finish()
