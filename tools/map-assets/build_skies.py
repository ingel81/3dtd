"""Builds the image skies of custom maps (E172) from Poly Haven HDRIs (CC0).

    python -I tools/map-assets/build_skies.py $DL/skies public/maps/assets [<id> ...]

Per sky the HDRI (4k) is downloaded into $DL once,
scaled so its horizon has the brightness of the sky preset it stands for
(the lights and the exposure of that preset then fit it), graded where the
table says so, and written as the upper hemisphere only (the dome and the
water read nothing below the horizon; the environment light fills it from
the horizon colour), sRGB, WebP. Next to the pictures `skies/skies.json`
holds per sky what the renderer needs before the picture has loaded, all
measured here on the linear HDR after scaling:

- `sun`: azimuth (degrees from north, clockwise) and elevation of the
  brightest spot, when the picture has a sun or moon that outshines the
  rest (peak over 40 times the sky's median); the map rotates the picture
  so this spot stands where the map's sun stands
- `sunColor`: the colour of that spot, brightest channel 1
- `zenith`, `horizon`: mean colour above 60 degrees and between 0 and 8
  degrees (linear), the haze the far land sinks into is the horizon's
- `sky`: mean colour of the hemisphere (cosine weighted, the sun clipped),
  the hemisphere light's colour

Needs numpy, OpenCV (reads Radiance .hdr) and Pillow (writes WebP).
"""
import json
import math
import os
import sys
import urllib.request

import cv2
import numpy as np
from PIL import Image

# What a human decides per sky: source, the preset whose lights it takes, label, grade.
# `level`: mean luminance of the horizon band after scaling (the presets' horizon: day 0.62,
# dusk 0.45, overcast 0.57, night 0.022). `saturation`, `tint` (linear RGB multipliers) grade it.
# `lift`: the photo's land reaches this high (degrees); the sky above it is stretched down to the horizon, so no
# hills of another place stand over a map (a slight squeeze no one reads in clouds or stars). `sunPeak`: how far the brightest spot must outshine the sky's median to count as the sun (default 40; None:
# the picture has none, a bright star is no sun). `stars`: keep only the stars and the milky way (the airglow of
# each row goes)
SKIES = [
    {'id': 'fair-weather', 'label': 'Fair weather', 'preset': 'day',
     'asset': 'kloofendal_48d_partly_cloudy_puresky', 'size': '4k', 'level': 0.62},
    {'id': 'sunset', 'label': 'Sunset', 'preset': 'dusk',
     'asset': 'belfast_sunset_puresky', 'size': '4k', 'level': 0.3, 'sunPeak': 8},
    {'id': 'afterglow', 'label': 'Afterglow', 'preset': 'dusk',
     'asset': 'qwantani_dusk_2_puresky', 'size': '4k', 'level': 0.22, 'sunPeak': 2.5},
    {'id': 'overcast', 'label': 'Overcast', 'preset': 'overcast',
     'asset': 'kloofendal_overcast_puresky', 'size': '4k', 'level': 0.3},
    {'id': 'thunderstorm', 'label': 'Thunderstorm', 'preset': 'overcast',
     'asset': 'quarry_cloudy', 'size': '4k', 'level': 0.05, 'lift': 13, 'saturation': 0.4,
     'tint': [0.86, 0.94, 1.1], 'gamma': 1.6},
    {'id': 'moonrise', 'label': 'Moonrise', 'preset': 'night',
     'asset': 'qwantani_moonrise_puresky', 'size': '4k', 'level': 0.03},
    {'id': 'starry-night', 'label': 'Starry night', 'preset': 'night',
     'asset': 'rogland_clear_night', 'size': '4k', 'level': 0.04, 'lift': 23, 'sunPeak': None},
    {'id': 'deep-space', 'label': 'Deep space', 'preset': 'night',
     'asset': 'rogland_clear_night', 'size': '4k', 'stars': True, 'lift': 22, 'sunPeak': None},
]

QUALITY = 88


def fetch(asset, size, dl):
    path = os.path.join(dl, f'{asset}_{size}.hdr')
    if not os.path.exists(path):
        url = f'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/{size}/{asset}_{size}.hdr'
        print('fetch', url)
        urllib.request.urlretrieve(url, path)
    return path


def luminance(img):
    return img[..., 0] * 0.2126 + img[..., 1] * 0.7152 + img[..., 2] * 0.0722


def elevations(h):
    """Elevation (radians) of each row of an equirect picture, top row first"""
    v = 1 - (np.arange(h) + 0.5) / h
    return (v - 0.5) * math.pi


def band_mean(img, el, lo, hi, weights=None):
    rows = (el >= math.radians(lo)) & (el < math.radians(hi))
    w = np.cos(el[rows])[:, None] * np.ones(img.shape[1])[None, :]
    if weights is not None:
        w = w * weights[rows]
    sel = img[rows]
    return (sel * w[..., None]).sum(axis=(0, 1)) / w.sum()


