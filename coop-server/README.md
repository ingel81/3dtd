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
| `--status local` | The status page (`/`, `/status`) only for this machine and the local network, not for what comes through a Cloudflare tunnel |
| `--log-dir DIR` | Where `coop_<day>.log` goes (`logs/` in the repository by default) |
| `--log-days N` | Delete log days older than N |

## The public lobby on Docker-Host, behind a Cloudflare tunnel

The image is `ghcr.io/ingel81/3dtd-relay`, built by the release workflow for every version (`:0.5.0`, `:latest`).
Its default arguments are the public lobby's: `--status local --log-days 14 --origins app://app` (only the desktop
app, D59).

1. **The first time:** on GitHub under Packages, `3dtd-relay`, set the visibility to public, so Docker-Host pulls it
   without logging in.
2. **Container** (Docker tab, Add Container):
   - Repository `ghcr.io/ingel81/3dtd-relay:latest`
   - Network: the one your `cloudflared` container is on (a custom bridge), so the tunnel reaches it by name
   - Path: container `/app/logs` → host `/mnt/user/appdata/3dtd-relay/logs`
   - No port mapping needed; map `3003` only to read the status page from the LAN (`http://<server>:3003/`)
   - Restart policy: unless stopped

   Or with compose: [docker-compose.example.yml](docker-compose.example.yml).
3. **Tunnel:** in Cloudflare Zero Trust, Networks, Tunnels, your tunnel, Public Hostname: `lobby.3dtd.sgeht.net`,
   service `HTTP`, URL `3dtd-relay:3003` (the container's name). WebSockets pass by default.
4. **The game:** `runtime-config.json` of the web build and the app names the lobby:

   ```json
   { "coopLobbies": [{ "name": "3DTD Lobby", "url": "wss://lobby.3dtd.sgeht.net" }] }
   ```

5. **Check:** `https://lobby.3dtd.sgeht.net/status` answers `not here` from outside (the status page is local only);
   in the game, Online, the gear, "Check 3DTD Lobby" says the lobby answers.

**With every release** the relay has to speak the apps' protocol: pull the new image (Docker-Host: "Update" on the
container). Apps of another version are refused with both versions named and told to update.

## Privacy

What the relay sees: the name a player types, the room code, which engine and system the client runs on (for the
coop warning about mixed engines), the commands of the game. What it keeps: a log per day with times, room codes and
names, deleted after 14 days. It never stores IP addresses; behind the tunnel it does not even see them.

A paragraph for the privacy notice of the landing page:

> **Online coop.** If you play coop online, your game connects to our lobby server (lobby.3dtd.sgeht.net, run through
> Cloudflare). It passes your moves to the other players of your room. The server keeps a log with the time, the room
> code and the name you chose, for 14 days, to find errors; it does not store IP addresses. Cloudflare processes the
> connection as our network provider. Coop on the same network (LAN) does not use the lobby.
