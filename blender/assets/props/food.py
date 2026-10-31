"""Food kit: every dish and ingredient the kitchen makes, as separate top-level meshes the client
clones by name and sets on a plate.

Each `food_*` mesh sits at the scene origin with its own origin at its bottom center, fits a
0.2 m footprint (the plate's well is about 0.17 m across) and stays near 200 triangles. Colors
are chunky and saturated so raw and cooked read at a glance across the table: raw is pale or
bright red, cooked is golden or brown with grill marks.

The birthday cake's candle flames are child meshes `flame_bc_0..3` (origin at the wick), which
the client makes glow.
"""

import math

from lib import prop_prims as pp

KIND = "kit"


def rnd(i: int, seed: int = 0) -> float:
    """Repeatable scatter value in [-1, 1]."""
    return pp.noise(i * 1.37 + 0.11, seed * 0.71 + 0.3, 0.5, seed)


def flatten_bottom(part: pp.Part, z: float = 0.0) -> pp.Part:
    return part.warp(lambda v: (v.x, v.y, max(v.z, z)))


def folded_leaf(ln: float, w: float, h: float, color: str) -> list[pp.Part]:
    """A leaf shard folded along its spine (the spine on the bottom, edges raised), along X."""
    a, b, c, d = (-ln, 0.0, 0.0), (ln, 0.0, 0.0), (0.0, -w, h), (0.0, w, h)
    return [pp.panel([a, b, d], color), pp.panel([a, c, b], color)]


def fleck(color: str, at: tuple[float, float, float], r: float = 0.004) -> pp.Part:
    """A tiny chunky crumb (herbs, garlic, pepper)."""
    return pp.sphere(r, color, seg=3, rings=2, center=at)


# Bread -------------------------------------------------------------------


def loaf() -> pp.Model:
    m = pp.Model()
    xs = (-0.09, -0.078, -0.035, 0.035, 0.078, 0.09)
    radii = [(0.022, 0.018), (0.036, 0.03), (0.042, 0.035), (0.042, 0.035), (0.036, 0.03), (0.022, 0.018)]
    body = pp.tube([(x, 0.0, 0.03) for x in xs], radii, "cake", sides=8, phase=22.5)
    m.add(flatten_bottom(body.jitter(0.002, 5)))
    # Scored cuts filled with garlic butter.
    for i, x in enumerate((-0.05, -0.017, 0.017, 0.05)):
        m.add(pp.box((0.009, 0.06, 0.01), (x, 0.0, 0.061), "garlic", rot=(0, 0, 28)))
    for i in range(6):
        x, y = -0.06 + i * 0.024, 0.016 * rnd(i, 1)
        m.add(fleck("plant_green" if i % 2 else "garlic", (x, y, 0.065), 0.0045))
    return m


def bread_slices() -> pp.Model:
    m = pp.Model()
    outline = [(x, max(y, -0.024)) for x, y in pp.circle(0.042, 10, ry=0.034, phase=-90)]
    for i in range(4):
        s = pp.prism(outline, 0.013, "bread_crust", top="bread", bottom="bread", z0=-0.0065)
        x = -0.048 + i * 0.032
        s.move((x, 0.0, 0.024 + 0.004 * i), rot=(0, 24, 8 * rnd(i, 2)))
        m.add(s)
    for i in range(4):
        x = -0.04 + i * 0.032
        m.add(fleck("plant_green", (x + 0.004, 0.012 * rnd(i, 3), 0.045 + 0.004 * i), 0.004))
    return m


# Steak -------------------------------------------------------------------


def steak_outline(scale: float = 1.0) -> list[tuple[float, float]]:
    pts = []
    n = 12
    for i in range(n):
        a = 2 * math.pi * i / n
        f = 1.0 + 0.1 * math.cos(2 * a + 0.6) + 0.06 * math.sin(3 * a)
        pts.append((0.074 * f * scale * math.cos(a), 0.05 * f * scale * math.sin(a)))
    return pts


def steak_raw() -> pp.Model:
    m = pp.Model()
    s = pp.prism(steak_outline(), 0.022, "meat_raw", bevel=0.006, bevel_bottom=0.003)
    s.paint("garlic", lambda c, n: n.y > 0.35 and c.y > 0.025 and n.z < 0.8)  # fat cap
    m.add(s)
    # Marbling.
    m.add(pp.panel([(-0.03, -0.012, 0.0226), (0.02, -0.02, 0.0226), (0.022, -0.014, 0.0226), (-0.028, -0.006, 0.0226)], "lip"))
    m.add(pp.panel([(-0.01, 0.01, 0.0226), (0.035, 0.004, 0.0226), (0.036, 0.009, 0.0226), (-0.008, 0.015, 0.0226)], "lip"))
    return m


