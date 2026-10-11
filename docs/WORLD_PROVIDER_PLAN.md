# Weltprovider, eigene Karten und Level-Editor

**Status:** in Arbeit auf `exp/custom-maps` (Experiment, ab 2026-10-11)

## Ziel

Das Spiel lief auf zwei Welten: Google Photorealistic 3D Tiles (über Cesium Ion oder die Google Maps API) und
DevWorld, über `DevWorldService.isActive` und `engine.devTerrainProvider != null` an rund 60 Stellen verdrahtet,
Straßen fest aus `OsmStreetService`. Seit 2026-10-11 laufen sie über austauschbare Weltprovider (Bausteine unten).
Dazu kommen:

- **Eigene Karten**: eigenständige Welten mit Höhenfeld, Texturschichten, Wasser, Objekten (Bäume, Felsen,
  Gebäude), Wegenetz, Spawns und HQ. Mitgelieferte Karten unter `public/maps/`, eigene im Browser oder als Datei
- **Level-Editor** (`/editor`), mit dem man solche Karten baut, auch aus Warcraft-3-Karten (`.w3x`) importiert
- eigene 3D-Tilesets als eigene Welt (`{ kind: 'tileset', id }`, [OWN_TILESETS.md](OWN_TILESETS.md)) und
  Zerstörbarkeit als Fähigkeit (`capabilities.destructible`, `WorldProvider.destruction`, für eigene Karten mit
  `?destructible`, [CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md)), ohne neue Verzweigungen in Engine und Diensten;
  nachgebaut aus den Experimenten `exp/own-tiles` und `exp/tile-deform`

Ein Lauf weiß immer, auf welcher Welt er spielt (`WorldRef`): Spielstand, Replay, Run-Log, Coop-Weltpaket, URL und
Bots tragen dasselbe Feld.

## Grundsätze

- **Eine Welt je Spiel, gewählt beim Start.** Die Engine bekommt einen fertigen `WorldProvider` und fragt nie, was
  für einer es ist. Unterschiede stehen in Fähigkeiten (`WorldCapabilities`) und in Daten (z. B. `streetStyle`),
  nicht in `if (devWorld)`
- **Kein zweites System daneben.** DevWorld zieht auf die neue Schnittstelle um, `DevWorldService.isActive`,
  `getDevTerrainProvider()`, `TerrainSources.devTerrain()` und die `DEV_WORLD_ORIGIN`-Vergleiche verschwinden
- **Keine Kosten im Spiel.** Abfragen gehen über ein festes Objekt je Welt (`WorldSurface`), ein Methodenaufruf statt
  einer Verzweigung; heiße Pfade (Höhen, Spalten-Samples) bleiben allokationsfrei
- **Simulation unverändert.** Der Worker bekommt weiter `SimWorld` (Ursprung, HQ, Spawns, Pfade, Höhen). Eigene
  Karten liefern dieselben Daten, Gegner laufen auf dem Wegenetz der Karte wie auf OSM-Straßen
- **Geo-Rahmen bleibt.** Die Simulation rechnet in lat/lon. Synthetische Welten (DevWorld, eigene Karten) liegen um
  einen festen Ursprung (0, 0); ihre Identität kommt aus dem `WorldRef`, nie aus Koordinatenvergleichen

## Bausteine (gebaut, Stand 2026-10-11)

Engine, Abfragen, Straßen und Startablauf laufen über die Bausteine unten; die früheren Weichen
(`DevWorldService.isActive`, `engine.getDevTerrainProvider()`, `TerrainSources.devTerrain()`, `DEV_WORLD_ORIGIN`,
`TerrainProvider`- und `StreetNetworkProvider`-Interface, `DevStreetProvider` in der Komponenten-Brücke) sind entfernt.

### WorldRef (`src/app/world/world-ref.ts`)

Serialisierbare Angabe, welche Welt ein Lauf benutzt:

