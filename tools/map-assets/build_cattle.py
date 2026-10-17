"""Cattle of the map asset catalogue (loaded by build_models.py): a cow in
three poses (standing, grazing, lying), each in four coats.

The body grows from a skeleton of points with radii (Blender's skin
modifier, then subdivided and thinned out): barrel, hips and shoulders, a dewlap under the
neck, jointed legs with knees and hocks, an udder; ears, horns, hooves and
the tail are parts of their own. The coats are procedural and baked into one
2 x 2 atlas (blender_kit.bake_surface with variants): Holstein (black on
white), Fleckvieh (red-gold on white, white head), Braunvieh (grey-brown with
a pale muzzle ring) and Angus (black, sun-bleached). Each cow in a herd shows
the coat its place picks (catalogue `variants`, objects/atlas-variants.ts),
so one model and one draw call make a mixed herd.

Model space: facing -Y, feet on z = 0.
"""
import math

import bpy
from mathutils import Vector

from blender_kit import Nodes, Part, bake_surface, clear_scene, export_lod, tube


def skeleton(pose):
    """Points (position, radius across, radius up) and the edges between them, plus named landmarks
    (poll, muzzle, eyes, udder, hooves, ears, horns, tail) for the coats and the extra parts"""
    pts, edges, marks = [], [], {}

    def add(name, p, r, link=None):
        pts.append((Vector(p), r))
        k = len(pts) - 1
        marks[name] = k
        if link is not None:
            edges.append((marks[link], k))
        return k

    lie = pose == 'lie'
    dz = -0.48 if lie else 0.0
    add('rump', (0, 0.8, 1.1 + dz), (0.27, 0.28))
    add('hip', (0, 0.5, 1.05 + dz), (0.4, 0.41), 'rump')
    add('belly', (0, 0.05, 0.99 + dz), (0.44, 0.47), 'hip')
    add('chest', (0, -0.4, 1.03 + dz), (0.38, 0.45), 'belly')
    # Withers and hook bones: the straight, slightly angular topline of a cow
    add('withers', (0, -0.42, 1.33 + dz), (0.13, 0.12), 'chest')
    for s, side in ((1, 'l'), (-1, 'r')):
        add('hook' + side, (s * 0.25, 0.52, 1.27 + dz), (0.1, 0.09), 'hip')

    add('brisket', (0, -0.66, 1.0 + dz), (0.27, 0.37), 'chest')
    if pose == 'graze':
        head = [((0, -0.93, 0.93), (0.18, 0.23)), ((0, -1.1, 0.64), (0.14, 0.15)), ((0, -1.17, 0.4), (0.13, 0.12)), ((0.02, -1.25, 0.15), (0.125, 0.1))]
    elif lie:
        head = [((0, -0.84, 0.74), (0.24, 0.3)), ((0.02, -0.98, 0.96), (0.15, 0.16)), ((0.06, -1.19, 0.86), (0.13, 0.12)), ((0.12, -1.33, 0.7), (0.125, 0.1))]
    else:
        head = [((0, -0.88, 1.13), (0.2, 0.27)), ((0, -1.08, 1.32), (0.14, 0.15)), ((0, -1.26, 1.14), (0.13, 0.12)), ((0, -1.42, 0.95), (0.125, 0.1))]
    add('neck', *head[0], 'brisket')
    add('poll', *head[1], 'neck')
    add('face', *head[2], 'poll')
    add('muzzle', *head[3], 'face')
    for s, side in ((1, 'l'), (-1, 'r')):
        if lie:
            # Front legs folded under the chest, hoof tucked back; hind legs one along the flank, one out
            add('fl0' + side, (s * 0.21, -0.5, 0.36), (0.12, 0.12), 'chest')
            add('fl1' + side, (s * 0.23, -0.78, 0.12), (0.08, 0.08), 'fl0' + side)
            add('fl2' + side, (s * 0.2, -0.58, 0.07), (0.06, 0.06), 'fl1' + side)
            out = 1.0 if s > 0 else 0.6
            add('hl0' + side, (s * 0.32, 0.5, 0.38), (0.17, 0.17), 'hip')
            add('hl1' + side, (s * (0.32 + 0.14 * out), 0.32, 0.12), (0.1, 0.1), 'hl0' + side)
            add('hl2' + side, (s * (0.3 + 0.12 * out), 0.0, 0.08), (0.06, 0.06), 'hl1' + side)
            continue
        fy = -0.6 if pose == 'graze' else -0.52
        fx = 0.22 if pose == 'graze' else 0.2
        add('fl0' + side, (s * 0.21, -0.5, 0.8), (0.12, 0.13), 'chest')
        add('fl1' + side, (s * fx, -0.52, 0.6), (0.105, 0.11), 'fl0' + side)
        add('fl2' + side, (s * fx, fy + 0.02, 0.36), (0.068, 0.072), 'fl1' + side)
        add('fl3' + side, (s * fx, fy, 0.1), (0.055, 0.055), 'fl2' + side)
        add('hl0' + side, (s * 0.23, 0.55, 0.86), (0.17, 0.18), 'hip')
        add('hl1' + side, (s * 0.22, 0.45, 0.66), (0.13, 0.14), 'hl0' + side)
        add('hl2' + side, (s * 0.2, 0.7, 0.42), (0.07, 0.075), 'hl1' + side)
        add('hl3' + side, (s * 0.19, 0.62, 0.1), (0.055, 0.055), 'hl2' + side)
    return pts, edges, marks


