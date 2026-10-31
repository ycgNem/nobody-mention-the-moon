"""Low-poly building blocks. All sizes in meters, Blender Z-up. Every prim is painted from the palette."""

from __future__ import annotations

import math

import bmesh
import bpy

from . import palette

Vec3 = tuple[float, float, float]


def _link(name: str, bm: bmesh.types.BMesh, location: Vec3, rot_z: float, color: str) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.rotation_euler = (0.0, 0.0, rot_z)
    bpy.context.scene.collection.objects.link(obj)
    palette.paint(obj, color)
    return obj


def box(
    name: str,
    size: Vec3,
    location: Vec3,
    color: str,
    bevel: float = 0.0,
    rot_z: float = 0.0,
) -> bpy.types.Object:
    """Axis-aligned box centered on `location`. `bevel` chamfers every edge (chunky look)."""
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
    return _link(name, bm, location, rot_z, color)


def cylinder(
    name: str,
    radius: float,
    height: float,
    location: Vec3,
    color: str,
    segments: int = 8,
    radius_top: float | None = None,
) -> bpy.types.Object:
    """Upright (tapered) cylinder; `location` is the center of the base."""
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
    return _link(name, bm, location, 0.0, color)


def capsule_figure(name: str, height: float, radius: float, location: Vec3, color: str) -> bpy.types.Object:
    """Placeholder person: a capsule standing on `location`."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=radius)
    stretch = height / 2.0 - radius
    for v in bm.verts:
        v.co.z += stretch if v.co.z > 0 else -stretch
        v.co.z += height / 2.0
    return _link(name, bm, location, 0.0, color)


def deg(d: float) -> float:
    return math.radians(d)
