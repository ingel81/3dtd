"""The td-icon set, drawn as geometry on the 24 grid.

Style: a stamp in the manner of the logo. Every icon is a filled form (body);
its details are not cut out but shown in a quieter tone (half, 40 % opacity),
so the form stays closed on any ground and reads at 11 px.

Writes the ICONS block of src/app/components/icon/icon.component.ts:

    uv run --with shapely python tools/icons/draw_icons.py
"""
import math, re, sys
from pathlib import Path
from shapely.geometry import Point, Polygon, LineString, box
from shapely.ops import unary_union
from shapely import affinity

RES = 24


def U(*g):
    return unary_union([x for x in g if x is not None and not x.is_empty])


def C(cx, cy, r):
    return Point(cx, cy).buffer(r, quad_segs=RES)


def E(cx, cy, rx, ry, rot=0):
    e = affinity.scale(Point(0, 0).buffer(1, quad_segs=RES), rx, ry)
    return affinity.translate(affinity.rotate(e, rot, origin=(0, 0)), cx, cy)


def L(pts, w, cap='round', join='round'):
    return LineString(pts).buffer(w / 2, quad_segs=RES, cap_style=cap, join_style=join, mitre_limit=3)


def B(x0, y0, x1, y1):
    return box(x0, y0, x1, y1)


def RR(x0, y0, x1, y1, r):
    return box(x0 + r, y0 + r, x1 - r, y1 - r).buffer(r, quad_segs=RES)


def P(*pts):
    return Polygon(pts).buffer(0)


def ring(cx, cy, r, w):
    return C(cx, cy, r + w / 2).difference(C(cx, cy, r - w / 2))


def hull(*g):
    return U(*g).convex_hull


def pol(cx, cy, r, a):
    return (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))


def arcpts(cx, cy, r, a0, a1, n=40):
    return [pol(cx, cy, r, a0 + (a1 - a0) * i / n) for i in range(n + 1)]


def arcL(cx, cy, r, a0, a1, w, cap='round'):
    return L(arcpts(cx, cy, r, a0, a1), w, cap)


def head(tip, ang, length, width):
    """Arrow head with its tip at `tip`, pointing along `ang` degrees."""
    bx, by = tip[0] - length * math.cos(math.radians(ang)), tip[1] - length * math.sin(math.radians(ang))
    px, py = -math.sin(math.radians(ang)) * width / 2, math.cos(math.radians(ang)) * width / 2
    return P(tip, (bx + px, by + py), (bx - px, by - py))


def star(cx, cy, ro, ri, n, rot=-90):
    pts = []
    for i in range(2 * n):
        pts.append(pol(cx, cy, ro if i % 2 == 0 else ri, rot + i * 180 / n))
    return P(*pts)


def gear(cx, cy, ro, ri, n, top=0.22, root=0.3):
    pts = []
    for i in range(n):
        a = i / n * 2 * math.pi - math.pi / 2
        s = 2 * math.pi / n
        for da, r in ((-root * s * 1.3, ri), (-top * s, ro), (top * s, ro), (root * s * 1.3, ri)):
            pts.append((cx + r * math.cos(a + da), cy + r * math.sin(a + da)))
    return Polygon(pts).union(C(cx, cy, ri))


def bez(d):
    pts, cur = [d[0]], d[0]
    for c1, c2, e in d[1:]:
        for i in range(1, 13):
            t = i / 12
            u = 1 - t
            pts.append((u**3 * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t**3 * e[0],
                        u**3 * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t**3 * e[1]))
        cur = e
    return Polygon(pts).buffer(0)


def spline(pts, n=10):
    """Catmull-Rom through the points."""
    out = []
    p = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for k in range(n):
            t = k / n
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t ** 3) for j in (0, 1)))
    out.append(pts[-1])
    return out


def taper(pts, r0, r1):
    n = len(pts)
    return U(*[C(x, y, r0 + (r1 - r0) * i / (n - 1)) for i, (x, y) in enumerate(pts)],
             *[hull(C(*pts[i], r0 + (r1 - r0) * i / (n - 1)), C(*pts[i + 1], r0 + (r1 - r0) * (i + 1) / (n - 1))) for i in range(n - 1)])


def rot(g, a, o=(12, 12)):
    return affinity.rotate(g, a, origin=o)


def mirror(g):
    return affinity.scale(g, -1, 1, origin=(12, 12))


def fit(g, lo=2.2, hi=21.8):
    x0, y0, x1, y1 = g.bounds
    s = min((hi - lo) / (x1 - x0), (hi - lo) / (y1 - y0))
    g = affinity.scale(g, s, s, origin=((x0 + x1) / 2, (y0 + y1) / 2))
    x0, y0, x1, y1 = g.bounds
    return affinity.translate(g, 12 - (x0 + x1) / 2, 12 - (y0 + y1) / 2)


def fit2(body, half, lo=2.2, hi=21.8):
    """Fit body and half together."""
    x0, y0, x1, y1 = body.bounds
    s = min((hi - lo) / (x1 - x0), (hi - lo) / (y1 - y0))
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    f = lambda g: None if g is None else affinity.translate(affinity.scale(g, s, s, origin=(cx, cy)), 12 - cx, 12 - cy)
    return f(body), f(half)


def gap(front, back, g=1.0):
    """Back with room cut around the front, so overlaps read."""
    return back.difference(front.buffer(g, quad_segs=RES))


ICONS = {}


def icon(fn):
    ICONS[fn.__name__.rstrip('_')] = fn
    return fn


# ---- stats and header ---------------------------------------------------

@icon
def heart():
    tip = Point(12, 21)
    body = U(hull(C(7.5, 8.6, 4.8), tip), hull(C(16.5, 8.6, 4.8), tip))
    return body, arcL(7.5, 8.6, 2.6, 200, 265, 1.2)


def coin_disc(cx, cy, rx, ry, t, r):
    face = E(0, 0, rx, ry)
    body = U(face, E(0, t, rx, ry), B(-rx, 0, rx, t))
    edge = face.exterior.buffer(0.42).intersection(B(-rx - 1, 0.01, rx + 1, t + ry + 1))
    notches = [L([(x, ry * math.sqrt(1 - (x / rx) ** 2) + 0.95), (x, ry * math.sqrt(1 - (x / rx) ** 2) + t - 0.25)], 0.55, 'flat')
               for x in (-3.9, -1.95, 0, 1.95, 3.9)]
    place = lambda g: affinity.translate(affinity.rotate(g, r, origin=(0, 0)), cx, cy)
    return place(body), place(U(edge, *notches))


@icon
def coin():
    b1, c1 = coin_disc(9.2, 7.6, 6.2, 3.1, 2.7, -8)
    b2, c2 = coin_disc(14.8, 13.8, 6.2, 3.1, 2.7, -8)
    return U(gap(b2, b1), b2), U(gap(b2, c1), c2)


