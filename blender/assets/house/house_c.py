"""House C: a country manor. Big and drafty: a long dining hall, an entrance hall with a grand
front door, a library, and the kitchen far away at the end of a service corridor (whatever you say
in there never reaches the table). The wine is down in the cellar, the dog sleeps in the coach
house, and the catering van waits on the gravel drive.

Blender Z-up, meters. Rooms (wall centerlines):
    dining    x -17..-4  y -5..3      hall      x -4..4    y -5..5
    corridor  x -17..-4  y 3..5       study     x 4..12    y -5..5
    kitchen   x -17..-8  y 5..12      cellar    stairs x -8..-6 y 5..9 (down to z -2.6),
                                                room x -9..-2 y 9..14
    garage    x 13..21   y -16..-8 (the coach house, open to the drive)
    outside   x -20..13  y -22..-5 (the drive; the van at x 6 y -13)
Doors: the front door, an archway from the hall into the dining hall, two servery doors from the
corridor into the dining hall, the corridor's doors to the hall, the kitchen and the cellar, the
library door, and the coach house's carriage arch. The moon rises over the west garden, behind
the tall window at the head of the table.

Furniture comes from blender/lib/furniture; walls, floors and the grounds are built here.
"""

import math

import bpy
from mathutils import Matrix

from lib import furniture, prims, sockets

KIND = "house"

WALL_H = 3.4
T = 0.25
DOOR_W, DOOR_H = 1.0, 2.3
CELLAR_Z = -2.6
CELLAR_TOP = -0.3

TABLE_X, TABLE_Y = -10.5, -1.0
TABLE_L, TABLE_W, TABLE_H = 4.4, 1.2, 0.76
TABLE_TOP = TABLE_H + 0.012
WORKTOP = 0.92

SKIN = {
    "dining": "carpet_red",
    "hall": "wall_cream",
    "corridor": "plaster",
    "kitchen": "tile_white",
    "study": "wall_green",
    "cellar": "stone_dark",
    "garage": "brick",
    "outside": "stone",
    "void": None,
}


def F(name):
    return furniture.get(name).make


# ---------------------------------------------------------------------------------------------
# Helpers (the same building blocks as house_a)


def solid(name, x0, x1, y0, y1, z0, z1, color, bevel=0.0, collide=True):
    """Visible box (+ matching collider), from min/max bounds."""
    size = (x1 - x0, y1 - y0, z1 - z0)
    center = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    obj = prims.box(name, size, center, color, bevel=bevel)
    if collide:
        sockets.collider_box(name, center, size)
    return obj


def segments(u0, u1, openings, z0, z1):
    """Rectangles (a0, a1, b0, b1) in a wall's (along, up) plane, leaving holes for
    openings given as (center, width, bottom, top)."""
    out = []
    cur = u0
    for c, w, bottom, top in sorted(openings):
        g0, g1 = c - w / 2, c + w / 2
        if g0 > cur:
            out.append((cur, g0, z0, z1))
        if bottom > z0:
            out.append((g0, g1, z0, bottom))
        if top < z1:
            out.append((g0, g1, top, z1))
        cur = g1
    if cur < u1:
        out.append((cur, u1, z0, z1))
    return out


def wall(name, axis, at, u0, u1, neg, pos, openings=(), z0=0.0, z1=WALL_H, t=T):
    """A wall along `axis` ('x' or 'y') centered on the line `axis_other = at`, from u0 to u1.
    `neg`/`pos` say what is on the -/+ side of the line (their skins face them)."""
    skin = 0.01
    for i, (a0, a1, b0, b1) in enumerate(segments(u0, u1, openings, z0, z1)):
        n = f"{name}_{i}"
        if axis == "x":
            solid(n, a0, a1, at - t / 2, at + t / 2, b0, b1, "plaster")
        else:
            solid(n, at - t / 2, at + t / 2, a0, a1, b0, b1, "plaster")
        for side, room in ((-1, neg), (1, pos)):
            color = SKIN[room]
            if color is None:
                continue
            off = side * (t / 2 + skin / 2)
            if axis == "x":
                prims.box(f"{n}_{'np'[side > 0]}", (a1 - a0, skin, b1 - b0), ((a0 + a1) / 2, at + off, (b0 + b1) / 2), color)
            else:
                prims.box(f"{n}_{'np'[side > 0]}", (skin, a1 - a0, b1 - b0), (at + off, (a0 + a1) / 2, (b0 + b1) / 2), color)


# Which way the door's front (+Y of the furniture piece) faces. A leaf hinged on the piece's -x
# jamb swings toward its front when the client turns it +90 degrees.
FRONT_ROT = {"+y": 0.0, "-x": math.pi / 2, "-y": math.pi, "+x": -math.pi / 2}


def leaf_door(door_id, x, y, a, b, front, open_=False, width=DOOR_W, height=DOOR_H, door="wood_dark", frame="wood_mid"):
    """A doorway with a door that opens: the furniture door_leaf (frame + `doorleaf_<id>` + its
    collider), the room-graph door and the interactable. The leaf swings into the `front` side.
    The client sets the leaf's yaw outright (0 shut, 90 degrees open), so the piece's turn is
    baked into the leaf mesh and the leaf object keeps a zero rotation, origin on the hinge."""
    rot = FRONT_ROT[front]
    objs = F("door_leaf")(f"frame_{door_id}", (x, y, 0.0), rot_z=rot, width=width, height=height, wall_t=T, door=door, frame=frame, leaf_name=f"doorleaf_{door_id}", leaf_collider=True)
    leaf = next(o for o in objs if o.name == f"doorleaf_{door_id}")
    if abs(rot) > 1e-9:
        leaf.data.transform(Matrix.Rotation(rot, 4, "Z"))
        leaf.rotation_euler = (0.0, 0.0, 0.0)
    sockets.door(door_id, (x, y, 0.0), a=a, b=b, leaf=True, open=open_)
    sockets.interact(door_id, (x, y, 1.0), kind="door")


def arch(name, x, y, along, width, height, color="wood_dark"):
    """Trim around an archway in a wall along `along` ('x' or 'y')."""
    w = T + 0.08
    for i, s in enumerate((-1, 1)):
        off = s * (width / 2 + 0.05)
        loc = (x + off, y, height / 2) if along == "x" else (x, y + off, height / 2)
        size = (0.1, w, height) if along == "x" else (w, 0.1, height)
        prims.box(f"{name}_jamb_{i}", size, loc, color)
    size = (width + 0.3, w, 0.16) if along == "x" else (w, width + 0.3, 0.16)
    prims.box(f"{name}_head", size, (x, y, height + 0.08), color, bevel=0.02)


def moon_window(objs):
    """The window the moon is seen through has no pane: the palette glass is opaque, and the
    table has to see the moon when the curtains are open."""
    for o in [o for o in objs if o.name.endswith("_glass")]:
        mesh = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(mesh)


def chair(i, x, y, rot_z):
    F("chair")(f"chair_{i}", (x, y, 0.0), rot_z=rot_z, cushion="cloth_red", back_height=1.1)
    sockets.seat(str(i), (x, y, 0.45), rot_z)
    px, py, _ = prims.to_world((x, y, 0.0), rot_z, (0.0, 0.62, 0.0))
    sockets.socket(f"plate_{i}", (px, py, TABLE_TOP + 0.004), rot_z=rot_z)


