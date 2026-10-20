"""Builds the distance copy (-lod1) of a box-built house anew from its packed model, with its facades as
blender_kit.facade_lod draws them, when the model's sources are not at hand (the builders do the same through
export_lod(..., facades=CITY_FACADES)).

    node tools/map-assets/unpack_glb.mjs public/maps/assets/models/<id>.glb <tmp>/<id>.glb
    blender --background --factory-startup --python tools/map-assets/relod_facades.py -- <tmp> <packed-models-dir> <id> [<id> ...]

Writes <tmp>/<id>-lod1.glb: the model's materials, the textured ones as flat `<name>-lod` copies (their colour
from match_lods.py afterwards), the untextured ones under their own names (the game draws them with the full
model's materials). Then meshopt, match_lods.py, count_triangles.py and stage_tones.mjs as for any new LOD
(README.md).
"""
import json
import os
import struct
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import blender_kit  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
TMP, PACKED, IDS = argv[0], argv[1], argv[2:]
with open(os.path.join(PACKED, '..', 'catalog.json'), encoding='utf8') as f:
    CATALOG = {o['id']: o for o in json.load(f)['objects']}


def textured_materials(path):
    """Names of the packed model's materials with a colour texture"""
    with open(path, 'rb') as f:
        data = f.read()
    length = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    return {m.get('name') for m in gltf.get('materials', []) if 'baseColorTexture' in m.get('pbrMetallicRoughness', {})}


def main():
    blender_kit.configure(TMP, TMP, TMP)
    for mid in IDS:
        blender_kit.clear_scene()
        bpy.ops.import_scene.gltf(filepath=os.path.join(TMP, mid + '.glb'))
        meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        if len(meshes) > 1:
            bpy.ops.object.join()
        obj = bpy.context.view_layer.objects.active
        # Metres: the import keeps the model's node scale on the object
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        textured = textured_materials(os.path.join(PACKED, mid + '.glb'))
        for slot in obj.material_slots:
            m = slot.material
            if m is not None and m.name in textured:
                bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
                slot.material = blender_kit.flat_material(m.name + '-lod', tuple(bsdf.inputs['Base Color'].default_value)[:3])
        # The rest decimated as the builder's export_lod does: to the share its LOD's triangles were of the model's
        entry = CATALOG.get(mid, {})
        lods = entry.get('lod') or [{}]
        rest = min(1.0, lods[0].get('triangles', 900) / max(1, entry.get('triangles', len(obj.data.polygons))))
        blender_kit.facade_lod(obj, *blender_kit.CITY_FACADES, rest=rest)
        while len(obj.data.uv_layers):
            obj.data.uv_layers.remove(obj.data.uv_layers[0])
        blender_kit.export(mid + '-lod1', [obj])


main()
