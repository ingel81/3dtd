"""Mars ascent vehicle, livestock, deer, a dog sled and a siege tower of the map
asset catalogue (loaded by build_models.py).

Animals are cheap on purpose (a few hundred triangles, two or three flat
materials, no textures) so a herd at the map edge instances into a few draw
calls: bodies are tubes squashed into an oval, legs two-segment tubes,
heads tapered tubes; each pose is a model of its own.
"""
import math
import random

from mathutils import Matrix, Vector

from blender_kit import Part, box, clear_scene, export, export_lod, finish, flat_material, hexa, oriented_box, pbr_material, rust_material, tube


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


# ---------------------------------------------------------------- livestock and deer

# Per kind: body length and radius (round, then squashed across by `wide` and up by `deep`), height of the
# body's axis standing, leg radius, neck and head length, head radius, how upright the neck is carried
# (0 level, 1 upright) and how steeply the head points down (0 level, 1 straight down)
COW = dict(length=1.75, radius=0.4, wide=0.8, deep=1.2, axis=0.98, leg=0.08, neck=0.42, head=0.5, head_r=0.15, carriage=0.3, nose=0.75)
SHEEP = dict(length=0.95, radius=0.33, wide=0.9, deep=1.0, axis=0.62, leg=0.035, neck=0.3, head=0.3, head_r=0.09, carriage=0.6, nose=0.6)
DEER = dict(length=1.15, radius=0.25, wide=0.8, deep=1.15, axis=0.95, leg=0.035, neck=0.55, head=0.32, head_r=0.08, carriage=0.85, nose=0.5)


def body_axis(kind, pose):
    """Height of the body's axis: standing, or resting on the ground"""
    return kind['radius'] * kind['deep'] * 0.9 if pose == 'lie' else kind['axis']


