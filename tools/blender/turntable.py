"""Turntable frames of every mesh in the open .blend (headless).

blender.exe -b <file.blend> -P turntable.py -- <out_dir>
Writes <out_dir>/frame_####.png and <out_dir>/stats.txt.
"""
import bpy, sys, math, os
from mathutils import Vector

FRAMES = 96          # 4 s at 24 fps, one full turn
RES = 720
ELEVATION_DEG = 22
SAMPLES = 32

out_dir = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out_dir, exist_ok=True)
scene = bpy.context.scene

# Only meshes count; drop cameras and lights the file brought
for obj in list(scene.objects):
    if obj.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(obj, do_unlink=True)

meshes = [o for o in scene.objects if o.type == "MESH" and o.visible_get()]
lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
tris = 0
deps = bpy.context.evaluated_depsgraph_get()
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    ev = o.evaluated_get(deps)
    m = ev.to_mesh()
    m.calc_loop_triangles()
    tris += len(m.loop_triangles)
    ev.to_mesh_clear()
size = hi - lo
center = (lo + hi) / 2

images = [(i.name, i.size[0], i.size[1]) for i in bpy.data.images if i.size[0] > 0]
with open(os.path.join(out_dir, "stats.txt"), "w") as f:
    f.write(f"meshes {len(meshes)}\ntriangles {tris}\nsize {size.x:.3f} x {size.y:.3f} x {size.z:.3f}\n")
    for name, w, h in images:
        f.write(f"image {name} {w}x{h}\n")

# Pivot under the model's centre, everything top-level parented to it
pivot = bpy.data.objects.new("turntable_pivot", None)
scene.collection.objects.link(pivot)
pivot.location = Vector((center.x, center.y, lo.z))
bpy.context.view_layer.update()
for o in list(scene.objects):
    if o is pivot or o.parent is not None:
        continue
    mw = o.matrix_world.copy()
    o.parent = pivot
    o.matrix_world = mw

scene.frame_start = 1
scene.frame_end = FRAMES
pivot.rotation_euler = (0, 0, 0)
pivot.keyframe_insert("rotation_euler", index=2, frame=1)
pivot.rotation_euler = (0, 0, 2 * math.pi)
pivot.keyframe_insert("rotation_euler", index=2, frame=FRAMES + 1)
for fc in pivot.animation_data.action.fcurves if hasattr(pivot.animation_data.action, "fcurves") else []:
    for k in fc.keyframe_points:
        k.interpolation = "LINEAR"
try:
    # Blender 5: layered actions, curves live in channelbags
    for layer in pivot.animation_data.action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    for k in fc.keyframe_points:
                        k.interpolation = "LINEAR"
except AttributeError:
    pass

# Camera framing the whole turn (radius of the footprint, height)
radius = max(size.x, size.y) / 2 * 1.05
height = size.z
fov = math.radians(35)
target = Vector((center.x, center.y, lo.z + height * 0.45))
dist = max(radius, height * 0.6) / math.tan(fov / 2) * 1.25
el = math.radians(ELEVATION_DEG)
cam_data = bpy.data.cameras.new("tt_cam"); cam_data.angle = fov
cam = bpy.data.objects.new("tt_cam", cam_data); scene.collection.objects.link(cam)
cam.location = target + Vector((0, -dist * math.cos(el), dist * math.sin(el)))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
cam_data.clip_end = dist * 10
scene.camera = cam

def light(name, kind, energy, loc, rot=None, size_=None):
    d = bpy.data.lights.new(name, kind); d.energy = energy
    if size_ is not None and hasattr(d, "size"): d.size = size_
    o = bpy.data.objects.new(name, d); scene.collection.objects.link(o)
    o.location = loc
    if rot: o.rotation_euler = rot
    return o

light("key", "SUN", 3.0, center + Vector((0, 0, 10)), (math.radians(50), 0, math.radians(35)))
light("rim", "SUN", 1.5, center + Vector((0, 0, 10)), (math.radians(-60), 0, math.radians(200)))
world = scene.world or bpy.data.worlds.new("tt_world"); scene.world = world
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.06, 0.07, 0.08, 1); bg.inputs[1].default_value = 0.6

r = scene.render
try:
    r.engine = "BLENDER_EEVEE"
except TypeError:
    r.engine = "BLENDER_EEVEE_NEXT"
try:
    scene.eevee.taa_render_samples = SAMPLES
except AttributeError:
    pass
r.resolution_x = r.resolution_y = RES
r.resolution_percentage = 100
r.image_settings.file_format = "PNG"
r.filepath = os.path.join(out_dir, "frame_")
r.fps = 24
bpy.ops.render.render(animation=True)
print("TURNTABLE_DONE", out_dir)
