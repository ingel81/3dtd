"""Hero model: public/assets/models/hero/mercenary.glb.

Source: "SWAT" by Quaternius, CC0 1.0 (https://poly.pizza/m/Btfn3G5Xv4),
see public/assets/models/hero/LICENSES.md. The script downloads it into WORK
once and builds the hero from it:

  - the rig, the four skinned meshes and a handful of its clips, renamed
    (CLIPS); the model has no death clip in use, the hero is invulnerable
  - uniform and gear recoloured to a mercenary look (COLOURS), no textures
  - a compact submachine gun (built here from boxes and cylinders) parented
    to the right hand bone, and an empty `Muzzle` at its muzzle, so the game
    can start tracers there

Axes as in three.js: y up, the hero looks along +z. Blender is z-up and the
figure looks along -y; the glTF exporter turns it. Height about 1.8 model
units (see the log of `run()`).

The clips hold the gun one-handed like a pistol: `aim` points the right arm
forward, `shoot` is one shot with a strong upward kick (about 45 degrees at
the wrist around frame 5), `idle` holds the gun low at the hip.

Headless:
    blender --background --python tools/blender/hero_mercenary.py
From a running Blender (Blender MCP):
    REPO = r'D:/Source/3dtd'
    exec(open(REPO + '/tools/blender/hero_mercenary.py').read()); run()
"""
import math
import os
import urllib.request

import bmesh
import bpy
from mathutils import Matrix, Vector

if 'REPO' not in globals():
    REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SRC_URL = 'https://static.poly.pizza/713f6535-f4f3-4367-a4c6-ced126ae0936.glb'
WORK = os.path.join(REPO, 'tmp/hero_work')
SRC = os.path.join(WORK, 'swat.glb')
OUT_GLB = os.path.join(REPO, 'public/assets/models/hero/mercenary.glb')
SCENE = 'hero_mercenary'

# Clips kept, source name -> name in the GLB
CLIPS = {
    'CharacterArmature|Idle_Gun': 'idle',
    'CharacterArmature|Walk': 'walk',
    'CharacterArmature|Run': 'run',
    'CharacterArmature|Run_Shoot': 'run_shoot',
    'CharacterArmature|Idle_Gun_Pointing': 'aim',
    'CharacterArmature|Gun_Shoot': 'shoot',
}

# Materials: source name -> (new name, linear base colour, metallic, roughness).
# The source has metallic 0.4 on cloth and skin, which darkens them in
# three.js without an environment map.
COLOURS = {
    'Swat': ('Uniform', (0.138, 0.150, 0.068), 0.0, 0.8),
    'Swat_Black': ('Gear', (0.024, 0.022, 0.019), 0.0, 0.65),
    'Skin': ('Skin', (0.494, 0.334, 0.191), 0.0, 0.7),
    'Visor': ('Visor', (0.006, 0.006, 0.006), 0.3, 0.25),
}
GUN_COLOUR = ((0.026, 0.027, 0.030), 0.55, 0.4)

HAND_BONE = 'Wrist.R'
# The gun in the hand bone's frame (m, rotation in degrees): the bone's +y
# runs along the fingers, in the aiming pose its +x points down and its +z
# away from the body. GUN_OFFSET moves the grip point into the fist.
GUN_OFFSET = (-0.02, 0.11, -0.012)

# ── Gun (m): +y the barrel, +z up, the origin the grip point in the fist ──
BARREL_R = 0.013
SUPPRESSOR_R = 0.019
MUZZLE_Y = 0.36
BORE_Z = 0.052


def clear_scene():
    """This script's scene, emptied; other scenes stay as they are."""
    sc = bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)
    for ob in list(sc.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(sc.collection.children):
        bpy.data.collections.remove(coll)
    for name in set(CLIPS.values()):
        act = bpy.data.actions.get(name)
        if act:
            bpy.data.actions.remove(act)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.actions):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)
    bpy.context.window.scene = sc
    # The source's keys lie on whole frames at 24 fps; at another rate the
    # exporter's sampling would cut the last key off a loop
    sc.render.fps = 24
    return sc