def grill_marks(m: pp.Model, top: float, half: float, n: int, angle: float, spacing: float, length: float) -> None:
    for i in range(n):
        d = (i - (n - 1) / 2) * spacing
        ln = length * math.sqrt(max(0.2, 1 - (d / half) ** 2))
        a = math.radians(angle)
        cx, cy = -d * math.sin(a), d * math.cos(a)
        m.add(pp.box((ln, 0.0055, 0.003), (cx, cy, top), "burnt", rot=(0, 0, angle)))


def steak_cooked() -> pp.Model:
    m = pp.Model()
    s = pp.prism(steak_outline(0.93), 0.026, "meat_cooked", bevel=0.007, bevel_bottom=0.004)
    s.paint("bread_crust", lambda c, n: n.y > 0.35 and c.y > 0.022 and n.z < 0.8)  # crisp fat
    m.add(s)
    grill_marks(m, 0.026, 0.05, 4, 35, 0.021, 0.075)
    return m


def tartare() -> pp.Model:
    m = pp.Model()
    mound = pp.dome(0.056, 0.036, "meat_raw", seg=9, rings=3).jitter(0.004, 7)
    m.add(flatten_bottom(mound))
    m.add(pp.dome(0.018, 0.014, "yolk", seg=8, rings=2, base=(0.0, 0.0, 0.031)))
    for i in range(8):
        a = 2 * math.pi * (i + 0.3 * rnd(i, 4)) / 8
        r = 0.06 + 0.006 * rnd(i, 5)
        color = ("olive", "garlic", "plant_green", "garlic")[i % 4]
        m.add(fleck(color, (r * math.cos(a), r * math.sin(a), 0.004), 0.0055))
    return m


# Salad -------------------------------------------------------------------


def leaf_shell(r: float, a0: float, width: float, lo: float, hi: float, flare: float, color: str, seed: int, cols: int = 2, rows: int = 3) -> pp.Part:
    """A cupped leaf on a sphere of radius r: azimuth a0 +- width/2, polar angle lo..hi (degrees,
    0 = straight down), flaring outward at the top."""
    grid = []
    for i in range(cols + 1):
        a = math.radians(a0 - width / 2 + width * i / cols)
        col = []
        for j in range(rows + 1):
            t = j / rows
            p = math.radians(lo + (hi - lo) * t)
            rr = r * (1 + flare * t * t)
            col.append((rr * math.sin(p) * math.cos(a), rr * math.sin(p) * math.sin(a), r - rr * math.cos(p)))
        grid.append(col)
    return pp.sheet(grid, color).jitter(r * 0.06, seed)


def lettuce() -> pp.Model:
    """A whole round lettuce: a pale heart showing on top, cupped by darker outer leaves."""
    m = pp.Model()
    heart = pp.sphere(0.055, "lettuce", seg=8, rings=5, center=(0.0, 0.0, 0.05), scale=(1, 1, 0.92)).jitter(0.005, 8)
    heart.paint("leek", lambda c, n: n.z > 0.85)
    m.add(flatten_bottom(heart))
    for i in range(6):
        color = ("apron_sage", "plant_green", "lettuce")[i % 3]
        m.add(leaf_shell(0.062, i * 60 + 15 * (i % 2), 92, 25, 96, 0.22, color, 20 + i))
    for i in range(3):
        m.add(leaf_shell(0.05, i * 120 + 40, 80, 60, 108, 0.16, "lettuce", 30 + i).move((0.0, 0.0, 0.02)))
    return m


