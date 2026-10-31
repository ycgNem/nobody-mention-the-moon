"""Builds 3D assets from Python scripts. Run through `npm run art` (tools/art.ts), which calls:

    blender -b --factory-startup -P blender/build.py -- [asset ...]

With no asset names it builds everything under blender/assets/. Each asset script defines:

    KIND = "prop" | "character" | "house"
    def build() -> None: ...   # create objects in the empty scene
    BAKE = "ao"                 # optional: bake ambient occlusion (lib/bake.py)

Output per asset: client/public/models/<name>.glb, plus <name>.layout.json when the asset has
gameplay empties (colliders, seats, rooms, doors, interactables, spawns), plus <name>_ao.webp
when it bakes AO. tools/art.ts then meshopt-compresses the glb.
"""

from __future__ import annotations

import importlib.util
import sys
import traceback
from pathlib import Path

import bpy

BLENDER_DIR = Path(__file__).resolve().parent
ROOT = BLENDER_DIR.parent
ASSETS_DIR = BLENDER_DIR / "assets"
OUT_DIR = ROOT / "client" / "public" / "models"
PALETTE_TS = ROOT / "shared" / "src" / "content" / "palette.ts"

sys.path.insert(0, str(BLENDER_DIR))

from lib import bake, layout, palette, validate  # noqa: E402


def discover() -> dict[str, Path]:
    found: dict[str, Path] = {}
    for path in sorted(ASSETS_DIR.rglob("*.py")):
        if path.name.startswith("_"):
            continue
        if path.stem in found:
            raise SystemExit(f"duplicate asset name '{path.stem}': {found[path.stem]} and {path}")
        found[path.stem] = path
    return found


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(f"asset_{name}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def export_glb(path: Path) -> None:
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_animations=True,
        # Skinned clips: only export the bone channels a clip actually keys (rotations, plus the
        # hips location). Without this every bone also gets constant scale/translation tracks,
        # which would stomp the client's per-guest bone scaling. No effect on static assets.
        export_optimize_animation_keep_anim_armature=False,
    )


def build_one(name: str, path: Path) -> bool:
    reset_scene()
    module = load_module(name, path)
    kind = getattr(module, "KIND", None)
    module.build()

    problems, tris = validate.check(str(kind))
    if problems:
        print(f"✗ {name}: {len(problems)} problem(s)")
        for p in problems:
            print(f"    - {p}")
        return False

    baked = ""
    bake_kind = getattr(module, "BAKE", None)
    if bake_kind is not None:
        if bake_kind != "ao":
            print(f"✗ {name}: unknown BAKE '{bake_kind}', expected 'ao'")
            return False
        baked = ", " + bake.bake_ao(
            name,
            OUT_DIR,
            skip=tuple(getattr(module, "BAKE_SKIP", ())),
            occluders=tuple(getattr(module, "BAKE_OCCLUDERS", ())),
            density=dict(getattr(module, "BAKE_DENSITY", {})),
            size=int(getattr(module, "BAKE_SIZE", 2048)),
            samples=int(getattr(module, "BAKE_SAMPLES", 64)),
            distance=float(getattr(module, "BAKE_DISTANCE", 1.0)),
        )

    glb = OUT_DIR / f"{name}.glb"
    export_glb(glb)
    data = layout.extract(name)
    note = ""
    if layout.has_gameplay_data(data):
        layout.write(data, str(OUT_DIR / f"{name}.layout.json"))
        note = (
            f", layout: {len(data['colliders'])} colliders, {len(data['seats'])} seats, "
            f"{len(data['rooms'])} rooms, {len(data['spawns'])} spawns"
        )
    print(f"✓ {name} ({kind}): {tris} tris → {glb.relative_to(ROOT)}{note}{baked}")
    return True


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    assets = discover()
    wanted = argv or list(assets)
    unknown = [a for a in wanted if a not in assets]
    if unknown:
        print(f"unknown asset(s): {', '.join(unknown)}. Known: {', '.join(assets)}")
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PALETTE_TS.parent.mkdir(parents=True, exist_ok=True)
    palette.write_ts(str(PALETTE_TS))

    failed = 0
    for name in wanted:
        try:
            if not build_one(name, assets[name]):
                failed += 1
        except Exception:
            failed += 1
            print(f"✗ {name}: crashed")
            traceback.print_exc()
    print(f"\n{len(wanted) - failed}/{len(wanted)} asset(s) built.")
    return 1 if failed else 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    sys.exit(code)
