"""House A: a family house with a dining room, kitchen, hall, bathroom, garage, a cellar down a
flight of stairs, and the front garden where the catering van waits. M6 art pass: low-poly,
chunky, candlelit, cozy-creepy, furnished from lib/furniture, with an AO bake (BAKE below).

Blender Z-up, meters. Rooms (interior, wall centerlines):
    dining   x -9..-1  y -5..1        kitchen  x -9..-1  y 1..5
    hall     x -1..2   y -5..5        bathroom x 2..5    y 2..5
    garage   x 2..9    y -5..2  (+ x 5..9, y 2..5)
    cellar   stairs x -4..-2 y 5..8 (down to z -1.6), room x -6..-1 y 8..12 (ceiling at 0.9)
    outside  x -13..13 y -16..-5 (front garden + driveway, van at x 5.5 y -10.5)
Everything the game needs is an empty: seats, sockets (prop homes, plate spots, guest paths,
stations, light points), doors (with leaves the client swings), rooms, interactables and spawns
by the van. Meshes the client looks up by name are kept separate (KEEP); everything else is
joined per area at the end so the house is a few dozen draw calls.
"""

import math
import random
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Vector

from lib import furniture, palette, prims, sockets
from lib.furniture._piece import Piece

KIND = "house"

# Ambient occlusion bake (lib/bake.py). Things that move, hide or glow get no lightmap.
BAKE = "ao"
BAKE_SKIP = ("doorleaf_", "curtain_", "mirror_cover", "record_disc", "moon", "chalkboard_surface", "whiteboard_surface", "flame_", "backyard")
BAKE_OCCLUDERS = ("ceiling_roof", "floorbase")
BAKE_DENSITY = {"ground_": 0.45, "ceiling_rooms": 0.6}
BAKE_SIZE = 2048
BAKE_SAMPLES = 64

# Meshes the client finds by name: never joined into the area meshes.
KEEP = ("doorleaf_", "curtain_", "mirror_cover", "record_disc", "moon", "chalkboard_surface", "whiteboard_surface", "lamp_shade", "lamp_cord", "flame_")

WALL_H = 2.8
T = 0.2
DOOR_W, DOOR_H = 1.0, 2.1
CELLAR_Z = -1.6
CELLAR_TOP = 0.9

TABLE_X, TABLE_Y = -5.0, -2.0
TABLE_L, TABLE_W, TABLE_H = 3.4, 1.1, 0.75
ON_CLOTH = TABLE_H + 0.012  # dining_table: things set on the cloth
ON_RUNNER = ON_CLOTH + 0.005
WORKTOP = 0.92
CY = 5 - T / 2 - 0.31  # kitchen counter run center line (0.62 deep, back on the north wall)
HOB_Z = 0.92

# Wall finishes per room: (height above that room's floor, color) bands from the floor up.
FINISH = {
    "dining": ((0.0, "wood_dark"), (0.9, "wall_green"), (2.3, "wall_green_dark")),
    "chimney": ((0.0, "wall_green"), (2.3, "wall_green_dark")),
    "kitchen": ((0.0, "wall_kitchen"), (0.9, "tile_white"), (1.5, "wall_kitchen")),
    "hall": ((0.0, "wood_dark"), (0.9, "wallpaper_rose"), (2.3, "plaster")),
    "bathroom": ((0.0, "tile_white"), (1.2, "wallpaper_blue")),
    "garage": ((0.0, "stone_dark"), (0.2, "concrete")),
    "cellar": ((0.0, "stone_dark"), (0.25, "stone")),
    "stairs": ((0.0, "stone"),),
    "outside": ((0.0, "stone"), (0.35, "brick")),
    "earth": ((0.0, "stone_dark"),),
}
# Trim boards on a room's side of its walls: (kind, height above floor, tall, proud, color).
_ROOM_TRIM = (
    ("skirt", 0.0, 0.14, 0.022, "wood_dark"),
    ("dado", 0.88, 0.04, 0.03, "wood_mid"),
    ("rail", 2.28, 0.03, 0.022, "wood_dark"),
    ("cornice", 2.72, 0.08, 0.05, "plaster"),
)
TRIMS = {
    "dining": _ROOM_TRIM,
    "hall": _ROOM_TRIM,
    "chimney": (_ROOM_TRIM[0], _ROOM_TRIM[2], _ROOM_TRIM[3]),
    "kitchen": (("skirt", 0.0, 0.12, 0.02, "wall_trim"), ("strip", 1.48, 0.03, 0.012, "ceramic_blue"), ("cornice", 2.73, 0.07, 0.045, "plaster")),
    "bathroom": (("strip", 1.18, 0.04, 0.012, "ceramic_blue"), ("cornice", 2.74, 0.06, 0.04, "plaster")),
}


def F(name):
    return furniture.get(name).make


# ---------------------------------------------------------------------------------------------
# Areas: everything built inside `with area("x")` is joined into one mesh "x_static" at the end.

AREAS: dict[str, list[str]] = {}


@contextmanager
def area(name):
    before = set(bpy.data.objects.keys())
    yield
    AREAS.setdefault(name, []).extend(o.name for o in bpy.context.scene.objects if o.type == "MESH" and o.name not in before)


def consolidate():
    """Join every static mesh by area; keep the client's named meshes; flames become one glow mesh."""
    groups: dict[str, list[bpy.types.Object]] = {}
    seen = set()
    for key, names in AREAS.items():
        for n in names:
            o = bpy.data.objects.get(n)
            if o is None or o.type != "MESH" or n in seen:
                continue
            seen.add(n)
            if n.startswith("flame_"):
                groups.setdefault("flame_glow", []).append(o)
            elif n.startswith(KEEP):
                continue
            elif n.startswith("ceiling_roof"):
                groups.setdefault("ceiling_roof", []).append(o)
            elif n.startswith("ceiling"):
                groups.setdefault("ceiling_rooms", []).append(o)
            elif key == "floorbase":
                groups.setdefault("floorbase", []).append(o)
            else:
                groups.setdefault(f"{key}_static", []).append(o)
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name not in seen and not o.name.startswith(KEEP):
            groups.setdefault("misc_static", []).append(o)
    for name, objs in groups.items():
        for o in objs:
            layers = o.data.uv_layers
            while len(layers) > 1:
                layers.remove(layers[-1])  # drawable-board UVs nobody draws on (van signs)
        prims.join(name, objs)


# ---------------------------------------------------------------------------------------------
# Small helpers


def named(objs, suffix):
    return next(o for o in objs if o.type == "MESH" and o.name.endswith(suffix))


def rename(obj, name):
    obj.name = name
    obj.data.name = name
    return obj


def bake_rotation(obj):
    """Apply an object's rotation to its mesh (the client sets rotation.y on door leaves)."""
    obj.data.transform(obj.rotation_euler.to_matrix().to_4x4())
    obj.rotation_euler = (0.0, 0.0, 0.0)


def mesh_obj(name, bm, color, up=False):
    if up:
        bm.normal_update()
        for f in bm.faces:
            if f.normal.z < 0:
                f.normal_flip()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    palette.paint(obj, color)
    return obj


def quad(name, x0, x1, y0, y1, z, color, down=False):
    """Flat rectangle facing up (or down)."""
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z))]
    bm.faces.new(list(reversed(vs)) if down else vs)
    return mesh_obj(name, bm, color)


def poly(name, pts, color, toward=None):
    """One flat face; with `toward` it is wound to face that point."""
    if toward is not None:
        a, b, c = (Vector(p) for p in pts[:3])
        if (b - a).cross(c - a).dot(Vector(toward) - a) < 0:
            pts = list(reversed(pts))
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in pts])
    return mesh_obj(name, bm, color)


def paint_list(obj, colors):
    prims.paint_faces(obj, lambda p: colors[p.index])


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


def finish(room, h):
    color = FINISH[room][0][1]
    for start, c in FINISH[room]:
        if h >= start - 1e-6:
            color = c
    return color


def banded(name, x0, x1, y0, y1, zs, color_of, bottom=False):
    """Box x0..x1, y0..y1 with edge loops at heights zs (bottom..top), so each band of each face
    can take its own color: color_of(normal, z_center). No bottom face unless `bottom`."""
    bm = bmesh.new()
    rings = [[bm.verts.new((x, y, z)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))] for z in zs]
    for lo, hi in zip(rings, rings[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new(rings[-1])
    if bottom:
        bm.faces.new(list(reversed(rings[0])))
    obj = mesh_obj(name, bm, "plaster")
    prims.paint_faces(obj, lambda p: color_of(p.normal, p.center.z))
    return obj


def wall(name, axis, at, u0, u1, neg, pos, openings=(), z0=0.0, z1=WALL_H, thick=T, ends=None):
    """A wall along `axis` ('x' or 'y') centered on the line `other axis = at`, from u0 to u1, with
    a collider per piece. `neg`/`pos` are the rooms on its -/+ side: their finishes and trims face
    them. `ends` paints the end faces like that room (free-standing pieces like a chimney breast)."""
    for i, (a0, a1, b0, b1) in enumerate(segments(u0, u1, openings, z0, z1)):
        n = f"{name}_{i}"
        cuts = {b0, b1}
        for room in (neg, pos):
            for start, _ in FINISH[room]:
                if b0 + 1e-6 < z0 + start < b1 - 1e-6:
                    cuts.add(z0 + start)
        if axis == "x":
            x0, x1, y0, y1 = a0, a1, at - thick / 2, at + thick / 2
        else:
            x0, x1, y0, y1 = at - thick / 2, at + thick / 2, a0, a1

        def color_of(nrm, zc, axis=axis):
            perp = nrm.y if axis == "x" else nrm.x
            if perp < -0.5:
                return finish(neg, zc - z0)
            if perp > 0.5:
                return finish(pos, zc - z0)
            if nrm.z > 0.5:
                return "wall_trim"  # tops: a clean dark cut in the overhead view
            if ends and abs(nrm.z) < 0.5:
                return finish(ends, zc - z0)
            return "plaster"

        banded(n, x0, x1, y0, y1, sorted(cuts), color_of, bottom=b0 > z0 + 1e-6)
        sockets.collider_box(n, ((x0 + x1) / 2, (y0 + y1) / 2, (b0 + b1) / 2), (x1 - x0, y1 - y0, b1 - b0))
        for side, room in ((-1, neg), (1, pos)):
            face = at + side * thick / 2
            trims(n, axis, face, side, a0, a1, b0, b1, z0, room)
            if room == "hall" and b0 <= z0 + 0.9 and b1 >= z0 + 2.3:
                stripes(n, axis, face, side, a0, a1)
            if room == "dining" and b0 <= z0 and b1 >= z0 + 0.9:
                wainscot_panels(n, axis, face, side, a0, a1)


def along_box(name, axis, face, side, a0, a1, z, h, d, color):
    """Box lying along a wall face, `d` proud of it, from a0 to a1 and z to z + h."""
    c = face + side * d / 2
    if axis == "x":
        return prims.box(name, (a1 - a0, d, h), ((a0 + a1) / 2, c, z + h / 2), color)
    return prims.box(name, (d, a1 - a0, h), (c, (a0 + a1) / 2, z + h / 2), color)


def trims(n, axis, face, side, a0, a1, b0, b1, floor, room):
    for k, (_, z, h, d, color) in enumerate(TRIMS.get(room, ())):
        z += floor
        if z < b0 - 1e-6 or z + h > b1 + 1e-6:
            continue
        along_box(f"{n}_trim{side}_{k}", axis, face, side, a0, a1, z, h, d, color)


def facing(axis, side):
    """rot_z that turns a +Y-facing prim to face out of a wall face."""
    if axis == "x":
        return 0.0 if side > 0 else math.pi
    return -math.pi / 2 if side > 0 else math.pi / 2


def stripes(n, axis, face, side, a0, a1):
    """Hall wallpaper: darker rose stripes between the dado and the picture rail."""
    z0, z1 = 0.93, 2.27
    u = a0 + 0.12
    k = 0
    while u + 0.1 < a1 - 0.06:
        c = u + 0.05
        loc = (c, face + side * 0.003, (z0 + z1) / 2) if axis == "x" else (face + side * 0.003, c, (z0 + z1) / 2)
        prims.panel(f"{n}_stripe{side}_{k}", 0.1, z1 - z0, loc, "wallpaper_rose_dark", rot_z=facing(axis, side))
        u += 0.24
        k += 1


def wainscot_panels(n, axis, face, side, a0, a1):
    """Raised panels on the dining room's wood wainscot."""
    span = a1 - a0 - 0.16
    if span < 0.4:
        return
    count = max(1, round(span / 0.75))
    w = span / count
    for k in range(count):
        c = a0 + 0.08 + w * (k + 0.5)
        along_box(f"{n}_panel{side}_{k}", axis, face, side, c - (w - 0.14) / 2, c + (w - 0.14) / 2, 0.22, 0.54, 0.014, "wood_mid")


def plank_floor(name, x0, x1, y0, y1, along, seed, z=0.0, board=0.19, colors=("wood_floor", "wood_floor_dark", "wood_mid")):
    """Rows of boards with staggered joints, 3 mm above a dark base that shows in the gaps."""
    rng = random.Random(seed)
    with area("floorbase"):
        quad(f"{name}_base", x0, x1, y0, y1, z, "wood_dark")
    (u0, u1), (v0, v1) = ((x0, x1), (y0, y1)) if along == "x" else ((y0, y1), (x0, x1))
    rows = max(1, round((v1 - v0) / board))
    w = (v1 - v0) / rows
    gap = 0.011
    bm = bmesh.new()
    face_colors = []
    zz = z + 0.003
    for r in range(rows):
        va, vb = v0 + r * w + gap / 2, v0 + (r + 1) * w - gap / 2
        us = [u0]
        u = u0 + rng.uniform(0.25, 1.5)
        while u < u1 - 0.35:
            us.append(u)
            u += rng.uniform(1.1, 2.0)
        us.append(u1)
        pt = (lambda uu, vv: (uu, vv, zz)) if along == "x" else (lambda uu, vv: (vv, uu, zz))
        lo = [bm.verts.new(pt(uu, va)) for uu in us]
        hi = [bm.verts.new(pt(uu, vb)) for uu in us]
        last = None
        for i in range(len(us) - 1):
            bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))
            c = rng.choice([c for c in colors if c != last])
            face_colors.append(c)
            last = c
    obj = mesh_obj(name, bm, colors[0], up=True)
    paint_list(obj, face_colors)
    return obj


