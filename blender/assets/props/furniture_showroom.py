"""Review sheet for blender/lib/furniture: every module laid out on one floor, in four rows backed
by walls (wall-mounted pieces hang on them), plus the van. Not used by the game.

Rows (Blender Y, each row's wall front face, pieces face +Y):
  y =  8  dining and living room
  y =  2  kitchen
  y = -4  garage and bathroom
  y = -10 a wall with a door (closed and ajar) and a window; stairs; the van (rear to +Y)
"""

import math

from lib import furniture, prims

KIND = "house"

WALL_H, WALL_T = 2.8, 0.2


def F(name):
    return furniture.get(name).make


def wall(name, x0, x1, y, color, z0=0.0, z1=WALL_H):
    """Wall slab whose front face is the plane y, spanning x0..x1."""
    prims.box(name, (x1 - x0, WALL_T, z1 - z0), ((x0 + x1) / 2.0, y - WALL_T / 2.0, (z0 + z1) / 2.0), color)


def dining_row(y):
    wall("wall_dining", -9.0, 9.0, y, "wall_green")
    prims.box("wainscot_dining", (18.0, 0.03, 0.9), (0.0, y + 0.015, 0.45), "wood_mid")
    F("bookcase")("bookcase", (-8.0, y + 0.18, 0.0))
    F("cupboard")("cupboard", (-6.7, y + 0.3, 0.0))
    F("sideboard")("sideboard", (-4.5, y + 0.28, 0.0))
    F("wall_mirror")("mirror_oval", (-4.5, y + 0.03, 0.0), center_z=1.65)
    F("potted_plant")("plant_tree", (-2.6, y + 0.35, 0.0), kind="tree", seed=1)
    F("rug")("rug", (0.0, y + 2.2, 0.0), length=3.4, width=2.4)
    F("dining_table")("table", (0.0, y + 2.2, 0.0))
    for i, (x, dy, r) in enumerate(((-0.6, -0.85, 0.0), (0.6, -0.85, 0.0), (-0.6, 0.85, math.pi), (0.6, 0.85, math.pi), (-1.6, 0.0, -math.pi / 2), (1.6, 0.0, math.pi / 2))):
        F("chair")(f"chair_{i}", (x, y + 2.2 + dy, 0.0), rot_z=r)
    F("potted_plant")("plant_bush", (2.1, y + 0.35, 0.0), kind="bush", height=0.75, seed=2)
    F("floor_lamp")("lamp", (2.9, y + 0.45, 0.0))
    F("armchair")("armchair", (3.7, y + 0.9, 0.0), rot_z=-0.35)
    F("side_table")("side_table", (4.6, y + 0.55, 0.0))
    F("record_player")("record_player", (5.8, y + 0.23, 0.0))
    F("coat_stand")("coat_stand", (7.0, y + 0.5, 0.0))
    F("wall_mirror")("mirror_covered", (8.3, y + 0.03, 0.0), cover="cloth_cream")
    F("potted_plant")("plant_spiky", (8.3, y + 0.5, 0.0), kind="spiky", height=0.9, seed=3)


def kitchen_row(y):
    wall("wall_kitchen", -9.0, 9.0, y, "wall_kitchen")
    F("fridge")("fridge", (-7.6, y + 0.36, 0.0))
    F("counter")("counter_a", (-6.6, y + 0.32, 0.0), length=1.2)
    F("stove")("stove", (-5.65, y + 0.32, 0.0))
    F("sink")("sink", (-4.8, y + 0.32, 0.0))
    F("counter")("counter_b", (-3.85, y + 0.32, 0.0), length=0.9, drawers=False)
    F("shelf")("shelf", (-6.6, y, 0.0), mount=1.55)
    F("kitchen_island")("island", (-5.4, y + 2.4, 0.0))
    F("chalkboard")("chalkboard", (-1.6, y, 0.0))
    F("wine_rack")("wine_rack", (0.4, y + 0.16, 0.0))
    F("shelf")("shelf_bare", (2.2, y, 0.0), length=0.8, items=False, mount=1.3)


def garage_row(y):
    wall("wall_garage", -9.0, 0.0, y, "concrete")
    wall("wall_bath", 0.0, 9.0, y, "tile_white")
    F("workbench")("workbench", (-7.0, y + 0.36, 0.0))
    F("fuse_box")("fuse_box", (-5.3, y, 0.0))
    F("dog_bed")("dog_bed", (-4.0, y + 1.0, 0.0), rot_z=0.2)
    F("toilet")("toilet", (1.2, y + 0.32, 0.0))
    F("basin")("basin", (2.5, y + 0.22, 0.0))
    F("wall_mirror")("mirror_rect", (2.5, y, 0.0), shape="rect", width=0.5, height=0.65, center_z=1.55)
    F("bath")("bath", (4.6, y + 0.42, 0.0))


def house_row(y):
    t = WALL_T
    cy = y - t / 2.0
    # Wall with two doorways and a window hole: x -9..-0.5.
    doors = ((-7.0, 0.9), (-5.2, 0.9))
    win_x, win_w, win_h, sill = -2.8, 1.2, 1.3, 0.9
    solid =[(-9.0, doors[0][0] - 0.45), (doors[0][0] + 0.45, doors[1][0] - 0.45), (doors[1][0] + 0.45, win_x - win_w / 2.0), (win_x + win_w / 2.0, -0.5)]
    for i, (x0, x1) in enumerate(solid):
        wall(f"wall_house_{i}", x0, x1, y, "wallpaper_rose")
    for i, (x, w) in enumerate(doors):
        wall(f"wall_house_lintel_{i}", x - w / 2.0, x + w / 2.0, y, "wallpaper_rose", z0=2.1)
    wall("wall_house_sill", win_x - win_w / 2.0, win_x + win_w / 2.0, y, "wallpaper_rose", z1=sill)
    wall("wall_house_head", win_x - win_w / 2.0, win_x + win_w / 2.0, y, "wallpaper_rose", z0=sill + win_h)

    F("door_leaf")("leaf_closed", (doors[0][0], cy, 0.0), hinge="-x")
    ajar = F("door_leaf")("leaf_ajar", (doors[1][0], cy, 0.0), hinge="+x")
    leaf = next(o for o in ajar if o.name == "leaf_ajar_leaf")
    leaf.rotation_euler.z += math.radians(-70)
    F("window")("window", (win_x, cy, 0.0), width=win_w, height=win_h, sill=sill)

    F("stairs")("stairs", (2.0, y + 3.0, 0.0), rot_z=-math.pi / 2.0, rail="+x")
    F("van")("van", (5.0, y - 3.2, 0.0), rot_z=math.pi)


def build():
    prims.box("showroom_floor", (19.0, 30.0, 0.1), (0.0, -3.5, -0.05), "wood_floor")
    dining_row(8.0)
    kitchen_row(2.0)
    garage_row(-4.0)
    house_row(-10.0)
