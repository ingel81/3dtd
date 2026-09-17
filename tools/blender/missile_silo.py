"""Missile silo: public/assets/models/buildings/missile_silo.glb.

Turns a textured source model of the Nuclear Strike's building (a square
bunker with two opened dome doors and a missile standing in the shaft in its
middle; one material with one base colour texture) into the game's GLB with
two nodes under the root `missile_silo`:

  silo      the building without the missile. Origin in the middle of the
            footprint, y = 0 at its lowest point.
  missile   the missile alone. Origin in the middle of its bottom (the nozzle
            exit), axis +Y. The node's translation is where it stands in the
            silo, so the GLB as it is shows the missile in its place.

The source fuses the missile's foot to the shaft floor, so the split is
geometric (all lengths in the source's model units, measured after the model
is moved onto its footprint):
  1. Hull: flood from the nose (the highest vertex near the axis) over the
     faces that lie fully within --radius of the axis. Loose parts that lie
     fully within that radius and the hull's height join it (details on the
     hull the source did not weld).
  2. Cut: a horizontal plane --cut above the highest vertex of the seam where
     the hull meets the rest. Above it the missile, below it a stub that stays
     on the shaft floor as the silo's launch pad.
  3. Closing: the pad gets a flat disc, the missile a flat base and a nozzle
     bell, since the flight shows it from below. The added faces take one
     colour each, the texture under the UV of a dark, even face of the same
     part.

Normals: the source's corner normals are carried through the cut, the added
faces are flat (the nozzle smooth round its axis).

Texture: the source's base colour scaled to --tex-size, stored as JPEG in the
GLB. Material like the other buildings: metallic 0, roughness 0.5; double
sided, as the source's surface has gaps. No Draco, the game loads buildings
with a plain GLTFLoader (AssetManagerService).

The first version came from tmp/Meshy_AI_Iron_Citadel_Missile__0916151112_texture.blend
(Meshy AI, not in git). A new version of the source: rerun with its path, check
the renders, adjust --radius (misses parts of the missile or takes parts of the
shaft) or --cut (the cut runs through the seam), and update the config values
the script prints (TOWER_TYPES).

Headless, without the add-ons of the user's settings (the Blender MCP would open
its server a second time):
    blender --background --factory-startup --python tools/blender/missile_silo.py -- \\
        --input <source.blend|.glb|.gltf> [--output <glb>] [--radius 0.25] [--cut 0.01] \\
        [--axis 0,0] [--tex-size 2048] [--jpeg-quality 85] [--width 14] [--render <dir>]

  --input         source model: all mesh objects of a .blend, or a .glb/.gltf
  --output        default public/assets/models/buildings/missile_silo.glb
  --radius        radius of the missile's cylinder round the axis
  --cut           height of the cut above the seam's highest vertex
  --axis X,Y      the missile's axis on the footprint (Blender x, y from the
                  footprint's middle), default its middle
  --tex-size      edge of the stored texture in pixels
  --jpeg-quality  JPEG quality of the stored texture (0 to 100)
  --width         building width in metres the printed config values are for
  --render DIR    import the written GLB into an empty scene and render check
                  images (Eevee) of the silo, the missile and both to DIR
"""
import argparse
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_OUTPUT = os.path.join(REPO, 'public/assets/models/buildings/missile_silo.glb')

ROUGHNESS = 0.5
# Nose search: vertices this close to the axis, as a share of --radius
NOSE_REACH = 0.25
# Colour picks for the added faces: luminance (0 to 1) of the texture they
# aim for, and the half edge of the sampled window in pixels of the source
PAD_LUMA = 0.10
BASE_LUMA = 0.12
NOZZLE_INNER_LUMA = 0.03
SAMPLE_HALF = 4

# Nozzle, in shares of the missile's body radius
NOZZLE_THROAT = 0.45
NOZZLE_EXIT = 0.72
NOZZLE_LENGTH = 0.6
NOZZLE_WALL = 0.07
NOZZLE_SEGMENTS = 24


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser(prog='missile_silo.py')
    p.add_argument('--input', required=True)
    p.add_argument('--output', default=DEFAULT_OUTPUT)
    p.add_argument('--radius', type=float, default=0.25)
    p.add_argument('--cut', type=float, default=0.01)
    p.add_argument('--axis', default='0,0')
    p.add_argument('--tex-size', type=int, default=2048)
    p.add_argument('--jpeg-quality', type=int, default=85)
    p.add_argument('--width', type=float, default=14.0)
    p.add_argument('--render', default=None)
    return p.parse_args(argv)