def quadruped(kind, pose, coat, legs, face, hoof, seed=0):
    """A grazing animal facing -Y in one of three poses: `stand` (head up), `graze` (muzzle on the ground)
    or `lie` (body on the ground, legs folded under). Coat, leg, face and hoof parts may be the same Part.
    Returns the poll (top of the head) and the head's forward direction for ears, horns or antlers"""
    rnd = random.Random(seed)
    L, r = kind['length'], kind['radius']
    axis = body_axis(kind, pose)
    lying = pose == 'lie'
    # Body: rump (+Y) to chest (-Y), deepest behind the shoulder
    ys = [L / 2 + 0.05, L / 2 - 0.05, L * 0.25, 0.0, -L * 0.25, -L / 2 + 0.06, -L / 2 - 0.04]
    rs = [0.25, 0.8, 0.98, 1.0, 0.97, 0.78, 0.35]
    pts = [Vector((0, y, axis + (0.02 * L if y < 0 else 0.0))) for y in ys]
    faces = tube(coat, pts, [r * f for f in rs], 10, cap=True)
    squash(faces, sx=kind['wide'], sz=kind['deep'], centre=Vector((0, 0, axis)))
    r *= kind['deep']
    # Legs: thigh, shank, hoof; hind legs bend back at the hock, front legs straight
    half = r * kind['wide'] * 0.55
    lr = kind['leg']
    for front in (True, False):
        y = -L / 2 + 0.22 * L if front else L / 2 - 0.2 * L
        for side in (-1, 1):
            x = side * half
            if lying:
                # Folded under the body: front legs bent at the knee with the shank tucked back, hind legs
                # along the flank with the hoof forward
                if front:
                    hip = Vector((x, y, axis - r * 0.4))
                    knee = Vector((x * 1.1, y - 0.12 * L, lr * 1.4))
                    foot = Vector((x * 1.05, y + 0.08 * L, lr * 1.2))
                else:
                    hip = Vector((x * 1.2, y, axis - r * 0.1))
                    knee = Vector((x * 1.9, y + 0.08 * L, lr * 1.6))
                    foot = Vector((x * 1.8, y - 0.3 * L, lr * 1.2))
                tube(legs, [hip, knee, foot], [lr * 2.0, lr * 1.3, lr * 1.0], 6, cap=True)
                continue
            hip = Vector((x, y, axis - r * 0.2))
            knee = Vector((x, y + (0.0 if front else 0.08 * L), (axis - r * 0.2) * 0.45))
            foot = Vector((x, y + (0.02 if front else 0.03), 0.05))
            if pose == 'graze' and front:
                # Front legs a little apart and forward, taking the weight of the lowered head
                foot.y -= 0.05 * L
                foot.x *= 1.15
            tube(legs, [hip, hip.lerp(knee, 0.5), knee, foot], [lr * 2.2, lr * 1.7, lr * 1.0, lr * 0.9], 6)
            tube(hoof, [foot, foot - Vector((0, 0, 0.05))], [lr * 1.05, lr * 1.15], 6, cap=True)
    # Neck and head
    shoulder = Vector((0, -L / 2 + 0.12, axis + r * 0.35))
    head_r = kind['head_r']
    if pose == 'graze':
        poll = Vector((0, -L / 2 - kind['neck'] * 0.55, max(0.35, axis * 0.42)))
        tip = poll + Vector((rnd.uniform(-0.05, 0.05), -kind['head'] * 0.45, -kind['head'] * 0.85))
        tip.z = max(tip.z, head_r * 0.7)
    elif lying:
        poll = Vector((0, -L / 2 - kind['neck'] * 0.25, axis + r * 0.9 + kind['neck'] * 0.5))
        turn = rnd.uniform(-0.6, 0.6)
        tip = poll + Vector((math.sin(turn) * kind['head'], -math.cos(turn) * kind['head'] * 0.9, -kind['head'] * 0.35))
    else:
        up = kind['carriage']
        poll = Vector((0, -L / 2 - kind['neck'] * (1.0 - 0.6 * up), axis + r * 0.5 + kind['neck'] * up))
        dip = kind['nose'] * math.pi / 2
        tip = poll + Vector((0, -math.cos(dip), -math.sin(dip))) * kind['head']
    tube(coat, [shoulder, shoulder.lerp(poll, 0.6), poll], [r * 0.62, r * 0.45, head_r * 1.2], 8)
    tube(face, [poll - (tip - poll).normalized() * head_r * 0.6, poll, poll.lerp(tip, 0.6), tip],
         [head_r * 0.5, head_r * 1.05, head_r * 0.9, head_r * 0.62], 8, cap=True)
    # Tail
    rump = Vector((0, L / 2 + 0.02, axis + r * 0.55))
    if kind.get('curl'):
        # A bushy tail curled up over the back (sled dogs)
        tube(coat, [rump, rump + Vector((0, 0.08, 0.1)), rump + Vector((0.02, 0.04, 0.2)), rump + Vector((0.04, -0.06, 0.21))],
             [lr * 1.4, lr * 2.2, lr * 2.0, lr * 0.8], 6)
    elif lying:
        tube(coat, [rump, rump + Vector((0.08, 0.12, -r * 0.6))], [lr * 0.7, lr * 0.4], 5)
    else:
        tube(coat, [rump, rump + Vector((0, 0.05, -axis * 0.35)), rump + Vector((0, 0.06, -axis * 0.6))], [lr * 0.6, lr * 0.45, lr * 0.35], 5)
    return poll, (tip - poll).normalized()


def head_frame(ahead):
    """Sideways and up from the head's point of view (up tilts forward when the head points down)"""
    side = Vector((0, 0, 1)).cross(ahead).normalized()
    return side, ahead.cross(side).normalized()


def ears(part, poll, ahead, size, droop=0.3):
    """Two flat ears out from the poll, sideways and a little back"""
    side, _ = head_frame(ahead)
    for s in (-1, 1):
        a = poll + side * s * size * 0.4 - ahead * size * 0.2
        b = a + side * s * size + Vector((0, 0, -droop * size)) - ahead * size * 0.2
        oriented_box(part, a, b, size * 0.35)


