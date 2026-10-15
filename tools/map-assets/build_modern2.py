"""More modern buildings for OSM worlds (loaded by build_models.py): the kinds build_modern.py lacked.

A small shop with display windows under a sign band, a farm barn of timber
boarding on a concrete sock, an open lean-to shelter, a 4 x 4 m outbuilding,
an annex that stands against a house wall, and an office tower with ribbon
windows between stone pilasters (a second tower beside office-tower). Same
family of materials and helpers as build_modern.py: painted plaster,
concrete plinths, zinc, white or dark frames set back in real openings.
Front towards -Y, width along X.
"""
import math
import random

from mathutils import Vector

from blender_kit import Part, box, clear_scene, flat_material, pbr_material, tilt, tube
from build_city import Face
from build_modern import (FOUNDATION, PALE_GREY, PLINTH, SAND, WHITE, Kit, base, door, export, gable_wall, gabled_roof, plank, prism,
                          punched_wall, roof_plant, window)
from build_structures import gable_roof


def bitumen():
    return Part(pbr_material('roof-bitumen', 'bitumen', (0.8, 0.8, 0.8)), uv_metres=3.0, bevel=0.0)


def parapet_roof(kit, w, d, z, h=0.6, tint=WHITE):
    """Flat roof behind a plastered parapet with a zinc coping"""
    for k in range(4):
        face = Face(k, w, d)
        face.box(kit.walls(tint), 0, -0.15, z, face.length, 0.3, h)
        face.box(kit.metal, 0, 0.0, z + h, face.length + 0.04, 0.36, 0.05)
    felt = bitumen()
    box(felt, 0, 0, z - 0.05, w - 0.5, d - 0.5, 0.1)
    kit.extra.append(felt)


# ---------------------------------------------------------------- shop

