"""A folded tea towel: 0.3 x 0.2 x 0.02 m, red gingham, lying flat. The fold is the rounded -X
end; the open +X end shows the two layers.

Origin at the bottom center.
"""

from lib import prop_prims as pp

KIND = "prop"

L, W, H = 0.3, 0.2, 0.02
CELLS_X, CELLS_Y = 8, 6


def section() -> list[tuple[float, float]]:
    """The towel's cross-section in XZ, walked over the top (+X), down the open end, back along
    the bottom and up round the fold."""
    x0, x1 = -L / 2 + 0.012, L / 2 - 0.004
    top = [(x0 + (x1 - x0) * i / (CELLS_X - 1), H - (0.0012 if i in (0, CELLS_X - 1) else 0.0)) for i in range(CELLS_X)]
    open_end = [(L / 2, H * 0.62), (L / 2 - 0.005, H * 0.5), (L / 2, H * 0.38), (L / 2 - 0.003, 0.002)]
    bottom = [(-L / 2 + 0.01, 0.0)]
    fold = [(-L / 2 + 0.002, H * 0.22), (-L / 2, H * 0.55), (-L / 2 + 0.004, H * 0.86)]
    return top + open_end + bottom + fold


def gingham(i: int, j: int) -> str:
    a, b = i % 2, j % 2
    if a and b:
        return "cloth_red"
    if a or b:
        return "wallpaper_rose"
    return "cloth_white"


def build() -> None:
    sec = section()
    loop = sec + [sec[0]]
    grid = [[(x, -W / 2 + W * j / CELLS_Y, z) for j in range(CELLS_Y + 1)] for x, z in loop]
    towel = pp.sheet(grid, "cloth_white", smooth=False)
    # Gingham by cell: walk the faces in creation order (section segment i, row j).
    faces = list(towel.bm.faces)
    bottom_seg = CELLS_X - 1 + 4
    for n, f in enumerate(faces):
        i, j = divmod(n, CELLS_Y)
        color = "cloth_white" if i == bottom_seg else gingham(i, j)
        f[towel.layer] = pp.color_index(color)
    m = pp.Model()
    m.add(towel)
    # Ends of the extrusion (the long edges of the towel).
    m.add(pp.panel([(x, -W / 2, z) for x, z in reversed(sec)], "wallpaper_rose"))
    m.add(pp.panel([(x, W / 2, z) for x, z in sec], "wallpaper_rose"))
    m.build("tea_towel")
