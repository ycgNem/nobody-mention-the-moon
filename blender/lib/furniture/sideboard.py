"""Sideboard: a low cabinet on bun feet with a row of drawers over doors. Back against -Y.

Params: length (1.8), depth (0.5), height (0.9), wood, top, panel, handle (palette colors).
Meshes: {prefix}_body. Things set on it sit at `height`.
Collider: one box.
"""

from __future__ import annotations

import bpy

from ._piece import Piece


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    length: float = 1.8,
    depth: float = 0.5,
    height: float = 0.9,
    wood: str = "wood_dark",
    top: str = "wood_light",
    panel: str = "wood_mid",
    handle: str = "brass",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    feet_h, top_t = 0.08, 0.04
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cylinder(0.04, feet_h, (sx * (length / 2.0 - 0.08), sy * (depth / 2.0 - 0.07), 0.0), wood, segments=6, radius_top=0.052)
    body_h = height - feet_h - top_t
    p.box((length, depth, body_h), (0.0, 0.0, feet_h + body_h / 2.0), wood, bevel=0.016)
    p.box((length + 0.06, depth + 0.05, top_t), (0.0, 0.01, height - top_t / 2.0), top, bevel=0.014)

    n = max(2, round(length / 0.6))
    bay = (length - 0.08) / n
    front = depth / 2.0
    drawer_h = 0.12
    drawer_z = height - top_t - 0.03 - drawer_h / 2.0
    door_top = drawer_z - drawer_h / 2.0 - 0.025
    door_bottom = feet_h + 0.04
    for i in range(n):
        x = -length / 2.0 + 0.04 + bay * (i + 0.5)
        p.box((bay - 0.03, 0.02, drawer_h), (x, front + 0.008, drawer_z), panel, bevel=0.006)
        p.box((0.1, 0.022, 0.018), (x, front + 0.024, drawer_z), handle)
        dh = door_top - door_bottom
        p.box((bay - 0.03, 0.022, dh), (x, front + 0.009, door_bottom + dh / 2.0), panel, bevel=0.008)
        p.box((bay - 0.14, 0.01, dh - 0.12), (x, front + 0.024, door_bottom + dh / 2.0), wood)
        p.cylinder_y(0.017, 0.03, (x, front + 0.034, door_top - 0.08), handle, segments=6)

    p.collider((0.0, 0.01, height / 2.0), (length + 0.06, depth + 0.05, height))
    return p.finish()