def ceiling(name, x0, x1, y0, y1, z, color="plaster"):
    prims.box(f"ceiling_{name}", (x1 - x0, y1 - y0, 0.12), ((x0 + x1) / 2, (y0 + y1) / 2, z + 0.06), color)


def floor(name, x0, x1, y0, y1, color, z=0.0):
    prims.box(f"floor_{name}", (x1 - x0, y1 - y0, 0.02), ((x0 + x1) / 2, (y0 + y1) / 2, z - 0.01), color)


def hedge(name, x0, x1, y0, y1, height=1.7):
    prims.box(name, (x1 - x0, y1 - y0, height), ((x0 + x1) / 2, (y0 + y1) / 2, height / 2), "plant_green", bevel=0.08)
    sockets.collider_box(name, ((x0 + x1) / 2, (y0 + y1) / 2, 1.5), (x1 - x0, y1 - y0, 3.0))


def tree(name, x, y, height=4.5, seed=0, collide=False):
    prims.cylinder(f"{name}_trunk", 0.2, height * 0.55, (x, y, 0.0), "wood_dark", segments=6, radius_top=0.12)
    if collide:
        sockets.collider_box(f"{name}_trunk", (x, y, 1.5), (0.4, 0.4, 3.0))
    for i, (dx, dy, dz, r) in enumerate(((0.0, 0.0, 0.75, 1.4), (0.7, -0.5, 0.62, 0.9), (-0.6, 0.6, 0.66, 1.0))):
        prims.blob(f"{name}_crown_{i}", (r, r, r * 0.85), (x + dx, y + dy, height * dz), "lettuce" if i == 1 else "plant_green", segments=8, rings=5, wobble=0.12, seed=seed * 3 + i)


def portrait(name, x, y, z, rot_z, w=0.7, h=0.9, color="cloth_blue"):
    """A framed portrait on a wall face (back on the wall at x, y)."""
    parts = [
        prims.box(f"{name}_frame", (w, 0.05, h), (0.0, 0.025, 0.0), "gold", bevel=0.015),
        prims.box(f"{name}_canvas", (w - 0.14, 0.01, h - 0.14), (0.0, 0.053, 0.0), color),
        prims.blob(f"{name}_face", (0.1, 0.01, 0.13), (0.0, 0.06, h * 0.12), "skin_pale", segments=6, rings=4),
    ]
    prims.place(prims.join(name, parts), (x, y, z), rot_z)


# ---------------------------------------------------------------------------------------------
# Shell


def floors():
    # Colliders: the house, the drive and the coach house. None over the cellar stairwell.
    sockets.collider_box("ground_house", (-2.5, 0.0, -0.1), (29.0, 10.0, 0.2))
    sockets.collider_box("ground_kitchen", (-12.5, 8.5, -0.1), (9.0, 7.0, 0.2))
    sockets.collider_box("ground_drive", (-3.5, -13.5, -0.1), (34.0, 17.0, 0.2))
    sockets.collider_box("ground_coach_house", (17.0, -12.0, -0.1), (8.4, 8.4, 0.2))

    floor("dining", -17.0, -4.0, -5.0, 3.0, "wood_floor")
    floor("corridor", -17.0, -4.0, 3.0, 5.0, "wood_mid")
    floor("kitchen", -17.0, -8.0, 5.0, 12.0, "stone")
    floor("hall", -4.0, 4.0, -5.0, 5.0, "tile_white")
    floor("study", 4.0, 12.0, -5.0, 5.0, "wood_floor")
    floor("coach_house", 13.0, 21.0, -16.0, -8.0, "concrete")
    floor("drive", -20.0, 13.0, -22.0, -5.0, "stone")
    floor("garden_w", -26.0, -17.0, -5.0, 12.0, "grass")
    # The hall's black-and-white flags.
    tiles = []
    for i in range(8):
        for j in range(10):
            if (i + j) % 2:
                tiles.append(prims.box(f"hall_tile_{i}_{j}", (0.98, 0.98, 0.004), (-3.5 + i, -4.5 + j, 0.002), "tile_black"))
    prims.join("hall_tiles", tiles)

    for name, (x0, x1, y0, y1) in {
        "dining": (-17.0, -4.0, -5.0, 3.0),
        "corridor": (-17.0, -4.0, 3.0, 5.0),
        "kitchen": (-17.0, -8.0, 5.0, 12.0),
        "hall": (-4.0, 4.0, -5.0, 5.0),
        "study": (4.0, 12.0, -5.0, 5.0),
        "stairwell": (-8.0, -6.0, 5.0, 9.0),
        "coach_house": (13.0, 21.0, -16.0, -8.0),
    }.items():
        ceiling(name, x0, x1, y0, y1, WALL_H)


