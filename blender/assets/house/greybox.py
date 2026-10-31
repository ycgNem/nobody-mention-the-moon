"""M0 greybox dining room: floor, walls, one door (east), one window (north), table, six chairs.

Blender Z-up, meters. The room interior spans x -4..4, y -3..3, z 0..2.8.
"""

import math

from lib import prims, sockets

KIND = "house"

HX, HY = 4.0, 3.0  # interior half extents
WALL_H = 2.8
WALL_T = 0.2

DOOR_Y, DOOR_W, DOOR_H = 1.5, 0.9, 2.1
WIN_W, WIN_SILL, WIN_TOP = 1.6, 0.9, 2.1

TABLE_L, TABLE_W, TABLE_H = 2.4, 1.0, 0.75


def solid(name, x0, x1, y0, y1, z0, z1, color, bevel=0.0):
    """Visible box + matching collider, from min/max bounds."""
    size = (x1 - x0, y1 - y0, z1 - z0)
    center = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    prims.box(name, size, center, color, bevel=bevel)
    sockets.collider_box(name, center, size)


def rotated(cx, cy, rot_z, lx, ly):
    """World XY of a point at local (lx, ly) on an object at (cx, cy) rotated by rot_z."""
    c, s = math.cos(rot_z), math.sin(rot_z)
    return (cx + lx * c - ly * s, cy + lx * s + ly * c)


def walls():
    solid("floor", -HX - WALL_T, HX + WALL_T, -HY - WALL_T, HY + WALL_T, -0.1, 0.0, "wood_floor")
    # South and west: solid.
    solid("wall_s", -HX - WALL_T, HX + WALL_T, -HY - WALL_T, -HY, 0, WALL_H, "wall_green")
    solid("wall_w", -HX - WALL_T, -HX, -HY, HY, 0, WALL_H, "wall_green")
    # East: gap for the door.
    d0, d1 = DOOR_Y - DOOR_W / 2, DOOR_Y + DOOR_W / 2
    solid("wall_e_a", HX, HX + WALL_T, -HY, d0, 0, WALL_H, "wall_green")
    solid("wall_e_b", HX, HX + WALL_T, d1, HY, 0, WALL_H, "wall_green")
    solid("wall_e_lintel", HX, HX + WALL_T, d0, d1, DOOR_H, WALL_H, "wall_green")
    # North: hole for the window.
    w0, w1 = -WIN_W / 2, WIN_W / 2
    solid("wall_n_a", -HX - WALL_T, w0, HY, HY + WALL_T, 0, WALL_H, "wall_green")
    solid("wall_n_b", w1, HX + WALL_T, HY, HY + WALL_T, 0, WALL_H, "wall_green")
    solid("wall_n_sill", w0, w1, HY, HY + WALL_T, 0, WIN_SILL, "wall_green")
    solid("wall_n_head", w0, w1, HY, HY + WALL_T, WIN_TOP, WALL_H, "wall_green")

    # Wainscoting and picture rail (visual only).
    t = 0.03
    prims.box("wainscot_s", (2 * HX, t, 1.0), (0, -HY + t / 2, 0.5), "wood_mid")
    prims.box("wainscot_w", (t, 2 * HY, 1.0), (-HX + t / 2, 0, 0.5), "wood_mid")
    prims.box("rail_s", (2 * HX, 0.05, 0.05), (0, -HY + 0.025, 2.2), "wall_trim")
    prims.box("rail_w", (0.05, 2 * HY, 0.05), (-HX + 0.025, 0, 2.2), "wall_trim")


def door():
    d0, d1 = DOOR_Y - DOOR_W / 2, DOOR_Y + DOOR_W / 2
    x = HX + WALL_T / 2
    solid("front_door", x - 0.03, x + 0.03, d0, d1, 0, DOOR_H, "wood_dark", bevel=0.01)
    prims.cylinder("front_door_knob", 0.035, 0.06, (x - 0.06, d0 + 0.1, 1.0), "brass", segments=6)
    sockets.door("hall", (x, DOOR_Y, 0.0), a="dining", b="hall")
    sockets.interact("front_door", (x - 0.1, DOOR_Y, 1.0), kind="door")


def window():
    y = HY + WALL_T / 2
    w0, w1 = -WIN_W / 2, WIN_W / 2
    # Nobody climbs out of the window.
    sockets.collider_box("window", (0, y, (WIN_SILL + WIN_TOP) / 2), (WIN_W, WALL_T, WIN_TOP - WIN_SILL))
    # Frame
    prims.box("window_frame_mid_v", (0.05, 0.08, WIN_TOP - WIN_SILL), (0, y, (WIN_SILL + WIN_TOP) / 2), "wood_light")
    prims.box("window_frame_mid_h", (WIN_W, 0.08, 0.05), (0, y, (WIN_SILL + WIN_TOP) / 2), "wood_light")
    prims.box("window_sill", (WIN_W + 0.2, 0.3, 0.05), (0, HY - 0.05, WIN_SILL), "wood_light")
    # Night sky and the moon outside. Nobody mention it.
    prims.box("sky", (WIN_W + 1.0, 0.05, 2.2), (0, HY + 0.9, 1.5), "night_blue")
    moon = prims.cylinder("moon", 0.22, 0.02, (0.35, HY + 0.85, 1.85), "moon", segments=12)
    moon.rotation_euler = (math.radians(90), 0, 0)

    # Curtains, open, either side of the window.
    for side, x in (("l", w0 - 0.2), ("r", w1 + 0.2)):
        prims.box(f"curtain_{side}", (0.4, 0.08, 1.9), (x, HY - 0.1, 1.55), "curtain_plum", bevel=0.02)
    prims.cylinder("curtain_rod", 0.015, 0.02, (0, HY - 0.1, 2.52), "brass", segments=6)
    prims.box("curtain_rod_bar", (WIN_W + 1.0, 0.03, 0.03), (0, HY - 0.1, 2.52), "brass")
    sockets.interact("curtain", (0, HY - 0.15, 1.5), kind="curtain")


