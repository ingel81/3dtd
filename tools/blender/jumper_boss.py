"""Jumper boss (the crab walker with the twin gun on its back):
public/assets/models/enemies/jumper.glb from the source scene.

The source is a Blender scene of 41 link empties and 47 rigid meshes in a
display pose (no armature, no clips), in metres, z up, +x forward, its feet
and claws on z = 0. Kept as it is: proportions, the link hierarchy, the
materials' colours (the procedural micro bump of its shaders is dropped, a
glTF material has none and the enemy renderer shows the base colour). Done
here:

  turret   the deck parts on top (upper_shell_link) are cut apart by loose
           part: what stands on the turret ring turns with a new empty
           `turret_yaw` (pivot the ring's middle), the gun cradle and the two
           barrels tilt with `turret_pitch` under it (pivot the trunnion).
           `muzzle_L` and `muzzle_R` mark the barrels' mouths. The game turns
           both per instance (EnemyTypeConfig.turret, the VAT's turret joints).
  meshes   welded, decimated to the boss budget (docs/ENEMY_MODEL_BUDGET.md,
           at most 15 000 vertices as the game loads them), smooth, with
           normals weighted by face area instead of sharp edges: the source
           is a hard surface with rounded edges, its flat faces stay flat and
           no vertex is split (sharp edges at 38 to 70 degrees split the
           decimated mesh to 36 000 to 49 000 vertices).
  clips    WALK: a diagonal gait of the four legs (left middle with right
           rear, then right middle with left rear), the feet on the ground
           in stance and lifted on an arc in swing, solved per frame by a
           two-link IK in each leg's plane; the body dips as a pair lands,
           rolls and pitches a little; the claws hover off the ground and
           sway, the pincers work. The feet land at FOOTSTEP_PHASES.
           SCUTTLE: the crab's gait, the same pairs and timing stepping
           sideways: the body goes to its left (+y, glTF +x), the feet
           reach out on the leading side and push on the trailing one; the
           body lurches over each landing pair, rolls hard and sways across.
           Played backwards it goes to its right (EnemyTypeConfig.crabGait).
           Same stride and period as WALK, so one animationSpeed fits both.
           The Jumper repository (KingKongRobotics/jumper) has no keyframed
           clip to take: its locomotion is a learned policy for a physics
           simulation, its recorded motions are dances.
           DEATH: the legs give way (the body drops onto its belly, the feet
           slide out), the claws fall, the barrels sag, it rolls to one side
           and lies still from 1.4 s; the clip ends at 1.5 s.
  root     an empty `jumper` turns the model to look along glTF +z, the
           game's forward (headingOffset 0), and scales it by ROOT_SCALE:
           model units of decimetres, so the game's scale (3.25) and preview
           sizes stay in the range of the other enemies.

Headless (Blender 5.1):
    blender --background --python tools/blender/jumper_boss.py -- <source.blend> [--out <glb>] [--preview <dir>]
`--preview` writes stills of the turret split and the clips instead of nothing.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, 'public/assets/models/enemies/jumper.glb')
FPS = 30
# The model in decimetres: 4.2 units long, 2.8 high
ROOT_SCALE = 10

# ── Turret (source metres, z up, +x forward) ──
# The ring the turret stands on: its middle, the yaw pivot
YAW_PIVOT = Vector((-0.014, 0.0, 0.182))
# The trunnion the gun cradle tilts round
PITCH_PIVOT = Vector((0.061, 0.0, 0.2085))
# Barrel mouths
MUZZLES = {'muzzle_L': Vector((0.207, 0.023, 0.2085)), 'muzzle_R': Vector((0.207, -0.023, 0.2085))}
# A loose part of the deck meshes whose middle lies above this turns with the turret
TURRET_FROM_Z = 0.1815
# ... and tilts with the gun when it lies in front of the cradle's back and above its foot
PITCH_FROM_X = 0.0525
PITCH_FROM_Z = 0.19

# ── Mesh budget ──
# Share of the faces each mesh keeps, at least MIN_FACES; the deck and the turret keep more, the grips less
KEEP = 0.055
KEEP_BY_PART = {'shellflow': 0.11, 'base_link': 0.07, 'grip': 0.03, 'pad': 0.03, 'finger_tip': 0.03}
MIN_FACES = 48
WELD_M = 0.00002
# Weight of the face areas in the normals (WEIGHTED_NORMAL)
NORMAL_WEIGHT = 80

# ── Walk ──
WALK_S = 1.6
# Stride of a foot along x in stance (source metres): at animationSpeed 1 the ground passes under the feet at
# STRIDE / (STANCE * WALK_S) * ROOT_SCALE = 1.04 model units a second (EnemyTypeConfig.animationSpeed)
STRIDE = 0.10
SWING = 0.4
STANCE = 1 - SWING
LIFT = 0.03
PAIRS = {'LM': 0.0, 'RR': 0.0, 'RM': 0.5, 'LR': 0.5}
# A foot lands at the end of its swing: the phases of the clip a pair lands at
FOOTSTEP_PHASES = (SWING, 0.5 + SWING)
BOB = 0.003
ROLL = 0.014
PITCH_NOD = 0.008
# The crab's sideways gait: stride as WALK (one animationSpeed for both), a heavier lurch
SCUTTLE_BOB = 0.004
SCUTTLE_ROLL = 0.03
SCUTTLE_SWAY = 0.004
# The feet step in this much nearer the body than WALK's: the stride across stays within WALK's width
SCUTTLE_TUCK = 0.03
# How high the claws hover over the ground while it walks (lowest point, model units)
CLAW_HOVER = 0.02
CLAW_SWAY = 0.05
PINCER = 0.12

# ── Death ──
# Still from 1.4 s; the game holds the last frame until the enemy goes (deathDuration)
DEATH_S = 1.5
DEATH_DROP = 0.088
DEATH_SPLAY = 0.045
DEATH_ROLL = 0.10
DEATH_PITCH = -0.06
BARREL_SAG = -0.22

LEGS = ('LM', 'LR', 'RM', 'RR')
ARMS = ('LF', 'RF')


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = {'source': None, 'out': OUT, 'preview': None}
    i = 0
    while i < len(argv):
        if argv[i] == '--out':
            out['out'] = argv[i + 1]
            i += 2
        elif argv[i] == '--preview':
            out['preview'] = argv[i + 1]
            i += 2
        else:
            out['source'] = argv[i]
            i += 1
    if not out['source']:
        sys.exit('usage: jumper_boss.py -- <source.blend> [--out <glb>] [--preview <dir>]')
    return out


O = None


def obj(name):
    return O[name]


# ───────────────────────────── scene ─────────────────────────────

def clean_scene():
    for coll in list(bpy.data.collections):
        if coll.name.startswith('Studio'):
            for o in list(coll.objects):
                bpy.data.objects.remove(o, do_unlink=True)
            bpy.data.collections.remove(coll)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1


def plain_materials():
    """Base colour, metal and roughness as factors: the noise bump has no glTF form"""
    for mat in bpy.data.materials:
        if not mat.node_tree:
            continue
        nodes = mat.node_tree.nodes
        bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        for n in list(nodes):
            if n.type in ('TEX_NOISE', 'BUMP', 'MAP_RANGE', 'TEX_COORD'):
                nodes.remove(n)


def set_parent(child, parent):
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = world


def empty(name, at, parent):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.01
    for c in parent.users_collection:
        c.objects.link(e)
    e.location = at
    bpy.context.view_layer.update()
    set_parent(e, parent)
    return e


def components(bm):
    """Loose parts of a bmesh as lists of vertex indices"""
    bm.verts.ensure_lookup_table()
    seen = set()
    parts = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack = [v]
        seen.add(v.index)
        ids = []
        while stack:
            x = stack.pop()
            ids.append(x.index)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen:
                    seen.add(y.index)
                    stack.append(y)
        parts.append(ids)
    return parts


def classify(lo, hi):
    """'pitch', 'turret' or 'deck' for a loose part spanning lo..hi (world)"""
    mid_z = (lo.z + hi.z) / 2
    # The star on the turret's face stands flat at the cradle's back, it stays
    if lo.z > PITCH_FROM_Z and lo.x > PITCH_FROM_X and hi.x > PITCH_FROM_X + 0.0005:
        return 'pitch'
    return 'turret' if mid_z > TURRET_FROM_Z else 'deck'


def keep_only(o, ids):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    keep = set(ids)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context='VERTS')
    bm.to_mesh(o.data)
    bm.free()


def split_turret():
    """The deck meshes cut into deck, turret and gun by loose part"""
    shell = obj('upper_shell_link')
    yaw = empty('turret_yaw', YAW_PIVOT, shell)
    pitch = empty('turret_pitch', PITCH_PIVOT, yaw)
    for name, at in MUZZLES.items():
        empty(name, at, pitch)
    targets = {'turret': yaw, 'pitch': pitch}
    counts = {'deck': 0, 'turret': 0, 'pitch': 0}
    for o in [o for o in O if o.type == 'MESH' and o.parent == shell]:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        mw = o.matrix_world
        groups = {'deck': [], 'turret': [], 'pitch': []}
        bm.verts.ensure_lookup_table()
        for ids in components(bm):
            pts = [mw @ bm.verts[i].co for i in ids]
            lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
            hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
            kind = classify(lo, hi)
            groups[kind].extend(ids)
            counts[kind] += len(ids)
        bm.free()
        for kind in ('turret', 'pitch'):
            if not groups[kind]:
                continue
            part = o.copy()
            part.data = o.data.copy()
            part.name = f'{o.name}_{kind}'
            for c in o.users_collection:
                c.objects.link(part)
            keep_only(part, groups[kind])
            bpy.context.view_layer.update()
            set_parent(part, targets[kind])
        if groups['deck']:
            keep_only(o, groups['deck'])
        else:
            bpy.data.objects.remove(o, do_unlink=True)
    print('turret split (vertices):', counts)


def add_root():
    root = bpy.data.objects.new('jumper', None)
    base = obj('base_link')
    for c in base.users_collection:
        c.objects.link(root)
    bpy.context.view_layer.update()
    set_parent(base, root)
    return root


# ───────────────────────────── meshes ─────────────────────────────

def keep_share(name):
    for key, share in KEEP_BY_PART.items():
        if key in name:
            return share
    return KEEP


def reduce_meshes():
    before = after = 0
    for o in [o for o in O if o.type == 'MESH']:
        me = o.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD_M)
        bm.to_mesh(me)
        bm.free()
        faces = len(me.polygons)
        before += faces
        target = max(MIN_FACES, faces * keep_share(o.name))
        if target < faces:
            mod = o.modifiers.new('decimate', 'DECIMATE')
            mod.decimate_type = 'COLLAPSE'
            mod.ratio = target / faces
            mod.use_collapse_triangulate = False
            with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
                bpy.ops.object.modifier_apply(modifier=mod.name)
        me.shade_smooth()
        # Normals weighted by face area: the large faces of a decimated hard surface stay flat
        mod = o.modifiers.new('normals', 'WEIGHTED_NORMAL')
        mod.mode = 'FACE_AREA'
        mod.weight = NORMAL_WEIGHT
        mod.keep_sharp = False
        with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        after += len(me.polygons)
    print(f'faces {before} -> {after}')


# ───────────────────────────── rig math ─────────────────────────────

class Rest:
    """Rest matrices: each link's matrix_basis and the chain's world matrices at rest"""

    def __init__(self):
        bpy.context.view_layer.update()
        self.basis = {o.name: o.matrix_basis.copy() for o in O if o.type == 'EMPTY'}
        self.world = {o.name: o.matrix_world.copy() for o in O if o.type == 'EMPTY'}
        self.rot = {o.name: Euler(o.rotation_euler) for o in O if o.type == 'EMPTY'}
        self.loc = {o.name: o.location.copy() for o in O if o.type == 'EMPTY'}


class Leg:
    """Two-link IK of one leg in its plane: hip yaw about its z, thigh and calf about the plane's normal"""

    def __init__(self, rest, leg):
        self.name = leg
        base_inv = rest.world['base_link'].inverted()
        self.hip_body = base_inv @ rest.world[f'{leg}_hip_link']
        hip_inv = self.hip_body.inverted()
        to_hip = hip_inv @ base_inv
        self.thigh = to_hip @ rest.world[f'{leg}_thigh_link'].translation
        self.calf = to_hip @ rest.world[f'{leg}_calf_link'].translation
        self.tip = to_hip @ rest.world[f'{leg}_foot_tip_link'].translation
        self.foot_world = rest.world[f'{leg}_foot_tip_link'].translation.copy()
        # The plane holds the hip's z and the direction of the foot from the hip
        self.side = Vector((self.tip.x, self.tip.y)).normalized()
        self.l1 = (self.calf - self.thigh).length
        self.l2 = (self.tip - self.calf).length
        self.a1 = self.angle(self.calf - self.thigh)
        self.a2 = self.angle(self.tip - self.calf)
        self.sign = None

    def radial(self, p):
        """(outward, up) of a hip-frame point in the rest plane"""
        return Vector((p.x * self.side.x + p.y * self.side.y, p.z))

    def angle(self, d):
        r = self.radial(d)
        return math.atan2(r.y, r.x)

    def solve(self, target_body):
        """Hip yaw and the in-plane turns of thigh and calf from rest for a foot at `target_body` (base_link frame)"""
        t = self.hip_body.inverted() @ target_body
        rest_dir = math.atan2(self.side.y, self.side.x)
        yaw = math.atan2(t.y, t.x) - rest_dir
        # Into the turned plane
        out = math.hypot(t.x, t.y)
        thigh = self.radial(self.thigh)
        dx = out - thigh.x
        dz = t.z - thigh.y
        d = min(math.hypot(dx, dz), self.l1 + self.l2 - 1e-6)
        base = math.atan2(dz, dx)
        cos_k = (self.l1 ** 2 + d ** 2 - self.l2 ** 2) / (2 * self.l1 * d)
        k = math.acos(max(-1.0, min(1.0, cos_k)))
        # Knee up, as at rest
        a1 = base + k
        knee = Vector((thigh.x + self.l1 * math.cos(a1), thigh.y + self.l1 * math.sin(a1)))
        a2 = math.atan2(dz + thigh.y - knee.y, out - knee.x)
        return yaw, a1 - self.a1, (a2 - a1) - (self.a2 - self.a1)


