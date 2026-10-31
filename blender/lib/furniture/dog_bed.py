"""Oval dog bed: a stuffed rim around a soft cushion. Length along X; the open side is +Y.

Params: length (0.9), width (0.7), rim, cushion (palette colors).
Meshes: {prefix}_body. The dog lies at about 0.08 m up.
Collider: one low box.
"""

from __future__ import annotations

import bpy

from .. import prims
from ._piece import Piece


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    length: float = 0.9,
    width: float = 0.7,
    rim: str = "cloth_red",
    cushion: str = "cloth_cream",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    major, minor = 0.5, 0.16
    ring = p.torus(major, minor, (0.0, 0.0, 0.0), rim, segments=12, sides=5)
    sx = (length / 2.0) / (major + minor)
    sy = (width / 2.0) / (major + minor)
    rim_h = 0.2
    prims.stretch(ring, (sx, sy, (rim_h / 2.0) / minor))
    # Sit the rim on the floor and squash it toward the front so the dog can step in.
    for v in ring.data.vertices:
        t = min(1.0, max(0.0, v.co.y) / (width / 2.0)) ** 1.5
        v.co.z = rim_h / 2.0 + v.co.z * (1.0 - 0.45 * t) - 0.04 * t
    p.blob((length / 2.0 - 0.1, width / 2.0 - 0.1, 0.07), (0.0, 0.0, 0.04), cushion, flat_bottom=0.55, segments=10, rings=5)
    p.collider((0.0, 0.0, rim_h / 2.0), (length, width, rim_h))
    return p.finish()
