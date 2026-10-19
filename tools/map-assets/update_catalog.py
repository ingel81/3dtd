"""Writes the objects of public/maps/assets/catalog.json from objects.json.

    python -I tools/map-assets/update_catalog.py <glb-raw-dir> public/maps/assets

objects.json lists every object with what only a person can decide (name,
category, tags, licence source and, where the default does not fit,
placement flags). Missing fields come from the category defaults below;
footprint and height come from the measured bounds in <glb-raw-dir>/report.json
(pack_models.py) unless objects.json sets them; the underside of rocks (`base`)
from bases.json (measure_bases.mjs), the ground rectangle of buildings and walls
(`box`) from boxes.json (measure_boxes.mjs), the top surface of what carries a tower (`roof`) from roofs.json
(measure_roofs.mjs), the far stage of buildings (`far`) from farboxes.json (bake_far_boxes.mjs); the triangle counts from the packed models
(count_triangles.py). Objects <glb-raw-dir> has not measured (a build of a few
models) keep their measured fields from the current catalog.json.
First it runs tools/model-pack/pack-map-models.mjs over all models (a model
still with images of its own gets the shared KTX2 textures, files no model
names any more go), then writes per model file the shared textures it names
(`textures`, also per `lod` entry): the game fetches them beside the GLB.
Needs the ktx tool in KTX_TOOL. Also rewrites LICENSES.md.
"""
import json
import math
import os
import posixpath
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = os.path.join(HERE, '..', 'model-pack')

DEFAULTS = {
    'tree': {'blocksLos': True, 'blocksBuild': True, 'scaleRange': [0.8, 1.2], 'randomRotation': True, 'wind': 0.5, 'drawDistance': 2500},
    'plant': {'blocksLos': False, 'blocksBuild': False, 'scaleRange': [0.7, 1.3], 'randomRotation': True, 'wind': 0.6, 'drawDistance': 300},
    'rock': {'blocksLos': False, 'blocksBuild': True, 'scaleRange': [0.7, 1.4], 'randomRotation': True, 'wind': 0, 'drawDistance': 800},
    'building': {'blocksLos': True, 'blocksBuild': True, 'scaleRange': [1, 1], 'randomRotation': False, 'wind': 0, 'drawDistance': 3000},
    'wall': {'blocksLos': True, 'blocksBuild': True, 'scaleRange': [1, 1], 'randomRotation': False, 'wind': 0, 'drawDistance': 1500},
    'prop': {'blocksLos': False, 'blocksBuild': True, 'scaleRange': [0.9, 1.1], 'randomRotation': True, 'wind': 0, 'drawDistance': 500},
    'structure': {'blocksLos': False, 'blocksBuild': False, 'scaleRange': [1, 1], 'randomRotation': False, 'wind': 0, 'drawDistance': 3000},
    'fx': {'blocksLos': False, 'blocksBuild': False, 'scaleRange': [0.7, 1.5], 'randomRotation': True, 'wind': 0, 'drawDistance': 1500},
}
# Share of the half extent that counts as occupied ground (a crown overhangs, a trunk does not)
FOOTPRINT_SHARE = {'tree': 0.3, 'plant': 0.6}
# The builders' LOD copies take over at this camera distance (small plants at 0.4 of their draw distance) for an
# object of the asset's size at scale 1. The catalogue keeps it as the share of the screen's height the object
# fills there (`screen`): a smaller object switches nearer, a bigger one farther (object-layer.ts)
LOD_DISTANCE = 350
# Buildings take their LOD model nearer: from afar their box stands for them (FAR_SCREEN)
BUILDING_LOD_DISTANCE = 140
# Half the vertical field of view of the game camera (60 degrees), as object-layer.ts LOD_TAN_HALF_FOV
TAN_HALF_FOV = math.tan(math.radians(30))
# A building's box (objects/far-boxes.ts) takes over where it fills less than this share of the screen's height
FAR_SCREEN = 0.045
# Trees with a hand-built far copy (objects.json lodSharesTextures) take it nearer: the impostor keeps its distance
# (render-quality impostorFrom), the copy halves the triangles of the trees before it instead of holding the impostor
# back (which drew a million triangles more on Demo Valley)
TREE_LOD_DISTANCE = 175
ORDER = ['id', 'name', 'category', 'file', 'footprint', 'height', 'base', 'box', 'roof', 'blocksLos', 'blocksBuild', 'scaleRange',
         'randomRotation', 'wind', 'drawDistance', 'float', 'aloft', 'stilts', 'roadThrough', 'groundCut', 'spin', 'rotor', 'cable', 'grip', 'variants', 'signPanel', 'grime', 'tags', 'effects', 'light', 'textures', 'lod', 'far', 'source']


def lod_screen(e, distance):
    """The screen share at which an object of entry `e` at scale 1 is `distance` metres away: its bounding radius as
    object-layer.ts writeInstance takes it, over the half height of the view there"""
    radius = max(e['footprint'], e['height'] * 0.6)
    return round(radius / (distance * TAN_HALF_FOV), 4)


