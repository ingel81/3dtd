"""
Build the textures of the menu globe (docs/GLOBE_PLAN.md) from NASA sources.

    python tools/globe/build_textures.py [--src DIR] [--ktx PATH] [--only day,night,relief,region,stars]

Sources (download with tools/globe/fetch_sources.sh into --src, default
tmp/globe-textures/src):
  world.200407.3x21600x10800.jpg            NASA Blue Marble Next Generation, July 2004 (Visible Earth 74092): leaves out, no snow, like the tiles
  world.200407.3x21600x21600.{A..D}{1,2}.jpg the same at 500 m in eight 90 degree tiles
  BlackMarble_2016_3km.jpg                  NASA Black Marble 2016 (Visible Earth 144898)
  cloud_combined_8192.tif                   NASA cloud composite (Visible Earth 57747)
  gebco_08_rev_elev_21600x10800.png         NASA Visible Earth 73934 (GEBCO 2008 based), height
  gebco_08_rev_bath_21600x10800.png         NASA Visible Earth 73963 (GEBCO 2008 based), water
  bsc5.dat.gz                               Yale Bright Star Catalog, 5th ed. (public domain)

Writes public/assets/globe/:
  earth-day-{2k,8k}.ktx2      sRGB, the day surface
  earth-night-{2k,8k}.ktx2    sRGB city lights, cloud cover in alpha (linear)
  earth-relief-{2k,4k}.ktx2   height in RGB (grey, linear), water in alpha
  region/<row>_<col>.ktx2     9 degree tiles at 1 km per pixel, day in RGB, water in alpha;
                              tiles with water only are left out
  region/index.json           which region tiles exist
  stars.bin                   Float32 per star: right ascension (rad), declination (rad), V magnitude, B-V

All KTX2 files are Basis Universal ETC1S with mipmaps: small on disk, transcoded
on the device to the GPU format it has (docs/GLOBE_PLAN.md, Texturen und Leistung).
The ktx tool comes from KTX-Software (4.4); --ktx points at ktx.exe.
"""

import argparse
import gzip
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, 'public', 'assets', 'globe')

# Region tiles: 9 degree squares, 1 km per pixel (120 px per degree)
REGION_DEG = 9
REGION_PX = 1080
# The 500 m source: 240 px per degree, eight tiles of 90 degrees
SOURCE_PX_PER_DEG = 240
SOURCE_TILE_DEG = 90
SOURCE_COLS = 'ABCD'


def ktx(args, tool):
    subprocess.run([tool, 'create', *args], check=True, stdout=subprocess.DEVNULL)


