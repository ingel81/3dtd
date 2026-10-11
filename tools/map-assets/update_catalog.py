"""Writes the objects of public/maps/assets/catalog.json from objects.json.

    python -I tools/map-assets/update_catalog.py <glb-raw-dir> public/maps/assets

objects.json lists every object with what only a person can decide (name,
category, tags, licence source and, where the default does not fit,
placement flags). Missing fields come from the category defaults below;
footprint and height come from the measured bounds in <glb-raw-dir>/report.json
(pack_models.py) unless objects.json sets them. Also rewrites LICENSES.md.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

DEFAULTS = {
    'tree': {'blocksLos': True, 'blocksBuild': True, 'scaleRange': [0.8, 1.2], 'randomRotation': True, 'wind': 0.5, 'drawDistance': 2500},
    'plant': {'blocksLos': False, 'blocksBuild': False, 'scaleRange': [0.7, 1.3], 'randomRotation': True, 'wind': 0.6, 'drawDistance': 300},
    'rock': {'blocksLos': False, 'blocksBuild': True, 'scaleRange': [0.7, 1.4], 'randomRotation': True, 'wind': 0, 'drawDistance': 800},
    'building': {'blocksLos': True, 'blocksBuild': True, 'scaleRange': [1, 1], 'randomRotation': False, 'wind': 0, 'drawDistance': 3000},
    'wall': {'blocksLos': True, 'blocksBuild': True, 'scaleRange': [1, 1], 'randomRotation': False, 'wind': 0, 'drawDistance': 1500},
    'prop': {'blocksLos': False, 'blocksBuild': True, 'scaleRange': [0.9, 1.1], 'randomRotation': True, 'wind': 0, 'drawDistance': 500},
}
# Share of the half extent that counts as occupied ground (a crown overhangs, a trunk does not)
FOOTPRINT_SHARE = {'tree': 0.3, 'plant': 0.6}
ORDER = ['id', 'name', 'category', 'file', 'footprint', 'height', 'blocksLos', 'blocksBuild', 'scaleRange',
         'randomRotation', 'wind', 'drawDistance', 'tags', 'source']


def main():
    raw, out = sys.argv[1], sys.argv[2]
    spec = json.load(open(os.path.join(HERE, 'objects.json'), encoding='utf8'))
    report = json.load(open(os.path.join(raw, 'report.json'), encoding='utf8'))
    objects = []
    for o in spec:
        e = {'file': f'models/{o["id"]}.glb', **DEFAULTS[o['category']], **o}
        e.pop('textureSize', None)
        m = report.get(o['id'])
        if m is None and ('footprint' not in o or 'height' not in o):
            raise SystemExit(f'{o["id"]}: not measured, run pack_models.py first')
        if 'height' not in o:
            e['height'] = round(m['max'][1], 1)
        if 'footprint' not in o:
            half = max(m['max'][0] - m['min'][0], m['max'][2] - m['min'][2]) / 2
            e['footprint'] = round(max(0.2, half * FOOTPRINT_SHARE.get(o['category'], 0.9)), 1)
        if e['category'] == 'rock' and 'blocksLos' not in o:
            e['blocksLos'] = e['height'] >= 1.8
        if 'drawDistance' not in o and e['category'] in ('rock', 'prop') and e['height'] >= 3:
            e['drawDistance'] = 2500
        objects.append({k: e[k] for k in ORDER if k in e})
    path = os.path.join(out, 'catalog.json')
    catalog = json.load(open(path, encoding='utf8'))
    taken = {m['id'] for m in catalog['materials']}
    for o in objects:
        if o['id'] in taken:
            raise SystemExit(f'{o["id"]}: id used twice (materials and objects share one id space)')
        taken.add(o['id'])
    catalog['objects'] = objects
    with open(path, 'w', encoding='utf8', newline='\n') as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write('\n')
    subprocess.run([sys.executable, '-I', os.path.join(HERE, 'write_licenses.py'), out], check=True)
    print(len(objects), 'objects', file=sys.stderr)


main()
