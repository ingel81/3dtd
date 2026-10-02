"""Split one fused tower mesh (a Meshy candidate) into the parts the game moves, from a JSON config.

    blender.exe -b <candidate.blend> -P tools/blender/split_tower.py -- <config.json> <out_dir> [check] [show]

Config (metres, Z up, the file's own coordinates), see towers/*.json:
    {
      "yaw": [x, y, z],                       the turret's vertical axis and its foot
      "parts": [                              first match wins, the last part takes the rest
        {"name": "gun", "parent": "turret", "pivot": [x, y, z],
         "rules": [{"beyond": {"point": [...], "normal": [...]}}, {"box": {"lo": [...], "hi": [...]}}],
         "motion": [{"type": "swing", "axis": [0, 1, 0], "deg": 9, "period": 3.0}]},
        {"name": "base", "rules": [{"zBelow": -0.38}]},
        {"name": "turret", "parent": "base", "pivot": "yaw"}
      ]
    }

Rules on a face's centre: zBelow/zAbove/yBelow/yAbove/xBelow/xAbove, beyond (a half space), box, notBox,
radiusBelow/radiusAbove (around a vertical axis), loose (the k-th biggest connected piece of the mesh), colour and
notColour (hue range and saturation of the texture at the face). Small islands a cut leaves are given to the
neighbouring part. A part named drop_* is cut away. A part may have its own "pivot" and a fixed "restRotationDeg".
Motions: swing, spin (optionally ramped up with "rampUp"), stroke, slide, recoil, throw; "stream" sends copies of
loose pieces out in salvos timed to a stroke. `check` renders each part in its own colour from four sides, `show`
renders a clip with a ground and a circling camera into <out_dir>/show.
"""
import bpy, bmesh, sys, math, os, json
from mathutils import Vector, Matrix, Quaternion


args = sys.argv[sys.argv.index("--") + 1:]
config = json.load(open(args[0]))
out_dir = args[1]
flags = set(args[2:])
os.makedirs(out_dir, exist_ok=True)
scene = bpy.context.scene
for o in list(scene.objects):
    if o.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(o, do_unlink=True)

src = next(o for o in scene.objects if o.type == "MESH")
src.data.transform(src.matrix_world)
src.matrix_world = Matrix.Identity(4)


def holds(rule, c, loose=0, hsv=None):
    if "loose" in rule: return loose in rule["loose"]
    if "colour" in rule or "notColour" in rule:
        cr = rule.get("colour") or rule["notColour"]
        hit = hsv is not None and cr["hue"][0] <= hsv[0] * 360 <= cr["hue"][1] and hsv[1] >= cr.get("satMin", 0)             and hsv[2] <= cr.get("valMax", 1)
        return hit if "colour" in rule else not hit
    if "zBelow" in rule: return c.z < rule["zBelow"]
    if "zAbove" in rule: return c.z > rule["zAbove"]
    if "yBelow" in rule: return c.y < rule["yBelow"]
    if "yAbove" in rule: return c.y > rule["yAbove"]
    if "xBelow" in rule: return c.x < rule["xBelow"]
    if "xAbove" in rule: return c.x > rule["xAbove"]
    if "beyond" in rule:
        b = rule["beyond"]
        return (c - Vector(b["point"])).dot(Vector(b["normal"])) > 0
    if "box" in rule:
        lo, hi = rule["box"]["lo"], rule["box"]["hi"]
        return all(lo[k] <= c[k] <= hi[k] for k in range(3))
    if "radiusBelow" in rule:
        c0 = rule["radiusBelow"]["centre"]; return math.hypot(c.x - c0[0], c.y - c0[1]) < rule["radiusBelow"]["r"]
    if "radiusAbove" in rule:
        c0 = rule["radiusAbove"]["centre"]; return math.hypot(c.x - c0[0], c.y - c0[1]) > rule["radiusAbove"]["r"]
    if "notBox" in rule:
        lo, hi = rule["notBox"]["lo"], rule["notBox"]["hi"]
        return not all(lo[k] <= c[k] <= hi[k] for k in range(3))
    raise ValueError(rule)