def salad() -> pp.Model:
    m = pp.Model()
    m.add(pp.dome(0.066, 0.03, "plant_green", seg=8, rings=2))
    leaf_colors = ("lettuce", "apron_sage", "lettuce", "plant_green")
    for i in range(14):
        a = 2 * math.pi * i / 14 + 0.4 * rnd(i, 9)
        r = 0.045 * abs(rnd(i, 10)) + 0.008
        z = 0.03 * (1 - (r / 0.07) ** 2) + 0.004
        x, y = r * math.cos(a), r * math.sin(a)
        ln, w = 0.022, 0.013
        for leaf in folded_leaf(ln, w, 0.007, leaf_colors[i % 4]):
            m.add(leaf.move((x, y, z), rot=(25 * rnd(i, 11), 20 * rnd(i, 12), math.degrees(a) + 60 * rnd(i, 13))))
    for i in range(4):
        a = 2 * math.pi * (i + 0.5) / 4 + 0.3
        r = 0.032 + 0.008 * (i % 2)
        z = 0.03 * (1 - (r / 0.07) ** 2)
        m.add(pp.dome(0.015, 0.013, "tomato", seg=6, rings=2, base=(r * math.cos(a), r * math.sin(a), z)))
    for i, (x, y) in enumerate(((0.0, 0.0), (-0.028, 0.03))):
        z = 0.03 * (1 - ((x * x + y * y) ** 0.5 / 0.07) ** 2) + 0.002
        m.add(pp.cylinder(0.014, 0.005, "lettuce", seg=6, base=(x, y, z), top="leek").move(rot=(0, 0, 0)))
    return m


# Leeks -------------------------------------------------------------------


def leek(m: pp.Model, y: float, yaw: float) -> None:
    """One raw leek along X: roots, white shank, pale then dark green leaves splitting at +X."""
    xs = (-0.09, -0.083, -0.01, 0.033, 0.055)
    r = 0.017
    parts = [
        pp.tube([(x, 0.0, r) for x in xs], [r * 0.85, r, r, r * 0.95, r * 0.92], "garlic", sides=6, colors=["plaster", None, "leek", "lettuce"]),
    ]
    for side in (-1, 1):
        parts.append(
            pp.tube(
                [(0.05, 0.0, r), (0.076, side * 0.012, r + 0.006), (0.097, side * 0.022, r + 0.004)],
                [(0.014, 0.005), (0.013, 0.004), (0.0, 0.0)],
                "plant_green",
                sides=4,
                caps=(False, True),
                up=(0.0, 0.0, 1.0),
            )
        )
    for k in range(3):
        parts.append(pp.tube([(-0.089, 0.0, r), (-0.099, 0.008 * (k - 1), r - 0.006 + 0.004 * k)], [0.004, 0.0], "plaster", sides=4, caps=False))
    for p in parts:
        m.add(p.move((0.0, y, 0.0), rot=(0, 0, yaw)))


def leeks() -> pp.Model:
    m = pp.Model()
    leek(m, -0.021, 4)
    leek(m, 0.021, -5)
    return m


def leeks_chopped() -> pp.Model:
    """A heap of thick leek rings: white ones from the shank, green ones from the top."""
    m = pp.Model()
    rings = [
        (-0.035, -0.024, 0.0, 0, 0, "white"),
        (0.016, -0.036, 0.0, 0, 10, "green"),
        (0.044, 0.01, 0.0, 0, 20, "white"),
        (-0.012, 0.034, 0.0, 0, 5, "green"),
        (-0.008, -0.004, 0.014, 16, 30, "white"),
        (0.024, 0.016, 0.012, -14, 120, "green"),
    ]
    for x, y, z, tilt, yaw, kind in rings:
        R, h = 0.026, 0.014
        cols = ["garlic", "garlic", "garlic", "leek"] if kind == "white" else ["leek", "lettuce", "leek", "apron_sage"]
        ring = pp.lathe([(0.0, 0.0), (R, 0.0), (R, h), (R * 0.5, h), (0.0, h)], cols[0], seg=6, colors=cols)
        m.add(ring.move((x, y, z), rot=(tilt, 0, yaw)))
    return m


def soup() -> pp.Model:
    m = pp.Model()
    profile = [(0.0, 0.003), (0.042, 0.003), (0.05, 0.0), (0.068, 0.022), (0.075, 0.055), (0.07, 0.058), (0.064, 0.046), (0.0, 0.046)]
    blue, white = "ceramic_blue", "porcelain"
    m.add(pp.lathe(profile, blue, seg=10, colors=[white, white, blue, blue, white, white, "soup_green"]))
    # Swirl of cream.
    grid = []
    for i in range(8):
        a = 1.2 + i * 0.55
        r = 0.012 + i * 0.0045
        w = 0.004 * (1 - i / 9)
        grid.append([((r - w) * math.cos(a), (r - w) * math.sin(a), 0.0465), ((r + w) * math.cos(a), (r + w) * math.sin(a), 0.0465)])
    m.add(pp.sheet(grid, "cloth_white", smooth=False))
    m.add(pp.box((0.012, 0.012, 0.01), (0.03, -0.018, 0.047), "bread", rot=(0, 0, 20)))  # croutons
    m.add(pp.box((0.012, 0.012, 0.01), (-0.026, -0.03, 0.047), "bread", rot=(0, 0, -15)))
    m.add(pp.panel([(-0.03, 0.022, 0.0468), (-0.018, 0.02, 0.0468), (-0.02, 0.032, 0.0468)], "plant_green"))
    return m