def cow(name, pose, seed):
    """Hereford-style cow: red-brown coat, white face and chest, short pale horns"""
    clear_scene()
    coat = Part(flat_material('cow-coat', (0.17, 0.065, 0.03), 0.85), smooth=True)
    white = Part(flat_material('cow-white', (0.62, 0.6, 0.55), 0.85), smooth=True)
    hoof = Part(flat_material('animal-hoof', (0.05, 0.045, 0.04), 0.6), smooth=True)
    poll, ahead = quadruped(COW, pose, coat, coat, white, hoof, seed)
    ears(coat, poll, ahead, 0.16)
    side, up = head_frame(ahead)
    for s in (-1, 1):
        base = poll + side * s * 0.08 + up * 0.06
        tube(white, [base, base + side * s * 0.12 + up * 0.03, base + side * s * 0.17 + up * 0.1 + ahead * 0.04],
             [0.03, 0.022, 0.008], 5)
    # The white blaze down the chest
    L, z = COW['length'], body_axis(COW, pose)
    tube(white, [Vector((0, -L / 2 + 0.1, z + 0.1)), Vector((0, -L / 2 - 0.01, z - 0.12))], [0.18, 0.12], 8, cap=True)
    objects = [coat.to_object(name), white.to_object(name + '-white'), hoof.to_object(name + '-hoof')]
    # Lying, the hooves are folded under: no hoof part
    export(name, [o for o in objects if o.data.polygons])


def sheep(name, pose, seed):
    """Woolly sheep with a black face and legs (Suffolk): tufts of fleece over the body"""
    clear_scene()
    rnd = random.Random(seed)
    wool = Part(flat_material('sheep-wool', (0.56, 0.52, 0.43), 0.95), smooth=True)
    black = Part(flat_material('sheep-face', (0.06, 0.055, 0.05), 0.8), smooth=True)
    poll, ahead = quadruped(SHEEP, pose, wool, black, black, black, seed)
    ears(black, poll, ahead, 0.1, droop=0.5)
    L, r, axis = SHEEP['length'], SHEEP['radius'], body_axis(SHEEP, pose)
    for k in range(9):
        a = rnd.uniform(-1.9, 1.9)
        y = rnd.uniform(-L * 0.38, L * 0.4)
        c = Vector((math.sin(a) * r * 0.85, y, axis + math.cos(a) * r * 0.85))
        n = (c - Vector((0, y, axis))).normalized()
        rad = rnd.uniform(0.11, 0.15)
        tube(wool, [c - n * rad * 0.6, c + n * rad * 0.2, c + n * rad * 0.55], [rad * 0.9, rad, rad * 0.5], 7)
    # The wool cap on the poll
    tube(wool, [poll - ahead * 0.06 + Vector((0, 0, -0.02)), poll + Vector((0, 0, 0.05))], [0.1, 0.07], 7, cap=True)
    export(name, [wool.to_object(name), black.to_object(name + '-face')])


def deer(name, pose, seed):
    """Red deer stag: reddish brown with a pale rump patch, antlers with four tines a side"""
    clear_scene()
    coat = Part(flat_material('deer-coat', (0.19, 0.095, 0.045), 0.85), smooth=True)
    pale = Part(flat_material('deer-pale', (0.46, 0.38, 0.29), 0.85), smooth=True)
    poll, ahead = quadruped(DEER, pose, coat, coat, coat, pale, seed)
    ears(coat, poll, ahead, 0.13, droop=-0.3)
    L, axis = DEER['length'], body_axis(DEER, pose)
    tube(pale, [Vector((0, L / 2 + 0.02, axis + 0.04)), Vector((0, L / 2 + 0.06, axis - 0.1))], [0.13, 0.09], 8, cap=True)
    side, up = head_frame(ahead)
    back = -ahead
    for s in (-1, 1):
        # Main beam out, back and up in a lyre curve, tines forward and up off it
        base = poll + side * s * 0.05 + up * 0.05
        beam = [base, base + side * s * 0.2 + up * 0.18 + back * 0.1, base + side * s * 0.38 + up * 0.36 + back * 0.2,
                base + side * s * 0.45 + up * 0.55 + back * 0.15, base + side * s * 0.4 + up * 0.7 + back * 0.05]
        tube(pale, beam, [0.028, 0.024, 0.02, 0.016, 0.006], 5)
        for t, length in ((0.12, 0.2), (0.3, 0.18), (0.55, 0.16), (0.8, 0.12)):
            k = min(int(t * 4), 3)
            p = beam[k].lerp(beam[k + 1], t * 4 - k)
            tine = p + (ahead * 0.7 + up * 0.7 - side * s * 0.1).normalized() * length
            tube(pale, [p, tine], [0.014, 0.004], 4)
    export(name, [coat.to_object(name), pale.to_object(name + '-pale')])


