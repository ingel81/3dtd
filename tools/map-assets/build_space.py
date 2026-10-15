"""Moon and Mars models of the map asset catalogue (loaded by build_models.py).

Station modules, domes, a greenhouse, antenna dish and mast, a lander, a
rover, solar arrays, fuel tanks, a landing pad, crater rims; rocks from the
Poly Haven moon scans, grey for the Moon, rust for Mars. Panels are flat
materials with drawn solar cells and gold foil (make_foliage.py).
"""
import math
import random

from mathutils import Vector

from blender_kit import (
    Part, box, clear_scene, export, flat_material, image_material, import_model, oriented_box, pbr_material, tube,
)
import blender_kit
from build_nature import lump



def hull(name='hull-panels'):
    return image_material(name, blender_kit.FOLIAGE + '/hull-panels.jpg', 0.5)


def trim():
    return flat_material('hull-trim', (0.2, 0.21, 0.22), 0.5, 0.6)


def window():
    return flat_material('station-window', (0.55, 0.7, 0.85), 0.15, emission=(0.45, 0.6, 0.75), strength=0.35)


def see_through(material, alpha):
    """Glass one sees through (glTF alpha blend): the base colour's alpha"""
    bsdf = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Alpha'].default_value = alpha
    for attr, value in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
        try:
            setattr(material, attr, value)
        except (AttributeError, TypeError):
            pass
    return material


def hatch(frame, dark, centre, normal, radius=0.7):
    """Round hatch: a framed ring with a dark door and a wheel"""
    n = normal.normalized()
    tube(frame, [centre - n * 0.05, centre + n * 0.12], [radius + 0.12, radius + 0.12], 16, cap=True)
    tube(dark, [centre + n * 0.12, centre + n * 0.16], [radius, radius], 16, cap=True)
    tube(frame, [centre + n * 0.16, centre + n * 0.2], [radius * 0.35, radius * 0.35], 10, cap=True)


def cable(part, a, b, sag=0.3, radius=0.04):
    pts = [a.lerp(b, t) - Vector((0, 0, sag * 4 * t * (1 - t))) for t in [k / 8 for k in range(9)]]
    tube(part, pts, [radius] * 9, 5)


def solar_wing(cells, frame, root, direction, length=5.0, width=1.8):
    """A boom from `root` along `direction` carrying two solar panels"""
    d = direction.normalized()
    side = Vector((0, 0, 1)).cross(d).normalized()
    oriented_box(frame, root, root + d * length, 0.1)
    for k in range(2):
        a = root + d * (0.6 + k * (length - 0.6) / 2)
        b = a + d * ((length - 0.6) / 2 - 0.1)
        corners = [a - side * width / 2, b - side * width / 2, b + side * width / 2, a + side * width / 2]
        corners = [c + Vector((0, 0, 0.02)) for c in corners]
        cells.quad(corners, [(0, 0), (1, 0), (1, 1), (0, 1)])
        cells.quad(list(reversed(corners)), [(0, 1), (1, 1), (1, 0), (0, 0)])
        for c0, c1 in zip(corners, corners[1:] + corners[:1]):
            oriented_box(frame, c0, c1, 0.05)


def base_module(name, length=8.0, radius=2.2):
    """Habitat cylinder on legs: panelled hull, ribs, end domes with a hatch, a window strip, cable runs,
    radiator fins on top and a solar wing on one side"""
    clear_scene()
    shell = Part(hull(), smooth=True, uv_scale=0.3)
    ribs = Part(trim(), smooth=True, bevel=0.02)
    dark = Part(flat_material('hatch-dark', (0.06, 0.06, 0.07), 0.6))
    win = Part(window())
    cells = Part(image_material('solar-cells', blender_kit.FOLIAGE + '/solar.jpg', 0.25))
    z = radius + 0.9
    tube(shell, [Vector((-length / 2, 0, z)), Vector((length / 2, 0, z))], [radius, radius], 24)
    for sx in (-1, 1):
        prof = [(0.0, 1.0), (0.35, 0.94), (0.7, 0.75), (0.95, 0.4), (1.05, 0.02)]
        tube(shell, [Vector((sx * (length / 2 + p * 0.9), 0, z)) for p, _ in prof], [radius * r for _, r in prof], 24)
    hatch(ribs, dark, Vector((-(length / 2 + 0.93), 0, z)), Vector((-1, 0, 0)), 0.65)
    for k in range(5):
        x = -length / 2 + 0.25 + k * (length - 0.5) / 4
        tube(ribs, [Vector((x - 0.1, 0, z)), Vector((x + 0.1, 0, z))], [radius + 0.07, radius + 0.07], 24)
    for k in range(6):
        x = -length / 2 + 1.0 + k * (length - 2.0) / 5
        box(ribs, x, -radius + 0.12, z + 0.05, 0.75, 0.25, 0.55)
        box(win, x, -radius - 0.02, z + 0.12, 0.6, 0.08, 0.4)
    for y in (-0.5, 0.5):
        cable(ribs, Vector((-length / 2, y - radius * 0.2, z - radius * 0.95)), Vector((length / 2, y - radius * 0.2, z - radius * 0.95)), 0.25)
    for k in range(4):
        x = -length / 2 + 1.2 + k * (length - 2.4) / 3
        box(ribs, x, 0, z + radius - 0.05, 0.08, 1.6, 0.6)
    for x in (-length / 2 + 1.0, length / 2 - 1.0):
        for y in (-radius * 0.75, radius * 0.75):
            foot = Vector((x, y * 1.25, 0.05))
            oriented_box(ribs, Vector((x, y * 0.7, z - radius * 0.7)), foot, 0.16)
            tube(ribs, [foot - Vector((0, 0, 0.05)), foot + Vector((0, 0, 0.06))], [0.35, 0.35], 10, cap=True)
    solar_wing(cells, ribs, Vector((0, radius + 0.05, z + 0.4)), Vector((0, 1, 0.12)), 5.5, 1.8)
    tube(ribs, [Vector((length / 2 - 1.2, 0, z + radius)), Vector((length / 2 - 1.2, 0, z + radius + 2.2))], [0.03, 0.02], 5)
    export(name, [shell.to_object(name), ribs.to_object(name + '-ribs'), dark.to_object(name + '-hatch'), win.to_object(name + '-windows'),
                  cells.to_object(name + '-solar')])