# Chicken -----------------------------------------------------------------


def chicken(cooked: bool) -> pp.Model:
    m = pp.Model()
    skin = "bread" if cooked else "skin_pale"
    legs = "bread_crust" if cooked else "skin_pale"
    plump = 1.0 if cooked else 0.88
    body = pp.sphere(1.0, skin, seg=8, rings=5, scale=(0.062, 0.078, 0.052 * plump)).jitter((0.003, 0.003, 0.002), 11)
    body.move((0.0, -0.008, 0.044 * plump))
    if cooked:
        body.paint("bread_crust", lambda c, n: n.z > 0.75 and abs(c.x) > 0.012)  # browned top
    m.add(flatten_bottom(body))
    for side in (-1, 1):
        m.add(
            pp.tube(
                [(side * 0.042, 0.02, 0.04 * plump), (side * 0.04, 0.06, 0.05 * plump), (side * 0.03, 0.088, 0.062 * plump)],
                [0.03, 0.022, 0.012],
                legs,
                sides=6,
                caps=(False, True),
            )
        )
        tip = "cloth_white" if cooked else "garlic"
        frill = 0.009 if cooked else 0.006
        m.add(pp.tube([(side * 0.03, 0.086, 0.062 * plump), (side * 0.026, 0.104, 0.07 * plump)], [frill, frill * 1.2], tip, sides=5, caps=(False, True)))
        m.add(
            pp.tube(
                [(side * 0.05, -0.04, 0.04 * plump), (side * 0.064, -0.06, 0.03 * plump), (side * 0.05, -0.078, 0.018)],
                [(0.016, 0.007), (0.014, 0.006), (0.0, 0.0)],
                legs,
                sides=4,
                caps=(False, True),
                up=(side * 1.0, 0.0, 1.0),
            )
        )
    if cooked:
        for i in range(3):
            m.add(fleck("plant_green", (0.02 * rnd(i, 14), -0.03 + 0.025 * i, 0.093), 0.0045))
    return m


# Cakes -------------------------------------------------------------------


def batter() -> pp.Model:
    """Striped mixing bowl of yellow batter with a wooden spoon."""
    m = pp.Model()
    out, band, inside = "cloth_cream", "ceramic_blue", "porcelain"
    profile = [(0.0, 0.0), (0.056, 0.0), (0.07, 0.02), (0.078, 0.036), (0.083, 0.056), (0.085, 0.074), (0.079, 0.077), (0.073, 0.058), (0.0, 0.058)]
    m.add(pp.lathe(profile, out, seg=10, colors=[out, out, band, out, band, inside, inside, "cheese"]))
    grid = []
    for i in range(8):
        a = i * 0.7
        r = 0.01 + i * 0.007
        grid.append([((r - 0.004) * math.cos(a), (r - 0.004) * math.sin(a), 0.0585), ((r + 0.004) * math.cos(a), (r + 0.004) * math.sin(a), 0.061)])
    m.add(pp.sheet(grid, "yolk", smooth=False))
    m.add(pp.tube([(-0.01, 0.01, 0.045), (0.05, -0.02, 0.1), (0.075, -0.034, 0.128)], [0.006, 0.005, 0.0055], "wood_light", sides=5))  # spoon
    return m


def honey_cake() -> pp.Model:
    """Layered honey cake: golden sponge and cream stripes, a honey glaze running down the sides."""
    m = pp.Model()
    R = 0.074
    profile = [(0.0, 0.0), (R, 0.0), (R, 0.022), (R, 0.03), (R, 0.052), (R + 0.003, 0.058), (R - 0.008, 0.066), (0.0, 0.066)]
    glaze = "honey"
    m.add(pp.lathe(profile, "bread", seg=10, colors=[None, None, "garlic", None, glaze, glaze, glaze]))
    for i in range(4):
        a = 2 * math.pi * (i + 0.3 * rnd(i, 15)) / 4 + 0.4
        ln = 0.012 + 0.014 * abs(rnd(i, 16))
        c, s = math.cos(a), math.sin(a)
        r = R + 0.0015
        m.add(pp.tube([(r * c, r * s, 0.056), (r * c, r * s, 0.054 - ln), (r * c, r * s, 0.047 - ln)], [0.0075, 0.0065, 0.0], "honey", sides=5, caps=False, up=(c, s, 0.0)))
    return m


