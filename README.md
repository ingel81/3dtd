# 3DTD

Tower defense on your actual street. You type in an address, the game loads the
photorealistic 3D tiles for that place, and enemies walk up the real roads towards
your base.

[![A walkthrough on YouTube](https://img.youtube.com/vi/XoRsYuTkUmA/maxresdefault.jpg)](https://youtu.be/XoRsYuTkUmA)

**[A walkthrough, 6:42](https://youtu.be/XoRsYuTkUmA)**, mostly Frankfurt am Main,
with the mechanics explained along the way.

**[3dtd.sgeht.net](https://3dtd.sgeht.net)**, project page, screenshots, and a
playable build under [/play/](https://3dtd.sgeht.net/play/). You bring your own
Cesium Ion token; the game asks for it on first start and keeps it in your browser.

**Desktop app:** the [releases page](https://github.com/ingel81/3dtd/releases/latest)
has a Windows installer and a Linux AppImage (x64). Both keep themselves up to date.
Windows: not code-signed yet, so SmartScreen warns on the first start: click *More info*,
then *Run anyway*. Linux: make the AppImage executable (`chmod +x`) and keep it where you
can write, since an update rewrites the file; it needs FUSE 2 (`libfuse2` on Ubuntu,
`fuse2` on Arch), or start it with `--appimage-extract-and-run`. Both need your own
Cesium Ion token; a token restricted to certain websites, or a Google Maps key
with an HTTP referrer restriction, does not work in the app.

A hobby project. It runs, it's playable, and it is nowhere near finished.

## What makes it different from a normal tower defense

The map isn't authored, it's streamed from Google's Photorealistic 3D Tiles. That has
one interesting consequence: the tiles are not scenery, they are the world the game
rules run against.

- **Routes follow real streets.** The street graph comes from OpenStreetMap via
  Overpass. The route runs through a grid of 2 m cells, and each cell is raycast
  straight down onto the tile surface to get its height, so paths follow the actual
  terrain.
- **The street is as wide as the tiles say.** Horizontal rays either side of the
  route find the facades, and the corridor enemies spread across ends there. Where
  the tiles can't tell, the OSM width or a typical width for the road class fills in.
- **Buildings block line of sight.** A tower only fires at what it can actually see.
  For each tower the surrounding tiles get rendered into a cubemap, the depth is
  read back, and every route cell in range remembers whether the tower can see it.
  Standing behind a building works.
- **Tower placement probes the ground** with a raycast against the tiles.

The annoying part is level of detail. When a tile refines while you're playing, the
ground underneath an already placed route moves, so every height sampled from it has
to be re-anchored. Sample tile depth is tracked for exactly this reason.

## Tech

| | |
|---|---|
| Frontend | [Angular](https://angular.dev) 22, standalone components, signal stores |
| UI | [Angular Material](https://material.angular.dev) 22 |
| Rendering | [Three.js](https://threejs.org) 0.186 |
| Tiles | [3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) 0.5.2 |
| Geometry | [Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles), via [Cesium Ion](https://cesium.com/platform/cesium-ion/) or the Google Maps API directly |
| Map data | [OpenStreetMap](https://www.openstreetmap.org/copyright) ([Overpass](https://overpass-api.de) for streets and buildings, [Nominatim](https://nominatim.org) for geocoding) |
| Desktop | [Electron](https://www.electronjs.org) 44, NSIS installer, updates from GitHub Releases ([desktop/](desktop/README.md)) |
| Tests | [Vitest](https://vitest.dev) |
| AI training | [PyTorch](https://pytorch.org) (offline, for the wave director experiments) |

The game client is fully client side. There is no game server and no account for the game itself; the one sign-up is the Cesium Ion account for your own tile key.

## Running it locally

You need your own API key. The tiles are not free to serve, so there are no keys in
this repo and there won't be.

1. Copy the environment template. `npm start` reads the first file, `npm run build`
   swaps in the second, so create both (they are gitignored):
   ```bash
   cp src/environments/environment.template.ts src/environments/environment.ts
   cp src/environments/environment.template.ts src/environments/environment.prod.ts
   ```
   Set `production: true` in the prod one. Leave the keys empty.
2. Install and run:
   ```bash
   npm install
   npm start          # http://localhost:4200
   ```
3. The game asks for credentials on first start and keeps them in your browser.
   Take either route to the same tiles: a **Cesium Ion token** (free tier is enough,
   the default) or a **Google Maps API key** with the Map Tiles API enabled.

If you would rather not type it every time, put the token into `environment.ts`, or
into `public/runtime-config.json` for a deployment that should carry its own key.

Other commands:

```bash
npm run build        # production build into dist/
npm test             # vitest
npm run lint
```

If you just want to poke at the code, there's **DevWorld**: a seeded offline world with
generated buildings and streets, no tiles and no network. Append `?devworld` to the URL.
It loads in well under a second instead of several, which is also why the AI training
runs on it. See [docs/DEVWORLD.md](docs/DEVWORLD.md).

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
├── ai/                the wave director and the training bots
├── replay/            replay of the last wave
└── devworld/          offline dev environment

bot-server/            optional Python side: bot runs, their log and a dashboard
desktop/               the desktop app: Electron shell around the same build
```

Managers talk to each other over an event bus rather than calling into each other
directly. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/EVENT_SYSTEM.md](docs/EVENT_SYSTEM.md) explain why.

## Where the waves come from

Waves aren't a fixed table. A director picks a template and four shape factors (how
many, how fast, how tough, how mixed) each wave, and a closed loop on the fraction of
enemies that actually reach your base keeps the size honest.

That director used to be a small neural net, trained with PPO and run in the browser
through onnxruntime-web. It got replaced by a page of rules, because an A/B against a
uniform random sampler said the net wasn't doing anything: three runs, statistically
indistinguishable, and two trivial heuristics beat both. The interesting part is *why*,
the campaign and the survivability cap between them had left almost nothing to decide.
Full write-up in [docs/WAVE_DIRECTOR.md](docs/WAVE_DIRECTOR.md).

So the game needs no Python, no model file and no ONNX runtime to run. The model path
was removed with the rest of the training stack on 2026-09-20; the rules are the only
director there is.

## Docs

There's more written down than is usual for a project this size, mostly because I keep
forgetting how my own systems work. [docs/INDEX.md](docs/INDEX.md) is the entry point.
[CHANGELOG.md](CHANGELOG.md) is what changed for players, release by release. [TODO.md](TODO.md) is what's still
open, [DONE.md](DONE.md) is the detailed log of the work.

## Status and caveats

- Hobby project, built in evenings. No roadmap, no release schedule, no support.
- Expect rough edges. Some places load beautifully, others have tile geometry that
  makes pathfinding do silly things.
- Performance depends heavily on your GPU and on how dense the tiles are where you live.
- Licensed under the GNU Affero General Public License v3.0, see [LICENSE](LICENSE).
  Third party assets keep their own licenses, listed in the in-game attributions.