def base_hub(name, radius=4.0, height=4.0):
    """Upright hub: panelled drum on a ring footing, shallow dome with a hatch, airlock with a round door,
    window ring, cable reels and a mast"""
    clear_scene()
    shell = Part(hull(), smooth=True, uv_scale=0.3)
    ribs = Part(trim(), smooth=True, bevel=0.02)
    dark = Part(flat_material('hatch-dark', (0.06, 0.06, 0.07), 0.6))
    win = Part(window())
    tube(ribs, [Vector((0, 0, -0.3)), Vector((0, 0, 0.6))], [radius + 0.35, radius + 0.35], 28, cap=True)
    tube(shell, [Vector((0, 0, 0.6)), Vector((0, 0, height))], [radius, radius], 28)
    dome = [(0.0, 1.0), (0.4, 0.95), (0.9, 0.8), (1.4, 0.55), (1.8, 0.25), (1.95, 0.02)]
    tube(shell, [Vector((0, 0, height + z)) for z, _ in dome], [radius * r for _, r in dome], 28)
    for z in (0.62, height - 0.1):
        tube(ribs, [Vector((0, 0, z)), Vector((0, 0, z + 0.15))], [radius + 0.06, radius + 0.06], 28)
    for k in range(10):
        a = k / 10 * math.tau
        box(ribs, math.cos(a) * (radius - 0.05), math.sin(a) * (radius - 0.05), 2.3, 0.25, 0.9, 0.6, a)
        box(win, math.cos(a) * (radius + 0.03), math.sin(a) * (radius + 0.03), 2.4, 0.08, 0.7, 0.4, a)
    hatch(ribs, dark, Vector((0, 0, height + 1.95)), Vector((0, 0, 1)), 0.6)
    box(shell, 0, -radius - 0.7, 0.6, 2.4, 1.6, 2.8)
    box(ribs, 0, -radius - 0.7, 3.4, 2.6, 1.8, 0.15)
    hatch(ribs, dark, Vector((0, -radius - 1.5, 1.8)), Vector((0, -1, 0)), 0.8)
    for k in range(2):
        x = (k - 0.5) * 3.0
        tube(ribs, [Vector((x, radius + 0.7, 0.0)), Vector((x, radius + 0.7, 0.8))], [0.5, 0.5], 12, cap=True)
        cable(ribs, Vector((x, radius + 0.7, 0.7)), Vector((x * 0.6, radius - 0.05, 1.6)), 0.2, 0.05)
    tube(ribs, [Vector((radius * 0.4, radius * 0.4, height + 1.0)), Vector((radius * 0.4, radius * 0.4, height + 4.5))], [0.05, 0.03], 6)
    export(name, [shell.to_object(name), ribs.to_object(name + '-trim'), dark.to_object(name + '-hatches'), win.to_object(name + '-windows')])


def wheel(tyre, hub, centre, axis, radius=0.42, width=0.32, cleats=16):
    """Rover wheel: drum with raised cleats and a hub"""
    a = axis.normalized()
    tube(tyre, [centre - a * width / 2, centre + a * width / 2], [radius, radius], 18, cap=True)
    tube(tyre, [centre + a * width / 2, centre - a * width / 2], [radius, radius], 18, cap=True)
    side = a.orthogonal().normalized()
    up = a.cross(side).normalized()
    for k in range(cleats):
        t = k / cleats * math.tau
        r = side * math.cos(t) + up * math.sin(t)
        oriented_box(tyre, centre + r * radius - a * width / 2, centre + r * radius + a * width / 2, 0.06)
    tube(hub, [centre + a * (width / 2), centre + a * (width / 2 + 0.06)], [radius * 0.45, radius * 0.3], 10, cap=True)


