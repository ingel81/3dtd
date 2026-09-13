"""Optimise enemy models for the VAT renderer (docs/ENEMY_MODEL_BUDGET.md).

Each recipe below reads the original model from git (SOURCE_REV), so a rerun
gives the same file instead of optimising an already optimised one, and writes
the result into public/assets/models/enemies/.

Headless:
    blender --background --python tools/blender/optimize_enemy.py -- rat spider
From a running Blender (Text editor or the Blender MCP):
    REPO = r'D:/Source/3dtd'
    exec(open(REPO + '/tools/blender/optimize_enemy.py').read()); run('rat')

After a run: `npm run model-budget` measures the new file and fails if a clip
the config expects is missing.
"""
import fnmatch
import math
import os
import subprocess
import sys
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

# Commit that holds the original models.
SOURCE_REV = '39fbb18'
ENEMIES = 'public/assets/models/enemies'

# Recipe keys (all optional except `src`):
#   src         model path in the repo at SOURCE_REV
#   extra       further files the importer needs next to it (external textures)
#   out         output path in the repo (default: src with .glb)
#   actions     {source action: exported clip name}; every other action is dropped
#   trim        {exported clip name: (start frame, end frame, blend frames)}, see trim_action
#   decimate    triangle ratio kept by the collapse decimator, for every mesh or
#               {mesh name pattern: ratio}, first matching fnmatch pattern wins
#   seams       {mesh name pattern: weight}: vertices on UV seams get this weight in
#               an inverted decimate vertex group, so the decimator collapses them
#               later and fewer triangles span two UV islands (see decimate)
#   weld        merge vertices closer than this (model units) before decimating;
#               for meshes the importer leaves as a triangle soup because the
#               normals differ slightly across UV seams
#   normals     'keep' (default), 'smooth' or a smoothing angle in degrees
#   rebake      {'size', 'supersample'}: after decimating, new UVs and the base
#               colour taken from the undecimated mesh (see rebake_base_color); for
#               atlases whose seams the decimator cannot keep
#   merge       merge co-located vertices with equal normals on import (glTF
#               importer option), also without decimating
#   texture     longest side of every image left in the model
#   base_color_only  drop every other texture (the VAT shader only samples base colour)
#   image_format     'AUTO' (default) or 'JPEG'
#   sample      resample every frame on export (default False: write the source
#               keys, so clip lengths like 58.75 frames stay exact)
#   slide       shift every clip to start at 0 (default False: keep the key times)
#   guess_bind_pose  glTF importer option (default True); False for rigs whose
#               bind pose the importer guesses wrong (the rat's Sketchfab rig)
#   rest_from_file   write the file's node transforms as the rest pose, not the
#               bind pose the importer guessed (see keep_file_rest_pose)
RECIPES = {
    # FBXLoader builds three vertices per triangle (17,010); as indexed GLB the
    # same mesh is 3,444. Only the clips the config uses stay.
    'wallsmasher': {
        'src': f'{ENEMIES}/wallsmasher.fbx',
        'extra': [f'{ENEMIES}/Zombie_Atlas.png'],
        'out': f'{ENEMIES}/wallsmasher.glb',
        'actions': {
            'CharacterArmature|CharacterArmature|Walk': 'CharacterArmature|Walk',
            'CharacterArmature|CharacterArmature|Run': 'CharacterArmature|Run',
            'CharacterArmature|CharacterArmature|Death': 'CharacterArmature|Death',
        },
        # The FBX clips start at frame 1.
        'sample': True,
        'slide': True,
    },
    # 16 rigid meshes under animated empties (object-animation VAT path). Every
    # empty carries one mesh (the head two, with different materials), so there
    # is nothing to merge. The four wings are flat 266-vertex cards and stay.
    # Without seam weights the head texture tore into black stripes across the
    # mandibles.
    'hornet': {
        'src': f'{ENEMIES}/hornet.glb',
        'decimate': {'wing01_wings_0*': 1.0, '*': 0.036},
        'seams': {'*Hornet1*': 0.5},
        'normals': 'smooth',
    },
    # Swarm enemy, up to 5,000 per wave. The shader samples the base colour
    # only; the metal-roughness and normal maps (1024² each) go. Not exact:
    # with the bind pose guess this rig exports broken, without it Blender's
    # Run differs from the file between the keys (up to 9.4 % of the height
    # at frames 3 and 7 of 11, upper hind body), whatever the export options.
    'rat': {
        'src': f'{ENEMIES}/rat.glb',
        'guess_bind_pose': False,
        'decimate': 0.42,
        'normals': 'smooth',
        'base_color_only': True,
        'texture': 512,
        'image_format': 'JPEG',
    },
    # Swarm enemy, up to 800 per wave. Body 12,833 and eyes 340 vertices; the
    # config plays only the basic walk, the other five cycles go. At 8 % the
    # legs turn into triangular prisms and the eyes vanish, so the body keeps
    # 11 % (above the 1,500 swarm guideline) and the eyes (Object_10) 30 %.
    'spider': {
        'src': f'{ENEMIES}/spider.glb',
        'actions': {'Armature|Walk-Cycle-Basic': 'Armature|Walk-Cycle-Basic'},
        'decimate': {'Object_10': 0.3, '*': 0.11},
        'normals': 'smooth',
    },
    # Three 2048² JPEGs (base colour, metal-roughness, normal) for a bat the
    # size of a pigeon; the shader samples the base colour only. `fly` is a
    # single-frame clip nothing plays. Geometry stays as it is.
    'bat': {
        'src': f'{ENEMIES}/bat.glb',
        'actions': {'fly.001': 'fly.001'},
        'base_color_only': True,
        'texture': 512,
        'image_format': 'JPEG',
    },
    # `flying` (13.13 s) is two copies of a 99-frame flight cycle (3.3 s);
    # shorter windows do not repeat (7 % of the height off at 1 s). Frames
    # 158-257 differ by 0.21 %, eased over the last 4 frames. The config
    # plays only `flying`.
    'dragon': {
        'src': f'{ENEMIES}/dragon.glb',
        'actions': {'flying': 'flying'},
        'trim': {'flying': (158, 257, 4)},
    },
    # 31,342 VAT vertices for 30,887 triangles: UV seams split almost every
    # edge, and the importer keeps the mesh as a triangle soup (normals differ
    # slightly across the seams). Welded first, the decimator works on the
    # connected surface (15,418 positions). 62 % of those sit on UV seams, so
    # seam weights cannot help; decimated on the old atlas the texture smeared
    # along the seams. Rebaked onto new UVs instead, 12 % stays under 5,000
    # VAT vertices (the new UVs split less). Electrocuted_Fall (6.33 s)
    # stands twitching until 3.0 s and hits the ground at about 5 s; the enemy
    # is removed 2 s after the kill, so only the fall, 3.0-5.0 s, is kept.
    'zombie-v2': {
        'src': f'{ENEMIES}/zombie_v2.glb',
        'actions': {'Unsteady_Walk': 'Unsteady_Walk', 'Dead': 'Dead', 'dying_backwards': 'dying_backwards',
                    'Electrocuted_Fall': 'Electrocuted_Fall'},
        'trim': {'Electrocuted_Fall': (90, 150, 0)},
        'weld': 1e-6,
        'decimate': 0.12,
        'normals': 'smooth',
        'rebake': {'size': 1024, 'supersample': 2},
    },
    # Look change: the zombie is faceted, every vertex split at the normals
    # (4,525 VAT vertices for 2,157 triangles). Welded and smooth-shaded it
    # keeps only the UV splits. Geometry, texture and clips stay.
    'zombie': {
        'src': f'{ENEMIES}/zombie.glb',
        'weld': 1e-6,
        'normals': 'smooth',
        # Walk leaves 20 bones unkeyed; with the guessed bind pose as rest they moved.
        'rest_from_file': True,
    },
    # Split at UV seams like zombie_v2 (19,863 positions, 30,228 vertices). The
    # seams keep about 2.5 vertices per position after decimating, so 17 % ends
    # at 8,126 VAT vertices; 10.5 % (5,799) smeared the ribcage in a close-up.
    # Neither fix used for zombie_v2 and the hornet helps here: 41 % of the
    # vertices sit on seams, so seam weights change nothing, and a Cycles bake onto
    # the thin double-layered robe came out dark with more VAT vertices.
    'wraith': {
        'src': f'{ENEMIES}/wraith.glb',
        'weld': 1e-6,
        'decimate': 0.17,
        'normals': 'smooth',
    },
    # Swarm enemy. Three 1024² PNGs, the shader samples the base colour only;
    # it keeps its alpha (the material blends), so it stays PNG. Of five clips
    # the config plays Walk and Fall. Exact only with the file's node pose.
    'penguin': {
        'src': f'{ENEMIES}/penguin.glb',
        'actions': {'Walk': 'Walk', 'Fall': 'Fall'},
        'base_color_only': True,
        'texture': 512,
        'rest_from_file': True,
    },
    # Twelve clips, the config plays Walk and Die. Geometry and textures stay.
    # The default import moves the rig; with the file's node pose it is exact.
    'mammoth': {
        'src': f'{ENEMIES}/mammoth.glb',
        'actions': {'Walk': 'Walk', 'Die': 'Die'},
        'rest_from_file': True,
    },
    # Casual_Walk (4.17 s) jumps by 3.2 % of the height where it loops. The
    # window 50-90 (1.33 s, a whole number of 30 fps frames on the 24 fps key
    # raster) jumps by 1.2 %; the last 7.5 frames ease into the first pose.
    # Base colour and emission (the same image twice) 2048² -> 1024²; of six
    # clips the config plays two.
    'stone-golem': {
        'src': f'{ENEMIES}/stone_golem.glb',
        'actions': {'Casual_Walk': 'Casual_Walk', 'dying_backwards': 'dying_backwards'},
        'trim': {'Casual_Walk': (50, 90, 7.5)},
        'texture': 1024,
    },
    # Static, seven material colours, no texture. The file stores 319
    # vertices twice (same position, normal and UV); merged on import they
    # are written once, positions and normals as before (the faceted look
    # stays). Welding by position instead changed the normals of 12 vertices
    # by up to 47 degrees.
    'tank': {
        'src': f'{ENEMIES}/tank.glb',
        'merge': True,
    },
    # No mech recipe: its round trip is exact only without the bind pose guess,
    # and decimating the 34 hard-surface parts to 12 % (6,739 VAT vertices, not
    # 5,000) left shards and texture seams; mech_army stays at 4.2 million.
}


