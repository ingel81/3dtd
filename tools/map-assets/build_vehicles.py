"""Vehicles of the map asset catalogue (loaded by build_models.py).

Car, pickup truck, box truck, bus and a tank, each whole and as a rusted
or burnt-out wreck; whole cars in six bodies of today (small car, hatchback,
saloon, estate, SUV, people carrier: passenger_car) with their glasshouse,
pillars and glossy paint, sixteen paints in one baked atlas. Bodies are side profiles extruded across the width,
tapered above the belt line, with wheel arches cut by booleans, rounded
by a bevel and shaded smooth by angle; glass, pillars, bumpers, grille,
number plates, mirrors, door seams, lights and wheels are separate parts.
Paint is a flat colour; wrecks keep their paint under rust (rust_material,
dented), burnt ones are soot black with rust coming through.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

from blender_kit import Part, bake_surface, box, box_uv, clear_scene, export_lod, flat_material, oriented_box, pbr_material, rust_material, tilt, tube
from blender_kit import finish as export  # noqa: F401  (baked AO)


def profile_solid(part, profile, width, taper_from=None, taper=0.85, x0=0.0):
    """Prism from a side profile [(y, z), ...] (counter-clockwise seen from +X) across the width; above
    `taper_from` the sides lean in to `taper` of the width at the top"""
    bm = part.bm
    left = [bm.verts.new((x0 - width / 2, y, z)) for y, z in profile]
    right = [bm.verts.new((x0 + width / 2, y, z)) for y, z in profile]
    faces = [bm.faces.new(list(reversed(left))), bm.faces.new(right)]
    n = len(profile)
    faces += [bm.faces.new((left[i], right[i], right[(i + 1) % n], left[(i + 1) % n])) for i in range(n)]
    # Profiles may be listed either way round: make the normals point out
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    if taper_from is not None:
        top = max(z for _, z in profile)
        for v in left + right:
            if v.co.z > taper_from:
                t = (v.co.z - taper_from) / max(1e-3, top - taper_from)
                v.co.x = x0 + (v.co.x - x0) * (1 - (1 - taper) * t)


def cut_arches(obj, wheels, radius, width):
    """Boolean difference of a cylinder per wheel (axis X) from the body"""
    for y, z in wheels:
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius, depth=width + 0.6, location=(0, y, z),
                                            rotation=(0, math.pi / 2, 0))
        cutter = bpy.context.active_object
        mod = obj.modifiers.new('arch', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cutter
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter)


def round_body(obj, width=0.05, segments=2):
    mod = obj.modifiers.new('round', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(25)
    mod.use_clamp_overlap = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))


def wheel(tyre, rim, centre, radius=0.33, width=0.22, flat=False, rims_only=False):
    """Tyre with rounded shoulders and a rim with five spokes, axis X"""
    r = radius * (0.85 if flat else 1.0)
    c = Vector(centre) - Vector((0, 0, radius - r))
    x = Vector((1, 0, 0))
    if not rims_only:
        prof = [(-0.5, 0.82), (-0.42, 0.97), (0.0, 1.0), (0.42, 0.97), (0.5, 0.82)]
        tube(tyre, [c + x * width * t for t, _ in prof], [r * f for _, f in prof], 18)
    side = 1 if c.x > 0 else -1
    tube(rim, [c + x * side * width * 0.3, c + x * side * width * 0.5], [r * 0.62, r * 0.58], 14, cap=True)
    for k in range(5):
        a = k / 5 * math.tau
        d = Vector((0, math.cos(a), math.sin(a)))
        oriented_box(rim, c + x * side * width * 0.5, c + x * side * width * 0.5 + d * r * 0.55, 0.05)


def materials(state, paint):
    if state == 'whole':
        body = flat_material('paint-' + '-'.join('%.2f' % c for c in paint), paint, 0.28, 0.35)
        glass = flat_material('car-glass', (0.08, 0.1, 0.12), 0.05, 0.6)
    elif state == 'rust':
        # Faded paint, rust eating through in patches
        body = rust_material('paint-rusted-' + '-'.join('%.2f' % c for c in paint), paint=tuple(c * 0.75 + 0.06 for c in paint),
                             threshold=0.63)
        glass = flat_material('car-hole', (0.03, 0.025, 0.02), 0.95)
    else:
        body = rust_material('metal-burnt-wreck', paint=(0.05, 0.045, 0.042), threshold=0.72)
        glass = flat_material('car-hole', (0.03, 0.025, 0.02), 0.95)
    return body, glass


def dent(obj, seed, depth=0.035):
    """Wrecks: crumple the body a little (low-frequency noise along the normals)"""
    off = Vector((seed * 7.1, seed * 3.3, seed * 1.7))
    mesh = obj.data
    for v in mesh.vertices:
        v.co += v.normal * depth * noise.noise(v.co * 1.4 + off)
    mesh.update()


def vehicle(name, profile, greenhouse, roof, length, width, wheels, wheel_r, paint, state, extras=None, taper=0.82, belt=0.9,
            front_z=0.62, seams=()):
    """Shared assembly: body with arches, greenhouse glass under a roof, bumpers, grille, number plates, mirrors,
    door seams (`seams`: y of the cuts below the belt line), lights, wheels, wreck tilt and dents"""
    clear_scene()
    rnd = random.Random(len(name))
    body_mat, glass_mat = materials(state, paint)
    body = Part(body_mat)
    glass = Part(glass_mat, smooth=True)
    trim = Part(flat_material('car-trim', (0.06, 0.06, 0.065), 0.5, 0.3), bevel=0.02)
    # Small details in the trim material without the chamfer (the packer merges both into one draw call)
    fine = Part(trim.material)
    # Panels in the body paint that stay out of the wheel-arch booleans (ribs over the cargo box)
    panel = Part(body_mat, uv_metres=1.5 if state != 'whole' else None, bevel=0.0)
    tyre = Part(flat_material('tyre', (0.035, 0.035, 0.035), 0.9), smooth=True)
    rim = Part(flat_material('rim', (0.55, 0.56, 0.58), 0.35, 0.85) if state != 'burnt' else flat_material('rim-burnt', (0.12, 0.1, 0.09), 0.8, 0.5))
    profile_solid(body, profile, width, taper_from=belt, taper=taper)
    if greenhouse:
        profile_solid(glass, greenhouse, width - 0.1, taper_from=belt, taper=taper + 0.02)
    if roof:
        profile_solid(body, roof, width * (taper + 0.02) - 0.05, None)
    for sy in (-1, 1):
        y = sy * (length / 2 + 0.02)
        box(trim, 0, y, 0.38, width + 0.04, 0.16, 0.22)
    if extras:
        extras(body, glass, trim, fine, panel)
    # Grille between the headlights, number plates (rim metal) front and back, door seams, mirrors at the A-pillars
    box(fine, 0, -length / 2 - 0.005, front_z - 0.08, width * 0.42, 0.04, 0.18)
    for sy in (-1, 1):
        box(rim, 0, sy * (length / 2 + 0.105), 0.42, 0.52, 0.01, 0.12)
    side = width / 2 + 0.004
    for y in seams:
        for sx in (-1, 1):
            box(fine, sx * side, y, 0.36, 0.012, 0.02, belt - 0.42)
    if greenhouse:
        ya = min(p[0] for p in greenhouse) + 0.12
        for sx in (-1, 1):
            box(fine, sx * (width / 2 + 0.06), ya, belt + 0.02, 0.12, 0.18, 0.12)
            oriented_box(fine, Vector((sx * (width / 2 - 0.05), ya + 0.04, belt + 0.06)), Vector((sx * (width / 2 + 0.02), ya, belt + 0.06)), 0.03)
    for y, z in wheels:
        for sx in (-1, 1):
            wheel(tyre, rim, (sx * (width / 2 - 0.12), y, z), wheel_r, flat=state == 'rust' and sx > 0, rims_only=state == 'burnt')
    objects = []
    body_obj = body.to_object(name)
    cut_arches(body_obj, wheels, wheel_r + 0.08, width)
    round_body(body_obj, 0.05, 2)
    if state != 'whole':
        dent(body_obj, len(name))
        box_uv(body_obj, 1.5)
    objects.append(body_obj)
    if panel.bm.faces:
        objects.append(panel.to_object(name + '-panels'))
    if glass.bm.faces:
        g = glass.to_object(name + '-glass')
        if greenhouse:
            round_body(g, 0.03, 1)
        objects.append(g)
    if state == 'whole':
        head = Part(flat_material('headlight', (1.0, 0.96, 0.85), 0.2, emission=(1.0, 0.95, 0.8), strength=0.4))
        tail = Part(flat_material('taillight', (0.6, 0.05, 0.04), 0.3, emission=(0.8, 0.05, 0.03), strength=0.3))
        front_z = profile[0][1]
        for sx in (-1, 1):
            box(head, sx * (width / 2 - 0.3), -length / 2 - 0.01, 0.62, 0.32, 0.06, 0.12)
            box(tail, sx * (width / 2 - 0.25), length / 2 + 0.01, 0.68, 0.3, 0.06, 0.12)
        objects += [head.to_object(name + '-head'), tail.to_object(name + '-tail')]
    objects += [trim.to_object(name + '-trim'), fine.to_object(name + '-fine'), tyre.to_object(name + '-tyres'), rim.to_object(name + '-rims')]
    if state != 'whole':
        tilt(objects, x=rnd.uniform(-2, 2), y=rnd.uniform(2, 5), z=rnd.uniform(-10, 10), lift=-0.06 if state == 'rust' else -0.12)
    export(name, objects)


SEDAN = [(-2.2, 0.3), (2.2, 0.3), (2.25, 0.62), (2.15, 0.86), (1.3, 0.93), (-0.55, 0.9), (-1.0, 0.86), (-2.15, 0.74), (-2.25, 0.55)]
SEDAN_GLASS = [(-0.55, 0.88), (1.55, 0.9), (0.98, 1.38), (0.05, 1.37)]
SEDAN_ROOF = [(0.0, 1.35), (1.0, 1.36), (0.98, 1.41), (0.02, 1.41)]
PICKUP = [(-2.55, 0.38), (2.55, 0.38), (2.6, 0.75), (2.55, 1.0), (0.45, 1.0), (0.45, 1.02), (-0.9, 1.05), (-1.3, 1.02), (-2.5, 0.92), (-2.6, 0.62)]
PICKUP_GLASS = [(-1.25, 1.0), (0.4, 1.0), (0.4, 1.75), (-0.62, 1.75)]
PICKUP_ROOF = [(-0.66, 1.72), (0.42, 1.72), (0.42, 1.8), (-0.62, 1.8)]
TRUCK_CAB = [(-3.4, 0.45), (-1.5, 0.45), (-1.5, 2.85), (-2.9, 2.85), (-3.35, 2.2), (-3.45, 1.0)]
TRUCK_GLASS = [(-3.38, 1.75), (-2.9, 1.75), (-2.9, 2.6), (-3.2, 2.6)]
BUS = [(-5.6, 0.45), (5.6, 0.45), (5.62, 3.0), (5.4, 3.15), (-5.4, 3.15), (-5.62, 3.0)]


def car(name, paint, state='whole'):
    vehicle(name, SEDAN, SEDAN_GLASS, SEDAN_ROOF, 4.4, 1.8, [(-1.35, 0.33), (1.35, 0.33)], 0.33, paint, state, seams=(-0.55, 0.45, 1.3))


# Passenger cars (whole), today's bodies: each from a few measures (BODIES), the side profile drawn from them. Short
# overhangs, a high belt line, a raked windscreen and big wheels; the glasshouse a dark prism under a curved roof,
# broken by pillars in the paint. Front at -y. Fields: length, width, sill (body's foot), belt (top of the doors),
# nose and tail (top of the nose and of the tail at their faces), windscreen foot and top, rear glass top and foot
# (y), glass top (z), wheel radius, front and rear axle (y), the pillars between (y: the B pillar, on an estate or a
# people carrier a D pillar too), hood (how the hood falls to the nose: higher keeps it up longer)
BODIES = {
    'small': dict(L=3.68, W=1.72, sill=0.3, belt=1.04, nose=0.9, tail=1.04, af=-0.66, at=0.1, rt=1.56, rf=1.8,
                  top=1.5, wheel=0.31, axles=(-1.22, 1.24), pillars=(0.6,), hood=2.4),
    'hatch': dict(L=4.2, W=1.8, sill=0.3, belt=1.05, nose=0.88, tail=1.05, af=-0.64, at=0.24, rt=1.76, rf=2.02,
                  top=1.46, wheel=0.33, axles=(-1.38, 1.32), pillars=(0.8,), hood=2.6),
    'sedan': dict(L=4.8, W=1.84, sill=0.3, belt=1.04, nose=0.84, tail=1.03, af=-0.8, at=0.08, rt=1.32, rf=1.9,
                  top=1.44, wheel=0.34, axles=(-1.48, 1.44), pillars=(0.66,), hood=2.8),
    'estate': dict(L=4.84, W=1.84, sill=0.3, belt=1.04, nose=0.84, tail=1.06, af=-0.8, at=0.08, rt=2.2, rf=2.36,
                   top=1.48, wheel=0.34, axles=(-1.5, 1.44), pillars=(0.66, 1.62), hood=2.8),
    'suv': dict(L=4.6, W=1.88, sill=0.42, belt=1.2, nose=1.02, tail=1.2, af=-0.7, at=0.16, rt=1.98, rf=2.2,
                top=1.7, wheel=0.37, axles=(-1.4, 1.36), pillars=(0.84,), hood=2.4),
    'van': dict(L=4.62, W=1.86, sill=0.33, belt=1.1, nose=0.92, tail=1.1, af=-1.3, at=-0.4, rt=2.14, rf=2.27,
                top=1.8, wheel=0.33, axles=(-1.48, 1.46), pillars=(0.06, 1.5), hood=2.0),
}

# Paints as the cars of a European street wear them: mostly black, grey, silver and white, a few darker colours, no
# signal colours; (colour, metalness, roughness), the common ones more than once
PAINTS = [
    ((0.012, 0.013, 0.015), 0.4, 0.18), ((0.02, 0.021, 0.024), 0.0, 0.22), ((0.06, 0.065, 0.07), 0.6, 0.24),
    ((0.1, 0.105, 0.11), 0.55, 0.25), ((0.42, 0.43, 0.44), 0.85, 0.26), ((0.55, 0.56, 0.57), 0.8, 0.24),
    ((0.78, 0.79, 0.79), 0.0, 0.2), ((0.72, 0.73, 0.71), 0.3, 0.22), ((0.86, 0.86, 0.84), 0.0, 0.2),
    ((0.02, 0.045, 0.12), 0.6, 0.22), ((0.12, 0.2, 0.3), 0.5, 0.24), ((0.03, 0.09, 0.05), 0.55, 0.24),
    ((0.2, 0.025, 0.03), 0.5, 0.22), ((0.03, 0.11, 0.12), 0.55, 0.24), ((0.42, 0.37, 0.28), 0.65, 0.26),
    ((0.25, 0.22, 0.17), 0.4, 0.28),
]


def car_shape(b):
    """The side profile of the body, the glasshouse, the roof, the pillars, the wheels and the door seams of a BODIES entry"""
    h = b['L'] / 2
    sill, belt, nose, tail, af = b['sill'], b['belt'], b['nose'], b['tail'], b['af']
    # Tail: from the foot up its face, rounded into the boot's or the tailgate's top, along the belt to the windscreen
    profile = [(-h + 0.02, sill), (h - 0.02, sill), (h + 0.03, sill + 0.14), (h + 0.05, (sill + tail) / 2),
               (h + 0.03, tail - 0.1), (h - 0.05, tail - 0.01), (h - 0.3, tail)]
    profile += [(y, belt) for y in (min(h - 0.6, b['rf'] - 0.1), af + 0.1) if y > af + 0.1] + [(af, belt - 0.01)]
    # Hood: falls from the windscreen's foot to the nose, flat first, then round over the nose's edge
    for t in (0.3, 0.55, 0.75, 0.88, 0.96):
        profile.append((af + (-h + 0.06 - af) * t, belt - (belt - nose) * t ** b['hood']))
    profile += [(-h + 0.02, nose - 0.03), (-h - 0.03, nose - 0.14), (-h - 0.05, (sill + nose) / 2 - 0.02),
                (-h - 0.04, sill + 0.12)]
    top, rt, rf, at = b['top'], b['rt'], b['rf'], b['at']
    greenhouse = [(af - 0.02, belt - 0.02), (rf, belt - 0.01), (rt, top - 0.02), (at, top)]
    mid = (at + rt) / 2
    roof = [(at - 0.04, top - 0.03), (mid, top + 0.01), (rt + 0.03, top - 0.05), (rt + 0.01, top + 0.03),
            (mid, top + 0.07), (at - 0.01, top + 0.04)]

    def at_top(y):
        """Height of the glass's top edge over y"""
        return top - 0.02 * (y - at) / max(1e-3, rt - at)

    pillars = [((af - 0.02, belt - 0.02), (at, top))] + [((y, belt - 0.01), (y - 0.04, at_top(y))) for y in b['pillars']]
    pillars.append(((rf, belt - 0.01), (rt, top - 0.02)))
    wheels = [(y, b['wheel']) for y in b['axles']]
    seams = (af + 0.06, b['pillars'][0], min(b['axles'][1] - b['wheel'] - 0.08, b['pillars'][0] + 0.95))
    return b['L'], b['W'], profile, greenhouse, roof, pillars, wheels, b['wheel'], seams


