"""Trees, plants and rocks of the map asset catalogue (loaded by build_models.py)."""
import math
import os
import random

from mathutils import Matrix, Vector

from blender_kit import (
    Part, box, box_uv, card, card_material, clear_scene, export, export_lod, flat_material, hexa, image_material, import_model,
    oriented_box, pbr_material, tube,
)
import blender_kit


# ---------------------------------------------------------------- trees and plants

def broadleaf(name, seed, height, crown_r, trunk_r, bark, leaves, bark_tint=None, slender=False, extra=None):
    """Broadleaf tree: a flared trunk splitting into primary and secondary branches; leaf cards in clusters
    at the branch tips (the crown reads as clumps with gaps, not a ball), cards facing out of their cluster
    with normals bent from the crown centre (soft round light), darker cards inside the crown for depth.
    `extra(wood, foliage, pts)` adds parts (roots, more cards)"""
    clear_scene()
    rnd = random.Random(seed)
    wood = Part(pbr_material('bark-' + bark + ('-t' if bark_tint else ''), bark, bark_tint))
    foliage = Part(card_material(leaves.replace('leaves-', ''), leaves + '.png'))
    inner = Part(card_material(leaves.replace('leaves-', '') + '-dark', leaves + '-dark.png'))
    trunk_top = height * (0.45 if not slender else 0.62)
    pts = [Vector((0, 0, -0.3))]
    for k in range(1, 7):
        t = k / 6
        pts.append(Vector((rnd.uniform(-0.2, 0.2) * t, rnd.uniform(-0.2, 0.2) * t, trunk_top * t)))
    radii = [trunk_r * (1.6 if k == 0 else (1.15 if k == 1 else 1 - 0.55 * k / 6)) for k in range(7)]
    tube(wood, pts, radii, 9)
    crown_c = Vector((0, 0, height - crown_r * (0.95 if not slender else 1.15)))
    tips = []
    primaries = 6 if not slender else 5
    for b in range(primaries):
        t = 0.55 + 0.45 * b / primaries
        start = pts[min(6, int(t * 6))]
        ang = b * 2.39996 + rnd.uniform(-0.25, 0.25)
        rise = rnd.uniform(0.7, 1.2) if not slender else rnd.uniform(1.6, 2.2)
        out = Vector((math.cos(ang), math.sin(ang), rise)).normalized()
        length = crown_r * rnd.uniform(0.75, 1.0) * (1.0 if not slender else 1.2)
        mid = start + out * length * 0.5 + Vector((0, 0, length * 0.1))
        end = start + out * length + Vector((0, 0, length * 0.2))
        tube(wood, [start, mid, end], [trunk_r * 0.5, trunk_r * 0.32, trunk_r * 0.14], 6)
        tips.append((end, crown_r * 0.42))
        for s in range(2):
            a2 = ang + (s - 0.5) * rnd.uniform(1.0, 1.6)
            d2 = Vector((math.cos(a2), math.sin(a2), rnd.uniform(0.5, 1.1))).normalized()
            p0 = mid.lerp(end, rnd.uniform(0.2, 0.6))
            l2 = length * rnd.uniform(0.45, 0.65)
            p1 = p0 + d2 * l2
            tube(wood, [p0, p0.lerp(p1, 0.5), p1], [trunk_r * 0.18, trunk_r * 0.11, trunk_r * 0.05], 4)
            tips.append((p1, crown_r * rnd.uniform(0.3, 0.38)))
    tips.append((crown_c + Vector((0, 0, crown_r * 0.55)), crown_r * 0.45))
    # Leaf clusters at the tips
    for c, rc in tips:
        for k in range(10):
            u = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.4, 1))).normalized()
            p = c + u * rc * rnd.uniform(0.3, 0.8)
            out = (p - crown_c).normalized() * 0.6 + u * 0.4
            out.normalize()
            d = (Vector((0, 0, 1)) + out * rnd.uniform(0.3, 1.0)).normalized()
            hint = (out + d.cross(out) * rnd.uniform(-0.4, 0.4)).normalized()
            size = rc * rnd.uniform(1.2, 1.7)
            card(foliage, p - d * size * 0.5, d, hint, size, size, crown_c)
    # Dark cards fill the inside of the crown
    for k in range(10 if not slender else 6):
        p = crown_c + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.4, 0.6))) * crown_r * 0.5
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0.3, 1))).normalized()
        size = crown_r * 0.75
        card(inner, p - d * size * 0.4, d, d.orthogonal(), size, size, crown_c)
    if extra:
        extra(wood, foliage, pts)
    export(name, [wood.to_object(name + '-wood'), foliage.to_object(name + '-leaves'), inner.to_object(name + '-inner')])


def conifer(name, seed, height, radius, bare, trunk_r, leaves='leaves-conifer'):
    """Trunk with whorls of branch cards; `bare` = fraction of the trunk without branches"""
    clear_scene()
    rnd = random.Random(seed)
    wood = Part(pbr_material('bark-knotted_pine_bark', 'knotted_pine_bark'))
    foliage = Part(card_material(leaves.replace('leaves-', ''), leaves + '.png'))
    dark = 'leaves-conifer-dark' if leaves == 'leaves-conifer' else leaves
    inner = Part(card_material(dark.replace('leaves-', ''), dark + '.png'))
    tube(wood, [Vector((0, 0, -0.3)), Vector((0, 0, 0.3)), Vector((0, 0, height * 0.5)), Vector((0, 0, height * 0.9))],
         [trunk_r * 1.4, trunk_r, trunk_r * 0.6, trunk_r * 0.1], 8)
    h0 = height * bare
    z = h0
    whorl = 0
    while z < height - 0.4:
        t = (z - h0) / (height - h0)
        reach = radius * (1 - t) ** 0.9 + 0.35
        n = 7 if reach > 1.2 else 5
        for k in range(n):
            ang = (k / n + whorl * 0.37) * math.tau + rnd.uniform(-0.2, 0.2)
            out = Vector((math.cos(ang), math.sin(ang), 0))
            droop = rnd.uniform(-0.45, -0.15) if t < 0.8 else rnd.uniform(0.3, 0.7)
            d = (out + Vector((0, 0, droop))).normalized()
            base = Vector((0, 0, z))
            center = Vector((0, 0, z + reach * 0.3))
            # Two cards per branch, crossed along it
            hint_a = Vector((0, 0, 1)).cross(out).cross(d).normalized()
            if hint_a.z < 0:
                hint_a = -hint_a
            card(foliage, base, d, hint_a, reach * 1.05, reach * 1.1, center)
            hint_b = (hint_a + out.cross(d) * 1.5).normalized()
            card(foliage, base + Vector((0, 0, 0.1)), d, hint_b, reach * 0.7, reach, center)
            if k % 2 == 0:
                card(inner, base + Vector((0, 0, 0.25)), (out * 0.6 + Vector((0, 0, 0.1))).normalized(), hint_a, reach * 0.8, reach * 0.65, center)
        whorl += 1
        z += rnd.uniform(0.5, 0.7) * (1.0 if height > 10 else 0.7)
    # Tip: three narrow cards leaning out from the top of the trunk
    for k in range(3):
        ang = k / 3 * math.tau
        d = Vector((math.cos(ang) * 0.12, math.sin(ang) * 0.12, 1)).normalized()
        card(foliage, Vector((0, 0, height - 1.8)), d, Vector((-math.sin(ang), math.cos(ang), 0)), 0.5, 1.6, Vector((0, 0, height - 2.5)))
    objects = [wood.to_object(name + '-wood'), foliage.to_object(name + '-leaves')]
    if inner.bm.faces:
        objects.append(inner.to_object(name + '-inner'))
    export(name, objects)