def tile_floor(name, x0, x1, y0, y1, nx, ny, color_of, z=0.0):
    """A connected grid of square-ish tiles, color_of(i, j) per tile."""
    bm = bmesh.new()
    xs = [x0 + (x1 - x0) * i / nx for i in range(nx + 1)]
    ys = [y0 + (y1 - y0) * j / ny for j in range(ny + 1)]
    grid = [[bm.verts.new((x, y, z)) for x in xs] for y in ys]
    colors = []
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            colors.append(color_of(i, j))
    obj = mesh_obj(name, bm, colors[0], up=True)
    paint_list(obj, colors)
    return obj


def pleated(name, cx, back_y, width, z0, z1, pleats, depth, color, thick=0.02):
    """A hanging curtain facing +Y: `pleats` folds across `width`, from z0 to z1, its back at back_y."""
    n = pleats * 2
    front = [(back_y + thick + depth * (i % 2), -width / 2 + width * i / n) for i in range(n + 1)]
    back = [(y - thick, x) for y, x in reversed(front)]
    # prism() extrudes an outline (y, z) along X; turned 90 deg about Y the extrusion runs
    # vertically and the outline's second coordinate becomes world X.
    outline = [(y - back_y, x) for y, x in front + back]
    return prims.prism(name, outline, z1 - z0, (cx, back_y, (z0 + z1) / 2), color, rot=(0.0, math.pi / 2, 0.0))


def glow(name, radii, location, color="candle"):
    """A light bulb, flame or ember: prepare() in the client makes `flame_*` meshes glow."""
    return prims.blob(f"flame_{name}", radii, location, color, segments=8, rings=5)


def hanging_bulb(room, x, y, z, ceiling, shade=None):
    """A bare bulb on a cord (or under an enamel shade) hanging from the ceiling at `ceiling`,
    the bulb around (x, y, z) where the room light socket is."""
    parts = [prims.cylinder(f"ceiling_light_{room}_cord", 0.007, ceiling - (z + 0.08), (x, y, z + 0.08), "black", segments=4)]
    parts.append(prims.cylinder(f"ceiling_light_{room}_cap", 0.02, 0.05, (x, y, z + 0.05), "brass", segments=6))
    parts.append(prims.cylinder(f"ceiling_light_{room}_rose", 0.05, 0.02, (x, y, ceiling - 0.02), "plaster", segments=8))
    if shade:
        parts.append(
            prims.lathe(
                f"ceiling_light_{room}_shade",
                [(0.2, 0.0), (0.06, 0.13), (0.05, 0.12), (0.19, 0.005), (0.2, 0.0)],
                (x, y, z - 0.02),
                shade,
                segments=10,
                caps=False,
            )
        )
    prims.join(f"ceiling_light_{room}", parts)
    glow(f"bulb_{room}", (0.04, 0.04, 0.05), (x, y, z), "candle")


# ---------------------------------------------------------------------------------------------
# Shell


def walls():
    # Exterior.
    wall("wall_s_dining", "x", -5, -9.1, -1, "outside", "dining", [(TABLE_X, 1.8, 0.9, 2.2)])
    wall("wall_s_hall", "x", -5, -1, 2, "outside", "hall", [(0.5, DOOR_W, 0.0, DOOR_H)])
    wall("wall_s_garage", "x", -5, 2, 9.1, "outside", "garage", [(5.5, 2.8, 0.0, 2.3)])
    wall("wall_n_kitchen_a", "x", 5, -9.1, -4.1, "kitchen", "outside")
    wall("wall_n_kitchen_b", "x", 5, -4.1, -1.9, "kitchen", "stairs", [(-3.0, DOOR_W, 0.0, DOOR_H)])
    wall("wall_n_kitchen_c", "x", 5, -1.9, -1, "kitchen", "outside", [(-1.5, 0.6, 1.3, 2.1)])
    wall("wall_n_hall", "x", 5, -1, 2, "hall", "outside")
    wall("wall_n_bath", "x", 5, 2, 5, "bathroom", "outside")
    wall("wall_n_garage", "x", 5, 5, 9.1, "garage", "outside")
    wall("wall_w_dining", "y", -9, -4.9, 1, "outside", "dining")
    wall("wall_w_kitchen", "y", -9, 1, 4.9, "outside", "kitchen")
    wall("wall_e", "y", 9, -4.9, 4.9, "garage", "outside", [(-2.5, 1.0, 1.2, 2.0)])
    # Interior.
    wall("wall_dining_kitchen", "x", 1, -8.9, -1.1, "dining", "kitchen", [(-2.5, DOOR_W, 0.0, DOOR_H)])
    wall("wall_dining_hall", "y", -1, -4.9, 1, "dining", "hall", [(-2.0, 2.0, 0.0, 2.4)])
    wall("wall_kitchen_hall", "y", -1, 1, 4.9, "kitchen", "hall", [(3.0, DOOR_W, 0.0, DOOR_H)])
    wall("wall_hall_garage", "y", 2, -4.9, 2, "hall", "garage", [(-1.5, DOOR_W, 0.0, DOOR_H)])
    wall("wall_hall_bath", "y", 2, 2, 4.9, "hall", "bathroom", [(3.5, DOOR_W, 0.0, DOOR_H)])
    wall("wall_bath_garage_s", "x", 2, 2.1, 5.1, "garage", "bathroom")
    wall("wall_bath_garage_e", "y", 5, 2.1, 4.9, "bathroom", "garage")
    # Stairwell down to the cellar, and the cellar.
    wall("stair_wall_w", "y", -4, 5.1, 8.1, "outside", "stairs", z0=CELLAR_Z)
    wall("stair_wall_e", "y", -2, 5.1, 8.1, "stairs", "outside", z0=CELLAR_Z)
    wall("stair_header", "x", 8.1, -3.9, -2.1, "stairs", "earth", z0=CELLAR_TOP)
    for name, axis, at, u0, u1, neg, pos in (
        ("cellar_wall_w", "y", -6, 7.9, 12.1, "earth", "cellar"),
        ("cellar_wall_e", "y", -1, 7.9, 12.1, "cellar", "earth"),
        ("cellar_wall_n", "x", 12, -5.9, -1.1, "cellar", "earth"),
        ("cellar_wall_s_a", "x", 8, -5.9, -4.1, "earth", "cellar"),
        ("cellar_wall_s_b", "x", 8, -1.9, -1.1, "earth", "cellar"),
    ):
        wall(name, axis, at, u0, u1, neg, pos, z0=CELLAR_Z, z1=CELLAR_TOP)

    # Thresholds under every doorway.
    for name, x0, x1, y0, y1 in (
        ("front", 0.0, 1.0, -5.1, -4.9),
        ("kitchen_dining", -3.0, -2.0, 0.9, 1.1),
        ("kitchen_hall", -1.1, -0.9, 2.5, 3.5),
        ("cellar", -3.5, -2.5, 4.9, 5.1),
        ("bathroom", 1.9, 2.1, 3.0, 4.0),
        ("garage", 1.9, 2.1, -2.0, -1.0),
        ("arch", -1.1, -0.9, -3.0, -1.0),
    ):
        prims.box(f"threshold_{name}", (x1 - x0, y1 - y0, 0.012), ((x0 + x1) / 2, (y0 + y1) / 2, 0.006), "wood_dark")

    # The archway between the dining room and the hall: linings and architraves.
    for y in (-3.0, -1.0):
        s = 1 if y < -2 else -1
        prims.box(f"arch_jamb_{y}", (T + 0.01, 0.025, 2.4), (-1.0, y + s * 0.0125, 1.2), "wood_mid")
        for face in (-1, 1):
            prims.box(f"arch_casing_{y}_{face}", (0.024, 0.09, 2.45), (-1.0 + face * (T / 2 + 0.012), y - s * 0.045, 1.225), "wood_mid")
    prims.box("arch_head", (T + 0.01, 2.0, 0.025), (-1.0, -2.0, 2.3875), "wood_mid")
    for face in (-1, 1):
        prims.box(f"arch_head_casing_{face}", (0.03, 2.24, 0.11), (-1.0 + face * (T / 2 + 0.015), -2.0, 2.455), "wood_mid", bevel=0.008)


def doors():
    def leaf_door(door_id, x, y, axis, a, b, open_, door="wood_dark", frame="wood_mid"):
        # The furniture door hangs on its -x jamb; turned for walls along Y, the hinge is at -Y.
        rot = 0.0 if axis == "x" else math.pi / 2
        F("door_leaf")(f"frame_{door_id}", (x, y, 0.0), rot_z=rot, width=DOOR_W, height=DOOR_H, wall_t=T, door=door, frame=frame, leaf_name=f"doorleaf_{door_id}", leaf_collider=True)
        bake_rotation(bpy.data.objects[f"doorleaf_{door_id}"])
        sockets.door(door_id, (x, y, 0.0), a=a, b=b, leaf=True, open=open_)
        sockets.interact(door_id, (x, y, 1.0), kind="door")

    # Leaves swing +90 deg about the hinge: front into the hall, kitchen_dining into the kitchen,
    # cellar over the stairs, kitchen_hall into the kitchen, bathroom and garage into the hall.
    leaf_door("front", 0.5, -5.0, "x", "hall", "outside", False, door="cloth_red", frame="cloth_white")
    leaf_door("kitchen_dining", -2.5, 1.0, "x", "kitchen", "dining", True)
    leaf_door("kitchen_hall", -1.0, 3.0, "y", "kitchen", "hall", True)
    leaf_door("cellar", -3.0, 5.0, "x", "kitchen", "cellar", False, door="wood_mid", frame="wood_dark")
    leaf_door("bathroom", 2.0, 3.5, "y", "hall", "bathroom", False)
    leaf_door("garage", 2.0, -1.5, "y", "hall", "garage", False)
    sockets.door("dining_hall", (-1, -2, 0), a="dining", b="hall")

    # The big up-and-over garage door stays shut: steel ribs on both faces.
    prims.box("garage_door", (2.8, 0.06, 2.3), (5.5, -5.0, 1.15), "steel_dark", bevel=0.01)
    sockets.collider_box("garage_door", (5.5, -5.0, 1.15), (2.8, 0.1, 2.3))
    for side in (-1, 1):
        for i in range(6):
            prims.box(f"garage_door_rib_{side}_{i}", (2.7, 0.02, 0.05), (5.5, -5.0 + side * 0.04, 0.22 + i * 0.38), "steel")
    prims.box("garage_door_handle", (0.3, 0.04, 0.04), (5.5, -5.09, 0.9), "metal_silver")


