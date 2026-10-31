"""Furniture library for house scripts (not built on its own: build.py only builds blender/assets/).

Every module exposes

    make(prefix, location, rot_z=0.0, collide=True, **params) -> list[bpy.types.Object]

which builds meshes named f"{prefix}_<part>" (the static parts are joined into f"{prefix}_body";
parts the client moves or retextures are separate meshes) around `location`: the base center on
the floor, front facing Blender +Y before the piece is turned by `rot_z`. Wall-mounted pieces
(chalkboard, fuse_box, shelf, wall_mirror) put their back on the wall plane through `location`;
door_leaf and window sit centered in the wall's thickness. With `collide`, box colliders named
col_box_{prefix}_{n} cover the solid parts. It returns the meshes, then the collider empties.

No interactables, seats or doors here: house scripts add those.

    from lib.furniture import chair
    chair.make("chair_0", (0.6, -0.85, 0.0), rot_z=0.0)
"""

from __future__ import annotations

import importlib
from types import ModuleType

MODULES: tuple[str, ...] = (
    "chair",
    "dining_table",
    "sideboard",
    "armchair",
    "side_table",
    "floor_lamp",
    "coat_stand",
    "record_player",
    "potted_plant",
    "rug",
    "bookcase",
    "cupboard",
    "fridge",
    "counter",
    "stove",
    "sink",
    "kitchen_island",
    "chalkboard",
    "shelf",
    "wine_rack",
    "workbench",
    "dog_bed",
    "fuse_box",
    "toilet",
    "bath",
    "basin",
    "wall_mirror",
    "stairs",
    "door_leaf",
    "window",
    "van",
)


def get(name: str) -> ModuleType:
    """The furniture module called `name` (imported on first use)."""
    if name not in MODULES:
        raise KeyError(f"unknown furniture '{name}'. Known: {', '.join(MODULES)}")
    return importlib.import_module(f"{__name__}.{name}")
