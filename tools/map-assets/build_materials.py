"""Downloads the CC0 ground materials listed in materials.json and packs them
for the custom map renderer.

    python -I tools/map-assets/build_materials.py <download-dir> <out-dir> [<id> ...]

Writes per material <out-dir>/materials/<id>/color.jpg, normal.jpg and
arh.jpg (AO in red, roughness in green, height in blue), all 1024 px, plus
emissive.jpg for glowing materials (lava), and replaces the materials of
<out-dir>/catalog.json with the entries (with the average colour) and
rewrites LICENSES.md. Ids on
the command line rebuild only those files; the catalogue is always written
whole. `tint` (RGB multiplier) and `desaturate` (0..1) in materials.json
adjust the albedo, e.g. to turn a greenish ice scan blue; `shade` (0..1)
darkens the albedo in the hollows of the height map (flat lunar dust).
Sources: Poly Haven (polyhaven.com) and ambientCG (ambientcg.com), both CC0, and
`baked`: a ground built from geometry in Blender (bake_grounds.py, recipes in
ground_recipes.py), read from <download-dir>/grounds/<id>/ (bake it first); `target` (hex) is
the mean colour it is brought to (calibrate).
"""
import io
import json
import os
import subprocess
import sys
import urllib.request
import zipfile

import numpy as np
from PIL import Image, ImageFilter, ImageOps

SIZE = 1024
# Root mean square of a normal map's x and y the bakes are scaled to: about what the scans of grass, sand and soil show
NORMAL_RMS = 0.25
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
    if img.mode in ('I;16', 'I;16B', 'I'):
        # 16-bit bakes (height): to 8 bit without clipping
        img = Image.fromarray((np.asarray(img, dtype=np.float32) / 257).clip(0, 255).astype(np.uint8), 'L')
    return img.convert('L').resize((SIZE, SIZE), Image.LANCZOS)


def linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def calibrate(color, target):
    """Brings a bake's mean colour to `target` (hex): its brightness fully, its hue half way, in linear light.
    The maps, their lighting and their grade were tuned against the scans these bakes replace: a snow field twice
    as bright would blow out, while the bake keeps its own colours within (an autumn floor stays orange and gold)"""
    rgb = linear(np.asarray(color, dtype=np.float32) / 255)
    want = linear(np.array([int(target[k:k + 2], 16) for k in (1, 3, 5)], dtype=np.float32) / 255)
    have = rgb.reshape(-1, 3).mean(axis=0)
    lum = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    lw, lh = float(want @ lum), float(have @ lum)
    hue = ((want / max(lw, 1e-6)) / np.maximum(have / max(lh, 1e-6), 1e-6)) ** 0.5
    scale = hue * lw / max(float((have * hue) @ lum), 1e-6)
    return Image.fromarray((srgb(rgb * scale) * 255).round().astype(np.uint8), 'RGB')


def painted(rgb, radius=3):
    """A painter's hand over a bake (Kuwahara filter, wrapping so it still tiles): each pixel takes the mean of the
    calmest of the four squares round it, so blades, leaves and stones become strokes of flat colour with crisp
    edges between them instead of a render's fine noise"""
    from scipy.ndimage import uniform_filter
    size = radius + 1
    lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    mean = [uniform_filter(rgb[..., c], size, mode='wrap') for c in range(3)]
    mean_l = uniform_filter(lum, size, mode='wrap')
    var = uniform_filter(lum * lum, size, mode='wrap') - mean_l * mean_l
    best = np.full(lum.shape, np.inf, dtype=np.float32)
    out = np.zeros_like(rgb)
    # The four squares are the box means shifted by half a box towards each corner
    h = radius // 2 + 1
    for dy in (-h, h):
        for dx in (-h, h):
            v = np.roll(var, (dy, dx), (0, 1))
            pick = v < best
            best = np.where(pick, v, best)
            for c in range(3):
                out[..., c] = np.where(pick, np.roll(mean[c], (dy, dx), (0, 1)), out[..., c])
    return out