def window(name, x, y, rot, width, height, sill, panes, glass):
    objs = F("window")(name, (x, y, 0.0), rot_z=rot, width=width, height=height, sill=sill, wall_t=T, panes=panes, frame="cloth_white")
    g = named(objs, "_glass")
    if glass is None:
        bpy.data.objects.remove(g)  # the dining window stays open to the night (and the moon)
    else:
        palette.paint(g, glass)


def windows():
    window("dining_window", TABLE_X, -5.0, 0.0, 1.8, 1.3, 0.9, (3, 3), None)
    window("kitchen_window", -1.5, 5.0, math.pi, 0.6, 0.8, 1.3, (1, 2), "glass_dark")
    window("garage_window", 9.0, -2.5, math.pi / 2, 1.0, 0.8, 1.2, (2, 1), "glass_dark")


def ceilings():
    for room, (x0, x1, y0, y1) in {
        "dining": (-8.9, -1.1, -4.9, 0.9),
        "kitchen": (-8.9, -1.1, 1.1, 4.9),
        "hall": (-0.9, 1.9, -4.9, 4.9),
        "bathroom": (2.1, 4.9, 2.1, 4.9),
        "garage_a": (2.1, 8.9, -4.9, 1.9),
        "garage_b": (5.1, 8.9, 1.9, 4.9),
    }.items():
        quad(f"ceiling_{room}", x0, x1, y0, y1, WALL_H, "plaster", down=True)
    # Over the stairwell and the cellar: slabs, so the turf and tiles on top hide the inside.
    for name, (x0, x1, y0, y1, z0, top) in {
        "ceiling_stairs": (-4.1, -1.9, 5.1, 8.2, WALL_H, "roof"),
        "ceiling_cellar": (-6.1, -0.9, 7.9, 12.1, CELLAR_TOP, "grass"),
    }.items():
        slab = prims.box(name, (x1 - x0, y1 - y0, 0.1), ((x0 + x1) / 2, (y0 + y1) / 2, z0 + 0.05), "plaster")
        prims.paint_facing(slab, (0, 0, 1), top)


def roof():
    """Pitched tile roof over the main block, ridge along X, brick gables, a chimney over the
    dining room fireplace. All `ceiling_roof*`: hidden in the overhead view."""
    p = math.radians(35)
    tan = math.tan(p)
    x0, x1 = -9.45, 9.45
    over = 0.4
    base = WALL_H + 0.05
    run = 5.1 + over
    length = run / math.cos(p)
    t = 0.12
    for s, name in ((-1, "s"), (1, "n")):
        # Bottom surface: z = base + (5.1 - |y|) tan(p); the slab sits on it.
        y_mid = s * run / 2
        z_mid = base + (5.1 - run / 2) * tan
        nx, ny, nz = 0.0, s * math.sin(p), math.cos(p)
        rot = (-s * p, 0.0, 0.0)
        prims.box(f"ceiling_roof_{name}", (x1 - x0, length, t), (0.0, y_mid + ny * t / 2, z_mid + nz * t / 2), "roof", rot=rot)
        # Courses of tiles: alternating bands, alternately raised so they read as overlapping rows.
        rows = round(length / 0.42)
        for i in range(rows):
            d = length / 2 - 0.21 - i * 0.42  # from the ridge end down
            lift = t + (0.03 if i % 2 else 0.012)
            cy = y_mid - s * d * math.cos(p)
            cz = z_mid + d * math.sin(p)
            prims.box(
                f"ceiling_roof_{name}_row{i}",
                (x1 - x0 + 0.04, 0.44, 0.03),
                (0.0, cy + ny * lift, cz + nz * lift),
                "roof" if i % 2 else "brick_dark",
                rot=rot,
            )
        prims.cylinder_x(f"ceiling_roof_gutter_{name}", 0.06, x1 - x0, (0.0, s * (5.1 + over + 0.03), base - over * tan - 0.06), "steel_dark", segments=6)
        prims.box(f"ceiling_roof_fascia_{name}", (18.2, 0.04, 0.16), (0.0, s * 5.12, WALL_H + 0.06), "wood_dark")
    ridge_z = base + 5.1 * tan
    prims.box("ceiling_roof_ridge", (x1 - x0 + 0.06, 0.26, 0.26), (0.0, 0.0, ridge_z + 0.12), "brick_dark", rot=(math.radians(45), 0.0, 0.0))
    for name, x in (("w", -9.0), ("e", 9.0)):
        outline = [(-5.1, WALL_H), (5.1, WALL_H), (5.1, base), (0.0, ridge_z), (-5.1, base)]
        g = prims.prism(f"ceiling_roof_gable_{name}", outline, T, (x, 0.0, 0.0), "brick")
        prims.paint_faces(g, lambda f: "wall_trim" if abs(f.normal.x) < 0.5 and f.normal.z < -0.5 else None)
    # Chimney stack over the fireplace (dining west wall), through the south slope.
    cx, cy = -8.6, -2.0
    roof_z = base + (5.1 - abs(cy)) * tan
    top = ridge_z + 0.7
    stack = prims.box("ceiling_roof_chimney", (0.75, 0.95, top - (roof_z - 0.4)), (cx, cy, (top + roof_z - 0.4) / 2), "brick")
    prims.paint_facing(stack, (0, 0, 1), "black")
    prims.box("ceiling_roof_chimney_cap", (0.85, 1.05, 0.08), (cx, cy, top + 0.02), "stone_dark")
    for i, dy in enumerate((-0.22, 0.22)):
        prims.lathe(f"ceiling_roof_chimney_pot_{i}", [(0.1, 0.0), (0.085, 0.25), (0.1, 0.3), (0.07, 0.3), (0.0, 0.28)], (cx, cy + dy, top + 0.06), "terracotta", segments=8)


# ---------------------------------------------------------------------------------------------
# Dining room


def chair(i, x, y, rot_z):
    F("chair")(f"chair_{i}", (x, y, 0.0), rot_z=rot_z)
    sockets.seat(str(i), (x, y, 0.45), rot_z)
    px, py, _ = prims.to_world((x, y, 0.0), rot_z, (0.0, 0.62, 0.0))
    on_runner = abs(py - TABLE_Y) < 0.15
    sockets.socket(f"plate_{i}", (px, py, ON_RUNNER if on_runner else ON_CLOTH), rot_z=rot_z)


def sconce(i, x, y, rot_z, z=1.62):
    p = Piece(f"sconce_{i}", (x, y, 0.0), rot_z=rot_z, collide=False)
    p.box((0.07, 0.014, 0.17), (0.0, 0.007, z), "brass", bevel=0.005)
    p.box((0.018, 0.13, 0.018), (0.0, 0.075, z - 0.04), "brass")
    p.cylinder(0.035, 0.03, (0.0, 0.14, z - 0.05), "brass", segments=8, radius_top=0.048)
    p.cylinder(0.016, 0.1, (0.0, 0.14, z - 0.02), "candle", segments=6)
    p.keep(glow(f"sconce_{i}", (0.014, 0.014, 0.03), (0.0, 0.14, z + 0.11), "flame"))
    p.finish()


def fireplace():
    """Chimney breast on the west wall with a fire, a mantel, candlesticks, and the mirror."""
    bx = -9 + T / 2 + 0.44  # breast front face
    wall("chimney_breast", "y", -8.9 + 0.22, -2.95, -1.05, "chimney", "chimney", [(-2.0, 0.8, 0.0, 0.75)], thick=0.44, ends="chimney")
    # Firebox lining, hearth, surround and mantel.
    prims.box("firebox_back", (0.04, 0.8, 0.75), (-8.88, -2.0, 0.375), "brick_dark")
    for y in (-2.39, -1.61):
        prims.box(f"firebox_side_{y}", (0.44, 0.02, 0.75), (-8.68, y, 0.375), "brick_dark")
    prims.box("firebox_top", (0.44, 0.8, 0.02), (-8.68, -2.0, 0.74), "black")
    prims.box("firebox_floor", (0.44, 0.8, 0.02), (-8.68, -2.0, 0.01), "burnt")
    prims.box("hearth", (0.38, 1.3, 0.035), (bx + 0.19, -2.0, 0.0175), "stone_dark", bevel=0.008)
    for y in (-2.48, -1.52):
        prims.box(f"surround_tiles_{y}", (0.012, 0.16, 0.86), (bx + 0.006, y, 0.43), "brick_dark")
    prims.box("surround_tiles_top", (0.012, 1.12, 0.11), (bx + 0.006, -2.0, 0.805), "brick_dark")
    for y in (-2.62, -1.38):
        prims.box(f"surround_pilaster_{y}", (0.06, 0.12, 1.08), (bx + 0.03, y, 0.54), "wood_dark", bevel=0.01)
    prims.box("surround_frieze", (0.05, 1.36, 0.2), (bx + 0.025, -2.0, 0.98), "wood_dark", bevel=0.01)
    prims.box("mantel", (0.22, 1.6, 0.06), (bx + 0.09, -2.0, 1.11), "wood_mid", bevel=0.015)
    prims.cylinder_y("fender", 0.018, 1.2, (bx + 0.34, -2.0, 0.09), "brass", segments=6)
    for y in (-2.55, -1.45):
        prims.box(f"fender_post_{y}", (0.03, 0.03, 0.09), (bx + 0.34, y + (0.05 if y < -2 else -0.05), 0.045), "brass")
    # Fire: logs, embers and flames (flames glow).
    for i, (x, y, z, r) in enumerate(((-8.7, -2.0, 0.07, 0.055), (-8.62, -1.98, 0.13, 0.045))):
        prims.cylinder_y(f"log_{i}", r, 0.5, (x, y, z), "wood_dark" if i else "burnt", segments=6, rot_z=0.15 * (1 - 2 * i))
    for y in (-2.22, -1.78):
        prims.box(f"firedog_{y}", (0.28, 0.025, 0.05), (-8.66, y, 0.04), "metal_iron")
        prims.blob(f"firedog_knob_{y}", (0.025, 0.025, 0.025), (-8.52, y, 0.08), "brass", segments=5, rings=4)
    glow("embers", (0.2, 0.16, 0.03), (-8.68, -2.0, 0.035), "hob_glow")
    for i, (y, h, c) in enumerate(((-2.12, 0.26, "fire"), (-2.0, 0.36, "flame"), (-1.88, 0.24, "fire"), (-2.05, 0.18, "yolk"))):
        prims.cone(f"flame_fire_{i}", 0.06, h, (-8.66, y, 0.1), c, segments=5)
    # Candlesticks on the mantel.
    for i, y in enumerate((-2.62, -1.38)):
        prims.lathe(f"candlestick_{i}", [(0.045, 0.0), (0.04, 0.02), (0.015, 0.05), (0.018, 0.14), (0.03, 0.16), (0.0, 0.16)], (bx + 0.1, y, 1.14), "brass", segments=8)
        prims.cylinder(f"candlestick_candle_{i}", 0.014, 0.12, (bx + 0.1, y, 1.3), "candle", segments=6)
        glow(f"mantel_{i}", (0.012, 0.012, 0.026), (bx + 0.1, y, 1.445), "flame")
    # The mirror over the mantel, with the tea towel that covers it.
    objs = F("wall_mirror")("mirror", (bx, -2.0, 0.0), rot_z=-math.pi / 2, shape="oval", width=0.62, height=0.78, center_z=1.66, frame="gold", cover="cloth_cream")
    rename(named(objs, "_cover"), "mirror_cover")
    sockets.interact("mirror", (bx + 0.16, -2.0, 1.66), kind="mirror")
    for y, s in ((-2.95, -1), (-1.05, 1)):
        for k, (_, z, h, d, color) in enumerate(TRIMS["chimney"]):
            prims.box(f"chimney_end_trim_{s}_{k}", (0.44 + d, d, h), (-8.9 + (0.44 + d) / 2, y + s * d / 2, z + h / 2), color)
    sockets.collider_box("chimney_hearth", (bx + 0.19, -2.0, 0.3), (0.38, 1.3, 0.6))


def curtains():
    wx, wy = TABLE_X, -5.0
    back = wy + T / 2 + 0.07
    for s, x in (("l", wx - 1.17), ("r", wx + 1.17)):
        c = pleated(f"curtain_{s}_cloth", x, back, 0.52, 0.12, 2.46, 4, 0.09, "curtain_plum")
        tie = prims.box(f"curtain_{s}_tie", (0.56, 0.13, 0.06), (x, back + 0.06, 1.0), "cloth_mustard", bevel=0.02)
        prims.join(f"curtain_{s}", [c, tie])
    pleated("curtain_closed", wx, back + 0.012, 2.5, 0.12, 2.46, 11, 0.06, "curtain_plum")
    prims.cylinder_x("drape_rod", 0.018, 3.3, (wx, back + 0.06, 2.52), "brass", segments=6)
    for x in (wx - 1.68, wx + 1.68):
        prims.blob(f"drape_rod_finial_{x}", (0.04, 0.04, 0.04), (x, back + 0.06, 2.52), "brass", segments=6, rings=4)
    for x in (wx - 1.45, wx + 1.45):
        prims.box(f"drape_rod_bracket_{x}", (0.02, 0.1, 0.02), (x, back + 0.02, 2.52), "brass")
    sockets.interact("curtain", (wx, wy + 0.3, 1.5), kind="curtain")


