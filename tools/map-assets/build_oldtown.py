"""Old-town houses for OSM worlds (loaded by build_models.py): the half-timbered and plastered town houses
of a German old town, chosen where the map finds an old town (convert/buildings.ts, kind `oldtown`).

Each house is a stack of storeys, the upper ones jettied out over the one below, plaster between oak
frames (posts at every bay, sill and head plates, braces in the bays without windows, the man figure at
the corners), small windows with crosses, a steep tiled roof with a dormer or two and a chimney; on the
street gable of the gable-fronted ones the frame goes on up into the gable. Ground floors in sandstone or
plaster, with a door and a shop window.

The surfaces are tiled (Poly Haven, as the other houses: sharp from close by); the weathering is baked
over the whole house into the green channel of its occlusion texture (blender_kit.bake_ao grime: dirt
rising from the ground, streaks down the walls, dirt in the hollows) and darkens it in the game (catalogue
`grime`). Each house has a plaster colour of its own; instance tints vary them further. Front towards -Y,
width along X.
"""
import math
import random
from types import SimpleNamespace

import bpy
from mathutils import Matrix, Vector

from blender_kit import Part, box, clear_scene, export_lod, finish, flat_material, pbr_material, tube
from build_city import Face, glass
from build_modern import FOUNDATION, Moved, gable_wall, gabled_roof, plank, punched_wall

T = 0.24  # wall thickness
BEAM = 0.17  # width of a timber member
PROUD = 0.035  # how far the timber stands out of the plaster

# ---------------------------------------------------------------- materials

def materials(plaster_tint, timber_tint):
    """The tiled surfaces of one house by role"""
    return {
        'plaster': Part(pbr_material('plaster-ot-' + '-'.join('%.2f' % c for c in plaster_tint), 'painted_plaster_wall', plaster_tint),
                        uv_metres=2.6, bevel=0.0),
        'timber': Part(pbr_material('timber-ot-' + '-'.join('%.2f' % c for c in timber_tint), 'dark_planks', timber_tint), uv_metres=1.4,
                       bevel=0.0),
        'stone': Part(pbr_material('stone-ot', 'sandstone_blocks_04', (1.0, 0.93, 0.84)), uv_metres=2.2, bevel=0.0),
        'frame': Part(flat_material('frame-ot', (0.9, 0.88, 0.82), 0.5)),
        'roof': Part(pbr_material('roof-ot-tiles', 'clay_roof_tiles_02', (0.92, 0.78, 0.7))),
        'door': Part(pbr_material('door-ot', 'dark_planks', (0.95, 0.75, 0.6)), uv_metres=1.0, bevel=0.0),
        'metal': Part(flat_material('zinc', (0.55, 0.57, 0.58), 0.4, 0.8), smooth=True),
    }


# ---------------------------------------------------------------- pieces

def beam(part, face, u0, z0, u1, z1, proud=PROUD, width=BEAM):
    """A timber member on a face from (u0, z0) to (u1, z1), standing out of the plaster"""
    off = getattr(face, 'off', Vector((0, 0, 0)))
    out = face.n * (face.depth / 2 + proud / 2) + off
    a = out + face.u * u0 + Vector((0, 0, z0))
    b = out + face.u * u1 + Vector((0, 0, z1))
    if abs(z1 - z0) < 1e-6:
        # plank: `width` across (here the depth out of the wall), `height` up
        plank(part, a, b, proud + 0.02, width)
    else:
        _upright(part, a, b, face, width, proud)


def _upright(part, a, b, face, width, proud):
    """A post or brace in the wall plane: `width` across in the wall, `proud` deep"""
    d = (b - a).normalized()
    across = d.cross(face.n).normalized() * (width / 2)
    deep = face.n * ((proud + 0.02) / 2)
    from build_modern import prism
    prism(part, [a - across - deep, a + across - deep, a + across + deep, a - across + deep], b - a)


def window_in(kit, face, u, zb, w, h, reveal=0.08):
    """A small window: frame set back in the opening, a pane, a cross"""
    face.box(kit.frames, u, -reveal - 0.03, zb, w, 0.06, h)
    face.box(kit.glass, u, -reveal + 0.006, zb + 0.06, w - 0.12, 0.02, h - 0.12)
    face.box(kit.frames, u, -reveal + 0.02, zb + 0.05, 0.05, 0.03, h - 0.1)
    face.box(kit.frames, u, -reveal + 0.02, zb + h * 0.62, w - 0.1, 0.03, 0.05)