def dead_tree(name, seed, tint=(0.62, 0.6, 0.58), extra=None, bark='bark_brown_02'):
    """Bare trunk with forked branches; `extra(wood, pts)` adds parts (stilt roots, hanging moss)"""
    clear_scene()
    rnd = random.Random(seed)
    wood = Part(pbr_material('bark-dead-%s-%s' % (bark, '-'.join('%.2f' % c for c in tint)), bark, tint))
    pts = [Vector((0, 0, 0)), Vector((0.1, 0, 3)), Vector((0.3, 0.2, 6)), Vector((0.2, 0.4, 8.5))]
    tube(wood, pts, [0.32, 0.24, 0.15, 0.05], 7)

    def branch(start, d, length, r, depth):
        end = start + d * length
        mid = start.lerp(end, 0.5) + Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(-0.2, 0.3)))
        tube(wood, [start, mid, end], [r, r * 0.6, r * 0.15], 4 if depth else 5)
        if depth < 2:
            for _ in range(2):
                nd = (d + Vector((rnd.uniform(-0.8, 0.8), rnd.uniform(-0.8, 0.8), rnd.uniform(0.0, 0.7)))).normalized()
                branch(mid.lerp(end, rnd.uniform(0.2, 0.8)), nd, length * 0.55, r * 0.5, depth + 1)

    for k in range(5):
        ang = k * 2.4 + rnd.uniform(-0.3, 0.3)
        z = rnd.uniform(3.2, 7.0)
        d = Vector((math.cos(ang), math.sin(ang), rnd.uniform(0.3, 1.0))).normalized()
        branch(Vector((0.15, 0.2, z)), d, rnd.uniform(1.8, 3.0), 0.1, 0)
    objects = [wood]
    if extra:
        objects += extra(wood, pts) or []
    export(name, [p.to_object(name + '-' + str(k)) for k, p in enumerate(objects)])


def bush(name, seed, radius, height, leaves='leaves-bush'):
    clear_scene()
    rnd = random.Random(seed)
    foliage = Part(card_material(leaves.replace('leaves-', ''), leaves + '.png'))
    center = Vector((0, 0, height * 0.35))
    for k in range(16):
        ang = rnd.uniform(0, math.tau)
        out = Vector((math.cos(ang), math.sin(ang), rnd.uniform(0.2, 1.4))).normalized()
        base = Vector((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), 0.0))
        size = radius * rnd.uniform(1.1, 1.4)
        hint = (out.orthogonal().normalized() + out * 0.4).normalized()
        card(foliage, base, out, hint, size * 1.1, height * rnd.uniform(0.9, 1.15) / max(out.z, 0.4), center)
    export(name, [foliage.to_object(name + '-leaves')])


def grass(name, png, width, height, seed, cards=5):
    clear_scene()
    rnd = random.Random(seed)
    foliage = Part(card_material(name, png))
    # Cards fanned out from the centre and leaning outwards, so the clump has area seen from above
    for k in range(cards):
        ang = k / cards * math.tau + rnd.uniform(-0.3, 0.3)
        out = Vector((math.cos(ang), math.sin(ang), 0))
        side = Vector((-out.y, out.x, 0)) * width / 2
        base = out * width * 0.08
        up = Vector((0, 0, height)) + out * height * rnd.uniform(0.35, 0.6)
        # Normals straight up: clumps light exactly like the ground they stand on
        nrm = lambda co: Vector((0, 0, 1))
        foliage.quad([base - side, base + side, base + side + up, base - side + up], [(0, 0), (1, 0), (1, 1), (0, 1)], nrm)
    export(name, [foliage.to_object(name)])


def lumpy(part, first, amount, seed):
    """Pushes the vertices of `part` from index `first` on out from the Z axis by a smooth bumpy factor
    (bark that is not a lathe-turned cylinder)"""
    part.bm.verts.ensure_lookup_table()
    for v in part.bm.verts[first:]:
        a = math.atan2(v.co.y, v.co.x)
        f = 1 + amount * (math.sin(3 * a + seed) * 0.6 + math.sin(5 * a + 2 * seed + v.co.z * 3) * 0.4)
        v.co.x *= f
        v.co.y *= f


def stump(name):
    """Tree stump broken off: a lumpy trunk flaring into five roots, the break a little slanted with a bark
    rim standing proud of the wood and splinters left standing on one side"""
    clear_scene()
    rnd = random.Random(11)
    wood = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02'))
    top = Part(pbr_material('wood-rough', 'rough_wood', (1.1, 1.0, 0.85)))
    tube(wood, [Vector((0, 0, -0.1)), Vector((0, 0, 0.12)), Vector((0, 0, 0.3)), Vector((0, 0, 0.44))], [0.42, 0.36, 0.32, 0.31], 12)
    lumpy(wood, 0, 0.06, 1.0)
    for k in range(5):
        a = k / 5 * math.tau + rnd.uniform(-0.3, 0.3)
        out = Vector((math.cos(a), math.sin(a), 0))
        tube(wood, [out * 0.22 + Vector((0, 0, 0.26)), out * 0.42 + Vector((0, 0, 0.08)), out * 0.62 + Vector((0, 0, -0.06))],
             [0.13, 0.08, 0.04], 6)
    # The break: wood a little below the bark rim, slanted, splinters up to 0.6 m on the high side
    bm = top.bm
    ring = [bm.verts.new((math.cos(a / 12 * math.tau) * 0.29, math.sin(a / 12 * math.tau) * 0.29,
                          0.41 + 0.035 * math.cos(a / 12 * math.tau))) for a in range(12)]
    f = bm.faces.new(ring)
    for loop in f.loops:
        loop[top.uv].uv = (loop.vert.co.x + 0.5, loop.vert.co.y + 0.5)
    for k in range(6):
        a = -0.9 + k * 0.36 + rnd.uniform(-0.08, 0.08)
        base = Vector((math.cos(a) * 0.24, math.sin(a) * 0.24, 0.42))
        tip = base + Vector((rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), rnd.uniform(0.07, 0.18)))
        tube(top, [base, tip], [0.045, 0.006], 4, smooth=False)
    export(name, [wood.to_object(name + '-bark'), top.to_object(name + '-top')])