def walls():
    # The south front: dining hall windows, the front door between two hall windows, the library.
    win = (1.3, 0.8, 2.6)  # width, sill, top
    wall("wall_s_dining", "x", -5.0, -17.0 - T / 2, -4.0, "outside", "dining", [(x, win[0], win[1], win[2]) for x in (-14.2, -10.5, -6.8)])
    wall("wall_s_hall", "x", -5.0, -4.0, 4.0, "outside", "hall", [(0.0, 1.4, 0.0, 2.7), (-2.4, 0.8, 0.9, 2.5), (2.4, 0.8, 0.9, 2.5)])
    wall("wall_s_study", "x", -5.0, 4.0, 12.0 + T / 2, "outside", "study", [(6.0, win[0], win[1], win[2]), (10.0, win[0], win[1], win[2])])
    # West: the tall window at the head of the table (the moon window), the corridor, the kitchen.
    wall("wall_w_dining", "y", -17.0, -5.0, 3.0, "outside", "dining", [(TABLE_Y, 2.4, 0.5, 2.9)])
    wall("wall_w_corridor", "y", -17.0, 3.0, 5.0, "outside", "corridor")
    wall("wall_w_kitchen", "y", -17.0, 5.0, 12.0 + T / 2, "outside", "kitchen")
    # North and east.
    wall("wall_n_kitchen", "x", 12.0, -17.0, -8.0, "kitchen", "outside", [(-12.2, 1.0, 1.3, 2.4)])
    wall("wall_e_kitchen_stair", "y", -8.0, 5.0 + T / 2, 9.0, "kitchen", "cellar", z0=CELLAR_Z)
    wall("wall_e_kitchen", "y", -8.0, 9.0, 12.0 + T / 2, "kitchen", "outside")
    wall("wall_n_corridor_e", "x", 5.0, -6.0, -4.0, "corridor", "void")
    wall("wall_n_hall", "x", 5.0, -4.0, 4.0, "hall", "outside", [(0.0, 1.6, 0.9, 2.9)])
    wall("wall_n_study", "x", 5.0, 4.0, 12.0 + T / 2, "study", "outside")
    wall("wall_e_study", "y", 12.0, -5.0, 5.0, "study", "outside")
    # Inside.
    wall("wall_dining_corridor", "x", 3.0, -17.0 + T / 2, -4.0, "dining", "corridor", [(-15.5, DOOR_W, 0.0, DOOR_H), (-5.0, DOOR_W, 0.0, DOOR_H)])
    wall("wall_dining_hall", "y", -4.0, -5.0 + T / 2, 3.0, "dining", "hall", [(TABLE_Y, 2.4, 0.0, 2.9)])
    wall("wall_corridor_hall", "y", -4.0, 3.0, 5.0 + T / 2, "corridor", "hall", [(4.0, DOOR_W, 0.0, DOOR_H)])
    wall("wall_corridor_kitchen", "x", 5.0, -17.0 + T / 2, -8.0, "corridor", "kitchen", [(-11.0, DOOR_W, 0.0, DOOR_H)])
    wall("wall_hall_study", "y", 4.0, -5.0 + T / 2, 5.0 - T / 2, "hall", "study", [(TABLE_Y, DOOR_W, 0.0, DOOR_H)])
    arch("arch_dining", -4.0, TABLE_Y, "y", 2.4, 2.9)
    for i, x in enumerate((-2.4, 2.4)):
        F("window")(f"hall_window_{i}", (x, -5.0, 0.0), width=0.8, height=1.6, sill=0.9, wall_t=T, panes=(1, 3))
    F("window")("hall_window_n", (0.0, 5.0, 0.0), rot_z=math.pi, width=1.6, height=2.0, sill=0.9, wall_t=T, panes=(2, 3))

    # The cellar stairwell (down from the corridor) and the cellar.
    wall("wall_corridor_stair", "x", 5.0, -8.0, -6.0, "corridor", "cellar", [(-7.0, DOOR_W, 0.0, DOOR_H)])
    wall("wall_stair_e", "y", -6.0, 5.0 + T / 2, 9.0, "cellar", "void", z0=CELLAR_Z)
    wall("wall_stair_n", "x", 9.0, -8.0 - T / 2, -6.0 + T / 2, "cellar", "void", z0=CELLAR_TOP)
    wall("wall_cellar_s", "x", 9.0, -9.0 - T / 2, -2.0 + T / 2, "void", "cellar", [(-7.0, 2.0 - T, CELLAR_Z, CELLAR_TOP)], z0=CELLAR_Z, z1=CELLAR_TOP)
    solid("cellar_floor", -9.0, -2.0, 9.0, 14.0, CELLAR_Z - 0.2, CELLAR_Z, "stone_dark")
    solid("stair_floor", -8.0, -6.0, 8.8, 9.0, CELLAR_Z - 0.2, CELLAR_Z, "stone_dark")
    wall("wall_cellar_w", "y", -9.0, 9.0 - T / 2, 14.0 + T / 2, "void", "cellar", z0=CELLAR_Z, z1=CELLAR_TOP)
    wall("wall_cellar_e", "y", -2.0, 9.0 - T / 2, 14.0 + T / 2, "cellar", "void", z0=CELLAR_Z, z1=CELLAR_TOP)
    wall("wall_cellar_n", "x", 14.0, -9.0, -2.0, "cellar", "void", z0=CELLAR_Z, z1=CELLAR_TOP)
    prims.box("ceiling_cellar", (7.0, 5.0, 0.12), (-5.5, 11.5, CELLAR_TOP + 0.06), "stone")

    # The coach house, open to the drive through its carriage arch.
    wall("wall_coach_w", "y", 13.0, -16.0 - T / 2, -8.0 + T / 2, "outside", "garage", [(-12.0, 3.4, 0.0, 2.9)])
    wall("wall_coach_e", "y", 21.0, -16.0 - T / 2, -8.0 + T / 2, "garage", "outside")
    wall("wall_coach_n", "x", -8.0, 13.0, 21.0, "garage", "outside")
    wall("wall_coach_s", "x", -16.0, 13.0, 21.0, "outside", "garage")
    arch("arch_coach", 13.0, -12.0, "y", 3.4, 2.9, color="wood_mid")


def roofs():
    """Pitched roofs, seen from the drive. Named ceiling_* so the overhead view hides them too."""
    eave = 0.3
    prims.prism("ceiling_roof_main", [(-5.0 - eave, 0.0), (5.0 + eave, 0.0), (0.0, 2.8)], 29.0 + 2 * eave, (-2.5, 0.0, WALL_H), "roof")
    prims.prism("ceiling_roof_kitchen", [(-4.5 - eave, 0.0), (4.5 + eave, 0.0), (0.0, 2.4)], 7.0 + eave, (-12.5, 8.65, WALL_H), "roof", rot_z=math.pi / 2)
    prims.prism("ceiling_roof_coach", [(-4.0 - eave, 0.0), (4.0 + eave, 0.0), (0.0, 2.0)], 8.0 + 2 * eave, (17.0, -12.0, WALL_H), "roof", rot_z=math.pi / 2)
    prims.box("ceiling_roof_stair", (2.4, 4.2, 0.2), (-7.0, 7.0, WALL_H + 0.1), "roof")
    # Chimneys over the two fireplaces.
    for i, (x, y) in enumerate(((-14.6, 2.6), (8.0, 4.4))):
        prims.box(f"ceiling_chimney_{i}", (0.9, 0.7, 3.3), (x, y, WALL_H + 1.75), "brick")


def doors():
    leaf_door("front", 0.0, -5.0, "hall", "outside", "+y", width=1.4, height=2.7, door="cloth_green", frame="stone")
    prims.box("front_door_knocker", (0.12, 0.03, 0.14), (0.0, -5.18, 1.6), "brass")
    sockets.door("dining_hall", (-4.0, TABLE_Y, 0.0), a="dining", b="hall")
    leaf_door("hall_corridor", -4.0, 4.0, "hall", "corridor", "+x", open_=True, door="cloth_green")
    leaf_door("servery", -5.0, 3.0, "corridor", "dining", "-y", open_=True)
    leaf_door("servery_w", -15.5, 3.0, "corridor", "dining", "-y", open_=False)
    leaf_door("kitchen", -11.0, 5.0, "corridor", "kitchen", "+y", open_=True)
    leaf_door("cellar", -7.0, 5.0, "corridor", "cellar", "+y", open_=False)
    leaf_door("study", 4.0, TABLE_Y, "hall", "study", "+x", open_=False)
    sockets.door("garage", (13.0, -12.0, 0.0), a="outside", b="garage")


# ---------------------------------------------------------------------------------------------
# Rooms


