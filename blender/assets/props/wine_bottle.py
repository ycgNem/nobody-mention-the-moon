"""Wine bottle: Ø0.08 m, 0.32 m tall, dark wine-red glass, gold foil capsule, paper label on the
front (+Y). Origin at the bottom center.
"""

import math

from lib import prop_prims as pp

KIND = "prop"

R = 0.04
H = 0.32


def label(r: float, z0: float, z1: float, half_angle: float, color: str, cols: int = 6) -> pp.Part:
    """A curved panel hugging the bottle, centered on the front (+Y)."""
    grid = []
    for i in range(cols + 1):
        a = math.radians(90 - half_angle + 2 * half_angle * i / cols)
        grid.append([(r * math.cos(a), r * math.sin(a), z) for z in (z0, z1)])
    return pp.sheet(grid, color)


def build() -> None:
    m = pp.Model()
    profile = [
        (0.0, 0.006),  # punt
        (R - 0.008, 0.0),
        (R, 0.008),
        (R, 0.205),
        (0.036, 0.228),  # shoulder
        (0.022, 0.252),
        (0.0145, 0.268),
        (0.0135, 0.3),  # neck
        (0.016, 0.304),  # lip
        (0.016, 0.314),
        (0.012, H),
        (0.0, H),
    ]
    foil = "gold"
    colors = [None, None, None, None, None, None, foil, foil, foil, foil, foil]
    m.add(pp.lathe(profile, "wine", seg=12, colors=colors))
    m.add(label(R + 0.0012, 0.07, 0.17, 70, "paper"))
    m.add(label(R + 0.0022, 0.095, 0.125, 50, "cloth_red", cols=4))
    m.add(label(R + 0.0022, 0.15, 0.157, 50, "gold", cols=4))
    m.build("wine_bottle")
