# 3DTD Overpass host

An Overpass API of our own for the game's street, building and OSM world loads, so they do not hang on the public
servers. It holds the planet's current data (no history, no metadata), sits behind a proxy that takes only queries
held to a small area, and is reached from outside only through a Cloudflare tunnel. The game does not use it yet; it
joins as the first entry of `src/app/world/osm/overpass-servers.ts` later (docs/LOCATION_SYSTEM.md, "Server").

| Service | What it is |
|---------|------------|
| `overpass` | [wiktorn/overpass-api](https://github.com/wiktorn/Overpass-API) `v0.7.62.9` with `overpass/start-overpass.sh` in front: the official Overpass sources (dispatcher, `osm3s_query`, nginx with FastCGI), no areas, no diffs |
| `proxy` | `src/proxy.ts`, Node 24 without dependencies: CORS, limits per client, box check, caps, queue, statistics |
| `status` | `src/status-main.ts`, the same image: the status page for the LAN |
| tunnel | The only way in from outside: the cloudflared that runs already for the coop lobby, to the proxy's own address in the LAN (`docker-compose.lan.yml`; or a port of the server, or its Docker network, `docker-compose.shared-tunnel.yml`), or one of its own (`cloudflared`, compose profile `tunnel`) |
| `clone` | `clone/clone.sh`, run by hand: fills the database with a clone of dev.overpass-api.de |

Overpass sits on an internal network without a way out (the clone, run by hand, on one with a way out); the proxy and
the status page are on it and, by default, each at an address of its own in the LAN. Nothing is open to the internet: the proxy's address is
for the tunnel's connector, the status page's for the LAN.

The images come ready from the GitHub Container Registry, built by the workflow `overpass-host-image.yml` with every
change of `overpass-host/` on next (`:next`) and main (`:latest`), each also tagged with its commit (`:sha-<8 hex>`):
`ghcr.io/ingel81/3dtd-osm-overpass`, `3dtd-osm-proxy` (proxy and status page) and `3dtd-osm-clone`. A server needs
nothing of the repository but `docker-compose.yml`, `docker-compose.lan.yml` and its `.env`.

Why the wiktorn image: it builds the released Overpass sources unchanged and already starts dispatcher, nginx and
FastCGI under supervision; what this host needs on top (no self-clone on an empty volume, FastCGI processes matched to
the proxy's slots, the container's memory for the status page) is one start script (`overpass/start-overpass.sh`),
not a fork. Why Node for the proxy: the check of the query needs a lexer for Overpass QL, which is plain code in Node
and covered by the repository's tests; the proxy only streams the answer through, the time is spent in Overpass.

## Resources

- **Disk:** the clone is about 280 GB (2026-10: nodes.bin 95 GB, nodes.map 53 GB, the rest ways, relations and tags),
  on an SSD or NVMe; Overpass reads it at random. Keep 30 GB or more free past it: the clone grows with OSM.
- **Memory:** the container gets `OVERPASS_MEMORY` (16 GB). The queries reserve up to `OVERPASS_SPACE` (10 GB) together;
  the rest is file cache for the database, which speeds up whatever was asked before. Proxy and status page take
  well under 100 MB each.
- **CPU:** a query runs on one core; `OVERPASS_SLOTS` (8) run at once, more wait in the proxy's queue.

## First start

```bash
mkdir 3dtd-osm && cd 3dtd-osm
raw=https://raw.githubusercontent.com/ingel81/3dtd/next/overpass-host
curl -fsSL -O "$raw/docker-compose.yml" -O "$raw/docker-compose.lan.yml"
curl -fsSL -o .env "$raw/.env.example"
nano .env                   # OVERPASS_DATA, LAN_NETWORK, PROXY_IP, STATUS_IP
docker compose --profile clone pull
docker compose run --rm clone
docker compose up -d
```

The clone takes 1.5 to 3 hours (measured 2026-10-18: 34 MB/s over one connection, 59 MB/s with the default two files
at once and four connections each). It can be stopped at any time and goes on where it stopped with the same command:
aria2 keeps what it has, and `$OVERPASS_DATA/clone/base-url` holds the clone's address, so a run that goes on never
mixes files of two clone days (when the server no longer has that clone, it starts anew with the newest). It checks the
room on the disk first, checks every file's size at the end, writes the data's time (`osm_base_version`, from the
clone's minute diff) and marks the database complete (`init_done`). Overpass refuses to start without that mark.

## Tunnel

The tunnel that runs already for the coop lobby (coop-server/README.md) takes this host as well. By default the proxy
and the status page get addresses of their own in the LAN, the way the relay is set up: on an external Docker network
of the server (a macvlan or ipvlan network, Unraid's `br0` or a VLAN of it), with `docker-compose.lan.yml`:

1. `.env`: `COMPOSE_FILE=docker-compose.yml:docker-compose.lan.yml`, the network in `LAN_NETWORK`, a free fixed address
   each in `PROXY_IP` and `STATUS_IP`. `STATUS_NETWORK` puts the status page on another network than the proxy (a DMZ
   for the proxy, the home network for the page); by default both share `LAN_NETWORK`. Overpass and the clone stay on
   the internal network.
2. In Cloudflare Zero Trust, Networks, Tunnels, the lobby's tunnel, Public Hostname, add: `3dtd-osm.sgeht.net`,
   service `HTTP`, URL `<PROXY_IP>:8080`. A name one level under the domain, so Cloudflare's free certificate
   covers it. The proxy's address is for the tunnel's connector only: never forward it on the router.
3. The status page: `http://<STATUS_IP>:8090/`.

On macvlan the server itself cannot reach its containers' addresses (a property of macvlan; ipvlan, or Unraid's
"Host access to custom networks" in the Docker settings, lifts it). That matters only where cloudflared runs on the
server's own network stack; a cloudflared in a container of its own network, or on another machine, reaches them.

Alternatives: ports on the server's own address (`COMPOSE_FILE=docker-compose.yml`, `PROXY_BIND` and `STATUS_BIND`,
the tunnel URL `<PROXY_BIND>:8088`; both bind to 127.0.0.1 without them); the cloudflared's Docker network
(`COMPOSE_FILE=docker-compose.yml:docker-compose.shared-tunnel.yml`, `TUNNEL_NETWORK`, URL `3dtd-osm-proxy:8080`);
a tunnel of its own (`COMPOSE_PROFILES=tunnel`, `CLOUDFLARE_TUNNEL_TOKEN`, URL `proxy:8080`).

The proxy takes the client's address from `CF-Connecting-IP` and its country from `CF-IPCountry` (`TRUST_CLOUDFLARE`),
but only on a connection from `TRUSTED_PROXIES`; on any other the connection's own address counts. The default,
`private`, trusts every local address: a machine in the LAN that reaches the proxy directly could name an address of
its choice and so slip past its rate limit, nothing more, and the proxy is not reachable from outside. To close that
too, set `TRUSTED_PROXIES` to the address the cloudflared connects from (its own, `/32`; behind a router between
networks the one the router passes on). While it is not trusted, the status page shows "?" under countries and the
proxy's log names the connecting address once (`Cloudflare headers from ..., not in TRUSTED_PROXIES`); a player's
address is never logged.

Check: `https://3dtd-osm.sgeht.net/api/interpreter?data=[out:json];node(1);out;` answers with a node;
`https://3dtd-osm.sgeht.net/api/status` answers 404.

## On Unraid

For the Unraid plugin Compose Manager Plus (mstrhakr/compose_plugin) the folder `unraid/` holds a stack of its
own: `docker-compose.yml` with the three services that run for good (Overpass, proxy, status page), the proxy and the
page at fixed addresses of their own on an external network (`LAN_NETWORK`, `STATUS_NETWORK`), no port on the server,
no profiles; `docker-compose.clone.yml` with the clone, run by hand; `env.example` for its `.env`. The plugin calls
`docker compose` with the stack's compose file and its override, and adds every file a `COMPOSE_FILE` in `.env`
names; with profiles in the file it asks which to start, and "all" would start the clone and the own tunnel too.
That is why this stack is one file without profiles, and why its `.env` has no `COMPOSE_FILE`. The services are the
same as in `docker-compose.yml`; `src/compose-files.spec.ts` holds the two alike.

```bash
mkdir -p /mnt/cache/appdata/3dtd-osm/data /mnt/cache/appdata/3dtd-osm/stats && cd /mnt/cache/appdata/3dtd-osm
raw=https://raw.githubusercontent.com/ingel81/3dtd/next/overpass-host/unraid
curl -fsSL -O "$raw/docker-compose.yml" -O "$raw/docker-compose.clone.yml"
curl -fsSL -o .env "$raw/env.example"     # LAN_NETWORK, PROXY_IP, STATUS_IP, TRUSTED_PROXIES
docker compose -f docker-compose.clone.yml run --rm clone
```

Then in the plugin: Add New Stack, Compose Source "External folder" `/mnt/cache/appdata/3dtd-osm/`, the ENV path left
empty (the `.env` of that folder, also editable in the stack's editor), Create; Compose Up starts the three services
(no profile dialog), Autostart keeps them up after a reboot, Update Stack pulls new images. A new clone by hand:
`docker stop 3dtd-overpass`, `docker compose -f docker-compose.clone.yml run --rm clone --fresh`, Compose Up. Proxy
and status page keep running meanwhile; the proxy answers 503 with `Retry-After: 1800` until the clone is complete.

The containers show in the Docker tab with the 3DTD logo (`net.unraid.docker.icon`); the status page's container has
the status page as its WebUI (`net.unraid.docker.webui`, Unraid fills in the container's own address). Keep the
database on a pool path (`/mnt/cache/...`) of a share without a secondary storage, so the mover never takes it to the
array.

## Status page

`http://<STATUS_IP>:8090/` from the LAN (or `http://<STATUS_BIND>:<STATUS_PORT>/` on a port of the server); it loads nothing from outside and reloads every
ten seconds. Requests over time by what became of them, answer times (median and 95 %), the boxes asked on a map of
the world or around where they were asked, countries, outcomes, refusals, the last problems; Overpass's state, the
time of its data and its running queries, the disk, the database's size, the memory of the Overpass container and of
the machine, a clone under way with its progress.

## Update

There are no running diffs: the data is as old as the clone. A new one when it is due:

```bash
docker compose stop overpass
docker compose run --rm clone --fresh
docker compose up -d overpass
```

(`reclone.sh` in the repository runs the same three lines.) Overpass is down for the 2 to 3 hours of the clone; the
proxy answers 503 with `Retry-After: 1800` meanwhile (the clone's maintenance flag), so the game leaves this server
alone and asks the public ones. Interrupted: `docker compose run --rm clone && docker compose up -d overpass`.

New images: `docker compose --profile clone pull && docker compose up -d`.

## What the proxy lets through

Only `/api/interpreter`, GET (`?data=`) or POST (a form with `data=`, or the query as the body, at most 256 kB); every
other path is 404, `/api/status` among them. Any Overpass QL query is taken when every query statement is held to an
area the proxy can measure:

- an explicit box `(south,west,north,east)`, the global `[bbox:...]`, `around:<radius>,<points>`, `poly:"..."`, ids,
  or an input set and recursion from one (bounded by what came before)
- no box longer than `MAX_EDGE_KM` (5 km) on an edge, and all boxes together at most `MAX_AREA_KM2` (30 km²); an
  `around` counts the band it sweeps, not its envelope (the game's buildings ask a band of 50 m along the routes)
- no areas (`area`, `(area)`, `is_in`: this host builds none), no history (`[date]`, `[diff]`, `[adiff]`), no XML
- `[timeout:]` and `[maxsize:]` above `MAX_TIMEOUT_S` (90 s) and `MAX_MAXSIZE_MB` (256 MB), or missing, become the cap

The game's largest queries fit: the streets of a place are one box of 4 km, an OSM world 2.6 km with 90 s and
256 MB, the buildings a band along the routes.

| Status | When | The game's client |
|--------|------|-------------------|
| 400 | The query is refused (the text says why) | Asks the next server at once |
| 403 | A page not in `ALLOWED_ORIGINS` | Sees no answer (no CORS header), asks the next |
| 413 | The query is longer than 256 kB | Asks the next |
| 429 | The client's rate (`RATE_BURST`, `RATE_PER_MINUTE`) or its queries at once (`RATE_CONCURRENT`), with `Retry-After` | Pauses this server, at least 30 s |
| 503 | No slot within `QUEUE_WAIT_S` (`Retry-After: 15`), Overpass not reachable (300), a new clone (1800) | Pauses this server for Retry-After |
| 504 | Overpass took 30 s longer than the query's own timeout | Asks again later |

Every answer of the proxy carries the CORS header for an allowed page, so the game reads the status instead of a
network error. Requests without an `Origin` (no browser) pass unless `ALLOW_NO_ORIGIN=0`; an Origin is easy to fake
outside a browser, so the limits above are what protect the server. The pages allowed by default are the web game,
the desktop app (`app://app`) and the dev server (`http://localhost:4200`). Limits per client count an IPv4 address,
and an IPv6 address by its /64.

All settings with their defaults: [.env.example](.env.example).

## Privacy

The proxy holds a client's address only in memory while its rate bucket is not full again, and never writes it, nor
does it pass it to Overpass. The statistics (`STATS_DIR/requests.sqlite`, `STATS_DAYS` days, 30 by default) keep per
request: the time, the status and outcome, the durations, the bytes sent, the country Cloudflare names, the hull of
the query's boxes and its area, and for a refusal its kind. Not the address, not the query.

## A test with a region

The whole stack with a regional extract instead of the planet; Overpass builds it from the extract on its first start
(Unterfranken: 100 MB, 4 minutes, 3.7 GB of database):

```bash
OVERPASS_DATA=/some/empty/dir docker compose -f docker-compose.yml -f docker-compose.extract.yml up -d
```

To run the images built from the sources here instead of the published ones, add `-f docker-compose.build.yml` and
`docker compose ... build` first; they take the published names, so nothing is pulled over them.

`EXTRACT_URL` picks another Geofabrik extract. Started with the two `-f` files as above (they replace `COMPOSE_FILE`),
the proxy answers on `http://127.0.0.1:8088` of the machine and the status page on `http://127.0.0.1:8090`.

Measured 2026-10-18 with Unterfranken, the game's queries through the proxy on a desktop machine (WSL 2): the streets
of a place (4 km) 80 to 250 ms, the buildings along four routes of 1.5 km 0.45 to 1.1 s, an OSM world (2.6 km, 4 to
12 MB of JSON) 0.4 to 0.8 s; eight OSM worlds at once in 0.6 s together. The planet's database is far larger than the
memory, so the first query of a region there waits on the disk; those numbers are still to be measured on the host.

## Tests

`npm test` in the repository runs the specs of `src/` (the query check against the game's own queries, the limits,
the proxy against a stand-in for Overpass, the statistics). `npx tsc -p overpass-host/tsconfig.json` checks the types.