def shop_small(name, w=10.0, d=8.0, h=4.2, tint=SAND, seed=0):
    """One-storey shop: two display windows over a stone stall riser and a glazed door between them, a sign
    band (no lettering) over the full front, a blade sign at the corner, a striped awning over one window,
    a rendered box with a flat roof behind a parapet, a back door"""
    clear_scene()
    kit = Kit(frame=(0.18, 0.19, 0.2))
    sign = Part(flat_material('sign-band-teal', (0.05, 0.22, 0.24), 0.45, 0.2))
    # One part each for the sign band and the awning; the blank panels in the sill grey
    sign_face = kit.sill
    awning = sign
    kit.extra.append(sign)
    z0 = 0.15
    box(kit.plinth, 0, 0, -FOUNDATION, w + 0.08, d + 0.08, FOUNDATION + z0)
    front = Face(0, w, d)
    ops = [(-2.6, 3.6, z0 + 0.5, z0 + 3.0), (2.85, 3.3, z0 + 0.5, z0 + 3.0), (0.4, 1.2, z0, z0 + 2.5)]
    punched_wall(kit.walls(tint), front, -w / 2, w / 2, z0, h, ops, t=0.3)
    for u, ow, zb, zt in ops:
        if zb == z0:
            # Glazed shop door with a fanlight
            front.box(kit.frames, u, -0.18, zb, ow, 0.06, zt - zb)
            front.box(kit.glass, u, -0.14, zb + 0.12, ow - 0.2, 0.02, zt - zb - 0.62)
            front.box(kit.frames, u, -0.13, zb + 1.95, ow - 0.1, 0.04, 0.06)
            front.box(kit.metal, u - ow * 0.32, -0.12, zb + 1.0, 0.04, 0.08, 0.5)
        else:
            # Display window: a slim dark frame, one big pane, a transom bar, the stall riser in stone
            front.box(kit.frames, u, -0.16, zb, ow, 0.06, zt - zb)
            front.box(kit.glass, u, -0.12, zb + 0.06, ow - 0.12, 0.02, zt - zb - 0.12)
            front.box(kit.frames, u, -0.11, zb + 2.0, ow - 0.06, 0.04, 0.05)
            front.box(kit.sill, u, 0.03, z0, ow + 0.2, 0.12, 0.5)
    # Sign band: a dark fascia with a blank cream panel, a cornice over it
    front.box(sign, 0, 0.08, z0 + 3.05, w + 0.1, 0.16, 0.8)
    front.box(sign_face, -1.2, 0.17, z0 + 3.2, 5.2, 0.03, 0.5)
    front.box(kit.sill, 0, 0.1, h - 0.05, w + 0.2, 0.3, 0.12)
    # Blade sign on a bracket at the east corner
    front.box(kit.metal, w / 2 - 0.5, 0.35, z0 + 3.55, 0.05, 0.7, 0.05)
    front.box(sign, w / 2 - 0.5, 0.55, z0 + 2.7, 0.08, 0.6, 0.8)
    front.box(sign_face, w / 2 - 0.5, 0.55, z0 + 2.85, 0.1, 0.45, 0.5)
    # Awning over the west window, falling to the street
    u = -2.6
    prism(awning, [front.u * (u - 1.9) + front.n * (d / 2 + 0.2) + Vector((0, 0, z0 + 3.05)),
                   front.u * (u + 1.9) + front.n * (d / 2 + 0.2) + Vector((0, 0, z0 + 3.05)),
                   front.u * (u + 1.9) + front.n * (d / 2 + 1.3) + Vector((0, 0, z0 + 2.55)),
                   front.u * (u - 1.9) + front.n * (d / 2 + 1.3) + Vector((0, 0, z0 + 2.55))], Vector((0, 0, 0.04)))
    front.box(awning, u, 1.29, z0 + 2.35, 3.8, 0.03, 0.22)
    for k in (1, 2, 3):
        f = Face(k, w, d)
        L = f.length
        u0, u1 = (-L / 2, L / 2) if k % 2 == 0 else (-L / 2 + 0.3, L / 2 - 0.3)
        if k == 2:
            o = [(L / 2 - 1.6, 1.0, z0, z0 + 2.1), (-1.0, 1.0, z0 + 1.4, z0 + 2.3)]
        elif k == 1:
            o = [(0.0, 1.4, z0 + 1.0, z0 + 2.3)]
        else:
            o = []
        punched_wall(kit.walls(tint), f, u0, u1, z0, h, o, t=0.3)
        for ou, ow, zb, zt in o:
            if zb == z0:
                door(kit, f, ou, zb, ow, zt - zb, side_light=False)
            else:
                window(kit, f, ou, zb, ow, zt - zb, reveal=0.12, split=False)
    parapet_roof(kit, w, d, h, h=0.55, tint=tint)
    rnd = random.Random(seed)
    box(kit.metal, rnd.uniform(-2, 2), 1.5, h, 1.6, 1.0, 0.9)
    export(name, kit.objects(name), lod=220)


# ---------------------------------------------------------------- barn

