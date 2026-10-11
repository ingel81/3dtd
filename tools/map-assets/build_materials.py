"""Downloads the CC0 ground materials listed in materials.json and packs them
for the custom map renderer.

    python -I tools/map-assets/build_materials.py <download-dir> <out-dir> [<id> ...]

Writes per material <out-dir>/materials/<id>/color.jpg, normal.jpg and
arh.jpg (AO in red, roughness in green, height in blue), all 1024 px, plus
emissive.jpg for glowing materials (lava), and replaces the materials of
<out-dir>/catalog.json with the entries (with the average colour). Ids on
the command line rebuild only those files; the catalogue is always written
whole. `tint` (RGB multiplier) and `desaturate` (0..1) in materials.json
adjust the albedo, e.g. to turn a greenish ice scan blue.
Sources: Poly Haven (polyhaven.com) and ambientCG (ambientcg.com), both CC0.
"""
import io
import json
import os
import sys
import urllib.request
import zipfile

import numpy as np
from PIL import Image, ImageOps

SIZE = 1024
HERE = os.path.dirname(os.path.abspath(__file__))


def fetch(url, path):
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={'User-Agent': '3dtd-map-assets'})
        with urllib.request.urlopen(req) as r, open(path, 'wb') as f:
            f.write(r.read())
    return path


def polyhaven(asset, dl):
    """Maps by the file list of the Poly Haven API: not every set has separate AO or roughness, `arm` packs both"""
    listing = os.path.join(dl, f'{asset}.json')
    fetch(f'https://api.polyhaven.com/files/{asset}', listing)
    files = json.load(open(listing, encoding='utf8'))
    maps = {}

    def get(key, name):
        if name not in files:
            return None
        url = files[name]['1k']['jpg']['url']
        return Image.open(fetch(url, os.path.join(dl, os.path.basename(url))))

    maps['color'] = get('color', 'Diffuse')
    maps['normal'] = get('normal', 'nor_gl')
    maps['height'] = get('height', 'Displacement')
    arm = get('arm', 'arm')
    ao = get('ao', 'AO')
    rough = get('rough', 'Rough')
    if arm is not None:
        r, g, _ = arm.convert('RGB').split()
        ao = ao or r
        rough = rough or g
    maps['ao'] = ao
    maps['rough'] = rough
    return maps


def ambientcg(asset, dl):
    z = zipfile.ZipFile(fetch(f'https://ambientcg.com/get?file={asset}_1K-JPG.zip', os.path.join(dl, f'{asset}.zip')))
    names = z.namelist()

    def get(tag):
        name = next((n for n in names if n.endswith(f'_{tag}.jpg')), None)
        return Image.open(io.BytesIO(z.read(name))) if name else None

    return {
        'color': get('Color'),
        'normal': get('NormalGL'),
        'ao': get('AmbientOcclusion'),
        'rough': get('Roughness'),
        'height': get('Displacement'),
        'emission': get('Emission'),
    }


def gray(img, fallback):
    if img is None:
        return Image.new('L', (SIZE, SIZE), fallback)
    return img.convert('L').resize((SIZE, SIZE), Image.LANCZOS)


def adjust(color, m):
    """Optional albedo tweaks from materials.json: desaturate, then tint"""
    if not m.get('desaturate') and not m.get('tint'):
        return color
    arr = np.asarray(color).astype(np.float32)
    if m.get('desaturate'):
        g = arr @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
        arr = arr * (1 - m['desaturate']) + g[..., None] * m['desaturate']
    if m.get('tint'):
        arr = arr * np.array(m['tint'], dtype=np.float32)
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGB')


def build(m, dl, out):
    maps = polyhaven(m['asset'], dl) if m['source'] == 'polyhaven' else ambientcg(m['asset'], dl)
    target = os.path.join(out, 'materials', m['id'])
    os.makedirs(target, exist_ok=True)
    color = adjust(maps['color'].convert('RGB').resize((SIZE, SIZE), Image.LANCZOS), m)
    color.save(os.path.join(target, 'color.jpg'), quality=88, optimize=True)
    maps['normal'].convert('RGB').resize((SIZE, SIZE), Image.LANCZOS).save(
        os.path.join(target, 'normal.jpg'), quality=85, optimize=True)
    # Height stretched to the full range: the blend compares heights across materials
    height = ImageOps.autocontrast(gray(maps['height'], 128), cutoff=1)
    Image.merge('RGB', (gray(maps['ao'], 255), gray(maps['rough'], 220), height)).save(
        os.path.join(target, 'arh.jpg'), quality=85, optimize=True)
    if m.get('emissive') and maps.get('emission') is not None:
        maps['emission'].convert('RGB').resize((SIZE, SIZE), Image.LANCZOS).save(
            os.path.join(target, 'emissive.jpg'), quality=88, optimize=True)


def entry(m, out):
    target = os.path.join(out, 'materials', m['id'])
    color = Image.open(os.path.join(target, 'color.jpg')).convert('RGB')
    avg = color.resize((1, 1), Image.BOX).getpixel((0, 0))
    url = (f'https://polyhaven.com/a/{m["asset"]}' if m['source'] == 'polyhaven'
           else f'https://ambientcg.com/view?id={m["asset"]}')
    files = {f: f'materials/{m["id"]}/{f}.jpg' for f in ('color', 'normal', 'arh')}
    e = {'id': m['id'], 'name': m['name'], 'category': m['category'], 'files': files}
    if os.path.exists(os.path.join(target, 'emissive.jpg')):
        files['emissive'] = f'materials/{m["id"]}/emissive.jpg'
        e['emissive'] = m['emissive']
    e.update({'scale': m['scale'], 'average': '#%02x%02x%02x' % avg})
    if m.get('tags'):
        e['tags'] = m['tags']
    e['source'] = url
    return e


def main():
    dl, out, only = sys.argv[1], sys.argv[2], set(sys.argv[3:])
    os.makedirs(dl, exist_ok=True)
    entries = []
    for m in json.load(open(os.path.join(HERE, 'materials.json'), encoding='utf8')):
        if not only or m['id'] in only:
            build(m, dl, out)
            print(m['id'], 'ok', file=sys.stderr)
        entries.append(entry(m, out))
    path = os.path.join(out, 'catalog.json')
    catalog = json.load(open(path, encoding='utf8'))
    catalog['materials'] = entries
    with open(path, 'w', encoding='utf8', newline='\n') as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write('\n')


main()
