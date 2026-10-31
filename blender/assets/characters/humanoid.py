"""The shared humanoid: hosts and disguised guests on one rig, with every optional part in one file.

Blender Z-up, meters. Faces +Y (Three.js -Z); its right side is +X. Origin = root, feet center on
the floor. 1.72 m tall, eyes at 1.55 m. Built on lib/rig.py (armature, pose solver, clip baking)
and lib/char_prims.py (lofted shapes with per-face palette colors and bone weights).

Meshes (all skinned to `rig`; the client decides which to show):
  skin, face                              head, neck, hands / eyes, brows, mouth
  outfit_suit, outfit_dress, outfit_cardigan, host_shirt, apron, shoes
  hair_short, hair_long, hair_bun, hair_slick
  acc_glasses, acc_sunglasses, acc_moustache, acc_monocle, acc_bowtie, acc_pearls, acc_scarf
  slip_fur, slip_fangs, slip_cape, slip_eyes   (shown when a monster's disguise slips)
  slip_wings, slip_snakes, slip_bandages, slip_rot, slip_melt   (fae, gorgon, mummy, zombie, shapeshifter)
Sockets: socket_hat, socket_tell (on head), socket_hand_r (palm, on hand_r).
Clips: see CLIPS at the bottom.
"""

import math

from mathutils import Matrix, Vector

from lib import char_prims as cp
from lib import rig as R
from lib.rig import lean

KIND = "character"

V = Vector
UP = V((0.0, 0.0, 1.0))
FWD = V((0.0, 1.0, 0.0))
HEAD = cp.Profile(R.HEAD_PROFILE)
EYE_ANG = math.radians(23.0)  # eyes sit this far either side of the face center line
MOUTH_Z = 1.479


def mirror(v: Vector, side: str) -> Vector:
    return V((v.x * R.side_sign(side), v.y, v.z))


def rot_x(deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 3, "X")


# ============================================================================================
# Head surface
# ============================================================================================


def _meridian() -> tuple[list[float], list[float]]:
    """Normalized arc length down the head profile, for spacing hair rows evenly."""
    pts = [((rx + ry) / 2.0, z) for z, rx, ry, _ in R.HEAD_PROFILE]
    s = [0.0]
    for (r0, z0), (r1, z1) in zip(pts, pts[1:]):
        s.append(s[-1] + math.hypot(r1 - r0, z1 - z0))
    return [z for _, z in pts], [v / s[-1] for v in s]


_MZ, _MS = _meridian()


def _interp(x: float, xs: list[float], ys: list[float]) -> float:
    for i in range(len(xs) - 1):
        a, b = xs[i], xs[i + 1]
        if min(a, b) <= x <= max(a, b) and a != b:
            return ys[i] + (ys[i + 1] - ys[i]) * (x - a) / (b - a)
    return ys[0] if abs(x - xs[0]) < abs(x - xs[-1]) else ys[-1]


def s_of_z(z: float) -> float:
    return _interp(z, _MZ, _MS)


def z_of_s(s: float) -> float:
    return _interp(s, _MS, _MZ)


def on_head(z: float, ang: float, grow: float = 0.0) -> Vector:
    """A point on the head surface, pushed out along the surface normal."""
    return HEAD.point(z, ang) + HEAD.normal(z, ang) * grow


def dome(p: cp.Part, base: Vector, n: Vector, r_across: float, r_up: float, height: float, color: str, w: cp.WeightFn, segs: int = 10, sink: float = 0.004) -> None:
    """A shallow dome on a surface (eyes, lenses): rim sunk in, apex `height` out along n."""
    u, v = cp.frame_for(n, UP)
    rim = cp.ring(base - n * sink, u, v, r_up, r_across, segs)
    mid = cp.ring(base + n * (height * 0.62), u, v, r_up * 0.74, r_across * 0.74, segs)
    p.loft([rim, mid, [base + n * height]], color, w)


# ============================================================================================
# Skin and face
# ============================================================================================


def hand_axes(side: str) -> tuple[Vector, Vector, Vector, Vector]:
    """Rest wrist, finger direction, palm normal and thumb direction of one hand."""
    _, _, wrist, tip = R.arm_points(side)
    d = (tip - wrist).normalized()
    palm = V((-R.side_sign(side), 0.0, 0.0))
    palm = (palm - d * palm.dot(d)).normalized()
    thumb = (FWD - d * FWD.dot(d)).normalized()
    return wrist, d, palm, thumb


def palm_center(side: str) -> Vector:
    wrist, d, palm, _ = hand_axes(side)
    return wrist + d * 0.07 + palm * 0.025


def hand(p: cp.Part, side: str) -> None:
    wrist, d, palm, thumb = hand_axes(side)
    w = cp.rigid(f"hand_{side}")
    cp.blob(p, wrist + d * 0.066, (0.024, 0.046, 0.068), "tint_white", w, segs=8, rings=5, rot=cp.axes(d, palm), squareness=0.85)
    tz = (d + thumb * 0.75).normalized()
    cp.blob(p, wrist + d * 0.045 + thumb * 0.04 + palm * 0.01, (0.016, 0.018, 0.03), "tint_white", w, segs=6, rings=4, rot=cp.axes(tz, palm))
    cp.tube(p, [wrist - d * 0.04, wrist + d * 0.025], [0.03, 0.03], "tint_white", w, segs=6, start="open", end="open")


def build_skin(arm) -> None:
    p = cp.Part("skin")
    head = cp.rigid("head")
    HEAD.loft(p, 14, "tint_white", head, cap_start=False, cap_end=False)
    # A round storybook nose. It lives on the skin mesh so it takes the skin tint.
    cp.blob(p, HEAD.point(1.515, 0.0) + V((0, 0.010, -0.002)), (0.025, 0.022, 0.027), "tint_white", head, segs=8, rings=5)
    for side in "lr":
        s = R.side_sign(side)
        c = HEAD.point(1.537, s * math.pi / 2) + V((s * 0.003, -0.008, 0.0))
        cp.blob(p, c, (0.016, 0.027, 0.041), "tint_white", head, segs=6, rings=4, rot=rot_x(12))
    neck_w = cp.along_z([(1.37, "chest"), (1.42, "neck"), (1.45, "neck"), (1.49, "head")])
    cp.tube(p, [V((0, -0.006, 1.33)), V((0, -0.004, 1.415)), V((0, 0.0, 1.50))], [0.056, 0.054, 0.052], "tint_white", neck_w, segs=10, start="open", end="open")
    for side in "lr":
        hand(p, side)
    cp.finish(p, arm)


def build_face(arm) -> None:
    p = cp.Part("face")
    w = cp.rigid("head")
    for side in "lr":
        s = R.side_sign(side)
        a = s * EYE_ANG
        base, n = HEAD.point(R.EYE_Z, a), HEAD.normal(R.EYE_Z, a)
        dome(p, base, n, 0.024, 0.028, 0.010, "eye_white", w)
        cp.stud(p, base + n * 0.0085, n, 0.0135, 0.004, "eye_dark", w, segs=8)
        brow = [on_head(z, s * math.radians(d), 0.005) for z, d in ((1.594, 11.0), (1.601, 21.0), (1.598, 32.0))]
        if s < 0:
            brow.reverse()
        cp.tube(p, brow, [(0.0045, 0.0075)] * 3, "hair_black", w, segs=6, up=HEAD.normal(1.6, a), start="pole", end="pole")
    mouth = [on_head(MOUTH_Z + 0.006 * (d / 16.0) ** 2, math.radians(d), 0.0015) for d in (-16.0, -8.0, 0.0, 8.0, 16.0)]
    cp.tube(p, mouth, [(0.0035, 0.0045)] * 5, "lip", w, segs=5, up=HEAD.normal(MOUTH_Z, 0.0), start="pole", end="pole")
    cp.finish(p, arm)


# ============================================================================================
# Clothing
# ============================================================================================

TORSO = cp.Profile([
    (1.405, 0.072, 0.064, -0.004),
    (1.392, 0.125, 0.082, -0.008),
    (1.360, 0.180, 0.100, -0.006),
    (1.310, 0.196, 0.116, 0.000),
    (1.230, 0.189, 0.126, 0.008),
    (1.130, 0.176, 0.130, 0.012),
    (1.030, 0.172, 0.130, 0.012),
    (0.930, 0.180, 0.127, 0.006),
    (0.810, 0.190, 0.134, 0.004),
])  # fmt: skip

SEAT = cp.Profile([
    (1.020, 0.172, 0.121, 0.008),
    (0.940, 0.178, 0.124, 0.004),
    (0.865, 0.180, 0.126, -0.004),
    (0.818, 0.153, 0.110, -0.006),
    (0.788, 0.095, 0.070, -0.004),
])  # fmt: skip

SHIRT = cp.Profile([
    (1.405, 0.068, 0.062, -0.004),
    (1.392, 0.120, 0.080, -0.008),
    (1.360, 0.176, 0.098, -0.006),
    (1.310, 0.190, 0.113, 0.000),
    (1.230, 0.182, 0.122, 0.008),
    (1.130, 0.170, 0.124, 0.012),
    (1.040, 0.165, 0.122, 0.012),
    (0.960, 0.162, 0.116, 0.008),
])  # fmt: skip

TORSO_W = cp.along_z([(0.95, "hips"), (1.06, "spine"), (1.13, "spine"), (1.24, "chest")])
THIGHS = cp.by_side(lambda side: cp.rigid(f"thigh_{side}"))
# Coats: the front of the hem partly follows the thighs, so it swings when walking and folds onto
# the lap when seated instead of sticking out through the legs.
COAT_W = cp.mix(TORSO_W, THIGHS, lambda co: 0.6 * cp.smoothstep(0.95, 0.83, co.z) * cp.smoothstep(-0.03, 0.07, co.y))
COLLAR_W = cp.along_z([(1.39, "chest"), (1.44, "neck")])

# Leg tube: (height, forward offset, radius), hip joint down to the trouser cuff.
LEG = [(0.90, 0.0, 0.080), (0.66, 0.006, 0.071), (0.535, 0.01, 0.066), (0.50, 0.012, 0.066), (0.465, 0.01, 0.064), (0.30, 0.004, 0.063), (0.10, 0.0, 0.066)]
# Sleeve: (distance from the shoulder joint along the rest arm, radius)
SLEEVE = [(0.0, 0.062), (0.25, 0.052), (0.28, 0.051), (0.31, 0.050), (0.505, 0.046), (0.512, 0.053), (0.535, 0.053)]


def leg_weight(side: str) -> cp.WeightFn:
    return cp.nearest([f"thigh_{side}", f"shin_{side}"])


def skirt_weight(co: Vector) -> cp.Weights:
    """Hips at the waist, then the legs on each side (thigh down to the knee, shin below).
    Seated, the lap follows the thighs and the hem drapes down from the knees."""
    up = cp.smoothstep(0.78, 0.94, co.z)
    knee = cp.smoothstep(0.44, 0.62, co.z)
    s = cp.smoothstep(-0.12, 0.12, co.x)
    w = {"hips": up}
    for side, f in (("r", s), ("l", 1.0 - s)):
        w[f"thigh_{side}"] = (1.0 - up) * knee * f
        w[f"shin_{side}"] = (1.0 - up) * (1.0 - knee) * f
    return w