```ts
type WorldRef =
  | { kind: 'tiles'; source: 'cesium' | 'google' }          // Ort steht in HQ/Ursprung des Laufs
  | { kind: 'tileset'; id: string }                         // eigenes 3D-Tiles-Set aus `ownTilesets`
  | { kind: 'devworld'; terrain: string; seed: number; buildings: string; spawns: number }
  | { kind: 'custom-map'; mapId: string; contentHash: string; name?: string };
```

- URL: `?world=map:<id>` und `?world=tileset:<id>` (`worldRefFromSearch`, `worldUrlValue`; die Orts-URL behält
  `world`), `?devworld…` bleibt die Kurzform für DevWorld
- Getragen von `WorldPackage.world` (Coop, auch im Spielstand), `ReplayFile.world`, `RunLogHead.world` (neben dem
  alten `map`); Bot-Läufe schicken ihn mit dem Run-Log an den Bot-Server
- Dateien ohne das Feld: `legacyWorldRef(origin, tilesSource)` bildet Ursprung (0, 0) auf DevWorld mit den Vorgaben
  von `?devworld` ab (`LEGACY_DEV_WORLD_REF`), sonst Tiles der eingestellten Quelle; Run-Logs über `runWorld(head)`
- `worldsMatch(a, b)`: Tiles beider Quellen sind derselbe Ort, alle anderen Welten müssen gleich sein; ein Ref ohne
  Inhalts-Hash (aus der URL) passt zu jedem Inhalt seiner Karte. `sameWorld` bleibt die strenge Gleichheit
- `worldRefShape` prüft einen Ref aus einer Datei; `worldLabel` (Logs, Menü-Fuß), `worldPlaceName` (Ortsname einer
  Welt ohne echten Ort)

### WorldProvider (`src/app/world/world-provider.ts`)

```ts
interface WorldProvider {
  readonly ref: WorldRef;                 // DevWorld: folgt einer Neugenerierung
  readonly capabilities: WorldCapabilities;
  readonly sync: EllipsoidSync;           // Geo ↔ Szene um den Ursprung der Welt (engine.sync)
  readonly surface: WorldSurface;         // engine.terrain
  readonly streets: WorldStreetSource;
  readonly streetStyle: StreetStyle;
  readonly tiles: WorldTiles | null;      // die gestreamten Tiles: Renderer, Korridor, Statistik
  readonly destruction: WorldDestruction | null; // Bauwerke mit HP, die fallen (capabilities.destructible)
  attach(ctx: WorldAttachContext): Promise<void>; // Szene, Kamera, Renderer, CameraRig, groundChanged()
  ready(): boolean;                       // zeichnet (Tiles: sobald der Renderer steht)
  setOrigin(lat, lon, height): void;
  update(camera, overlay): void;          // je gezeichnetem Frame: Boden streamen, Overlay mitführen
  resize(camera, renderer): void;
  setDrawSuppressed(suppressed): void;    // Menü-Globus deckt das Bild
  losBlockers(): Object3D | null;         // direktes Szenen-Kind für den LOS-Würfel
  sceneToEcef(target): Matrix4 | null;
  attribution(): string[];               // Quellenzeile und Fotomodus, sonst nichts
  onFirstGround(cb): void;                // mit Nachholen
  onLoadFailure(cb): void;                // 'credentials' | 'unreachable', mit Nachholen
  startLayout(): WorldStartLayout | null; // HQ + Spawns der Welt, null: Spieler wählt (Tiles)
  runRules(): RunRules | null;            // Startcredits, HQ-HP, erlaubte Tower; null: die des Spiels
  worldWaves(): WorldWaves | null;        // Wellenquelle der Welt, ggf. mit eigener Liste; null: Wahl des Spielers
  regenerate(): Promise<void>;            // capabilities.regenerate
  dispose(): void;
}

interface WorldCapabilities {
  realPlace; streaming; ecef; credentials; regenerate; destructible: boolean;
  controls: 'globe' | 'environment';
}
```