specs = config["parts"]


def part_of(c, loose=0, hsv=None):
    for spec in specs[:-1]:
        if all(holds(r, c, loose, hsv) for r in spec["rules"]):
            return spec["name"]
    return specs[-1]["name"]


bm = bmesh.new()
bm.from_mesh(src.data)
bm.faces.ensure_lookup_table()
# Texture colour of every face (rule "colour"): the base colour image sampled at the face's UV centre, as HSV
face_hsv = None
if any("colour" in r for sp_ in specs for r in sp_.get("rules", [])):
    import colorsys
    img = next(n.image for m in src.data.materials if m and m.use_nodes for n in m.node_tree.nodes
               if n.type == "TEX_IMAGE" and n.image)
    w, h = img.size
    px = list(img.pixels)
    uv = src.data.uv_layers.active.data
    face_hsv = []
    for poly in src.data.polygons:
        u = sum(uv[i].uv.x for i in poly.loop_indices) / poly.loop_total
        v = sum(uv[i].uv.y for i in poly.loop_indices) / poly.loop_total
        x = min(w - 1, max(0, int(u % 1.0 * w))); y = min(h - 1, max(0, int(v % 1.0 * h)))
        k = (y * w + x) * 4
        face_hsv.append(colorsys.rgb_to_hsv(px[k], px[k + 1], px[k + 2]))

# Loose rank of every face: 0 for the biggest connected piece of the mesh, 1 for the next, ... (rule "loose")
parent_of = list(range(len(bm.verts)))
def find(i):
    while parent_of[i] != i:
        parent_of[i] = parent_of[parent_of[i]]; i = parent_of[i]
    return i
for e in bm.edges:
    a_, b_ = find(e.verts[0].index), find(e.verts[1].index)
    if a_ != b_:
        parent_of[a_] = b_
roots = [find(f.verts[0].index) for f in bm.faces]
sizes = {}
for r_ in roots:
    sizes[r_] = sizes.get(r_, 0) + 1
rank_of = {r_: k for k, r_ in enumerate(sorted(sizes, key=lambda r_: -sizes[r_]))}
loose_rank = [rank_of[r_] for r_ in roots]
owner = [part_of(f.calc_center_median(), loose_rank[f.index], face_hsv[f.index] if face_hsv else None) for f in bm.faces]

# Islands: a cut through interlocking geometry leaves small patches of one part inside another (a sliver of the
# arm's underside in the base). A patch under ISLAND_SHARE of its part's faces goes to the neighbour it shares
# the most edges with, so nothing floats when the parts move.
ISLAND_SHARE = config.get("islandShare", 0.02)
neighbours = [[g.index for e in f.edges for g in e.link_faces if g.index != f.index] for f in bm.faces]
counts = {}
for o_ in owner:
    counts[o_] = counts.get(o_, 0) + 1
for _ in range(3):
    seen = [False] * len(owner)
    moved = 0
    for start in range(len(owner)):
        if seen[start]:
            continue
        name = owner[start]
        island, stack = [], [start]
        seen[start] = True
        while stack:
            i = stack.pop()
            island.append(i)
            for j in neighbours[i]:
                if not seen[j] and owner[j] == name:
                    seen[j] = True
                    stack.append(j)
        if len(island) >= counts[name] * ISLAND_SHARE:
            continue
        border = {}
        for i in island:
            for j in neighbours[i]:
                if owner[j] != name:
                    border[owner[j]] = border.get(owner[j], 0) + 1
        if not border:
            continue
        to = max(border, key=border.get)
        for i in island:
            owner[i] = to
        counts[name] -= len(island); counts[to] += len(island)
        moved += len(island)
    print("ISLANDS moved", moved)
    if moved == 0:
        break
bm.free()