BC_CANDLES = ("blue_bright", "apron_coral", "green_bright", "apron_mustard")
BC_TOP = 0.066
BC_CANDLE_H = 0.045


def birthday_cake() -> pp.Model:
    m = pp.Model()
    R = 0.072
    profile = [(0.0, 0.0), (R, 0.0), (R, 0.024), (R, 0.034), (R, BC_TOP - 0.006), (R - 0.004, BC_TOP), (0.0, BC_TOP)]
    m.add(pp.lathe(profile, "icing", seg=10, colors=[None, None, "rose", None, None, None]))
    for i in range(6):
        a = 2 * math.pi * i / 6 + 0.25
        m.add(pp.sphere(0.0075, "red_bright", seg=4, rings=2, center=(0.062 * math.cos(a), 0.062 * math.sin(a), BC_TOP + 0.002)))
    for i, (x, y, z) in enumerate(birthday_candle_tops()):
        m.add(pp.lathe([(0.0045, BC_TOP - 0.004), (0.0045, z), (0.0, z)], BC_CANDLES[i], seg=5).move((x, y, 0.0)))
    return m


def birthday_candle_tops() -> list[tuple[float, float, float]]:
    tops = []
    for i in range(4):
        a = math.radians(45 + 90 * i)
        tops.append((0.032 * math.cos(a), 0.032 * math.sin(a), BC_TOP + BC_CANDLE_H - 0.004 * (i % 2)))
    return tops


# Small plates ------------------------------------------------------------


def olives() -> pp.Model:
    """A little terracotta dish piled with green olives and a couple of dark ones."""
    m = pp.Model()
    profile = [(0.0, 0.0), (0.044, 0.0), (0.06, 0.024), (0.055, 0.026), (0.042, 0.008), (0.0, 0.008)]
    m.add(pp.lathe(profile, "terracotta", seg=8, colors=[None, None, None, "cloth_cream", "cloth_cream"]))
    spots = [(-0.018, -0.014, 0.019, 20), (0.016, -0.018, 0.019, 70), (0.023, 0.013, 0.019, 130), (-0.012, 0.022, 0.019, 200), (-0.027, 0.006, 0.02, 100), (0.002, 0.0, 0.033, 40)]
    for i, (x, y, z, yaw) in enumerate(spots):
        color = "curtain_plum" if i in (1, 4) else "olive"
        m.add(pp.sphere(1.0, color, seg=5, rings=3, scale=(0.016, 0.0115, 0.0115)).move((x, y, z), rot=(0, 0, yaw)))
    return m


def oysters() -> pp.Model:
    """Three oysters on the half shell around a lemon wedge."""
    m = pp.Model()
    for i in range(3):
        a = 90 + 120 * i
        shell = pp.lathe([(0.0, 0.0), (0.03, 0.004), (0.042, 0.017), (0.034, 0.016), (0.0, 0.01)], "stone", seg=7, colors=[None, None, "shell", "porcelain"])
        # Teardrop: narrow at the hinge (toward the middle), wide and frilly at the far end.
        shell.warp(lambda v: (v.x * (0.75 + 0.25 * (v.y / 0.042 + 1) / 2), v.y * 1.25, v.z))
        shell.jitter((0.004, 0.004, 0.003), 40 + i)
        meat = pp.dome(0.022, 0.01, "plaster", seg=6, rings=1, base=(0.0, 0.006, 0.01)).jitter(0.002, 50 + i)
        meat.paint("stone_dark", lambda c, n: n.z < 0.6)  # the dark frill of the mantle
        for p in (shell, meat):
            m.add(p.move((0.0, 0.052, 0.0)).move(rot=(0, 0, a)))
    lemon = pp.prism([(0.0, 0.0), (0.022, 0.0), (0.016, 0.016), (0.0, 0.022)], 0.02, "cheese", top="cheese")
    lemon.paint("yolk", lambda c, n: n.x > 0.3 and n.y > 0.3)
    m.add(lemon.move((-0.008, -0.008, 0.0), rot=(0, 0, 15)))
    return m


