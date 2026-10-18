"""Sports, play, street and shop models for the areas and points of interest of OSM worlds (loaded by
build_models.py; docs/OSM_WORLD_ROUND2_PLAN.md, P4).

Three sets in the family of build_modern.py (painted steel, rough timber, concrete, plaster colours of a
German town):

- Courts and playgrounds: basketball hoop, tennis and volleyball nets, a concrete table-tennis table, a
  small-pitch goal with a steel mesh back, a handball goal in red and white bands, a skate quarter pipe,
  a timber climbing tower, a seesaw, a spring rider, a sandpit.
- Street and square: a bicycle rack of three hoops, an advertising column with drawn posters, a fuel
  pump on its island, a wayside cross under a tin roof, a raised flower bed, a pool lounger, a beer table
  set, a bistro set, a market parasol.
- Facades: shopfronts in two widths, an awning, a facade sign board and a wrought-iron bracket sign. Their
  origin lies on the wall at their foot, the front towards -Y: the generator puts them on a facade anchor.
  The sign boards keep an empty panel; the game writes the kind of shop on it (render/objects/sign-text.ts,
  catalogue `signPanel`).

Awning, parasol, sign boards and the fuel pump are drawn light so an object `tint` gives them the colour of
their shop. Every model gets baked AO and, where collapsing its tubes saves most of it, a flat-coloured distance
copy (`lod` counts polygons, mostly quads: about 40 % of the model's triangles).
"""
import math
import os

import bmesh
import bpy
from mathutils import Vector

import blender_kit
from blender_kit import Part, box, card_material, clear_scene, flat_material, net_material, oriented_box, pbr_material, tube
from blender_kit import export as export_plain
from build_city import glass
from build_modern import export, plank, prism

GALV = (0.45, 0.46, 0.45)
WOOD = (0.95, 0.8, 0.6)


def galvanised():
    return Part(flat_material('galvanised', GALV, 0.4, 0.8), smooth=True)


def goal_net():
    return net_material('goal', (0.88, 0.88, 0.86), diamond=True)


def steel_mesh():
    return net_material('steel', (0.5, 0.51, 0.5), cell=40, cord=7)


def ring_points(centre, radius, n, axis='z', start=0.0):
    """`n + 1` points round a circle (the last one closes it), in the plane across `axis`"""
    pts = []
    for k in range(n + 1):
        a = start + k / n * math.tau
        c, s = math.cos(a) * radius, math.sin(a) * radius
        off = {'z': Vector((c, s, 0)), 'x': Vector((0, c, s)), 'y': Vector((c, 0, s))}[axis]
        pts.append(centre + off)
    return pts


def ring(part, centre, radius, thickness, n=16, axis='z', sides=6):
    pts = ring_points(centre, radius, n, axis)
    tube(part, pts, [thickness] * len(pts), sides)


def bent(points, radius, steps=3):
    """A polyline with its inner corners rounded by `radius` (bent tube)"""
    out = [points[0]]
    for a, b, c in zip(points, points[1:], points[2:]):
        da, db = (a - b).normalized(), (c - b).normalized()
        r = min(radius, (a - b).length / 2, (c - b).length / 2)
        p0, p1 = b + da * r, b + db * r
        for k in range(steps + 1):
            t = k / steps
            out.append(p0.lerp(b, t).lerp(b.lerp(p1, t), t))
    out.append(points[-1])
    return out


def striped_tube(parts, a, b, radius, band, sides=8):
    """A tube from a to b in bands of `band` metres, alternating between the parts (a handball goal, an
    antenna)"""
    length = (b - a).length
    n = max(1, round(length / band))
    for k in range(n):
        tube(parts[k % len(parts)], [a.lerp(b, k / n), a.lerp(b, (k + 1) / n)], [radius, radius], sides)


def net_quad(part, corners, metres):
    """One net card; `metres` of the net per texture repeat"""
    a, b, c, d = corners
    w, h = (b - a).length / metres, (d - a).length / metres
    part.quad(corners, [(0, 0), (w, 0), (w, h), (0, h)])


def footing(part, x, y, size=0.4):
    box(part, x, y, -0.25, size, size, 0.3)


# ---------------------------------------------------------------- courts and playgrounds

def basketball_hoop(name):
    """Street basketball: a steel post behind the line, a braced arm, a white backboard with the red shooter's
    square, an orange ring with a chain-net cone (court towards -Y)"""
    clear_scene()
    steel = Part(flat_material('post-blue', (0.08, 0.2, 0.38), 0.45, 0.6), smooth=True)
    board = Part(flat_material('backboard-white', (0.88, 0.89, 0.87), 0.35))
    lines = Part(flat_material('backboard-red', (0.62, 0.1, 0.07), 0.5))
    hoop = Part(flat_material('hoop-orange', (0.85, 0.32, 0.05), 0.4, 0.6), smooth=True)
    net = Part(net_material('hoop', (0.92, 0.92, 0.9), cell=40, cord=7, diamond=True), uv_scale=2.0)
    concrete = Part(pbr_material('footing-concrete', 'brushed_concrete', (0.7, 0.7, 0.7)), uv_metres=1.0)
    post_y = 1.1
    tube(steel, [Vector((0, post_y, -0.3)), Vector((0, post_y, 3.1)), Vector((0, post_y - 0.25, 3.35))], [0.075, 0.07, 0.06], 10)
    tube(steel, [Vector((0, post_y - 0.25, 3.35)), Vector((0, 0.06, 3.35))], [0.055, 0.055], 8)
    tube(steel, [Vector((0, post_y, 2.55)), Vector((0, 0.06, 3.05))], [0.04, 0.04], 8)
    for sx in (-0.35, 0.35):
        oriented_box(steel, Vector((sx, 0.04, 3.0)), Vector((sx, 0.04, 3.75)), 0.04)
    footing(concrete, 0, post_y, 0.5)
    w, h, z0 = 1.8, 1.05, 2.9
    box(board, 0, 0, z0, w, 0.04, h)
    t = 0.05
    for (cx, cz, sx, sz) in ((0, z0 + h - t / 2, w - 0.04, t), (0, z0 + t / 2, w - 0.04, t), (-w / 2 + t / 2, z0 + h / 2, t, h - 0.04),
                             (w / 2 - t / 2, z0 + h / 2, t, h - 0.04)):
        box(lines, cx, -0.022, cz - sz / 2, sx, 0.006, sz)
    sw, sh, sz0 = 0.59, 0.45, 3.05
    for (cx, cz, sx, szz) in ((0, sz0 + sh - t / 2, sw, t), (0, sz0 + t / 2, sw, t), (-sw / 2 + t / 2, sz0 + sh / 2, t, sh),
                              (sw / 2 - t / 2, sz0 + sh / 2, t, sh)):
        box(lines, cx, -0.022, cz - szz / 2, sx, 0.006, szz)
    r = 0.23
    c = Vector((0, -0.15 - r, 3.05))
    ring(hoop, c, r, 0.011, n=20, sides=6)
    box(hoop, 0, -0.08, 2.98, 0.22, 0.14, 0.08)
    cone = [c, c + Vector((0, 0, -0.22)), c + Vector((0, 0, -0.42))]
    tube(net, cone, [r, 0.19, 0.15], 12)
    export(name, [steel.to_object(name), board.to_object(name + '-board'), lines.to_object(name + '-lines'),
                  hoop.to_object(name + '-hoop'), net.to_object(name + '-net'), concrete.to_object(name + '-footing')], lod=110)


def tennis_net(name, span=12.8):
    """Tennis net: two dark green posts with the winder, the net sagging to 0.914 m in the middle under a white
    band, the centre strap (along X)"""
    clear_scene()
    post = Part(flat_material('post-green', (0.06, 0.16, 0.1), 0.5, 0.5), smooth=True)
    band = Part(flat_material('net-band-white', (0.9, 0.9, 0.88), 0.7))
    net = Part(net_material('tennis', (0.09, 0.12, 0.1), cord=6))
    for sx in (-1, 1):
        tube(post, [Vector((sx * span / 2, 0, -0.3)), Vector((sx * span / 2, 0, 1.09))], [0.045, 0.045], 8, cap=True)
    box(post, -span / 2, -0.09, 0.85, 0.06, 0.14, 0.12)
    mid, end = 0.914, 1.07
    for sx in (-1, 1):
        a = Vector((sx * (span / 2 - 0.05), 0, 0.05))
        top_end = Vector((sx * (span / 2 - 0.05), 0, end))
        net_quad(net, [a, Vector((0, 0, 0.05)), Vector((0, 0, mid)), top_end] if sx > 0 else
                 [Vector((0, 0, 0.05)), a, top_end, Vector((0, 0, mid))], 0.5)
        plank(band, Vector((0, 0, mid - 0.03)), Vector((sx * (span / 2 - 0.05), 0, end - 0.03)), 0.02, 0.065)
    box(band, 0, 0, 0.0, 0.05, 0.015, mid)
    export(name, [post.to_object(name), band.to_object(name + '-band'), net.to_object(name + '-net')], lod=None)


def volleyball_net(name):
    """Volleyball: padded posts with guy lines, the net 1 m deep with its top at 2.43 m, white bands and side
    markers, red and white antennas (along X)"""
    clear_scene()
    steel = galvanised()
    pad = Part(flat_material('post-pad-blue', (0.06, 0.18, 0.42), 0.8), smooth=True)
    white = Part(flat_material('net-band-white', (0.9, 0.9, 0.88), 0.7))
    red = Part(flat_material('antenna-red', (0.7, 0.1, 0.08), 0.5))
    net = Part(net_material('volley', (0.05, 0.05, 0.055), cord=6))
    px = 5.75
    for sx in (-1, 1):
        tube(steel, [Vector((sx * px, 0, -0.4)), Vector((sx * px, 0, 2.55))], [0.045, 0.045], 8, cap=True)
        tube(pad, [Vector((sx * px, 0, 0.0)), Vector((sx * px, 0, 1.9))], [0.1, 0.1], 10, cap=True)
        tube(steel, [Vector((sx * px, 0, 2.5)), Vector((sx * (px + 1.6), 0, 0.0))], [0.006, 0.006], 4)
        box(steel, sx * (px + 1.6), 0, -0.1, 0.12, 0.12, 0.14)
    w, top, depth = 9.5, 2.43, 1.0
    net_quad(net, [Vector((-w / 2, 0, top - depth)), Vector((w / 2, 0, top - depth)), Vector((w / 2, 0, top)), Vector((-w / 2, 0, top))], 0.5)
    box(white, 0, 0, top - 0.07, w, 0.012, 0.07)
    box(white, 0, 0, top - depth, w, 0.012, 0.05)
    for sx in (-1, 1):
        box(white, sx * w / 2, 0, top - depth, 0.05, 0.014, depth)
        tube(white, [Vector((sx * w / 2, 0, top)), Vector((sx * px, 0, top))], [0.004, 0.004], 4)
        striped_tube([red, white], Vector((sx * (w / 2 - 0.05), 0, top - depth)), Vector((sx * (w / 2 - 0.05), 0, top + 0.8)), 0.006, 0.1, 6)
    export(name, [steel.to_object(name), pad.to_object(name + '-pad'), white.to_object(name + '-white'), red.to_object(name + '-red'),
                  net.to_object(name + '-net')], lod=120)


