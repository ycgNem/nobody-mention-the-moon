"""Standard lamp: weighted base, thin pole, flared fabric shade with a bulb inside.

Params: height (1.6, top of the shade), shade, metal (palette colors).
Meshes: {prefix}_body, {prefix}_bulb (origin at the bulb's center, height - 0.27 m up: put the
light there; the client can make it glow).
Collider: one slim box.
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
    height: float = 1.6,
    shade: str = "cloth_cream",
    metal: str = "brass",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    p.lathe([(0.16, 0.0), (0.16, 0.025), (0.1, 0.05), (0.035, 0.075), (0.0, 0.08)], (0.0, 0.0, 0.0), metal, segments=8)
    shade_bottom, shade_top = height - 0.36, height
    pole_top = height - 0.24
    p.cylinder(0.014, pole_top - 0.07, (0.0, 0.0, 0.07), metal, segments=6)
    p.blob((0.03, 0.03, 0.025), (0.0, 0.0, 0.62), metal, segments=6, rings=4)
    p.cylinder(0.026, 0.05, (0.0, 0.0, pole_top - 0.05), metal, segments=6)
    # A thin shell: up the outside, back down the inside.
    p.lathe(
        [(0.25, shade_bottom), (0.15, shade_top), (0.14, shade_top - 0.01), (0.24, shade_bottom + 0.008), (0.25, shade_bottom)],
        (0.0, 0.0, 0.0),
        shade,
        segments=8,
        caps=False,
    )
    # A cross of spokes holding the shade.
    p.box((0.008, 0.29, 0.008), (0.0, 0.0, shade_top - 0.03), metal)
    p.box((0.29, 0.008, 0.008), (0.0, 0.0, shade_top - 0.03), metal)

    bulb_z = height - 0.27
    p.keep(prims.blob(p.name("bulb"), (0.05, 0.05, 0.065), (0.0, 0.0, bulb_z), "candle", segments=8, rings=5))

    p.collider((0.0, 0.0, height / 2.0), (0.3, 0.3, height))
    return p.finish()
