"""Game GLB of a Meshy tower candidate, after split_tower.py has cut it into its parts.

    blender.exe -b --factory-startup <candidate.blend> --python tools/blender/split_tower.py
        --python tools/blender/build_tower.py -- <config.json> <out_dir>

Reads the "export" block of the same config (towers/*.json):
    "export": {
      "glb": "public/assets/models/towers/bastion.glb",
      "triangles": 45000,                     the whole model after decimation, shared out by each part's share
      "texture": 1024, "quality": 88,         the base colour only, scaled and stored as JPEG
      "names": {"turret": "turret_top"},      node names in the GLB (default: the part's own name)
      "level": [{"part": "gun", "dir": [-0.859, 0.016, 0.513]}]
    }
"level" turns a part about its pivot until `dir` (its barrel in the file) lies horizontal: the game tilts the
gun from there (TowerTypeConfig.pitchNodes, aim pitch 0 = level).

"morphs" give a part shape keys, exported as glTF morph targets the game blends (the ballista's string slack,
TowerTypeConfig.firingMotion.reload.release), in the file's coordinates:
      "morphs": [{"part": "weapon", "name": "relaxed", "moves": [
        {"type": "segment", "from": [A, B], "to": [null, B2], "radius": 0.016, "span": [0, 0.985]},
        {"type": "bend", "box": {"lo": [...], "hi": [...]}, "pivot": [...], "axis": [0, 0, 1], "deg": -7,
         "along": [0, -1, 0], "reach": [0, 0.56]}]}]
"segment" moves the faces that lie wholly within `radius` of the line A-B (between the shares `span` of its length)
onto the line A2-B2, turned with it and stretched along it (a string), cut loose from the faces round them; an end
given as null goes where the moves after it put that point (the string's end on a bending limb). Every other vertex
takes the first bend whose box holds it. "bend" turns what
lies in `box` about `axis` through `pivot`, by `deg` times its reach along `along` from the pivot, 0 at reach[0]
and full at reach[1] (a limb flexing).

The model is moved so the turret's yaw axis stands on x = y = 0 and its lowest point on z = 0 (glTF y = 0). Every
node keeps no rotation; a part's origin is its pivot, the base's the model origin. Material as the other towers:
metallic 0, roughness 0.6, the Meshy metal/roughness and normal maps are left out. Prints the triangles per part, the
size and the bounds, `BUILD_TOWER {...}` as JSON.
"""
import bpy, bmesh, sys, os, json, math
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index("--") + 1:]
config = json.load(open(args[0]))
exp = config["export"]
scene = bpy.context.scene
specs = [s for s in config["parts"] if not s["name"].startswith("drop_")]
parts = {s["name"]: bpy.data.objects[s["name"]] for s in specs}

# Every part to world coordinates, no parents: the hierarchy is built again below
world_origin = {}
for name, o in parts.items():
    world_origin[name] = o.matrix_world.translation.copy()
for name, o in parts.items():
    mw = o.matrix_world.copy()
    o.parent = None
    o.data.transform(mw)
    o.matrix_world = Matrix.Identity(4)
bpy.context.view_layer.update()

yaw = Vector(config["yaw"])
z_min = min(v.co.z for o in parts.values() for v in o.data.vertices)
shift = Vector((-yaw.x, -yaw.y, -z_min))

# Decimate: each part keeps its share of the triangles
for o in parts.values():
    o.data.calc_loop_triangles()
total = sum(len(o.data.loop_triangles) for o in parts.values())
ratio = min(1.0, exp["triangles"] / total)
for o in parts.values():
    mod = o.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        bpy.ops.object.modifier_apply(modifier=mod.name)

def bend_point(move, co):
    rel = co - Vector(move["pivot"])
    a, b = move["reach"]
    w = min(1.0, max(0.0, (rel.dot(Vector(move["along"]).normalized()) - a) / (b - a)))
    return Vector(move["pivot"]) + Matrix.Rotation(math.radians(move["deg"]) * w, 3, Vector(move["axis"]).normalized()) @ rel


def in_box(box, co):
    return all(box["lo"][k] <= co[k] <= box["hi"][k] for k in range(3))


def moved_point(moves, co):
    """Where the bend moves put a point (a segment's end given as null)."""
    for mv in moves:
        if mv["type"] == "bend" and in_box(mv["box"], co):
            return bend_point(mv, co)
    return co


def seg_holds(seg, co):
    """Whether `co` lies within the segment move's radius of its line, between the shares `span`; and its share."""
    _, a, b, _, _, _, mv = seg
    d = b - a
    s_ = (co - a).dot(d) / d.length_squared
    lo, hi = mv.get("span", (0.0, 1.0))
    return lo <= s_ <= hi and (co - (a + d * s_)).length <= mv["radius"], s_


