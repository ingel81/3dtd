"""Shared Blender helpers of the map asset builders (build_models.py and the
modules it loads): materials from Poly Haven texture sets, foliage cards,
mesh parts with world-scale UVs, primitive shapes, imported models and the
GLB export. Paths come from `configure`.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

SOURCES = FOLIAGE = OUT = ''


def configure(sources, foliage, out):
    global SOURCES, FOLIAGE, OUT
    SOURCES, FOLIAGE, OUT = sources, foliage, out
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


def tinted_image(img, tint):
    """A packed copy of an sRGB image multiplied by `tint` (clamped to 1 per channel)"""
    import numpy as np
    key = img.name + '-x' + '-'.join('%.2f' % c for c in tint)
    if key in bpy.data.images:
        return bpy.data.images[key]
    out = img.copy()
    out.name = key
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    for c in range(3):
        px[:, c] = np.clip(px[:, c] * tint[c], 0, 1)
    out.pixels.foreach_set(px.ravel())
    out.pack()
    return out


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
    if tint and max(tint) > 1.0:
        # glTF clamps baseColorFactor to 1: brightening tints go into a copy of the texture instead
        diff.image = tinted_image(diff.image, tint)
        tint = None
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


def glow_card_material(name, png, strength=0.8):
    """Alpha-tested card that emits its own colour (flames); named `foliage-*` for the loader's alpha test"""
    m = card_material(name, png)
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    img = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
    nt.links.new(img.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = strength
    return m


def image_material(name, path, roughness=0.8):
    """Opaque material from one colour image (cactus skin and other drawn textures)"""
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = load_image(path)
    nt.links.new(img.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = roughness
    return m


def flat_material(name, color, roughness=0.8, metallic=0.0, emission=None, strength=2.0):
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
        bsdf.inputs['Emission Strength'].default_value = strength
    return m


# ---------------------------------------------------------------- mesh building

class Part:
    """Collects faces of one material; becomes one mesh object"""

    def __init__(self, material, uv_metres=None, smooth=False):
        self.material = material
        self.uv_metres = uv_metres
        self.smooth = smooth  # keep the smooth flags of tube faces (round shapes), else flat shading
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
        elif not self.smooth:
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


def hexa(part, bottom, top):
    """Closed six-sided solid from four bottom and four top corners (counter-clockwise from above)"""
    bm = part.bm
    b = [bm.verts.new(c) for c in bottom]
    t = [bm.verts.new(c) for c in top]
    bm.faces.new(list(reversed(b)))
    bm.faces.new(t)
    for i in range(4):
        bm.faces.new((b[i], b[(i + 1) % 4], t[(i + 1) % 4], t[i]))


def tilt(objects, x=0.0, y=0.0, z=0.0, lift=0.0):
    """Rotates finished objects (degrees, about the origin) and bakes the rotation into the mesh"""
    m = Matrix.Translation((0, 0, lift)) @ (Matrix.Rotation(math.radians(z), 4, 'Z') @ Matrix.Rotation(math.radians(y), 4, 'Y')
                                            @ Matrix.Rotation(math.radians(x), 4, 'X'))
    for o in objects:
        o.data.transform(m)
        o.data.update()
    return objects


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


# ---------------------------------------------------------------- imported models

def import_model(asset, target_height, target_faces, name, desaturate=0.0, tint=None, objects=None, rot=0.0,
                 keep_scale=False, ground=False, extra=None):
    """A Poly Haven glTF as one game model: joined, decimated to `target_faces`, base centre at the
    origin and scaled to `target_height` (None or keep_scale: the scan's own metres).

    `objects`: names (or name prefixes ending in `*`) of the meshes to keep, for sets and kits;
    `rot`: degrees around the up axis (front towards -Y); `tint`: RGB multiplier of the colour
    textures after `desaturate`; `ground`: sink the base so the lowest 3 % of vertices sit under 0
    (rocks on uneven terrain); `extra(obj)`: last edits before the export, may return more objects
    to export with it (a plinth).
    """
    clear_scene()
    folder = os.path.join(SOURCES, 'models', asset)
    gltf = next(f for f in os.listdir(folder) if f.endswith('.gltf'))
    bpy.ops.import_scene.gltf(filepath=os.path.join(folder, gltf))

    def keep(o):
        if not objects:
            return True
        return any(o.name == n or (n.endswith('*') and o.name.startswith(n[:-1])) for n in objects)

    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and keep(o)]
    if not meshes:
        raise RuntimeError(f'{asset}: no mesh matches {objects}')
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    if obj.data.shape_keys:
        obj.shape_key_clear()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Some scans arrive with every face on its own vertices: weld them, or the decimation cannot collapse edges
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    if sum(1 for e in bm.edges if not e.is_manifold) > len(bm.edges) * 0.5:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.to_mesh(obj.data)
        for p in obj.data.polygons:
            p.use_smooth = True
    bm.free()
    for _ in range(3):
        # Some scans keep most faces on the first pass (quads, seams); triangulated, the next pass gets there
        if len(obj.data.polygons) <= target_faces * 1.2:
            break
        mod = obj.modifiers.new('triangulate', 'TRIANGULATE')
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = obj.modifiers.new('decimate', 'DECIMATE')
        mod.ratio = target_faces / len(obj.data.polygons)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # Base centre to the origin, scale to the target height
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = sorted(v.co.z for v in obj.data.vertices)
    s = 1.0 if keep_scale or not target_height else target_height / (zs[-1] - zs[0])
    base = zs[min(len(zs) - 1, int(len(zs) * 0.03))] if ground else zs[0]
    offset = Vector(((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, base))
    r = Matrix.Rotation(math.radians(rot), 3, 'Z')
    for v in obj.data.vertices:
        v.co = r @ ((v.co - offset) * s)
    obj.data.update()
    for o in list(bpy.context.scene.objects):
        if o != obj:
            bpy.data.objects.remove(o)
    obj.name = name
    if desaturate or tint:
        import numpy as np
        for img in bpy.data.images:
            if img.colorspace_settings.name != 'sRGB' or img.size[0] == 0:
                continue
            px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            px = px.reshape(-1, 4)
            if desaturate:
                g = px[:, 0] * 0.3 + px[:, 1] * 0.59 + px[:, 2] * 0.11
                for c in range(3):
                    px[:, c] = px[:, c] * (1 - desaturate) + g * desaturate * (0.97 if c == 0 else 1.0)
            if tint:
                for c in range(3):
                    px[:, c] = np.clip(px[:, c] * tint[c], 0, 1)
            img.pixels.foreach_set(px.ravel())
            img.pack()
    objects = [obj]
    if extra:
        objects += extra(obj) or []
    export(name, objects)
    return obj