def table():
    top_z = TABLE_H
    prims.box("table_top", (TABLE_L, TABLE_W, 0.06), (0, 0, top_z - 0.03), "wood_mid", bevel=0.02)
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
        x, y = sx * (TABLE_L / 2 - 0.1), sy * (TABLE_W / 2 - 0.1)
        prims.box(f"table_leg_{i}", (0.08, 0.08, top_z - 0.06), (x, y, (top_z - 0.06) / 2), "wood_dark")
    prims.box("tablecloth", (TABLE_L + 0.1, TABLE_W + 0.1, 0.01), (0, 0, top_z + 0.005), "cloth_cream")
    prims.box("runner", (TABLE_L - 0.1, 0.3, 0.01), (0, 0, top_z + 0.015), "cloth_red")
    sockets.collider_box("table", (0, 0, top_z / 2), (TABLE_L, TABLE_W, top_z))

    z = top_z + 0.02
    for i, x in enumerate((-0.6, 0.0, 0.6)):
        prims.cylinder(f"candlestick_base_{i}", 0.05, 0.03, (x, 0, z), "brass", segments=8)
        prims.cylinder(f"candlestick_stem_{i}", 0.015, 0.12, (x, 0, z + 0.03), "brass", segments=6)
        prims.cylinder(f"candle_{i}", 0.02, 0.12, (x, 0, z + 0.15), "candle", segments=6)
        prims.cylinder(f"flame_{i}", 0.012, 0.035, (x, 0, z + 0.27), "flame", segments=5, radius_top=0.002)
        sockets.socket(f"candle_light_{i}", (x, 0, z + 0.3))


def chair(i, x, y, rot_z):
    seat_z = 0.45
    prims.box(f"chair_{i}_seat", (0.45, 0.45, 0.05), (x, y, seat_z - 0.025), "wood_dark", bevel=0.01, rot_z=rot_z)
    prims.box(f"chair_{i}_cushion", (0.4, 0.4, 0.04), (x, y, seat_z + 0.02), "cushion_green", bevel=0.015, rot_z=rot_z)
    for j, (lx, ly) in enumerate(((-0.19, -0.19), (0.19, -0.19), (-0.19, 0.19), (0.19, 0.19))):
        px, py = rotated(x, y, rot_z, lx, ly)
        prims.box(f"chair_{i}_leg_{j}", (0.04, 0.04, seat_z - 0.05), (px, py, (seat_z - 0.05) / 2), "wood_dark", rot_z=rot_z)
    bx, by = rotated(x, y, rot_z, 0, -0.2)
    prims.box(f"chair_{i}_back", (0.45, 0.05, 0.5), (bx, by, seat_z + 0.25), "wood_dark", bevel=0.01, rot_z=rot_z)
    sockets.collider_box(f"chair_{i}", (x, y, 0.475), (0.45, 0.45, 0.95), rot_z=rot_z)
    sockets.seat(str(i), (x, y, seat_z), rot_z)

    # A plate in front of each seat.
    plate_x, plate_y = rotated(x, y, rot_z, 0, 0.6)
    prims.cylinder(f"plate_{i}", 0.12, 0.015, (plate_x, plate_y, TABLE_H + 0.02), "porcelain", segments=10)


def chairs():
    edge_y = TABLE_W / 2 + 0.35
    end_x = TABLE_L / 2 + 0.4
    seats = [
        (-0.6, -edge_y, 0.0),
        (0.6, -edge_y, 0.0),
        (0.6, edge_y, math.pi),
        (-0.6, edge_y, math.pi),
        (-end_x, 0.0, -math.pi / 2),
        (end_x, 0.0, math.pi / 2),
    ]
    for i, (x, y, r) in enumerate(seats):
        chair(i, x, y, r)


def furniture():
    solid("sideboard", -HX, -HX + 0.5, -0.9, 0.9, 0, 0.9, "wood_dark", bevel=0.02)
    prims.box("sideboard_top", (0.55, 1.85, 0.04), (-HX + 0.25, 0, 0.92), "wood_light", bevel=0.01)
    # Painting on the south wall.
    prims.box("painting_frame", (1.0, 0.04, 0.7), (1.5, -HY + 0.04, 1.6), "brass", bevel=0.01)
    prims.box("painting_canvas", (0.85, 0.02, 0.55), (1.5, -HY + 0.065, 1.6), "cloth_red")
    sockets.interact("painting", (1.5, -HY + 0.2, 1.6), kind="prop_painting")
    # Pendant lamp over the table.
    prims.cylinder("lamp_cord", 0.008, 0.6, (0, 0, WALL_H - 0.6), "metal_iron", segments=4)
    prims.cylinder("lamp_shade", 0.28, 0.2, (0, 0, WALL_H - 0.8), "brass", segments=10, radius_top=0.08)
    sockets.socket("lamp_light", (0, 0, WALL_H - 0.85))


def layout():
    sockets.room("dining", (0, 0, WALL_H / 2), (2 * HX, 2 * HY, WALL_H))
    # Spawns along the east side, facing the table (-X in Blender).
    for i, y in enumerate((-2.25, -1.5, -0.75, 0.0, 0.75, -2.6)):
        x = 3.2 if i < 5 else 2.5
        sockets.spawn(str(i), (x, y, 0.0), math.pi / 2)


def build():
    walls()
    door()
    window()
    table()
    chairs()
    furniture()
    layout()