`WorldSurface` hat die Abfragen, die `TerrainQueries` vorher hatte: `getTerrainHeightAtGeo`,
`getStreetHeightEstimate`, `getGroundHeightEstimate`, `sampleColumn`, `raycastTerrainHeight`,
`raycastColumnSample`, `inspectColumn`, `measureStreetClearance`, `peekBestTileLODAtLocal`, `raycastLineOfSight`,
`markTileSetChanged`, `clearHeightCache`, `lodVersion`; dazu `pickRay(raycaster)` (Bildschirm-Pick, den Strahl baut
der `ScreenPicker`), `roofAt` und `footprintColumn` (Turmplatzierung). Die Regel der Straßenhöhe ohne den Boden steht
einmal in `streetHeightAt` (`terrain-queries.ts`) und wird von allen Oberflächen benutzt.

`StreetStyle` (Daten statt Weichen): `overlayLift` (gelbes Overlay), `routeLineLift` (rote Linie), `subdivideM`
(Routen und Overlay in Stücke dieser Länge), `plainGround` (Höhen aus dem reinen Gelände, ohne Brücken und
Seitenproben), `carryOffStreet` (Abzweig zum HQ trägt die Straßenhöhe weiter).

| Provider | Datei | Fähigkeiten | Inhalt |
|----------|-------|-------------|--------|
| `TilesWorld` | `world/tiles/tiles-world.ts` | realPlace, streaming, ecef, credentials, globe | TilesRenderer und Plugins, `TileLoadingTracker`, `RouteCorridorTiles`, `SettleHold`, Overlay folgt der Tiles-Gruppe, GlobeControls, Zugangsdaten, Logos (`tilesLogos`); Oberfläche `TerrainQueries`, Straßen `OsmStreetService`. Die Quelle (`TileSource`: Cesium, Google, eigenes Set), Ref, Fähigkeiten und Datenvermerk kommen aus der Factory |
| `TilesWorld` (eigenes Set) | `world/tiles/tiles-world.ts`, Factory in `world-provider-registry.ts` | realPlace, streaming, ecef, globe, ohne credentials | wie oben aus der URL des Sets ohne Auth, `UnlitTilesPlugin`, `GeometricErrorScalePlugin`, Höhenversatz; Gebiet als `coverage` ([OWN_TILESETS.md](OWN_TILESETS.md)) |
| `DevWorldProvider` | `devworld/dev-world-provider.ts` | regenerate, environment | `DevTerrainProvider` in einer Gruppe am Ursprung, EnvironmentControls, Oberfläche `DevWorldSurface`, Straßen `DevStreetProvider`, Startaufstellung aus dem Straßengenerator |
| `CustomMapWorld` | `world/custom-map/custom-map-world.ts` | environment | `CustomMapView` (Renderer per dynamischem Import in `attach()`), Umgebung der Karte (`setEnvironment`), Oberfläche `CustomMapSurface` (`custom-map-surface.ts`: Höhenraster, Brückendecks, Rahmen `CustomMapFrame`), Straßen `CustomMapStreets` (`custom-map-streets.ts`: Wegegraph, Brücken als `bridge`), HQ und die ersten Spawns der Karte (`customMapSpawnLimit`, `?spawns=N`) |

### WorldStreetSource

`prefetchStreets`, `loadStreets`, `findNearestStreetPoint`, `findPath`, `segmentRoutes`, `findRandomStreetPoint`,
`filterStreetsNearRoutes`, `haversineDistance`, `loadBuildingsNearRoutes`, `spawnLabel`. Die Netzalgorithmen
(Segment-A*, Zufallspunkt mit Routenprüfung, Filter, nächster Punkt) stehen in `StreetRouter`
(`services/location/street-router.ts`); `OsmStreetService`, `DevStreetProvider` und `CustomMapStreets` erben sie.
`findRandomStreetPoint` prüft in jeder Welt mit dem Segment-A* (`routeAlongSegments`), wie DevWorld es vorher über
`OsmStreetService` tat; `DevStreetProvider.findPath` bleibt sein eigenes A* auf dem Gitter.

### WorldContext und Registry

- `WorldContext` (`world/world-context.service.ts`, root): `ref` (Signal, aus der URL; Tiles folgen der eingestellten
  Quelle), `capabilities`, `logos`, `provider`, `streets`, `startHq()`, `open(origin)` (macht den Provider vor dem
  Engine), `close()`, `refreshRef()` (nach einer Neugenerierung)