def wave_pts(y, amp, x0=3, x1=21, periods=1.5, n=60):
    return [(x0 + (x1 - x0) * i / n, y - amp * math.sin(2 * math.pi * periods * i / n)) for i in range(n + 1)]


@icon
def wave():
    return U(*(L(wave_pts(y, 1.5), 2.3) for y in (6.5, 12, 17.5))), L(wave_pts(17.5, 1.5), 2.4)


@icon
def castle():
    walls = U(B(3, 6, 8, 21), B(16, 6, 21, 21), B(8, 9.5, 16, 21))
    cuts = U(B(4.8, 6, 6.2, 7.8), B(17.8, 6, 19.2, 7.8), B(9.6, 9.5, 11, 11.2), B(13, 9.5, 14.4, 11.2))
    flag = U(L([(12, 3.2), (12, 9.6)], 1.1, 'flat'), P((12.4, 2.8), (16.4, 4.2), (12.4, 5.6)))
    body = U(walls.difference(cuts), flag)
    half = U(B(10.1, 16.2, 13.9, 21.5), C(12, 16.2, 1.9), B(5.1, 11.6, 5.9, 14.6), B(18.1, 11.6, 18.9, 14.6))
    return body, half


@icon
def tower():
    body = U(P((7.4, 20), (16.6, 20), (15.8, 9.8), (8.2, 9.8)), B(6.6, 5, 17.4, 9.2), B(6.2, 19.2, 17.8, 21.4))
    body = body.difference(U(B(8.9, 5, 10.4, 6.8), B(13.6, 5, 15.1, 6.8), L([(6, 9.5), (18, 9.5)], 0.75, 'flat'), L([(6, 19.4), (18, 19.4)], 0.6, 'flat')))
    half = U(B(10.7, 16.6, 13.3, 19.2), C(12, 16.6, 1.3), B(11.4, 11.4, 12.6, 13.8),
             L([(8.6, 15.2), (10.2, 15.2)], 0.6, 'flat'), L([(14, 12.6), (15.6, 12.6)], 0.6, 'flat'))
    return body, half


@icon
def skull():
    head_ = U(C(12, 9.4, 5.6), RR(8.7, 11, 15.3, 15.6, 0.8))
    half = U(E(9.8, 10, 1.55, 1.8), E(14.2, 10, 1.55, 1.8), P((12, 11.9), (11, 13.6), (13, 13.6)),
             L([(10.9, 14.4), (10.9, 16)], 0.75, 'flat'), L([(13.1, 14.4), (13.1, 16)], 0.75, 'flat'))
    bones = U(bone((3.4, 3.4), (20.6, 20.6)), bone((20.6, 3.4), (3.4, 20.6)))
    return U(gap(head_, bones), head_), half


def bone(a, b, w=2.0, k=1.35):
    (x0, y0), (x1, y1) = a, b
    dx, dy = x1 - x0, y1 - y0
    n = math.hypot(dx, dy)
    px, py = -dy / n, dx / n
    return U(L([a, b], w), *[C(x + s * px * k * 0.8, y + s * py * k * 0.8, k) for (x, y) in (a, b) for s in (-1, 1)])


@icon
def moon():
    return U(ring(12, 12, 9, 1.2), C(12, 12, 7.4).difference(C(15.2, 9.6, 6.2))), U(C(8.2, 14.2, 0.9), C(11, 17.2, 0.7))


@icon
def walk():
    return U(C(13.8, 3.9, 2.2), L([(13.1, 7.6), (11.7, 13.2)], 3.2), L([(11.7, 13.2), (9.8, 16.8), (7.2, 20.8)], 2.5),
             L([(11.9, 13.4), (14.4, 16.6), (14.9, 21)], 2.5), L([(12.9, 8.6), (10, 10.5), (9.3, 13)], 1.9),
             L([(13, 8.6), (15.2, 11.2), (17.6, 12.2)], 1.9)), None


@icon
def run():
    figure = U(C(15.6, 3.7, 2.2), L([(14.4, 7.4), (11.4, 12.8)], 3.2), L([(11.2, 12.8), (7.4, 14.2), (4.6, 18.2)], 2.5),
               L([(11.6, 13.2), (14.8, 16), (13.8, 21)], 2.5), L([(13.8, 8.4), (17.2, 10.6), (19.8, 9.2)], 1.9),
               L([(13.6, 8.4), (10.6, 7.8), (8.2, 10)], 1.9))
    lines = U(L([(2.2, 7.4), (6, 7.4)], 1.5), L([(1.8, 11), (5.2, 11)], 1.5))
    return U(figure, lines), lines


@icon
def plane():
    fus = L([(12, 3), (12, 20.4)], 3.0)
    wings = P((10.6, 8.6), (13.4, 8.6), (22, 13.6), (22, 15.6), (13.4, 13.4), (10.6, 13.4), (2, 15.6), (2, 13.6))
    tail = P((11, 17.2), (13, 17.2), (16.6, 20.2), (16.6, 21.6), (12, 20.6), (7.4, 21.6), (7.4, 20.2))
    return U(fus, wings, tail), L([(12, 5.2), (12, 7.2)], 1.0)


@icon
def flame():
    body = bez([(12, 21.6), ((7.6, 21.6), (4.6, 18.6), (4.6, 14.8)), ((4.6, 11.6), (6.2, 9.4), (7.4, 7.6)),
                ((7.8, 10), (8.6, 11.4), (9.6, 12.1)), ((9.4, 8.4), (10.8, 5), (13.4, 2.2)),
                ((13.4, 5.6), (14.8, 8.2), (15.2, 10.6)), ((16.4, 9.8), (17.6, 8.8), (18.4, 7)),
                ((19.8, 9.6), (19.7, 12.4), (19.4, 15)), ((19.2, 19), (16.4, 21.6), (12, 21.6))])
    inner = bez([(12, 20), ((9.8, 20), (8.8, 18.4), (9, 16.8)), ((9.2, 15), (10.8, 13.6), (12, 11.6)),
                 ((12.6, 13.8), (15, 15), (15, 17.2)), ((15, 18.8), (13.8, 20), (12, 20))])
    return body, inner


@icon
def cog():
    return gear(12, 12, 10, 7.6, 8).difference(C(12, 12, 1.9)), ring(12, 12, 4.7, 1.2)


@icon
def play():
    return P((6.5, 3.8), (20.5, 12), (6.5, 20.2)), None


@icon
def close():
    return U(L([(5.2, 5.2), (18.8, 18.8)], 4.2, 'square'), L([(18.8, 5.2), (5.2, 18.8)], 4.2, 'square')), None


# ---- combat and towers --------------------------------------------------

