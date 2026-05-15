"""Optimize zombie_v2.glb:
  - Force material alphaMode -> OPAQUE (disconnect alpha sources)
  - Enable backface culling
  - Remove orphan 'Icosphere' debug mesh
  - Drop unused actions ('Walking', 'Running')
  - Disconnect + delete emission texture node so the unused image gets pruned
  - Downscale baseColor texture 2048 -> 1024
  - Re-export GLB
"""
import bpy
import sys
import os


KEEP_ANIMATIONS = {
    'Unsteady_Walk',
    'Dead',
    'dying_backwards',
    'Electrocuted_Fall',
    'Shot_and_Blown_Back',
}
TEXTURE_TARGET_SIZE = 1024


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


def force_opaque_and_strip_emission(mat):
    """Force opaque + remove emission texture node + remove alpha link."""
    if not (mat.use_nodes and mat.node_tree):
        return
    nt = mat.node_tree

    # Find Principled BSDF
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        return

    # 1) Disconnect anything driving Alpha
    alpha_in = bsdf.inputs.get('Alpha')
    if alpha_in is not None:
        for link in list(nt.links):
            if link.to_socket == alpha_in:
                nt.links.remove(link)
        alpha_in.default_value = 1.0

    # 2) Disconnect emission inputs + set to black so exporter writes no emissive
    for socket_name in ('Emission Color', 'Emission', 'Emission Strength'):
        sock = bsdf.inputs.get(socket_name)
        if sock is None:
            continue
        for link in list(nt.links):
            if link.to_socket == sock:
                nt.links.remove(link)
        try:
            if socket_name == 'Emission Strength':
                sock.default_value = 0.0
            else:
                # Vector / color: set to black
                if hasattr(sock, 'default_value'):
                    dv = sock.default_value
                    if hasattr(dv, '__len__'):
                        for i in range(min(3, len(dv))):
                            dv[i] = 0.0
                        if len(dv) >= 4:
                            dv[3] = 1.0
        except Exception:
            pass

    # 3) Remove dangling image-texture nodes (no outgoing links left after we disconnected emission/alpha)
    for node in list(nt.nodes):
        if node.type == 'TEX_IMAGE':
            outgoing = [l for l in nt.links if l.from_node == node]
            if not outgoing:
                print(f"    removing orphan tex node '{node.name}' (image={node.image.name if node.image else 'None'})")
                nt.nodes.remove(node)

    # 4) Set blend modes
    if hasattr(mat, 'surface_render_method'):
        try:
            # 5.0 only supports DITHERED/BLENDED for EEVEE; OPAQUE legacy lives on blend_method
            mat.surface_render_method = 'DITHERED'
        except Exception:
            pass
    if hasattr(mat, 'blend_method'):
        try:
            mat.blend_method = 'OPAQUE'
        except Exception:
            pass

    # Tell glTF exporter explicitly
    mat['alpha_mode'] = 'OPAQUE'


def downscale_image(img, target):
    if not img.has_data:
        return
    w, h = img.size
    if max(w, h) <= target:
        print(f"    keep '{img.name}' at {w}x{h} (already ≤ target {target})")
        return
    # Compute aspect-preserving size
    if w >= h:
        new_w = target
        new_h = max(1, int(h * (target / w)))
    else:
        new_h = target
        new_w = max(1, int(w * (target / h)))
    print(f"    scaling '{img.name}' {w}x{h} -> {new_w}x{new_h}")
    img.scale(new_w, new_h)
    img.update()


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

    # 1) Fix materials (opaque + strip emission)
    for mat in bpy.data.materials:
        print(f"[mat] '{mat.name}'")
        force_opaque_and_strip_emission(mat)
        mat.use_backface_culling = True

    # 2) Remove orphan Icosphere debug mesh
    for obj in list(bpy.data.objects):
        if obj.type == 'MESH' and obj.name.startswith('Icosphere'):
            print(f"[clean] Removing debug mesh '{obj.name}'")
            bpy.data.objects.remove(obj, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)

    # 3) Drop unused animations
    actions_to_drop = [act for act in bpy.data.actions if act.name not in KEEP_ANIMATIONS]
    for act in actions_to_drop:
        print(f"[anim] Drop '{act.name}'")
        bpy.data.actions.remove(act)
    for act in bpy.data.actions:
        print(f"[anim] Keep '{act.name}'")

    # 4) Downscale remaining images
    for img in list(bpy.data.images):
        if img.users == 0:
            print(f"[tex] Purge unused '{img.name}'")
            bpy.data.images.remove(img)
    print("[tex] remaining images:")
    for img in bpy.data.images:
        print(f"    '{img.name}' {img.size[0]}x{img.size[1]} (users={img.users})")
        downscale_image(img, TEXTURE_TARGET_SIZE)

    # 5) Export GLB
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