def skinned(name, pts, edges):
    """A smooth body round the skeleton: skin modifier, two subdivisions thinned out, smooth shading"""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([p for p, _ in pts], edges, [])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    skin = obj.modifiers.new('skin', 'SKIN')
    skin.use_smooth_shade = True
    skin.branch_smoothing = 0.6
    for i, (_, r) in enumerate(pts):
        mesh.skin_vertices[0].data[i].radius = r
    mesh.skin_vertices[0].data[0].use_root = True
    sub = obj.modifiers.new('sub', 'SUBSURF')
    sub.levels = 2
    sub.render_levels = 2
    # Two subdivisions round the boxy skin, then the flat parts thinned out again: smooth outline, few triangles
    dec = obj.modifiers.new('thin', 'DECIMATE')
    dec.ratio = 0.35
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.data.uv_layers.new(name='UVMap')
    return obj


def ellipsoid(part, centre, radii, axis_from=None, segments=10, rings=6):
    """A squashed sphere (ears, udder), its long axis along `axis_from` when given"""
    bm = part.bm
    rot = Vector((0, 0, 1)).rotation_difference(axis_from.normalized()).to_matrix() if axis_from else None
    grid = []
    for i in range(rings + 1):
        th = math.pi * i / rings
        row = []
        for j in range(segments):
            ph = math.tau * j / segments
            v = Vector((math.sin(th) * math.cos(ph) * radii[0], math.sin(th) * math.sin(ph) * radii[1], math.cos(th) * radii[2]))
            row.append(bm.verts.new(centre + (rot @ v if rot else v)))
        grid.append(row)
    for i in range(rings):
        for j in range(segments):
            f = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][(j + 1) % segments], grid[i][(j + 1) % segments]))
            f.smooth = True
            for loop, uv in zip(f.loops, [(j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i)]):
                loop[part.uv].uv = (uv[0] / segments, uv[1] / rings)
    import bmesh
    bmesh.ops.remove_doubles(bm, verts=[v for row in grid for v in row], dist=1e-5)