def calibrate(rest, legs):
    """Which way a turn of the thigh's and calf's x lifts in each leg's plane (+1 or -1)"""
    vl = bpy.context.view_layer
    for leg in legs.values():
        signs = []
        for joint, follower in (('thigh', 'calf'), ('calf', 'foot_tip')):
            o = obj(f'{leg.name}_{joint}_link')
            f = obj(f'{leg.name}_{follower}_link')
            vl.update()
            before = leg.radial(leg.hip_body.inverted() @ rest.world['base_link'].inverted() @ f.matrix_world.translation)
            o.rotation_euler.x += 0.01
            vl.update()
            after = leg.radial(leg.hip_body.inverted() @ rest.world['base_link'].inverted() @ f.matrix_world.translation)
            o.rotation_euler.x -= 0.01
            pivot = leg.radial(leg.hip_body.inverted() @ rest.world['base_link'].inverted() @ o.matrix_world.translation)
            # Counter-clockwise in (outward, up) is positive
            r = before - pivot
            dr = after - before
            signs.append(1 if r.x * dr.y - r.y * dr.x > 0 else -1)
        vl.update()
        leg.sign = signs


def claw_signs(rest):
    """Which way the shoulder's x lifts each claw (+1 or -1)"""
    vl = bpy.context.view_layer
    out = {}
    for arm in ARMS:
        tip = obj(f'{arm}_palm_pad_b_link')
        s = obj(f'{arm}_shoulder_link')
        vl.update()
        z0 = tip.matrix_world.translation.z
        s.rotation_euler.x += 0.05
        vl.update()
        z1 = tip.matrix_world.translation.z
        s.rotation_euler.x -= 0.05
        out[arm] = 1 if z1 > z0 else -1
    vl.update()
    return out


