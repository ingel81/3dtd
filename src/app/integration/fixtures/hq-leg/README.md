# Leg fixtures from corridor snapshots

The end of the route cut from the corridor snapshots the user took after playtest 2026-09-16
(`tmp/snapshots/hqleg`, `__corridor.snapshot()`), for `hq-leg.snapshots.spec.ts`. At both places the cells of the
leg to the HQ stood on the roof of the HQ's building.

| File | Snapshot | Place | Leg |
|---|---|---|---|
| `neckarsulm-audi.json` | `corridor-neckarsulm-kernstadt-cold-231301.json` | Audi NSU Neckarsulm, hall | 16 m, segment 79, 8 stations |
| `erlenbach-bbh.json` | `corridor-binswangen-cold-231425.json` | Erlenbach, BBH, school | 12 m, segment 57, 6 stations |

## Format

One JSON object per file:

- `place`, `url` (the snapshot's `meta.location` and `meta.url`), `snapshot` (the file it was cut from),
  `fingerprint` (its `__corridor.fingerprint()`).
- `cellSize`: the lattice, 2 m. Coordinates are the snapshot's local frame (x = -east, z = +north around its HQ).
- `route`: the last street segment and the leg as waypoints take them: `points` `[x, z]` (the start of the street
  segment, the start of the leg, the HQ), `offStreet` per segment, `left` and `right` per segment (metres).
- `streetY`: the street under the leg's stations in the snapshot's band (`street`).
- `cells`: `[x, z, heightM, ground, top]` for every cell of the snapshot within 30 m of the HQ that has a column:
  its centre, the height the game gave it, and the column the cell cache held (`column.cached`).

## How they were cut

1. The route from the snapshot's `band[].route` (the street route's points), in the flat frame round the HQ
   (`x = -(lon - hq.lon) · 111320 · cos(hq.lat)`, `z = (lat - hq.lat) · 111320`). The stations of both segments lie
   within 7 mm of where the snapshot's band has them.
2. The last two segments: the street segment (its band stations `band`) and the leg (`fixed`, no OSM way).
3. The half widths: the narrowest band edge of each segment's stations, at least 1 m. The snapshot's waypoints run
   in the band, off the OSM line; these run on it. Cells the fixture's route claims that the snapshot has no column
   for stay without a sample.
4. The columns: the cells of the snapshot. A column the spec asks for between cell centres is the column of the cell
   it lies in, so the height carried along the leg reads one column per cell, not per 0.5 m.

Heights: the columns the game sampled from the 3D tiles when the snapshot was taken.
