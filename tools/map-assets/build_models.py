"""Builds the object models of the custom map asset catalogue in Blender.

    blender --background --factory-startup --python tools/map-assets/build_models.py -- <sources> <foliage> <out>

<sources>: download dir of fetch_model_sources.py (Poly Haven textures and
models, CC0); <foliage>: cards of make_foliage.py; <out>: one GLB per model,
pivot at the base centre, metres, front towards -Y in Blender (+Z in glTF).

Trees, plants and buildings are built procedurally here from those
textures: trunks and branches as tapered tubes, crowns as foliage cards
with normals bent outwards from the crown centre (soft, round lighting),
houses from boxes with box-mapped UVs. Rocks, fern and barrel are Poly
Haven models, decimated to game budgets. Deterministic for the seeds below.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SOURCES, FOLIAGE, OUT = argv[0], argv[1], argv[2]
os.makedirs(OUT, exist_ok=True)


# ---------------------------------------------------------------- scene, materials

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for item in list(block):
            block.remove(item)
    _materials.clear()


def tex_path(asset, kind):
    folder = os.path.join(SOURCES, 'textures', asset)
    suffix = {'diff': '_diff_1k.jpg', 'nor': '_nor_gl_1k.jpg', 'arm': '_arm_1k.jpg'}[kind]
    return os.path.join(folder, asset + suffix)


def load_image(path, non_color=False):
    img = bpy.data.images.load(path, check_existing=True)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    return img


_materials = {}


def pbr_material(name, asset, tint=None, roughness_scale=1.0):
    """Principled material from a Poly Haven texture set (diff, nor_gl, arm)"""
    key = (name, asset)
    if key in _materials:
        return _materials[key]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    diff = nt.nodes.new('ShaderNodeTexImage')
    diff.image = load_image(tex_path(asset, 'diff'))
    if tint:
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        nt.links.new(diff.outputs['Color'], mix.inputs['A'])
        mix.inputs['B'].default_value = (*tint, 1.0)
        nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    else:
        nt.links.new(diff.outputs['Color'], bsdf.inputs['Base Color'])
    nor = nt.nodes.new('ShaderNodeTexImage')
    nor.image = load_image(tex_path(asset, 'nor'), non_color=True)
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nor.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    arm = nt.nodes.new('ShaderNodeTexImage')
    arm.image = load_image(tex_path(asset, 'arm'), non_color=True)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(arm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    _materials[key] = m
    return m


def card_material(name, png):
    """Alpha-tested foliage (the loader switches `foliage-*` materials to alpha test, double sided)"""
    m = bpy.data.materials.new('foliage-' + name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = load_image(os.path.join(FOLIAGE, png))
    nt.links.new(img.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(img.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.8
    try:
        m.blend_method = 'CLIP'
    except (AttributeError, TypeError):
        pass
    m.use_backface_culling = False
    return m


def flat_material(name, color, roughness=0.8, metallic=0.0, emission=None):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = 2.0
    return m


# ---------------------------------------------------------------- mesh building

class Part:
    """Collects faces of one material; becomes one mesh object"""

    def __init__(self, material, uv_metres=None):
        self.material = material
        self.uv_metres = uv_metres
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.normals = []  # per loop, only for cards

    def quad(self, corners, uvs, normal_fn=None):
        verts = [self.bm.verts.new(c) for c in corners]
        f = self.bm.faces.new(verts)
        for loop, uv in zip(f.loops, uvs):
            loop[self.uv].uv = uv
        if normal_fn:
            for loop in f.loops:
                self.normals.append(normal_fn(loop.vert.co))
        return f

    def add_bmesh(self, other, matrix=Matrix()):
        """Appends geometry built in another bmesh (with its own UV layer)"""
        tmp = bpy.data.meshes.new('tmp')
        other.to_mesh(tmp)
        tmp.transform(matrix)
        self.bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)

    def to_object(self, name):
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(self.material)
        if self.uv_metres:
            box_uv(obj, self.uv_metres)
        if self.normals:
            mesh.normals_split_custom_set(self.normals)
        else:
            for p in mesh.polygons:
                p.use_smooth = False
        return obj


def box_uv(obj, metres):
    """World-scale box mapping: each face projects along its dominant axis"""
    mesh = obj.data
    uv = mesh.uv_layers.active or mesh.uv_layers.new()
    for poly in mesh.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            if ax == 2:
                u, v = co.x, co.y
            elif ax == 0:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            else:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            uv.data[li].uv = (u / metres, v / metres)


def tube(part, points, radii, sides, smooth=True, cap=False):
    """Tapered tube along points (bark: u around, v along in metres)"""
    bm = part.bm
    rings = []
    total = 0.0
    lengths = [0.0]
    for a, b in zip(points, points[1:]):
        total += (b - a).length
        lengths.append(total)
    for k, p in enumerate(points):
        d = (points[min(k + 1, len(points) - 1)] - points[max(k - 1, 0)]).normalized()
        side = d.orthogonal().normalized()
        up = d.cross(side).normalized()
        ring = []
        for s in range(sides + 1):
            a = s / sides * math.tau
            ring.append(bm.verts.new(p + (side * math.cos(a) + up * math.sin(a)) * radii[k]))
        rings.append(ring)
    circumference = math.tau * max(radii[0], 0.05)
    faces = []
    for k in range(len(points) - 1):
        for s in range(sides):
            f = bm.faces.new((rings[k][s], rings[k][s + 1], rings[k + 1][s + 1], rings[k + 1][s]))
            f.smooth = smooth
            u0 = s / sides * max(1.0, round(circumference / 1.2))
            u1 = (s + 1) / sides * max(1.0, round(circumference / 1.2))
            v0 = lengths[k] / 1.5
            v1 = lengths[k + 1] / 1.5
            for loop, uv in zip(f.loops, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
                loop[part.uv].uv = uv
            faces.append(f)
    if cap:
        f = bm.faces.new(list(reversed(rings[-1][:-1])))
        for loop in f.loops:
            loop[part.uv].uv = (0.5 + (loop.vert.co - points[-1]).x, 0.5 + (loop.vert.co - points[-1]).y)
    return faces


def box(part, cx, cy, z0, sx, sy, sz, rot=0.0):
    """Axis box (rotated around Z), bottom at z0"""
    bm = part.bm
    r = Matrix.Rotation(rot, 4, 'Z')
    corners = []
    for z in (z0, z0 + sz):
        for x, y in ((-sx / 2, -sy / 2), (sx / 2, -sy / 2), (sx / 2, sy / 2), (-sx / 2, sy / 2)):
            corners.append(bm.verts.new(r @ Vector((x, y, 0)) + Vector((cx, cy, z))))
    b = corners[:4]
    t = corners[4:]
    faces = [bm.faces.new(list(reversed(b))), bm.faces.new(t)]
    for i in range(4):
        faces.append(bm.faces.new((b[i], b[(i + 1) % 4], t[(i + 1) % 4], t[i])))
    return faces


def oriented_box(part, a, b, thickness):
    """Beam from point a to b with a square cross section"""
    d = b - a
    length = d.length
    m = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    m.translation = a
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    bmesh.ops.scale(tmp, vec=Vector((thickness, thickness, length)), verts=tmp.verts)
    bmesh.ops.translate(tmp, vec=Vector((0, 0, length / 2)), verts=tmp.verts)
    bmesh.ops.transform(tmp, matrix=m, verts=tmp.verts)
    part.add_bmesh(tmp)
    tmp.free()


def export(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, name + '.glb'),
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=True,
        export_materials='EXPORT',
        export_yup=True,
        export_animations=False,
    )
    print('exported', name, sum(len(o.data.polygons) for o in objects if o.type == 'MESH'), 'faces')


# ---------------------------------------------------------------- trees and plants

def card(part, base, direction, normal_hint, width, length, center):
    """A foliage card: stem at `base`, tip along `direction`, facing roughly `normal_hint`"""
    d = direction.normalized()
    side = d.cross(normal_hint).normalized() * (width / 2)
    tip = base + d * length

    def bent(co):
        out = (co - center)
        out = out.normalized() if out.length > 1e-4 else Vector((0, 0, 1))
        return (out * 0.75 + normal_hint.normalized() * 0.25).normalized()

    part.quad([base - side, base + side, tip + side, tip - side], [(0, 0), (1, 0), (1, 1), (0, 1)], bent)


def broadleaf(name, seed, height, crown_r, trunk_r, bark, leaves, bark_tint=None, slender=False):
    clear_scene()
    rnd = random.Random(seed)
    wood = Part(pbr_material('bark-' + bark, bark, bark_tint))
    foliage = Part(card_material(leaves, leaves + '.png'))
    trunk_top = height * (0.62 if not slender else 0.8)
    pts = [Vector((0, 0, 0))]
    for k in range(1, 7):
        t = k / 6
        pts.append(Vector((rnd.uniform(-0.25, 0.25) * t, rnd.uniform(-0.25, 0.25) * t, trunk_top * t)))
    tube(wood, pts, [trunk_r * (1.25 if k == 0 else 1 - 0.65 * k / 6) for k in range(7)], 8)
    crown_c = Vector((0, 0, height - crown_r * (0.95 if not slender else 1.1)))
    branches = 7 if not slender else 6
    for b in range(branches):
        t = 0.45 + 0.5 * b / branches
        start = pts[int(t * 6)]
        ang = b * 2.39996 + rnd.uniform(-0.3, 0.3)
        out = Vector((math.cos(ang), math.sin(ang), rnd.uniform(0.6, 1.3) if not slender else 1.8)).normalized()
        length = crown_r * rnd.uniform(0.75, 1.05)
        mid = start + out * length * 0.5 + Vector((0, 0, length * 0.15))
        end = start + out * length + Vector((0, 0, length * 0.25))
        tube(wood, [start, mid, end], [trunk_r * 0.45, trunk_r * 0.28, trunk_r * 0.1], 5)
        # Cards around the branch end and along its outer half
        for c in range(11 if not slender else 9):
            p = mid.lerp(end, rnd.uniform(0.0, 1.0)) + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.6, 0.8))) * crown_r * 0.25
            outward = (p - crown_c)
            outward = outward.normalized() if outward.length > 0.1 else Vector((0, 0, 1))
            d = (outward + Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(0.0, 0.8)))).normalized()
            hint = d.orthogonal().normalized()
            hint = (hint + outward * 0.5).normalized()
            size = crown_r * rnd.uniform(0.5, 0.7) * (0.85 if slender else 1.0)
            card(foliage, p - d * size * 0.25, d, hint, size, size, crown_c)
    # Inner cards fill the crown's middle
    for c in range(16 if not slender else 10):
        p = crown_c + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.5, 0.7))) * crown_r * 0.55
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0.2, 1))).normalized()
        size = crown_r * 0.65
        card(foliage, p - d * size * 0.4, d, d.orthogonal(), size, size, crown_c)
    export(name, [wood.to_object(name + '-wood'), foliage.to_object(name + '-leaves')])


def conifer(name, seed, height, radius, bare, trunk_r):
    """Trunk with whorls of branch cards; `bare` = fraction of the trunk without branches"""
    clear_scene()
    rnd = random.Random(seed)
    wood = Part(pbr_material('bark-knotted_pine_bark', 'knotted_pine_bark'))
    foliage = Part(card_material('conifer', 'leaves-conifer.png'))
    tube(wood, [Vector((0, 0, 0)), Vector((0, 0, height * 0.5)), Vector((0, 0, height * 0.9))],
         [trunk_r, trunk_r * 0.6, trunk_r * 0.1], 7)
    h0 = height * bare
    z = h0
    whorl = 0
    while z < height - 0.4:
        t = (z - h0) / (height - h0)
        reach = radius * (1 - t) ** 0.9 + 0.35
        n = 7 if reach > 1.2 else 5
        for k in range(n):
            ang = (k / n + whorl * 0.37) * math.tau + rnd.uniform(-0.2, 0.2)
            out = Vector((math.cos(ang), math.sin(ang), 0))
            droop = rnd.uniform(-0.45, -0.15) if t < 0.8 else rnd.uniform(0.3, 0.7)
            d = (out + Vector((0, 0, droop))).normalized()
            base = Vector((0, 0, z))
            center = Vector((0, 0, z + reach * 0.3))
            # Two cards per branch, crossed along it
            hint_a = Vector((0, 0, 1)).cross(out).cross(d).normalized()
            if hint_a.z < 0:
                hint_a = -hint_a
            card(foliage, base, d, hint_a, reach * 1.05, reach * 1.1, center)
            hint_b = (hint_a + out.cross(d) * 1.5).normalized()
            card(foliage, base + Vector((0, 0, 0.1)), d, hint_b, reach * 0.7, reach, center)
        whorl += 1
        z += rnd.uniform(0.6, 0.85) * (1.0 if height > 10 else 0.7)
    # Tip: three narrow cards leaning out from the top of the trunk
    for k in range(3):
        ang = k / 3 * math.tau
        d = Vector((math.cos(ang) * 0.12, math.sin(ang) * 0.12, 1)).normalized()
        card(foliage, Vector((0, 0, height - 1.8)), d, Vector((-math.sin(ang), math.cos(ang), 0)), 0.5, 1.6, Vector((0, 0, height - 2.5)))
    export(name, [wood.to_object(name + '-wood'), foliage.to_object(name + '-leaves')])


def dead_tree(name, seed):
    clear_scene()
    rnd = random.Random(seed)
    wood = Part(pbr_material('bark-dead', 'bark_brown_02', (0.62, 0.6, 0.58)))
    pts = [Vector((0, 0, 0)), Vector((0.1, 0, 3)), Vector((0.3, 0.2, 6)), Vector((0.2, 0.4, 8.5))]
    tube(wood, pts, [0.32, 0.24, 0.15, 0.05], 7)

    def branch(start, d, length, r, depth):
        end = start + d * length
        mid = start.lerp(end, 0.5) + Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(-0.2, 0.3)))
        tube(wood, [start, mid, end], [r, r * 0.6, r * 0.15], 4 if depth else 5)
        if depth < 2:
            for _ in range(2):
                nd = (d + Vector((rnd.uniform(-0.8, 0.8), rnd.uniform(-0.8, 0.8), rnd.uniform(0.0, 0.7)))).normalized()
                branch(mid.lerp(end, rnd.uniform(0.2, 0.8)), nd, length * 0.55, r * 0.5, depth + 1)

    for k in range(5):
        ang = k * 2.4 + rnd.uniform(-0.3, 0.3)
        z = rnd.uniform(3.2, 7.0)
        d = Vector((math.cos(ang), math.sin(ang), rnd.uniform(0.3, 1.0))).normalized()
        branch(Vector((0.15, 0.2, z)), d, rnd.uniform(1.8, 3.0), 0.1, 0)
    export(name, [wood.to_object(name + '-wood')])


def bush(name, seed, radius, height):
    clear_scene()
    rnd = random.Random(seed)
    foliage = Part(card_material('bush', 'leaves-bush.png'))
    center = Vector((0, 0, height * 0.35))
    for k in range(16):
        ang = rnd.uniform(0, math.tau)
        out = Vector((math.cos(ang), math.sin(ang), rnd.uniform(0.2, 1.4))).normalized()
        base = Vector((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), 0.0))
        size = radius * rnd.uniform(1.1, 1.4)
        hint = (out.orthogonal().normalized() + out * 0.4).normalized()
        card(foliage, base, out, hint, size * 1.1, height * rnd.uniform(0.9, 1.15) / max(out.z, 0.4), center)
    export(name, [foliage.to_object(name + '-leaves')])


def grass(name, png, width, height, seed):
    clear_scene()
    rnd = random.Random(seed)
    foliage = Part(card_material(name, png))
    # Cards fanned out from the centre and leaning outwards, so the clump has area seen from above
    for k in range(5):
        ang = k / 5 * math.tau + rnd.uniform(-0.3, 0.3)
        out = Vector((math.cos(ang), math.sin(ang), 0))
        side = Vector((-out.y, out.x, 0)) * width / 2
        base = out * width * 0.08
        up = Vector((0, 0, height)) + out * height * rnd.uniform(0.35, 0.6)
        # Normals straight up: clumps light exactly like the ground they stand on
        nrm = lambda co: Vector((0, 0, 1))
        foliage.quad([base - side, base + side, base + side + up, base - side + up], [(0, 0), (1, 0), (1, 1), (0, 1)], nrm)
    export(name, [foliage.to_object(name)])


def stump(name):
    clear_scene()
    wood = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02'))
    top = Part(pbr_material('wood-rough', 'rough_wood', (1.1, 1.0, 0.85)))
    pts = [Vector((0, 0, 0)), Vector((0, 0, 0.3)), Vector((0, 0, 0.55))]
    tube(wood, pts, [0.42, 0.34, 0.32], 9)
    bm = top.bm
    ring = [bm.verts.new((math.cos(a / 9 * math.tau) * 0.32, math.sin(a / 9 * math.tau) * 0.32, 0.55)) for a in range(9)]
    f = bm.faces.new(ring)
    for loop in f.loops:
        loop[top.uv].uv = (loop.vert.co.x + 0.5, loop.vert.co.y + 0.5)
    export(name, [wood.to_object(name + '-bark'), top.to_object(name + '-top')])


def log(name):
    clear_scene()
    wood = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02'))
    tube(wood, [Vector((-1.6, 0, 0.28)), Vector((0, 0.05, 0.3)), Vector((1.6, 0, 0.26))], [0.3, 0.29, 0.26], 9, cap=True)
    export(name, [wood.to_object(name)])


# ---------------------------------------------------------------- imported models

def import_model(asset, target_height, target_faces, name, desaturate=0.0):
    clear_scene()
    folder = os.path.join(SOURCES, 'models', asset)
    gltf = next(f for f in os.listdir(folder) if f.endswith('.gltf'))
    bpy.ops.import_scene.gltf(filepath=os.path.join(folder, gltf))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(obj.data.polygons) > target_faces:
        mod = obj.modifiers.new('decimate', 'DECIMATE')
        mod.ratio = target_faces / len(obj.data.polygons)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # Base centre to the origin, scale to the target height
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    s = target_height / (max(zs) - min(zs))
    offset = Vector(((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)))
    for v in obj.data.vertices:
        v.co = (v.co - offset) * s
    for o in list(bpy.context.scene.objects):
        if o != obj:
            bpy.data.objects.remove(o)
    obj.name = name
    if desaturate:
        import numpy as np
        for img in bpy.data.images:
            if img.colorspace_settings.name != 'sRGB' or img.size[0] == 0:
                continue
            px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            px = px.reshape(-1, 4)
            g = px[:, 0] * 0.3 + px[:, 1] * 0.59 + px[:, 2] * 0.11
            for c in range(3):
                px[:, c] = px[:, c] * (1 - desaturate) + g * desaturate * (0.97 if c == 0 else 1.0)
            img.pixels.foreach_set(px.ravel())
            img.pack()
    export(name, [obj])


# ---------------------------------------------------------------- buildings and props

FOUNDATION = 1.5

def gable_roof(part, w, d, wall_h, pitch_h, overhang, ridge_along_x=True):
    """Two roof planes with thickness 0.15 m; box-mapped UVs follow the slope"""
    hw = w / 2 + overhang
    hd = d / 2 + overhang
    eave = wall_h - overhang * pitch_h / (d / 2)
    top = wall_h + pitch_h
    for side in (-1, 1):
        a = Vector((-hw, side * hd, eave))
        b = Vector((hw, side * hd, eave))
        c = Vector((hw, 0, top))
        e = Vector((-hw, 0, top))
        slope = (c - b).length
        corners = [a, b, c, e] if side < 0 else [b, a, e, c]
        uvs = [(0, 0), (w / 2.2, 0), (w / 2.2, slope / 2.2), (0, slope / 2.2)]
        part.quad(corners, uvs)
        # Underside
        under = [v - Vector((0, 0, 0.15)) for v in reversed(corners)]
        part.quad(under, uvs)


def house(name, w, d, wall_h, roof_asset, wall_asset, storeys=1, barn=False, wall_tint=None):
    clear_scene()
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates'), uv_metres=2.0)
    walls = Part(pbr_material('wall-' + wall_asset, wall_asset, wall_tint), uv_metres=2.5 if not barn else 2.0)
    timber = Part(pbr_material('timber', 'medieval_wood', (0.45, 0.38, 0.32)), uv_metres=1.5)
    roof = Part(pbr_material('roof-' + roof_asset, roof_asset))
    dark = Part(flat_material('window', (0.05, 0.06, 0.07), roughness=0.2, metallic=0.3))
    plinth = 0.6
    # The foundation reaches 1.5 m into the ground: on a slope it shows as a stone base instead of a gap
    box(stone, 0, 0, -FOUNDATION, w + 0.1, d + 0.1, plinth + FOUNDATION)
    box(walls, 0, 0, plinth, w, d, wall_h - plinth)
    pitch = d * 0.45 if not barn else d * 0.5
    # Gable triangles
    for sx in (-1, 1):
        x = sx * w / 2
        bm = walls.bm
        tri = [bm.verts.new((x, -d / 2, wall_h)), bm.verts.new((x, d / 2, wall_h)), bm.verts.new((x, 0, wall_h + pitch))]
        bm.faces.new(tri if sx > 0 else list(reversed(tri)))
    gable_roof(roof, w, d, wall_h, pitch, 0.5)
    t = 0.18
    # Timber frame: corner posts, sill and top beams, storey beam, braces
    if not barn:
        for cx in (-w / 2, w / 2):
            for cy in (-d / 2, d / 2):
                box(timber, cx, cy, plinth, t, t, wall_h - plinth)
        for z in [plinth, wall_h - t] + ([plinth + (wall_h - plinth) / 2] if storeys > 1 else []):
            box(timber, 0, -d / 2, z, w + t, t, t)
            box(timber, 0, d / 2, z, w + t, t, t)
            box(timber, -w / 2, 0, z, t, d + t, t)
            box(timber, w / 2, 0, z, t, d + t, t)
        for sy in (-1, 1):
            y = sy * (d / 2 + 0.02)
            for k in range(int(w // 2.4)):
                x0 = -w / 2 + 0.3 + k * 2.4
                oriented_box(timber, Vector((x0, y, plinth + 0.1)), Vector((x0 + 1.1, y, wall_h - 0.3)), 0.14)
    else:
        for cx in (-w / 2, w / 2):
            for cy in (-d / 2, d / 2):
                box(timber, cx, cy, plinth, 0.3, 0.3, wall_h - plinth)
    # Door on the front (-Y), windows on all sides
    door_w = 1.2 if not barn else 3.2
    door_h = 2.2 if not barn else 3.4
    box(timber, 0, -d / 2 - 0.06, plinth * 0.3 if not barn else 0, door_w + 0.3, 0.12, door_h + 0.2)
    box(dark, 0, -d / 2 - 0.09, plinth * 0.3 + 0.1 if not barn else 0.05, door_w, 0.08, door_h)
    if not barn:
        for z in [plinth + 1.0] + ([plinth + 1.0 + (wall_h - plinth) / 2] if storeys > 1 else []):
            for x in (-w / 3, w / 3):
                for sy in (-1, 1):
                    if sy < 0 and abs(x) < 1.0:
                        continue
                    y = sy * (d / 2 + 0.05)
                    box(timber, x, y, z - 0.08, 1.1, 0.1, 1.25)
                    box(dark, x, y + sy * 0.02, z, 0.9, 0.1, 1.05)
            for sx in (-1, 1):
                box(timber, sx * (w / 2 + 0.05), 0, z - 0.08, 0.1, 1.1, 1.25)
                box(dark, sx * (w / 2 + 0.07), 0, z, 0.1, 0.9, 1.05)
        # Chimney
        box(stone, w * 0.3, d * 0.2, wall_h, 0.7, 0.7, pitch * 0.8 + 1.0)
    objects = [stone.to_object(name + '-stone'), walls.to_object(name + '-walls'), timber.to_object(name + '-timber')]
    # Roof UVs come from gable_roof, no box mapping
    objects.append(roof.to_object(name + '-roof'))
    objects.append(dark.to_object(name + '-dark'))
    export(name, objects)


def tower_ruin(name, seed):
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('castle-brick', 'castle_brick_07'))
    bm = stone.bm
    sides = 18
    r_out, r_in = 3.6, 2.8
    rings = 7
    heights = [12.0 - (5.5 * max(0.0, math.sin(s / sides * math.tau * 1.3 + 0.8)) + rnd.uniform(0, 1.2)) for s in range(sides + 1)]
    heights[-1] = heights[0]
    for r, flip in ((r_out, False), (r_in, True)):
        grid = []
        for k in range(rings + 1):
            row = []
            for s in range(sides + 1):
                a = s / sides * math.tau
                z = -FOUNDATION + (heights[s] + FOUNDATION) * k / rings
                row.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
            grid.append(row)
        circ = math.tau * r
        for k in range(rings):
            for s in range(sides):
                q = [grid[k][s], grid[k][s + 1], grid[k + 1][s + 1], grid[k + 1][s]]
                if flip:
                    q = list(reversed(q))
                f = bm.faces.new(q)
                for loop, (i, j) in zip(f.loops, [(s, k), (s + 1, k), (s + 1, k + 1), (s, k + 1)] if not flip else [(s, k + 1), (s + 1, k + 1), (s + 1, k), (s, k)]):
                    loop[stone.uv].uv = (i / sides * circ / 2.0, (heights[i] + FOUNDATION) * j / rings / 2.0)
        if not flip:
            outer_top = grid[-1]
        else:
            inner_top = grid[-1]
    for s in range(sides):
        f = bm.faces.new((outer_top[s], inner_top[s], inner_top[s + 1], outer_top[s + 1]))
        for loop, uv in zip(f.loops, [(0, 0), (0, 0.4), (0.4, 0.4), (0.4, 0)]):
            loop[stone.uv].uv = uv
    rubble = Part(pbr_material('castle-brick', 'castle_brick_07'), uv_metres=2.0)
    for k in range(9):
        a = rnd.uniform(0, math.tau)
        rr = rnd.uniform(4.0, 6.5)
        box(rubble, math.cos(a) * rr, math.sin(a) * rr, -0.1, rnd.uniform(0.5, 1.1), rnd.uniform(0.4, 0.8), rnd.uniform(0.3, 0.6), rnd.uniform(0, 3))
    export(name, [stone.to_object(name), rubble.to_object(name + '-rubble')])


def wall_stone(name, seed):
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('stone-stacked', 'stacked_stone_wall'), uv_metres=2.0)
    for k in range(4):
        h = 1.3 + rnd.uniform(-0.2, 0.15)
        box(stone, -1.5 + k * 1.0, 0, -0.8, 1.02, 0.6 - k % 2 * 0.04, h + 0.8)
    export(name, [stone.to_object(name)])


def fence(name):
    clear_scene()
    wood = Part(pbr_material('wood-rough', 'rough_wood', (0.8, 0.72, 0.62)), uv_metres=1.5)
    for x in (-2.0, 0.0, 2.0):
        box(wood, x, 0, -0.5, 0.14, 0.14, 1.8)
    for z in (0.45, 0.95):
        box(wood, 0, 0.09, z, 4.1, 0.05, 0.14)
    export(name, [wood.to_object(name)])


def crate(name):
    clear_scene()
    planks = Part(pbr_material('planks-crate', 'brown_planks_04'), uv_metres=1.0)
    frame = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    box(planks, 0, 0, 0, 0.9, 0.9, 0.9)
    e = 0.08
    for x in (-0.45, 0.45):
        for y in (-0.45, 0.45):
            box(frame, x, y, 0, e, e, 0.9)
    for z in (0.0, 0.9 - e):
        for y in (-0.45, 0.45):
            box(frame, 0, y, z, 0.98, e, e)
        for x in (-0.45, 0.45):
            box(frame, x, 0, z, e, 0.98, e)
    export(name, [planks.to_object(name), frame.to_object(name + '-frame')])


def lamp_post(name):
    clear_scene()
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    iron = Part(flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8))
    glass = Part(flat_material('lamp-glass', (1.0, 0.8, 0.5), 0.3, 0.0, emission=(1.0, 0.7, 0.35)))
    box(wood, 0, 0, 0, 0.22, 0.22, 3.6)
    oriented_box(wood, Vector((0, 0, 3.3)), Vector((0, -0.9, 3.5)), 0.12)
    box(iron, 0, -0.85, 3.05, 0.34, 0.34, 0.06)
    box(iron, 0, -0.85, 3.45, 0.4, 0.4, 0.06)
    box(glass, 0, -0.85, 3.11, 0.28, 0.28, 0.34)
    export(name, [wood.to_object(name), iron.to_object(name + '-iron'), glass.to_object(name + '-glass')])


def well(name):
    clear_scene()
    stone = Part(pbr_material('stone-slates', 'castle_wall_slates'))
    wood = Part(pbr_material('wood-rough', 'rough_wood', (0.8, 0.72, 0.62)), uv_metres=1.5)
    roof = Part(pbr_material('roof-clay_roof_tiles_02', 'clay_roof_tiles_02'))
    water = Part(flat_material('well-water', (0.02, 0.05, 0.05), 0.05))
    pts = [Vector((0, 0, -0.8)), Vector((0, 0, 0.9))]
    for r in (1.2,):
        tube(stone, pts, [r, r], 14, smooth=True)
    tube(stone, [Vector((0, 0, 0.9)), Vector((0, 0, 0.0))], [0.95, 0.95], 14, smooth=True)
    bm = stone.bm
    outer = [bm.verts.new((math.cos(a / 14 * math.tau) * 1.2, math.sin(a / 14 * math.tau) * 1.2, 0.9)) for a in range(14)]
    inner = [bm.verts.new((math.cos(a / 14 * math.tau) * 0.95, math.sin(a / 14 * math.tau) * 0.95, 0.9)) for a in range(14)]
    for k in range(14):
        f = bm.faces.new((outer[k], outer[(k + 1) % 14], inner[(k + 1) % 14], inner[k]))
        for loop in f.loops:
            loop[stone.uv].uv = (loop.vert.co.x / 2, loop.vert.co.y / 2)
    wb = water.bm
    disc = [wb.verts.new((math.cos(a / 14 * math.tau) * 0.95, math.sin(a / 14 * math.tau) * 0.95, 0.5)) for a in range(14)]
    wb.faces.new(disc)
    for x in (-1.1, 1.1):
        box(wood, x, 0, 0.9, 0.15, 0.15, 1.6)
    box(wood, 0, 0, 2.3, 2.4, 0.12, 0.12)
    gable_roof(roof, 2.8, 1.6, 2.45, 0.7, 0.1)
    export(name, [stone.to_object(name), wood.to_object(name + '-wood'), roof.to_object(name + '-roof'), water.to_object(name + '-water')])


def bridge_deck(name):
    """4 m of bridge along +X, 1 m wide (scaled to the path width), deck top at z = 0"""
    clear_scene()
    planks = Part(pbr_material('planks-bridge', 'brown_planks_07', (0.8, 0.75, 0.7)), uv_metres=2.0)
    beams = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.5)
    box(planks, 0, 0, -0.12, 4.0, 1.0, 0.12)
    for y in (-0.42, 0.0, 0.42):
        box(beams, 0, y, -0.45, 4.0, 0.12, 0.33)
    for y in (-0.5, 0.5):
        for x in (-1.9, 0.0, 1.9):
            box(beams, x, y, 0, 0.14, 0.06, 1.0)
        box(beams, 0, y, 0.95, 4.0, 0.06, 0.1)
    for x in (-1.9, 1.9):
        box(beams, x, 0, -4.0, 0.25, 0.25, 3.6)
    export(name, [planks.to_object(name), beams.to_object(name + '-beams')])


def main():
    broadleaf('tree-oak', 1, 12.0, 4.2, 0.42, 'bark_brown_02', 'leaves-oak')
    broadleaf('tree-birch', 2, 13.0, 2.6, 0.18, 'bark_platanus', 'leaves-birch', bark_tint=(1.5, 1.5, 1.45), slender=True)
    conifer('tree-pine', 3, 17.0, 3.4, 0.4, 0.32)
    conifer('tree-fir', 4, 13.0, 3.3, 0.08, 0.28)
    dead_tree('tree-dead', 5)
    bush('bush', 6, 1.2, 1.5)
    grass('grass-clump', 'grass.png', 1.1, 0.55, 7)
    grass('flowers', 'flowers.png', 1.0, 0.5, 8)
    stump('stump')
    log('log')
    import_model('fern_02', 0.9, 900, 'fern')
    import_model('namaqualand_boulder_04', 0.9, 500, 'rock-small', desaturate=0.7)
    import_model('namaqualand_boulder_02', 2.6, 1200, 'rock-large', desaturate=0.7)
    import_model('Barrel_01', 1.0, 1200, 'barrel')
    house('house', 7.0, 5.0, 3.6, 'clay_roof_tiles_02', 'grey_plaster_02', wall_tint=(1.08, 1.02, 0.9))
    house('house-large', 10.0, 7.0, 6.4, 'grey_roof_tiles', 'grey_plaster_02', storeys=2, wall_tint=(1.05, 0.98, 0.8))
    house('barn', 11.0, 7.5, 4.2, 'grey_roof_tiles', 'brown_planks_07', barn=True)
    tower_ruin('tower-ruin', 9)
    wall_stone('wall-stone', 10)
    fence('fence-wood')
    crate('crate')
    lamp_post('lamp-post')
    well('well')
    bridge_deck('bridge-deck')


main()
