"""The catering van "Hollow & Co.": a boxy, rounded panel van, 4.8 L x 2.0 W x 2.3 H (2.7 with
the silver cloche on its roof), van_white with an apron_teal stripe, dark windows, and its rear
doors swung open on a cargo bay of produce crates. The front faces +Y; `location` is the center of
its footprint on the ground. The lobby is this van with the doors open.

Params: body, stripe (palette colors), door_angle (rest swing of the rear doors, radians, 1.83 =
105 deg; 0 = closed), crates (bool).
Meshes: {prefix}_body; {prefix}_door_l / {prefix}_door_r: the rear doors, modeled closed, with
their origins on the hinge axes (local x -0.835 / +0.835, y -2.43) and resting open at
-door_angle / +door_angle about Z: set rotation.z to 0 to close them. {prefix}_sign_l /
{prefix}_sign_r: cream sign panels on the cargo sides (1.5 x 0.62 m, facing out), each with a
second UV map "board" (0..1, reading upright from outside; palette UV map first) for drawing the
"Hollow & Co." logo with a CanvasTexture.
Colliders: cab, cargo floor, cargo walls and roof, both open doors, and the crates (the cargo bay
is hollow: players can climb in at the back, floor 0.6 m up).
"""

from __future__ import annotations

import math

import bpy

from .. import prims
from ._piece import Piece

REAR, FRONT = -2.4, 2.4
HALF_W = 1.0
ROOF = 2.3
BOTTOM = 0.42
CARGO_FRONT = 0.7
CAB_BACK = 0.65
CORNER = 0.12  # body edge rounding
WALL = 0.06
INNER = HALF_W - CORNER - WALL  # half width of the cargo opening (0.82)
FLOOR = BOTTOM + CORNER + WALL  # cargo floor (0.6)
HINGE_X, HINGE_Y = INNER + 0.015, REAR - 0.03
DOOR_W, DOOR_T = INNER + 0.01, 0.05
DOOR_Z0, DOOR_Z1 = FLOOR - 0.04, ROOF - CORNER - WALL + 0.04
WHEEL_R, WHEEL_W = 0.37, 0.26
AXLES = (1.72, -1.5)


def _arch(p: Piece, y: float, side: int) -> None:
    """Dark wheel-arch shadow on the body side above a wheel."""
    r, cz = WHEEL_R + 0.09, WHEEL_R
    t0 = math.asin((BOTTOM - cz) / r)
    steps = 9
    outline = []
    for i in range(steps):
        t = t0 + (math.pi - 2 * t0) * i / (steps - 1)
        outline.append((y + r * math.cos(t), cz + r * math.sin(t)))
    p.prism(outline, 0.02, (side * (HALF_W + 0.005), 0.0, 0.0), "tire")


def _door(p: Piece, side: int, angle: float, body: str, stripe: str) -> None:
    """side -1 = left door (hinged at -x), +1 = right door (hinged at +x)."""
    hx = side * HINGE_X
    g = p.group("door_l" if side < 0 else "door_r", origin=(hx, HINGE_Y, 0.0), rot_z=side * angle)
    cx = hx - side * (DOOR_W / 2.0 + 0.004)
    h = DOOR_Z1 - DOOR_Z0
    out = HINGE_Y - DOOR_T / 2.0
    g.box((DOOR_W, DOOR_T, h), (cx, HINGE_Y, DOOR_Z0 + h / 2.0), body, bevel=0.02)
    g.box((DOOR_W - 0.24, 0.012, 0.42), (cx, out - 0.004, DOOR_Z1 - 0.34), "glass_dark")
    g.box((DOOR_W, 0.012, 0.13), (cx, out - 0.004, 1.1), stripe)
    g.box((0.035, 0.03, 0.14), (hx - side * (DOOR_W - 0.07), out - 0.015, 1.3), "metal_silver")
    for z in (DOOR_Z0 + 0.25, DOOR_Z1 - 0.25):
        g.box((0.07, 0.045, 0.1), (hx, HINGE_Y, z), "steel_dark")


