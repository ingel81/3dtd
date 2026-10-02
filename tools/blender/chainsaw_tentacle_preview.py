"""Concept clip: the Chainsaw candidate with mechanical tentacles instead of its arms.

Run after split_tower.py with towers/chainsaw-tentacle.json in the same Blender:
    blender.exe -b <Meshy_AI_Chainsaw_Turret_*.blend> --python tools/blender/split_tower.py
        --python tools/blender/chainsaw_tentacle_preview.py -- tools/blender/towers/chainsaw-tentacle.json <out_dir>

Each tentacle is one cubic Bezier (as the game's Tentacle Tower draws its arm on the GPU) along which a chain of
vertebrae is arrayed (Array fitted to the curve, Curve deform): a longer curve shows more vertebrae, so the arm is
seen to extend. The saw head sits on its end, turned along the curve's tangent.
The camera starts close and pulls back while the tentacles reach across a 14 m road (3.8 model units at the
tower's game scale of about 3.7).
"""
import bpy, math, os, sys, json
from mathutils import Vector, Quaternion, Matrix

FPS = 30
FRAMES = int(os.environ.get("TT_FRAMES", 210))
RES = (1280, 720)
GROUND_Z = -0.75
ROAD_Y = (-0.55, -4.35)     # 3.8 units wide, the tower stands at its near edge
RADIUS = 0.15            # even all along, a robot arm, not a taper
SEGMENT = 0.15           # one vertebra: a rounded barrel, short and close like a mechanical tentacle
SAW_HOVER = 0.42         # extended, the saw's attachment this high above the asphalt: its tip stays clear
SAW_TILT_DEG = 15        # and its bar points this far down, not into the road
SAW_SCALE = 1.25         # extended, the heads grow a little to read on arms this thick; docked they are as built

args = sys.argv[sys.argv.index("--") + 1:]
config = json.load(open(args[0]))
out_dir = args[1]
scene = bpy.context.scene
saws = {s["name"]: s for s in config["parts"] if s["name"].startswith("saw_")}

# Where each tentacle leaves the torso, its outward direction, and where it reaches (model units, Z up)
TENTACLES = {
    # Each arm acts on its own: its own moments to go out and come back, its own targets along the road. What keeps
    # them from crossing in 3D is not a shared motion but the split the game would make too: each arm owns a depth
    # band of the road (near, middle, far) and an arc height (low, middle, high).
    "saw_down": {"socket": (-0.30, 0.05, -0.12), "out": (0, -1, -0.1), "lane": -1.7, "lift": 0.30,
                 "extend": (0.9, 6.0), "targets": [(2.4, -0.9), (3.4, 0.5), (4.2, -0.3), (5.1, 0.9)]},
    "saw_side": {"socket": (-0.03, 0.31, 0.24), "out": (1, 0, 0.2), "lane": -2.7, "lift": 0.50,
                 "extend": (1.4, 6.3), "targets": [(2.9, 1.6), (3.7, 0.4), (4.9, 2.0), (5.6, 1.0)]},
    "saw_up":   {"socket": (-0.30, 0.03, 0.22), "out": (0, -1, 0.35), "lane": -3.8, "lift": 0.75,
                 "extend": (1.9, 5.7), "targets": [(3.3, -1.6), (4.3, 0.2), (5.0, -0.8)]},
}


def smooth(x):
    x = min(1.0, max(0.0, x)); return x * x * (3 - 2 * x)


def target_x(spec, t):
    """The arm's target along the road at time t: eased from one target to the next."""
    keys = spec["targets"]
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, x0), (t1, x1) in zip(keys, keys[1:]):
        if t <= t1:
            return x0 + (x1 - x0) * smooth((t - t0) / (t1 - t0))
    return keys[-1][1]


def mat(name, color, metallic=0.6, rough=0.45):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = color
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    return m


yellow = mat("collar_yellow", (0.85, 0.6, 0.05, 1), 0.3, 0.5)
asphalt = mat("asphalt", (0.05, 0.05, 0.055, 1), 0.0, 0.9)
grass = mat("ground", (0.16, 0.2, 0.13, 1), 0.0, 0.95)
paint = mat("paint", (0.9, 0.9, 0.85, 1), 0.0, 0.6)

# Ground, road, markings
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, -2, GROUND_Z - 0.002)); bpy.context.active_object.data.materials.append(grass)
road_w = abs(ROAD_Y[1] - ROAD_Y[0])
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, (ROAD_Y[0] + ROAD_Y[1]) / 2, GROUND_Z))
road = bpy.context.active_object; road.scale = (40, road_w, 1); road.data.materials.append(asphalt)
for y in ROAD_Y:
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, y, GROUND_Z + 0.002))
    e = bpy.context.active_object; e.scale = (40, 0.05, 1); e.data.materials.append(paint)