def coat(name, look, marks):
    """One breed's coat over the whole cow: patches, head and leg markings, muzzle, eyes, the udder, mud on the
    legs, and hair: a fine grain along the body"""
    n = Nodes(name)
    z = n.axis(2)
    muzzle, face, poll, udder = marks['muzzle'], marks['face'], marks['poll'], marks['udder']
    hair = n.noise(45.0, 3, stretch=(1, 0.22, 1))
    flank_light = n.ramp(z, 0.4, 1.3)
    if look == 'holstein':
        white, dark = (0.66, 0.64, 0.6), (0.018, 0.017, 0.017)
        patch = n.ramp(n.math('ADD', n.noise(1.25, 1.5), n.math('MULTIPLY', n.math('SUBTRACT', n.noise(7.0, 3), 0.5), 0.12)), 0.475, 0.49)
        black = n.math('MULTIPLY', patch, n.ramp(z, 0.3, 0.45))
        black = n.math('MAXIMUM', black, n.math('MULTIPLY', n.near(poll, 0.12, 0.2), n.math('SUBTRACT', 1.0, n.near(face + Vector((0, -0.04, 0.02)), 0.05, 0.09))))
        colour = n.mix(black, white, dark)
        nose = (0.5, 0.33, 0.3)
    elif look == 'fleckvieh':
        white, red = (0.67, 0.63, 0.56), (0.42, 0.17, 0.055)
        patch = n.ramp(n.math('ADD', n.noise(1.0, 1.5), n.math('MULTIPLY', n.math('SUBTRACT', n.noise(6.0, 3), 0.5), 0.14)), 0.42, 0.44)
        red_mask = n.math('MULTIPLY', patch, n.ramp(z, 0.35, 0.6))
        # The white head, a red patch round each eye
        head = n.near(face, 0.22, 0.3)
        red_mask = n.math('MULTIPLY', red_mask, n.math('SUBTRACT', 1.0, head))
        for s in (-1, 1):
            red_mask = n.math('MAXIMUM', red_mask, n.near(marks['eye'] * Vector((s, 1, 1)), 0.03, 0.06))
        colour = n.mix(red_mask, white, n.mix(n.noise(2.0, 2), red, (0.55, 0.26, 0.09)))
        nose = (0.6, 0.45, 0.38)
    elif look == 'braunvieh':
        base, darker, pale = (0.17, 0.12, 0.085), (0.07, 0.055, 0.045), (0.6, 0.54, 0.44)
        colour = n.mix(n.ramp(z, 1.2, 0.5), base, n.mix(0.5, base, darker))
        colour = n.mix(n.math('MULTIPLY', n.near(poll, 0.1, 0.25), 0.6), colour, darker)
        ring = n.math('SUBTRACT', n.near(muzzle, 0.13, 0.17), n.near(muzzle, 0.085, 0.11), clamp=True)
        colour = n.mix(ring, colour, pale)
        # A paler line along the back, darker legs
        colour = n.mix(n.math('MULTIPLY', n.ramp(n.math('ABSOLUTE', n.axis(0)), 0.08, 0.0), n.ramp(z, 1.2, 1.45)), colour, pale)
        nose = (0.05, 0.045, 0.045)
    else:
        black, bleach = (0.022, 0.02, 0.019), (0.12, 0.075, 0.05)
        colour = n.mix(n.math('MULTIPLY', flank_light, n.ramp(n.noise(1.5, 2), 0.4, 0.7)), black, bleach)
        nose = (0.03, 0.028, 0.028)
    colour = n.mix(n.math('MULTIPLY', n.math('SUBTRACT', hair, 0.5), 0.5), colour, (0.5, 0.5, 0.5), 'LINEAR_LIGHT')
    colour = n.mix(n.near(muzzle + Vector((0, -0.06, -0.01)), 0.075, 0.1), colour, nose)
    for s in (-1, 1):
        colour = n.mix(n.near(marks['eye'] * Vector((s, 1, 1)), 0.022, 0.03), colour, (0.01, 0.008, 0.008))
    colour = n.mix(n.near(udder, 0.1, 0.16), colour, (0.55, 0.38, 0.34) if look != 'angus' else (0.06, 0.05, 0.05))
    # Mud and grass up the legs (and under a lying cow's belly), dust on the back
    mud = n.math('MULTIPLY', n.ramp(z, 0.4, 0.08), n.ramp(n.noise(4.0, 4), 0.35, 0.65))
    colour = n.mix(n.math('MULTIPLY', mud, 0.8), colour, (0.11, 0.08, 0.045))
    colour = n.mix(n.math('MULTIPLY', n.hollows(0.15), 0.5), colour, (0.02, 0.015, 0.01))
    rough = n.mixf(mud, 0.68, 0.9)
    return n.finish(colour, rough, n.bump(hair, 0.18, 0.004))


LOOKS = ('holstein', 'fleckvieh', 'braunvieh', 'angus')