CLAW_PARTS = ('palm', 'finger', 'finger_tip', 'palm_pad_f', 'palm_pad_b', 'palm_grip_insert', 'finger_grip_insert')


def claw_low(arm):
    """Lowest point of a claw as it stands now (after the pose was set)"""
    bpy.context.view_layer.update()
    low = math.inf
    for part in CLAW_PARTS:
        o = obj(f'{arm}_{part}_link_visual')
        mw = o.matrix_world
        for v in o.data.vertices:
            low = min(low, (mw @ v.co).z)
    return low


def claw_on_ground(arm, shoulder, sign, height):
    """The shoulder's turn about x (from `shoulder`) that sets the claw's lowest point at `height`"""
    s = obj(f'{arm}_shoulder_link')
    lo, hi = -0.6, 1.6
    for _ in range(16):
        mid = (lo + hi) / 2
        s.rotation_euler = Euler((shoulder.x + sign * mid, shoulder.y, shoulder.z))
        if claw_low(arm) < height:
            lo = mid
        else:
            hi = mid
    return Euler((shoulder.x + sign * hi, shoulder.y, shoulder.z))


def body_matrix(rest, z, roll, pitch, y=0.0):
    """base_link's matrix_basis for a body raised by `z`, moved across by `y` and turned by roll (x) and pitch (y)"""
    m = rest.basis['base_link'].copy()
    turn = Euler((roll, pitch, 0)).to_matrix().to_4x4()
    loc = m.translation.copy()
    m = turn @ m
    m.translation = loc + Vector((0, y, z))
    return m


