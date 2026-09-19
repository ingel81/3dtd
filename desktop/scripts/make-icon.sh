#!/usr/bin/env bash
# Builds desktop/build/icon.ico from public/assets/images/logo/logo_square.png.
#
# 256, 128 and 64 px show the full logo. 48 px and below show only the pin
# with the tower: the full logo is a wide word mark, and at the sizes of the
# title bar and taskbar (16 to 32 px) it turns into a smudge.
#
# Needs ImageMagick 7 (`magick`). Run from desktop/.
set -euo pipefail

logo=../public/assets/images/logo/logo_square.png
out=build/icon.ico
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The pin sits at the left of the 256 px logo; crop, trim, pad to a square.
magick "$logo" -crop 110x146+2+52 +repage -trim +repage -background none \
  -gravity center -extent '%[fx:max(w,h)+4]x%[fx:max(w,h)+4]' "$work/pin.png"

magick "$logo" -filter Lanczos \
  \( -clone 0 -resize 256x256 \) \( -clone 0 -resize 128x128 \) \( -clone 0 -resize 64x64 \) \
  -delete 0 "$work/full.miff"
magick "$work/pin.png" -filter Lanczos \
  \( -clone 0 -resize 48x48 \) \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 24x24 \) \( -clone 0 -resize 16x16 \) \
  -delete 0 "$work/small.miff"

mkdir -p build
magick "$work/full.miff" "$work/small.miff" "$out"
magick identify "$out"
