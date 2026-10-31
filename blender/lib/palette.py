"""One shared palette texture for the whole game.

Every face is UV-mapped onto the center of a color swatch, so every asset shares one material.
Colors are sRGB hex. Order matters: a swatch's index decides where it sits in the texture,
so add new colors at the end.
"""

from __future__ import annotations

import bpy

PALETTE: dict[str, str] = {
    # Wood
    "wood_dark": "#4a2f22",
    "wood_mid": "#7d5136",
    "wood_light": "#b0835a",
    "wood_floor": "#6e4a32",
    # Fabric
    "cloth_red": "#9e2f2f",
    "cloth_cream": "#e8dcc0",
    "curtain_plum": "#5b2a4a",
    "cushion_green": "#46604a",
    # Walls
    "wall_green": "#4f6b58",
    "wall_cream": "#d9c9a3",
    "wall_trim": "#3a2b24",
    "plaster": "#c9b896",
    # Metal
    "metal_silver": "#c8c8cc",
    "metal_iron": "#4a4a50",
    "brass": "#c79a3c",
    "porcelain": "#f1ece0",
    # Light
    "candle": "#f2e6c8",
    "flame": "#ffb347",
    "glass": "#9fc6d6",
    "night_blue": "#1d2540",
    "moon": "#f5f0d0",
    # People (placeholders)
    "skin_host": "#e0b48f",
    "apron_teal": "#2f7f7a",
    "apron_mustard": "#c9a227",
    "apron_coral": "#d9665b",
    "apron_lilac": "#8f7cc2",
    "apron_sage": "#7fa36b",
    "apron_navy": "#2c3e66",
    # Debug
    "debug_magenta": "#ff00ff",
    # --- Added for M2+ (append only: a swatch's index decides its place in the texture) ---
    # Neutral bases the client tints per guest/host (skin tone, disguise color, apron, hair)
    "cloth_white": "#f4f1ea",
    "tint_white": "#ffffff",
    # Skin and hair
    "skin_pale": "#f0d2b8",
    "skin_tan": "#c99a6e",
    "skin_brown": "#8d5a3b",
    "skin_dark": "#5a3825",
    "skin_grey": "#9aa391",
    "hair_black": "#1e1a1a",
    "hair_brown": "#5a3a22",
    "hair_blonde": "#d9b25f",
    "hair_red": "#a3402a",
    "hair_grey": "#a8a8a8",
    "fur_brown": "#6b4a2e",
    "fur_grey": "#7a7470",
    # Faces
    "eye_dark": "#141414",
    "eye_white": "#f2efe6",
    "eye_red": "#d01010",
    "eye_yellow": "#e8c020",
    "lip": "#b45a5a",
    # Cloth
    "cloth_black": "#26222a",
    "cloth_blue": "#3d5a8a",
    "cloth_green": "#3f6b4a",
    "cloth_grey": "#6e6e72",
    "cloth_mustard": "#b8902a",
    "denim": "#3b4f6e",
    "leather": "#4a3020",
    "cape_red": "#7a1020",
    "ghost_white": "#e6f0f5",
    # Food
    "bread": "#d9a35a",
    "bread_crust": "#a8642a",
    "meat_raw": "#b0303a",
    "meat_cooked": "#6e3a22",
    "burnt": "#2a1a14",
    "lettuce": "#6fae3a",
    "tomato": "#d8412f",
    "leek": "#b8c47a",
    "soup_green": "#8fa04a",
    "wine": "#5a0f1f",
    "cake": "#e8c9a0",
    "icing": "#f7e9f0",
    "honey": "#e0a020",
    "olive": "#6b7a2a",
    "garlic": "#efe8d0",
    "yolk": "#f0b020",
    "rice": "#efe6cc",
    "mushroom": "#a08060",
    "cheese": "#f0d050",
    "shell": "#9a9488",
    # Kitchen
    "steel": "#9aa0a6",
    "steel_dark": "#5a5f66",
    "tile_white": "#e8e6e0",
    "tile_black": "#2a2a2e",
    "chalkboard": "#2b3a32",
    "chalk": "#e8e8e0",
    "fridge_cream": "#efe6cf",
    "ceramic_blue": "#4f7fae",
    "copper": "#b8693a",
    "hob_black": "#1c1c20",
    "hob_glow": "#ff4a1a",
    # House
    "brick": "#8a4a3a",
    "stone": "#7a776f",
    "stone_dark": "#4e4b46",
    "concrete": "#8e8b85",
    "grass": "#3e5a32",
    "asphalt": "#2e2e33",
    "roof": "#5a3030",
    "wallpaper_rose": "#b9858a",
    "wallpaper_blue": "#6f8aa6",
    "wall_kitchen": "#cfd8c0",
    "carpet_red": "#7a2a2a",
    "rug": "#8a5a3a",
    "plant_green": "#3f7a3a",
    "terracotta": "#b5653a",
    # Van
    "van_white": "#e8e8e8",
    "tire": "#1a1a1a",
    "glass_dark": "#2a3a48",
    "headlight": "#fff2b0",
    "taillight": "#c02020",
    # Dog
    "dog_tan": "#b58a5a",
    "dog_dark": "#3a2a20",
    # Misc
    "paper": "#f2ecd9",
    "gold": "#d4af37",
    "red_bright": "#e03030",
    "green_bright": "#40c040",
    "blue_bright": "#4080e0",
    "fire": "#ff6a1a",
    "smoke": "#808080",
    "snow": "#f8f8ff",
    "rose": "#c0405a",
    "black": "#111111",
    # --- Added for the M6 house art pass (append only) ---
    "wood_floor_dark": "#5a3a27",
    "wallpaper_rose_dark": "#a06e75",
    "wall_green_dark": "#3d5546",
    "brick_dark": "#6e3a2f",
    "hedge_dark": "#2b4529",
}

