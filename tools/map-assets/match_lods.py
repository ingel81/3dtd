"""Gives the distance copies (-lod1) the look of their full models.

    python -I tools/map-assets/match_lods.py public/maps/assets [<id> ...]

The LOD builders (blender_kit.export_lod, make_lods.py) replace each textured
material by one flat colour. That colour came out too light: the mean of the
image's sRGB values went in as a linear colour (a dark bitumen roof 0.18
instead of 0.035), and roughness and metalness of the texture were lost
(always 0.8 and 0). Here, on the packed GLBs in models/, each flat `<name>-lod`
material gets what the full model's `<name>` shows from afar: the mean of its
colour texture in linear light times its factor, the mean roughness and
metalness of its texture times their factors. The LOD meshes have no second UV
set, so their materials lose the occlusion texture they still pointed at (the
full model's baked AO, read at one texel), and images nothing uses any more
leave the file. Run after pack_models.py; running it again changes nothing.
"""
import io
import json
import os
import struct
import sys

import numpy as np
from PIL import Image


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    length = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    at = 20 + length
    binary = b''
    if at < len(data):
        size = struct.unpack_from('<I', data, at)[0]
        binary = data[at + 8:at + 8 + size]
    return gltf, binary


def write_glb(path, gltf, binary):
    text = json.dumps(gltf, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    binary += b'\0' * (-len(binary) % 4)
    total = 12 + 8 + len(text) + (8 + len(binary) if binary else 0)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(text), 0x4E4F534A) + text)
        if binary:
            f.write(struct.pack('<II', len(binary), 0x004E4942) + binary)


def image_of(gltf, binary, texture):
    tex = gltf['textures'][texture['index']]
    source = tex.get('extensions', {}).get('EXT_texture_webp', {}).get('source', tex.get('source'))
    view = gltf['bufferViews'][gltf['images'][source]['bufferView']]
    start = view.get('byteOffset', 0)
    return np.asarray(Image.open(io.BytesIO(binary[start:start + view['byteLength']])).convert('RGB'), dtype=np.float64) / 255


def linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def far_look(gltf, binary, m):
    """Colour, roughness and metalness of a material seen from afar: texture means times factors"""
    pbr = m.get('pbrMetallicRoughness', {})
    colour = list(pbr.get('baseColorFactor', [1, 1, 1, 1]))
    if 'baseColorTexture' in pbr:
        mean = linear(image_of(gltf, binary, pbr['baseColorTexture'])).mean(axis=(0, 1))
        colour[:3] = [float(f * v) for f, v in zip(colour[:3], mean)]
    rough = pbr.get('roughnessFactor', 1.0)
    metal = pbr.get('metallicFactor', 1.0)
    if 'metallicRoughnessTexture' in pbr:
        mean = image_of(gltf, binary, pbr['metallicRoughnessTexture']).mean(axis=(0, 1))
        rough, metal = rough * float(mean[1]), metal * float(mean[2])
    return colour, rough, metal