def repo_root():
    if 'REPO' in globals():
        return globals()['REPO']
    return os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def git_export(repo, path, dest_dir):
    """Write `path` as it is at SOURCE_REV into dest_dir, return the file path."""
    data = subprocess.run(['git', '-C', repo, 'show', f'{SOURCE_REV}:{path}'],
                          check=True, capture_output=True).stdout
    dest = os.path.join(dest_dir, os.path.basename(path))
    with open(dest, 'wb') as f:
        f.write(data)
    return dest


def clear_scene():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.armatures, bpy.data.actions,
                 bpy.data.materials, bpy.data.images, bpy.data.textures, bpy.data.node_groups,
                 bpy.data.cameras, bpy.data.lights):
        for block in list(coll):
            coll.remove(block)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


def import_model(path, merge_vertices, guess_bind_pose=True):
    if path.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        # No bone shapes: the importer would add an Icosphere mesh that ends up in the export.
        bpy.ops.import_scene.gltf(filepath=path, merge_vertices=merge_vertices, disable_bone_shape=True,
                                  guess_original_bind_pose=guess_bind_pose)


def keep_actions(mapping):
    for act in list(bpy.data.actions):
        if act.name not in mapping:
            bpy.data.actions.remove(act)
    for act in list(bpy.data.actions):
        act.name = mapping[act.name]
        act.use_fake_user = True
    missing = set(mapping.values()) - {a.name for a in bpy.data.actions}
    if missing:
        raise RuntimeError(f'actions not found: {sorted(missing)}')