@icon
def sword():
    blade = P((12, 1.6), (13.7, 4.6), (13.7, 15.2), (10.3, 15.2), (10.3, 4.6))
    guard = RR(7, 15, 17, 17.4, 0.9)
    grip = B(11, 17.4, 13, 20.6)
    pommel = C(12, 21.4, 1.6)
    body = U(blade, guard, grip, pommel)
    half = L([(12, 5.2), (12, 14.4)], 1.0, 'flat')
    return fit2(rot(body, 45), rot(half, 45), 1.8, 22.2)


@icon
def target():
    return C(12, 12, 10), U(ring(12, 12, 7, 2.2), ring(12, 12, 3, 1.9))


@icon
def bolt():
    return P((14.8, 1.8), (5, 13.6), (11.2, 13.6), (9, 22.2), (19, 9.8), (12.8, 9.8), (16, 1.8)), None


@icon
def shield():
    body = bez([(12, 2.2), ((15, 3.6), (18, 4.2), (20.4, 4.2)), ((20.4, 13), (17.6, 18.6), (12, 21.8)),
                ((6.4, 18.6), (3.6, 13), (3.6, 4.2)), ((6, 4.2), (9, 3.6), (12, 2.2))])
    return body, body.buffer(-1.7).intersection(B(12.6, 0, 24, 24))


@icon
def splash():
    drops = U(C(4.6, 11, 1.7), C(7.8, 5.8, 1.5), C(16.2, 5.8, 1.5), C(19.4, 11, 1.7), C(12, 3.4, 1.3))
    core = U(C(12, 14.6, 3.8), hull(C(12, 14.6, 2.4), Point(12, 8.6)))
    pool = E(12, 19.8, 9.4, 2.3)
    return U(drops, core, pool), gap(core, pool, 0.8)


@icon
def burst():
    return star(12, 12, 10.6, 5.4, 8), star(12, 12, 5.2, 2.8, 8, -90 + 22.5)


@icon
def sparkle():
    return U(star(10.4, 13.4, 8.8, 2.2, 4), star(18.8, 5, 3.4, 0.95, 4)), star(18.8, 5, 3.4, 0.95, 4)


@icon
def snowflake():
    arms = []
    for a in range(0, 360, 60):
        tip = pol(12, 12, 9.8, a - 90)
        arms.append(L([(12, 12), tip], 2.1))
        mid = pol(12, 12, 6.2, a - 90)
        for s in (-1, 1):
            arms.append(L([mid, pol(*mid, 3, a - 90 + s * 45 - 180 + 180)], 1.7))
    return U(*arms), None


@icon
def radiation():
    blades = U(*[C(12, 12, 9).difference(C(12, 12, 3.4)).intersection(
        P((12, 12), pol(12, 12, 14, a - 30), pol(12, 12, 14, a), pol(12, 12, 14, a + 30))) for a in (-90, 30, 150)])
    body = C(12, 12, 10.6)
    half = body.difference(U(blades, C(12, 12, 2))).difference(ring(12, 12, 10.6, 1.6))
    return body, half


@icon
def laser():
    core = RR(9.6, 1.8, 14.4, 7, 1)
    panels = U(B(2.6, 2.6, 8.6, 6.2), B(15.4, 2.6, 21.4, 6.2))
    cells = U(*[L([(x, 2), (x, 7)], 0.5, 'flat') for x in (4.6, 6.6, 17.4, 19.4)])
    arms = U(B(8.6, 3.9, 9.6, 4.9), B(14.4, 3.9, 15.4, 4.9))
    beam = P((11, 7), (13, 7), (13.8, 17.6), (10.2, 17.6))
    hit = U(E(12, 19.8, 8, 2.4), star(12, 18.6, 4, 1.8, 6))
    body = U(core, panels.difference(cells), arms, beam, hit)
    return body, U(gap(U(beam, star(12, 18.6, 4, 1.8, 6)), E(12, 19.8, 8, 2.4), 0.7), beam.difference(B(0, 0, 24, 15)) if False else None)

@icon
def arrowUp():
    body = P((12, 2.2), (21.2, 11.6), (15.6, 11.6), (15.6, 21.8), (8.4, 21.8), (8.4, 11.6), (2.8, 11.6))
    return body, body.intersection(B(0, 17.4, 24, 24)).buffer(0).difference(L([(0, 16.8), (24, 16.8)], 0.0001))


@icon
def chevrons2():
    return U(L([(5, 11), (12, 5.4), (19, 11)], 3.0), L([(5, 18.2), (12, 12.6), (19, 18.2)], 3.0)), L([(5, 18.2), (12, 12.6), (19, 18.2)], 3.1)


@icon
def chevrons3():
    a = [L([(5, y + 5), (12, y), (19, y + 5)], 2.6) for y in (3.2, 9.2, 15.2)]
    return U(*a), a[2].buffer(0.05)


@icon
def caretU():
    return L([(5, 15.6), (12, 8.4), (19, 15.6)], 3.2), None


@icon
def star_():
    s = star(12, 12.8, 10.6, 4.4, 5)
    return s, star(12, 12.8, 5.2, 2.2, 5)


@icon
def eye():
    body = C(12, 17.4, 11.4).intersection(C(12, 6.6, 11.4))
    return body, ring(12, 12, 3.3, 2.2)


@icon
def eyeOff():
    b, h = eye()
    slash = L([(4, 4), (20, 20)], 2.0)
    return U(b.difference(slash.buffer(1.1)), slash), h.difference(slash.buffer(1.1))


@icon
def ghost():
    body = U(C(12, 9.6, 7.4), B(4.6, 9.6, 19.4, 20.6)).difference(U(C(8.3, 21.2, 1.6), C(12, 21.2, 1.6), C(15.7, 21.2, 1.6)))
    return body, U(E(9.5, 9.8, 1.4, 1.9), E(14.5, 9.8, 1.4, 1.9), E(12, 14.6, 1.2, 1.5))


@icon
def lock():
    shackle = U((C(12, 8.6, 5.4).difference(C(12, 8.6, 3.2))).intersection(B(0, 0, 24, 8.6)), B(6.6, 8.6, 8.8, 11.6), B(15.2, 8.6, 17.4, 11.6))
    body = U(shackle, RR(4, 11, 20, 21.6, 1.6))
    return body, U(C(12, 15, 1.7), P((11.1, 15), (12.9, 15), (13.5, 19), (10.5, 19)))


# ---- research ----------------------------------------------------------

@icon
def gatling():
    housing = RR(2.6, 6.2, 10.4, 15.6, 1.4)
    barrels = U(*[L([(10, y), (21.6, y)], 1.7, 'flat') for y in (8.4, 10.9, 13.4)])
    collar = U(RR(15.6, 6.8, 17.4, 15, 0.5), RR(20.2, 7, 21.8, 14.8, 0.5))
    grip = P((4.6, 15.6), (8.6, 15.6), (7.4, 21), (3.6, 21))
    belt = L([(2.6, 18.6), (1.8, 21.8)], 1.6)
    body = U(housing, barrels, collar, grip)
    return body, U(gap(collar, barrels, 0.01).intersection(B(0, 0, 24, 24)), C(6.5, 10.9, 1.6))