def make(
    prefix: str,
    location: tuple[float, float, float],
    rot_z: float = 0.0,
    collide: bool = True,
    body: str = "van_white",
    stripe: str = "apron_teal",
    door_angle: float = math.radians(105),
    crates: bool = True,
) -> list[bpy.types.Object]:
    p = Piece(prefix, location, rot_z, collide)

    # Cargo box: a hollow box turned so its open side faces the rear (-Y).
    cargo_len = CARGO_FRONT - REAR
    cargo = p.hollow_box(
        (2 * HALF_W, ROOF - BOTTOM, cargo_len),
        (0.0, (REAR + CARGO_FRONT) / 2.0, (BOTTOM + ROOF) / 2.0),
        body,
        wall=WALL,
        depth=cargo_len - 0.1,
        bevel=CORNER,
        segments=2,
        inner="wood_light",
        rot=(math.pi / 2.0, 0.0, 0.0),
    )
    prims.paint_faces(cargo, lambda f: "wood_mid" if f.normal.y > 0.9 and f.center.y < -0.5 else None)

    # Cab: lower body with the hood, and the glasshouse with a raked windscreen.
    cab_len = FRONT - CAB_BACK
    belt = 1.28
    p.rounded_box((2 * HALF_W, cab_len, belt - BOTTOM), (0.0, (CAB_BACK + FRONT) / 2.0, (BOTTOM + belt) / 2.0), body, radius=CORNER)
    gh_y0, gh_y1, gh_top = CAB_BACK, 1.75, ROOF - 0.1
    gh_len = gh_y1 - gh_y0
    top_scale, shift = 0.72, -0.15
    p.tapered_box((2 * HALF_W - 0.04, gh_len, gh_top - belt), (0.0, (gh_y0 + gh_y1) / 2.0, belt), body, top=(1.0, top_scale), shift=(0.0, shift), bevel=0.05)
    p.box((2 * HALF_W - 0.02, 0.26, ROOF - 0.08 - BOTTOM), (0.0, (CAB_BACK + CARGO_FRONT) / 2.0, (BOTTOM + ROOF - 0.08) / 2.0), body)

    top_front = (gh_y0 + gh_y1) / 2.0 + shift + gh_len * top_scale / 2.0
    rake = math.atan2(gh_y1 - top_front, gh_top - belt)
    t = 0.52
    wy = gh_y1 - (gh_y1 - top_front) * t + math.cos(rake) * 0.008
    wz = belt + (gh_top - belt) * t + math.sin(rake) * 0.008
    p.box((1.62, 0.02, 0.64), (0.0, wy, wz), "glass_dark", rot=(rake, 0.0, 0.0))
    side_x = HALF_W - 0.02
    for s in (-1, 1):
        p.box((0.02, 0.56, 0.48), (s * (side_x + 0.006), 1.02, 1.74), "glass_dark")
        # Stripe, cab door seams and handle, wing mirror.
        p.box((0.012, 4.5, 0.13), (s * (HALF_W + 0.006), -0.02, 1.1), stripe)
        p.box((0.008, 0.012, 0.74), (s * (HALF_W + 0.004), 1.68, 0.86), "steel_dark")
        p.box((0.008, 0.012, 1.4), (s * (HALF_W + 0.004), 0.78, 1.25), "steel_dark")
        p.box((0.016, 0.11, 0.026), (s * (HALF_W + 0.008), 0.9, 1.22), "metal_silver")
        p.box((0.13, 0.03, 0.03), (s * (HALF_W + 0.06), 1.62, 1.46), "steel_dark")
        p.box((0.05, 0.12, 0.19), (s * (HALF_W + 0.13), 1.62, 1.52), "steel_dark", bevel=0.012)
        # Sign panel with a teal frame.
        p.box((0.012, 1.6, 0.72), (s * (HALF_W + 0.004), -0.9, 1.66), stripe)
        sign = prims.panel(p.name("sign_l" if s < 0 else "sign_r"), 1.5, 0.62, (s * (HALF_W + 0.012), -0.9, 1.66), "cloth_cream", rot_z=s * -math.pi / 2.0)
        prims.planar_uv(sign, "board")
        p.keep(sign)
        # Wheels and arches.
        for y in AXLES:
            _arch(p, y, s)
            x = s * (HALF_W - WHEEL_W / 2.0 + 0.03)
            p.cylinder_x(WHEEL_R, WHEEL_W, (x, y, WHEEL_R), "tire", segments=12, bevel=0.04)
            p.cylinder_x(0.2, WHEEL_W + 0.01, (x, y, WHEEL_R), "metal_silver", segments=8)
            p.cylinder_x(0.06, WHEEL_W + 0.02, (x, y, WHEEL_R), "steel_dark", segments=6)
        # Lights.
        p.cylinder_y(0.13, 0.025, (s * 0.7, FRONT - 0.004, 0.84), "metal_silver", segments=10)
        p.cylinder_y(0.11, 0.03, (s * 0.7, FRONT + 0.006, 0.84), "headlight", segments=10)
        p.box((0.05, 0.02, 0.22), (s * (INNER + 0.03), REAR - 0.004, 1.0), "taillight")

    # Front: grille, stripe, bumpers.
    p.box((0.9, 0.02, 0.3), (0.0, FRONT + 0.004, 0.8), "steel_dark")
    for z in (0.72, 0.88):
        p.box((0.94, 0.03, 0.025), (0.0, FRONT + 0.01, z), "metal_silver")
    p.box((1.5, 0.012, 0.13), (0.0, FRONT + 0.004, 1.08), stripe)
    p.box((2 * HALF_W + 0.06, 0.14, 0.15), (0.0, FRONT + 0.04, 0.5), "metal_silver", bevel=0.04)
    p.box((2 * HALF_W + 0.06, 0.22, 0.12), (0.0, REAR - 0.06, 0.48), "metal_silver", bevel=0.03)

    # The cloche on the roof.
    rz = ROOF - 0.01
    cy = (REAR + CARGO_FRONT) / 2.0
    p.cylinder(0.56, 0.05, (0.0, cy, rz), "metal_silver", segments=10, bevel=0.015)
    p.lathe([(0.5, 0.0), (0.47, 0.13), (0.38, 0.25), (0.22, 0.33), (0.0, 0.36)], (0.0, cy, rz + 0.05), "metal_silver", segments=10)
    p.blob((0.06, 0.06, 0.05), (0.0, cy, rz + 0.45), "metal_silver", segments=6, rings=4)

    _door(p, -1, door_angle, body, stripe)
    _door(p, 1, door_angle, body, stripe)

    crate_spots: list[tuple[float, float, float]] = []
    if crates:
        cw, cd, ch = 0.5, 0.4, 0.28

        def crate(x: float, y: float, z: float, yaw: float = 0.0) -> None:
            p.hollow_box((cw, cd, ch), (x, y, z + ch / 2.0), "wood_light", wall=0.025, depth=ch - 0.06, inner="wood_mid", rot_z=yaw)

        crate(-0.5, -1.9, FLOOR)
        crate(-0.48, -1.88, FLOOR + ch, 0.12)
        crate(0.45, -1.75, FLOOR)
        crate(0.3, -0.7, FLOOR)
        crate(0.3, -0.7, FLOOR + ch, -0.1)
        crate_spots = [(-0.5, -1.9, 2 * ch), (0.45, -1.75, ch), (0.3, -0.7, 2 * ch)]
        top1 = FLOOR + 2 * ch - 0.06
        for i, (dx, dy) in enumerate(((-0.1, -0.06), (0.1, 0.05), (0.0, 0.0))):
            p.blob((0.1, 0.1, 0.08), (-0.48 + dx, -1.88 + dy, top1 + 0.05), "lettuce" if i < 2 else "leek", segments=7, rings=5, wobble=0.12, seed=i)
        top2 = FLOOR + ch - 0.06
        for i, (dx, dy) in enumerate(((-0.12, -0.08), (0.0, -0.1), (0.12, -0.06), (-0.06, 0.04), (0.08, 0.06))):
            p.blob((0.055, 0.055, 0.05), (0.45 + dx, -1.75 + dy, top2 + 0.04), "tomato", segments=6, rings=4)
        p.blob((0.13, 0.065, 0.06), (0.4, -1.65, top2 + 0.1), "bread", segments=7, rings=5, rot_z=0.3)
        p.box((0.36, 0.36, 0.1), (-0.45, -0.9, FLOOR + 0.05), "cloth_white", bevel=0.01)
        p.box((0.32, 0.32, 0.1), (-0.45, -0.9, FLOOR + 0.15), "icing", bevel=0.01, rot_z=0.2)

    # Colliders.
    p.collider((0.0, (CARGO_FRONT - 0.1 + FRONT) / 2.0, ROOF / 2.0), (2 * HALF_W, FRONT - CARGO_FRONT + 0.1, ROOF))
    bay_len = CARGO_FRONT - 0.1 - REAR
    bay_y = (REAR + CARGO_FRONT - 0.1) / 2.0
    p.collider((0.0, bay_y, FLOOR / 2.0), (2 * HALF_W, bay_len, FLOOR))
    for s in (-1, 1):
        p.collider((s * (HALF_W + INNER) / 2.0, bay_y, (FLOOR + ROOF) / 2.0), (HALF_W - INNER, bay_len, ROOF - FLOOR))
    p.collider((0.0, bay_y, ROOF - (CORNER + WALL) / 2.0), (2 * INNER, bay_len, CORNER + WALL))
    for side in (-1, 1):
        a = side * door_angle
        local = (-side * (DOOR_W / 2.0), 0.0)
        cx = side * HINGE_X + local[0] * math.cos(a) - local[1] * math.sin(a)
        cy_ = HINGE_Y + local[0] * math.sin(a) + local[1] * math.cos(a)
        p.collider((cx, cy_, (DOOR_Z0 + DOOR_Z1) / 2.0), (DOOR_W, 0.08, DOOR_Z1 - DOOR_Z0), rot=(0.0, 0.0, a))
    for x, y, h in crate_spots:
        p.collider((x, y, FLOOR + h / 2.0), (0.5, 0.4, h))
    return p.finish()