# ───────────────────────────── clips ─────────────────────────────

def smooth(u):
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def foot_walk(leg, phase):
    """Foot (body frame, x and lift) of `leg` at `phase` of the walk"""
    u = (phase - PAIRS[leg]) % 1.0
    if u < SWING:
        v = u / SWING
        x = -STRIDE / 2 + STRIDE * smooth(v)
        return x, LIFT * math.sin(math.pi * v)
    v = (u - SWING) / STANCE
    return STRIDE / 2 - STRIDE * v, 0.0


def key_link(name, frame, rot=None, loc=None):
    o = obj(name)
    if rot is not None:
        o.rotation_euler = rot
        o.keyframe_insert('rotation_euler', frame=frame)
    if loc is not None:
        o.location = loc
        o.keyframe_insert('location', frame=frame)


def key_body(rest, frame, z, roll, pitch, y=0.0):
    o = obj('base_link')
    o.matrix_basis = body_matrix(rest, z, roll, pitch, y)
    o.keyframe_insert('location', frame=frame)
    o.keyframe_insert('rotation_euler', frame=frame)


def pose_leg(rest, leg, body, foot_world, frame):
    """Key hip, thigh and calf of `leg` for a foot at `foot_world` under a body at `body` (root frame)"""
    target = body.inverted() @ foot_world
    yaw, d1, d2 = leg.solve(target)
    n = leg.name
    hip = Euler(rest.rot[f'{n}_hip_link'])
    hip.z += yaw
    key_link(f'{n}_hip_link', frame, rot=hip)
    thigh = Euler(rest.rot[f'{n}_thigh_link'])
    thigh.x += leg.sign[0] * d1
    key_link(f'{n}_thigh_link', frame, rot=thigh)
    calf = Euler(rest.rot[f'{n}_calf_link'])
    calf.x += leg.sign[1] * d2
    key_link(f'{n}_calf_link', frame, rot=calf)


