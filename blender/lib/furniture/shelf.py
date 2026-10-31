"""Wall shelf on two wooden brackets, optionally dressed with jars, a bottle and books (seeded).
Back on the wall plane y = 0, `location` on the floor under its center.

Params: length (1.0), depth (0.22), mount (1.5, top of the board above the floor), wood
(palette color), items (bool), seed.
Meshes: {prefix}_body. Things set on it sit at `mount`.
Collider: one box around the board and brackets (players bump their heads on it).
"""

from __future__ import annotations

import random

import bpy

from ._piece import Piece

JARS = ("ceramic_blue", "glass", "terracotta", "porcelain")


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    length: float = 1.0,
    depth: float = 0.22,
    mount: float = 1.5,
    wood: str = "wood_mid",
    items: bool = True,
    seed: int = 2,
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    t = 0.035
    p.box((length, depth, t), (0.0, depth / 2.0, mount - t / 2.0), wood, bevel=0.01)
    bh = 0.17
    for s in (-1, 1):
        # A wedge flipped upside down: tall against the wall, its top holding the board.
        p.wedge((0.035, depth - 0.03, bh), (s * (length / 2.0 - 0.12), (depth - 0.03) / 2.0, mount - t - bh / 2.0), "wood_dark", rot=(0.0, 3.14159265, 0.0))

    if items:
        rng = random.Random(seed)
        x = -length / 2.0 + 0.08
        end = length / 2.0 - 0.06
        y = depth / 2.0 + 0.01
        while x < end:
            r = rng.random()
            if r < 0.45:
                jr, jh = rng.uniform(0.045, 0.06), rng.uniform(0.1, 0.17)
                if x + 2 * jr > end:
                    break
                p.lathe([(jr * 0.9, 0.0), (jr, 0.02), (jr, jh - 0.025), (jr * 0.75, jh - 0.01), (jr * 0.75, jh)], (x + jr, y, mount), rng.choice(JARS), segments=6)
                p.cylinder(jr * 0.8, 0.018, (x + jr, y, mount + jh), "copper", segments=6)
                x += 2 * jr + 0.03
            elif r < 0.6:
                p.lathe([(0.03, 0.0), (0.032, 0.17), (0.012, 0.23), (0.012, 0.26)], (x + 0.035, y, mount), rng.choice(("wine", "glass_dark")), segments=6)
                x += 0.1
            elif r < 0.8:
                n = rng.randint(2, 3)
                for i in range(n):
                    bw = rng.uniform(0.14, 0.2)
                    p.box((bw, 0.17, 0.035), (x + 0.1, y - 0.01, mount + 0.0175 + i * 0.035), rng.choice(("cloth_red", "cloth_blue", "leather", "cloth_green")), rot_z=rng.uniform(-0.15, 0.15))
                x += 0.24
            else:
                x += rng.uniform(0.06, 0.14)

    p.collider((0.0, depth / 2.0, mount - 0.1), (length, depth, 0.2))
    return p.finish()