def trim_action(act, start, end, blend=0):
    """Keep the keys in [start, end] (frames) and move them to start at 0.

    With `blend` > 0 the last `blend` frames are eased (smoothstep) towards the
    pose at `start`, so the clip ends where it begins and loops without a jump.
    Expects keys on every frame of the window, as glTF imports of baked clips
    have them.
    """
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                groups = {}
                for fc in cb.fcurves:
                    groups.setdefault(fc.data_path, []).append(fc)
                for path, fcs in groups.items():
                    fcs.sort(key=lambda f: f.array_index)
                    first = [fc.evaluate(start) for fc in fcs]
                    last = [fc.evaluate(end) for fc in fcs]
                    quat = path.endswith('rotation_quaternion') and len(fcs) == 4
                    if quat and sum(a * b for a, b in zip(first, last)) < 0:
                        first = [-x for x in first]
                    delta = [a - b for a, b in zip(first, last)]
                    by_frame = {}
                    for i, fc in enumerate(fcs):
                        pts = fc.keyframe_points
                        for p in reversed(list(pts)):
                            if p.co.x < start - 1e-3 or p.co.x > end + 1e-3:
                                pts.remove(p, fast=True)
                        for p in pts:
                            by_frame.setdefault(round(p.co.x, 3), [None] * len(fcs))[i] = p
                    for frame, pts in by_frame.items():
                        w = 0.0
                        if blend and frame > end - blend:
                            t = (frame - (end - blend)) / blend
                            w = t * t * (3 - 2 * t)
                        if w and all(pts):
                            vals = [p.co.y + d * w for p, d in zip(pts, delta)]
                            if quat:
                                n = sum(v * v for v in vals) ** 0.5
                                vals = [v / n for v in vals]
                            for p, v in zip(pts, vals):
                                p.co.y = v
                        for p in pts:
                            if p is None:
                                continue
                            p.co.x -= start
                            p.handle_left.x -= start
                            p.handle_right.x -= start
                    for fc in fcs:
                        fc.keyframe_points.handles_recalc()
                        fc.update()
    act.use_frame_range = False


