"""Split the two guns of the dual-gatling turret into their own nodes so they
can tilt, and write the result as a copy next to the original.

The gun bodies (barrels, housing, ammo box) sit on a fixed saddle on the
turret plate. Every loose part of turret_top whose lowest vertex lies at or
above the saddle top belongs to a gun; its side (Blender -Y / +Y) decides
which one. Each gun becomes a child of turret_top with its origin on the
trunnion axis, so the game turns turret_top for heading and each gun about
its local Z (glTF) for pitch.

Run:
    blender --background --python tools/blender/gatling_tilt.py -- <in.glb> <out.glb>
"""
import sys
import bpy
import bmesh
from mathutils import Matrix, Vector

# Saddle top: the post and saddle end below it, the gun bodies start at it
GUN_MIN_Z = 0.52
# Trunnion: above the middle of the saddle, a little into the gun body
PIVOT_X = 0.0
PIVOT_Z = 0.62

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
top = bpy.data.objects['turret_top']


def loose_parts(bm):
    seen = set()
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen:
                    seen.add(y.index)
                    stack.append(y)
        yield comp


def gun_vertex_mask(mesh, side):
    """Vertex indices of the gun on `side` (-1: Blender -Y, +1: +Y)."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    mask = set()
    for comp in loose_parts(bm):
        if min(v.co.z for v in comp) < GUN_MIN_Z:
            continue
        cy = sum(v.co.y for v in comp) / len(comp)
        if (cy > 0) == (side > 0):
            mask.update(v.index for v in comp)
    bm.free()
    return mask


def keep_only(mesh, keep):
    """Delete every vertex of `mesh` whose index is not in `keep`."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context='VERTS')
    bm.to_mesh(mesh)
    bm.free()


def split_gun(side):
    """Separate the gun on `side` from turret_top into its own object."""
    mask = gun_vertex_mask(top.data, side)
    gun_mesh = top.data.copy()
    keep_only(gun_mesh, mask)
    keep_only(top.data, set(range(len(top.data.vertices))) - mask)
    name = 'gun_left' if side < 0 else 'gun_right'
    gun_mesh.name = name
    gun = bpy.data.objects.new(name, gun_mesh)
    top.users_collection[0].objects.link(gun)
    return gun


for side in (-1, 1):
    gun = split_gun(side)
    ys = [v.co.y for v in gun.data.vertices]
    pivot_local = Vector((PIVOT_X, (min(ys) + max(ys)) / 2, PIVOT_Z))
    # Move the mesh so the object origin sits on the trunnion
    gun.data.transform(Matrix.Translation(-pivot_local))
    gun.parent = top
    gun.location = pivot_local
    print(f'{gun.name}: {len(gun.data.vertices)} verts, pivot {tuple(round(c, 3) for c in pivot_local)}')

print(f'turret_top: {len(top.data.vertices)} verts')

bpy.ops.export_scene.gltf(
    filepath=DST,
    export_format='GLB',
    export_image_format='AUTO',
    export_yup=True,
    export_apply=False,
    export_animations=False,
)
