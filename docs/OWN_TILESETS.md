# Eigene 3D-Tiles-Sets

Neben den Google-Kacheln (über Cesium Ion oder die Google Map Tiles API) spielt das Spiel auf einem eigenen,
georeferenzierten 3D-Tiles-Set. Das Set ist eine eigene Welt (`WorldRef` `{ kind: 'tileset', id }`, gebaut von der
Factory in `world/world-provider-registry.ts` als `TilesWorld`). Es braucht keinen Schlüssel und deckt nur ein Gebiet
ab, einen Kreis um `center` mit `radiusM`. Straßen kommen weiter aus OpenStreetMap. Der Rahmen steht in
[WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md).

## Konfiguration

Die Liste `ownTilesets` steht in `environment.ts` oder `public/runtime-config.json`. Die spätere Quelle ersetzt die
Liste ganz, wie bei den Schlüsseln (`ConfigService`). Ein Eintrag:

| Feld | Pflicht | Bedeutung |
|------|---------|-----------|
| `id` | ja | Kennung, für `?world=tileset:<id>` |
| `name` | nein | Name des Sets (sonst die `id`) |
| `url` | ja | `tileset.json` des Sets, ohne Schlüssel erreichbar |
| `attribution` | nein | Namensnennung, steht in der Kartenzeile unten (sonst der Name) |
| `center` | ja | `{ lat, lon }` in Grad, Mitte der Abdeckung |
| `radiusM` | ja | Radius der Abdeckung in Metern |
| `heightOffsetM` | nein | Meter, um die das Set angehoben wird (anderes Höhensystem als das Ellipsoid) |
| `geometricErrorScale` | nein | Faktor auf die geometricError-Werte des Sets, damit sie wie Googles gelesen werden (Standard 1) |

Ein Eintrag ohne `id`, `url`, gültiges `center` oder positiven `radiusM` fällt mit Warnung heraus
(`world/tileset/own-tileset.ts`).

Gespielt wird ein Set über `?world=tileset:<id>` in der URL. Die Orts-URL behält den Parameter beim Ortswechsel, ein
geteilter Link öffnet dieselbe Welt. Kennt die Konfiguration die `id` nicht, meldet der Start
`WorldUnavailableError`. Im Koop brauchen Gäste dasselbe Set in ihrer Konfiguration; ein Gast ohne es sieht, dass die
Welt des Hosts hier nicht steht.

Beispiel (Helsinki Kalasatama, ausgeliefert von `tools/own-tiles/serve.mjs` auf Port 4310) für
`public/runtime-config.json`, nur lokal, nicht einchecken. Das Set ist glTF 2 in b3dm mit `RTC_CENTER`, liegt direkt in
ECEF mit ellipsoidischen Höhen (kein `heightOffsetM`) und deckt etwa 2970 x 4228 m ab; 1400 m Radius bleiben in der
Abdeckung.

```json
"ownTilesets": [{
  "id": "kalasatama",
  "name": "Helsinki Kalasatama (2017)",
  "url": "http://localhost:4310/kalasatama/tileset/tileset.json",
  "attribution": "Helsingin kaupunki, Kalasataman kolmioverkkomalli 2017, CC BY 4.0",
  "center": { "lat": 60.18449, "lon": 24.97745 },
  "radiusM": 1400,
  "geometricErrorScale": 10
}]
```

## Was die Welt anders macht

Keine Weiche auf die Weltart: Die Factory gibt der `TilesWorld` Ref, Fähigkeiten, `TileSource` und Datenvermerk, und
die Ortswahl liest das Gebiet über `WorldContext.coverage()`.

- **Fähigkeiten** (`OWN_TILESET_CAPABILITIES`): wie die Google-Kacheln (echter Ort, Streaming, ECEF, Globus), aber ohne
  Zugangsdaten. Der Token-Dialog öffnet nicht, und ein abgelehntes oder fehlendes Wurzel-Tileset gilt als „nicht
  erreichbar“, nie als falscher Schlüssel.
- **Laden** (`three-engine/tiles-renderer-setup.ts`, `TileSource` `own`): `TilesRenderer` mit der URL des Sets, kein
  Auth-Plugin. Der `UnlitTilesPlugin` ersetzt beleuchtete Materialien (`MeshStandardMaterial` usw.) durch
  `MeshBasicMaterial` mit derselben Textur, denn ein Fotomesh trägt sein Licht in der Textur. Ein Set mit
  `KHR_materials_unlit` bleibt unverändert. Die übrigen Plugins (Kompression, Fade, Draco, Entladen, Load-Regions des
  Routenkorridors) bleiben gleich.
- **Ausrichtung**: wie bei Google über den `ReorientationPlugin` auf den Origin. Das Set muss in ECEF liegen
  (Wurzel-Transform oder ECEF-Koordinaten); ein Set im lokalen Rahmen ohne Georeferenz landet falsch.
  `heightOffsetM` verschiebt die Höhe, auf die der Origin gelegt wird (`reorientationHeight`).
- **Detailstufe** (`GeometricErrorScalePlugin`): Exporte schreiben ihre geometricError-Werte auf eigenen Skalen.
  Kalasatama (ContextCapture) gibt den 250-m-Blättern 4 und halbiert je Stufe bis 0,03. Ohne Faktor hielt der
  Routenkorridor in Ruhe die gröbsten Blätter; mit 10 lädt er in etwa 1 s und die Route ist ab Start scharf, mit 20
  wartet er bis zum Timeout.
