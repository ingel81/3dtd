# Weltprovider, eigene Karten und Level-Editor

**Status:** in Arbeit auf `exp/custom-maps` (Experiment, ab 2026-10-11)

## Ziel

Das Spiel läuft heute auf zwei Welten: Google Photorealistic 3D Tiles (über Cesium Ion oder die Google Maps API) und
DevWorld. Beide sind über `DevWorldService.isActive` und `engine.devTerrainProvider != null` an rund 60 Stellen
verdrahtet, Straßen kommen fest aus `OsmStreetService`. Dazu sollen kommen:

- **Eigene Karten**: eigenständige Welten mit Höhenfeld, Texturschichten, Wasser, Objekten (Bäume, Felsen,
  Gebäude), Wegenetz, Spawns und HQ. Mitgelieferte Karten unter `public/maps/`, eigene im Browser oder als Datei
- **Level-Editor** (`/editor`), mit dem man solche Karten baut, auch aus Warcraft-3-Karten (`.w3x`) importiert
- später eigene 3D-Tilesets (Branch `exp/own-tiles`) und zerstörbare Welten (Branch `exp/tile-deform`) als weitere
  Provider bzw. Fähigkeiten, ohne neue Verzweigungen in Engine und Diensten

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

## Bausteine

### WorldRef (`src/app/world/world-ref.ts`)

Serialisierbare Angabe, welche Welt ein Lauf benutzt:

```ts
type WorldRef =
  | { kind: 'tiles'; source: 'cesium' | 'google' }          // Ort steht in HQ/Ursprung des Laufs
  | { kind: 'devworld'; terrain: string; seed: number; buildings: string; spawns: number }
  | { kind: 'custom-map'; mapId: string; contentHash: string; name?: string };
```

- URL: `?world=map:<id>` (eigene Karte), `?devworld…` bleibt als Kurzform für DevWorld
- `WorldPackage`, Spielstand, Replay-Datei und Run-Log bekommen `world: WorldRef`. Dateien ohne das Feld werden beim
  Lesen abgebildet: Ursprung (0, 0) mit `map: 'devworld'` → DevWorld, sonst Tiles
- `WorldProviderRegistry.create(ref)` liefert den Provider; fehlt eine Karte oder passt der Hash nicht, kommt eine
  klare Meldung

### WorldProvider (`src/app/world/world-provider.ts`)

Eine Welt auf dem Hauptthread: Darstellung, Abfragen, Straßen, Startaufstellung.

```ts
interface WorldProvider {
  readonly ref: WorldRef;
  readonly capabilities: WorldCapabilities;
  readonly surface: WorldSurface;        // Höhen, Raycasts, Spalten, Sichtlinie
  readonly streets: WorldStreetSource;   // Wegenetz, Pfadsuche, Zufallspunkte, Filter
  readonly streetStyle: StreetStyle;     // Anhebung, Unterteilung, Brücken
  attach(ctx: WorldAttachContext): Promise<void>; // Szene, Kamera, Renderer, CameraRig, Sync
  setOrigin(lat: number, lon: number, height: number): void;
  update(dt: number, camera: Camera): void;
  beforeRender(camera: Camera): void;
  losBlockers(): Object3D | null;        // Gruppe für den LOS-Würfel
  pickRoot(): Object3D | null;           // Boden für die Kamera-Steuerung
  startLayout(): WorldStartLayout | null; // feste HQ/Spawns (Karte, DevWorld) oder null (Tiles: Spieler wählt)
  attribution(): string;
  events: WorldLoadEvents;               // erster Boden geladen, geladen, Auth-Fehler
  dispose(): void;
}

interface WorldCapabilities {
  realPlace: boolean;      // echter Ort: Nominatim, zuletzt besucht, Bestwellen, ?l=, Ortswechsel, Globus
  streaming: boolean;      // Boden lädt nach (Tiles): Ladeanzeige, LOD-Korridor, Neuabtastung
  ecef: boolean;           // sceneToEcef für Tauchflug und Globus
  credentials: boolean;    // braucht Token/Key
  regenerate: boolean;     // DevWorld: neu würfeln
  destructible: boolean;   // Gebäude zerstörbar (später)
  controls: 'globe' | 'environment';
}
```

Implementierungen:

| Provider | Ordner | Herkunft |
|----------|--------|----------|
| `TilesWorld` | `world/tiles/` | Tiles-Teil von `ThreeTilesEngine`, `TerrainQueries`, `ScreenPicker`, `RouteCorridorTiles`, `TileLoadingTracker`, OSM |
| `DevWorldProvider` | `devworld/` | `DevTerrainProvider`, `DevStreetProvider`, Teile von `LocationFacadeService` |
| `CustomMapWorld` | `world/custom-map/` | neu: Kartendokument, Renderer, Wegenetz der Karte |

Spätere: `OwnTilesWorld` (eigene Tilesets, Variante von `TilesWorld` mit anderer Quelle), Zerstörung als
`capabilities.destructible` plus Hook am Provider.

### WorldStreetSource

Ersetzt die direkte Injektion von `OsmStreetService` in rund acht Diensten. Enthält `loadStreets`, `findPath`,
`findNearestStreetPoint`, `findRandomStreetPoint`, `filterStreetsNearRoutes`, `segmentRoutes`, `spawnLabel`,
`prefetch`, `loadBuildingsNearRoutes` (Tiles: Overpass; Karten: keine, Gebäude sind Objekte der Karte).
`OsmStreetService` implementiert sie für Tiles, `DevStreetProvider` für DevWorld, das Wegenetz der Karte für eigene
Karten. Dienste holen sie über `WorldContext.streets`.

### WorldContext (Angular-Dienst)

Hält den aktiven Provider und seinen `WorldRef` als Signal. Einzige Stelle, an der Dienste die Welt erreichen.

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
- `environment`: Himmel, Sonnenstand, Nebel, Licht

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
2. Engine und Abfragen auf `WorldProvider` (Tiles, DevWorld), Straßenquelle, Startablauf, `WorldRef` überall
3. parallel: W3X-Leser und Konverter, Karten-Renderer und Assets, Editor
4. `CustomMapWorld` im Spiel, Coop mit eigener Karte (Host schickt das Kartenpaket)

## Kopplungsstellen heute (Erkundung 2026-10-11)

Schlimmste zuerst: `ThreeTilesEngine` (DevWorld-Parameter, Zugangsdaten, `getDevTerrainProvider()`,
Render/LOS/ECEF-Zweige); `TerrainQueries`/`ScreenPicker`/`TowerPlacementService` (`tiles()` vs `devTerrain()`);
OSM fest in Ortswechsel, Kartenverschiebung, Platzierung, strategischer Platzierung, Turmplatzierung,
Gebäude-Overlay, Visualisierung; `LocationFacadeService` und `EngineInitializationService.loadStreets`;
Zugangsdaten im Startablauf (Token-Prüfung kennt DevWorld nicht, E2E legt deshalb einen falschen Token ab);
Welt-Identität (`DEV_WORLD_ORIGIN`-Vergleiche, `RunMap`, kein Weltfeld in `WorldPackage`/Spielstand);
Straßen-Darstellung (DevWorld-Unterteilung und Anhebung); UI-Schalter (Kopfzeile, Schnellaktionen, Fotomodus,
Spielstand, Globus, Logos); drei leicht verschiedene Geo-Umrechnungen.
