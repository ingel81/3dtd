# 3DTD

[![CI](https://github.com/ingel81/3dtd/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ingel81/3dtd/actions/workflows/ci.yml)
[![Desktop release](https://github.com/ingel81/3dtd/actions/workflows/release.yml/badge.svg)](https://github.com/ingel81/3dtd/actions/workflows/release.yml)
[![Relay image](https://github.com/ingel81/3dtd/actions/workflows/relay-image.yml/badge.svg)](https://github.com/ingel81/3dtd/actions/workflows/relay-image.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

**[3dtd.sgeht.net](https://3dtd.sgeht.net)**: project page with screenshots, all videos and the downloads.

Tower defense on your actual street. You type in an address, the game loads the
photorealistic 3D tiles for that place, and enemies walk up the real roads towards
your base. Alone, or with up to three friends, each holding a road of their own.

[![Co-op best-of on YouTube](https://img.youtube.com/vi/zqb4eTpsdnc/maxresdefault.jpg)](https://youtu.be/zqb4eTpsdnc)

**[Co-op best-of, 15:24](https://youtu.be/zqb4eTpsdnc)**: our first co-op match, Heilbronn, waves 1 to 38,
narrated. **[Walkthrough, 6:42](https://youtu.be/XoRsYuTkUmA)**: mostly Frankfurt am Main, with the mechanics
explained along the way. The rest is on the [project page](https://3dtd.sgeht.net/#media).

A hobby project. It runs, it's playable, and it is nowhere near finished.

## Playing it

**Play the desktop app.** That is where the work goes now: co-op lives there, every player runs the same engine,
and it keeps itself up to date. [Windows installer](https://github.com/ingel81/3dtd/releases/latest/download/3DTD-win-x64-setup.exe)
or [Linux AppImage](https://github.com/ingel81/3dtd/releases/latest/download/3DTD-x86_64.AppImage) (x64), the
newest build of each; older ones are on the [releases page](https://github.com/ingel81/3dtd/releases).

- Windows: not code-signed yet, so SmartScreen warns on the first start: *More info*, then *Run anyway*.
- Linux: make the AppImage executable (`chmod +x`) and keep it where you can write, since an update rewrites
  the file. It needs FUSE 2 (`libfuse2` on Ubuntu, `fuse2` on Arch), or start it with `--appimage-extract-and-run`.

To try it without installing anything, there is a browser version at
[3dtd.sgeht.net/play/](https://3dtd.sgeht.net/play/), solo only.

Either way you need your own **Cesium ion token**. The tiles are billed per request, so there is no shared key. The
free tier is enough: sign up at [ion.cesium.com](https://ion.cesium.com/signup), copy the default token, paste it
when the game asks. The token stays on your machine and goes to Cesium, nowhere else. A Google Maps API key with
the Map Tiles API works too. In the app, a token restricted to certain websites, or a Google Maps key with an HTTP
referrer restriction, does not work.

It wants a desktop with a fast CPU, since the whole game runs in JavaScript, a decent GPU for the tiles, a mouse
and a keyboard. Late waves put thousands of enemies on top of a live tile stream.

## Co-op

Two to four players defend one base in the same city. Everyone gets a spawn and so a lane of their own, their own
gold, towers, research and hero, and may build anywhere. Waves are sized per lane, against that lane's share of the
defence.

It runs in lockstep: every machine simulates the whole game, and the commands travel through a small relay that
closes the ticks and compares a hash of the game state every second. The host's map and lines of sight travel too:
sight is read off each machine's own tiles, so the host's counts for everyone. Online there is a public lobby for the desktop app; on a local network the
app hosts the relay itself and the others find the game without typing an address.

The relay is [coop-server/](coop-server/README.md), a single Node file with `ws`, also as a container
(`ghcr.io/ingel81/3dtd-relay`). It keeps no accounts and no game state beyond the open rooms. Design and decisions:
[docs/COOP_PLAN.md](docs/COOP_PLAN.md).

## What makes it different from a normal tower defense

The map isn't authored, it's streamed from Google's Photorealistic 3D Tiles. That has one interesting consequence:
the tiles are not scenery, they are the world the game rules run against.

- **Routes follow real streets.** The street graph comes from OpenStreetMap via Overpass. The route runs through a
  grid of 2 m cells, and each cell is raycast straight down onto the tile surface to get its height, so paths follow
  the actual terrain.
- **The street is as wide as the tiles say.** Horizontal rays either side of the route find the facades, and the
  corridor enemies spread across ends there. Where the tiles can't tell, the OSM width or a typical width for the
  road class fills in.
- **Buildings block line of sight.** A tower only fires at what it can actually see. For each tower the surrounding
  tiles get rendered into a cubemap, the depth is read back, and every route cell in range remembers whether the
  tower can see it. Standing behind a building works.
- **Tower placement probes the ground** with a raycast against the tiles. Rooftops, embankments and bridges sit at
  their real height.

The annoying part is level of detail. When a tile refines while you're playing, the ground underneath an already
placed route moves, so every height sampled from it has to be re-anchored. Sample tile depth is tracked for exactly
this reason.

## Where the waves come from

Waves follow a run plan: every wave has its enemies, their spacing and how hard it is meant to be written down.
How tough they are is set when the wave is planned, as a budget against what your towers deal, nudged by how hard
your base was pressed lately. It started out as a small neural net trained with PPO; measured against random
choices it did no better, and plain rules did, so rules it is. Details in
[docs/WAVE_RUN_PLAN.md](docs/WAVE_RUN_PLAN.md).

## Tech

| | |
|---|---|
| Frontend | [Angular](https://angular.dev) 22, standalone components, signal stores |
| UI | [Angular Material](https://material.angular.dev) 22 |
| Rendering | [Three.js](https://threejs.org) 0.186 |
| Tiles | [3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) 0.5.2 |
| Geometry | [Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles), via [Cesium Ion](https://cesium.com/platform/cesium-ion/) or the Google Maps API directly |
| Map data | [OpenStreetMap](https://www.openstreetmap.org/copyright) ([Overpass](https://overpass-api.de) for streets and buildings, [Nominatim](https://nominatim.org) for geocoding) |
| Desktop | [Electron](https://www.electronjs.org) 44, NSIS installer (Windows), AppImage (Linux), updates from GitHub Releases ([desktop/](desktop/README.md)) |
| Co-op | lockstep over a small Node relay ([coop-server/](coop-server/README.md)), in the desktop app also on the LAN |
| Tests | [Vitest](https://vitest.dev), [Playwright](https://playwright.dev) ([e2e/](e2e/README.md)) |

The game client is fully client side. There is no game server and no account for the game itself; the one sign-up
is the Cesium ion account for your own tile key. Online co-op goes through the relay above.

## Running it locally from source

You need Node 22.22.3 or 24.15 (or later) and npm 11.

1. Get the code and its dependencies:
   ```bash
   git clone https://github.com/ingel81/3dtd.git
   cd 3dtd
   npm install
   ```
2. Create the two environment files. They are gitignored and hold no keys:
   ```bash
   cp src/environments/environment.template.ts src/environments/environment.ts
   cp src/environments/environment.template.ts src/environments/environment.prod.ts
   ```
3. In `src/environments/environment.prod.ts`, set `production: true`.
4. Start the dev server and open [http://localhost:4200](http://localhost:4200):
   ```bash
   npm start
   ```
5. Paste your Cesium ion token (or Google Maps key) when the game asks. It stays in your browser.

To skip step 5 every time, put the token into `environment.ts`.

Other commands:

```bash
npm run build        # production build into dist/
npm test             # vitest
npm run lint
npm run e2e          # browser tests against the running dev server (docs/E2E.md)
npm run coop-server  # the coop relay on port 3003; the dev game finds it by itself
```

If you just want to poke at the code, there's **DevWorld**: a seeded offline world with generated buildings and
streets, no tiles and no network. Append `?devworld` to the URL. It loads in well under a second instead of several,
which is also why the bot runs use it. See [docs/DEVWORLD.md](docs/DEVWORLD.md).

## Layout

```
src/app/
├── three-engine/      3D rendering, tiles, post processing, GPU line of sight
├── game-engine/       event bus, effects, audio
├── managers/          game logic, event driven
├── entities/          enemies, towers, projectiles
├── configs/           towers, enemies, projectiles, damage matrix, wave curriculum
├── store/             signal stores, single source of truth
├── services/          Angular side: facades, location, combat, world, debug
├── director/          wave sources: the rule-based director and the wave table
├── coop/              lockstep co-op: protocol, world package, hash check
├── simulator/         deterministic simulation: snapshots, re-simulation, replays
├── replay/            replay bar (a replay re-simulates the wave)
├── bots/              strategy bots for bot runs
└── devworld/          offline dev environment

coop-server/           Node relay for co-op, also the container image
desktop/               the desktop app: Electron shell around the same build, LAN hosting
bot-server/            optional Python side: bot runs, their log and a dashboard
e2e/                   Playwright tests of the dev game
landing/               the project page, plain HTML
```

Managers talk to each other over an event bus rather than calling into each other directly.
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/EVENT_SYSTEM.md](docs/EVENT_SYSTEM.md) explain why.

## Docs

- [docs/INDEX.md](docs/INDEX.md): entry point to the technical docs
- [CHANGELOG.md](CHANGELOG.md): what changed for players, per release
- [TODO.md](TODO.md): open work; [DONE.md](DONE.md): log of finished work

## Status and caveats

- Hobby project, built in evenings. No roadmap, no release schedule, no support.
- Expect rough edges. Some places load beautifully, others have tile geometry that makes pathfinding do silly things.
  Late waves are not balanced yet.
- Performance depends on your CPU first, then your GPU, and on how dense the tiles are where you play.
- Contributions: the code is AGPL and I can't merge outside pull requests without a contributor agreement yet.
  Issues and ideas are welcome.
- Licensed under the GNU Affero General Public License v3.0, see [LICENSE](LICENSE). Third party assets keep their
  own licenses, listed in the in-game attributions.
