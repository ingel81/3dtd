# 3DTD

Tower defense on your actual street. You type in an address, the game loads the
photorealistic 3D tiles for that place, and enemies walk up the real roads towards
your base.

<!-- TODO: drop a gameplay gif or screenshot here -->

**[3dtd.sgeht.net](https://3dtd.sgeht.net)**, project page, screenshots, and a
playable build under [/play/](https://3dtd.sgeht.net/play/). You bring your own
Cesium Ion token; the game asks for it on first start and keeps it in your browser.

A hobby project. It runs, it's playable, and it is nowhere near finished.

## What makes it different from a normal tower defense

The map isn't authored, it's streamed from Google's Photorealistic 3D Tiles. That has
one interesting consequence: the tiles are not scenery, they are the world the game
rules run against.

- **Routes follow real streets.** The street graph comes from OpenStreetMap via
  Overpass. Each waypoint is raycast straight down onto the tile surface to get its
  height, so paths follow the actual terrain.
- **Buildings block line of sight.** A tower only fires at what it can actually see.
  For each tower the surrounding tiles get rendered into a cubemap once, the depth is
  read back, and the result is kept as a visibility mask over the tower's range.
  Standing behind a building works.
- **Tower placement probes the ground** with a raycast against the tiles.

The annoying part is level of detail. When a tile refines while you're playing, the
ground underneath an already placed route moves, so every height sampled from it has
to be re-anchored. Sample tile depth is tracked for exactly this reason.

## Tech

| | |
|---|---|
| Frontend | Angular 21, standalone components, signal stores |
| Rendering | Three.js 0.184 |
| Tiles | [3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) 0.4.24 |
| Geometry | Google Photorealistic 3D Tiles, via Cesium Ion or the Google Maps API directly |
| Map data | OpenStreetMap (Overpass for streets and buildings, Nominatim for geocoding) |

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
├── managers/          game logic, event driven
├── entities/          enemies, towers, projectiles
├── store/             signal stores, single source of truth
├── services/          Angular side: location, combat, world, debug
├── ai/                the wave director and the training bots
└── devworld/          offline dev environment

training-backend/      optional Python side, PPO training for the wave director
```

Managers talk to each other over an event bus rather than calling into each other
directly. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/EVENT_SYSTEM.md](docs/EVENT_SYSTEM.md) explain why.

## Where the waves come from

Waves aren't a fixed table. A director picks a template and four shape factors (how
many, how fast, how tough, how mixed) each wave, and a closed loop on the fraction of
enemies that actually reach your base keeps the size honest.

That director used to be a small neural net, trained with PPO in `training-backend/`
and run in the browser through onnxruntime-web. It got replaced by a page of rules,
because an A/B against a uniform random sampler said the net wasn't doing
anything: three runs, statistically indistinguishable, and two trivial heuristics beat
both. The interesting part is *why*, the curriculum and the fairness cap between them
had left almost nothing to decide. Full write-up in
[docs/AI_WAVE_DIRECTOR_PLAN.md](docs/AI_WAVE_DIRECTOR_PLAN.md).

So the game needs no Python, no model file and no ONNX runtime to run. The model path
is still there behind a button in the debug window, kept for a future run trained on
real player data instead of against a scripted bot.

## Docs

There's more written down than is usual for a project this size, mostly because I keep
forgetting how my own systems work. [docs/INDEX.md](docs/INDEX.md) is the entry point.
[TODO.md](TODO.md) is what's still open, [DONE.md](DONE.md) is the changelog.

## Status and caveats

- Hobby project, built in evenings. No roadmap, no release schedule, no support.
- Expect rough edges. Some places load beautifully, others have tile geometry that
  makes pathfinding do silly things.
- Performance depends heavily on your GPU and on how dense the tiles are where you live.
- Licensed under the GNU Affero General Public License v3.0, see [LICENSE](LICENSE).
  Third party assets keep their own licenses, listed in the in-game attributions.