- `WorldProviderRegistry` (`world/world-provider-registry.ts`): je Art eine `WorldFactory` mit `capabilities`,
  `create(ref, { injector, origin })`, optional `startHq(ref)`, `logos(ref)` und `coverage(ref)` (das Gebiet, in dem
  die Welt Boden hat; `WorldContext.coverage`, `world-coverage.ts`); `WorldUnavailableError` für eine
  Welt, die es hier nicht gibt. Eine neue Art registriert nur ihre Factory
- `WorldPackageLoader.worldHere(package)`: warum die Welt eines Pakets (Coop, Spielstand) hier nicht steht, sonst
  null. Für eine eigene Karte im Coop schickt der Host die Karte vorher über das Relay, der Gast legt sie ab und
  öffnet sie ([COOP_PLAN.md](COOP_PLAN.md) C1c)

### Geo-Rahmen

`world/flat-frame.ts` (`FLAT_WORLD_ORIGIN`, `flatLocalToGeo`, `flatGeoToLocal`) ist das eine Paar der synthetischen
Welten, bei Breite 0 genau `geoToLocalSimple` und seine Umkehrung; `DevWorldService.localToGeo/geoToLocal` sind
entfernt. Die Karten haben `mapToGeo`/`geoToMap` im Kartendokument, mit demselben Faktor. `EllipsoidSync.localToGeo`
(Erdradius statt 111320) und die Simulation (`sim-coords.ts`) bleiben unverändert, wegen Replay-Prüfsummen.

### Entscheidungen beim Bau

- **Provider besitzt `sync`**: der Rahmen einer Welt ist ihr Ursprung; der Engine nimmt `world.sync` und
  `world.surface`. Der Provider wird vor dem Engine gemacht (`WorldContext.open`), damit der Straßen-Prefetch
  (TODO H13) vor dem Engine beginnt
- **Fähigkeit statt Art**: Zugangsdaten nur bei `credentials` (der Fake-Token der E2E-Läufe ist weg), Globus und
  Tauchflug nur bei `realPlace` und `ecef`, Zuletzt-besucht, Bestwellen, Ortssuche-URL nur bei `realPlace`.
  Bewusste Ausnahme: Bot-Training, Hintergrund-Schleife und Rendering-Schalter hängen an `ref.kind === 'devworld'`,
  weil DevWorld die Welt der Bots ist und eine eigene Karte keinen Bot-Server ansprechen soll. Die Kartenprobe
  (`?bot=trial`, `world/map-trial.ts`) läuft ohne Bot-Server auf jeder Welt ohne `realPlace`. Zweite Ausnahme: der
  Kartenversand im Koop fragt `kind === 'custom-map'` (`coop.service.ts` `mapPartsToSend` und der Abgleich
  beim Beitritt; `world-package-loader.service.ts` `worldHere` für die Meldung), weil seine Nutzlast der Inhalt der
  Karte selbst ist; im Spielablauf ist das keine Weiche
- **Gebiet als Fähigkeit der Factory**: `WorldFactory.coverage` (`WorldContext.coverage`, `world-coverage.ts`) hält
  HQ, Spawns, Würfel und Link-Orte in dem Kreis, in dem eine Welt Boden hat (eigenes Tileset); sonst überall
- **Welt wechseln heißt neu laden**: das Menü (New game, Maps; `WorldChoiceService`) lädt die Seite mit `?world=…`
  neu, statt die Welt unter einer laufenden Engine zu tauschen
- **Spielstand in DevWorld** ist jetzt möglich (nur gleiche Welt); die Autosicherung bleibt auf echten Orten, damit
  Bot-Läufe nie den Platz belegen, den das Menü zum Fortsetzen und Raten des Startorts nimmt
- **`TerrainQueries` bleibt in `three-engine/`** (viele Specs und Werkzeuge importieren ihn); er ist die Oberfläche
  der Tiles-Welt. Ebenso `RouteCorridorTiles`, `TileLoadingTracker`, `tiles-renderer-setup`