def barn_modern(name, w=18.0, d=12.0, eave=4.8, pitch_deg=18):
    """Farm barn of today: a concrete sock to 1.2 m, vertical timber boarding above with an open slatted band
    under the eaves, a shallow roof of fibre cement sheets with roof light strips and a ventilated ridge, a
    big sliding door on a rail and a man door in the front gable, zinc gutters"""
    clear_scene()
    kit = Kit()
    boards = Part(pbr_material('boards-barn', 'brown_planks_07', (0.95, 0.85, 0.72)), uv_metres=2.4, bevel=0.0)
    slats = Part(flat_material('barn-slats-dark', (0.07, 0.06, 0.05), 0.9))
    doors = Part(pbr_material('boards-barn-door', 'brown_planks_04', (0.8, 0.68, 0.55)), uv_metres=1.6, bevel=0.0)
    sheet = Part(pbr_material('roof-fibre-cement', 'corrugated_iron_02', (0.62, 0.64, 0.66)), uv_metres=2.0, bevel=0.0)
    lights = Part(flat_material('roof-light-strip', (0.62, 0.66, 0.62), 0.35))
    kit.extra += [boards, slats, doors, sheet, lights]
    sock = 1.2
    box(kit.plinth, 0, 0, -FOUNDATION, w + 0.1, d + 0.1, FOUNDATION + sock)
    pitch = d / 2 * math.tan(math.radians(pitch_deg))
    # The ridge runs along X, the gables face east and west; the doors go in the west gable, turned to the front below
    for k in range(4):
        face = Face(k, w, d)
        L = face.length
        u0, u1 = (-L / 2, L / 2) if k % 2 == 0 else (-L / 2 + 0.2, L / 2 - 0.2)
        ops = []
        if k == 3:
            ops = [(-1.2, 4.6, 0.0, 4.2), (3.4, 1.0, 0.0, 2.1)]
        elif k == 1:
            ops = [(0.0, 3.6, 0.0, 3.8)]
        top = eave - 0.5 if k % 2 == 0 else eave
        punched_wall(boards, face, u0, u1, sock, top, [(u, ow, max(sock, zb), zt) for u, ow, zb, zt in ops], t=0.2)
        for u, ow, zb, zt in ops:
            # The sock opens with the door
            face.box(kit.plinth, u, -0.04, 0.0, ow, 0.02, 0.02)
        if k % 2 == 0:
            # Slatted ventilation band under the eaves, behind the boards
            face.box(slats, 0, -0.15, top, L - 0.2, 0.05, 0.5)
            for i in range(int(L / 0.25)):
                face.box(boards, -L / 2 + 0.12 + i * 0.25, -0.08, top, 0.1, 0.04, 0.5)
            # Roof lights: windows of translucent sheet high in the long walls
            for i in range(3):
                face.box(lights, -L / 3 + i * L / 3, 0.01, sock + 1.4, 2.4, 0.02, 0.8)
        else:
            gable_wall(boards, face, eave, pitch, d, t=0.2)
            # Boards of the gable over the door line
            face.box(kit.door, 0, 0.02, eave - 0.06, L + 0.1, 0.04, 0.12)
    west = Face(3, w, d)
    # Sliding door slid half open: two leaves on a rail, one over the opening, a dark gap beside it
    west.box(slats, -1.2, -0.18, 0.0, 4.6, 0.04, 4.2)
    for du in (-2.35, 1.0):
        west.box(doors, -1.2 + du, 0.12, 0.05, 2.35, 0.08, 4.2)
        for zz in (0.3, 2.1, 3.9):
            west.box(kit.metal, -1.2 + du, 0.18, zz, 2.3, 0.03, 0.1)
        # Diagonal brace on each leaf
        out = west.n * (w / 2 + 0.18)
        plank(kit.metal, out + west.u * (-1.2 + du - 1.0) + Vector((0, 0, 0.45)), out + west.u * (-1.2 + du + 1.0) + Vector((0, 0, 3.85)),
              0.03, 0.1)
    west.box(kit.metal, 0.0, 0.25, 4.3, 7.8, 0.08, 0.1)
    west.box(doors, 3.4, -0.12, 0.0, 1.0, 0.05, 2.1)
    west.box(kit.metal, 3.4, 0.0, 2.1, 1.3, 0.5, 0.06)
    east = Face(1, w, d)
    east.box(doors, 0.0, -0.12, 0.0, 3.6, 0.05, 3.8)
    for zz in (0.4, 1.9, 3.4):
        east.box(kit.metal, 0.0, -0.08, zz, 3.5, 0.03, 0.1)
    # Concrete apron in front of the big door
    west.box(kit.plinth, -1.2, 1.5, -0.3, 6.0, 3.0, 0.35)
    # Roof: sheets, two roof light strips per slope, a raised ridge cap with a vent gap, verge and fascia boards
    gable_roof(sheet, w, d, eave, pitch, 0.5)
    slope = math.atan2(pitch, d / 2)
    for sy in (-1, 1):
        for x in (-w / 4, w / 4):
            y0, y1 = sy * (d / 2 - 0.6), sy * 1.0
            z0 = eave + (d / 2 - abs(y0)) * math.tan(slope) + 0.02
            z1 = eave + (d / 2 - abs(y1)) * math.tan(slope) + 0.02
            pts = [Vector((x - 0.6, y0, z0)), Vector((x + 0.6, y0, z0)), Vector((x + 0.6, y1, z1)), Vector((x - 0.6, y1, z1))]
            prism(lights, pts if sy < 0 else list(reversed(pts)), Vector((0, 0, 0.03)))
    top = eave + pitch
    box(sheet, 0, 0, top + 0.05, w + 1.0, 0.7, 0.06)
    for sy in (-0.3, 0.3):
        box(slats, 0, sy, top - 0.05, w + 0.9, 0.04, 0.12)
    low = eave - 0.5 * pitch / (d / 2)
    for sy in (-1, 1):
        plank(kit.door, Vector((-w / 2 - 0.5, sy * (d / 2 + 0.47), low - 0.12)), Vector((w / 2 + 0.5, sy * (d / 2 + 0.47), low - 0.12)), 0.05, 0.2)
        y = sy * (d / 2 + 0.56)
        tube(kit.metal, [Vector((-w / 2 - 0.5, y, low - 0.1)), Vector((w / 2 + 0.5, y, low - 0.1))], [0.08, 0.08], 6)
        for x in (-w / 2 + 0.3, w / 2 - 0.3):
            tube(kit.metal, [Vector((x, y, low - 0.1)), Vector((x, sy * (d / 2 + 0.06), low - 0.5)), Vector((x, sy * (d / 2 + 0.06), 0.1))],
                 [0.05, 0.05, 0.05], 6)
        for x in (-w / 2 - 0.5, w / 2 + 0.5):
            plank(kit.door, Vector((x, sy * (d / 2 + 0.5), low - 0.02)), Vector((x, 0, top + 0.02)), 0.05, 0.24)
    objects = kit.objects(name)
    tilt(objects, z=90)
    export(name, objects, lod=420)