def dining():
    tx, ty = TABLE_X, TABLE_Y
    F("rug")("dining_rug", (tx, ty, 0.0), length=6.2, width=3.0, field="carpet_red", border="cloth_mustard", medallion="cloth_cream")
    F("dining_table")("table", (tx, ty, 0.0), length=TABLE_L, width=TABLE_W, height=TABLE_H, wood="wood_dark", cloth="cloth_cream", runner="cloth_green")

    # Eight seats: three down each side, one at each end (sim seats go round the ring).
    side = TABLE_W / 2 + 0.35
    end = TABLE_L / 2 + 0.4
    seats = [(tx + dx, ty - side, 0.0) for dx in (-1.4, 0.0, 1.4)]
    seats += [(tx + end, ty, math.pi / 2)]
    seats += [(tx + dx, ty + side, math.pi) for dx in (1.4, 0.0, -1.4)]
    seats += [(tx - end, ty, -math.pi / 2)]
    for i, (x, y, r) in enumerate(seats):
        chair(i, x, y, r)
    sockets.socket("prop_candelabra", (tx, ty, TABLE_TOP))

    # The tall window at the head of the table, its curtains, and the moon over the west garden.
    moon_window(F("window")("moon_window", (-17.0, ty, 0.0), rot_z=-math.pi / 2, width=2.4, height=2.4, sill=0.5, wall_t=T, panes=(3, 4)))
    cx = -17.0 + T / 2 + 0.12
    for s, y in (("l", ty - 1.55), ("r", ty + 1.55)):
        prims.box(f"curtain_{s}", (0.1, 0.6, 3.0), (cx, y, 1.55), "cloth_green", bevel=0.03)
    prims.box("curtain_closed", (0.1, 2.9, 3.0), (cx + 0.05, ty, 1.55), "cloth_green", bevel=0.03)
    prims.box("curtain_pelmet", (0.16, 3.9, 0.3), (cx, ty, 3.15), "wood_dark", bevel=0.02)
    sockets.interact("curtain", (-16.55, ty, 1.4), kind="curtain")
    moon = prims.cylinder("moon", 1.0, 0.05, (-26.0, ty + 0.3, 3.9), "moon", segments=16)
    moon.rotation_euler = (0.0, math.radians(90), 0.0)
    for i, x in enumerate((-14.2, -10.5, -6.8)):
        F("window")(f"dining_window_{i}", (x, -5.0, 0.0), width=1.3, height=1.8, sill=0.8, wall_t=T, panes=(2, 3))

    # North wall: the sideboard and the mirror over it, the fireplace with the painting above it.
    F("sideboard")("sideboard", (tx, 2.875 - 0.27, 0.0), rot_z=math.pi, length=2.2, depth=0.5, height=0.92)
    F("wall_mirror")("mirror", (tx, 2.875, 0.0), rot_z=math.pi, width=0.8, height=1.05, center_z=1.85, cover="cloth_cream")
    sockets.interact("mirror", (tx, 2.65, 1.85), kind="mirror")
    fireplace("dining_fire", -14.6, 2.875)
    sockets.socket("prop_painting", (-14.6, 2.875 - 0.03, 1.75), rot_z=math.pi)
    for i, x in enumerate((-7.0, -16.0)):
        portrait(f"dining_portrait_{i}", x, 2.875, 2.0, math.pi, color="curtain_plum" if i else "cloth_blue")

    # South-west corner: the record player, its record on a side table, an armchair.
    F("record_player")("record", (-16.45, -4.875 + 0.22, 0.0))
    sockets.interact("record_player", (-16.45, -4.3, 0.95), kind="record_player")
    F("side_table")("record_table", (-15.55, -4.5, 0.0), radius=0.25)
    sockets.socket("prop_record", (-15.55, -4.5, 0.624))
    F("armchair")("dining_armchair", (-16.25, 1.6, 0.0), rot_z=-2.4, fabric="cloth_green")
    F("floor_lamp")("dining_floor_lamp", (-16.55, 2.5, 0.0))
    for i, y in enumerate((-2.9, 0.9)):
        F("potted_plant")(f"dining_plant_{i}", (-4.55, y, 0.0), kind="tree", height=1.6, seed=10 + i)

    # Light switch by the archway; the chandelier over the table.
    prims.box("light_switch", (0.02, 0.08, 0.12), (-4.135, 0.55, 1.25), "brass")
    sockets.interact("lights", (-4.25, 0.55, 1.25), kind="lights")
    prims.cylinder("lamp_cord", 0.012, 0.9, (tx, ty, WALL_H - 0.9), "brass", segments=4)
    parts = [
        prims.lathe("chandelier_body", [(0.0, 0.0), (0.14, 0.05), (0.08, 0.22), (0.12, 0.32), (0.0, 0.36)], (0.0, 0.0, 0.0), "brass", segments=8),
        prims.torus("chandelier_ring", 0.45, 0.025, (0.0, 0.0, 0.12), "brass", segments=12, sides=4),
    ]
    for i in range(6):
        a = i * math.pi / 3
        x, y = 0.45 * math.cos(a), 0.45 * math.sin(a)
        parts.append(prims.cylinder(f"chandelier_cup_{i}", 0.04, 0.04, (x, y, 0.12), "brass", segments=6))
        parts.append(prims.cylinder(f"chandelier_candle_{i}", 0.02, 0.14, (x, y, 0.16), "candle", segments=5))
        parts.append(prims.blob(f"chandelier_flame_{i}", (0.02, 0.02, 0.035), (x, y, 0.33), "flame", segments=5, rings=3))
    # The light hangs just under the chandelier's body (a light inside it would be shut in).
    prims.place(prims.join("lamp_shade", parts), (tx, ty, WALL_H - 1.26))
    sockets.socket("lamp_light", (tx, ty, WALL_H - 1.4))

    # Where arriving guests wait to be seated: a row south and a row north of the table.
    xs = (-8.4, -9.6, -10.8, -12.0)
    for i, x in enumerate(xs):
        sockets.socket(f"stand_{i}", (x, ty - 2.0, 0.0), rot_z=0.0)
    for i, x in enumerate(xs):
        sockets.socket(f"stand_{4 + i}", (x, ty + 2.0, 0.0), rot_z=math.pi)


def fireplace(name, x, wall_y, rot_z=math.pi):
    """A stone fireplace with its back on a wall face at y = wall_y, facing -Y (rot pi)."""
    parts = [
        prims.box(f"{name}_surround", (1.8, 0.3, 1.3), (0.0, 0.15, 0.65), "stone", bevel=0.02),
        prims.box(f"{name}_mantel", (2.1, 0.42, 0.1), (0.0, 0.2, 1.35), "stone", bevel=0.02),
        prims.box(f"{name}_hearth", (2.0, 0.5, 0.06), (0.0, 0.3, 0.03), "stone_dark"),
        prims.box(f"{name}_firebox", (0.9, 0.04, 0.8), (0.0, 0.31, 0.45), "black"),
    ]
    for i, dx in enumerate((-0.15, 0.12)):
        parts.append(prims.cylinder_x(f"{name}_log_{i}", 0.06, 0.6, (dx, 0.42, 0.12 + 0.06 * i), "wood_dark", segments=6, rot_z=0.3 * (1 - 2 * i)))
    parts.append(prims.cone(f"{name}_flame", 0.18, 0.4, (0.0, 0.42, 0.15), "fire", segments=6))
    obj = prims.join(name, parts)
    prims.place(obj, (x, wall_y, 0.0), rot_z)
    c = prims.to_world((x, wall_y, 0.0), rot_z, (0.0, 0.2, 0.7))
    sockets.collider_box(name, c, (2.1, 0.45, 1.4), rot_z=rot_z)


def corridor():
    F("rug")("corridor_runner", (-10.5, 4.0, 0.0), length=10.5, width=0.9, field="cloth_green", border="cloth_mustard", medallion="cloth_green")
    prims.box("corridor_bench", (1.4, 0.4, 0.45), (-13.2, 4.62, 0.225), "wood_dark", bevel=0.02)
    sockets.collider_box("corridor_bench", (-13.2, 4.62, 0.225), (1.4, 0.4, 0.45))
    for i, (x, color) in enumerate(((-9.0, "cloth_red"), (-13.2, "denim"), (-6.5, "cloth_mustard"))):
        portrait(f"corridor_portrait_{i}", x, 3.125 if i != 1 else 4.875, 1.7, 0.0 if i != 1 else math.pi, w=0.5, h=0.65, color=color)
    sockets.socket("room_light_corridor", (-10.5, 4.0, WALL_H - 0.35))


