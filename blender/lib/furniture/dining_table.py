"""Dining table with turned legs, a draped tablecloth and a runner. Length runs along X.

Params: length (2.4), width (1.0), height (0.75, top of the wood), wood, legs, cloth, runner
(palette colors; runner=None leaves it out).
Meshes: {prefix}_body (wood), {prefix}_tablecloth, {prefix}_runner. Things set on the table sit
on the cloth at height + 0.012.
Collider: one box over the table and its drape.
"""

from __future__ import annotations

import math

import bpy

from .. import prims
from ._piece import Piece

CLOTH_T = 0.012
DROP = 0.16
FLARE = 0.05  # how much wider the drape is at its hem than at the table edge, per side


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    length: float = 2.4,
    width: float = 1.0,
    height: float = 0.75,
    wood: str = "wood_mid",
    legs: str = "wood_dark",
    cloth: str = "cloth_cream",
    runner: str | None = "cloth_red",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    top_t = 0.06
    p.box((length, width, top_t), (0.0, 0.0, height - top_t / 2.0), wood, bevel=0.02)
    p.box((length - 0.24, width - 0.24, 0.09), (0.0, 0.0, height - top_t - 0.045), legs)
    h = height - top_t
    turned = [(0.03, 0.0), (0.042, 0.05), (0.028, 0.14), (0.046, 0.42), (0.04, h)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.lathe(turned, (sx * (length / 2.0 - 0.12), sy * (width / 2.0 - 0.12), 0.0), legs, segments=6)

    # Tablecloth: the top sheet plus a drape that flares out toward its hem.
    top_z = height + CLOTH_T
    over = 0.05  # cloth overhang past the table edge at the top
    hem_l, hem_w = length + 2 * (over + FLARE), width + 2 * (over + FLARE)
    cloth_obj = prims.tapered_box(
        p.name("tablecloth"),
        (hem_l, hem_w, DROP),
        (0.0, 0.0, top_z - DROP),
        cloth,
        top=((length + 2 * over) / hem_l, (width + 2 * over) / hem_w),
        bevel=0.012,
    )
    p.keep(cloth_obj)

    if runner:
        rw, rt = 0.34, 0.005
        g = p.group("runner")
        g.box((length + 2 * over, rw, rt), (0.0, 0.0, top_z + rt / 2.0), runner)
        # The ends hang down the drape's slope.
        tilt = math.atan2(FLARE, DROP)
        hang = 0.12
        frac = (hang / 2.0) / DROP
        for s in (-1, 1):
            x = s * (length / 2.0 + over + FLARE * frac + 0.004)
            g.box((rt, rw, hang), (x, 0.0, top_z - hang / 2.0), runner, rot=(0.0, -s * tilt, 0.0))

    p.collider((0.0, 0.0, top_z / 2.0), (length + 2 * over, width + 2 * over, top_z))
    return p.finish()
