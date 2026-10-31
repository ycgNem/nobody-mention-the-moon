"""Ambient-occlusion bake for an asset that opts in with `BAKE = "ao"` (houses).

Why AO and not a full lightmap: the game switches lights at runtime (the light switch, power
cuts, the dining lamp), so light baked into a texture would be wrong whenever the state changes.
AO doesn't depend on any light. It only says how boxed in each spot is by nearby geometry
(corners, under furniture, where things meet the floor), so the client can multiply it into
whatever light is on at the moment.

What `bake_ao` does, after the asset is built and validated and before it is exported:
1. Every static mesh gets a second UV map "lightmap": smart-projected, then all meshes are packed
   together into one atlas. Its custom property `lightmap = 1` goes to glTF as node extras, so the
   client knows which meshes' TEXCOORD_1 is the lightmap.
2. Cycles (CPU, headless) bakes AO into one Non-Color image through the lightmap UVs.
3. The image is saved as <asset>_ao.webp next to the glb, and the scene gets the custom property
   `aoMap` = that file name (glTF scene extras; `gltf.scene.userData.aoMap` in Three.js).

Asset settings (all optional):
    BAKE_SKIP       name prefixes of meshes that move, toggle or glow. No lightmap, and hidden
                    while baking so they leave no shadow behind (door leaves, curtains, the moon).
    BAKE_OCCLUDERS  name prefixes of static meshes that cast AO but aren't baked themselves
                    (roofs: nobody sees their AO, and they'd eat atlas space).
    BAKE_DENSITY    {name prefix: factor} to give a mesh less (or more) texels per meter.
    BAKE_SIZE       atlas size in pixels (2048), BAKE_SAMPLES (64), BAKE_DISTANCE (AO reach, 1 m).
Meshes that already have a second UV map (drawable boards) are left out, but still occlude.
"""

from __future__ import annotations

import math
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np

from . import palette

LIGHTMAP_UV = "lightmap"
IMAGE_NAME = "ao_bake"
SMALL_FACE = 0.004  # m²: smaller faces get no lightmap island
CORNER_KEEP = 0.995  # packed islands stay below this u and v; the corner above is white
WHITE_UV = (0.9985, 0.9985)


def _starts(name: str, prefixes: tuple[str, ...]) -> bool:
    return bool(prefixes) and name.startswith(prefixes)


def _select_only(objs: list[bpy.types.Object]) -> None:
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def _edit_bmeshes() -> list[tuple[bpy.types.Object, bmesh.types.BMesh]]:
    return [(o, bmesh.from_edit_mesh(o.data)) for o in bpy.context.objects_in_mode]


def _unwrap(targets: list[bpy.types.Object], density: dict[str, float], margin: float) -> None:
    """Smart-project every target into its "lightmap" UV map, then pack them all into one atlas.
    Faces smaller than SMALL_FACE (knobs, bevels, jars) aren't unwrapped: thousands of tiny islands,
    each with its margin, would starve the walls and floors of texels. They all map to the white
    texel in the atlas corner instead (no AO, which nobody could see on them anyway)."""
    for o in targets:
        mesh = o.data
        layer = mesh.uv_layers.new(name=LIGHTMAP_UV)
        mesh.uv_layers.active = layer
    _select_only(targets)
    bpy.context.tool_settings.mesh_select_mode = (False, False, True)
    bpy.ops.object.mode_set(mode="EDIT")
    for o, bm in _edit_bmeshes():
        for f in bm.faces:
            f.select_set(f.calc_area() >= SMALL_FACE)
        bmesh.update_edit_mesh(o.data)
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)

    # Smart project keeps world scale across objects; shrink the ones that need fewer texels.
    for o, bm in _edit_bmeshes():
        uv = bm.loops.layers.uv[LIGHTMAP_UV]
        factor = next((f for prefix, f in density.items() if o.name.startswith(prefix)), 1.0)
        for f in bm.faces:
            for loop in f.loops:
                loop[uv].uv = (loop[uv].uv[0] * factor, loop[uv].uv[1] * factor) if f.select else WHITE_UV
        bmesh.update_edit_mesh(o.data)

    bpy.ops.uv.select_all(action="SELECT")  # the UVs of the selected (big) faces only
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method="FRACTION", margin=margin, shape_method="CONCAVE")
    # Keep the packed islands off the white corner.
    for o, bm in _edit_bmeshes():
        uv = bm.loops.layers.uv[LIGHTMAP_UV]
        for f in bm.faces:
            if f.select:
                for loop in f.loops:
                    loop[uv].uv = (loop[uv].uv[0] * CORNER_KEEP, loop[uv].uv[1] * CORNER_KEEP)
        bmesh.update_edit_mesh(o.data)
    bpy.ops.object.mode_set(mode="OBJECT")