def with_object(obj, fn):
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
        return fn()


def weld(obj, distance):
    """Merge co-located vertices; UVs stay per corner, so seams survive."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=distance)
    bm.to_mesh(obj.data)
    bm.free()
    # Faces that end up on the same three vertices would make the mesh invalid.
    obj.data.validate()
    obj.data.update()


def uv_seam_vertices(obj):
    """Indices of vertices on an open edge or on an edge whose two faces disagree in UV."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.active
    found = set()
    if uv is not None:
        def uv_at(loop, v):
            return loop[uv].uv if loop.vert == v else loop.link_loop_next[uv].uv
        for e in bm.edges:
            loops = list(e.link_loops)
            if len(loops) != 2 or any((uv_at(loops[0], v) - uv_at(loops[1], v)).length > 1e-5 for v in e.verts):
                found.update(v.index for v in e.verts)
    bm.free()
    return sorted(found)


def decimate(obj, ratio, seam_weight=None):
    """Collapse decimate as the first modifier, so the armature pose is not applied.

    With `seam_weight` the UV seam vertices go into an inverted vertex group with
    that weight, so collapsing them costs more and happens later. At weight 1
    they stay entirely (the hornet head kept 5,424 VAT vertices instead of about
    1,000); at 0.5 the ratio is still reached. It only helps where seams are a
    minority: at zombie_v2 (62 % seam vertices) and the wraith (41 %) it
    changed nothing.
    """
    if ratio >= 1.0:
        return
    mod = obj.modifiers.new('Decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    if seam_weight is not None:
        group = obj.vertex_groups.new(name='uv_seams')
        group.add(uv_seam_vertices(obj), seam_weight, 'REPLACE')
        mod.vertex_group = group.name
        mod.invert_vertex_group = True
        mod.vertex_group_factor = 1.0
    with_object(obj, lambda: bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0))
    with_object(obj, lambda: bpy.ops.object.modifier_apply(modifier=mod.name))
    if seam_weight is not None:
        obj.vertex_groups.remove(obj.vertex_groups['uv_seams'])


