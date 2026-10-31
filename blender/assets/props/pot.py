"""Cooking pot: Ø0.24 m body, 0.16 m tall, open top, two loop handles on the sides (±X). Steel.

Origin at the bottom center. Inside floor at z = 0.012.
"""

from lib import prop_prims as pp

KIND = "prop"

R = 0.12
H = 0.16


def handle(side: int) -> pp.Part:
    """A flat U-shaped loop riveted to the wall, sticking out along ±X."""
    x0 = R - 0.006
    outline = [
        (x0, -0.045),
        (x0 + 0.03, -0.04),
        (x0 + 0.042, -0.022),
        (x0 + 0.042, 0.022),
        (x0 + 0.03, 0.04),
        (x0, 0.045),
        (x0, 0.031),
        (x0 + 0.022, 0.028),
        (x0 + 0.029, 0.016),
        (x0 + 0.029, -0.016),
        (x0 + 0.022, -0.028),
        (x0, -0.031),
    ]
    part = pp.prism(outline, 0.012, "steel_dark", bevel=0.003, bevel_bottom=0.003, z0=H - 0.034)
    if side < 0:
        part.move(rot=(0, 0, 180))
    return part


def build() -> None:
    m = pp.Model()
    profile = [
        (0.0, 0.0),
        (R - 0.008, 0.0),
        (R, 0.008),
        (R, H - 0.008),
        (R + 0.005, H - 0.003),  # rolled rim
        (R + 0.002, H),
        (R - 0.007, H),
        (R - 0.008, H - 0.008),
        (R - 0.008, 0.016),
        (R - 0.012, 0.012),
        (0.0, 0.012),
    ]
    dark = "steel_dark"
    colors = [dark, dark, None, None, None, None, None, dark, dark, dark]
    m.add(pp.lathe(profile, "steel", seg=16, colors=colors))
    m.add(handle(1), handle(-1))
    m.build("pot")
