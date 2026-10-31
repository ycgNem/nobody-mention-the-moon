"""Garage workbench: thick top on square legs, a lower shelf with a red toolbox, a vise on the +X
front corner and a hammer and a tin on top.

Params: length (1.6), depth (0.7), height (0.9), top, legs (palette colors), clutter (bool).
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
    length: float = 1.6,
    depth: float = 0.7,
    height: float = 0.9,
    top: str = "wood_light",
    legs: str = "wood_mid",
    clutter: bool = True,
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    top_t = 0.07
    p.box((length, depth, top_t), (0.0, 0.0, height - top_t / 2.0), top, bevel=0.016)
    leg = 0.08
    lx, ly = length / 2.0 - 0.07, depth / 2.0 - 0.07
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((leg, leg, height - top_t), (sx * lx, sy * ly, (height - top_t) / 2.0), legs)
    for sy in (-1, 1):
        p.box((2 * lx, 0.03, 0.1), (0.0, sy * ly, height - top_t - 0.05), legs)
    p.box((2 * lx + leg, 2 * ly - 0.02, 0.03), (0.0, 0.0, 0.17), legs, bevel=0.006)

    if not clutter:
        p.collider((0.0, 0.0, height / 2.0), (length, depth, height))
        return p.finish()

    # Toolbox on the shelf.
    p.box((0.42, 0.22, 0.17), (-0.3, 0.0, 0.185 + 0.085), "red_bright", bevel=0.012)
    p.box((0.2, 0.03, 0.03), (-0.3, 0.0, 0.185 + 0.17 + 0.03), "black")
    # Vise on the front corner.
    vx, vy = length / 2.0 - 0.18, depth / 2.0
    p.box((0.16, 0.1, 0.1), (vx, vy - 0.06, height + 0.05), "metal_iron", bevel=0.01)
    p.box((0.16, 0.05, 0.1), (vx, vy + 0.04, height + 0.05), "metal_iron", bevel=0.01)
    p.cylinder_y(0.014, 0.18, (vx, vy + 0.1, height + 0.04), "metal_silver", segments=6)
    p.cylinder_x(0.009, 0.2, (vx, vy + 0.18, height + 0.04), "metal_silver", segments=5)
    # Hammer and a tin of nails.
    p.box((0.03, 0.26, 0.024), (-0.15, 0.05, height + 0.012), "wood_mid", rot_z=0.4)
    p.box((0.1, 0.035, 0.035), (-0.2, 0.17, height + 0.0175), "metal_iron", rot_z=0.4)
    p.cylinder(0.05, 0.1, (0.25, -0.15, height), "steel", segments=8)

    p.collider((0.0, 0.0, height / 2.0), (length, depth, height))
    return p.finish()