def chops(cooked: bool) -> pp.Model:
    m = pp.Model()
    meat = "meat_cooked" if cooked else "meat_raw"
    fat = "bread_crust" if cooked else "garlic"
    bone = "cake" if cooked else "porcelain"
    outline = [(0.03 * math.cos(a) * (1 + 0.15 * math.cos(a)), 0.026 * math.sin(a)) for a in (2 * math.pi * k / 8 for k in range(8))]
    for i, (x, y, yaw, z) in enumerate(((-0.03, -0.022, 200, 0.0), (0.028, -0.024, 330, 0.0), (0.0, 0.03, 85, 0.008))):
        parts = []
        chop = pp.prism(outline, 0.018, meat, bevel=0.004)
        chop.paint(fat, lambda c, n: c.x < -0.012 and n.z < 0.8)
        parts.append(chop)
        parts.append(pp.tube([(0.026, 0.0, 0.009), (0.072, 0.0, 0.016)], [0.0065, 0.0055], bone, sides=4, phase=45, caps=(False, True)))
        if cooked:
            for d in (-0.009, 0.009):
                parts.append(pp.panel([(-0.018 + d, -0.016, 0.0186), (-0.012 + d, -0.016, 0.0186), (0.016 + d, 0.016, 0.0186), (0.01 + d, 0.016, 0.0186)], "burnt"))
        for p in parts:
            m.add(p.move(rot=(0, -6 if z else 0, yaw)).move((x * 0.7, y * 0.7, z)))
    return m


def mushrooms() -> pp.Model:
    """Five raw button mushrooms, one lying on its side to show the pale gills."""
    m = pp.Model()
    spots = [(-0.046, -0.012, 0, 0), (-0.012, -0.04, 0, 0), (0.026, -0.032, 0, 0), (0.05, 0.004, 0, 0), (-0.006, 0.03, 1, 20)]
    for i, (x, y, lying, yaw) in enumerate(spots):
        r = 0.025 + 0.003 * rnd(i, 17)
        stem = 0.018
        parts = [
            pp.lathe([(0.0, stem), (r, stem), (r * 0.72, stem + r * 0.6), (0.0, stem + r * 0.78)], "mushroom", seg=7, colors=["plaster", None, None]),
            pp.lathe([(0.0, 0.0), (0.011, 0.0), (0.0105, stem + 0.001)], "garlic", seg=5),
        ]
        for p in parts:
            if lying:
                p.move((0.0, 0.0, -0.012), rot=(90, 0, yaw)).move((x, y, r))
            else:
                p.move((x, y, 0.0))
            m.add(p)
    return m


def risotto() -> pp.Model:
    m = pp.Model()
    m.add(flatten_bottom(pp.dome(0.07, 0.028, "rice", seg=10, rings=2).jitter((0.004, 0.004, 0.005), 18)))
    slice_outline = [(-0.006, -0.012), (0.006, -0.012), (0.006, 0.0), (0.016, 0.0), (0.012, 0.01), (0.0, 0.015), (-0.012, 0.01), (-0.016, 0.0), (-0.006, 0.0)]
    for i, (x, y, yaw) in enumerate(((-0.022, -0.012, 30), (0.02, 0.006, -50), (-0.004, 0.026, 120))):
        s = pp.prism([(px * 1.35, py * 1.35) for px, py in slice_outline], 0.006, "mushroom", top="cake", bottom="cake")
        m.add(s.move((x, y, 0.024), rot=(10, -8, yaw)))
    for i, (x, y) in enumerate(((0.008, -0.026), (0.03, -0.012))):
        m.add(pp.box((0.016, 0.008, 0.002), (x, y, 0.026), "cheese", rot=(0, 10, 40 * i)))
    for i in range(3):
        a = 2 * math.pi * i / 3 + 0.5
        r = 0.04 * abs(rnd(i, 19)) + 0.008
        m.add(fleck("plant_green", (r * math.cos(a), r * math.sin(a), 0.026 * (1 - (r / 0.07) ** 2) + 0.002), 0.004))
    for i in range(3):
        a = 2 * math.pi * i / 3 + 1.3
        m.add(pp.sphere(1.0, "rice", seg=4, rings=2, scale=(0.006, 0.0035, 0.003)).move((0.05 * math.cos(a), 0.05 * math.sin(a), 0.012), rot=(0, 0, 50 * i)))
    return m


