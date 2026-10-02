"""The Scout path's attachment for the Archer tower (TODO E100/E101): a mast at the platform's corner with a
crow's nest, a brass spyglass and a teal pennant. Built in the archer model's own units, so the game hangs it
under the tower's mesh as it is.

    blender.exe -b --python tools/blender/scout_lookout.py -- [--preview out.png]

Writes public/assets/models/towers/attachments/scout.glb. Nodes: `scout_mast` stands, `scout_nest` (basket,
spyglass, pennant) turns about the mast in the game (ThreeTowerRenderer.setPath).
"""
import math
import os
import sys

import bpy
from mathutils import Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ARCHER = os.path.join(REPO, 'public', 'assets', 'models', 'towers', 'archer.glb')
OUT = os.path.join(REPO, 'public', 'assets', 'models', 'towers', 'attachments', 'scout.glb')

# Archer model units (Blender Z up): the battlement platform near z 0.03, its corner at about 0.2 | 0.2
MAST_AT = Vector((-0.19, -0.19, 0.02))
MAST_TOP = 0.66
MAST_RADIUS = 0.014
NEST_Z = 0.50
NEST_RADIUS = 0.065
NEST_HEIGHT = 0.035
SEGMENTS = 12


def material(name, color, metallic=0.0, roughness=0.8):
    mat = bpy.data.materials.new(name)
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def cylinder(name, radius, depth, location, mat, rotation=(0, 0, 0), verts=SEGMENTS):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=location, rotation=rotation)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    return ob


def rod(name, a, b, radius, mat):
    """A thin cylinder from `a` to `b`"""
    d = b - a
    ob = cylinder(name, radius, d.length, (a + b) / 2, mat, verts=6)
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return ob


def join(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    return ob


def build():
    wood = material('scout_wood', (0.23, 0.14, 0.07))
    brass = material('scout_brass', (0.78, 0.58, 0.22), metallic=0.9, roughness=0.35)
    cloth = material('scout_cloth', (0.10, 0.55, 0.55), roughness=0.9)

    # The mast and two struts down to the platform
    height = MAST_TOP - MAST_AT.z
    mast = cylinder('scout_mast', MAST_RADIUS, height, (MAST_AT.x, MAST_AT.y, MAST_AT.z + height / 2), wood, verts=8)
    struts = []
    # Two struts from the platform up to a third of the mast, along the platform's two edges
    for foot in (Vector((MAST_AT.x + 0.10, MAST_AT.y, MAST_AT.z)), Vector((MAST_AT.x, MAST_AT.y + 0.10, MAST_AT.z))):
        struts.append(rod('strut', foot, Vector((MAST_AT.x, MAST_AT.y, MAST_AT.z + height / 3)), MAST_RADIUS * 0.7, wood))
    mast = join('scout_mast', [mast, *struts])

    # The nest: a floor, a rail on posts, the spyglass on the rail, a pennant on the mast's top
    floor = cylinder('floor', NEST_RADIUS, 0.008, (MAST_AT.x, MAST_AT.y, NEST_Z), wood)
    bpy.ops.mesh.primitive_torus_add(major_radius=NEST_RADIUS, minor_radius=0.005, major_segments=SEGMENTS * 2,
                                     minor_segments=6, location=(MAST_AT.x, MAST_AT.y, NEST_Z + NEST_HEIGHT))
    rail = bpy.context.active_object
    rail.data.materials.append(wood)
    posts = []
    for i in range(6):
        a = i * math.tau / 6
        posts.append(cylinder('post', 0.004, NEST_HEIGHT,
                              (MAST_AT.x + math.cos(a) * NEST_RADIUS, MAST_AT.y + math.sin(a) * NEST_RADIUS,
                               NEST_Z + NEST_HEIGHT / 2), wood, verts=5))
    # The spyglass looks out over the rail, away from the tower's middle
    out = Vector((MAST_AT.x, MAST_AT.y, 0)).normalized() * -1
    out = Vector((-out.x, -out.y, 0))
    look = math.atan2(out.y, out.x)
    glass_at = Vector((MAST_AT.x, MAST_AT.y, NEST_Z + NEST_HEIGHT + 0.012)) + out * (NEST_RADIUS * 0.55)
    tube = cylinder('glass', 0.009, 0.075, glass_at, brass, rotation=(0, math.radians(84), look))
    lens = cylinder('lens', 0.012, 0.012, glass_at + out * 0.04 + Vector((0, 0, 0.004)), brass,
                    rotation=(0, math.radians(84), look))
    # The pennant: a long thin triangle off the mast's top, both faces
    top = Vector((MAST_AT.x, MAST_AT.y, MAST_TOP))
    tip = top + Vector((0.16, -0.04, -0.04))
    mesh = bpy.data.meshes.new('pennant')
    mesh.from_pydata([top, top - Vector((0, 0, 0.06)), tip], [], [(0, 1, 2), (0, 2, 1)])
    pennant = bpy.data.objects.new('pennant', mesh)
    bpy.context.scene.collection.objects.link(pennant)
    pennant.data.materials.append(cloth)
    nest = join('scout_nest', [floor, rail, *posts, tube, lens, pennant])

    # The nest turns about the mast: its origin on the mast's axis
    bpy.context.scene.cursor.location = (MAST_AT.x, MAST_AT.y, NEST_Z)
    bpy.ops.object.select_all(action='DESELECT')
    nest.select_set(True)
    bpy.context.view_layer.objects.active = nest
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    for ob in (mast, nest):
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.shade_flat()
    return mast, nest


def export(objects):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_materials='EXPORT')
    tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in objects)
    print(f'SCOUT wrote {OUT}, {tris} triangles')


def preview(path):
    bpy.ops.import_scene.gltf(filepath=ARCHER)
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    cam.location = (1.35, -1.35, 0.75)
    direction = Vector((0, 0, 0.05)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new('w')
    world.color = (0.35, 0.38, 0.42)
    scene.world = world
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f'SCOUT preview {path}')


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mast, nest = build()
    export([mast, nest])
    if '--preview' in args:
        preview(args[args.index('--preview') + 1])


main()
