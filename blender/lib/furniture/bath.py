"""Roll-top clawfoot bath: a soft rounded-rectangle tub on four brass feet, half full of water,
with a brass mixer tap at the -X end. Length along X; the long side faces +Y.

Params: length (1.65), width (0.78), height (0.62, rim), tub, feet (palette colors),
water (bool: the inside shows a water surface 0.24 m below the rim, else the porcelain floor).
Meshes: {prefix}_body.
Collider: one box.
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
    length: float = 1.65,
    width: float = 0.78,
    height: float = 0.62,
    tub: str = "porcelain",
    feet: str = "brass",
    water: bool = True,
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    lift = 0.13
    r = width / 2.0
    floor_z = height - 0.24 if water else lift + 0.08
    shell = p.lathe(
        [
            (r - 0.11, lift),
            (r - 0.03, lift + 0.07),
            (r - 0.005, lift + 0.28),
            (r, height - 0.035),
            (r - 0.02, height),
            (r - 0.05, height - 0.012),
            (r - 0.06, height - 0.07),
            (r - 0.08, floor_z),
            (0.0, floor_z),
        ],
        (0.0, 0.0, 0.0),
        tub,
        segments=16,
    )
    prims.squircle(shell, length / 2.0, r, r, power=3.2)
    if water:
        prims.paint_faces(shell, lambda f: "glass" if abs(f.center.z - floor_z) < 0.005 else None)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (length / 2.0 - 0.24), sy * (width / 2.0 - 0.12)
            # Claw foot: a bulb that splays out at the floor.
            p.lathe([(0.06, 0.0), (0.045, 0.03), (0.03, 0.07), (0.05, 0.12), (0.035, 0.15)], (x, y, 0.0), feet, segments=5)
    # Mixer tap on the -X rim.
    tx = -length / 2.0 + 0.035
    p.cylinder(0.016, 0.17, (tx, 0.0, height - 0.01), feet, segments=6)
    p.cylinder_x(0.014, 0.12, (tx + 0.05, 0.0, height + 0.15), feet, segments=6)
    p.cylinder(0.014, 0.05, (tx + 0.1, 0.0, height + 0.1), feet, segments=6)
    for s in (-1, 1):
        p.cylinder(0.012, 0.06, (tx, s * 0.08, height - 0.01), feet, segments=5)
        p.cylinder(0.026, 0.014, (tx, s * 0.08, height + 0.05), "porcelain", segments=6)

    p.collider((0.0, 0.0, height / 2.0), (length, width, height))
    return p.finish()