def jerky() -> pp.Model:
    m = pp.Model()
    strips = [(-0.03, 0.005, 20, "leather"), (0.0, 0.009, -15, "meat_cooked"), (0.026, 0.005, 40, "leather"), (-0.008, 0.013, 75, "burnt"), (0.012, 0.017, -60, "leather")]
    for i, (oy, z, yaw, color) in enumerate(strips):
        pts = []
        for k in range(5):
            x = -0.06 + 0.03 * k
            pts.append((x, oy + 0.005 * rnd(k, 20 + i), z + 0.004 * math.sin(k * 1.7 + i)))
        widths = [(0.009, 0.0028), (0.011, 0.003), (0.01, 0.003), (0.012, 0.0028), (0.008, 0.0025)]
        m.add(pp.tube(pts, widths, color, sides=4, phase=45, smooth=False).move(rot=(0, 0, yaw)))
    return m


def cheese() -> pp.Model:
    m = pp.Model()
    m.add(pp.box((0.17, 0.12, 0.014), (0.0, 0.0, 0.007), "wood_light", bevel=0.003))
    arc = [(0.085 * math.cos(math.radians(a)), 0.085 * math.sin(math.radians(a))) for a in (-24, -8, 8, 24)]
    wedge = pp.prism([(0.0, 0.0)] + arc, 0.055, "cheese", z0=0.014)
    wedge.paint("cloth_red", lambda c, n: n.x > 0.85)  # wax rind
    ax, ay = -0.06, 0.008  # wedge apex
    m.add(wedge.move((ax, ay, 0.0)))
    # Holes: on the two cut faces (distance from the apex, height) and one on top.
    for side, d, z, r in ((-1, 0.045, 0.042, 0.0065), (-1, 0.07, 0.026, 0.005), (1, 0.06, 0.05, 0.0055)):
        a = math.radians(24 * side)
        nx, ny = -math.sin(abs(a)), -side * math.cos(a)  # outward normal of that cut face
        x, y = ax + d * math.cos(a) + nx * 0.0006, ay + d * math.sin(a) + ny * 0.0006
        yaw = -24 if side < 0 else 204
        m.add(pp.panel([(px, py, 0.0) for px, py in pp.circle(r, 6)], "honey").move((x, y, z), rot=(90, 0, yaw)))
    m.add(pp.panel([(px, py, 0.0) for px, py in pp.circle(0.006, 6)], "honey").move((ax + 0.04, ay + 0.004, 0.0695)))
    m.add(pp.box((0.022, 0.022, 0.022), (0.045, -0.025, 0.025), "cheese", bevel=0.002, rot=(0, 0, 15)))
    for i, (x, y) in enumerate(((0.042, 0.03), (0.06, 0.018), (0.052, 0.042))):
        m.add(pp.sphere(0.0095, "curtain_plum", seg=5, rings=3, center=(x, y, 0.024)))
    return m


def canapes() -> pp.Model:
    m = pp.Model()
    for i in range(5):
        a = 2 * math.pi * i / 5 + 0.3
        x, y = 0.056 * math.cos(a), 0.056 * math.sin(a)
        base_h = 0.01
        if i % 2 == 0:
            m.add(pp.cylinder(0.024, base_h, "bread_crust", seg=6, top="bread", base=(x, y, 0.0)))
        else:
            m.add(pp.box((0.04, 0.04, base_h), (x, y, base_h / 2), "bread", rot=(0, 0, math.degrees(a))))
        top = base_h
        if i == 0:  # smoked salmon and dill
            m.add(pp.dome(0.017, 0.012, "apron_coral", seg=5, rings=1, base=(x, y, top)).jitter(0.002, 60))
            m.add(fleck("plant_green", (x + 0.003, y, top + 0.012), 0.005))
        elif i == 1:  # cheese and grape
            m.add(pp.box((0.02, 0.02, 0.015), (x - 0.005, y, top + 0.0075), "cheese", rot=(0, 0, 20)))
            m.add(pp.sphere(0.0085, "curtain_plum", seg=5, rings=2, center=(x + 0.01, y + 0.007, top + 0.007)))
        elif i == 2:  # tomato and basil
            m.add(pp.cylinder(0.018, 0.005, "tomato", seg=6, base=(x, y, top)))
            m.add(pp.panel([(x - 0.008, y - 0.005, top + 0.0055), (x + 0.01, y - 0.002, top + 0.0055), (x, y + 0.01, top + 0.0055)], "lettuce"))
        elif i == 3:  # olive
            m.add(pp.dome(0.014, 0.012, "olive", seg=5, rings=2, base=(x, y, top)))
            m.add(pp.cylinder(0.005, 0.0015, "tomato", seg=4, base=(x, y, top + 0.0115)))
        else:  # cream cheese and caviar
            m.add(pp.dome(0.016, 0.011, "cloth_white", seg=5, rings=1, base=(x, y, top)))
            m.add(fleck("black", (x, y, top + 0.011), 0.005))
    return m