def passenger_car(name, kind):
    """A whole car of BODIES[kind]: glossy paint, the glasshouse with its pillars, a body-coloured bumper over a dark
    lip, lamps set into the rounded nose and tail, door seams and handles, mirrors, plates, wheels. Baked, its PAINTS
    side by side in an atlas (catalogue `variants`): each parked car shows the paint its place picks"""
    spec = BODIES[kind]
    L, W, profile, greenhouse, roof, pillars, wheels, wheel_r, seams = car_shape(spec)
    clear_scene()
    belt, sill, taper = spec['belt'], spec['sill'], 0.72
    lift = sill - 0.3
    paints = [flat_material('car-paint-%d' % k, c, r, m) for k, (c, m, r) in enumerate(PAINTS)]
    body = Part(paints[0])
    paint_part = Part(paints[0], bevel=0.012)
    glass = Part(flat_material('car-glass-tint', (0.06, 0.075, 0.09), 0.04, 0.7), smooth=True)
    trim = Part(flat_material('car-trim', (0.06, 0.06, 0.065), 0.5, 0.3), bevel=0.02)
    fine = Part(trim.material)
    chrome = Part(flat_material('car-chrome', (0.7, 0.71, 0.72), 0.18, 1.0))
    tyre = Part(flat_material('tyre', (0.035, 0.035, 0.035), 0.9), smooth=True)
    rim = Part(flat_material('rim', (0.55, 0.56, 0.58), 0.35, 0.85))
    profile_solid(body, profile, W, taper_from=belt + 0.02, taper=0.9)
    glass_w = W - 0.12
    profile_solid(glass, greenhouse, glass_w, taper_from=belt, taper=taper)
    top = max(z for _, z in greenhouse)

    def half(z):
        """Half width of the glasshouse at height z"""
        f = min(1.0, max(0.0, (z - belt) / max(1e-3, top - belt)))
        return glass_w / 2 * (1 - (1 - taper) * f)

    profile_solid(paint_part, roof, half(top) * 2 + 0.06, None)
    # Pillars in the paint on both sides, standing a little proud of the glass
    for (y0, z0), (y1, z1) in pillars:
        for sx in (-1, 1):
            a = Vector((sx * (half(z0) + 0.012), y0, z0))
            b = Vector((sx * (half(z1) + 0.012), y1, z1 + 0.03))
            oriented_box(paint_part, a, b, 0.09)
    # Bumpers: paint over a dark lip; plates, a chrome strip at the tail
    for sy in (-1, 1):
        y = sy * (L / 2 - 0.02)
        box(paint_part, 0, y, 0.3 + lift, W - 0.06, 0.16, 0.24)
        box(trim, 0, y + sy * 0.03, 0.22 + lift, W - 0.2, 0.12, 0.1)
        box(chrome, 0, sy * (L / 2 + 0.065), 0.42 + lift, 0.52, 0.01, 0.12)
    # Lamps' height at the nose and the tail, a grille slot under the front ones
    lamp_front = spec['nose'] - 0.16
    lamp_tail = spec['tail'] - 0.2
    nose = -L / 2 - 0.02
    tail_y = L / 2 + 0.03
    box(fine, 0, nose + 0.01, lamp_front - 0.1, W * 0.5, 0.06, 0.14)
    box(chrome, 0, tail_y + 0.025, lamp_tail, W * 0.55, 0.01, 0.02)
    # Door seams, handles, a dark sill between the arches, mirrors at the A-pillars
    side = W / 2 + 0.003
    for y in seams:
        for sx in (-1, 1):
            box(fine, sx * side, y, sill + 0.04, 0.01, 0.018, belt - sill - 0.06)
    for y in seams[:-1]:
        for sx in (-1, 1):
            box(chrome, sx * (side + 0.008), y + 0.28, belt - 0.12, 0.02, 0.16, 0.035)
    for sx in (-1, 1):
        box(trim, sx * (W / 2 - 0.01), (wheels[0][0] + wheels[1][0]) / 2, sill - 0.06, 0.05, wheels[1][0] - wheels[0][0] - 2 * (wheel_r + 0.1), 0.1)
        ya = greenhouse[0][0] + 0.18
        oriented_box(fine, Vector((sx * (half(belt) + 0.02), ya, belt + 0.06)), Vector((sx * (W / 2 + 0.12), ya + 0.02, belt + 0.06)), 0.03)
        box(paint_part, sx * (W / 2 + 0.12), ya + 0.03, belt + 0.01, 0.1, 0.07, 0.11)
    for y, z in wheels:
        for sx in (-1, 1):
            wheel(tyre, rim, (sx * (W / 2 - 0.13), y, z), wheel_r)
    body_obj = body.to_object(name)
    cut_arches(body_obj, wheels, wheel_r + 0.07, W)
    round_body(body_obj, 0.1, 4)
    # The arches' faces come from the cutters, without a material: dark like the trim
    for slot in body_obj.material_slots:
        if slot.material is None:
            slot.material = trim.material
    g = glass.to_object(name + '-glass')
    round_body(g, 0.03, 2)
    # Lamps: a slim band each side under the hood's edge, two clusters at the tail
    head = Part(flat_material('headlight', (1.0, 0.96, 0.85), 0.2, emission=(1.0, 0.95, 0.8), strength=0.4))
    tail = Part(flat_material('taillight', (0.6, 0.05, 0.04), 0.3, emission=(0.8, 0.05, 0.03), strength=0.3))
    for sx in (-1, 1):
        box(head, sx * (W / 2 - 0.3), nose + 0.03, lamp_front, 0.42, 0.08, 0.07, rot=sx * 0.12)
        box(tail, sx * (W / 2 - 0.22), tail_y - 0.04, lamp_tail, 0.4, 0.08, 0.09)
    # The glass bakes with the body (dark, glossy in the baked roughness and metal): the far copy keeps it
    objects = [body_obj, g, paint_part.to_object(name + '-paint'), trim.to_object(name + '-trim'), fine.to_object(name + '-fine'),
               chrome.to_object(name + '-chrome'), tyre.to_object(name + '-tyres'), rim.to_object(name + '-rims')]
    keep = [head.to_object(name + '-head'), tail.to_object(name + '-tail')]

    def set_look(obj, k):
        for slot in obj.material_slots:
            if slot.material and slot.material.name.startswith('car-paint-'):
                slot.material = paints[k]

    obj = bake_surface(name, objects, keep=keep, size=1024, samples=16, ao_distance=0.8, variants=(len(PAINTS), set_look))
    export_lod(name, obj, ratio=min(1.0, 520 / len(obj.data.polygons)), textured=True)