def log(name):
    """Fallen trunk, slightly bent and lumpy, its ends chamfered where the bark has worn off, two broken
    branch stubs"""
    clear_scene()
    wood = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02'))
    mid = Vector((0, 0.05, 0.3))
    for end, r_end in ((Vector((-1.6, 0, 0.28)), 0.3), (Vector((1.6, 0, 0.26)), 0.26)):
        d = (end - mid).normalized()
        tube(wood, [mid, mid.lerp(end, 0.5) + Vector((0, 0.02, 0)), end - d * 0.06, end], [0.29, (0.29 + r_end) / 2, r_end, r_end * 0.85],
             12, cap=True)
    for v in wood.bm.verts:
        a = math.atan2(v.co.z - 0.28, v.co.y)
        f = 1 + 0.05 * math.sin(3 * a + v.co.x * 2.1)
        v.co.y *= f
        v.co.z = 0.28 + (v.co.z - 0.28) * f
    for x, a, length in ((-0.7, 0.35, 0.35), (0.5, 2.75, 0.25)):
        root = Vector((x, math.cos(a) * 0.2, 0.3 + math.sin(a) * 0.2))
        tip = root + Vector((0.12, math.cos(a), math.sin(a))).normalized() * length
        tube(wood, [root, tip], [0.07, 0.05], 6, cap=True)
    export(name, [wood.to_object(name)])


# ---------------------------------------------------------------- more trees

def stilt_roots(wood, rnd, count, spread, height, trunk_r):
    """Mangrove roots: arched tubes from a ring on the ground up into the trunk"""
    for k in range(count):
        ang = k / count * math.tau + rnd.uniform(-0.25, 0.25)
        out = Vector((math.cos(ang), math.sin(ang), 0))
        foot = out * spread * rnd.uniform(0.8, 1.15) + Vector((0, 0, -0.3))
        top = out * trunk_r * 0.6 + Vector((0, 0, height * rnd.uniform(0.8, 1.1)))
        knee = foot.lerp(top, 0.45) + out * spread * 0.35 + Vector((0, 0, height * 0.35))
        tube(wood, [foot, foot.lerp(knee, 0.5) + Vector((0, 0, 0.25)), knee, top],
             [trunk_r * 0.22, trunk_r * 0.24, trunk_r * 0.27, trunk_r * 0.32], 5)


def willow(name, seed, height=11.0, crown_r=5.5):
    """Weeping willow: a short thick trunk, branches arching out, long strands of leaves hanging down"""
    clear_scene()
    rnd = random.Random(seed)
    wood = Part(pbr_material('bark-bark_willow', 'bark_willow'))
    foliage = Part(card_material('willow', 'leaves-willow.png'))
    trunk_top = height * 0.4
    pts = [Vector((0, 0, 0)), Vector((0.1, 0.05, trunk_top * 0.5)), Vector((0.2, 0.0, trunk_top))]
    tube(wood, pts, [0.75, 0.55, 0.45], 9)
    center = Vector((0, 0, height * 0.6))
    for b in range(8):
        ang = b * 2.39996 + rnd.uniform(-0.3, 0.3)
        out = Vector((math.cos(ang), math.sin(ang), 0))
        start = pts[-1] + Vector((0, 0, rnd.uniform(-0.6, 0.4)))
        reach = crown_r * rnd.uniform(0.7, 1.0)
        top = start + out * reach * 0.55 + Vector((0, 0, height - trunk_top - rnd.uniform(0.0, 1.6)))
        end = start + out * reach + Vector((0, 0, (height - trunk_top) * 0.55))
        tube(wood, [start, start.lerp(top, 0.5), top, end], [0.3, 0.22, 0.12, 0.04], 5)
        # Strands hang from the upper arc of the branch
        for c in range(9):
            p = top.lerp(end, rnd.uniform(-0.6, 1.0)) + Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), 0))
            d = (Vector((0, 0, -1)) + out * rnd.uniform(0.1, 0.35)).normalized()
            length = min(p.z - 0.6, rnd.uniform(3.5, 6.0))
            side = out.cross(Vector((0, 0, 1))).normalized()
            hint = (out + side * rnd.uniform(-0.8, 0.8)).normalized()
            card(foliage, p + Vector((0, 0, 0.3)), d, hint, 1.3, length, center)
    # A cap of strands over the top so the crown reads closed from above
    for c in range(10):
        ang = rnd.uniform(0, math.tau)
        out = Vector((math.cos(ang), math.sin(ang), 0))
        p = Vector((0, 0, height - 0.6)) + out * rnd.uniform(0.0, crown_r * 0.4)
        d = (out * 0.9 + Vector((0, 0, -0.35))).normalized()
        card(foliage, p, d, Vector((0, 0, 1)), 1.4, crown_r * 0.75, center)
    export(name, [wood.to_object(name + '-wood'), foliage.to_object(name + '-leaves')])


def palm(name, seed, height=9.0, lean=1.6, fronds='palm-frond', count=12):
    """Palm: a slender curved trunk and a crown of fronds, each two cards (rising, then drooping)"""
    clear_scene()
    rnd = random.Random(seed)
    wood = Part(pbr_material('bark-palm_tree_bark', 'palm_tree_bark', (0.75, 0.7, 0.65)))
    foliage = Part(card_material(fronds.replace('palm-', 'palm'), fronds + '.png'))
    lean_dir = Vector((math.cos(seed), math.sin(seed), 0))
    pts = [lean_dir * lean * (t ** 2) + Vector((0, 0, height * t)) for t in [k / 8 for k in range(9)]]
    tube(wood, pts, [0.4 - 0.16 * k / 8 for k in range(9)], 8)
    top = pts[-1]
    center = top + Vector((0, 0, 0.6))
    for k in range(count):
        ang = k / count * math.tau + rnd.uniform(-0.2, 0.2)
        out = Vector((math.cos(ang), math.sin(ang), 0))
        rise = rnd.uniform(0.2, 0.7) if k % 2 else rnd.uniform(-0.1, 0.3)
        d1 = (out + Vector((0, 0, rise))).normalized()
        l1 = rnd.uniform(2.6, 3.2)
        hint = Vector((0, 0, 1)).cross(out).cross(d1).normalized()
        if hint.z < 0:
            hint = -hint
        card(foliage, top, d1, hint, 2.4, l1, center)
        d2 = (out + Vector((0, 0, rise - rnd.uniform(0.9, 1.4)))).normalized()
        hint2 = Vector((0, 0, 1)).cross(out).cross(d2).normalized()
        if hint2.z < 0:
            hint2 = -hint2
        card(foliage, top + d1 * l1 * 0.92, d2, hint2, 2.2, rnd.uniform(2.6, 3.3), center)
    # Fruit cluster under the crown
    nuts = Part(flat_material('palm-nuts', (0.25, 0.2, 0.08), 0.7))
    for k in range(5):
        a = k / 5 * math.tau
        box(nuts, top.x + math.cos(a) * 0.22, top.y + math.sin(a) * 0.22, top.z - 0.45, 0.2, 0.2, 0.22, a)
    export(name, [wood.to_object(name + '-wood'), foliage.to_object(name + '-leaves'), nuts.to_object(name + '-nuts')])