def cow(name, pose):
    """A cow in `pose` (stand, graze, lie) with four coats in its atlas, a textured LOD"""
    clear_scene()
    pts, edges, ids = skeleton(pose)
    body = skinned(name + '-body', pts, edges)
    at = {k: pts[i][0] for k, i in ids.items()}
    poll, face, muzzle, neck = at['poll'], at['face'], at['muzzle'], at['neck']
    ahead = (muzzle - poll).normalized()
    side = Vector((0, 0, 1)).cross(ahead).normalized()
    up = ahead.cross(side).normalized()
    eye = face.lerp(poll, 0.45) + side * 0.115 + up * 0.03
    if eye.x < 0:
        eye.x = -eye.x
    udder = Vector((0, 0.38, 0.62 if pose != 'lie' else 0.12))
    marks = {'muzzle': muzzle, 'face': face, 'poll': poll, 'eye': eye, 'udder': udder}
    coats = [coat('cow-coat-' + look, look, marks) for look in LOOKS]
    body.data.materials.append(coats[0])
    extra = Part(coats[0], smooth=True)
    # Ears out sideways under the horns, a little down; the udder with four teats
    for s in (-1, 1):
        base = poll + side * s * 0.13 - ahead * 0.03
        ellipsoid(extra, base + side * s * 0.08 + up * -0.03, (0.022, 0.06, 0.12), side * s + up * -0.3)
    if pose != 'lie':
        ellipsoid(extra, udder, (0.13, 0.15, 0.11))
        for sx in (-0.05, 0.05):
            for sy in (-0.05, 0.05):
                t0 = udder + Vector((sx, sy, -0.09))
                tube(extra, [t0, t0 + Vector((0, 0, -0.06))], [0.016, 0.012], 5, cap=True)
    # Tail from the pin bones down to its switch
    rump = at['rump'] + Vector((0, 0.03, 0.06))
    if pose == 'lie':
        tail = [rump, rump + Vector((0.12, 0.12, -0.25)), rump + Vector((0.3, 0.05, -0.5))]
    else:
        tail = [rump, rump + Vector((0, 0.1, -0.15)), rump + Vector((0, 0.13, -0.5)), rump + Vector((0, 0.12, -0.78))]
    tube(extra, tail, [0.035, 0.028, 0.022, 0.02][:len(tail)], 6, cap=True)
    tube(extra, [tail[-1], tail[-1] + Vector((0, 0.02, -0.16))], [0.05, 0.02], 6, cap=True)
    extra_obj = extra.to_object(name + '-extra')
    # Horns: short, forward and up, pale with dark tips; hooves split dark
    horn = Part(horn_material(), smooth=True)
    for s in (-1, 1):
        base = poll + side * s * 0.1 + up * 0.06
        tube(horn, [base, base + side * s * 0.09 + up * 0.03 - ahead * 0.01, base + side * s * 0.13 + up * 0.1 + ahead * 0.05],
             [0.03, 0.022, 0.006], 6, cap=True)
    hoof = Part(hoof_material(), smooth=True)
    for leg in ('fl', 'hl'):
        for side_name in ('l', 'r'):
            last = max(k for k in ids if k.startswith(leg) and k.endswith(side_name))
            foot = at[last]
            if pose == 'lie':
                d = (foot - at[last[:-2] + str(int(last[-2]) - 1) + side_name]).normalized()
                tube(hoof, [foot, foot + d * 0.1], [0.06, 0.055], 8, cap=True)
            else:
                tube(hoof, [Vector((foot.x, foot.y, 0.13)), Vector((foot.x, foot.y - 0.02, 0.0))], [0.058, 0.066], 8, cap=True)
    objects = [body, extra_obj, horn.to_object(name + '-horns'), hoof.to_object(name + '-hooves')]

    def set_look(obj, k):
        for slot in obj.material_slots:
            if slot.material and slot.material.name.startswith('cow-coat-'):
                slot.material = coats[k]

    obj = bake_surface(name, objects, size=1024, samples=24, ao_distance=0.6, variants=(len(LOOKS), set_look))
    export_lod(name, obj, ratio=min(1.0, 220 / len(obj.data.polygons)), textured=True)


def horn_material():
    n = Nodes('cow-horn')
    tip = n.ramp(n.uv(1), 0.06, 0.12)
    return n.finish(n.mix(tip, (0.62, 0.55, 0.42), (0.08, 0.06, 0.05)), 0.45)


def hoof_material():
    n = Nodes('cow-hoof')
    return n.finish(n.mix(n.noise(30.0, 3, stretch=(1, 1, 0.2)), (0.04, 0.035, 0.03), (0.12, 0.1, 0.08)), 0.6)


def models():
    return {
        'cow': lambda: cow('cow', 'stand'),
        'cow-grazing': lambda: cow('cow-grazing', 'graze'),
        'cow-lying': lambda: cow('cow-lying', 'lie'),
    }
