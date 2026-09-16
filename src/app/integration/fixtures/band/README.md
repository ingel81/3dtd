# Band fixtures from corridor snapshots

Stretches of routes cut from the corridor snapshots in `tmp/snapshots` (`__corridor.snapshot()`), for
`corridor-band.snapshots.spec.ts`. Lesson from playtest 748: the band went thin where neighbouring stations laid
it on different sides of something, which a scene on synthetic ground did not show. These files keep the ground
the snapshot saw, as far as the snapshot has it.

| File | Snapshot | Stations | For |
|---|---|---|---|
| `stuttgart-748.json` | `corridor-stuttgart-nav-152029.json` | 179 to 199 | the bend with the verge under the hedge and the post in the mouth of the next street |
| `berlin-748.json` | `corridor-berlin-cold-150556.json` | 155 to 163 | a hollow object between the two sides of the path |
| `paris-748.json` | `corridor-paris-cold-150811.json` | 60 to 66 | a row of hollow cells, the ground behind it 3 cm lower |
| `rothenburg-narrow.json` | `corridor-rothenburg-ob-der-tauber-cold-150317.json` | 91 to 94 | a lane the rays leave 1 m either side of |
| `stuttgart-narrow.json` | `corridor-stuttgart-nav-152029.json` | 93 to 94 | the rays leave 1 m left of the line |

## Format

One JSON object per file:

- `place`, `url` (from the snapshot's `meta.url`), `snapshot` (the file it was cut from), `fingerprint` (its
  `__corridor.fingerprint()`).
- `stations`: the station indices along the whole route in the snapshot the tests name; `first`: the index in
  the snapshot of the first station of this stretch.
- `cellSize`: the lattice, 2 m. Coordinates are the snapshot's local frame (x = -east, z = +north around its HQ),
  so the lattice lies where it lay in the game.
- `route`: a `BandRoute` for the stretch: `points` as `[x, z]`, `open`, `covered`, `streetHalfWidth`,
  `wallLeft`, `wallRight` (per station, metres).
- `band`: the snapshot's `left`, `right` and `backbone` of the named stations, for reference.
- `columns`: `[gx, gz, ground, top]` for every cell of the lattice buildBand reads on this stretch that has a
  column (see below); a cell not listed has none.
- `streetHalfWidthM`, `lowWallLeft`, `lowWallRight`, `hollowCells`: the assumptions below.

## How they were cut

With the harness of the analysis (`tmp/fix1/cornerband-harness`, report `tmp/fix1/reports/cornerband.md`):

1. The route from the snapshot's `band[].route`, in the local frame as `geoToLocalSimple` places it (stations on
   7 mm). Segments are open where the snapshot's band has a backbone on them.
2. The walls: `fitCorridorStations` over the snapshot's measured free space (`stations`) of the whole route, then
   cut to the stretch. The snapshot has no low-wall flags or OSM half widths: `streetHalfWidthM` for every
   segment, low walls at the stations in `lowWallLeft` and `lowWallRight` (`segment:k` of the whole route, where
   the rays were free for less than 2 m and the snapshot kept the dip).
3. The columns: the cells of the snapshot (`column.cached`), and at each station's backbone its height. The
   snapshot holds only the cells of the corridor it built. Of the cells outside it, those in `hollowCells`
   (`[gx, gz]`, Stuttgart only: the eleven the analysis found must end a walk, among them the post in the mouth of
   the next street) are a hollow object, their ground at the street under the nearest station and their top
   1.5 m over it. Every other cell within the reach of a station is street 2 cm over the highest backbone of the
   snapshot within 9 m: high enough that no such cell would have been a backbone the snapshot did not take,
   low enough for a walk to cross.
4. The stretch: whole segments from 15 stations before to 15 after the named ones. Checked when cut: on the band
   of 790bff72 the named stations of the three `-748` files come out as in the snapshot, to 2 cm (Stuttgart 197
   takes another backbone cell with the same edges, as in the analysis); the two `-narrow` files give the
   snapshot's edges on the named stations, the stations beside them differ. The band on the stretch equals the
   band on the whole route there, to 2 mm.

The columns outside the snapshot's corridor are a model; the tests say what they assert on it.

Heights: the columns the game sampled from the 3D tiles when the snapshot was taken.
