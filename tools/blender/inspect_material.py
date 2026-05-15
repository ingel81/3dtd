"""Deep material/normal inspection for a GLB.

Usage:
    blender.exe --background --python inspect_material.py -- <glb_path>
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


def inspect(glb_path):
    clear_scene()
    print(f"\n===== MATERIAL/NORMAL INSPECTION: {os.path.basename(glb_path)} =====")
    bpy.ops.import_scene.gltf(filepath=glb_path)

    # Material settings
    print("\n--- Materials (Blender side) ---")
    for mat in bpy.data.materials:
        print(f"  '{mat.name}':")
        # Blender material settings that map to GLTF alphaMode
        print(f"    blend_method        = {getattr(mat, 'blend_method', 'n/a')}")
        print(f"    shadow_method       = {getattr(mat, 'shadow_method', 'n/a')}")
        print(f"    surface_render_method = {getattr(mat, 'surface_render_method', 'n/a')}")
        print(f"    use_backface_culling = {mat.use_backface_culling}")
        try:
            print(f"    alpha_threshold     = {mat.alpha_threshold}")
        except AttributeError:
            pass
        if mat.use_nodes and mat.node_tree:
            for node in mat.node_tree.nodes:
                if node.type == 'BSDF_PRINCIPLED':
                    a = node.inputs.get('Alpha')
                    if a is not None:
                        print(f"    Principled Alpha    = {a.default_value}")
                if node.type == 'TEX_IMAGE' and node.image:
                    img = node.image
                    print(f"    tex '{img.name}' size={img.size[0]}x{img.size[1]} colorspace={img.colorspace_settings.name}")
                    # Check if alpha channel is meaningful
                    if img.channels == 4 and img.has_data:
                        pixels = list(img.pixels[3::4][:50000])  # alpha samples
                        if pixels:
                            mn, mx = min(pixels), max(pixels)
                            avg = sum(pixels)/len(pixels)
                            print(f"      alpha range: min={mn:.3f} max={mx:.3f} avg={avg:.3f}")

    # Mesh analysis: check for inverted/flipped normals using bmesh
    print("\n--- Mesh Normal Analysis ---")
    import bmesh
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        me = obj.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.normal_update()

        # Detect non-manifold edges (holes, T-junctions, internal faces)
        non_manifold_edges = [e for e in bm.edges if not e.is_manifold]
        # Detect faces with inconsistent normals to neighbors
        # We'll use a simple heuristic: count faces whose normal points "inward" relative to centroid
        center = obj.location.copy()
        outward = 0
        inward = 0
        for f in bm.faces:
            face_center = f.calc_center_median()
            radial = (face_center - center)
            if radial.length > 1e-6:
                radial.normalize()
                d = f.normal.dot(radial)
                if d > 0:
                    outward += 1
                else:
                    inward += 1
        total = outward + inward
        ratio_inward = inward / total if total else 0
        print(f"  '{obj.name}': verts={len(bm.verts)} faces={len(bm.faces)} edges={len(bm.edges)}")
        print(f"    non-manifold edges: {len(non_manifold_edges)}")
        print(f"    faces with normals pointing outward (from object center): {outward}/{total}")
        print(f"    faces with normals pointing inward (from object center): {inward}/{total} ({ratio_inward*100:.1f}%)")

        # Check for duplicated faces (overlapping)
        face_keys = {}
        dup_faces = 0
        for f in bm.faces:
            key = tuple(sorted(v.index for v in f.verts))
            if key in face_keys:
                dup_faces += 1
            else:
                face_keys[key] = 1
        print(f"    duplicate faces (same verts): {dup_faces}")

        # Bounding box info
        if bm.verts:
            xs = [v.co.x for v in bm.verts]
            ys = [v.co.y for v in bm.verts]
            zs = [v.co.z for v in bm.verts]
            print(f"    bbox local: X=[{min(xs):.2f},{max(xs):.2f}] Y=[{min(ys):.2f},{max(ys):.2f}] Z=[{min(zs):.2f},{max(zs):.2f}]")

        bm.free()


def main():
    argv = sys.argv
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    else:
        argv = []
    if not argv:
        print("ERROR: pass a .glb path")
        sys.exit(1)
    for p in argv:
        inspect(p)


main()
