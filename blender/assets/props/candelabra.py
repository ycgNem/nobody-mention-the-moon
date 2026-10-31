"""Three-arm brass candelabra, about 0.35 m tall to the flame tips, with cream candles.

Meshes: `candelabra` (brass and candles) with children `flame_0` (center), `flame_1` (-X) and
`flame_2` (+X). Each flame's origin is at its base, on the wick, so the client can flicker it
by scaling. Origin of the candelabra at the bottom center.
"""

from lib import prop_prims as pp

KIND = "prop"

ARM_X = 0.105
CUP_Z_MID = 0.215  # top of the center cup
CUP_Z_SIDE = 0.18
CANDLE_H = 0.095
CANDLE_R = 0.011
FLAME_H = 0.035


def cup(x: float, z: float) -> pp.Part:
    """Drip pan and socket a candle stands in; `z` is the top of the socket (open: the candle
    fills it)."""
    profile = [(0.0, z - 0.022), (0.026, z - 0.009), (0.027, z - 0.004), (0.013, z - 0.004), (0.013, z)]
    return pp.lathe(profile, "brass", seg=6, phase=30).move((x, 0.0, 0.0))


def build() -> None:
    m = pp.Model()
    stem = [
        (0.0, 0.0),
        (0.06, 0.0),  # foot
        (0.06, 0.008),
        (0.024, 0.026),
        (0.011, 0.05),
        (0.017, 0.064),  # knop
        (0.009, 0.08),
        (0.009, 0.112),
        (0.019, 0.124),  # knop the arms grow from
        (0.008, 0.138),
        (0.008, CUP_Z_MID - 0.02),  # open: hidden inside the center cup
    ]
    m.add(pp.lathe(stem, "brass", seg=8))
    m.add(cup(0.0, CUP_Z_MID))
    for side in (-1, 1):
        arm = [
            (0.0, 0.0, 0.124),
            (side * 0.05, 0.0, 0.11),
            (side * ARM_X, 0.0, 0.13),
            (side * ARM_X, 0.0, CUP_Z_SIDE - 0.02),
        ]
        m.add(pp.tube(arm, 0.0065, "brass", sides=5, up=(0.0, 1.0, 0.0), caps=False))
        m.add(cup(side * ARM_X, CUP_Z_SIDE))

    tops = []
    for i, (x, z) in enumerate(((0.0, CUP_Z_MID), (-ARM_X, CUP_Z_SIDE), (ARM_X, CUP_Z_SIDE))):
        # Open at the bottom: it stands in the socket.
        candle = pp.lathe([(CANDLE_R, z - 0.004), (CANDLE_R, z + CANDLE_H - 0.003), (CANDLE_R - 0.003, z + CANDLE_H), (0.0, z + CANDLE_H)], "candle", seg=6, phase=30)
        m.add(candle.move((x, 0.0, 0.0)))
        tops.append((x, 0.0, z + CANDLE_H))
    body = m.build("candelabra")

    for i, top in enumerate(tops):
        f = pp.Model()
        f.add(pp.flame(FLAME_H, 0.0085, base=top))
        pp.parent(f.build(f"flame_{i}", origin=top), body)
