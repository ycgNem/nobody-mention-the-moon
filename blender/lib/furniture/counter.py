"""Kitchen base cabinet run with a butcher-block worktop at 0.92 m. Back against -Y; length runs
along X, so runs of counters, a stove and a sink line up edge to edge.

Params: length (1.2), depth (0.62), drawers (bool), cabinet, door, top, handle (palette colors).
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
    length: float = 1.2,
    depth: float = 0.62,
    drawers: bool = True,
    cabinet: str = k.CABINET,
    door: str = k.DOOR,
    top: str = k.TOP,
    handle: str = k.HANDLE,
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    g = p.body
    body_d = depth - 0.03
    k.kick(g, length, depth)
    k.carcass(g, length, body_d, k.WORKTOP - k.TOP_T, cabinet, y=-0.015)
    k.worktop(g, length, depth, top)
    k.bays(g, length, body_d / 2.0 - 0.015, k.WORKTOP - k.TOP_T, door, handle, panel=cabinet, drawers=drawers)
    p.collider((0.0, 0.0, k.WORKTOP / 2.0), (length, depth, k.WORKTOP))
    return p.finish()
