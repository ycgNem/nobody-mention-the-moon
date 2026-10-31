"""Record player on a little splay-legged cabinet with speaker grilles.

Params: wood, grille (palette colors), record (label color).
Meshes: {prefix}_body; {prefix}_disc (the record, origin at the spindle on the platter top,
0.81 m up: spin it about its local Z); {prefix}_tonearm (origin at its pivot; rests on the record,
turn it about its local Z by about -0.6 rad to park it beside the record).
Collider: one box over the cabinet.
"""

from __future__ import annotations

import math

import bpy

from ._piece import Piece

CAB_W, CAB_D = 0.62, 0.42
LEG_H = 0.2
CAB_TOP = 0.73


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    wood: str = "wood_mid",
    grille: str = "cloth_mustard",
    record: str = "cloth_red",
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.tapered_box((0.026, 0.026, LEG_H), (sx * (CAB_W / 2.0 - 0.07), sy * (CAB_D / 2.0 - 0.07), 0.0), "wood_dark", top=(1.6, 1.6), shift=(-sx * 0.02, -sy * 0.02))
    body_h = CAB_TOP - 0.03 - LEG_H
    p.box((CAB_W, CAB_D, body_h), (0.0, 0.0, LEG_H + body_h / 2.0), wood, bevel=0.016)
    for sx in (-1, 1):
        p.box((CAB_W / 2.0 - 0.07, 0.012, body_h - 0.1), (sx * CAB_W / 4.0, CAB_D / 2.0 + 0.002, LEG_H + body_h / 2.0), grille)
    p.box((CAB_W + 0.02, CAB_D + 0.02, 0.03), (0.0, 0.0, CAB_TOP - 0.015), "wood_dark", bevel=0.01)

    # Turntable plinth, platter, spindle.
    plinth_top = CAB_TOP + 0.06
    p.box((0.46, 0.36, 0.06), (0.0, 0.0, CAB_TOP + 0.03), "wood_dark", bevel=0.014)
    spindle = (-0.05, 0.0)
    platter_top = plinth_top + 0.02
    p.cylinder(0.155, 0.02, (spindle[0], spindle[1], plinth_top), "metal_iron", segments=12)
    p.cylinder(0.006, 0.03, (spindle[0], spindle[1], platter_top), "metal_silver", segments=4)
    for i, x in enumerate((0.15, 0.19)):
        p.cylinder(0.014, 0.012, (x, 0.13, plinth_top), "metal_silver" if i else "brass", segments=6)

    disc = p.group("disc", origin=(spindle[0], spindle[1], platter_top))
    disc.cylinder(0.14, 0.006, (spindle[0], spindle[1], platter_top), "black", segments=12)
    disc.cylinder(0.045, 0.002, (spindle[0], spindle[1], platter_top + 0.006), record, segments=10)

    # Tonearm: pivot at the back right, arm reaching onto the record.
    pivot = (0.16, -0.11, plinth_top)
    head = (spindle[0] + 0.07, spindle[1] + 0.075)
    dx, dy = head[0] - pivot[0], head[1] - pivot[1]
    arm_len = math.hypot(dx, dy)
    yaw = math.atan2(-dx, dy)
    arm = p.group("tonearm", origin=pivot)
    arm.cylinder(0.024, 0.045, pivot, "metal_silver", segments=6)
    arm_z = plinth_top + 0.05
    arm.box((0.012, arm_len, 0.012), (pivot[0] + dx / 2.0, pivot[1] + dy / 2.0, arm_z), "metal_silver", rot_z=yaw)
    arm.box((0.03, 0.045, 0.014), (head[0], head[1], arm_z - 0.008), "black", rot_z=yaw)
    ux, uy = -dx / arm_len, -dy / arm_len
    arm.cylinder_y(0.02, 0.04, (pivot[0] + ux * 0.04, pivot[1] + uy * 0.04, arm_z), "metal_iron", segments=6, rot_z=yaw)

    p.collider((0.0, 0.0, (plinth_top + 0.05) / 2.0), (CAB_W + 0.02, CAB_D + 0.02, plinth_top + 0.05))
    return p.finish()