def fetch_source():
    """The source GLB in WORK, downloaded if missing. Where Blender may not
    open sockets: `curl -L <SRC_URL> -o tmp/hero_work/swat.glb`."""
    if not os.path.exists(SRC):
        os.makedirs(WORK, exist_ok=True)
        urllib.request.urlretrieve(SRC_URL, SRC)
    return SRC


def import_source(sc):
    before = set(bpy.data.actions)
    # No bone shapes (an Icosphere that would end up in the export); the rest
    # pose from the file, not a guessed bind pose, so the round trip is exact
    bpy.ops.import_scene.gltf(filepath=fetch_source(), disable_bone_shape=True,
                              guess_original_bind_pose=False)
    imported = [a for a in bpy.data.actions if a not in before]
    arm = next(o for o in sc.objects if o.type == 'ARMATURE')
    # Tail nodes of the source's bone chains, nothing hangs on them
    for ob in [o for o in sc.objects if o.type == 'EMPTY' and o.name.endswith('_end')]:
        bpy.data.objects.remove(ob, do_unlink=True)
    ad = arm.animation_data
    ad.action = None
    for track in list(ad.nla_tracks):
        ad.nla_tracks.remove(track)
    for act in imported:
        if act.name not in CLIPS:
            bpy.data.actions.remove(act)
            continue
        act.name = CLIPS[act.name]
        act.use_fake_user = True
    missing = set(CLIPS.values()) - {a.name for a in bpy.data.actions}
    assert not missing, f'clips not found: {sorted(missing)}'
    return arm


def recolour(sc):
    for ob in sc.objects:
        if ob.type != 'MESH':
            continue
        for mat in ob.data.materials:
            if mat.name not in COLOURS:
                continue
            name, colour, metal, rough = COLOURS[mat.name]
            set_principled(mat, colour, metal, rough)
            mat.name = name


def set_principled(mat, colour, metal, rough):
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*colour, 1.0)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough


def add_box(bm, centre, size, tilt_x=0.0):
    """A box of `size` round `centre`, turned by tilt_x degrees about x."""
    res = bmesh.ops.create_cube(bm, size=1.0)
    mat = (Matrix.Translation(Vector(centre)) @ Matrix.Rotation(math.radians(tilt_x), 4, 'X')
           @ Matrix.Diagonal((*size, 1.0)))
    bmesh.ops.transform(bm, matrix=mat, verts=res['verts'])


def add_tube(bm, y0, y1, radius, z, segments=8):
    """A cylinder along y from y0 to y1, its axis at height z."""
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius,
                                depth=y1 - y0)
    mat = Matrix.Translation(Vector((0, (y0 + y1) / 2, z))) @ Matrix.Rotation(math.radians(-90), 4, 'X')
    bmesh.ops.transform(bm, matrix=mat, verts=res['verts'])


def gun_bmesh():
    """A compact submachine gun, low poly: receiver with a rail, a short
    barrel shroud and a suppressor, the pistol grip in the fist, a magazine
    in front of it, a folded stock stub."""
    bm = bmesh.new()
    add_box(bm, (0, 0.075, 0.045), (0.042, 0.24, 0.058))
    add_box(bm, (0, 0.07, 0.083), (0.018, 0.15, 0.016))
    add_box(bm, (0, -0.015, 0.093), (0.024, 0.03, 0.022))
    add_tube(bm, 0.19, 0.24, BARREL_R, BORE_Z)
    add_tube(bm, 0.24, MUZZLE_Y, SUPPRESSOR_R, BORE_Z)
    add_box(bm, (0, -0.004, -0.035), (0.032, 0.042, 0.1), tilt_x=-14)
    add_box(bm, (0, 0.105, -0.045), (0.028, 0.034, 0.13), tilt_x=6)
    add_box(bm, (0, 0.035, -0.006), (0.012, 0.05, 0.012))
    add_box(bm, (0, -0.06, 0.035), (0.03, 0.05, 0.04))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def hand_frame(arm):
    """World matrix of the hand bone in the rest pose, without the armature's scale."""
    bone = arm.data.bones[HAND_BONE]
    loc, rot, _ = (arm.matrix_world @ bone.matrix_local).decompose()
    return Matrix.Translation(loc) @ rot.to_matrix().to_4x4()