def table_tennis(name):
    """Outdoor table tennis: a green-painted concrete slab with white lines on two concrete legs, a perforated
    steel net (long side along X)"""
    clear_scene()
    concrete = Part(pbr_material('table-concrete', 'brushed_concrete', (0.66, 0.66, 0.64)), uv_metres=1.5, bevel=0.015)
    top = Part(pbr_material('table-green', 'brushed_concrete', (0.18, 0.36, 0.25)), uv_metres=1.5, bevel=0.012)
    white = Part(flat_material('line-white', (0.9, 0.9, 0.88), 0.6))
    steel = Part(flat_material('net-steel', (0.2, 0.21, 0.22), 0.5, 0.7))
    L, W, z = 2.74, 1.525, 0.68
    box(top, 0, 0, z, L, W, 0.08)
    for sx in (-0.85, 0.85):
        box(concrete, sx, 0, -0.1, 0.22, 1.1, z + 0.1)
        box(concrete, sx, 0, -0.1, 0.5, 1.3, 0.14)
    zt = z + 0.081
    lw = 0.025
    box(white, 0, -W / 2 + lw / 2 + 0.005, zt, L - 0.01, lw, 0.002)
    box(white, 0, W / 2 - lw / 2 - 0.005, zt, L - 0.01, lw, 0.002)
    box(white, -L / 2 + lw / 2 + 0.005, 0, zt, lw, W - 0.01, 0.002)
    box(white, L / 2 - lw / 2 - 0.005, 0, zt, lw, W - 0.01, 0.002)
    box(white, 0, 0, zt, L - 0.01, 0.006, 0.002)
    box(steel, 0, 0, zt, 0.03, W + 0.15, 0.155)
    for sy in (-1, 1):
        box(steel, 0, sy * (W / 2 + 0.06), z - 0.02, 0.05, 0.05, 0.2)
    export(name, [concrete.to_object(name), top.to_object(name + '-top'), white.to_object(name + '-lines'), steel.to_object(name + '-net')],
           lod=None)


def goal(name, w, h, depth, posts, back=goal_net, back_metres=1.0, stripe=None, lod=None):
    """A goal on a court (front -Y): posts and crossbar, back stanchions, the net or a steel mesh. `posts`
    makes the frame's part, `stripe` a second one for the posts in bands (handball)"""
    clear_scene()
    posts = posts()
    stripe = stripe() if stripe else None
    net = Part(back())
    frame = [posts] + ([stripe] if stripe else [])
    r = 0.04 if w < 6 else 0.06
    for sx in (-1, 1):
        if stripe:
            striped_tube(frame, Vector((sx * w / 2, 0, h)), Vector((sx * w / 2, 0, -0.2)), r, 0.2)
        else:
            tube(posts, [Vector((sx * w / 2, 0, -0.2)), Vector((sx * w / 2, 0, h))], [r, r], 8)
        tube(posts, bent([Vector((sx * w / 2, 0.0, h)), Vector((sx * w / 2, 0.45, h)), Vector((sx * w / 2, depth, 0.02))], 0.2),
             [0.022] * 7, 6)
        tube(posts, [Vector((sx * w / 2, 0.0, 0.02)), Vector((sx * w / 2, depth, 0.02))], [0.022, 0.022], 6)
    if stripe:
        striped_tube(frame, Vector((-w / 2 - r, 0, h)), Vector((w / 2 + r, 0, h)), r, 0.2)
    else:
        tube(posts, [Vector((-w / 2 - r, 0, h)), Vector((w / 2 + r, 0, h))], [r, r], 8)
    tube(posts, [Vector((-w / 2, depth, 0.02)), Vector((w / 2, depth, 0.02))], [0.022, 0.022], 6)
    tube(posts, [Vector((-w / 2, 0.45, h)), Vector((w / 2, 0.45, h))], [0.018, 0.018], 6)
    net_quad(net, [Vector((-w / 2, depth, 0.02)), Vector((w / 2, depth, 0.02)), Vector((w / 2, 0.45, h)), Vector((-w / 2, 0.45, h))],
             back_metres)
    net_quad(net, [Vector((-w / 2, 0.45, h)), Vector((w / 2, 0.45, h)), Vector((w / 2, 0.0, h)), Vector((-w / 2, 0.0, h))], back_metres)
    for sx in (-1, 1):
        f = net.bm.faces.new([net.bm.verts.new(v) for v in (Vector((sx * w / 2, 0, 0.02)), Vector((sx * w / 2, depth, 0.02)),
                                                              Vector((sx * w / 2, 0.45, h)), Vector((sx * w / 2, 0, h)))])
        for loop in f.loops:
            loop[net.uv].uv = (loop.vert.co.y / back_metres, loop.vert.co.z / back_metres)
    objects = [posts.to_object(name), net.to_object(name + '-net')]
    if stripe:
        objects.append(stripe.to_object(name + '-stripe'))
    export(name, objects, lod=lod)


def goal_small(name):
    """Small-pitch goal of a kick-about court (5 x 2 m): galvanised frame, a welded steel mesh as its back"""
    goal(name, 5.0, 2.0, 1.2, galvanised, back=steel_mesh, back_metres=0.8)


def handball_goal(name):
    """Handball goal (3 x 2 m) in red and white bands, white net"""
    goal(name, 3.0, 2.0, 1.0, lambda: Part(flat_material('goal-white', (0.9, 0.9, 0.88), 0.4), smooth=True),
         stripe=lambda: Part(flat_material('goal-red', (0.68, 0.08, 0.06), 0.45), smooth=True), lod=150)


def skate_ramp(name, w=3.6, radius=2.2, height=1.4, deck=1.4):
    """Concrete quarter pipe (riding face towards -Y): the transition, a steel coping, a deck with a railing
    round its back"""
    clear_scene()
    concrete = Part(pbr_material('ramp-concrete', 'brushed_concrete', (0.78, 0.78, 0.76)), uv_metres=2.0, bevel=0.0)
    steel = galvanised()
    phi_max = math.acos((radius - height) / radius)
    n = 10
    prof = []
    for k in range(n + 1):
        phi = phi_max * k / n
        prof.append((radius * math.sin(phi) - radius * math.sin(phi_max), radius - radius * math.cos(phi)))
    y_top = 0.0
    y_back = y_top + deck
    bm = concrete.bm
    left = [bm.verts.new((-w / 2, y, z)) for y, z in prof]
    right = [bm.verts.new((w / 2, y, z)) for y, z in prof]
    for k in range(n):
        bm.faces.new((left[k], right[k], right[k + 1], left[k + 1]))
    # Deck, back, underside and the two side walls
    lb, rb = bm.verts.new((-w / 2, y_back, height)), bm.verts.new((w / 2, y_back, height))
    lg, rg = bm.verts.new((-w / 2, y_back, 0)), bm.verts.new((w / 2, y_back, 0))
    bm.faces.new((left[-1], right[-1], rb, lb))
    bm.faces.new((lb, rb, rg, lg))
    bm.faces.new(list(reversed(left + [lb, lg])))
    bm.faces.new(right + [rb, rg])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    tube(steel, [Vector((-w / 2, y_top - 0.03, height + 0.03)), Vector((w / 2, y_top - 0.03, height + 0.03))], [0.035, 0.035], 8)
    for x in (-w / 2 + 0.08, 0.0, w / 2 - 0.08):
        tube(steel, [Vector((x, y_back - 0.06, height)), Vector((x, y_back - 0.06, height + 1.0))], [0.025, 0.025], 6)
    tube(steel, bent([Vector((-w / 2 + 0.08, y_top + 0.5, height + 1.0)), Vector((-w / 2 + 0.08, y_back - 0.06, height + 1.0)),
                      Vector((w / 2 - 0.08, y_back - 0.06, height + 1.0)), Vector((w / 2 - 0.08, y_top + 0.5, height + 1.0))], 0.12),
         [0.028] * 10, 6)
    for sx in (-1, 1):
        tube(steel, [Vector((sx * (w / 2 - 0.08), y_top + 0.5, height)), Vector((sx * (w / 2 - 0.08), y_top + 0.5, height + 1.0))],
             [0.025, 0.025], 6)
    export(name, [concrete.to_object(name), steel.to_object(name + '-steel')], lod=None)


def climbing_frame(name):
    """Timber climbing tower: four round posts, a platform with rails, a rope net up the front, a climbing wall
    with coloured holds on one side, a ladder at the back, a pitched roof of boards"""
    clear_scene()
    wood = Part(pbr_material('playground-wood', 'rough_wood', WOOD), smooth=True)
    boards = Part(pbr_material('playground-boards', 'rough_wood', (0.85, 0.7, 0.5)), uv_metres=1.0)
    rope = Part(net_material('rope', (0.78, 0.68, 0.5), cell=32, cord=7, diamond=True))
    holds_a = Part(flat_material('holds-yellow', (0.85, 0.62, 0.08), 0.6))
    holds_b = Part(flat_material('holds-blue', (0.08, 0.3, 0.62), 0.6))
    roof = Part(pbr_material('playground-roof', 'rough_wood', (0.55, 0.7, 0.5)), uv_metres=1.0)
    s, deck, top = 1.8, 1.35, 3.1
    for sx in (-1, 1):
        for sy in (-1, 1):
            tube(wood, [Vector((sx * s / 2, sy * s / 2, -0.4)), Vector((sx * s / 2, sy * s / 2, top))], [0.065, 0.06], 8, cap=True)
    box(boards, 0, 0, deck, s + 0.04, s + 0.04, 0.06)
    for sx in (-1, 1):
        tube(wood, [Vector((sx * s / 2, -s / 2, deck + 0.75)), Vector((sx * s / 2, s / 2, deck + 0.75))], [0.035, 0.035], 6)
    tube(wood, [Vector((-s / 2, s / 2, deck + 0.75)), Vector((s / 2, s / 2, deck + 0.75))], [0.035, 0.035], 6)
    # Rope net slanting from the deck's front edge to a beam on the ground
    tube(wood, [Vector((-s / 2 - 0.1, -s / 2 - 1.3, 0.12)), Vector((s / 2 + 0.1, -s / 2 - 1.3, 0.12))], [0.06, 0.06], 8)
    net_quad(rope, [Vector((-s / 2, -s / 2 - 1.3, 0.12)), Vector((s / 2, -s / 2 - 1.3, 0.12)), Vector((s / 2, -s / 2, deck + 0.05)),
                    Vector((-s / 2, -s / 2, deck + 0.05))], 1.4)
    # Climbing wall on the east side, holds scattered over it
    wall_x = s / 2 + 0.06
    box(boards, wall_x, 0, 0.0, 0.05, s - 0.1, deck + 0.02)
    k = 0
    for row in range(4):
        for col in range(3):
            y = -s / 2 + 0.3 + col * 0.55 + (0.18 if row % 2 else 0)
            z = 0.25 + row * 0.3
            part = holds_a if (row + col) % 2 else holds_b
            box(part, wall_x + 0.04, y, z, 0.05, 0.1 + 0.03 * (k % 3), 0.07)
            k += 1
    # Ladder up the back
    for sx in (-0.25, 0.25):
        plank(boards, Vector((sx, s / 2 + 1.0, -0.05)), Vector((sx, s / 2, deck)), 0.05, 0.09)
    for k in range(5):
        t = (k + 0.6) / 6
        box(boards, 0, s / 2 + 1.0 * (1 - t), -0.05 + (deck + 0.05) * t, 0.5, 0.05, 0.04)
    for sy in (-1, 1):
        plank(roof, Vector((0, 0, top + 0.62)), Vector((0, sy * (s / 2 + 0.25), top - 0.08)), s + 0.4, 0.04)
    tube(wood, [Vector((-s / 2 - 0.2, 0, top + 0.64)), Vector((s / 2 + 0.2, 0, top + 0.64))], [0.05, 0.05], 8, cap=True)
    export(name, [wood.to_object(name), boards.to_object(name + '-boards'), rope.to_object(name + '-net'),
                  holds_a.to_object(name + '-holds-a'), holds_b.to_object(name + '-holds-b'), roof.to_object(name + '-roof')], lod=140)


