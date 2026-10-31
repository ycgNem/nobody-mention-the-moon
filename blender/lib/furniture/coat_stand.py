"""Hall coat stand: a turned pole on a heavy round foot, four brass hooks, optionally a coat and a
bowler hat hanging on it.

Params: height (1.8), wood, hooks (palette colors), coat (palette color or None), hat (palette
color or None).
Meshes: {prefix}_body. Collider: one slim box.
"""

from __future__ import annotations

import math

import bpy

from ..prims import deg
from ._piece import Piece


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    height: float = 1.8,
    wood: str = "wood_dark",
    hooks: str = "brass",
    coat: str | None = "cloth_blue",
    hat: str | None = "cloth_black",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    p.lathe([(0.2, 0.0), (0.2, 0.035), (0.13, 0.07), (0.05, 0.1), (0.0, 0.1)], (0.0, 0.0, 0.0), wood, segments=8)
    p.lathe(
        [(0.035, 0.09), (0.024, 0.3), (0.026, height - 0.3), (0.036, height - 0.2), (0.024, height - 0.12)],
        (0.0, 0.0, 0.0),
        wood,
        segments=6,
    )
    p.blob((0.045, 0.045, 0.055), (0.0, 0.0, height - 0.07), wood, segments=6, rings=4)

    hook_z, hook_len, tilt = height - 0.2, 0.17, deg(55)
    for i in range(4):
        a = math.pi / 4.0 + i * math.pi / 2.0
        p.cylinder(0.011, hook_len, (0.0, 0.0, hook_z), hooks, segments=5, rot=(0.0, tilt, a))
        tip = 0.02 + hook_len * math.sin(tilt)
        p.blob((0.018, 0.018, 0.018), (tip * math.cos(a), tip * math.sin(a), hook_z + hook_len * math.cos(tilt)), hooks, segments=5, rings=4)

    if coat:
        # A long coat hanging from the hook at +X/+Y by its collar, flaring toward the hem.
        a = math.pi / 4.0
        r = 0.13
        cx, cy = r * math.cos(a), r * math.sin(a)
        coat_top = hook_z + hook_len * math.cos(tilt) - 0.02
        coat_h = 0.95
        p.tapered_box((0.15, 0.44, coat_h), (cx, cy, coat_top - coat_h), coat, top=(0.75, 0.55), bevel=0.035, rot_z=a)
        p.blob((0.09, 0.15, 0.05), (cx * 0.9, cy * 0.9, coat_top - 0.02), coat, segments=6, rings=4, rot_z=a)
        ox, oy = math.cos(a), math.sin(a)
        for i in range(3):
            z = coat_top - 0.25 - i * 0.17
            depth = 0.075 * (0.75 + 0.25 * (1 - (coat_top - z) / coat_h))
            p.box((0.02, 0.03, 0.03), (cx + ox * (depth + 0.008), cy + oy * (depth + 0.008), z), "brass", rot_z=a)
    if hat:
        a = math.pi / 4.0 + math.pi
        tip = 0.02 + hook_len * math.sin(tilt)
        hx, hy, hz = tip * math.cos(a), tip * math.sin(a), hook_z + hook_len * math.cos(tilt)
        p.cylinder(0.13, 0.012, (hx, hy, hz - 0.03), hat, segments=10, rot=(deg(-20), 0.0, a + math.pi / 2.0))
        p.blob((0.085, 0.085, 0.075), (hx, hy, hz - 0.025), hat, segments=8, rings=5, flat_bottom=0.0, rot=(deg(-20), 0.0, a + math.pi / 2.0))

    p.collider((0.0, 0.0, height / 2.0), (0.36, 0.36, height))
    return p.finish()