@icon
def iceStar():
    return star(12, 12, 10.6, 4.4, 6), star(12, 12, 4.8, 2.6, 6, -60)


@icon
def helix():
    s1 = [(12 + 4.8 * math.sin(t / 30 * 2 * math.pi * 1.25), 2.4 + 19.2 * t / 30) for t in range(31)]
    s2 = [(12 - 4.8 * math.sin(t / 30 * 2 * math.pi * 1.25), 2.4 + 19.2 * t / 30) for t in range(31)]
    strands = U(L(s1, 2.2), L(s2, 2.2))
    rungs = U(*[L([s1[i], s2[i]], 1.3, 'flat') for i in (3, 9, 15, 21, 27) if abs(s1[i][0] - s2[i][0]) > 3])
    return U(strands, rungs), gap(strands, rungs, 0.0)


@icon
def tentacle():
    path = spline([(6.6, 22.4), (7.4, 16.6), (11.6, 12.6), (16.6, 9.6), (18.2, 5.6), (15.8, 3), (12.8, 4.2), (13.4, 7)], 8)
    body = taper(path, 3.4, 0.8)
    suckers = U(*[C(x - 1.0, y + 0.6, 0.62) for (x, y) in path[4:30:5]])
    return body, suckers.intersection(body.buffer(-0.5))


@icon
def hazardCone():
    body = P((12, 1.6), (22.4, 12), (12, 22.4), (1.6, 12)).buffer(-0.6).buffer(0.6)
    inner = body.buffer(-1.8)
    drop = hull(C(12, 14.4, 3.2), Point(12, 6.8))
    return body, U(inner.difference(inner.buffer(-1.1)), drop)


@icon
def catapult():
    base = L([(2.6, 16.6), (21.4, 16.6)], 2.4)
    wheels = U(C(6.4, 19.4, 2.6), C(17.6, 19.4, 2.6))
    frame = L([(9.2, 16), (13, 9.6), (16.6, 16)], 2.2)
    arm = L([(6, 15.4), (18.2, 5.6)], 2.2)
    cup = C(19, 4.8, 2.6)
    body = U(gap(base, wheels, 0.7), base, frame, gap(cup, arm, 0.0), cup)
    return body, U(C(6.4, 19.4, 1.1), C(17.6, 19.4, 1.1), C(19, 4.8, 1.4))


@icon
def flak():
    mount = P((4, 21.8), (20, 21.8), (17, 16.4), (7, 16.4))
    turret = C(12, 16.6, 5).intersection(B(0, 0, 24, 16.6))
    barrels = U(L([(13.2, 13.6), (20.8, 4.6)], 2.2), L([(10.4, 12.8), (16.6, 3.2)], 2.2))
    puff = star(5.6, 6, 3.6, 1.6, 8)
    body = U(gap(turret, mount, 0.8), turret, gap(turret, barrels, 0.0), puff)
    return body, U(puff, gap(barrels, mount, 0).intersection(B(0, 16.6, 24, 24)))

@icon
def arcaneStar():
    return U(ring(12, 12, 9.6, 1.4), star(12, 12, 7.6, 2.1, 4), star(12, 12, 5.4, 1.7, 4, -45)), U(ring(12, 12, 9.6, 1.4), star(12, 12, 5.4, 1.7, 4, -45).difference(star(12, 12, 7.6, 2.1, 4).buffer(0.6)))


@icon
def rocket():
    nose = hull(C(12, 9, 3.7), Point(12, 1.6))
    hull_ = U(nose, B(8.3, 9, 15.7, 16.6))
    fins = U(P((8.3, 11.6), (4.8, 17.8), (8.3, 16.6)), P((15.7, 11.6), (19.2, 17.8), (15.7, 16.6)))
    nozzle = P((9.6, 16.6), (14.4, 16.6), (15, 18.4), (9, 18.4))
    fire = hull(C(12, 19.8, 2), Point(12, 23))
    body = U(hull_, fins, nozzle, fire)
    half = U(C(12, 9.4, 1.7), fire, L([(8.3, 13.6), (15.7, 13.6)], 0.6, 'flat'))
    return fit2(rot(body, 40), rot(half, 40), 1.8, 22.2)


@icon
def frostRune():
    bomb = C(11, 13.4, 8.2)
    fuse = U(RR(13.4, 3.6, 17.4, 6.6, 0.6).difference(bomb.buffer(0.01)), L([(16.6, 4.4), (18.6, 2.4)], 1.4))
    spark = star(19.8, 1.9, 2.2, 0.7, 4)
    flake = U(*[L([pol(11, 13.4, 5, a), pol(11, 13.4, 5, a + 180)], 1.3) for a in (90, 30, 150)])
    return U(bomb, fuse, spark), flake


@icon
def rift():
    arms = []
    for k in range(3):
        pts = [pol(12, 12, 2 + 8.6 * t / 20, k * 120 + t / 20 * 230 - 90) for t in range(21)]
        arms.append(taper(pts, 0.9, 1.8))
    return U(C(12, 12, 2.6), *arms), U(C(12, 12, 1.3), *[a.difference(C(12, 12, 6.8)) for a in arms])


@icon
def mushroom():
    cap = U(C(8, 7.4, 4.2), C(12, 5.6, 4.8), C(16, 7.4, 4.2), E(12, 10, 8.4, 2.6))
    stem = P((10.2, 11.4), (13.8, 11.4), (15, 17.6), (9, 17.6))
    base = U(E(12, 19.6, 8.6, 2.6), C(6.8, 18.6, 2.4), C(17.2, 18.6, 2.4))
    body = U(cap, stem, base)
    return body, U(E(12, 10.6, 7.4, 1.5), L([(9.4, 14.6), (14.6, 14.6)], 1.0))


@icon
def pulse():
    return U(C(12, 12, 3), arcL(12, 12, 6.4, -42, 42, 2.1), arcL(12, 12, 6.4, 138, 222, 2.1),
             arcL(12, 12, 9.8, -38, 38, 2.1), arcL(12, 12, 9.8, 142, 218, 2.1)), U(arcL(12, 12, 9.8, -38, 38, 2.2), arcL(12, 12, 9.8, 142, 218, 2.2))


@icon
def cogRing():
    big = gear(9.4, 9.6, 7.6, 5.6, 8).difference(C(9.4, 9.6, 1.8))
    small = gear(17.4, 17.4, 4.8, 3.4, 6).difference(C(17.4, 17.4, 1.2))
    return U(big, gap(big, small, 0.8)), gap(big, small, 0.8)


