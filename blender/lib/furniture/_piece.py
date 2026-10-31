"""Shared helper for furniture modules: build a piece around the origin, then join and place it.

A piece is authored in local space: base center on the floor at the origin, front facing +Y
(wall-mounted pieces: back against the wall plane y = 0). `finish()` merges each group of parts
into one mesh, moves everything to `location`, turns it by `rot_z`, and adds the colliders.

    p = Piece(prefix, location, rot_z, collide)
    p.box((0.4, 0.4, 0.05), (0, 0, 0.4), "wood_dark", bevel=0.01)   # goes into {prefix}_body
    door = p.group("door", origin=(0.2, 0.3, 0.0))                     # {prefix}_door, origin at hinge
    door.box(...)                                                      # same local space as the body
    p.collider((0, 0, 0.45), (0.45, 0.45, 0.9))
    return p.finish()
"""

from __future__ import annotations

import bpy

from .. import prims, sockets

Vec3 = tuple[float, float, float]

# Prims a Group can add parts with (each takes the prim's arguments minus the name).
SHAPES = frozenset(
    {
        "box",
        "rounded_box",
        "tapered_box",
        "plank",
        "cushion",
        "hollow_box",
        "wedge",
        "panel",
        "prism",
        "strip",
        "cylinder",
        "cylinder_x",
        "cylinder_y",
        "cone",
        "torus",
        "blob",
        "capsule",
        "lathe",
    }
)


class Group:
    """Parts that become one mesh `{prefix}_{name}` with its origin at `origin` (local space).
    `rot_z` is the rest rotation about that origin (e.g. a door modeled closed that rests open)."""

    def __init__(self, piece: Piece, name: str, origin: Vec3, rot_z: float = 0.0) -> None:
        self.piece = piece
        self.name = name
        self.origin = origin
        self.rot_z = rot_z
        self.parts: list[bpy.types.Object] = []

    def add(self, obj: bpy.types.Object) -> bpy.types.Object:
        self.parts.append(obj)
        return obj

    def __getattr__(self, attr: str):
        if attr not in SHAPES:
            raise AttributeError(attr)
        fn = getattr(prims, attr)

        def make(*args, **kwargs) -> bpy.types.Object:
            return self.add(fn(self.piece.temp_name(), *args, **kwargs))

        return make

    def join(self) -> bpy.types.Object:
        obj = prims.join(f"{self.piece.prefix}_{self.name}", self.parts, self.origin)
        obj.rotation_euler = (0.0, 0.0, self.rot_z)
        return obj


class Piece:
    def __init__(self, prefix: str, location: Vec3, rot_z: float = 0.0, collide: bool = True) -> None:
        self.prefix = prefix
        self.location = (float(location[0]), float(location[1]), float(location[2]))
        self.rot_z = rot_z
        self.collide = collide
        self._n = 0
        self.groups: list[Group] = []
        self.kept: list[bpy.types.Object] = []
        self.colliders: list[tuple[Vec3, Vec3, Vec3]] = []
        self.body = self.group("body")

    def temp_name(self) -> str:
        self._n += 1
        return f"{self.prefix}__part{self._n}"

    def name(self, part: str) -> str:
        return f"{self.prefix}_{part}"

    def group(self, part: str, origin: Vec3 = (0.0, 0.0, 0.0), rot_z: float = 0.0) -> Group:
        g = Group(self, part, origin, rot_z)
        self.groups.append(g)
        return g

    def keep(self, obj: bpy.types.Object) -> bpy.types.Object:
        """A finished, separately named mesh (built in local space) to place with the piece."""
        self.kept.append(obj)
        return obj

    def collider(self, center: Vec3, size: Vec3, rot: Vec3 = (0.0, 0.0, 0.0)) -> None:
        """Box collider in local space; `rot` is an XYZ Euler applied before the piece's yaw."""
        self.colliders.append((center, size, rot))

    def __getattr__(self, attr: str):
        # p.box(...), p.cylinder(...): parts of the body.
        if attr in SHAPES:
            return getattr(self.body, attr)
        raise AttributeError(attr)

    def finish(self) -> list[bpy.types.Object]:
        """Join the groups, place everything, add colliders. Returns meshes, then collider empties."""
        meshes = [g.join() for g in self.groups if g.parts] + self.kept
        prims.place(meshes, self.location, self.rot_z)
        cols: list[bpy.types.Object] = []
        if self.collide:
            for i, (center, size, rot) in enumerate(self.colliders):
                col = sockets.collider_box(f"{self.prefix}_{i}", center, size)
                col.rotation_euler = rot
                cols.append(col)
            prims.place(cols, self.location, self.rot_z)
        return meshes + cols