# ---------------------------------------------------------------- dog sled

DOG = dict(length=0.72, radius=0.16, wide=0.85, deep=1.15, axis=0.38, leg=0.028, neck=0.2, head=0.17, head_r=0.06, carriage=0.7,
           nose=0.2, curl=True)


def sled_dog(coat, belly, dark, matrix, pose, seed):
    """One husky (grey back, pale face, legs and paws, pricked ears, curled tail) built at the origin and moved by
    `matrix` into the parts; a red harness saddle on the back. Returns the harness point (chest) moved too"""
    parts = [Part(p.material, smooth=True) for p in (coat, belly, dark)]
    tc, tb, td = parts
    poll, ahead = quadruped(DOG, pose, tc, tb, tb, tb, seed)
    ears(tc, poll, ahead, 0.06, droop=-1.2)
    axis = body_axis(DOG, pose)
    box(td, 0, -0.05, axis + DOG['radius'] * DOG['deep'] * 0.92, 0.12, 0.2, 0.025)
    for p, target in zip(parts, (coat, belly, dark)):
        target.add_bmesh(p.bm, matrix)
        p.bm.free()
    return matrix @ Vector((0, -DOG['length'] / 2 - 0.05, axis + 0.05))


def dog_sled(name):
    """A team of six huskies in three pairs on a gangline in front of a basket sled (front -Y): the lead pair
    standing alert, the others standing or lying at rest; the sled with ash runners, stanchions, a
    canvas load lashed down and the handlebar at the back"""
    clear_scene()
    coat = Part(flat_material('husky-coat', (0.2, 0.19, 0.18), 0.85), smooth=True)
    belly = Part(flat_material('husky-pale', (0.6, 0.58, 0.55), 0.85), smooth=True)
    dark = Part(flat_material('harness-red', (0.25, 0.03, 0.025), 0.7), smooth=True)
    wood = Part(flat_material('sled-ash', (0.28, 0.19, 0.11), 0.7))
    canvas = Part(flat_material('sled-canvas', (0.3, 0.3, 0.22), 0.9), smooth=True)
    rope = Part(flat_material('sled-rope', (0.12, 0.1, 0.08), 0.8), smooth=True)
    rnd = random.Random(12)
    # Dogs: pairs either side of the gangline, the lead pair in front; heads turned a little at random
    gang_back, gang_front = Vector((0, 1.5, 0.35)), Vector((0, -3.6, 0.35))
    poses = [('stand', 'stand'), ('stand', 'lie'), ('lie', 'stand')]
    for k, y in enumerate((-2.9, -1.7, -0.5)):
        for j, s in enumerate((-1, 1)):
            turn = rnd.uniform(-0.25, 0.25) + s * 0.08
            m = Matrix.Translation((s * 0.42, y, 0)) @ Matrix.Rotation(turn, 4, 'Z')
            chest = sled_dog(coat, belly, dark, m, poses[k][j], 20 + k * 2 + j)
            # Tugline from the harness back to the gangline
            tube(rope, [chest + Vector((0, 0.3, 0)), Vector((0, y + 0.6, 0.35))], [0.012, 0.012], 4)
            # Neckline from the collar to the gangline
            tube(rope, [chest + Vector((0, -0.05, 0.12)), Vector((0, y - 0.25, 0.4))], [0.01, 0.01], 4)
    tube(rope, [gang_back, Vector((0, -0.5, 0.33)), gang_front], [0.018, 0.018, 0.018], 4)
    # Sled: runners curving up at the front, a slatted bed on stanchions, side rails, the handlebar
    y0, y1 = 1.5, 3.9
    for x in (-0.38, 0.38):
        pts = [Vector((x, y1 + 0.3, 0.04)), Vector((x, y0 + 0.4, 0.04)), Vector((x, y0, 0.15)), Vector((x, y0 - 0.1, 0.45))]
        tube(wood, pts, [0.03] * 4, 6)
        for y in (y0 + 0.4, y0 + 1.1, y0 + 1.8, y1):
            box(wood, x, y, 0.04, 0.05, 0.05, 0.36)
        tube(wood, [Vector((x, y0, 0.55)), Vector((x, y1, 0.55))], [0.022, 0.022], 6)
        # Handlebar uprights at the back, leaning back
        tube(wood, [Vector((x, y1, 0.4)), Vector((x * 1.05, y1 + 0.3, 1.05))], [0.025, 0.022], 6)
    tube(wood, [Vector((-0.42, y1 + 0.3, 1.05)), Vector((0.42, y1 + 0.3, 1.05))], [0.025, 0.025], 6)
    tube(wood, [Vector((-0.38, y0 - 0.1, 0.45)), Vector((0.38, y0 - 0.1, 0.45))], [0.03, 0.03], 6)
    for k in range(7):
        box(wood, 0, y0 + 0.3 + k * 0.3, 0.38, 0.84, 0.18, 0.03)
    # The load: a canvas bag lashed down, a rolled pack on top
    prof = [(0.0, 0.05), (0.08, 0.28), (0.4, 0.33), (1.4, 0.33), (1.72, 0.28), (1.8, 0.05)]
    faces = tube(canvas, [Vector((0, y0 + 0.4 + d, 0.65)) for d, _ in prof], [w for _, w in prof], 10)
    squash(faces, sx=1.15, sz=0.75, centre=Vector((0, 0, 0.65)))
    tube(canvas, [Vector((-0.3, y0 + 1.6, 0.98)), Vector((0.3, y0 + 1.6, 0.98))], [0.12, 0.12], 8, cap=True)
    for y in (y0 + 0.7, y0 + 1.3, y0 + 1.9):
        tube(rope, [Vector((-0.42, y, 0.55)), Vector((-0.3, y, 0.85)), Vector((0, y, 0.92)), Vector((0.3, y, 0.85)), Vector((0.42, y, 0.55))],
             [0.012] * 5, 4)
    export(name, [coat.to_object(name), belly.to_object(name + '-pale'), dark.to_object(name + '-harness'), wood.to_object(name + '-wood'),
                  canvas.to_object(name + '-canvas'), rope.to_object(name + '-rope')])


