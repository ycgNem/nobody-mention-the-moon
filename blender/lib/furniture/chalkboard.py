"""Wall-mounted kitchen chalkboard (the diegetic Rumor Ledger) with a chunky wooden frame and a
chalk ledge. Back on the wall plane y = 0, `location` on the floor under its center.

Params: width (1.2), height (0.85, frame outside), mount (1.0, bottom of the frame above the
floor), frame (palette color).
Meshes: {prefix}_body; {prefix}_surface: the drawable board, one quad facing +Y,
(width - 0.1) x (height - 0.1), centered at local (0, 0.017, mount + height / 2), with a second
UV map "board" running 0..1 across its face (u to the viewer's right, v up; the palette UV map
stays first) for a CanvasTexture.
No collider (it sticks out less than 8 cm).
"""

from __future__ import annotations

import bpy

from .. import prims
from ._piece import Piece

FRAME_W, FRAME_D = 0.05, 0.045


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    width: float = 1.2,
    height: float = 0.85,
    mount: float = 1.0,
    frame: str = "wood_mid",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    cz = mount + height / 2.0
    p.box((width - 0.02, 0.015, height - 0.02), (0.0, 0.0075, cz), "chalkboard")
    fy = FRAME_D / 2.0
    for s in (-1, 1):
        p.box((width, FRAME_D, FRAME_W), (0.0, fy, cz + s * (height - FRAME_W) / 2.0), frame, bevel=0.012)
        p.box((FRAME_W, FRAME_D, height - 2 * FRAME_W), (s * (width - FRAME_W) / 2.0, fy, cz), frame, bevel=0.012)
    # Chalk ledge along the bottom with chalk and a duster.
    ledge_z = mount + FRAME_W - 0.012
    p.box((width - 0.08, 0.085, 0.024), (0.0, 0.0425, ledge_z), frame, bevel=0.008)
    top = ledge_z + 0.012
    p.box((0.07, 0.013, 0.013), (-0.28, 0.06, top + 0.0065), "chalk", rot_z=0.15)
    p.box((0.05, 0.013, 0.013), (-0.17, 0.066, top + 0.0065), "chalk", rot_z=-0.3)
    p.box((0.13, 0.05, 0.022), (0.3, 0.055, top + 0.025), "wood_light", bevel=0.006)
    p.box((0.13, 0.05, 0.014), (0.3, 0.055, top + 0.007), "cloth_grey")

    surface = prims.panel(p.name("surface"), width - 2 * FRAME_W, height - 2 * FRAME_W, (0.0, 0.017, cz), "chalkboard")
    prims.planar_uv(surface, "board")
    p.keep(surface)
    return p.finish()
