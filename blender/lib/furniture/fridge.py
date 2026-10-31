"""Rounded retro fridge, 0.7 x 0.7 x 1.8, freezer door over a tall main door, chrome handles on
the viewer's right (local -X). Back against -Y.

Params: color, trim (palette colors), board ((width, height) of the whiteboard, default
(0.44, 0.58); at most 0.54 wide), board_z (height of its center, 0.8).
Meshes: {prefix}_body; {prefix}_whiteboard: a flat quad on the main door front facing +Y,
`board` sized, centered at local (0.04, 0.353, board_z) (x is pulled left for boards wider than
0.5 so they clear the handles), with a second UV map "board" running 0..1 across its face (u to
the viewer's right, v up; the palette UV map stays first). Polaroids, labels and scribbles go
there.
Collider: one box.
"""

from __future__ import annotations

import bpy

from .. import prims
from ._piece import Piece

W, D, H = 0.7, 0.7, 1.8
BOARD_W, BOARD_H = 0.44, 0.58
BOARD_CENTER = (0.04, 0.0, 0.8)  # y is filled in from the door front


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    color: str = "fridge_cream",
    trim: str = "metal_silver",
    board: tuple[float, float] = (BOARD_W, BOARD_H),
    board_z: float = BOARD_CENTER[2],
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    kick_h = 0.08
    body_d = D - 0.05
    p.box((W - 0.08, body_d - 0.1, kick_h), (0.0, -0.06, kick_h / 2.0), "steel_dark")
    body_h = H - kick_h
    p.rounded_box((W, body_d, body_h), (0.0, -0.025, kick_h + body_h / 2.0), color, radius=0.07)
    front = -0.025 + body_d / 2.0  # 0.3

    door_t = 0.05
    door_y = front - 0.005 + door_t / 2.0
    door_front = front - 0.005 + door_t  # 0.345
    gap = 0.035
    main_bottom, main_top = kick_h + 0.05, 1.24
    frz_bottom, frz_top = main_top + gap, H - 0.06
    for z0, z1 in ((main_bottom, main_top), (frz_bottom, frz_top)):
        p.box((W - 0.05, door_t, z1 - z0), (0.0, door_y, (z0 + z1) / 2.0), color, bevel=0.02)
    # Handles on the viewer's right (local -X), standing off the doors.
    hx = -W / 2.0 + 0.07
    for z0, z1 in ((main_top - 0.42, main_top - 0.08), (frz_bottom + 0.06, frz_bottom + 0.24)):
        p.box((0.032, 0.03, z1 - z0), (hx, door_front + 0.035, (z0 + z1) / 2.0), trim, bevel=0.012)
        for z in (z0 + 0.03, z1 - 0.03):
            p.box((0.02, 0.03, 0.02), (hx, door_front + 0.012, z), trim)
    p.box((0.14, 0.008, 0.035), (0.0, door_front + 0.003, frz_top - 0.08), "brass")

    # Whiteboard: a steel frame and the board quad just in front of it.
    bw, bh = min(board[0], 0.54), board[1]
    bx = BOARD_CENTER[0] if bw <= 0.5 else 0.03
    p.box((bw + 0.04, 0.006, bh + 0.04), (bx, door_front + 0.003, board_z), "steel_dark")
    quad = prims.panel(p.name("whiteboard"), bw, bh, (bx, door_front + 0.008, board_z), "tint_white")
    prims.planar_uv(quad, "board")
    p.keep(quad)

    p.collider((0.0, 0.0, H / 2.0), (W, D, H))
    return p.finish()