parts = {}
for spec in specs:
    name = spec["name"]
    dup = src.copy(); dup.data = src.data.copy(); dup.name = name
    scene.collection.objects.link(dup)
    b = bmesh.new(); b.from_mesh(dup.data); b.faces.ensure_lookup_table()
    bmesh.ops.delete(b, geom=[f for f in b.faces if owner[f.index] != name], context="FACES")
    bmesh.ops.delete(b, geom=[v for v in b.verts if not v.link_faces], context="VERTS")
    b.to_mesh(dup.data); b.free()
    dup.rotation_mode = "XYZ"
    parts[name] = dup
bpy.data.objects.remove(src, do_unlink=True)
# Parts named drop_* are cut away for good (e.g. arms another script replaces)
for name in [n for n in parts if n.startswith("drop_")]:
    bpy.data.objects.remove(parts.pop(name), do_unlink=True)
specs = [s for s in specs if not s["name"].startswith("drop_")]

def set_origin(obj, point):
    obj.data.transform(Matrix.Translation(-(point - obj.location)))
    obj.location = point


yaw = Vector(config["yaw"])
for spec in specs:
    pivot = spec.get("pivot")
    if pivot == "yaw":
        set_origin(parts[spec["name"]], yaw)
    elif pivot is not None:
        set_origin(parts[spec["name"]], Vector(pivot))
bpy.context.view_layer.update()
for spec in specs:
    parent = spec.get("parent")
    if parent:
        child = parts[spec["name"]]
        child.parent = parts[parent]
        child.matrix_parent_inverse = parts[parent].matrix_world.inverted()
bpy.context.view_layer.update()

# A part may be posed for good (e.g. an arm lifted clear of the base); its children follow
for spec in specs:
    if "restRotationDeg" in spec:
        parts[spec["name"]].rotation_euler = [math.radians(v) for v in spec["restRotationDeg"]]
bpy.context.view_layer.update()

stats = {}
for name, o in parts.items():
    o.data.calc_loop_triangles()
    stats[name] = len(o.data.loop_triangles)
json.dump({"triangles": stats}, open(os.path.join(out_dir, "split.json"), "w"), indent=1)
print("SPLIT", stats)

def setup_camera(offset):
    cam = scene.camera
    if cam is None:
        cd = bpy.data.cameras.new("cam"); cd.angle = math.radians(35)
        cam = bpy.data.objects.new("cam", cd); scene.collection.objects.link(cam); scene.camera = cam
    target = Vector((yaw.x, yaw.y, 0.0))
    cam.location = target + offset
    cam.data.clip_end = 100
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()


r = scene.render
r.resolution_x = r.resolution_y = 720
r.image_settings.file_format = "PNG"

SHOW_FPS = 30
SHOW_FRAMES = 180


def ramp_cycles(t, hz, ramp):
    """Cycles turned by time t at hz, spun up from rest over `ramp` seconds (smoothstep speed): the integral of
    hz * smoothstep(t / ramp), u^3 - u^4 / 2 over the ramp."""
    if ramp <= 0:
        return hz * t
    u = min(1.0, t / ramp)
    cycles = hz * ramp * (u ** 3 - u ** 4 / 2)
    return cycles + (hz * (t - ramp) if t > ramp else 0.0)


def motion_at(spec, t):
    """Rotation and offset of a part at time t from its "motion" list (axes in its parent's rest frame)."""
    q = Quaternion(); off = Vector()
    for m in spec.get("motion", []):
        axis = Vector(m.get("axis", (0, 0, 1))).normalized()
        phase = m.get("phase", 0.0)
        if m["type"] == "swing":
            q = Quaternion(axis, math.radians(m["deg"]) * math.sin(2 * math.pi * (t / m["period"] + phase))) @ q
        elif m["type"] == "spin":
            turns = ramp_cycles(t, m["rps"], config.get("rampUp", 0)) if m.get("ramped") else m["rps"] * t
            q = Quaternion(axis, 2 * math.pi * turns) @ q
        elif m["type"] == "stroke":
            # A swing whose rate spins up with the tower's drive (rampUp), so it keeps time with a ramped spin
            c = ramp_cycles(t, m["hz"], config.get("rampUp", 0))
            q = Quaternion(axis, math.radians(m["deg"]) * math.sin(2 * math.pi * c)) @ q
        elif m["type"] == "slide":
            off += axis * m["length"] * (0.5 - 0.5 * math.cos(2 * math.pi * (t / m["period"] + phase)))
        elif m["type"] == "recoil":
            k = (t / m["period"] + phase) % 1.0
            v = k / 0.06 if k < 0.06 else max(0.0, 1 - (k - 0.06) / 0.45)
            off += axis * m["length"] * v
        elif m["type"] == "throw":
            k = (t / m["period"] + phase) % 1.0
            off += axis * m["length"] * k + Vector((0, 0, m["height"] * 4 * k * (1 - k)))
            q = Quaternion(Vector((1, 0.3, 0.2)).normalized(), math.radians(m.get("tumbleDeg", 720)) * k) @ q
    return q, off