def set_normals(obj, normals):
    if normals == 'keep':
        return
    me = obj.data
    if me.has_custom_normals:
        with_object(obj, lambda: bpy.ops.mesh.customdata_custom_splitnormals_clear())
    if normals == 'smooth':
        me.shade_smooth()
        if 'sharp_edge' in me.attributes:
            me.attributes.remove(me.attributes['sharp_edge'])
    else:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(normals))


def base_color_images(mat):
    """Image nodes feeding the Principled BSDF base colour (directly or through mix nodes)."""
    if not (mat and mat.use_nodes):
        return []
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        return []
    found, stack = [], [bsdf.inputs['Base Color']]
    while stack:
        sock = stack.pop()
        for link in sock.links:
            node = link.from_node
            if node.type == 'TEX_IMAGE':
                found.append(node)
            else:
                stack.extend(i for i in node.inputs if i.is_linked)
    return found


def channel_mean(sock):
    """Mean of what drives a Metallic/Roughness socket: factor x one channel of
    the metal-roughness image (glTF: roughness green, metallic blue)."""
    node, factor = sock.links[0].from_node, 1.0
    if node.type == 'MATH' and node.operation == 'MULTIPLY':
        factor = next((i.default_value for i in node.inputs[:2] if not i.is_linked), 1.0)
        node = next(i.links[0].from_node for i in node.inputs[:2] if i.is_linked)
    if node.type != 'SEPARATE_COLOR':
        return factor
    channel = {'Red': 0, 'Green': 1, 'Blue': 2}[next(
        l.from_socket.name for l in node.outputs[0].links + node.outputs[1].links + node.outputs[2].links
        if l.to_socket == sock or l.to_node.type == 'MATH')]
    src = node.inputs[0].links[0].from_node if node.inputs[0].is_linked else None
    if src is None or src.type != 'TEX_IMAGE' or src.image is None:
        return factor
    img = src.image
    px = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(px)
    return factor * float(px[channel::4].mean())


def strip_to_base_color(mat):
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        return
    keep = set(base_color_images(mat))
    for sock in bsdf.inputs:
        if sock.name in ('Base Color', 'Alpha') or not sock.is_linked:
            continue
        # The importer writes a glTF factor as Math(multiply) with the texture, or
        # leaves it out at 1.0. Unlinked, the socket gets factor x texture mean.
        value = channel_mean(sock) if sock.name in ('Metallic', 'Roughness') else None
        for link in list(sock.links):
            nt.links.remove(link)
        if value is not None:
            sock.default_value = value
    # Remove the chains left dangling (image -> Separate Color / Normal Map -> nothing).
    removed = True
    while removed:
        removed = False
        for node in list(nt.nodes):
            if node.type in ('OUTPUT_MATERIAL', 'BSDF_PRINCIPLED') or node in keep:
                continue
            if not any(o.is_linked for o in node.outputs):
                nt.nodes.remove(node)
                removed = True


def drop_opaque_image_alpha(mat):
    """The glTF importer multiplies the factor alpha with the texture alpha in a
    Math node, also for a JPEG, which has none. The exporter then packs colour and
    alpha into a new PNG. A plain factor alpha keeps the JPEG as it was."""
    if not (mat and mat.use_nodes):
        return
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None or not bsdf.inputs['Alpha'].is_linked:
        return
    math = bsdf.inputs['Alpha'].links[0].from_node
    if math.type != 'MATH' or math.operation != 'MULTIPLY':
        return
    linked = [i for i in math.inputs[:2] if i.is_linked]
    if len(linked) != 1 or linked[0].links[0].from_node.type != 'TEX_IMAGE':
        return
    img = linked[0].links[0].from_node.image
    if img is None or img.file_format != 'JPEG':
        return
    factor = next(i.default_value for i in math.inputs[:2] if not i.is_linked)
    nt.nodes.remove(math)
    bsdf.inputs['Alpha'].default_value = factor


def resize_image(img, longest):
    w, h = img.size
    if max(w, h) <= longest:
        return
    f = longest / max(w, h)
    img.scale(max(1, round(w * f)), max(1, round(h * f)))


