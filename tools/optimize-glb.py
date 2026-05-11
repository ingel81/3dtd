"""
Headless Blender script to optimize a GLB file:
  - Merge duplicate vertices (welds verts at identical positions)
  - Recalculate normals
  - Apply smooth shading with an auto-smooth angle (preserves hard edges past the angle)

Run:
  blender --background --python tools/optimize-glb.py -- <input.glb> <output.glb> [angle_deg]

Defaults: angle_deg=60, merge_threshold=1e-5 (meters)
"""

import sys
import os
import bpy
import math

# --- Args (after '--') ---
argv = sys.argv
if "--" not in argv:
    raise SystemExit("Missing '--' separator before script args")
args = argv[argv.index("--") + 1:]
if len(args) < 2:
    raise SystemExit("Usage: optimize-glb.py -- <input.glb> <output.glb> [angle_deg]")

INPUT_PATH = os.path.abspath(args[0])
OUTPUT_PATH = os.path.abspath(args[1])
ANGLE_DEG = float(args[2]) if len(args) >= 3 else 60.0
MERGE_THRESHOLD = 1e-5  # 0.01 mm

print(f"[optimize-glb] input  = {INPUT_PATH}")
print(f"[optimize-glb] output = {OUTPUT_PATH}")
print(f"[optimize-glb] angle  = {ANGLE_DEG} deg")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.images):
        bpy.data.images.remove(block)


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)


def optimize_mesh(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    # Edit mode: merge by distance + recalc normals
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=MERGE_THRESHOLD)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    # Smooth shading
    bpy.ops.object.shade_smooth()

    # Smooth by Angle: try modern operator (4.1+), fall back to mesh auto_smooth (4.0 and older)
    angle_rad = math.radians(ANGLE_DEG)
    try:
        bpy.ops.object.shade_auto_smooth(angle=angle_rad)
    except (AttributeError, RuntimeError):
        if hasattr(obj.data, "use_auto_smooth"):
            obj.data.use_auto_smooth = True
            obj.data.auto_smooth_angle = angle_rad


def export_glb(path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
    )


def main():
    clear_scene()
    import_glb(INPUT_PATH)

    mesh_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    print(f"[optimize-glb] imported meshes = {len(mesh_objs)}")
    for obj in mesh_objs:
        before_v = len(obj.data.vertices)
        before_p = len(obj.data.polygons)
        optimize_mesh(obj)
        after_v = len(obj.data.vertices)
        after_p = len(obj.data.polygons)
        print(f"[optimize-glb] {obj.name}: verts {before_v} -> {after_v}, polys {before_p} -> {after_p}")

    export_glb(OUTPUT_PATH)
    print(f"[optimize-glb] wrote {OUTPUT_PATH}")


main()
