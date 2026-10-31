"""Dining chair, 0.45 x 0.45 footprint, seat top at 0.45 m (the greybox chair's size). The sitter
faces +Y; the back is at -Y.

Params: wood, cushion (palette colors), back_height (top of the back, 0.95).
Meshes: {prefix}_body. Collider: one box over the whole chair.
"""

from __future__ import annotations

import bpy

from ._piece import Piece

SEAT_Z = 0.45
W = 0.45


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    wood: str = "wood_dark",
    cushion: str = "cushion_green",
    back_height: float = 0.95,
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    pad = 0.04
    slab_top = SEAT_Z - pad
    p.box((W, W, 0.05), (0.0, 0.0, slab_top - 0.025), wood, bevel=0.014)
    p.cushion((0.41, 0.39, pad), (0.0, 0.012, slab_top + pad / 2.0), cushion, puff=0.35)

    leg_h = slab_top - 0.05
    for x in (-0.19, 0.19):
        # Front legs flare toward the seat; back legs run up into the back posts and narrow.
        p.tapered_box((0.04, 0.04, leg_h), (x, 0.19, 0.0), wood, top=(1.25, 1.25))
        p.tapered_box((0.048, 0.048, back_height), (x, -0.19, 0.0), wood, top=(0.8, 0.8))
        p.box((0.028, 0.34, 0.028), (x, 0.0, 0.13), wood)
    p.box((0.34, 0.028, 0.028), (0.0, 0.19, 0.17), wood)

    # Back: a chunky crest rail and one wide splat.
    rail_h = 0.12
    p.box((W + 0.03, 0.06, rail_h), (0.0, -0.19, back_height - rail_h / 2.0 - 0.01), wood, bevel=0.022)
    splat_bottom = slab_top + 0.01
    splat_top = back_height - rail_h
    p.box((0.15, 0.024, splat_top - splat_bottom), (0.0, -0.19, (splat_top + splat_bottom) / 2.0), "wood_mid", bevel=0.008)

    p.collider((0.0, 0.0, back_height / 2.0), (W, W, back_height))
    return p.finish()