def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


# ── Source ──

def load_source(path):
    clear_scene()
    ext = os.path.splitext(path)[1].lower()
    if ext == '.blend':
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = list(src.objects)
        for ob in dst.objects:
            if ob is not None:
                bpy.context.scene.collection.objects.link(ob)
    elif ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        raise SystemExit(f'[silo] unsupported source {path}')
    bpy.context.view_layer.update()
    meshes = [ob for ob in bpy.context.scene.objects if ob.type == 'MESH']
    if not meshes:
        raise SystemExit(f'[silo] no mesh in {path}')
    return meshes


def source_image(meshes):
    images = set()
    for ob in meshes:
        for mat in ob.data.materials:
            if mat is None or mat.node_tree is None:
                continue
            images.update(n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
    if len(images) != 1:
        raise SystemExit(f'[silo] expected one texture in the source, found {len(images)}')
    return images.pop()


def source_bmesh(meshes):
    """All meshes in world space in one bmesh, their corner normals in the
    loop layers nx, ny, nz (bmesh keeps no custom normals of its own)."""
    bm = bmesh.new()
    layers = [bm.loops.layers.float.new(n) for n in ('nx', 'ny', 'nz')]
    for ob in meshes:
        me = ob.data.copy()
        me.transform(ob.matrix_world)
        normals = [c.vector.copy() for c in me.corner_normals]
        start = len(bm.faces)
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        for poly, face in zip(me.polygons, bm.faces[start:]):
            for k, loop in enumerate(face.loops):
                for layer, value in zip(layers, normals[poly.loop_start + k]):
                    loop[layer] = value
        bpy.data.meshes.remove(me)
    bm.verts.index_update()
    bm.faces.index_update()
    return bm


def onto_footprint(bm):
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    shift = Vector(((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)))
    bm.transform(Matrix.Translation(-shift))
    return shift


# ── Split ──

def linked_parts(faces):
    """Groups of the faces that share vertices."""
    parent = {f.index: f.index for f in faces}

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for v in {v for f in faces for v in f.verts}:
        linked = [f.index for f in v.link_faces if f.index in parent]
        for other in linked[1:]:
            parent[find(other)] = find(linked[0])
    groups = {}
    for f in faces:
        groups.setdefault(find(f.index), []).append(f)
    return list(groups.values())


def hull_faces(bm, axis, radius):
    bm.faces.ensure_lookup_table()

    def within(v):
        return math.hypot(v.co.x - axis.x, v.co.y - axis.y) < radius

    inside = {f.index for f in bm.faces if all(within(v) for v in f.verts)}
    nose = max((v for v in bm.verts if math.hypot(v.co.x - axis.x, v.co.y - axis.y) < radius * NOSE_REACH),
               key=lambda v: v.co.z, default=None)
    if nose is None:
        raise SystemExit('[silo] no vertex near the axis, check --axis and --radius')
    todo = [f.index for f in nose.link_faces if f.index in inside]
    hull = set(todo)
    while todo:
        f = bm.faces[todo.pop()]
        for e in f.edges:
            for g in e.link_faces:
                if g.index in inside and g.index not in hull:
                    hull.add(g.index)
                    todo.append(g.index)
    lo = min(v.co.z for i in hull for v in bm.faces[i].verts)
    hi = max(v.co.z for i in hull for v in bm.faces[i].verts)
    joined = 0
    for part in linked_parts(list(bm.faces)):
        ids = {f.index for f in part}
        if ids & hull or not ids <= inside:
            continue
        if all(lo <= v.co.z <= hi for f in part for v in f.verts):
            hull |= ids
            joined += 1
    print(f'[silo] hull: {len(hull)} faces, {joined} loose parts joined, nose at z {nose.co.z:.3f}')
    return hull


def seam_top(bm, hull):
    """Highest vertex on an edge between a hull face and another face."""
    top = None
    for e in bm.edges:
        inner = [f.index in hull for f in e.link_faces]
        if any(inner) and not all(inner):
            z = max(v.co.z for v in e.verts)
            top = z if top is None else max(top, z)
    return top


def cut_hull(bm, hull, cut_z):
    """Cuts the hull's faces at cut_z and marks the pieces above the cut, the
    missile, with 1 in the face layer 'missile'."""
    bm.faces.ensure_lookup_table()
    tag = bm.faces.layers.int.new('missile')
    faces = [bm.faces[i] for i in hull]
    for f in faces:
        f[tag] = 1
    geom = faces + list({e for f in faces for e in f.edges}) + list({v for f in faces for v in f.verts})
    # Split faces keep their layer values
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=(0, 0, cut_z), plane_no=(0, 0, 1))
    for f in bm.faces:
        if f[tag] and f.calc_center_median().z < cut_z:
            f[tag] = 0
    return sum(f[tag] for f in bm.faces)


