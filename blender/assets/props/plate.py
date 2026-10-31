"""Dinner plate: Ø0.26 m, 0.025 m tall, porcelain with a thin ceramic_blue rim.

Origin at the bottom center. Food from the food kit sits on the flat well at z = WELL_Z.
"""

from lib import prop_prims as pp

KIND = "prop"

R = 0.13
H = 0.025
WELL_Z = 0.009  # top of the flat center, where food sits


def build() -> None:
    m = pp.Model()
    profile = [
        (0.0, 0.003),  # underside, inside the foot ring
        (0.068, 0.003),
        (0.074, 0.0),  # foot ring
        (0.086, 0.0),
        (0.122, 0.017),  # underside of the rim
        (R, H - 0.002),
        (0.127, H),  # rim top
        (0.124, H - 0.0002),  # blue band
        (0.115, H - 0.0014),
        (0.104, H - 0.004),  # inner edge of the rim
        (0.086, WELL_Z),
        (0.0, WELL_Z),
    ]
    blue = "ceramic_blue"
    colors = [None, None, None, None, None, None, blue, None, None, None, None]
    m.add(pp.lathe(profile, "porcelain", seg=18, colors=colors))
    m.build("plate")
