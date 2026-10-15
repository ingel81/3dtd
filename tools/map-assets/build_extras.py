"""Mars ascent vehicle, livestock, deer, a dog sled and a siege tower of the map
asset catalogue (loaded by build_models.py).

Animals are cheap on purpose (a few hundred triangles, two or three flat
materials, no textures) so a herd at the map edge instances into a few draw
calls: bodies are tubes squashed into an oval, legs two-segment tubes,
heads tapered tubes; each pose is a model of its own.
"""
import math
import random

from mathutils import Vector

from blender_kit import Part, box, clear_scene, finish, flat_material, oriented_box, rust_material, tube


def squash(faces, sx=1.0, sz=1.0, centre=Vector()):
    """Scales the verts of `faces` about `centre` across (x) and up (z): round tubes into oval bodies"""
    for v in {v for f in faces for v in f.verts}:
        v.co.x = centre.x + (v.co.x - centre.x) * sx
        v.co.z = centre.z + (v.co.z - centre.z) * sz


# ---------------------------------------------------------------- Mars ascent vehicle

def mars_lander(name):
    """Mars ascent vehicle on its descent stage (front -Y): a tall white cone with a rounded nose, an
    engine skirt, two small windows and a side hatch, sitting on a hexagonal deck with two spherical
    propellant tanks, four splayed legs with footpads and a ladder; everything in red dust, thickest low
    down. Taller and slimmer than the lunar lander, no gold foil"""
    clear_scene()
    hull = Part(rust_material('mav-hull', paint=(0.9, 0.89, 0.87), threshold=0.6, tint=(1.0, 0.95, 0.9)), smooth=True)
    dusty = Part(rust_material('mav-deck', paint=(0.55, 0.42, 0.34), threshold=0.68, tint=(1.0, 0.85, 0.72)), uv_metres=2.0)
    metal = Part(flat_material('mav-metal', (0.36, 0.3, 0.27), 0.55, 0.6), smooth=True)
    dark = Part(flat_material('mav-dark', (0.06, 0.055, 0.05), 0.5, 0.3), smooth=True)
    win = Part(flat_material('mav-window', (0.05, 0.07, 0.09), 0.1, 0.5))
    # Descent stage: hexagonal deck on a lower frame
    deck_z, r_deck = 2.0, 3.0
    hexagon = [Vector((math.cos(k / 6 * math.tau) * r_deck, math.sin(k / 6 * math.tau) * r_deck, 0)) for k in range(6)]
    bm = dusty.bm
    top = [bm.verts.new(c + Vector((0, 0, deck_z + 0.35))) for c in hexagon]
    bot = [bm.verts.new(c * 0.82 + Vector((0, 0, deck_z - 0.25))) for c in hexagon]
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    for k in range(6):
        bm.faces.new((bot[k], bot[(k + 1) % 6], top[(k + 1) % 6], top[k]))
    # Railing round the deck edge, broken at the front for the ladder
    for k in range(6):
        a, b = hexagon[k] * 0.96, hexagon[(k + 1) % 6] * 0.96
        if k == 4:
            continue
        for p in (a, a.lerp(b, 0.5)):
            oriented_box(metal, p + Vector((0, 0, deck_z + 0.35)), p + Vector((0, 0, deck_z + 1.25)), 0.05)
        oriented_box(metal, a + Vector((0, 0, deck_z + 1.25)), b + Vector((0, 0, deck_z + 1.25)), 0.05)
    # Legs on the diagonals: a main strut out and down to a footpad, two side struts back to the frame
    for k in range(4):
        a = (k + 0.5) / 4 * math.tau
        out = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-out.y, out.x, 0))
        hip = out * 2.3 + Vector((0, 0, deck_z))
        foot = out * 4.3 + Vector((0, 0, 0.35))
        tube(metal, [hip, hip.lerp(foot, 0.55), foot], [0.14, 0.13, 0.1], 8)
        knee = hip.lerp(foot, 0.6)
        for s in (-1, 1):
            tube(metal, [out * 1.7 + side * s * 1.2 + Vector((0, 0, deck_z - 0.2)), knee], [0.06, 0.06], 6)
        # Shock absorber sleeve and the footpad, half buried in dust
        tube(dark, [hip.lerp(foot, 0.25), hip.lerp(foot, 0.45)], [0.2, 0.2], 8, cap=True)
        tube(dusty, [foot + Vector((0, 0, -0.45)), foot + Vector((0, 0, -0.25)), foot + Vector((0, 0, -0.05))], [0.7, 0.7, 0.35], 12,
             cap=True)
    # Engine bells under the deck
    for k in range(3):
        a = k / 3 * math.tau
        c = Vector((math.cos(a) * 0.9, math.sin(a) * 0.9, deck_z - 0.25))
        tube(dark, [c, c - Vector((0, 0, 0.9))], [0.25, 0.48], 12)
    # Propellant tanks in the two rear corners on cradles, a pipe each to the vehicle
    for a in (math.pi / 3, 2 * math.pi / 3):
        out = Vector((math.cos(a), math.sin(a), 0))
        c = out * 2.3 + Vector((0, 0, deck_z + 0.95))
        prof = [(-0.55, 0.02), (-0.48, 0.3), (-0.28, 0.48), (0.0, 0.55), (0.28, 0.48), (0.48, 0.3), (0.55, 0.02)]
        tube(hull, [c + Vector((0, 0, z)) for z, _ in prof], [w for _, w in prof], 14)
        side = Vector((-out.y, out.x, 0))
        for d in (-0.3, 0.3):
            oriented_box(metal, c + side * d + Vector((0, 0, -0.6)), c + side * d * 0.7 + Vector((0, 0, -0.3)), 0.08)
        tube(metal, [c - out * 0.5 + Vector((0, 0, 0.15)), out * 1.55 + Vector((0, 0, deck_z + 1.4))], [0.06, 0.06], 6)
    # The ascent vehicle: skirt, a short cylinder, a long cone, a rounded nose
    z0 = deck_z + 0.35
    tube(dark, [Vector((0, 0, z0)), Vector((0, 0, z0 + 0.5))], [1.55, 1.7], 24)
    prof = [(0.5, 1.7), (1.6, 1.72), (2.0, 1.66), (5.5, 1.05), (7.6, 0.62), (8.2, 0.48), (8.6, 0.3), (8.8, 0.1)]
    tube(hull, [Vector((0, 0, z0 + z)) for z, _ in prof], [w for _, w in prof], 24)
    # Dark band at the joint of cylinder and cone, the docking ring at the nose
    tube(dark, [Vector((0, 0, z0 + 1.95)), Vector((0, 0, z0 + 2.1))], [1.68, 1.67], 24)
    tube(metal, [Vector((0, 0, z0 + 8.15)), Vector((0, 0, z0 + 8.3))], [0.52, 0.48], 16)
    tube(dark, [Vector((0, 0, z0 + 6.6)), Vector((0, 0, z0 + 6.9))], [0.87, 0.82], 24)
    # Two windows on the front of the cone and the side hatch (+X) with a ladder down to the deck
    for s in (-1, 1):
        a = -math.pi / 2 + s * 0.28
        zw, rw = z0 + 5.4, 1.08
        n = Vector((math.cos(a), math.sin(a), 0.36)).normalized()
        c = Vector((math.cos(a) * rw, math.sin(a) * rw, zw))
        t = Vector((-math.sin(a), math.cos(a), 0))
        u = n.cross(t).normalized()
        c = c + n * 0.03
        oriented_box(metal, c - t * 0.3 - u * 0.25, c + t * 0.3 - u * 0.25, 0.07)
        oriented_box(metal, c - t * 0.25 + u * 0.23, c + t * 0.25 + u * 0.23, 0.07)
        c = c + n * 0.02
        win.quad([c - t * 0.24 - u * 0.2, c + t * 0.24 - u * 0.2, c + t * 0.2 + u * 0.18, c - t * 0.2 + u * 0.18],
                 [(0, 0), (1, 0), (1, 1), (0, 1)])
    hz = z0 + 3.0
    hr = 1.5
    tube(dark, [Vector((hr - 0.05, 0, hz)), Vector((hr + 0.08, 0, hz + 0.1))], [0.52, 0.5], 14, cap=True)
    tube(metal, [Vector((hr + 0.06, 0, hz + 0.08)), Vector((hr + 0.14, 0, hz + 0.1))], [0.18, 0.18], 10, cap=True)
    for y in (-0.35, 0.35):
        oriented_box(metal, Vector((1.85, y, z0)), Vector((1.75, y, hz - 0.45)), 0.05)
    for k in range(5):
        z = z0 + 0.35 + k * 0.45
        oriented_box(metal, Vector((1.84 - k * 0.02, -0.35, z)), Vector((1.84 - k * 0.02, 0.35, z)), 0.04)
    # RCS thruster blocks round the cone
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 4
        c = Vector((math.cos(a) * 1.25, math.sin(a) * 1.25, z0 + 4.6))
        box(metal, c.x, c.y, c.z, 0.25, 0.25, 0.4, a)
        for d in (Vector((math.cos(a), math.sin(a), 0)), Vector((0, 0, 1))):
            tube(dark, [c + Vector((0, 0, 0.2)) + d * 0.12, c + Vector((0, 0, 0.2)) + d * 0.3], [0.04, 0.07], 6)
    # Ladder from the front of the deck down to the ground
    for x in (-0.35, 0.35):
        oriented_box(metal, Vector((x, -2.55, deck_z + 0.35)), Vector((x, -3.4, 0.0)), 0.06)
    for k in range(6):
        p = Vector((0, -2.55, deck_z + 0.35)).lerp(Vector((0, -3.4, 0.0)), (k + 0.5) / 6)
        oriented_box(metal, p + Vector((-0.35, 0, 0)), p + Vector((0.35, 0, 0)), 0.04)
    # Antenna mast and a small dish on the deck, left
    mast = Vector((-2.05, -0.75, deck_z + 0.35))
    tube(metal, [mast, mast + Vector((0, 0, 2.2))], [0.05, 0.04], 6)
    tip = mast + Vector((0, 0, 2.2))
    tube(hull, [tip, tip + Vector((0.08, 0.12, 0.08)), tip + Vector((0.15, 0.25, 0.2))], [0.05, 0.3, 0.42], 12)
    # Dust drifted against the footpads and the deck's underside (a low heap under the engines)
    heap = Part(rust_material('mav-deck', paint=(0.55, 0.42, 0.34), threshold=0.68, tint=(1.0, 0.85, 0.72)), smooth=True)
    tube(heap, [Vector((0, 0, -0.3)), Vector((0, 0, 0.05)), Vector((0, 0, 0.14))], [2.2, 1.6, 0.4], 16, cap=True)
    finish(name, [hull.to_object(name), dusty.to_object(name + '-deck'), metal.to_object(name + '-metal'),
                  dark.to_object(name + '-dark'), win.to_object(name + '-window'), heap.to_object(name + '-heap')])


def models():
    return {
        'mars-lander': lambda: mars_lander('mars-lander'),
    }