def show():
    """A clip with a ground and a camera circling the tower while every part runs its motion."""
    for o in parts.values():
        o.color = (1, 1, 1, 1)
    try:
        r.engine = "BLENDER_EEVEE"
    except TypeError:
        r.engine = "BLENDER_EEVEE_NEXT"
    try:
        scene.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    lows = [min((o.matrix_world @ Vector(c)).z for c in o.bound_box) for o in parts.values()]
    span = max(max((o.matrix_world @ Vector(c)) .length for c in o.bound_box) for o in parts.values())
    ground_z = min(lows)
    g = bpy.data.materials.new("ground"); g.use_nodes = True
    gb = next(n for n in g.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    gb.inputs["Base Color"].default_value = (0.22, 0.24, 0.22, 1); gb.inputs["Roughness"].default_value = 0.9
    bpy.ops.mesh.primitive_plane_add(size=40, location=(yaw.x, yaw.y, ground_z - 0.002))
    bpy.context.active_object.data.materials.append(g)
    for rot, energy, color in (((math.radians(48), 0, math.radians(30)), 3.5, (1.0, 0.95, 0.88)),
                               ((math.radians(-55), 0, math.radians(210)), 1.6, (0.75, 0.85, 1.0))):
        d = bpy.data.lights.new("sun", "SUN"); d.energy = energy; d.color = color; d.angle = math.radians(3)
        o = bpy.data.objects.new("sun", d); scene.collection.objects.link(o); o.rotation_euler = rot
    world = scene.world or bpy.data.worlds.new("w"); scene.world = world
    world.use_nodes = True
    next(n for n in world.node_tree.nodes if n.type == "BACKGROUND").inputs[0].default_value = (0.32, 0.38, 0.46, 1)
    cd = bpy.data.cameras.new("show_cam"); cd.angle = math.radians(38); cd.clip_end = 200
    cam = bpy.data.objects.new("show_cam", cd); scene.collection.objects.link(cam); scene.camera = cam
    stream = []
    st = config.get("stream")
    if st:
        # Pieces cut off in salvos, one salvo per stroke of the cutting arm, so their rate follows the drive's
        # spin-up; each flies straight out at `speed` for `flight` seconds and is hidden otherwise. A pool of copies
        # of the loose pieces is reused round-robin.
        start = Vector(st["from"]); direction = Vector(st["dir"]).normalized()
        sources = [parts[n] for n in st["sources"]]
        for o in sources:
            o.hide_render = True
        holder = parts[st["parent"]]
        bpy.context.view_layer.update()
        pool = []
        for i in range(st["pool"]):
            src_o = sources[i % len(sources)]
            me = src_o.data.copy(); me.transform(src_o.matrix_world)
            centre = sum((v.co for v in me.vertices), Vector()) / len(me.vertices)
            me.transform(Matrix.Translation(-centre))
            cp = bpy.data.objects.new(f"piece_{i}", me); scene.collection.objects.link(cp)
            cp.location = start
            cp.parent = holder; cp.matrix_parent_inverse = holder.matrix_world.inverted()
            cp.rotation_mode = "QUATERNION"
            pool.append(cp)
        # Emission times: every 1 / perStroke of a stroke cycle, found on a fine time grid
        end = SHOW_FRAMES / SHOW_FPS
        emits, k, step = [], 1, 1 / 1200
        t_ = 0.0
        while t_ < end:
            if ramp_cycles(t_, st["strokeHz"], config.get("rampUp", 0)) * st["perStroke"] >= k:
                emits.append(t_); k += 1
            t_ += step
        stream = (pool, emits, start, direction)
    rest_loc = {n: o.location.copy() for n, o in parts.items()}
    moving = [s_ for s_ in specs if s_.get("motion")]
    for s_ in moving:
        parts[s_["name"]].rotation_mode = "QUATERNION"
    target = Vector((yaw.x, yaw.y, ground_z + span * 0.55))
    dist = span * config.get("showDistance", 4.4)
    scene.frame_start, scene.frame_end = 1, SHOW_FRAMES
    for f in range(1, SHOW_FRAMES + 1):
        t = (f - 1) / SHOW_FPS
        for s_ in moving:
            o = parts[s_["name"]]
            q, off = motion_at(s_, t)
            o.rotation_quaternion = q
            o.location = rest_loc[s_["name"]] + off
            o.keyframe_insert("rotation_quaternion", frame=f); o.keyframe_insert("location", frame=f)
        if stream:
            pool, emits, start, direction = stream
            live = [e for e in emits if 0 <= t - e < st["flight"]]
            for j, piece in enumerate(pool):
                mine = [e for e in live if emits.index(e) % len(pool) == j]
                if mine:
                    age = t - mine[-1]
                    piece.location = start + direction * st["speed"] * age + Vector((0, 0, -2.0 * age * age))
                    piece.rotation_quaternion = Quaternion(Vector((0.3, 1, 0.2)).normalized(), age * 25)
                    piece.scale = (st.get("scale", 1.0),) * 3
                else:
                    piece.location = start; piece.scale = (0.0001,) * 3
                piece.keyframe_insert("location", frame=f); piece.keyframe_insert("rotation_quaternion", frame=f)
                piece.keyframe_insert("scale", frame=f)
        a = math.radians(-125 + 70 * t / (SHOW_FRAMES / SHOW_FPS))
        cam.location = target + Vector((math.cos(a) * dist, math.sin(a) * dist, dist * 0.42))
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = (target - cam.location).to_track_quat("-Z", "Y")
        cam.keyframe_insert("location", frame=f); cam.keyframe_insert("rotation_quaternion", frame=f)
    r.resolution_x, r.resolution_y = 1280, 720
    r.fps = SHOW_FPS
    r.use_motion_blur = True
    try:
        r.motion_blur_shutter = 0.5
    except AttributeError:
        pass
    r.filepath = os.path.join(out_dir, "show", "f_")
    bpy.ops.render.render(animation=True)


if "check" in flags:
    palette = [(0.55, 0.55, 0.55, 1), (0.2, 0.5, 1.0, 1), (1.0, 0.45, 0.1, 1), (0.2, 0.8, 0.3, 1),
               (0.85, 0.2, 0.6, 1), (0.95, 0.85, 0.2, 1), (0.5, 0.3, 0.9, 1), (0.3, 0.9, 0.9, 1)]
    for i, o in enumerate(parts.values()):
        o.color = palette[i % len(palette)]
    r.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "STUDIO"; sh.color_type = "OBJECT"; sh.show_cavity = True
    d = config.get("checkDistance", 3.6)
    shots = [("a", Vector((-d, -0.6, 0.7)), 0), ("b", Vector((0.6, -d, 0.7)), 0), ("c", Vector((d, 0.6, 0.7)), 0),
             ("d", Vector((-0.6, d, 0.7)), 0)]
    for name, off, _ in shots:
        setup_camera(off)
        r.filepath = os.path.join(out_dir, "check_" + name + ".png")
        bpy.ops.render.render(write_still=True)

if "show" in flags:
    show()
print("SPLIT_TOWER_DONE")