def baked(mid, dl, target=None):
    """Maps of a ground baked from geometry (bake_grounds.py), its mean colour brought to `target`"""
    folder = os.path.join(dl, 'grounds', mid)

    def get(name):
        path = os.path.join(folder, name + '.png')
        return Image.open(path) if os.path.exists(path) else None

    if get('color') is None:
        raise SystemExit(f'{mid}: no bake in {folder} (run bake_grounds.py first)')
    normal = get('normal')
    # The relief to the strength the terrain shader was tuned for (the scans' typical slope, NORMAL_RMS): blade by
    # blade a sward's normals turn every way and would read as noise, settled snow or sand would read flat
    n = np.asarray(normal.convert('RGB'), dtype=np.float32) / 255 * 2 - 1
    rms = float(np.sqrt((n[..., :2] ** 2).sum(axis=2).mean()))
    n[..., :2] *= min(3.0, max(0.4, NORMAL_RMS / max(rms, 1e-6)))
    n /= np.linalg.norm(n, axis=2, keepdims=True) + 1e-6
    normal = Image.fromarray(((n * 0.5 + 0.5) * 255).round().astype(np.uint8), 'RGB')
    # A photo carries its light in its colour (the shade in every hollow); a bake's colour is pure albedo, and
    # from the game camera the normal map alone no longer shapes it: part of the occlusion and the small relief
    # go into the colour as a scan would have them
    color = np.asarray(get('color').convert('RGB'), dtype=np.float32)
    # The occlusion pass has single black samples on open ground (rays that found the patch's own surface)
    ao_img = gray(get('ao'), 255).filter(ImageFilter.MedianFilter(3))
    ao = np.asarray(ao_img, dtype=np.float32) / 255
    hi = gray(get('height'), 128)
    h = np.asarray(hi, dtype=np.float32) - np.asarray(hi.filter(ImageFilter.GaussianBlur(6)), dtype=np.float32)
    h = np.clip(h / (3 * h.std() + 4), -1, 1)
    shade = (0.5 + 0.5 * ao) * (1 + 0.18 * h)
    # Same brightness as the albedo the recipe chose: the shade moves light into the hollows, it does not darken
    shade /= shade.mean()
    color = Image.fromarray(painted((color * shade[..., None]).clip(0, 255)).astype(np.uint8), 'RGB')
    if target:
        color = calibrate(color, target)
    # The colour carries part of the occlusion now: the occlusion channel keeps the rest, or the hollows darken twice
    ao_img = Image.fromarray((150 + ao * 105).round().astype(np.uint8), 'L')
    return {'color': color, 'normal': normal, 'height': get('height'), 'ao': ao_img, 'rough': get('rough')}


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
    maps = (polyhaven(m['asset'], dl) if m['source'] == 'polyhaven' else baked(m['id'], dl, m.get('target')) if m['source'] == 'baked'
            else ambientcg(m['asset'], dl))
    target = os.path.join(out, 'materials', m['id'])
    os.makedirs(target, exist_ok=True)
    color = adjust(maps['color'].convert('RGB').resize((SIZE, SIZE), Image.LANCZOS), m)
    if m.get('shade') and maps['height'] is not None:
        # Nearly uniform albedo (lunar dust): darken the hollows by the height map so the relief reads from afar
        hi = gray(maps['height'], 128)
        # High-pass: only the small relief, a slope across the whole tile would show as stripes when tiled
        h = np.asarray(hi).astype(np.float32) - np.asarray(hi.filter(ImageFilter.GaussianBlur(24))).astype(np.float32)
        h = np.clip(0.5 + h / (4 * h.std() + 1e-6), 0, 1)
        k = 1 - m['shade'] / 2 + m['shade'] * h
        color = Image.fromarray((np.asarray(color).astype(np.float32) * k[..., None]).clip(0, 255).astype(np.uint8), 'RGB')
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
           else 'procedural (tools/map-assets/bake_grounds.py)' if m['source'] == 'baked'
           else f'https://ambientcg.com/view?id={m["asset"]}')
    files = {f: f'materials/{m["id"]}/{f}.jpg' for f in ('color', 'normal', 'arh')}
    e = {'id': m['id'], 'name': m['name'], 'category': m['category'], 'files': files}
    # The GPU-compressed layers of pack_textures.py, where they were made
    if all(os.path.exists(os.path.join(target, f'{f}.ktx2')) for f in ('color', 'data')):
        files['packed'] = {f: f'materials/{m["id"]}/{f}.ktx2' for f in ('color', 'data')}
    if os.path.exists(os.path.join(target, 'emissive.jpg')):
        files['emissive'] = f'materials/{m["id"]}/emissive.jpg'
        e['emissive'] = m['emissive']
    e.update({'scale': m['scale'], 'average': '#%02x%02x%02x' % avg})
    if m.get('tags'):
        e['tags'] = m['tags']
    if m.get('flow'):
        e['flow'] = m['flow']
    if m.get('paved'):
        e['paved'] = True
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
    subprocess.run([sys.executable, '-I', os.path.join(HERE, 'write_licenses.py'), out], check=True)


main()