def keep_file_rest_pose():
    """Bones without keys in a clip stand at their node transform in three.js.
    The importer makes the guessed bind pose Blender's rest pose and poses the
    bones at the file's node transforms; with no action applied, exporting that
    pose as the rest keeps those bones where the file had them."""
    for arm in (o for o in bpy.context.scene.objects if o.type == 'ARMATURE'):
        ad = arm.animation_data
        if ad is None:
            continue
        ad.action = None
        for track in list(ad.nla_tracks):
            ad.nla_tracks.remove(track)
    for act in bpy.data.actions:
        act.use_fake_user = True
    bpy.context.view_layer.update()


def view3d_override(**extra):
    """Context for edit-mode operators: the first 3D viewport if Blender has one."""
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            if area.type == 'VIEW_3D':
                region = next(r for r in area.regions if r.type == 'WINDOW')
                return bpy.context.temp_override(window=win, area=area, region=region, **extra)
    return bpy.context.temp_override(**extra)


def copy_for_bake(obj):
    """Undecimated copy of `obj`: the surface and UVs the rebake samples."""
    high = obj.copy()
    high.data = obj.data.copy()
    high.name = obj.name + '_bake_source'
    for coll in obj.users_collection:
        coll.objects.link(high)
    return high


def mesh_triangles(me):
    """Vertex positions, triangle vertex indices and triangle corner UVs of `me`."""
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    verts = np.empty(n * 3, dtype=np.int32)
    loops = np.empty(n * 3, dtype=np.int32)
    me.loop_triangles.foreach_get('vertices', verts)
    me.loop_triangles.foreach_get('loops', loops)
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    uv = np.empty(len(me.loops) * 2, dtype=np.float64)
    me.uv_layers.active.data.foreach_get('uv', uv)
    return co.reshape(-1, 3), verts.reshape(-1, 3), uv.reshape(-1, 2)[loops.reshape(-1, 3)]


def barycentric(p, a, b, c):
    """Barycentric weights of the points `p` in the triangles (a, b, c), row by row."""
    v0, v1, v2 = b - a, c - a, p - a
    d00 = (v0 * v0).sum(-1)
    d01 = (v0 * v1).sum(-1)
    d11 = (v1 * v1).sum(-1)
    d20 = (v2 * v0).sum(-1)
    d21 = (v2 * v1).sum(-1)
    den = d00 * d11 - d01 * d01
    den = np.where(np.abs(den) < 1e-30, 1e-30, den)
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    return np.stack([1 - v - w, v, w], -1)


def sample_image(img, uv):
    """Bilinear samples of `img` at `uv` (repeat wrap), one row per point."""
    w, h = img.size
    px = np.empty(w * h * img.channels, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, img.channels)
    x = (uv[:, 0] % 1.0) * w - 0.5
    y = (uv[:, 1] % 1.0) * h - 0.5
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = (x - x0)[:, None]
    fy = (y - y0)[:, None]
    x0 %= w
    y0 %= h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    return ((px[y0, x0] * (1 - fx) + px[y0, x1] * fx) * (1 - fy)
            + (px[y1, x0] * (1 - fx) + px[y1, x1] * fx) * fy)


def raster_uv_triangles(uv_tris, res):
    """Pixel centres of a res x res image covered by each UV triangle:
    (pixel index, triangle index, barycentric weights), each pixel once."""
    pix, tri, bary = [], [], []
    for t, (a, b, c) in enumerate(uv_tris * res):
        lo = np.clip(np.floor(np.minimum(np.minimum(a, b), c)).astype(int), 0, res - 1)
        hi = np.clip(np.ceil(np.maximum(np.maximum(a, b), c)).astype(int), 0, res - 1)
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        xs, ys = np.meshgrid(np.arange(lo[0], hi[0] + 1), np.arange(lo[1], hi[1] + 1))
        p = np.stack([xs.ravel() + 0.5, ys.ravel() + 0.5], -1)
        l0 = ((b[1] - c[1]) * (p[:, 0] - c[0]) + (c[0] - b[0]) * (p[:, 1] - c[1])) / d
        l1 = ((c[1] - a[1]) * (p[:, 0] - c[0]) + (a[0] - c[0]) * (p[:, 1] - c[1])) / d
        l2 = 1 - l0 - l1
        # About half a pixel of slack, so texels on an island edge are covered.
        eps = 0.5 / max(1e-9, math.sqrt(abs(d)))
        inside = (l0 >= -eps) & (l1 >= -eps) & (l2 >= -eps)
        if not inside.any():
            continue
        q = p[inside]
        pix.append(q[:, 1].astype(np.int64) * res + q[:, 0].astype(np.int64))
        tri.append(np.full(len(q), t, dtype=np.int64))
        bary.append(np.clip(np.stack([l0[inside], l1[inside], l2[inside]], -1), 0, 1))
    pix, tri, bary = np.concatenate(pix), np.concatenate(tri), np.concatenate(bary)
    bary /= bary.sum(-1, keepdims=True)
    _, first = np.unique(pix, return_index=True)
    return pix[first], tri[first], bary[first]


