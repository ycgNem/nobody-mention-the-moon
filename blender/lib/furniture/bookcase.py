"""Tall bookcase with a cornice, five shelves and rows of books (seeded, so rebuilds match).
Back against -Y.

Params: width (0.9), depth (0.32), height (1.9), wood (palette color), books (bool), seed.
Meshes: {prefix}_body. Collider: one box.
"""

from __future__ import annotations

import random

import bpy

from ..prims import deg
from ._piece import Piece

BOOK_COLORS = ("cloth_red", "cloth_blue", "cloth_green", "cloth_mustard", "leather", "curtain_plum", "cape_red", "cloth_cream", "denim")


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    width: float = 0.9,
    depth: float = 0.32,
    height: float = 1.9,
    wood: str = "wood_dark",
    books: bool = True,
    seed: int = 1,
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    rng = random.Random(seed)
    side_t, board_t, plinth_h, crown_h = 0.04, 0.025, 0.08, 0.06
    inner_w = width - 2 * side_t
    for s in (-1, 1):
        p.box((side_t, depth, height - crown_h), (s * (width - side_t) / 2.0, 0.0, (height - crown_h) / 2.0), wood, bevel=0.008)
    p.box((inner_w, depth - 0.02, plinth_h), (0.0, -0.01, plinth_h / 2.0), wood)
    p.box((width + 0.08, depth + 0.05, crown_h), (0.0, 0.015, height - crown_h / 2.0), wood, bevel=0.016)
    p.box((inner_w, 0.015, height - crown_h - plinth_h), (0.0, -depth / 2.0 + 0.0075, (height - crown_h + plinth_h) / 2.0), "wood_mid")

    levels = 5
    floor0 = plinth_h
    span = (height - crown_h - plinth_h) / levels
    for i in range(levels):
        z = floor0 + i * span
        if i > 0:
            p.box((inner_w, depth - 0.03, board_t), (0.0, 0.0, z), wood)
        if not books:
            continue
        shelf_top = z + (board_t / 2.0 if i else 0.0)
        if i == levels - 1:
            # Top shelf: a vase and a little box instead of books.
            p.lathe([(0.04, 0.0), (0.07, 0.08), (0.045, 0.17), (0.035, 0.2), (0.045, 0.22)], (-inner_w / 4.0, -0.01, shelf_top), "ceramic_blue", segments=6)
            p.box((0.16, 0.12, 0.08), (inner_w / 5.0, -0.01, shelf_top + 0.04), "brass", bevel=0.01, rot_z=0.2)
            continue
        x = -inner_w / 2.0 + 0.02
        end = inner_w / 2.0 - 0.02
        while x < end - 0.03:
            if rng.random() < 0.15:
                x += rng.uniform(0.06, 0.14)  # a gap
                continue
            bw = rng.uniform(0.04, 0.075)
            if x + bw > end:
                break
            bh = min(span - board_t - 0.04, rng.uniform(0.19, 0.27))
            bd = rng.uniform(0.17, 0.22)
            color = rng.choice(BOOK_COLORS)
            lean = rng.random() < 0.1
            if lean:
                p.box((bw, bd, bh), (x + bh * 0.25, -0.01, shelf_top + bh / 2.0 - 0.01), color, rot=(0.0, deg(24), 0.0))
                x += bh * 0.55
            else:
                p.box((bw, bd, bh), (x + bw / 2.0, -depth / 2.0 + 0.03 + bd / 2.0, shelf_top + bh / 2.0), color)
                x += bw + 0.002

    p.collider((0.0, 0.015, height / 2.0), (width + 0.08, depth + 0.05, height))
    return p.finish()
