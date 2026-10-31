"""Modelling helpers for characters and their kits: lofted rings, blobs, tubes and surface patches.

A `Part` collects the geometry of one exported mesh object. Every face carries a palette color
(painted per face with palette.swatch_uv, so the whole game still shares one material) and every
vertex carries bone weights, so one Part becomes one skinned mesh. Parts without a rig (the hat
kit) export as plain meshes.

Winding: a loft's rings run along a direction t and each ring goes around t counter-clockwise
(ring axes u, v with u x v = t). Faces built that way face outward, so callers never fix normals.
"""

from __future__ import annotations

import math
import random
from typing import Callable, Sequence

import bpy
from mathutils import Matrix, Vector

from . import palette, rig

Weights = dict[str, float]
WeightFn = Callable[[Vector], Weights]
ColorFn = Callable[[int, int], str]  # (band index, segment index) -> palette color
Color = str | ColorFn

MAX_INFLUENCES = 4

# --- Weights --------------------------------------------------------------------------------


def smoothstep(e0: float, e1: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def rigid(bone: str) -> WeightFn:
    return lambda co: {bone: 1.0}


def _dist_to_segment(p: Vector, a: Vector, b: Vector) -> float:
    ab = b - a
    t = min(1.0, max(0.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def nearest(bones: Sequence[str], power: float = 6.0) -> WeightFn:
    """Blend between the rest-pose bone segments closest to each vertex. Mostly rigid away from
    joints, a soft blend where two segments meet (elbows, knees, the spine)."""

    def fn(co: Vector) -> Weights:
        return {b: 1.0 / max(_dist_to_segment(co, *rig.SEGMENTS[b]), 1e-4) ** power for b in bones}

    return fn


def along_z(stops: Sequence[tuple[float, str]]) -> WeightFn:
    """Blend between bones by height: [(z, bone), ...] ascending; smooth between neighbours."""

    def fn(co: Vector) -> Weights:
        if co.z <= stops[0][0]:
            return {stops[0][1]: 1.0}
        for (z0, b0), (z1, b1) in zip(stops, stops[1:]):
            if co.z <= z1:
                t = smoothstep(z0, z1, co.z)
                return {b0: 1.0 - t, b1: t} if b0 != b1 else {b0: 1.0}
        return {stops[-1][1]: 1.0}

    return fn


def mix(a: WeightFn, b: WeightFn, t: Callable[[Vector], float]) -> WeightFn:
    """(1 - t) * a + t * b, with t chosen per vertex."""

    def fn(co: Vector) -> Weights:
        k = t(co)
        out: Weights = {}
        for bone, w in a(co).items():
            out[bone] = out.get(bone, 0.0) + w * (1.0 - k)
        for bone, w in b(co).items():
            out[bone] = out.get(bone, 0.0) + w * k
        return out

    return fn


def by_side(fn: Callable[[str], WeightFn], width: float = 0.1) -> WeightFn:
    """Blend a per-side weight function across the center line (x = 0)."""
    return mix(fn("l"), fn("r"), lambda co: smoothstep(-width, width, co.x))


def normalized(w: Weights) -> Weights:
    items = sorted(((v, k) for k, v in w.items() if v > 1e-6), reverse=True)[:MAX_INFLUENCES]
    items = [(v, k) for v, k in items if v >= 0.02 * items[0][0]]
    total = sum(v for v, _ in items)
    return {k: v / total for v, k in items}


# --- Geometry collector ---------------------------------------------------------------------


class Part:
    def __init__(self, name: str) -> None:
        self.name = name
        self.co: list[Vector] = []
        self.weights: list[Weights] = []
        self.faces: list[tuple[int, ...]] = []
        self.colors: list[str] = []
        self.smooth: list[bool] = []

    @property
    def tris(self) -> int:
        return sum(len(f) - 2 for f in self.faces)

    def vert(self, co: Vector, weight: WeightFn | None) -> int:
        v = Vector(co)
        self.co.append(v)
        self.weights.append(normalized(weight(v)) if weight else {})
        return len(self.co) - 1

    def face(self, idx: Sequence[int], color: str, smooth: bool = True, flip: bool = False) -> None:
        palette.swatch_uv(color)  # fail early on a typo
        f = tuple(reversed(idx)) if flip else tuple(idx)
        self.faces.append(f)
        self.colors.append(color)
        self.smooth.append(smooth)

    def face_toward(self, idx: Sequence[int], color: str, outward: Vector, smooth: bool = False) -> None:
        """A face wound so its normal points along `outward` (for edge strips of sheets)."""
        pts = [self.co[i] for i in idx]
        n = Vector((0.0, 0.0, 0.0))
        for a, b in zip(pts, pts[1:] + pts[:1]):
            n += a.cross(b)
        self.face(idx, color, smooth, flip=n.dot(outward) < 0.0)

    def loft(
        self,
        rings: Sequence[Sequence[Vector]],
        color: Color,
        weight: WeightFn | None,
        cap_start: bool = False,
        cap_end: bool = False,
        smooth: bool = True,
        flip: bool = False,
        cap_color: str | None = None,
    ) -> list[list[int]]:
        """Join rings (each the same length, or a single point for a pole at either end)."""
        ids = [[self.vert(p, weight) for p in ring] for ring in rings]
        pick = color if callable(color) else (lambda band, seg: color)
        for band, (a, b) in enumerate(zip(ids, ids[1:])):
            n = max(len(a), len(b))
            for k in range(n):
                k1 = (k + 1) % n
                if len(a) == 1:
                    quad = (a[0], b[k1], b[k])
                elif len(b) == 1:
                    quad = (a[k], a[k1], b[0])
                else:
                    quad = (a[k], a[k1], b[k1], b[k])
                self.face(quad, pick(band, k), smooth, flip)
        cc = cap_color or (color if isinstance(color, str) else pick(0, 0))
        if cap_start and len(ids[0]) > 2:
            self.face(list(reversed(ids[0])), cc, False, flip)
        if cap_end and len(ids[-1]) > 2:
            self.face(ids[-1], cc, False, flip)
        return ids

    def grid(self, rows: Sequence[Sequence[Vector]], color: Color, weight: WeightFn | None, smooth: bool = True, flip: bool = False) -> list[list[int]]:
        """An open sheet: rows of points (each row left to right as seen from the front side,
        rows ordered top to bottom) so faces point toward the viewer."""
        ids = [[self.vert(p, weight) for p in row] for row in rows]
        pick = color if callable(color) else (lambda band, seg: color)
        for r, (a, b) in enumerate(zip(ids, ids[1:])):
            for c in range(len(a) - 1):
                self.face((a[c], a[c + 1], b[c + 1], b[c]), pick(r, c), smooth, flip)
        return ids


# --- Shapes ---------------------------------------------------------------------------------


def ring(center: Vector, u: Vector, v: Vector, ru: float, rv: float, n: int, phase: float = 0.0, shape: Callable[[float], float] | None = None) -> list[Vector]:
    """n points c + ru cos(a) u + rv sin(a) v. `shape(a)` scales the radius per angle."""
    pts = []
    for k in range(n):
        a = phase + 2.0 * math.pi * k / n
        s = shape(a) if shape else 1.0
        pts.append(center + u * (ru * s * math.cos(a)) + v * (rv * s * math.sin(a)))
    return pts


def hring(z: float, rx: float, ry: float, n: int, cx: float = 0.0, cy: float = 0.0, shape: Callable[[float], float] | None = None) -> list[Vector]:
    """Horizontal ring for a top-to-bottom loft. Angle 0 is the front (+Y), then toward +X."""
    return ring(Vector((cx, cy, z)), Vector((0, 1, 0)), Vector((1, 0, 0)), ry, rx, n, shape=shape)


def frame_for(t: Vector, up_hint: Vector) -> tuple[Vector, Vector]:
    """Ring axes (u, v) around direction t with u x v = t, u as close to up_hint as possible."""
    t = t.normalized()
    u = up_hint - t * up_hint.dot(t)
    if u.length < 1e-6:
        u = t.orthogonal()
    u.normalize()
    return u, t.cross(u)


def axes(z_axis: Vector, x_hint: Vector) -> Matrix:
    """Right-handed 3x3 rotation with local Z along z_axis and local X as close to x_hint as possible."""
    z = Vector(z_axis).normalized()
    x = Vector(x_hint) - z * Vector(x_hint).dot(z)
    if x.length < 1e-6:
        x = z.orthogonal()
    x.normalize()
    return Matrix((x, z.cross(x), z)).transposed()


def loop_tube(part: Part, path: Sequence[Vector], radii: tuple[float, float], color: str, weight: WeightFn | None, segs: int = 4, up: Vector = Vector((0, 0, 1))) -> None:
    """A closed ring of tube (rims, necklaces, a scarf). radii = (along `up`, across)."""
    n = len(path)
    rings = []
    for i in range(n):
        t = Vector(path[(i + 1) % n]) - Vector(path[i - 1])
        u, v = frame_for(t, up)
        rings.append(ring(Vector(path[i]), u, v, radii[0], radii[1], segs))
    ids = [[part.vert(pt, weight) for pt in r] for r in rings]
    for i in range(n):
        a, b = ids[i], ids[(i + 1) % n]
        for k in range(segs):
            k1 = (k + 1) % segs
            part.face((a[k], a[k1], b[k1], b[k]), color)


def tube(
    part: Part,
    path: Sequence[Vector],
    radii: Sequence[float | tuple[float, float]],
    color: Color,
    weight: WeightFn | None,
    segs: int = 8,
    up: Vector = Vector((0, 1, 0)),
    start: str = "flat",
    end: str = "flat",
    smooth: bool = True,
    cap_color: str | None = None,
    dome_steps: Sequence[float] = (35.0, 68.0),
) -> list[list[int]]:
    """A tube along `path` with a ring per point. start/end: 'flat', 'pole' (pointed), 'dome'
    (rounded half-ellipsoid centered on the end point), or 'open'."""
    path = [Vector(p) for p in path]
    rings: list[list[Vector]] = []
    frames = []
    for i, p in enumerate(path):
        if i == 0:
            t = path[1] - p
        elif i == len(path) - 1:
            t = p - path[i - 1]
        else:
            t = (path[i + 1] - p).normalized() + (p - path[i - 1]).normalized()
        u, v = frame_for(t, up)
        frames.append((t.normalized(), u, v))
        r = radii[i]
        ru, rv = (r, r) if isinstance(r, (int, float)) else r
        rings.append(ring(p, u, v, ru, rv, segs))

    def cap(at_start: bool) -> list[list[Vector]]:
        i = 0 if at_start else -1
        t, u, v = frames[i]
        r = radii[i]
        ru, rv = (r, r) if isinstance(r, (int, float)) else r
        sign = -1.0 if at_start else 1.0
        depth = (ru + rv) * 0.5
        extra = []
        for ang in dome_steps:
            a = math.radians(ang)
            c = path[i] + t * (sign * depth * math.sin(a))
            extra.append(ring(c, u, v, ru * math.cos(a), rv * math.cos(a), segs))
        extra.append([path[i] + t * (sign * depth)])
        return extra

    if start == "dome":
        rings = list(reversed(cap(True))) + rings
    elif start == "pole":
        rings = [[path[0] - frames[0][0] * 0.001]] + rings
    if end == "dome":
        rings = rings + cap(False)
    elif end == "pole":
        rings = rings + [[path[-1] + frames[-1][0] * 0.001]]
    return part.loft(rings, color, weight, cap_start=start == "flat", cap_end=end == "flat", smooth=smooth, cap_color=cap_color)


def blob(
    part: Part,
    center: Vector,
    radii: tuple[float, float, float],
    color: Color,
    weight: WeightFn | None,
    segs: int = 10,
    rings: int = 6,
    rot: Matrix | None = None,
    squareness: float = 1.0,
    flat_bottom: float | None = None,
    smooth: bool = True,
) -> list[list[int]]:
    """Ellipsoid (local Z is the pole axis). squareness < 1 makes it boxier (superellipsoid).
    flat_bottom clamps world z at that height (shoe soles)."""
    m = rot if rot is not None else Matrix.Identity(3)
    c = Vector(center)
    rx, ry, rz = radii

    def sp(x: float, e: float) -> float:
        return math.copysign(abs(x) ** e, x)

    out: list[list[Vector]] = [[c + m @ Vector((0, 0, rz))]]
    for j in range(1, rings):
        th = math.pi * j / rings
        z = sp(math.cos(th), squareness) * rz
        s = sp(math.sin(th), squareness)
        pts = []
        for k in range(segs):
            ph = 2.0 * math.pi * k / segs
            local = Vector((rx * s * sp(math.sin(ph), squareness), ry * s * sp(math.cos(ph), squareness), z))
            pts.append(c + m @ local)
        out.append(pts)
    out.append([c + m @ Vector((0, 0, -rz))])
    if flat_bottom is not None:
        for ring_pts in out:
            for p in ring_pts:
                p.z = max(p.z, flat_bottom)
    return part.loft(out, color, weight, smooth=smooth)


def cone(part: Part, base: Vector, tip: Vector, radius: float, color: str, weight: WeightFn | None, segs: int = 5, up: Vector = Vector((0, 0, 1)), squash: float = 1.0) -> None:
    """Open-based cone (its base is meant to be buried in something)."""
    t = tip - base
    u, v = frame_for(t, up)
    part.loft([ring(base, u, v, radius, radius * squash, segs), [tip]], color, weight)


# --- Surface helpers --------------------------------------------------------------------------


class Profile:
    """A body shell described as horizontal elliptical rings: (z, half width, half depth, center y).
    Rings are listed top to bottom."""

    def __init__(self, rings: Sequence[tuple[float, float, float, float]]) -> None:
        self.rings = list(rings)

    def at(self, z: float) -> tuple[float, float, float]:
        r = self.rings
        if z >= r[0][0]:
            return r[0][1:]
        for (z0, *a), (z1, *b) in zip(r, r[1:]):
            if z1 <= z <= z0:
                t = (z0 - z) / (z0 - z1)
                return tuple(x + (y - x) * t for x, y in zip(a, b))  # type: ignore[return-value]
        return r[-1][1:]

    def point(self, z: float, ang: float, grow: float = 0.0) -> Vector:
        """Point at height z, angle ang (radians, 0 = front, +pi/2 = right side), pushed out by grow."""
        rx, ry, cy = self.at(z)
        return Vector(((rx + grow) * math.sin(ang), cy + (ry + grow) * math.cos(ang), z))

    def front(self, x: float, z: float, grow: float = 0.0, back: bool = False) -> Vector:
        """Point on the front (or back) surface at a given x, pushed out by grow."""
        rx, ry, cy = self.at(z)
        rx, ry = rx + grow, ry + grow
        k = max(0.0, 1.0 - (x / rx) ** 2) if rx > 1e-6 else 0.0
        y = ry * math.sqrt(k)
        return Vector((x, cy - y if back else cy + y, z))

    def normal(self, z: float, ang: float) -> Vector:
        e = 1e-3
        p = self.point(z, ang)
        du = self.point(z, ang + e) - p
        dz = self.point(z - e, ang) - p
        return du.cross(dz).normalized()

    def loft(self, part: Part, segs: int, color: Color, weight: WeightFn | None, grow: float = 0.0, cap_start: bool = True, cap_end: bool = True) -> list[list[int]]:
        rings = []
        for z, rx, ry, cy in self.rings:
            if rx <= 0.0 or ry <= 0.0:
                rings.append([Vector((0.0, cy, z))])
            else:
                rings.append(hring(z, rx + grow, ry + grow, segs, cy=cy))
        return part.loft(rings, color, weight, cap_start=cap_start, cap_end=cap_end)


def slab(
    part: Part,
    front: Sequence[Sequence[Vector]],
    back: Sequence[Sequence[Vector]],
    color: Color,
    weight: WeightFn | None,
    back_color: Color | None = None,
    edge_color: str | None = None,
) -> None:
    """A sheet with thickness: a front grid, a matching back grid facing the other way, and edge
    strips joining their borders (aprons, capes, collars)."""
    f = part.grid(front, color, weight)
    b = part.grid(back, back_color or color, weight, flip=True)
    ec = edge_color or (color if isinstance(color, str) else color(0, 0))
    co = part.co
    rows, cols = len(f), len(f[0])
    for c in range(cols - 1):
        part.face_toward((f[0][c], f[0][c + 1], b[0][c + 1], b[0][c]), ec, co[f[0][c]] - co[f[1][c]])
        part.face_toward((f[-1][c], f[-1][c + 1], b[-1][c + 1], b[-1][c]), ec, co[f[-1][c]] - co[f[-2][c]])
    for r in range(rows - 1):
        part.face_toward((f[r][0], f[r + 1][0], b[r + 1][0], b[r][0]), ec, co[f[r][0]] - co[f[r][1]])
        part.face_toward((f[r][-1], f[r + 1][-1], b[r + 1][-1], b[r][-1]), ec, co[f[r][-1]] - co[f[r][-2]])


def patch(rows: Sequence[Sequence[tuple[float, float]]], surface: Callable[[float, float], Vector]) -> list[list[Vector]]:
    """Map rows of (x, z) through a surface function, for Part.grid."""
    return [[surface(x, z) for x, z in row] for row in rows]


def stud(part: Part, center: Vector, normal: Vector, radius: float, height: float, color: str, weight: WeightFn | None, segs: int = 6) -> None:
    """A small domed disc (button, pupil, rivet) sitting on a surface, base sunk slightly in."""
    n = normal.normalized()
    u, v = frame_for(n, Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((0, 1, 0)))
    base = ring(center - n * 0.003, u, v, radius, radius, segs)
    rim = ring(center + n * (height * 0.55), u, v, radius * 0.85, radius * 0.85, segs)
    part.loft([base, rim, [center + n * height]], color, weight)


def seeded(name: str) -> random.Random:
    """Deterministic randomness per asset part (builds must be reproducible)."""
    return random.Random(sum(ord(c) * (i + 1) for i, c in enumerate(name)))


# --- Output ---------------------------------------------------------------------------------


def finish(part: Part, armature: bpy.types.Object | None = None) -> bpy.types.Object:
    """Create the mesh object: per-face palette UVs, smooth flags and (with a rig) vertex groups
    plus an Armature modifier, parented to the rig with an identity transform."""
    mesh = bpy.data.meshes.new(part.name)
    mesh.from_pydata([tuple(v) for v in part.co], [], [list(f) for f in part.faces])
    if len(mesh.polygons) != len(part.faces):
        raise RuntimeError(f"{part.name}: mesh lost faces ({len(mesh.polygons)} of {len(part.faces)})")
    uv = mesh.uv_layers.new(name="UVMap")
    uvs: list[float] = [0.0] * (len(mesh.loops) * 2)
    smooth: list[bool] = []
    for poly, color, sm in zip(mesh.polygons, part.colors, part.smooth):
        u, v = palette.swatch_uv(color)
        for li in poly.loop_indices:
            uvs[li * 2] = u
            uvs[li * 2 + 1] = v
        smooth.append(sm)
    uv.data.foreach_set("uv", uvs)
    mesh.polygons.foreach_set("use_smooth", smooth)
    mesh.materials.append(palette.material())
    mesh.update()

    obj = bpy.data.objects.new(part.name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if armature is not None:
        obj.parent = armature
        groups: dict[str, bpy.types.VertexGroup] = {}
        for name in rig.BONE_NAMES:
            groups[name] = obj.vertex_groups.new(name=name)
        for i, w in enumerate(part.weights):
            if not w:
                raise RuntimeError(f"{part.name}: vertex {i} has no bone weights")
            for bone, value in w.items():
                groups[bone].add([i], value, "REPLACE")
        mod = obj.modifiers.new("rig", "ARMATURE")
        mod.object = armature
    return obj