def animate_walk(rest, legs, lift_sign):
    frames = round(WALK_S * FPS)
    for f in range(frames + 1):
        phase = f / frames
        bob = BOB * math.cos(4 * math.pi * (phase - SWING / 2))
        roll = ROLL * math.sin(2 * math.pi * phase)
        nod = PITCH_NOD * math.cos(4 * math.pi * (phase - SWING / 2))
        key_body(rest, f, bob, roll, nod)
        body = body_frame(rest, bob, roll, nod)
        for leg in legs.values():
            dx, lift = foot_walk(leg.name, phase)
            foot = leg.foot_world + Vector((dx, 0, lift))
            pose_leg(rest, leg, body, foot, f)
        for arm in ARMS:
            # The claws hover, sway with the walk and work their pincers
            swing = math.sin(2 * math.pi * (phase + (0.25 if arm == 'LF' else 0.75)))
            s = Euler(rest.rot[f'{arm}_shoulder_link'])
            s.z += CLAW_SWAY * swing * (1 if arm == 'LF' else -1)
            hover = CLAW_HOVER * (1 + 0.25 * swing)
            key_link(f'{arm}_shoulder_link', f, rot=claw_on_ground(arm, s, lift_sign[arm], hover))
            p = Euler(rest.rot[f'{arm}_finger_link'])
            p.z += PINCER * (0.5 + 0.5 * math.sin(2 * math.pi * phase * 2 + (0 if arm == 'LF' else 1.7)))
            key_link(f'{arm}_finger_link', f, rot=p)
    return frames


