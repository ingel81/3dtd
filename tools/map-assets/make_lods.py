"""Builds distance copies (-lod1) of finished raw GLBs in Blender.

    blender --background --factory-startup --python tools/map-assets/make_lods.py -- <glb-raw-dir> <triangles> <id> [<id> ...]

For models the builders do not give a LOD themselves (imported plants and
trees, procedural rocks of several parts). Each mesh is decimated to its
share of <triangles>; textured materials become their average colour
(blender_kit.flat_copy), so the LOD file carries no textures. Foliage
cards (`foliage-*`) are kept as they are: decimating a card breaks it, and
they are only a handful of quads.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import blender_kit  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
RAW, TARGET, IDS = argv[0], int(argv[1]), argv[2:]
blender_kit.configure(RAW, RAW, RAW)


def main():
    for mid in IDS:
        blender_kit.clear_scene()
        bpy.ops.import_scene.gltf(filepath=os.path.join(RAW, mid + '.glb'))
        meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        solid = [o for o in meshes if not any(s.material and s.material.name.startswith('foliage-') for s in o.material_slots)]
        tris = sum(len(o.data.polygons) for o in solid) or 1
        for o in solid:
            for slot in o.material_slots:
                if slot.material is not None:
                    slot.material = blender_kit.flat_copy(slot.material)
            ratio = min(1.0, TARGET / tris)
            if ratio < 1.0:
                mod = o.modifiers.new('decimate', 'DECIMATE')
                mod.ratio = ratio
                bpy.ops.object.select_all(action='DESELECT')
                o.select_set(True)
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.modifier_apply(modifier=mod.name)
            while len(o.data.uv_layers):
                o.data.uv_layers.remove(o.data.uv_layers[0])
        blender_kit.export(mid + '-lod1', meshes)


main()
