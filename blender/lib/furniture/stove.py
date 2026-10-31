"""Retro enamel range: two-burner hob at 0.92 m, control knobs, a drop-down oven door and a
splashback. Back against -Y, width along X, lines up with counters.

Params: width (0.7), enamel, hob, trim (palette colors).
Meshes: {prefix}_body; {prefix}_burner_0 (local -X) and {prefix}_burner_1 (local +X), origins at
the burner centers on the hob (0.92 m up; tint or swap their material to show them lit);
{prefix}_oven_door (origin on its bottom hinge line, 0.12 m up at the cabinet front: rotate about
its local X, positive tips the top toward +Y to open it).
Collider: one box.
"""

from __future__ import annotations

import bpy

from ._piece import Piece

DEPTH = 0.62
HOB_Z = 0.92


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    width: float = 0.7,
    enamel: str = "fridge_cream",
    hob: str = "hob_black",
    trim: str = "metal_silver",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    kick_h, hob_t = 0.08, 0.04
    body_d = DEPTH - 0.04
    front = body_d / 2.0 - 0.02
    p.box((width - 0.04, body_d - 0.1, kick_h), (0.0, -0.06, kick_h / 2.0), hob)
    body_h = HOB_Z - hob_t - kick_h
    p.box((width, body_d, body_h), (0.0, -0.02, kick_h + body_h / 2.0), enamel, bevel=0.016)
    p.box((width + 0.01, DEPTH, hob_t), (0.0, 0.0, HOB_Z - hob_t / 2.0), hob, bevel=0.01)
    # Splashback with a little shelf.
    p.box((width, 0.05, 0.2), (0.0, -DEPTH / 2.0 + 0.025, HOB_Z + 0.1), enamel, bevel=0.014)
    p.box((width + 0.02, 0.08, 0.02), (0.0, -DEPTH / 2.0 + 0.04, HOB_Z + 0.2), trim)
    # Control strip and knobs.
    strip_z = HOB_Z - hob_t - 0.06
    p.box((width - 0.06, 0.012, 0.08), (0.0, front + 0.006, strip_z), "steel_dark")
    for x in (-0.2, 0.0, 0.2):
        p.cylinder_y(0.024, 0.035, (x * width / 0.7, front + 0.028, strip_z), "black", segments=6)

    for i, x in enumerate((-0.17, 0.17)):
        b = p.group(f"burner_{i}", origin=(x * width / 0.7, -0.03, HOB_Z))
        bx = x * width / 0.7
        b.torus(0.07, 0.013, (bx, -0.03, HOB_Z + 0.008), "steel_dark", segments=10, sides=4)
        b.cylinder(0.032, 0.014, (bx, -0.03, HOB_Z), "steel_dark", segments=8)
        # Pan supports stay on the body so a lit burner glows on its own.
        p.box((0.2, 0.014, 0.012), (bx, -0.03, HOB_Z + 0.026), "metal_iron")
        p.box((0.014, 0.2, 0.012), (bx, -0.03, HOB_Z + 0.026), "metal_iron")

    door_bottom, door_h, door_t = kick_h + 0.04, 0.5, 0.035
    hinge = (0.0, front, door_bottom)
    d = p.group("oven_door", origin=hinge)
    dy = front + door_t / 2.0
    d.box((width - 0.08, door_t, door_h), (0.0, dy, door_bottom + door_h / 2.0), enamel, bevel=0.012)
    d.box((width - 0.3, 0.008, 0.2), (0.0, front + door_t + 0.002, door_bottom + door_h * 0.48), "glass_dark")
    handle_y = front + door_t + 0.04
    d.cylinder_x(0.012, width - 0.16, (0.0, handle_y, door_bottom + door_h - 0.06), trim, segments=6)
    for s in (-1, 1):
        d.box((0.018, 0.045, 0.018), (s * (width / 2.0 - 0.1), front + door_t + 0.02, door_bottom + door_h - 0.06), trim)

    p.collider((0.0, 0.0, HOB_Z / 2.0), (width, DEPTH, HOB_Z))
    return p.finish()