def body_frame(rest, z, roll, pitch, y=0.0):
    """base_link's world matrix (source frame, before the root's turn) for that body pose"""
    return rest.world['base_link'] @ rest.basis['base_link'].inverted() @ body_matrix(rest, z, roll, pitch, y)


def animate_scuttle(rest, legs, lift_sign):
    """The crab's gait: WALK's pairs and timing, the feet stepping across, the body to its left"""
    frames = round(WALK_S * FPS)
    for f in range(frames + 1):
        phase = f / frames
        # Down as a pair lands, over onto it and across with it
        bob = SCUTTLE_BOB * math.cos(4 * math.pi * (phase - SWING / 2))
        roll = SCUTTLE_ROLL * math.cos(4 * math.pi * (phase - SWING))
        sway = SCUTTLE_SWAY * math.sin(4 * math.pi * (phase - SWING))
        key_body(rest, f, bob, roll, 0.0, sway)
        body = body_frame(rest, bob, roll, 0.0, sway)
        for leg in legs.values():
            dy, lift = foot_walk(leg.name, phase)
            tuck = -math.copysign(SCUTTLE_TUCK, leg.foot_world.y)
            foot = leg.foot_world + Vector((0, dy + tuck, lift))
            pose_leg(rest, leg, body, foot, f)
        for arm in ARMS:
            # The claws hover low, swing across with the lurch and snap
            swing = math.sin(4 * math.pi * (phase - SWING) + (0 if arm == 'LF' else 0.6))
            s = Euler(rest.rot[f'{arm}_shoulder_link'])
            s.z += 1.4 * CLAW_SWAY * swing
            hover = CLAW_HOVER * (1 + 0.3 * swing)
            key_link(f'{arm}_shoulder_link', f, rot=claw_on_ground(arm, s, lift_sign[arm], hover))
            p = Euler(rest.rot[f'{arm}_finger_link'])
            p.z += PINCER * (0.5 + 0.5 * math.sin(2 * math.pi * phase * 2 + (0.8 if arm == 'LF' else 2.5)))
            key_link(f'{arm}_finger_link', f, rot=p)
    return frames


HULL_PARTS = ('base_link_visual', 'LM_hip_link_visual', 'LR_hip_link_visual', 'RM_hip_link_visual', 'RR_hip_link_visual')


def hull_low(rest, roll, pitch):
    """Lowest point of the hull and the hips for a body turned by roll and pitch at its rest height"""
    o = obj('base_link')
    o.matrix_basis = body_matrix(rest, 0, roll, pitch)
    bpy.context.view_layer.update()
    low = math.inf
    for name in HULL_PARTS:
        m = obj(name)
        mw = m.matrix_world
        for v in m.data.vertices:
            low = min(low, (mw @ v.co).z)
    return low


