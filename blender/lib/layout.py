"""Reads the gameplay empties from the scene and writes <asset>.layout.json.

Blender is Z-up; the JSON uses glTF/Three.js space (Y-up): (x, y, z)_three = (x, z, -y)_blender.
The JSON shape is defined by shared/src/layout.ts and validated there.
"""

from __future__ import annotations

import json
import math

import bpy
from mathutils import Vector

PREFIX_COL_BOX = "col_box_"
PREFIX_SEAT = "seat_"
PREFIX_SPAWN = "spawn_"
PREFIX_ROOM = "room_"
PREFIX_DOOR = "door_"
PREFIX_INTERACT = "interact_"
PREFIX_SOCKET = "socket_"

EMPTY_PREFIXES = (PREFIX_COL_BOX, PREFIX_SEAT, PREFIX_SPAWN, PREFIX_ROOM, PREFIX_DOOR, PREFIX_INTERACT, PREFIX_SOCKET)


def _r(x: float) -> float:
    # Rounded so rebuilding unchanged scripts gives byte-identical JSON.
    v = round(x, 4)
    return 0.0 if v == 0 else v


def to_three(v) -> list[float]:
    return [_r(v[0]), _r(v[2]), _r(-v[1])]


def quat_to_three(q) -> list[float]:
    # Blender quaternion is (w, x, y, z); the rotation axis converts like a position.
    return [_r(q.x), _r(q.z), _r(-q.y), _r(q.w)]


def yaw_of(obj: bpy.types.Object) -> float:
    """Yaw about the up axis, 0 = facing Blender +Y (Three.js -Z)."""
    fwd = obj.matrix_world.to_3x3() @ Vector((0.0, 1.0, 0.0))
    return _r(math.atan2(-fwd.x, fwd.y))


def _strip(name: str, prefix: str) -> str:
    return name[len(prefix) :]


def extract(asset: str) -> dict:
    colliders, seats, spawns, rooms, doors, interactables = [], [], [], [], [], []
    for obj in sorted(bpy.context.scene.objects, key=lambda o: o.name):
        if obj.type != "EMPTY":
            continue
        name = obj.name
        loc, rot, scale = obj.matrix_world.decompose()
        if name.startswith(PREFIX_COL_BOX):
            colliders.append(
                {
                    "name": name,
                    "shape": "box",
                    "center": to_three(loc),
                    # Local axes convert the same way as world axes: (sx, sz, sy).
                    "halfExtents": [_r(abs(scale.x)), _r(abs(scale.z)), _r(abs(scale.y))],
                    "rotation": quat_to_three(rot),
                }
            )
        elif name.startswith(PREFIX_SEAT):
            seats.append({"id": _strip(name, PREFIX_SEAT), "position": to_three(loc), "yaw": yaw_of(obj)})
        elif name.startswith(PREFIX_SPAWN):
            spawns.append({"id": _strip(name, PREFIX_SPAWN), "position": to_three(loc), "yaw": yaw_of(obj)})
        elif name.startswith(PREFIX_ROOM):
            rooms.append(
                {
                    "id": _strip(name, PREFIX_ROOM),
                    "center": to_three(loc),
                    "halfExtents": [_r(abs(scale.x)), _r(abs(scale.z)), _r(abs(scale.y))],
                }
            )
        elif name.startswith(PREFIX_DOOR):
            doors.append({"id": _strip(name, PREFIX_DOOR), "a": obj["a"], "b": obj["b"], "position": to_three(loc)})
        elif name.startswith(PREFIX_INTERACT):
            interactables.append({"id": _strip(name, PREFIX_INTERACT), "kind": obj["kind"], "position": to_three(loc)})

    return {
        "version": 1,
        "asset": asset,
        "colliders": colliders,
        "seats": seats,
        "rooms": rooms,
        "doors": doors,
        "interactables": interactables,
        "spawns": spawns,
    }


def has_gameplay_data(data: dict) -> bool:
    return any(data[k] for k in ("colliders", "seats", "rooms", "doors", "interactables", "spawns"))


def write(data: dict, path: str) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
