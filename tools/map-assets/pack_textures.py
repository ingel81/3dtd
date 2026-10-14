"""Packs the ground materials into GPU-compressed KTX2 textures (E154, PF-M3).

    python -I tools/map-assets/pack_textures.py --ktx <ktx.exe> public/maps/assets [<id> ...]

Per material the three JPGs of build_materials.py go into the two RGBA layers
the terrain samples (map-asset-library.ts packMaterial): `color.ktx2` with the
colour and the height in alpha (sRGB, Basis ETC1S, quality 255) and
`data.ktx2` with normal x/y, roughness and occlusion (linear, UASTC with
zstd, the normals keep their detail). Both with mipmaps, so the game uploads
them as they come: no decode on the main thread, a quarter of the GPU memory
of RGBA (BC7 or ASTC after the transcoder). The catalogue's material entry
gets `files.packed` naming both; build_materials.py keeps it.

The ktx tool comes from KTX-Software 4.4 (--ktx points at ktx.exe), as for
tools/globe/build_textures.py.
"""
import argparse
import json
import os
import subprocess
import tempfile

from PIL import Image


def encode(png, out, tool, srgb, uastc):
    fmt = 'R8G8B8A8_SRGB' if srgb else 'R8G8B8A8_UNORM'
    tf = 'srgb' if srgb else 'linear'
    codec = (['--encode', 'uastc', '--uastc-quality', '2', '--uastc-rdo', '--uastc-rdo-l', '1', '--zstd', '20'] if uastc
             else ['--encode', 'basis-lz', '--clevel', '2', '--qlevel', '255'])
    subprocess.run([tool, 'create', '--format', fmt, '--assign-tf', tf, *codec, '--generate-mipmap', png, out],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def pack(assets, m, tool):
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
        encode(c, os.path.join(assets, packed['color']), tool, srgb=True, uastc=False)
        encode(d, os.path.join(assets, packed['data']), tool, srgb=False, uastc=True)
    return packed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ktx', required=True)
    parser.add_argument('assets')
    parser.add_argument('ids', nargs='*')
    args = parser.parse_args()
    path = os.path.join(args.assets, 'catalog.json')
    catalog = json.load(open(path, encoding='utf8'))
    total = 0
    for m in catalog['materials']:
        if args.ids and m['id'] not in args.ids:
            continue
        m['files']['packed'] = pack(args.assets, m, args.ktx)
        size = sum(os.path.getsize(os.path.join(args.assets, f)) for f in m['files']['packed'].values())
        total += size
        print(f"{m['id']}: {size / 1024:.0f} KiB")
    with open(path, 'w', encoding='utf8', newline='\n') as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(f'{total / 2 ** 20:.1f} MiB')


main()