# ---------------------------------------------------------------- shelter, outbuilding, annex

def lean_to(name, w=6.0, d=2.6, front_h=2.5, back_h=2.0):
    """Open timber lean-to: four posts with knee braces at the front, a boarded back wall and half-boarded
    ends, a mono-pitch roof of corrugated sheet falling to the back on rafters, posts on concrete footings,
    a stack of logs along the back wall"""
    clear_scene()
    kit = Kit()
    timber = Part(pbr_material('timber-lean-to', 'rough_wood', (0.85, 0.72, 0.58)), uv_metres=1.5)
    boards = Part(pbr_material('boards-lean-to', 'wood_planks_grey', (1.6, 1.4, 1.15)), uv_metres=1.6, bevel=0.0)
    sheet = Part(pbr_material('roof-sheet-lean-to', 'corrugated_iron_02', (0.5, 0.53, 0.55)), uv_metres=1.6, bevel=0.0)
    logs = Part(pbr_material('logs-lean-to', 'bark_brown_01', (0.9, 0.85, 0.8)), smooth=True)
    kit.extra += [timber, boards, sheet, logs]
    hw, hd = w / 2, d / 2
    fy, by = -hd + 0.1, hd - 0.1

    def roof_z(y):
        return front_h + (y - fy) / (by - fy) * (back_h - front_h)

    for x in (-hw + 0.1, -hw / 3, hw / 3, hw - 0.1):
        for y in (fy, by):
            box(kit.plinth, x, y, -0.5, 0.3, 0.3, 0.6)
            box(timber, x, y, 0.1, 0.14, 0.14, roof_z(y) - 0.1)
        if abs(x) < hw - 0.2:
            for s in (-1, 1):
                plank(timber, Vector((x, fy, front_h - 0.75)), Vector((x + s * 0.6, fy, front_h - 0.15)), 0.08, 0.08)
    # Plates along the front and back, rafters over them
    box(timber, 0, fy, front_h - 0.16, w + 0.1, 0.16, 0.16)
    box(timber, 0, by, back_h - 0.16, w + 0.1, 0.16, 0.16)
    n = 7
    for i in range(n):
        x = -hw + 0.05 + i * (w - 0.1) / (n - 1)
        plank(timber, Vector((x, fy - 0.45, roof_z(fy - 0.45) + 0.04)), Vector((x, by + 0.35, roof_z(by + 0.35) + 0.04)), 0.07, 0.14)
    prism(sheet, [Vector((-hw - 0.2, fy - 0.5, roof_z(fy - 0.5) + 0.12)), Vector((hw + 0.2, fy - 0.5, roof_z(fy - 0.5) + 0.12)),
                  Vector((hw + 0.2, by + 0.4, roof_z(by + 0.4) + 0.12)), Vector((-hw - 0.2, by + 0.4, roof_z(by + 0.4) + 0.12))],
          Vector((0, 0, 0.04)))
    plank(kit.door, Vector((-hw - 0.2, fy - 0.52, roof_z(fy - 0.5) + 0.08)), Vector((hw + 0.2, fy - 0.52, roof_z(fy - 0.5) + 0.08)),
          0.04, 0.16)
    # Back wall to the roof, the ends boarded from the back to half the depth
    box(boards, 0, by + 0.1, 0.1, w + 0.1, 0.04, back_h - 0.12)
    for sx in (-1, 1):
        x = sx * (hw + 0.1)
        y0 = 0.0
        prism(boards, [Vector((x, y0, 0.1)), Vector((x, by + 0.12, 0.1)), Vector((x, by + 0.12, roof_z(by) - 0.02)),
                       Vector((x, y0, roof_z(y0) - 0.02))], Vector((-sx * 0.04, 0, 0)))
    # Firewood stacked along the back wall
    rnd = random.Random(7)
    for row in range(4):
        for i in range(int((w - 1.2) / 0.24)):
            x0 = -hw + 0.6 + i * 0.24 + (0.12 if row % 2 else 0)
            if x0 > hw - 0.6:
                continue
            z = 0.22 + row * 0.2
            r = rnd.uniform(0.09, 0.11)
            tube(logs, [Vector((x0, by - 0.05, z)), Vector((x0, by - 0.55, z))], [r, r], 5, cap=True)
    export(name, kit.objects(name), lod=180)


