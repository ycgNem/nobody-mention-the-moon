"""Hat kit for the humanoid: one top-level mesh per hat, cloned by name on the client.

KIND "kit" -> client/public/models/hats.glb. Every hat's origin is the point that sits on the
humanoid's `socket_hat` (the crown of the head, 1.723 m in the rest pose): attach with an identity
transform. Brims and bands reach down below the origin to the hat line around the head; hats are
sized from the humanoid's head profile (lib/rig.py) plus room for hair. Blender Z-up, front +Y.

hat_chef is cloth_white; hat_flower uses its own colors; the rest are tint_white for the client
to tint (their bands stay dark under any tint).
"""

import math

from mathutils import Matrix, Vector

from lib import char_prims as cp
from lib import rig as R

KIND = "kit"

V = Vector
HEAD = cp.Profile(R.HEAD_PROFILE)
HAIR = 0.015  # room left for hair under a hat
SEGS = 16


def head_line(dz: float) -> tuple[float, float, float]:
    """Half width, half depth and center y of the head plus hair, dz below the crown."""
    rx, ry, cy = HEAD.at(R.HEAD_TOP + dz)
    return rx + HAIR, ry + HAIR, cy


def oval(dz: float, base: tuple[float, float, float], scale: float, lift=None, wobble=None) -> list[Vector]:
    """A ring of SEGS points: the base oval scaled, at height dz (+ lift(angle)). Angle 0 = front."""
    rx, ry, cy = base
    pts = []
    for k in range(SEGS):
        a = 2.0 * math.pi * k / SEGS
        s = scale * (wobble(a) if wobble else 1.0)
        pts.append(V((rx * s * math.sin(a), cy + ry * s * math.cos(a), dz + (lift(a) if lift else 0.0))))
    return pts


def brim_lift(side: float, front: float = 0.0):
    """Brims curl up at the sides (side) and optionally at the front/back (front)."""
    return lambda a: side * math.sin(a) ** 2 + front * math.cos(a) ** 2


def banded(bands: dict[int, str], default: str):
    return lambda band, seg: bands.get(band, default)


def transform(p: cp.Part, start: int, m: Matrix, offset: Vector = V((0, 0, 0))) -> None:
    """Rotate/shift vertices added since `start` (tilting a whole hat about its origin)."""
    for i in range(start, len(p.co)):
        p.co[i] = m @ p.co[i] + offset


def hat_bowler() -> None:
    p = cp.Part("hat_bowler")
    base = head_line(-0.058)
    rings = [[V((0, base[2], 0.077))]]
    for dz, s in ((0.072, 0.42), (0.06, 0.72), (0.036, 0.93), (0.0, 1.0), (-0.032, 1.0), (-0.058, 1.0)):
        rings.append(oval(dz, base, s))
    curl = brim_lift(0.016)
    rings += [oval(-0.056, base, 1.38, curl), oval(-0.064, base, 1.40, curl), oval(-0.066, base, 1.0)]
    p.loft(rings, banded({5: "cloth_black", 6: "cloth_black"}, "tint_white"), None, cap_end=True)
    cp.finish(p)


def hat_top() -> None:
    p = cp.Part("hat_top")
    base = head_line(-0.045)
    rings = [[V((0, base[2], 0.20))]]
    for dz, s in ((0.20, 1.07), (0.193, 1.075), (0.06, 0.985), (-0.008, 0.985), (-0.045, 1.0)):
        rings.append(oval(dz, base, s))
    curl = brim_lift(0.02)
    rings += [oval(-0.043, base, 1.42, curl), oval(-0.052, base, 1.44, curl), oval(-0.054, base, 1.0)]
    p.loft(rings, banded({3: "cloth_black"}, "tint_white"), None, cap_end=True)
    cp.finish(p)


def hat_chef() -> None:
    p = cp.Part("hat_chef")
    base = head_line(-0.06)

    def pleats(a: float) -> float:
        return 1.0 + 0.05 * math.cos(8.0 * a)

    rings = [[V((0, base[2], 0.252))]]
    for dz, s in ((0.248, 0.45), (0.232, 0.92), (0.195, 1.27), (0.14, 1.38), (0.085, 1.33), (0.04, 1.12)):
        rings.append(oval(dz, base, s, wobble=pleats))
    rings += [oval(0.028, base, 1.02), oval(-0.06, base, 1.0), oval(-0.06, base, 0.94)]
    p.loft(rings, "cloth_white", None, cap_end=True)
    cp.finish(p)


def hat_beret() -> None:
    p = cp.Part("hat_beret")
    base = head_line(-0.034)
    rings = [[V((0, base[2], 0.047))]]
    for dz, s in ((0.044, 0.35), (0.036, 0.85), (0.02, 1.25), (0.0, 1.42), (-0.018, 1.32), (-0.03, 1.04), (-0.034, 1.0), (-0.034, 0.9)):
        rings.append(oval(dz, base, s))
    p.loft(rings, "tint_white", None, cap_end=True)
    cp.tube(p, [V((0, base[2], 0.04)), V((0, base[2], 0.06))], [0.008, 0.006], "tint_white", None, segs=6, start="open", end="flat")
    transform(p, 0, Matrix.Rotation(math.radians(14), 3, "Y"), V((0.012, 0.0, -0.004)))
    cp.finish(p)


