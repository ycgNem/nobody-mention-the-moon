"""Wall-mounted fuse box on a wooden backboard, with ceramic fuses, a warning plate, a conduit up
to the ceiling and a big knife-switch lever on its right side. Back on the wall plane y = 0.

Params: mount (1.3, bottom of the box above the floor), box, board (palette colors),
conduit (length of the pipe above the box, 0.8; 0 = none).
Meshes: {prefix}_body; {prefix}_lever: origin at the pivot on the box's local -X side (the
viewer's right), 0.1 m out from the wall; the arm points up (+Z) = ON. Rotate about its local X
to throw it: -2.4 rad swings the handle down toward the front (OFF).
Collider: one box.
"""

from __future__ import annotations

import bpy

from ._piece import Piece

BW, BD, BH = 0.34, 0.13, 0.44


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    mount: float = 1.3,
    box: str = "steel_dark",
    board: str = "wood_dark",
    conduit: float = 0.8,
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    board_t = 0.02
    cz = mount + BH / 2.0
    p.box((BW + 0.2, board_t, BH + 0.18), (0.0, board_t / 2.0, cz), board, bevel=0.008)
    by = board_t + BD / 2.0
    p.box((BW, BD, BH), (0.0, by, cz), box, bevel=0.014)
    front = board_t + BD
    p.box((BW - 0.06, 0.01, BH - 0.06), (0.0, front + 0.002, cz), "metal_iron")
    # Ceramic fuses in a row, with a scorched one.
    for i in range(4):
        x = -0.105 + i * 0.07
        p.box((0.045, 0.03, 0.08), (x, front + 0.02, cz + 0.06), "porcelain")
        p.box((0.02, 0.034, 0.03), (x, front + 0.02, cz + 0.06), "burnt" if i == 2 else "brass")
    p.box((0.14, 0.006, 0.07), (0.0, front + 0.008, cz - 0.11), "apron_mustard")
    p.box((0.03, 0.008, 0.045), (0.0, front + 0.011, cz - 0.11), "black", rot=(0.0, 0.5, 0.0))
    if conduit > 0:
        p.cylinder(0.02, conduit, (0.1, by - 0.02, mount + BH), "metal_iron", segments=6)

    pivot = (-BW / 2.0 - 0.015, front - 0.05, cz)
    lever = p.group("lever", origin=pivot)
    lever.cylinder_x(0.032, 0.03, pivot, "metal_silver", segments=8)
    arm_len = 0.2
    lever.box((0.022, 0.022, arm_len), (pivot[0] - 0.012, pivot[1], cz + arm_len / 2.0), "metal_silver")
    lever.blob((0.03, 0.03, 0.04), (pivot[0] - 0.012, pivot[1], cz + arm_len + 0.02), "red_bright", segments=6, rings=4)

    p.collider((0.0, (board_t + BD) / 2.0, cz), (BW + 0.2, board_t + BD, BH + 0.18))
    return p.finish()