def outbuilding(name, w=4.0, d=4.0, wall_h=2.6, tint=PALE_GREY, roof='anthracite', pitch_deg=30):
    """Rendered outbuilding of 4 x 4 m (a shed or a small garage): a gable roof with tiles and gutters, a
    wooden double door in the front gable on a concrete threshold, a window in the east wall, a vent in
    the gable"""
    clear_scene()
    kit = Kit(roof)
    leaf = Part(pbr_material('boards-outbuilding-door', 'brown_planks_04', (0.6, 0.5, 0.42)), uv_metres=1.4, bevel=0.0)
    kit.extra.append(leaf)
    z0 = 0.15
    box(kit.plinth, 0, 0, -FOUNDATION, w + 0.08, d + 0.08, FOUNDATION + z0)
    pitch = w / 2 * math.tan(math.radians(pitch_deg))
    # Ridge along Y (front to back): the front is a gable end
    for k in range(4):
        face = Face(k, w, d)
        L = face.length
        u0, u1 = (-L / 2, L / 2) if k % 2 == 0 else (-L / 2 + 0.25, L / 2 - 0.25)
        ops = [(0.0, 2.3, z0, z0 + 2.1)] if k == 0 else [(0.2, 0.9, z0 + 1.1, z0 + 2.0)] if k == 1 else []
        punched_wall(kit.walls(tint), face, u0, u1, z0, wall_h, ops, t=0.25)
        if k == 0:
            for s in (-1, 1):
                face.box(leaf, s * 0.575, -0.12, z0, 1.13, 0.05, 2.1)
                for zz in (0.35, 1.75):
                    face.box(kit.metal, s * 0.575, -0.09, z0 + zz, 1.0, 0.02, 0.06)
            face.box(kit.metal, 0.12, -0.08, z0 + 1.0, 0.04, 0.06, 0.25)
            face.box(kit.plinth, 0, 0.3, -0.1, 2.6, 0.6, 0.25)
            face.box(kit.sill, 0, 0.0, z0 + 2.1, 2.5, 0.28, 0.12)
        elif k == 1:
            window(kit, face, 0.2, z0 + 1.1, 0.9, 0.9, reveal=0.1, split=False)
        if k % 2 == 0:
            # Gable triangle over the eave (ridge along Y: the gable faces are front and back)
            gable_wall(kit.walls(tint), face, wall_h, pitch, w, t=0.25)
    Face(0, w, d).box(kit.door, 0, 0.0, wall_h + pitch * 0.4, 0.5, 0.04, 0.35)
    # The roof of build_modern runs along X: built on a turned box and turned back
    roof_kit = Kit(roof)
    gabled_roof(roof_kit, d, w, wall_h, pitch, over=0.3, verge=0.25)
    from mathutils import Matrix
    for src, dst in ((roof_kit.roof, kit.roof), (roof_kit.ridge, kit.ridge), (roof_kit.door, kit.door), (roof_kit.metal, kit.metal)):
        dst.add_bmesh(src.bm, matrix=Matrix.Rotation(math.pi / 2, 4, 'Z'))
        src.bm.free()
    export(name, kit.objects(name), lod=160)