for i in range(-20, 20):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(i * 1.0 + 0.25, (ROAD_Y[0] + ROAD_Y[1]) / 2, GROUND_Z + 0.002))
    d = bpy.context.active_object; d.scale = (0.5, 0.05, 1); d.data.materials.append(paint)



def vertebra():
    """One segment along +X (0..SEGMENT): a rounded barrel that bulges in the middle and draws in at both ends,
    with a yellow ring in the joint so each gap shows a thin line of colour."""
    import bmesh
    me = bpy.data.meshes.new("vertebra"); bm = bmesh.new()
    around, steps = 40, 14
    rings = []
    for i in range(steps + 1):
        u = i / steps                                   # 0..1 along the segment
        x = 0.012 + u * (SEGMENT - 0.024)
        r = RADIUS * (0.80 + 0.20 * math.sin(math.pi * u) ** 0.6)
        rings.append([bm.verts.new((x, math.cos(2 * math.pi * k / around) * r, math.sin(2 * math.pi * k / around) * r))
                      for k in range(around)])
    for i in range(steps):
        for k in range(around):
            f = bm.faces.new((rings[i][k], rings[i][(k + 1) % around], rings[i + 1][(k + 1) % around], rings[i + 1][k]))
            f.material_index = 0
    # Joint: a yellow ring at the segment's back, inside the barrel's ends, bridging to the next segment
    jr = bmesh.ops.create_cone(bm, cap_ends=False, segments=around, radius1=RADIUS * 0.78, radius2=RADIUS * 0.78, depth=0.03)
    for v in jr["verts"]:
        z = v.co.z; v.co.z = v.co.x; v.co.x = z
    for f in {f for v in jr["verts"] for f in v.link_faces}:
        f.material_index = 1
    bm.to_mesh(me); bm.free()
    for f in me.polygons:
        f.use_smooth = True
    return me


dark = bpy.data.materials.new("tentacle_dark"); dark.use_nodes = True
db = next(n for n in dark.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
db.inputs["Base Color"].default_value = (0.06, 0.06, 0.065, 1); db.inputs["Metallic"].default_value = 0.95
db.inputs["Roughness"].default_value = 0.22

curves = {}
for name, t in TENTACLES.items():
    socket = Vector(t["socket"])
    # Collar where the tentacle leaves the torso
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=RADIUS * 1.12, depth=0.07, location=socket)
    col = bpy.context.active_object
    col.rotation_mode = "QUATERNION"; col.rotation_quaternion = Vector(t["out"]).normalized().to_track_quat("Z", "Y")
    col.data.materials.append(yellow)
    cd = bpy.data.curves.new(name + "_path", "CURVE"); cd.dimensions = "3D"; cd.resolution_u = 48
    sp = cd.splines.new("BEZIER"); sp.bezier_points.add(1)
    for bp in sp.bezier_points:
        bp.handle_left_type = bp.handle_right_type = "FREE"
    path = bpy.data.objects.new(name + "_path", cd); scene.collection.objects.link(path)
    chain = bpy.data.objects.new(name + "_chain", vertebra()); scene.collection.objects.link(chain)
    chain.data.materials.append(dark); chain.data.materials.append(yellow)
    arr = chain.modifiers.new("chain", "ARRAY"); arr.fit_type = "FIT_CURVE"; arr.curve = path
    arr.use_relative_offset = True; arr.relative_offset_displace = (1, 0, 0)
    deform = chain.modifiers.new("along", "CURVE"); deform.object = path; deform.deform_axis = "POS_X"
    curves[name] = (path, sp)

saw_obj = {n: scene.objects[n] for n in TENTACLES}
for o in saw_obj.values():
    o.parent = None
saw_local_box = {n: [Vector(c) for c in o.bound_box] for n, o in saw_obj.items()}
rest = {n: (o.location.copy(), Vector(saws[n]["axis"]).normalized()) for n, o in saw_obj.items()}