def trousers(p: cp.Part, color: str) -> None:
    SEAT.loft(p, 12, color, cp.rigid("hips"))
    for side in "lr":
        x = R.side_sign(side) * R.HIP_X
        path = [V((x, dy, z)) for z, dy, _ in LEG]
        cp.tube(p, path, [r for _, _, r in LEG], color, leg_weight(side), segs=8, start="dome", end="flat", dome_steps=(50.0,))


def sleeves(p: cp.Part, color: str, cuff: str, grow: float = 0.0, puff: float = 0.0) -> None:
    for side in "lr":
        shoulder, _, wrist, _ = R.arm_points(side)
        down = (wrist - shoulder).normalized()
        path = [shoulder + down * d for d, _ in SLEEVE]
        radii = [r + grow + (puff if d < 0.01 else 0.0) for d, r in SLEEVE]
        last = len(path) + 1  # the dome adds three rings in front of the path

        def pick(band: int, seg: int, last: int = last) -> str:
            return cuff if band >= last - 1 else color

        w = cp.nearest([f"upper_arm_{side}", f"forearm_{side}"])
        cp.tube(p, path, radii, pick, w, segs=8, start="dome", end="flat", cap_color=cuff)


def front_strip(rows: list[tuple[float, float, float]], cols: int = 2) -> list[list[tuple[float, float]]]:
    """Rows of (z, x_left, x_right) -> (x, z) rows for a front patch, columns left to right."""
    return [[(x0 + (x1 - x0) * c / cols, z) for c in range(cols + 1)] for z, x0, x1 in rows]


def studs_down_front(p: cp.Part, prof: cp.Profile, zs: list[float], r: float, color: str, w: cp.WeightFn, grow: float = 0.0) -> None:
    for z in zs:
        cp.stud(p, prof.front(0.0, z, grow), prof.normal(z, 0.0), r, r * 0.45, color, w)


def patch_on(p: cp.Part, prof: cp.Profile, x0: float, x1: float, z0: float, z1: float, color: str, w: cp.WeightFn, grow: float) -> None:
    rows = front_strip([(z1, x0, x1), (z0, x0, x1)], 2)
    p.grid(cp.patch(rows, lambda x, z: prof.front(x, z, grow)), color, w)


def build_suit(arm) -> None:
    p = cp.Part("outfit_suit")
    TORSO.loft(p, 12, "tint_white", COAT_W)
    # Dark waistcoat V with lapels either side.
    zs = [1.385, 1.31, 1.235, 1.16, 1.115]
    hw = [0.068 * (z - 1.11) / 0.275 + 0.004 for z in zs]
    p.grid(cp.patch(front_strip([(z, -h, h) for z, h in zip(zs, hw)]), lambda x, z: TORSO.front(x, z, 0.003)), "cloth_black", TORSO_W)
    for s in (-1.0, 1.0):
        rows = []
        for z, h in zip(zs, hw):
            lw = 0.012 + 0.03 * (z - 1.11) / 0.275
            a, b = sorted((s * h, s * (h + lw)))
            rows.append((z, a, b))
        p.grid(cp.patch(front_strip(rows, 1), lambda x, z: TORSO.front(x, z, 0.006)), "cloth_grey", TORSO_W)
        patch_on(p, TORSO, min(s * 0.08, s * 0.15), max(s * 0.08, s * 0.15), 0.935, 0.965, "cloth_grey", COAT_W, 0.004)
    studs_down_front(p, TORSO, [1.07, 0.99], 0.011, "brass", COAT_W, 0.002)
    trousers(p, "tint_white")
    sleeves(p, "tint_white", "cloth_grey")
    cp.finish(p, arm)


DRESS_TOP = cp.Profile([
    (1.405, 0.070, 0.062, -0.004),
    (1.392, 0.122, 0.080, -0.008),
    (1.360, 0.176, 0.098, -0.006),
    (1.310, 0.188, 0.116, 0.002),
    (1.230, 0.181, 0.126, 0.010),
    (1.130, 0.163, 0.121, 0.012),
    (1.040, 0.156, 0.117, 0.010),
    (0.990, 0.160, 0.119, 0.008),
])  # fmt: skip

SKIRT = cp.Profile([
    (1.030, 0.165, 0.123, 0.010),
    (0.950, 0.190, 0.144, 0.008),
    (0.820, 0.207, 0.158, 0.008),
    (0.640, 0.224, 0.176, 0.010),
    (0.450, 0.244, 0.196, 0.012),
    (0.270, 0.262, 0.214, 0.012),
    (0.170, 0.270, 0.222, 0.012),
    (0.155, 0.214, 0.172, 0.012),
])  # fmt: skip


def build_dress(arm) -> None:
    p = cp.Part("outfit_dress")
    DRESS_TOP.loft(p, 12, "tint_white", TORSO_W)
    hem = len(SKIRT.rings) - 3

    def skirt_color(band: int, seg: int) -> str:
        return "cloth_black" if band >= hem else "tint_white"

    rings = [cp.hring(z, rx, ry, 16, cy=cy) for z, rx, ry, cy in SKIRT.rings]
    p.loft(rings, skirt_color, skirt_weight, cap_end=True, cap_color="cloth_black")
    # Sash at the waist and a lace collar.
    p.loft([cp.hring(1.062, 0.166, 0.127, 12, cy=0.010), cp.hring(0.998, 0.182, 0.140, 12, cy=0.009)], "cloth_black", TORSO_W)
    collar = [cp.hring(1.456, 0.057, 0.055, 12, cy=-0.004), cp.hring(1.45, 0.068, 0.066, 12, cy=-0.004), cp.hring(1.392, 0.078, 0.072, 12, cy=-0.004)]
    p.loft(collar, "cloth_cream", COLLAR_W)
    studs_down_front(p, DRESS_TOP, [1.33, 1.27, 1.21, 1.15], 0.008, "brass", TORSO_W)
    sleeves(p, "tint_white", "cloth_cream", grow=0.002, puff=0.014)
    cp.finish(p, arm)


CARDI = cp.Profile([(z, rx + 0.012, ry + 0.012, cy) for z, rx, ry, cy in TORSO.rings[:-1]] + [(0.86, 0.198, 0.142, 0.004), (0.79, 0.198, 0.142, 0.002)])


def build_cardigan(arm) -> None:
    p = cp.Part("outfit_cardigan")
    hem = len(CARDI.rings) - 2

    def body_color(band: int, seg: int) -> str:
        return "cloth_grey" if band >= hem else "tint_white"

    rings = [cp.hring(z, rx, ry, 12, cy=cy) for z, rx, ry, cy in CARDI.rings]
    p.loft(rings, body_color, COAT_W, cap_start=True, cap_end=True, cap_color="tint_white")
    zs = [1.39, 1.30, 1.21, 1.12, 1.06]
    hw = [0.062 * (z - 1.055) / 0.335 + 0.004 for z in zs]
    p.grid(cp.patch(front_strip([(z, -h, h) for z, h in zip(zs, hw)]), lambda x, z: CARDI.front(x, z, 0.003)), "cloth_grey", TORSO_W)
    studs_down_front(p, CARDI, [1.02, 0.95, 0.88], 0.014, "wood_dark", COAT_W, 0.002)
    for s in (-1.0, 1.0):
        patch_on(p, CARDI, min(s * 0.075, s * 0.155), max(s * 0.075, s * 0.155), 0.865, 0.945, "cloth_grey", COAT_W, 0.004)
    trousers(p, "cloth_grey")
    sleeves(p, "tint_white", "cloth_grey", grow=0.008, puff=0.006)
    # Leather elbow patches.
    for side in "lr":
        _, elbow, _, _ = R.arm_points(side)
        cp.stud(p, elbow + V((0, -0.062, 0.0)), V((0, -1, 0)), 0.026, 0.004, "leather", cp.nearest([f"upper_arm_{side}", f"forearm_{side}"]))
    cp.finish(p, arm)


def build_host_shirt(arm) -> None:
    p = cp.Part("host_shirt")
    SHIRT.loft(p, 12, "cloth_white", TORSO_W)
    collar = [cp.hring(1.436, 0.056, 0.054, 12, cy=-0.004), cp.hring(1.432, 0.064, 0.062, 12, cy=-0.004), cp.hring(1.392, 0.076, 0.070, 12, cy=-0.004)]
    p.loft(collar, "cloth_white", COLLAR_W)
    for s in (-1.0, 1.0):  # collar points
        rows = [[on_collar(s * 0.012, 1.402), on_collar(s * 0.062, 1.412)], [on_collar(s * 0.010, 1.372), on_collar(s * 0.07, 1.366)]]
        if s < 0:
            rows = [list(reversed(r)) for r in rows]
        p.grid(rows, "cloth_white", COLLAR_W)
    p.grid(cp.patch(front_strip([(1.37, -0.011, 0.011), (0.99, -0.011, 0.011)], 1), lambda x, z: SHIRT.front(x, z, 0.002)), "cloth_cream", TORSO_W)
    studs_down_front(p, SHIRT, [1.30, 1.20, 1.10, 1.01], 0.005, "porcelain", TORSO_W, 0.003)
    trousers(p, "cloth_black")
    p.loft([cp.hring(1.016, 0.177, 0.126, 12, cy=0.008), cp.hring(0.976, 0.181, 0.128, 12, cy=0.006)], "leather", cp.rigid("hips"))
    cp.stud(p, SEAT.front(0.0, 0.996, 0.006), FWD, 0.017, 0.006, "brass", cp.rigid("hips"))
    sleeves(p, "cloth_white", "cloth_white")
    cp.finish(p, arm)


def on_collar(x: float, z: float) -> Vector:
    return SHIRT.front(x, z, 0.012) + V((0, 0.004, 0))


def apron_y(x: float, z: float) -> float:
    ys = []
    if z >= 0.955:
        ys.append(SHIRT.front(x, z).y)
    if 0.79 <= z <= 1.025:
        ys.append(SEAT.front(x, z).y + 0.008)
    if z < 0.95:
        ys.append(0.13 - 0.5 * x * x)
    return max(ys)


def apron_weight(co: Vector) -> cp.Weights:
    if co.z > 0.97:
        return TORSO_W(co)
    return skirt_weight(co)


def build_apron(arm) -> None:
    p = cp.Part("apron")
    outline = [(1.30, 0.098), (1.22, 0.100), (1.13, 0.104), (1.05, 0.11), (0.995, 0.172), (0.92, 0.176), (0.80, 0.176), (0.66, 0.172), (0.53, 0.166)]

    def sheet(grow: float) -> list[list[Vector]]:
        return [[V((x, apron_y(x, z) + grow, z)) for x in (-h, -h / 2, 0.0, h / 2, h)] for z, h in outline]

    cp.slab(p, sheet(0.020), sheet(0.010), "tint_white", apron_weight)
    pocket = front_strip([(0.86, -0.075, 0.075), (0.76, -0.075, 0.075)], 2)
    p.grid([[V((x, apron_y(x, z) + 0.024, z)) for x, z in row] for row in pocket], "cloth_cream", apron_weight)
    # Neck strap from the bib corners over the back of the neck, and the waist ties.
    strap = [V((0.094, apron_y(0.094, 1.30) + 0.015, 1.298)), V((0.092, 0.07, 1.376)), V((0.078, 0.0, 1.408)), V((0.04, -0.06, 1.414)), V((0.0, -0.072, 1.414))]
    strap += [mirror(v, "l") for v in reversed(strap[:-1])]
    cp.tube(p, strap, [0.007] * len(strap), "tint_white", cp.rigid("chest"), segs=4, start="open", end="open")
    waist = [SEAT.point(0.996, math.radians(a), 0.014) for a in range(84, 277, 24)]
    cp.tube(p, waist, [(0.012, 0.005)] * len(waist), "tint_white", cp.rigid("hips"), segs=4, up=UP, start="open", end="open")
    for s in (-1.0, 1.0):
        bow = V((s * 0.028, -0.148, 0.998))
        cp.blob(p, bow, (0.024, 0.012, 0.016), "tint_white", cp.rigid("hips"), segs=6, rings=4)
        cp.tube(p, [V((s * 0.01, -0.146, 0.99)), V((s * 0.025, -0.15, 0.93)), V((s * 0.03, -0.152, 0.88))], [(0.004, 0.011)] * 3, "tint_white", cp.rigid("hips"), segs=4, up=FWD, start="open", end="flat")
    cp.finish(p, arm)


