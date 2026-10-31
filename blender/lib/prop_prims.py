"""Building blocks for small hand-held props and food. Blender Z-up, meters, angles in degrees.

A prop is one mesh made of many colored parts. Each part is shaped in its own bmesh, where
every face remembers its palette color, then `Model.build` merges the parts into one object
and points every face at its swatch (palette.swatch_uv). So a multi-colored prop still uses
the single shared palette material.

    m = Model()
    m.add(lathe([(0, 0), (0.1, 0), (0.1, 0.02), (0, 0.02)], "porcelain"))
    m.add(box((0.02, 0.02, 0.02), (0, 0, 0.03), "tomato", bevel=0.004))
    m.build("thing")

Shading: lathes, tubes and spheres are smooth-shaded, boxes and prisms flat. Edges sharper
than `sharp_deg` stay crisp either way.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from . import palette

Vec2 = tuple[float, float]
Vec3 = tuple[float, float, float]
FaceTest = Callable[[Vector, Vector], bool]  # (face center, face normal) -> bool

_LAYER = "pal"
_COLOR_INDEX = {name: i for i, name in enumerate(palette.PALETTE)}
_COLOR_NAME = list(palette.PALETTE)


def _index(color: str) -> int:
    if color not in _COLOR_INDEX:
        raise KeyError(f"unknown palette color '{color}'")
    return _COLOR_INDEX[color]


def color_index(color: str) -> int:
    """Value to store in a face's color layer (`part.layer`) for a palette color."""
    return _index(color)


def _bm() -> bmesh.types.BMesh:
    """A new bmesh that already has the color layer (adding a layer later invalidates faces)."""
    bm = bmesh.new()
    bm.faces.layers.int.new(_LAYER)
    return bm


def noise(x: float, y: float, z: float, seed: int = 0) -> float:
    """Deterministic hash noise in [-1, 1] for a point (no `random`, so builds are repeatable)."""
    s = math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453
    return (s - math.floor(s)) * 2.0 - 1.0


class Part:
    """Geometry in its own bmesh. Every face carries a palette color and a smooth flag."""

    def __init__(self, bm: bmesh.types.BMesh, color: str, smooth: bool = False) -> None:
        self.bm = bm
        self.layer = bm.faces.layers.int.get(_LAYER) or bm.faces.layers.int.new(_LAYER)
        idx = _index(color)
        for f in bm.faces:
            f[self.layer] = idx
            f.smooth = smooth
        bm.normal_update()

    # Color ---------------------------------------------------------------
    def paint(self, color: str, where: FaceTest | None = None) -> Part:
        """Repaint faces (all, or those where `where(center, normal)` is true)."""
        idx = _index(color)
        for f in self.bm.faces:
            if where is None or where(f.calc_center_median(), f.normal):
                f[self.layer] = idx
        return self

    def paint_by(self, fn: Callable[[Vector, Vector], str | None]) -> Part:
        """Per-face color from `fn(center, normal)`; None keeps the current color."""
        for f in self.bm.faces:
            c = fn(f.calc_center_median(), f.normal)
            if c is not None:
                f[self.layer] = _index(c)
        return self

    # Shape ---------------------------------------------------------------
    def move(self, loc: Vec3 = (0.0, 0.0, 0.0), rot: Vec3 = (0.0, 0.0, 0.0), scale: Vec3 | float = 1.0) -> Part:
        """Scale, then rotate (XYZ Euler, degrees), then translate, about the part's own origin."""
        s = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
        mat = (
            Matrix.Translation(loc)
            @ Euler(tuple(math.radians(a) for a in rot), "XYZ").to_matrix().to_4x4()
            @ Matrix.Diagonal((*s, 1.0))
        )
        bmesh.ops.transform(self.bm, matrix=mat, verts=list(self.bm.verts))
        if s[0] * s[1] * s[2] < 0:
            bmesh.ops.reverse_faces(self.bm, faces=list(self.bm.faces))
        self.bm.normal_update()
        return self

    def warp(self, fn: Callable[[Vector], Vec3 | Vector]) -> Part:
        """Move every vertex: `fn(position) -> new position`."""
        for v in self.bm.verts:
            v.co = Vector(fn(v.co.copy()))
        self.bm.normal_update()
        return self

    def jitter(self, amount: float | Vec3, seed: int = 0) -> Part:
        """Lumpy, hand-made look: nudge each vertex by deterministic noise."""
        a = (amount, amount, amount) if isinstance(amount, (int, float)) else amount
        for v in self.bm.verts:
            x, y, z = (round(c, 5) for c in v.co)
            v.co.x += a[0] * noise(x, y, z, seed)
            v.co.y += a[1] * noise(y, z, x, seed + 1)
            v.co.z += a[2] * noise(z, x, y, seed + 2)
        self.bm.normal_update()
        return self


