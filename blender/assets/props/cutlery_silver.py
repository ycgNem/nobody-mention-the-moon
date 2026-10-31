"""Silver knife and fork lying flat side by side, pointing along +Y (handles toward -Y).
Fork on the left (-X), knife on the right (+X). Chunky enough to read across the table.

Origin at the bottom center.
"""

from lib import prop_prims as pp

KIND = "prop"

GAP = 0.026  # each piece's center line sits this far from the middle


def fork(cx: float) -> list[pp.Part]:
    handle = [(-0.008, -0.095), (0.008, -0.095), (0.012, -0.085), (0.011, -0.04), (0.005, 0.0), (-0.005, 0.0), (-0.011, -0.04), (-0.012, -0.085)]
    head = [(-0.005, -0.006), (0.005, -0.006), (0.0055, 0.025), (0.014, 0.045), (0.015, 0.095)]
    # Four tines across the head, walked right to left.
    edges = [0.015, 0.0105, 0.0065, 0.002, -0.002, -0.0065, -0.0105, -0.015]
    for k in range(1, len(edges) - 1, 2):
        head += [(edges[k], 0.095), (edges[k], 0.062), (edges[k + 1], 0.062), (edges[k + 1], 0.095)]
    head += [(-0.015, 0.095), (-0.014, 0.045), (-0.0055, 0.025)]

    def curl(v):
        # Tines lift a little off the table.
        lift = max(0.0, v.y - 0.04) * 0.12
        return (v.x + cx, v.y, v.z + lift)

    return [
        pp.prism(handle, 0.007, "metal_silver", bevel=0.002, bevel_bottom=0.001).warp(lambda v: (v.x + cx, v.y, v.z)),
        pp.prism(head, 0.0035, "metal_silver", bevel=0.001, z0=0.0015).warp(curl),
    ]


def knife(cx: float) -> list[pp.Part]:
    handle = [(-0.008, -0.105), (0.008, -0.105), (0.011, -0.095), (0.0105, -0.01), (0.007, 0.0), (-0.007, 0.0), (-0.0105, -0.01), (-0.011, -0.095)]
    blade = [(-0.006, -0.004), (0.006, -0.004), (0.008, 0.006), (0.009, 0.075), (0.006, 0.096), (0.0, 0.104), (-0.006, 0.098), (-0.0105, 0.075), (-0.011, 0.012)]
    return [
        pp.prism(handle, 0.008, "metal_silver", bevel=0.0025, bevel_bottom=0.001).warp(lambda v: (v.x + cx, v.y, v.z)),
        pp.prism(blade, 0.003, "steel", bevel=0.001, z0=0.0025).warp(lambda v: (v.x + cx, v.y, v.z)),
    ]


def build() -> None:
    m = pp.Model()
    for p in fork(-GAP) + knife(GAP):
        m.add(p)
    m.build("cutlery_silver")
