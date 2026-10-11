"""Downloads the CC0 ground materials listed in materials.json and packs them
for the custom map renderer.

    python -I tools/map-assets/build_materials.py <download-dir> <out-dir>

Writes per material <out-dir>/materials/<id>/color.jpg, normal.jpg and
arh.jpg (AO in red, roughness in green, height in blue), all 1024 px, and
prints the catalogue entries (with the average colour) as JSON on stdout.
Sources: Poly Haven (polyhaven.com) and ambientCG (ambientcg.com), both CC0.
"""
import io
import json
import os
import sys
import urllib.request
import zipfile

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
    base = f'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/{asset}/{asset}'
    maps = {}
    for key, suffix in [('color', 'diff'), ('normal', 'nor_gl'), ('ao', 'ao'), ('rough', 'rough'), ('height', 'disp')]:
        maps[key] = Image.open(fetch(f'{base}_{suffix}_1k.jpg', os.path.join(dl, f'{asset}_{suffix}.jpg')))
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
    }


def gray(img, fallback):
    if img is None:
        return Image.new('L', (SIZE, SIZE), fallback)
    return img.convert('L').resize((SIZE, SIZE), Image.LANCZOS)


def main():
    dl, out = sys.argv[1], sys.argv[2]
    os.makedirs(dl, exist_ok=True)
    entries = []
    for m in json.load(open(os.path.join(HERE, 'materials.json'), encoding='utf8')):
        maps = polyhaven(m['asset'], dl) if m['source'] == 'polyhaven' else ambientcg(m['asset'], dl)
        target = os.path.join(out, 'materials', m['id'])
        os.makedirs(target, exist_ok=True)
        color = maps['color'].convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
        color.save(os.path.join(target, 'color.jpg'), quality=88, optimize=True)
        maps['normal'].convert('RGB').resize((SIZE, SIZE), Image.LANCZOS).save(
            os.path.join(target, 'normal.jpg'), quality=92, optimize=True)
        # Height stretched to the full range: the blend compares heights across materials
        height = ImageOps.autocontrast(gray(maps['height'], 128), cutoff=1)
        Image.merge('RGB', (gray(maps['ao'], 255), gray(maps['rough'], 220), height)).save(
            os.path.join(target, 'arh.jpg'), quality=90, optimize=True)
        avg = color.resize((1, 1), Image.BOX).getpixel((0, 0))
        url = (f'https://polyhaven.com/a/{m["asset"]}' if m['source'] == 'polyhaven'
               else f'https://ambientcg.com/view?id={m["asset"]}')
        entries.append({
            'id': m['id'],
            'name': m['name'],
            'category': m['category'],
            'files': {f: f'materials/{m["id"]}/{f}.jpg' for f in ('color', 'normal', 'arh')},
            'scale': m['scale'],
            'average': '#%02x%02x%02x' % avg,
            'source': url,
        })
        print(m['id'], 'ok', file=sys.stderr)
    json.dump(entries, sys.stdout, indent=2)


main()