def pose(frame):
    """Docked as the model was built (saw heads where its arms held them), out across the road with the heads
    held level just above the asphalt, a sweep along it, then back in."""
    t = frame / FPS
    for name, spec in TENTACLES.items():
        t_out, t_in = spec["extend"]
        reach = smooth((t - t_out) / 1.6) * (1 - smooth((t - t_in) / 1.2))
        ob, sp = curves[name]
        socket = Vector(spec["socket"]); out = Vector(spec["out"]).normalized()
        home, axis = rest[name]
        far = Vector((target_x(spec, t), spec["lane"], GROUND_Z + SAW_HOVER))
        sway = Vector((math.sin(t * 2.1 + len(name)), math.cos(t * 1.7 + len(name)), 0)) * 0.05
        end = home.lerp(far + sway, reach)
        span = (end - socket).length
        flat = Vector(((end - socket).x, (end - socket).y, 0)).normalized()
        reach_dir = Vector((flat.x, flat.y, -math.tan(math.radians(SAW_TILT_DEG)))).normalized()
        end_dir = axis.lerp(reach_dir, reach).normalized()
        p0, p3 = socket, end
        p1 = socket + out * span * 0.35 + Vector((0, 0, spec["lift"] * span)) * reach
        p2 = end - end_dir * span * 0.35
        b0, b1 = sp.bezier_points
        b0.co, b0.handle_left, b0.handle_right = p0, p0 - (p1 - p0), p1
        b1.co, b1.handle_left, b1.handle_right = p3, p2, p3 + (p3 - p2)
        saw = saw_obj[name]
        q = axis.rotation_difference(end_dir)
        scale = 1 + (SAW_SCALE - 1) * reach
        # Lift the head (and the arm's end with it) if any corner of it would dip under the asphalt
        m = Matrix.Translation(p3) @ q.to_matrix().to_4x4() @ Matrix.Scale(scale, 4)
        low = min((m @ Vector(c)).z for c in saw_local_box[name])
        if low < GROUND_Z + 0.03:
            p3 = p3 + Vector((0, 0, GROUND_Z + 0.03 - low)); p2 = p3 - end_dir * span * 0.35
            b1.co, b1.handle_left, b1.handle_right = p3, p2, p3 + (p3 - p2)
        saw.location = p3
        saw.rotation_mode = "QUATERNION"
        saw.rotation_quaternion = q
        saw.scale = (scale,) * 3
        for bp in (b0, b1):
            bp.keyframe_insert("co", frame=frame); bp.keyframe_insert("handle_left", frame=frame); bp.keyframe_insert("handle_right", frame=frame)
        saw.keyframe_insert("location", frame=frame); saw.keyframe_insert("rotation_quaternion", frame=frame)
        saw.keyframe_insert("scale", frame=frame)
    # Camera: close on the docked tower, back and up while the arms reach across the road, a little in again
    k = smooth((t - 0.9) / 3.2) * (1 - 0.35 * smooth((t - 6.0) / 1.0))
    target = Vector((-0.28, 0.1, -0.1)).lerp(Vector((0.2, -2.2, -0.6)), k)
    offset = Vector((-2.3, -3.2, 1.2)).lerp(Vector((-6.5, -9.5, 5.2)), k)
    cam.location = target + offset
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (target - cam.location).to_track_quat("-Z", "Y")
    cam.keyframe_insert("location", frame=frame); cam.keyframe_insert("rotation_quaternion", frame=frame)


cd = bpy.data.cameras.new("cam"); cd.angle = math.radians(40); cd.clip_end = 200
cam = bpy.data.objects.new("cam", cd); scene.collection.objects.link(cam); scene.camera = cam
for rot, energy, color in (((math.radians(48), 0, math.radians(30)), 3.5, (1.0, 0.95, 0.88)),
                           ((math.radians(-55), 0, math.radians(210)), 1.6, (0.75, 0.85, 1.0))):
    d = bpy.data.lights.new("sun", "SUN"); d.energy = energy; d.color = color; d.angle = math.radians(3)
    o = bpy.data.objects.new("sun", d); scene.collection.objects.link(o); o.rotation_euler = rot
world = scene.world or bpy.data.worlds.new("w"); scene.world = world
world.use_nodes = True
next(n for n in world.node_tree.nodes if n.type == "BACKGROUND").inputs[0].default_value = (0.32, 0.38, 0.46, 1)

scene.frame_start, scene.frame_end = 1, FRAMES
for f in range(1, FRAMES + 1):
    pose(f)
r = scene.render
try:
    r.engine = "BLENDER_EEVEE"
except TypeError:
    r.engine = "BLENDER_EEVEE_NEXT"
try:
    scene.eevee.taa_render_samples = 32
    scene.eevee.use_shadows = True
except AttributeError:
    pass
r.resolution_x, r.resolution_y = RES
r.fps = FPS
r.image_settings.file_format = "PNG"
r.filepath = os.path.join(out_dir, "frames", "f_")
bpy.ops.render.render(animation=True)
print("TENTACLE_PREVIEW_DONE")
