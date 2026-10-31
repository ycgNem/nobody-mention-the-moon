"""Snow globe: a Ø0.12 m glass globe on a wooden base, 0.15 m tall, with a snowy cottage and a
fir tree inside.

Two meshes: `snow_globe` (base and scene) and `snow_globe_glass` (the globe, painted `glass`, so
the client can give it its own see-through material). Origin at the bottom center.
"""

import math

from lib import prop_prims as pp

KIND = "prop"

GLOBE_R = 0.06
H = 0.15
GLOBE_Z = H - GLOBE_R  # globe center
BASE_TOP = 0.042


def base(m: pp.Model) -> None:
    profile = [
        (0.0, 0.0),
        (0.058, 0.0),
        (0.06, 0.008),
        (0.05, 0.014),
        (0.047, 0.034),
        (0.05, 0.038),
        (0.046, BASE_TOP),
        (0.0, BASE_TOP),
    ]
    dark = "wood_dark"
    m.add(pp.lathe(profile, "wood_mid", seg=10, colors=[dark, dark, None, None, dark, dark, dark]))
    # Little brass plaque on the front.
    m.add(pp.box((0.03, 0.004, 0.012), (0.0, 0.049, 0.024), "gold", rot=(-8, 0, 0)))


def scene(m: pp.Model) -> None:
    # Snow drift filling the bottom of the globe.
    m.add(pp.dome(0.04, 0.014, "snow", seg=10, rings=2, base=(0.0, 0.0, BASE_TOP)).jitter((0.0, 0.0, 0.002), 3))
    z = BASE_TOP + 0.01
    # Cottage.
    m.add(pp.box((0.026, 0.022, 0.018), (-0.006, 0.002, z + 0.009), "wall_cream"))
    roof = pp.prism([(-0.013, 0.0), (0.013, 0.0), (0.0, 0.014)], 0.028, "roof")  # gable, extruded along Z
    roof.move((-0.006, 0.016, z + 0.017), rot=(90, 0, 0))
    m.add(roof)
    m.add(pp.prism([(-0.008, 0.0), (0.008, 0.0), (0.0, 0.0085)], 0.03, "snow").move((-0.006, 0.017, z + 0.0235), rot=(90, 0, 0)))
    m.add(pp.box((0.005, 0.005, 0.01), (0.002, -0.004, z + 0.028), "brick"))  # chimney
    m.add(pp.box((0.007, 0.002, 0.011), (-0.006, 0.013, z + 0.0055), "wood_dark"))  # door
    m.add(pp.box((0.006, 0.002, 0.006), (0.002, 0.013, z + 0.011), "yolk"))  # lit window
    # Fir tree with snow on top.
    m.add(pp.cylinder(0.012, 0.024, "plant_green", seg=6, base=(0.022, -0.008, z - 0.004), r_top=0.0))
    m.add(pp.cylinder(0.009, 0.02, "plant_green", seg=6, base=(0.022, -0.008, z + 0.012), r_top=0.0))
    m.add(pp.cylinder(0.004, 0.006, "snow", seg=6, base=(0.022, -0.008, z + 0.026), r_top=0.0))
    # Snowflakes swirling against the glass: they show whether the glass is opaque or not.
    for i in range(8):
        az = math.radians(i * 47 + 20)
        el = math.radians(-5 + (i * 37) % 70)
        r = GLOBE_R + 0.0005
        c = (r * math.cos(el) * math.cos(az), r * math.cos(el) * math.sin(az), GLOBE_Z + r * math.sin(el))
        m.add(pp.sphere(0.0038, "snow", seg=4, rings=2, center=c))


def build() -> None:
    body = pp.Model()
    base(body)
    scene(body)
    body.build("snow_globe")

    glass = pp.Model()
    globe = pp.sphere(GLOBE_R, "glass", seg=12, rings=7, center=(0.0, 0.0, GLOBE_Z))
    # The snow drift line, so the globe still reads as a snow globe while the glass is opaque.
    globe.paint("snow", lambda c, n: c.z < GLOBE_Z - 0.04)
    glass.add(globe)
    glass.build("snow_globe_glass")
