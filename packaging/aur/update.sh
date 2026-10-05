#!/usr/bin/env bash
# The AUR package for a release: pkgver, pkgrel 1, the checksums, and the
# .SRCINFO from makepkg. release.yml runs it in an Arch container; on Arch it
# runs as it is.
#
# Usage: packaging/aur/update.sh <version> <sha256 of 3DTD-<version>-x86_64.AppImage>
set -euo pipefail
cd "$(dirname "$0")"

version="${1#v}"
appimage_sum="${2:-}"
# The AUR takes no "-" in pkgver, and a pre-release is no package
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "[aur] not a release version: $1" >&2
  exit 1
fi
if [[ ! "$appimage_sum" =~ ^[0-9a-f]{64}$ ]]; then
  echo "[aur] not a sha256: $appimage_sum" >&2
  exit 1
fi

desktop_sum=$(sha256sum 3dtd.desktop | cut -d' ' -f1)
launcher_sum=$(sha256sum 3dtd.sh | cut -d' ' -f1)
sed -i \
  -e "s/^pkgver=.*/pkgver=${version}/" \
  -e "s/^pkgrel=.*/pkgrel=1/" \
  -e "s/^sha256sums=.*/sha256sums=('${appimage_sum}' '${desktop_sum}' '${launcher_sum}')/" \
  PKGBUILD

makepkg --printsrcinfo > .SRCINFO
echo "[aur] PKGBUILD and .SRCINFO for ${version}"
