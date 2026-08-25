# 3DTD

Tower defense on your actual street. You type in an address, the game loads the
photorealistic 3D tiles for that place, and enemies walk up the real roads towards
your base.

<!-- TODO: drop a gameplay gif or screenshot here -->

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

The game client is fully client side. No game server, no accounts, nothing to sign up for.

## Running it locally

You need your own API keys. The tiles are not free to serve, so there are no keys in
this repo and there won't be.

1. Get a **Cesium Ion token** (free tier is enough) or a **Google Maps API key** with
   the Map Tiles API enabled.
2. Copy the environment template and fill it in. `npm start` reads the first file,
   `npm run build` swaps in the second, so create both:
   ```bash
   cp src/environments/environment.template.ts src/environments/environment.ts
   cp src/environments/environment.template.ts src/environments/environment.prod.ts
   ```
   Both are gitignored. Set `production: true` in the prod one.
3. Install and run:
   ```bash
   npm install
   npm start          # http://localhost:4200
   ```

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
├── ai/                bots and the ONNX wave director
└── devworld/          offline dev environment

training-backend/      optional Python side, PPO training for the wave director
```

Managers talk to each other over an event bus rather than calling into each other
directly. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/EVENT_SYSTEM.md](docs/EVENT_SYSTEM.md) explain why.

## The AI part

Waves aren't a fixed table. A small neural net picks what to send at you based on how
the run is going. It's trained offline with PPO in `training-backend/` (Python,
PyTorch), exported to ONNX, and runs in the browser via onnxruntime-web.

This is entirely optional to the game and a rabbit hole of its own. Start at
[docs/AI_WAVE_DIRECTOR_PLAN.md](docs/AI_WAVE_DIRECTOR_PLAN.md) if that sounds fun.

## Docs

There's more written down than is usual for a project this size, mostly because I keep
forgetting how my own systems work. [docs/INDEX.md](docs/INDEX.md) is the entry point.
[TODO.md](TODO.md) is what's still open, [DONE.md](DONE.md) is the changelog.

## Status and caveats

- Hobby project, built in evenings. No roadmap, no release schedule, no support.
- Expect rough edges. Some places load beautifully, others have tile geometry that
  makes pathfinding do silly things.
- Performance depends heavily on your GPU and on how dense the tiles are where you live.
- No license file yet, so default copyright applies. Ask if you want to do something
  with it.