def pickup(name, paint, state='whole'):
    def bed(body, glass, trim, fine, panel):
        for sx in (-1, 1):
            box(body, sx * 0.86, 1.5, 1.0, 0.08, 2.1, 0.45)
            # Bed rail cap and stake pockets
            box(fine, sx * 0.86, 1.5, 1.45, 0.12, 2.1, 0.04)
        box(body, 0, 2.53, 1.0, 1.8, 0.08, 0.45)
        box(fine, 0, 2.58, 1.3, 0.5, 0.03, 0.06)
        box(trim, 0, -2.55, 0.7, 1.4, 0.06, 0.3)
    vehicle(name, PICKUP, PICKUP_GLASS, PICKUP_ROOF, 5.2, 1.9, [(-1.6, 0.4), (1.7, 0.4)], 0.4, paint, state, extras=bed, taper=0.9, belt=1.05,
            front_z=0.75, seams=(-1.2, 0.38))


def box_truck(name, paint, state='whole'):
    """Cab-over truck with a ribbed cargo box, rear doors with hinges and bars, side guards and a fuel tank"""
    def cargo(body, glass, trim, fine, panel):
        box(trim, 0, 0.9, 0.55, 2.0, 5.6, 0.3)
        box(body, 0, 1.0, 0.85, 2.45, 5.0, 2.7)
        box(trim, 0, 3.52, 0.85, 2.3, 0.04, 2.5)
        for k in range(5):
            box(trim, 0, -1.2 + k * 1.05, 0.85, 2.5, 0.06, 0.1)
        # Vertical ribs between the rails, a top rail
        for k in range(10):
            y = -1.35 + (k + 0.5) * 4.7 / 10
            for sx in (-1, 1):
                box(panel, sx * 1.24, y, 0.95, 0.04, 0.07, 2.5)
        box(fine, 0, 1.0, 3.485, 2.5, 5.05, 0.06)
        # Rear doors: a seam, hinges, locking bars with handles
        box(fine, 0, 3.55, 0.9, 0.03, 0.02, 2.4)
        for sx in (-1, 1):
            for z in (1.2, 2.2, 3.1):
                box(fine, sx * 1.1, 3.55, z, 0.18, 0.03, 0.1)
            oriented_box(fine, Vector((sx * 0.35, 3.555, 0.95)), Vector((sx * 0.35, 3.555, 3.35)), 0.04)
            box(fine, sx * 0.35, 3.56, 1.9, 0.18, 0.03, 0.05)
            # Side guard between the axles, fuel tank behind the cab
            box(fine, sx * 1.12, 0.0, 0.62, 0.05, 1.8, 0.08)
            box(fine, sx * 1.12, 0.0, 0.42, 0.05, 1.8, 0.06)
        tube(fine, [Vector((-1.0, -1.45, 0.75)), Vector((-1.0, -0.55, 0.75))], [0.24, 0.24], 12, cap=True)
        # Big grille on the cab front, a sun visor over the windscreen
        box(fine, 0, -3.46, 0.95, 1.5, 0.05, 0.55)
        box(fine, 0, -3.38, 2.62, 2.1, 0.25, 0.06)
    vehicle(name, TRUCK_CAB, TRUCK_GLASS, None, 7.2, 2.4, [(-2.6, 0.5), (1.2, 0.5), (2.5, 0.5)], 0.5, paint, state, extras=cargo,
            taper=0.95, belt=1.8, seams=(-2.95, -1.9))