def animate_death(rest, legs, lift_sign):
    frames = round(DEATH_S * FPS)
    for f in range(frames + 1):
        t = f / FPS
        # The legs give way over 0.25 to 1.1 s, a small bounce as the belly hits, still from 1.4 s
        give = smooth((t - 0.25) / 0.85)
        bounce = 0.006 * math.sin(math.pi * min(1.0, max(0.0, (t - 1.1) / 0.3)))
        shudder = 0.012 * math.sin(t * 38) * (1 - smooth(t / 0.4)) if t < 0.4 else 0.0
        roll = DEATH_ROLL * smooth((t - 0.5) / 0.8) + shudder
        pitch = DEATH_PITCH * smooth((t - 0.4) / 0.9)
        # It sinks until the lowest of its hull and hips touches the ground, not into it
        z = max(-DEATH_DROP * give, -hull_low(rest, roll, pitch)) + bounce
        key_body(rest, f, z, roll, pitch)
        body = body_frame(rest, z, roll, pitch)
        for leg in legs.values():
            # Out along the leg, as the knees buckle up
            out = Vector((leg.foot_world.x, leg.foot_world.y, 0)) - Vector((rest.world['base_link'].translation.x, 0, 0))
            out.z = 0
            out.normalize()
            # Splayed, the foot's tip turns down past its origin: lifted that much
            foot = leg.foot_world + out * DEATH_SPLAY * give + Vector((0, 0, 0.005 * give))
            pose_leg(rest, leg, body, foot, f)
        for arm in ARMS:
            # The claws spread and come down from their hover until they lie on the ground, as the body sinks
            s = Euler(rest.rot[f'{arm}_shoulder_link'])
            s.z += 0.18 * smooth((t - 0.3) / 0.8) * (1 if arm == 'LF' else -1)
            hover = CLAW_HOVER * (1 - smooth((t - 0.2) / 0.7))
            key_link(f'{arm}_shoulder_link', f, rot=claw_on_ground(arm, s, lift_sign[arm], hover))
            p = Euler(rest.rot[f'{arm}_finger_link'])
            p.z += PINCER * smooth(t / 0.5)
            key_link(f'{arm}_finger_link', f, rot=p)
        gun = Euler(rest.rot['turret_pitch'])
        gun.y -= BARREL_SAG * smooth((t - 0.3) / 0.9)
        key_link('turret_pitch', f, rot=gun)
    return frames


def bake_clip(name, build):
    """Key one clip with `build` and put it on each keyed link as an NLA strip of track `name`"""
    for o in O:
        if o.animation_data:
            o.animation_data.action = None
    frames = build()
    for o in O:
        ad = o.animation_data
        if not ad or not ad.action:
            continue
        action = ad.action
        action.name = f'{name}_{o.name}'
        track = ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, action)
        strip.frame_end = frames
        ad.action = None
    return frames


def reset_pose(rest):
    for name, m in rest.basis.items():
        if name in O:
            O[name].matrix_basis = m
    bpy.context.view_layer.update()


# ───────────────────────────── out ─────────────────────────────

def export(path):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=False,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_force_sampling=True,
        export_frame_range=False,
        export_skins=False,
        export_morph=False,
        export_materials='EXPORT',
        export_vertex_color='NONE',
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    print('wrote', path, os.path.getsize(path), 'bytes')


