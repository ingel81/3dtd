#!/usr/bin/env bash
# Fill /db with a clone of the Overpass database of dev.overpass-api.de, the
# current data only (no metadata, no attic, no changelog: the files of
# download_clone.sh --meta=no), about 280 GB.
#
#   docker compose run --rm clone            # first fill, or go on after an interruption
#   docker compose run --rm clone --fresh    # throw the database away and clone anew (reclone.sh)
#
# aria2 loads several files at once, each in several pieces, and keeps what it
# has: a run that breaks off goes on where it stopped. The clone's address is
# kept in /db/clone/base-url, so a run that goes on never mixes the files of two
# clone days; when the server no longer has that clone, it starts anew with the
# newest. /shared/maintenance tells the proxy the database is being renewed
# until the clone is complete. At the end the clone's minute diff is turned into
# its time (osm_base_version), which Overpass puts into every answer as
# timestamp_osm_base, and /db/init_done marks the database complete.
set -euo pipefail

DB=/db
DIR=$DB/db
STATE=$DB/clone
SHARED=/shared
SOURCE=${CLONE_SOURCE:-https://dev.overpass-api.de/api_drolbr/}
JOBS=${CLONE_JOBS:-2}
SPLIT=${CLONE_SPLIT:-4}
REPLICATION=${CLONE_REPLICATION:-https://planet.openstreetmap.org/replication/minute}
# Room left on the disk past the clone, bytes
SPARE=$((5 * 1024 * 1024 * 1024))

# download_clone.sh, FILES_BASE: the current data of nodes, ways and relations; each with its .idx.
# CLONE_FILES replaces the list, for a test of the script only (the database is not usable then)
FILES_BASE="${CLONE_FILES:-nodes.bin nodes.map node_tags_local.bin node_tags_global.bin node_frequent_tags.bin node_keys.bin
ways.bin ways.map way_tags_local.bin way_tags_global.bin way_frequent_tags.bin way_keys.bin
relations.bin relations.map relation_roles.bin relation_tags_local.bin relation_tags_global.bin relation_frequent_tags.bin relation_keys.bin}"

log() { echo "$(date -u +%FT%TZ) $*"; }
fresh=0
case "${1:-}" in
  --fresh) fresh=1 ;;
  "") ;;
  *) echo "usage: clone.sh [--fresh]"; exit 2 ;;
esac

if [[ -f $DB/init_done && $fresh == 0 ]]; then
  log "The database is complete (init_done). To clone anew: reclone.sh, or docker compose run --rm clone --fresh"
  exit 0
fi

mkdir -p "$SHARED"
touch "$SHARED/maintenance"
if [[ $fresh == 1 ]]; then
  log "Throwing the old database away"
  rm -f "$DB/init_done"
  rm -rf "$DIR" "$STATE"
fi
mkdir -p "$STATE" "$DIR"

if [[ -s $STATE/base-url ]]; then
  base=$(<"$STATE/base-url")
  if ! curl -sfI -o /dev/null "$base/replicate_id"; then
    log "The clone $base is no longer on the server; starting anew with the newest"
    rm -rf "$DIR"
    mkdir -p "$DIR"
    rm -f "$STATE/base-url"
  fi
fi
if [[ ! -s $STATE/base-url ]]; then
  # trigger_clone names the newest clone's directory, e.g. https://dev.overpass-api.de/clone//2026-10-13
  base=$(curl -sfL "${SOURCE%/}/trigger_clone" | tr -d '[:space:]' | sed -E 's#([^:])/+#\1/#g; s#/$##')
  [[ $base == http* ]] || { log "No clone found at $SOURCE"; exit 1; }
  echo "$base" >"$STATE/base-url"
fi
base=$(<"$STATE/base-url")
log "Clone: $base"

# The size of every file, from the server; the total for the disk check and the status page
total=0
: >"$STATE/sizes"
for f in $FILES_BASE; do
  for x in "$f" "$f.idx"; do
    size=$(curl -sfIL "$base/$x" | tr -d '\r' | awk 'tolower($1) == "content-length:" { n = $2 } END { print n }')
    [[ $size =~ ^[0-9]+$ ]] || { log "No size for $x"; exit 1; }
    echo "$x $size" >>"$STATE/sizes"
    total=$((total + size))
  done
done
echo "$total" >"$STATE/total-bytes"
have=$(du -s -B1 "$DIR" | cut -f1)
free=$(df -B1 --output=avail "$DIR" | tail -1 | tr -d ' ')
need=$((total - have + SPARE))
log "$((total / 1024 ** 3)) GB in all, $((have / 1024 ** 3)) GB there, $((free / 1024 ** 3)) GB free"
if (( free < need )); then
  log "Not enough room: $((need / 1024 ** 3)) GB needed"
  exit 1
fi

: >"$STATE/aria2-input"
while read -r x _; do
  printf '%s\n  out=%s\n' "$base/$x" "$x" >>"$STATE/aria2-input"
done <"$STATE/sizes"

log "Loading with $JOBS files at once, $SPLIT connections each"
aria2c \
  --input-file="$STATE/aria2-input" \
  --dir="$DIR" \
  --continue=true \
  --auto-file-renaming=false \
  --max-concurrent-downloads="$JOBS" \
  --split="$SPLIT" \
  --max-connection-per-server="$SPLIT" \
  --min-split-size=256M \
  --file-allocation=none \
  --max-tries=0 \
  --retry-wait=30 \
  --connect-timeout=30 \
  --timeout=120 \
  --summary-interval=300 \
  --console-log-level=notice \
  --show-console-readout=false \
  --download-result=hide \
  || { log "The download stopped (aria2 exit $?); run the clone again to go on where it stopped"; exit 1; }

# Every file whole: its size as the server gave it, no aria2 control file left
while read -r x size; do
  got=$(stat -c %s "$DIR/$x" 2>/dev/null || echo 0)
  if [[ $got != "$size" || -e $DIR/$x.aria2 ]]; then
    log "$x is not complete ($got of $size bytes); run the clone again to go on"
    exit 1
  fi
done <"$STATE/sizes"

curl -sfL -o "$DIR/replicate_id" "$base/replicate_id"
cp "$DIR/replicate_id" "$DB/replicate_id"
seq=$(tr -dc '0-9' <"$DIR/replicate_id")
path=$(printf '%09d' "$seq" | sed -E 's#(...)(...)(...)#\1/\2/\3#')
stamp=$(curl -sfL "$REPLICATION/$path.state.txt" | sed -n 's/^timestamp=//p' | tr -d '\\\r')
if [[ $stamp =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]]; then
  echo "$stamp" >"$DIR/osm_base_version"
  log "Data as of $stamp (minute diff $seq)"
else
  log "No time for minute diff $seq; answers will carry no timestamp_osm_base"
fi

rm -f "$STATE/aria2-input"
echo "$(date -u +%FT%TZ) $base" >"$STATE/done"
touch "$DB/init_done"
rm -f "$SHARED/maintenance"
log "The database is complete. Start Overpass: docker compose up -d"