def find_sun(img, el, ratio):
    """Azimuth, elevation (degrees) and colour of the brightest spot, or None without one"""
    h, w = img.shape[:2]
    upper = el > math.radians(-2)
    lum = cv2.GaussianBlur(luminance(img), (0, 0), max(1.0, w / 2048))
    peak = lum[upper].max()
    median = np.median(lum[el > 0])
    if ratio is None or peak < ratio * median:
        return None
    spot = (lum >= peak * 0.5) & upper[:, None]
    ys, xs = np.nonzero(spot)
    weights = lum[ys, xs]
    # Centroid as a direction (three's equirect: u = atan(z, x) / 2pi + 0.5)
    phi = ((xs + 0.5) / w - 0.5) * 2 * math.pi
    theta = el[ys]
    d = np.stack([np.cos(phi) * np.cos(theta), np.sin(theta), np.sin(phi) * np.cos(theta)], axis=1)
    c = (d * weights[:, None]).sum(axis=0)
    c /= np.linalg.norm(c)
    azimuth = math.degrees(math.atan2(-c[0], c[2])) % 360
    elevation = math.degrees(math.asin(c[1]))
    colour = img[ys, xs].mean(axis=0)
    return {'azimuth': round(azimuth, 1), 'elevation': round(elevation, 1)}, colour / colour.max()


def stars_only(img):
    """The stars and the milky way: each row less its airglow (a low percentile)"""
    lum = luminance(img)
    floor = np.percentile(lum, 35, axis=1)
    out = np.clip(img - floor[:, None, None], 0, None)
    # Grey the milky way a little: the airglow's tint is gone, the stars keep their own colours
    grey = luminance(out)[..., None]
    return grey + (out - grey) * 0.6


def lift(img, el, deg):
    """The sky above `deg` degrees stretched down to the horizon, the land below it gone"""
    el_deg = np.degrees(el)
    rows = np.empty(len(el), dtype=np.int64)
    for i, d in enumerate(el_deg):
        src = deg + d * ((90 - deg) / 90) if d >= 0 else d
        rows[i] = int(np.argmin(np.abs(el_deg - src)))
    return img[rows]


def shoulder(x):
    """Linear up to 0.6, then rolled off towards 1: the sun's glare keeps its gradient instead of a white blot"""
    return np.where(x < 0.6, x, 0.6 + 0.4 * (1 - np.exp(-(x - 0.6) / 0.4)))


def to_srgb(linear):
    a = np.clip(shoulder(linear), 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)


def build(sky, dl, out):
    path = fetch(sky['asset'], sky['size'], dl)
    img = cv2.imread(path, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32)
    h, w = img.shape[:2]
    el = elevations(h)
    if sky.get('stars'):
        img = stars_only(img)
    if 'lift' in sky:
        img = lift(img, el, sky['lift'])
    if sky.get('stars'):
        # A field of stars has no horizon: its brightest stars (99.9th percentile) to white, faint at the horizon
        img = img / np.percentile(luminance(img[el > math.radians(20)]), 99.9) * 0.9
        img = img * np.clip(np.degrees(el) / 4, 0, 1)[:, None, None]
    else:
        # Scale: the horizon band (0 to 8 degrees) to the preset's level, measured below the sun's glare
        clipped = np.minimum(img, np.percentile(luminance(img[el > 0]), 99))
        img = img * (sky['level'] / luminance(band_mean(clipped, el, 0, 8)[None, :])[0])
    if 'gamma' in sky:
        # Deeper contrast for the storm: brights stay, the darks of the clouds sink
        lum = np.maximum(luminance(img), 1e-6)[..., None]
        ref = sky['level']
        img = img * np.power(lum / ref, sky['gamma'] - 1)
    if 'saturation' in sky:
        grey = luminance(img)[..., None]
        img = grey + (img - grey) * sky['saturation']
    if 'tint' in sky:
        img = img * np.array(sky['tint'], dtype=np.float32)
    sun = find_sun(img, el, sky.get('sunPeak', 40))
    no_sun = np.minimum(img, np.percentile(luminance(img[el > 0]), 99.5))
    upper = img[el >= 0]
    rows = upper.shape[0]
    pixels = (to_srgb(upper) * 255 + 0.5).astype(np.uint8)
    file = f'{sky["id"]}.webp'
    Image.fromarray(pixels, 'RGB').save(os.path.join(out, file), 'WEBP', quality=QUALITY, method=6)
    entry = {
        'id': sky['id'],
        'label': sky['label'],
        'preset': sky['preset'],
        'file': file,
        'width': w,
        'height': rows,
        'source': f'https://polyhaven.com/a/{sky["asset"]}' + (' (nur Sterne)' if sky.get('stars') else ''),
        'sun': sun[0] if sun else None,
        'sunColor': [round(float(c), 4) for c in sun[1]] if sun else None,
        'zenith': [round(float(c), 4) for c in band_mean(no_sun, el, 60, 91)],
        'horizon': [round(float(c), 4) for c in band_mean(no_sun, el, 0, 8)],
        'sky': [round(float(c), 4) for c in band_mean(no_sun, el, 0, 91)],
    }
    size = os.path.getsize(os.path.join(out, file))
    print(f'{sky["id"]}: {w}x{rows}, {size / 1024:.0f} kB, sun {entry["sun"]}')
    return entry


def main():
    dl, root = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    os.makedirs(dl, exist_ok=True)
    out = os.path.join(root, 'skies')
    os.makedirs(out, exist_ok=True)
    index_path = os.path.join(out, 'skies.json')
    old = {}
    if os.path.exists(index_path):
        old = {e['id']: e for e in json.load(open(index_path, encoding='utf8'))['skies']}
    entries = []
    for sky in SKIES:
        entries.append(build(sky, dl, out) if not only or sky['id'] in only else old[sky['id']])
    with open(index_path, 'w', encoding='utf8', newline='\n') as f:
        json.dump({'skies': entries}, f, indent=2, ensure_ascii=False)
        f.write('\n')


main()
