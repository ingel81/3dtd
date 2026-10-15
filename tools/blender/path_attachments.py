"""The attachments of the tower paths (TODO E101) after the Scout's lookout (scout_lookout.py): one small add-on per
path, built in its tower model's own units, so the game hangs it under the tower's mesh as it is
(ThreeTowerRenderer.setPath).

    blender.exe -b --python tools/blender/path_attachments.py -- <name> [--preview out.png]

Writes public/assets/models/towers/attachments/<name>.glb. Names:
    incendiary  Archer, Fire Arrows: an iron fire basket with embers on the platform, a quiver of pitch arrows
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TOWERS = os.path.join(REPO, 'public', 'assets', 'models', 'towers')
SEGMENTS = 12


def material(name, color, metallic=0.0, roughness=0.8, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1.0)
        bsdf.inputs['Emission Strength'].default_value = strength
    return mat


def cylinder(name, radius, depth, location, mat, rotation=(0, 0, 0), verts=SEGMENTS, radius2=None):
    if radius2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=location,
                                            rotation=rotation)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radius, radius2=radius2, depth=depth,
                                        location=location, rotation=rotation)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    return ob


def rod(name, a, b, radius, mat, verts=6):
    """A thin cylinder from `a` to `b`"""
    d = b - a
    ob = cylinder(name, radius, d.length, (a + b) / 2, mat, verts=verts)
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return ob


def sphere(name, radius, location, mat, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=radius, location=location)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    return ob


def join(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    bpy.ops.object.shade_flat()
    return ob


# ---------------------------------------------------------------- incendiary (archer)

# Archer model units (Blender Z up): the walkway between the roof and the battlements at z -0.02, about 0.2 from
# the middle; the Scout's mast stands on the merlon at -x -y, the basket on the walkway at +x -y
BASKET_AT = Vector((0.145, -0.145, -0.02))


def build_incendiary():
    iron = material('fire_iron', (0.09, 0.08, 0.07), metallic=0.8, roughness=0.55)
    ember = material('fire_ember', (1.0, 0.35, 0.05), emission=(1.0, 0.38, 0.06), strength=6.0)
    wood = material('fire_wood', (0.25, 0.15, 0.08))
    leather = material('fire_leather', (0.30, 0.16, 0.08), roughness=0.9)
    pitch = material('fire_pitch', (0.05, 0.04, 0.03), roughness=0.7)

    flame = material('fire_flame', (1.0, 0.55, 0.1), emission=(1.0, 0.45, 0.05), strength=2.5)
    parts = []
    # Three legs and a bowl that widens upwards, high enough to show over the merlons, embers and flames in it
    top = BASKET_AT + Vector((0, 0, 0.11))
    for i in range(3):
        a = i * math.tau / 3 + 0.4
        foot = BASKET_AT + Vector((math.cos(a) * 0.05, math.sin(a) * 0.05, 0))
        parts.append(rod('leg', foot, top, 0.005, iron))
    parts.append(cylinder('bowl', 0.03, 0.04, top + Vector((0, 0, 0.015)), iron, radius2=0.055))
    for i in range(7):
        a = i * math.tau / 7
        parts.append(sphere('coal', 0.016, top + Vector((math.cos(a) * 0.028, math.sin(a) * 0.028, 0.035)), ember))
    for i, (dx, dy, h) in enumerate(((0, 0, 0.09), (0.02, 0.012, 0.06), (-0.018, 0.01, 0.065), (0.004, -0.021, 0.055))):
        parts.append(cylinder('flame', 0.022 - i * 0.002, h, top + Vector((dx, dy, 0.04 + h / 2)), flame,
                              radius2=0.0, verts=7))
    basket = join('incendiary_basket', parts)

    # A quiver beside it, the arrows' heads wrapped in pitch rags
    quiver_at = Vector((0.195, -0.04, -0.02))
    tilt = (math.radians(14), math.radians(-10), 0)
    q = [cylinder('quiver', 0.018, 0.09, quiver_at + Vector((0, 0, 0.045)), leather, rotation=tilt, verts=10)]
    up = Vector((0, 0, 1))
    up.rotate(Euler(tilt))
    for k, (dx, dy) in enumerate(((0.006, 0.004), (-0.007, 0.003), (0.0, -0.007), (0.004, -0.002))):
        base = quiver_at + Vector((dx, dy, 0.06))
        tip = base + up * (0.075 + 0.008 * k)
        q.append(rod('shaft', base, tip, 0.0025, wood, verts=5))
        q.append(sphere('rag', 0.008, tip, pitch))
    quiver = join('incendiary_quiver', q)
    return [basket, quiver]


BUILDS = {
    'incendiary': ('archer.glb', build_incendiary, (1.1, -1.1, 0.9), (0.05, 0.05, 0.1)),
}


def export(name, objects):
    out = os.path.join(TOWERS, 'attachments', f'{name}.glb')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_materials='EXPORT')
    tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in objects)
    print(f'PATH {name} wrote {out}, {tris} triangles')


def preview(tower, camera, target, path):
    bpy.ops.import_scene.gltf(filepath=os.path.join(TOWERS, tower))
    scene = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    cam.location = camera
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat('-Z', 'Y').to_euler()
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
    print(f'PATH preview {path}')


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    name = args[0]
    tower, build, camera, target = BUILDS[name]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objects = build()
    export(name, objects)
    if '--preview' in args:
        preview(tower, camera, target, args[args.index('--preview') + 1])


main()