def timber_storey(kit, face, u0, u1, z0, fh, bays, windows, rnd, corners=True):
    """The frame of one storey on one face: sill and head plates, posts at the bay lines, a window rail
    and lintel where the bay has a window, braces in the bays without one (the man figure at the ends)"""
    t = kit.timber
    beam(t, face, u0, z0 + BEAM / 2, u1, z0 + BEAM / 2)
    beam(t, face, u0, z0 + fh - BEAM / 2, u1, z0 + fh - BEAM / 2)
    bw = (u1 - u0) / bays
    for b in range(bays + 1):
        u = u0 + b * bw
        if not corners and b in (0, bays):
            continue
        beam(t, face, u, z0 + BEAM, u, z0 + fh - BEAM)
    for b in range(bays):
        ua, ub = u0 + b * bw, u0 + (b + 1) * bw
        if b in windows:
            zb, zt = windows[b]
            beam(t, face, ua, zb - BEAM / 2, ub, zb - BEAM / 2, width=BEAM * 0.8)
            beam(t, face, ua, zt + BEAM / 2, ub, zt + BEAM / 2, width=BEAM * 0.8)
        elif b in (0, bays - 1) or rnd.random() < 0.5:
            # Braces from the posts to the middle of the bay: a half man at the ends, a cross elsewhere
            mid = z0 + fh * 0.55
            if b == 0:
                beam(t, face, ua, z0 + BEAM, ua + bw * 0.8, mid, width=BEAM * 0.85)
            elif b == bays - 1:
                beam(t, face, ub, z0 + BEAM, ub - bw * 0.8, mid, width=BEAM * 0.85)
            else:
                beam(t, face, ua, z0 + BEAM, ub, z0 + fh - BEAM, width=BEAM * 0.8)
                beam(t, face, ub, z0 + BEAM, ua, z0 + fh - BEAM, width=BEAM * 0.8)


def storey_box(w, d, grow):
    """The faces of a storey that juts out `grow` metres on every side"""
    return [Face(k, w + 2 * grow, d + 2 * grow) for k in range(4)]


# ---------------------------------------------------------------- houses

