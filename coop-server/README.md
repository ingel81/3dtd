# 3DTD coop relay

The relay coop rooms play over: rooms, ticks, chat, nothing else. It keeps no accounts and no game state beyond the
rooms that are open, and it never writes an IP address. Design and decisions: [docs/COOP_PLAN.md](../docs/COOP_PLAN.md)
(C4, C7, D56 to D68).

## On the dev machine

```bash
npm run coop-server                      # port 3003, cheats allowed, log in logs/
npm run coop-server -- --no-cheats       # as a public lobby would
```

The dev game on `http://localhost:4200` finds it by itself ("This machine" under Online). The desktop app runs its own
relay for LAN games; nothing to set up for that.

## Options

| Option | Meaning |
|--------|---------|
| `--port N` | Port, 3003 by default |
| `--no-cheats` | Rooms refuse the dev tools' cheats whatever the host sets |
| `--origins a,b` | Browsers only from these pages (`Origin`); the desktop app is `app://app`. Clients without an Origin pass. Without the option every page may |
| `--status local` | The status page (`/`, `/status`, `/text`, `/metrics.json`, `/log.json`) only for this machine and the local network, not for what comes through a Cloudflare tunnel. `/healthz` answers everyone |
| `--admin-token T` | The status page may close rooms and drop players for whoever enters `T`. Better as the environment variable `RELAY_ADMIN_TOKEN` (a process list shows arguments). Without it the page only reads |
| `--log-dir DIR` | Where `coop_<day>.log` goes (`logs/` in the repository by default) |
| `--log-days N` | Delete log days older than N |

## Status page

`http://<relay>:3003/` (from the machine or the LAN; `--status local` keeps it off the tunnel): uptime, connections,
lobbies and games, traffic, what was dropped and why (too fast, malformed, too slow to read, guessing room codes, no
hello, hanging, taken out), refused connections, errors, memory; curves of the last hour (in memory, gone with a
restart); the rooms with their players, ping, tick, desync; the last 200 log lines. It reloads every five seconds and
loads nothing from outside. The admin token goes into the field under the rooms; "Unlock" asks the relay
(`POST /admin/check`) and says whether it is right. Only then do the rooms get "drop" (a player) and "close room".
A metrics line goes to the log once a minute when something changed (memory alone is no change).

## Limits

What keeps one client from taking the relay down (relay review 2026-09-26): every message is checked field by field
and cut (`validate.ts`), and handled in a try/catch, a failing one drops only that connection; 1 MB per message, 120
messages a second, a command at most 256 kB, a world at most once a second; 500 connections, 8 from one address
(counted in memory only, never logged), a hello within 10 s; a client that leaves 8 MB unread is dropped; 20 room codes
that do not exist and the connection is closed; three missed heartbeats (15 s) let a player go, a player the room
waited on for 30 s as well (their lane closes, the others play on); a lobby closes after an hour, a game without a
command after three hours. A day's log file stops at 50 MB, the console goes on.

## The public lobby, behind a Cloudflare tunnel

The image is `ghcr.io/ingel81/3dtd-relay`, built by the workflow `relay-image.yml`: with every release (`:0.5.0`,
`:latest`), and by hand for any branch (GitHub, Actions, Relay image, Run workflow; tagged with the branch, e.g. `:coop`).
Its default arguments are the public lobby's: `--status local --log-days 14 --origins app://app` (only the desktop
app, D59).

1. **The first time:** on GitHub under Packages, `3dtd-relay`, set the visibility to public, so a Docker host
   pulls it without logging in.
2. **Container** on any Docker host:
   - Repository `ghcr.io/ingel81/3dtd-relay:latest`
   - Network: the one your `cloudflared` container is on (a custom bridge), so the tunnel reaches it by name
   - Volume: container `/app/logs` → a folder of the host for the logs
   - No port mapping needed; map `3003` only to read the status page from the LAN (`http://<server>:3003/`)
   - Restart policy: unless stopped. The image has a `HEALTHCHECK` on `/healthz`; plain Docker only marks an
     unhealthy container, a watchdog such as `willfarrell/autoheal` restarts it
   - Worth adding: `--read-only --cap-drop=ALL --security-opt=no-new-privileges --memory=256m --pids-limit=100`, and a
     network that cannot reach anything sensitive; the relay needs no outbound connections

   Or with compose: [docker-compose.example.yml](docker-compose.example.yml).
3. **Tunnel:** in Cloudflare Zero Trust, Networks, Tunnels, your tunnel, Public Hostname: `3dtd-lobby.sgeht.net`,
   service `HTTP`, URL `3dtd-relay:3003` (the container's name). WebSockets pass by default.
4. **The game:** `runtime-config.json` of the web build and the app names the lobby:

   ```json
   { "coopLobbies": [{ "name": "3DTD Lobby", "url": "wss://3dtd-lobby.sgeht.net", "desktopOnly": true }] }
   ```

   `desktopOnly` keeps it out of the web version, whose pages the lobby refuses (D59). Use a name one level under
   the domain: Cloudflare's free certificate covers `*.sgeht.net`, not `*.3dtd.sgeht.net`.
   In Cloudflare, a rate limiting rule on the hostname adds a limit before the relay (optional).

5. **Check:** the container's log starts with `relay <build>, protocol <n>` (the build is the image's version or
   branch and commit, e.g. `coop (327bb299)`); the status page from the LAN or with
   `docker exec 3dtd-relay wget -qO- http://localhost:3003/text` names the same. `https://3dtd-lobby.sgeht.net/status`
   answers `not here` from outside (the status page is local only);
   in the game, Online, the gear, "Check 3DTD Lobby" says the lobby answers.

**With every release** the relay has to speak the apps' protocol: pull the new image and restart the
container. Apps of another version are refused with both versions named and told to update. A stop (SIGTERM) tells
the players the relay restarts (close code 1012) instead of a lost connection; games running then end.

## Privacy

What the relay sees: the name a player types, the room code, which engine and system the client runs on (for the
coop warning about mixed engines), the commands of the game, and the address a connection comes from (behind the
tunnel the one Cloudflare passes on). What it keeps: a log per day with times, room codes and names, deleted after 14
days. The address is only counted in memory while the connection is open, to limit how many one machine opens; it is
never logged or written anywhere.

A paragraph for the privacy notice of the landing page:

> **Online coop.** If you play coop online, your game connects to our lobby server (3dtd-lobby.sgeht.net, run through
> Cloudflare). It passes your moves to the other players of your room. The server keeps a log with the time, the room
> code and the name you chose, for 14 days, to find errors; it does not store IP addresses. Cloudflare processes the
> connection as our network provider. Coop on the same network (LAN) does not use the lobby.
