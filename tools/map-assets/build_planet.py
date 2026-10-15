"""Builds the Earth that hangs over moon maps (E194) from NASA's Blue Marble (public domain).

    python -I tools/map-assets/build_planet.py $DL/planet public/maps/assets

Downloads two equirect pictures of NASA Visible Earth's Blue Marble (2048 x 1024) into $DL once:
the Earth with clouds, which the sky shows, and the same without clouds, which tells sea from land.
Writes `skies/earth.webp` at 1024 x 512 (the disc is a few hundred pixels at most; the sky samples
it with mipmaps): RGB the Earth with clouds (sRGB), alpha where the sun glints (open sea, not under a
cloud). `exact` keeps the colour under transparent pixels, which lossy WebP would otherwise smear. Longitude -180 at the left edge, the north pole at the top row.

Needs numpy and Pillow (writes WebP).
"""
import os
import sys
import urllib.request

import numpy as np
from PIL import Image

SOURCES = {
    'cloud': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57735/land_ocean_ice_cloud_2048.jpg',
    'clear': 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_2048.jpg',
}
SIZE = (1024, 512)


def fetch(dl, url):
    path = os.path.join(dl, url.rsplit('/', 1)[1])
    if not os.path.exists(path):
        urllib.request.urlretrieve(url, path)
    return path


def main():
    dl, out = sys.argv[1], sys.argv[2]
    os.makedirs(dl, exist_ok=True)
    cloud = Image.open(fetch(dl, SOURCES['cloud'])).convert('RGB').resize(SIZE, Image.LANCZOS)
    clear = Image.open(fetch(dl, SOURCES['clear'])).convert('RGB').resize(SIZE, Image.LANCZOS)
    c = np.asarray(cloud, dtype=np.float32) / 255
    k = np.asarray(clear, dtype=np.float32) / 255
    # Sea: blue outweighs red and green in the cloudless picture (ice and desert do not)
    sea = np.clip((k[..., 2] - np.maximum(k[..., 0], k[..., 1]) - 0.04) * 12, 0, 1)
    # Cloud: grey and bright in the clouded picture (its open sea is a dark blue, about 0.18 in its darkest channel)
    clouded = np.clip((c.min(axis=2) - 0.25) * 4, 0, 1)
    glint = sea * (1 - clouded)
    rgba = np.dstack([c, glint]) * 255
    img = Image.fromarray(np.round(rgba).astype(np.uint8), 'RGBA')
    path = os.path.join(out, 'skies', 'earth.webp')
    img.save(path, 'WEBP', quality=88, alpha_quality=60, method=6, exact=True)
    print(path, os.path.getsize(path), 'bytes')


main()