def annex(name, w=7.0, d=5.0, front_h=2.9, back_h=3.9, tint=WHITE):
    """Single-storey annex that stands against a house wall at its back (+Y): rendered walls, a mono-pitch
    roof of zinc standing seams falling to the front with a gutter, a wide window in front, a glazed door
    at the east side with a step, the back left open against the house and closed by a flashing strip"""
    clear_scene()
    kit = Kit()
    zinc = Part(pbr_material('roof-zinc-seam', 'corrugated_iron_02', (0.72, 0.74, 0.76)), uv_metres=1.2, bevel=0.0)
    kit.extra.append(zinc)
    base(kit, w, d)
    hw, hd = w / 2, d / 2
    front = Face(0, w, d)
    ops = [(-1.6, 2.0, PLINTH + 0.8, PLINTH + 2.1), (1.6, 2.0, PLINTH + 0.1, PLINTH + 2.15)]
    punched_wall(kit.walls(tint), front, -hw, hw, PLINTH, front_h, ops)
    for u, ow, zb, zt in ops:
        window(kit, front, u, zb, ow, zt - zb, shutter=0.3 if zb > PLINTH + 0.5 else 0.0)
    back = Face(2, w, d)
    punched_wall(kit.walls(tint), back, -hw, hw, PLINTH, back_h, [])
    for k, ops in ((1, [(-0.6, 1.0, PLINTH, PLINTH + 2.15)]), (3, [(0.0, 1.0, PLINTH + 1.0, PLINTH + 2.1)])):
        face = Face(k, w, d)
        L = face.length
        punched_wall(kit.walls(tint), face, -L / 2 + 0.3, L / 2 - 0.3, PLINTH, front_h, ops)
        # The sloping top of the side wall up to the back
        c = face.n * (face.depth / 2 - 0.3)
        ends = [c + face.u * uu for uu in (-L / 2 + 0.3, L / 2 - 0.3)]
        poly = [Vector((p.x, p.y, front_h)) for p in ends]
        poly += [Vector((p.x, p.y, front_h + (p.y + hd) / d * (back_h - front_h) - 0.02)) for p in reversed(ends)]
        prism(kit.walls(tint), poly, face.n * 0.3)
        for u, ow, zb, zt in ops:
            if zb == PLINTH:
                door(kit, face, u, zb, ow, zt - zb)
                face.box(kit.plinth, u, 0.25, -0.05, 1.4, 0.5, PLINTH + 0.05)
            else:
                window(kit, face, u, zb, ow, zt - zb, split=False)
    # Roof falling to the front: a slab with standing seams, a fascia, a gutter, a flashing up the house wall
    over = 0.35
    zf, zb = front_h + 0.05 - over * (back_h - front_h) / d, back_h + 0.05
    prism(zinc, [Vector((-hw - 0.15, -hd - over, zf)), Vector((hw + 0.15, -hd - over, zf)), Vector((hw + 0.15, hd, zb)),
                 Vector((-hw - 0.15, hd, zb))], Vector((0, 0, 0.12)))
    for i in range(int(w / 0.5) + 1):
        x = -hw - 0.1 + i * (w + 0.2) / int(w / 0.5)
        plank(kit.metal, Vector((x, -hd - over, zf + 0.15)), Vector((x, hd, zb + 0.15)), 0.03, 0.05)
    plank(kit.door, Vector((-hw - 0.15, -hd - over - 0.02, zf + 0.0)), Vector((hw + 0.15, -hd - over - 0.02, zf + 0.0)), 0.04, 0.2)
    tube(kit.metal, [Vector((-hw - 0.15, -hd - over - 0.1, zf - 0.02)), Vector((hw + 0.15, -hd - over - 0.1, zf - 0.02))], [0.07, 0.07], 6)
    tube(kit.metal, [Vector((hw - 0.1, -hd - over - 0.1, zf - 0.02)), Vector((hw - 0.1, -hd + 0.06, zf - 0.4)),
                     Vector((hw - 0.1, -hd + 0.06, 0.1))], [0.045, 0.045, 0.045], 6)
    box(kit.metal, 0, hd - 0.02, zb + 0.1, w + 0.3, 0.04, 0.3)
    export(name, kit.objects(name), lod=200)