def dilate(img, filled, steps):
    """Grow the filled pixels of `img` by `steps` pixels (mean of filled neighbours),
    so mipmaps do not pull the empty background into the islands."""
    img = img.copy()
    filled = filled.copy()
    for _ in range(steps):
        acc = np.zeros_like(img)
        count = np.zeros(filled.shape, dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            m = np.roll(np.roll(filled, dy, 0), dx, 1)
            acc += np.roll(np.roll(img, dy, 0), dx, 1) * m[..., None]
            count += m
        grow = ~filled & (count > 0)
        img[grow] = acc[grow] / count[grow][:, None]
        filled |= grow
    return img


def rebake_base_color(low, high, size=1024, supersample=2, margin=16):
    """New UVs for `low` and its base colour taken from `high`, so the decimated
    mesh no longer samples the old atlas across its seams.

    Each texel of the new layout (supersample x supersample samples) is placed
    on `low` in rest pose, moved to the closest point of `high` and takes the
    atlas colour at that point's UV. A Cycles selected-to-active bake casts rays
    along the low normals instead: at zombie_v2 (170 units tall, decimated up
    to 0.4 units off the original) with an extrusion of 0.1, the ray of 12 % of
    the head and 16 % of the body vertices hit another surface than the closest
    one, which speckled the skull and the shirt. Every link from the old atlas
    to the BSDF (the wraith's emission, too) moves to the new image; `high` is
    removed.
    """
    low.data.materials[0] = low.data.materials[0].copy()
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    with view3d_override(object=low, active_object=low):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
        # Packed by shape, the islands cover 51 % of the image instead of 37 %.
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=True, margin=0.002, shape_method='CONCAVE', margin_method='FRACTION')
        bpy.ops.object.mode_set(mode='OBJECT')

    mat = low.data.materials[0]
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    # Every image node that shows the old atlas (the wraith has a second one for emission).
    atlases = {n.image for n in base_color_images(mat)}
    if len(atlases) != 1:
        raise RuntimeError(f'rebake expects one base colour image, found {len(atlases)}')
    old = {n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image in atlases}
    targets = [link.to_socket for link in nt.links
               if link.from_node in old and link.to_node == bsdf and link.to_socket.name != 'Alpha']

    res = size * supersample
    hco, htri, huv = mesh_triangles(high.data)
    tree = BVHTree.FromPolygons([Vector(v) for v in hco], htri.tolist(), all_triangles=True)
    lco, ltri, luv = mesh_triangles(low.data)
    pix, tri, bary = raster_uv_triangles(luv, res)
    points = (lco[ltri[tri]] * bary[..., None]).sum(1)
    nearest = np.empty_like(points)
    nearest_tri = np.empty(len(points), dtype=np.int64)
    for i, p in enumerate(points):
        loc, _, k, _ = tree.find_nearest(Vector(p))
        nearest[i] = loc
        nearest_tri[i] = k
    w = np.clip(barycentric(nearest, *(hco[htri[nearest_tri][:, j]] for j in range(3))), 0, None)
    w /= w.sum(-1, keepdims=True)
    colour = sample_image(next(iter(atlases)), (huv[nearest_tri] * w[..., None]).sum(1))

    out = np.zeros((res * res, 4), dtype=np.float32)
    out[pix, :3] = colour[:, :3]
    filled = np.zeros(res * res, dtype=bool)
    filled[pix] = True
    out = dilate(out.reshape(res, res, 4), filled.reshape(res, res), margin * supersample)
    out[..., 3] = 1.0
    out = out.reshape(size, supersample, size, supersample, 4).mean((1, 3))
    image = bpy.data.images.new(mat.name + '_baked', size, size, alpha=False)
    image.pixels.foreach_set(out.ravel())
    image.pack()

    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    for node in old:
        nt.nodes.remove(node)
    for sock in targets:
        nt.links.new(tex.outputs['Color'], sock)
    bpy.data.objects.remove(high, do_unlink=True)