- **Karten**: Ursprung der Szene ist das HQ des Laufs wie bei den Tiles; `CustomMapFrame` rechnet Szene und
  Kartenmeter um, die Kartenansicht wird um den Versatz verschoben. Die Karte lädt einmal für das Start-HQ
  (`openCustomMap`, `WorldFactory.startHq`) und wird beim Erzeugen der Welt übernommen; `WorldContext.open` holt
  danach Inhalts-Hash und Namen in den Ref (`refreshRef`). Brückendecks zählen als Boden (Routen laufen darüber),
  Türme stehen auf Gelände oder Deck, nicht auf Gebäuden der Karte

## Eigene Karten

### Kartendokument (`src/app/world/custom-map/map-document.ts`)

Koordinaten in Metern, Ursprung in der Kartenmitte, `x` nach Osten, `y` nach Norden. Spielraum: lat = y / 111320,
lon = x / 111320 um den Ursprung (0, 0), womit `geoToLocalSimple` die Karte unverzerrt abbildet.

- `meta`: id, Name, Autor, Beschreibung, Zeiten, Herkunft (`w3x` mit Dateiname)
- `terrain`: Größe, Raster (Höhenwerte als `Float32Array`), Texturschichten (bis 8 Materialien, Gewichte als zwei
  RGBA-Splatmaps), Klippen über Steilheit, Wasser (Spiegel + Maske)
- `objects`: Platzierungen aus dem Asset-Katalog (Position, Drehung, Größe), mit `blocksLos`/`blocksBuild` aus dem Katalog
- `paths`: Knoten und Kanten (Breite, Art Straße/Pfad), daraus das Straßennetz
- `spawns`, `hq`
- `environment`: Himmel, Sonnenstand, Nebel, Licht, Biom, Wetter
- `gameplay` (optional): Startcredits, HQ-HP, erlaubte Tower, Wellen (Budget oder eigene Liste)

Speicher: `.3dtdmap` (gezippt mit fflate: `map.json` + Binärdateien). `contentHash` = SHA-256 über den Inhalt.
Mitgelieferte Karten in `public/maps/<id>.3dtdmap` plus `public/maps/index.json`; eigene in IndexedDB.

### Asset-Katalog (`public/maps/assets/`)

CC0-Texturen (ambientCG, Poly Haven) als PBR-Sätze für Bodenmaterialien und CC0-Modelle (Poly Haven, Poly Pizza,
Kenney) als GLB mit Fußabdruck, LOS-Blocker-Flag und Kategorie. Kein generate_3d, keine Blizzard-Assets.

### Renderer

Höhenfeld als Kachelgitter mit LOD, Splatting mit Triplanar auf steilen Hängen (Klippen), Detail- und
Makrovariation gegen Kachelmuster, Wasser-Shader, instanzierte Objekte, Himmel und Schatten. Alle eigenen Shader mit
logdepthbuf-Chunks. Derselbe Renderer zeigt die Karte im Editor und im Spiel.

## Warcraft-3-Import

`src/app/world/w3x/`: MPQ-Leser (Hash-/Blocktabelle, Verschlüsselung, zlib/bzip2/PKWARE), Parser für `war3map.w3i`,
`w3e` (Höhen, Klippen, Wasser, Bodentexturen), `doo` (Doodads), `w3r` (Regionen), `j` (Wege aus Befehlen zwischen
Regionen). Konverter auf das Kartendokument: Bodentexturen auf eigene Materialien, Doodads auf Katalog-Assets,
Regionen und Skript-Wege auf Wegenetz, Spawns, HQ. Eine Warcraft-Kachel (128 Einheiten) = konfigurierbare Meter.

## Editor (`/editor`)