# ---------------------------------------------------------------- siege tower

def siege_tower(name):
    """A siege tower (belfry) rolled up to a wall (front -Y): a timber frame of four storeys tapering
    upwards on a chassis with six solid wheels, planked on the front and sides and hung with hides against
    fire, arrow slits in the sides, the back open on ladders and floors; on top a fighting platform behind
    a planked parapet and the drawbridge half lowered on its ropes"""
    clear_scene()
    wood = Part(pbr_material('wood-rough', 'rough_wood', (0.8, 0.72, 0.62)), uv_metres=1.0)
    planks = Part(pbr_material('planks-dark', 'dark_planks', (0.85, 0.75, 0.65)), uv_metres=2.0)
    hides = Part(pbr_material('hide-hessian', 'hessian_230', (0.42, 0.27, 0.17)), uv_metres=1.5, smooth=True, bevel=0.0)
    iron = Part(flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8), smooth=True)
    rope = Part(flat_material('rope', (0.55, 0.47, 0.33), 0.9), smooth=True, bevel=0.0)
    dark = Part(flat_material('slit', (0.03, 0.03, 0.035), 0.9), bevel=0.0)
    z_base, z_top, z_platform = 1.0, 12.4, 10.2
    floors = (z_base, 4.1, 7.2, z_platform)

    def half(z):
        """Half width (x) and half depth (y) of the frame at height z: it narrows towards the top"""
        t = (z - z_base) / (z_top - z_base)
        return 2.2 - 0.45 * t, 2.5 - 0.5 * t

    def corner(z, sx, sy, grow=0.0):
        hx, hy = half(z)
        return Vector((sx * (hx + grow), sy * (hy + grow), z))

    # Chassis: two long sills and cross beams, six wheels with iron tyres, axle ends through the hubs
    for s in (-1, 1):
        box(wood, s * 1.9, 0, 0.55, 0.45, 5.8, 0.45)
        for y in (-1.9, 0.0, 1.9):
            tube(wood, [Vector((s * 2.15, y, 0.62)), Vector((s * 2.5, y, 0.62))], [0.62, 0.62], 14, cap=True)
            tube(iron, [Vector((s * 2.12, y, 0.62)), Vector((s * 2.53, y, 0.62))], [0.65, 0.65], 14)
            tube(iron, [Vector((s * 2.5, y, 0.62)), Vector((s * 2.6, y, 0.62))], [0.14, 0.14], 8, cap=True)
    for y in (-2.6, -0.95, 0.95, 2.6):
        box(wood, 0, y, 0.6, 4.3, 0.35, 0.35)
    # Corner posts, the girts at each floor and the floors
    for sx in (-1, 1):
        for sy in (-1, 1):
            oriented_box(wood, corner(z_base - 0.1, sx, sy), corner(z_top, sx, sy), 0.32)
    for z in floors:
        for a, b in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            oriented_box(wood, corner(z, *a, grow=0.02), corner(z, *b, grow=0.02), 0.26)
        hx, hy = half(z)
        box(planks, 0, 0, z - 0.05, hx * 2, hy * 2, 0.1)
    # Cladding: plank slabs on the front and both sides from the base to the platform, proud of the posts
    for z0, z1 in zip(floors, floors[1:]):
        for (ax, ay), (bx, by) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((-1, 1), (-1, -1))):
            n = Vector((ax + bx, ay + by, 0)).normalized() * 0.08
            a0, b0 = corner(z0, ax, ay, 0.1), corner(z0, bx, by, 0.1)
            a1, b1 = corner(z1, ax, ay, 0.1), corner(z1, bx, by, 0.1)
            hexa(planks, [a0, b0, b0 - n, a0 - n], [a1, b1, b1 - n, a1 - n])
    # Hides hung down the front in two tiers of strips, the upper over the lower, wavy and of uneven length
    hx, _ = half(z_platform)
    for k in range(10):
        tier, col = divmod(k, 5)
        n = 5
        xa = -hx + (col + 0.5 * tier) * hx * 2 / (n + 0.5) + 0.04
        xb = xa + hx * 2 / (n + 0.5) - 0.08
        top = z_platform - 0.1 if tier == 0 else 5.6
        bottom = (5.0 if tier == 0 else z_base + 0.3) - 0.35 * math.sin(k * 2.1) ** 2
        lift = 0.06 * (1 - tier)
        pts = []
        for j in range(6):
            z = top - j * (top - bottom) / 5
            pts.append((z, -half(z)[1] - 0.2 - lift - 0.05 * math.sin(j * 1.3 + k)))
        for (za, ya), (zb, yb) in zip(pts, pts[1:]):
            hides.quad([Vector((xa, ya, za)), Vector((xa, yb, zb)), Vector((xb, yb, zb)), Vector((xb, ya, za))],
                       [(0, za / 1.5), (0, zb / 1.5), (1, zb / 1.5), (1, za / 1.5)])
    # Arrow slits in the sides, two per storey
    for z0 in floors[:-1]:
        zc = z0 + 1.4
        for s in (-1, 1):
            for y in (-0.9, 0.9):
                box(dark, s * (half(zc)[0] + 0.19), y, zc, 0.04, 0.22, 1.0)
    # The back: open, a ladder up each storey and a diagonal brace between the rear posts
    for z0, z1 in zip(floors, floors[1:]):
        y0, y1 = half(z0)[1] - 0.9, half(z1)[1] - 0.6
        for x in (0.8, 1.3):
            oriented_box(wood, Vector((x, y0, z0)), Vector((x, y1, z1)), 0.09)
        for k in range(1, 8):
            p = Vector((0, y0, z0)).lerp(Vector((0, y1, z1)), k / 8)
            oriented_box(wood, Vector((0.8, p.y, p.z)), Vector((1.3, p.y, p.z)), 0.06)
        oriented_box(wood, corner(z0, -1, 1), corner(z1, 1, 1), 0.2)
    # Fighting platform: a parapet of planks on the sides and back, high and low in turn (crenels)
    for (ax, ay), (bx, by) in (((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
        a, b = corner(z_platform, ax, ay), corner(z_platform, bx, by)
        for k in range(4):
            p0, p1 = a.lerp(b, k / 4 + 0.02), a.lerp(b, (k + 1) / 4 - 0.02)
            d = p1 - p0
            box(planks, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2, z_platform, abs(d.x) + 0.1, abs(d.y) + 0.1, 1.6 if k % 2 == 0 else 1.1)
    # Two posts at the front carry the bridge ropes
    for sx in (-1, 1):
        tube(wood, [corner(z_platform, sx, -1), corner(z_top + 0.6, sx, -1)], [0.16, 0.14], 8)
    # Drawbridge: hinged at the front edge of the platform, lowered to 35 degrees from upright
    hx, hy = half(z_platform)
    ang = math.radians(35)
    length, width = 3.6, hx * 2 - 0.3
    base = Vector((0, -hy - 0.15, z_platform))
    tip = base + Vector((0, -math.sin(ang) * length, math.cos(ang) * length))
    for k in range(7):
        x = -width / 2 + (k + 0.5) * width / 7
        oriented_box(planks, base + Vector((x, 0, 0)), tip + Vector((x, 0, 0)), width / 7.3)
    # Battens across the bridge's outer face, hinge irons, the ropes to the posts
    for t in (0.15, 0.55, 0.92):
        p = base.lerp(tip, t) + Vector((0, -0.1 * math.cos(ang), -0.1 * math.sin(ang)))
        oriented_box(wood, p - Vector((width / 2, 0, 0)), p + Vector((width / 2, 0, 0)), 0.14)
    for x in (-width / 3, width / 3):
        tube(iron, [base + Vector((x - 0.2, 0, 0)), base + Vector((x + 0.2, 0, 0))], [0.09, 0.09], 8)
    for sx in (-1, 1):
        tube(rope, [tip + Vector((sx * (width / 2 - 0.1), 0, 0)), corner(z_top + 0.5, sx, -1)], [0.03, 0.03], 5)
    obj = finish(name, [wood.to_object(name), planks.to_object(name + '-planks'), hides.to_object(name + '-hides'),
                        iron.to_object(name + '-iron'), rope.to_object(name + '-rope'), dark.to_object(name + '-slits')])
    export_lod(name, obj, ratio=min(1.0, 700 / len(obj.data.polygons)))


def models():
    return {
        'mars-lander': lambda: mars_lander('mars-lander'),
        'cow': lambda: cow('cow', 'stand', 1),
        'cow-grazing': lambda: cow('cow-grazing', 'graze', 2),
        'cow-lying': lambda: cow('cow-lying', 'lie', 3),
        'sheep': lambda: sheep('sheep', 'stand', 4),
        'sheep-grazing': lambda: sheep('sheep-grazing', 'graze', 5),
        'sheep-lying': lambda: sheep('sheep-lying', 'lie', 6),
        'deer': lambda: deer('deer', 'stand', 7),
        'deer-grazing': lambda: deer('deer-grazing', 'graze', 8),
        'dog-sled': lambda: dog_sled('dog-sled'),
        'siege-tower': lambda: siege_tower('siege-tower'),
    }
