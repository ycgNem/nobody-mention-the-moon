"""Bowl: Ø0.18 m, 0.07 m tall. ceramic_blue glaze outside, porcelain inside and on the lip.

Origin at the bottom center.
"""

from lib import prop_prims as pp

KIND = "prop"

R = 0.09
H = 0.07


def build() -> None:
    m = pp.Model()
    profile = [
        (0.0, 0.004),
        (0.042, 0.004),
        (0.046, 0.0),  # foot ring
        (0.056, 0.0),
        (0.058, 0.008),
        (0.078, 0.03),
        (0.088, 0.055),
        (R, H - 0.003),
        (0.087, H),  # lip
        (0.081, H - 0.004),
        (0.07, 0.035),
        (0.046, 0.014),
        (0.0, 0.011),
    ]
    blue, white = "ceramic_blue", "porcelain"
    colors = [white, white, white, blue, blue, blue, blue, white, white, white, white, white]
    m.add(pp.lathe(profile, white, seg=16, colors=colors))
    m.build("bowl")