def seesaw(name, length=3.6, tilt_deg=11.0):
    """Seesaw: a timber beam on a steel pivot, at rest with one end down on its buffer tyre; handles and
    seats at both ends"""
    clear_scene()
    wood = Part(pbr_material('playground-wood', 'rough_wood', WOOD), uv_metres=1.0)
    steel = Part(flat_material('seesaw-green', (0.1, 0.35, 0.2), 0.45, 0.5), smooth=True)
    rubber = Part(flat_material('rubber-black', (0.03, 0.03, 0.03), 0.9), smooth=True)
    pivot_z = 0.55
    prism(steel, [Vector((-0.25, -0.12, 0.0)), Vector((0.25, -0.12, 0.0)), Vector((0.06, -0.12, pivot_z)), Vector((-0.06, -0.12, pivot_z))],
          Vector((0, 0.04, 0)))
    prism(steel, [Vector((-0.25, 0.08, 0.0)), Vector((0.25, 0.08, 0.0)), Vector((0.06, 0.08, pivot_z)), Vector((-0.06, 0.08, pivot_z))],
          Vector((0, 0.04, 0)))
    box(steel, 0, 0, -0.2, 0.6, 0.4, 0.22)
    tube(steel, [Vector((0, -0.16, pivot_z)), Vector((0, 0.16, pivot_z))], [0.04, 0.04], 8, cap=True)
    a = math.radians(tilt_deg)
    d = Vector((math.cos(a), 0, -math.sin(a)))
    centre = Vector((0, 0, pivot_z + 0.06))
    plank(wood, centre - d * (length / 2), centre + d * (length / 2), 0.2, 0.1)
    up = Vector((math.sin(a), 0, math.cos(a)))
    for sgn in (-1, 1):
        end = centre + d * (sgn * (length / 2 - 0.35))
        box(rubber, end.x, end.y, end.z + 0.05, 0.36, 0.26, 0.04)
        grip = centre + d * (sgn * (length / 2 - 0.75))
        tube(steel, bent([grip + Vector((0, -0.18, 0.05)), grip + up * 0.38 + Vector((0, -0.18, 0)), grip + up * 0.38 + Vector((0, 0.18, 0)),
                          grip + Vector((0, 0.18, 0.05))], 0.06), [0.018] * 10, 6)
    for sgn in (-1, 1):
        tyre_x = sgn * (length / 2 - 0.4) * math.cos(a)
        ring(rubber, Vector((tyre_x, 0, 0.02)), 0.24, 0.07, n=12, axis='y', sides=6)
    export(name, [wood.to_object(name), steel.to_object(name + '-steel'), rubber.to_object(name + '-rubber')], lod=120)


def spring_rider(name):
    """Spring rider: a chunky horse of coloured board on a steel coil, handles through its head, footrests"""
    clear_scene()
    body = Part(flat_material('rider-yellow', (0.88, 0.62, 0.08), 0.55))
    saddle = Part(flat_material('rider-blue', (0.08, 0.28, 0.6), 0.55))
    coil = Part(flat_material('coil-green', (0.12, 0.4, 0.22), 0.4, 0.6), smooth=True)
    steel = Part(flat_material('handle-steel', (0.6, 0.62, 0.63), 0.3, 0.9), smooth=True)
    pts = []
    turns, h, r = 5, 0.42, 0.11
    for k in range(turns * 10 + 1):
        a = k / 10 * math.tau
        pts.append(Vector((math.cos(a) * r, math.sin(a) * r, 0.04 + h * k / (turns * 10))))
    tube(coil, pts, [0.022] * len(pts), 6)
    box(coil, 0, 0, -0.02, 0.32, 0.32, 0.05)
    # The horse as a cut-out board (profile in x-z, 0.12 thick), the saddle and a mane on top
    prof = [(-0.42, 0.52), (0.18, 0.52), (0.3, 0.6), (0.36, 0.86), (0.48, 0.92), (0.5, 1.0), (0.38, 1.1), (0.22, 1.08),
            (0.12, 0.76), (-0.3, 0.74), (-0.46, 0.84), (-0.5, 0.68)]
    prism(body, [Vector((x, -0.06, z)) for x, z in prof], Vector((0, 0.12, 0)))
    box(saddle, -0.08, 0, 0.74, 0.32, 0.18, 0.05)
    prism(saddle, [Vector((0.16, -0.025, 0.8)), Vector((0.24, -0.025, 1.08)), Vector((0.3, -0.025, 1.1)), Vector((0.22, -0.025, 0.78))],
          Vector((0, 0.05, 0)))
    box(saddle, 0.36, 0, 0.88, 0.05, 0.13, 0.05)
    tube(steel, [Vector((0.28, -0.2, 0.98)), Vector((0.28, 0.2, 0.98))], [0.016, 0.016], 6, cap=True)
    tube(steel, [Vector((0.0, -0.2, 0.56)), Vector((0.0, 0.2, 0.56))], [0.016, 0.016], 6, cap=True)
    box(body, 0, 0, 0.46, 0.2, 0.08, 0.07)
    export(name, [body.to_object(name), saddle.to_object(name + '-saddle'), coil.to_object(name + '-coil'),
                  steel.to_object(name + '-steel')], lod=140)


def sandbox(name, s=3.2):
    """Sandpit: a frame of timber sleepers with a seat board at the corners, raked sand, a forgotten bucket"""
    clear_scene()
    wood = Part(pbr_material('sleeper-wood', 'rough_wood', (0.75, 0.6, 0.42)), uv_metres=1.0)
    sand = Part(flat_material('sandpit-sand', (0.36, 0.29, 0.19), 1.0))
    toy = Part(flat_material('bucket-blue', (0.1, 0.35, 0.7), 0.5))
    t, h = 0.2, 0.28
    for k in range(4):
        cx, cy = [(0, -s / 2 + t / 2), (s / 2 - t / 2, 0), (0, s / 2 - t / 2), (-s / 2 + t / 2, 0)][k]
        box(wood, cx, cy, -0.05, s if k % 2 == 0 else t, t if k % 2 == 0 else s - 2 * t, h + 0.05)
    for sx in (-1, 1):
        for sy in (-1, 1):
            prism(wood, [Vector((sx * (s / 2 - 0.01), sy * (s / 2 - 0.01), h)), Vector((sx * (s / 2 - 0.6), sy * (s / 2 - 0.01), h)),
                         Vector((sx * (s / 2 - 0.01), sy * (s / 2 - 0.6), h))], Vector((0, 0, 0.04)))
    n = 6
    inner = s - 2 * t
    import random
    rnd = random.Random(5)
    grid = [[sand.bm.verts.new((-inner / 2 + inner * i / n, -inner / 2 + inner * j / n,
                                 0.18 + (0.0 if i in (0, n) or j in (0, n) else rnd.uniform(-0.03, 0.05))))
             for j in range(n + 1)] for i in range(n + 1)]
    grid[2][4].co.z += 0.12
    grid[2][3].co.z += 0.06
    for i in range(n):
        for j in range(n):
            f = sand.bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            for loop in f.loops:
                loop[sand.uv].uv = (loop.vert.co.x, loop.vert.co.y)
    tube(toy, [Vector((0.6, 0.5, 0.17)), Vector((0.6, 0.5, 0.33))], [0.07, 0.09], 10, cap=True)
    export(name, [wood.to_object(name), sand.to_object(name + '-sand'), toy.to_object(name + '-toy')], lod=80)


# ---------------------------------------------------------------- street and square

def bike_rack(name, hoops=3, spacing=1.0):
    """Bicycle rack: galvanised hoops with a cross bar, set in the pavement (row along X)"""
    clear_scene()
    steel = galvanised()
    w, h = 0.8, 0.85
    for k in range(hoops):
        x = (k - (hoops - 1) / 2) * spacing
        tube(steel, bent([Vector((x, -w / 2, -0.15)), Vector((x, -w / 2, h)), Vector((x, w / 2, h)), Vector((x, w / 2, -0.15))], 0.22, 4),
             [0.025] * 12, 8)
        tube(steel, [Vector((x, -w / 2, 0.42)), Vector((x, w / 2, 0.42))], [0.02, 0.02], 6)
    export(name, [steel.to_object(name)], lod=110)