def keep_faces(bm, missile):
    """Copy of the mesh with only the missile's faces, or only the others."""
    out = bm.copy()
    tag = out.faces.layers.int['missile']
    bmesh.ops.delete(out, geom=[f for f in out.faces if bool(f[tag]) != missile], context='FACES')
    bmesh.ops.delete(out, geom=[v for v in out.verts if not v.link_faces], context='VERTS')
    return out


def cut_loops(bm, cut_z, axis, radius):
    """Open edges on the cut, grouped into their loops."""
    edges = [e for e in bm.edges if e.is_boundary
             and all(abs(v.co.z - cut_z) < 1e-4 and math.hypot(v.co.x - axis.x, v.co.y - axis.y) < radius
                     for v in e.verts)]
    loops = []
    left = set(edges)
    while left:
        todo = [left.pop()]
        group = list(todo)
        while todo:
            e = todo.pop()
            for v in e.verts:
                for g in v.link_edges:
                    if g in left:
                        left.discard(g)
                        group.append(g)
                        todo.append(g)
        loops.append(group)
    return loops


# ── Closing ──

class Texture:
    def __init__(self, image):
        self.w, self.h = image.size
        px = np.empty(self.w * self.h * 4, dtype=np.float32)
        image.pixels.foreach_get(px)
        rgb = px.reshape(self.h, self.w, 4)[:, :, :3]
        self.luma = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

    def even_uv(self, faces, uv_layer, target):
        """UV of the face whose texture window is closest to the target luminance
        and most even."""
        best, best_uv = None, None
        for f in faces:
            uv = sum((l[uv_layer].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
            x, y = int(uv.x % 1 * self.w), int(uv.y % 1 * self.h)
            win = self.luma[max(y - SAMPLE_HALF, 0):y + SAMPLE_HALF + 1, max(x - SAMPLE_HALF, 0):x + SAMPLE_HALF + 1]
            score = abs(float(win.mean()) - target) + 2 * float(win.std())
            if best is None or score < best:
                best, best_uv = score, uv
        return best_uv


def orient(faces, want):
    for f in faces:
        f.normal_update()
        if f.normal.dot(want(f)) < 0:
            f.normal_flip()


def normal_layers(bm):
    return [bm.loops.layers.float[n] for n in ('nx', 'ny', 'nz')]


def set_flat(faces, uv_layer, uv, nlayers):
    for f in faces:
        f.smooth = False
        f.normal_update()
        for loop in f.loops:
            loop[uv_layer].uv = uv
            for layer, value in zip(nlayers, f.normal):
                loop[layer] = value


def close_cut(bm, name, cut_z, axis, radius, tex, luma):
    """Closes the open loops on the cut with flat faces, facing up on the
    silo's pad and down under the missile. Returns the added faces."""
    up = name == 'silo'
    loops = cut_loops(bm, cut_z, axis, radius)
    uv_layer = bm.loops.layers.uv.active
    near = [f for f in bm.faces if any(math.hypot(v.co.x - axis.x, v.co.y - axis.y) < radius for v in f.verts)]
    uv = tex.even_uv(near, uv_layer, luma)
    added = []
    for loop in loops:
        res = bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=loop,
                                      normal=(0, 0, 1 if up else -1))
        added += [g for g in res['geom'] if isinstance(g, bmesh.types.BMFace)]
    orient(added, lambda f: Vector((0, 0, 1 if up else -1)))
    set_flat(added, uv_layer, uv, normal_layers(bm))
    still_open = len(cut_loops(bm, cut_z, axis, radius))
    source_open = sum(e.is_boundary for e in bm.edges)
    print(f'[silo] {name}: {len(loops)} loops on the cut closed with {len(added)} faces, {still_open} left open; '
          f'{source_open} open edges of the source elsewhere')
    if not added or still_open:
        raise SystemExit(f'[silo] {name}: the cut is not closed, check --radius and --cut')
    return added


def base_centre(faces):
    """Area centroid of the missile's base and the median distance of its rim
    from it (the body's radius, fins count little)."""
    area = sum(f.calc_area() for f in faces)
    centre = sum((f.calc_center_median() * f.calc_area() for f in faces), Vector()) / area
    rim = {v for f in faces for v in f.verts}
    return centre, float(np.median([(v.co.xy - centre.xy).length for v in rim]))


def straighten(bm, centre):
    """Turns the missile round its base centre so that the nose stands right
    above it. Returns the angle in degrees."""
    nose = max(bm.verts, key=lambda v: v.co.z)
    axis = nose.co - centre
    turn = axis.rotation_difference(Vector((0, 0, 1)))
    bm.transform(Matrix.Translation(centre) @ turn.to_matrix().to_4x4() @ Matrix.Translation(-centre))
    nlayers = normal_layers(bm)
    for f in bm.faces:
        for loop in f.loops:
            n = turn @ Vector([loop[layer] for layer in nlayers])
            for layer, value in zip(nlayers, n):
                loop[layer] = value
    return math.degrees(axis.angle(Vector((0, 0, 1))))


def add_nozzle(bm, centre, body_r, uv_outer, uv_inner):
    """Bell under the missile's base: outer wall from the throat (a little
    inside the base) to the exit, a lip, the inner wall back up and a disc
    closing the throat. Returns the exit's height."""
    uv_layer = bm.loops.layers.uv.active
    nlayers = normal_layers(bm)
    r_t, r_e = NOZZLE_THROAT * body_r, NOZZLE_EXIT * body_r
    length, wall = NOZZLE_LENGTH * body_r, NOZZLE_WALL * body_r
    ts = (0.0, 0.35, 0.7, 1.0)

    def ring(r, z):
        return [bm.verts.new((centre.x + r * math.cos(a), centre.y + r * math.sin(a), z))
                for a in (2 * math.pi * k / NOZZLE_SEGMENTS for k in range(NOZZLE_SEGMENTS))]

    def bell_r(t):
        return r_t + (r_e - r_t) * t ** 1.6

    outer = [ring(r_t, centre.z + 0.05 * body_r)] + [ring(bell_r(t), centre.z - length * t) for t in ts[1:]]
    inner = [ring(bell_r(t) - wall, centre.z - length * t) for t in reversed(ts[1:])]
    rings = outer + inner
    faces_out, faces_in = [], []
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(NOZZLE_SEGMENTS):
            k1 = (k + 1) % NOZZLE_SEGMENTS
            f = bm.faces.new((a[k], a[k1], b[k1], b[k]))
            (faces_out if i < len(outer) - 1 else faces_in).append(f)
    lip = faces_in[:NOZZLE_SEGMENTS]
    walls_in = faces_in[NOZZLE_SEGMENTS:]
    mid = bm.verts.new((centre.x, centre.y, rings[-1][0].co.z))
    disc = [bm.faces.new((rings[-1][k], rings[-1][(k + 1) % NOZZLE_SEGMENTS], mid)) for k in range(NOZZLE_SEGMENTS)]

    def radial(f, sign):
        c = f.calc_center_median()
        return Vector((c.x - centre.x, c.y - centre.y, 0)) * sign

    orient(faces_out, lambda f: radial(f, 1))
    orient(walls_in, lambda f: radial(f, -1))
    orient(lip + disc, lambda f: Vector((0, 0, -1)))
    set_flat(lip + disc, uv_layer, uv_outer, nlayers)
    set_flat(disc, uv_layer, uv_inner, nlayers)
    for faces, sign, uv in ((faces_out, 1, uv_outer), (walls_in, -1, uv_inner)):
        for f in faces:
            f.smooth = True
            for loop in f.loops:
                loop[uv_layer].uv = uv
                n = Vector((loop.vert.co.x - centre.x, loop.vert.co.y - centre.y, 0)).normalized() * sign
                for layer, value in zip(nlayers, n):
                    loop[layer] = value
    return rings[len(outer) - 1][0].co.z


# ── Output ──

def material(image, tex_size):
    if image.size[0] != tex_size or image.size[1] != tex_size:
        image = image.copy()
        image.scale(tex_size, tex_size)
    mat = bpy.data.materials.new('MissileSilo')
    # Double sided: the source has open edges (small gaps between its plates)
    # that single sided faces show as holes to the sky
    mat.use_backface_culling = False
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = ROUGHNESS
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def to_object(bm, name, mat, parent, origin):
    bm.transform(Matrix.Translation(-origin))
    nlayers = normal_layers(bm)
    normals = [Vector([loop[layer] for layer in nlayers]).normalized() for f in bm.faces for loop in f.loops]
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    for n in ('nx', 'ny', 'nz'):
        if n in me.attributes:
            me.attributes.remove(me.attributes[n])
    me.normals_split_custom_set(normals)
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    ob.location = origin
    return ob


def export(objects, path, quality):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for ob in bpy.context.scene.objects:
        ob.select_set(ob in objects)
    bpy.context.view_layer.objects.active = objects[0]
    options = dict(
        export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_image_format='JPEG', export_jpeg_quality=quality, export_image_quality=quality,
        export_attributes=False, export_animations=False, export_draco_mesh_compression_enable=False,
        export_extras=False, export_all_vertex_colors=False, export_vertex_color='NONE',
        export_cameras=False, export_lights=False)
    known = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    bpy.ops.export_scene.gltf(filepath=path, **{k: v for k, v in options.items() if k in known})


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def texels_per_unit(ob, tex_size):
    """Mean texture density over the surface: texels per model unit."""
    me = ob.data
    uv = me.uv_layers.active.data
    area_3d = area_uv = 0.0
    for p in me.polygons:
        pts = [uv[i].uv for i in p.loop_indices]
        area_uv += abs(sum(a.x * b.y - b.x * a.y for a, b in zip(pts, pts[1:] + pts[:1]))) / 2
        area_3d += p.area
    return math.sqrt(area_uv / area_3d) * tex_size


def report(silo, missile, plate_z, tilt, path, tex_size, width_m):
    """Sizes in model units along the glTF axes (x, y up, z) and config
    values for a building width_m metres wide."""
    sv = [v.co for v in silo.data.vertices]
    mv = [v.co for v in missile.data.vertices]
    wx = max(c.x for c in sv) - min(c.x for c in sv)
    wz = max(c.y for c in sv) - min(c.y for c in sv)
    top = max(c.z for c in sv)
    scale = width_m / max(wx, wz)
    reach = max(math.hypot(c.x, c.y) for c in sv)
    base = missile.location
    tip = base.z + max(c.z for c in mv)
    span = 2 * max(math.hypot(c.x, c.y) for c in mv)
    density = texels_per_unit(silo, tex_size) / scale
    print(f'[silo] {path}: {os.path.getsize(path) / 1024:.0f} KB, texture {tex_size} JPEG, '
          f'{density:.0f} texels per metre at {width_m:g} m')
    print(f'[silo] silo: {tris(silo)} tris, width x {wx:.3f} z {wz:.3f}, top y {top:.3f}, '
          f'widest vertex {reach:.3f} from the origin')
    print(f'[silo] missile: {tris(missile)} tris, node translation ({base.x:.4f}, {base.z:.4f}, {-base.y:.4f}), '
          f'bottom (nozzle exit) y {base.z:.3f}, base plate y {plate_z:.3f}, tip y {tip:.3f}, '
          f'length {tip - base.z:.3f}, span {span:.3f} (fins), straightened by {tilt:.2f} deg')
    print(f'[silo] config for {width_m:g} m: scale {scale:.2f}, heightOffset 0, footprintRadius {reach * scale:.2f}; '
          f'missile bottom {base.z * scale:.2f} m, base plate {plate_z * scale:.2f} m, tip {tip * scale:.2f} m, '
          f'length {(tip - base.z) * scale:.2f} m, span {span * scale:.2f} m')


# ── Check renders ──

def render_checks(glb, out_dir):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=glb)
    scn = bpy.context.scene
    silo, missile = bpy.data.objects['silo'], bpy.data.objects['missile']
    print(f'[silo] reimport: missile at {tuple(round(c, 4) for c in missile.matrix_world.translation)}')
    for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            scn.render.engine = engine
            break
        except TypeError:
            pass
    size = 800
    scn.render.resolution_x = scn.render.resolution_y = size
    scn.world = scn.world or bpy.data.worlds.new('World')
    scn.world.use_nodes = True
    bg = next(n for n in scn.world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs[0].default_value = (0.6, 0.65, 0.7, 1)
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    scn.collection.objects.link(sun)
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(40), 0, math.radians(30))
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    scn.collection.objects.link(cam)
    scn.camera = cam
    os.makedirs(out_dir, exist_ok=True)
    names = []

    def shot(name, loc, target, show_silo=True, show_missile=True):
        silo.hide_render = not show_silo
        missile.hide_render = not show_missile
        cam.location = loc
        cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(out_dir, name + '.png')
        bpy.ops.render.render(write_still=True)
        names.append(name)

    # Blender axes after the import: -y is the glTF +z
    mz = missile.matrix_world.translation.z
    shot('both_iso', (2.6, -2.6, 2.6), (0, 0, 0.5))
    shot('silo_iso', (2.6, -2.6, 2.6), (0, 0, 0.5), show_missile=False)
    shot('silo_shaft', (0.25, -0.35, 1.3), (0, 0, mz), show_missile=False)
    for name, (dx, dy) in (('silo_plus_z', (0, -1)), ('silo_plus_x', (1, 0)),
                           ('silo_minus_z', (0, 1)), ('silo_minus_x', (-1, 0))):
        shot(name, (3.4 * dx, 3.4 * dy, 1.0), (0, 0, 0.6), show_missile=False)
    shot('missile_side', (0, -1.5, mz + 0.45), (0, 0, mz + 0.45), show_silo=False)
    shot('missile_side_x', (1.5, 0, mz + 0.45), (0, 0, mz + 0.45), show_silo=False)
    shot('missile_below', (0.6, -0.6, mz - 0.55), (0, 0, mz + 0.3), show_silo=False)
    shot('missile_bottom', (0.03, -0.03, mz - 0.7), (0, 0, mz), show_silo=False)

    # All shots at half size on one sheet
    cols, half = 4, size // 2
    rows = -(-len(names) // cols)
    sheet = np.zeros((rows * half, cols * half, 4), dtype=np.float32)
    sheet[..., 3] = 1
    for i, name in enumerate(names):
        img = bpy.data.images.load(os.path.join(out_dir, name + '.png'))
        px = np.empty(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(half, 2, half, 2, 4).mean(axis=(1, 3))
        row, col = rows - 1 - i // cols, i % cols
        sheet[row * half:(row + 1) * half, col * half:(col + 1) * half] = px
    out = bpy.data.images.new('sheet', cols * half, rows * half, alpha=True)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = os.path.join(out_dir, 'sheet.png')
    out.file_format = 'PNG'
    out.save()
    print(f'[silo] renders in {out_dir}: {", ".join(names)}, sheet.png')


def main():
    args = parse_args()
    axis = Vector([float(c) for c in args.axis.split(',')])
    meshes = load_source(os.path.abspath(args.input))
    image = source_image(meshes)
    bm = source_bmesh(meshes)
    shift = onto_footprint(bm)
    print(f'[silo] source {args.input}: {len(bm.faces)} faces, moved by {tuple(round(c, 4) for c in -shift)}')

    hull = hull_faces(bm, axis, args.radius)
    seam = seam_top(bm, hull)
    cut_z = seam + args.cut
    count = cut_hull(bm, hull, cut_z)
    print(f'[silo] seam top {seam:.3f}, cut at {cut_z:.3f}, {count} missile faces')

    tex = Texture(image)
    bm_silo = keep_faces(bm, False)
    bm_missile = keep_faces(bm, True)
    bm.free()

    close_cut(bm_silo, 'silo', cut_z, axis, args.radius, tex, PAD_LUMA)
    base = close_cut(bm_missile, 'missile', cut_z, axis, args.radius, tex, BASE_LUMA)
    centre, body_r = base_centre(base)
    tilt = straighten(bm_missile, centre)
    uv_layer = bm_missile.loops.layers.uv.active
    exit_z = add_nozzle(bm_missile, centre, body_r,
                        tex.even_uv(bm_missile.faces, uv_layer, BASE_LUMA),
                        tex.even_uv(bm_missile.faces, uv_layer, NOZZLE_INNER_LUMA))

    mat = material(image, args.tex_size)
    root = bpy.data.objects.new('missile_silo', None)
    bpy.context.scene.collection.objects.link(root)
    silo = to_object(bm_silo, 'silo', mat, root, Vector())
    missile = to_object(bm_missile, 'missile', mat, root, Vector((centre.x, centre.y, exit_z)))
    bm_silo.free()
    bm_missile.free()
    export([root, silo, missile], os.path.abspath(args.output), args.jpeg_quality)
    report(silo, missile, cut_z, tilt, args.output, args.tex_size, args.width)
    if args.render:
        render_checks(os.path.abspath(args.output), os.path.abspath(args.render))


if __name__ == '__main__':
    main()