def kitchen():
    # North run (facing south): fridge, chopping counter, range, pot counter, oven, sink, worktop.
    ny = 12.0 - T / 2  # inside face of the north wall
    F("fridge")("fridge", (-16.5, ny - 0.35, 0.0), rot_z=math.pi)
    sockets.interact("fridge", (-16.5, ny - 0.83, 1.1), kind="fridge")

    F("counter")("counter_chop", (-15.6, ny - 0.31, 0.0), rot_z=math.pi, length=1.0)
    cb = (-15.75, ny - 0.35)
    prims.box("chopping_board", (0.45, 0.32, 0.03), (cb[0], cb[1], WORKTOP + 0.015), "wood_light", bevel=0.01)
    prims.box("chopping_knife", (0.22, 0.03, 0.01), (cb[0] + 0.05, cb[1] - 0.13, WORKTOP + 0.035), "steel", rot_z=0.3)
    sockets.interact("chop", (cb[0], cb[1], WORKTOP + 0.15), kind="chop")
    sockets.socket("station_chop", (cb[0], cb[1], WORKTOP + 0.03))
    F("shelf")("kitchen_shelf_a", (-15.6, ny, 0.0), rot_z=math.pi, length=1.0, mount=1.7, seed=7)

    sx, sw = -14.65, 0.9
    F("stove")("stove", (sx, ny - 0.31, 0.0), rot_z=math.pi, width=sw)
    for i, lx in enumerate((0.17 * sw / 0.7, -0.17 * sw / 0.7)):
        bx, by, _ = prims.to_world((sx, ny - 0.31, 0.0), math.pi, (lx, -0.03, 0.0))
        sockets.interact(f"hob_{i}", (bx, by, WORKTOP + 0.15), kind="hob")
        sockets.socket(f"station_hob_{i}", (bx, by, WORKTOP + 0.04))
    prims.box("range_hood", (1.1, 0.5, 0.5), (sx, ny - 0.25, 2.35), "copper", bevel=0.03)

    F("counter")("counter_pot", (-13.8, ny - 0.31, 0.0), rot_z=math.pi, length=0.8, drawers=False)
    sockets.socket("prop_pot", (-13.8, ny - 0.3, WORKTOP))

    ox = -13.0
    F("counter")("oven", (ox, ny - 0.31, 0.0), rot_z=math.pi, length=0.8, drawers=False)
    fy = ny - 0.62
    prims.box("oven_front", (0.74, 0.02, 0.66), (ox, fy - 0.025, 0.48), "steel_dark", bevel=0.008)
    prims.box("oven_glass", (0.5, 0.012, 0.3), (ox, fy - 0.04, 0.45), "glass_dark")
    prims.cylinder_x("oven_handle", 0.012, 0.56, (ox, fy - 0.08, 0.76), "steel", segments=6)
    for i, x in enumerate((ox - 0.24, ox + 0.24)):
        prims.cylinder_y(f"oven_knob_{i}", 0.022, 0.03, (x, fy - 0.045, 0.86), "black", segments=6)
    sockets.interact("oven", (ox, fy - 0.17, 0.95), kind="oven")
    sockets.socket("station_oven", (ox, ny - 0.3, WORKTOP + 0.02))

    F("sink")("sink", (-12.1, ny - 0.31, 0.0), rot_z=math.pi, length=1.0)
    F("window")("kitchen_window", (-12.2, 12.0, 0.0), rot_z=math.pi, width=1.0, height=1.1, sill=1.3, wall_t=T)
    F("counter")("counter_end", (-11.0, ny - 0.31, 0.0), rot_z=math.pi, length=1.2)
    sockets.socket("prop_tea_towel", (-10.8, ny - 0.3, WORKTOP + 0.01))
    F("shelf")("kitchen_shelf_b", (-11.0, ny, 0.0), rot_z=math.pi, length=1.2, mount=1.7, seed=9)
    F("cupboard")("dresser", (-9.2, ny - 0.3, 0.0), rot_z=math.pi, width=1.3, height=2.1)

    # The island in the middle: the plate stack at one end, the pass, the pan.
    ix, iy = -13.6, 8.6
    F("kitchen_island")("island", (ix, iy, 0.0), length=2.2, depth=0.9)
    stack = [prims.cylinder(f"plate_stack_{i}", 0.13, 0.015, (0.0, 0.0, i * 0.017), "porcelain", segments=10) for i in range(6)]
    prims.place(prims.join("plate_stack", stack), (ix - 0.8, iy, WORKTOP))
    sockets.interact("plates", (ix - 0.8, iy, WORKTOP + 0.15), kind="plates")
    sockets.interact("pass", (ix - 0.05, iy, WORKTOP + 0.12), kind="pass")
    sockets.socket("station_pass", (ix - 0.05, iy, WORKTOP + 0.02))
    sockets.socket("prop_pan", (ix + 0.65, iy, WORKTOP + 0.01), rot_z=math.pi / 2)
    bell = [prims.cylinder("bell_base", 0.04, 0.01, (0.0, 0.0, 0.0), "brass", segments=8), prims.blob("bell_dome", (0.035, 0.035, 0.03), (0.0, 0.0, 0.012), "brass", segments=8, rings=4)]
    prims.place(prims.join("service_bell", bell), (ix + 0.25, iy - 0.3, WORKTOP))

    # The servants' table by the door.
    kx, ky = -9.6, 7.2
    parts = [prims.box("kitchen_table_top", (1.6, 0.9, 0.06), (0.0, 0.0, 0.75), "wood_light", bevel=0.015)]
    for i, (sx_, sy_) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
        parts.append(prims.box(f"kitchen_table_leg_{i}", (0.07, 0.07, 0.72), (sx_ * 0.7, sy_ * 0.36, 0.36), "wood_mid"))
    prims.place(prims.join("kitchen_table", parts), (kx, ky, 0.0))
    sockets.collider_box("kitchen_table", (kx, ky, 0.39), (1.6, 0.9, 0.78))
    for i, (dy, r) in enumerate(((-0.75, 0.0), (0.75, math.pi))):
        F("chair")(f"kitchen_chair_{i}", (kx + 0.3 * (1 - 2 * i), ky + dy, 0.0), rot_z=r, cushion="cloth_red")

    # The Rumor Ledger chalkboard (west wall) and the guest whiteboard (south wall).
    wx = -17.0 + T / 2
    F("chalkboard")("chalkboard", (wx, 8.6, 0.0), rot_z=-math.pi / 2, width=1.3, height=0.9, mount=1.0)
    sockets.interact("chalkboard", (wx + 0.16, 8.6, 1.45), kind="chalkboard")
    sy = 5.0 + T / 2
    prims.box("whiteboard_frame", (1.1, 0.03, 0.75), (-14.5, sy + 0.015, 1.55), "steel", bevel=0.008)
    board = prims.panel("whiteboard_surface", 1.02, 0.67, (-14.5, sy + 0.034, 1.55), "tint_white")
    prims.planar_uv(board, "board")
    prims.box("whiteboard_tray", (0.7, 0.06, 0.02), (-14.5, sy + 0.05, 1.18), "steel")
    sockets.interact("whiteboard", (-14.5, sy + 0.2, 1.55), kind="whiteboard")
    sockets.socket("room_light_kitchen", (-12.5, 8.5, WALL_H - 0.35))