def build_shoes(arm) -> None:
    p = cp.Part("shoes")
    for side in "lr":
        x = R.side_sign(side) * R.HIP_X

        def color(band: int, seg: int) -> str:
            return "black" if band >= 4 else "leather"

        cp.blob(p, V((x, 0.045, 0.05)), (0.052, 0.112, 0.056), color, cp.rigid(f"foot_{side}"), segs=10, rings=6, squareness=0.72, flat_bottom=0.0)
    cp.finish(p, arm)


# ============================================================================================
# Hair
# ============================================================================================


def wave3(ang: float, front: float, side: float, back: float) -> float:
    """Smooth value around the head: `front` at ang 0, `side` at +-90 degrees, `back` at 180."""
    b = (front - back) / 2.0
    a_plus_c = (front + back) / 2.0
    a = (a_plus_c + side) / 2.0
    c = a_plus_c - a
    return a + b * math.cos(ang) + c * math.cos(2.0 * ang)


def hair_cap(p: cp.Part, w: cp.WeightFn, line, thick, segs: int = 14, rows: int = 6) -> None:
    """A shell over the top of the head down to a hairline. line(ang) -> z of the hairline;
    thick(frac, ang) -> thickness, frac 0 at the crown and 1 at the hairline."""
    angs = [2.0 * math.pi * k / segs for k in range(segs)]
    top = V((0.0, R.HEAD_PROFILE[0][3], R.HEAD_TOP + thick(0.0, 0.0)))
    rings = [[top]]
    for j in range(1, rows + 1):
        f = j / rows
        ring = []
        for a in angs:
            z = z_of_s(s_of_z(line(a)) * f)
            ring.append(on_head(z, a, thick(f, a)))
        rings.append(ring)
    rings.append([on_head(line(a), a, -0.004) for a in angs])
    p.loft(rings, "tint_white", w)


def hair_curtain(p: cp.Part, w: cp.WeightFn, a0: float, a1: float, z_top: float, bottom, cols: int = 10, rows: int = 5, grow: float = 0.012, flare: float = 0.02, thickness: float = 0.016) -> None:
    """Hair hanging from under the cap: a thick sheet around the back of the head between angles
    a0 and a1. It hugs the head down to its widest point, then falls straight to bottom(ang)."""
    z_wide = 1.56

    def sheet(g: float) -> list[list[Vector]]:
        out = []
        for i in range(rows + 1):
            f = i / rows
            row = []
            for c in range(cols + 1):
                a = a0 + (a1 - a0) * c / cols
                zb = bottom(a)
                z = z_top + (zb - z_top) * f
                rx, ry, cy = HEAD.at(max(z, z_wide))
                lock = c % 2  # alternate columns stick out and hang lower: chunky locks
                z += 0.035 * lock * f
                fall = max(0.0, (z_wide - z) / (z_wide - zb))
                r = g + flare * fall**1.3 + 0.014 * lock * math.sqrt(fall)
                row.append(V(((rx + r) * math.sin(a), cy + (ry + r) * math.cos(a), z)))
            out.append(row)
        return out

    cp.slab(p, sheet(grow), sheet(grow - thickness), "tint_white", w)


def head_to_chest(co: Vector) -> cp.Weights:
    t = cp.smoothstep(1.47, 1.34, co.z) * 0.5
    return {"head": 1.0 - t, "chest": t}


def build_hair_short(arm) -> None:
    p = cp.Part("hair_short")

    def thick(f: float, a: float) -> float:
        quiff = 0.016 * math.exp(-(((a + 0.35 + math.pi) % (2 * math.pi) - math.pi) / 0.6) ** 2) * math.sin(math.pi * min(1.0, f * 1.25))
        return 0.017 - 0.006 * f + quiff

    hair_cap(p, cp.rigid("head"), lambda a: wave3(a, 1.652, 1.585, 1.47), thick)
    cp.finish(p, arm)


def build_hair_long(arm) -> None:
    p = cp.Part("hair_long")

    def thick(f: float, a: float) -> float:
        ears = 0.02 * math.exp(-((abs(math.sin(a)) - 1.0) / 0.25) ** 2) * cp.smoothstep(0.55, 0.95, f)
        return 0.018 - 0.004 * f + ears

    def part_line(a: float) -> float:
        return wave3(a, 1.652, 1.52, 1.50)

    hair_cap(p, cp.rigid("head"), part_line, thick)
    hair_curtain(p, head_to_chest, math.radians(68), math.radians(292), 1.62, lambda a: wave3(a, 1.44, 1.42, 1.33))
    cp.finish(p, arm)


def build_hair_bun(arm) -> None:
    p = cp.Part("hair_bun")
    hair_cap(p, cp.rigid("head"), lambda a: wave3(a, 1.655, 1.59, 1.50), lambda f, a: 0.013 - 0.004 * f)
    cp.blob(p, V((0.0, -0.148, 1.668)), (0.058, 0.052, 0.054), "tint_white", cp.rigid("head"), segs=10, rings=6)
    cp.finish(p, arm)


def build_hair_slick(arm) -> None:
    p = cp.Part("hair_slick")

    def line(a: float) -> float:
        wrapped = (a + math.pi) % (2 * math.pi) - math.pi
        peak = -0.026 * math.exp(-(wrapped / 0.2) ** 2) + 0.012 * math.exp(-((abs(wrapped) - 0.5) / 0.18) ** 2)
        return wave3(a, 1.665, 1.585, 1.47) + peak

    hair_cap(p, cp.rigid("head"), line, lambda f, a: 0.010 - 0.002 * f, segs=16)
    cp.finish(p, arm)


# ============================================================================================
# Accessories
# ============================================================================================


def eye_frame(side: str) -> tuple[Vector, Vector]:
    a = R.side_sign(side) * EYE_ANG
    return HEAD.point(R.EYE_Z, a), HEAD.normal(R.EYE_Z, a)


def rim_path(center: Vector, n: Vector, rx: float, rz: float, count: int = 10) -> list[Vector]:
    u, v = cp.frame_for(n, UP)
    return cp.ring(center, u, v, rz, rx, count)


def glasses_arms(p: cp.Part, w: cp.WeightFn, color: str, offset: float) -> None:
    for side in "lr":
        s = R.side_sign(side)
        base, n = eye_frame(side)
        outer = base + n * offset + V((s * 0.034, 0, 0.004))
        ear = V((s * 0.137, -0.02, 1.578))
        mid = V((s * 0.136, 0.06, 1.562))
        cp.tube(p, [outer, mid, ear], [0.0045] * 3, color, w, segs=4, start="open", end="pole")
    lc, ln = eye_frame("l")
    rc, rn = eye_frame("r")
    bridge = [lc + ln * offset + V((0.031, 0, 0.004)), V((0.0, 0.152, 1.558)), rc + rn * offset + V((-0.031, 0, 0.004))]
    cp.tube(p, bridge, [0.004] * 3, color, w, segs=4, start="open", end="open")


def build_glasses(arm) -> None:
    p = cp.Part("acc_glasses")
    w = cp.rigid("head")
    for side in "lr":
        base, n = eye_frame(side)
        cp.loop_tube(p, rim_path(base + n * 0.02, n, 0.034, 0.03), (0.0045, 0.005), "black", w, segs=4, up=n)
    glasses_arms(p, w, "black", 0.02)
    cp.finish(p, arm)


def build_sunglasses(arm) -> None:
    p = cp.Part("acc_sunglasses")
    w = cp.rigid("head")
    for side in "lr":
        base, n = eye_frame(side)
        rot = cp.axes(n, V((R.side_sign(side), 0, 0)))
        cp.blob(p, base + n * 0.021, (0.036, 0.031, 0.007), "glass_dark", w, segs=10, rings=4, rot=rot, squareness=0.8)
    glasses_arms(p, w, "black", 0.022)
    cp.finish(p, arm)


def build_monocle(arm) -> None:
    p = cp.Part("acc_monocle")
    base, n = eye_frame("r")
    c = base + n * 0.018
    cp.loop_tube(p, rim_path(c, n, 0.031, 0.031), (0.004, 0.0045), "gold", cp.rigid("head"), segs=4, up=n)
    chain = [c + V((0.02, 0.0, -0.025)), V((0.095, 0.105, 1.49)), V((0.112, 0.10, 1.43)), V((0.105, 0.105, 1.385))]
    cp.tube(p, chain, [0.0025] * 4, "gold", cp.along_z([(1.40, "chest"), (1.47, "head")]), segs=4, start="open", end="pole")
    cp.finish(p, arm)


def build_moustache(arm) -> None:
    p = cp.Part("acc_moustache")
    w = cp.rigid("head")
    for side in "lr":
        s = R.side_sign(side)
        pts = [on_head(z, s * math.radians(d), g) for z, d, g in ((1.497, 2.0, 0.012), (1.491, 13.0, 0.013), (1.487, 25.0, 0.011), (1.497, 33.0, 0.009), (1.51, 35.0, 0.009))]
        cp.tube(p, pts, [0.011, 0.012, 0.009, 0.006, 0.003], "tint_white", w, segs=6, up=UP, start="dome", end="pole")
    cp.finish(p, arm)


def build_bowtie(arm) -> None:
    p = cp.Part("acc_bowtie")
    w = cp.rigid("chest")
    c = V((0.0, 0.086, 1.393))
    cp.blob(p, c, (0.012, 0.011, 0.013), "cloth_red", w, segs=6, rings=4)
    for s in (-1.0, 1.0):
        rot = Matrix.Rotation(math.radians(90 * s), 3, "Y")
        cp.blob(p, c + V((s * 0.03, -0.004, 0.0)), (0.02, 0.009, 0.028), "cloth_red", w, segs=6, rings=4, rot=rot, squareness=0.7)
    cp.finish(p, arm)


def build_pearls(arm) -> None:
    p = cp.Part("acc_pearls")
    w = cp.rigid("chest")
    count = 15
    for i in range(count):
        a = 2.0 * math.pi * i / count
        z = 1.392 - 0.05 * max(0.0, math.cos(a)) ** 2
        cp.blob(p, TORSO.point(z, a, 0.014), (0.0095, 0.0095, 0.0095), "porcelain", w, segs=4, rings=3)
    cp.finish(p, arm)


