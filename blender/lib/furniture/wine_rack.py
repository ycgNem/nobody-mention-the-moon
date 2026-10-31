"""Freestanding wine rack: a grid of cubbies with bottles lying neck-out (seeded fill). Back
against -Y.

Params: width (0.66), depth (0.3), height (0.95), cols (3), rows (4), wood (palette color), seed.
Meshes: {prefix}_body. Collider: one box.
"""

from __future__ import annotations

import random

import bpy

from .. import prims
from ._piece import Piece

BOTTLE = [(0.039, 0.0), (0.041, 0.19), (0.016, 0.25), (0.015, 0.3)]


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    width: float = 0.62,
    depth: float = 0.3,
    height: float = 0.95,
    cols: int = 3,
    rows: int = 5,
    wood: str = "wood_mid",
    seed: int = 4,
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    rng = random.Random(seed)
    side_t, board_t, base_h, top_t = 0.03, 0.018, 0.05, 0.03
    for s in (-1, 1):
        p.box((side_t, depth, height - top_t), (s * (width - side_t) / 2.0, 0.0, (height - top_t) / 2.0), wood)
    p.box((width + 0.02, depth + 0.02, top_t), (0.0, 0.0, height - top_t / 2.0), wood, bevel=0.01)
    inner_w = width - 2 * side_t
    p.box((inner_w, depth, base_h), (0.0, 0.0, base_h / 2.0), "wood_dark")
    inner_h = height - top_t - base_h
    cell_h = (inner_h - (rows - 1) * board_t) / rows
    cell_w = (inner_w - (cols - 1) * board_t) / cols
    for r in range(1, rows):
        z = base_h + r * cell_h + (r - 0.5) * board_t
        p.box((inner_w, depth - 0.02, board_t), (0.0, 0.0, z), wood)
    for c in range(1, cols):
        x = -inner_w / 2.0 + c * cell_w + (c - 0.5) * board_t
        p.box((board_t, depth - 0.02, inner_h), (x, 0.0, base_h + inner_h / 2.0), wood)

    for r in range(rows):
        for c in range(cols):
            if rng.random() < 0.25:
                continue
            x = -inner_w / 2.0 + c * (cell_w + board_t) + cell_w / 2.0
            z = base_h + r * (cell_h + board_t) + 0.042
            glass = rng.choice(("wine", "glass_dark", "glass_dark"))
            foil = rng.choice(("gold", "cape_red", "black"))
            b = p.lathe(BOTTLE, (x, -depth / 2.0 + 0.03, z), glass, segments=5, rot=(-1.5707963, 0.0, 0.0))
            prims.paint_faces(b, lambda f, foil=foil: foil if f.center.z > 0.25 else None)

    p.collider((0.0, 0.0, height / 2.0), (width + 0.02, depth + 0.02, height))
    return p.finish()
