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
    """An sRGB image multiplied by `tint` (clamped to 1 per channel), saved next to the GLBs as a PNG
    (a packed copy would export the original file)"""
    import numpy as np
    key = os.path.splitext(img.name)[0] + '-x' + '-'.join('%.2f' % c for c in tint)
    if key in bpy.data.images:
        return bpy.data.images[key]
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    for c in range(3):
        px[:, c] = np.clip(px[:, c] * tint[c], 0, 1)
    out = bpy.data.images.new(key, w, h)
    out.pixels.foreach_set(px.ravel())
    folder = os.path.join(OUT, 'tinted')
    os.makedirs(folder, exist_ok=True)
    out.filepath_raw = os.path.join(folder, key + '.png')
    out.file_format = 'PNG'
    out.save()
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


def two_sided(material):
    """Cloth and sheets: one face drawn from both sides (two coincident faces would occlude each other in the AO bake)"""
    material.use_backface_culling = False
    return material


def rust_material(name, asset=None, paint=None, threshold=0.66, tint=None):
    """Weathered metal: a Poly Haven set (`asset`, with its normal map) or a flat `paint` colour, rusted where
    rusty_metal_03 shows rust (its brown, not its yellow paint: green/red below `threshold`, 0.66 heavy, 0.6
    light); rust is rough and not metallic. Colour and roughness/metal maps go next to the GLBs as PNGs"""
    import numpy as np
    key = (name, asset or 'paint')
    if key in _materials:
        return _materials[key]
    folder = os.path.join(OUT, 'tinted')
    os.makedirs(folder, exist_ok=True)

    def pixels(path, non_color=False):
        img = load_image(path, non_color)
        px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        return img.size, px.reshape(-1, 4)

    def save(label, size, px, non_color=False):
        out = bpy.data.images.new(name + '-' + label, size[0], size[1])
        if non_color:
            out.colorspace_settings.name = 'Non-Color'
        out.pixels.foreach_set(px.ravel())
        out.filepath_raw = os.path.join(folder, name + '-' + label + '.png')
        out.file_format = 'PNG'
        out.save()
        return out

    size, rust = pixels(tex_path('rusty_metal_03', 'diff'))
    _, rust_arm = pixels(tex_path('rusty_metal_03', 'arm'), True)
    mask = np.clip((threshold - rust[:, 1] / (rust[:, 0] + 1e-3)) / 0.14, 0, 1)[:, None]
    if asset:
        _, base = pixels(tex_path(asset, 'diff'))
        _, arm = pixels(tex_path(asset, 'arm'), True)
        normal = tex_path(asset, 'nor')
    else:
        base = np.tile(np.array([*paint, 1.0], dtype=np.float32), (len(rust), 1))
        # Paint: a flat colour with the rust texture's faint scratches as variation, a painted sheen
        base[:, :3] *= 0.85 + 0.3 * rust[:, :3].mean(axis=1, keepdims=True)
        arm = np.tile(np.array([1.0, 0.45, 0.3, 1.0], dtype=np.float32), (len(rust), 1))
        normal = tex_path('rusty_metal_03', 'nor')
    if tint:
        base[:, :3] *= np.array(tint, dtype=np.float32)
    colour = base * (1 - mask) + rust * 0.85 * mask
    colour[:, 3] = 1.0
    rough = arm.copy()
    rough[:, 1:2] = arm[:, 1:2] * (1 - mask) + np.maximum(rust_arm[:, 1:2], 0.75) * mask
    rough[:, 2:3] = arm[:, 2:3] * (1 - mask) + 0.15 * mask
    rough[:, 3] = 1.0
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    diff = nt.nodes.new('ShaderNodeTexImage')
    diff.image = save('diff', size, np.clip(colour, 0, 1))
    nt.links.new(diff.outputs['Color'], bsdf.inputs['Base Color'])
    nor = nt.nodes.new('ShaderNodeTexImage')
    nor.image = load_image(normal, non_color=True)
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nor.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    armn = nt.nodes.new('ShaderNodeTexImage')
    armn.image = save('arm', size, np.clip(rough, 0, 1), True)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(armn.outputs['Color'], sep.inputs['Color'])
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