def bus(name, paint, state='whole'):
    """City bus: window band with pillars, a glazed front with a destination board, two folding doors, a rubbing
    strip, a slatted engine grille at the back"""
    def windows(body, glass, trim, fine, panel):
        for sx in (-1, 1):
            box(glass, sx * 1.255, 0.2, 1.65, 0.04, 9.6, 1.0)
            for k in range(8):
                box(body, sx * 1.27, -4.4 + k * 1.25, 1.62, 0.04, 0.12, 1.06)
            box(fine, sx * 1.265, 0.0, 1.0, 0.04, 10.8, 0.1)
        box(glass, 0, -5.62, 1.4, 2.2, 0.04, 1.4)
        box(fine, 0, -5.625, 2.85, 1.6, 0.04, 0.22)
        for y in (-4.6, 0.6):
            for k in (-1, 1):
                box(glass, -1.27, y + k * 0.29, 0.55, 0.04, 0.54, 2.1)
            box(fine, -1.275, y, 0.5, 0.04, 1.25, 0.06)
            box(fine, -1.275, y, 2.64, 0.04, 1.25, 0.06)
            box(fine, -1.275, y, 0.5, 0.04, 0.04, 2.2)
        for k in range(6):
            box(fine, 0, 5.625, 0.75 + k * 0.12, 1.8, 0.03, 0.05)
    vehicle(name, BUS, None, None, 11.2, 2.5, [(-3.6, 0.5), (3.4, 0.5)], 0.5, paint, state, extras=windows, taper=0.97, belt=2.8,
            front_z=0.72)