def dome(name, radius=6.0, glass=True, greenhouse=False):
    """Geodesic-looking dome: a ring wall with vents, a hemisphere of struts with glass or white panels, an
    airlock tunnel with a round hatch at the front (-Y), a cable reel and a small tank beside it. The
    greenhouse has dark green glass one sees through, onto beds of plants lit in patches by grow lights"""
    clear_scene()
    struts = Part(trim(), smooth=True)
    if greenhouse:
        pane = see_through(flat_material('greenhouse-glass', (0.04, 0.12, 0.06), 0.08, 0.3), 0.45)
    elif glass:
        pane = flat_material('dome-glass', (0.35, 0.45, 0.5), 0.08, 0.4)
    else:
        pane = None
    panel = Part(pane if pane else hull(), smooth=True, uv_scale=0.3)
    shell = Part(hull(), smooth=True, uv_scale=0.3)
    dark = Part(flat_material('hatch-dark', (0.06, 0.06, 0.07), 0.6))
    tube(struts, [Vector((0, 0, -0.3)), Vector((0, 0, 0.8))], [radius + 0.2, radius + 0.2], 24, cap=False)
    # Ring wall top: closes the slot between the wall and the hemisphere
    tube(struts, [Vector((0, 0, 0.8)), Vector((0, 0, 0.801))], [radius + 0.2, radius - 0.05], 24)
    for k in range(12):
        a = (k + 0.5) / 12 * math.tau
        box(dark, math.cos(a) * (radius + 0.22), math.sin(a) * (radius + 0.22), 0.25, 0.06, 0.9, 0.3, a)
    prof = [(math.sin(t) * radius, math.cos(t)) for t in [k / 10 * math.pi / 2 for k in range(11)]]
    tube(panel, [Vector((0, 0, 0.8 + z)) for z, _ in prof], [radius * r + 0.001 for _, r in prof], 24)
    for k in range(12):
        a = k / 12 * math.tau
        pts = [Vector((math.cos(a) * radius * r * 1.01, math.sin(a) * radius * r * 1.01, 0.8 + z)) for z, r in prof]
        for p, q in zip(pts, pts[1:]):
            oriented_box(struts, p, q, 0.12)
    for z, r in prof[2:9:2]:
        n = 24
        pts = [Vector((math.cos(k / n * math.tau) * radius * r * 1.01, math.sin(k / n * math.tau) * radius * r * 1.01, 0.8 + z)) for k in range(n + 1)]
        for p, q in zip(pts, pts[1:]):
            oriented_box(struts, p, q, 0.1)
    tube(struts, [Vector((0, 0, 0.8 + radius - 0.05)), Vector((0, 0, 0.8 + radius + 0.15))], [0.9, 0.7], 12, cap=True)
    # Airlock: a short tunnel out of the ring wall, ribs, an end plate with a round hatch
    tube(shell, [Vector((0, -radius + 0.5, 1.4)), Vector((0, -radius - 2.0, 1.4))], [1.3, 1.3], 16, cap=True)
    for y in (-radius - 0.2, -radius - 1.9):
        tube(struts, [Vector((0, y + 0.12, 1.4)), Vector((0, y - 0.12, 1.4))], [1.4, 1.4], 16, cap=y < -radius - 1)
    box(struts, 0, -radius - 1.0, -0.3, 2.4, 2.8, 0.45)
    hatch(struts, dark, Vector((0, -radius - 2.1, 1.4)), Vector((0, -1, 0)), 0.8)
    # A cable reel and a tank against the ring wall
    a = 0.9
    c = Vector((math.cos(a) * (radius + 1.1), math.sin(a) * (radius + 1.1), 0))
    tube(struts, [c + Vector((-0.4, 0, 0.6)), c + Vector((0.4, 0, 0.6))], [0.6, 0.6], 12, cap=True)
    tube(struts, [c + Vector((0.4, 0, 0.6)), c + Vector((-0.4, 0, 0.6))], [0.6, 0.6], 12, cap=True)
    c = Vector((math.cos(a + 1.2) * (radius + 1.0), math.sin(a + 1.2) * (radius + 1.0), 0))
    tube(shell, [c, c + Vector((0, 0, 0.2)), c + Vector((0, 0, 1.8)), c + Vector((0, 0, 2.1))], [0.4, 0.6, 0.6, 0.25], 12)
    objects = [struts.to_object(name + '-struts'), panel.to_object(name), shell.to_object(name + '-airlock'), dark.to_object(name + '-dark')]
    if greenhouse:
        # Seen through the dark glass: beds of plants, some lit by the grow lights over them and some in the dark
        # between, so the dome glows in patches, not as a lamp
        plants = Part(flat_material('greenhouse-plants', (0.06, 0.2, 0.06), 0.8, emission=(0.03, 0.12, 0.03), strength=0.5))
        lit = Part(flat_material('greenhouse-plants-lit', (0.1, 0.32, 0.08), 0.8, emission=(0.12, 0.45, 0.08), strength=0.8))
        beds = Part(flat_material('greenhouse-soil', (0.2, 0.13, 0.08), 0.9))
        lamps = Part(flat_material('grow-light', (0.9, 0.85, 0.7), 0.4, emission=(1.0, 0.8, 0.55), strength=1.2))
        rnd = random.Random(3)
        for k in range(3):
            x = -radius * 0.45 + k * radius * 0.45
            half = math.sqrt(max(0.0, (radius * 0.85) ** 2 - x * x))
            box(beds, x, 0, 0.7, 1.2, 2 * half, 0.35)
            # A grow light over part of the bed only; the plants under it are the lit ones
            y0, y1 = sorted(rnd.uniform(-half, half) for _ in range(2))
            if y1 - y0 > 1.5:
                oriented_box(lamps, Vector((x, y0, 3.2)), Vector((x, y1, 3.2)), 0.08)
            for j in range(int(2 * half / 0.9)):
                y = -half + 0.45 + j * 0.9
                size = rnd.uniform(0.5, 0.9)
                box(lit if y0 <= y <= y1 else plants, x + rnd.uniform(-0.15, 0.15), y, 1.05, size, size * 0.9, rnd.uniform(0.3, 1.0), rnd.uniform(0, 1))
        objects += [plants.to_object(name + '-plants'), lit.to_object(name + '-plants-lit'), beds.to_object(name + '-beds'), lamps.to_object(name + '-lights')]
    export(name, objects)