def _paint_white_corner(img: bpy.types.Image) -> None:
    """The texel the small faces sample (WHITE_UV), and a few around it, set to no occlusion."""
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    n = max(4, int(w * (1.0 - CORNER_KEEP)) - 2)  # clear of the islands' bake margin
    px[h - n :, w - n :, :3] = 1.0
    img.pixels.foreach_set(px.ravel())


def bake_ao(
    asset: str,
    out_dir: Path,
    skip: tuple[str, ...] = (),
    occluders: tuple[str, ...] = (),
    density: dict[str, float] | None = None,
    size: int = 2048,
    samples: int = 64,
    distance: float = 1.0,
    margin_px: int = 2,
) -> str:
    """Bakes AO for the current scene. Returns a one-line summary for the build log."""
    t0 = time.time()
    scene = bpy.context.scene
    meshes = [o for o in scene.objects if o.type == "MESH"]
    hidden = [o for o in meshes if _starts(o.name, skip)]
    targets = [
        o
        for o in meshes
        if not _starts(o.name, skip) and not _starts(o.name, occluders) and len(o.data.uv_layers) == 1 and len(o.data.polygons)
    ]
    if not targets:
        return "AO: nothing to bake"

    # Islands sit 2 x margin_px apart, so the bake's edge padding never reaches a neighbor.
    _unwrap(targets, density or {}, margin=2.0 * margin_px / size)
    t_uv = time.time() - t0

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    world = scene.world or bpy.data.worlds.new("bake")
    scene.world = world
    world.light_settings.distance = distance

    img = bpy.data.images.new(IMAGE_NAME, size, size, alpha=False)
    img.colorspace_settings.name = "Non-Color"  # AO is data: Three.js reads aoMap as linear
    mat = palette.material()
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    mat.node_tree.nodes.active = node

    for o in hidden:
        o.hide_render = True
    _select_only(targets)
    bpy.ops.object.bake(type="AO", margin=margin_px, margin_type="EXTEND", use_clear=True, target="IMAGE_TEXTURES", uv_layer=LIGHTMAP_UV)
    for o in hidden:
        o.hide_render = False
    _paint_white_corner(img)
    t_bake = time.time() - t0 - t_uv

    file_name = f"{asset}_ao.webp"
    path = out_dir / file_name
    img.filepath_raw = str(path)
    img.file_format = "WEBP"
    img.save(quality=90)

    # Leave the scene as the exporter expects it: palette UVs first and active, no bake node.
    mat.node_tree.nodes.remove(node)
    bpy.data.images.remove(img)
    for o in targets:
        layers = o.data.uv_layers
        layers.active = layers[0]
        layers[0].active_render = True
        o["lightmap"] = 1
    for o in scene.objects:
        o.select_set(False)
    scene["aoMap"] = file_name

    kb = path.stat().st_size / 1024
    return f"AO: {len(targets)} meshes, {size}px, {samples} samples, UVs {t_uv:.1f}s + bake {t_bake:.1f}s → {file_name} ({kb:.0f} KB)"