@icon
def bug():
    body_ = E(12, 14, 5.2, 6.4)
    head_ = C(12, 6.4, 2.8)
    legs = U(*[L(p, 1.6) for p in ([(7, 11), (3.4, 9.2)], [(6.8, 14.6), (3, 14.8)], [(7.2, 18), (3.8, 20.6)],
                                   [(17, 11), (20.6, 9.2)], [(17.2, 14.6), (21, 14.8)], [(16.8, 18), (20.2, 20.6)],
                                   [(10.8, 4.4), (9.2, 2.2)], [(13.2, 4.4), (14.8, 2.2)])])
    return U(gap(head_, body_, 0.8), head_, legs), U(body_.buffer(-1.4).intersection(B(12.5, 0, 24, 24)), body_.buffer(-1.4).intersection(B(0, 0, 11.5, 24)))


@icon
def flask():
    neck = U(RR(8.6, 2, 15.4, 3.8, 0.6), B(9.8, 3.6, 14.2, 9))
    cone = P((9.8, 8.6), (14.2, 8.6), (20.4, 19.2), (19.4, 21.4), (4.6, 21.4), (3.6, 19.2))
    body = U(neck, cone.buffer(-0.5).buffer(0.5))
    glass = body.buffer(-1.4).intersection(B(0, 0, 24, 13.6))
    bubbles = U(C(10, 17.4, 0.95), C(13.8, 16.2, 0.75))
    return body, U(glass, bubbles)


@icon
def sliders():
    tracks = U(*[L([(3, y), (21, y)], 1.8) for y in (6, 12, 18)])
    knobs = U(C(15, 6, 2.8), C(8, 12, 2.8), C(17, 18, 2.8))
    return U(tracks, knobs), tracks.difference(knobs.buffer(0.8))


# ---- buttons and UI -----------------------------------------------------

@icon
def pin():
    body = hull(C(12, 9, 7), Point(12, 22.4))
    return body, C(12, 9, 2.8)


@icon
def flag():
    pole = U(L([(5, 2.6), (5, 21.4)], 2.0), L([(2.8, 21.6), (8.2, 21.6)], 1.8))
    cloth = bez([(6.4, 3.2), ((10.4, 1.8), (13.6, 5.2), (20, 3.6)), ((19.2, 6.6), (19.2, 9.2), (20, 12.4)),
                 ((13.6, 14), (10.4, 11), (6.4, 12.4)), ((6.4, 9), (6.4, 6.6), (6.4, 3.2))])
    return U(pole, cloth), cloth.intersection(B(0, 7.9, 24, 24)).buffer(-0.01)


@icon
def home():
    body = U(P((12, 2.4), (22.2, 11.4), (19.6, 11.4), (19.6, 21.2), (4.4, 21.2), (4.4, 11.4), (1.8, 11.4)), B(15.8, 3.6, 18.2, 8.6))
    return body, U(RR(10, 14, 14, 21.6, 0.6))


@icon
def search():
    return U(C(10, 10, 7.2), L([(15.2, 15.2), (20.6, 20.6)], 3.4)), C(10, 10, 4.6)


@icon
def caret():
    return L([(5, 8.6), (12, 15.6), (19, 8.6)], 3.2), None


@icon
def caretL():
    return L([(15.4, 5), (8.4, 12), (15.4, 19)], 3.2), None


@icon
def caretR():
    return L([(8.6, 5), (15.6, 12), (8.6, 19)], 3.2), None


@icon
def pause():
    return U(RR(5.6, 3.8, 10.2, 20.2, 1.1), RR(13.8, 3.8, 18.4, 20.2, 1.1)), None


@icon
def stop():
    return RR(4.6, 4.6, 19.4, 19.4, 1.8), None


@icon
def power():
    return U(arcL(12, 13, 7.8, -58, 238, 2.6), L([(12, 2.4), (12, 11)], 2.8)), None


@icon
def speed():
    dial = C(12, 15, 10).intersection(B(0, 0, 24, 17.6))
    needle = L([(12, 15), (17.2, 9.2)], 2.2)
    hubb = C(12, 15, 2.2)
    face = C(12, 15, 7.4).intersection(B(0, 0, 24, 15.2))
    return U(dial, needle, hubb), face.difference(U(needle, hubb).buffer(0.7))


@icon
def fullscreen():
    a = [L(p, 2.8) for p in ([(3.5, 9.2), (3.5, 3.5), (9.2, 3.5)], [(14.8, 3.5), (20.5, 3.5), (20.5, 9.2)],
                             [(20.5, 14.8), (20.5, 20.5), (14.8, 20.5)], [(9.2, 20.5), (3.5, 20.5), (3.5, 14.8)])]
    return U(*a), None


@icon
def layers():
    top = P((12, 2.6), (21.4, 7.8), (12, 13), (2.6, 7.8)).buffer(-0.4).buffer(0.4)
    mid = L([(3.2, 12.2), (12, 17), (20.8, 12.2)], 2.4)
    low = L([(3.2, 16.6), (12, 21.4), (20.8, 16.6)], 2.4)
    return U(top, mid, low), low


@icon
def grid():
    cells = [RR(x, y, x + 5.4, y + 5.4, 0.8) for x in (2.6, 9.3, 16) for y in (2.6, 9.3, 16)]
    return U(*cells), U(*[c for i, c in enumerate(cells) if i % 2 == 1])


@icon
def gridAir():
    rh = lambda y: P((2.4, y + 3.2), (8.4, y), (21.6, y), (15.6, y + 3.2))
    lower = rh(17.6).difference(rh(17.6).buffer(-1.1))
    lines = U(L([(5.4, 19.2), (18.6, 19.2)], 0.0001))
    upper = rh(11.2)
    arrow = U(L([(12, 10.6), (12, 4.2)], 2.0), head((12, 1.8), -90, 3.6, 5.4))
    return U(lower, upper, arrow), U(lower, upper.buffer(-1.1))


@icon
def audio():
    spk = P((2.8, 8.8), (7.6, 8.8), (13.2, 3.6), (13.2, 20.4), (7.6, 15.2), (2.8, 15.2)).buffer(-0.5).buffer(0.5)
    w2 = arcL(12.4, 12, 8.4, -48, 48, 2.2)
    return U(spk, arcL(12.4, 12, 4.4, -45, 45, 2.2), w2), w2


@icon
def audioOff():
    spk = P((2.8, 8.8), (7.6, 8.8), (13.2, 3.6), (13.2, 20.4), (7.6, 15.2), (2.8, 15.2)).buffer(-0.5).buffer(0.5)
    x = U(L([(16, 9), (21.4, 15)], 2.4), L([(21.4, 9), (16, 15)], 2.4))
    return U(spk, x), None