def net_material(name, colour, cell=32, cord=8, diamond=False, size=256):
    """Alpha-tested net card drawn here: cords about a quarter of the mesh wide, so the net still covers
    some 40 % once mipmaps have averaged it (a thin cord vanishes past a few metres and the net with it).
    Square mesh for court nets, `diamond` for goal nets and the steel mesh"""
    import numpy as np
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) + 0.5
    if diamond:
        x, y = (x + y) / 2, (x - y) / 2
    dx = np.abs(((x + cell / 2) % cell) - cell / 2)
    dy = np.abs(((y + cell / 2) % cell) - cell / 2)
    d = np.minimum(dx, dy)
    alpha = np.clip(cord / 2 + 0.5 - d, 0, 1)
    shade = 0.75 + 0.25 * np.clip(1 - d / (cord / 2 + 0.5), 0, 1)
    rgba = np.zeros((size, size, 4), dtype=np.float32)
    for c in range(3):
        rgba[..., c] = colour[c] * shade
    rgba[..., 3] = alpha
    img = bpy.data.images.new('net-' + name, size, size, alpha=True)
    img.pixels.foreach_set(rgba[::-1].ravel())
    folder = os.path.join(OUT, 'tex')
    os.makedirs(folder, exist_ok=True)
    img.filepath_raw = os.path.join(folder, 'net-' + name + '.png')
    img.file_format = 'PNG'
    img.save()
    m = bpy.data.materials.new('foliage-net-' + name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
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

    def __init__(self, material, uv_metres=None, smooth=False, bevel=None, uv_scale=1.0):
        self.material = material
        if bevel is None:
            # Box-built parts (world-scale UVs) get a small chamfer by default: no razor-sharp toy edges
            bevel = 0.02 if uv_metres else 0.0
        self.uv_scale = uv_scale  # multiplies the UVs of tubes and cards (larger texture repeats on hulls)
        self.uv_metres = uv_metres
        self.bevel = bevel  # chamfer width in metres on hard edges (no toy-like razor edges)
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
        if self.bevel:
            chamfer(obj, self.bevel)
        if self.uv_metres:
            box_uv(obj, self.uv_metres)
        if self.uv_scale != 1.0 and mesh.uv_layers:
            for d in mesh.uv_layers[0].data:
                d.uv = d.uv * self.uv_scale
        if self.normals:
            mesh.normals_split_custom_set(self.normals)
        elif not self.smooth:
            for p in mesh.polygons:
                p.use_smooth = False
        return obj


def chamfer(obj, width, segments=1, angle=40):
    """Bevels the hard edges of an object (each closed shell for itself)"""
    mod = obj.modifiers.new('chamfer', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    mod.use_clamp_overlap = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def bake_ao(name, objects, size=512, distance=2.0, samples=24, grime=False):
    """Bakes ambient occlusion of the whole model into one texture on a second UV map and wires it as the
    glTF occlusion texture (TEXCOORD_1): contact shadow in corners, under eaves, in window reveals.
    `grime`: the weathering darkens the occlusion (_grime_socket: dirt rising from the ground, streaks
    running down the walls, dirt in hollows, less on worn edges), and where the catalogue says `grime` the
    game lets the occlusion darken the colour in direct light too (object-layer.ts addGrime): the tiled
    surfaces stay sharp. Not in a channel of its own: the glTF export packs occlusion, roughness and metal
    into one image where the sizes match, and only the red channel stays the occlusion's.
    Joins the objects (materials stay separate); returns the joined object"""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name='UVMap')
    base = mesh.uv_layers[0]
    ao_uv = mesh.uv_layers.new(name='AO')
    mesh.uv_layers.active = ao_uv
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
    if grime:
        # The walls' share of the image by their size: the weathering runs over them, not over the trim
        bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(rotate=True, margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    base.active_render = True
    img = bpy.data.images.new(name + '-ao', size, size)
    img.colorspace_settings.name = 'Non-Color'
    group = bpy.data.node_groups.get('glTF Material Output')
    if group is None:
        group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    for slot in obj.material_slots:
        m = slot.material
        if m is None:
            continue
        nt = m.node_tree
        uvn = nt.nodes.new('ShaderNodeUVMap')
        uvn.uv_map = 'AO'
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(tex.outputs['Color'], sep.inputs['Color'])
        out = nt.nodes.new('ShaderNodeGroup')
        out.node_tree = group
        nt.links.new(sep.outputs['Red'], out.inputs['Occlusion'])
        nt.nodes.active = tex
    scene = bpy.context.scene
    try:
        scene.render.engine = 'CYCLES'
    except TypeError:
        pass
    scene.cycles.samples = samples
    scene.world = scene.world or bpy.data.worlds.new('World')
    scene.world.light_settings.distance = distance
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    # Cycles bakes into the active UV map; the colour textures keep the first one
    mesh.uv_layers.active = mesh.uv_layers['AO']
    bpy.ops.object.bake(type='AO', margin=4, use_clear=True)
    if grime:
        _bake_grime(name, obj, img, size, samples)
    mesh.uv_layers.active = mesh.uv_layers[0]
    folder = os.path.join(OUT, 'ao')
    os.makedirs(folder, exist_ok=True)
    img.filepath_raw = os.path.join(folder, name + '-ao.png')
    img.file_format = 'PNG'
    img.save()
    return obj


# How far the weathering darkens the occlusion at its dirtiest
GRIME_DEPTH = 0.6


def _grime_socket(nt):
    """A material's weathering, 0 clean to 1 dirty, from the geometry: dirt rising from the ground, streaks
    running down (noise stretched upright), dirt in the hollows, the worn outer edges cleaner"""
    def node(kind, **inputs):
        n = nt.nodes.new(kind)
        for key, value in inputs.items():
            setattr(n, key, value)
        return n

    def math(op, a, b, clamp=True):
        n = node('ShaderNodeMath', operation=op, use_clamp=clamp)
        for k, v in enumerate((a, b)):
            if isinstance(v, bpy.types.NodeSocket):
                nt.links.new(v, n.inputs[k])
            else:
                n.inputs[k].default_value = v
        return n.outputs[0]

    def ramp(value, lo, hi):
        n = node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        nt.links.new(value, n.inputs['Value'])
        n.inputs['From Min'].default_value = lo
        n.inputs['From Max'].default_value = hi
        return n.outputs['Result']

    def noise(scale, stretch, detail=4.0):
        coords = node('ShaderNodeTexCoord').outputs['Object']
        mul = node('ShaderNodeVectorMath', operation='MULTIPLY')
        nt.links.new(coords, mul.inputs[0])
        mul.inputs[1].default_value = tuple(scale * s for s in stretch)
        n = node('ShaderNodeTexNoise', noise_dimensions='3D')
        nt.links.new(mul.outputs[0], n.inputs['Vector'])
        n.inputs['Scale'].default_value = 1.0
        n.inputs['Detail'].default_value = detail
        return n.outputs['Fac']

    sep = node('ShaderNodeSeparateXYZ')
    nt.links.new(node('ShaderNodeTexCoord').outputs['Object'], sep.inputs[0])
    ground = math('MULTIPLY', ramp(sep.outputs['Z'], 1.5, 0.0), ramp(noise(2.0, (1, 1, 1)), 0.25, 0.7))
    streak = math('MULTIPLY', ramp(noise(1.2, (1.0, 1.0, 0.08), 3.0), 0.5, 0.8), 0.6)
    ao = node('ShaderNodeAmbientOcclusion', samples=16)
    ao.inputs['Distance'].default_value = 0.3
    hollow = math('MULTIPLY', math('SUBTRACT', 1.0, ao.outputs['AO']), 0.8)
    bevel = node('ShaderNodeBevel', samples=8)
    bevel.inputs['Radius'].default_value = 0.025
    dot = node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
    nt.links.new(bevel.outputs['Normal'], dot.inputs[0])
    nt.links.new(node('ShaderNodeNewGeometry').outputs['Normal'], dot.inputs[1])
    worn = ramp(dot.outputs['Value'], 0.995, 0.9)
    dirt = math('MAXIMUM', math('MAXIMUM', ground, streak), hollow)
    return math('MULTIPLY', dirt, math('SUBTRACT', 1.0, math('MULTIPLY', worn, 0.7)))


def _bake_grime(name, obj, ao_img, size, samples):
    """Bakes _grime_socket of every material and darkens the occlusion image by it"""
    import numpy as np
    img = bpy.data.images.new(name + '-grime', size, size, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    undo = []
    for slot in obj.material_slots:
        m = slot.material
        if m is None:
            continue
        nt = m.node_tree
        before = set(nt.nodes)
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
        relink = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].is_linked else None
        emit = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(_grime_socket(nt), emit.inputs['Color'])
        nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
        target = nt.nodes.new('ShaderNodeTexImage')
        target.image = img
        nt.nodes.active = target
        undo.append((nt, before, out, relink))
    bpy.context.scene.cycles.samples = max(8, samples // 2)
    bpy.ops.object.bake(type='EMIT', margin=4, use_clear=True)
    for nt, before, out, relink in undo:
        for n in [n for n in nt.nodes if n not in before]:
            nt.nodes.remove(n)
        if relink is not None:
            nt.links.new(relink, out.inputs['Surface'])
    n = size * size * 4
    ao = np.empty(n, dtype=np.float32)
    ao_img.pixels.foreach_get(ao)
    g = np.empty(n, dtype=np.float32)
    img.pixels.foreach_get(g)
    px = ao.reshape(-1, 4)
    dirt = np.clip(g.reshape(-1, 4)[:, 0], 0, 1)
    for c in range(3):
        px[:, c] *= 1.0 - GRIME_DEPTH * dirt
    ao_img.pixels.foreach_set(px.ravel())
    bpy.data.images.remove(img)


def finish(name, objects, ao_size=512, grime=False):
    """Bakes ambient occlusion (and with `grime` the weathering, bake_ao) over the whole model, then exports
    it; the faces of `spin-*` materials (a part that turns, see split_spin) go into a node of their own"""
    obj = bake_ao(name, objects, size=ao_size, grime=grime)
    export(name, [obj] + split_spin(obj, name))
    return obj


def split_spin(obj, name):
    """Moves the faces of materials named `spin-*` out of `obj` into one object `spin-<name>`: a part of
    the model that turns about the vertical axis through its origin (a radar head, a lighthouse lens).
    It stays a node of its own in the GLB; pack_models.py joins only equal materials, so give spin
    materials values no other material of the model has (glTF-Transform merges equal materials first)"""
    spin = [i for i, slot in enumerate(obj.material_slots) if slot.material and slot.material.name.startswith('spin-')]
    if not spin:
        return []
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bm = bmesh.from_edit_mesh(obj.data)
    for f in bm.faces:
        f.select_set(f.material_index in spin)
    bmesh.update_edit_mesh(obj.data)
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    part = next(o for o in bpy.context.selected_objects if o != obj)
    part.name = 'spin-' + name
    return [part]


# ---------------------------------------------------------------- baked surfaces

class Nodes:
    """Builds the node tree of one procedural material: shorthands for the
    weathering recipes (paint over wood, grime in hollows, worn edges, streaks)
    that bake_surface renders into the model's own textures. Arguments are
    sockets or plain numbers and colours (constants)"""

    def __init__(self, name):
        self.material = bpy.data.materials.new(name)
        try:
            self.material.use_nodes = True
        except AttributeError:
            pass
        self.nt = self.material.node_tree
        self.bsdf = next(n for n in self.nt.nodes if n.type == 'BSDF_PRINCIPLED')
        self._coords = None

    def put(self, socket, value):
        if isinstance(value, bpy.types.NodeSocket):
            self.nt.links.new(value, socket)
        elif isinstance(value, (tuple, list)) and len(value) == 3 and socket.type == 'RGBA':
            socket.default_value = (*value, 1.0)
        else:
            socket.default_value = value

    def coords(self):
        """Model-space position in metres (the object's own coordinates)"""
        if self._coords is None:
            self._coords = self.nt.nodes.new('ShaderNodeTexCoord').outputs['Object']
        return self._coords

    def scaled(self, scale):
        """Model coordinates times a per-axis scale"""
        n = self.nt.nodes.new('ShaderNodeVectorMath')
        n.operation = 'MULTIPLY'
        self.nt.links.new(self.coords(), n.inputs[0])
        n.inputs[1].default_value = scale
        return n.outputs[0]

    def noise(self, scale, detail=4.0, roughness=0.55, stretch=(1, 1, 1)):
        """Noise at `scale` per metre; `stretch` per axis (above 1 squeezes: streaks, grain)"""
        n = self.nt.nodes.new('ShaderNodeTexNoise')
        n.noise_dimensions = '3D'
        self.nt.links.new(self.scaled(tuple(scale * s for s in stretch)), n.inputs['Vector'])
        n.inputs['Scale'].default_value = 1.0
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = roughness
        return n.outputs['Fac']

    def voronoi(self, scale, stretch=(1, 1, 1), feature='F1', output='Distance'):
        n = self.nt.nodes.new('ShaderNodeTexVoronoi')
        n.feature = feature
        self.nt.links.new(self.scaled(tuple(scale * s for s in stretch)), n.inputs['Vector'])
        n.inputs['Scale'].default_value = 1.0
        return n.outputs[output]

    def uv(self, which):
        """One coordinate of the part's own UV map (0 u, 1 v): metres along and round a hull, say"""
        if not hasattr(self, '_uv'):
            uv = self.nt.nodes.new('ShaderNodeUVMap')
            uv.uv_map = 'UVMap'
            sep = self.nt.nodes.new('ShaderNodeSeparateXYZ')
            self.nt.links.new(uv.outputs['UV'], sep.inputs[0])
            self._uv = sep
        return self._uv.outputs[which]

    def axis(self, which):
        """One model coordinate (0 x, 1 y, 2 z) in metres"""
        n = self.nt.nodes.new('ShaderNodeSeparateXYZ')
        self.nt.links.new(self.coords(), n.inputs[0])
        return n.outputs[which]

    def near(self, point, inner, outer):
        """1 within `inner` metres of a model point, 0 beyond `outer`, smooth between"""
        n = self.nt.nodes.new('ShaderNodeVectorMath')
        n.operation = 'DISTANCE'
        self.nt.links.new(self.coords(), n.inputs[0])
        n.inputs[1].default_value = point
        return self.ramp(n.outputs['Value'], outer, inner)

    def math(self, op, a, b=0.0, clamp=False):
        n = self.nt.nodes.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        self.put(n.inputs[0], a)
        self.put(n.inputs[1], b)
        return n.outputs[0]

    def ramp(self, value, lo, hi):
        """0 at `lo`, 1 at `hi`, smooth between (lo above hi turns it round)"""
        n = self.nt.nodes.new('ShaderNodeMapRange')
        n.interpolation_type = 'SMOOTHSTEP'
        self.put(n.inputs['Value'], value)
        n.inputs['From Min'].default_value = lo
        n.inputs['From Max'].default_value = hi
        return n.outputs['Result']

    def mix(self, factor, a, b, blend='MIX'):
        """Colour `a` towards `b` by `factor`"""
        n = self.nt.nodes.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        n.blend_type = blend
        n.clamp_result = True
        self.put(n.inputs['Factor'], factor)
        self.put(n.inputs['A'], a)
        self.put(n.inputs['B'], b)
        return n.outputs['Result']

    def mixf(self, factor, a, b):
        """Number `a` towards `b` by `factor`"""
        n = self.nt.nodes.new('ShaderNodeMix')
        n.data_type = 'FLOAT'
        n.clamp_factor = True
        self.put(n.inputs['Factor'], factor)
        self.put(n.inputs[2], a)
        self.put(n.inputs[3], b)
        return n.outputs[0]

    def hollows(self, distance=0.25):
        """1 in corners and crevices, 0 on open surfaces (Cycles ambient occlusion)"""
        n = self.nt.nodes.new('ShaderNodeAmbientOcclusion')
        n.samples = 16
        n.inputs['Distance'].default_value = distance
        return self.math('SUBTRACT', 1.0, n.outputs['AO'], clamp=True)

    def edges(self, radius=0.02):
        """1 on outer edges and corners, 0 on flat faces: the bevel normal against the true normal"""
        bevel = self.nt.nodes.new('ShaderNodeBevel')
        bevel.samples = 8
        bevel.inputs['Radius'].default_value = radius
        geo = self.nt.nodes.new('ShaderNodeNewGeometry')
        dot = self.nt.nodes.new('ShaderNodeVectorMath')
        dot.operation = 'DOT_PRODUCT'
        self.nt.links.new(bevel.outputs['Normal'], dot.inputs[0])
        self.nt.links.new(geo.outputs['Normal'], dot.inputs[1])
        return self.ramp(dot.outputs['Value'], 0.995, 0.9)

    def image(self, asset, kind='diff', metres=1.5, tint=None):
        """A Poly Haven texture laid on in model space (box projection), for wood under paint and the like"""
        tex = self.nt.nodes.new('ShaderNodeTexImage')
        tex.image = load_image(tex_path(asset, kind), non_color=kind != 'diff')
        tex.projection = 'BOX'
        tex.projection_blend = 0.25
        self.nt.links.new(self.scaled((1 / metres,) * 3), tex.inputs['Vector'])
        out = tex.outputs['Color']
        return self.mix(1.0, out, tint, 'MULTIPLY') if tint else out

    def bump(self, height, strength=0.3, distance=0.02, normal=None):
        n = self.nt.nodes.new('ShaderNodeBump')
        n.inputs['Strength'].default_value = strength
        n.inputs['Distance'].default_value = distance
        self.put(n.inputs['Height'], height)
        if normal is not None:
            self.put(n.inputs['Normal'], normal)
        return n.outputs['Normal']

    def finish(self, colour, roughness=0.8, normal=None, metallic=0.0):
        self.put(self.bsdf.inputs['Base Color'], colour)
        self.put(self.bsdf.inputs['Roughness'], roughness)
        self.put(self.bsdf.inputs['Metallic'], metallic)
        if normal is not None:
            self.put(self.bsdf.inputs['Normal'], normal)
        return self.material


def _join(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def _pin_source_uvs(material, uv_name):
    """Image textures and normal maps of a source material read the UV map they were made for, not the bake map"""
    nt = material.node_tree
    for n in list(nt.nodes):
        if n.type == 'TEX_IMAGE' and not n.inputs['Vector'].is_linked:
            uv = nt.nodes.new('ShaderNodeUVMap')
            uv.uv_map = uv_name
            nt.links.new(uv.outputs['UV'], n.inputs['Vector'])
        elif n.type == 'NORMAL_MAP' and not n.uv_map:
            n.uv_map = uv_name


def _bake_pass(obj, image, kind, samples, socket=None):
    """Bakes one pass of every material of `obj` into `image`: Cycles NORMAL or AO, or with `socket` the value
    of that Principled input (wired through an emission shader for the bake)"""
    bpy.context.scene.cycles.samples = samples
    undo = []
    for slot in obj.material_slots:
        nt = slot.material.node_tree
        target = nt.nodes.new('ShaderNodeTexImage')
        target.image = image
        nt.nodes.active = target
        added, relink = [target], None
        if socket is not None:
            out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
            bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
            emit = nt.nodes.new('ShaderNodeEmission')
            added.append(emit)
            src = bsdf.inputs[socket]
            if src.is_linked:
                nt.links.new(src.links[0].from_socket, emit.inputs['Color'])
            else:
                v = src.default_value
                emit.inputs['Color'].default_value = (*v[:3], 1) if hasattr(v, '__len__') else (v, v, v, 1)
            if out.inputs['Surface'].is_linked:
                relink = (out.inputs['Surface'].links[0].from_socket, out.inputs['Surface'])
            nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
        undo.append((nt, added, relink))
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    options = dict(margin=8, margin_type='EXTEND', use_clear=True)
    if socket is not None:
        bpy.ops.object.bake(type='EMIT', **options)
    elif kind == 'NORMAL':
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', **options)
    else:
        bpy.ops.object.bake(type=kind, **options)
    for nt, added, relink in undo:
        if relink:
            nt.links.new(*relink)
        for n in added:
            nt.nodes.remove(n)


def _pixels(image):
    import numpy as np
    px = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    return px.reshape(image.size[1], image.size[0], 4)


def _saved_image(name, px, non_color):
    h, w = px.shape[:2]
    img = bpy.data.images.new(name, w, h)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(px.ravel())
    folder = os.path.join(OUT, 'baked')
    os.makedirs(folder, exist_ok=True)
    img.filepath_raw = os.path.join(folder, name + '.png')
    img.file_format = 'PNG'
    img.save()
    return img


def bake_surface(name, objects, keep=(), size=1024, samples=24, ao_distance=1.5, variants=None):
    """Renders the procedural materials of `objects` into textures of their own and exports the model:
    joins them, unwraps them once (UV map 'Bake'), bakes colour, roughness, metalness, the normal (bumps
    and normal maps of the sources) and ambient occlusion, and gives the result one material
    `<name>-surface` (colour, normal, and occlusion/roughness/metal in one image as glTF packs it).
    Grime, worn edges and streaks the materials compute from the geometry end up painted into the model:
    one draw call, no shader cost in the game.

    `variants` (n, set_look): n looks of the same mesh in a grid atlas (2 x 2 for four); `set_look(obj, k)`
    changes the materials of the joined object before look k is baked. The UVs show the first cell, the renderer picks a cell
    per instance (catalogue `variants`). `keep` (window glass, lamps, alpha cards) goes out as it is.
    Returns the joined object"""
    import numpy as np
    obj = _join(objects)
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name='UVMap')
    source_uv = mesh.uv_layers[0].name
    for slot in obj.material_slots:
        _pin_source_uvs(slot.material, source_uv)
    bake_uv = mesh.uv_layers.new(name='Bake')
    mesh.uv_layers.active = bake_uv
    bake_uv.active_render = True
    count, set_look = variants or (1, None)
    grid = math.ceil(math.sqrt(count))
    cell = size // grid
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=6.0 / cell, area_weight=0.0)
    bpy.ops.object.mode_set(mode='OBJECT')
    scene = bpy.context.scene
    try:
        scene.render.engine = 'CYCLES'
    except TypeError:
        pass
    scene.world = scene.world or bpy.data.worlds.new('World')
    scene.world.light_settings.distance = ao_distance
    atlas = {key: np.zeros((size, size, 4), dtype=np.float32) for key in ('colour', 'normal', 'orm')}
    work = {key: bpy.data.images.new(name + '-bake-' + key, cell, cell, float_buffer=True) for key in ('colour', 'normal', 'r', 'm', 'ao')}
    for img in work.values():
        img.colorspace_settings.name = 'Non-Color'
    for k in range(count):
        if set_look:
            set_look(obj, k)
        _bake_pass(obj, work['colour'], 'EMIT', samples, 'Base Color')
        _bake_pass(obj, work['r'], 'EMIT', max(4, samples // 3), 'Roughness')
        _bake_pass(obj, work['m'], 'EMIT', 4, 'Metallic')
        _bake_pass(obj, work['normal'], 'NORMAL', max(4, samples // 3))
        _bake_pass(obj, work['ao'], 'AO', samples)
        y0, x0 = (k // grid) * cell, (k % grid) * cell
        colour = _pixels(work['colour'])
        # The colour bakes in linear light (a float buffer, no view transform); the texture stores sRGB
        rgb = np.clip(colour[..., :3], 0, 1)
        colour[..., :3] = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
        colour[..., 3] = 1
        atlas['colour'][y0:y0 + cell, x0:x0 + cell] = colour
        atlas['normal'][y0:y0 + cell, x0:x0 + cell] = _pixels(work['normal'])
        orm = np.ones((cell, cell, 4), dtype=np.float32)
        orm[..., 0] = _pixels(work['ao'])[..., 0]
        orm[..., 1] = _pixels(work['r'])[..., 0]
        orm[..., 2] = _pixels(work['m'])[..., 0]
        atlas['orm'][y0:y0 + cell, x0:x0 + cell] = orm
    if count > 1:
        # The UVs show the first cell (bottom left in Blender's image space, top left once glTF flips v);
        # edit mode rebuilt the mesh data, so the layer is looked up again
        for d in mesh.uv_layers['Bake'].data:
            d.uv = d.uv / grid
    images = {
        'colour': _saved_image(name + '-colour', np.clip(atlas['colour'], 0, 1), False),
        'normal': _saved_image(name + '-normal', np.clip(atlas['normal'], 0, 1), True),
        'orm': _saved_image(name + '-orm', np.clip(atlas['orm'], 0, 1), True),
    }
    for img in work.values():
        bpy.data.images.remove(img)
    # One material reading the baked textures through the bake map, which becomes the only UV map
    m = bpy.data.materials.new(name + '-surface')
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    col = nt.nodes.new('ShaderNodeTexImage')
    col.image = images['colour']
    nt.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
    nor = nt.nodes.new('ShaderNodeTexImage')
    nor.image = images['normal']
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nor.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    orm = nt.nodes.new('ShaderNodeTexImage')
    orm.image = images['orm']
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    group = bpy.data.node_groups.get('glTF Material Output')
    if group is None:
        group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    gout = nt.nodes.new('ShaderNodeGroup')
    gout.node_tree = group
    nt.links.new(sep.outputs['Red'], gout.inputs['Occlusion'])
    mesh.materials.clear()
    mesh.materials.append(m)
    for p in mesh.polygons:
        p.material_index = 0
    for layer in [l for l in mesh.uv_layers if l.name != 'Bake']:
        mesh.uv_layers.remove(layer)
    export(name, [obj] + list(keep))
    return obj


def flat_copy(material):
    """A texture-free stand-in for a material: the average colour of its base colour image (times its tint).
    A first guess only: match_lods.py sets the final colour, roughness and metalness on the packed GLBs"""
    import numpy as np
    nt = material.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None) if nt else None
    if bsdf is None:
        return material
    src = bsdf.inputs['Base Color']
    colour = list(src.default_value)[:3]
    img_node = None
    if src.is_linked:
        node = src.links[0].from_node
        if node.type == 'TEX_IMAGE':
            img_node = node
        elif node.type == 'MIX':
            a = node.inputs['A']
            img_node = a.links[0].from_node if a.is_linked and a.links[0].from_node.type == 'TEX_IMAGE' else None
            colour = list(node.inputs['B'].default_value)[:3]
    if img_node is None or img_node.image is None:
        return material
    img = img_node.image
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    mean = px.reshape(-1, 4)[:, :3].mean(axis=0)
    tint = colour if src.links[0].from_node.type == 'MIX' else (1.0, 1.0, 1.0)
    rough = bsdf.inputs['Roughness'].default_value if not bsdf.inputs['Roughness'].is_linked else 0.8
    flat = flat_material(material.name + '-lod', tuple(float(m * t) for m, t in zip(mean, tint)), rough)
    if material.name.startswith('foliage-'):
        return material
    return flat


def export_lod(name, obj, ratio=0.3, suffix='-lod1', textured=False, facades=None):
    """A decimated copy for distant views (catalogue `lod`), exported next to the model. Textured
    materials become their average colour, so the LOD file carries no second copy of the textures;
    `textured` keeps a baked surface (bake_surface) with its UVs: its paint and markings are the look;
    `facades` (walls, openings, details by material prefix, CITY_FACADES) draws a box-built house's facades
    flat instead of decimating them (facade_lod)"""
    lod = obj.copy()
    lod.data = obj.data.copy()
    bpy.context.collection.objects.link(lod)
    for slot in ([] if textured else lod.material_slots):
        source = slot.material
        if source is not None:
            # Object-level slot: the shared mesh data keeps the textured materials for the full model
            slot.link = 'OBJECT'
            slot.material = flat_copy(source)
    if facades:
        facade_lod(lod, *facades, rest=ratio)
    else:
        decimate_keeping(lod, ratio, name)
    while len(lod.data.uv_layers) and not textured:
        lod.data.uv_layers.remove(lod.data.uv_layers[0])
    export(name + suffix, [lod])
    bpy.data.objects.remove(lod)


# Materials with this many faces or fewer are left whole by decimate_keeping
LOD_KEEP_FACES = 24


def _faces_by_material(obj):
    used = set()
    for poly in obj.data.polygons:
        slot = obj.material_slots[poly.material_index] if poly.material_index < len(obj.material_slots) else None
        used.add(slot.material.name.removesuffix('-lod') if slot and slot.material else '')
    return used


def _delete_faces(obj, keep):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep(f.material_index)], context='FACES')
    bm.to_mesh(obj.data)
    bm.free()


def decimate_keeping(obj, ratio, name='', check=True):
    """Collapse-decimates `obj` to about `ratio` of its faces, leaving the materials of LOD_KEEP_FACES faces or
    fewer whole: a roof of four big quads is most of what a distant view sees, and the collapse took such
    parts away entirely (the industrial hall, the town hall and the station stood without a roof past their
    LOD distance). Every material of the full mesh keeps faces, else the build stops"""
    before = _faces_by_material(obj)
    counts = {}
    for poly in obj.data.polygons:
        counts[poly.material_index] = counts.get(poly.material_index, 0) + 1
    small = {i for i, n in counts.items() if n <= LOD_KEEP_FACES}
    total = len(obj.data.polygons)
    kept = None
    if ratio < 1.0 and small and len(small) < len(counts):
        kept = obj.copy()
        kept.data = obj.data.copy()
        bpy.context.collection.objects.link(kept)
        _delete_faces(kept, lambda i: i in small)
        _delete_faces(obj, lambda i: i not in small)
        # The kept faces count against the target
        ratio = min(1.0, max(0.02, (ratio * total - len(kept.data.polygons)) / max(1, len(obj.data.polygons))))
    if ratio < 1.0:
        mod = obj.modifiers.new('decimate', 'DECIMATE')
        mod.ratio = ratio
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if kept is not None:
        bpy.ops.object.select_all(action='DESELECT')
        kept.select_set(True)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.join()
    # Collapsed edges can leave duplicate faces behind (box-built parts)
    obj.data.validate()
    lost = sorted(before - _faces_by_material(obj))
    if lost and check:
        raise RuntimeError('%s: the distance copy lost every face of %s' % (name or obj.name, ', '.join(lost)))


# A facade's skin: reveals, recessed glass and window frames lie this far behind its plane at most, m
FACADE_SKIN = 0.6
# A wall plane needs this much area facing one way, m2 (less is a ledge's edge)
FACADE_MIN_AREA = 1.0
# The materials of the city houses' facades by prefix (build_modern.py Kit): walls, openings, details (facade_lod)
CITY_FACADES = (('plaster', 'plinth'), ('window-glass', 'door'), ('frame', 'sill', 'shutter'))


def facade_lod(obj, walls, openings, details, rest=1.0):
    """The facades of a box-built house as a distance copy draws them (E268): each outer wall plane one hole-free
    polygon per wall material (the convex hull of its faces there; a set-back storey's walls a plane of their
    own), the openings (`openings`: glass, doors) and the front faces of the details (`details`: frames, sills,
    shutters) laid flat on it as rectangles, a little in front (one per touching group: a window's frame bars one
    rim behind its glass, its panes one), the reveals and the sides of frames gone. Collapse-decimating such a wall turned its window holes and frames into
    triangles (block-row-4); this keeps every window a rectangle with far fewer triangles. Materials are named by
    prefix; faces of other materials and faces away from the outer planes (roofs, dormers, balconies) are
    collapse-decimated to `rest` of their count, their small materials whole (decimate_keeping). Works on Blender's
    Z-up axes, outer planes facing +-X and +-Y"""
    from mathutils import geometry
    before = _faces_by_material(obj)
    names = [s.material.name if s.material else '' for s in obj.material_slots]
    kind = [('wall' if n.startswith(walls) else 'opening' if n.startswith(openings) else 'detail' if n.startswith(details) else '')
            for n in names]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    dirs = [Vector((1, 0, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), Vector((0, -1, 0))]
    planes = []
    for d in dirs:
        # The walls' area facing that way by offset
        area = {}
        for f in bm.faces:
            if kind[f.material_index] == 'wall' and f.normal.dot(d) > 0.95:
                key = round(f.calc_center_median().dot(d) * 50) / 50
                area[key] = area.get(key, 0) + f.calc_area()
        if not area:
            continue
        # Every plane with some wall facing that way, the largest first (a set-back top storey, a balcony's parapet
        # have their own), but none within the skin of a larger one it overlaps (a cornice, the backs of recesses)
        side = Vector((0, 0, 1)).cross(d)
        taken = []
        for at in sorted((k for k, a in area.items() if a >= FACADE_MIN_AREA), key=lambda k: -area[k]):
            pts = [v.co for f in bm.faces if kind[f.material_index] == 'wall' and f.normal.dot(d) > 0.95
                   and abs(f.calc_center_median().dot(d) - at) < 0.02 for v in f.verts]
            box = (min(p.dot(side) for p in pts), max(p.dot(side) for p in pts), min(p.z for p in pts), max(p.z for p in pts))
            if any(abs(t - at) <= FACADE_SKIN and b[0] < box[1] and box[0] < b[1] and b[2] < box[3] and box[2] < b[3] for t, b in taken):
                continue
            taken.append((at, box))
            planes.append((d, at, box))
    drop = set()
    hulls = []
    rects = {}
    made = set()
    for f in bm.faces:
        k = kind[f.material_index]
        if not k:
            continue
        c = f.calc_center_median()
        # Its facade: a plane it faces, else one it lies behind, the nearest, within the skin and the plane's box
        home = None
        for d, at, (s0, s1, z0, z1) in planes:
            depth = at - c.dot(d)
            u = c.dot(Vector((0, 0, 1)).cross(d))
            if depth < -0.05 or depth > FACADE_SKIN or not (s0 - 0.05 <= u <= s1 + 0.05 and z0 - 0.05 <= c.z <= z1 + 0.05):
                continue
            facing = f.normal.dot(d) > 0.95
            if home is None or (not facing, depth) < (not home[3], home[2]):
                home = (d, at, depth, facing)
        if home is None:
            continue
        d, at, depth, facing = home
        if k == 'wall':
            if facing and abs(depth) < 0.02:
                hulls.append((d, at, f.material_index, [v.co.copy() for v in f.verts]))
            drop.add(f)
        elif facing:
            # Flat on the wall as rectangles: a window's frame bars, its panes, a sill each become one
            side = Vector((0, 0, 1)).cross(d)
            us = [v.co.dot(side) for v in f.verts]
            zs = [v.co.z for v in f.verts]
            rects.setdefault((tuple(d), at, f.material_index, k), []).append([min(us), max(us), min(zs), max(zs)])
            drop.add(f)
        else:
            drop.add(f)
    bmesh.ops.delete(bm, geom=list(drop), context='FACES')
    for (dt, at, mat, k), boxes in rects.items():
        d = Vector(dt)
        side = Vector((0, 0, 1)).cross(d)
        # Details just in front of the wall, openings over them: the frame shows as a rim round the glass
        lift = 0.02 if k == 'opening' else 0.01
        for u0, u1, z0, z1 in _merge_touching(boxes, 0.03):
            corners = [(u0, z0), (u1, z0), (u1, z1), (u0, z1)]
            face = bm.faces.new([bm.verts.new(side * u + Vector((0, 0, z)) + d * (at + lift)) for u, z in corners])
            face.material_index = mat
            made.add(face)
            face.normal_update()
            if face.normal.dot(d) < 0:
                face.normal_flip()
    # One polygon per plane, wall material and connected piece (a wall, each balcony's parapet), the hull of its faces
    groups = {}
    for d, at, mat, pts in hulls:
        groups.setdefault((tuple(d), at, mat), []).append(pts)
    pieces = []
    for key, faces in groups.items():
        for piece in _connected(faces):
            pieces.append((key, piece))
    for (dt, at, mat), pts in pieces:
        d = Vector(dt)
        side = Vector((0, 0, 1)).cross(d)
        flat = [(p.dot(side), p.z) for p in pts]
        order = geometry.convex_hull_2d(flat)
        verts = [bm.verts.new(side * flat[i][0] + Vector((0, 0, flat[i][1])) + d * at) for i in order]
        face = bm.faces.new(verts)
        face.material_index = mat
        made.add(face)
        face.normal_update()
        if face.normal.dot(d) < 0:
            face.normal_flip()
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.faces.ensure_lookup_table()
    flat = {f.index for f in bm.faces if f in made}
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.validate()
    if rest < 1.0:
        # The rest decimated on its own, the facades as drawn: split, decimate, join
        whole = obj.copy()
        whole.data = obj.data.copy()
        bpy.context.collection.objects.link(whole)
        _delete_faces_where(whole, lambda poly: poly.index not in flat)
        _delete_faces_where(obj, lambda poly: poly.index in flat)
        decimate_keeping(obj, rest, check=False)
        bpy.ops.object.select_all(action='DESELECT')
        whole.select_set(True)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.join()
    lost = sorted(before - _faces_by_material(obj))
    if lost:
        raise RuntimeError('%s: the distance copy lost every face of %s' % (obj.name, ', '.join(lost)))


def _delete_faces_where(obj, gone):
    """Deletes the faces of `obj` for which `gone(polygon)` holds (by the mesh's polygons, before any change)"""
    indices = {p.index for p in obj.data.polygons if gone(p)}
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index in indices], context='FACES')
    bm.to_mesh(obj.data)
    bm.free()


def _connected(faces):
    """Faces (lists of corner points) that share a corner, joined: the points of each connected piece"""
    key = lambda p: (round(p.x, 3), round(p.y, 3), round(p.z, 3))
    parent = list(range(len(faces)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    owner = {}
    for i, pts in enumerate(faces):
        for p in pts:
            j = owner.setdefault(key(p), i)
            parent[root(i)] = root(j)
    pieces = {}
    for i, pts in enumerate(faces):
        pieces.setdefault(root(i), []).extend(pts)
    return list(pieces.values())


def _merge_touching(boxes, gap):
    """Rectangles [u0, u1, z0, z1] that overlap or come within `gap` of each other, merged into their bounds"""
    boxes = [list(b) for b in boxes]
    merged = True
    while merged:
        merged = False
        out = []
        for b in boxes:
            for o in out:
                if b[0] <= o[1] + gap and o[0] <= b[1] + gap and b[2] <= o[3] + gap and o[2] <= b[3] + gap:
                    o[0], o[1], o[2], o[3] = min(o[0], b[0]), max(o[1], b[1]), min(o[2], b[2]), max(o[3], b[3])
                    merged = True
                    break
            else:
                out.append(b)
        boxes = out
    return boxes


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
        # The ring runs counter-clockwise about the tube's direction: in that order the cap faces out of the end
        f = bm.faces.new(rings[-1][:-1])
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

def plain_texel(obj, bm, uv):
    """UV of a texel with the scan's average colour: of 400 corners spread over the mesh, the one whose
    base colour texel is nearest the mean of them all"""
    import numpy as np
    img = next((n.image for m in obj.data.materials if m and m.use_nodes for n in m.node_tree.nodes
                if n.type == 'TEX_IMAGE' and n.image and n.image.colorspace_settings.name == 'sRGB'), None)
    if img is None or img.size[0] == 0:
        return None
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[:, :, :3]
    corners = [l[uv].uv.copy() for f in bm.faces for l in f.loops]
    picks = corners[::max(1, len(corners) // 400)]
    cols = np.array([px[min(h - 1, int((c.y % 1) * h)), min(w - 1, int((c.x % 1) * w))] for c in picks])
    best = int(np.argmin(((cols - cols.mean(axis=0)) ** 2).sum(axis=1)))
    return picks[best]


def close_shell(obj):
    """Close a scanned shell: a cliff scan is its face and top only, open behind and underneath, a boulder scan
    can be open underneath, so from above, behind or downhill one looked into it (or through it, onto the ground). Every open rim gets a fan to a
    tip behind it, so the surface has no edge left and hides its inside from every side. The caps read
    one texel of the scan, the one nearest its average colour: an atlas smears across new faces."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # Split vertices along UV seams are no holes
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    uv = bm.loops.layers.uv.active
    plain = plain_texel(obj, bm, uv) if uv else None
    rim = {e for e in bm.edges if e.is_boundary}
    added = 0
    while rim:
        # One closed rim: walk from edge to edge over the rim vertices
        loop = [rim.pop()]
        v = loop[0].verts[1]
        while True:
            e = next((x for x in v.link_edges if x in rim), None)
            if e is None:
                break
            rim.discard(e)
            loop.append(e)
            v = e.other_vert(v)
        # The tip under the rim's middle, as far back and as low as the rim reaches: from the middle itself
        # the fan of the open back cut through the curved face in front of it, and a low tip keeps the
        # back steep, in the slope behind the rock and not over it
        tip = sum((e.verts[0].co for e in loop), Vector()) / len(loop)
        span = max(max(e.verts[0].co[i] for e in loop) - min(e.verts[0].co[i] for e in loop) for i in (0, 1))
        rise = max(e.verts[0].co.z for e in loop) - min(e.verts[0].co.z for e in loop)
        if rise > span * 0.1:
            tip.y = max(e.verts[0].co.y for e in loop)
        # A flat rim is an underside (a boulder scan cut off at the ground): its cap from the middle, at the rim's
        # lowest point, so it stays a floor and does not fold over itself
        tip.z = min(e.verts[0].co.z for e in loop)
        apex = bm.verts.new(tip)
        for e in loop:
            # The face's own winding over the edge, reversed for the cap
            f = e.link_faces[0]
            l = next(x for x in f.loops if x.edge == e)
            a, b = l.vert, l.link_loop_next.vert
            tri = bm.faces.new((b, a, apex))
            tri.smooth = True
            added += 1
            if plain:
                for c in tri.loops:
                    c[uv].uv = plain
    bm.to_mesh(obj.data)
    bm.free()
    print('closed', obj.name, added, 'cap triangles')


def import_model(asset, target_height, target_faces, name, desaturate=0.0, tint=None, objects=None, rot=0.0,
                 keep_scale=False, ground=False, close=False, extra=None):
    """A Poly Haven glTF as one game model: joined, decimated to `target_faces`, base centre at the
    origin and scaled to `target_height` (None or keep_scale: the scan's own metres).

    `objects`: names (or name prefixes ending in `*`) of the meshes to keep, for sets and kits;
    `rot`: degrees around the up axis (front towards -Y); `tint`: RGB multiplier of the colour
    textures after `desaturate`; `ground`: sink the base so the lowest 3 % of vertices sit under 0
    (rocks on uneven terrain); `close`: fill the open back and underside of a scanned face (close_shell);
    `extra(obj)`: last edits before the export, may return more objects
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
    if close:
        close_shell(obj)
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
    if ground and len(objects) == 1 and len(obj.data.polygons) > 1000:
        # Rocks are placed by the hundred: a 300-triangle copy for distance
        export_lod(name, obj, ratio=300 / len(obj.data.polygons))
    return obj
