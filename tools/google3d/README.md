# Google 3D coverage of the city list

One-shot job: marks the cities of `public/assets/data/cities.json` that Google
covers with photorealistic 3D data, in that same file (`google3d` 1 or 0).
Nothing here runs in the game; the World Dice only rolls cities with coverage
([LOCATION_SYSTEM.md](../../docs/LOCATION_SYSTEM.md)).

Stand 2026-09-20: 4063 cities checked, 1100 with coverage, no errors,
about 75 minutes.

```bash
npm install
npm run setup                     # downloads Chromium for Playwright
npx tsx enrich-google-3d.ts --headed --min-population 500000
npx tsx enrich-google-3d.ts --headed --min-population 200000
npx tsx enrich-google-3d.ts --headed
```

| Option | What it does |
|--------|--------------|
| `--headed` | Shows the browser. **Needed**: headless Chromium draws the map without the coverage layer, and the self test then stops the run |
| `--min-population N` | Only cities of at least N inhabitants, biggest first |
| `--limit N` | Only the first N of them |
| `--only "Berlin,Tokyo"` | Only these cities, by name |
| `--recheck` | Checks cities that already have an answer again |
| `--shots DIR` | One screenshot per city, to check the answers by eye |
| `--in`, `--out` | Other files than the two above |

## How it decides

It drives Google's own coverage sample
(<https://maps-docs-team.web.app/samples/3d-coverage-map/dist/>), which paints
the covered areas blue over a grey basemap. No key of ours, no Maps client of
ours, no tiles pulled. Per city the map moves to its coordinates at zoom 11,
and a square of 320 px around the middle decides: at least 40 % coverage blue
means yes.

Two things had to be learned the hard way (2026-09-20):

- **Do not touch the dataset layer.** Asking `map.getDatasetFeatureLayer()`
  for the features under the pointer takes the sample's own styling off the
  layer; the map then stays grey everywhere and every city looks uncovered.
  The sample runs the map in raster mode, where there is no client-side
  feature hit testing anyway.
- **Read a wide square, not the middle pixel.** The city's own label sits in
  the very middle, and dark text is not blue: London, Paris and New York came
  out uncovered with a 9 px patch.

A jump across the world takes a moment, so the square is read until two reads
in a row match. A view that never settles counts as an error, and an error
stays `null` (unknown), never a no.

## Starting again

The run writes the list every ten cities, at Ctrl+C and on an error. Starting
it again checks only the cities whose `google3d` is still `null`, so a stopped
run carries on. `--recheck` goes over the answers again.

A fresh list from `tools/wikidata/fetch-cities.mjs` keeps the answers it
already has (`--keep-3d`, on by default): only new cities come out as `null`.

Before the first city the run checks itself against two known points
(Frankfurt covered, the middle of the Sahara not). If those two do not come
out as expected, it writes nothing.