class Model:
    """Collects parts and builds them into one painted mesh object."""

    def __init__(self) -> None:
        self.parts: list[Part] = []

    def add(self, *parts: Part) -> Part:
        self.parts.extend(parts)
        return parts[-1]

    def build(self, name: str, origin: Vec3 = (0.0, 0.0, 0.0), sharp_deg: float = 48.0) -> bpy.types.Object:
        """Merge the parts into object `name`. Geometry stays where it was modelled; the object's
        origin (its pivot) goes to `origin`."""
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        o = Vector(origin)
        uvs = [palette.swatch_uv(c) for c in _COLOR_NAME]
        for part in self.parts:
            vmap = {v: bm.verts.new(v.co - o) for v in part.bm.verts}
            for f in part.bm.faces:
                try:
                    nf = bm.faces.new([vmap[v] for v in f.verts])
                except ValueError:
                    continue  # duplicate face
                nf.smooth = f.smooth
                u, w = uvs[f[part.layer]]
                for loop in nf.loops:
                    loop[uv].uv = (u, w)
            part.bm.free()
        self.parts = []

        bm.normal_update()
        ngons = [f for f in bm.faces if len(f.verts) > 4]
        if ngons:
            bmesh.ops.triangulate(bm, faces=ngons, quad_method="BEAUTY", ngon_method="BEAUTY")
        limit = math.radians(sharp_deg)
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > limit:
                e.smooth = False

        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(palette.material())
        obj = bpy.data.objects.new(name, mesh)
        obj.location = o
        bpy.context.scene.collection.objects.link(obj)
        return obj


def parent(child: bpy.types.Object, to: bpy.types.Object) -> bpy.types.Object:
    """Parent keeping the child's world position (parents here are never rotated or scaled)."""
    child.parent = to
    child.location = child.location - to.location
    return child


# Primitives ---------------------------------------------------------------


def box(size: Vec3, center: Vec3, color: str, bevel: float = 0.0, rot: Vec3 = (0.0, 0.0, 0.0)) -> Part:
    """Box centered on `center`. `bevel` chamfers every edge once (the chunky look)."""
    bm = _bm()
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
    return Part(bm, color).move(center, rot)


def lathe(
    profile: Sequence[Vec2],
    color: str,
    seg: int = 12,
    colors: Sequence[str | None] | None = None,
    smooth: bool = True,
    phase: float = 0.0,
) -> Part:
    """Spin a (radius, z) profile around Z. A point with radius 0 becomes a pole, or a flat cap
    when its neighbour has the same z. `colors[i]` paints the band between points i and i+1.
    Walk the profile with the visible side on your right (outside: bottom to top)."""
    bm = _bm()
    rings: list[list[bmesh.types.BMVert]] = []
    for r, z in profile:
        if r <= 1e-9:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            ring = []
            for k in range(seg):
                a = 2.0 * math.pi * k / seg + math.radians(phase)
                ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
            rings.append(ring)

    band_faces: list[list[bmesh.types.BMFace]] = []
    n = len(profile)
    for i in range(n - 1):
        a, b = rings[i], rings[i + 1]
        faces = []
        flat_start = i == 0 and len(a) == 1 and abs(profile[0][1] - profile[1][1]) < 1e-9
        flat_end = i == n - 2 and len(b) == 1 and abs(profile[-1][1] - profile[-2][1]) < 1e-9
        if len(a) == 1 and len(b) == 1:
            pass
        elif flat_start:
            faces.append(bm.faces.new(list(reversed(b))))
        elif flat_end:
            faces.append(bm.faces.new(a))
        else:
            for k in range(seg):
                k1 = (k + 1) % seg
                quad = [a[k % len(a)], a[k1 % len(a)], b[k1 % len(b)], b[k % len(b)]]
                verts = [v for j, v in enumerate(quad) if v not in quad[:j]]
                faces.append(bm.faces.new(verts))
        band_faces.append(faces)

    part = Part(bm, color, smooth)
    if colors:
        for faces, c in zip(band_faces, colors):
            if c:
                idx = _index(c)
                for f in faces:
                    f[part.layer] = idx
    return part


