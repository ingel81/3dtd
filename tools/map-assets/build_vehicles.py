"""Vehicles of the map asset catalogue (loaded by build_models.py).

Car, pickup truck, box truck, bus and a tank, each whole and as a rusted
or burnt-out wreck. Bodies are side profiles extruded across the width,
tapered above the belt line, with wheel arches cut by booleans, rounded
by a bevel and shaded smooth by angle; glass, pillars, bumpers, lights
and wheels are separate parts. Paint is a flat colour; wrecks use Poly
Haven rusty metal.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from blender_kit import Part, box, box_uv, clear_scene, flat_material, oriented_box, pbr_material, tilt, tube
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
        body = pbr_material('metal-rusty_metal_03-wreck', 'rusty_metal_03', (0.46, 0.4, 0.36))
        glass = flat_material('car-hole', (0.03, 0.025, 0.02), 0.95)
    else:
        body = pbr_material('metal-burnt-wreck', 'rusty_metal_03', (0.22, 0.18, 0.17))
        glass = flat_material('car-hole', (0.03, 0.025, 0.02), 0.95)
    return body, glass


def vehicle(name, profile, greenhouse, roof, length, width, wheels, wheel_r, paint, state, extras=None, taper=0.82, belt=0.9):
    """Shared assembly: body with arches, greenhouse glass under a roof, bumpers, lights, wheels, wreck tilt"""
    clear_scene()
    rnd = random.Random(len(name))
    body_mat, glass_mat = materials(state, paint)
    body = Part(body_mat)
    glass = Part(glass_mat, smooth=True)
    trim = Part(flat_material('car-trim', (0.06, 0.06, 0.065), 0.5, 0.3), bevel=0.02)
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
        extras(body, glass, trim)
    for y, z in wheels:
        for sx in (-1, 1):
            wheel(tyre, rim, (sx * (width / 2 - 0.12), y, z), wheel_r, flat=state == 'rust' and sx > 0, rims_only=state == 'burnt')
    objects = []
    body_obj = body.to_object(name)
    cut_arches(body_obj, wheels, wheel_r + 0.08, width)
    round_body(body_obj, 0.05, 2)
    if state != 'whole':
        box_uv(body_obj, 1.5)
    objects.append(body_obj)
    if greenhouse:
        g = glass.to_object(name + '-glass')
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
    objects += [trim.to_object(name + '-trim'), tyre.to_object(name + '-tyres'), rim.to_object(name + '-rims')]
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
    vehicle(name, SEDAN, SEDAN_GLASS, SEDAN_ROOF, 4.4, 1.8, [(-1.35, 0.33), (1.35, 0.33)], 0.33, paint, state)


def pickup(name, paint, state='whole'):
    def bed(body, glass, trim):
        for sx in (-1, 1):
            box(body, sx * 0.86, 1.5, 1.0, 0.08, 2.1, 0.45)
        box(body, 0, 2.53, 1.0, 1.8, 0.08, 0.45)
        box(trim, 0, -2.55, 0.7, 1.4, 0.06, 0.3)
    vehicle(name, PICKUP, PICKUP_GLASS, PICKUP_ROOF, 5.2, 1.9, [(-1.6, 0.4), (1.7, 0.4)], 0.4, paint, state, extras=bed, taper=0.9, belt=1.05)


def box_truck(name, paint, state='whole'):
    """Cab-over truck with a cargo box"""
    def cargo(body, glass, trim):
        box(trim, 0, 0.9, 0.55, 2.0, 5.6, 0.3)
        cargo_mat = body if state != 'whole' else trim
        box(body, 0, 1.0, 0.85, 2.45, 5.0, 2.7)
        box(trim, 0, 3.52, 0.85, 2.3, 0.04, 2.5)
        for k in range(5):
            box(trim, 0, -1.2 + k * 1.05, 0.85, 2.5, 0.06, 0.1)
    vehicle(name, TRUCK_CAB, TRUCK_GLASS, None, 7.2, 2.4, [(-2.6, 0.5), (1.2, 0.5), (2.5, 0.5)], 0.5, paint, state, extras=cargo,
            taper=0.95, belt=1.8)


def bus(name, paint, state='whole'):
    def windows(body, glass, trim):
        for sx in (-1, 1):
            box(glass, sx * 1.255, 0.2, 1.65, 0.04, 9.6, 1.0)
            for k in range(8):
                box(body, sx * 1.27, -4.4 + k * 1.25, 1.62, 0.04, 0.12, 1.06)
        box(glass, 0, -5.62, 1.4, 2.2, 0.04, 1.4)
        box(trim, -1.27, -3.8, 0.5, 0.05, 1.1, 2.2)
    vehicle(name, BUS, None, None, 11.2, 2.5, [(-3.6, 0.5), (3.4, 0.5)], 0.5, paint, state, extras=windows, taper=0.97, belt=2.8)


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
        'car-red': lambda: car('car-red', red),
        'car-blue': lambda: car('car-blue', blue),
        'car-white': lambda: car('car-white', white),
        'car-grey': lambda: car('car-grey', (0.4, 0.41, 0.43)),
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