def shared_textures(out, file):
    """The shared texture files a packed model names (images with a URI), as catalogue paths"""
    with open(os.path.join(out, file), 'rb') as f:
        data = f.read()
    length = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    folder = posixpath.dirname(file)
    return sorted({posixpath.normpath(posixpath.join(folder, im['uri'])) for im in gltf.get('images', []) if 'uri' in im})


def main():
    raw, out = sys.argv[1], sys.argv[2]
    subprocess.run(['node', os.path.join(PACK, 'pack-map-models.mjs'), out], check=True)
    spec = json.load(open(os.path.join(HERE, 'objects.json'), encoding='utf8'))
    report = json.load(open(os.path.join(raw, 'report.json'), encoding='utf8'))
    bases = json.load(open(os.path.join(HERE, 'bases.json'), encoding='utf8'))
    boxes = json.load(open(os.path.join(HERE, 'boxes.json'), encoding='utf8'))
    roofs = json.load(open(os.path.join(HERE, 'roofs.json'), encoding='utf8'))
    farboxes = json.load(open(os.path.join(HERE, 'farboxes.json'), encoding='utf8'))
    path = os.path.join(out, 'catalog.json')
    catalog = json.load(open(path, encoding='utf8'))
    current = {o['id']: o for o in catalog['objects']}
    objects = []
    for o in spec:
        # Effect-only entries (`"file": ""` in objects.json) have no model; they need footprint and height
        e = {'file': f'models/{o["id"]}.glb', **DEFAULTS[o['category']], **o}
        if e['file'] == '':
            objects.append({k: e[k] for k in ORDER if k in e})
            continue
        e.pop('textureSize', None)
        e.pop('textureCodec', None)
        m = report.get(o['id'])
        # Not built this time (a build of a few models): the measured fields stay as the catalogue has them
        kept = current.get(o['id']) if m is None else None
        if m is None and kept is None and ('footprint' not in o or 'height' not in o):
            raise SystemExit(f'{o["id"]}: not measured, run pack_models.py first')
        if 'height' not in o:
            e['height'] = kept['height'] if kept else round(m['max'][1], 1)
        if 'footprint' not in o:
            if kept:
                e['footprint'] = kept['footprint']
            else:
                half = max(m['max'][0] - m['min'][0], m['max'][2] - m['min'][2]) / 2
                e['footprint'] = round(max(0.2, half * FOOTPRINT_SHARE.get(o['category'], 0.9)), 1)
        if o['id'] in bases:
            e['base'] = bases[o['id']]
        if o['id'] in boxes:
            e['box'] = boxes[o['id']]
        if o['id'] in roofs:
            e['roof'] = roofs[o['id']]
        if e['category'] == 'rock' and 'blocksLos' not in o:
            e['blocksLos'] = e['height'] >= 1.8
        if 'drawDistance' not in o and e['category'] in ('rock', 'prop') and e['height'] >= 3:
            e['drawDistance'] = 2500
        lod_file = os.path.join(out, 'models', o['id'] + '-lod1.glb')
        if 'lod' not in o and (o['id'] + '-lod1' in report or (not (kept and 'lod' in kept) and os.path.exists(lod_file))):
            # Decimated copy from the builders (export_lod) or make_far_lods.mjs; small plants vanish at their draw distance:
            # switch well before that
            distance = BUILDING_LOD_DISTANCE if e['category'] == 'building' else TREE_LOD_DISTANCE if o.get('lodSharesTextures') else LOD_DISTANCE
            e['lod'] = [{'file': f'models/{o["id"]}-lod1.glb', 'screen': lod_screen(e, min(distance, round(e['drawDistance'] * 0.4)))}]
        elif kept and 'lod' in kept and 'lod' not in o:
            e['lod'] = kept['lod']
        if o['id'] in farboxes:
            e['far'] = {'screen': FAR_SCREEN, **farboxes[o['id']]}
        if os.path.exists(os.path.join(out, e['file'])):
            textures = shared_textures(out, e['file'])
            if textures:
                e['textures'] = textures
            for level in e.get('lod', []):
                level.pop('textures', None)
                lod_textures = shared_textures(out, level['file']) if os.path.exists(os.path.join(out, level['file'])) else []
                if lod_textures:
                    level['textures'] = lod_textures
        objects.append({k: e[k] for k in ORDER if k in e})
    taken = {m['id'] for m in catalog['materials']}
    for o in objects:
        if o['id'] in taken:
            raise SystemExit(f'{o["id"]}: id used twice (materials and objects share one id space)')
        taken.add(o['id'])
    catalog['objects'] = objects
    with open(path, 'w', encoding='utf8', newline='\n') as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write('\n')
    subprocess.run([sys.executable, '-I', os.path.join(HERE, 'count_triangles.py'), out], check=True)
    subprocess.run([sys.executable, '-I', os.path.join(HERE, 'write_licenses.py'), out], check=True)
    print(len(objects), 'objects', file=sys.stderr)


main()