def encode(image, path, tool, srgb=True, alpha=False, quality=128):
    """One image to an ETC1S KTX2 with mipmaps"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        png = os.path.join(tmp, 'in.png')
        image.save(png, compress_level=1)
        fmt = ('R8G8B8A8' if alpha else 'R8G8B8') + ('_SRGB' if srgb else '_UNORM')
        ktx([
            '--format', fmt,
            '--assign-tf', 'srgb' if srgb else 'linear', '--assign-primaries', 'bt709',
            '--encode', 'basis-lz', '--qlevel', str(quality), '--clevel', '2',
            '--generate-mipmap',
            png, path,
        ], tool)
    print(f'  {os.path.relpath(path, REPO)}  {os.path.getsize(path) / 1024:.0f} KiB')


def resized(image, width):
    return image.resize((width, width // 2), Image.LANCZOS)


def water_mask(src):
    """Water 255, land 0, from the GEBCO bathymetry (palette index 255 is land)"""
    bath = Image.open(os.path.join(src, 'gebco_08_rev_bath_21600x10800.png'))
    index = np.asarray(bath)  # palette indices
    return Image.fromarray(np.where(index < 255, 255, 0).astype(np.uint8), 'L')


def build_day(src, tool):
    print('day')
    day = Image.open(os.path.join(src, 'world.200407.3x21600x10800.jpg')).convert('RGB')
    encode(resized(day, 2048), os.path.join(OUT, 'earth-day-2k.ktx2'), tool)
    encode(resized(day, 8192), os.path.join(OUT, 'earth-day-8k.ktx2'), tool, quality=160)


def build_night(src, tool):
    print('night and clouds')
    night = Image.open(os.path.join(src, 'BlackMarble_2016_3km.jpg')).convert('RGB')
    clouds = Image.open(os.path.join(src, 'cloud_combined_8192.tif')).convert('L')
    for width, name in ((2048, '2k'), (8192, '8k')):
        rgba = resized(night, width)
        rgba.putalpha(resized(clouds, width))
        encode(rgba, os.path.join(OUT, f'earth-night-{name}.ktx2'), tool, alpha=True)


def build_relief(src, tool):
    print('relief and water')
    height = Image.open(os.path.join(src, 'gebco_08_rev_elev_21600x10800.png')).convert('L')
    water = water_mask(src)
    for width, name in ((2048, '2k'), (4096, '4k')):
        rgba = Image.merge('RGBA', (*(resized(height, width),) * 3, resized(water, width)))
        encode(rgba, os.path.join(OUT, f'earth-relief-{name}.ktx2'), tool, srgb=False, alpha=True)


def source_tile(src, col, row, cache={}):
    key = (col, row)
    if key not in cache:
        cache.clear()
        name = f'world.200407.3x21600x21600.{SOURCE_COLS[col]}{row + 1}.jpg'
        cache[key] = Image.open(os.path.join(src, name)).convert('RGB')
    return cache[key]


def build_regions(src, tool):
    print('region tiles')
    water = np.asarray(water_mask(src))  # 60 px per degree
    water_img = Image.fromarray(water, 'L')
    rows = 180 // REGION_DEG
    cols = 360 // REGION_DEG
    per_source = SOURCE_TILE_DEG // REGION_DEG
    jobs = []
    present = []
    # Source tile by source tile, so each big JPEG is decoded once
    for srow in range(2):
        for scol in range(4):
            tile = None
            for r in range(srow * per_source, (srow + 1) * per_source):
                for c in range(scol * per_source, (scol + 1) * per_source):
                    y0, x0 = r * REGION_DEG * 60, c * REGION_DEG * 60
                    block = water[y0:y0 + REGION_DEG * 60, x0:x0 + REGION_DEG * 60]
                    if block.min() == 255:
                        continue  # water only: the global texture is enough
                    if tile is None:
                        tile = source_tile(src, scol, srow)
                    px = REGION_DEG * SOURCE_PX_PER_DEG
                    lx = (c - scol * per_source) * px
                    ly = (r - srow * per_source) * px
                    day = tile.crop((lx, ly, lx + px, ly + px)).resize((REGION_PX, REGION_PX), Image.LANCZOS)
                    wmask = water_img.crop((x0, y0, x0 + REGION_DEG * 60, y0 + REGION_DEG * 60)).resize(
                        (REGION_PX, REGION_PX), Image.BILINEAR)
                    day.putalpha(wmask)
                    jobs.append((r, c, day))
            # Encode this source tile's regions in parallel, then let the image go
            with ThreadPoolExecutor(max_workers=8) as pool:
                list(pool.map(lambda j: encode(j[2], os.path.join(OUT, 'region', f'{j[0]}_{j[1]}.ktx2'), tool, alpha=True), jobs))
            present.extend(f'{r}_{c}' for r, c, _ in jobs)
            jobs = []
    with open(os.path.join(OUT, 'region', 'index.json'), 'w') as f:
        json.dump({'deg': REGION_DEG, 'px': REGION_PX, 'tiles': sorted(present)}, f, separators=(',', ':'))
    total = sum(os.path.getsize(os.path.join(OUT, 'region', n)) for n in os.listdir(os.path.join(OUT, 'region')))
    print(f'  {len(present)} region tiles of {rows * cols}, {total / 2**20:.1f} MiB')


def build_stars(src):
    """Yale BSC5 (fixed-width ASCII): RA, Dec J2000, V mag, B-V"""
    print('stars')
    rows = []
    with gzip.open(os.path.join(src, 'bsc5.dat.gz'), 'rt', encoding='latin1') as f:
        for line in f:
            try:
                ra = (int(line[75:77]) + int(line[77:79]) / 60 + float(line[79:83]) / 3600) * 15
                sign = -1 if line[83] == '-' else 1
                dec = sign * (int(line[84:86]) + int(line[86:88]) / 60 + int(line[88:90]) / 3600)
                vmag = float(line[102:107])
            except ValueError:
                continue  # novae and objects without a position
            bv_text = line[109:114].strip()
            bv = float(bv_text) if bv_text else 0.6
            rows.append((math.radians(ra), math.radians(dec), vmag, bv))
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'stars.bin'), 'wb') as f:
        for row in rows:
            f.write(struct.pack('<4f', *row))
    print(f'  {len(rows)} stars')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--src', default=os.path.join(REPO, 'tmp', 'globe-textures', 'src'))
    parser.add_argument('--ktx', default=os.path.join(REPO, 'tmp', 'globe-textures', 'ktx', 'out', 'bin', 'ktx.exe'))
    parser.add_argument('--only', default='day,night,relief,region,stars')
    args = parser.parse_args()
    only = set(args.only.split(','))
    if 'stars' in only:
        build_stars(args.src)
    if 'day' in only:
        build_day(args.src, args.ktx)
    if 'night' in only:
        build_night(args.src, args.ktx)
    if 'relief' in only:
        build_relief(args.src, args.ktx)
    if 'region' in only:
        build_regions(args.src, args.ktx)


if __name__ == '__main__':
    sys.exit(main())