- **Namensnennung**: `attribution()` nennt die Strings der Kacheln, sonst die `attribution` des Sets, dazu den
  OSM-Vermerk. Keine Google- und Cesium-Logos, auch nicht im Fotomodus.
- **Gebiet** (`world/world-coverage.ts`): HQ und Spawns bleiben im Kreis, 50 m vom Rand (`COVERAGE_EDGE_MARGIN_M`).
  - Ein gewählter Ort außerhalb (Suche, Liste, Favorit) lädt nicht, und das Menü sagt warum.
  - Ein URL-Ort außerhalb wartet wie ohne Ort auf die Wahl.
  - Der Weltwürfel landet in der Mitte des Gebiets.
  - Der zufällige Spawn (`findRandomStreetPoint`) nimmt nur Knoten im Kreis und kappt seinen Abstand zum HQ auf die
    Gegenseite des Kreises.
  - HQ- und Spawn-Platzierung im Spiel melden „Outside the map area“.

## Ein Set bereitstellen

Daten liegen nie im Repo, sondern lokal unter `tmp/own-tiles/<id>/` (gitignored). Die Werkzeuge in `tools/own-tiles/`
haben keine Abhängigkeiten.

1. **Entpacken** nach `tmp/own-tiles/<id>/raw/`. Große ZIP64-Archive mit 7-Zip oder Python `zipfile`; das `unzip` aus
   git-bash scheitert daran.
2. **Analysieren**: `node tools/own-tiles/analyse.mjs <wurzel.json>` gibt Version, `root.transform`, glTF-Version der
   Kacheln, Ausdehnung, Mittelpunkt, die geometricError-Kette mit MB je Ebene und die Ellipsoidhöhen der gröbsten
   Kacheln aus. An der Höhe flacher Wasserflächen sieht man den Höhenbezug: Liegen sie bei der örtlichen Geoidhöhe, sind
   die Höhen ellipsoidisch und es braucht keinen Versatz. Liegen sie bei 0 m, liegt das Mesh um die Geoidhöhe zu tief.
3. **Konvertieren**, falls glTF 1.0 drinsteckt (ältere Exporte, etwa ContextCapture um 2017):
   `node tools/own-tiles/convert-gltf1.mjs <raw> <tileset> --root <Wurzel>.json` schreibt Tileset 1.0 mit `uri`, je
   b3dm ein GLB 2.0 mit unbeleuchtetem Material (`KHR_materials_unlit`) und das RTC-Zentrum als `RTC_CENTER`.
4. **Ausliefern**: `npm run own-tiles` liefert `tmp/own-tiles/` auf `http://localhost:4310/` aus, mit
   `Access-Control-Allow-Origin: *` und `Cross-Origin-Resource-Policy: cross-origin`, damit der Dev-Server unter COEP
   credentialless die Kacheln laden darf. Anderer Ordner oder Port:
   `node tools/own-tiles/serve.mjs <ordner> --port <port> --host <host>`.
5. **Eintragen** in `ownTilesets` (siehe oben) und `?world=tileset:<id>` öffnen.

3DTilesRendererJS 0.5.2 liest Tilesets 1.0 (0.0 geht auch) mit b3dm, i3dm, pnts, cmpt und glTF/GLB, sofern darin
glTF 2.0 steckt; `asset.gltfUpAxis`, `RTC_CENTER` und `CESIUM_RTC` werden beachtet, Draco geht über das
`GLTFExtensionsPlugin`.

## Geprüft

- Specs: `own-tileset.spec.ts` (Einträge, Factory: Ref, Fähigkeiten, Vermerk, Gebiet, unbekanntes Set),
  `world-coverage.spec.ts`, `world-ref.spec.ts`, `tiles-renderer-setup.spec.ts` (URL, kein Auth, Plugins, Versatz),
  `unlit-tiles-plugin.spec.ts`, `geometric-error-scale-plugin.spec.ts`, `location-change-coordinator.service.spec.ts`
  (Ort außerhalb, Würfel in die Mitte).
- Im Browser (2026-10-11) mit einem synthetischen Set (ein GLB-Boden, 2 x 2 km, ENU-Transform in Stuttgart):
  - Das Set lädt, und es gibt keine Anfrage an Google oder Cesium.
  - Die Kartenzeile nennt das Set, Logos erscheinen keine.
  - Die URL behält `world`, der zufällige Spawn liegt im Kreis, und Welle 1 läuft.
  - Ein URL-Ort außerhalb wartet auf die Wahl.

## Grenzen

- Die Mitte des Gebiets ist der Ort des Würfels. Liegt sie nicht nahe einer Straße, sucht man den Ort besser über die
  Suche im Kreis.
- Die Streaming-Werte (`errorTarget` 20, Warteschlangen) sind für Google-Kacheln eingestellt.
- Fotomeshes dieser Art sind unbeleuchtet und ohne Normalen, wie die Google-Kacheln.
- Außerhalb des Gebiets gibt es keinen Boden; OSM-Straßen reichen darüber hinaus.
