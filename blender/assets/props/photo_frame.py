"""Standing photo frame: 0.18 m wide, 0.22 m tall, silver, leaning back on a strut. The photo is
the family dog on a sunny day.

The picture faces +Y. Origin at the bottom center of the footprint.
"""

import math

from lib import prop_prims as pp

KIND = "prop"

W, H, D = 0.18, 0.22, 0.016
BORDER = 0.022
MAT = 0.012  # white card mount inside the frame
OW, OH = W / 2 - BORDER, H / 2 - BORDER
CZ = H / 2
TILT = 12.0  # degrees the frame leans back
PHOTO_Y = 0.003


def frame() -> pp.Part:
    profile = [(0.0, PHOTO_Y), (0.0, 0.006), (0.006, D / 2), (BORDER - 0.005, D / 2), (BORDER, D / 2 - 0.004), (BORDER, -D / 2), (0.0, -D / 2)]
    corners = ((1, 1), (1, -1), (-1, -1), (-1, 1))
    grid = []
    for out, y in profile:
        ring = [(sx * (OW + out), y, CZ + sz * (OH + out)) for sx, sz in corners]
        grid.append(ring + [ring[0]])
    part = pp.sheet(grid, "metal_silver", smooth=False)
    part.paint("cloth_black", lambda c, n: n.y < -0.5)
    return part


def layer(points, color: str, depth: int, inset: float = MAT) -> pp.Part:
    """Shape on the photo in its own (u right, v up, 0..1) coordinates, counter-clockwise."""
    y = PHOTO_Y + 0.0006 * depth
    w, h = OW - inset, OH - inset
    return pp.panel([(w - u * 2 * w, y, CZ - h + v * 2 * h) for u, v in points], color)


def photo() -> list[pp.Part]:
    sq = [(0, 0), (1, 0), (1, 1), (0, 1)]
    parts = [
        layer(sq, "cloth_white", 0, inset=0.0),  # mount
        layer(sq, "glass", 1),  # sky
        layer([(0, 0), (1, 0), (1, 0.3), (0.5, 0.36), (0, 0.32)], "grass", 2),
        layer(pp.circle(0.1, 6, (0.18, 0.84)), "yolk", 2),  # sun
        # The dog: tan head, dark ears, dark nose, a tongue out.
        layer(pp.circle(0.25, 8, (0.5, 0.42), ry=0.2), "dog_tan", 3),
        layer(pp.circle(0.21, 8, (0.52, 0.66), ry=0.18), "dog_tan", 3),
        layer([(0.25, 0.78), (0.3, 0.6), (0.36, 0.72), (0.34, 0.86)], "dog_dark", 4),
        layer([(0.64, 0.72), (0.7, 0.6), (0.76, 0.76), (0.68, 0.86)], "dog_dark", 4),
        layer(pp.circle(0.04, 5, (0.43, 0.68)), "eye_dark", 4),
        layer(pp.circle(0.04, 5, (0.6, 0.68)), "eye_dark", 4),
        layer(pp.circle(0.05, 6, (0.52, 0.55), ry=0.035), "black", 4),
        layer([(0.48, 0.38), (0.56, 0.38), (0.55, 0.47), (0.49, 0.47)], "rose", 4),
    ]
    return parts


def build() -> None:
    parts = [frame()]
    parts.append(pp.panel([(-OW, -D / 2, CZ - OH), (OW, -D / 2, CZ - OH), (OW, -D / 2, CZ + OH), (-OW, -D / 2, CZ + OH)], "cloth_black"))
    parts += photo()

    # Lean everything back about the bottom edge, then add the strut down to the floor.
    t = math.radians(TILT)
    lift = (D / 2) * math.sin(t)
    for p in parts:
        p.move(rot=(TILT, 0, 0)).move((0.0, 0.0, lift))
    top_back = (0.0, -D / 2 * math.cos(t) - 0.12 * math.sin(t), lift - D / 2 * math.sin(t) + 0.12 * math.cos(t))
    foot = (0.0, top_back[1] - 0.07, 0.004)
    parts.append(pp.tube([top_back, foot], [(0.012, 0.003)] * 2, "cloth_black", sides=4, phase=45, up=(0.0, 1.0, 0.0)))

    # Center the footprint on the origin.
    ys = [v.co.y for p in parts for v in p.bm.verts]
    cy = (min(ys) + max(ys)) / 2
    m = pp.Model()
    for p in parts:
        m.add(p.move((0.0, -cy, 0.0)))
    m.build("photo_frame")