def cylinder(
    r: float,
    h: float,
    color: str,
    seg: int = 8,
    base: Vec3 = (0.0, 0.0, 0.0),
    r_top: float | None = None,
    bevel: float = 0.0,
    top: str | None = None,
) -> Part:
    """Upright (tapered) cylinder standing on `base`, optionally with chamfered rims and a
    differently colored top."""
    rt = r if r_top is None else r_top
    if rt <= 0.0:
        return lathe([(0.0, 0.0), (r, 0.0), (0.0, h)], color, seg).move(base)
    if bevel > 0.0:
        b = min(bevel, h * 0.45, r * 0.45, rt * 0.45)
        prof = [(0.0, 0.0), (r - b, 0.0), (r, b), (rt, h - b), (rt - b, h), (0.0, h)]
        cols = [None, None, None, top, top] if top else None
    else:
        prof = [(0.0, 0.0), (r, 0.0), (rt, h), (0.0, h)]
        cols = [None, None, top] if top else None
    return lathe(prof, color, seg, cols).move(base)


def sphere(
    r: float,
    color: str,
    seg: int = 8,
    rings: int = 5,
    center: Vec3 = (0.0, 0.0, 0.0),
    scale: Vec3 | float = 1.0,
) -> Part:
    """UV sphere (`rings` = number of bands from pole to pole)."""
    prof = [(r * math.sin(math.pi * i / rings), -r * math.cos(math.pi * i / rings)) for i in range(rings + 1)]
    prof[0] = (0.0, -r)
    prof[-1] = (0.0, r)
    return lathe(prof, color, seg).move(center, scale=scale)


def dome(r: float, h: float, color: str, seg: int = 8, rings: int = 3, base: Vec3 = (0.0, 0.0, 0.0)) -> Part:
    """Half-ellipsoid mound on a flat base (food heaps, scoops, caps)."""
    prof = [(0.0, 0.0)]
    for i in range(rings + 1):
        a = (math.pi / 2) * i / rings
        prof.append((r * math.cos(a), h * math.sin(a)))
    prof[-1] = (0.0, h)
    return lathe(prof, color, seg).move(base)


def _frames(pts: list[Vector], up: Vector) -> list[tuple[Vector, Vector]]:
    """(side, normal) per path point, carried along by parallel transport so tubes don't twist."""
    n = len(pts)
    tangents = []
    for i in range(n):
        t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        tangents.append(t.normalized())
    side = tangents[0].cross(up)
    if side.length < 1e-6:
        side = tangents[0].cross(Vector((1.0, 0.0, 0.0)))
    side.normalize()
    frames = []
    for i in range(n):
        if i > 0:
            side = tangents[i - 1].rotation_difference(tangents[i]) @ side
            side = (side - tangents[i] * side.dot(tangents[i])).normalized()
        frames.append((side.copy(), side.cross(tangents[i]).normalized()))
    return frames


def tube(
    path: Sequence[Vec3],
    radius: float | Sequence[float | Vec2],
    color: str,
    sides: int = 6,
    colors: Sequence[str | None] | None = None,
    up: Vec3 = (0.0, 0.0, 1.0),
    smooth: bool = True,
    caps: bool | tuple[bool, bool] = True,
    phase: float = 0.0,
) -> Part:
    """Sweep a (possibly elliptical) cross-section along a path. `radius` is one value or one per
    point; a pair (rx, ry) gives an ellipse whose ry axis leans toward `up`. A radius of 0 at an
    end makes a point. `colors[i]` paints the segment between points i and i+1. `caps` closes
    the ends: one flag for both, or (start, end) to leave a hidden end open."""
    pts = [Vector(p) for p in path]
    n = len(pts)
    radii = radius if isinstance(radius, (list, tuple)) else [radius] * n
    radii = [(r, r) if isinstance(r, (int, float)) else r for r in radii]
    frames = _frames(pts, Vector(up))

    bm = _bm()
    rings = []
    for p, (side, nrm), (rx, ry) in zip(pts, frames, radii):
        if rx <= 1e-9 and ry <= 1e-9:
            rings.append([bm.verts.new(p)])
            continue
        ring = []
        for k in range(sides):
            a = 2.0 * math.pi * k / sides + math.radians(phase)
            ring.append(bm.verts.new(p + side * (rx * math.cos(a)) + nrm * (ry * math.sin(a))))
        rings.append(ring)

    seg_faces = []
    for i in range(n - 1):
        a, b = rings[i], rings[i + 1]
        faces = []
        for k in range(sides):
            k1 = (k + 1) % sides
            quad = [a[k % len(a)], b[k % len(b)], b[k1 % len(b)], a[k1 % len(a)]]
            verts = [v for j, v in enumerate(quad) if v not in quad[:j]]
            if len(verts) >= 3:
                faces.append(bm.faces.new(verts))
        seg_faces.append(faces)
    end_faces = []
    cap_start, cap_end = (caps, caps) if isinstance(caps, bool) else caps
    if cap_start and len(rings[0]) > 1:
        end_faces.append(bm.faces.new(rings[0]))
    if cap_end and len(rings[-1]) > 1:
        end_faces.append(bm.faces.new(list(reversed(rings[-1]))))

    part = Part(bm, color, smooth)
    for f in end_faces:
        f.smooth = False
    if colors:
        for faces, c in zip(seg_faces, colors):
            if c:
                idx = _index(c)
                for f in faces:
                    f[part.layer] = idx
    return part