def build_scarf(arm) -> None:
    p = cp.Part("acc_scarf")
    ring_w = cp.along_z([(1.39, "chest"), (1.45, "neck")])
    path = [V((0.084 * math.sin(a), -0.004 + 0.08 * math.cos(a), 1.41 - 0.01 * math.cos(a))) for a in (2 * math.pi * k / 10 for k in range(10))]
    cp.loop_tube(p, path, (0.032, 0.024), "cloth_mustard", ring_w, segs=6, up=UP)
    for dx, length in ((0.035, 0.22), (0.065, 0.17)):
        def surf(x: float, z: float, g: float) -> Vector:
            return TORSO.front(x, z, g)

        rows = [(1.39 - length * f, dx - 0.026, dx + 0.026) for f in (0.0, 0.35, 0.7, 1.0)]
        front = [[surf(x, z, 0.022) for x, z in row] for row in front_strip(rows, 1)]
        back = [[surf(x, z, 0.010) for x, z in row] for row in front_strip(rows, 1)]
        cp.slab(p, front, back, "cloth_mustard", cp.rigid("chest"))
    cp.finish(p, arm)


# ============================================================================================
# Slips (shown when a disguise slips)
# ============================================================================================


def build_slip_fur(arm) -> None:
    p = cp.Part("slip_fur")
    rnd = cp.seeded("slip_fur")
    collar_w = cp.along_z([(1.38, "chest"), (1.44, "neck")])
    for i in range(13):
        a = 2.0 * math.pi * (i + rnd.uniform(-0.2, 0.2)) / 13
        base = TORSO.point(1.392, a, -0.012)
        out = V((math.sin(a), math.cos(a), 0.0))
        tip = base + (out * 0.85 + UP * rnd.uniform(0.35, 0.8)).normalized() * rnd.uniform(0.06, 0.085)
        cp.cone(p, base, tip, rnd.uniform(0.02, 0.026), "fur_brown", collar_w, segs=4)
    for side in "lr":
        shoulder, _, wrist, _ = R.arm_points(side)
        down = (wrist - shoulder).normalized()
        u, v = cp.frame_for(down, FWD)
        cuff = wrist - down * 0.035
        for i in range(7):
            a = 2.0 * math.pi * (i + rnd.uniform(-0.2, 0.2)) / 7
            radial = u * math.cos(a) + v * math.sin(a)
            base = cuff + radial * 0.035
            tip = base + (down * 0.7 + radial * 0.8).normalized() * rnd.uniform(0.04, 0.055)
            cp.cone(p, base, tip, 0.016, "fur_brown", cp.rigid(f"forearm_{side}"), segs=4)
        s = R.side_sign(side)
        # Pointy ears on top of the head, and tufts on the cheeks.
        base = on_head(1.668, s * 1.05, -0.006)
        tip = base + V((s * 0.04, -0.012, 0.105))
        cp.cone(p, base, tip, 0.04, "fur_brown", cp.rigid("head"), segs=6, up=V((1, 0, 0)), squash=0.45)
        for z, d in ((1.53, 1.15), (1.495, 1.05), (1.465, 0.95)):
            b = on_head(z, s * d, -0.004)
            n = HEAD.normal(z, s * d)
            cp.cone(p, b, b + (n + V((0, 0, -0.5))).normalized() * 0.04, 0.016, "fur_brown", cp.rigid("head"), segs=4)
    cp.finish(p, arm)


def build_slip_fangs(arm) -> None:
    p = cp.Part("slip_fangs")
    for s in (-1.0, 1.0):
        a = s * math.radians(7.0)
        base = on_head(MOUTH_Z + 0.004, a, 0.002)
        cp.cone(p, base, base + V((0, 0.005, -0.03)), 0.0075, "porcelain", cp.rigid("head"), segs=5, up=FWD)
    cp.finish(p, arm)


def cape_weight(co: Vector) -> cp.Weights:
    """Chest at the shoulders down to the hips; the side edges partly follow the upper arms so
    the cape opens like wings when the arms go up."""
    w = cp.along_z([(0.9, "hips"), (1.05, "spine"), (1.12, "spine"), (1.26, "chest")])(co)
    side = "r" if co.x > 0 else "l"
    a = math.atan2(abs(co.x), -co.y)  # 0 at the back center, pi/2 at the side
    arm_k = 0.55 * cp.smoothstep(0.9, 1.45, a) * cp.smoothstep(0.75, 1.15, co.z)
    out = {k: v * (1.0 - arm_k) for k, v in w.items()}
    out[f"upper_arm_{side}"] = arm_k
    return out


def build_slip_cape(arm) -> None:
    p = cp.Part("slip_cape")
    # Cape: around the back from one shoulder to the other, flaring toward the calves.
    a0, a1, cols, rows = math.radians(98), math.radians(262), 10, 6

    def cape(g: float) -> list[list[Vector]]:
        out = []
        for i in range(rows + 1):
            f = i / rows
            z = 1.375 - (1.375 - 0.48) * f
            row = []
            for c in range(cols + 1):
                a = a0 + (a1 - a0) * c / cols
                rx = 0.235 + 0.10 * f + g
                ry = 0.13 + 0.09 * f + g
                row.append(V((rx * math.sin(a), -0.01 + ry * math.cos(a), z - 0.015 * math.sin(math.pi * c / cols) * f)))
            out.append(row)
        return out

    cp.slab(p, cape(0.0), cape(-0.008), "cloth_black", cape_weight, back_color="cape_red")
    # A high collar standing up behind the head.
    b0, b1, ccols = math.radians(118), math.radians(242), 6

    def collar(g: float) -> list[list[Vector]]:
        out = []
        for z, rx, ry in ((1.66, 0.23, 0.20), (1.52, 0.18, 0.165), (1.39, 0.125, 0.095)):
            row = []
            for c in range(ccols + 1):
                a = b0 + (b1 - b0) * c / ccols
                row.append(V(((rx + g) * math.sin(a), -0.01 + (ry + g) * math.cos(a), z)))
            out.append(row)
        return out

    cp.slab(p, collar(0.0), collar(-0.007), "cloth_black", cp.rigid("chest"), back_color="cape_red")
    cp.finish(p, arm)


def build_slip_eyes(arm) -> None:
    p = cp.Part("slip_eyes")
    w = cp.rigid("head")
    for side in "lr":
        base, n = eye_frame(side)
        u, v = cp.frame_for(n, UP)
        rim = cp.ring(base - n * 0.004, u, v, 0.031, 0.027, 10)
        mid = cp.ring(base + n * 0.012, u, v, 0.022, 0.019, 10)
        p.loft([rim, mid, [base + n * 0.0175]], "eye_yellow", w)
        cp.blob(p, base + n * 0.0168, (0.0042, 0.003, 0.016), "eye_dark", w, segs=6, rings=4, rot=cp.axes(u, v))
    cp.finish(p, arm)


# --- Slips for fae, gorgon, mummy, zombie and shapeshifter ----------------------------------
#
# Each has to read from across the table in candlelight, so they lean on silhouette (wings,
# snakes, hanging strips, a dropped jaw, a sagging face) and on pale or vivid palette colors that
# stand apart from the skin tones and the dark disguise colors. They are not tinted. Free-hanging
# sheets are slabs with two sides, since the client culls back faces.


def facing(rows: list[list[Vector]], outward: Vector) -> list[list[Vector]]:
    """Grid rows ordered so the sheet's faces point along `outward` (every row reversed if not)."""
    a, b = rows[0], rows[1]
    n = (a[1] - a[0]).cross(b[0] - a[0])
    return rows if n.dot(outward) >= 0.0 else [list(reversed(r)) for r in rows]


def sheet_slab(p: cp.Part, front: list[list[Vector]], back: list[list[Vector]], outward: Vector, color: cp.Color, w: cp.WeightFn, back_color: cp.Color | None = None, edge_color: str | None = None) -> None:
    """cp.slab with the front grid turned to face `outward` (the back grid follows it)."""
    if facing(front, outward) is not front:
        front = [list(reversed(r)) for r in front]
        back = [list(reversed(r)) for r in back]
    cp.slab(p, front, back, color, w, back_color=back_color, edge_color=edge_color)


def strip(p: cp.Part, path: list[Vector], across: list[Vector], normal: list[Vector], half_width: list[float], color: cp.Color, w: cp.WeightFn, back_color: cp.Color | None = None, thick: float = 0.004) -> None:
    """A loose ribbon with thickness: a point, width direction, face normal and half width per row."""
    t = thick / 2.0
    front = [[c - a * h + n * t, c + a * h + n * t] for c, a, n, h in zip(path, across, normal, half_width)]
    back = [[c - a * h - n * t, c + a * h - n * t] for c, a, n, h in zip(path, across, normal, half_width)]
    sheet_slab(p, front, back, normal[0], color, w, back_color=back_color)


def blot(p: cp.Part, surf, outward: Vector, center: tuple[float, float], radii: tuple[float, float], color: str, inner: str, w: cp.WeightFn, rnd, segs: int = 7) -> None:
    """An irregular round patch on a surface. surf(u, v) -> point already lifted off the surface;
    center and radii are in (u, v). The middle takes `inner`, the rim `color`."""
    u0, v0 = center
    ru, rv = radii
    jitter = [1.0 + rnd.uniform(-0.3, 0.3) for _ in range(segs)]
    phase = rnd.uniform(0.0, 2.0 * math.pi)

    def ring(f: float) -> list[Vector]:
        out = []
        for k, j in enumerate(jitter):
            t = phase + 2.0 * math.pi * k / segs
            out.append(surf(u0 + ru * f * j * math.cos(t), v0 + rv * f * j * math.sin(t)))
        return out

    rings = [[surf(u0, v0)], ring(0.55), ring(1.0)]
    c, r = rings[0][0], rings[1]
    flip = (r[1] - c).cross(r[0] - c).dot(outward) < 0.0
    p.loft(rings, lambda band, seg: inner if band == 0 else color, w, flip=flip)


def feature(p: cp.Part, base: Vector, n: Vector, r_across: float, r_up: float, height: float, color: str, w: cp.WeightFn, tilt: float = 0.0, segs: int = 8) -> None:
    """Like dome(), with the oval turned `tilt` degrees about its normal (eyes on a slid face)."""
    up = Matrix.Rotation(math.radians(tilt), 3, n) @ UP
    u, v = cp.frame_for(n, up)
    rim = cp.ring(base - n * 0.004, u, v, r_up, r_across, segs)
    mid = cp.ring(base + n * (height * 0.62), u, v, r_up * 0.74, r_across * 0.74, segs)
    p.loft([rim, mid, [base + n * height]], color, w)


# Fae ----------------------------------------------------------------------------------------

# (span fraction, leading-edge and trailing-edge half widths as fractions of the chord)
UPPER_WING = [(0.0, 0.07, 0.07), (0.2, 0.17, 0.36), (0.42, 0.26, 0.58), (0.64, 0.3, 0.66), (0.83, 0.26, 0.52), (0.95, 0.15, 0.27), (1.0, 0.03, 0.05)]
LOWER_WING = [(0.0, 0.07, 0.07), (0.3, 0.3, 0.4), (0.62, 0.42, 0.5), (0.88, 0.3, 0.28), (1.0, 0.04, 0.04)]