@icon
def music():
    heads = U(E(6.8, 18.2, 3.1, 2.3, -20), E(17, 16.2, 3.1, 2.3, -20))
    stems = U(B(8.6, 5.4, 10.4, 18), B(18.8, 3.4, 20.6, 16))
    beam = P((8.6, 5.4), (20.6, 2.4), (20.6, 5.8), (8.6, 8.8))
    return U(heads, stems, beam), None


@icon
def build():
    head_ = U(RR(5, 3, 17, 8.4, 1), P((17, 3.4), (20.4, 5.2), (17, 8)))
    handle = RR(9.8, 8, 12.8, 21.6, 1.2)
    body = U(head_, gap(head_, handle, 0.0))
    return fit2(rot(body, -38), rot(handle.intersection(B(0, 15.6, 24, 24)), -38), 2.2, 21.8)


@icon
def refresh():
    a1 = U(arcL(12, 12, 7.8, 200, 320, 2.6, 'flat'), head(pol(12, 12, 7.8, 334), 334 + 90, 4.4, 5.6))
    a2 = U(arcL(12, 12, 7.8, 20, 140, 2.6, 'flat'), head(pol(12, 12, 7.8, 154), 154 + 90, 4.4, 5.6))
    return U(a1, a2), None


@icon
def text():
    return U(B(4, 3.4, 20, 7.6), B(9.8, 3.4, 14.2, 20.6), RR(7.6, 18.2, 16.4, 20.8, 0.4), B(4, 3.4, 6.2, 9.6), B(17.8, 3.4, 20, 9.6)), None


@icon
def bulb():
    glass = U(C(12, 9.2, 7.2), P((8, 13.6), (16, 13.6), (15, 17.2), (9, 17.2)))
    base = U(RR(8.8, 18, 15.2, 19.8, 0.7), RR(9.8, 20.4, 14.2, 22.2, 0.8))
    return U(glass, base), U(C(12, 9.2, 4.6), arcL(12, 9.2, 5.6, 200, 250, 0.0001))


@icon
def user():
    h = C(12, 7.2, 4.6)
    bust = C(12, 23.4, 9.4).intersection(B(0, 13.4, 24, 21.8))
    return U(h, gap(h, bust)), None


@icon
def users():
    f_h, f_b = C(9.4, 8, 4.2), C(9.4, 23.6, 8.4).intersection(B(0, 14.2, 24, 21.8))
    b_h, b_b = C(16.6, 6.6, 3.4), C(16.6, 20, 6.8).intersection(B(0, 12, 24, 18.4))
    front = U(f_h, gap(f_h, f_b))
    back = U(b_h, gap(b_h, b_b))
    back = gap(front, back)
    return U(front, back), back


@icon
def link():
    def lnk(c):
        a, b = (c[0] - 2.6, c[1] + 2.6), (c[0] + 2.6, c[1] - 2.6)
        return L([a, b], 6.6).difference(L([a, b], 2.6))
    l1, l2 = lnk((8.6, 15.4)), lnk((15.4, 8.6))
    return U(l1, gap(l1, l2, 0.9).difference(gap(l2, l1).buffer(0.0)).union(l2.difference(l1.buffer(0.9)))), None


@icon
def send():
    body = P((2.4, 10.8), (21.8, 2.2), (14.6, 21.6), (11.2, 12.8))
    return body, P((11.2, 12.8), (21.8, 2.2), (14.6, 21.6)).buffer(-0.01)


@icon
def more():
    return U(C(4.8, 12, 2.3), C(12, 12, 2.3), C(19.2, 12, 2.3)), None


@icon
def signIn():
    door = L([(12.4, 3.4), (20.6, 3.4), (20.6, 20.6), (12.4, 20.6)], 2.4)
    arrow = U(L([(3.2, 12), (12.6, 12)], 2.6), head((16.2, 12), 0, 5.4, 8.6))
    return U(door, gap(arrow, door, 0.8), arrow), door


def mark():
    return P((5.4, 2.4), (18.6, 2.4), (18.6, 21.6), (12, 16.6), (5.4, 21.6)).buffer(-0.5).buffer(0.5)


@icon
def bookmarkStar():
    return mark(), star(12, 9.4, 4.6, 1.9, 5)


@icon
def bookmark():
    return mark(), mark().intersection(B(0, 0, 24, 6.4))


@icon
def dice():
    top = P((12, 2.2), (21.2, 6.8), (12, 11.4), (2.8, 6.8))
    left = P((2.8, 8.2), (11.3, 12.6), (11.3, 21.8), (2.8, 17.4))
    right = P((12.7, 12.6), (21.2, 8.2), (21.2, 17.4), (12.7, 21.8))
    pips = U(E(12, 6.8, 1.7, 0.95), E(5.6, 12.4, 1, 1.4, 0), E(8.6, 17.4, 1, 1.4),
             E(15.2, 17.6, 1, 1.4), E(17, 14.8, 1, 1.4), E(18.8, 12, 1, 1.4))
    return U(top, left, right).buffer(-0.3).buffer(0.3), U(pips, right.buffer(-0.01).difference(pips.buffer(0.01)) if False else pips)


@icon
def portal():
    gate = U(E(12, 11, 7.6, 9.4), RR(3.6, 19.4, 20.4, 22.2, 0.8))
    return gate, U(E(12, 11.4, 4.8, 6.8), arcL(12, 11.4, 2.4, 0, 260, 0.0001))


@icon
def portalAdd():
    b, h = portal()
    b, h = [affinity.translate(affinity.scale(g, 0.8, 0.8, origin=(12, 12)), -2.2, -1.2) for g in (b, h)]
    plus = U(L([(18.4, 13.6), (18.4, 22.4)], 2.8), L([(14, 18), (22.8, 18)], 2.8))
    return U(gap(plus, b, 1.0), plus), h.difference(plus.buffer(1.0))


@icon
def shields():
    sh, _ = shield()
    front = affinity.translate(affinity.scale(sh, 0.78, 0.78, origin=(12, 12)), -3, 1.6)
    back = affinity.translate(affinity.scale(sh, 0.66, 0.66, origin=(12, 12)), 4.4, -3)
    back = gap(front, back)
    return U(front, back), back


@icon
def chart():
    bars = U(RR(3.2, 13, 7.6, 19.6, 0.8), RR(9.8, 8, 14.2, 19.6, 0.8), RR(16.4, 3.4, 20.8, 19.6, 0.8))
    base = L([(2.4, 21.6), (21.6, 21.6)], 1.6)
    return U(bars, base), RR(3.2, 13, 7.6, 19.6, 0.8)


@icon
def share():
    nodes = U(C(18, 5.2, 3.2), C(6, 12, 3.2), C(18, 18.8, 3.2))
    lines = U(L([(6, 12), (18, 5.2)], 1.9), L([(6, 12), (18, 18.8)], 1.9))
    return U(nodes, lines), lines.difference(nodes.buffer(0.8))