def tunnel(name, length=6.0):
    clear_scene()
    shell = Part(hull(), smooth=True, uv_scale=0.3)
    ribs = Part(trim(), smooth=True)
    dark = Part(flat_material('hatch-dark', (0.06, 0.06, 0.07), 0.6))
    tube(shell, [Vector((-length / 2, 0, 1.6)), Vector((length / 2, 0, 1.6))], [1.1, 1.1], 14)
    for x in (-length / 2, 0, length / 2):
        # The end ribs are closed plates facing outwards, each with a hatch
        ends = [Vector((x + 0.1, 0, 1.6)), Vector((x - 0.1, 0, 1.6))] if x < 0 else [Vector((x - 0.1, 0, 1.6)), Vector((x + 0.1, 0, 1.6))]
        tube(ribs, ends, [1.2, 1.2], 14, cap=x != 0)
        box(ribs, x, 0, 0, 0.3, 1.6, 0.6)
    for sx in (-1, 1):
        hatch(ribs, dark, Vector((sx * (length / 2 + 0.1), 0, 1.6)), Vector((sx, 0, 0)), 0.7)
    export(name, [shell.to_object(name), ribs.to_object(name + '-ribs'), dark.to_object(name + '-hatch')])


def antenna_dish(name):
    """Parabolic dish on a turret, tilted to the sky (towards -Y): a fixed pedestal with a cable box and
    a ladder; the head (yoke, dish with its rim struts and feed horn) has materials `spin-*` and stays a
    node of its own, turning about the vertical axis through the origin (docs/CUSTOM_MAPS.md, Drehteile)"""
    clear_scene()
    metal = Part(trim(), smooth=True)
    shell = Part(flat_material('spin-dish-white', (0.82, 0.83, 0.84), 0.4, 0.2), smooth=True)
    head = Part(flat_material('spin-dish-metal', (0.24, 0.25, 0.26), 0.45, 0.6), smooth=True)
    tube(metal, [Vector((0, 0, -0.3)), Vector((0, 0, 0.4))], [1.1, 1.1], 16, cap=True)
    tube(metal, [Vector((0, 0, 0.4)), Vector((0, 0, 2.6))], [0.55, 0.45], 12, cap=True)
    box(metal, 0.75, 0, 0.4, 0.5, 0.8, 0.9)
    for k in range(6):
        oriented_box(metal, Vector((-0.5, -0.3, 0.6 + k * 0.33)), Vector((-0.5, 0.3, 0.6 + k * 0.33)), 0.04)
    # Head: a turntable, a yoke and the dish
    tube(head, [Vector((0, 0, 2.6)), Vector((0, 0, 3.0))], [0.7, 0.7], 16, cap=True)
    for s in (-1, 1):
        oriented_box(head, Vector((s * 0.55, 0, 3.0)), Vector((s * 0.55, -0.2, 4.1)), 0.18)
    c = Vector((0, -0.3, 4.2))
    axis = Vector((0, -0.6, 0.8)).normalized()
    oriented_box(head, Vector((-0.6, -0.2, 4.1)), Vector((0.6, -0.2, 4.1)), 0.16)
    prof = [(0.0, 0.2), (0.15, 1.2), (0.45, 2.2), (0.85, 3.0), (1.1, 3.4)]
    tube(shell, [c + axis * z for z, _ in prof], [r for _, r in prof], 24)
    tube(shell, [c + axis * (z - 0.06) for z, _ in reversed(prof)], [r for _, r in reversed(prof)], 24)
    tube(head, [c + axis * 1.08, c + axis * 1.14], [3.45, 3.45], 24)
    side = axis.orthogonal().normalized()
    for k in range(3):
        a = k / 3 * math.tau
        rim = c + axis * 1.1 + (side * math.cos(a) + axis.cross(side) * math.sin(a)) * 3.2
        oriented_box(head, rim, c + axis * 2.6, 0.06)
    tube(head, [c + axis * 2.4, c + axis * 2.9], [0.2, 0.12], 8, cap=True)
    export(name, [metal.to_object(name + '-metal'), shell.to_object('spin-' + name), head.to_object('spin-' + name + '-head')])


