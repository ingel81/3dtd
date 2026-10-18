#!/usr/bin/env bash
# A new clone of the planet's data (README.md, "Update"): Overpass is down for
# the 2 to 3 hours of the download, the proxy answers 503 with Retry-After
# meanwhile, and the game asks the public servers. The same by hand, without
# this file: the three docker compose lines below. Interrupted? Go on with
#   docker compose run --rm clone && docker compose up -d overpass
set -euo pipefail
cd "$(dirname "$0")"
docker compose stop overpass
docker compose run --rm clone --fresh
docker compose up -d overpass