def wing(p: cp.Part, root: Vector, span: Vector, chord_hint: Vector, length: float, chord: float, shape, color: cp.ColorFn, w: cp.WeightFn, cup: float = 0.018) -> None:
    """One wing as a thin two-sided sheet: rows out along the span, four points across the chord
    (trailing edge to leading edge), cupped a little so the candles catch it."""
    s = span.normalized()
    c = (chord_hint - s * chord_hint.dot(s)).normalized()
    n = s.cross(c)
    if n.y > 0.0:  # cup and curl backward on both sides
        n = -n
    cols = (0.0, 0.4, 0.74, 1.0)

    def sheet(g: float) -> list[list[Vector]]:
        rows = []
        for f, lead, trail in shape:
            row = []
            for k in cols:
                x = -trail + (lead + trail) * k
                bulge = cup * math.sin(math.pi * k) * math.sin(math.pi * min(1.0, f * 1.2))
                row.append(root + s * (length * f) + c * (chord * x) + n * (g + bulge + 0.03 * f * f))
            rows.append(row)
        return rows

    sheet_slab(p, sheet(0.002), sheet(-0.002), n, color, w)


def wing_color(tip_from: int, rim: int):
    """Iridescent membrane: blue-glass at the root, pale in the middle, pink toward the tip, with
    a lilac vein down the leading edge and lilac rims near the tip."""

    def pick(band: int, seg: int) -> str:
        if seg == 2 and band < tip_from + 1:
            return "apron_lilac"
        if band >= rim and seg != 1:
            return "apron_lilac"
        if band < 2:
            return "glass"
        return "icing" if band >= tip_from else "ghost_white"

    return pick


def build_slip_wings(arm) -> None:
    p = cp.Part("slip_wings")
    w = cp.rigid("chest")
    for side in "lr":
        # Roots sit just inside the shoulder blades; the wings sweep a little back so the arms
        # clear them, and stand up past the shoulders so they read beside the head.
        upper_root, upper_span = mirror(V((0.045, -0.1, 1.28)), side), mirror(V((0.62, -0.26, 0.74)), side)
        wing(p, upper_root, upper_span, UP, 0.56, 0.25, UPPER_WING, wing_color(4, 5), w)
        lower_root, lower_span = mirror(V((0.04, -0.1, 1.215)), side), mirror(V((0.9, -0.25, -0.4)), side)
        wing(p, lower_root, lower_span, -UP, 0.36, 0.16, LOWER_WING, wing_color(3, 3), w)
    cp.finish(p, arm)


# Gorgon -------------------------------------------------------------------------------------


def build_slip_snakes(arm) -> None:
    p = cp.Part("slip_snakes")
    w = cp.rigid("head")
    rnd = cp.seeded("slip_snakes")
    for i, deg in enumerate((-150.0, -112.0, -76.0, -42.0, -10.0, 24.0, 58.0, 94.0, 132.0, 170.0)):
        a = math.radians(deg + rnd.uniform(-5.0, 5.0))
        z = wave3(a, 1.676, 1.655, 1.63)
        base, n = on_head(z, a), HEAD.normal(z, a)
        across = V((math.cos(a), -math.sin(a), 0.0))
        wig = 1.0 if i % 2 else -1.0
        out = rnd.uniform(0.85, 1.15)
        rise = rnd.uniform(0.9, 1.15)
        # Out through any hair and up, then over in a hook like a rearing snake: the head looks
        # out, forward and down at the table. Pale belly, darker back.
        p1 = base + n * (0.05 * out) + UP * (0.026 * rise) + across * (0.016 * wig)
        crest = p1 + n * (0.026 * out) + UP * (0.044 * rise) - across * (0.022 * wig)
        look = (n * 0.8 + FWD * 0.45 - UP * 0.4).normalized()
        head = crest + n * 0.026 + FWD * 0.008 + UP * 0.004
        snout = head + look * 0.03
        back = "lettuce" if i % 2 else "soup_green"

        def color(band: int, seg: int, back: str = back) -> str:
            if band == 0 or band == 4:
                return "olive"
            return "leek" if seg in (1, 2) else back

        path = [base - n * 0.006, p1, crest, head, snout]
        cp.tube(p, path, [0.014, 0.0135, 0.01, (0.013, 0.024), (0.008, 0.013)], color, w, segs=4, up=UP, start="open", end="pole")
        cp.cone(p, snout - look * 0.004, snout + look * 0.026, 0.0035, "red_bright", w, segs=3)
    cp.finish(p, arm)


# Mummy --------------------------------------------------------------------------------------

WRAP = ("paper", "cloth_cream")


def wrap_color(band: int, seg: int) -> str:
    return WRAP[seg % 2]


def sleeve_radius(d: float) -> float:
    return _interp(d, [x for x, _ in SLEEVE], [r for _, r in SLEEVE])


def build_slip_bandages(arm) -> None:
    p = cp.Part("slip_bandages")
    for side in "lr":
        s = R.side_sign(side)
        shoulder, _, wrist, _ = R.arm_points(side)
        down = (wrist - shoulder).normalized()
        u, v = cp.frame_for(down, FWD)  # u: thumb side (forward at rest), v: back of the hand (s * v is outward)
        w = cp.nearest([f"forearm_{side}", f"hand_{side}"])

        # A spiral from mid forearm over the cuff and onto the back of the hand.
        rows: list[list[Vector]] = [[], []]
        steps, turns, d0, d1 = 17, 2.1, 0.41, 0.6
        for i in range(steps + 1):
            t = i / steps
            d = d0 + (d1 - d0) * t
            th = s * 2.0 * math.pi * turns * t
            if d <= 0.54:  # just over the thickest sleeve (the cardigan's)
                ru = rv = sleeve_radius(min(d, 0.535)) + 0.011
            else:  # around the hand: an oval, wide across the thumb, thin through the palm
                k = cp.smoothstep(0.54, 0.575, d)
                r0 = sleeve_radius(0.535) + 0.011
                ru, rv = r0 + (0.053 - r0) * k, r0 + (0.033 - r0) * k
            radial = u * (ru * math.cos(th)) + v * (rv * math.sin(th))
            c = shoulder + down * d
            rows[0].append(c + radial - down * 0.019)
            rows[1].append(c + radial + down * 0.019)
        rows = facing(rows, (rows[0][0] - shoulder - down * d0))
        p.grid(rows, wrap_color, w)

        # A loose end peeling off the back of the cuff and curling away from the back of the hand
        # (hanging free when standing, lifting off the hand rather than into the table when seated).
        out = (v * s * 0.85 - u * 0.5).normalized()
        side = down.cross(out)
        path = [shoulder + down * d + out * r + side * (0.008 * math.sin(k * 1.7)) for k, (d, r) in enumerate(((0.5, 0.066), (0.56, 0.084), (0.615, 0.106), (0.66, 0.13), (0.695, 0.148)))]
        across, normal = [], []
        for k, c in enumerate(path):
            t = (path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]).normalized()
            n = (out - t * out.dot(t)).normalized()
            q = Matrix.Rotation(math.radians(s * 16.0 * k), 3, t)
            normal.append(q @ n)
            across.append(q @ t.cross(n))
        strip(p, path, across, normal, [0.02, 0.022, 0.022, 0.02, 0.017], "paper", w, back_color="plaster")

    # Two loose wraps around the neck, over any collar, and an end hanging down the chest.
    for z, rx, ry, tilt in ((1.434, 0.071, 0.069, -0.008), (1.412, 0.083, 0.079, -0.006)):
        def wrap_ring(dz: float, z: float = z, rx: float = rx, ry: float = ry, tilt: float = tilt) -> list[Vector]:
            return [V((rx * math.sin(a), -0.004 + ry * math.cos(a), z + dz + tilt * math.cos(a))) for a in (2.0 * math.pi * k / 12 for k in range(12))]

        p.loft([wrap_ring(0.013), wrap_ring(-0.013)], wrap_color, COLLAR_W)
    # Ends hanging down the chest from the lower wrap: a long one on the left, a short one right.
    for rows in (
        ((1.425, -26.0, 0.03), (1.37, -30.0, 0.034), (1.31, -27.0, 0.032), (1.25, -33.0, 0.03), (1.19, -30.0, 0.032)),
        ((1.422, 30.0, 0.03), (1.37, 36.0, 0.033), (1.315, 33.0, 0.032), (1.27, 39.0, 0.03)),
    ):
        path, across, normal = [], [], []
        for z, deg, g in rows:
            a = math.radians(deg)
            path.append(TORSO.point(z, a, g))
            normal.append(TORSO.normal(z, a))
            across.append(normal[-1].cross(UP).normalized())
        strip(p, path, across, normal, [0.02, 0.021, 0.021, 0.02, 0.018][: len(rows)], "paper", COLLAR_W, back_color="plaster")

    # A band around the head, across the right eye, and a strip trailing off the cheek.
    head = cp.rigid("head")

    def band_z(a: float) -> float:
        return 1.61 - 0.075 * math.cos(a - math.radians(60.0))

    def band_ring(dz: float, g: float) -> list[Vector]:
        out = []
        for k in range(16):
            a = 2.0 * math.pi * k / 16
            out.append(on_head(band_z(a) + dz, a, g + 0.006 * math.sin(a) ** 2))
        return out

    p.loft([band_ring(0.025, 0.007), band_ring(0.0, 0.014), band_ring(-0.025, 0.007)], wrap_color, head)
    a0 = math.radians(64.0)
    start = on_head(band_z(a0) - 0.014, a0, 0.016)
    side_out = V((math.sin(a0), math.cos(a0), 0.0))
    path = [start, start + V((0.004, 0.012, -0.045)), start + V((0.014, 0.028, -0.09)), start + V((0.026, 0.034, -0.128))]
    normal = [(side_out * 0.6 + FWD * 0.8).normalized()] * 4
    across = [n.cross(UP).normalized() for n in normal]
    strip(p, path, across, normal, [0.021, 0.021, 0.02, 0.017], "paper", head, back_color="plaster")
    cp.finish(p, arm)


# Zombie -------------------------------------------------------------------------------------

JAW_HINGE = V((0.0, -0.01, 1.52))
JAW_OPEN = rot_x(-13.0)  # the chin drops about 3 cm


def jaw_point(z: float, a: float, g: float) -> Vector:
    return JAW_HINGE + JAW_OPEN @ (on_head(z, a, g) - JAW_HINGE)


def hand_surface(side: str, grow: float):
    """surf(theta, phi) on the hand blob of build_skin grown by `grow` (theta 0 at the fingertips,
    phi -pi/2 on the back of the hand), and the back-of-hand direction."""
    wrist, d, palm, _ = hand_axes(side)
    c = wrist + d * 0.066
    m = cp.axes(d, palm)
    rx, ry, rz = 0.024 + grow, 0.046 + grow, 0.068 + grow

    def sp(x: float) -> float:
        return math.copysign(abs(x) ** 0.85, x)

    def surf(th: float, ph: float) -> Vector:
        s = sp(math.sin(th))
        return c + m @ V((rx * s * sp(math.sin(ph)), ry * s * sp(math.cos(ph)), sp(math.cos(th)) * rz))

    return surf, -palm


