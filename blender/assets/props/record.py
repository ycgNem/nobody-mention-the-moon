"""A vinyl record in its sleeve, lying flat: 0.31 x 0.31 m sleeve, 0.01 m thick, with the record
peeking out of the +X side. Bright retro sleeve art on top (+Z).

Origin at the bottom center of the whole footprint (sleeve plus the peeking record).
"""

from lib import prop_prims as pp

KIND = "prop"

S = 0.31
T = 0.008
PEEK = 0.05  # how far the record sticks out of the sleeve
REC_R = 0.15
CX = -PEEK / 2  # sleeve center, so the footprint is centered


def art(u0: float, v0: float, pts, color: str, depth: int) -> pp.Part:
    """Shape on the sleeve front, in sleeve coordinates (0..1, +X right, +Y up the cover)."""
    z = T + 0.0006 * (depth + 1)
    m = 0.008
    return pp.panel([(CX - S / 2 + m + (u0 + u) * (S - 2 * m), -S / 2 + m + (v0 + v) * (S - 2 * m), z) for u, v in pts], color)


def build() -> None:
    m = pp.Model()
    m.add(pp.box((S, S, T), (CX, 0.0, T / 2), "cloth_cream", bevel=0.002))
    # The record: black vinyl with a lighter groove ring, sliding out of the open edge.
    rx = CX + S / 2 + PEEK - REC_R
    rec = pp.lathe([(0.0, 0.002), (REC_R, 0.002), (REC_R, 0.006), (0.0, 0.006)], "black", seg=24)
    rec.paint("tile_black", lambda c, n: n.z > 0.5)
    m.add(rec.move((rx, 0.0, 0.0)))
    ring = pp.lathe([(REC_R - 0.012, 0.0063), (REC_R - 0.028, 0.0063)], "cloth_grey", seg=24)
    m.add(ring.move((rx, 0.0, 0.0)))

    sq = [(0, 0), (1, 0), (1, 1), (0, 1)]
    m.add(art(0, 0, sq, "apron_mustard", 0))
    m.add(art(0, 0, pp.circle(0.3, 14, (0.5, 0.62)), "apron_coral", 1))  # big sun
    m.add(art(0, 0, pp.circle(0.17, 10, (0.5, 0.62)), "cloth_red", 2))
    for i, c in enumerate(("apron_teal", "apron_navy", "apron_teal")):
        v = 0.08 + i * 0.1
        m.add(art(0, v, [(0, 0), (1, 0), (1, 0.06), (0, 0.06)], c, 3))
    m.add(art(0.08, 0.9, [(0, 0), (0.45, 0), (0.45, 0.05), (0, 0.05)], "cloth_white", 3))  # title
    m.build("record")
