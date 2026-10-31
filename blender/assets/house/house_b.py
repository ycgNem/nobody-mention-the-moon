"""House B: a ground-floor city flat in a mansion block. Small and close: a galley kitchen whose
one door opens onto the dining room, a short hall from the flat's front door, a bathroom and a
bedroom (where the dog sleeps). The flat's front door opens onto the building's lobby, and the
lobby's street door onto the pavement, where the catering van waits at the kerb.

Blender Z-up, meters. Rooms (wall centerlines):
    dining    x -7.6..-2.0  y -3.0..2.4     kitchen  x -7.6..-3.4  y 2.4..5.0 (galley)
    hall      x -2.0..0.6   y -3.0..2.4     bathroom x -3.4..-0.8  y 2.4..5.0
    bedroom   x -0.8..2.6   y 2.4..5.0
    outside   lobby x -3.0..3.0 y -6.0..-3.0, street x -10..10 y -16..-6 (van at x 4.2 y -10)
Everything is within a few steps: the kitchen door is three meters from the table, and the front
door is in earshot of the dining room while the hall archway is open. The moon rises over the
courtyard behind the French window at the west end of the table.

Furniture comes from blender/lib/furniture; walls, floors and the street are built here.
"""

import math

import bpy
from mathutils import Matrix

from lib import furniture, prims, sockets

KIND = "house"

WALL_H = 2.7
LOBBY_H = 3.0
FACADE_H = 8.4
T = 0.2
DOOR_W, DOOR_H = 0.9, 2.1

TABLE_X, TABLE_Y = -4.8, -0.3
TABLE_L, TABLE_W, TABLE_H = 2.4, 1.0, 0.75
TABLE_TOP = TABLE_H + 0.012  # on the cloth
WORKTOP = 0.92

