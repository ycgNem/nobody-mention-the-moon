"""Fat upholstered armchair: rolled arms, a leaning back and a puffy seat cushion on bun feet.
0.86 x 0.84 footprint, seat top at ~0.47 m, back top at ~1.0 m. The sitter faces +Y.

Params: fabric, cushion (palette colors; cushion defaults to the fabric), wood (feet).
Meshes: {prefix}_body. Collider: one box.
"""

from __future__ import annotations

import bpy

from ..prims import deg
from ._piece import Piece

W, D = 0.86, 0.84


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    fabric: str = "curtain_plum",
    cushion: str | None = None,
    wood: str = "wood_dark",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    feet_h = 0.07
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cylinder(0.035, feet_h, (sx * (W / 2.0 - 0.1), sy * (D / 2.0 - 0.1), 0.0), wood, segments=6, radius_top=0.045)
    base_top = 0.37
    p.box((W - 0.04, D - 0.04, base_top - feet_h), (0.0, 0.0, (feet_h + base_top) / 2.0), fabric, bevel=0.05)

    arm_w, arm_top = 0.17, 0.67
    for sx in (-1, 1):
        p.rounded_box((arm_w, D, arm_top - feet_h - 0.02), (sx * (W / 2.0 - arm_w / 2.0), 0.0, (feet_h + 0.02 + arm_top) / 2.0), fabric, radius=0.075)

    back_t, back_top = 0.2, 1.0
    p.rounded_box(
        (W - 0.06, back_t, back_top - base_top + 0.05),
        (0.0, -D / 2.0 + back_t / 2.0 + 0.02, (base_top - 0.05 + back_top) / 2.0),
        fabric,
        radius=0.085,
        rot=(deg(8), 0.0, 0.0),
    )
    seat_t = 0.1
    p.cushion((W - 2 * arm_w + 0.02, D - back_t - 0.02, seat_t), (0.0, back_t / 2.0 + 0.0, base_top + seat_t / 2.0 - 0.005), cushion or fabric, puff=0.3)

    p.collider((0.0, 0.0, back_top / 2.0), (W, D, back_top))
    return p.finish()
