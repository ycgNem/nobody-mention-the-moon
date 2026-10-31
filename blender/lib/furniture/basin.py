"""Pedestal washbasin with two brass taps and a bar of soap. Footprint 0.56 x 0.42, back against
the wall at local y = -0.21.

Params: porcelain, taps, soap (palette colors).
Meshes: {prefix}_body. Rim at 0.86 m; the basin floor is 0.75 m up.
Collider: one box.
"""

from __future__ import annotations

import bpy

from ._piece import Piece

W, D, RIM = 0.56, 0.42, 0.86
BASIN_H = 0.17


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    porcelain: str = "porcelain",
    taps: str = "brass",
    soap: str = "rose",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    ped_top = RIM - BASIN_H + 0.02
    p.lathe(
        [(0.13, 0.0), (0.13, 0.025), (0.085, 0.07), (0.07, 0.4), (0.1, ped_top - 0.03), (0.1, ped_top), (0.0, ped_top)],
        (0.0, -0.02, 0.0),
        porcelain,
        segments=8,
    )
    p.hollow_box(
        (W, D, BASIN_H),
        (0.0, 0.0, RIM - BASIN_H / 2.0),
        porcelain,
        wall=0.06,
        depth=0.11,
        bevel=0.05,
        segments=2,
        floor="tile_white",
    )
    p.cylinder(0.022, 0.004, (0.0, 0.0, RIM - 0.11), "steel_dark", segments=6)
    for s in (-1, 1):
        x, y = s * 0.13, -D / 2.0 + 0.045
        p.cylinder(0.012, 0.09, (x, y, RIM), taps, segments=6)
        p.cylinder_y(0.01, 0.06, (x, y + 0.03, RIM + 0.08), taps, segments=5)
        p.box((0.07, 0.012, 0.012), (x, y, RIM + 0.1), taps)
        p.blob((0.012, 0.012, 0.012), (x, y, RIM + 0.11), "porcelain", segments=5, rings=4)
    p.box((0.075, 0.045, 0.025), (0.19, D / 2.0 - 0.06, RIM + 0.0125), soap, bevel=0.008, rot_z=0.3)

    p.collider((0.0, 0.0, RIM / 2.0), (W, D, RIM))
    return p.finish()