# Gun axes in the hand bone's frame: gun +x -> bone +z, +y -> +y, +z -> -x
GUN_IN_HAND = Matrix(((0, 0, -1, 0), (0, 1, 0, 0), (1, 0, 0, 0), (0, 0, 0, 1)))


def attach(ob, arm, local):
    """Parent ob to the hand bone at `local` (gun space) in the rest pose."""
    ob.parent = arm
    ob.parent_type = 'BONE'
    ob.parent_bone = HAND_BONE
    bpy.context.view_layer.update()
    ob.matrix_world = hand_frame(arm) @ Matrix.Translation(Vector(GUN_OFFSET)) @ GUN_IN_HAND @ local


def add_gun(sc, arm):
    arm.data.pose_position = 'REST'
    me = bpy.data.meshes.new('Gun')
    bm = gun_bmesh()
    bm.to_mesh(me)
    bm.free()
    mat = bpy.data.materials.new('Gun')
    colour, metal, rough = GUN_COLOUR
    set_principled(mat, colour, metal, rough)
    # Closed boxes: single-sided, like the source's materials
    mat.use_backface_culling = True
    me.materials.append(mat)
    gun = bpy.data.objects.new('Gun', me)
    sc.collection.objects.link(gun)
    attach(gun, arm, Matrix.Identity(4))
    muzzle = bpy.data.objects.new('Muzzle', None)
    muzzle.empty_display_size = 0.03
    sc.collection.objects.link(muzzle)
    attach(muzzle, arm, Matrix.Translation(Vector((0, MUZZLE_Y, BORE_Z))))
    arm.data.pose_position = 'POSE'
    return gun, muzzle


def gltf_point(v):
    """Blender world point as the GLB's (x, y, z)."""
    return (v.x, v.z, -v.y)


def report(sc, arm, muzzle):
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    tris = 0
    zs = []
    for ob in sc.objects:
        if ob.type != 'MESH':
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
        zs += [(ev.matrix_world @ v.co).z for v in me.vertices]
        ev.to_mesh_clear()
    print(f'[hero] {tris} triangles, rest height {max(zs) - min(zs):.3f} (feet at {min(zs):.3f})')
    print(f'[hero] muzzle rest {tuple(round(c, 3) for c in gltf_point(muzzle.matrix_world.translation))}')
    arm.data.pose_position = 'POSE'
    ad = arm.animation_data_create()
    for name in CLIPS.values():
        act = bpy.data.actions[name]
        # Bones a clip does not key stand at the rest pose, as in three.js
        for pb in arm.pose.bones:
            pb.matrix_basis.identity()
        ad.action = act
        ad.action_slot = act.slots[0]
        start, end = act.frame_range
        sc.frame_set(int(start))
        bpy.context.view_layer.update()
        m = gltf_point(muzzle.matrix_world.translation)
        print(f'[hero] {name}: {(end - start) / sc.render.fps:.3f} s, muzzle at frame 0 '
              f'{tuple(round(c, 3) for c in m)}')
    ad.action = None
    return tris


def export(sc, arm):
    for ob in sc.objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = arm
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format='GLB',
        use_selection=True,
        # Without it the exporter also takes what is selected in other scenes
        use_active_scene=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_skins=True,
        export_influence_nb=4,
        export_morph=False,
        export_materials='EXPORT',
        export_apply=False,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_rest_position_armature=True,
    )
    print(f'[hero] wrote {OUT_GLB} ({os.path.getsize(OUT_GLB) / 1e6:.2f} MB)')


def run(write=True):
    sc = clear_scene()
    arm = import_source(sc)
    recolour(sc)
    _, muzzle = add_gun(sc, arm)
    report(sc, arm, muzzle)
    if write:
        export(sc, arm)
    return arm


if __name__ == '__main__':
    run()