def antenna_mast(name, height=14.0):
    """Lattice mast with guy-wire anchors and a red beacon"""
    clear_scene()
    metal = Part(flat_material('mast-steel', (0.55, 0.56, 0.58), 0.4, 0.8))
    beacon = Part(flat_material('beacon', (0.9, 0.1, 0.05), 0.3, emission=(1.0, 0.1, 0.05), strength=1.0))
    s = 0.7
    corners = [Vector((math.cos(k / 3 * math.tau) * s, math.sin(k / 3 * math.tau) * s, 0)) for k in range(3)]
    segs = int(height / 1.4)
    for k in range(3):
        oriented_box(metal, corners[k] + Vector((0, 0, -0.5)), corners[k] * 0.4 + Vector((0, 0, height)), 0.08)
    for j in range(segs):
        z0, z1 = j * height / segs, (j + 1) * height / segs
        f0, f1 = 1 - 0.6 * z0 / height, 1 - 0.6 * z1 / height
        for k in range(3):
            a = corners[k] * f0 + Vector((0, 0, z0))
            b = corners[(k + 1) % 3] * f1 + Vector((0, 0, z1))
            oriented_box(metal, a, b, 0.04)
            oriented_box(metal, a, corners[(k + 1) % 3] * f0 + Vector((0, 0, z0)), 0.04)
    box(beacon, 0, 0, height, 0.25, 0.25, 0.25)
    box(metal, 0, -0.4, height * 0.7, 0.6, 0.1, 0.9)
    export(name, [metal.to_object(name), beacon.to_object(name + '-beacon')])


