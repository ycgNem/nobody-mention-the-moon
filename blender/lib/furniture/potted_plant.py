"""Potted plant in a terracotta pot.

Params: kind ("tree": a stem with lumpy leaf clusters, "bush": a round clump, "spiky": snake-plant
leaves), height (total, 1.1), pot, leaves (palette colors), seed (varies the leaves).
Meshes: {prefix}_body. Collider: one box around the pot, full height.
"""

from __future__ import annotations

import math
import random

import bpy

from .. import prims
from ._piece import Piece

POT_H, POT_R = 0.33, 0.2


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    kind: str = "tree",
    height: float = 1.1,
    pot: str = "terracotta",
    leaves: str = "plant_green",
    seed: int = 0,
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    rng = random.Random(seed)
    pot_obj = p.lathe(
        [(0.15, 0.0), (0.185, POT_H - 0.06), (0.205, POT_H - 0.055), (POT_R + 0.005, POT_H), (POT_R - 0.025, POT_H), (0.0, POT_H - 0.03)],
        (0.0, 0.0, 0.0),
        pot,
        segments=8,
    )
    prims.paint_faces(pot_obj, lambda f: "dog_dark" if math.hypot(f.center.x, f.center.y) < POT_R - 0.03 and f.center.z > POT_H - 0.04 else None)

    alt = "lettuce"
    if kind == "spiky":
        n = 7
        for i in range(n):
            a = 2 * math.pi * i / n + rng.uniform(-0.2, 0.2)
            lean = rng.uniform(0.08, 0.3)
            h = (height - POT_H + 0.05) * rng.uniform(0.7, 1.0)
            r = 0.05 * rng.uniform(0.8, 1.2)
            p.cone(r, h, (0.06 * math.cos(a), 0.06 * math.sin(a), POT_H - 0.05), leaves if i % 2 else alt, segments=4, rot=(0.0, lean, a))
    elif kind == "bush":
        top = max(height, POT_H + 0.25)
        r = (top - POT_H) * 0.55
        p.blob((r * 1.1, r * 1.1, r), (0.0, 0.0, top - r), leaves, wobble=0.12, seed=seed)
        for i in range(3):
            a = 2 * math.pi * i / 3 + rng.uniform(-0.3, 0.3)
            rr = r * 0.7
            p.blob((rr, rr, rr * 0.85), (r * 0.75 * math.cos(a), r * 0.75 * math.sin(a), POT_H + rr * 0.6), alt if i % 2 else leaves, segments=7, rings=5, wobble=0.12, seed=seed + i + 1)
    else:  # tree: a bare stem up to a crown of leaf clusters
        crown_r = min(0.26, (height - POT_H) * 0.32)
        crown_z = height - crown_r * 1.1
        p.cylinder(0.022, crown_z - POT_H + 0.03, (0.0, 0.0, POT_H - 0.03), "wood_mid", segments=5, radius_top=0.014)
        p.blob((crown_r, crown_r, crown_r * 0.9), (0.0, 0.0, crown_z), leaves, wobble=0.14, seed=seed * 7)
        a0 = rng.uniform(0, 2 * math.pi)
        for i in range(3):
            a = a0 + i * 2 * math.pi / 3 + rng.uniform(-0.3, 0.3)
            r = crown_r * rng.uniform(0.6, 0.72)
            off = crown_r * 0.75
            z = crown_z + crown_r * rng.uniform(-0.45, 0.2)
            p.blob((r, r, r * 0.85), (off * math.cos(a), off * math.sin(a), z), alt if i == 1 else leaves, segments=7, rings=5, wobble=0.14, seed=seed * 7 + i + 1)

    p.collider((0.0, 0.0, height / 2.0), (2 * POT_R, 2 * POT_R, height))
    return p.finish()