@icon
def filing():
    lid = RR(2.4, 3.4, 21.6, 8.4, 1)
    box_ = RR(4, 9.6, 20, 21.2, 1)
    return U(lid, box_), RR(9.2, 12, 14.8, 14.4, 1.1)


@icon
def case():
    handle = RR(8.4, 2.8, 15.6, 8, 1.6).difference(RR(10.2, 4.6, 13.8, 8.4, 0.6))
    bag = RR(2.4, 7.2, 21.6, 20.8, 1.6)
    return U(handle, bag), U(L([(2.4, 13), (21.6, 13)], 1.2, 'flat'), RR(10.4, 11.4, 13.6, 14.6, 0.5)).intersection(bag)


@icon
def cross():
    x = U(L([(7.8, 7.8), (16.2, 16.2)], 2.8), L([(16.2, 7.8), (7.8, 16.2)], 2.8))
    return U(ring(12, 12, 9.4, 2), x), None


@icon
def check():
    return L([(3.8, 12.6), (9.4, 18.2), (20.2, 6.2)], 3.6), None


@icon
def info():
    return C(12, 12, 10.2), U(C(12, 6.9, 1.7), RR(10.6, 10, 13.4, 17.8, 0.7))


@icon
def warn():
    tri = P((12, 2.2), (22.6, 20.8), (1.4, 20.8)).buffer(-0.9).buffer(0.9)
    return tri, U(RR(10.8, 8.4, 13.2, 14.6, 0.6), C(12, 17.4, 1.4))


@icon
def manual():
    palm = RR(7, 11, 18, 22, 3.4)
    finger = RR(8.8, 2.2, 12.4, 14, 1.8)
    knuckles = U(RR(12.4, 8.8, 15.1, 13.6, 1.35), RR(15.1, 9.8, 17.8, 13.6, 1.3))
    thumb = L([(7.8, 15.6), (4.8, 12.2)], 3.0)
    seams = U(L([(12.4, 10), (12.4, 13.6)], 0.55, 'flat'), L([(15.1, 11), (15.1, 13.6)], 0.55, 'flat'))
    body = U(palm, finger, knuckles, thumb).difference(seams)
    return body, B(7, 19.6, 18, 22)

@icon
def edit():
    tip = P((12, 22.4), (9.6, 16.6), (14.4, 16.6))
    shaft = B(9.6, 5.8, 14.4, 16.6)
    cap = RR(9.6, 1.8, 14.4, 5.2, 1)
    body = U(tip, shaft, cap)
    half = U(P((9.6, 16.6), (14.4, 16.6), (13, 19.8), (11, 19.8)), L([(9, 5.5), (15, 5.5)], 0.0001))
    body = body.difference(L([(9, 5.5), (15, 5.5)], 0.6, 'flat'))
    return fit2(rot(body, 45), rot(half, 45), 2.2, 21.8)


@icon
def plus():
    return U(L([(12, 3.6), (12, 20.4)], 3.6), L([(3.6, 12), (20.4, 12)], 3.6)), None


@icon
def minus():
    return L([(3.6, 12), (20.4, 12)], 3.6), None


@icon
def terrain():
    body = P((1.4, 20.6), (9, 5.6), (13.2, 13.4), (15.8, 9.2), (22.6, 20.6))
    snow = P((9, 5.6), (11.6, 10.6), (10.2, 9.8), (9, 11.2), (7.8, 9.8), (6.4, 10.6))
    return body, snow


@icon
def copyright():
    return U(ring(12, 12, 9.2, 2), arcL(12, 12, 4.2, 42, 318, 2.3)), None


@icon
def vibration():
    phone = RR(7.8, 2.6, 16.2, 21.4, 1.6)
    waves = U(L([(4.6, 7.6), (3, 9.8), (4.6, 12), (3, 14.2), (4.6, 16.4)], 1.6), L([(19.4, 7.6), (21, 9.8), (19.4, 12), (21, 14.2), (19.4, 16.4)], 1.6))
    return U(phone, waves), RR(9.4, 4.8, 14.6, 17.4, 0.6)


@icon
def fastForward():
    return U(P((2.6, 5), (12, 12), (2.6, 19)), P((12, 5), (21.4, 12), (12, 19))).buffer(-0.5).buffer(0.5), None


@icon
def gamepad():
    body = U(RR(3.6, 6.6, 20.4, 15.8, 4), C(6.6, 15, 3.8), C(17.4, 15, 3.8))
    return body, U(L([(7.4, 8.8), (7.4, 13.2)], 1.5, 'flat'), L([(5.2, 11), (9.6, 11)], 1.5, 'flat'), C(15.6, 9.8, 1.15), C(17.8, 12.2, 1.15))


def mouse_parts():
    m = RR(6, 2.4, 18, 21.6, 6)
    seams = U(L([(12, 2), (12, 10)], 0.8, 'flat'), L([(5, 10), (19, 10)], 0.8, 'flat'))
    m = m.difference(seams)
    left = m.intersection(B(0, 0, 12, 10))
    right = m.intersection(B(12, 0, 24, 10))
    low = m.intersection(B(0, 10, 24, 24))
    return m, left, right, low


@icon
def mouseLeft():
    m, l, r, lo = mouse_parts()
    return m, U(r, lo)


@icon
def mouseRight():
    m, l, r, lo = mouse_parts()
    return m, U(l, lo)


@icon
def mouseWheel():
    m, l, r, lo = mouse_parts()
    wheel = RR(10.6, 4.2, 13.4, 9.2, 1.4)
    return U(m.difference(wheel.buffer(0.7)), wheel), m.difference(wheel.buffer(0.7))


@icon
def download():
    arrow = U(L([(12, 2.4), (12, 11)], 2.8), head((12, 16.2), 90, 6.6, 10.4))
    tray = L([(3.4, 15.4), (3.4, 20.6), (20.6, 20.6), (20.6, 15.4)], 2.4)
    return U(arrow, tray), tray


@icon
def trash():
    lid = U(RR(3, 4.4, 21, 7.2, 1), RR(9, 2, 15, 5, 0.9))
    can = P((5, 8.4), (19, 8.4), (17.8, 21.6), (6.2, 21.6)).buffer(-0.6).buffer(0.6)
    ribs = U(L([(9.4, 11), (9.8, 18.8)], 1.1), L([(12, 11), (12, 18.8)], 1.1), L([(14.6, 11), (14.2, 18.8)], 1.1))
    return U(lid, can), ribs


@icon
def copy():
    front = RR(8.6, 8.6, 21.4, 21.4, 1.6)
    back = gap(front, RR(2.6, 2.6, 15.4, 15.4, 1.6), 1.2)
    return U(front, back), back