def lander(name):
    """Two-stage lunar lander (front -Y): an octagonal descent stage in gold and black foil over its engine
    bell, four legs with struts and footpads, a porch and a ladder down the front leg; the ascent stage on
    top with the crew cabin and its slanted windows, an equipment bay behind, tank bulges at the sides,
    a docking tunnel, radar and antenna dishes and four thruster quads"""
    clear_scene()
    foil = Part(image_material('gold-foil', blender_kit.FOLIAGE + '/gold-foil.jpg', 0.35))
    black = Part(flat_material('foil-black', (0.05, 0.045, 0.04), 0.55, 0.4))
    shell = Part(hull(), smooth=False, uv_scale=0.5)
    metal = Part(trim(), smooth=True)
    win = Part(window())
    # Descent stage: eight panels, gold and black in turn, a deck on top and a floor under it
    r, z0, z1 = 2.0, 1.1, 2.7
    corners = [Vector((math.cos((k + 0.5) / 8 * math.tau) * r, math.sin((k + 0.5) / 8 * math.tau) * r, 0)) for k in range(8)]
    for k in range(8):
        a, b = corners[k], corners[(k + 1) % 8]
        part = foil if k % 2 == 0 else black
        part.quad([a + Vector((0, 0, z0)), b + Vector((0, 0, z0)), b + Vector((0, 0, z1)), a + Vector((0, 0, z1))],
                  [(0, 0), (1, 0), (1, 1), (0, 1)])
    deck = [metal.bm.verts.new(c + Vector((0, 0, z1))) for c in corners]
    metal.bm.faces.new(deck)
    floor = [metal.bm.verts.new(c + Vector((0, 0, z0))) for c in reversed(corners)]
    metal.bm.faces.new(floor)
    tube(black, [Vector((0, 0, z0 + 0.05)), Vector((0, 0, 0.5))], [0.5, 0.9], 16)
    # Legs on the four axes: main strut, two side struts, a footpad; ladder rungs on the front one
    for k in range(4):
        a = k / 4 * math.tau - math.pi / 2
        out = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-out.y, out.x, 0))
        top = out * 2.0 + Vector((0, 0, 2.5))
        foot = out * 3.7 + Vector((0, 0, 0.3))
        tube(metal, [top, foot], [0.11, 0.09], 8)
        mid = top.lerp(foot, 0.6)
        for s in (-1, 1):
            tube(metal, [out * 1.6 + side * s * 1.0 + Vector((0, 0, z0 + 0.05)), mid], [0.05, 0.05], 6)
        tube(foil, [foot + Vector((0, 0, -0.3)), foot + Vector((0, 0, -0.18)), foot + Vector((0, 0, -0.05))], [0.55, 0.55, 0.3], 12,
             cap=True)
        if k == 0:
            for j in range(8):
                p = top.lerp(foot, 0.1 + j * 0.1)
                oriented_box(metal, p - side * 0.35 - out * 0.12, p + side * 0.35 - out * 0.12, 0.05)
            box(metal, 0, -2.0, z1 - 0.1, 1.0, 0.8, 0.08)
    # Ascent stage: base plate, cabin with the front facets and windows, equipment bay, tank bulges
    box(metal, 0, 0, z1, 3.2, 3.0, 0.22)
    zc = z1 + 0.22
    tube(shell, [Vector((0, 0.7, zc + 1.15)), Vector((0, -1.4, zc + 1.15))], [1.15, 1.15], 10, cap=True)
    box(shell, 0, 1.25, zc, 2.6, 1.5, 1.8)
    for s in (-1, 1):
        prof = [(-0.7, 0.05), (-0.55, 0.38), (-0.3, 0.55), (1.0, 0.55), (1.25, 0.38), (1.4, 0.05)]
        tube(black, [Vector((s * 1.4, y, zc + 0.7)) for y, _ in prof], [w for _, w in prof], 10)
    for s in (-1, 1):
        # Slanted triangular windows on the front facets
        c = Vector((s * 0.45, -1.42, zc + 1.6))
        win.quad([c + Vector((-0.25 * s, -0.02, -0.25)), c + Vector((0.3 * s, -0.02, -0.35)), c + Vector((0.2 * s, -0.08, 0.25)),
                  c + Vector((-0.25 * s, -0.08, 0.3))][::s], [(0, 0), (1, 0), (1, 1), (0, 1)])
    box(black, 0, -1.43, zc + 0.15, 0.9, 0.06, 1.0)
    # Docking tunnel, rendezvous radar, steerable antenna
    tube(metal, [Vector((0, -0.3, zc + 2.2)), Vector((0, -0.3, zc + 2.75))], [0.55, 0.5], 12, cap=True)
    tube(black, [Vector((0, -0.3, zc + 2.75)), Vector((0, -0.3, zc + 2.82))], [0.42, 0.42], 12, cap=True)
    radar = Vector((0.0, -1.0, zc + 2.6))
    oriented_box(metal, Vector((0.0, -0.9, zc + 2.1)), radar, 0.08)
    tube(shell, [radar, radar + Vector((0, -0.2, 0.15)), radar + Vector((0, -0.32, 0.3))], [0.08, 0.35, 0.5], 12)
    mast = Vector((1.3, 0.9, zc + 2.6))
    oriented_box(metal, Vector((1.1, 0.9, zc + 1.8)), mast, 0.07)
    tube(shell, [mast, mast + Vector((0.12, -0.12, 0.15)), mast + Vector((0.2, -0.2, 0.25))], [0.05, 0.3, 0.42], 12)
    tube(metal, [Vector((-1.0, 1.6, zc + 1.8)), Vector((-1.0, 1.6, zc + 3.2))], [0.025, 0.02], 5)
    # Thruster quads at the four corners: a block with four nozzles
    for sx in (-1, 1):
        for sy in (-1, 1):
            c = Vector((sx * 1.55, sy * 1.25, zc + 1.4))
            box(metal, c.x, c.y, c.z - 0.15, 0.3, 0.3, 0.3)
            for d in (Vector((0, 0, 1)), Vector((0, 0, -1)), Vector((sx, 0, 0)), Vector((0, sy, 0))):
                tube(metal, [c + d * 0.12, c + d * 0.35], [0.05, 0.09], 6)
    export(name, [foil.to_object(name + '-foil'), black.to_object(name + '-black'), shell.to_object(name), metal.to_object(name + '-metal'),
                  win.to_object(name + '-window')])