def dining():
    tx, ty = TABLE_X, TABLE_Y
    plank_floor("floor_dining", -8.9, -1.1, -4.9, 0.9, "x", seed=3)
    F("rug")("dining_rug", (tx, ty, 0.0), length=4.9, width=3.1)
    table = F("dining_table")("table", (tx, ty, 0.0), length=TABLE_L, width=TABLE_W, height=TABLE_H)
    # The client finds the table by this exact collider name (EventViews: the stain, its long axis).
    next(o for o in table if o.name.startswith("col_box_table")).name = "col_box_table"

    # Eight seats: three down each side, one at each end.
    side = TABLE_W / 2 + 0.35
    end = TABLE_L / 2 + 0.4
    seats = [(tx + dx, ty - side, 0.0) for dx in (-1.1, 0.0, 1.1)]
    seats += [(tx + end, ty, math.pi / 2)]
    seats += [(tx + dx, ty + side, math.pi) for dx in (1.1, 0.0, -1.1)]
    seats += [(tx - end, ty, -math.pi / 2)]
    for i, (x, y, r) in enumerate(seats):
        chair(i, x, y, r)
    sockets.socket("prop_candelabra", (tx, ty, ON_RUNNER))

    # Pendant lamp over the table (hidden with the ceiling in the overhead view).
    prims.lathe("ceiling_rose", [(0.22, 0.0), (0.2, 0.025), (0.12, 0.05), (0.05, 0.06), (0.0, 0.06)], (tx, ty, WALL_H - 0.002), "plaster", segments=12, rot=(math.pi, 0.0, 0.0))
    shade_z = 1.98
    prims.cylinder("lamp_cord", 0.008, WALL_H - 0.06 - (shade_z + 0.3), (tx, ty, shade_z + 0.3), "black", segments=4)
    parts = [
        prims.lathe("lamp_shade_cloth", [(0.34, 0.0), (0.14, 0.27), (0.13, 0.262), (0.33, 0.004), (0.34, 0.0)], (tx, ty, shade_z), "cloth_cream", segments=12, caps=False),
        prims.torus("lamp_shade_rim", 0.34, 0.012, (tx, ty, shade_z), "brass", segments=12, sides=4),
        prims.torus("lamp_shade_top", 0.14, 0.01, (tx, ty, shade_z + 0.27), "brass", segments=10, sides=4),
        prims.cylinder("lamp_shade_fitting", 0.035, 0.07, (tx, ty, shade_z + 0.24), "brass", segments=8),
        prims.blob("lamp_shade_bulb", (0.045, 0.045, 0.055), (tx, ty, shade_z + 0.17), "candle", segments=8, rings=5),
    ]
    for k in range(12):
        a = 2 * math.pi * (k + 0.5) / 12
        parts.append(prims.blob(f"lamp_shade_bead_{k}", (0.012, 0.012, 0.02), (tx + 0.345 * math.cos(a), ty + 0.345 * math.sin(a), shade_z - 0.025), "cape_red", segments=4, rings=3))
    prims.join("lamp_shade", parts, origin=(tx, ty, shade_z))
    sockets.socket("lamp_light", (tx, ty, WALL_H - 0.9))

    window_dressing()
    curtains()
    fireplace()

    # Sideboard on the east wall by the archway, the light switch beside it.
    F("sideboard")("sideboard", (-1.1 - 0.245, 0.25, 0.0), rot_z=math.pi / 2, length=1.2, depth=0.45)
    sx = -1.1 - 0.245
    prims.lathe("fruit_bowl", [(0.05, 0.0), (0.12, 0.06), (0.16, 0.08), (0.15, 0.085), (0.0, 0.03)], (sx, 0.55, 0.9), "ceramic_blue", segments=10)
    for k, (dx, dy, c) in enumerate(((-0.05, 0.02, "tomato"), (0.05, -0.03, "apron_mustard"), (0.0, 0.06, "lettuce"), (0.02, -0.01, "tomato"))):
        prims.blob(f"fruit_{k}", (0.045, 0.045, 0.042), (sx + dx, 0.55 + dy, 0.97 + (0.04 if k == 3 else 0.0)), c, segments=6, rings=4)
    prims.lathe("vase", [(0.04, 0.0), (0.07, 0.08), (0.05, 0.2), (0.035, 0.25), (0.045, 0.27)], (sx, -0.1, 0.9), "terracotta", segments=8)
    for k in range(5):
        a = k * 1.3
        prims.cylinder(f"vase_stem_{k}", 0.005, 0.22, (sx, -0.1, 1.15), "plant_green", segments=3, rot=(0.25 * math.cos(a), 0.25 * math.sin(a), 0.0))
        prims.blob(f"vase_flower_{k}", (0.035, 0.035, 0.03), (sx + 0.055 * math.sin(a), -0.1 - 0.055 * math.cos(a), 1.37), ("rose", "cloth_cream", "apron_lilac")[k % 3], segments=6, rings=4)
    prims.box("light_switch", (0.012, 0.08, 0.12), (-1.106, -0.5, 1.25), "brass", bevel=0.003)
    prims.box("light_switch_toggle", (0.02, 0.014, 0.03), (-1.12, -0.5, 1.26), "porcelain")
    sockets.interact("lights", (-1.2, -0.5, 1.25), kind="lights")

    # Record player in the north-west corner, a record leaning beside it.
    objs = F("record_player")("record_player", (-8.9 + 0.24, 0.45, 0.0), rot_z=-math.pi / 2)
    rename(named(objs, "_disc"), "record_disc")
    sockets.interact("record_player", (-8.45, 0.45, 1.0), kind="record_player")
    F("side_table")("record_table", (-8.6, -0.42, 0.0), radius=0.25, height=0.62, doily=None)
    sockets.socket("prop_record", (-8.6, -0.42, 0.62), rot_z=-math.pi / 2)

    # The painting's hook on the north wall, sconces either side, plants in the corners.
    prims.box("painting_hook", (0.03, 0.02, 0.03), (-6.0, 0.89, 1.82), "brass")
    sockets.socket("prop_painting", (-6.0, 1.0 - T / 2 - 0.03, 1.35), rot_z=math.pi)
    sconce(0, -7.5, 0.9, math.pi)
    sconce(1, -4.5, 0.9, math.pi)
    sconce(2, -7.4, -4.9, 0.0)
    sconce(3, -2.6, -4.9, 0.0)
    F("potted_plant")("dining_plant_sw", (-8.45, -4.45, 0.0), kind="tree", height=1.35, seed=11)
    F("potted_plant")("dining_plant_se", (-1.5, -4.5, 0.0), kind="spiky", height=0.95, seed=12)

    # Where arriving guests wait to be seated: a row south and a row north of the table.
    for i, x in enumerate((-7.4, -6.2, -3.8, -2.6)):
        sockets.socket(f"stand_{i}", (x, -4.25, 0.0), rot_z=0.0)
    for i, x in enumerate((-7.4, -6.2, -3.8, -2.6)):
        sockets.socket(f"stand_{4 + i}", (x, 0.25, 0.0), rot_z=math.pi)


def window_dressing():
    """Outside the dining window: shutters and a flower box (seen from the garden)."""
    wx = TABLE_X
    for s in (-1, 1):
        x = wx + s * 1.18
        prims.box(f"shutter_{s}", (0.5, 0.04, 1.42), (x, -5.12, 1.55), "wall_green_dark", bevel=0.008)
        for k in range(7):
            prims.box(f"shutter_{s}_slat_{k}", (0.42, 0.012, 0.05), (x, -5.145, 0.98 + k * 0.19), "cushion_green")
        for z in (1.1, 2.0):
            prims.box(f"shutter_{s}_hinge_{z}", (0.12, 0.012, 0.025), (x - s * 0.22, -5.145, z), "black")
    prims.box("flower_box", (1.7, 0.22, 0.16), (wx, -5.23, 0.74), "wood_mid", bevel=0.01)
    rng = random.Random(21)
    for k in range(9):
        x = wx - 0.75 + k * 0.19
        prims.blob(f"flower_box_leaf_{k}", (0.1, 0.08, 0.08), (x, -5.23, 0.84), "plant_green", segments=6, rings=4)
        prims.blob(f"flower_box_bloom_{k}", (0.04, 0.04, 0.035), (x + rng.uniform(-0.04, 0.04), -5.27, 0.92), rng.choice(("rose", "apron_mustard", "cloth_white", "apron_lilac")), segments=5, rings=4)


# ---------------------------------------------------------------------------------------------
# Kitchen


def oven_tower(x):
    """Tall housing unit with an eye-level oven, open, its door dropped flat: food in it shows."""
    p = Piece("oven_tower", (x, CY, 0.0), rot_z=math.pi)
    W, H = 0.7, 2.1
    body_d = 0.59
    front = body_d / 2 - 0.015
    p.box((W - 0.02, 0.5, 0.1), (0.0, -0.03, 0.05), "wood_dark")
    oz0, oz1 = 0.9, 1.5
    p.box((W, body_d, oz0 - 0.1), (0.0, -0.015, 0.1 + (oz0 - 0.1) / 2), "wall_green", bevel=0.01)
    p.box((W, body_d, H - oz1), (0.0, -0.015, oz1 + (H - oz1) / 2), "wall_green", bevel=0.01)
    for s in (-1, 1):
        p.box((0.03, body_d, oz1 - oz0), (s * (W / 2 - 0.015), -0.015, (oz0 + oz1) / 2), "wall_green")
    p.box((W - 0.06, 0.03, oz1 - oz0), (0.0, -0.015 - body_d / 2 + 0.015, (oz0 + oz1) / 2), "wall_green")
    p.box((W + 0.04, 0.64, 0.05), (0.0, 0.0, H + 0.025), "wood_light", bevel=0.01)
    for z0, z1 in ((0.13, 0.48), (0.5, 0.85)):
        p.box((W - 0.06, 0.02, z1 - z0 - 0.02), (0.0, front + 0.01, (z0 + z1) / 2), "cushion_green", bevel=0.006)
        p.box((0.16, 0.022, 0.018), (0.0, front + 0.026, z1 - 0.07), "brass")
    # The oven: an enamel box open to the front, dark inside, a glowing element at the top.
    p.hollow_box((0.64, oz1 - oz0, 0.5), (0.0, front + 0.01 - 0.25, (oz0 + oz1) / 2), "fridge_cream", wall=0.07, depth=0.44, inner="hob_black", floor="hob_black", bevel=0.01, rot=(-math.pi / 2, 0.0, 0.0))
    floor_z = oz0 + 0.07
    for k in range(5):
        p.cylinder_x(0.006, 0.48, (0.0, front - 0.38 + k * 0.08, floor_z + 0.02), "metal_silver", segments=4)
    p.box((0.42, 0.012, 0.015), (0.0, front - 0.33, oz1 - 0.1), "hob_glow")
    p.box((0.42, 0.3, 0.015), (0.0, front - 0.2, oz1 - 0.085), "hob_glow")
    # Dropped door: lying flat at the bottom of the opening, handle hanging under its far edge.
    door_y = front + 0.01 + 0.215
    p.box((0.6, 0.43, 0.035), (0.0, door_y, oz0 + 0.03), "fridge_cream", bevel=0.01)
    p.box((0.38, 0.24, 0.006), (0.0, door_y, oz0 + 0.049), "glass_dark")
    p.cylinder_x(0.012, 0.44, (0.0, door_y + 0.19, oz0 - 0.02), "metal_silver", segments=6)
    for s in (-1, 1):
        p.box((0.05, 0.05, 0.05), (s * 0.27, front + 0.02, oz0 + 0.02), "metal_iron")
    # Controls and a clock above the oven, a cupboard above that.
    p.box((0.62, 0.02, 0.1), (0.0, front + 0.01, oz1 + 0.07), "steel_dark")
    for k, kx in enumerate((-0.2, -0.1, 0.18)):
        p.cylinder_y(0.022, 0.03, (kx, front + 0.03, oz1 + 0.07), "black", segments=6)
    p.cylinder_y(0.035, 0.012, (0.04, front + 0.025, oz1 + 0.07), "porcelain", segments=10)
    p.box((W - 0.06, 0.02, H - oz1 - 0.24), (0.0, front + 0.01, (oz1 + 0.15 + H - 0.05) / 2), "cushion_green", bevel=0.008)
    p.box((W - 0.18, 0.008, H - oz1 - 0.36), (0.0, front + 0.022, (oz1 + 0.15 + H - 0.05) / 2), "wall_green")
    p.cylinder_y(0.016, 0.03, (-0.22, front + 0.035, oz1 + 0.24), "brass", segments=6)
    p.collider((0.0, 0.0, H / 2 + 0.025), (W + 0.04, 0.62, H + 0.05))
    p.collider((0.0, door_y, oz0 + 0.03), (0.6, 0.43, 0.06))
    p.finish()
    sockets.interact("oven", prims.to_world((x, CY, 0.0), math.pi, (0.0, front + 0.06, 1.2)), kind="oven")
    sockets.socket("station_oven", prims.to_world((x, CY, 0.0), math.pi, (0.0, front - 0.2, floor_z + 0.03)))