def preview(directory):
    """Stills: the split coloured, the walk at four phases, the death's end"""
    os.makedirs(directory, exist_ok=True)
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        pass
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    cam_data = bpy.data.cameras.new('preview')
    cam = bpy.data.objects.new('preview', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.rotation_euler = (0.7, 0.2, 0.8)
    scene.collection.objects.link(sun)
    world = scene.world or bpy.data.worlds.new('w')
    scene.world = world
    target = Vector((0, 0, 0.13))

    def shot(name, direction, frame):
        scene.frame_set(frame)
        d = Vector(direction).normalized()
        cam.location = target + d * 0.85
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(directory, f'{name}.png')
        bpy.ops.render.render(write_still=True)

    root = obj('jumper')
    # Preview in the source frame: +x forward
    root.rotation_euler.z = 0
    for o in O:
        if o.animation_data:
            for t in o.animation_data.nla_tracks:
                t.mute = t.name != 'Walk'
    frames = round(WALK_S * FPS)
    for f in range(0, frames + 1, 4):
        scene.frame_set(f)
        row = []
        for leg in LEGS:
            m = obj(f'{leg}_foot_tip_link_visual')
            low = min((m.matrix_world @ v.co for v in m.data.vertices), key=lambda p: p.z)
            row.append(f'{leg} x{low.x:+.3f} z{low.z:+.4f}')
        print(f'walk f{f:02d}', '  '.join(row))
    for o in O:
        if o.animation_data:
            for t in o.animation_data.nla_tracks:
                t.mute = t.name != 'Scuttle'
    for f in range(0, frames + 1, 4):
        scene.frame_set(f)
        row = []
        for leg in LEGS:
            m = obj(f'{leg}_foot_tip_link_visual')
            low = min((m.matrix_world @ v.co for v in m.data.vertices), key=lambda p: p.z)
            row.append(f'{leg} y{low.y:+.3f} z{low.z:+.4f}')
        print(f'scuttle f{f:02d}', '  '.join(row))
    shot('scuttle_0', (0.6, -0.9, 0.35), 0)
    shot('scuttle_1', (0.6, -0.9, 0.35), round(0.3 * frames))
    shot('scuttle_front', (1.0, 0.0, 0.25), round(0.6 * frames))
    for o in O:
        if o.animation_data:
            for t in o.animation_data.nla_tracks:
                t.mute = t.name != 'Walk'
    for k, phase in enumerate((0.0, 0.25, 0.5, 0.75)):
        shot(f'walk_{k}', (0.6, -0.9, 0.35), round(phase * WALK_S * FPS))
    shot('walk_side', (0.0, -1.0, 0.12), 0)
    obj('turret_yaw').rotation_euler.z += 0.7
    obj('turret_pitch').rotation_euler.y -= 0.25
    shot('turret_turned', (0.6, -0.9, 0.35), 0)
    obj('turret_yaw').rotation_euler.z -= 0.7
    obj('turret_pitch').rotation_euler.y += 0.25
    for o in O:
        if o.animation_data:
            for t in o.animation_data.nla_tracks:
                t.mute = t.name != 'Death'
    meshes = [o for o in O if o.type == 'MESH']
    for f in range(0, round(DEATH_S * FPS) + 1, 6):
        scene.frame_set(f)
        low, who = min(((o.matrix_world @ v.co).z, o.name) for o in meshes for v in o.data.vertices)
        belly = min((obj('base_link_visual').matrix_world @ v.co).z for v in obj('base_link_visual').data.vertices)
        print(f'death f{f:02d} lowest {low:+.4f} ({who}) belly {belly:+.4f}')
    shot('death_mid', (0.6, -0.9, 0.35), round(0.8 * FPS))
    shot('death_end', (0.6, -0.9, 0.35), round(DEATH_S * FPS))


def main():
    global O
    opts = args()
    bpy.ops.wm.open_mainfile(filepath=opts['source'])
    O = bpy.data.objects
    clean_scene()
    plain_materials()
    split_turret()
    root = add_root()
    reduce_meshes()
    rest = Rest()
    legs = {n: Leg(rest, n) for n in LEGS}
    calibrate(rest, legs)
    lift = claw_signs(rest)
    walk_frames = bake_clip('Walk', lambda: animate_walk(rest, legs, lift))
    reset_pose(rest)
    bake_clip('Scuttle', lambda: animate_scuttle(rest, legs, lift))
    reset_pose(rest)
    bake_clip('Death', lambda: animate_death(rest, legs, lift))
    reset_pose(rest)
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = walk_frames
    print('footstep phases', FOOTSTEP_PHASES)
    if opts['preview']:
        preview(opts['preview'])
        return
    # Look along glTF +z: the source's +x turns to -y, which the exporter writes as +z
    root.rotation_euler.z = -math.pi / 2
    root.scale = (ROOT_SCALE, ROOT_SCALE, ROOT_SCALE)
    export(opts['out'])


main()
