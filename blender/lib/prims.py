"""Low-poly building blocks in the chunky storybook style. All sizes in meters, Blender Z-up.

Placement
- Boxy prims are centered on `location`: box, rounded_box, plank, cushion, hollow_box, wedge,
  blob, torus, panel, cylinder_x, cylinder_y.
- Upright prims stand on `location` (it is their base center): cylinder, cone, tapered_box,
  capsule, capsule_figure, lathe.
- prism and strip use `location` as the origin of their (y, z) outline.
- Every prim takes `rot_z` (yaw) and `rot` (XYZ Euler, radians; overrides `rot_z`). The rotation
  is stored on the object and turns the prim about its origin.

Color
- Every prim is painted one palette color. `paint_faces` / `paint_facing` repaint single faces, so
  one mesh can carry several colors, and `join` merges prims into one mesh (one draw call) that
  keeps each part's colors.

Building in local space
- Build a piece around the origin (front facing +Y), `join` its parts, then `place` the result:
  place() moves objects built in local space to a world position + yaw, composing their own
  rotations. `to_world` does the same for a single point.
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable, Iterable, Sequence

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import palette

Vec2 = tuple[float, float]
Vec3 = tuple[float, float, float]
Rot = tuple[float, float, float]


def deg(d: float) -> float:
    return math.radians(d)


# ---------------------------------------------------------------------------------------------
# Internals


def _rotation(rot_z: float, rot: Rot | None) -> Rot:
    return (float(rot[0]), float(rot[1]), float(rot[2])) if rot is not None else (0.0, 0.0, rot_z)


def _link(
    name: str,
    bm: bmesh.types.BMesh,
    location: Vec3,
    rot_z: float,
    color: str,
    rot: Rot | None = None,
    smooth: bool = False,
) -> bpy.types.Object:
    if smooth:
        for f in bm.faces:
            f.smooth = True
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.rotation_euler = _rotation(rot_z, rot)
    bpy.context.scene.collection.objects.link(obj)
    palette.paint(obj, color)
    return obj


def _cube(size: Vec3, base: bool = False) -> bmesh.types.BMesh:
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if base:
        bmesh.ops.translate(bm, vec=(0.0, 0.0, size[2] / 2.0), verts=bm.verts)
    return bm


def _bevel_edges(bm: bmesh.types.BMesh, edges: list, offset: float, segments: int) -> None:
    if offset <= 0.0 or not edges:
        return
    bmesh.ops.bevel(
        bm,
        geom=edges,
        offset=offset,
        segments=segments,
        affect="EDGES",
        profile=0.5,
        clamp_overlap=True,
    )


def _cyl(radius: float, height: float, segments: int, radius_top: float | None) -> bmesh.types.BMesh:
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        segments=segments,
        radius1=radius,
        radius2=radius if radius_top is None else radius_top,
        depth=height,
    )
    bmesh.ops.translate(bm, vec=(0.0, 0.0, height / 2.0), verts=bm.verts)
    return bm


def _bevel_rims(bm: bmesh.types.BMesh, amount: float, limit: float) -> None:
    """Chamfer the cap rims of a cylinder (edges that touch a flat cap)."""
    bm.normal_update()
    caps = {f for f in bm.faces if abs(f.normal.z) > 0.999}
    edges = [e for e in bm.edges if any(f in caps for f in e.link_faces)]
    _bevel_edges(bm, edges, min(amount, limit), 1)


def _face_indices(bm: bmesh.types.BMesh, faces: Iterable) -> list[int]:
    bm.faces.index_update()
    return [f.index for f in faces]


def _paint_polys(obj: bpy.types.Object, indices: Iterable[int], color: str) -> None:
    mesh = obj.data
    u, v = palette.swatch_uv(color)
    uv = mesh.uv_layers[0].data
    for i in indices:
        for li in mesh.polygons[i].loop_indices:
            uv[li].uv = (u, v)


# ---------------------------------------------------------------------------------------------
# Boxes


def box(
    name: str,
    size: Vec3,
    location: Vec3,
    color: str,
    bevel: float = 0.0,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Box centered on `location`. `bevel` chamfers every edge once (44 tris instead of 12)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel > 0.0:
        bmesh.ops.bevel(
            bm,
            geom=list(bm.edges),
            offset=min(bevel, min(size) * 0.45),
            segments=1,
            affect="EDGES",
            profile=0.5,
        )
    return _link(name, bm, location, rot_z, color, rot)


def rounded_box(
    name: str,
    size: Vec3,
    location: Vec3,
    color: str,
    radius: float = 0.03,
    segments: int = 2,
    rot_z: float = 0.0,
    rot: Rot | None = None,
    smooth: bool = False,
) -> bpy.types.Object:
    """Box centered on `location` with every edge rounded (`segments` = 2: ~108 tris). Hero slabs."""
    bm = _cube(size)
    _bevel_edges(bm, list(bm.edges), min(radius, min(size) * 0.45), segments)
    return _link(name, bm, location, rot_z, color, rot, smooth)


def tapered_box(
    name: str,
    size: Vec3,
    location: Vec3,
    color: str,
    top: Vec2 = (0.7, 0.7),
    shift: Vec2 = (0.0, 0.0),
    bevel: float = 0.0,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Box standing on `location`; `size` is the bottom footprint + height. The top face is scaled by
    `top` (x, y factors, > 0; above 1 flares out) and moved by `shift`. Legs, plinths, shades."""
    bm = _cube(size, base=True)
    for v in bm.verts:
        if v.co.z > size[2] / 2.0:
            v.co.x = v.co.x * top[0] + shift[0]
            v.co.y = v.co.y * top[1] + shift[1]
    if bevel > 0.0:
        smallest = min(size[0] * min(1.0, top[0]), size[1] * min(1.0, top[1]), size[2])
        _bevel_edges(bm, list(bm.edges), min(bevel, smallest * 0.45), 1)
    return _link(name, bm, location, rot_z, color, rot)


