"""Empties that carry gameplay data. Their name prefix says what they are (docs/TECH.md naming table).

Empties export to glTF as plain nodes (with custom props as extras) and are also read
by layout.py into <asset>.layout.json.
"""

from __future__ import annotations

import bpy

Vec3 = tuple[float, float, float]


def _empty(
    name: str,
    location: Vec3,
    display: str = "PLAIN_AXES",
    scale: Vec3 = (1.0, 1.0, 1.0),
    rot_z: float = 0.0,
    rot_x: float = 0.0,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = display
    obj.location = location
    obj.scale = scale
    obj.rotation_euler = (rot_x, 0.0, rot_z)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def collider_box(name: str, center: Vec3, size: Vec3, rot_z: float = 0.0, rot_x: float = 0.0) -> bpy.types.Object:
    """Box collider. The empty's scale holds the half extents. rot_x tilts it (ramps)."""
    half = (size[0] / 2.0, size[1] / 2.0, size[2] / 2.0)
    return _empty(f"col_box_{name}", center, "CUBE", half, rot_z, rot_x)


def seat(seat_id: str, location: Vec3, rot_z: float) -> bpy.types.Object:
    """A table seat. rot_z = 0 means the sitter faces +Y (Blender), which is -Z in Three.js."""
    return _empty(f"seat_{seat_id}", location, "SINGLE_ARROW", rot_z=rot_z)


def spawn(spawn_id: str, location: Vec3, rot_z: float = 0.0) -> bpy.types.Object:
    return _empty(f"spawn_{spawn_id}", location, "SINGLE_ARROW", rot_z=rot_z)


def room(room_id: str, center: Vec3, size: Vec3, part: str = "") -> bpy.types.Object:
    """Room volume. A room made of several boxes passes a distinct `part` for each."""
    half = (size[0] / 2.0, size[1] / 2.0, size[2] / 2.0)
    obj = _empty(f"room_{room_id}{'_' + part if part else ''}", center, "CUBE", half)
    obj["room_id"] = room_id
    return obj


def door(door_id: str, location: Vec3, a: str, b: str, leaf: bool = False, open: bool = True) -> bpy.types.Object:
    """Doorway between rooms a and b. `leaf` = has a door that opens and shuts (mesh and collider
    `doorleaf_<id>`); `open` = its state when a dinner starts."""
    obj = _empty(f"door_{door_id}", location, "SPHERE")
    obj["a"] = a
    obj["b"] = b
    obj["leaf"] = 1 if leaf else 0
    obj["open"] = 1 if open or not leaf else 0
    return obj


def interact(interact_id: str, location: Vec3, kind: str) -> bpy.types.Object:
    obj = _empty(f"interact_{interact_id}", location, "SPHERE")
    obj["kind"] = kind
    return obj


def socket(
    socket_id: str, location: Vec3, parent: bpy.types.Object | None = None, rot_z: float = 0.0
) -> bpy.types.Object:
    """Attach/anchor point. House sockets (no parent) are also exported to the layout."""
    obj = _empty(f"socket_{socket_id}", location, rot_z=rot_z)
    if parent is not None:
        obj.parent = parent
    return obj