def cactus(name, seed, height=5.0, arms=2):
    """Saguaro: ribbed column with rounded top and arms bending upwards"""
    clear_scene()
    rnd = random.Random(seed)
    skin = Part(image_material('cactus-skin', blender_kit.FOLIAGE + '/cactus.jpg', 0.6), smooth=True)
    r = height * 0.075

    def column(points, radius):
        n = len(points)
        radii = [radius * (1.0 if k < n - 2 else (0.75 if k == n - 2 else 0.25)) for k in range(n)]
        tube(skin, points, radii, 12, cap=True)

    column([Vector((0, 0, -0.2))] + [Vector((0, 0, height * t)) for t in (0.3, 0.6, 0.9, 0.97, 1.0)], r)
    for a in range(arms):
        ang = a * math.pi + rnd.uniform(-0.6, 0.6)
        out = Vector((math.cos(ang), math.sin(ang), 0))
        z = height * rnd.uniform(0.3, 0.5)
        reach = r * rnd.uniform(2.6, 3.4)
        up = height * rnd.uniform(0.25, 0.4)
        base = Vector((0, 0, z))
        column([base, base + out * reach * 0.7 + Vector((0, 0, r * 0.2)), base + out * reach + Vector((0, 0, r * 1.2)),
                base + out * reach + Vector((0, 0, up)), base + out * reach + Vector((0, 0, up + r * 0.5)),
                base + out * reach + Vector((0, 0, up + r * 0.8))], r * 0.7)
    export(name, [skin.to_object(name)])


def barrel_cactus(name, seed):
    clear_scene()
    skin = Part(image_material('cactus-skin', blender_kit.FOLIAGE + '/cactus.jpg', 0.6), smooth=True)
    profile = [(-0.05, 0.3), (0.15, 0.42), (0.4, 0.46), (0.65, 0.42), (0.82, 0.3), (0.9, 0.12)]
    tube(skin, [Vector((0, 0, z)) for z, _ in profile], [r for _, r in profile], 14, cap=True)
    flowers = Part(flat_material('cactus-flower', (0.95, 0.75, 0.15), 0.6))
    for k in range(6):
        a = k / 6 * math.tau
        box(flowers, math.cos(a) * 0.08, math.sin(a) * 0.08, 0.86, 0.07, 0.07, 0.08, a)
    export(name, [skin.to_object(name), flowers.to_object(name + '-flowers')])


def round_bush(name, seed, radius, height, leaves):
    """Dense rounded shrub: leaf cards scattered through an ellipsoid, facing outwards"""
    clear_scene()
    rnd = random.Random(seed)
    foliage = Part(card_material(leaves.replace('leaves-', 'shrub-'), leaves + '.png'))
    wood = Part(pbr_material('bark-bark_brown_02', 'bark_brown_02'))
    center = Vector((0, 0, height * 0.5))
    for k in range(4):
        a = k / 4 * math.tau + rnd.uniform(-0.4, 0.4)
        tube(wood, [Vector((0, 0, 0)), Vector((math.cos(a) * radius * 0.35, math.sin(a) * radius * 0.35, height * 0.55))],
             [radius * 0.06, radius * 0.02], 4)
    for k in range(20):
        ang = rnd.uniform(0, math.tau)
        out = Vector((math.cos(ang), math.sin(ang), 0))
        p = center + out * radius * rnd.uniform(0.15, 0.6) + Vector((0, 0, rnd.uniform(-0.3, 0.3) * height))
        # Standing cards facing outwards, tilted a little: a closed silhouette from every side
        d = (Vector((0, 0, 1)) + out * rnd.uniform(-0.15, 0.45)).normalized()
        size = radius * rnd.uniform(1.0, 1.25)
        card(foliage, p - d * size * 0.5, d, out, size, min(size, height * 1.1), center)
    dark = os.path.join(blender_kit.FOLIAGE, leaves + '-dark.png')
    objects = [wood.to_object(name + '-wood'), foliage.to_object(name + '-leaves')]
    if os.path.exists(dark):
        inner = Part(card_material(leaves.replace('leaves-', 'shrub-') + '-dark', leaves + '-dark.png'))
        for k in range(6):
            ang = k / 6 * math.tau
            card(inner, center + Vector((math.cos(ang), math.sin(ang), 0)) * radius * 0.15 - Vector((0, 0, height * 0.4)),
                 Vector((0, 0, 1)), Vector((math.cos(ang), math.sin(ang), 0)), radius * 1.1, height * 0.85, center)
        objects.append(inner.to_object(name + '-inner'))
    export(name, objects)


def hedge(name, seed, length=3.0, height=1.4, depth=1.0, leaves='leaves-bush'):
    """Clipped hedge: a dark core battered like a trimmed hedge (narrower at the top), covered in
    outward-facing leaf cards on the sides, the ends, a slightly domed top and rounded shoulders; the face
    bulges a little along its length. Card normals bend away from the hedge's axis, not its middle, so a long
    hedge lights like a trimmed block with soft edges"""
    clear_scene()
    rnd = random.Random(seed)
    core = Part(flat_material('hedge-core', (0.06, 0.1, 0.04), 0.9))
    foliage = Part(card_material(leaves.replace('leaves-', 'hedge-'), leaves + '.png'))
    hl, hd = length / 2 - 0.1, depth / 2 - 0.1
    hexa(core, [(-hl, -hd, 0), (hl, -hd, 0), (hl, hd, 0), (-hl, hd, 0)],
         [(-hl + 0.08, -hd + 0.12, height - 0.1), (hl - 0.08, -hd + 0.12, height - 0.1), (hl - 0.08, hd - 0.12, height - 0.1),
          (-hl + 0.08, hd - 0.12, height - 0.1)])

    def axis(x, z):
        return Vector((max(-length / 2 + depth / 2, min(length / 2 - depth / 2, x)), 0, min(z, height * 0.45)))

    step = 0.55
    nx = max(1, round(length / step))
    nz = max(1, round(height / step))
    bulge = [rnd.uniform(-0.05, 0.05) for _ in range(nx)]
    for i in range(nx):
        x = -length / 2 + (i + 0.5) * length / nx
        for j in range(nz):
            z = (j + 0.5) * height / nz
            for side in (-1, 1):
                # Battered face: 0.1 m in at the top
                y = side * (depth / 2 - 0.1 * z / height + bulge[i])
                p = Vector((x + rnd.uniform(-0.1, 0.1), y, z + rnd.uniform(-0.08, 0.08)))
                d = Vector((rnd.uniform(-0.3, 0.3), side * 0.2, 1)).normalized()
                card(foliage, p - d * 0.45, d, Vector((0, side, 0)), 0.85, 0.9, axis(x, z))
                # A layer just behind, half a step along, fills the gaps between the cards
                q = Vector((min(length / 2 - 0.3, x + length / nx / 2), y - side * 0.07, z + rnd.uniform(-0.1, 0.1)))
                card(foliage, q - d * 0.45, d, Vector((0, side, 0)), 0.8, 0.9, axis(q.x, z))
        # Shoulders: cards leaning out at 45 degrees along both top edges
        for side in (-1, 1):
            p = Vector((x + rnd.uniform(-0.1, 0.1), side * (depth / 2 - 0.14), height - 0.12))
            d = Vector((1, rnd.uniform(-0.2, 0.2), 0.05)).normalized()
            card(foliage, p - d * 0.42, d, Vector((0, side, 1)), 0.75, 0.85, axis(x, height))
        for j in range(3):
            y = -depth / 2 + (j + 0.5) * depth / 3
            p = Vector((x, y, height - 0.05 + (0.04 if j == 1 else -0.03) + rnd.uniform(-0.03, 0.03)))
            d = Vector((1, rnd.uniform(-0.3, 0.3), 0.1)).normalized()
            card(foliage, p - d * 0.45, d, Vector((0, 0, 1)), 0.8, 0.9, axis(x, height))
    for side in (-1, 1):
        for j in range(nz):
            for k in range(2):
                y = -depth / 4 + k * depth / 2
                z = (j + 0.5) * height / nz
                p = Vector((side * (length / 2 - 0.05 * z / height), y, z))
                d = Vector((side * 0.2, 0, 1)).normalized()
                card(foliage, p - d * 0.45, d, Vector((side, 0, 0)), 0.8, 0.9, axis(side * length, z))
    export(name, [core.to_object(name + '-core'), foliage.to_object(name + '-leaves')])


