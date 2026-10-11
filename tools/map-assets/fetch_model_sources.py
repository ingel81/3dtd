"""Downloads the CC0 sources of the map object models (Poly Haven).

    python -I tools/map-assets/fetch_model_sources.py <download-dir>

Textures (1k: diff, nor_gl, arm) for the procedural models and the glTF
models used as they are (rocks, fern, barrel). Blender reads them from the
download dir (build_models.py).
"""
import json
import os
import sys
import urllib.request

TEXTURES = [
    'bark_brown_02', 'knotted_pine_bark', 'bark_platanus', 'clay_plaster', 'grey_plaster_02',
    'medieval_wood', 'clay_roof_tiles_02', 'grey_roof_tiles', 'castle_wall_slates', 'brown_planks_07',
    'brown_planks_04', 'castle_brick_07', 'stacked_stone_wall', 'dark_planks', 'rough_wood',
]
MODELS = ['namaqualand_boulder_02', 'namaqualand_boulder_04', 'fern_02', 'Barrel_01', 'dead_tree_trunk']


def get(url, path):
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers={'User-Agent': '3dtd-map-assets'})
    with urllib.request.urlopen(req) as r, open(path, 'wb') as f:
        f.write(r.read())


def api(asset):
    req = urllib.request.Request(f'https://api.polyhaven.com/files/{asset}', headers={'User-Agent': '3dtd-map-assets'})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def main():
    dl = sys.argv[1]
    for t in TEXTURES:
        files = api(t)
        for key in ('Diffuse', 'nor_gl', 'arm'):
            url = files[key]['1k']['jpg']['url']
            get(url, os.path.join(dl, 'textures', t, os.path.basename(url)))
        print('texture', t, file=sys.stderr)
    for m in MODELS:
        g = api(m)['gltf']['1k']['gltf']
        base = os.path.join(dl, 'models', m)
        get(g['url'], os.path.join(base, os.path.basename(g['url'])))
        for rel, inc in g['include'].items():
            get(inc['url'], os.path.join(base, rel))
        print('model', m, file=sys.stderr)


main()