def tank(name, state='rust'):
    """Battle tank wreck: sloped hull on track units with road wheels, a cast turret knocked askew, a long gun"""
    clear_scene()
    rnd = random.Random(9)
    tint = (0.62, 0.55, 0.47) if state == 'rust' else (0.24, 0.2, 0.18)
    hull = Part(pbr_material('metal-rusty_metal_03-tank-' + state, 'rusty_metal_03', tint), uv_metres=1.6, bevel=0.04)
    tracks = Part(flat_material('tracks', (0.08, 0.075, 0.07), 0.7, 0.6), bevel=0.02)
    wheels_p = Part(flat_material('road-wheels', (0.2, 0.19, 0.17), 0.6, 0.5), smooth=True)
    L, W = 7.0, 3.4
    profile_solid(hull, [(-L / 2, 0.55), (L / 2, 0.55), (L / 2 + 0.2, 1.3), (L / 2 - 0.4, 1.7), (-L / 2 + 1.4, 1.75), (-L / 2 - 0.1, 1.15)], W - 1.0)
    for sx in (-1, 1):
        x = sx * (W / 2 - 0.35)
        box(hull, x, 0, 1.15, 0.7, L - 0.2, 0.18)
        profile_solid(tracks, [(-L / 2 + 0.2, 0.02), (L / 2 - 0.2, 0.02), (L / 2 + 0.25, 0.55), (L / 2 - 0.1, 1.05), (-L / 2 + 0.1, 1.05),
                               (-L / 2 - 0.25, 0.55)], 0.62, x0=x)
        for k in range(6):
            y = -L / 2 + 0.7 + k * (L - 1.4) / 5
            tube(wheels_p, [Vector((x - sx * 0.33, y, 0.45)), Vector((x - sx * 0.38, y, 0.45))], [0.42, 0.42], 14, cap=True)
    turret = Part(pbr_material('metal-rusty_metal_03-tank-' + state, 'rusty_metal_03', tint), uv_metres=1.6, bevel=0.06)
    profile_solid(turret, [(-1.4, 1.75), (1.6, 1.75), (1.8, 2.15), (1.1, 2.55), (-0.9, 2.6), (-1.6, 2.2)], 2.4, taper_from=1.9, taper=0.8)
    tube(turret, [Vector((0, -1.4, 2.15)), Vector((0, -1.8, 2.15)), Vector((0, -5.6, 2.2))], [0.22, 0.13, 0.11], 10, cap=True)
    objects = [hull.to_object(name), tracks.to_object(name + '-tracks'), wheels_p.to_object(name + '-wheels')]
    t = turret.to_object(name + '-turret')
    # Knocked askew: turned and tipped off its ring
    t.data.transform(Matrix.Translation((0.3, 0.2, 0.0)) @ Matrix.Rotation(math.radians(28), 4, 'Z') @ Matrix.Rotation(math.radians(6), 4, 'Y'))
    objects.append(t)
    tilt(objects, x=rnd.uniform(-2, 2), y=3, z=0, lift=-0.1)
    export(name, objects)


