"""Interior panelled door that opens, with its frame (jambs and architraves on both faces).
`location` is the bottom center of the doorway, in the middle of the wall's thickness; the
opening spans local x -width/2..width/2 and z 0..height; +Y is the front face.

Params: width (0.9) and height (2.1) of the opening in the wall, wall_t (0.2), thickness (0.045),
hinge ("-x" or "+x": which jamb the leaf hangs on), door, frame, knob (palette colors),
with_frame (bool), leaf_name (full mesh name for the leaf instead of {prefix}_leaf, e.g.
"doorleaf_hall" for house_a's convention), leaf_collider (bool).
Meshes: {prefix}_body (the frame; left out when with_frame is False); {prefix}_leaf (or
leaf_name): modeled closed, knobs included, its origin on the hinge axis (the hinge-side edge,
middle of the leaf's thickness, on the floor). Rotate it about its local Z to swing it open
(either way; +90 deg turns a "-x" hinged leaf toward +Y).
Colliders: none by default (the doorway stays walkable). With leaf_collider (and collide), one
box over the closed leaf named col_box_{leaf name}, for the game to toggle.
"""

from __future__ import annotations

import bpy

from .. import prims, sockets
from ._piece import Piece

JAMB = 0.03


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    width: float = 0.9,
    height: float = 2.1,
    wall_t: float = 0.2,
    thickness: float = 0.045,
    hinge: str = "-x",
    door: str = "wood_dark",
    frame: str = "wood_mid",
    knob: str = "brass",
    with_frame: bool = True,
    leaf_name: str | None = None,
    leaf_collider: bool = False,
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    if with_frame:
        for s in (-1, 1):
            p.box((JAMB, wall_t + 0.01, height), (s * (width / 2.0 - JAMB / 2.0), 0.0, height / 2.0), frame)
        p.box((width, wall_t + 0.01, JAMB), (0.0, 0.0, height - JAMB / 2.0), frame)
        cw = 0.08
        for face in (-1, 1):
            y = face * (wall_t / 2.0 + 0.012)
            for s in (-1, 1):
                p.box((cw, 0.024, height + 0.02), (s * (width / 2.0 - JAMB + cw / 2.0), y, (height + 0.02) / 2.0), frame)
            p.box((width - 2 * JAMB + 2 * cw + 0.04, 0.03, 0.1), (0.0, face * (wall_t / 2.0 + 0.015), height + 0.05), frame, bevel=0.01)

    sign = 1 if hinge == "-x" else -1
    hx = -sign * (width / 2.0 - JAMB)
    lw = width - 2 * JAMB - 0.006
    lh = height - JAMB - 0.012
    z0 = 0.01
    leaf = p.group("leaf", origin=(hx, 0.0, 0.0))
    cx = hx + sign * (0.003 + lw / 2.0)
    leaf.box((lw, thickness, lh), (cx, 0.0, z0 + lh / 2.0), door, bevel=0.008)
    for face in (-1, 1):
        y = face * (thickness / 2.0 + 0.005)
        leaf.box((lw - 0.2, 0.012, lh * 0.36), (cx, y, z0 + lh * 0.74), "wood_mid", bevel=0.004)
        leaf.box((lw - 0.2, 0.012, lh * 0.4), (cx, y, z0 + lh * 0.3), "wood_mid", bevel=0.004)
    kx = hx + sign * (lw - 0.06)
    leaf.cylinder_y(0.008, thickness + 0.1, (kx, 0.0, 1.0), knob, segments=4)
    for face in (-1, 1):
        y = face * (thickness / 2.0 + 0.05)
        leaf.blob((0.028, 0.022, 0.028), (kx, y, 1.0), knob, segments=6, rings=4)
        leaf.box((0.04, 0.006, 0.13), (kx, face * (thickness / 2.0 + 0.003), 0.97), knob)
    for z in (0.25, lh - 0.25):
        leaf.box((0.016, thickness + 0.01, 0.1), (hx + sign * 0.006, 0.0, z0 + z), "metal_iron")
    objs = p.finish()

    name = leaf_name or p.name("leaf")
    leaf_obj = next(o for o in objs if o.name == p.name("leaf"))
    leaf_obj.name = name
    leaf_obj.data.name = name
    if collide and leaf_collider:
        col = sockets.collider_box(name, (cx, 0.0, z0 + lh / 2.0), (lw, thickness + 0.02, lh))
        prims.place(col, p.location, rot_z)
        objs.append(col)
    return objs