def purge_orphans():
    # Materials first: an image loses its last user only once they are gone.
    for coll in (bpy.data.materials, bpy.data.meshes, bpy.data.textures, bpy.data.images):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def export_glb(path, image_format, sample, slide, rest_position=True):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_anim_slide_to_zero=slide,
        export_force_sampling=sample,
        export_optimize_animation_size=True,
        export_skins=True,
        export_influence_nb=4,
        export_morph=True,
        export_materials='EXPORT',
        export_image_format=image_format,
        export_jpeg_quality=90,
        export_image_quality=90,
        export_apply=False,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_rest_position_armature=rest_position,
    )


def run(name):
    recipe = RECIPES[name]
    repo = repo_root()
    out = os.path.join(repo, recipe.get('out') or os.path.splitext(recipe['src'])[0] + '.glb')
    decim = recipe.get('decimate')
    with tempfile.TemporaryDirectory() as tmp:
        src = git_export(repo, recipe['src'], tmp)
        for extra in recipe.get('extra', []):
            git_export(repo, extra, tmp)
        clear_scene()
        # The importer places keys by the scene rate, and recipe frames (`trim`) count
        # at the baker's 30 fps; a fresh Blender runs at 24.
        bpy.context.scene.render.fps = 30
        bpy.context.scene.render.fps_base = 1.0
        # Merged vertices let the decimator collapse across UV seams without tearing them open.
        import_model(src, merge_vertices=decim is not None or recipe.get('merge', False),
                     guess_bind_pose=recipe.get('guess_bind_pose', True))

        if 'actions' in recipe:
            keep_actions(recipe['actions'])
        for action_name, window in recipe.get('trim', {}).items():
            trim_action(bpy.data.actions[action_name], *window)

        meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        for obj in meshes:
            ratio = decim
            if isinstance(decim, dict):
                ratio = next((r for pat, r in decim.items() if fnmatch.fnmatchcase(obj.name, pat)), 1.0)
            bake_source = copy_for_bake(obj) if 'rebake' in recipe else None
            if 'weld' in recipe:
                weld(obj, recipe['weld'])
            seam_weight = next((w for pat, w in recipe.get('seams', {}).items()
                                if fnmatch.fnmatchcase(obj.name, pat)), None)
            if ratio is not None:
                decimate(obj, ratio, seam_weight)
            set_normals(obj, recipe.get('normals', 'keep'))
            if obj.data.validate():
                print(f'[optimize_enemy] {obj.name}: repaired invalid geometry')
            if bake_source is not None:
                rebake_base_color(obj, bake_source, **recipe['rebake'])

        for mat in bpy.data.materials:
            if recipe.get('base_color_only'):
                strip_to_base_color(mat)
            drop_opaque_image_alpha(mat)
        purge_orphans()
        if 'texture' in recipe:
            for img in bpy.data.images:
                resize_image(img, recipe['texture'])

        rest_from_file = recipe.get('rest_from_file', False)
        if rest_from_file:
            keep_file_rest_pose()
        export_glb(out, recipe.get('image_format', 'AUTO'), recipe.get('sample', False),
                   recipe.get('slide', False), rest_position=not rest_from_file)
    print(f'[optimize_enemy] {name}: {out} ({os.path.getsize(out) / 1048576:.2f} MB)')
    return out


if __name__ == '__main__' and '--' in sys.argv:
    for recipe_name in sys.argv[sys.argv.index('--') + 1:]:
        run(recipe_name)
