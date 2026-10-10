# Download the NASA and star catalog sources of the menu globe (tools/globe/build_textures.py).
# Usage: bash tools/globe/fetch_sources.sh [dir], default tmp/globe-textures/src; resumes broken downloads.
mkdir -p "${1:-tmp/globe-textures/src}" && cd "${1:-tmp/globe-textures/src}"
B=https://eoimages.gsfc.nasa.gov/images/imagerecords
get(){ f=$(basename "$1"); want=$(curl -sIL "$1" | grep -i content-length | tail -1 | tr -dc 0-9)
  for i in 1 2 3 4 5 6 7 8; do have=$(stat -c %s "$f" 2>/dev/null || echo 0); [ "$have" = "$want" ] && { echo "ok $f"; return; }
    curl -sSL -C - -o "$f" "$1"; done; echo "FAIL $f"; }
get $B/74000/74092/world.200407.3x21600x10800.jpg
get $B/144000/144898/BlackMarble_2016_3km.jpg
get $B/57000/57747/cloud_combined_8192.tif
get $B/73000/73934/gebco_08_rev_elev_21600x10800.png
get $B/73000/73963/gebco_08_rev_bath_21600x10800.png
for t in A1 B1 C1 D1 A2 B2 C2 D2; do get $B/74000/74092/world.200407.3x21600x21600.$t.jpg; done
curl -sSfL -C - -o bsc5.dat.gz http://tdc-www.harvard.edu/catalogs/bsc5.dat.gz
echo DONE