# ---------------------------------------------------------------- small plants

def field_patch(name, png, size, height, seed, rows=4):
    """Crop or reed bed: rows of crossed cards over a square patch"""
    clear_scene()
    rnd = random.Random(seed)
    foliage = Part(card_material(name, png))
    nrm = lambda co: Vector((0, 0, 1))
    for i in range(rows):
        for j in range(rows):
            c = Vector((-size / 2 + (i + 0.5) * size / rows + rnd.uniform(-0.15, 0.15),
                        -size / 2 + (j + 0.5) * size / rows + rnd.uniform(-0.15, 0.15), 0))
            for a in (0.0, math.pi / 2):
                ang = a + rnd.uniform(-0.4, 0.4)
                side = Vector((math.cos(ang), math.sin(ang), 0)) * size / rows * 0.75
                up = Vector((0, 0, height * rnd.uniform(0.85, 1.1)))
                foliage.quad([c - side, c + side, c + side + up, c - side + up], [(0, 0), (1, 0), (1, 1), (0, 1)], nrm)
    export(name, [foliage.to_object(name)])


def lily_pads(name, seed, flowers=2):
    """Floating leaves (place them at the water level with the object's height offset)"""
    clear_scene()
    rnd = random.Random(seed)
    pads = Part(card_material('lily-pad', 'lily-pad.png'))
    bloom = Part(card_material('lily-flower', 'lily-flower.png'))
    up = lambda co: Vector((0, 0, 1))
    spots = []
    for k in range(7):
        for _ in range(20):
            p = Vector((rnd.uniform(-1.3, 1.3), rnd.uniform(-1.3, 1.3), 0.02 + k * 0.002))
            r = rnd.uniform(0.22, 0.45)
            if all((p.xy - q.xy).length > r + rr for q, rr in spots):
                spots.append((p, r))
                break
    for p, r in spots:
        a = rnd.uniform(0, math.tau)
        rot = Matrix.Rotation(a, 3, 'Z')
        corners = [p + rot @ Vector((x * r, y * r, 0)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        pads.quad(corners, [(0, 0), (1, 0), (1, 1), (0, 1)], up)
    for p, r in spots[:flowers]:
        c = p + Vector((0, 0, 0.06))
        for k, a in enumerate((0.0, 0.5)):
            rot = Matrix.Rotation(a, 3, 'Z')
            s = 0.16 - 0.04 * k
            z = 0.02 * k
            corners = [c + rot @ Vector((x * s, y * s, z)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            bloom.quad(corners, [(0, 0), (1, 0), (1, 1), (0, 1)], up)
    export(name, [pads.to_object(name + '-pads'), bloom.to_object(name + '-flowers')])


def mushrooms(name, seed, cap_color, glow=None, scale=1.0, count=5):
    """A cluster of mushrooms: pale stems, domed caps (optionally glowing)"""
    clear_scene()
    rnd = random.Random(seed)
    stem = Part(flat_material('mushroom-stem', (0.82, 0.78, 0.68), 0.7), smooth=True)
    cap = Part(flat_material(name + '-cap', cap_color, 0.55, emission=glow, strength=0.6), smooth=True)
    gills = Part(flat_material('mushroom-gills', (0.55, 0.48, 0.4), 0.9))
    for k in range(count):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(0.0, 0.35) * scale if k else 0.0
        base = Vector((math.cos(a) * d, math.sin(a) * d, -0.02))
        h = scale * rnd.uniform(0.18, 0.4) * (1.4 if k == 0 else 1.0)
        r = h * rnd.uniform(0.55, 0.8)
        lean = Vector((rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1), 0)) * h
        top = base + Vector((0, 0, h)) + lean
        tube(stem, [base, base.lerp(top, 0.5), top], [r * 0.3, r * 0.22, r * 0.2], 7)
        profile = [(0.0, 1.0), (0.12, 0.95), (0.3, 0.75), (0.45, 0.45), (0.5, 0.0)]
        tube(cap, [top + Vector((0, 0, z * r * 1.1)) for z, _ in profile], [r * f for _, f in profile], 10)
        tube(gills, [top + Vector((0, 0, 0.001)), top + Vector((0, 0, -0.002))], [r * 0.98, r * 0.25], 10)
    export(name, [stem.to_object(name + '-stem'), cap.to_object(name + '-cap'), gills.to_object(name + '-gills')])


# ---------------------------------------------------------------- rocks, cliffs, crystals

def lump(part, center, size, seed, roughness=0.35, flat_top=None, flat_bottom=True, subdiv=3):
    """A noisy rock lump (icosphere displaced by noise), box-mapped by the part"""
    import bmesh
    from mathutils import noise
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=1.0)
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    for v in tmp.verts:
        n = v.co.normalized()
        d = 1.0 + roughness * noise.noise(n * 1.6 + off) + roughness * 0.4 * noise.noise(n * 4.0 + off)
        v.co = Vector((n.x * size.x, n.y * size.y, n.z * size.z)) * d
        if flat_bottom and v.co.z < -size.z * 0.3:
            v.co.z = -size.z * 0.3
        if flat_top is not None and v.co.z > size.z * flat_top:
            v.co.z = size.z * flat_top + 0.04 * size.z * noise.noise(v.co * 0.3 + off)
    bmesh.ops.translate(tmp, vec=center + Vector((0, 0, size.z * 0.3)), verts=tmp.verts)
    part.add_bmesh(tmp)
    tmp.free()


def rock_shape(name, asset, seed, pieces, tint=None, uv=3.0, subdiv=3):
    """Procedural rock formation from lumps: pieces = [(center, size, flat_top), ...]"""
    clear_scene()
    stone = Part(pbr_material('rock-' + asset + ('-tint' if tint else ''), asset, tint), uv_metres=uv)
    for k, (c, s, top) in enumerate(pieces):
        lump(stone, Vector(c), Vector(s), seed + k, flat_top=top, subdiv=subdiv)
    obj = stone.to_object(name)
    for p in obj.data.polygons:
        p.use_smooth = True
    export(name, [obj])
    if len(obj.data.polygons) > 1000:
        export_lod(name, obj, ratio=max(0.1, 400 / len(obj.data.polygons)))


def hoodoo(name, seed, height=12.0, asset='cliff_side'):
    """Sandstone pillar: stacked lumps narrowing upwards with a wider cap rock"""
    rnd = random.Random(seed)
    pieces = []
    z = 0.0
    n = 4
    for k in range(n):
        h = height / n * rnd.uniform(0.9, 1.1)
        r = (2.6 - 1.4 * k / n) * rnd.uniform(0.9, 1.1)
        pieces.append(((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), z), (r, r * rnd.uniform(0.85, 1.0), h * 0.75), None))
        z += h * 0.8
    pieces.append(((0, 0, z - 0.4), (2.2, 2.0, 1.2), 0.6))
    rock_shape(name, asset, seed, pieces, uv=4.0, subdiv=4)


def mesa(name, seed, radius=22.0, height=16.0, asset='cliff_side'):
    """Table mountain: a wide lump with a flat top and steep sides"""
    pieces = [((0, 0, -height * 0.15), (radius, radius * 0.8, height * 1.1), 0.62)]
    rock_shape(name, asset, seed, pieces, uv=8.0, subdiv=5)


def rock_arch(name, seed, span=14.0, height=10.0, asset='cliff_side'):
    """Natural arch: two legs and a lintel of lumps along a half ellipse"""
    rnd = random.Random(seed)
    pieces = []
    for k in range(13):
        t = k / 12 * math.pi
        x = -math.cos(t) * span / 2
        z = math.sin(t) * height * 0.82
        s = 3.0 if k in (0, 12) else 2.3
        pieces.append(((x, 0, max(0.0, z - s)), (s * rnd.uniform(0.9, 1.1), 2.0 * rnd.uniform(0.9, 1.1), s * 1.1), None))
    rock_shape(name, asset, seed, pieces, uv=4.0)


def stalagmites(name, seed, asset='rock_boulder_dry', count=4, height=4.0, hang=False):
    """A group of stone spikes (or icicle-like spikes when `hang`)"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('rock-' + asset, asset, (1.05, 1.0, 0.95)))
    for k in range(count):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(0.4, 1.6) if k else 0.0
        base = Vector((math.cos(a) * d, math.sin(a) * d, -0.2))
        h = height * rnd.uniform(0.4, 1.0) * (1.0 if k == 0 else 0.7)
        r = h * rnd.uniform(0.13, 0.18)
        pts = [base + Vector((rnd.uniform(-0.05, 0.05) * h * t, rnd.uniform(-0.05, 0.05) * h * t, h * t)) for t in (0, 0.2, 0.45, 0.7, 0.9, 1.0)]
        tube(stone, pts, [r * f for f in (1.0, 0.8, 0.6, 0.38, 0.18, 0.02)], 8)
    export(name, [stone.to_object(name)])


def crystals(name, seed, color, glow, count=7, height=2.2):
    """Crystal cluster: six-sided prisms with pointed tips fanning out of a rock base"""
    clear_scene()
    rnd = random.Random(seed)
    gem = Part(flat_material(name, color, 0.12, 0.1, emission=glow, strength=1.2))
    base = Part(pbr_material('rock-dark_rock', 'dark_rock'), uv_metres=2.0)
    lump(base, Vector((0, 0, -0.35)), Vector((0.9, 0.8, 0.5)), seed)
    for k in range(count):
        a = rnd.uniform(0, math.tau)
        tilt = rnd.uniform(0.0, 0.55) if k else rnd.uniform(0.0, 0.15)
        d = Vector((math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt)))
        h = height * rnd.uniform(0.45, 1.0) * (1.0 if k == 0 else 0.75)
        r = h * rnd.uniform(0.12, 0.17)
        start = Vector((math.cos(a) * 0.25, math.sin(a) * 0.25, -0.1)) * (1 if k else 0)
        pts = [start, start + d * h * 0.78, start + d * h]
        tube(gem, pts, [r, r * 0.92, 0.0], 6, smooth=False)
    export(name, [base.to_object(name + '-rock'), gem.to_object(name + '-gem')])


def basalt_columns(name, seed, count=12, height=5.0):
    """Hexagonal basalt columns of varying height, flat topped"""
    clear_scene()
    rnd = random.Random(seed)
    stone = Part(pbr_material('rock-dark_rock-cols', 'dark_rock', (1.5, 1.45, 1.4)), uv_metres=2.0)
    r = 0.6
    placed = 0
    for i in range(-2, 3):
        for j in range(-2, 3):
            if placed >= count or rnd.random() < 0.25:
                continue
            x = (i + 0.5 * (j % 2)) * r * 1.75
            y = j * r * 1.5
            h = height * rnd.uniform(0.35, 1.0) * (1.0 - 0.12 * math.hypot(i, j))
            tube(stone, [Vector((x, y, -0.4)), Vector((x, y, h))], [r, r], 6, smooth=False, cap=True)
            placed += 1
    obj = stone.to_object(name)
    from blender_kit import box_uv
    box_uv(obj, 2.0)
    export(name, [obj])


def lava_pool(name, seed, radius=4.0):
    """Glowing pool of molten rock with a crusted rim of dark rocks"""
    clear_scene()
    rnd = random.Random(seed)
    melt = Part(flat_material('lava-melt', (1.0, 0.35, 0.05), 0.4, emission=(1.0, 0.3, 0.03), strength=1.0))
    rim = Part(pbr_material('rock-dark_rock_02', 'dark_rock_02', (0.7, 0.66, 0.64)), uv_metres=2.0)
    bm = melt.bm
    n = 24
    centre = bm.verts.new((0, 0, 0.12))
    ring = [bm.verts.new((math.cos(a / n * math.tau) * radius * rnd.uniform(0.9, 1.05),
                          math.sin(a / n * math.tau) * radius * rnd.uniform(0.9, 1.05), 0.12)) for a in range(n)]
    for k in range(n):
        f = bm.faces.new((centre, ring[k], ring[(k + 1) % n]))
        for loop in f.loops:
            loop[melt.uv].uv = (loop.vert.co.x / radius, loop.vert.co.y / radius)
    for k in range(14):
        a = k / 14 * math.tau + rnd.uniform(-0.1, 0.1)
        rr = radius * rnd.uniform(0.95, 1.1)
        lump(rim, Vector((math.cos(a) * rr, math.sin(a) * rr, -0.25)),
             Vector((rnd.uniform(0.7, 1.2), rnd.uniform(0.6, 1.0), rnd.uniform(0.35, 0.6))), seed + k, subdiv=2)
    export(name, [melt.to_object(name + '-melt'), rim.to_object(name + '-rim')])


# ---------------------------------------------------------------- catalogue

def models():
    tint_sand = (1.15, 0.95, 0.72)
    dark = (0.36, 0.34, 0.33)

    def roots(wood, foliage, pts):
        stilt_roots(wood, random.Random(41), 8, 2.4, 1.8, 0.5)

    def dead_roots(wood, pts):
        stilt_roots(wood, random.Random(42), 6, 1.6, 1.2, 0.32)
        return []

    return {
        # Temperate and autumn broadleaves
        'tree-oak-autumn': lambda: broadleaf('tree-oak-autumn', 1, 12.0, 4.2, 0.42, 'bark_brown_02', 'leaves-oak-autumn'),
        'tree-street': lambda: broadleaf('tree-street', 41, 7.5, 2.4, 0.18, 'bark_platanus', 'leaves-maple', bark_tint=(0.9, 0.85, 0.8)),
        'tree-oak-young': lambda: broadleaf('tree-oak-young', 31, 7.0, 2.6, 0.24, 'bark_brown_02', 'leaves-oak'),
        'tree-maple': lambda: broadleaf('tree-maple', 21, 11.0, 3.9, 0.36, 'bark_brown_01', 'leaves-maple'),
        'tree-maple-autumn': lambda: broadleaf('tree-maple-autumn', 21, 11.0, 3.9, 0.36, 'bark_brown_01', 'leaves-maple-autumn'),
        'tree-maple-red': lambda: broadleaf('tree-maple-red', 22, 9.0, 3.4, 0.3, 'bark_brown_01', 'leaves-maple-autumn'),
        'tree-birch-autumn': lambda: broadleaf('tree-birch-autumn', 2, 13.0, 2.6, 0.18, 'bark_platanus', 'leaves-birch-autumn',
                                               bark_tint=(1.5, 1.5, 1.45), slender=True),
        'tree-willow': lambda: willow('tree-willow', 23),
        'tree-mangrove': lambda: broadleaf('tree-mangrove', 24, 10.0, 3.6, 0.5, 'bark_willow', 'leaves-swamp',
                                           bark_tint=(0.8, 0.82, 0.75), extra=roots),
        'tree-swamp-dead': lambda: dead_tree('tree-swamp-dead', 25, tint=(0.5, 0.52, 0.45), extra=dead_roots),
        'tree-dead-pale': lambda: dead_tree('tree-dead-pale', 26, tint=(2.2, 2.25, 2.3), bark='bark_platanus'),
        # Conifers with snow
        'tree-pine-snow': lambda: conifer('tree-pine-snow', 3, 17.0, 3.4, 0.4, 0.32, leaves='leaves-conifer-snow'),
        'tree-fir-snow': lambda: conifer('tree-fir-snow', 4, 13.0, 3.3, 0.08, 0.28, leaves='leaves-conifer-snow'),
        'tree-fir-young': lambda: conifer('tree-fir-young', 27, 6.0, 1.8, 0.05, 0.14),
        'tree-fir-young-snow': lambda: conifer('tree-fir-young-snow', 27, 6.0, 1.8, 0.05, 0.14, leaves='leaves-conifer-snow'),
        # Palms and desert
        'tree-palm': lambda: palm('tree-palm', 28),
        'tree-palm-tall': lambda: palm('tree-palm-tall', 29, height=12.0, lean=2.6),
        'tree-palm-dry': lambda: palm('tree-palm-dry', 30, height=8.0, lean=1.0, fronds='palm-frond-dry', count=10),
        'cactus': lambda: cactus('cactus', 32),
        'cactus-tall': lambda: cactus('cactus-tall', 33, height=7.5, arms=3),
        'cactus-barrel': lambda: barrel_cactus('cactus-barrel', 34),
        'tree-quiver': lambda: import_model('quiver_tree_01', 5.0, 3000, 'tree-quiver'),
        'tree-quiver-small': lambda: import_model('quiver_tree_02', 3.0, 3000, 'tree-quiver-small'),
        'tree-quiver-dead': lambda: import_model('dead_quiver_trunk', 2.2, 1500, 'tree-quiver-dead'),
        'desert-shrub': lambda: round_bush('desert-shrub', 65, 1.0, 1.1, 'leaves-dry'),
        'desert-tree': lambda: import_model('searsia_lucida', 3.4, 3000, 'desert-tree', objects=['searsia_lucida_a*']),
        'succulent': lambda: import_model('cheiridopsis_succulent', 0.45, 1500, 'succulent', objects=['cheiridopsis_succulent_h*']),
        'iceplant': lambda: import_model('crystalline_iceplant', 0.22, 1500, 'iceplant', objects=['crystalline_iceplant_a*']),
        'flower-gazania': lambda: import_model('flower_gazania', 0.4, 1200, 'flower-gazania', objects=['flower_gazania_h*']),
        'flower-ursinia': lambda: import_model('flower_ursinia', 0.4, 1500, 'flower-ursinia', objects=['flower_ursinia_a*']),
        # Shrubs, hedges, ground plants
        'shrub': lambda: round_bush('shrub', 66, 1.2, 1.6, 'leaves-bush'),
        'shrub-wide': lambda: round_bush('shrub-wide', 67, 1.9, 1.5, 'leaves-oak'),
        'bush-maple-autumn': lambda: round_bush('bush-maple-autumn', 35, 1.4, 1.8, 'leaves-maple-autumn'),
        'bush-ivy': lambda: round_bush('bush-ivy', 36, 1.2, 1.4, 'leaves-ivy'),
        'hedge': lambda: hedge('hedge', 37),
        'hedge-long': lambda: hedge('hedge-long', 38, length=6.0),
        'nettles': lambda: import_model('nettle_plant', 0.7, 1500, 'nettles', objects=['nettle_plant_tall_a*']),
        'periwinkle': lambda: import_model('periwinkle_plant', None, 1500, 'periwinkle', objects=['periwinkle_plant_01*'], keep_scale=True),
        'grass-green': lambda: grass('grass-green', 'grass-green.png', 1.2, 0.6, 39),
        'grass-tall-dry': lambda: grass('grass-tall-dry', 'grass-dry.png', 1.2, 0.7, 40),
        'grass-autumn': lambda: grass('grass-autumn', 'grass-autumn.png', 1.2, 0.6, 41),
        'grass-snow': lambda: grass('grass-snow', 'grass-snow.png', 1.0, 0.45, 42),
        'grass-swamp': lambda: grass('grass-swamp', 'grass-swamp.png', 1.3, 0.9, 43),
        'reeds': lambda: grass('reeds', 'reeds.png', 1.4, 1.9, 44, cards=7),
        'wheat-field': lambda: field_patch('wheat-field', 'wheat.png', 4.0, 1.0, 45),
        'reed-bed': lambda: field_patch('reed-bed', 'reeds.png', 4.0, 1.9, 46, rows=3),
        'flowers-red': lambda: grass('flowers-red', 'flowers-red.png', 1.0, 0.5, 47),
        'flowers-blue': lambda: grass('flowers-blue', 'flowers-blue.png', 1.0, 0.5, 48),
        'flowers-yellow': lambda: grass('flowers-yellow', 'flowers-yellow.png', 1.0, 0.5, 49),
        'lily-pads': lambda: lily_pads('lily-pads', 50),
        'mushrooms': lambda: mushrooms('mushrooms', 51, (0.55, 0.36, 0.2)),
        'mushrooms-red': lambda: mushrooms('mushrooms-red', 52, (0.75, 0.08, 0.05)),
        'mushrooms-glow': lambda: mushrooms('mushrooms-glow', 53, (0.25, 0.6, 0.7), glow=(0.2, 0.75, 0.9)),
        'mushroom-giant': lambda: mushrooms('mushroom-giant', 54, (0.42, 0.26, 0.48), glow=(0.45, 0.2, 0.75), scale=6.0, count=3),
        # Deadwood
        'stump-old': lambda: import_model('tree_stump_01', None, 1500, 'stump-old', keep_scale=True),
        'stump-mossy': lambda: import_model('tree_stump_02', None, 1500, 'stump-mossy', keep_scale=True),
        'log-fallen': lambda: import_model('dead_tree_trunk_02', None, 1500, 'log-fallen', keep_scale=True),
        'roots': lambda: import_model('pine_roots', None, 1500, 'roots', objects=['pine_roots_a'], keep_scale=True),
        'branches': lambda: import_model('dry_branches_medium_01', None, 1200, 'branches', keep_scale=True),
        # Rocks per stone type
        'boulder': lambda: import_model('boulder_01', 1.4, 1500, 'boulder', desaturate=0.4, ground=True),
        'rock-granite': lambda: import_model('rock_07', 1.8, 1500, 'rock-granite', ground=True),
        'rock-granite-flat': lambda: import_model('rock_09', 1.2, 1500, 'rock-granite-flat', ground=True),
        'rock-round': lambda: import_model('stone_01', 0.9, 1200, 'rock-round', ground=True),
        'rock-desert': lambda: import_model('namaqualand_boulder_03', 1.8, 1500, 'rock-desert', ground=True),
        'rock-desert-large': lambda: import_model('namaqualand_boulder_06', 3.2, 2000, 'rock-desert-large', ground=True),
        'rock-sandstone': lambda: import_model('namaqualand_boulder_05', 2.2, 1500, 'rock-sandstone', tint=tint_sand, desaturate=0.5, ground=True),
        'rock-sandstone-large': lambda: import_model('namaqualand_boulder_02', 3.5, 2000, 'rock-sandstone-large', tint=tint_sand, desaturate=0.5, ground=True, close=True),
        'rock-basalt': lambda: import_model('namaqualand_boulder_03', 1.6, 1500, 'rock-basalt', tint=dark, desaturate=0.9, ground=True),
        'rock-basalt-large': lambda: import_model('namaqualand_boulder_06', 3.0, 2000, 'rock-basalt-large', tint=dark, desaturate=0.9, ground=True),
        'rock-snow': lambda: import_model('namaqualand_boulder_05', 2.0, 1500, 'rock-snow', tint=(1.3, 1.33, 1.38), desaturate=1.0, ground=True),
        'rock-volcanic': lambda: import_model('moon_rock_03', 1.2, 1500, 'rock-volcanic', tint=(0.42, 0.38, 0.36), ground=True),
        'rock-volcanic-large': lambda: import_model('moon_rock_05', 2.4, 2000, 'rock-volcanic-large', tint=(0.42, 0.38, 0.36), ground=True),
        'rock-pumice': lambda: import_model('moon_rock_01', 0.8, 1500, 'rock-pumice', objects=['moon_rock_01_LOD0'], tint=(0.7, 0.66, 0.62), ground=True),
        'rock-mossy-a': lambda: import_model('rock_moss_set_01', None, 1800, 'rock-mossy-a', objects=['rock_moss_set_01_rock01'], keep_scale=True, ground=True),
        'rock-mossy-b': lambda: import_model('rock_moss_set_01', None, 1800, 'rock-mossy-b', objects=['rock_moss_set_01_rock04'], keep_scale=True, ground=True),
        'rock-mossy-c': lambda: import_model('rock_moss_set_01', None, 1800, 'rock-mossy-c', objects=['rock_moss_set_01_rock05'], keep_scale=True, ground=True),
        'rock-mossy-flat': lambda: import_model('rock_moss_set_02', None, 1500, 'rock-mossy-flat', objects=['rock_moss_set_02_rock10'], keep_scale=True, ground=True),
        'stones': lambda: import_model('namaqualand_stones_01', 0.35, 1500, 'stones', ground=True),
        'rock-coast': lambda: import_model('coast_rocks_01', None, 3000, 'rock-coast', keep_scale=True, ground=True),
        # Cliff pieces (modular: stand them in a row or a ring against a slope), toned to one grey: the Cliff rocks
        # brush mixes them
        'cliff-face': lambda: import_model('rock_face_01', 8.0, 4000, 'cliff-face', desaturate=0.5, ground=True, close=True),
        'cliff-face-b': lambda: import_model('rock_face_02', 9.0, 4000, 'cliff-face-b', desaturate=0.5, ground=True, close=True),
        'cliff-wall': lambda: import_model('namaqualand_cliff_01', 10.0, 5000, 'cliff-wall', desaturate=0.5, ground=True, close=True),
        'cliff-wall-b': lambda: import_model('namaqualand_cliff_02', 12.0, 6000, 'cliff-wall-b', desaturate=0.5, ground=True, close=True),
        'cliff-wall-sandstone': lambda: import_model('namaqualand_cliff_01', 10.0, 5000, 'cliff-wall-sandstone', tint=tint_sand, desaturate=0.5, ground=True, close=True),
        'cliff-wall-basalt': lambda: import_model('namaqualand_cliff_02', 12.0, 6000, 'cliff-wall-basalt', tint=dark, desaturate=0.9, ground=True, close=True),
        'cliff-coast': lambda: import_model('coastal_cliff_02', None, 6000, 'cliff-coast', keep_scale=True, ground=True, close=True),
        # Formations built from rock surfaces
        'sandstone-pillar': lambda: hoodoo('sandstone-pillar', 55),
        'sandstone-pillar-tall': lambda: hoodoo('sandstone-pillar-tall', 56, height=20.0),
        'mesa': lambda: mesa('mesa', 57),
        'rock-arch': lambda: rock_arch('rock-arch', 58),
        'stalagmites': lambda: stalagmites('stalagmites', 59),
        'basalt-columns': lambda: basalt_columns('basalt-columns', 60),
        'crystals-blue': lambda: crystals('crystals-blue', 61, (0.35, 0.6, 0.95), (0.2, 0.45, 1.0)),
        'crystals-violet': lambda: crystals('crystals-violet', 62, (0.6, 0.35, 0.9), (0.55, 0.2, 1.0)),
        'crystals-ice': lambda: crystals('crystals-ice', 63, (0.8, 0.92, 1.0), None, height=3.0),
        'lava-pool': lambda: lava_pool('lava-pool', 64),
    }
