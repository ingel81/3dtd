"""Packs the ground materials into GPU-compressed KTX2 textures (E154).

    python -I tools/map-assets/pack_textures.py --ktx <ktx.exe> public/maps/assets [<id> ...]

Per material the three JPGs of build_materials.py go into the two RGBA layers
the terrain samples (map-asset-library.ts packMaterial): `color.ktx2` with the
colour and the height in alpha (sRGB) and `data.ktx2` with normal x/y,
roughness and occlusion (linear), both Basis ETC1S with mipmaps, at the
highest quality (QUALITIES) at which the two files together stay below the
material's three JPGs, so no map downloads more than before. The game
uploads them as they come: no decode on the main thread, a quarter of the
GPU memory of RGBA (BC7 or ASTC after the transcoder). The catalogue's material entry gets `files.packed` naming both;
build_materials.py keeps it.

Why ETC1S for the normals too: the normals share their layer with roughness
and occlusion (one texture, one codec), and UASTC for that layer alone (some
1.3 MB a material) would make a material's download larger than its three
JPGs (some 0.85 MB on average); with ETC1S both layers stay below them. The
PSNR of each layer against its packed source is printed (`--psnr`).

The ktx tool comes from KTX-Software 4.4 (--ktx points at ktx.exe), as for
tools/globe/build_textures.py.
"""
import argparse
import json
import os
import subprocess
import tempfile

from PIL import Image


def psnr(png, ktx2, tool):
    """PSNR per channel (dB) of a KTX2 file decoded again against the image it was made from"""
    import numpy as np
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, 'back.png')
        subprocess.run([tool, 'extract', '--transcode', 'rgba8', ktx2, out], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        a = np.asarray(Image.open(png).convert('RGBA'), dtype=np.float64)
        b = np.asarray(Image.open(out).convert('RGBA'), dtype=np.float64)
    mse = ((a - b) ** 2).mean(axis=(0, 1))
    return [round(float(10 * np.log10(255 ** 2 / max(e, 1e-9))), 1) for e in mse]


# ETC1S quality levels tried in turn, best first
QUALITIES = (255, 224, 192, 160, 128, 96)


def encode(png, out, tool, srgb, quality):
    fmt = 'R8G8B8A8_SRGB' if srgb else 'R8G8B8A8_UNORM'
    tf = 'srgb' if srgb else 'linear'
    codec = ['--encode', 'basis-lz', '--clevel', '2', '--qlevel', str(quality)]
    subprocess.run([tool, 'create', '--format', fmt, '--assign-tf', tf, *codec, '--generate-mipmap', png, out],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def pack(assets, m, tool, measure):
    files = m['files']
    load = lambda key: Image.open(os.path.join(assets, files[key])).convert('RGB')
    color, normal, arh = load('color'), load('normal'), load('arh')
    size = color.size
    normal, arh = normal.resize(size, Image.LANCZOS), arh.resize(size, Image.LANCZOS)
    r, g, b = color.split()
    nr, ng, _ = normal.split()
    ao, rough, height = arh.split()
    folder = os.path.dirname(files['color'])
    packed = {'color': f'{folder}/color.ktx2', 'data': f'{folder}/data.ktx2'}
    with tempfile.TemporaryDirectory() as tmp:
        c = os.path.join(tmp, 'color.png')
        d = os.path.join(tmp, 'data.png')
        Image.merge('RGBA', (r, g, b, height)).save(c, compress_level=1)
        Image.merge('RGBA', (nr, ng, rough, ao)).save(d, compress_level=1)
        jpg = sum(os.path.getsize(os.path.join(assets, files[k])) for k in ('color', 'normal', 'arh'))
        for q in QUALITIES:
            encode(c, os.path.join(assets, packed['color']), tool, srgb=True, quality=q)
            encode(d, os.path.join(assets, packed['data']), tool, srgb=False, quality=q)
            if sum(os.path.getsize(os.path.join(assets, f)) for f in packed.values()) <= jpg:
                break
        quality = ({key: psnr(src, os.path.join(assets, packed[key]), tool) for key, src in (('color', c), ('data', d))}
                   if measure else None)
    return packed, quality


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ktx', required=True)
    parser.add_argument('assets')
    parser.add_argument('ids', nargs='*')
    parser.add_argument('--psnr', action='store_true', help='print the PSNR of each layer against its source')
    args = parser.parse_args()
    path = os.path.join(args.assets, 'catalog.json')
    catalog = json.load(open(path, encoding='utf8'))
    total = 0
    jpgs = 0
    layers = {'color': [], 'data': []}
    for m in catalog['materials']:
        if args.ids and m['id'] not in args.ids:
            continue
        m['files']['packed'], quality = pack(args.assets, m, args.ktx, args.psnr)
        size = sum(os.path.getsize(os.path.join(args.assets, f)) for f in m['files']['packed'].values())
        jpg = sum(os.path.getsize(os.path.join(args.assets, m['files'][k])) for k in ('color', 'normal', 'arh'))
        total += size
        jpgs += jpg
        line = f"{m['id']}: {size / 1024:.0f} KiB (JPG {jpg / 1024:.0f} KiB)"
        if quality:
            for key in layers:
                layers[key].append(quality[key])
            line += f" PSNR colour {quality['color']} data {quality['data']}"
        print(line)
    with open(path, 'w', encoding='utf8', newline='\n') as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(f'{total / 2 ** 20:.1f} MiB KTX2, {jpgs / 2 ** 20:.1f} MiB JPG')
    for key, values in layers.items():
        if values:
            mean = [round(sum(v[c] for v in values) / len(values), 1) for c in range(4)]
            print(f'PSNR {key} per channel, mean over {len(values)} materials: {mean}, lowest {min(min(v) for v in values)}')


main()
