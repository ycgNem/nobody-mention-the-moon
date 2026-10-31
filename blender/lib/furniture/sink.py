"""Kitchen sink unit: a deep porcelain Belfast sink set into a cabinet, with a brass gooseneck tap.
Worktop at 0.92 m, back against -Y, length along X.

Params: length (1.0, >= 0.8), depth (0.62), basin, tap, cabinet, door, top (palette colors).
Meshes: {prefix}_body. The basin's inside floor is 0.72 m up; the tap's spout ends over it at
about (0, -0.03, 1.1) local.
Collider: one box.
"""

from __future__ import annotations

import bpy

from . import _kitchen as k
from ._piece import Piece

SINK_W, SINK_D, SINK_H = 0.6, 0.46, 0.24


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    length: float = 1.0,
    depth: float = 0.62,
    basin: str = "porcelain",
    tap: str = "brass",
    cabinet: str = k.CABINET,
    door: str = k.DOOR,
    top: str = k.TOP,
) -> list[bpy.types.Object]:
    length = max(length, SINK_W + 0.2)
    p = Piece(prefix, location, rot_z, collide)
    g = p.body
    body_d = depth - 0.03
    sink_y = depth / 2.0 - SINK_D / 2.0 + 0.04  # proud of the cabinet front
    sink_bottom = k.WORKTOP - SINK_H
    side_w = (length - SINK_W) / 2.0
    back_d = (sink_y - SINK_D / 2.0) + depth / 2.0

    k.kick(g, length, depth)
    k.carcass(g, length, body_d, sink_bottom, cabinet, y=-0.015)
    # Cabinet sides and back up to the worktop, around the sink.
    block_h = k.WORKTOP - k.TOP_T - sink_bottom
    for s in (-1, 1):
        g.box((side_w, body_d, block_h), (s * (SINK_W + side_w) / 2.0, -0.015, sink_bottom + block_h / 2.0), cabinet)
        g.box((side_w, depth, k.TOP_T), (s * (SINK_W + side_w) / 2.0, 0.0, k.WORKTOP - k.TOP_T / 2.0), top, bevel=0.01)
    g.box((SINK_W, back_d, k.TOP_T), (0.0, -depth / 2.0 + back_d / 2.0, k.WORKTOP - k.TOP_T / 2.0), top, bevel=0.01)
    g.box((SINK_W, back_d, block_h), (0.0, -depth / 2.0 + back_d / 2.0, sink_bottom + block_h / 2.0), cabinet)

    g.hollow_box(
        (SINK_W, SINK_D, SINK_H),
        (0.0, sink_y, k.WORKTOP - SINK_H / 2.0),
        basin,
        wall=0.04,
        depth=SINK_H - 0.04,
        bevel=0.02,
        inner="tile_white",
    )
    g.cylinder(0.03, 0.006, (0.0, sink_y, sink_bottom + 0.04), "steel_dark", segments=6)
    k.bays(g, length, body_d / 2.0 - 0.015, sink_bottom, door, k.HANDLE, panel=cabinet, drawers=False, min_bay=length / 2.0)

    # Gooseneck tap behind the sink.
    ty = sink_y - SINK_D / 2.0 - 0.06
    g.cylinder(0.04, 0.02, (0.0, ty, k.WORKTOP), tap, segments=6)
    g.cylinder(0.016, 0.26, (0.0, ty, k.WORKTOP), tap, segments=6)
    g.cylinder_y(0.014, 0.17, (0.0, ty + 0.075, k.WORKTOP + 0.25), tap, segments=6)
    g.cylinder(0.014, 0.06, (0.0, ty + 0.15, k.WORKTOP + 0.2), tap, segments=6)
    for s in (-1, 1):
        g.cylinder(0.012, 0.07, (s * 0.1, ty, k.WORKTOP), tap, segments=5)
        g.box((0.07, 0.014, 0.014), (s * 0.1, ty, k.WORKTOP + 0.075), tap)

    p.collider((0.0, 0.02, k.WORKTOP / 2.0), (length, depth + 0.04, k.WORKTOP))
    return p.finish()