@icon
def dragHandle():
    return U(*[C(x, y, 1.95) for x in (8.8, 15.2) for y in (5.6, 12, 18.4)]), None


@icon
def externalLink():
    frame = L([(18.2, 13.6), (18.2, 20.6), (3.4, 20.6), (3.4, 5.8), (10.4, 5.8)], 2.4)
    arrow = U(L([(10.6, 13.4), (18.6, 5.4)], 2.6), P((13, 3), (21, 3), (21, 11)))
    return U(frame, arrow), frame


@icon
def shuffle():
    p1 = L([(2.8, 7), (7, 7), (14.6, 17), (17.4, 17)], 2.4)
    p2 = L([(2.8, 17), (7, 17), (14.6, 7), (17.4, 7)], 2.4)
    heads = U(head((21.8, 7), 0, 5.2, 7.4), head((21.8, 17), 0, 5.2, 7.4))
    return U(p1, gap(p1, p2, 1.1), heads), None


@icon
def route():
    path = L([(6, 18), (15.4, 18), (17.6, 15.8), (17.6, 14.2), (15.4, 12), (8.6, 12), (6.4, 9.8), (6.4, 8.2), (8.6, 6), (18, 6)], 2.0)
    ends = U(C(5.4, 18, 2.8), hull(C(18.4, 6, 2.6), Point(18.4, 11.2)))
    return U(path, ends), path.difference(ends.buffer(0.8))


@icon
def undo():
    arc = arcL(13.6, 13.4, 6.2, -90, 90, 2.6, 'flat')
    top = L([(13.6, 7.2), (7.4, 7.2)], 2.6, 'flat')
    bottom = L([(13.6, 19.6), (8.2, 19.6)], 2.6)
    return U(arc, top, bottom, head((2.6, 7.2), 180, 5.8, 9)), None


@icon
def wind():
    l1 = U(L([(2.6, 9), (15.4, 9)], 2.2), arcL(15.4, 6.2, 2.8, 90, -150, 2.2))
    l2 = U(L([(2.6, 14), (18.6, 14)], 2.2), arcL(18.6, 16.8, 2.8, -90, 150, 2.2))
    l3 = L([(5, 19.2), (12.4, 19.2)], 2.2)
    return U(l1, l2, l3), l3


@icon
def camera():
    body = U(RR(2.4, 6.4, 21.6, 20.2, 2), P((7.6, 6.6), (9.2, 3.6), (14.8, 3.6), (16.4, 6.6)))
    return body, U(ring(12, 13.2, 3.9, 1.9), C(18.2, 9.4, 0.9))


@icon
def globe():
    disc = C(12, 12, 10.2)
    grid_ = U(E(12, 12, 4.4, 10.2).exterior.buffer(0.55), L([(1, 12), (23, 12)], 1.1),
              L([(1, 7.2), (23, 7.2)], 1.0), L([(1, 16.8), (23, 16.8)], 1.0), L([(12, 1), (12, 23)], 1.0))
    return disc, grid_.intersection(disc.buffer(-0.01))


@icon
def replay():
    arc = U(arcL(12, 12, 8.8, -40, 228, 2.4, 'flat'), head(pol(12, 12, 8.8, 242), 242 + 90, 4.6, 6.2))
    tri = P((9.6, 8.2), (16.4, 12), (9.6, 15.8)).buffer(-0.3).buffer(0.3)
    return U(arc, tri), arc


@icon
def keyboard():
    plate = RR(1.8, 5.6, 22.2, 18.6, 1.6)
    keys = U(*[RR(x, y, x + 2.2, y + 2.1, 0.4) for x in (4, 7.1, 10.2, 13.3, 16.4, 19.5 - 1.5) for y in (8, 11.2)
               if x + 2.2 < 20.4], RR(7.4, 14.4, 16.6, 16.4, 0.5))
    return plate, keys


@icon
def nextCamo():
    frame = U(*[L(p, 2.4) for p in ([(4, 8.4), (4, 4), (8.4, 4)], [(15.6, 4), (20, 4), (20, 8.4)], [(20, 15.6), (20, 20), (15.6, 20)],
                                    [(8.4, 20), (4, 20), (4, 15.6)], [(10.6, 4), (13.4, 4)], [(20, 10.6), (20, 13.4)],
                                    [(13.4, 20), (10.6, 20)], [(4, 13.4), (4, 10.6)])])
    inner = RR(7, 7, 17, 17, 0.8)
    return U(frame, inner), inner


ALIASES = {'hqSolid': 'castle', 'coinSolid': 'coin', 'waveSolid': 'wave', 'random': 'dice', 'nextGround': 'walk', 'nextAir': 'plane'}


# ---- output --------------------------------------------------------------

def path(g):
    if g is None or g.is_empty:
        return ''
    polys = [g] if isinstance(g, Polygon) else [p for p in getattr(g, 'geoms', []) if isinstance(p, Polygon)]
    out = []
    for p in polys:
        for rg in [p.exterior, *p.interiors]:
            c = list(rg.coords)[:-1]
            out.append('M' + 'L'.join(f'{x:.2f} {y:.2f}'.replace('.00', '') for x, y in c) + 'Z')
    return ''.join(out)


def render(name):
    """The inner SVG of one icon: the form, then its quiet details."""
    body, half = ICONS[name]()
    body = body.buffer(-0.3, quad_segs=8).buffer(0.3, quad_segs=8)
    if half is not None and not half.is_empty:
        half = half.intersection(body)
        full = body.difference(half)
    else:
        full, half = body, None
    full = full.buffer(0).simplify(0.02)
    out = f'<path fill-rule="evenodd" d="{path(full)}"/>'
    if half is not None and not half.is_empty:
        out += f'<path fill-rule="evenodd" fill-opacity=".4" d="{path(half.buffer(0).simplify(0.02))}"/>'
    return out


TARGET = Path(__file__).resolve().parents[2] / 'src/app/components/icon/icon.component.ts'
START, END = '  // <generated by tools/icons/draw_icons.py>\n', '  // </generated>\n'


if __name__ == '__main__':
    out = {n: render(n) for n in ICONS}
    for a, b in ALIASES.items():
        out[a] = out[b]
    raw = TARGET.read_bytes().decode('utf8')
    crlf = '\r\n' in raw
    text = raw.replace('\r\n', '\n')
    union = text[text.index('export type TdIconName'):]
    names = re.findall(r"'(\w+)'", union[:union.index(';')])
    missing = [n for n in names if n not in out]
    if missing:
        sys.exit(f'not drawn: {missing}')
    block = START + ''.join(f"  {n}: '{out[n]}',\n" for n in names) + END
    a, b = text.index(START), text.index(END) + len(END)
    text = text[:a] + block + text[b:]
    TARGET.write_bytes((text.replace('\n', '\r\n') if crlf else text).encode('utf8'))
    print(len(names), 'icons written')


