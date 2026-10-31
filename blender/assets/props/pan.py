"""Iron frying pan: Ø0.26 m, with a 0.2 m handle along +Y ending in a wooden grip.

Origin at the bottom center of the pan (not of the handle), so it sits on a hob ring.
"""

from lib import prop_prims as pp

KIND = "prop"

R = 0.13
H = 0.045


def build() -> None:
    m = pp.Model()
    profile = [
        (0.0, 0.0),
        (0.1, 0.0),
        (0.108, 0.005),
        (R, H - 0.003),  # flared wall
        (R - 0.004, H),
        (R - 0.009, H - 0.002),
        (0.104, 0.012),
        (0.096, 0.008),
        (0.0, 0.008),
    ]
    inside = "hob_black"
    colors = [None, None, None, None, None, inside, inside, inside]
    m.add(pp.lathe(profile, "metal_iron", seg=16, colors=colors))

    # Handle: iron strap rising gently away from the rim, then a wooden grip with a hanging hole.
    path = [(0.0, R - 0.012, H - 0.012), (0.0, R + 0.04, H + 0.002), (0.0, R + 0.09, H + 0.014)]
    m.add(pp.tube(path, [(0.013, 0.007)] * 3, "metal_iron", sides=6, phase=30))
    grip = [(0.0, R + 0.085, H + 0.013), (0.0, R + 0.15, H + 0.028), (0.0, R + 0.2, H + 0.04)]
    m.add(pp.tube(grip, [(0.015, 0.011), (0.016, 0.012), (0.014, 0.011)], "wood_dark", sides=6, phase=30))
    m.add(pp.cylinder(0.006, 0.026, "black", seg=6, base=(0.0, R + 0.18, H + 0.022)))
    m.build("pan")