Eigene Seite mit eigener Szene (Renderer der Karte, Orbit-Kamera), unabhängig vom Spielstart. Werkzeuge: Höhe
(heben, senken, glätten, ebnen, Rauschen, Klippen-Stufen), Textur malen, Wasser, Objekte setzen/verschieben/drehen
(Einzeln und Pinsel), Wege zeichnen und bearbeiten, Spawns und HQ, Umgebung; Rückgängig/Wiederholen, Minikarte,
Prüfung (Wege verbunden, Spawns erreichen HQ), Speichern lokal/Datei, Import `.w3x`, „Karte testen“ startet das
Spiel mit `?world=map:<id>`.

## Reihenfolge

1. Typen und Plan (dieses Dokument), `WorldRef`, Kartendokument
2. Engine und Abfragen auf `WorldProvider` (Tiles, DevWorld), Straßenquelle, Startablauf, `WorldRef` überall (gebaut)
3. parallel: W3X-Leser und Konverter, Karten-Renderer und Assets, Editor
4. `CustomMapWorld` im Spiel (gebaut: `?world=map:<id>`, die Demo-Karte liegt als `demo-valley` in `public/maps/` bei),
   Coop mit eigener Karte (gebaut: der Host schickt die Karte über das Relay, COOP_PLAN.md C1c)
5. Gebaut 2026-10-11: Spielwerte je Karte, Kartenprobe mit dem Bot, eigene 3D-Tilesets, Zerstörbarkeit als
   Fähigkeit, Kartenauswahl im Hauptmenü. Offen: Zerstörung in der Simulation (Entscheidung des Users), ein
   Zerstörbar-Schalter im Kartendokument statt `?destructible`

## Stand 2026-10-11 morgens (Bereich Welten)

### Gebaut

- **Weltprovider und `WorldRef`:** Engine, Bodenabfragen und Straßen laufen auf `WorldProvider` (`cd103c40`). Jeder Lauf
  trägt seinen `WorldRef` in Spielstand, Replay, Run-Log und Koop-Paket (`dcc9cb77`). Zwei Menü-Abfragen hängen an
  Fähigkeit bzw. Weltname statt an der Art (`8bded195`); das Store-Signal heißt `worldRegenerating` (`a1bb01e0`).
- **Ursprung und Quellenzeile:**
  - Hauptthread und Simulation rechnen mit demselben Ursprung in Grad (`b84f1157`, `ellipsoid-sync.ts`). Die
    Simulation ist dabei unverändert, Replays und Prüfsummen bleiben gültig.
  - Die Quellenzeile kommt nur aus `attribution()` der Welt (`05036591`).
- **Eigene Karte im Koop:** Der Host schickt die Karte in Stücken über das Relay (`34fa2ecd`, `c81e3101`).
  - Empfangene Karten sind `'shared'`: Die nächste Version des Hosts ersetzt sie, eine eigene Karte wird nie
    überschrieben, und nichts verdeckt eine mitgelieferte (`45dcb491`).
  - Die Welt nach den Stücken ist immer die neueste (`c3f0ebcf`, `PacedMapSend`).
  - Das Relay hält Stücke nur bis zum Start und innerhalb eines Budgets (`c4fa23fe`, `MapBudget`).
  - Nur eine Welt mit Zugangsdaten wartet auf einen Schlüssel (`bfd79b2d`).
- **Spielwerte je Karte:** `gameplay` mit Startcredits, HQ-HP, Towern und Wellen geht über `RunRules` und die
  Wellenquellen (`7c970150`). Alle Anteile an der HQ-HP rechnen mit der HP des Laufs (`0ac7799e`, Feuer `c711c562`).
  Ohne eigene Regeln ist alles bitgleich.
- **Kartenprobe:** `?bot=trial&trialWaves=N` (`626f1374`, `c49f3a54`, Banner `c1bfa109`).
- **Eigene 3D-Tilesets:** eigene Welt `{ kind: 'tileset', id }` (`48b5aaee`). Ein Link-Ort außerhalb des Gebiets
  startet in dessen Mitte (`46bbaaf1`). Doku in [OWN_TILESETS.md](OWN_TILESETS.md).
- **Zerstörbarkeit:** als Fähigkeit mit `WorldProvider.destruction`; bei eigenen Karten nur mit `?destructible`
  (`8cb5da0b`).