def kitchen():
    tile_floor("floor_kitchen", -8.9, -1.1, 1.1, 4.9, 20, 10, lambda i, j: "tile_black" if (i + j) % 2 else "tile_white")

    # North wall, west to east: fridge, counter (chopping), stove, counter, oven tower, counter,
    # the cellar door, the sink under the window.
    objs = F("fridge")("fridge", (-8.53, 4.9 - 0.35, 0.0), rot_z=math.pi, board=(0.54, 0.324), board_z=0.9)
    rename(named(objs, "_whiteboard"), "whiteboard_surface")
    sockets.interact("fridge", (-8.53, 4.12, 1.5), kind="fridge")
    sockets.interact("whiteboard", (-8.56, 4.1, 0.9), kind="whiteboard")
    for k, (dx, z, c) in enumerate(((-0.15, 1.62, "red_bright"), (0.05, 1.68, "apron_mustard"), (0.18, 1.58, "blue_bright"), (-0.02, 1.52, "green_bright"))):
        prims.box(f"fridge_magnet_{k}", (0.05, 0.012, 0.04), (-8.53 - dx, 4.9 - 0.35 - 0.351, z), c, bevel=0.004)

    F("counter")("counter_a", (-7.32, CY, 0.0), rot_z=math.pi, length=1.7)
    prims.box("chopping_board", (0.46, 0.32, 0.035), (-7.4, CY - 0.04, WORKTOP + 0.0175), "wood_light", bevel=0.01)
    prims.box("knife_blade", (0.2, 0.035, 0.006), (-7.06, CY - 0.1, WORKTOP + 0.005), "metal_silver", rot_z=0.3)
    prims.box("knife_handle", (0.1, 0.025, 0.02), (-7.21, CY - 0.05, WORKTOP + 0.01), "wood_dark", rot_z=0.3)
    prims.blob("chop_onion", (0.04, 0.04, 0.035), (-7.75, CY + 0.15, WORKTOP + 0.035), "garlic", segments=6, rings=4)
    sockets.interact("chop", (-7.4, CY - 0.04, WORKTOP + 0.15), kind="chop")
    sockets.socket("station_chop", (-7.4, CY - 0.04, WORKTOP + 0.035))

    objs = F("stove")("stove", (-6.1, CY, 0.0), rot_z=math.pi)
    for i, burner in enumerate(("_burner_1", "_burner_0")):  # west burner first
        b = named(objs, burner)
        x, y = b.location.x, b.location.y
        sockets.interact(f"hob_{i}", (x, y, HOB_Z + 0.15), kind="hob")
        sockets.socket(f"station_hob_{i}", (x, y, HOB_Z + 0.032))
    # Copper cooker hood and its duct.
    prims.tapered_box("hood", (0.78, 0.5, 0.42), (-6.1, 4.9 - 0.25, 1.62), "copper", top=(0.42, 0.6), shift=(0.0, 0.08), bevel=0.01)
    prims.box("hood_rim", (0.8, 0.52, 0.04), (-6.1, 4.9 - 0.26, 1.62), "brass", bevel=0.008)
    prims.box("hood_duct", (0.3, 0.26, WALL_H - 2.03), (-6.1, 4.9 - 0.13, (2.03 + WALL_H) / 2), "copper")

    F("counter")("counter_b", (-5.49, CY, 0.0), rot_z=math.pi, length=0.5)
    prims.lathe("utensil_crock", [(0.06, 0.0), (0.065, 0.15), (0.055, 0.16), (0.0, 0.14)], (-5.49, CY + 0.12, WORKTOP), "ceramic_blue", segments=8)
    for k in range(3):
        prims.cylinder(f"spoon_{k}", 0.008, 0.26, (-5.49 + (k - 1) * 0.02, CY + 0.12, WORKTOP + 0.05), "wood_light", segments=4, rot=(0.15 * (k - 1), 0.1, 0.0))
    oven_tower(-4.89)
    F("counter")("counter_c", (-4.07, CY, 0.0), rot_z=math.pi, length=0.92)
    sockets.socket("prop_pot", (-3.95, CY, WORKTOP))
    for k, (dx, h) in enumerate(((-0.4, 0.2), (-0.3, 0.16), (-0.21, 0.12))):
        prims.cylinder(f"canister_{k}", 0.045, h, (-4.07 + dx, CY + 0.17, WORKTOP), "cloth_cream", segments=8)
        prims.cylinder(f"canister_lid_{k}", 0.047, 0.02, (-4.07 + dx, CY + 0.17, WORKTOP + h), "copper", segments=8)
    F("sink")("sink", (-1.75, CY, 0.0), rot_z=math.pi, length=1.3)
    prims.lathe("herb_pot", [(0.05, 0.0), (0.065, 0.1), (0.0, 0.1)], (-1.5, 4.88, 1.3), "terracotta", segments=6)
    prims.blob("herbs", (0.07, 0.07, 0.07), (-1.5, 4.88, 1.44), "lettuce", segments=6, rings=4, wobble=0.15, seed=4)

    # Wall cabinets over the chopping counter, a shelf of jars by the cellar door.
    p = Piece("wall_cabinets", (-7.32, 4.9, 0.0), rot_z=math.pi, collide=False)
    p.box((1.6, 0.34, 0.66), (0.0, 0.17, 1.84), "wall_green", bevel=0.01)
    p.box((1.66, 0.38, 0.04), (0.0, 0.19, 2.19), "wood_light", bevel=0.008)
    for k in range(3):
        dx = -0.53 + k * 0.53
        p.box((0.5, 0.02, 0.6), (dx, 0.35, 1.84), "cushion_green", bevel=0.006)
        p.box((0.38, 0.008, 0.46), (dx, 0.362, 1.84), "wall_green")
        p.cylinder_y(0.015, 0.03, (dx + (0.19 if k < 2 else -0.19), 0.375, 1.6), "brass", segments=6)
    p.finish()
    F("shelf")("kitchen_shelf", (-4.07, 4.9, 0.0), rot_z=math.pi, length=0.85, mount=1.62, collide=False, seed=5)

    # The island: plates stack at one end, plating ("the pass") in the middle.
    F("kitchen_island")("island", (-6.0, 2.6, 0.0), length=2.4, depth=0.8, towel=None)
    for i in range(6):
        prims.cylinder(f"plate_stack_{i}", 0.085, 0.016, (-6.85, 2.6, WORKTOP + i * 0.018), "porcelain", segments=10, radius_top=0.125)
    sockets.interact("plates", (-6.85, 2.6, WORKTOP + 0.15), kind="plates")
    prims.box("pass_tray", (0.52, 0.38, 0.012), (-5.9, 2.6, WORKTOP + 0.006), "steel", bevel=0.004)
    prims.lathe("pass_bell", [(0.05, 0.0), (0.05, 0.008), (0.045, 0.03), (0.03, 0.05), (0.0, 0.058)], (-5.5, 2.86, WORKTOP), "brass", segments=10)
    prims.cylinder("pass_bell_button", 0.008, 0.015, (-5.5, 2.86, WORKTOP + 0.055), "metal_silver", segments=5)
    sockets.interact("pass", (-5.9, 2.6, WORKTOP + 0.12), kind="pass")
    sockets.socket("station_pass", (-5.9, 2.6, WORKTOP + 0.012))
    sockets.socket("prop_pan", (-5.1, 2.6, WORKTOP), rot_z=0.4)
    sockets.socket("prop_tea_towel", (-5.2, 2.35, WORKTOP))

    # South wall: the pantry, a shelf, a clock over the dining room door.
    F("cupboard")("pantry", (-8.38, 1.1 + 0.28, 0.0), width=0.95, depth=0.5, height=1.95, wood="wall_green", door="cushion_green", panel="wall_green")
    F("shelf")("kitchen_shelf_s", (-5.8, 1.1, 0.0), length=1.4, mount=1.78, collide=False, seed=7)
    prims.cylinder_y("kitchen_clock_rim", 0.17, 0.035, (-2.5, 1.1 + 0.0175, 2.45), "wood_dark", segments=14)
    prims.cylinder_y("kitchen_clock_face", 0.145, 0.01, (-2.5, 1.1 + 0.04, 2.45), "porcelain", segments=14)
    prims.box("kitchen_clock_hand_h", (0.012, 0.006, 0.08), (-2.48, 1.1 + 0.047, 2.48), "black", rot=(0.0, -0.6, 0.0))
    prims.box("kitchen_clock_hand_m", (0.008, 0.006, 0.12), (-2.47, 1.1 + 0.048, 2.4), "black", rot=(0.0, 2.4, 0.0))

    # The Rumor Ledger chalkboard on the west wall (the guest whiteboard is on the fridge).
    objs = F("chalkboard")("chalkboard", (-8.9, 3.0, 0.0), rot_z=-math.pi / 2, width=1.15, height=0.9, mount=1.15)
    rename(named(objs, "_surface"), "chalkboard_surface")
    sockets.interact("chalkboard", (-8.75, 3.0, 1.6), kind="chalkboard")

    hanging_bulb("kitchen", -5.0, 3.0, WALL_H - 0.3, WALL_H, shade="cushion_green")
    sockets.socket("room_light_kitchen", (-5.0, 3.0, WALL_H - 0.3))


# ---------------------------------------------------------------------------------------------
# Hall, bathroom, garage


def grandfather_clock(x, y, rot_z):
    p = Piece("grandfather_clock", (x, y, 0.0), rot_z=rot_z)
    p.box((0.52, 0.32, 0.12), (0.0, 0.0, 0.06), "wood_dark", bevel=0.012)
    p.box((0.46, 0.27, 0.82), (0.0, 0.0, 0.53), "wood_mid", bevel=0.012)
    p.box((0.36, 0.23, 0.72), (0.0, 0.0, 1.3), "wood_mid", bevel=0.01)
    p.box((0.4, 0.02, 0.06), (0.0, 0.12, 0.95), "wood_dark")
    p.box((0.22, 0.012, 0.5), (0.0, 0.118, 1.3), "glass_dark")
    p.box((0.012, 0.006, 0.32), (0.0, 0.126, 1.38), "brass")
    p.cylinder_y(0.065, 0.01, (0.0, 0.128, 1.18), "brass", segments=10)
    p.box((0.5, 0.3, 0.5), (0.0, 0.0, 1.91), "wood_dark", bevel=0.015)
    p.cylinder_y(0.19, 0.014, (0.0, 0.152, 1.92), "brass", segments=14)
    p.cylinder_y(0.165, 0.012, (0.0, 0.16, 1.92), "porcelain", segments=14)
    p.box((0.012, 0.006, 0.1), (0.02, 0.169, 1.95), "black", rot=(0.0, -0.4, 0.0))
    p.box((0.008, 0.006, 0.14), (-0.035, 0.17, 1.93), "black", rot=(0.0, 1.0, 0.0))
    p.prism([(-0.28, 0.0), (0.28, 0.0), (0.0, 0.17)], 0.3, (0.0, 0.0, 2.16), "wood_dark", rot_z=math.pi / 2)
    for s in (-1, 0, 1):
        p.blob((0.03, 0.03, 0.04), (s * 0.24, 0.0, 2.2 + (0.13 if s == 0 else 0.0)), "brass", segments=6, rings=4)
    p.collider((0.0, 0.0, 1.1), (0.52, 0.32, 2.2))
    p.finish()