for morph in exp.get("morphs", []):
    o = parts[morph["part"]]
    moves = morph["moves"]
    segs = []
    for i, mv in enumerate(moves):
        if mv["type"] != "segment":
            continue
        a, b = Vector(mv["from"][0]), Vector(mv["from"][1])
        rest = moves[i + 1:]
        a2 = Vector(mv["to"][0]) if mv["to"][0] is not None else moved_point(rest, a)
        b2 = Vector(mv["to"][1]) if mv["to"][1] is not None else moved_point(rest, b)
        segs.append((i, a, b, a2, b2, (b - a).rotation_difference(b2 - a2).to_matrix(), mv))
    # A segment takes whole faces (all corners within it) and is cut loose from the rest: where a string ends in
    # a post, the post stays and the string's end goes with it, no face stretched between them
    bm = bmesh.new()
    bm.from_mesh(o.data)
    seg_of_face = {}
    for f in bm.faces:
        for seg in segs:
            if all(seg_holds(seg, v.co)[0] for v in f.verts):
                seg_of_face[f] = seg
                break
    cut = [e for e in bm.edges if len({seg_of_face[f][0] if f in seg_of_face else -1 for f in e.link_faces}) > 1]
    bmesh.ops.split_edges(bm, edges=cut)
    seg_of_vert = {}
    for f, seg in seg_of_face.items():
        for v in f.verts:
            seg_of_vert[v.index] = seg
    bm.to_mesh(o.data)
    bm.free()
    if o.data.shape_keys is None:
        o.shape_key_add(name="Basis", from_mix=False)
    key = o.shape_key_add(name=morph["name"], from_mix=False)
    counts = [0] * len(moves)
    for v, kv in zip(o.data.vertices, key.data):
        co = v.co
        seg = seg_of_vert.get(v.index)
        if seg is not None:
            i, a, b, a2, b2, turn, _ = seg
            s_ = seg_holds(seg, co)[1]
            kv.co = a2 + (b2 - a2) * s_ + turn @ (co - (a + (b - a) * s_))
            counts[i] += 1
            continue
        for i, mv in enumerate(moves):
            if mv["type"] == "bend" and in_box(mv["box"], co):
                kv.co = bend_point(mv, co)
                counts[i] += 1
                break
    print("MORPH", morph["part"], morph["name"], "vertices per move", counts, "edges cut", len(cut))

# Material: the base colour alone
src_mat = next(m for o in parts.values() for m in o.data.materials if m)
image = next(n.image for n in src_mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image
             and any(l.to_socket.name == "Base Color" for l in n.outputs[0].links))
size = exp.get("texture", 1024)
if image.size[0] != size:
    image = image.copy()
    image.scale(size, size)
mat = bpy.data.materials.new(config.get("material", "Tower"))
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = 0.6
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = image
mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

# Origins: the pivot of each part (the base: the model origin), moved with the model
origin = {}
for spec in specs:
    pivot = spec.get("pivot")
    p = yaw if pivot == "yaw" else Vector(pivot) if pivot is not None else -shift
    origin[spec["name"]] = p + shift
for name, o in parts.items():
    o.data.transform(Matrix.Translation(shift - origin[name]), shape_keys=True)
    o.data.materials.clear()
    o.data.materials.append(mat)
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))

# Level a part's barrel about its pivot
for lv in exp.get("level", []):
    d = Vector(lv["dir"]).normalized()
    flat = Vector((d.x, d.y, 0)).normalized()
    parts[lv["part"]].data.transform(d.rotation_difference(flat).to_matrix().to_4x4(), shape_keys=True)
    print("LEVEL", lv["part"], "by", round(math.degrees(math.asin(d.z)), 2), "deg")

# Hierarchy: no rotation on any node, a child sits at its origin relative to its parent's
for spec in specs:
    o = parts[spec["name"]]
    parent = spec.get("parent")
    if parent:
        o.parent = parts[parent]
        o.matrix_parent_inverse = Matrix.Identity(4)
        o.location = origin[spec["name"]] - origin[parent]
    else:
        o.location = origin[spec["name"]]
    o.rotation_euler = (0, 0, 0)
names = exp.get("names", {})
for name, o in parts.items():
    o.name = names.get(name, name)
    o.data.name = o.name
bpy.context.view_layer.update()

out = exp["glb"]
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
for o in scene.objects:
    o.select_set(o.name in {p.name for p in parts.values()})
options = dict(
    export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
    export_texcoords=True, export_normals=True, export_tangents=False, export_materials="EXPORT",
    export_image_format="JPEG", export_jpeg_quality=exp.get("quality", 88), export_image_quality=exp.get("quality", 88),
    export_attributes=False, export_animations=False, export_draco_mesh_compression_enable=False,
    export_morph=True, export_morph_normal=True, export_morph_tangent=False, export_morph_animation=False,
    export_extras=False, export_vertex_color="NONE", export_cameras=False, export_lights=False)
known = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
bpy.ops.export_scene.gltf(filepath=out, **{k: v for k, v in options.items() if k in known})

report = {"glb": out, "kb": round(os.path.getsize(out) / 1024), "parts": {}}
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for name, o in parts.items():
    o.data.calc_loop_triangles()
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    for p in pts:
        lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
    report["parts"][o.name] = {"triangles": len(o.data.loop_triangles),
                               "origin": [round(c, 4) for c in o.matrix_world.translation],
                               "radiusXY": round(max(math.hypot(p.x, p.y) for p in pts), 4)}
report["bounds"] = {"lo": [round(c, 4) for c in lo], "hi": [round(c, 4) for c in hi]}
print("BUILD_TOWER", json.dumps(report))