def town_house(name, w, d, floors, gable_front, plaster=(1.22, 1.05, 0.72), timber=(0.55, 0.42, 0.32), ground='stone', timber_from=1,
               fh=2.75, gh=3.1, jetty=0.22, pitch_deg=56, dormers=1, seed=0, lod=900):
    """An old-town house w (street front) by d: `floors` storeys, the ground floor `gh` high in stone or plaster
    with a door and a shop window, the upper ones `fh` high, jettied out from `timber_from` on (no timber
    with `timber_from` past the top). `gable_front`: the gable to the street (built with its ridge along X
    and turned a quarter), else the eaves"""
    clear_scene()
    rnd = random.Random(seed)
    look = materials(plaster, timber)
    glass_part = Part(glass(), bevel=0.0)
    kit = SimpleNamespace(timber=look['timber'], frames=look['frame'], glass=glass_part, sill=look['timber'], door=look['door'],
                          metal=look['metal'], roof=look['roof'], ridge=look['roof'], plinth=look['stone'], shutter=look['frame'],
                          extra=[], walls=lambda tint=None: look['plaster'])
    # Built with the street front on face 0 (-Y) or, for a gable front, on face 1 (+X), turned to -Y at the end
    bw_, bd_ = (d, w) if gable_front else (w, d)
    street = 1 if gable_front else 0
    timbered = timber_from < floors
    box(look['stone'], 0, 0, -FOUNDATION, bw_ + 0.1, bd_ + 0.1, FOUNDATION + 0.35)
    z = 0.35
    grow = 0.0
    for f in range(floors):
        h = gh if f == 0 else fh
        if f >= timber_from and f > 0:
            grow += jetty
        faces = storey_box(bw_, bd_, grow)
        for k, face in enumerate(faces):
            L = face.length
            u0, u1 = (-L / 2, L / 2) if k % 2 == 0 else (-L / 2 + T, L / 2 - T)
            front = k == street
            ops = []
            fills = []
            if f == 0:
                if front:
                    # A door off the middle, a shop window or two beside it
                    du = (u1 - u0) * (0.28 if rnd.random() < 0.5 else -0.28)
                    ops.append((du, 1.15, z, z + 2.2))
                    fills.append(('door', du))
                    for su in (-du * 0.2 - (u1 - u0) * 0.08,) if L < 9 else (-du, -du * 0.1):
                        if abs(su - du) > 1.6:
                            ops.append((su, 1.6, z + 0.75, z + 2.4))
                            fills.append(('win', su, z + 0.75, 1.6, 1.65))
                elif k != street + 2 or L > 8:
                    for su in ((-L * 0.22, L * 0.22) if L > 8 else (0.0,)):
                        ops.append((su, 0.8, z + 1.1, z + 2.2))
                        fills.append(('win', su, z + 1.1, 0.8, 1.1))
                part = look['stone'] if ground == 'stone' else look['plaster']
                punched_wall(part, face, u0, u1, z, z + h, ops, t=T)
            else:
                bays = max(2, int(round((u1 - u0) / 1.6)))
                bwid = (u1 - u0) / bays
                windows = {}
                for b in range(bays):
                    # The street front: most bays a window, braces in the rest; the other walls fewer
                    wanted = (front and (rnd.random() < 0.72 or bays <= 3)) or (k % 2 == (street % 2) and rnd.random() < 0.5) or (rnd.random() < 0.25)
                    if wanted and not (b in (0, bays - 1) and not front and bays > 2):
                        zb = z + 0.85
                        windows[b] = (zb, zb + 1.15)
                for b, (zb, zt) in windows.items():
                    u = u0 + (b + 0.5) * bwid
                    ops.append((u, min(0.95, bwid - 0.5), zb, zt))
                punched_wall(look['plaster'], face, u0, u1, z, z + h, ops, t=T)
                for u, ow, zb, zt in ops:
                    window_in(kit, face, u, zb, ow, zt - zb)
                if timbered and f >= timber_from:
                    timber_storey(kit, face, u0, u1, z, h, bays, windows, rnd, corners=k % 2 == 0)
                if f == timber_from and grow > 0:
                    # The jetty's sill beam over the storey below, its joist ends along it
                    face.box(look['timber'], 0, -0.02, z - 0.02, L + 0.02, jetty + 0.1, 0.22)
            for fill in fills:
                if fill[0] == 'door':
                    face.box(kit.door, fill[1], -0.18, z, 1.15, 0.06, 2.2)
                    face.box(kit.glass, fill[1], -0.15, z + 1.75, 0.8, 0.02, 0.3)
                    face.box(look['stone'], fill[1], 0.25, z - 0.18, 1.6, 0.6, 0.2)
                else:
                    _, u, zb, ww, hh = fill
                    window_in(kit, face, u, zb, ww, hh, reveal=0.12)
        z += h
    eave = z
    top_w, top_d = bw_ + 2 * grow, bd_ + 2 * grow
    pitch = top_d / 2 * math.tan(math.radians(pitch_deg))
    for k in (1, 3):
        face = Face(k, top_w, top_d)
        gable_wall(look['plaster'], face, eave, pitch, top_d, t=T)
        if k == street or (not gable_front and k == 1):
            # The frame goes on into the gable: posts, a collar beam, two attic windows and one above
            hd = top_d / 2
            for frac in (-0.5, 0.0, 0.5):
                u = frac * hd
                ztop = eave + pitch * (1 - abs(u) / hd) - 0.2
                beam(look['timber'], face, u, eave, u, ztop)
            for zc in (eave + pitch * 0.42, eave + pitch * 0.75):
                half = hd * (1 - (zc - eave) / pitch) - 0.25
                beam(look['timber'], face, -half, zc, half, zc)
            beam(look['timber'], face, -hd, eave, hd, eave)
            for u in (-hd * 0.25, hd * 0.25):
                window_in(kit, Moved(face, face.n * 0.02), u, eave + 0.55, 0.7, 0.95, reveal=-0.02)
            window_in(kit, Moved(face, face.n * 0.02), 0.0, eave + pitch * 0.5, 0.55, 0.8, reveal=-0.02)
    low, _ = gabled_roof(kit, top_w, top_d, eave, pitch, over=0.3, verge=0.22, gutters=False)
    # Gutters along the eaves; the downpipes run down the corners of the storeys, stepping in at each jetty
    for sy in (-1, 1):
        y = sy * (top_d / 2 + 0.36)
        tube(look['metal'], [Vector((-top_w / 2 - 0.22, y, low - 0.1)), Vector((top_w / 2 + 0.22, y, low - 0.1))], [0.07, 0.07], 6)
    x = top_w / 2 - 0.25
    pipe = [Vector((x, top_d / 2 + 0.36, low - 0.1))]
    zz = eave
    g = grow
    for f in range(floors - 1, -1, -1):
        h = gh if f == 0 else fh
        pipe.append(Vector((x - (grow - g), bd_ / 2 + g + 0.08, zz)))
        zz -= h
        if f >= timber_from and f > 0:
            g -= jetty
        pipe.append(Vector((x - (grow - g), bd_ / 2 + g + 0.08, zz + 0.05)))
    pipe[-1].z = 0.15
    tube(look['metal'], pipe, [0.045] * len(pipe), 6)
    slope = pitch / (top_d / 2)
    # Dormers on the street slope (eaves front) or on both (gable front), a chimney
    for k in range(dormers):
        x = (k + 1) / (dormers + 1) * top_w - top_w / 2
        for sy in ((-1,) if not gable_front else (-1, 1)):
            yf = sy * (top_d / 2 - 1.3)
            zf = eave + 1.3 * slope
            box(look['plaster'], x, yf - sy * 0.6, zf - 0.6, 1.2, 1.5, 1.8)
            Fd = Face(0 if sy < 0 else 2, 1.2, 1.5 + 2 * abs(yf - sy * 0.6))
            window_in(kit, Moved(Fd, Vector((x, 0, 0))), 0.0, zf + 0.05, 0.75, 0.95, reveal=-0.02)
            tri_h = 0.7
            for side in (-1, 1):
                plank(look['roof'], Vector((x + side * 0.8, yf - sy * 0.55, zf + 1.15)), Vector((x, yf - sy * 0.55, zf + 1.15 + tri_h)), 1.7, 0.05)
    cx = top_w * 0.25 * (1 if rnd.random() < 0.5 else -1)
    zc = eave + pitch * 0.6
    box(look['plaster'], cx, top_d * 0.12, zc, 0.55, 0.55, pitch * 0.4 + 1.0)
    box(look['stone'], cx, top_d * 0.12, zc + pitch * 0.4 + 1.0, 0.65, 0.65, 0.12)
    objects = [p.to_object(name + '-' + role) for role, p in look.items() if p.bm.faces] + [glass_part.to_object(name + '-glass')]
    if gable_front:
        # Turn the street front from +X to -Y
        turn = Matrix.Rotation(-math.pi / 2, 4, 'Z')
        for o in objects:
            o.data.transform(turn)
    obj = finish(name, objects, ao_size=1024, grime=True)
    export_lod(name, obj, ratio=min(1.0, lod / max(1, len(obj.data.polygons))))


