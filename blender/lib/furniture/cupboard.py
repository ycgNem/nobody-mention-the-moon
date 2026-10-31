"""Tall two-door cupboard (pantry or wardrobe) on bun feet, with a cornice and panelled doors.
Back against -Y.

Params: width (1.0), depth (0.55), height (1.9), wood, door, panel, handle (palette colors).
Meshes: {prefix}_body. Collider: one box.
"""

from __future__ import annotations

import bpy

from ._piece import Piece


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    width: float = 1.0,
    depth: float = 0.55,
    height: float = 1.9,
    wood: str = "wood_dark",
    door: str = "wood_mid",
    panel: str = "wood_dark",
    handle: str = "brass",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    feet_h, crown_h = 0.07, 0.08
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cylinder(0.04, feet_h, (sx * (width / 2.0 - 0.08), sy * (depth / 2.0 - 0.08), 0.0), wood, segments=6, radius_top=0.052)
    body_h = height - feet_h - crown_h
    p.box((width, depth, body_h), (0.0, 0.0, feet_h + body_h / 2.0), wood, bevel=0.016)
    p.box((width + 0.08, depth + 0.06, crown_h), (0.0, 0.015, height - crown_h / 2.0), wood, bevel=0.018)
    p.box((width + 0.03, depth + 0.02, 0.04), (0.0, 0.005, feet_h + 0.02), wood)

    front = depth / 2.0
    dw = width / 2.0 - 0.05
    dh = body_h - 0.12
    dz = feet_h + 0.06 + dh / 2.0
    for s in (-1, 1):
        x = s * (width / 4.0)
        p.box((dw, 0.025, dh), (x, front + 0.008, dz), door, bevel=0.01)
        p.box((dw - 0.12, 0.012, dh * 0.36), (x, front + 0.024, dz + dh * 0.24), panel)
        p.box((dw - 0.12, 0.012, dh * 0.36), (x, front + 0.024, dz - dh * 0.22), panel)
        p.cylinder_y(0.02, 0.035, (s * 0.06, front + 0.035, dz + 0.02), handle, segments=6)

    p.collider((0.0, 0.015, height / 2.0), (width + 0.08, depth + 0.06, height))
    return p.finish()