def plank(
    name: str,
    length: float,
    width: float,
    thickness: float,
    location: Vec3,
    color: str,
    axis: str = "x",
    bevel: float = 0.008,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Beveled board centered on `location`, running along `axis`: "x"/"y" lie flat (thickness is
    height), "z" stands up as a post (width along X, thickness along Y)."""
    size = {
        "x": (length, width, thickness),
        "y": (width, length, thickness),
        "z": (width, thickness, length),
    }[axis]
    return box(name, size, location, color, bevel=bevel, rot_z=rot_z, rot=rot)


def cushion(
    name: str,
    size: Vec3,
    location: Vec3,
    color: str,
    puff: float = 0.35,
    radius: float | None = None,
    smooth: bool = False,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Soft pad centered on `location`: well-rounded edges, and the top bulges up by
    `puff` x thickness in the middle. Seats, pillows, mattresses (~112 tris)."""
    bm = _cube(size)
    r = size[2] * 0.4 if radius is None else radius
    _bevel_edges(bm, list(bm.edges), min(r, min(size) * 0.45), 2)
    bm.normal_update()
    tops = [f for f in bm.faces if f.normal.z > 0.999]
    if tops and puff:
        res = bmesh.ops.poke(bm, faces=tops)
        for v in res["verts"]:
            v.co.z += puff * size[2]
    return _link(name, bm, location, rot_z, color, rot, smooth)


def hollow_box(
    name: str,
    size: Vec3,
    location: Vec3,
    color: str,
    wall: float = 0.04,
    depth: float | None = None,
    bevel: float = 0.0,
    segments: int = 1,
    inner: str | None = None,
    floor: str | None = None,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Box centered on `location` whose top is opened into a basin: a rim `wall` wide, sunk `depth`
    (default: down to `wall` above the bottom). Tubs, sinks, crates, planters, van cargo boxes.
    `inner` paints the inside walls and `floor` the inside bottom (both default to `color`)."""
    bm = _cube(size)
    if bevel > 0.0:
        _bevel_edges(bm, list(bm.edges), min(bevel, min(size) * 0.45), segments)
    bm.normal_update()
    top = max((f for f in bm.faces if f.normal.z > 0.999), key=lambda f: f.calc_center_median().z)
    bmesh.ops.inset_region(bm, faces=[top], thickness=wall, depth=0.0, use_even_offset=True)
    sunk = size[2] - wall if depth is None else depth
    walls_before = set(bm.faces)
    res = bmesh.ops.extrude_face_region(bm, geom=[top])
    new_faces = [g for g in res["geom"] if isinstance(g, bmesh.types.BMFace)]
    new_verts = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0.0, 0.0, -sunk), verts=new_verts)
    if top.is_valid and top not in new_faces:
        bmesh.ops.delete(bm, geom=[top], context="FACES_ONLY")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    floor_faces = new_faces
    wall_faces = [f for f in bm.faces if f not in walls_before and f not in floor_faces]
    floor_idx = _face_indices(bm, floor_faces)
    wall_idx = _face_indices(bm, wall_faces)
    obj = _link(name, bm, location, rot_z, color, rot)
    if inner:
        _paint_polys(obj, wall_idx, inner)
    if floor or inner:
        _paint_polys(obj, floor_idx, floor or inner)
    return obj


def wedge(
    name: str,
    size: Vec3,
    location: Vec3,
    color: str,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Triangular prism centered on its bounding box: full height at the back (-Y), sloping down to
    the bottom front (+Y) edge. Brackets, ramps, roof pitches (8 tris)."""
    x, y, z = size[0] / 2.0, size[1] / 2.0, size[2] / 2.0
    bm = bmesh.new()
    b0, b1, b2, b3 = (bm.verts.new(p) for p in ((-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z)))
    t0, t1 = bm.verts.new((-x, -y, z)), bm.verts.new((x, -y, z))
    for f in ((b0, b3, b2, b1), (b0, b1, t1, t0), (b3, t0, t1, b2), (b0, t0, b3), (b1, b2, t1)):
        bm.faces.new(f)
    return _link(name, bm, location, rot_z, color, rot)


def panel(
    name: str,
    width: float,
    height: float,
    location: Vec3,
    color: str,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """One flat upright quad centered on `location`, in the XZ plane, facing +Y (2 tris). Drawable
    surfaces: pair it with `planar_uv`."""
    w, h = width / 2.0, height / 2.0
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((-w, 0.0, -h), (-w, 0.0, h), (w, 0.0, h), (w, 0.0, -h))]
    bm.faces.new(vs)
    return _link(name, bm, location, rot_z, color, rot)


def prism(
    name: str,
    outline: Sequence[Vec2],
    width: float,
    location: Vec3,
    color: str,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Extrude a closed (y, z) outline along X, `width` wide and centered on `location`. The outline
    may be concave (stair stringers, step stacks, gables) and is relative to `location`."""
    w = width / 2.0
    bm = bmesh.new()
    left = [bm.verts.new((-w, y, z)) for y, z in outline]
    right = [bm.verts.new((w, y, z)) for y, z in outline]
    n = len(outline)
    bm.faces.new(right)
    bm.faces.new(list(reversed(left)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((left[i], left[j], right[j], right[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _link(name, bm, location, rot_z, color, rot)


def strip(
    name: str,
    path: Sequence[Vec2],
    width: float,
    location: Vec3,
    color: str,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Flat one-sided ribbon following an open (y, z) path, `width` wide along X and centered on
    `location`. Faces point up on runs going +Y and toward -Y on rises (a stair runner)."""
    w = width / 2.0
    bm = bmesh.new()
    left = [bm.verts.new((-w, y, z)) for y, z in path]
    right = [bm.verts.new((w, y, z)) for y, z in path]
    for i in range(len(path) - 1):
        bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
    return _link(name, bm, location, rot_z, color, rot)


# ---------------------------------------------------------------------------------------------
# Round things


def cylinder(
    name: str,
    radius: float,
    height: float,
    location: Vec3,
    color: str,
    segments: int = 8,
    radius_top: float | None = None,
    bevel: float = 0.0,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Upright (tapered) cylinder; `location` is the center of the base. `bevel` chamfers both rims."""
    bm = _cyl(radius, height, segments, radius_top)
    if bevel > 0.0:
        rt = radius if radius_top is None else radius_top
        _bevel_rims(bm, bevel, min(radius, rt) * 0.45 if rt > 0 else 0.0)
    return _link(name, bm, location, rot_z, color, rot)


def cylinder_x(
    name: str,
    radius: float,
    length: float,
    location: Vec3,
    color: str,
    segments: int = 8,
    radius_end: float | None = None,
    bevel: float = 0.0,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Cylinder lying along X, centered on `location` (`radius` at -X, `radius_end` at +X).
    Wheels, rails, rolling pins, handles."""
    bm = _cyl(radius, length, segments, radius_end)
    bmesh.ops.translate(bm, vec=(0.0, 0.0, -length / 2.0), verts=bm.verts)
    if bevel > 0.0:
        re = radius if radius_end is None else radius_end
        _bevel_rims(bm, bevel, min(min(radius, re) * 0.45, length * 0.45))
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0.0, 0.0, 0.0), matrix=Matrix.Rotation(math.pi / 2.0, 3, "Y"))
    return _link(name, bm, location, rot_z, color, rot)


def cylinder_y(
    name: str,
    radius: float,
    length: float,
    location: Vec3,
    color: str,
    segments: int = 8,
    radius_end: float | None = None,
    bevel: float = 0.0,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Cylinder lying along Y, centered on `location` (`radius` at -Y, `radius_end` at +Y). Knobs on
    a front face, pipes, bottles lying in a rack."""
    bm = _cyl(radius, length, segments, radius_end)
    bmesh.ops.translate(bm, vec=(0.0, 0.0, -length / 2.0), verts=bm.verts)
    if bevel > 0.0:
        re = radius if radius_end is None else radius_end
        _bevel_rims(bm, bevel, min(min(radius, re) * 0.45, length * 0.45))
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0.0, 0.0, 0.0), matrix=Matrix.Rotation(-math.pi / 2.0, 3, "X"))
    return _link(name, bm, location, rot_z, color, rot)


def cone(
    name: str,
    radius: float,
    height: float,
    location: Vec3,
    color: str,
    segments: int = 8,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Pointed cone standing on `location` (base center). Spikes, roofs, finials, hats."""
    bm = bmesh.new()
    ring = [
        bm.verts.new((radius * math.cos(2 * math.pi * i / segments), radius * math.sin(2 * math.pi * i / segments), 0.0))
        for i in range(segments)
    ]
    apex = bm.verts.new((0.0, 0.0, height))
    for i in range(segments):
        bm.faces.new((ring[i], ring[(i + 1) % segments], apex))
    bm.faces.new(list(reversed(ring)))
    return _link(name, bm, location, rot_z, color, rot)


def torus(
    name: str,
    major: float,
    minor: float,
    location: Vec3,
    color: str,
    segments: int = 12,
    sides: int = 6,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Ring lying flat (in the XY plane) centered on `location`: `major` to the tube center, `minor`
    tube radius (segments x sides x 2 tris). Burners, rims, hoops; `stretch` it for ovals."""
    bm = bmesh.new()
    grid = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        row = []
        for j in range(sides):
            b = 2 * math.pi * j / sides
            r = major + minor * math.cos(b)
            row.append(bm.verts.new((r * math.cos(a), r * math.sin(a), minor * math.sin(b))))
        grid.append(row)
    for i in range(segments):
        i2 = (i + 1) % segments
        for j in range(sides):
            j2 = (j + 1) % sides
            bm.faces.new((grid[i][j], grid[i2][j], grid[i2][j2], grid[i][j2]))
    return _link(name, bm, location, rot_z, color, rot)


def blob(
    name: str,
    radii: Vec3,
    location: Vec3,
    color: str,
    segments: int = 8,
    rings: int = 5,
    flat_bottom: float | None = None,
    wobble: float = 0.0,
    seed: int = 0,
    smooth: bool = False,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Soft low-poly ellipsoid centered on `location` (8 x 5: 64 tris). `flat_bottom` cuts a flat
    base at that fraction of radii.z below the center (0 = halfway) so it can sit on things;
    `wobble` scales each vertex by a seeded random 1 +- wobble for lumpy organic shapes."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    rng = random.Random(seed)
    for v in bm.verts:
        k = 1.0 + rng.uniform(-wobble, wobble) if wobble else 1.0
        v.co = Vector((v.co.x * radii[0] * k, v.co.y * radii[1] * k, v.co.z * radii[2] * k))
        if flat_bottom is not None:
            v.co.z = max(v.co.z, -radii[2] * flat_bottom)
    return _link(name, bm, location, rot_z, color, rot, smooth)


def capsule(
    name: str,
    radius: float,
    height: float,
    location: Vec3,
    color: str,
    segments: int = 8,
    rings: int = 5,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Capsule standing on `location`, `height` tall overall. `rings` is made odd so the straight
    middle band is clean. Arm rolls, bolsters, finials, bodies."""
    rings = rings if rings % 2 else rings + 1
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    stretch = max(0.0, height / 2.0 - radius)
    for v in bm.verts:
        v.co.z += (stretch if v.co.z > 0 else -stretch) + height / 2.0
    return _link(name, bm, location, rot_z, color, rot)


def capsule_figure(name: str, height: float, radius: float, location: Vec3, color: str) -> bpy.types.Object:
    """Placeholder person: a capsule standing on `location`."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=radius)
    stretch = height / 2.0 - radius
    for v in bm.verts:
        v.co.z += stretch if v.co.z > 0 else -stretch
        v.co.z += height / 2.0
    return _link(name, bm, location, 0.0, color)


def lathe(
    name: str,
    profile: Sequence[Vec2],
    location: Vec3,
    color: str,
    segments: int = 8,
    smooth: bool = False,
    caps: bool = True,
    rot_z: float = 0.0,
    rot: Rot | None = None,
) -> bpy.types.Object:
    """Surface of revolution standing on `location`. `profile` lists (radius, z) from bottom to top;
    a radius of 0 closes that end to a point, otherwise the ends get flat caps (unless `caps` is
    False). A profile that goes up the outside and back down the inside makes a thin shell (lamp
    shades, bowls). Bottles, vases, pots, turned legs, lamp bases, plates."""
    bm = bmesh.new()
    rings: list[list] = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            rings.append(
                [
                    bm.verts.new((r * math.cos(2 * math.pi * i / segments), r * math.sin(2 * math.pi * i / segments), z))
                    for i in range(segments)
                ]
            )
    for lo, hi in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            if len(lo) == 1 and len(hi) == 1:
                continue
            if len(lo) == 1:
                bm.faces.new((lo[0], hi[j], hi[i]))
            elif len(hi) == 1:
                bm.faces.new((lo[i], lo[j], hi[0]))
            else:
                bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    if caps and len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if caps and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    return _link(name, bm, location, rot_z, color, rot, smooth)


# ---------------------------------------------------------------------------------------------
# Painting and UVs


def paint_faces(obj: bpy.types.Object, fn: Callable[[bpy.types.MeshPolygon], str | None]) -> None:
    """Repaint single faces: `fn(polygon)` returns a palette color, or None to leave the face as it
    is. Polygons are in object space (polygon.normal, polygon.center)."""
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv = mesh.uv_layers[0].data
    for poly in mesh.polygons:
        color = fn(poly)
        if color is None:
            continue
        u, v = palette.swatch_uv(color)
        for li in poly.loop_indices:
            uv[li].uv = (u, v)
    if not mesh.materials:
        mesh.materials.append(palette.material())


def paint_facing(obj: bpy.types.Object, direction: Vec3, color: str, min_dot: float = 0.7) -> None:
    """Repaint every face whose normal points along `direction` (object space), e.g. (0, 0, 1) for
    the tops."""
    d = Vector(direction).normalized()
    paint_faces(obj, lambda p: color if p.normal.dot(d) >= min_dot else None)


def planar_uv(
    obj: bpy.types.Object,
    name: str = "board",
    u_axis: Vec3 = (-1.0, 0.0, 0.0),
    v_axis: Vec3 = (0.0, 0.0, 1.0),
) -> None:
    """Add a UV map `name` that runs 0..1 across the mesh along two object-space axes, for a
    CanvasTexture. The defaults read upright from the front of a +Y-facing panel (u to the
    viewer's right, v up). The palette UV map stays first and active."""
    mesh = obj.data
    first = mesh.uv_layers[0]
    layer = mesh.uv_layers.get(name) or mesh.uv_layers.new(name=name)
    ua, va = Vector(u_axis), Vector(v_axis)
    us = [v.co.dot(ua) for v in mesh.vertices]
    vs = [v.co.dot(va) for v in mesh.vertices]
    u0, du = min(us), (max(us) - min(us)) or 1.0
    v0, dv = min(vs), (max(vs) - min(vs)) or 1.0
    for loop in mesh.loops:
        i = loop.vertex_index
        layer.data[loop.index].uv = ((us[i] - u0) / du, (vs[i] - v0) / dv)
    mesh.uv_layers.active = first
    first.active_render = True


def stretch(obj: bpy.types.Object, factors: Vec3) -> bpy.types.Object:
    """Scale a prim's mesh (not its object) about its origin, e.g. a torus into an oval ring."""
    obj.data.transform(Matrix.Diagonal((factors[0], factors[1], factors[2], 1.0)))
    obj.data.update()
    return obj


def squircle(obj: bpy.types.Object, half_x: float, half_y: float, radius: float, power: float = 3.0) -> bpy.types.Object:
    """Reshape a round prim (lathe, cylinder, torus, all built `radius` wide around the object's Z
    axis) into a rounded rectangle half_x by half_y, keeping wall thicknesses: a ring `d` inside
    `radius` lands `d` inside the rectangle. `power` 2 is an ellipse, higher is boxier. Tubs,
    oval tables, basins."""
    for v in obj.data.vertices:
        rho = math.hypot(v.co.x, v.co.y)
        if rho < 1e-9:
            continue
        c, s = v.co.x / rho, v.co.y / rho
        inset = radius - rho
        v.co.x = (half_x - inset) * math.copysign(abs(c) ** (2.0 / power), c)
        v.co.y = (half_y - inset) * math.copysign(abs(s) ** (2.0 / power), s)
    obj.data.update()
    return obj


# ---------------------------------------------------------------------------------------------
# Assembling


def join(name: str, objs: Sequence[bpy.types.Object], origin: Vec3 = (0.0, 0.0, 0.0)) -> bpy.types.Object:
    """Merge prims into one mesh object `name` with its origin at `origin` (in the parts' space).
    Every face keeps its palette color; the source objects are removed."""
    bm = bmesh.new()
    to_local = Matrix.Translation(Vector(origin)).inverted()
    for o in objs:
        n0 = len(bm.verts)
        bm.from_mesh(o.data)
        bm.verts.ensure_lookup_table()
        new = [bm.verts[i] for i in range(n0, len(bm.verts))]
        bmesh.ops.transform(bm, matrix=to_local @ o.matrix_basis, verts=new)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for o in objs:
        data = o.data
        bpy.data.objects.remove(o)
        if data.users == 0:
            bpy.data.meshes.remove(data)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = origin
    bpy.context.scene.collection.objects.link(obj)
    if not mesh.materials:
        mesh.materials.append(palette.material())
    return obj


def place(objs: bpy.types.Object | Iterable[bpy.types.Object], location: Vec3, rot_z: float = 0.0) -> None:
    """Move objects built around the origin to `location`, turned by `rot_z` about Z. Each keeps
    its own transform relative to that frame (a part at local (1, 0, 0) ends up 1 m along the
    turned X axis, and its own rotation is composed with `rot_z`)."""
    m = Matrix.Translation(Vector(location)) @ Matrix.Rotation(rot_z, 4, "Z")
    for o in [objs] if isinstance(objs, bpy.types.Object) else objs:
        o.matrix_basis = m @ o.matrix_basis


def to_world(location: Vec3, rot_z: float, local: Vec3) -> Vec3:
    """World position of a point at `local` on something placed at `location` turned by `rot_z`."""
    c, s = math.cos(rot_z), math.sin(rot_z)
    return (location[0] + local[0] * c - local[1] * s, location[1] + local[0] * s + local[1] * c, location[2] + local[2])
