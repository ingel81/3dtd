#!/usr/bin/env bash
# The AUR package for a release: pkgver, pkgrel, the checksums, and the
# .SRCINFO from makepkg. release.yml runs it in an Arch container; on Arch it
# runs as it is.
#
# pkgrel is 1 for a new version. Given the PKGBUILD the AUR holds now, and it
# has this version already, pkgrel stays when nothing else changed and goes up
# by one when the package did (a rerun after a fix to the packaging), so pacman
# offers it as an update.
#
# Usage: packaging/aur/update.sh <version> <sha256 of 3DTD-<version>-x86_64.AppImage> [<PKGBUILD in the AUR now>]
set -euo pipefail

version="${1#v}"
appimage_sum="${2:-}"
published="${3:-}"
if [[ -n "$published" && -f "$published" ]]; then
  published="$(realpath "$published")"
fi
cd "$(dirname "$0")"

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

write() {
  sed -i \
    -e "s/^pkgver=.*/pkgver=${version}/" \
    -e "s/^pkgrel=.*/pkgrel=$1/" \
    -e "s/^sha256sums=.*/sha256sums=('${appimage_sum}' '${desktop_sum}' '${launcher_sum}')/" \
    PKGBUILD
}

pkgrel=1
published_pkgrel=''
if [[ -n "$published" && -f "$published" ]] && grep -qx "pkgver=${version}" "$published"; then
  published_pkgrel=$(sed -n 's/^pkgrel=//p' "$published")
  if [[ ! "$published_pkgrel" =~ ^[0-9]+$ ]]; then
    echo "[aur] the AUR's pkgrel is not a number: $published_pkgrel" >&2
    exit 1
  fi
  pkgrel=$published_pkgrel
fi
write "$pkgrel"
if [[ -n "$published_pkgrel" ]] && ! cmp -s PKGBUILD "$published"; then
  pkgrel=$((published_pkgrel + 1))
  write "$pkgrel"
fi

makepkg --printsrcinfo > .SRCINFO
echo "[aur] PKGBUILD and .SRCINFO for ${version}-${pkgrel}"
