"""Checks run on every asset before export. Any problem fails the build."""

from __future__ import annotations

import bpy

from . import palette
from .layout import EMPTY_PREFIXES, PREFIX_DOOR, PREFIX_INTERACT

TRI_BUDGETS = {"prop": 500, "character": 3000, "house": 60000}


def triangle_count(obj: bpy.types.Object) -> int:
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def check(kind: str) -> tuple[list[str], int]:
    """Returns (problems, total triangles)."""
    problems: list[str] = []
    tris = 0
    if kind not in TRI_BUDGETS:
        problems.append(f"unknown KIND '{kind}', expected one of {sorted(TRI_BUDGETS)}")

    for obj in bpy.context.scene.objects:
        name = obj.name
        if obj.type == "EMPTY":
            if not name.startswith(EMPTY_PREFIXES):
                problems.append(f"{name}: empties must use a prefix {EMPTY_PREFIXES}")
            if name.startswith(PREFIX_DOOR) and ("a" not in obj or "b" not in obj):
                problems.append(f"{name}: door needs custom props 'a' and 'b'")
            if name.startswith(PREFIX_INTERACT) and "kind" not in obj:
                problems.append(f"{name}: interactable needs custom prop 'kind'")
        elif obj.type == "MESH":
            if name.startswith(EMPTY_PREFIXES):
                problems.append(f"{name}: gameplay prefixes are for empties, not meshes")
            if tuple(round(s, 6) for s in obj.scale) != (1.0, 1.0, 1.0):
                problems.append(f"{name}: scale must be applied (is {tuple(obj.scale)})")
            mats = [m.name for m in obj.data.materials if m]
            if mats != [palette.MATERIAL_NAME]:
                problems.append(f"{name}: must use only the '{palette.MATERIAL_NAME}' material (has {mats})")
            tris += triangle_count(obj)
        else:
            problems.append(f"{name}: unsupported object type {obj.type}")

    budget = TRI_BUDGETS.get(kind)
    if budget is not None and tris > budget:
        problems.append(f"{tris} triangles is over the {kind} budget of {budget}")
    return problems, tris