def rover(name, colour=(0.82, 0.8, 0.76)):
    """Six-wheeled rover (front -Y): panelled body with chamfered edges, rocker-bogie arms, cleated wheels,
    a mast with a camera head, a high-gain dish and a solar deck in a frame"""
    clear_scene()
    body = Part(hull('rover-panels'), uv_metres=1.2, bevel=0.04)
    metal = Part(trim(), smooth=True)
    tyre = Part(flat_material('rover-wheel', (0.38, 0.38, 0.39), 0.6, 0.6), smooth=True)
    cells = Part(image_material('solar-cells', blender_kit.FOLIAGE + '/solar.jpg', 0.25))
    dish = Part(flat_material('dish-white', (0.82, 0.83, 0.84), 0.4, 0.2), smooth=True)
    lens = Part(flat_material('camera-lens', (0.05, 0.08, 0.12), 0.1, 0.8))
    box(body, 0, 0, 0.95, 1.6, 2.4, 0.7)
    box(body, 0, 0.9, 1.65, 1.0, 0.6, 0.35)
    corners = [Vector((-1.15, -1.25, 1.72)), Vector((1.15, -1.25, 1.72)), Vector((1.15, 1.55, 1.72)), Vector((-1.15, 1.55, 1.72))]
    cells.quad(corners, [(0, 0), (1, 0), (1, 1), (0, 1)])
    for c0, c1 in zip(corners, corners[1:] + corners[:1]):
        oriented_box(metal, c0, c1, 0.05)
    for sx in (-1, 1):
        x = sx * 1.25
        pivot = Vector((sx * 0.85, 0.2, 1.05))
        for y in (-1.15, 0.05, 1.2):
            c = Vector((x, y, 0.42))
            wheel(tyre, metal, c, Vector((sx, 0, 0)))
            oriented_box(metal, pivot, Vector((x - sx * 0.2, y, 0.75)), 0.09)
            oriented_box(metal, Vector((x - sx * 0.2, y, 0.75)), c + Vector((-sx * 0.18, 0, 0)), 0.07)
    oriented_box(metal, Vector((0.5, -0.9, 1.3)), Vector((0.5, -0.9, 2.8)), 0.09)
    box(body, 0.5, -0.92, 2.8, 0.55, 0.32, 0.3)
    for s in (-1, 1):
        tube(lens, [Vector((0.5 + s * 0.12, -1.08, 2.95)), Vector((0.5 + s * 0.12, -1.13, 2.95))], [0.06, 0.06], 8, cap=True)
    oriented_box(metal, Vector((-0.5, 0.9, 1.95)), Vector((-0.5, 0.9, 2.5)), 0.06)
    prof = [(0.0, 0.05), (0.1, 0.35), (0.22, 0.55)]
    c = Vector((-0.5, 0.9, 2.5))
    ax = Vector((0, -0.4, 1)).normalized()
    tube(dish, [c + ax * z for z, _ in prof], [r for _, r in prof], 16)
    export(name, [body.to_object(name), metal.to_object(name + '-metal'), tyre.to_object(name + '-wheels'), cells.to_object(name + '-solar'),
                  dish.to_object(name + '-dish'), lens.to_object(name + '-lens')])


def solar_array(name, panels=4):
    """Row of tilted solar panels on posts, facing -Y"""
    clear_scene()
    cells = Part(image_material('solar-cells', blender_kit.FOLIAGE + '/solar.jpg', 0.25))
    metal = Part(trim(), smooth=True)
    for k in range(panels):
        x = -panels * 1.1 + 1.1 + k * 2.2
        tube(metal, [Vector((x, 0, -0.4)), Vector((x, 0, 1.3))], [0.07, 0.07], 6)
        a = Vector((x - 1.0, -0.8, 0.9))
        b = Vector((x + 1.0, -0.8, 0.9))
        c = Vector((x + 1.0, 0.8, 1.9))
        d = Vector((x - 1.0, 0.8, 1.9))
        cells.quad([a, b, c, d], [(0, 0), (1, 0), (1, 1), (0, 1)])
        cells.quad([d, c, b, a], [(0, 1), (1, 1), (1, 0), (0, 0)])
    oriented_box(metal, Vector((-panels * 1.1 + 1.1, 0, 1.3)), Vector((panels * 1.1 - 1.1, 0, 1.3)), 0.08)
    export(name, [cells.to_object(name), metal.to_object(name + '-frame')])


def fuel_tanks(name):
    clear_scene()
    shell = Part(hull('tank-white'), smooth=True, uv_scale=0.3)
    metal = Part(trim(), smooth=True)
    for k, x in enumerate((-1.6, 0.0, 1.6)):
        tube(shell, [Vector((x, 0, 0.4)), Vector((x, 0, 0.6)), Vector((x, 0, 3.4)), Vector((x, 0, 3.8))], [0.5, 0.75, 0.75, 0.3], 14, cap=True)
        tube(metal, [Vector((x, 0, 0)), Vector((x, 0, 0.45))], [0.6, 0.6], 14, cap=True)
    oriented_box(metal, Vector((-1.6, -0.8, 2.0)), Vector((1.6, -0.8, 2.0)), 0.1)
    export(name, [shell.to_object(name), metal.to_object(name + '-base')])


