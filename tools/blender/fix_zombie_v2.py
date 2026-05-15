"""Fix zombie_v2.glb:
  - Force material alphaMode -> OPAQUE (disconnect all alpha sources)
  - Enable backface culling
  - Remove orphan 'Icosphere' debug mesh
  - Re-export as GLB to the same path
"""
import bpy
import sys
import os


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


def force_opaque(mat):
    """Force material to be fully opaque so GLTF export writes alphaMode=OPAQUE."""
    if not (mat.use_nodes and mat.node_tree):
        return

    nt = mat.node_tree

    # Step 1: disconnect everything driving Principled BSDF Alpha input, set to 1.0
    for node in nt.nodes:
        if node.type == 'BSDF_PRINCIPLED':
            alpha_in = node.inputs.get('Alpha')
            if alpha_in is not None:
                for link in list(nt.links):
                    if link.to_socket == alpha_in:
                        nt.links.remove(link)
                alpha_in.default_value = 1.0

    # Step 2: switch all texture image colorspaces to sRGB (we don't want sneaky non-color
    # interpretations) and remove single-channel separated alpha branches.
    # Look for Separate Color + Mix + Alpha-into-BSDF wiring left over from glTF import.
    for node in list(nt.nodes):
        # Remove nodes whose only sink was the BSDF Alpha we just disconnected
        if node.type in {'SEPARATE_COLOR', 'SEPARATE_RGBA', 'MIX_RGB'}:
            has_link_out = any(link.from_node == node for link in nt.links)
            if not has_link_out:
                nt.nodes.remove(node)

    # Step 3: now set blend mode (in this order to defeat Blender 5's auto-promotion)
    if hasattr(mat, 'surface_render_method'):
        try:
            mat.surface_render_method = 'OPAQUE'
        except Exception as e:
            print(f"    surface_render_method=OPAQUE failed: {e}")
    if hasattr(mat, 'blend_method'):
        try:
            mat.blend_method = 'OPAQUE'
        except Exception as e:
            print(f"    blend_method=OPAQUE failed: {e}")

    # Step 4: also stamp the glTF custom alpha_mode prop if the exporter looks for it
    # (newer glTF addon reads this if present)
    mat['alpha_mode'] = 'OPAQUE'


def main():
    argv = sys.argv
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    else:
        argv = []
    if len(argv) < 2:
        print("ERROR: pass <input.glb> <output.glb>")
        sys.exit(1)
    inp, out = argv[0], argv[1]

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=inp)

    # 1) Fix materials
    for mat in bpy.data.materials:
        print(f"[mat] '{mat.name}' before:")
        print(f"    blend_method={getattr(mat,'blend_method','?')} surf_render={getattr(mat,'surface_render_method','?')} backface_cull={mat.use_backface_culling}")
        if mat.use_nodes and mat.node_tree:
            print(f"    nodes: {[n.type for n in mat.node_tree.nodes]}")
            for link in mat.node_tree.links:
                print(f"    link: {link.from_node.name}.{link.from_socket.name} -> {link.to_node.name}.{link.to_socket.name}")

        force_opaque(mat)
        mat.use_backface_culling = True

        print(f"[mat] '{mat.name}' after:")
        print(f"    blend_method={getattr(mat,'blend_method','?')} surf_render={getattr(mat,'surface_render_method','?')} backface_cull={mat.use_backface_culling}")

    # 2) Remove orphan Icosphere debug mesh
    for obj in list(bpy.data.objects):
        if obj.type == 'MESH' and obj.name.startswith('Icosphere'):
            print(f"[clean] Removing debug mesh '{obj.name}'")
            bpy.data.objects.remove(obj, do_unlink=True)

    # Purge orphans
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
    for img in list(bpy.data.images):
        if img.users == 0:
            print(f"[clean] Purging unused image '{img.name}'")
            bpy.data.images.remove(img)

    # 3) Export GLB
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        export_animations=True,
        export_skins=True,
        export_materials='EXPORT',
        export_apply=False,
        export_image_format='AUTO',
    )
    size = os.path.getsize(out)
    print(f"\n[ok] Exported {out} ({size/1024/1024:.2f} MB)")


main()
