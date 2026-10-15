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

The model is moved so the turret's yaw axis stands on x = y = 0 and its lowest point on z = 0 (glTF y = 0). Every
node keeps no rotation; a part's origin is its pivot, the base's the model origin. Material as the other towers:
metallic 0, roughness 0.6, the Meshy metal/roughness and normal maps are left out. Prints the triangles per part, the
size and the bounds, `BUILD_TOWER {...}` as JSON.
"""
import bpy, sys, os, json, math
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
    o.data.transform(Matrix.Translation(shift - origin[name]))
    o.data.materials.clear()
    o.data.materials.append(mat)
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))

# Level a part's barrel about its pivot
for lv in exp.get("level", []):
    d = Vector(lv["dir"]).normalized()
    flat = Vector((d.x, d.y, 0)).normalized()
    parts[lv["part"]].data.transform(d.rotation_difference(flat).to_matrix().to_4x4())
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