def models():
    red, blue, white, green, yellow = (0.55, 0.06, 0.05), (0.08, 0.2, 0.45), (0.86, 0.86, 0.84), (0.15, 0.3, 0.18), (0.8, 0.6, 0.08)
    return {
        'car-small': lambda: passenger_car('car-small', 'small'),
        'car-hatch': lambda: passenger_car('car-hatch', 'hatch'),
        'car-sedan': lambda: passenger_car('car-sedan', 'sedan'),
        'car-estate': lambda: passenger_car('car-estate', 'estate'),
        'car-suv': lambda: passenger_car('car-suv', 'suv'),
        'car-van': lambda: passenger_car('car-van', 'van'),
        'car-wreck': lambda: car('car-wreck', red, 'rust'),
        'car-wreck-b': lambda: car('car-wreck-b', blue, 'rust'),
        'car-burnt': lambda: car('car-burnt', red, 'burnt'),
        'pickup': lambda: pickup('pickup', green),
        'pickup-wreck': lambda: pickup('pickup-wreck', green, 'rust'),
        'truck': lambda: box_truck('truck', white),
        'truck-wreck': lambda: box_truck('truck-wreck', white, 'rust'),
        'bus': lambda: bus('bus', yellow),
        'bus-wreck': lambda: bus('bus-wreck', yellow, 'rust'),
        'bus-burnt': lambda: bus('bus-burnt', yellow, 'burnt'),
        'tank-wreck': lambda: tank('tank-wreck', 'rust'),
        'tank-burnt': lambda: tank('tank-burnt', 'burnt'),
    }
