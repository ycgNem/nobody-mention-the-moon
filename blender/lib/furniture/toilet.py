"""Victorian high-tank toilet: porcelain pedestal bowl with a wooden seat and the lid up against
the wall, a cast-iron cistern up high on brackets, brass flush pipe and a pull chain.
Footprint 0.42 x 0.62, back against the wall at local y = -0.31. The sitter faces +Y.

Params: porcelain, seat, cistern (palette colors).
Meshes: {prefix}_body. The pull-chain handle hangs at about (0.17, -0.2, 1.4) local.
Collider: one box around the bowl (the cistern is above head height).
"""

from __future__ import annotations

import math

import bpy

from .. import prims
from ..prims import deg
from ._piece import Piece

BACK = -0.31
BOWL_Y = 0.04
STRETCH_Y = 1.25
SEAT_Z = 0.4


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    porcelain: str = "porcelain",
    seat: str = "wood_dark",
    cistern: str = "metal_iron",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    bowl = p.lathe(
        [(0.12, 0.0), (0.1, 0.12), (0.115, 0.2), (0.175, 0.33), (0.18, SEAT_Z - 0.02), (0.14, SEAT_Z - 0.02), (0.06, 0.27), (0.0, 0.26)],
        (0.0, BOWL_Y, 0.0),
        porcelain,
        segments=8,
    )
    prims.stretch(bowl, (1.0, STRETCH_Y, 1.0))
    prims.paint_faces(bowl, lambda f: "glass" if f.center.z < 0.3 and math.hypot(f.center.x, f.center.y) < 0.08 and f.normal.z > 0.3 else None)
    p.box((0.2, 0.16, 0.16), (0.0, BACK + 0.09, SEAT_Z - 0.1), porcelain, bevel=0.03)

    ring = p.torus(0.15, 0.024, (0.0, BOWL_Y, SEAT_Z - 0.008), seat, segments=10, sides=4)
    prims.stretch(ring, (1.0, STRETCH_Y * 0.95, 0.7))
    p.box((0.36, 0.025, 0.44), (0.0, BACK + 0.06, SEAT_Z + 0.22), seat, bevel=0.012, rot=(deg(10), 0.0, 0.0))
    p.box((0.12, 0.05, 0.03), (0.0, BACK + 0.07, SEAT_Z + 0.005), "brass")

    # High cistern on brackets, flush pipe and pull chain.
    cz = 1.95
    p.box((0.46, 0.2, 0.25), (0.0, BACK + 0.1, cz), cistern, bevel=0.02)
    p.box((0.5, 0.22, 0.03), (0.0, BACK + 0.11, cz + 0.14), cistern, bevel=0.008)
    for s in (-1, 1):
        p.wedge((0.03, 0.16, 0.16), (s * 0.17, BACK + 0.08, cz - 0.205), cistern, rot=(0.0, math.pi, 0.0))
    pipe_y = BACK + 0.05
    p.cylinder(0.02, cz - 0.12 - (SEAT_Z - 0.08), (-0.12, pipe_y, SEAT_Z - 0.08), "brass", segments=6)
    p.box((0.12, 0.03, 0.03), (-0.06, pipe_y + 0.04, SEAT_Z - 0.06), "brass")
    p.box((0.008, 0.008, 0.48), (0.17, BACK + 0.11, cz - 0.125 - 0.24), "brass")
    p.cylinder(0.014, 0.09, (0.17, BACK + 0.11, cz - 0.125 - 0.48 - 0.09), "porcelain", segments=6)

    p.collider((0.0, -0.02, SEAT_Z / 2.0 + 0.02), (0.42, 0.58, SEAT_Z + 0.04))
    return p.finish()