def models():
    return {
        # Ochre on dark oak, white on ox-blood, salmon, cream on near-black, sage: each house its own plaster
        'oldtown-gable-3': lambda: town_house('oldtown-gable-3', 7.0, 12.0, 3, True, (1.22, 1.02, 0.66), (0.42, 0.3, 0.22), seed=61),
        'oldtown-gable-4': lambda: town_house('oldtown-gable-4', 8.5, 14.0, 4, True, (1.3, 1.28, 1.2), (0.75, 0.28, 0.2), timber_from=2,
                                              seed=62, dormers=2, lod=1100),
        'oldtown-gable-2': lambda: town_house('oldtown-gable-2', 6.0, 10.0, 2, True, (1.25, 0.95, 0.85), ground='plaster', timber_from=9,
                                              seed=63, pitch_deg=52, lod=700),
        'oldtown-eave-3': lambda: town_house('oldtown-eave-3', 12.0, 9.5, 3, False, (1.25, 1.18, 0.98), (0.3, 0.26, 0.24), seed=64,
                                             dormers=2, lod=1100),
        'oldtown-eave-2': lambda: town_house('oldtown-eave-2', 10.0, 9.0, 2, False, (1.0, 1.1, 0.92), ground='plaster', timber_from=9,
                                             seed=65, pitch_deg=50, dormers=1, lod=800),
    }