def landing_pad(name, radius=10.0):
    """Concrete pad with a painted ring and corner lights"""
    clear_scene()
    concrete = Part(pbr_material('wall-brushed_concrete', 'brushed_concrete'), uv_metres=4.0)
    paint = Part(flat_material('pad-paint', (0.8, 0.65, 0.1), 0.6))
    lights = Part(flat_material('pad-light', (0.2, 0.6, 1.0), 0.3, emission=(0.2, 0.6, 1.0), strength=1.0))
    tube(concrete, [Vector((0, 0, -0.6)), Vector((0, 0, 0.25))], [radius, radius], 24, cap=True)
    tube(paint, [Vector((0, 0, 0.26)), Vector((0, 0, 0.27))], [radius * 0.75, radius * 0.75], 32, cap=True)
    tube(concrete, [Vector((0, 0, 0.27)), Vector((0, 0, 0.28))], [radius * 0.7, radius * 0.7], 32, cap=True)
    for k in range(8):
        a = k / 8 * math.tau
        box(lights, math.cos(a) * (radius - 0.4), math.sin(a) * (radius - 0.4), 0.25, 0.3, 0.3, 0.15)
    export(name, [concrete.to_object(name), paint.to_object(name + '-ring'), lights.to_object(name + '-lights')])


def crater_rim(name, seed, radius=10.0, asset='moon_01', tint=None):
    """Ring of rock lumps around a bowl: place over a dip in the terrain"""
    clear_scene()
    rnd = random.Random(seed)
    rock = Part(pbr_material('rock-' + asset + ('-t' if tint else ''), asset, tint), uv_metres=4.0)
    n = 18
    for k in range(n):
        a = k / n * math.tau + rnd.uniform(-0.1, 0.1)
        r = radius * rnd.uniform(0.95, 1.05)
        lump(rock, Vector((math.cos(a) * r, math.sin(a) * r, -0.8)),
             Vector((rnd.uniform(2.0, 3.2), rnd.uniform(1.6, 2.4), rnd.uniform(0.8, 1.5))), seed + k, subdiv=2)
    obj = rock.to_object(name)
    for p in obj.data.polygons:
        p.use_smooth = True
    export(name, [obj])


def models():
    grey = (0.62, 0.62, 0.62)
    rust = (0.95, 0.5, 0.3)
    return {
        'base-module': lambda: base_module('base-module'),
        'base-hub': lambda: base_hub('base-hub'),
        'base-tunnel': lambda: tunnel('base-tunnel'),
        'dome-white': lambda: dome('dome-white', glass=False),
        'dome-glass': lambda: dome('dome-glass'),
        'greenhouse-dome': lambda: dome('greenhouse-dome', radius=7.0, greenhouse=True),
        'antenna-dish': lambda: antenna_dish('antenna-dish'),
        'antenna-mast': lambda: antenna_mast('antenna-mast'),
        'lander': lambda: lander('lander'),
        'rover': lambda: rover('rover'),
        'solar-array': lambda: solar_array('solar-array'),
        'fuel-tanks': lambda: fuel_tanks('fuel-tanks'),
        'landing-pad': lambda: landing_pad('landing-pad'),
        'crater-rim': lambda: crater_rim('crater-rim', 70, tint=(0.75, 0.75, 0.75)),
        'mars-crater-rim': lambda: crater_rim('mars-crater-rim', 71, tint=(1.0, 0.55, 0.35)),
        'moon-boulder': lambda: import_model('moon_rock_05', 2.6, 2000, 'moon-boulder', desaturate=1.0, tint=grey, ground=True),
        'moon-rock': lambda: import_model('moon_rock_03', 1.3, 1500, 'moon-rock', desaturate=1.0, tint=grey, ground=True),
        'moon-rocks-small': lambda: import_model('moon_rock_01', 0.6, 1200, 'moon-rocks-small', objects=['moon_rock_01_LOD0'], desaturate=1.0,
                                                 tint=grey, ground=True),
        'mars-boulder': lambda: import_model('moon_rock_05', 2.4, 2000, 'mars-boulder', desaturate=1.0, tint=rust, ground=True),
        'mars-stone': lambda: import_model('namaqualand_boulder_03', 1.6, 1500, 'mars-stone', desaturate=0.8, tint=rust, ground=True),
        'mars-rock-large': lambda: import_model('namaqualand_boulder_06', 3.2, 2000, 'mars-rock-large', desaturate=0.8, tint=rust, ground=True),
        'mars-cliff': lambda: import_model('namaqualand_cliff_02', 12.0, 6000, 'mars-cliff', desaturate=0.8, tint=rust, ground=True, close=True),
    }
