"""Contact sheets: of a --verify run (one sheet per scene, every step's picture after it, labelled), or of a take.

    python tools/showreel/sheets.py <run folder> [--cols 4] [--width 480]
    python tools/showreel/sheets.py --take <take folder> [--cols 6]

A take's sheet (check.mjs picks the frames into <take>/sheet/frames.json): one frame a second of the scene and one
half a second after every labelled step, in time order; a step's caption is yellow. Written to <take>/sheet.jpg.

Reads <run>/verify.txt (scene, step, what, changed) and <run>/verify/<scene>-NN.png, writes
<run>/sheets/<scene>.jpg. A tile's caption is red when the step should change the map (stroke, clickMap)
and changed nothing: the review starts there.
"""
import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

LINE = re.compile(r'^(\S+)\s+(\d+)\s(.{60})\s(.+)$')
MAP_STEPS = ('stroke', 'clickMap')


def font(size):
    for name in ('consola.ttf', 'arial.ttf', 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def take_sheet(take, cols, width):
    import json
    frames = json.loads((take / 'sheet' / 'frames.json').read_text(encoding='utf-8'))
    tiles = []
    for f in frames:
        p = Path(f['file'])
        if not p.exists():
            continue
        img = Image.open(p).convert('RGB')
        tiles.append((f, img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)))
    if not tiles:
        return
    cap = 24
    th = tiles[0][1].height
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * width, rows * (th + cap)), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    fnt = font(14)
    for n, (f, img) in enumerate(tiles):
        x, y = (n % cols) * width, (n // cols) * (th + cap)
        sheet.paste(img, (x, y + cap))
        colour = (255, 210, 90) if f['step'] else (200, 200, 200)
        d.text((x + 4, y + 4), f"{f['t']:7.2f}  {f['label']}"[:60], fill=colour, font=fnt)
    sheet.save(take / 'sheet.jpg', quality=85)
    print(f'{take / "sheet.jpg"}: {len(tiles)} frames')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('run', nargs='?')
    ap.add_argument('--take')
    ap.add_argument('--cols', type=int, default=4)
    ap.add_argument('--width', type=int, default=480)
    a = ap.parse_args()
    if a.take:
        take_sheet(Path(a.take), a.cols if a.cols != 4 else 6, 320 if a.width == 480 else a.width)
        return
    run = Path(a.run)
    scenes = {}
    for raw in (run / 'verify.txt').read_text(encoding='utf-8').splitlines():
        m = LINE.match(raw)
        if m:
            scenes.setdefault(m[1], []).append((int(m[2]), m[3].strip(), m[4].strip()))
    out = run / 'sheets'
    out.mkdir(exist_ok=True)
    f = font(14)
    cap = 40
    for scene, steps in scenes.items():
        tiles = []
        for i, what, changed in steps:
            p = run / 'verify' / f'{scene}-{i:02d}.png'
            if not p.exists():
                continue
            # Only steps that do something on screen; waits and marks repeat the picture before
            if what.split(' ')[0] in ('wait', 'mark', 'settings', 'key') and len(what.split(' ')) == 1:
                continue
            img = Image.open(p).convert('RGB')
            h = round(img.height * a.width / img.width)
            tiles.append((i, what, changed, img.resize((a.width, h), Image.LANCZOS)))
        if not tiles:
            continue
        th = tiles[0][3].height
        rows = (len(tiles) + a.cols - 1) // a.cols
        sheet = Image.new('RGB', (a.cols * a.width, rows * (th + cap)), (20, 20, 20))
        d = ImageDraw.Draw(sheet)
        for n, (i, what, changed, img) in enumerate(tiles):
            x, y = (n % a.cols) * a.width, (n // a.cols) * (th + cap)
            sheet.paste(img, (x, y + cap))
            dead = what.split(' ')[0] in MAP_STEPS and changed == '-'
            d.text((x + 4, y + 2), f'{i:02d} {what}'[:58], fill=(255, 90, 90) if dead else (230, 230, 230), font=f)
            d.text((x + 4, y + 20), changed[:58], fill=(140, 200, 140) if changed != '-' else (150, 150, 150), font=f)
        sheet.save(out / f'{scene}.jpg', quality=85)
        print(f'{scene}: {len(tiles)} steps')


if __name__ == '__main__':
    main()