def hall():
    # The grand front door, a portico outside, a chandelier, the clock and the coats.
    F("rug")("hall_rug", (0.0, -1.0, 0.0), length=3.2, width=4.2, field="cloth_blue", border="cloth_mustard", medallion="carpet_red")
    F("side_table")("hall_round_table", (0.0, 1.6, 0.0), radius=0.55, height=0.78, doily=None)
    vase = prims.lathe("hall_vase", [(0.06, 0.0), (0.11, 0.12), (0.07, 0.28), (0.09, 0.34)], (0.0, 1.6, 0.78), "ceramic_blue", segments=8)
    flowers = [prims.blob(f"hall_flower_{i}", (0.12, 0.12, 0.1), (0.1 * math.cos(i * 2.1), 1.6 + 0.1 * math.sin(i * 2.1), 1.2 + 0.05 * i), ("rose", "plant_green", "cloth_cream")[i], segments=6, rings=4, wobble=0.15, seed=i) for i in range(3)]
    prims.join("hall_flowers", [vase] + flowers)
    F("coat_stand")("coat_stand", (3.4, -4.3, 0.0), coat="cloth_green", hat="cloth_black")
    F("side_table")("hall_table_a", (3.45, -2.6, 0.0), radius=0.28)
    sockets.socket("prop_snow_globe", (3.45, -2.6, 0.624))
    F("side_table")("hall_table_b", (3.45, 2.4, 0.0), radius=0.28)
    sockets.socket("prop_photo_frame", (3.45, 2.4, 0.624), rot_z=math.pi / 2)
    # A grandfather clock and a suit of armour.
    clock = [
        prims.box("clock_case", (0.5, 0.35, 2.1), (0.0, 0.0, 1.05), "wood_dark", bevel=0.02),
        prims.box("clock_hood", (0.58, 0.4, 0.3), (0.0, 0.0, 2.25), "wood_dark", bevel=0.03),
        prims.cylinder_y("clock_face", 0.17, 0.02, (0.0, 0.18, 1.85), "cloth_cream", segments=10),
        prims.box("clock_door", (0.3, 0.02, 1.0), (0.0, 0.18, 0.95), "glass_dark"),
        prims.blob("clock_bob", (0.06, 0.01, 0.06), (0.0, 0.2, 0.7), "brass", segments=6, rings=4),
    ]
    prims.place(prims.join("grandfather_clock", clock), (-3.55, 2.6, 0.0), -math.pi / 2)
    sockets.collider_box("grandfather_clock", (-3.55, 2.6, 1.2), (0.42, 0.6, 2.4))
    armour = [
        prims.box("armour_plinth", (0.6, 0.5, 0.12), (0.0, 0.0, 0.06), "stone"),
        prims.capsule("armour_body", 0.2, 0.95, (0.0, 0.0, 0.75), "metal_silver"),
        prims.blob("armour_helm", (0.14, 0.15, 0.17), (0.0, 0.0, 1.85), "metal_silver", segments=8, rings=5),
        prims.box("armour_visor", (0.16, 0.03, 0.03), (0.0, 0.14, 1.86), "black"),
        prims.cylinder("armour_halberd", 0.02, 2.4, (0.3, 0.05, 0.12), "wood_dark", segments=4),
        prims.box("armour_blade", (0.03, 0.2, 0.3), (0.3, 0.05, 2.4), "metal_silver"),
    ]
    for i, s in enumerate((-1, 1)):
        armour.append(prims.capsule(f"armour_arm_{i}", 0.06, 0.6, (s * 0.27, 0.0, 1.0), "metal_silver"))
        armour.append(prims.capsule(f"armour_leg_{i}", 0.08, 0.75, (s * 0.1, 0.0, 0.12), "metal_silver"))
    prims.place(prims.join("suit_of_armour", armour), (-3.45, -4.3, 0.0), -math.pi / 2)
    sockets.collider_box("suit_of_armour", (-3.45, -4.3, 1.1), (0.6, 0.6, 2.2))
    for i, x in enumerate((-2.2, 2.2)):
        F("potted_plant")(f"hall_plant_{i}", (x, 4.45, 0.0), kind="tree", height=1.7, seed=20 + i)
    portrait("hall_portrait", 4.0 - T / 2, 1.0, 1.9, math.pi / 2, w=0.9, h=1.1, color="grass")
    hall_lamp = [prims.lathe("hall_chandelier_body", [(0.0, 0.0), (0.2, 0.1), (0.1, 0.3), (0.0, 0.34)], (0.0, 0.0, 0.0), "brass", segments=8)]
    for i in range(5):
        a = i * 2 * math.pi / 5
        hall_lamp.append(prims.blob(f"hall_chandelier_bulb_{i}", (0.05, 0.05, 0.07), (0.32 * math.cos(a), 0.32 * math.sin(a), 0.12), "candle", segments=6, rings=4))
    prims.place(prims.join("hall_chandelier", hall_lamp), (0.0, -1.0, WALL_H - 0.7))
    prims.cylinder("hall_chandelier_chain", 0.012, 0.4, (0.0, -1.0, WALL_H - 0.4), "brass", segments=4)
    sockets.socket("room_light_hall", (0.0, -1.0, WALL_H - 0.9))

    # Arriving guests walk: under the portico → just inside → across the hall to the archway →
    # into the dining hall, then to their standing spot via the south or north side of the table.
    sockets.socket("guest_door", (0.0, -5.9, 0.0), rot_z=0.0)
    sockets.socket("visitor_door", (0.75, -5.9, 0.0), rot_z=0.0)
    sockets.socket("path_0", (0.4, -3.7, 0.0))
    sockets.socket("path_1", (-2.6, TABLE_Y, 0.0))
    sockets.socket("path_2", (-5.0, TABLE_Y, 0.0))
    sockets.socket("path_s", (-6.6, TABLE_Y - 2.0, 0.0))
    sockets.socket("path_n", (-6.6, TABLE_Y + 2.0, 0.0))
    # Gary from the next farm stands in the hall, peering through the archway at the table.
    sockets.socket("neighbor", (-2.7, -1.9, 0.0), rot_z=math.pi / 2)