def prune_images(gltf, binary):
    """Drops textures no material uses, then images no texture uses, with their bytes"""
    used = set()

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key.endswith('Texture') and isinstance(value, dict) and 'index' in value:
                    used.add(value['index'])
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(gltf.get('materials', []))
    textures = gltf.get('textures', [])
    keep = [i for i in range(len(textures)) if i in used]
    if len(keep) == len(textures):
        return binary
    remap = {old: new for new, old in enumerate(keep)}

    def renumber(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key.endswith('Texture') and isinstance(value, dict) and 'index' in value:
                    value['index'] = remap[value['index']]
                renumber(value)
        elif isinstance(node, list):
            for value in node:
                renumber(value)

    renumber(gltf['materials'])
    gltf['textures'] = [textures[i] for i in keep]
    sources = {t.get('extensions', {}).get('EXT_texture_webp', {}).get('source', t.get('source')) for t in gltf['textures']}
    images = gltf.get('images', [])
    drop_views = {images[i]['bufferView'] for i in range(len(images)) if i not in sources}
    image_map = {old: new for new, old in enumerate(i for i in range(len(images)) if i in sources)}
    gltf['images'] = [images[i] for i in range(len(images)) if i in sources]
    for t in gltf['textures']:
        ext = t.get('extensions', {}).get('EXT_texture_webp')
        if ext:
            ext['source'] = image_map[ext['source']]
        if 'source' in t:
            t['source'] = image_map[t['source']]
    for key in ('textures', 'images', 'samplers'):
        if key in gltf and not gltf[key]:
            del gltf[key]
    if 'textures' not in gltf:
        gltf.pop('samplers', None)
        for key in ('extensionsUsed', 'extensionsRequired'):
            if key in gltf:
                gltf[key] = [e for e in gltf[key] if e != 'EXT_texture_webp']
                if not gltf[key]:
                    del gltf[key]
    return drop_buffer_views(gltf, binary, drop_views)


def drop_buffer_views(gltf, binary, drop):
    """Removes buffer views and their bytes from the binary chunk (buffer 0), up to the next view's start so
    the alignment of what follows holds"""
    views = gltf['bufferViews']
    # Every range in buffer 0: plain views and meshopt-compressed ones
    starts = sorted({v.get('byteOffset', 0) for v in views if v['buffer'] == 0}
                    | {v['extensions']['EXT_meshopt_compression'].get('byteOffset', 0) for v in views
                       if v.get('extensions', {}).get('EXT_meshopt_compression', {}).get('buffer') == 0})
    cuts = []
    for i in sorted(drop):
        start = views[i].get('byteOffset', 0)
        later = [s for s in starts if s > start]
        cuts.append((start, later[0] if later else len(binary)))
    cuts.sort()

    def moved(offset):
        return offset - sum(end - start for start, end in cuts if end <= offset)

    out = bytearray()
    at = 0
    for start, end in cuts:
        out += binary[at:start]
        at = end
    out += binary[at:]
    remap = {}
    kept = []
    for i, v in enumerate(views):
        if i in drop:
            continue
        remap[i] = len(kept)
        if v['buffer'] == 0:
            v['byteOffset'] = moved(v.get('byteOffset', 0))
        ext = v.get('extensions', {}).get('EXT_meshopt_compression')
        if ext and ext.get('buffer') == 0:
            ext['byteOffset'] = moved(ext.get('byteOffset', 0))
        kept.append(v)
    gltf['bufferViews'] = kept
    for a in gltf.get('accessors', []):
        if 'bufferView' in a:
            a['bufferView'] = remap[a['bufferView']]
    for im in gltf.get('images', []):
        im['bufferView'] = remap[im['bufferView']]
    gltf['buffers'][0]['byteLength'] = len(out)
    return bytes(out)


def match(models, mid, lod_file):
    full, full_bin = read_glb(os.path.join(models, mid + '.glb'))
    by_name = {m.get('name'): m for m in full.get('materials', [])}
    path = os.path.join(models, os.path.basename(lod_file))
    lod, lod_bin = read_glb(path)
    changed = []
    for m in lod.get('materials', []):
        name = m.get('name', '')
        if 'occlusionTexture' in m:
            del m['occlusionTexture']
        source = by_name.get(name[:-4]) if name.endswith('-lod') else None
        if source is None:
            continue
        colour, rough, metal = far_look(full, full_bin, source)
        pbr = m.setdefault('pbrMetallicRoughness', {})
        before = pbr.get('baseColorFactor', [1, 1, 1, 1])
        pbr['baseColorFactor'] = [round(v, 4) for v in colour]
        pbr['roughnessFactor'] = round(rough, 4)
        pbr['metallicFactor'] = round(metal, 4)
        changed.append(f"{name} {[round(v, 3) for v in before[:3]]} -> {pbr['baseColorFactor'][:3]} r {pbr['roughnessFactor']} m {pbr['metallicFactor']}")
    size = os.path.getsize(path)
    lod_bin = prune_images(lod, lod_bin)
    write_glb(path, lod, lod_bin)
    return changed, size, os.path.getsize(path)


def main():
    assets, ids = sys.argv[1], sys.argv[2:]
    with open(os.path.join(assets, 'catalog.json'), encoding='utf-8') as f:
        catalog = json.load(f)
    models = os.path.join(assets, 'models')
    before = after = 0
    for o in catalog['objects']:
        if not o.get('lod') or (ids and o['id'] not in ids):
            continue
        for level in o['lod']:
            changed, a, b = match(models, o['id'], level['file'])
            before += a
            after += b
            print(f"{o['id']}: {a / 1024:.0f} -> {b / 1024:.0f} KiB")
            for line in changed:
                print('  ' + line)
    print(f'LOD files {before / 1024:.0f} -> {after / 1024:.0f} KiB')


main()