def build_slip_rot(arm) -> None:
    p = cp.Part("slip_rot")
    rnd = cp.seeded("slip_rot")
    head = cp.rigid("head")
    grey, dark = "skin_grey", "olive"

    def face(z: float, a: float) -> Vector:
        return on_head(z, a, 0.0035)

    for z, deg, rz, r_side in ((1.497, -46.0, 0.033, 0.04), (1.607, 27.0, 0.024, 0.033), (1.565, 66.0, 0.02, 0.022)):
        a = math.radians(deg)
        blot(p, face, HEAD.normal(z, a), (z, a), (rz, r_side / 0.13), grey, dark, head, rnd)

    def neck(z: float, a: float) -> Vector:
        return V((0.057 * math.sin(a), -0.004 + 0.057 * math.cos(a), z))

    a = math.radians(38.0)
    blot(p, neck, V((math.sin(a), math.cos(a), 0.0)), (1.428, a), (0.02, 0.6), grey, dark, cp.along_z([(1.37, "chest"), (1.42, "neck"), (1.45, "neck"), (1.49, "head")]), rnd)
    for side in "lr":
        surf, back = hand_surface(side, 0.003)
        w = cp.rigid(f"hand_{side}")
        blot(p, surf, back, (math.pi / 2 - 0.1, -math.pi / 2), (0.55, 0.85), grey, dark, w, rnd, segs=8)
        blot(p, surf, back, (0.5, -math.pi / 2 - 1.3), (0.3, 0.45), grey, grey, w, rnd, segs=6)

    # The slack jaw: the lower face swung open about a hinge by the ears, with a few teeth, and
    # the gap it leaves painted dark over the real mouth.
    cols = [math.radians(d) for d in range(80, -81, -20)]
    zs = (1.49, 1.47, 1.452, 1.437)

    def jaw(g: float) -> list[list[Vector]]:
        return [[jaw_point(z, a, g) for a in cols] for z in zs]

    def jaw_color(band: int, seg: int) -> str:
        return dark if band == 1 and seg in (2, 5) else grey

    sheet_slab(p, jaw(0.007), jaw(0.001), FWD, jaw_color, head, edge_color="wine")
    for deg in (-21.0, -7.0, 7.0, 21.0):
        a = math.radians(deg)
        b = jaw_point(1.49, a, 0.003)
        cp.cone(p, b - JAW_OPEN @ UP * 0.006, b + JAW_OPEN @ UP * 0.012, 0.0055, "porcelain", head, segs=3)
    gap_cols = [math.radians(d) for d in (56, 42, 28, 14, 0, -14, -28, -42, -56)]
    top, bottom = [], []
    for a in gap_cols:
        pinch = cp.smoothstep(30.0, 56.0, abs(math.degrees(a)))
        z_jaw = jaw_point(1.49, a, 0.007).z - 0.004
        z_top = 1.489
        top.append(on_head(z_top, a, 0.007))
        bottom.append(on_head(z_jaw + (z_top - 0.002 - z_jaw) * pinch, a, 0.007))
    p.grid(facing([top, bottom], FWD), "eye_dark", head)
    cp.finish(p, arm)


# Shapeshifter -------------------------------------------------------------------------------

MELT_HANG = 1.47  # below this the shell stops following the face and sags
MELT_DEG = (-72.0, -48.0, -24.0, 0.0, 24.0, 48.0, 72.0)
MELT_BOTTOM = (1.49, 1.435, 1.39, 1.41, 1.375, 1.43, 1.485)  # per column: an uneven, dripping hem
MELT_DRIPS = ((-24.0, 0.05), (24.0, 0.066), (-48.0, 0.034))  # (column, length) of wax runs below the hem


def melt_top(a: float) -> float:
    """Top edge of the shell: under the nose in the middle, below the eyes either side, wavy."""
    return 1.488 + 0.05 * cp.smoothstep(0.0, math.radians(50.0), abs(a)) + 0.005 * math.sin(5.0 * a)


def melt_bottom(a: float) -> float:
    return _interp(math.degrees(a), list(MELT_DEG), list(MELT_BOTTOM))


def melt_grow(f: float) -> float:
    """How far the shell's outer face stands off the face: tucked in at the top edge, sagging out
    in the middle."""
    return 0.003 + 0.009 * cp.smoothstep(0.0, 0.35, f) + 0.006 * math.sin(math.pi * min(1.0, f))


def melt_point(a: float, z: float, g: float) -> Vector:
    if z >= MELT_HANG:
        return on_head(z, a, g)
    base = on_head(MELT_HANG, a, g)
    out = HEAD.normal(MELT_HANG, a)
    out.z = 0.0
    return base + out.normalized() * (0.35 * (MELT_HANG - z)) + V((0.0, 0.0, z - MELT_HANG))


def melt_frame(a: float, z: float) -> tuple[Vector, Vector]:
    """Point on the outer face of the shell and its outward normal."""
    top = melt_top(a)
    g = melt_grow((top - z) / (top - melt_bottom(a)))
    e = 0.002
    pt = melt_point(a, z, g)
    da = melt_point(a + e / 0.13, z, g) - pt
    dz = melt_point(a, z + e, g) - pt
    return pt, da.cross(dz).normalized()


def build_slip_melt(arm) -> None:
    p = cp.Part("slip_melt")
    w = cp.rigid("head")
    cols = [math.radians(d) for d in MELT_DEG]

    def shell(dg: float) -> list[list[Vector]]:
        rows = []
        for f in (0.0, 0.25, 0.5, 0.75, 1.0):
            rows.append([melt_point(a, melt_top(a) + (zb - melt_top(a)) * f, melt_grow(f) + dg) for a, zb in zip(cols, MELT_BOTTOM)])
        return rows

    def wax(band: int, seg: int) -> str:
        """Pale wax that yellows where it runs (so it never reads as a flat-colored beard)."""
        return "cake" if band == 3 or (band == 2 and seg in (2, 4)) else "candle"

    sheet_slab(p, shell(0.0), shell(-0.006), FWD, wax, w, edge_color="cake")
    for deg, length in MELT_DRIPS:
        a = math.radians(deg)
        top = melt_point(a, melt_bottom(a) + 0.016, melt_grow(0.9) - 0.003)
        cp.tube(p, [top, top + V((0.0, 0.006, -0.016 - length))], [0.012, 0.0095], "cake", w, segs=5, start="pole", end="dome", dome_steps=(55.0,))
    # The second face, slid down and to the guest's left and tilted: dark eye holes with yellow
    # pinpoints (they read against the pale wax at any distance) and a gaping mouth.
    for deg, z, tilt in ((-35.0, 1.487, -16.0), (15.0, 1.46, -12.0)):
        base, n = melt_frame(math.radians(deg), z)
        feature(p, base, n, 0.022, 0.031, 0.003, "eye_dark", w, tilt)
        u, _ = cp.frame_for(n, Matrix.Rotation(math.radians(tilt), 3, n) @ UP)
        cp.stud(p, base + n * 0.002 - u * 0.009, n, 0.0075, 0.003, "eye_yellow", w, segs=6)
    base, n = melt_frame(math.radians(-18.0), 1.427)
    feature(p, base, n, 0.05, 0.022, 0.003, "wine", w, -14.0, segs=10)
    feature(p, base + n * 0.0015, n, 0.042, 0.014, 0.005, "eye_dark", w, -14.0, segs=10)
    cp.finish(p, arm)


# ============================================================================================
# Sockets
# ============================================================================================


def build_sockets(arm) -> None:
    R.socket(arm, "socket_hat", "head", V((0.0, 0.0, R.HEAD_TOP)))
    R.socket(arm, "socket_tell", "head", V((0.0, 0.0, R.HEAD_TOP + 0.30)))
    _, d, palm, _ = hand_axes("r")
    # Socket axes: Z out of the palm, Y along the fingers (Three.js: +Y out of the palm, -Z along
    # the fingers), so a prop resting on an upturned palm stands upright.
    rot = Matrix((d.cross(palm), d, palm)).transposed()
    R.socket(arm, "socket_hand_r", "hand_r", palm_center("r"), rot)


# ============================================================================================
# Animation
# ============================================================================================
#
# Every clip is a function t in [0, 1] -> parameter dict -> Pose. Parameters are plain floats
# and Vectors so key poses can be interpolated. Angles are (forward, right tilt, right turn) in
# degrees. Wrist and ankle targets are in armature space (character frame, meters).

ANKLE = R.ANKLE_Z
TAU = 2.0 * math.pi


def ang(fwd: float = 0.0, right: float = 0.0, turn: float = 0.0) -> Vector:
    return V((fwd, right, turn))


def arm_params(side: str, wrist: Vector, elbow: Vector, fingers: Vector, palm: Vector) -> dict:
    """Arm by IK. Vectors are given for the right arm and mirrored for the left."""
    return {f"wrist_{side}": mirror(wrist, side), f"elbow_{side}": mirror(elbow, side), f"fingers_{side}": mirror(fingers, side), f"palm_{side}": mirror(palm, side)}


def leg_params(side: str, ankle: Vector, knee: Vector, toe_up: float = 0.0, turn_out: float = 7.0) -> dict:
    return {f"ankle_{side}": mirror(ankle, side), f"knee_{side}": mirror(knee, side), f"toe_{side}": toe_up, f"turn_{side}": turn_out * R.side_sign(side)}


def both(fn, *args, **kw) -> dict:
    d = fn("r", *args, **kw)
    d.update(fn("l", *args, **kw))
    return d


RELAXED_ARM = (V((0.243, 0.03, 0.815)), V((0.5, -1.0, 0.0)), V((0.08, 0.12, -1.0)), V((-1.0, 0.12, 0.0)))
STAND_LEG = (V((0.10, 0.0, ANKLE)), V((0.12, 1.0, 0.0)))


def standing() -> dict:
    d = {
        "offset": V((0.0, 0.0, -0.012)),
        "hips": ang(),
        "spine": ang(1.0),
        "chest": ang(),
        "neck": ang(-1.0),
        "head": ang(),
    }
    d.update(both(arm_params, *RELAXED_ARM))
    d.update(both(leg_params, *STAND_LEG))
    return d


SIT_HIPS = V((0.0, -0.03, 0.545 - R.HIP_Z))
TABLE_HAND = (V((0.16, 0.37, 0.812)), V((1.0, -0.5, -0.6)), V((-0.35, 1.0, -0.08)), V((0.0, 0.05, -1.0)))


def seated() -> dict:
    d = {
        "offset": SIT_HIPS.copy(),
        "hips": ang(-8.0),
        "spine": ang(10.0),
        "chest": ang(3.0),
        "neck": ang(-2.0),
        "head": ang(-1.0),
    }
    d.update(both(arm_params, *TABLE_HAND))
    d.update(both(leg_params, V((0.115, 0.39, ANKLE)), V((0.05, 0.6, 0.8)), 0.0, 6.0))
    return d


def body(d: dict) -> R.Pose:
    p = R.Pose(offset=V(d["offset"]))
    for bone in ("hips", "spine", "chest", "neck", "head"):
        a = d[bone]
        p.rel[bone] = lean(a[0], a[1], a[2])
    if "head_world" in d:
        a = d["head_world"]
        p.world["head"] = lean(a[0], a[1], a[2])
    for side in "lr":
        if f"upper_{side}" in d:
            p.aim[f"upper_arm_{side}"] = V(d[f"upper_{side}"])
            p.aim[f"forearm_{side}"] = V(d[f"fore_{side}"])
        else:
            p.reach[f"arm_{side}"] = (V(d[f"wrist_{side}"]), V(d[f"elbow_{side}"]))
        palm = V(d[f"palm_{side}"])
        p.frame[f"hand_{side}"] = (V(d[f"fingers_{side}"]), palm if side == "r" else -palm)
        p.reach[f"leg_{side}"] = (V(d[f"ankle_{side}"]), V(d[f"knee_{side}"]))
        p.world[f"foot_{side}"] = lean(-d[f"toe_{side}"], 0.0, d[f"turn_{side}"])
    return p


