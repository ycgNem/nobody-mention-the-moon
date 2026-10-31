"""Shared kitchen-cabinet parts for counter, sink and kitchen_island (one style for the whole run)."""

from __future__ import annotations

from ._piece import Group

WORKTOP = 0.92  # top of every worktop
TOP_T = 0.04
KICK_H = 0.1

CABINET = "wall_green"
DOOR = "cushion_green"
TOP = "wood_light"
HANDLE = "brass"


def kick(g: Group, length: float, depth: float, y: float = 0.0) -> None:
    g.box((length - 0.02, depth - 0.1, KICK_H), (0.0, y - 0.03, KICK_H / 2.0), "wood_dark")


def carcass(g: Group, length: float, depth: float, top_z: float, color: str, y: float = 0.0) -> None:
    """Cabinet box from the kick up to `top_z`, front face at y + depth/2."""
    h = top_z - KICK_H
    g.box((length, depth, h), (0.0, y, KICK_H + h / 2.0), color, bevel=0.01)


def worktop(g: Group, length: float, depth: float, color: str, y: float = 0.0, thickness: float = TOP_T) -> None:
    g.box((length, depth, thickness), (0.0, y, WORKTOP - thickness / 2.0), color, bevel=0.01)


def bays(
    g: Group,
    length: float,
    front_y: float,
    top_z: float,
    door: str,
    handle: str,
    panel: str = CABINET,
    drawers: bool = True,
    face: int = 1,
    min_bay: float = 0.55,
) -> None:
    """Doors (and a drawer over each) across a cabinet front at `front_y`, facing `face` (+1: +Y,
    -1: -Y), filling the height from the kick to `top_z`. Paired doors get their knobs in the
    middle of the pair."""
    n = max(1, round(length / min_bay))
    bay = length / n
    y = front_y + face * 0.01
    pull_y = front_y + face * 0.026
    drawer_h = 0.14
    door_top = top_z - 0.03 - (drawer_h + 0.03 if drawers else 0.0)
    door_bottom = KICK_H + 0.03
    dh = door_top - door_bottom
    for i in range(n):
        x = -length / 2.0 + bay * (i + 0.5)
        if drawers:
            dz = top_z - 0.03 - drawer_h / 2.0
            g.box((bay - 0.03, 0.02, drawer_h), (x, y, dz), door, bevel=0.006)
            g.box((0.12, 0.022, 0.016), (x, pull_y, dz), handle)
        g.box((bay - 0.03, 0.02, dh), (x, y, door_bottom + dh / 2.0), door, bevel=0.008)
        g.box((bay - 0.12, 0.008, dh - 0.1), (x, y + face * 0.012, door_bottom + dh / 2.0), panel)
        toward_middle = 1 if (n == 1 or i % 2 == 0) else -1
        knob_x = x + toward_middle * (bay / 2.0 - 0.065)
        g.cylinder_y(0.015, 0.028, (knob_x, front_y + face * 0.034, door_top - 0.07), handle, segments=6)
