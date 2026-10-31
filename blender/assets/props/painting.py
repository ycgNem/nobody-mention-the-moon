"""Hand-held framed painting: 0.5 m wide, 0.4 m tall, 0.04 m deep. Gold frame around a little
landscape (sky, sun, hills, a cottage, a river) made of a few flat faces of color.

Stands upright on its bottom edge. The picture faces +Y; the plain wooden back faces -Y.
Origin at the bottom center.
"""

from lib import prop_prims as pp

KIND = "prop"

W, H, D = 0.5, 0.4, 0.04
FRAME = 0.05
OW, OH = W / 2 - FRAME, H / 2 - FRAME  # half size of the opening
CZ = H / 2  # center height
CANVAS_Y = 0.006


def frame() -> pp.Part:
    """Sweep a moulding profile around the opening. (out, y): offset outward from the opening
    edge, and depth (+Y is the front)."""
    profile = [
        (0.0, CANVAS_Y),
        (0.0, 0.012),
        (0.01, 0.02),  # inner bead
        (0.024, 0.02),
        (0.03, 0.015),  # groove
        (0.036, 0.02),
        (FRAME - 0.006, 0.02),
        (FRAME, 0.013),
        (FRAME, -D / 2),
        (0.0, -D / 2),  # back
    ]
    corners = ((1, 1), (1, -1), (-1, -1), (-1, 1))
    grid = []
    for out, y in profile:
        ring = [(sx * (OW + out), y, CZ + sz * (OH + out)) for sx, sz in corners]
        grid.append(ring + [ring[0]])
    part = pp.sheet(grid, "gold", smooth=False)
    part.paint("wood_dark", lambda c, n: n.y < -0.5)
    return part


def layer(points: list[tuple[float, float]], color: str, depth: int) -> pp.Part:
    """A flat shape on the canvas, counter-clockwise in canvas coordinates as the viewer sees
    them (u to the right, v up, 0..1). Later layers sit a hair in front of earlier ones."""
    y = CANVAS_Y + 0.0008 * depth
    # Facing +Y, the viewer's right is -X.
    pts = [(OW - u * 2 * OW, y, CZ - OH + v * 2 * OH) for u, v in points]
    return pp.panel(pts, color)


def landscape(m: pp.Model) -> None:
    m.add(layer([(0, 0), (1, 0), (1, 1), (0, 1)], "glass", 0))  # sky
    m.add(layer([(0, 0.62), (1, 0.62), (1, 1), (0, 1)], "wallpaper_blue", 1))  # upper sky
    m.add(layer(pp.circle(0.075, 8, (0.78, 0.76), ry=0.1), "yolk", 2))  # sun
    m.add(layer([(0.15, 0.81), (0.25, 0.81), (0.28, 0.84), (0.2, 0.86), (0.12, 0.84)], "cloth_white", 2))  # cloud
    m.add(layer([(0, 0.3), (0.18, 0.56), (0.32, 0.46), (0.5, 0.64), (0.68, 0.44), (0.84, 0.54), (1, 0.4), (1, 0), (0, 0)][::-1], "cushion_green", 3))
    m.add(layer([(0, 0.0), (1, 0.0), (1, 0.26), (0.74, 0.38), (0.4, 0.33), (0, 0.42)], "apron_sage", 4))
    m.add(layer([(0, 0), (1, 0), (1, 0.12), (0.6, 0.2), (0.25, 0.16), (0, 0.22)], "grass", 5))
    m.add(layer([(0.46, 0.0), (0.62, 0.0), (0.56, 0.12), (0.62, 0.24), (0.66, 0.32), (0.63, 0.33), (0.55, 0.25), (0.48, 0.12)], "ceramic_blue", 6))  # river
    # Cottage on the left hill.
    m.add(layer([(0.2, 0.3), (0.32, 0.3), (0.32, 0.42), (0.2, 0.42)], "wall_cream", 6))
    m.add(layer([(0.18, 0.42), (0.34, 0.42), (0.26, 0.52)], "roof", 7))
    m.add(layer([(0.245, 0.3), (0.275, 0.3), (0.275, 0.37), (0.245, 0.37)], "wood_dark", 7))
    # A round tree.
    m.add(layer([(0.79, 0.2), (0.81, 0.2), (0.81, 0.3), (0.79, 0.3)], "wood_dark", 6))
    m.add(layer(pp.circle(0.06, 7, (0.8, 0.36), ry=0.08), "plant_green", 7))


def build() -> None:
    m = pp.Model()
    m.add(frame())
    # Backboard behind the opening.
    m.add(pp.panel([(-OW, -D / 2, CZ - OH), (OW, -D / 2, CZ - OH), (OW, -D / 2, CZ + OH), (-OW, -D / 2, CZ + OH)], "wood_mid"))
    landscape(m)
    m.build("painting")
