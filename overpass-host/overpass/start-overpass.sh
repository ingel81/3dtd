#!/bin/bash
# Runs as root in front of the Overpass image's own entrypoint (docker-compose.yml):
# - refuses to start on an empty database instead of letting the image clone it
#   itself (in one go, not resumable): fill it with `docker compose run --rm clone`
# - gives the data to the user Overpass runs as (the clone writes as root)
# - one FastCGI process per query slot, and two for the health check and /api/status
# - writes the container's memory to /shared every 10 s for the status page
set -eo pipefail

if [[ "${OVERPASS_MODE}" == "clone" && ! -f /db/init_done ]]; then
  echo "No complete database in /db (init_done missing). Fill it first: docker compose run --rm clone"
  sleep 60
  exit 1
fi
chown -R overpass:overpass /db

export OVERPASS_FASTCGI_PROCESSES=$(( ${OVERPASS_SLOTS:-8} + 2 ))

memory_loop() {
  local cg=/sys/fs/cgroup current max anon file
  while true; do
    if [[ -f $cg/memory.current ]]; then
      current=$(<"$cg/memory.current")
      max=$(<"$cg/memory.max")
      anon=$(awk '$1 == "anon" { print $2 }' "$cg/memory.stat")
      file=$(awk '$1 == "file" { print $2 }' "$cg/memory.stat")
    elif [[ -f $cg/memory/memory.usage_in_bytes ]]; then
      current=$(<"$cg/memory/memory.usage_in_bytes")
      max=$(<"$cg/memory/memory.limit_in_bytes")
      anon=$(awk '$1 == "total_rss" { print $2 }' "$cg/memory/memory.stat")
      file=$(awk '$1 == "total_cache" { print $2 }' "$cg/memory/memory.stat")
    else
      sleep 60
      continue
    fi
    [[ $max =~ ^[0-9]+$ ]] || max=null
    printf '{"t":%s,"current":%s,"max":%s,"anon":%s,"file":%s}\n' "$(date +%s)" "$current" "$max" "${anon:-null}" "${file:-null}" \
      >/shared/overpass-memory.json.tmp && mv /shared/overpass-memory.json.tmp /shared/overpass-memory.json
    sleep 10
  done
}
if [[ -d /shared ]]; then memory_loop & fi

exec /app/docker-entrypoint.sh
