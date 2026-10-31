"""A scruffy, friendly mutt standing on all fours: about 0.65 m nose to tail, 0.5 m to the top of
the head. Tan with a dark saddle, floppy dark ears and an eye patch, cream socks and chest, and
a red collar with a brass tag.

Meshes (front faces +Y):
- `dog_body`: torso, legs, neck and collar. Origin at the bottom center.
- `dog_head`: child of dog_body, origin at the neck joint, so rotating it about X nods and about
  Y tilts the head.
- `dog_tail`: child of dog_body, origin at the tail root, so rotating it about Z wags the tail.
"""

from lib import prop_prims as pp

KIND = "prop"

OY = -0.04  # shifts the whole dog so its footprint is centered on the origin
HEAD_DROP = 0.025  # the head is modelled a little high; this lowers it to about 0.5 m
NECK = (0.0, 0.15 + OY, 0.4 - HEAD_DROP)
TAIL_ROOT = (0.0, -0.2 + OY, 0.35)

TAN, DARK, CREAM = "dog_tan", "dog_dark", "cake"


def at(x: float, y: float, z: float) -> tuple[float, float, float]:
    return (x, y + OY, z)


def tuft(a, b, r: float, color: str) -> pp.Part:
    """A little pointed tuft of fur from a to b."""
    return pp.tube([at(*a), at(*b)], [r, 0.0], color, sides=4, caps=False)


def body() -> pp.Model:
    m = pp.Model()
    torso = pp.tube(
        [at(0, -0.235, 0.32), at(0, -0.2, 0.322), at(0, -0.07, 0.315), at(0, 0.08, 0.33), at(0, 0.155, 0.4)],
        [(0.045, 0.045), (0.082, 0.08), (0.092, 0.088), (0.09, 0.1), (0.058, 0.06)],
        TAN,
        sides=8,
        phase=22.5,
        caps=(True, False),  # the neck end is inside the head
    ).jitter(0.008, 1)

    def coat(c, n):
        if n.z > 0.4 and -0.19 + OY < c.y < 0.05 + OY:
            return DARK  # saddle
        if n.y > 0.2 and n.z < 0.2 and c.y > 0.06 + OY:
            return CREAM  # chest
        return None

    torso.paint_by(coat)
    m.add(torso)
    m.add(tuft((-0.022, 0.12, 0.27), (-0.03, 0.15, 0.225), 0.02, CREAM))  # chest scruff
    m.add(tuft((0.022, 0.12, 0.27), (0.03, 0.15, 0.23), 0.02, CREAM))
    # Collar and tag.
    m.add(pp.tube([at(0, 0.108, 0.355), at(0, 0.13, 0.376)], (0.082, 0.088), "cloth_red", sides=8, phase=22.5, caps=False))
    m.add(pp.cylinder(0.013, 0.004, "brass", seg=6).move(at(0, 0.172, 0.29), rot=(-90, 0, 0)))

    for side in (-1, 1):
        x = side * 0.055
        m.add(
            pp.tube(
                [at(x, 0.1, 0.3), at(x, 0.105, 0.14), at(x, 0.11, 0.035), at(x, 0.14, 0.02)],
                [0.036, 0.028, 0.026, (0.026, 0.02)],
                TAN,
                sides=5,
                colors=[None, None, CREAM],
                caps=(False, True),
            )
        )
        m.add(
            pp.tube(
                [at(x, -0.15, 0.31), at(x, -0.12, 0.18), at(x, -0.165, 0.09), at(x, -0.155, 0.035), at(x, -0.125, 0.02)],
                [0.05, 0.036, 0.026, 0.025, (0.026, 0.02)],
                TAN,
                sides=5,
                colors=[None, None, None, CREAM],
                caps=(False, True),
            )
        )
    return m


def head() -> pp.Model:
    m = pp.Model()
    skull = pp.tube(
        [at(0, 0.14, 0.445), at(0, 0.2, 0.455), at(0, 0.26, 0.45)],
        [(0.062, 0.058), (0.079, 0.068), (0.064, 0.057)],
        TAN,
        sides=8,
        phase=22.5,
    ).jitter(0.006, 2)
    skull.paint(DARK, lambda c, n: c.x > 0.015 and n.y > -0.3 and c.z > 0.44)  # patch over one eye
    m.add(skull)
    muzzle = pp.tube(
        [at(0, 0.24, 0.425), at(0, 0.3, 0.418), at(0, 0.345, 0.414)],
        [(0.044, 0.036), (0.038, 0.031), (0.031, 0.026)],
        TAN,
        sides=6,
        phase=30,
        caps=(False, True),
    ).jitter(0.004, 3)
    muzzle.paint(CREAM, lambda c, n: n.z < -0.3)
    m.add(muzzle)
    m.add(pp.sphere(0.016, "black", seg=5, rings=3, center=at(0, 0.35, 0.43), scale=(1.25, 0.9, 0.85)))  # nose
    m.add(pp.box((0.018, 0.026, 0.004), at(0, 0.33, 0.39), "rose", rot=(-30, 0, 0)))  # tongue out
    for side in (-1, 1):
        m.add(pp.sphere(0.011, "eye_dark", seg=5, rings=2, center=at(side * 0.035, 0.266, 0.47)))
        m.add(tuft((side * 0.03, 0.245, 0.49), (side * 0.04, 0.275, 0.497), 0.01, DARK if side > 0 else TAN))  # brow
        ear = pp.tube(
            [at(side * 0.056, 0.185, 0.505), at(side * 0.079, 0.19, 0.478), at(side * 0.085, 0.198, 0.41), at(side * 0.077, 0.205, 0.372)],
            [(0.03, 0.009), (0.032, 0.009), (0.025, 0.008), (0.0, 0.0)],
            DARK,
            sides=4,
            up=(1.0, 0.0, 0.0),
        )
        m.add(ear)
    m.add(tuft((0.0, 0.17, 0.5), (0.008, 0.19, 0.535), 0.018, TAN))  # mop of fur on top
    m.add(tuft((0.0, 0.31, 0.395), (0.0, 0.305, 0.365), 0.013, CREAM))  # chin whiskers
    for p in m.parts:
        p.move((0.0, 0.0, -HEAD_DROP))
    return m


def tail() -> pp.Model:
    m = pp.Model()
    m.add(
        pp.tube(
            [TAIL_ROOT, at(0, -0.245, 0.4), at(0, -0.265, 0.47), at(0, -0.25, 0.525)],
            [0.026, 0.022, 0.017, 0.0],
            TAN,
            sides=5,
            colors=[None, None, CREAM],
            caps=(False, True),
        ).jitter(0.003, 4)
    )
    return m


def build() -> None:
    dog = body().build("dog_body")
    pp.parent(head().build("dog_head", origin=NECK), dog)
    pp.parent(tail().build("dog_tail", origin=TAIL_ROOT), dog)