def picture(name, x, y, rot_z, z, w, h, colors):
    """A framed picture hanging on a wall (decoration, not the painting prop)."""
    p = Piece(name, (x, y, 0.0), rot_z=rot_z, collide=False)
    p.box((w, 0.03, h), (0.0, 0.015, z), "gold", bevel=0.008)
    p.box((w - 0.08, 0.008, h - 0.08), (0.0, 0.031, z), colors[0])
    p.blob((w * 0.22, 0.006, h * 0.2), (0.0, 0.035, z + h * 0.05), colors[1], segments=6, rings=4)
    p.finish()


def hall():
    plank_floor("floor_hall", -0.9, 1.9, -4.9, 4.9, "y", seed=5)
    F("rug")("hall_runner", (0.45, -0.1, 0.0), rot_z=math.pi / 2, length=8.4, width=0.9, field="cloth_blue", border="carpet_red", medallion="cloth_blue", fringe="cloth_cream")
    F("coat_stand")("coat_stand", (1.6, -4.45, 0.0))
    p = Piece("umbrella_stand", (1.25, -4.68, 0.0), collide=True)
    p.lathe([(0.11, 0.0), (0.12, 0.45), (0.13, 0.48), (0.11, 0.48), (0.0, 0.05)], (0.0, 0.0, 0.0), "ceramic_blue", segments=10)
    p.cylinder(0.012, 0.75, (0.03, 0.02, 0.05), "black", segments=4, rot=(0.12, 0.08, 0.0))
    p.box((0.1, 0.02, 0.02), (0.13, 0.08, 0.8), "black", rot=(0.12, 0.08, 0.0))
    p.cylinder(0.012, 0.7, (-0.04, -0.02, 0.05), "cape_red", segments=4, rot=(-0.1, -0.1, 0.0))
    p.collider((0.0, 0.0, 0.4), (0.26, 0.26, 0.8))
    p.finish()

    for i, (y, z) in enumerate(((-3.0, 0.756), (0.8, 0.756))):
        F("side_table")(f"hall_table_{i}", (1.6, y, 0.0), radius=0.27, height=z)
    sockets.socket("prop_snow_globe", (1.6, -3.0, 0.76))
    sockets.socket("prop_photo_frame", (1.6, 0.8, 0.76), rot_z=math.pi / 2)
    picture("hall_picture_0", 1.9, -3.0, math.pi / 2, 1.62, 0.5, 0.62, ("night_blue", "moon"))
    picture("hall_picture_1", 1.9, 0.8, math.pi / 2, 1.62, 0.62, 0.48, ("cushion_green", "rose"))
    picture("hall_picture_2", -0.9, -4.0, -math.pi / 2, 1.6, 0.42, 0.52, ("cloth_cream", "skin_grey"))
    grandfather_clock(-0.9 + 0.17, 1.3, -math.pi / 2)

    p = Piece("hall_lantern", (0.5, 0.0, 0.0), collide=False)
    z = WALL_H - 0.3
    p.cylinder(0.006, 0.18, (0.0, 0.0, z + 0.14), "black", segments=4)
    p.cylinder(0.06, 0.02, (0.0, 0.0, WALL_H - 0.02), "brass", segments=8)
    p.cone(0.13, 0.08, (0.0, 0.0, z + 0.07), "brass", segments=4, rot_z=math.pi / 4)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        p.box((0.014, 0.014, 0.2), (0.085 * math.cos(a), 0.085 * math.sin(a), z - 0.03), "brass")
    p.box((0.14, 0.14, 0.02), (0.0, 0.0, z - 0.13), "brass", bevel=0.005, rot_z=0.0)
    p.keep(prims.box("flame_bulb_hall", (0.11, 0.11, 0.17), (0.0, 0.0, z - 0.03), "candle"))
    objs = p.finish()
    named(objs, "_body").name = "ceiling_light_hall"
    sockets.socket("room_light_hall", (0.5, 0.0, WALL_H - 0.3))

    # Arriving guests walk: doorstep → just inside → hall by the archway → into the dining room,
    # then to their standing spot via the south or north side of the table.
    sockets.socket("guest_door", (0.5, -5.9, 0.0), rot_z=0.0)
    sockets.socket("path_0", (0.5, -4.2, 0.0))
    sockets.socket("path_1", (0.4, -2.0, 0.0))
    sockets.socket("path_2", (-1.8, -2.0, 0.0))
    sockets.socket("path_s", (-2.3, -4.25, 0.0))
    sockets.socket("path_n", (-2.3, 0.25, 0.0))
    # Gary from next door hovers by the archway, where he can see the table.
    sockets.socket("neighbor", (0.2, -2.3, 0.0), rot_z=math.pi / 2)
    sockets.socket("visitor_door", (0.9, -5.9, 0.0), rot_z=0.0)


def bathroom():
    tile_floor("floor_bathroom", 2.1, 4.9, 2.1, 4.9, 10, 10, lambda i, j: "tile_black" if (i + j) % 2 else "tile_white")
    F("bath")("bath", (4.9 - 0.42, 3.0, 0.0), rot_z=math.pi / 2)
    prims.blob("rubber_duck", (0.04, 0.035, 0.035), (4.6, 2.5, 0.42), "yolk", segments=6, rings=4)
    prims.blob("rubber_duck_head", (0.025, 0.025, 0.025), (4.6, 2.47, 0.465), "yolk", segments=6, rings=4)
    prims.box("bath_mat", (0.5, 0.8, 0.012), (3.82, 3.0, 0.006), "cloth_cream", bevel=0.004)
    F("toilet")("toilet", (4.25, 4.9 - 0.31, 0.0), rot_z=math.pi)
    F("basin")("basin", (2.95, 4.9 - 0.21, 0.0), rot_z=math.pi)
    F("wall_mirror")("bath_mirror", (2.95, 4.9, 0.0), rot_z=math.pi, shape="rect", width=0.5, height=0.62, center_z=1.52, frame="brass")
    # Towel rail on the south wall, a spiky plant in the corner.
    for s in (-1, 1):
        prims.box(f"towel_rail_bracket_{s}", (0.03, 0.08, 0.03), (3.2 + s * 0.3, 2.14, 1.05), "brass")
    prims.cylinder_x("towel_rail", 0.012, 0.66, (3.2, 2.17, 1.05), "brass", segments=6)
    prims.box("towel", (0.42, 0.03, 0.55), (3.2, 2.19, 0.79), "cloth_white", bevel=0.008)
    prims.box("towel_stripe", (0.425, 0.034, 0.05), (3.2, 2.19, 0.62), "ceramic_blue")
    F("potted_plant")("bath_plant", (2.4, 2.4, 0.0), kind="spiky", height=0.8, seed=13)
    p = Piece("bath_light", (3.5, 3.5, 0.0), collide=False)
    p.cylinder(0.2, 0.02, (0.0, 0.0, WALL_H - 0.02), "brass", segments=12)
    p.keep(prims.lathe("flame_bulb_bathroom", [(0.0, 0.0), (0.1, 0.02), (0.17, 0.08), (0.19, 0.14)], (0.0, 0.0, WALL_H - 0.16), "candle", segments=12))
    objs = p.finish()
    named(objs, "_body").name = "ceiling_light_bathroom"
    sockets.socket("room_light_bathroom", (3.5, 3.5, WALL_H - 0.3))


def garage():
    quad("floor_garage_a", 2.1, 8.9, -4.9, 1.9, 0.0, "concrete")
    quad("floor_garage_b", 5.1, 8.9, 1.9, 4.9, 0.0, "concrete")
    for k, x in enumerate((4.4, 6.7)):
        prims.box(f"garage_joint_x_{k}", (0.02, 9.8, 0.004), (x, 0.0, 0.002), "stone_dark")
    prims.box("garage_joint_y", (6.8, 0.02, 0.004), (5.5, -1.5, 0.002), "stone_dark")
    oil = prims.cylinder("oil_stain", 0.5, 0.003, (5.4, -2.9, 0.0), "asphalt", segments=10)
    prims.stretch(oil, (1.0, 1.4, 1.0))

    F("workbench")("workbench", (8.9 - 0.36, 0.0, 0.0), rot_z=math.pi / 2)
    # Pegboard with tools over the bench.
    p = Piece("pegboard", (8.9, 0.0, 0.0), rot_z=math.pi / 2, collide=False)
    p.box((1.6, 0.02, 0.85), (0.0, 0.01, 1.55), "wood_light")
    p.box((0.03, 0.02, 0.5), (-0.55, 0.03, 1.6), "wood_mid")
    p.box((0.16, 0.025, 0.07), (-0.55, 0.03, 1.86), "metal_iron")
    p.box((0.45, 0.012, 0.12), (-0.15, 0.03, 1.5), "metal_silver")
    p.box((0.12, 0.03, 0.12), (0.12, 0.03, 1.5), "wood_mid")
    p.box((0.04, 0.02, 0.3), (0.35, 0.03, 1.65), "metal_iron", rot=(0.0, 0.3, 0.0))
    p.cylinder_y(0.03, 0.02, (0.55, 0.03, 1.75), "red_bright", segments=8)
    p.box((0.015, 0.025, 0.22), (0.55, 0.03, 1.58), "metal_silver")
    p.finish()

    objs = F("dog_bed")("dog_bed", (7.4, -3.6, 0.0), rot_z=math.pi / 2)
    sockets.socket("dog", (7.4, -3.6, 0.0), rot_z=math.pi / 2)
    prims.lathe("dog_bowl", [(0.1, 0.0), (0.13, 0.06), (0.11, 0.06), (0.09, 0.02), (0.0, 0.02)], (6.75, -4.45, 0.0), "red_bright", segments=10)
    prims.box("dog_bone", (0.16, 0.03, 0.025), (6.9, -3.0, 0.0125), "porcelain", rot_z=0.5)

    # The fuse box, on the wall to the left as you come in from the hall.
    F("fuse_box")("fuse_box", (2.1, 0.4, 0.0), rot_z=-math.pi / 2, mount=1.3, conduit=0.95)
    sockets.interact("fuse_box", (2.33, 0.4, 1.52), kind="fuse_box")

    # A car under a dust sheet.
    p = Piece("covered_car", (5.3, -1.3, 0.0))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cylinder_x(0.32, 0.22, (sx * 0.82, sy * 1.3, 0.32), "tire", segments=10)
            p.cylinder_x(0.16, 0.23, (sx * 0.82, sy * 1.3, 0.32), "steel_dark", segments=8)
    p.rounded_box((1.86, 4.1, 0.62), (0.0, 0.0, 0.62), "cloth_grey", radius=0.18)
    p.cushion((1.6, 2.1, 0.5), (0.0, -0.25, 1.15), "cloth_grey", puff=0.3, radius=0.16)
    p.tapered_box((1.98, 4.2, 0.22), (0.0, 0.0, 0.2), "cloth_grey", top=(0.96, 0.98), bevel=0.04)
    p.collider((0.0, 0.0, 0.7), (1.98, 4.2, 1.4))
    p.finish()

    # Steel shelving on the back wall, a chest freezer, tyres, garden tools.
    p = Piece("garage_shelving", (6.9, 4.9 - 0.25, 0.0), rot_z=math.pi)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.04, 0.04, 1.9), (sx * 1.4, sy * 0.2, 0.95), "steel_dark")
    rng = random.Random(31)
    for k, z in enumerate((0.12, 0.62, 1.12, 1.62)):
        p.box((2.88, 0.46, 0.03), (0.0, 0.0, z), "steel", bevel=0.005)
        x = -1.3
        while x < 1.2:
            r = rng.random()
            if r < 0.45:
                w = rng.uniform(0.3, 0.5)
                h = rng.uniform(0.18, 0.4)
                p.box((w, 0.36, h), (x + w / 2, 0.0, z + 0.015 + h / 2), rng.choice(("bread_crust", "wood_light", "paper")), rot_z=rng.uniform(-0.08, 0.08))
                x += w + 0.06
            elif r < 0.8:
                c = rng.choice(("red_bright", "blue_bright", "apron_mustard", "cloth_white", "green_bright"))
                p.cylinder(0.085, 0.2, (x + 0.09, 0.0, z + 0.015), c, segments=6)
                x += 0.22
            else:
                x += rng.uniform(0.15, 0.3)
    p.collider((0.0, 0.0, 0.95), (2.9, 0.48, 1.9))
    p.finish()

    p = Piece("chest_freezer", (8.9 - 0.4, 3.2, 0.0), rot_z=math.pi / 2)
    p.box((1.2, 0.66, 0.06), (0.0, 0.0, 0.03), "steel_dark")
    p.rounded_box((1.25, 0.72, 0.8), (0.0, 0.0, 0.46), "fridge_cream", radius=0.05)
    p.box((1.27, 0.74, 0.02), (0.0, 0.0, 0.7), "steel_dark")
    p.box((0.3, 0.04, 0.04), (0.0, 0.38, 0.74), "metal_silver")
    p.box((0.06, 0.03, 0.08), (0.0, 0.39, 0.66), "brass", bevel=0.008)
    p.torus(0.025, 0.006, (0.0, 0.405, 0.72), "brass", segments=6, sides=3, rot=(math.pi / 2, 0.0, 0.0))
    p.collider((0.0, 0.0, 0.43), (1.27, 0.74, 0.86))
    p.finish()

    for k in range(3):
        prims.torus(f"tyre_{k}", 0.27, 0.1, (8.4, -4.4, 0.1 + k * 0.2), "tire", segments=12, sides=5)
    sockets.collider_box("tyres", (8.4, -4.4, 0.3), (0.75, 0.75, 0.6))
    for k, (x, c) in enumerate(((2.45, "wood_mid"), (2.7, "wood_light"))):
        prims.cylinder(f"tool_handle_{k}", 0.016, 1.3, (x, -4.82, 0.12), c, segments=5, rot=(-0.08, 0.0, 0.0))
    prims.box("spade_head", (0.2, 0.025, 0.28), (2.45, -4.83, 0.14), "metal_iron")
    prims.box("rake_head", (0.4, 0.04, 0.04), (2.7, -4.8, 1.42), "metal_iron")

    hanging_bulb("garage", 5.5, 0.0, WALL_H - 0.3, WALL_H)
    sockets.socket("room_light_garage", (5.5, 0.0, WALL_H - 0.3))


