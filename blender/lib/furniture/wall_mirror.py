"""Wall mirror, oval with a bow on top or rectangular, in a chunky frame. Back on the wall plane
y = 0, `location` on the floor under its center.

Params: shape ("oval" or "rect"), width (0.62), height (0.82), center_z (1.6), frame (palette
color), cover (palette color of a tea towel hung over it, or None).
Meshes: {prefix}_body (frame); {prefix}_glass (the mirror face, facing +Y; give it a reflective
material); {prefix}_cover when `cover` is set (the client shows it when the mirror is covered).
No collider (it sticks out less than 8 cm).
"""

from __future__ import annotations

import math

import bpy

from .. import prims
from ._piece import Piece


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    shape: str = "oval",
    width: float = 0.62,
    height: float = 0.82,
    center_z: float = 1.6,
    frame: str = "brass",
    cover: str | None = None,
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    fw = 0.035  # frame tube radius / bar half-width
    glass = p.group("glass")
    if shape == "oval":
        # Ring in the XZ plane: rot X by 90 deg turns the torus's local Y into world Z (up).
        rx = width / 2.0 - fw
        tall = (height / 2.0 - fw) / rx
        ring = p.torus(rx, fw, (0.0, fw, center_z), frame, segments=16, sides=4, rot=(math.pi / 2.0, 0.0, 0.0))
        prims.stretch(ring, (1.0, tall, 1.0))
        g = glass.cylinder(rx, 0.006, (0.0, fw * 0.6, center_z), "glass", segments=16, rot=(-math.pi / 2.0, 0.0, 0.0))
        prims.stretch(g, (1.0, tall, 1.0))
        # A bow on top.
        top = center_z + height / 2.0
        p.box((0.05, 0.04, 0.045), (0.0, fw, top), frame, bevel=0.012)
        for s in (-1, 1):
            p.blob((0.06, 0.02, 0.035), (s * 0.055, fw, top + 0.01), frame, segments=6, rings=4, rot=(0.0, s * 0.3, 0.0))
            p.box((0.025, 0.012, 0.09), (s * 0.03, fw, top - 0.06), frame, rot=(0.0, s * 0.35, 0.0))
    else:
        for s in (-1, 1):
            p.box((width, 0.045, 2 * fw), (0.0, 0.0225, center_z + s * (height / 2.0 - fw)), frame, bevel=0.012)
            p.box((2 * fw, 0.045, height - 4 * fw), (s * (width / 2.0 - fw), 0.0225, center_z), frame, bevel=0.012)
        glass.box((width - 2 * fw, 0.01, height - 2 * fw), (0.0, 0.02, center_z), "glass")

    if cover:
        # A striped tea towel thrown over the top, hanging down over the whole glass.
        c = p.group("cover")
        top = center_z + height / 2.0 + 0.05
        drop = height + 0.06
        y = 0.09
        c.cylinder_x(0.045, width + 0.1, (0.0, y - 0.035, top - 0.01), cover, segments=6)
        c.box((width + 0.08, 0.03, drop), (0.0, y, top - drop / 2.0), cover, bevel=0.012)
        for z in (top - drop + 0.07, top - drop + 0.12):
            c.box((width + 0.084, 0.034, 0.025), (0.0, y, z), "cloth_red")
    return p.finish()