def hat_party() -> None:
    p = cp.Part("hat_party")
    tip = V((0.0, 0.0, 0.20))
    rings = []
    for dz in (0.15, 0.10, 0.05, 0.0, -0.012):
        r = 0.076 * (0.20 - dz) / 0.212
        rings.append(cp.hring(dz, r, r, 12, cy=-0.004))
    p.loft([[tip]] + rings, banded({1: "gold", 3: "gold"}, "tint_white"), None, cap_end=True)
    cp.blob(p, tip + V((0, 0, 0.012)), (0.024, 0.024, 0.022), "gold", None, segs=8, rings=5)
    transform(p, 0, Matrix.Rotation(math.radians(-10), 3, "Y"))
    cp.finish(p)


def hat_flatcap() -> None:
    p = cp.Part("hat_flatcap")
    rx, ry, cy = head_line(-0.05)
    top = (rx * 1.08, ry * 1.12, cy + 0.02)

    def slope(a: float) -> float:
        return -0.012 * math.cos(a)  # lower at the front

    rings = [[V((0, cy + 0.025, 0.018))], oval(0.016, top, 0.55, slope), oval(0.012, top, 0.92, slope), oval(0.0, top, 1.02, slope),
             oval(-0.03, (rx, ry, cy), 1.03), oval(-0.05, (rx, ry, cy), 1.0), oval(-0.05, (rx, ry, cy), 0.92)]  # fmt: skip
    p.loft(rings, "tint_white", None, cap_end=True)
    # The peak: a thin slab sticking out over the forehead.
    angs = [math.radians(a) for a in (-70, -35, 0, 35, 70)]

    def peak(dy: float, dz: float) -> list[list[Vector]]:
        inner = [V((rx * 1.0 * math.sin(a), cy + ry * 1.0 * math.cos(a), -0.046 + dz)) for a in angs]
        outer = [V((rx * 1.0 * math.sin(a), cy + (ry + 0.07 * math.cos(a) ** 1.5) * math.cos(a), -0.062 + dz)) for a in angs]
        return [inner, outer]

    cp.slab(p, peak(0.0, 0.0), peak(0.0, -0.008), "tint_white", None)
    cp.finish(p)


def hat_beanie() -> None:
    p = cp.Part("hat_beanie")
    knit = 0.012
    rings = [[V((0, -0.004, HAIR + knit + 0.006))]]
    for dz in (-0.006, -0.02, -0.04, -0.06):
        rx, ry, cy = head_line(dz)
        rings.append(cp.hring(dz + 0.006, rx + knit, ry + knit, SEGS, cy=cy))
    rx, ry, cy = head_line(-0.08)

    def ribs(a: float) -> float:
        return 1.0 + 0.03 * math.cos(16.0 * a)

    rings += [
        cp.hring(-0.05, rx + knit + 0.012, ry + knit + 0.012, SEGS, cy=cy, shape=ribs),
        cp.hring(-0.088, rx + knit + 0.012, ry + knit + 0.012, SEGS, cy=cy, shape=ribs),
        cp.hring(-0.09, rx, ry, SEGS, cy=cy),
    ]
    p.loft(rings, "tint_white", None, cap_end=True)
    cp.blob(p, V((0, -0.004, HAIR + knit + 0.032)), (0.034, 0.034, 0.03), "tint_white", None, segs=8, rings=5)
    cp.finish(p)


def hat_flower() -> None:
    """A single flower tucked into the hair above and behind the right ear."""
    p = cp.Part("hat_flower")
    z = 1.588
    rx, ry, cy = HEAD.at(z)
    c = V((rx + HAIR + 0.004, -0.04, z - R.HEAD_TOP))
    n = V((1.0, -0.25, 0.35)).normalized()
    u, v = cp.frame_for(n, V((0, 0, 1)))
    for i in range(5):
        a = 2.0 * math.pi * i / 5 + 0.3
        radial = u * math.cos(a) + v * math.sin(a)
        cp.blob(p, c + radial * 0.021 + n * 0.003, (0.019, 0.014, 0.006), "rose", None, segs=6, rings=4, rot=cp.axes(n, radial))
    cp.blob(p, c + n * 0.008, (0.011, 0.011, 0.007), "yolk", None, segs=6, rings=4, rot=cp.axes(n, u))
    for a, length in ((2.2, 0.034), (3.6, 0.03)):
        radial = u * math.cos(a) + v * math.sin(a)
        cp.blob(p, c + radial * 0.036 - n * 0.004, (0.022 * length / 0.034, 0.011, 0.004), "plant_green", None, segs=6, rings=4, rot=cp.axes(n, radial))
    cp.finish(p)


def build() -> None:
    for make in (hat_chef, hat_beret, hat_bowler, hat_party, hat_flatcap, hat_top, hat_beanie, hat_flower):
        make()