# --- Interpolation --------------------------------------------------------------------------


def _lerp(a, b, t: float):
    return a + (b - a) * t


def _cr(p0, p1, p2, p3, u: float):
    u2, u3 = u * u, u * u * u
    return (p1 * 2.0 + (p2 - p0) * u + (p0 * 2.0 - p1 * 5.0 + p2 * 4.0 - p3) * u2 + (p1 * 3.0 - p0 - p2 * 3.0 + p3) * u3) * 0.5


def track(t: float, keys: list[tuple[float, object]], loop: bool):
    """Value at t from (time, value) keys spanning 0..1. Loops use a closed Catmull-Rom spline
    (first and last keys must match); one-shots ease in and out of every key."""
    t = min(1.0, max(0.0, t))
    i = 0
    while i < len(keys) - 2 and t > keys[i + 1][0]:
        i += 1
    (t0, v0), (t1, v1) = keys[i], keys[i + 1]
    u = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
    if not loop:
        return _lerp(v0, v1, cp.smoothstep(0.0, 1.0, u))
    m = len(keys) - 1
    vals = [k[1] for k in keys[:-1]]
    return _cr(vals[(i - 1) % m], vals[i % m], vals[(i + 1) % m], vals[(i + 2) % m], u)


def blend(a: dict, b: dict, t: float) -> dict:
    return {k: _lerp(a[k], b[k], t) for k in a}


def track_dict(t: float, keys: list[tuple[float, dict]], loop: bool) -> dict:
    names = keys[0][1].keys()
    return {n: track(t, [(kt, kd[n]) for kt, kd in keys], loop) for n in names}


def with_(d: dict, **over) -> dict:
    out = dict(d)
    out.update(over)
    return out


def sw(t: float, k: float = 1.0, phase: float = 0.0) -> float:
    """sin(2 pi (k t + phase)): loops seamlessly for whole k."""
    return math.sin(TAU * (k * t + phase))


# --- Standing clips -------------------------------------------------------------------------


def idle(t: float) -> R.Pose:
    d = standing()
    d["offset"] = V((0.006 * sw(t), 0.0, -0.012 + 0.002 * sw(t, 2)))
    d["hips"] = ang(0.0, -1.2 * sw(t))
    d["spine"] = ang(1.0, 1.0 * sw(t))
    d["chest"] = ang(-0.9 * sw(t, 1, 0.15))
    d["head"] = ang(1.5 * sw(t, 2, 0.1), 1.5 * sw(t, 1, 0.3), 6.0 * sw(t))
    for side, ph in (("r", 0.0), ("l", 0.4)):
        wrist = RELAXED_ARM[0] + V((0.0, 0.008 * sw(t, 1, ph), 0.004 * sw(t, 1, ph + 0.25)))
        d.update(arm_params(side, wrist, *RELAXED_ARM[1:]))
    return body(d)


def pivot_foot(flat: Vector, toe_up: float) -> Vector:
    """Ankle position when the foot rolls by toe_up degrees about its heel (toes up) or the ball
    of the foot (heel up), starting flat with the ankle at `flat`."""
    if abs(toe_up) < 1e-6:
        return flat.copy()
    pivot = flat + (V((0.0, -0.05, -ANKLE)) if toe_up > 0 else V((0.0, 0.12, -ANKLE)))
    return pivot + rot_x(toe_up) @ (flat - pivot)


def hermite(p0: float, m0: float, p1: float, m1: float, u: float) -> float:
    u2, u3 = u * u, u * u * u
    return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1


def gait(phase: float, x: float, stride: float, stance: float, lift: float, y_front: float, toe_off: float, heel: float, lift_peak: float = 0.5) -> tuple[Vector, float]:
    """Ankle target and toe pitch for one foot of an in-place gait. The planted foot slides back
    at stride / cycle so it stays put when the root moves forward at that speed."""
    y_back = y_front - stride * stance

    def planted(q: float) -> tuple[Vector, float]:
        y = y_front + (y_back - y_front) * q
        if q < 0.18:
            a = heel * (1.0 - cp.smoothstep(0.0, 0.18, q))
        elif q > 0.62:
            a = -toe_off * cp.smoothstep(0.62, 1.0, q)
        else:
            a = 0.0
        return pivot_foot(V((x, y, ANKLE)), a), a

    ph = phase % 1.0
    if ph < stance:
        return planted(ph / stance)
    q = (ph - stance) / (1.0 - stance)
    (p0, a0), (p1, a1) = planted(1.0), planted(0.0)
    m = (y_back - y_front) / stance * (1.0 - stance) * 0.55
    y = hermite(p0.y, m, p1.y, m, q)
    qz = q ** (math.log(0.5) / math.log(lift_peak))
    z = _lerp(p0.z, p1.z, q) + lift * math.sin(math.pi * qz)
    a = _lerp(a0, a1, cp.smoothstep(0.0, 1.0, q))
    return V((x, y, z)), a


def swing_arm(d: dict, side: str, swing: float, bend: float, curl: float, splay: float = 7.0) -> None:
    """Arm by forward kinematics: swing (degrees forward from hanging), elbow bend, finger curl."""
    s = R.side_sign(side)
    hang = V((s * math.sin(math.radians(splay)), 0.0, -math.cos(math.radians(splay))))
    d[f"upper_{side}"] = rot_x(swing) @ hang
    d[f"fore_{side}"] = rot_x(swing + bend) @ hang
    d[f"fingers_{side}"] = rot_x(swing + bend + curl) @ hang
    d[f"palm_{side}"] = V((-s, 0.1, 0.0))


WALK_STRIDE = 1.4  # meters per 1 s cycle: feet stay planted when the root moves at 1.4 m/s
RUN_STRIDE = 1.8  # meters per 0.667 s cycle: 2.7 m/s


def walk(t: float) -> R.Pose:
    d = standing()
    c = math.cos(TAU * t)
    d["offset"] = V((0.012 * sw(t), 0.0, (0.862 - 0.013 * math.cos(2 * TAU * (t - 0.03))) - R.HIP_Z))
    d["hips"] = ang(2.0, -3.0 * sw(t), -5.0 * c)
    d["spine"] = ang(3.0, 1.5 * sw(t), 3.0 * c)
    d["chest"] = ang(1.0 - 0.8 * math.cos(2 * TAU * t), 0.0, 5.0 * c)
    d["neck"] = ang(-1.0)
    d["head_world"] = ang(1.5 + 1.0 * math.cos(2 * TAU * t), 0.0, 0.0)
    for side, ph in (("r", t), ("l", t + 0.5)):
        s = R.side_sign(side)
        ankle, toe = gait(ph, 0.10 * s, WALK_STRIDE, 0.55, 0.095, 0.32, 28.0, 14.0, 0.45)
        d[f"ankle_{side}"], d[f"toe_{side}"] = ankle, toe
        d[f"knee_{side}"] = V((0.1 * s, 1.0, 0.1))
        d[f"turn_{side}"] = 4.0 * s
    swing_r = -18.0 * c + 3.0
    swing_l = 18.0 * c + 3.0
    for side, swing in (("r", swing_r), ("l", swing_l)):
        swing_arm(d, side, swing, 16.0 + 14.0 * max(0.0, swing) / 21.0, 12.0)
    return body(d)


def run(t: float) -> R.Pose:
    d = standing()
    c = math.cos(TAU * t)
    d["offset"] = V((0.008 * sw(t), 0.0, (0.845 - 0.025 * math.cos(2 * TAU * (t - 0.18))) - R.HIP_Z))
    d["hips"] = ang(7.0, -3.0 * sw(t), -8.0 * c)
    d["spine"] = ang(4.0, 1.5 * sw(t), 5.0 * c)
    d["chest"] = ang(3.0, 0.0, 7.0 * c)
    d["neck"] = ang(-6.0)
    d["head_world"] = ang(2.0 + 1.5 * math.cos(2 * TAU * (t - 0.18)), 0.0, 0.0)
    for side, ph in (("r", t), ("l", t + 0.5)):
        s = R.side_sign(side)
        ankle, toe = gait(ph, 0.09 * s, RUN_STRIDE, 0.36, 0.25, 0.24, 35.0, 6.0, 0.4)
        d[f"ankle_{side}"], d[f"toe_{side}"] = ankle, toe
        d[f"knee_{side}"] = V((0.08 * s, 1.0, 0.2))
        d[f"turn_{side}"] = 3.0 * s
    for side, swing in (("r", -30.0 * c - 2.0), ("l", 30.0 * c - 2.0)):
        swing_arm(d, side, swing, 82.0 + 8.0 * max(0.0, swing) / 30.0, 40.0, splay=12.0)
    return body(d)


def crouch(t: float) -> R.Pose:
    d = standing()
    b = sw(t)
    d["offset"] = V((0.0, -0.085, -0.432 + 0.004 * b))
    d["hips"] = ang(27.0)
    d["spine"] = ang(8.0 - 1.0 * b)
    d["chest"] = ang(6.0 - 1.0 * b)
    d["neck"] = ang(-16.0)
    d["head"] = ang(-20.0 + 1.0 * b, 0.0, 8.0 * sw(t, 1, 0.1))
    d.update(both(leg_params, V((0.15, 0.05, ANKLE)), V((0.4, 1.0, 0.3)), 0.0, 14.0))
    d.update(both(arm_params, V((0.18, 0.31, 0.60 + 0.004 * b)), V((0.8, -0.6, -0.2)), V((-0.25, 0.6, -0.8)), V((-0.4, 0.1, -1.0))))
    return body(d)


def stand_wait(t: float) -> R.Pose:
    d = standing()
    d["offset"] = V((0.008 * sw(t), 0.0, -0.012))
    d["hips"] = ang(0.0, -1.0 * sw(t))
    d["spine"] = ang(-0.5, 0.8 * sw(t))
    d["chest"] = ang(-1.5 - 0.8 * sw(t, 1, 0.15))
    d["head"] = ang(3.0 + 1.5 * sw(t, 2), 3.0 + 2.0 * sw(t, 1, 0.2), 4.0 * sw(t, 1, 0.6))
    bob = V((0.0, 0.0, 0.004 * sw(t, 1, 0.15)))
    d.update(arm_params("r", V((0.05, 0.176, 0.905)) + bob, V((1.0, -0.5, -0.3)), V((-0.55, 0.05, -0.83)), V((0.0, -1.0, -0.1))))
    d.update(arm_params("l", V((0.05, 0.148, 0.897)) + bob, V((1.0, -0.5, -0.3)), V((-0.55, 0.05, -0.83)), V((0.0, -1.0, -0.1))))
    return body(d)


def carry(t: float) -> R.Pose:
    d = standing()
    b = sw(t)
    d["offset"] = V((0.004 * b, -0.006, -0.014))
    d["hips"] = ang(-2.0, -0.8 * b)
    d["chest"] = ang(-3.0 - 0.8 * sw(t, 1, 0.15))
    d["head"] = ang(5.0, 0.0, 4.0 * sw(t, 1, 0.3))
    hold = V((0.0, 0.0, 0.004 * sw(t, 1, 0.2)))
    d.update(both(arm_params, V((0.15, 0.29, 1.12)) + hold, V((0.7, -1.0, -0.4)), V((-0.2, 1.0, 0.1)), V((-0.35, 0.0, 1.0))))
    return body(d)