# ---------------------------------------------------------------------------------------------
# Cellar


def cellar():
    # The stairs (one ramp collider) from the kitchen door down to the cellar floor.
    F("stairs")("cellar_stairs", (-3.0, 6.5, CELLAR_Z), rot_z=math.pi, width=1.8, run=3.0, rise=-CELLAR_Z, wood="wood_dark", tread="wood_mid", runner=None)
    for y in (5.6, 7.4):
        prims.box(f"stair_rail_bracket_{y}", (0.06, 0.03, 0.03), (-2.13, y, 0.9 - (y - 5.0) * 0.53), "metal_iron")
    rail_len = 3.0 / math.cos(math.atan2(1.6, 3.0))
    prims.cylinder_y("stair_rail", 0.022, rail_len - 0.6, (-2.16, 6.5, 0.9 - 1.5 * 0.53 + 0.02), "wood_mid", segments=6, rot=(-math.atan2(1.6, 3.0), 0.0, 0.0))

    # Floor, joists, the floor collider.
    rng = random.Random(41)
    tile_floor("floor_cellar", -5.9, -1.1, 7.9, 11.9, 8, 7, lambda i, j: rng.choice(("stone", "stone_dark", "shell", "concrete", "smoke")), z=CELLAR_Z)
    sockets.collider_box("cellar_floor", (-3.5, 10.0, CELLAR_Z - 0.1), (5.0, 4.2, 0.2))
    for k in range(5):
        prims.box(f"cellar_joist_{k}", (0.14, 4.0, 0.16), (-5.5 + k * 1.0, 10.0, CELLAR_TOP - 0.08), "wood_dark")

    # The wine rack straight ahead at the bottom of the stairs.
    F("wine_rack")("cellar_wine_rack", (-4.0, 11.9 - 0.17, CELLAR_Z), rot_z=math.pi, width=1.5, depth=0.32, height=1.75, cols=5, rows=7, seed=9)
    sockets.interact("wine_rack", (-4.0, 11.3, CELLAR_Z + 1.0), kind="wine_rack")

    # Shelves of preserves along the west wall.
    p = Piece("preserve_shelves", (-5.9 + 0.18, 10.0, CELLAR_Z), rot_z=-math.pi / 2)
    for sx in (-1, 1):
        p.box((0.05, 0.34, 1.8), (sx * 1.0, 0.0, 0.9), "wood_mid")
    jars = ("honey", "tomato", "lettuce", "olive", "yolk", "soup_green", "meat_raw")
    for k, z in enumerate((0.1, 0.55, 1.0, 1.45)):
        p.box((2.04, 0.34, 0.03), (0.0, 0.0, z), "wood_mid", bevel=0.005)
        x = -0.9
        while x < 0.85:
            if rng.random() < 0.2:
                x += 0.15
                continue
            r, h = rng.uniform(0.05, 0.065), rng.uniform(0.13, 0.2)
            p.lathe([(r, 0.0), (r, h - 0.025), (r * 0.7, h)], (x + r, 0.0, z + 0.015), rng.choice(jars), segments=5)
            p.cylinder(r * 0.72, 0.022, (x + r, 0.0, z + 0.015 + h), "copper", segments=5)
            x += 2 * r + 0.06
    p.collider((0.0, 0.0, 0.9), (2.1, 0.36, 1.8))
    p.finish()

    # Barrels, crates of potatoes, a mouse trap.
    for k, (x, y) in enumerate(((-1.55, 11.45), (-2.15, 11.5), (-1.6, 10.85))):
        p = Piece(f"barrel_{k}", (x, y, CELLAR_Z), rot_z=k * 0.7)
        p.lathe([(0.22, 0.0), (0.25, 0.18), (0.265, 0.38), (0.25, 0.58), (0.22, 0.76), (0.0, 0.76)], (0.0, 0.0, 0.0), "wood_mid", segments=8)
        for z, rr in ((0.1, 0.235), (0.66, 0.235)):
            p.torus(rr, 0.012, (0.0, 0.0, z), "metal_iron", segments=8, sides=3)
        p.cylinder(0.04, 0.012, (0.0, 0.0, 0.76), "wood_dark", segments=6)
        p.collider((0.0, 0.0, 0.38), (0.52, 0.52, 0.76))
        p.finish()
    for k, (x, y, z, yaw) in enumerate(((-1.45, 9.0, 0.0, 0.1), (-1.45, 9.0, 0.3, -0.15), (-1.5, 9.55, 0.0, 0.05))):
        prims.hollow_box(f"cellar_crate_{k}", (0.5, 0.4, 0.3), (x, y, CELLAR_Z + z + 0.15), "wood_light", wall=0.025, depth=0.24, inner="wood_mid", rot_z=yaw + math.pi / 2)
    for k in range(5):
        prims.blob(f"potato_{k}", (0.05, 0.04, 0.035), (-1.45 + (k % 3 - 1) * 0.1, 9.0 + (k // 3 - 0.5) * 0.12, CELLAR_Z + 0.58), "mushroom", segments=5, rings=4, wobble=0.15, seed=k)
    sockets.collider_box("cellar_crates", (-1.47, 9.27, CELLAR_Z + 0.3), (0.45, 1.1, 0.6))
    prims.box("mouse_trap", (0.11, 0.05, 0.012), (-2.6, 11.0, CELLAR_Z + 0.006), "wood_light")
    prims.box("mouse_trap_bar", (0.006, 0.045, 0.006), (-2.62, 11.0, CELLAR_Z + 0.015), "metal_silver")
    prims.wedge("mouse_trap_cheese", (0.025, 0.03, 0.02), (-2.57, 11.0, CELLAR_Z + 0.022), "cheese")
    # Cobwebs in the corners.
    for k, (x, y, sx, sy) in enumerate(((-5.9, 11.9, 1, -1), (-1.1, 8.1, -1, 1))):
        z = CELLAR_TOP - 0.01
        poly(f"cobweb_{k}", [(x, y, z), (x + sx * 0.35, y, z), (x, y + sy * 0.35, z - 0.3)], "ghost_white", toward=(-3.5, 10.0, CELLAR_Z + 1.0))

    hanging_bulb("cellar", -3.5, 10.0, CELLAR_TOP - 0.2, CELLAR_TOP)
    sockets.socket("room_light_cellar", (-3.5, 10.0, CELLAR_TOP - 0.2))


# ---------------------------------------------------------------------------------------------
# Outside


def picket_fence():
    """White picket fence along the south boundary, with a gate across the driveway."""
    y = -16.1
    outline = [(-0.04, 0.0), (0.04, 0.0), (0.04, 0.95), (0.0, 1.03), (-0.04, 0.95)]
    x = -12.9
    k = 0
    while x < 12.95:
        prims.prism(f"picket_{k}", outline, 0.025, (x, y, 0.0), "cloth_white", rot_z=math.pi / 2)
        x += 0.21
        k += 1
    for z in (0.3, 0.78):
        prims.box(f"fence_rail_{z}", (26.0, 0.03, 0.07), (0.0, y + 0.03, z), "cloth_white")
    for k, px in enumerate([-13.0 + 2.0 * i for i in range(14)]):
        big = abs(px - 3.0) < 0.1 or abs(px - 7.0) < 0.1
        s = 0.14 if big else 0.1
        prims.box(f"fence_post_{k}", (s, s, 1.15 if big else 1.05), (px, y + 0.05, (1.15 if big else 1.05) / 2), "cloth_white")
        prims.blob(f"fence_post_ball_{k}", (s * 0.55, s * 0.55, s * 0.5), (px, y + 0.05, (1.15 if big else 1.05) + s * 0.4), "cloth_white", segments=5, rings=3)
    # The driveway gate between the big posts: a diagonal brace says "gate".
    gate_len = math.hypot(4.0, 0.48)
    prims.box("gate_brace", (gate_len, 0.03, 0.07), (5.0, y + 0.035, 0.54), "cloth_white", rot=(0.0, -math.atan2(0.48, 4.0), 0.0))
    prims.box("gate_latch", (0.1, 0.04, 0.06), (5.0, y + 0.06, 0.78), "black")


def hedge_row(name, x0, y0, x1, y1, step=0.75, height=1.5, seed=0, segments=6, rings=4):
    rng = random.Random(seed)
    n = max(1, round(math.hypot(x1 - x0, y1 - y0) / step))
    for k in range(n + 1):
        t = k / n
        r = rng.uniform(0.42, 0.55)
        h = height * rng.uniform(0.85, 1.05)
        prims.blob(
            f"{name}_{k}",
            (r, r, h / 2),
            (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, h / 2),
            "hedge_dark" if k % 3 else "plant_green",
            segments=segments,
            rings=rings,
            flat_bottom=0.98,
            wobble=0.1,
            seed=seed * 100 + k,
        )


def tree(name, x, y, height, seed):
    rng = random.Random(seed)
    prims.lathe(f"{name}_trunk", [(0.2, 0.0), (0.14, 0.3), (0.1, height * 0.55), (0.06, height * 0.75)], (x, y, 0.0), "wood_dark", segments=6)
    r = height * 0.24
    prims.blob(f"{name}_crown", (r * 1.1, r * 1.1, r), (x, y, height - r), "hedge_dark", segments=8, rings=5, wobble=0.12, seed=seed)
    for k in range(3):
        a = rng.uniform(0, 2 * math.pi)
        rr = r * rng.uniform(0.55, 0.7)
        prims.blob(f"{name}_crown_{k}", (rr, rr, rr * 0.9), (x + r * 0.7 * math.cos(a), y + r * 0.7 * math.sin(a), height - r * rng.uniform(0.7, 1.3)), "plant_green" if k == 1 else "hedge_dark", segments=6, rings=4, wobble=0.12, seed=seed + k + 1)
    sockets.collider_box(name, (x, y, 1.0), (0.35, 0.35, 2.0))


def moon():
    """The moon, beyond the garden fence, in view of the dining table through the window."""
    mx, my, mz, r = -5.4, -16.9, 3.3, 1.1
    parts = [prims.cylinder_y("moon_disc", r, 0.08, (mx, my, mz), "moon", segments=20)]
    for k, (dx, dz, cr) in enumerate(((-0.35, 0.3, 0.22), (0.3, -0.25, 0.28), (0.45, 0.42, 0.12), (-0.2, -0.5, 0.14), (0.05, 0.1, 0.09))):
        parts.append(prims.cylinder_y(f"moon_crater_{k}", cr, 0.02, (mx + dx, my + 0.045, mz + dz), "cloth_cream", segments=10))
    prims.join("moon", parts, origin=(mx, my, mz))


def facade():
    """Quoins, odd bricks, downpipes, the porch lantern, the house number."""
    rng = random.Random(51)
    for cx, sx in ((-9.1, 1), (9.1, -1)):
        for k in range(9):
            z = 0.4 + k * 0.27
            long = k % 2 == 0
            prims.box(f"quoin_s_{cx}_{k}", (0.42 if long else 0.24, 0.03, 0.22), (cx + sx * (0.21 if long else 0.12), -5.115, z + 0.11), "stone")
            prims.box(f"quoin_e_{cx}_{k}", (0.03, 0.24 if long else 0.42, 0.22), (cx - sx * 0.015, -5.1 + (0.12 if long else 0.21), z + 0.11), "stone")
    holes = ((-6.45, -3.55, 0.6, 2.3), (-0.1, 1.1, 0.0, 2.25), (0.3, 0.7, 2.4, 2.8), (1.15, 1.55, 1.6, 1.9), (4.0, 7.0, 0.0, 2.35))
    k = 0
    while k < 50:
        x, z = rng.uniform(-8.5, 8.5), rng.uniform(0.45, 2.65)
        if any(a0 - 0.15 < x < a1 + 0.15 and b0 - 0.1 < z < b1 + 0.1 for a0, a1, b0, b1 in holes):
            continue
        prims.box(f"brick_{k}", (0.22, 0.02, 0.07), (x, -5.11, z), rng.choice(("brick_dark", "brick_dark", "terracotta")))
        k += 1
    for x in (-9.25, 9.25):
        prims.cylinder(f"downpipe_{x}", 0.045, 2.7, (x, -5.45, 0.0), "steel_dark", segments=6)
        prims.box(f"downpipe_shoe_{x}", (0.1, 0.16, 0.06), (x, -5.5, 0.03), "steel_dark")
    prims.box("house_number", (0.2, 0.02, 0.14), (1.35, -5.11, 1.75), "brass", bevel=0.005)
    prims.box("house_number_digit", (0.1, 0.022, 0.08), (1.35, -5.115, 1.75), "black")
    # Porch: step, doormat, a lantern on a bracket over the door (the porch light), two plants.
    prims.box("porch_step", (1.9, 0.95, 0.03), (0.5, -5.575, 0.015), "stone", bevel=0.006)
    prims.box("doormat", (0.85, 0.5, 0.012), (0.5, -5.42, 0.036), "rug", bevel=0.004)
    prims.box("porch_bracket_plate", (0.1, 0.02, 0.16), (0.5, -5.11, 2.62), "black")
    prims.box("porch_bracket", (0.025, 0.5, 0.025), (0.5, -5.35, 2.62), "black")
    lx, ly, lz = 0.5, -5.6, 2.4
    prims.cylinder("porch_lantern_hook", 0.006, 0.08, (lx, ly, 2.54), "black", segments=4)
    prims.cone("porch_lantern_roof", 0.12, 0.09, (lx, ly, lz + 0.11), "black", segments=4, rot_z=math.pi / 4)
    prims.box("porch_lantern_base", (0.15, 0.15, 0.03), (lx, ly, lz - 0.13), "black")
    for kk in range(4):
        a = math.pi / 4 + kk * math.pi / 2
        prims.box(f"porch_lantern_post_{kk}", (0.014, 0.014, 0.24), (lx + 0.075 * math.cos(a), ly + 0.075 * math.sin(a), lz - 0.01), "black")
    prims.box("flame_porch", (0.12, 0.12, 0.2), (lx, ly, lz - 0.01), "candle")
    sockets.socket("room_light_porch", (lx, ly, lz))
    F("potted_plant")("porch_plant_l", (-0.4, -5.45, 0.0), kind="spiky", height=0.85, seed=14)
    F("potted_plant")("porch_plant_r", (1.4, -5.45, 0.0), kind="spiky", height=0.85, seed=15)


def garden():
    rng = random.Random(61)
    # Flower bed along the dining room front.
    prims.box("bed_soil", (7.4, 0.62, 0.04), (-5.1, -5.43, 0.02), "dog_dark")
    prims.box("bed_edge", (7.44, 0.05, 0.07), (-5.1, -5.76, 0.035), "stone_dark")
    for k in range(17):
        x = -8.6 + k * 0.44 + rng.uniform(-0.08, 0.08)
        if -6.0 < x < -4.0 and k % 2:
            continue
        prims.blob(f"bed_clump_{k}", (0.17, 0.15, 0.14), (x, -5.42, 0.12), "plant_green" if k % 2 else "hedge_dark", segments=6, rings=4, wobble=0.12, seed=k)
        for j in range(1):
            prims.blob(f"bed_bloom_{k}_{j}", (0.045, 0.045, 0.04), (x + rng.uniform(-0.1, 0.1), -5.45 + rng.uniform(-0.1, 0.06), 0.25 + rng.uniform(-0.03, 0.04)), rng.choice(("rose", "apron_mustard", "cloth_white", "apron_lilac", "red_bright")), segments=5, rings=4)
    for k, x in enumerate((-8.85, -1.35)):
        prims.blob(f"bed_bush_{k}", (0.42, 0.38, 0.45), (x, -5.5, 0.4), "hedge_dark", segments=8, rings=5, flat_bottom=0.9, wobble=0.1, seed=70 + k)
    # Stepping stones from the porch toward the driveway.
    for k, (x, y, yaw) in enumerate(((0.5, -6.35, 0.05), (0.42, -6.95, -0.1), (0.6, -7.55, 0.12), (1.15, -7.95, 0.3), (1.8, -8.1, 0.05))):
        prims.box(f"paver_{k}", (0.55, 0.44, 0.025), (x, y, 0.0125), "stone", bevel=0.01, rot_z=yaw)
    prims.box("drive_curb", (0.12, 10.9, 0.05), (2.0, -10.55, 0.025), "stone")
    # Trees, a bird bath, a gnome, tufts of grass.
    tree("garden_tree_0", -10.6, -9.4, 4.4, 81)
    tree("garden_tree_1", -11.6, -14.2, 3.8, 82)
    tree("garden_tree_2", -0.8, -13.8, 3.6, 83)
    p = Piece("bird_bath", (-7.6, -10.6, 0.0))
    p.lathe([(0.18, 0.0), (0.12, 0.08), (0.06, 0.2), (0.07, 0.7), (0.3, 0.8), (0.33, 0.86), (0.28, 0.86), (0.0, 0.8)], (0.0, 0.0, 0.0), "stone", segments=10)
    p.cylinder(0.27, 0.01, (0.0, 0.0, 0.84), "glass", segments=10)
    p.collider((0.0, 0.0, 0.43), (0.6, 0.6, 0.86))
    p.finish()
    p = Piece("gnome", (-1.15, -6.15, 0.0), rot_z=0.4, collide=False)
    p.blob((0.09, 0.08, 0.12), (0.0, 0.0, 0.12), "cloth_blue", segments=7, rings=5, flat_bottom=0.95)
    p.blob((0.06, 0.06, 0.06), (0.0, 0.03, 0.28), "skin_host", segments=6, rings=4)
    p.blob((0.05, 0.03, 0.06), (0.0, 0.07, 0.22), "cloth_white", segments=6, rings=4)
    p.cone(0.065, 0.18, (0.0, 0.0, 0.31), "red_bright", segments=6, rot=(-0.3, 0.0, 0.0))
    p.blob((0.012, 0.012, 0.012), (0.0, 0.088, 0.28), "red_bright", segments=4, rings=3)
    p.finish()
    k = 0
    while k < 70:
        x, y = rng.uniform(-12.7, 1.6), rng.uniform(-15.7, -6.0)
        if -0.3 < x < 2.2 and y > -8.4:
            continue
        h = rng.uniform(0.09, 0.16)
        prims.cone(f"tuft_{k}", 0.05, h, (x, y, 0.0), rng.choice(("plant_green", "hedge_dark", "lettuce")), segments=3, rot_z=rng.uniform(0, 2))
        k += 1


def outside():
    with area("ground"):
        quad("ground_lawn", -13.0, 2.0, -16.0, -5.1, 0.0, "grass")
        quad("ground_drive", 2.0, 13.0, -16.0, -5.1, 0.0, "asphalt")

    # Boundaries: hedges either side and a picket fence along the south keep everyone in the
    # front garden.
    for name, (x0, x1, y0, y1) in {
        "fence_s": (-13.0, 13.0, -16.2, -16.0),
        "fence_w": (-13.2, -13.0, -16.0, -5.0),
        "fence_e": (13.0, 13.2, -16.0, -5.0),
        "hedge_w": (-13.0, -9.1, -5.3, -4.9),
        "hedge_e": (9.1, 13.0, -5.3, -4.9),
    }.items():
        sockets.collider_box(name, ((x0 + x1) / 2, (y0 + y1) / 2, 1.5), (x1 - x0, y1 - y0, 3.0))
    picket_fence()
    hedge_row("hedge_w", -12.7, -5.15, -9.5, -5.15, height=1.4, seed=1)
    hedge_row("hedge_e", 9.5, -5.15, 12.7, -5.15, height=1.4, seed=2)
    hedge_row("hedge_side_w", -13.1, -15.6, -13.1, -5.6, height=1.7, seed=3)
    hedge_row("hedge_side_e", 13.1, -15.6, 13.1, -5.6, height=1.7, seed=4)

    facade()
    garden()

    # The catering van, rear doors open toward the house.
    vx, vy = 5.5, -10.5
    F("van")("van", (vx, vy, 0.0), rot_z=math.pi)
    sockets.interact("van", (vx, vy + 2.5, 1.1), kind="van")
    sockets.socket("van_rear", (vx, vy + 3.0, 0.0), rot_z=math.pi)


def backyard():
    """Behind and beside the house: only seen through windows and over the hedges."""
    for k, (x0, x1, y0, y1) in enumerate(((-13.0, -6.1, 5.1, 14.0), (-0.9, 13.0, 5.1, 14.0), (-6.1, -0.9, 12.1, 14.0), (-6.1, -4.1, 5.1, 7.9), (-1.9, -0.9, 5.1, 7.9))):
        quad(f"backyard_ground_{k}", x0, x1, y0, y1, 0.0, "grass")
    quad("backyard_side_w", -13.0, -9.1, -4.9, 5.1, 0.0, "grass")
    quad("backyard_side_e", 9.1, 13.0, -4.9, 5.1, 0.0, "grass")
    hedge_row("backyard_hedge", -12.0, 13.5, 12.0, 13.5, step=1.5, height=2.0, seed=5, segments=5)
    tree("backyard_tree_0", 1.5, 10.5, 4.6, 91)
    tree("backyard_tree_1", -9.5, 9.0, 4.0, 92)
    for k, x in enumerate((-11.0, 0.5, 9.5)):
        tree(f"backyard_far_tree_{k}", x, -19.0 - k * 0.6, 5.5, 95 + k)


def layout():
    sockets.room("dining", (-5, -2, WALL_H / 2), (8, 6, WALL_H))
    sockets.room("kitchen", (-5, 3, WALL_H / 2), (8, 4, WALL_H))
    sockets.room("hall", (0.5, 0, WALL_H / 2), (3, 10, WALL_H))
    sockets.room("bathroom", (3.5, 3.5, WALL_H / 2), (3, 3, WALL_H))
    sockets.room("garage", (5.5, -1.5, WALL_H / 2), (7, 7, WALL_H), part="a")
    sockets.room("garage", (7.0, 3.5, WALL_H / 2), (4, 3, WALL_H), part="b")
    sockets.room("cellar", (-3.0, 6.5, (CELLAR_Z + WALL_H) / 2), (2, 3, WALL_H - CELLAR_Z), part="stairs")
    sockets.room("cellar", (-3.5, 10.0, (CELLAR_Z + CELLAR_TOP) / 2), (5, 4, CELLAR_TOP - CELLAR_Z), part="main")
    sockets.room("outside", (0.0, -10.5, 2.0), (26, 11, 4.0))
    # The ground under the house and garden.
    sockets.collider_box("ground", (0, -5.5, -0.1), (26.4, 21.4, 0.2))
    # Lobby spawns behind the van, facing the house.
    for i, (x, y) in enumerate(((4.2, -7.2), (5.5, -7.0), (6.8, -7.2), (4.6, -6.2), (5.5, -6.0), (6.4, -6.2))):
        sockets.spawn(str(i), (x, y, 0.0), 0.0)


def build():
    AREAS.clear()
    with area("shell"):
        walls()
        doors()
        windows()
    with area("ceiling"):
        ceilings()
        roof()
    with area("dining"):
        dining()
    with area("kitchen"):
        kitchen()
    with area("hall"):
        hall()
    with area("bathroom"):
        bathroom()
    with area("garage"):
        garage()
    with area("cellar"):
        cellar()
    with area("outside"):
        outside()
        moon()
    with area("backyard"):
        backyard()
    layout()
    consolidate()