def study():
    # A library: bookcases, a desk, armchairs by the fire, a globe.
    ny = 5.0 - T / 2
    for i, x in enumerate((5.3, 6.35, 9.65, 10.7)):
        F("bookcase")(f"bookcase_n_{i}", (x, ny - 0.18, 0.0), rot_z=math.pi, width=1.0, height=2.3, seed=30 + i)
    fireplace("study_fire", 8.0, ny)
    ex = 12.0 - T / 2
    for i, y in enumerate((3.0, 1.95, -2.4, -3.45)):
        F("bookcase")(f"bookcase_e_{i}", (ex - 0.18, y, 0.0), rot_z=math.pi / 2, width=1.0, height=2.3, seed=40 + i, books=i % 2 == 0)
    F("rug")("study_rug", (8.0, 0.0, 0.0), length=4.0, width=3.0, field="cloth_green", border="wood_mid", medallion="cloth_mustard")
    for i, (x, r) in enumerate(((6.8, -0.62), (9.2, 0.62))):
        F("armchair")(f"study_armchair_{i}", (x, 2.8, 0.0), rot_z=r, fabric="leather", cushion="cloth_red")
    F("side_table")("study_side_table", (8.0, 2.6, 0.0), radius=0.25)
    # The desk.
    dx, dy = 8.0, -2.2
    parts = [prims.box("desk_top", (1.8, 0.85, 0.06), (0.0, 0.0, 0.76), "wood_dark", bevel=0.015)]
    for i, s in enumerate((-1, 1)):
        parts.append(prims.box(f"desk_pedestal_{i}", (0.45, 0.75, 0.73), (s * 0.6, 0.0, 0.365), "wood_mid", bevel=0.01))
    parts.append(prims.box("desk_blotter", (0.6, 0.4, 0.01), (0.0, -0.05, 0.795), "cloth_green"))
    parts.append(prims.cylinder("desk_lamp_base", 0.08, 0.3, (0.6, 0.2, 0.79), "brass", segments=6))
    parts.append(prims.cylinder("desk_lamp_shade", 0.15, 0.12, (0.6, 0.2, 1.05), "cloth_green", segments=8, radius_top=0.08))
    prims.place(prims.join("desk", parts), (dx, dy, 0.0))
    sockets.collider_box("desk", (dx, dy, 0.4), (1.8, 0.85, 0.8))
    F("chair")("desk_chair", (dx, dy + 0.75, 0.0), rot_z=math.pi, cushion="cloth_green")
    globe = [
        prims.lathe("globe_stand", [(0.18, 0.0), (0.04, 0.05), (0.03, 0.6), (0.0, 0.62)], (0.0, 0.0, 0.0), "wood_dark", segments=6),
        prims.blob("globe_ball", (0.25, 0.25, 0.25), (0.0, 0.0, 0.85), "ceramic_blue", segments=10, rings=6),
        prims.torus("globe_ring", 0.27, 0.012, (0.0, 0.0, 0.85), "brass", segments=12, sides=4, rot=(math.radians(70), 0.0, 0.0)),
    ]
    prims.place(prims.join("globe", globe), (5.2, -4.0, 0.0))
    sockets.collider_box("globe", (5.2, -4.0, 0.55), (0.5, 0.5, 1.1))
    for i, x in enumerate((6.0, 10.0)):
        F("window")(f"study_window_{i}", (x, -5.0, 0.0), width=1.3, height=1.8, sill=0.8, wall_t=T, panes=(2, 3))
    F("floor_lamp")("study_floor_lamp", (10.5, 3.2, 0.0), shade="cloth_mustard")
    sockets.socket("room_light_study", (8.0, 0.0, WALL_H - 0.35))


def cellar():
    # The stairs down from the corridor: the top step at the corridor wall (y 5), the foot at y 9.
    F("stairs")("cellar_stairs", (-7.0, 7.0, CELLAR_Z), rot_z=math.pi, width=1.5, run=4.0, rise=-CELLAR_Z, rail="-x", runner=None)
    # The stairs' ramp collider stops half a tread short of the top step: a landing under that
    # tread joins it to the doorway floor without a gap.
    sockets.collider_box("cellar_landing", (-7.0, 5.04, -0.1), (1.6, 0.34, 0.2))
    # Racks along the north wall, barrels, the fuse box by the stairs.
    ny = 14.0 - T / 2
    for i, x in enumerate((-8.2, -7.4, -6.6, -5.0, -4.2)):
        F("wine_rack")(f"wine_rack_{i}", (x, ny - 0.16, CELLAR_Z), rot_z=math.pi, seed=4 + i)
    sockets.interact("wine_rack", (-6.6, ny - 0.5, CELLAR_Z + 0.7), kind="wine_rack")
    for i, (x, y) in enumerate(((-2.7, 12.9), (-2.7, 12.15), (-3.45, 12.9))):
        barrel = prims.lathe(f"barrel_{i}", [(0.28, 0.0), (0.34, 0.4), (0.28, 0.8), (0.0, 0.8)], (x, y, CELLAR_Z), "wood_mid", segments=8)
        prims.paint_faces(barrel, lambda f: "metal_iron" if abs(f.center.z - 0.4) < 0.08 or f.center.z < 0.1 else None)
        sockets.collider_box(f"barrel_{i}", (x, y, CELLAR_Z + 0.4), (0.66, 0.66, 0.8))
    F("shelf")("cellar_shelf", (-9.0 + T / 2, 11.0, CELLAR_Z), rot_z=-math.pi / 2, length=1.6, mount=1.3, seed=11)
    F("fuse_box")("fuse_box", (-2.0 - T / 2, 10.3, CELLAR_Z), rot_z=math.pi / 2, mount=1.0, conduit=0.6)
    sockets.interact("fuse_box", (-2.0 - T / 2 - 0.3, 10.3, CELLAR_Z + 1.22), kind="fuse_box")
    sockets.socket("room_light_cellar", (-5.5, 11.5, CELLAR_TOP - 0.25))


def coach_house():
    # Where the family's old car sleeps under a dust sheet, and so does the dog.
    cx, cy = 18.0, -12.0
    car = [
        prims.rounded_box("car_body", (1.8, 4.2, 0.9), (0.0, 0.0, 0.75), "cloth_cream", radius=0.2),
        prims.rounded_box("car_cabin", (1.6, 2.0, 0.7), (0.0, -0.3, 1.45), "cloth_cream", radius=0.25),
    ]
    for i, (sx_, sy_) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
        car.append(prims.cylinder_x(f"car_wheel_{i}", 0.34, 0.24, (sx_ * 0.82, sy_ * 1.35, 0.34), "tire", segments=10))
    prims.place(prims.join("covered_car", car), (cx, cy, 0.0))
    sockets.collider_box("covered_car", (cx, cy, 0.9), (1.9, 4.3, 1.8))
    F("workbench")("workbench", (21.0 - T / 2 - 0.36, -9.8, 0.0), rot_z=math.pi / 2, length=1.8)
    F("shelf")("coach_shelf", (21.0 - T / 2, -14.0, 0.0), rot_z=math.pi / 2, length=1.6, mount=1.5, seed=13)
    for i, (x, y) in enumerate(((20.3, -15.3), (19.6, -15.4))):
        prims.box(f"hay_bale_{i}", (0.6, 0.9, 0.45), (x, y, 0.225 + (0.45 if i == 2 else 0.0)), "cheese", bevel=0.04, rot_z=0.15 * i)
        sockets.collider_box(f"hay_bale_{i}", (x, y, 0.225), (0.62, 0.92, 0.45), rot_z=0.15 * i)
    F("dog_bed")("dog_bed", (14.4, -15.0, 0.0), rot_z=math.pi / 4)
    sockets.socket("dog", (14.4, -15.0, 0.08), rot_z=math.pi / 4)
    sockets.socket("room_light_garage", (17.0, -12.0, WALL_H - 0.4))