def _offset(outline: Sequence[Vec2], d: float) -> list[Vec2]:
    """Move a counter-clockwise polygon's edges inward by d (mitred corners, clamped)."""
    n = len(outline)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(outline[i - 1]), Vector(outline[i]), Vector(outline[(i + 1) % n])
        e1, e2 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n1, n2 = Vector((e1.y, -e1.x)), Vector((e2.y, -e2.x))  # outward normals for CCW
        m = n1 + n2
        denom = 1.0 + n1.dot(n2)
        m = m / max(denom, 0.35)
        q = p1 - m * d
        out.append((q.x, q.y))
    return out


def prism(
    outline: Sequence[Vec2],
    h: float,
    color: str,
    bevel: float = 0.0,
    bevel_bottom: float = 0.0,
    top: str | None = None,
    bottom: str | None = None,
    z0: float = 0.0,
) -> Part:
    """Extrude a counter-clockwise XY outline from z0 up by h. `bevel` chamfers the top rim
    inward (and `bevel_bottom` the bottom rim); `top` colors the top face and its chamfer."""
    bm = _bm()
    loops: list[tuple[list[Vec2], float]] = []
    if bevel_bottom > 0.0:
        loops.append((_offset(outline, bevel_bottom), z0))
        loops.append((list(outline), z0 + bevel_bottom))
    else:
        loops.append((list(outline), z0))
    if bevel > 0.0:
        loops.append((list(outline), z0 + h - bevel))
        loops.append((_offset(outline, bevel), z0 + h))
    else:
        loops.append((list(outline), z0 + h))
    rings = [[bm.verts.new((x, y, z)) for x, y in pts] for pts, z in loops]
    n = len(outline)
    walls = []
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(n):
            k1 = (k + 1) % n
            walls.append((i, bm.faces.new([a[k], a[k1], b[k1], b[k]])))
    f_bottom = bm.faces.new(list(reversed(rings[0])))
    f_top = bm.faces.new(rings[-1])
    part = Part(bm, color)
    if top:
        part_top = _index(top)
        f_top[part.layer] = part_top
        if bevel > 0.0:
            last = len(rings) - 2
            for i, f in walls:
                if i == last:
                    f[part.layer] = part_top
    if bottom:
        f_bottom[part.layer] = _index(bottom)
    return part


def panel(points: Sequence[Vec3], color: str) -> Part:
    """One flat polygon (decals: painting layers, labels, stripes). Wind it counter-clockwise
    as seen from the side it faces."""
    bm = _bm()
    bm.faces.new([bm.verts.new(p) for p in points])
    return Part(bm, color)


def sheet(grid: Sequence[Sequence[Vec3]], color: str, smooth: bool = True) -> Part:
    """A surface through a grid of points, grid[i][j]. The visible side is (d/di) x (d/dj):
    labels, leaves, petals, cloth."""
    bm = _bm()
    rows = [[bm.verts.new(p) for p in row] for row in grid]
    for i in range(len(rows) - 1):
        for j in range(len(rows[i]) - 1):
            bm.faces.new([rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]])
    return Part(bm, color, smooth)


def circle(r: float, n: int, center: Vec2 = (0.0, 0.0), phase: float = 0.0, ry: float | None = None) -> list[Vec2]:
    """Counter-clockwise points on a circle or ellipse (2D)."""
    ry = r if ry is None else ry
    return [
        (center[0] + r * math.cos(2 * math.pi * i / n + math.radians(phase)), center[1] + ry * math.sin(2 * math.pi * i / n + math.radians(phase)))
        for i in range(n)
    ]


def flame(h: float, r: float, base: Vec3 = (0.0, 0.0, 0.0), seg: int = 5) -> Part:
    """Teardrop candle flame standing on `base`."""
    prof = [(0.0, 0.0), (r, h * 0.3), (r * 0.6, h * 0.62), (0.0, h)]
    return lathe(prof, "flame", seg).move(base)
