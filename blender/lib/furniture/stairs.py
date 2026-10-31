"""A straight flight of stairs climbing toward +Y, with wooden treads, a carpet runner and an
optional banister. `location` is the center of the footprint (width x run) on the lower floor:
the first riser is at local y = -run/2 and the top step's back edge at y = +run/2, height `rise`.

Params: width (1.0), run (3.0), rise (2.6), wood, tread, runner (palette colors; runner=None
leaves the carpet off), rail (None, "-x", "+x" or "both": which open side gets a banister),
ramp_thickness (0.3).
Meshes: {prefix}_body.
Collider: ONE box tilted about local X, its top face a smooth ramp from the lower floor (half a
tread in front of the first riser) up to height `rise` (half a tread before the top edge), so
the walking surface runs through the middle of every tread.
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
    width: float = 1.0,
    run: float = 3.0,
    rise: float = 2.6,
    wood: str = "wood_mid",
    tread: str = "wood_light",
    runner: str | None = "carpet_red",
    rail: str | None = None,
    ramp_thickness: float = 0.3,
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    n = max(2, round(rise / 0.18))
    h, d = rise / n, run / n
    y0 = -run / 2.0
    tt, nose = 0.03, 0.025

    # The solid flight as one extruded stair profile (concave n-gon sides).
    outline = [(y0, 0.0), (y0 + run, 0.0)]
    for i in reversed(range(n)):
        z = (i + 1) * h - tt
        outline += [(y0 + (i + 1) * d, z), (y0 + i * d, z)]
    body = p.prism(outline, width, (0.0, 0.0, 0.0), wood)
    prims.paint_faces(body, lambda f: "wood_dark" if abs(f.normal.x) > 0.9 else None)
    for i in range(n):
        p.box((width + 0.02, d + nose, tt), (0.0, y0 + i * d + (d - nose) / 2.0, (i + 1) * h - tt / 2.0), tread)

    if runner:
        off = 0.004
        ry = -nose - 0.006
        path = [(y0 + ry, 0.0)]
        for i in range(n):
            z = (i + 1) * h + off
            path.append((y0 + i * d + ry, z))
            path.append((y0 + (i + 1) * d + (ry if i < n - 1 else 0.0), z))
        p.strip(path, width * 0.62, (0.0, 0.0, 0.0), runner)

    sides = {"-x": (-1,), "+x": (1,), "both": (-1, 1)}.get(rail or "", ())
    if sides:
        slope = math.atan2(rise, run)
        rail_h = 0.9
        for s in sides:
            x = s * (width / 2.0 - 0.04)
            for y, z_floor, post_h in ((y0 + 0.05, 0.0, h + 1.05), (y0 + run - 0.05, rise, 1.15)):
                p.box((0.08, 0.08, post_h), (x, y, z_floor + post_h / 2.0), "wood_dark", bevel=0.012)
                p.blob((0.05, 0.05, 0.045), (x, y, z_floor + post_h + 0.03), "wood_dark", segments=6, rings=4)
            length = math.hypot(run, rise) - 0.1
            p.box((0.06, length, 0.05), (x, 0.0, rise / 2.0 + rail_h + h / 2.0), "wood_dark", bevel=0.012, rot=(slope, 0.0, 0.0))
            for i in range(1, n - 1):
                yb = y0 + i * d + d / 2.0
                zb = (i + 1) * h
                top = rise / 2.0 + rail_h + h / 2.0 + (yb) * math.tan(slope) - 0.02
                p.box((0.025, 0.025, top - zb), (x, yb, (zb + top) / 2.0), "wood_dark")

    # One ramp collider through the middle of the treads.
    a = math.atan2(rise, run)
    length = math.hypot(run, rise)
    t = ramp_thickness
    center = (0.0, -d / 2.0 + math.sin(a) * t / 2.0, rise / 2.0 - math.cos(a) * t / 2.0)
    p.collider(center, (width, length, t), rot=(a, 0.0, 0.0))
    return p.finish()
