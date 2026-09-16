# OSM fixtures for corridor scenes

Real route geometry for scene tests of the route corridor (phase 2, the enemies' line in the middle of the
walkable band, `tmp/archive-2026-09/fix1/reports/phase2-design.md`). Lesson from playtest 732: a scene on a modelled line 0.9 m
off the real one passed while the game failed. Scenes build on these lines, not on hand-drawn ones.

| File | Place | Route | For |
|---|---|---|---|
| `erlenbach-732.json` | `?l=49.17337,9.26851&s=49.17434,9.25915` | 11 ways, way 959083801 Erlenbacher Weg | parked cars along the line, street on one side only, holes, columns without a hit |
| `erlenbach-weinsberger-a6.json` | spawn and HQ set on L 1101 either side of the A6 | 3 ways of L 1101 (230161782, 230161781, 283608415), under the A6 decks 15258911, 15258913 | a route under a bridge of another way (tunnel) |
| `rothenburg-galgengasse.json` | `?l=49.37721,10.17904&s=49.37944,10.18365` | 14 ways, Galgengasse 1115686347, Georgengasse 139711828 `tunnel=yes`, 39 structures | a car hollow in the mesh, the archway through the gate tower Weisser Turm (139711833), the cells before the arcade of the town hall on the Marktplatz (1311003086) |
| `berlin-platz-der-republik.json` | `?l=52.51630,13.37759&s=52.51861,13.37529` | 13 ways across the square | an open square with small objects |
| `paris-pont-d-iena.json` | `?l=48.85889,2.29320&s=48.86239,2.29190` | 8 ways, Place de Varsovie to the bridge 1322092757 | the stretch off a bridge end, a hollow under the road |

## Format

One JSON object per file:

- `scene`, `description`, `url` (the playtest URL, `null` where spawn and HQ were set for the fixture).
- `hq`, `spawn`: lat, lon. The engine's local frame has its origin at the HQ (`setOrigin`).
- `frame`: how the `cells` are placed: `EllipsoidSync.geoToLocalSimple` around `hq`, x = -east, z = +north, metres.
- `source`: the Overpass query, the date it was fetched and the licence.
- `route.wayIds`: the ways the route runs on, in order; `route.underWayIds`: ways it passes under
  (`UnderpassIndex`), kept so the underpass is found.
- `routePoints`: the route as `[lat, lon]` after `extendPathToOptimalTurnoff` and `leavePathForBase`, before the
  cut at underpasses and before the corridor splits it.
- `elements`: Overpass nodes and ways, only those of `route.wayIds` and `route.underWayIds`, with their tags.
- `cells`: grid spots from the playtest cell reports: `x`, `z` (cell centre, local frame), `heightM` (the cell's
  height or the column's lowest hit), `topM` (highest hit where reported), `cell: false` for a spot the corridor
  lost, `what`, `from` (the report).
- `picks`: measurements without a cell position (heights under a deck, picks along a route).
- `structures` (optional): what stands over or beside the route, for scenes that need the lane to be built up:
  `wayId`, the closed ring `points` (lat, lon), `heightM` and `heightFrom` (the `height` tag, else
  `building:levels` times 3.3 plus `roof:levels` times 2, else assumed). Not part of the street network: these
  ways carry no `highway` tag and stay out of `elements`, so `findPath` and `StreetEdgeIndex.match` do not see
  them. A scene turns them into columns itself and says how far it lets the photogrammetry reach past the
  footprint.
  Rothenburg: the 23 ways with `building` round the gate tower, and 16 ways with `building` or `building:part` with a
  height tag or levels whose ring comes within 20 m of the route, the town hall and its arcade on the Marktplatz
  among them (Overpass 2026-09-16, `way[building]` and `way["building:part"]` within 60 m of the HQ).

## How they were cut

1. The Overpass query in `source.query`: the highways in a box around spawn and HQ (for the A6 scene: around way
   230161781).
2. The game's own route on that network: `OsmStreetService` parser, `findPath(network, spawn, hq)`,
   `extendPathToOptimalTurnoff`, `leavePathForBase`, `StreetEdgeIndex.match`, `UnderpassIndex.spans`.
3. Kept: the ways the route matches and the ways above it, with their nodes. `findPath` on the kept ways alone
   gives the same `routePoints` (checked for every file when it was cut).

## Use in a test

Build a `StreetNetwork` from `elements`: a node map from the `node` elements; one `Street` per way with `id`,
`name` (tag `name`), `type` (tag `highway`), its nodes, and `width`, `lanes`, `bridge`, `tunnel`, `covered`,
`layer` as `OsmStreetService` reads them (`parseStreetTags`). Put the engine origin at `hq`, spawn at `spawn`.
Heights: `cells` where reported, a synthetic ground on the real line elsewhere; say which in the test.

OSM changes; these files do not. Fetching again gives other node ids and points, so tests read the files, never
the live API.

Map data (c) OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0,
https://www.openstreetmap.org/copyright.