def grounds():
    # The gravel drive round a lawn and fountain, hedges all round, the gate shut to the south.
    prims.cylinder("drive_lawn", 3.2, 0.03, (-4.0, -14.5, -0.02), "grass", segments=16)
    prims.lathe("fountain_basin", [(1.4, 0.0), (1.45, 0.45), (1.3, 0.5), (1.25, 0.32), (0.0, 0.32)], (-4.0, -14.5, 0.0), "stone", segments=12)
    prims.lathe("fountain_column", [(0.25, 0.3), (0.12, 0.6), (0.1, 1.3), (0.45, 1.4), (0.35, 1.55), (0.0, 1.55)], (-4.0, -14.5, 0.0), "stone", segments=8)
    prims.cylinder("fountain_water", 1.26, 0.02, (-4.0, -14.5, 0.36), "glass", segments=12)
    sockets.collider_box("fountain", (-4.0, -14.5, 0.6), (2.6, 2.6, 1.2))
    hedge("hedge_w", -20.4, -20.0, -22.0, -5.0)
    hedge("hedge_nw", -20.4, -17.0, -5.0, -4.8)
    hedge("hedge_s_w", -20.4, -5.0, -22.4, -22.0)
    hedge("hedge_s_e", -1.0, 13.0, -22.4, -22.0)
    hedge("hedge_e_s", 13.0, 13.4, -22.4, -16.0)
    hedge("hedge_e_n", 13.0, 13.4, -8.0, -4.8)
    hedge("hedge_ne", 12.0, 13.0, -5.0, -4.8)
    # Gate piers and the shut iron gates.
    for i, x in enumerate((-5.25, -0.75)):
        solid(f"gate_pier_{i}", x - 0.25, x + 0.25, -22.45, -21.95, 0.0, 2.2, "stone", bevel=0.02)
        prims.blob(f"gate_pier_ball_{i}", (0.2, 0.2, 0.2), (x, -22.2, 2.4), "stone", segments=8, rings=5)
    sockets.collider_box("gate", (-3.0, -22.2, 1.5), (4.0, 0.2, 3.0))
    prims.box("gate_rail_top", (4.0, 0.06, 0.08), (-3.0, -22.2, 1.9), "metal_iron")
    prims.box("gate_rail_bottom", (4.0, 0.06, 0.08), (-3.0, -22.2, 0.2), "metal_iron")
    for i in range(14):
        prims.box(f"gate_bar_{i}", (0.03, 0.03, 1.8), (-4.85 + i * 0.285, -22.2, 1.0), "metal_iron")
    # The portico over the front door.
    for i, x in enumerate((-1.3, 1.3)):
        prims.lathe(f"portico_column_{i}", [(0.24, 0.0), (0.24, 0.15), (0.18, 0.2), (0.15, 2.85), (0.22, 2.95), (0.22, 3.05)], (x, -6.2, 0.0), "stone", segments=8)
        sockets.collider_box(f"portico_column_{i}", (x, -6.2, 1.5), (0.4, 0.4, 3.0))
    prims.box("portico_roof", (3.4, 1.6, 0.25), (0.0, -5.85, 3.17), "stone", bevel=0.03)
    prims.prism("portico_pediment", [(-1.7, 0.0), (1.7, 0.0), (0.0, 0.7)], 1.5, (0.0, -5.85, 3.295), "stone", rot_z=math.pi / 2)
    for i, x in enumerate((-1.05, 1.05)):
        prims.box(f"porch_lantern_{i}", (0.18, 0.18, 0.32), (x, -5.25, 2.25), "headlight", bevel=0.03)
    sockets.socket("room_light_porch", (0.0, -5.9, 2.6))
    # A lamp post by the van.
    lx, ly = 3.0, -9.0
    prims.cylinder("lamp_post", 0.07, 3.0, (lx, ly, 0.0), "metal_iron", segments=6)
    prims.box("lamp_post_lantern", (0.3, 0.3, 0.42), (lx, ly, 3.15), "headlight", bevel=0.04)
    prims.cone("lamp_post_cap", 0.25, 0.2, (lx, ly, 3.36), "metal_iron", segments=4)
    sockets.collider_box("lamp_post", (lx, ly, 1.5), (0.2, 0.2, 3.0))
    sockets.socket("room_light_outside", (lx, ly, 2.8))
    # The west garden behind the moon window (looked at, never walked in).
    hedge("garden_hedge_w", -26.4, -26.0, -6.0, 12.0, height=1.4)
    tree("garden_tree_a", -23.5, 6.0, seed=1)
    tree("garden_tree_b", -22.0, -8.5, height=4.0, seed=2)
    tree("drive_tree", 10.0, -19.5, height=5.0, seed=3, collide=True)

    # The catering van on the gravel, rear doors open toward the front door.
    vx, vy = 6.0, -13.0
    F("van")("van", (vx, vy, 0.0), rot_z=math.pi)
    sockets.interact("van", (vx, vy + 2.75, 1.1), kind="van")
    sockets.socket("van_rear", (vx, vy + 3.2, 0.0), rot_z=math.pi)


def layout():
    sockets.room("dining", (-10.5, -1.0, WALL_H / 2), (13.0, 8.0, WALL_H))
    sockets.room("corridor", (-10.5, 4.0, WALL_H / 2), (13.0, 2.0, WALL_H))
    sockets.room("kitchen", (-12.5, 8.5, WALL_H / 2), (9.0, 7.0, WALL_H))
    sockets.room("hall", (0.0, 0.0, WALL_H / 2), (8.0, 10.0, WALL_H))
    sockets.room("study", (8.0, 0.0, WALL_H / 2), (8.0, 10.0, WALL_H))
    sockets.room("cellar", (-7.0, 7.0, (CELLAR_Z + WALL_H) / 2), (2.0, 4.0, WALL_H - CELLAR_Z), part="stairs")
    sockets.room("cellar", (-5.5, 11.5, (CELLAR_Z + CELLAR_TOP) / 2), (7.0, 5.0, CELLAR_TOP - CELLAR_Z), part="main")
    sockets.room("garage", (17.0, -12.0, WALL_H / 2), (8.0, 8.0, WALL_H))
    sockets.room("outside", (-3.5, -13.5, 2.5), (33.0, 17.0, 5.0))
    # Lobby spawns behind the van, facing the house.
    for i, (x, y) in enumerate(((4.8, -9.2), (6.0, -9.0), (7.2, -9.2), (4.8, -8.1), (6.0, -7.9), (7.2, -8.1))):
        sockets.spawn(str(i), (x, y, 0.0), 0.0)


CLIENT_MESHES = ("lamp_shade", "lamp_cord", "chalkboard_surface", "whiteboard_surface", "moon", "curtain_l", "curtain_r", "curtain_closed", "mirror_cover", "record_disc")


def check_client_names():
    """The client finds these meshes by name (render/HouseView.ts): fail the build without them.
    Door leaves must rest at zero yaw with their origin on the hinge (the client sets the yaw)."""
    objs = {o.name: o for o in bpy.context.scene.objects}
    problems = [f"missing mesh {n}" for n in CLIENT_MESHES if objs.get(n) is None or objs[n].type != "MESH"]
    if not any(n.startswith("ceiling_") for n in objs):
        problems.append("no ceiling_* meshes")
    for o in objs.values():
        if o.type == "EMPTY" and o.name.startswith("door_") and o.get("leaf"):
            leaf = objs.get(f"doorleaf_{o.name[len('door_'):]}")
            if leaf is None or leaf.type != "MESH":
                problems.append(f"{o.name} has no leaf mesh")
            elif any(abs(a) > 1e-6 for a in leaf.rotation_euler):
                problems.append(f"{leaf.name} must rest unrotated (is {tuple(leaf.rotation_euler)})")
    if problems:
        raise RuntimeError("; ".join(problems))


def build():
    floors()
    walls()
    roofs()
    doors()
    dining()
    corridor()
    kitchen()
    hall()
    study()
    cellar()
    coach_house()
    grounds()
    layout()
    check_client_names()