def hold_up(t: float) -> R.Pose:
    d = standing()
    b = sw(t)
    d["offset"] = V((0.008 * b, 0.0, -0.012))
    d["hips"] = ang(0.0, -1.0 * b)
    d["spine"] = ang(-1.0, 1.0 * b)
    d["chest"] = ang(-3.0)
    d["neck"] = ang(-4.0)
    d["head"] = ang(-10.0, 0.0, 3.0 * sw(t, 1, 0.3))
    wob = V((0.012 * sw(t, 1, 0.1), 0.0, 0.006 * sw(t, 2)))
    d.update(arm_params("r", V((0.18, 0.06, 1.82)) + wob, V((1.0, -0.2, -0.3)), V((-0.75, -0.3, 0.25)), V((0.0, 0.05, 1.0))))
    d.update(arm_params("l", V((0.18, 0.06, 1.82)) + mirror(wob, "l"), V((1.0, -0.2, -0.3)), V((-0.75, -0.3, 0.25)), V((0.0, 0.05, 1.0))))
    return body(d)


def wave(t: float) -> R.Pose:
    d = standing()
    d["offset"] = V((-0.008, 0.0, -0.012))
    d["hips"] = ang(0.0, 1.0)
    d["spine"] = ang(0.0, -2.5)
    d["chest"] = ang(-1.0, -2.0)
    d["head"] = ang(-2.0, 6.0 + 2.0 * sw(t), 8.0)
    flick = 24.0 * sw(t, 2)
    d["upper_r"] = V((0.72, 0.18, 0.67))
    fore = Matrix.Rotation(math.radians(14.0 + flick), 3, "Y") @ V((0.0, 0.12, 1.0))
    d["fore_r"] = fore
    d["fingers_r"] = Matrix.Rotation(math.radians(8.0 + flick * 0.5), 3, "Y") @ V((0.0, 0.10, 1.0))
    d["palm_r"] = V((0.0, 1.0, -0.1))
    return body(d)


# --- Seated clips ---------------------------------------------------------------------------


def sit_idle(t: float) -> R.Pose:
    d = seated()
    d["chest"] = ang(3.0 - 1.0 * sw(t))
    d["spine"] = ang(10.0, 0.8 * sw(t))
    d["head"] = ang(-1.0 - 2.0 * sw(t, 2), 1.5 * sw(t), 14.0 * sw(t))
    d.update(arm_params("r", TABLE_HAND[0] + V((0.0, 0.012 * sw(t), 0.0)), *TABLE_HAND[1:]))
    return body(d)


def sit_talk(t: float) -> R.Pose:
    base = seated()
    table_r, table_l = base["wrist_r"], base["wrist_l"]
    right = [(0.0, table_r), (0.12, V((0.23, 0.33, 0.95))), (0.25, V((0.20, 0.38, 0.90))), (0.38, V((0.25, 0.31, 1.00))),
             (0.52, V((0.19, 0.36, 0.87))), (0.66, V((0.22, 0.34, 0.97))), (0.82, V((0.17, 0.37, 0.83))), (1.0, table_r)]  # fmt: skip
    left = [(0.0, table_l), (0.3, table_l), (0.45, V((-0.24, 0.31, 0.96))), (0.6, V((-0.21, 0.34, 0.92))), (0.76, table_l), (1.0, table_l)]
    d = dict(base)
    for side, keys in (("r", right), ("l", left)):
        s = R.side_sign(side)
        wrist = track(t, keys, True)
        lift = cp.smoothstep(0.83, 0.94, wrist.z)
        d[f"wrist_{side}"] = wrist
        d[f"fingers_{side}"] = mirror(_lerp(V((-0.35, 1.0, -0.08)), V((0.25, 0.9, 0.35)), lift), side)
        d[f"palm_{side}"] = mirror(_lerp(V((0.0, 0.05, -1.0)), V((-0.6, 0.15, 0.8)), lift), side)
        d[f"elbow_{side}"] = V((s, -0.5, -0.6))
    d["spine"] = ang(10.0 + 3.0 * (0.5 - 0.5 * math.cos(2 * TAU * t)), 1.0 * sw(t))
    d["chest"] = ang(3.0, 0.0, 6.0 * sw(t))
    d["head"] = ang(-1.0 + 3.0 * sw(t, 5), 2.0 * sw(t, 1, 0.25), 14.0 * sw(t))
    return body(d)


MOUTH_REST = HEAD.point(MOUTH_Z, 0.0)


def sit_eat_keys(solver: R.Solver) -> list[tuple[float, dict]]:
    """Fork from the plate to the mouth and back. The mouth position comes from solving the
    leaning-in pose, so the hand lands on it."""
    base = seated()
    bite = with_(base, spine=ang(14.0), chest=ang(5.0), head=ang(4.0))
    solver.solve(body(bite))
    mouth = solver.point("head", MOUTH_REST)
    to_mouth = V((-0.35, -0.45, 0.82)).normalized()
    at_mouth = {"wrist_r": mouth - to_mouth * 0.125, "fingers_r": to_mouth, "palm_r": V((-0.75, 0.55, -0.1))}
    plate = {"wrist_r": V((0.13, 0.46, 0.83)), "fingers_r": V((-0.15, 0.75, -0.65)), "palm_r": V((-0.3, 0.1, -0.95))}
    scoop = with_(plate, wrist_r=V((0.11, 0.48, 0.822)))
    lift = {"wrist_r": V((0.12, 0.38, 0.93)), "fingers_r": V((-0.25, 0.4, 0.6)), "palm_r": V((-0.7, 0.2, -0.5))}

    def key(hand: dict, lean_in: float) -> dict:
        d = with_(base, **hand)
        d["spine"] = ang(10.0 + 4.0 * lean_in)
        d["chest"] = ang(3.0 + 2.0 * lean_in)
        d["head"] = ang(-1.0 + 5.0 * lean_in)
        d["elbow_r"] = V((1.0, -0.4, -0.8))
        return d

    return [(0.0, key(plate, 0.0)), (0.12, key(scoop, 0.0)), (0.24, key(lift, 0.5)), (0.38, key(at_mouth, 1.0)),
            (0.55, key(at_mouth, 0.8)), (0.70, key(lift, 0.3)), (0.85, key(plate, 0.0)), (1.0, key(plate, 0.0))]  # fmt: skip


def make_sit_eat(solver: R.Solver):
    keys = sit_eat_keys(solver)

    def sit_eat(t: float) -> R.Pose:
        d = track_dict(t, keys, True)
        chew = 2.0 * math.sin(TAU * 8.0 * t) * cp.smoothstep(0.38, 0.45, t) * (1.0 - cp.smoothstep(0.8, 0.9, t))
        d["head"] = d["head"] + ang(chew, 0.0, 6.0 * sw(t))
        return body(d)

    return sit_eat


def sit_flinch(t: float) -> R.Pose:
    base = seated()
    peak = with_(
        base,
        offset=base["offset"] + V((0.0, -0.02, 0.01)),
        hips=ang(-10.0),
        spine=ang(4.0, 0.0, -5.0),
        chest=ang(-1.0, 0.0, -6.0),
        neck=ang(-6.0),
        head=ang(-10.0, 6.0, -16.0),
    )
    peak.update(both(arm_params, V((0.17, 0.27, 0.98)), V((1.0, -0.6, -0.4)), V((-0.2, 0.25, 1.0)), V((0.0, 1.0, 0.2))))
    k = track(t, [(0.0, 0.0), (0.16, 1.0), (0.42, 0.55), (1.0, 0.0)], False)
    return body(blend(base, peak, k))


def slip(t: float) -> R.Pose:
    base = seated()
    hunch = with_(base, offset=base["offset"] + V((0.0, 0.02, 0.0)), spine=ang(24.0), chest=ang(10.0), neck=ang(8.0), head=ang(14.0))
    hunch.update(both(arm_params, V((0.12, 0.25, 0.84)), V((1.0, -0.6, -0.6)), V((-0.4, 0.4, 0.8)), V((-1.0, 0.0, 0.0))))
    burst = with_(base, offset=base["offset"] + V((0.0, 0.04, 0.07)), hips=ang(-10.0), spine=ang(2.0), chest=ang(-6.0), neck=ang(-8.0), head=ang(-24.0))
    burst.update(both(arm_params, V((0.36, 0.10, 1.50)), V((1.0, 0.0, -0.4)), V((0.45, 0.15, 0.9)), V((0.0, 1.0, 0.2))))
    settle = blend(base, hunch, 0.3)
    d = track_dict(t, [(0.0, base), (0.12, hunch), (0.28, burst), (0.66, burst), (0.82, settle), (1.0, base)], False)
    shake = cp.smoothstep(0.26, 0.32, t) * (1.0 - cp.smoothstep(0.6, 0.68, t))
    d["spine"] = d["spine"] + ang(1.5 * math.sin(TAU * 10.0 * t) * shake)
    d["head"] = d["head"] + ang(0.0, 0.0, 3.0 * math.sin(TAU * 7.0 * t) * shake)
    for side, ph in (("r", 0.0), ("l", 0.5)):
        d[f"wrist_{side}"] = d[f"wrist_{side}"] + V((0.0, 0.01, 0.012)) * (math.sin(TAU * (12.0 * t + ph)) * shake)
    return body(d)


# name, frames at 24 fps, loops, pose function (or a factory taking the solver)
CLIPS = [
    ("idle", 72, True, idle),
    ("walk", 24, True, walk),
    ("run", 16, True, run),
    ("crouch", 48, True, crouch),
    ("stand_wait", 72, True, stand_wait),
    ("sit_idle", 72, True, sit_idle),
    ("sit_talk", 72, True, sit_talk),
    ("sit_eat", 48, True, make_sit_eat),
    ("sit_flinch", 15, False, sit_flinch),
    ("slip", 36, False, slip),
    ("carry", 48, True, carry),
    ("hold_up", 48, True, hold_up),
    ("wave", 24, True, wave),
]


def build_clips(arm) -> None:
    solver = R.Solver(arm)
    for name, frames, loop, fn in CLIPS:
        pose_at = fn(solver) if fn is make_sit_eat else fn
        R.bake_clip(arm, solver, name, frames, pose_at, loop)


# ============================================================================================


def build() -> None:
    import bpy

    bpy.context.scene.render.fps = R.FPS
    bpy.context.scene.render.fps_base = 1.0
    arm = R.create_armature()
    for part in (
        build_skin, build_face,
        build_suit, build_dress, build_cardigan, build_host_shirt, build_apron, build_shoes,
        build_hair_short, build_hair_long, build_hair_bun, build_hair_slick,
        build_glasses, build_sunglasses, build_moustache, build_monocle, build_bowtie, build_pearls, build_scarf,
        build_slip_fur, build_slip_fangs, build_slip_cape, build_slip_eyes,
        build_slip_wings, build_slip_snakes, build_slip_bandages, build_slip_rot, build_slip_melt,
    ):  # fmt: skip
        part(arm)
    build_sockets(arm)
    build_clips(arm)
    bpy.context.scene.frame_set(0)
