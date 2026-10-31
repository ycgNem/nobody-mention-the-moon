"""Freestanding kitchen island: cabinets with doors and drawers on the front (+Y), panelled back,
a thick butcher-block top at 0.92 m and a towel on a rail at the +X end.

Params: length (1.6), depth (0.9), cabinet, door, top, handle, towel (palette colors; towel=None
leaves the rail off).
Meshes: {prefix}_body. Things set on it sit at 0.92.
Collider: one box.
"""

from __future__ import annotations

import bpy

from . import _kitchen as k
from ._piece import Piece


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    length: float = 1.6,
    depth: float = 0.9,
    cabinet: str = k.CABINET,
    door: str = k.DOOR,
    top: str = k.TOP,
    handle: str = k.HANDLE,
    towel: str | None = "cloth_white",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    g = p.body
    top_t = 0.06
    body_d = depth - 0.1
    g.box((length - 0.06, body_d - 0.1, k.KICK_H), (0.0, 0.0, k.KICK_H / 2.0), "wood_dark")
    k.carcass(g, length, body_d, k.WORKTOP - top_t, cabinet)
    k.worktop(g, length + 0.1, depth, top, thickness=top_t)
    k.bays(g, length, body_d / 2.0, k.WORKTOP - top_t, door, handle, panel=cabinet)
    # Back: plain panels.
    n = max(1, round(length / 0.55))
    bay = length / n
    ph = k.WORKTOP - top_t - k.KICK_H - 0.12
    for i in range(n):
        x = -length / 2.0 + bay * (i + 0.5)
        g.box((bay - 0.08, 0.012, ph), (0.0 + x, -body_d / 2.0 - 0.004, k.KICK_H + 0.06 + ph / 2.0), door)
    if towel:
        x = length / 2.0 + 0.035
        rail_z = k.WORKTOP - top_t - 0.08
        for s in (-1, 1):
            g.box((0.04, 0.012, 0.012), (x - 0.015, s * 0.22, rail_z), handle)
        g.cylinder_y(0.009, 0.48, (x, 0.0, rail_z), handle, segments=5)
        g.box((0.012, 0.22, 0.34), (x + 0.012, 0.04, rail_z - 0.16), towel, bevel=0.004)
        g.box((0.014, 0.22, 0.03), (x + 0.012, 0.04, rail_z - 0.26), "cloth_red")

    p.collider((0.0, 0.0, k.WORKTOP / 2.0), (length + 0.1, depth, k.WORKTOP))
    return p.finish()