COLS = 8
ROWS = 16
SWATCH_PX = 8
IMAGE_NAME = "palette"
MATERIAL_NAME = "palette"

assert len(PALETTE) <= COLS * ROWS, "palette is full: grow ROWS"

_NAMES = list(PALETTE.keys())


def _hex_to_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)


def swatch_uv(color: str) -> tuple[float, float]:
    """UV of the center of a swatch. Row 0 is the top of the image."""
    if color not in PALETTE:
        raise KeyError(f"unknown palette color '{color}'")
    i = _NAMES.index(color)
    col, row = i % COLS, i // COLS
    return ((col + 0.5) / COLS, 1.0 - (row + 0.5) / ROWS)


def _make_image() -> bpy.types.Image:
    w, h = COLS * SWATCH_PX, ROWS * SWATCH_PX
    img = bpy.data.images.new(IMAGE_NAME, width=w, height=h, alpha=False)
    px = [0.0] * (w * h * 4)
    for i, name in enumerate(_NAMES):
        r, g, b = _hex_to_rgb(PALETTE[name])
        col, row = i % COLS, i // COLS
        y0 = (ROWS - 1 - row) * SWATCH_PX  # Blender images start at the bottom row
        for y in range(y0, y0 + SWATCH_PX):
            for x in range(col * SWATCH_PX, (col + 1) * SWATCH_PX):
                o = (y * w + x) * 4
                px[o : o + 4] = (r, g, b, 1.0)
    img.pixels.foreach_set(px)
    img.pack()
    return img


def material() -> bpy.types.Material:
    """The shared palette material, created once per build."""
    mat = bpy.data.materials.get(MATERIAL_NAME)
    if mat is not None:
        return mat
    img = bpy.data.images.get(IMAGE_NAME) or _make_image()
    mat = bpy.data.materials.new(MATERIAL_NAME)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"  # exports as NEAREST so swatches never bleed
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    return mat


def paint(obj: bpy.types.Object, color: str) -> None:
    """Assign the palette material and point every face at one swatch."""
    mesh = obj.data
    u, v = swatch_uv(color)
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv = mesh.uv_layers.active.data
    for loop in mesh.loops:
        uv[loop.index].uv = (u, v)
    mesh.materials.clear()
    mesh.materials.append(material())


def write_ts(path: str) -> None:
    """Mirror the palette into TypeScript so the client can use the same named colors."""
    lines = [
        "// GENERATED by blender/lib/palette.py. Edit the palette there, then run `npm run art`.",
        "",
        "export const PALETTE = {",
        *[f"  {name}: '{hexv}'," for name, hexv in PALETTE.items()],
        "} as const;",
        "",
        "export type PaletteColor = keyof typeof PALETTE;",
        "",
    ]
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