# Wall skins by what is on that side of the wall. None: nobody ever sees that face.
SKIN = {
    "dining": "wallpaper_blue",
    "kitchen": "wall_kitchen",
    "hall": "wall_cream",
    "bathroom": "tile_white",
    "bedroom": "wallpaper_rose",
    "lobby": "stone",
    "street": "brick",
    "court": "brick",
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
    objs = F("door_leaf")(f"frame_{door_id}", (x, y, 0.0), rot_z=rot, width=width, height=height, door=door, frame=frame, leaf_name=f"doorleaf_{door_id}", leaf_collider=True)
    leaf = next(o for o in objs if o.name == f"doorleaf_{door_id}")
    if abs(rot) > 1e-9:
        leaf.data.transform(Matrix.Rotation(rot, 4, "Z"))
        leaf.rotation_euler = (0.0, 0.0, 0.0)
    sockets.door(door_id, (x, y, 0.0), a=a, b=b, leaf=True, open=open_)
    sockets.interact(door_id, (x, y, 1.0), kind="door")


def moon_window(objs):
    """The window the moon is seen through has no pane: the palette glass is opaque, and the
    table has to see the moon when the curtains are open."""
    for o in [o for o in objs if o.name.endswith("_glass")]:
        mesh = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(mesh)


def chair(i, x, y, rot_z):
    F("chair")(f"chair_{i}", (x, y, 0.0), rot_z=rot_z, cushion="cloth_mustard")
    sockets.seat(str(i), (x, y, 0.45), rot_z)
    px, py, _ = prims.to_world((x, y, 0.0), rot_z, (0.0, 0.62, 0.0))
    sockets.socket(f"plate_{i}", (px, py, TABLE_TOP + 0.004), rot_z=rot_z)


def ceiling(name, x0, x1, y0, y1, z):
    prims.box(f"ceiling_{name}", (x1 - x0, y1 - y0, 0.1), ((x0 + x1) / 2, (y0 + y1) / 2, z + 0.05), "plaster")


def floor(name, x0, x1, y0, y1, color, z=0.0):
    prims.box(f"floor_{name}", (x1 - x0, y1 - y0, 0.02), ((x0 + x1) / 2, (y0 + y1) / 2, z - 0.01), color)


# ---------------------------------------------------------------------------------------------
# Shell


def floors():
    # One collider under the flat, the lobby and the street; colored floors on top.
    sockets.collider_box("ground", (-1.0, -5.6, -0.1), (22.4, 21.6, 0.2))
    floor("dining", -7.6, -2.0, -3.0, 2.4, "wood_floor")
    floor("kitchen", -7.6, -3.4, 2.4, 5.0, "tile_black")
    floor("hall", -2.0, 0.6, -3.0, 2.4, "wood_mid")
    floor("bathroom", -3.4, -0.8, 2.4, 5.0, "tile_white")
    floor("bedroom", -0.8, 2.6, 2.4, 5.0, "rug")
    floor("lobby", -3.0, 3.0, -6.0, -3.0, "stone_dark")
    prims.box("lobby_runner", (1.2, 2.6, 0.012), (-0.35, -4.5, 0.006), "carpet_red")
    floor("pavement", -10.0, 10.0, -8.5, -6.0, "stone")
    floor("road", -10.0, 10.0, -16.4, -8.5, "asphalt")
    prims.box("kerb", (20.0, 0.16, 0.03), (0.0, -8.5, 0.015), "stone_dark")
    for i in range(6):
        prims.box(f"road_dash_{i}", (1.4, 0.1, 0.006), (-8.0 + i * 3.2, -12.4, 0.003), "chalk")
    floor("courtyard", -12.2, -7.7, -6.0, 5.2, "grass")
    for name, (x0, x1, y0, y1) in {
        "dining": (-7.6, -2.0, -3.0, 2.4),
        "kitchen": (-7.6, -3.4, 2.4, 5.0),
        "hall": (-2.0, 0.6, -3.0, 2.4),
        "bathroom": (-3.4, -0.8, 2.4, 5.0),
        "bedroom": (-0.8, 2.6, 2.4, 5.0),
    }.items():
        ceiling(name, x0, x1, y0, y1, WALL_H)
    ceiling("lobby", -3.0, 3.0, -6.0, -3.0, LOBBY_H)


def walls():
    # The flat's outside walls.
    wall("wall_w_gary", "y", -7.6, -6.0, -3.0, "court", "void", z1=FACADE_H)
    wall("wall_w_dining", "y", -7.6, -3.0, 2.4, "court", "dining", [(TABLE_Y, 1.6, 0.1, 2.2)])
    wall("wall_w_kitchen", "y", -7.6, 2.4, 5.0 + T / 2, "court", "kitchen")
    wall("wall_n_kitchen", "x", 5.0, -7.6, -3.4, "kitchen", "void", [(-4.7, 0.8, 1.3, 2.1)])
    wall("wall_n_bath", "x", 5.0, -3.4, -0.8, "bathroom", "void")
    wall("wall_n_bedroom", "x", 5.0, -0.8, 2.6 + T / 2, "bedroom", "void", [(1.7, 1.0, 1.3, 2.3)])
    wall("wall_e_bedroom", "y", 2.6, 2.4, 5.0, "bedroom", "void")
    wall("wall_s_bedroom_e", "x", 2.4, 0.6, 2.6, "void", "bedroom")
    wall("wall_e_hall", "y", 0.6, -3.0, 2.4, "hall", "void")
    # Inside the flat.
    wall("wall_dining_kitchen", "x", 2.4, -7.6 + T / 2, -3.4, "dining", "kitchen", [(-4.05, DOOR_W, 0.0, DOOR_H)])
    wall("wall_kitchen_bath", "y", -3.4, 2.4 + T / 2, 5.0 - T / 2, "kitchen", "bathroom")
    wall("wall_s_bath_dining", "x", 2.4, -3.4, -2.0, "dining", "bathroom")
    wall("wall_s_bath_hall", "x", 2.4, -2.0, -0.8, "hall", "bathroom", [(-1.35, DOOR_W, 0.0, DOOR_H)])
    wall("wall_s_bedroom_hall", "x", 2.4, -0.8, 0.6, "hall", "bedroom", [(-0.05, DOOR_W, 0.0, DOOR_H)])
    wall("wall_bath_bedroom", "y", -0.8, 2.4 + T / 2, 5.0 - T / 2, "bathroom", "bedroom")
    wall("wall_dining_hall", "y", -2.0, -3.0 + T / 2, 2.4 - T / 2, "dining", "hall", [(TABLE_Y, 1.6, 0.0, 2.3)])
    # Between the flat and the lobby (and Gary's flat behind the dining room).
    wall("wall_s_dining_gary", "x", -3.0, -7.6, -3.0, "void", "dining")
    wall("wall_s_dining_lobby", "x", -3.0, -3.0, -2.0, "lobby", "dining", z1=LOBBY_H)
    wall("wall_s_hall", "x", -3.0, -2.0, 0.6, "lobby", "hall", [(-0.7, 1.0, 0.0, DOOR_H)], z1=LOBBY_H)
    wall("wall_n_lobby_e", "x", -3.0, 0.6, 3.0 + T / 2, "lobby", "void", z1=LOBBY_H)
    wall("wall_w_lobby", "y", -3.0, -6.0, -3.0, "void", "lobby", z1=LOBBY_H)
    wall("wall_e_lobby", "y", 3.0, -6.0, -3.0, "lobby", "void", z1=LOBBY_H)
    # The building's street front, three storeys, with the street door (always open).
    wall("facade", "x", -6.0, -7.6 - T / 2, 10.0, "street", "lobby", [(0.0, 2.0, 0.0, 2.6)], z1=FACADE_H, t=0.3)
    # Archway trim between the dining room and the hall.
    for i, y in enumerate((TABLE_Y - 0.83, TABLE_Y + 0.83)):
        prims.box(f"arch_jamb_{i}", (T + 0.06, 0.08, 2.3), (-2.0, y, 1.15), "wood_mid")
    prims.box("arch_head", (T + 0.06, 1.82, 0.1), (-2.0, TABLE_Y, 2.35), "wood_mid")


def doors():
    leaf_door("front", -0.7, -3.0, "hall", "outside", "+y", open_=False, width=1.0, door="cloth_blue", frame="wood_dark")
    prims.box("front_door_number", (0.12, 0.02, 0.16), (-0.7, -3.13, 1.55), "brass")
    sockets.door("dining_hall", (-2.0, TABLE_Y, 0.0), a="dining", b="hall")
    leaf_door("kitchen", -4.05, 2.4, "kitchen", "dining", "+y", open_=True)
    leaf_door("bathroom", -1.35, 2.4, "hall", "bathroom", "+y", door="cloth_white")
    leaf_door("bedroom", -0.05, 2.4, "hall", "bedroom", "+y")


# ---------------------------------------------------------------------------------------------
# Rooms


def dining():
    tx, ty = TABLE_X, TABLE_Y
    F("rug")("dining_rug", (tx, ty, 0.0), length=3.6, width=2.6, field="cloth_blue", border="cloth_cream", medallion="cloth_mustard")
    F("dining_table")("table", (tx, ty, 0.0), length=TABLE_L, width=TABLE_W, height=TABLE_H, cloth="cloth_white", runner="cloth_mustard")

    # Eight seats: three down each side, one at each end (sim seats go round the ring).
    side = TABLE_W / 2 + 0.35
    end = TABLE_L / 2 + 0.4
    seats = [(tx + dx, ty - side, 0.0) for dx in (-0.8, 0.0, 0.8)]
    seats += [(tx + end, ty, math.pi / 2)]
    seats += [(tx + dx, ty + side, math.pi) for dx in (0.8, 0.0, -0.8)]
    seats += [(tx - end, ty, -math.pi / 2)]
    for i, (x, y, r) in enumerate(seats):
        chair(i, x, y, r)
    sockets.socket("prop_candelabra", (tx, ty, TABLE_TOP))

    # French window onto the courtyard at the head of the table: curtains and, out there, the moon.
    moon_window(F("window")("french_window", (-7.6, ty, 0.0), rot_z=-math.pi / 2, width=1.6, height=2.1, sill=0.1, panes=(2, 4)))
    cx = -7.5 + 0.1
    for s, y in (("l", ty - 1.03), ("r", ty + 1.03)):
        prims.box(f"curtain_{s}", (0.08, 0.45, 2.35), (cx, y, 1.25), "curtain_plum", bevel=0.02)
    prims.box("curtain_closed", (0.08, 2.0, 2.35), (cx + 0.04, ty, 1.25), "curtain_plum", bevel=0.02)
    prims.box("curtain_rod_bar", (0.03, 2.9, 0.03), (cx, ty, 2.48), "brass")
    sockets.interact("curtain", (-7.2, ty, 1.3), kind="curtain")
    moon = prims.cylinder("moon", 0.8, 0.05, (-17.0, ty + 0.4, 3.5), "moon", segments=16)
    moon.rotation_euler = (0.0, math.radians(90), 0.0)

    # Sideboard against the party wall (Gary's flat), the mirror over it.
    F("sideboard")("sideboard", (tx, -2.9 + 0.25, 0.0), length=1.6, depth=0.45, height=0.85)
    F("wall_mirror")("mirror", (tx, -2.9, 0.0), center_z=1.72, cover="cloth_cream")
    sockets.interact("mirror", (tx, -2.72, 1.72), kind="mirror")

    # North wall: the record player in the corner, its record on a side table, a bookcase and
    # the painting by the kitchen door.
    F("record_player")("record", (-7.14, 2.09, 0.0), rot_z=math.pi)
    sockets.interact("record_player", (-7.14, 1.8, 0.95), kind="record_player")
    F("side_table")("record_table", (-7.15, 1.4, 0.0), radius=0.25)
    sockets.socket("prop_record", (-7.15, 1.4, 0.624))
    F("bookcase")("bookcase", (-6.2, 2.3 - 0.18, 0.0), rot_z=math.pi, width=0.9, depth=0.3, height=1.9, seed=3)
    sockets.socket("prop_painting", (-5.15, 2.3 - 0.03, 1.38), rot_z=math.pi)
    # The wine rack (no cellar here) in the south-west corner.
    F("wine_rack")("wine_rack", (-7.15, -2.9 + 0.16, 0.0))
    sockets.interact("wine_rack", (-7.15, -2.45, 0.6), kind="wine_rack")

    # Light switch by the archway; pendant lamp over the table.
    prims.box("light_switch", (0.02, 0.08, 0.12), (-2.11, 0.9, 1.25), "brass")
    sockets.interact("lights", (-2.2, 0.9, 1.25), kind="lights")
    prims.cylinder("lamp_cord", 0.008, 0.55, (tx, ty, WALL_H - 0.55), "metal_iron", segments=4)
    prims.cylinder("lamp_shade", 0.3, 0.22, (tx, ty, WALL_H - 0.77), "ceramic_blue", segments=10, radius_top=0.08)
    sockets.socket("lamp_light", (tx, ty, WALL_H - 0.85))

    # Where arriving guests wait to be seated: a row south and a row north of the table.
    for i, x in enumerate((-6.0, -5.1, -4.2, -3.3)):
        sockets.socket(f"stand_{i}", (x, ty - 1.75, 0.0), rot_z=0.0)
    for i, x in enumerate((-6.0, -5.1, -4.2, -3.3)):
        sockets.socket(f"stand_{4 + i}", (x, ty + 1.75, 0.0), rot_z=math.pi)


def kitchen():
    # The galley. North run (facing south): fridge, chopping counter, stove, sink, oven.
    ny = 4.9  # inside face of the north wall
    F("fridge")("fridge", (-7.15, ny - 0.35, 0.0), rot_z=math.pi)
    sockets.interact("fridge", (-7.15, 4.07, 1.1), kind="fridge")

    F("counter")("counter_chop", (-6.35, ny - 0.31, 0.0), rot_z=math.pi, length=0.9)
    prims.box("chopping_board", (0.45, 0.32, 0.03), (-6.55, 4.55, WORKTOP + 0.015), "wood_light", bevel=0.01)
    prims.box("chopping_knife", (0.22, 0.03, 0.01), (-6.5, 4.42, WORKTOP + 0.035), "steel", rot_z=0.3)
    sockets.interact("chop", (-6.55, 4.55, WORKTOP + 0.15), kind="chop")
    sockets.socket("station_chop", (-6.55, 4.55, WORKTOP + 0.03))
    sockets.socket("prop_pot", (-6.08, 4.6, WORKTOP))
    F("shelf")("kitchen_shelf", (-6.35, ny, 0.0), rot_z=math.pi, length=0.9, mount=1.65, seed=5)

    sx, sw = -5.5, 0.8
    F("stove")("stove", (sx, ny - 0.31, 0.0), rot_z=math.pi, width=sw)
    for i, lx in enumerate((0.17 * sw / 0.7, -0.17 * sw / 0.7)):
        bx, by, _ = prims.to_world((sx, ny - 0.31, 0.0), math.pi, (lx, -0.03, 0.0))
        sockets.interact(f"hob_{i}", (bx, by, WORKTOP + 0.15), kind="hob")
        sockets.socket(f"station_hob_{i}", (bx, by, WORKTOP + 0.04))

    F("sink")("sink", (-4.7, ny - 0.31, 0.0), rot_z=math.pi, length=0.8)
    F("window")("kitchen_window", (-4.7, 5.0, 0.0), rot_z=math.pi, width=0.8, height=0.8, sill=1.3, panes=(2, 2))

    # The oven: a cabinet with an oven front; food in the oven sits on top of it.
    ox = -3.95
    F("counter")("oven", (ox, ny - 0.31, 0.0), rot_z=math.pi, length=0.7, drawers=False)
    prims.box("oven_front", (0.64, 0.02, 0.66), (ox, 4.255, 0.48), "steel_dark", bevel=0.008)
    prims.box("oven_glass", (0.44, 0.012, 0.3), (ox, 4.24, 0.45), "glass_dark")
    prims.cylinder_x("oven_handle", 0.012, 0.5, (ox, 4.2, 0.76), "steel", segments=6)
    for i, x in enumerate((ox - 0.2, ox + 0.2)):
        prims.cylinder_y(f"oven_knob_{i}", 0.022, 0.03, (x, 4.235, 0.86), "black", segments=6)
    sockets.interact("oven", (ox, 4.12, 0.95), kind="oven")
    sockets.socket("station_oven", (ox - 0.1, 4.6, WORKTOP + 0.02))
    sockets.socket("prop_tea_towel", (ox + 0.22, 4.6, WORKTOP + 0.01), rot_z=math.pi / 2)

    # South run (facing north): the pass, with the plate stack at the window end.
    sy = 2.5  # inside face of the south wall
    F("counter")("counter_pass", (-6.6, sy + 0.31, 0.0), length=1.8)
    stack = [prims.cylinder(f"plate_stack_{i}", 0.13, 0.015, (0.0, 0.0, i * 0.017), "porcelain", segments=10) for i in range(6)]
    prims.place(prims.join("plate_stack", stack), (-7.2, 2.81, WORKTOP))
    sockets.interact("plates", (-7.2, 2.81, WORKTOP + 0.15), kind="plates")
    sockets.interact("pass", (-6.6, 2.81, WORKTOP + 0.12), kind="pass")
    sockets.socket("station_pass", (-6.6, 2.81, WORKTOP + 0.02))
    sockets.socket("prop_pan", (-6.05, 2.81, WORKTOP + 0.01), rot_z=math.pi / 2)
    bell = [prims.cylinder("bell_base", 0.04, 0.01, (0.0, 0.0, 0.0), "brass", segments=8), prims.blob("bell_dome", (0.035, 0.035, 0.03), (0.0, 0.0, 0.012), "brass", segments=8, rings=4)]
    prims.place(prims.join("service_bell", bell), (-6.25, 2.62, WORKTOP))

    # The Rumor Ledger chalkboard (south wall, between the pass and the door) and the guest
    # whiteboard (west wall, over the plates).
    F("chalkboard")("chalkboard", (-5.12, sy, 0.0), width=0.9, height=0.8, mount=1.05)
    sockets.interact("chalkboard", (-5.12, 2.66, 1.45), kind="chalkboard")
    wx = -7.5
    prims.box("whiteboard_frame", (0.03, 1.0, 0.7), (wx + 0.015, 3.6, 1.5), "steel", bevel=0.008)
    board = prims.panel("whiteboard_surface", 0.92, 0.62, (wx + 0.034, 3.6, 1.5), "tint_white", rot_z=-math.pi / 2)
    prims.planar_uv(board, "board")
    prims.box("whiteboard_tray", (0.06, 0.6, 0.02), (wx + 0.05, 3.6, 1.15), "steel")
    sockets.interact("whiteboard", (-7.3, 3.6, 1.5), kind="whiteboard")
    sockets.socket("room_light_kitchen", (-5.5, 3.7, WALL_H - 0.3))


def hall():
    F("coat_stand")("coat_stand", (0.22, -2.55, 0.0), coat="cloth_mustard", hat="cloth_grey")
    prims.box("doormat", (0.9, 0.55, 0.012), (-0.7, -2.62, 0.006), "rug")
    F("side_table")("hall_table_a", (0.25, -1.2, 0.0), radius=0.25)
    sockets.socket("prop_snow_globe", (0.25, -1.2, 0.624))
    F("potted_plant")("hall_plant", (0.28, 0.1, 0.0), kind="spiky", height=0.95, seed=6)
    F("side_table")("hall_table_b", (0.25, 1.4, 0.0), radius=0.25)
    sockets.socket("prop_photo_frame", (0.25, 1.4, 0.624), rot_z=math.pi / 2)
    sockets.socket("room_light_hall", (-0.7, -0.3, WALL_H - 0.3))

    # Arriving guests walk: the doormat outside the flat → just inside → the hall by the archway →
    # into the dining room, then to their standing spot via the south or north side of the table.
    sockets.socket("guest_door", (-0.7, -3.85, 0.0), rot_z=0.0)
    sockets.socket("visitor_door", (-0.15, -3.85, 0.0), rot_z=0.0)
    sockets.socket("path_0", (-0.7, -2.2, 0.0))
    sockets.socket("path_1", (-0.85, TABLE_Y, 0.0))
    sockets.socket("path_2", (-2.55, TABLE_Y, 0.0))
    sockets.socket("path_s", (-2.6, TABLE_Y - 1.75, 0.0))
    sockets.socket("path_n", (-2.6, TABLE_Y + 1.75, 0.0))
    # Gary from across the landing hovers in the hall, looking through the archway at the table.
    sockets.socket("neighbor", (-1.35, -1.25, 0.0), rot_z=math.pi / 2)


def bathroom():
    F("bath")("bath", (-2.45, 4.9 - 0.4, 0.0), length=1.65, width=0.78)
    F("toilet")("toilet", (-0.9 - 0.31, 3.9, 0.0), rot_z=math.pi / 2)
    F("basin")("basin", (-3.3 + 0.21, 3.3, 0.0), rot_z=-math.pi / 2)
    F("wall_mirror")("bath_mirror", (-3.3, 3.3, 0.0), rot_z=-math.pi / 2, shape="rect", width=0.5, height=0.62, center_z=1.55, frame="metal_silver")
    sockets.socket("room_light_bathroom", (-2.1, 3.7, WALL_H - 0.3))


def bedroom():
    # A double bed, head against the north wall; the dog's basket in the corner by the door.
    bx, by = 1.75, 3.9
    parts = [
        prims.box("bed_frame", (1.4, 2.0, 0.28), (0.0, 0.0, 0.14), "wood_mid", bevel=0.02),
        prims.cushion("bed_mattress", (1.34, 1.94, 0.18), (0.0, 0.0, 0.37), "cloth_white"),
        prims.box("bed_duvet", (1.44, 1.3, 0.07), (0.0, -0.33, 0.48), "cloth_blue", bevel=0.03),
        prims.box("bed_head", (1.5, 0.08, 1.05), (0.0, 0.98, 0.525), "wood_dark", bevel=0.02),
    ]
    for i, x in enumerate((-0.33, 0.33)):
        parts.append(prims.cushion(f"bed_pillow_{i}", (0.55, 0.34, 0.12), (x, 0.7, 0.52), "cloth_cream"))
    prims.place(prims.join("bed", parts), (bx, by, 0.0))
    sockets.collider_box("bed", (bx, by, 0.3), (1.44, 2.0, 0.6))
    F("side_table")("bedside_table", (0.72, 4.6, 0.0), radius=0.2, height=0.55)
    F("dog_bed")("dog_bed", (0.0, 4.35, 0.0), rot_z=math.pi)
    sockets.socket("dog", (0.0, 4.35, 0.08), rot_z=math.pi)
    F("window")("bedroom_window", (1.75, 5.0, 0.0), rot_z=math.pi, width=1.0, height=1.0, sill=1.3)
    sockets.socket("room_light_bedroom", (0.9, 3.7, WALL_H - 0.3))


def lobby():
    # The building's shared hall: Gary's door opposite the lift, the meters, the mailboxes.
    F("fuse_box")("fuse_box", (1.7, -3.1, 0.0), rot_z=math.pi, conduit=0.9)
    sockets.interact("fuse_box", (1.7, -3.36, 1.52), kind="fuse_box")
    prims.box("mailboxes", (0.24, 0.9, 0.62), (2.78, -3.75, 1.35), "brass", bevel=0.01)
    for i in range(3):
        prims.box(f"mailbox_slot_{i}", (0.01, 0.75, 0.02), (2.655, -3.75, 1.18 + i * 0.18), "black")
    # Lift doors (they never come).
    prims.box("lift_frame", (0.06, 1.3, 2.3), (2.87, -4.9, 1.15), "steel_dark")
    for i, y in enumerate((-5.18, -4.62)):
        prims.box(f"lift_door_{i}", (0.04, 0.55, 2.1), (2.83, y, 1.05), "steel")
    prims.box("lift_button", (0.03, 0.1, 0.16), (2.88, -4.05, 1.2), "brass")
    prims.box("lift_lamp", (0.03, 0.3, 0.08), (2.86, -4.9, 2.42), "headlight")
    # Gary's front door (Flat 3A), shut on the west wall.
    prims.box("gary_door_frame", (0.06, 1.12, 2.22), (-2.87, -4.6, 1.11), "wood_mid")
    prims.box("gary_door", (0.05, 0.94, 2.08), (-2.84, -4.6, 1.04), "cloth_green", bevel=0.01)
    prims.blob("gary_door_knob", (0.03, 0.03, 0.03), (-2.8, -4.95, 1.0), "brass", segments=6, rings=4)
    prims.box("gary_door_number", (0.02, 0.12, 0.16), (-2.81, -4.6, 1.6), "brass")
    prims.box("gary_doormat", (0.55, 0.9, 0.012), (-2.55, -4.6, 0.006), "rug")
    F("potted_plant")("lobby_plant", (2.45, -5.5, 0.0), kind="bush", height=0.9, seed=8)
    sockets.socket("room_light_porch", (-0.7, -3.6, LOBBY_H - 0.35))


def street():
    # Canopy over the street door, numbers, and the windows of the floors above.
    prims.box("entrance_canopy", (2.8, 0.9, 0.12), (0.0, -6.6, 2.85), "steel_dark", bevel=0.02)
    prims.box("entrance_number", (0.4, 0.03, 0.3), (1.35, -6.17, 2.2), "brass")
    lit = {(0, 1), (2, 2), (3, 1), (5, 2), (6, 1)}
    for row, z in enumerate((0.9, 3.7, 6.5)):
        for col, x in enumerate((-6.5, -4.3, -2.1, 2.1, 4.3, 6.5, 8.7)):
            if row == 0 and col in (2, 3):
                continue
            prims.box(f"facade_window_{row}_{col}", (1.1, 0.04, 1.45), (x, -6.17, z + 0.725), "candle" if (col, row) in lit else "glass_dark")
            prims.box(f"facade_sill_{row}_{col}", (1.25, 0.12, 0.06), (x, -6.2, z - 0.03), "stone")
    prims.box("facade_cornice", (17.9, 0.5, 0.3), (1.2, -6.1, FACADE_H - 0.15), "stone")

    # Across the road: the next block (a wall of windows and a shut shop).
    solid("opposite_block", -10.5, 10.5, -16.9, -16.4, 0.0, 9.0, "wallpaper_blue")
    for row, z in enumerate((3.5, 6.3)):
        for col in range(7):
            x = -8.4 + col * 2.8
            prims.box(f"opposite_window_{row}_{col}", (1.1, 0.04, 1.4), (x, -16.38, z + 0.7), "candle" if (row + col) % 3 == 0 else "glass_dark")
    prims.box("shop_front", (6.0, 0.06, 2.4), (-3.0, -16.37, 1.4), "glass_dark")
    prims.box("shop_awning", (6.4, 0.9, 0.12), (-3.0, -15.95, 2.75), "cloth_red", rot=(math.radians(-12), 0.0, 0.0))
    prims.box("shop_shutter", (2.4, 0.06, 2.6), (4.5, -16.37, 1.3), "steel_dark")

    # Road works close the street at both ends.
    for side in (-1, 1):
        x = side * 9.9
        sockets.collider_box(f"street_end_{'wl'[side > 0]}", (x, -11.2, 1.5), (0.3, 10.4, 3.0))
        for j, y in enumerate((-14.5, -11.2, -7.6)):
            prims.box(f"barrier_{'wl'[side > 0]}_{j}", (0.08, 2.4, 0.3), (x, y, 0.85), "red_bright", bevel=0.01)
            prims.box(f"barrier_stripe_{'wl'[side > 0]}_{j}", (0.09, 2.4, 0.08), (x, y, 0.85), "tint_white")
            for k, dy in enumerate((-1.0, 1.0)):
                prims.box(f"barrier_foot_{'wl'[side > 0]}_{j}_{k}", (0.4, 0.12, 0.9), (x, y + dy, 0.45), "steel_dark")
    # The courtyard railing (players stay on the street).
    sockets.collider_box("court_railing", (-8.85, -6.0, 1.5), (2.5, 0.12, 3.0))
    prims.box("court_rail_top", (2.5, 0.06, 0.06), (-8.85, -6.0, 1.4), "metal_iron")
    prims.box("court_rail_bottom", (2.5, 0.06, 0.06), (-8.85, -6.0, 0.15), "metal_iron")
    for i in range(9):
        prims.box(f"court_rail_bar_{i}", (0.03, 0.03, 1.3), (-9.95 + i * 0.27, -6.0, 0.77), "metal_iron")

    # A street lamp by the kerb.
    lx, ly = -3.2, -8.2
    prims.cylinder("street_lamp_pole", 0.06, 3.7, (lx, ly, 0.0), "metal_iron", segments=6)
    prims.box("street_lamp_arm", (0.08, 0.8, 0.06), (lx, ly - 0.35, 3.62), "metal_iron")
    prims.box("street_lamp_head", (0.3, 0.45, 0.12), (lx, ly - 0.7, 3.55), "metal_iron", bevel=0.02)
    prims.box("street_lamp_glow", (0.24, 0.38, 0.02), (lx, ly - 0.7, 3.48), "headlight")
    sockets.collider_box("street_lamp", (lx, ly, 1.85), (0.16, 0.16, 3.7))
    sockets.socket("room_light_outside", (lx, ly - 0.7, 3.3))

    # The catering van at the kerb, rear doors open toward the street door.
    vx, vy = 4.2, -10.0
    F("van")("van", (vx, vy, 0.0), rot_z=-math.pi / 2)
    sockets.interact("van", (vx - 2.75, vy, 1.1), kind="van")
    sockets.socket("van_rear", (vx - 3.2, vy, 0.0), rot_z=-math.pi / 2)


def courtyard():
    # Behind the French window: a little walled courtyard with a tree, and the sky over it.
    for name, (x0, x1, y0, y1) in {
        "court_wall_w": (-12.4, -12.1, -6.0, 5.4),
        "court_wall_n": (-12.4, -7.5, 5.1, 5.4),
    }.items():
        solid(name, x0, x1, y0, y1, 0.0, 2.3, "brick")
    prims.cylinder("court_tree_trunk", 0.14, 2.4, (-10.4, 2.2, 0.0), "wood_dark", segments=6, radius_top=0.09)
    for i, (dx, dy, dz, r) in enumerate(((0.0, 0.0, 3.0, 1.1), (0.6, -0.4, 2.6, 0.75), (-0.5, 0.5, 2.7, 0.8))):
        prims.blob(f"court_tree_crown_{i}", (r, r, r * 0.85), (-10.4 + dx, 2.2 + dy, dz), "plant_green" if i != 1 else "lettuce", segments=8, rings=5, wobble=0.12, seed=i + 3)
    prims.box("court_bench", (0.5, 1.4, 0.45), (-11.6, -1.5, 0.225), "wood_mid", bevel=0.02)
    # A Juliet balcony rail outside the French window.
    rx = -7.6 - T / 2 - 0.2
    prims.box("juliet_rail_top", (0.05, 1.9, 0.05), (rx, TABLE_Y, 1.0), "metal_iron")
    prims.box("juliet_rail_bottom", (0.05, 1.9, 0.05), (rx, TABLE_Y, 0.15), "metal_iron")
    for i in range(7):
        prims.box(f"juliet_rail_bar_{i}", (0.025, 0.025, 0.85), (rx, TABLE_Y - 0.9 + i * 0.3, 0.575), "metal_iron")


def layout():
    sockets.room("dining", (-4.8, -0.3, WALL_H / 2), (5.6, 5.4, WALL_H))
    sockets.room("kitchen", (-5.5, 3.7, WALL_H / 2), (4.2, 2.6, WALL_H))
    sockets.room("hall", (-0.7, -0.3, WALL_H / 2), (2.6, 5.4, WALL_H))
    sockets.room("bathroom", (-2.1, 3.7, WALL_H / 2), (2.6, 2.6, WALL_H))
    sockets.room("bedroom", (0.9, 3.7, WALL_H / 2), (3.4, 2.6, WALL_H))
    sockets.room("outside", (0.0, -4.5, LOBBY_H / 2), (6.0, 3.0, LOBBY_H), part="lobby")
    sockets.room("outside", (0.0, -11.2, 2.0), (20.0, 10.4, 4.0), part="street")
    # Lobby spawns behind the van, facing the building.
    for i, (x, y) in enumerate(((0.3, -9.3), (0.3, -10.7), (-0.7, -9.0), (-0.7, -10.0), (-0.7, -11.0), (-1.7, -10.0))):
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
    doors()
    dining()
    kitchen()
    hall()
    bathroom()
    bedroom()
    lobby()
    street()
    courtyard()
    layout()
    check_client_names()