- **Kartenauswahl im Hauptmenü:** New game, Reiter „Maps“ (`03e38b6e`, Summaries mit Spawns und Biom `b7e6c4b5`).
- **Keine Tower im Wasser** eigener Karten (`8502623d`).
- **Routen:** Neue Editor-Karten bekommen ihre Route (`ec1ba23b`, Regressionstest `b96dbdfc`).
- **Review-Befunde:** dispose während attach (`4d84a23e`), Höhen-Zyklus (`9ceabea1`), Boot-Fenster (`23bbb2cc`),
  `select()` entfernt und `opened`-Cache begrenzt (`694efe6d`).
- **Tests:** `e2e/tests/custom-map.e2e.ts` ohne Kartensitzung (`8acd76bd`), 7/7 grün am 2026-10-11 gegen einen
  Dev-Server auf 4214, Relay auf 3015 (`E2E_RELAY_PORT`).

### Bewusst offen

- **Zerstörung:** nur Darstellung und Bausperre. Ein Sprung im Replay stellt Gefallenes nicht wieder her; die
  Sichtlinien merken einen Fall erst beim nächsten Rendern des Würfels; Schaden nur durch Einschläge
  ([CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md), Zerstörbarkeit).
- **Ältere empfangene Karten:** Was vor `45dcb491` empfangen wurde, steht als `'own'` im Store.
- **`laneScaling`:** Die Wellenvorschau (`peek`) zeigt die ungeteilten Zahlen. Im Koop zählt N die Spuren des ganzen
  Raums.
- **Relay-Budget:** Ein Joiner nach erschöpftem Budget bekommt die Karte nicht (Log-Zeile im Relay).
- **Bot-Ausnahmen:** Bot-Training, Hintergrund-Schleife und Headless-Schalter hängen weiter an
  `ref.kind === 'devworld'` (begründet unter „Entscheidungen beim Bau“).

### Entscheidungen beim User

- **Zerstörung in die Simulation:** Bauwerke in Weltschlüssel und Sichtlinien aufnehmen, damit Replay-Sprünge und
  Sichtlinien stimmen. Heute nur Darstellung, Schalter `?destructible`.
- **Leckschaden 1/N bei vielen Spuren:** Laut Rechnung (`81a96256`, `tools/balance-calc/lanes.ts`) der einzige Hebel,
  der jede Spurzahl auf der Kurve einer Spur hält (höchstens 28 HP Abweichung bis W40). Nicht gebaut; er gehörte als
  Lauf-Regel in `RunRules`.
- **`laneScaling: 'sqrt'`:** vorbereitet und aus (`9a25b3fc`). Bei 10 Spuren hält die Option durch die Aufbauwellen,
  ist aber nicht lastgleich: 68 HP nach W10, Tod in W30. Offen ist, ob Karten sie nutzen dürfen.

## Kopplungsstellen vor dem Umbau (Erkundung 2026-10-11, inzwischen aufgelöst)

Schlimmste zuerst: `ThreeTilesEngine` (DevWorld-Parameter, Zugangsdaten, `getDevTerrainProvider()`,
Render/LOS/ECEF-Zweige); `TerrainQueries`/`ScreenPicker`/`TowerPlacementService` (`tiles()` vs `devTerrain()`);
OSM fest in Ortswechsel, Kartenverschiebung, Platzierung, strategischer Platzierung, Turmplatzierung,
Gebäude-Overlay, Visualisierung; `LocationFacadeService` und `EngineInitializationService.loadStreets`;
Zugangsdaten im Startablauf (Token-Prüfung kennt DevWorld nicht, E2E legt deshalb einen falschen Token ab);
Welt-Identität (`DEV_WORLD_ORIGIN`-Vergleiche, `RunMap`, kein Weltfeld in `WorldPackage`/Spielstand);
Straßen-Darstellung (DevWorld-Unterteilung und Anhebung); UI-Schalter (Kopfzeile, Schnellaktionen, Fotomodus,
Spielstand, Globus, Logos); drei leicht verschiedene Geo-Umrechnungen.
