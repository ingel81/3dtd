"""Inspect a GLB file in Blender headless and dump a structural report.

Usage:
    blender.exe --background --python inspect_glb.py -- <glb_path> [<glb_path2> ...]
"""
import bpy
import sys
import os
import json


def clear_scene():
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    for img in list(bpy.data.images):
        bpy.data.images.remove(img)
    for arm in list(bpy.data.armatures):
        bpy.data.armatures.remove(arm)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)


def human_size(b):
    for unit in ('B', 'KB', 'MB', 'GB'):
        if b < 1024.0:
            return f"{b:.2f} {unit}"
        b /= 1024.0
    return f"{b:.2f} TB"


def inspect(glb_path):
    clear_scene()
    print(f"\n{'='*70}\nINSPECT: {glb_path}\n{'='*70}")
    file_size = os.path.getsize(glb_path)
    print(f"File size: {human_size(file_size)} ({file_size} bytes)")

    bpy.ops.import_scene.gltf(filepath=glb_path)

    total_verts = 0
    total_tris = 0
    total_loops = 0
    meshes = []
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            me = obj.data
            me.calc_loop_triangles()
            tris = len(me.loop_triangles)
            verts = len(me.vertices)
            total_verts += verts
            total_tris += tris
            total_loops += len(me.loops)
            uv_layers = [uv.name for uv in me.uv_layers]
            vcol = [c.name for c in me.color_attributes] if hasattr(me, 'color_attributes') else []
            shape_keys = []
            if me.shape_keys:
                shape_keys = [k.name for k in me.shape_keys.key_blocks]
            mats = [s.material.name if s.material else None for s in obj.material_slots]
            meshes.append({
                'name': obj.name,
                'verts': verts,
                'tris': tris,
                'uv_layers': uv_layers,
                'vertex_colors': vcol,
                'shape_keys': shape_keys,
                'materials': mats,
            })

    print(f"\n--- Meshes ({len(meshes)}) ---")
    for m in meshes:
        print(f"  '{m['name']}': {m['verts']:>6} verts, {m['tris']:>6} tris, UVs={m['uv_layers']}, mats={m['materials']}, shape_keys={len(m['shape_keys'])}")
    print(f"TOTAL: {total_verts} verts, {total_tris} tris")

    armatures = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    print(f"\n--- Armatures ({len(armatures)}) ---")
    for arm in armatures:
        bones = arm.data.bones
        print(f"  '{arm.name}': {len(bones)} bones")
        for b in bones[:5]:
            print(f"    - {b.name}")
        if len(bones) > 5:
            print(f"    ... (+{len(bones)-5} more)")

    print(f"\n--- Materials ({len(bpy.data.materials)}) ---")
    for mat in bpy.data.materials:
        textures = []
        if mat.use_nodes and mat.node_tree:
            for node in mat.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image:
                    img = node.image
                    textures.append(f"{img.name} ({img.size[0]}x{img.size[1]})")
        print(f"  '{mat.name}': textures={textures}")

    print(f"\n--- Images ({len(bpy.data.images)}) ---")
    for img in bpy.data.images:
        ch = img.channels
        size = img.size[0] * img.size[1] * ch
        print(f"  '{img.name}': {img.size[0]}x{img.size[1]}, channels={ch}, raw_bytes={human_size(size)}, source={img.source}, file_format={img.file_format}")

    print(f"\n--- Actions / Animations ({len(bpy.data.actions)}) ---")
    for act in bpy.data.actions:
        frame_range = act.frame_range
        duration = frame_range[1] - frame_range[0]
        try:
            fcurves = len(act.fcurves)
        except AttributeError:
            fcurves = 0
            try:
                for layer in act.layers:
                    for strip in layer.strips:
                        for ch in strip.channelbag(act.slots[0]).fcurves if act.slots else []:
                            fcurves += 1
            except Exception:
                pass
        print(f"  '{act.name}': frames {frame_range[0]:.0f}-{frame_range[1]:.0f} (len={duration:.0f}), fcurves={fcurves}")

    print(f"\n--- Scene Hierarchy ---")
    for obj in bpy.data.objects:
        if obj.parent is None:
            _print_hierarchy(obj, 0)


def _print_hierarchy(obj, depth):
    indent = '  ' * depth
    extra = ''
    if obj.type == 'MESH':
        extra = f" [verts={len(obj.data.vertices)}]"
    elif obj.type == 'ARMATURE':
        extra = f" [bones={len(obj.data.bones)}]"
    print(f"  {indent}- {obj.name} ({obj.type}){extra}")
    for child in obj.children:
        _print_hierarchy(child, depth + 1)


def main():
    argv = sys.argv
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    else:
        argv = []
    if not argv:
        print("ERROR: pass at least one .glb path after --")
        sys.exit(1)
    for p in argv:
        inspect(p)


main()