# ---------------------------------------------------------------- office tower

def office_ribbon(name, w=16.0, d=16.0, floors=10, fh=3.4, ground=4.8, bay=3.2, shop=False, seed=0, lod=900):
    """Office tower with ribbon windows between stone pilasters: a glass core, a pale stone spandrel band per
    storey running between the pilasters, pilasters at every bay over the full height and wider ones at the
    corners, dark mullions behind the ribbons, a two-storey glazed base with a recessed entrance under a
    canopy, a set-back glass attic under a thin roof slab, plant behind it. `shop`: a small commercial building
    instead (no attic): display windows on stall risers and a sign band over the ground floor of the front"""
    clear_scene()
    rnd = random.Random(seed)
    kit = Kit(frame=(0.12, 0.13, 0.14))
    stone = Part(pbr_material('stone-pilaster', 'concrete_slab_wall', (1.35, 1.33, 1.28)), uv_metres=3.0, bevel=0.02)
    band = Part(pbr_material('stone-spandrel', 'concrete_slab_wall', (1.05, 1.0, 0.92)), uv_metres=3.0, bevel=0.0)
    kit.extra += [stone, band]
    top = PLINTH + ground + (floors - 1) * fh
    base(kit, w, d)
    box(kit.glass, 0, 0, PLINTH, w - 0.6, d - 0.6, top - PLINTH)
    for k in range(4):
        face = Face(k, w, d)
        L = face.length
        n = max(2, int(round(L / bay)))
        step = L / n
        # Bands between the storeys from the first floor up, and the deep band over the glazed base
        face.box(band, 0, -0.2, PLINTH + ground - 0.7, L - 0.4, 0.3, 0.7)
        for f in range(1, floors):
            z = PLINTH + ground + (f - 1) * fh
            face.box(band, 0, -0.2, z + fh - 0.95, L - 0.4, 0.3, 0.95)
        face.box(band, 0, -0.2, top, L - 0.4, 0.3, 1.1)
        # Pilasters: every bay, proud of the bands; the corners wider
        for i in range(1, n):
            face.box(stone, -L / 2 + i * step, 0.02, PLINTH, 0.42, 0.36, top - PLINTH + 1.1)
        # A mullion mid-bay behind each ribbon
        for i in range(n):
            u = -L / 2 + (i + 0.5) * step
            face.box(kit.frames, u, -0.3, PLINTH + ground, 0.08, 0.06, top - PLINTH - ground)
        # The base: tall glazing with transoms, the entrance recessed on the front
        face.box(kit.frames, 0, -0.29, PLINTH + 2.9, L - 0.6, 0.06, 0.08)
        face.box(kit.frames, 0, -0.29, PLINTH + ground - 0.75, L - 0.6, 0.06, 0.08)
        for f in range(1, floors):
            z = PLINTH + ground + (f - 1) * fh
            face.box(kit.frames, 0, -0.3, z, L - 0.6, 0.05, 0.06)
        face.box(kit.metal, 0, 0.0, top + 1.1, L + 0.08, 0.6, 0.06)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(stone, sx * (w / 2 - 0.3), sy * (d / 2 - 0.3), PLINTH, 0.9, 0.9, top - PLINTH + 1.1)
    front = Face(0, w, d)
    if shop:
        # Sign band in the door anthracite, blank panels in the sill grey: no parts of their own
        sign, sign_face = kit.door, kit.sill
        front.box(sign, 0, -0.04, PLINTH + ground - 0.72, w - 1.8, 0.14, 0.74)
        front.box(sign_face, -w * 0.15, 0.04, PLINTH + ground - 0.6, w * 0.4, 0.03, 0.5)
        n = max(2, int(round(w / bay)))
        for i in range(n):
            u = -w / 2 + (i + 0.5) * w / n
            if i == n // 2:
                front.box(kit.door, u, -0.32, PLINTH, 1.4, 0.06, 2.6)
            else:
                front.box(kit.sill, u, -0.15, PLINTH, w / n - 0.4, 0.3, 0.5)
        front.box(kit.metal, -w / 4, 0.6, PLINTH + 3.0, w / 2 - 1.0, 1.2, 0.08)
    else:
        front.box(kit.door, 0, -0.32, PLINTH, 3.6, 0.06, 2.8)
        front.box(kit.metal, 0, 1.4, PLINTH + 3.4, 6.4, 3.2, 0.22)
        for s in (-1, 1):
            front.box(kit.frames, s * 2.9, 2.6, 0.0, 0.16, 0.16, PLINTH + 3.4)
        front.box(kit.plinth, 0, 1.4, -0.1, 7.0, 3.0, PLINTH + 0.05)
    # Roof: membrane behind the parapet, a set-back glass attic with mullions under a projecting slab
    felt = bitumen()
    box(felt, 0, 0, top + 0.95, w - 0.6, d - 0.6, 0.05)
    kit.extra.append(felt)
    if shop:
        roof_plant(kit, w * 0.7, d * 0.6, top + 0.95, rnd, units=1)
        export(name, kit.objects(name), lod=lod)
        return
    aw, ad, ah = w - 4.0, d - 4.0, 3.0
    box(kit.glass, 0, 0, top + 1.0, aw, ad, ah)
    for k in range(4):
        face = Face(k, aw, ad)
        m = int(face.length / 1.6)
        for i in range(m + 1):
            face.box(kit.frames, -face.length / 2 + i * face.length / m, 0.0, top + 1.0, 0.08, 0.08, ah)
    box(kit.metal, 0, 0, top + 1.0 + ah, aw + 1.4, ad + 1.4, 0.25)
    box(felt, 0, 0, top + 1.25 + ah, aw + 1.2, ad + 1.2, 0.04)
    roof_plant(kit, aw * 0.8, ad * 0.6, top + 1.29 + ah, rnd, units=2)
    export(name, kit.objects(name), lod=lod)


def models():
    return {
        'shop-small': lambda: shop_small('shop-small', seed=51),
        'barn-modern': lambda: barn_modern('barn-modern'),
        'shelter-lean-to': lambda: lean_to('shelter-lean-to'),
        'outbuilding': lambda: outbuilding('outbuilding'),
        'annex': lambda: annex('annex'),
        'office-ribbon': lambda: office_ribbon('office-ribbon', seed=52),
        'shop-office': lambda: office_ribbon('shop-office', 12.0, 10.0, 4, fh=3.3, ground=4.2, bay=3.0, shop=True, seed=53, lod=500),
    }