def poster_image(name, w=512, h=256, seed=3):
    """Pasted-over posters for the advertising column: torn-edged sheets of colour with blocks of dark
    lettering and a picture shape each, no words (a PNG next to the GLBs)"""
    import random
    import numpy as np
    rnd = random.Random(seed)
    px = np.zeros((h, w, 3), dtype=np.float32)
    px[:] = (0.78, 0.74, 0.64)
    palette = [(0.82, 0.62, 0.18), (0.62, 0.14, 0.12), (0.16, 0.3, 0.5), (0.86, 0.84, 0.78), (0.2, 0.42, 0.3), (0.12, 0.12, 0.14),
               (0.86, 0.5, 0.36)]
    x = 0
    while x < w:
        sw = rnd.randint(48, 96)
        y = 0
        while y < h:
            sh = rnd.randint(70, 130)
            col = np.array(rnd.choice(palette))
            x1, y1 = min(w, x + sw), min(h, y + sh)
            px[y:y1, x:x1] = col
            ink = np.array((0.08, 0.08, 0.09)) if col.mean() > 0.45 else np.array((0.9, 0.88, 0.8))
            # A picture: a disc or a band
            cx, cy = x + sw // 2, y + int(sh * 0.38)
            rr = max(6, sw // 4)
            yy, xx = np.ogrid[y:y1, x:x1]
            if rnd.random() < 0.5:
                mask = (xx - cx) ** 2 + (yy - cy) ** 2 < rr * rr
            else:
                mask = (abs(yy - cy) < rr // 2) & (xx > x + 4) & (xx < x1 - 4)
            px[y:y1, x:x1][mask] = rnd.choice(palette)
            # Lines of "lettering": short dark bars
            ly = y + int(sh * 0.66)
            while ly < y1 - 6:
                lx0 = x + 5 + rnd.randint(0, 6)
                lx1 = min(x1 - 5, lx0 + rnd.randint(sw // 3, sw - 12))
                thick = rnd.choice((2, 2, 3, 5))
                px[ly:ly + thick, lx0:lx1] = ink
                ly += thick + rnd.randint(3, 6)
            # Torn edge: a ragged paper line along the sheet's bottom
            for xi in range(x, x1):
                d = rnd.randint(0, 2)
                px[max(y, y1 - d):y1, xi] = (0.86, 0.83, 0.74)
            y = y1
        x += sw
    img = bpy.data.images.new(name, w, h)
    rgba = np.concatenate([px[::-1], np.ones((h, w, 1), dtype=np.float32)], axis=2)
    img.pixels.foreach_set(rgba.ravel())
    folder = os.path.join(blender_kit.OUT, 'tex')
    os.makedirs(folder, exist_ok=True)
    img.filepath_raw = os.path.join(folder, name + '.png')
    img.file_format = 'PNG'
    img.save()
    return img


def advertising_column(name, r=0.6, h=2.6, sides=20):
    """Advertising column: a cast-iron foot and crown in dark green, posters pasted round the drum, a small
    dome with a finial"""
    clear_scene()
    iron = Part(flat_material('column-green', (0.06, 0.17, 0.12), 0.5, 0.5), smooth=True)
    m = bpy.data.materials.new('column-posters')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(nd for nd in nt.nodes if nd.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = poster_image('column-posters')
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    posters = Part(m, smooth=True)
    z0 = 0.35
    bm = posters.bm
    lo = [bm.verts.new((math.cos(k / sides * math.tau) * r, math.sin(k / sides * math.tau) * r, z0)) for k in range(sides + 1)]
    hi = [bm.verts.new((math.cos(k / sides * math.tau) * r, math.sin(k / sides * math.tau) * r, h)) for k in range(sides + 1)]
    for k in range(sides):
        f = bm.faces.new((lo[k], lo[k + 1], hi[k + 1], hi[k]))
        f.smooth = True
        for loop, uv in zip(f.loops, [(k / sides, 0), ((k + 1) / sides, 0), ((k + 1) / sides, 1), (k / sides, 1)]):
            loop[posters.uv].uv = uv
    tube(iron, [Vector((0, 0, -0.1)), Vector((0, 0, 0.18)), Vector((0, 0, 0.24)), Vector((0, 0, z0 + 0.02))],
         [r + 0.1, r + 0.1, r + 0.04, r + 0.02], sides, smooth=False)
    tube(iron, [Vector((0, 0, h - 0.02)), Vector((0, 0, h + 0.1)), Vector((0, 0, h + 0.22)), Vector((0, 0, h + 0.3))],
         [r + 0.02, r + 0.05, r + 0.14, r + 0.14], sides, smooth=False)
    tube(iron, [Vector((0, 0, h + 0.3)), Vector((0, 0, h + 0.42)), Vector((0, 0, h + 0.62)), Vector((0, 0, h + 0.78))],
         [r + 0.06, r - 0.05, r * 0.5, 0.06], sides)
    tube(iron, [Vector((0, 0, h + 0.78)), Vector((0, 0, h + 0.86)), Vector((0, 0, h + 0.95)), Vector((0, 0, h + 1.0))],
         [0.05, 0.09, 0.07, 0.0], 8)
    export(name, [posters.to_object(name), iron.to_object(name + '-iron')], lod=90)


def fuel_pump(name):
    """Fuel pump on its island: a light body with a dark price head lit on both faces, two nozzles in their
    holsters with hoses, a concrete kerb and a yellow guard post at each end (island along X, faces -Y and +Y)"""
    clear_scene()
    body = Part(flat_material('pump-white', (0.86, 0.87, 0.86), 0.4), bevel=0.02, uv_metres=1.0)
    dark = Part(flat_material('pump-dark', (0.06, 0.065, 0.07), 0.45, 0.3))
    screen = Part(flat_material('pump-screen', (0.06, 0.09, 0.08), 0.3, emission=(0.55, 0.8, 0.6), strength=0.6))
    hose = Part(flat_material('hose-black', (0.025, 0.025, 0.025), 0.7), smooth=True)
    kerb = Part(pbr_material('kerb-concrete', 'brushed_concrete', (0.72, 0.72, 0.7)), uv_metres=1.5)
    guard = Part(flat_material('guard-yellow', (0.85, 0.62, 0.05), 0.5), smooth=True)
    L, W = 3.6, 1.1
    box(kerb, 0, 0, -0.2, L, W, 0.35)
    box(body, 0, 0, 0.15, 0.62, 0.42, 1.55)
    box(dark, 0, 0, 1.7, 0.68, 0.5, 0.42)
    box(body, 0, 0, 2.12, 0.62, 0.42, 0.06)
    for sy in (-1, 1):
        box(screen, 0, sy * 0.252, 1.78, 0.5, 0.01, 0.26)
        box(dark, 0, sy * 0.215, 0.9, 0.36, 0.01, 0.4)
        for sx in (-1, 1):
            hx, hy = sx * 0.36, sy * 0.1
            box(dark, hx, hy, 1.1, 0.1, 0.12, 0.22)
            tube(hose, [Vector((sx * 0.31, sy * 0.14, 1.55)), Vector((sx * 0.5, sy * 0.24, 1.0)), Vector((sx * 0.48, sy * 0.3, 0.4)),
                        Vector((sx * 0.4, sy * 0.15, 1.05))], [0.02, 0.02, 0.02, 0.02], 6)
    for sy in (-1, 1):
        tube(guard, [Vector((sy * (L / 2 - 0.2), 0, 0.15)), Vector((sy * (L / 2 - 0.2), 0, 1.05))], [0.07, 0.07], 10, cap=True)
    export(name, [body.to_object(name), dark.to_object(name + '-dark'), screen.to_object(name + '-screen'), hose.to_object(name + '-hose'),
                  kerb.to_object(name + '-kerb'), guard.to_object(name + '-guard')], lod=None)


def wayside_cross(name):
    """Wayside cross: an oak cross on a stepped sandstone plinth under a small tin roof, a plaque below the
    arms"""
    clear_scene()
    stone = Part(pbr_material('stone-sandstone-grey', 'sandstone_blocks_04', (0.78, 0.77, 0.74)), uv_metres=1.0)
    oak = Part(pbr_material('cross-oak', 'rough_wood', (0.55, 0.4, 0.28)), uv_metres=1.0)
    tin = Part(flat_material('roof-tin', (0.32, 0.34, 0.35), 0.45, 0.8))
    plaque = Part(flat_material('plaque-dark', (0.06, 0.06, 0.06), 0.4, 0.5))
    box(stone, 0, 0, -0.2, 1.0, 1.0, 0.4)
    box(stone, 0, 0, 0.2, 0.7, 0.7, 0.3)
    box(stone, 0, 0, 0.5, 0.45, 0.45, 0.25)
    box(oak, 0, 0, 0.7, 0.16, 0.16, 2.7)
    box(oak, 0, 0, 2.55, 1.3, 0.14, 0.16)
    box(plaque, 0, -0.085, 1.65, 0.3, 0.02, 0.22)
    top = 3.4
    for sx in (-1, 1):
        plank(tin, Vector((0, 0, top)), Vector((sx * 0.62, 0, top - 0.42)), 0.6, 0.02)
    box(oak, 0, 0, top - 0.1, 0.08, 0.62, 0.08)
    export(name, [stone.to_object(name), oak.to_object(name + '-oak'), tin.to_object(name + '-tin'), plaque.to_object(name + '-plaque')],
           lod=None)


def flower_bed(name, w=2.4, d=1.0):
    """Raised flower bed: a sandstone border round dark soil, clumps of yellow, blue and white flowers"""
    clear_scene()
    stone = Part(pbr_material('stone-sandstone-grey', 'sandstone_blocks_04', (0.78, 0.77, 0.74)), uv_metres=1.0)
    soil = Part(flat_material('bed-soil', (0.12, 0.08, 0.05), 1.0))
    cards = [Part(card_material(png[:-4], png)) for png in ('flowers-yellow.png', 'flowers-blue.png', 'flowers.png')]
    t, h = 0.12, 0.45
    box(stone, 0, -d / 2 + t / 2, -0.1, w, t, h + 0.1)
    box(stone, 0, d / 2 - t / 2, -0.1, w, t, h + 0.1)
    box(stone, -w / 2 + t / 2, 0, -0.1, t, d - 2 * t, h + 0.1)
    box(stone, w / 2 - t / 2, 0, -0.1, t, d - 2 * t, h + 0.1)
    box(soil, 0, 0, h - 0.12, w - 2 * t, d - 2 * t, 0.07)
    import random
    rnd = random.Random(11)
    for k in range(9):
        x = -w / 2 + 0.3 + k * (w - 0.6) / 8 + rnd.uniform(-0.06, 0.06)
        y = rnd.uniform(-0.12, 0.12)
        part = cards[k % 3]
        a = rnd.uniform(0, math.pi)
        for turn in (0.0, math.pi / 2):
            dx, dy = math.cos(a + turn) * 0.22, math.sin(a + turn) * 0.22
            z0, z1 = h - 0.06, h + 0.3 + rnd.uniform(-0.05, 0.05)
            part.quad([Vector((x - dx, y - dy, z0)), Vector((x + dx, y + dy, z0)), Vector((x + dx, y + dy, z1)), Vector((x - dx, y - dy, z1))],
                      [(0, 0), (1, 0), (1, 1), (0, 1)], lambda co: Vector((0, 0, 1)))
    # No baked AO: the walls and the cards' neighbours would black out the flowers
    export_plain(name, [stone.to_object(name), soil.to_object(name + '-soil')] + [c.to_object(name + '-flowers%d' % i) for i, c in enumerate(cards)])


def sun_lounger(name):
    """Pool lounger: a white plastic frame, a slatted bed with the back raised, two wheels at the head"""
    clear_scene()
    white = Part(flat_material('lounger-white', (0.88, 0.88, 0.86), 0.35), smooth=True)
    slat = Part(flat_material('lounger-slats', (0.84, 0.84, 0.82), 0.4))
    wheel = Part(flat_material('wheel-grey', (0.25, 0.25, 0.26), 0.6), smooth=True)
    L, W, z = 1.95, 0.68, 0.32
    for sx in (-1, 1):
        tube(white, [Vector((sx * W / 2, -L / 2, z)), Vector((sx * W / 2, L / 2 - 0.65, z))], [0.03, 0.03], 6)
    back = math.radians(40)
    hinge = Vector((0, L / 2 - 0.65, z))
    bd = Vector((0, math.cos(back), math.sin(back)))
    for sx in (-1, 1):
        tube(white, [hinge + Vector((sx * W / 2, 0, 0)), hinge + Vector((sx * W / 2, 0, 0)) + bd * 0.7], [0.03, 0.03], 6)
        tube(white, [Vector((sx * (W / 2 - 0.03), -L / 2 + 0.1, z)), Vector((sx * (W / 2 - 0.03), -L / 2 + 0.12, 0.0))], [0.025, 0.025], 6)
        tube(wheel, [Vector((sx * (W / 2 + 0.02), L / 2 - 0.62, 0.08)), Vector((sx * (W / 2 + 0.06), L / 2 - 0.62, 0.08))], [0.08, 0.08], 10,
             cap=True)
    for k in range(10):
        y = -L / 2 + 0.06 + k * 0.125
        box(slat, 0, y, z + 0.01, W - 0.02, 0.09, 0.025)
    for k in range(6):
        p = hinge + bd * (0.06 + k * 0.11)
        plank(slat, p + Vector((-W / 2 + 0.01, 0, 0.02)), p + Vector((W / 2 - 0.01, 0, 0.02)), 0.08, 0.025)
    export(name, [white.to_object(name), slat.to_object(name + '-slats'), wheel.to_object(name + '-wheel')], lod=None)


def beer_bench_set(name, L=2.2):
    """Beer table set: a planked table and two benches on folding steel legs (long side along X)"""
    clear_scene()
    wood = Part(pbr_material('beer-table-wood', 'rough_wood', (1.0, 0.86, 0.66)), uv_metres=1.0, bevel=0.008)
    steel = Part(flat_material('legs-grey', (0.35, 0.36, 0.36), 0.5, 0.7), smooth=True)
    box(wood, 0, 0, 0.74, L, 0.5, 0.03)
    for sy in (-0.55, 0.55):
        box(wood, 0, sy, 0.44, L, 0.25, 0.03)
    for sx in (-1, 1):
        x = sx * (L / 2 - 0.35)
        for sy in (-1, 1):
            tube(steel, [Vector((x, sy * 0.2, 0.0)), Vector((x - sx * 0.12, 0, 0.73))], [0.014, 0.014], 5)
            tube(steel, [Vector((x, sy * 0.55 + 0.1, 0.0)), Vector((x - sx * 0.06, sy * 0.55, 0.43))], [0.012, 0.012], 5)
            tube(steel, [Vector((x, sy * 0.55 - 0.1, 0.0)), Vector((x - sx * 0.06, sy * 0.55, 0.43))], [0.012, 0.012], 5)
        tube(steel, [Vector((x, -0.2, 0.0)), Vector((x, 0.2, 0.0))], [0.014, 0.014], 5)
    export(name, [wood.to_object(name), steel.to_object(name + '-legs')], lod=None)


def cafe_set(name):
    """Bistro set: a small round table with a marble top on a cast foot, two woven chairs facing it (along X)"""
    clear_scene()
    top = Part(flat_material('bistro-marble', (0.84, 0.83, 0.8), 0.25), smooth=True)
    iron = Part(flat_material('bistro-iron', (0.07, 0.07, 0.075), 0.45, 0.7), smooth=True)
    weave = Part(flat_material('chair-weave', (0.55, 0.38, 0.22), 0.8))
    tube(top, [Vector((0, 0, 0.71)), Vector((0, 0, 0.74))], [0.32, 0.32], 16, cap=True, smooth=False)
    tube(iron, [Vector((0, 0, 0.0)), Vector((0, 0, 0.71))], [0.03, 0.03], 8)
    tube(iron, [Vector((0, 0, 0.0)), Vector((0, 0, 0.04))], [0.22, 0.2], 12, cap=True)
    for sx in (-1, 1):
        cx = sx * 0.62
        for dx in (-0.18, 0.18):
            for dy in (-0.18, 0.18):
                tube(iron, [Vector((cx + dx, dy, 0.0)), Vector((cx + dx * 0.9, dy * 0.9, 0.45))], [0.012, 0.012], 5)
        box(weave, cx, 0, 0.45, 0.42, 0.42, 0.04)
        bx = cx + sx * 0.2
        tube(iron, bent([Vector((bx, -0.2, 0.45)), Vector((bx + sx * 0.06, -0.2, 0.88)), Vector((bx + sx * 0.06, 0.2, 0.88)),
                         Vector((bx, 0.2, 0.45))], 0.12, 3), [0.012] * 10, 5)
        prism(weave, [Vector((bx + sx * 0.035, -0.18, 0.62)), Vector((bx + sx * 0.035, 0.18, 0.62)), Vector((bx + sx * 0.055, 0.18, 0.84)),
                      Vector((bx + sx * 0.055, -0.18, 0.84))], Vector((sx * 0.02, 0, 0)))
    export(name, [top.to_object(name), iron.to_object(name + '-iron'), weave.to_object(name + '-weave')], lod=80)


def parasol(name, s=3.0, h=2.55):
    """Market parasol: a square light canvas with a valance on eight ribs, a wooden pole in a concrete foot"""
    clear_scene()
    canvas = Part(flat_material('parasol-canvas', (0.9, 0.88, 0.82), 0.85))
    valance = Part(flat_material('parasol-valance', (0.78, 0.76, 0.7), 0.85))
    wood = Part(pbr_material('parasol-wood', 'rough_wood', (0.9, 0.75, 0.55)), smooth=True)
    foot = Part(pbr_material('footing-concrete', 'brushed_concrete', (0.7, 0.7, 0.7)), uv_metres=1.0)
    tube(wood, [Vector((0, 0, 0.05)), Vector((0, 0, h + 0.15))], [0.025, 0.022], 8, cap=True)
    tube(foot, [Vector((0, 0, 0.0)), Vector((0, 0, 0.1))], [0.26, 0.24], 12, cap=True, smooth=False)
    edge_z, apex = h - 0.75, Vector((0, 0, h))
    corners = [Vector((sx * s / 2, sy * s / 2, edge_z)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for k in range(4):
        a, b = corners[k], corners[(k + 1) % 4]
        mid = (a + b) / 2 + Vector((0, 0, 0.04))
        canvas.bm.faces.new([canvas.bm.verts.new(a), canvas.bm.verts.new(mid), canvas.bm.verts.new(apex)])
        canvas.bm.faces.new([canvas.bm.verts.new(mid), canvas.bm.verts.new(b), canvas.bm.verts.new(apex)])
        down = Vector((0, 0, -0.2))
        valance.quad([a, b, b + down, a + down], [(0, 0), (1, 0), (1, 0.2), (0, 0.2)])
        for p in (a, mid):
            tube(wood, [p + Vector((0, 0, -0.03)), Vector((0, 0, h - 0.05))], [0.012, 0.012], 4)
    blender_kit.two_sided(canvas.material)
    blender_kit.two_sided(valance.material)
    tube(wood, [Vector((0, 0, h)), Vector((0, 0, h + 0.12)), Vector((0, 0, h + 0.2))], [0.05, 0.05, 0.0], 8)
    export(name, [canvas.to_object(name), valance.to_object(name + '-valance'), wood.to_object(name + '-wood'), foot.to_object(name + '-foot')],
           lod=None)


# ---------------------------------------------------------------- facades (origin on the wall at its foot, front -Y)

def shopfront(name, w, door_at):
    """Shopfront 5 cm proud of the facade: a dark stone stall riser, anthracite frames with tall panes that
    light at night, a glazed door with a steel push bar, a fascia over it all. `door_at`: the door's middle
    along the width"""
    clear_scene()
    stone = Part(pbr_material('riser-stone', 'brushed_concrete', (0.3, 0.3, 0.31)), uv_metres=1.0, bevel=0.01)
    frame = Part(flat_material('shop-frame', (0.09, 0.095, 0.1), 0.4, 0.6))
    pane = Part(flat_material('window-glass-shop', (0.06, 0.08, 0.09), 0.06, 0.7))
    steel = Part(flat_material('push-bar', (0.7, 0.72, 0.73), 0.25, 0.9), smooth=True)
    fascia = Part(flat_material('fascia-dark', (0.12, 0.13, 0.14), 0.5, 0.3))
    h, riser, door_w, door_h, f = 3.0, 0.45, 1.1, 2.3, 0.06
    y0 = -0.05
    box(fascia, 0, y0 - 0.04, h - 0.42, w + 0.1, 0.12, 0.42)
    # Glass first, set back a little; frames over it
    left, right = door_at - door_w / 2, door_at + door_w / 2
    spans = [(-w / 2, left), (right, w / 2)]
    for u0, u1 in spans:
        if u1 - u0 < 0.3:
            continue
        box(stone, (u0 + u1) / 2, y0 - 0.03, 0.0, u1 - u0, 0.1, riser)
        box(pane, (u0 + u1) / 2, y0 + 0.01, riser, u1 - u0, 0.02, h - 0.42 - riser)
        bays = max(1, round((u1 - u0) / 1.6))
        for k in range(bays + 1):
            u = u0 + (u1 - u0) * k / bays
            box(frame, u, y0 - 0.02, riser, f, 0.08, h - 0.42 - riser)
        box(frame, (u0 + u1) / 2, y0 - 0.02, riser, u1 - u0 + f, 0.08, f)
        box(frame, (u0 + u1) / 2, y0 - 0.02, h - 0.42 - f, u1 - u0 + f, 0.08, f)
        box(frame, (u0 + u1) / 2, y0 - 0.02, h - 0.42 - 0.5, u1 - u0, 0.06, 0.04)
    box(pane, door_at, y0 + 0.03, 0.0, door_w, 0.02, door_h)
    box(pane, door_at, y0 + 0.01, door_h + f, door_w, 0.02, h - 0.42 - door_h - f)
    for u in (left, right):
        box(frame, u, y0 - 0.02, 0.0, f, 0.08, h - 0.42)
    box(frame, door_at, y0 - 0.02, door_h, door_w + f, 0.08, f)
    box(frame, door_at - door_w / 2 + 0.06, y0 - 0.0, 0.0, 0.07, 0.06, door_h)
    box(frame, door_at + door_w / 2 - 0.06, y0 - 0.0, 0.0, 0.07, 0.06, door_h)
    box(frame, door_at, y0 - 0.0, 0.0, door_w, 0.06, 0.12)
    tube(steel, [Vector((left + 0.15, y0 - 0.1, 1.05)), Vector((right - 0.15, y0 - 0.1, 1.05))], [0.016, 0.016], 6, cap=True)
    for u in (left + 0.2, right - 0.2):
        tube(steel, [Vector((u, y0 - 0.1, 1.05)), Vector((u, y0 - 0.03, 1.05))], [0.01, 0.01], 4)
    box(stone, door_at, y0 - 0.12, -0.02, door_w + 0.2, 0.3, 0.04)
    export(name, [stone.to_object(name), frame.to_object(name + '-frame'), pane.to_object(name + '-glass'), steel.to_object(name + '-steel'),
                  fascia.to_object(name + '-fascia')], lod=None)


def awning(name, w=3.2, reach=1.5, drop=0.55, valance=0.24, stripes=12):
    """Folding-arm awning: the cassette on the wall, canvas in light and mid stripes falling to a scalloped
    valance on the front bar. Origin on the wall level with the valance's lowest point; an object tint
    colours canvas and valance (tone on tone stripes)"""
    clear_scene()
    light = Part(flat_material('awning-light', (0.88, 0.87, 0.84), 0.85))
    mid = Part(flat_material('awning-mid', (0.42, 0.41, 0.39), 0.85))
    metal = Part(flat_material('awning-metal', (0.3, 0.31, 0.32), 0.45, 0.7), smooth=True)
    top = valance + drop + 0.15
    box(metal, 0, -0.1, top - 0.05, w + 0.1, 0.2, 0.2)
    back = Vector((0, -0.18, top - 0.04))
    front = Vector((0, -reach, valance + 0.02))
    sw = w / stripes
    for k in range(stripes):
        part = light if k % 2 == 0 else mid
        x0, x1 = -w / 2 + k * sw, -w / 2 + (k + 1) * sw
        part.quad([Vector((x0, front.y, front.z)), Vector((x1, front.y, front.z)), Vector((x1, back.y, back.z)), Vector((x0, back.y, back.z))],
                  [(0, 0), (1, 0), (1, 1), (0, 1)])
        # Valance with a scalloped hem: a half wave per stripe
        n = 4
        tops = [part.bm.verts.new((x0 + (x1 - x0) * i / n, front.y - 0.005, front.z)) for i in range(n + 1)]
        bots = [part.bm.verts.new((x0 + (x1 - x0) * i / n, front.y - 0.005, front.z - valance + 0.06 * math.sin(math.pi * i / n)))
                for i in range(n + 1)]
        for i in range(n):
            f = part.bm.faces.new((bots[i], bots[i + 1], tops[i + 1], tops[i]))
            for loop in f.loops:
                loop[part.uv].uv = (loop.vert.co.x, loop.vert.co.z)
    blender_kit.two_sided(light.material)
    blender_kit.two_sided(mid.material)
    tube(metal, [Vector((-w / 2, front.y + 0.02, front.z - 0.02)), Vector((w / 2, front.y + 0.02, front.z - 0.02))], [0.03, 0.03], 8, cap=True)
    for sx in (-1, 1):
        x = sx * (w / 2 - 0.25)
        elbow = Vector((x - sx * 0.35, -reach * 0.55, top - 0.25))
        tube(metal, [Vector((x, -0.05, top - 0.12)), elbow, Vector((x, front.y + 0.03, front.z))], [0.02, 0.02, 0.02], 6)
        box(metal, x, -0.03, top - 0.2, 0.1, 0.06, 0.16)
    export(name, [light.to_object(name), mid.to_object(name + '-mid'), metal.to_object(name + '-metal')], lod=None)


def sign_facade(name, w=2.6, h=0.6):
    """Facade sign: a light board in a dark iron frame (the panel carries the shop's kind, drawn by the game),
    two gooseneck lamps over it. Origin on the wall at the board's foot; an object tint colours the board"""
    clear_scene()
    board = Part(flat_material('sign-board', (0.86, 0.84, 0.78), 0.6))
    iron = Part(flat_material('sign-iron', (0.06, 0.06, 0.065), 0.45, 0.6), smooth=True)
    lamp = Part(flat_material('sign-lamp', (0.9, 0.85, 0.7), 0.4, emission=(1.0, 0.85, 0.6), strength=1.5))
    d = 0.05
    box(board, 0, -d / 2, 0, w, d, h)
    r = 0.035
    for z in (0.0, h - r):
        box(iron, 0, -d - 0.005, z, w + 2 * r, 0.03, r)
    for sx in (-1, 1):
        box(iron, sx * (w / 2 + r / 2), -d - 0.005, 0, r, 0.03, h)
    for sx in (-1, 1):
        x = sx * w * 0.3
        tube(iron, bent([Vector((x, 0.0, h + 0.08)), Vector((x, -0.25, h + 0.25)), Vector((x, -0.45, h + 0.2))], 0.08, 3), [0.012] * 7, 5)
        box(iron, x, -0.01, h + 0.03, 0.08, 0.02, 0.1)
        tube(iron, [Vector((x, -0.38, h + 0.22)), Vector((x, -0.5, h + 0.14)), Vector((x, -0.52, h + 0.12))], [0.03, 0.06, 0.065], 8)
        tube(lamp, [Vector((x, -0.515, h + 0.12)), Vector((x, -0.53, h + 0.11))], [0.055, 0.055], 8, cap=True)
    export(name, [board.to_object(name), iron.to_object(name + '-iron'), lamp.to_object(name + '-lamp')], lod=None)


def sign_bracket(name, reach=1.05):
    """Bracket sign of an old town: a wall plate, a wrought-iron arm with two scrolls under it, a shield-shaped
    plate hanging from two rings (its faces carry the shop's sign, drawn by the game; both sides). Origin on the
    wall at the plate's foot; an object tint colours the shield"""
    clear_scene()
    iron = Part(flat_material('bracket-iron', (0.05, 0.05, 0.055), 0.5, 0.6), smooth=True)
    gilt = Part(flat_material('bracket-gilt', (0.78, 0.58, 0.22), 0.35, 0.85), smooth=True)
    shield = Part(flat_material('bracket-shield', (0.86, 0.84, 0.78), 0.55))
    arm_z = 1.0
    box(iron, 0, -0.02, 0.0, 0.14, 0.04, arm_z + 0.15)
    tube(iron, [Vector((0, -0.03, arm_z)), Vector((0, -reach, arm_z))], [0.018, 0.018], 6, cap=True)
    tube(gilt, [Vector((0, -reach - 0.02, arm_z)), Vector((0, -reach - 0.06, arm_z))], [0.035, 0.0], 8)
    # A brace from low on the plate to the arm, a scroll curling at each end
    tube(iron, [Vector((0, -0.03, 0.25)), Vector((0, -0.4, 0.68)), Vector((0, -0.75, arm_z - 0.01))], [0.012, 0.012, 0.012], 5)
    for cy, cz, r0, turn in ((-0.32, arm_z - 0.16, 0.14, 1), (-0.72, arm_z - 0.12, 0.1, -1)):
        pts = []
        for k in range(15):
            a = k / 14 * 1.6 * math.tau * turn
            rr = r0 * (1 - 0.8 * k / 14)
            pts.append(Vector((0, cy + math.sin(a) * rr, cz + math.cos(a) * rr)))
        tube(gilt if turn > 0 else iron, pts, [0.01] * len(pts), 5)
    # The hanging shield: a plate in the x = 0 plane, rounded at the foot
    sw, sh = 0.62, 0.62
    top_z = arm_z - 0.12
    cy = -reach + 0.38
    outline = [(cy - sw / 2, top_z), (cy + sw / 2, top_z), (cy + sw / 2, top_z - sh * 0.55)]
    for k in range(1, 8):
        a = k / 8 * math.pi
        outline.append((cy + math.cos(a) * sw / 2, top_z - sh * 0.55 - math.sin(a) * sh * 0.45))
    outline.append((cy - sw / 2, top_z - sh * 0.55))
    prism(shield, [Vector((-0.015, y, z)) for y, z in outline], Vector((0.03, 0, 0)))
    rim = [Vector((0, y, z)) for y, z in outline] + [Vector((0, outline[0][0], outline[0][1]))]
    tube(gilt, rim, [0.022] * len(rim), 5)
    for y in (cy - sw * 0.32, cy + sw * 0.32):
        ring(iron, Vector((0, y, arm_z - 0.06)), 0.05, 0.008, n=8, axis='y', sides=4)
    export(name, [iron.to_object(name), gilt.to_object(name + '-gilt'), shield.to_object(name + '-shield')], lod=120)


# ---------------------------------------------------------------- the river (bow at -Y, waterline at z = 0, catalogue `float`)

BARGE_L = 67.0
BARGE_B = 8.2
BARGE_DECK = 1.35
BARGE_KEEL = -1.1


def barge_half(t):
    """Half beam of the barge at `t` (0 bow, 1 stern): a long parallel body, a spoon bow over its first
    12 %, a rounded stern over its last 7 %"""
    if t < 0.12:
        return BARGE_B / 2 * max(0.1, math.sin(math.pi / 2 * t / 0.12) ** 0.6)
    if t > 0.93:
        return BARGE_B / 2 * max(0.35, math.cos(math.pi / 2 * (t - 0.93) / 0.07) ** 0.5)
    return BARGE_B / 2


def barge_deck(t):
    """Deck edge height: flat, rising forward to the bow's sheer"""
    return BARGE_DECK + 0.9 * max(0.0, 1 - t / 0.1) ** 2


def river_barge(name):
    """Inland motor barge of the Main and the Rhine (67 m): a black hull with a spoon bow and a red-white
    gunwale stripe, a long hold under rows of arched hatch covers with a walkway either side, the anchor
    winch and a flag mast at the bow; aft the crew's house with the wheelhouse on top, radar mast, exhaust
    and the skipper's car on deck. Weathered paint baked into its own textures (build_boats.py recipes),
    lit windows at night, a textured distance copy"""
    from build_boats import painted_metal, simple
    clear_scene()
    hull = Part(painted_metal('barge-hull', (0.025, 0.027, 0.03), 0.5), smooth=True, bevel=0.0)
    stripe_red = Part(simple('barge-stripe-red', (0.55, 0.06, 0.04), 0.5), bevel=0.0)
    stripe_white = Part(simple('barge-stripe-white', (0.74, 0.73, 0.69), 0.5), bevel=0.0)
    deck = Part(painted_metal('barge-deck', (0.22, 0.07, 0.05), 0.6), bevel=0.0)
    hatch = Part(painted_metal('barge-hatch', (0.09, 0.2, 0.15), 0.35), bevel=0.02)
    coaming = Part(painted_metal('barge-coaming', (0.03, 0.03, 0.035), 0.5), bevel=0.02)
    house = Part(painted_metal('barge-house', (0.72, 0.72, 0.69), 0.25), bevel=0.03)
    trim = Part(painted_metal('barge-trim', (0.04, 0.12, 0.28), 0.3), bevel=0.01)
    steel = Part(painted_metal('barge-steel', (0.55, 0.55, 0.53), 0.4), smooth=True, bevel=0.0)
    car = Part(simple('barge-car', (0.08, 0.16, 0.32), 0.3), bevel=0.04)
    glass = Part(flat_material('window', (0.04, 0.05, 0.06), 0.15, 0.3))
    n, girth = 40, 7
    rings = []
    for k in range(n + 1):
        t = k / n
        # More stations in the bow and stern
        t = 0.5 - 0.5 * math.cos(math.pi * t)
        hw, top = barge_half(t), barge_deck(t)
        y = -BARGE_L / 2 + t * BARGE_L
        ring = []
        for g in range(girth + 1):
            u = g / girth
            # From the keel's middle round the bilge up the side to the deck edge
            a = u * math.pi / 2
            x = hw * (1 - (1 - math.sin(a)) ** 2.2) if u < 1 else hw
            z = BARGE_KEEL + (top - BARGE_KEEL) * (1 - math.cos(a)) ** 1.4 if u < 1 else top
            ring.append(Vector((x, y, z)))
        rings.append(ring)
    bm = hull.bm
    for side in (1, -1):
        verts = [[bm.verts.new(Vector((p.x * side, p.y, p.z))) for p in ring] for ring in rings]
        for k in range(n):
            for g in range(girth):
                q = (verts[k][g], verts[k + 1][g], verts[k + 1][g + 1], verts[k][g + 1])
                f = bm.faces.new(q if side > 0 else tuple(reversed(q)))
                f.smooth = True
                for loop in f.loops:
                    loop[hull.uv].uv = (loop.vert.co.y / 3.0, loop.vert.co.z / 3.0)
    # The deck over the hull, the gunwale stripe along its edge
    for k in range(n):
        a0, a1 = rings[k][-1], rings[k + 1][-1]
        deck.quad([Vector((-a0.x, a0.y, a0.z)), Vector((a0.x, a0.y, a0.z)), Vector((a1.x, a1.y, a1.z)), Vector((-a1.x, a1.y, a1.z))],
                  [(0, a0.y / 3), (1, a0.y / 3), (1, a1.y / 3), (0, a1.y / 3)])
        for side in (1, -1):
            for part, z0, z1 in ((stripe_white, -0.38, -0.2), (stripe_red, -0.2, -0.04)):
                p0 = Vector((a0.x * side * 1.003, a0.y, a0.z + z0))
                p1 = Vector((a1.x * side * 1.003, a1.y, a1.z + z0))
                q = [p0, p1, p1 + Vector((0, 0, z1 - z0)), p0 + Vector((0, 0, z1 - z0))]
                part.quad(q if side > 0 else list(reversed(q)), [(0, 0), (1, 0), (1, 1), (0, 1)])
    # The hold: coaming and arched hatch covers, the walkways beside them
    y0, y1 = -BARGE_L / 2 + 9.0, BARGE_L / 2 - 13.0
    hw = BARGE_B / 2 - 0.85
    box(coaming, 0, (y0 + y1) / 2, BARGE_DECK, hw * 2, y1 - y0, 0.95)
    covers = int((y1 - y0) / 4.1)
    step = (y1 - y0) / covers
    for c in range(covers):
        cy = y0 + (c + 0.5) * step
        pts = []
        for k in range(7):
            a = -1 + 2 * k / 6
            pts.append(Vector((a * (hw + 0.05), 0, BARGE_DECK + 0.95 + 0.38 * (1 - a * a))))
        for k in range(6):
            p, q = pts[k], pts[k + 1]
            l0, l1 = cy - step / 2 + 0.05, cy + step / 2 - 0.05
            hatch.quad([Vector((p.x, l0, p.z)), Vector((q.x, l0, q.z)), Vector((q.x, l1, q.z)), Vector((p.x, l1, p.z))],
                       [(p.x, 0), (q.x, 0), (q.x, 1), (p.x, 1)])
        # The cover's end plate, so the arch reads as a lid from the side
        prism(hatch, [Vector((pt.x, cy - step / 2 + 0.05, pt.z)) for pt in pts], Vector((0, 0.04, 0)))
    for side in (1, -1):
        tube(steel, [Vector((side * (BARGE_B / 2 - 0.12), y0 - 6, BARGE_DECK + 0.9)), Vector((side * (BARGE_B / 2 - 0.12), y1 + 9, BARGE_DECK + 0.9))],
             [0.03, 0.03], 5)
        for k in range(14):
            y = y0 - 6 + k * (y1 - y0 + 15) / 13
            tube(steel, [Vector((side * (BARGE_B / 2 - 0.12), y, BARGE_DECK)), Vector((side * (BARGE_B / 2 - 0.12), y, BARGE_DECK + 0.9))],
                 [0.025, 0.025], 4)
    # The bow: winch, bollards, flag mast
    box(steel, 0, -BARGE_L / 2 + 5.0, barge_deck(0.07), 2.2, 1.0, 0.8)
    for side in (1, -1):
        tube(steel, [Vector((side * 2.2, -BARGE_L / 2 + 7.0, barge_deck(0.1))), Vector((side * 2.2, -BARGE_L / 2 + 7.0, barge_deck(0.1) + 0.45))],
             [0.18, 0.18], 10, cap=True)
    tube(steel, [Vector((0, -BARGE_L / 2 + 2.6, barge_deck(0.03))), Vector((0, -BARGE_L / 2 + 2.6, barge_deck(0.03) + 3.5))], [0.06, 0.04], 6, cap=True)
    # Aft: the crew's house, the wheelhouse on top of it, mast, exhaust, the car
    hy0, hy1 = BARGE_L / 2 - 9.5, BARGE_L / 2 - 3.0
    box(house, 0, (hy0 + hy1) / 2, BARGE_DECK, BARGE_B - 2.0, hy1 - hy0, 2.4)
    box(trim, 0, (hy0 + hy1) / 2, BARGE_DECK + 2.4, BARGE_B - 1.8, hy1 - hy0 + 0.2, 0.18)
    for side in (1, -1):
        for k in range(3):
            y = hy0 + 1.2 + k * 2.0
            box(glass, side * (BARGE_B / 2 - 1.0 + 0.01), y, BARGE_DECK + 1.1, 0.05, 1.1, 0.8)
    box(glass, 0, hy0 - 0.01, BARGE_DECK + 1.1, 4.0, 0.05, 0.8)
    wz = BARGE_DECK + 2.58
    box(house, 0, hy0 + 1.6, wz, 3.6, 3.0, 1.0)
    box(glass, 0, hy0 + 1.6, wz + 1.0, 3.8, 3.2, 0.95)
    box(trim, 0, hy0 + 1.6, wz + 1.95, 4.4, 3.8, 0.16)
    tube(steel, [Vector((0, hy0 + 2.6, wz + 2.1)), Vector((0, hy0 + 2.6, wz + 4.6))], [0.07, 0.05], 6, cap=True)
    box(steel, 0, hy0 + 2.6, wz + 3.6, 1.8, 0.12, 0.12)
    tube(coaming, [Vector((1.6, hy1 - 0.8, BARGE_DECK + 2.4)), Vector((1.6, hy1 - 0.8, BARGE_DECK + 4.2))], [0.2, 0.18], 10, cap=True)
    cx, cy = -1.4, hy1 + 1.2
    box(car, cx, cy, BARGE_DECK + 0.25, 1.75, 4.1, 0.75)
    box(car, cx, cy + 0.2, BARGE_DECK + 1.0, 1.55, 2.2, 0.55)
    box(glass, cx, cy + 0.2, BARGE_DECK + 1.05, 1.6, 2.0, 0.42)
    for wx in (-0.8, 0.8):
        for wy in (-1.3, 1.3):
            tube(coaming, [Vector((cx + wx - 0.1, cy + wy, BARGE_DECK + 0.32)), Vector((cx + wx + 0.1, cy + wy, BARGE_DECK + 0.32))], [0.32, 0.32], 10, cap=True)
    baked = [o for o in (p.to_object(name + '-' + str(k)) for k, p in enumerate(
        (hull, stripe_red, stripe_white, deck, hatch, coaming, house, trim, steel, car))) if o.data.polygons]
    keep = [o for o in (glass.to_object(name + '-windows'),) if o.data.polygons]
    obj = blender_kit.bake_surface(name, baked, keep, size=1024, samples=24)
    blender_kit.export_lod(name, obj, ratio=0.25, textured=True)


# ---------------------------------------------------------------- more of the street and the playground

def picnic_table(name):
    """Picnic table of a park or a rest area: one timber frame, the top and both benches on crossed legs"""
    clear_scene()
    wood = Part(pbr_material('picnic-wood', 'rough_wood', (0.8, 0.62, 0.42)), uv_metres=1.0, bevel=0.01)
    L = 1.9
    for k in range(4):
        box(wood, 0, -0.27 + k * 0.18, 0.74, L, 0.16, 0.04)
    for sy in (-1, 1):
        for k in range(2):
            box(wood, 0, sy * (0.6 + k * 0.13), 0.44, L, 0.12, 0.04)
    for sx in (-0.7, 0.7):
        for sy in (-1, 1):
            plank(wood, Vector((sx, sy * 0.72, 0.0)), Vector((sx, sy * 0.05, 0.74)), 0.06, 0.1)
        box(wood, sx, 0, 0.36, 0.08, 1.6, 0.08)
        box(wood, sx, 0, 0.66, 0.08, 0.72, 0.08)
    export(name, [wood.to_object(name)], lod=None)


def recycling_containers(name):
    """Bottle banks: three steel containers for white, brown and green glass in a row, each with a coloured
    band and two round mouths in its sloping lid, on a concrete strip"""
    clear_scene()
    steel = Part(flat_material('bank-green', (0.07, 0.2, 0.12), 0.55, 0.35), bevel=0.04, uv_metres=1.0)
    holes = Part(flat_material('bank-hole', (0.015, 0.015, 0.015), 0.9))
    bands = [Part(flat_material('band-' + n, c, 0.5)) for n, c in (('white', (0.85, 0.85, 0.82)), ('brown', (0.33, 0.17, 0.07)),
                                                                     ('green', (0.2, 0.5, 0.18)))]
    strip = Part(pbr_material('kerb-concrete', 'brushed_concrete', (0.72, 0.72, 0.7)), uv_metres=1.5)
    box(strip, 0, 0, -0.2, 5.4, 1.8, 0.28)
    for k, band in enumerate(bands):
        x = (k - 1) * 1.75
        box(steel, x, 0, 0.08, 1.55, 1.45, 1.35)
        # A hipped lid rising to a ridge across the container
        for sy in (-1, 1):
            plank(steel, Vector((x, sy * 0.73, 1.43)), Vector((x, sy * 0.05, 1.72)), 1.55, 0.05)
        box(steel, x, 0, 1.68, 1.5, 0.14, 0.08)
        box(band, x, -0.73, 0.95, 1.4, 0.02, 0.22)
        for hx in (-0.35, 0.35):
            tube(holes, [Vector((x + hx, -0.42, 1.62)), Vector((x + hx, -0.4, 1.64))], [0.11, 0.11], 12, cap=True)
            tube(steel, [Vector((x + hx, -0.43, 1.6)), Vector((x + hx, -0.41, 1.63))], [0.15, 0.15], 12)
        box(steel, x, 0, 1.78, 0.2, 0.2, 0.18)
    objects = [steel.to_object(name), holes.to_object(name + '-holes'), strip.to_object(name + '-strip')]
    objects += [b.to_object(name + '-band%d' % k) for k, b in enumerate(bands)]
    export(name, objects, lod=None)


def post_box(name):
    """Letter box on its post: a yellow box with a rounded top and the slot under a lip, a grey post"""
    clear_scene()
    yellow = Part(flat_material('postbox-yellow', (0.88, 0.62, 0.03), 0.45), smooth=True, bevel=0.02, uv_metres=1.0)
    dark = Part(flat_material('postbox-dark', (0.04, 0.04, 0.045), 0.6))
    post = Part(flat_material('postbox-post', (0.4, 0.41, 0.42), 0.5, 0.6), smooth=True)
    tube(post, [Vector((0, 0.05, -0.3)), Vector((0, 0.05, 0.85))], [0.04, 0.04], 8)
    box(yellow, 0, 0, 0.85, 0.44, 0.3, 0.5)
    tube(yellow, [Vector((-0.22, 0, 1.35)), Vector((0.22, 0, 1.35))], [0.15, 0.15], 12, cap=True)
    box(dark, 0, -0.152, 1.22, 0.24, 0.01, 0.03)
    box(yellow, 0, -0.17, 1.26, 0.3, 0.05, 0.02)
    box(dark, 0, -0.152, 0.92, 0.12, 0.01, 0.08)
    export(name, [yellow.to_object(name), dark.to_object(name + '-dark'), post.to_object(name + '-post')], lod=None)


def charging_station(name):
    """Charging point for cars: a white pillar on a concrete plinth, a dark face with a lit strip, two coiled
    cables in their holders, a bollard in front"""
    clear_scene()
    white = Part(flat_material('charger-white', (0.86, 0.87, 0.86), 0.35), bevel=0.03, uv_metres=1.0)
    face = Part(flat_material('charger-face', (0.05, 0.06, 0.07), 0.3, 0.3))
    led = Part(flat_material('charger-led', (0.1, 0.5, 0.25), 0.3, emission=(0.2, 1.0, 0.45), strength=1.2))
    cable = Part(flat_material('charger-cable', (0.03, 0.03, 0.03), 0.7), smooth=True)
    concrete = Part(pbr_material('footing-concrete', 'brushed_concrete', (0.7, 0.7, 0.7)), uv_metres=1.0)
    box(concrete, 0, 0, -0.2, 0.8, 0.6, 0.3)
    box(white, 0, 0, 0.1, 0.5, 0.32, 1.55)
    box(face, 0, -0.165, 0.7, 0.36, 0.01, 0.75)
    box(led, 0, -0.17, 1.5, 0.3, 0.01, 0.05)
    for sx in (-1, 1):
        box(face, sx * 0.26, 0, 0.95, 0.04, 0.12, 0.16)
        pts = []
        for k in range(17):
            a = k / 16 * math.tau * 1.25
            pts.append(Vector((sx * (0.32 + 0.12 * (1 + math.cos(a)) / 2), 0.08 * math.sin(a), 0.98 - k / 16 * 0.55)))
        tube(cable, pts, [0.018] * len(pts), 5)
    tube(concrete, [Vector((0, -0.9, 0.0)), Vector((0, -0.9, 0.9))], [0.08, 0.08], 10, cap=True)
    export(name, [white.to_object(name), face.to_object(name + '-face'), led.to_object(name + '-led'), cable.to_object(name + '-cable'),
                  concrete.to_object(name + '-plinth')], lod=None)


def playground_roundabout(name, r=1.0):
    """Playground roundabout: a low disc of blue and yellow sectors on a hub, four bent handrails"""
    clear_scene()
    blue = Part(flat_material('round-blue', (0.08, 0.28, 0.6), 0.55))
    yellow = Part(flat_material('round-yellow', (0.88, 0.62, 0.08), 0.55))
    steel = Part(flat_material('handle-steel', (0.6, 0.62, 0.63), 0.3, 0.9), smooth=True)
    sectors = 8
    for k in range(sectors):
        a0, a1 = k / sectors * math.tau, (k + 1) / sectors * math.tau
        pts = [Vector((0, 0, 0.32))] + [Vector((math.cos(a) * r, math.sin(a) * r, 0.32)) for a in (a0, (a0 + a1) / 2, a1)]
        prism(blue if k % 2 else yellow, pts, Vector((0, 0, -0.05)))
    tube(steel, [Vector((0, 0, 0.0)), Vector((0, 0, 0.27))], [0.12, 0.12], 10, cap=True)
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 8
        c, s_ = math.cos(a), math.sin(a)
        p0 = Vector((c * 0.2, s_ * 0.2, 0.32))
        p1 = Vector((c * 0.2, s_ * 0.2, 0.95))
        p2 = Vector((c * 0.85, s_ * 0.85, 0.95))
        p3 = Vector((c * 0.85, s_ * 0.85, 0.32))
        tube(steel, bent([p0, p1, p2, p3], 0.12), [0.022] * 10, 6)
    export(name, [blue.to_object(name), yellow.to_object(name + '-yellow'), steel.to_object(name + '-steel')], lod=110)


def fitness_station(name):
    """Outdoor fitness station: a high pull-up bar, low parallel bars and a sloping sit-up bench, galvanised
    steel with green padding"""
    clear_scene()
    steel = galvanised()
    pad = Part(flat_material('fitness-green', (0.12, 0.38, 0.2), 0.7), bevel=0.02, uv_metres=1.0)
    for x in (-1.6, -0.4):
        tube(steel, [Vector((x, 0, -0.3)), Vector((x, 0, 2.3))], [0.045, 0.045], 8, cap=True)
    tube(steel, [Vector((-1.65, 0, 2.2)), Vector((-0.35, 0, 2.2))], [0.022, 0.022], 6, cap=True)
    for x in (0.4, 1.6):
        for y in (-0.28, 0.28):
            tube(steel, [Vector((x, y, -0.3)), Vector((x, y, 1.05))], [0.035, 0.035], 6, cap=True)
    for y in (-0.28, 0.28):
        tube(steel, [Vector((0.35, y, 1.05)), Vector((1.65, y, 1.05))], [0.025, 0.025], 6, cap=True)
    bench0, bench1 = Vector((-1.4, 1.4, 0.25)), Vector((0.4, 1.4, 0.75))
    plank(pad, bench0, bench1, 0.4, 0.07)
    tube(steel, [Vector((-1.3, 1.4, -0.2)), Vector((-1.3, 1.4, 0.25))], [0.035, 0.035], 6)
    tube(steel, [Vector((0.3, 1.4, -0.2)), Vector((0.3, 1.4, 0.72))], [0.035, 0.035], 6)
    tube(steel, [Vector((0.35, 1.2, 0.95)), Vector((0.35, 1.6, 0.95))], [0.02, 0.02], 6, cap=True)
    export(name, [steel.to_object(name), pad.to_object(name + '-pad')], lod=None)


def street_clock(name):
    """Street clock of a square: a fluted cast-iron column in dark green, a drum with a white face on both
    sides and a finial"""
    clear_scene()
    iron = Part(flat_material('column-green', (0.06, 0.17, 0.12), 0.5, 0.5), smooth=True)
    face = Part(flat_material('clock-face', (0.9, 0.88, 0.82), 0.4, emission=(1.0, 0.95, 0.8), strength=0.25))
    hands = Part(flat_material('clock-hands', (0.03, 0.03, 0.03), 0.4, 0.5))
    tube(iron, [Vector((0, 0, -0.2)), Vector((0, 0, 0.3)), Vector((0, 0, 0.4)), Vector((0, 0, 3.1))], [0.22, 0.2, 0.1, 0.08], 12)
    tube(iron, [Vector((0, 0, 3.1)), Vector((0, 0, 3.2))], [0.1, 0.14], 12, cap=True)
    c = Vector((0, 0, 3.6))
    tube(iron, [c + Vector((0, -0.12, 0)), c + Vector((0, 0.12, 0))], [0.42, 0.42], 20, cap=True, smooth=False)
    tube(iron, [c + Vector((0, 0.12, 0)), c + Vector((0, -0.12, 0))], [0.42, 0.42], 20, cap=True, smooth=False)
    for sy in (-1, 1):
        tube(face, [c + Vector((0, sy * 0.12, 0)), c + Vector((0, sy * 0.125, 0))], [0.36, 0.36], 20, cap=True)
        # Hands at ten past ten
        for ang, length, w in ((math.radians(-60), 0.24, 0.025), (math.radians(60), 0.31, 0.018)):
            tip = c + Vector((math.sin(ang) * length, sy * 0.135, math.cos(ang) * length))
            oriented_box(hands, c + Vector((0, sy * 0.135, 0)), tip, w)
    tube(iron, [c + Vector((0, 0, 0.42)), c + Vector((0, 0, 0.62)), c + Vector((0, 0, 0.75))], [0.08, 0.05, 0.0], 8)
    export(name, [iron.to_object(name), face.to_object(name + '-face'), hands.to_object(name + '-hands')], lod=None)


def drinking_fountain(name):
    """Drinking fountain: a short cast-iron column with a push button, a spout over a small round basin"""
    clear_scene()
    iron = Part(flat_material('fountain-iron', (0.05, 0.14, 0.1), 0.5, 0.5), smooth=True)
    brass = Part(flat_material('fountain-brass', (0.7, 0.52, 0.22), 0.3, 0.9), smooth=True)
    tube(iron, [Vector((0, 0, -0.1)), Vector((0, 0, 0.15)), Vector((0, 0, 0.25)), Vector((0, 0, 1.05))], [0.2, 0.18, 0.11, 0.1], 12)
    tube(iron, [Vector((0, 0, 1.05)), Vector((0, 0, 1.15)), Vector((0, 0, 1.22))], [0.13, 0.12, 0.0], 12)
    tube(iron, [Vector((0, -0.12, 0.62)), Vector((0, -0.35, 0.62))], [0.03, 0.03], 8)
    tube(iron, [Vector((0, -0.42, 0.5)), Vector((0, -0.42, 0.62)), Vector((0, -0.42, 0.66))], [0.08, 0.14, 0.15], 12, cap=True)
    tube(brass, [Vector((0, -0.08, 0.95)), Vector((0, -0.28, 0.95)), Vector((0, -0.36, 0.86))], [0.02, 0.018, 0.015], 6, cap=True)
    tube(brass, [Vector((0, -0.1, 0.8)), Vector((0, -0.13, 0.8))], [0.03, 0.03], 8, cap=True)
    export(name, [iron.to_object(name), brass.to_object(name + '-brass')], lod=None)


def models():
    return {
        'basketball-hoop': lambda: basketball_hoop('basketball-hoop'),
        'tennis-net': lambda: tennis_net('tennis-net'),
        'volleyball-net': lambda: volleyball_net('volleyball-net'),
        'table-tennis': lambda: table_tennis('table-tennis'),
        'goal-small': lambda: goal_small('goal-small'),
        'handball-goal': lambda: handball_goal('handball-goal'),
        'skate-ramp': lambda: skate_ramp('skate-ramp'),
        'climbing-frame': lambda: climbing_frame('climbing-frame'),
        'seesaw': lambda: seesaw('seesaw'),
        'spring-rider': lambda: spring_rider('spring-rider'),
        'sandbox': lambda: sandbox('sandbox'),
        'bike-rack': lambda: bike_rack('bike-rack'),
        'advertising-column': lambda: advertising_column('advertising-column'),
        'fuel-pump': lambda: fuel_pump('fuel-pump'),
        'wayside-cross': lambda: wayside_cross('wayside-cross'),
        'flower-bed': lambda: flower_bed('flower-bed'),
        'sun-lounger': lambda: sun_lounger('sun-lounger'),
        'beer-bench-set': lambda: beer_bench_set('beer-bench-set'),
        'cafe-set': lambda: cafe_set('cafe-set'),
        'parasol': lambda: parasol('parasol'),
        'shopfront-narrow': lambda: shopfront('shopfront-narrow', 3.0, 0.75),
        'shopfront-wide': lambda: shopfront('shopfront-wide', 6.0, 0.0),
        'awning': lambda: awning('awning'),
        'sign-facade': lambda: sign_facade('sign-facade'),
        'sign-bracket': lambda: sign_bracket('sign-bracket'),
        'river-barge': lambda: river_barge('river-barge'),
        'picnic-table': lambda: picnic_table('picnic-table'),
        'recycling-containers': lambda: recycling_containers('recycling-containers'),
        'post-box': lambda: post_box('post-box'),
        'charging-station': lambda: charging_station('charging-station'),
        'playground-roundabout': lambda: playground_roundabout('playground-roundabout'),
        'fitness-station': lambda: fitness_station('fitness-station'),
        'street-clock': lambda: street_clock('street-clock'),
        'drinking-fountain': lambda: drinking_fountain('drinking-fountain'),
    }