def sorbet() -> pp.Model:
    """Three scoops of sorbet (raspberry, lemon, pistachio) in a footed glass coupe."""
    m = pp.Model()
    profile = [(0.0, 0.0), (0.034, 0.0), (0.008, 0.008), (0.006, 0.034), (0.056, 0.058), (0.051, 0.06), (0.0, 0.047)]
    m.add(pp.lathe(profile, "glass", seg=8))
    scoops = [(-0.018, -0.011, 0.054, "rose"), (0.019, -0.009, 0.054, "cheese"), (0.0, 0.019, 0.056, "apron_sage")]
    for i, (x, y, z, color) in enumerate(scoops):
        s = pp.sphere(0.027, color, seg=6, rings=4).jitter(0.003, 70 + i)
        m.add(flatten_bottom(s.move((x, y, z)), 0.046))
    for leaf in folded_leaf(0.011, 0.007, 0.004, "plant_green"):
        m.add(leaf.move((0.004, 0.002, 0.08), rot=(0, -20, 60)))
    return m


def burnt() -> pp.Model:
    m = pp.Model()
    lump = pp.sphere(0.05, "burnt", seg=7, rings=5).jitter(0.012, 80).move((0.0, 0.0, 0.028), scale=(1.15, 0.95, 0.7))
    lump.paint_by(lambda c, n: "hob_glow" if pp.noise(c.x * 40, c.y * 40, c.z * 40, 3) > 0.82 else ("tile_black" if pp.noise(c.x * 30, c.y * 30, 0.0, 4) > 0.3 else None))
    m.add(flatten_bottom(lump))
    for i, (x, y, z, r, color) in enumerate(((0.008, 0.0, 0.082, 0.028, "smoke"), (-0.014, 0.006, 0.12, 0.024, "hair_grey"), (0.008, -0.004, 0.155, 0.018, "ghost_white"))):
        m.add(pp.sphere(r, color, seg=6, rings=4, center=(x, y, z)).jitter(r * 0.15, 90 + i))
    return m


ITEMS = {
    "food_loaf": loaf,
    "food_bread_slices": bread_slices,
    "food_steak_raw": steak_raw,
    "food_steak_cooked": steak_cooked,
    "food_tartare": tartare,
    "food_lettuce": lettuce,
    "food_salad": salad,
    "food_leeks": leeks,
    "food_leeks_chopped": leeks_chopped,
    "food_soup": soup,
    "food_chicken_raw": lambda: chicken(False),
    "food_chicken_roast": lambda: chicken(True),
    "food_batter": batter,
    "food_cake": honey_cake,
    "food_birthday_cake": birthday_cake,
    "food_olives": olives,
    "food_oysters": oysters,
    "food_chops_raw": lambda: chops(False),
    "food_chops_cooked": lambda: chops(True),
    "food_mushrooms": mushrooms,
    "food_risotto": risotto,
    "food_jerky": jerky,
    "food_cheese": cheese,
    "food_canapes": canapes,
    "food_sorbet": sorbet,
    "food_burnt": burnt,
}


def settle(m: pp.Model) -> pp.Model:
    """Put the item's footprint center on the origin and its bottom on z = 0."""
    vs = [v.co for p in m.parts for v in p.bm.verts]
    cx = (min(v.x for v in vs) + max(v.x for v in vs)) / 2
    cy = (min(v.y for v in vs) + max(v.y for v in vs)) / 2
    drop = max(min(v.z for v in vs), 0.0)  # rest on the plate if it floats; clip crumbs that poke below
    for p in m.parts:
        p.warp(lambda v: (v.x - cx, v.y - cy, max(v.z - drop, 0.0)))
    return m


def build() -> None:
    for name, make in ITEMS.items():
        if name == "food_birthday_cake":
            # Built centered already, so the flames can sit on the candle tops as modelled.
            cake = make().build(name)
            for i, top in enumerate(birthday_candle_tops()):
                f = pp.Model()
                f.add(pp.flame(0.022, 0.006, base=top, seg=4))
                pp.parent(f.build(f"flame_bc_{i}", origin=top), cake)
        else:
            settle(make()).build(name)
