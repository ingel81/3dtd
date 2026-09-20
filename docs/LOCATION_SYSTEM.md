# Location System

**Stand:** 2026-09-16

Das Location-System ermöglicht es Spielern, ihren eigenen Spielort zu wählen. Die URL ist die Single Source of Truth für die aktuelle Location.

## Übersicht

```
URL (?l=...&s=...)                  ← Source of Truth
  ↓
UrlLocationService                  ← Parse/Update URL
  ↓
LocationManagementService           ← State (Signals), Favorites
  ↓
LocationFacadeService               ← Location Detection, Spawn-Logik
  ↓
LocationChangeCoordinatorService    ← Dialog, Favoriten, Weltwürfel; applyNewLocation
  ↓
LocationChangeExecutorService       ← 7-Step Location Change Sequence
  ↓
LocationDialogComponent             ← UI für Ortswahl
```

## Dateien

```
models/location.types.ts                                    - Interfaces (LocationConfig, LocationInfo, etc.)
store/location.store.ts                                     - LocationStore (Angular Signals)
services/location/location-management.service.ts            - Location State & Favorites
services/location/location-change-coordinator.service.ts    - Location-UI-Flows, applyNewLocation (Guard + Fehler-Unwinding)
services/location/location-change-executor.service.ts       - 7-Step Change Sequence
services/facade/location-facade.service.ts                  - Sub-Facade (Detection, Spawns, Cleanup)
services/location/url-location.service.ts                   - URL als Source of Truth
services/location/geocoding.service.ts                      - Nominatim Forward/Reverse Geocoding
services/location/geolocation.service.ts                    - Browser-Geolocation (kein IP-Lookup)
services/location/osm-street.service.ts                     - Straßen via Overpass, A*, Random-Spawn-Suche
services/location/street-cache.service.ts                   - IndexedDB-Cache für Straßennetze
services/location/world-dice.service.ts                     - Zufällige Stadt aus der mitgelieferten Liste
services/world/path-route.service.ts                        - Routen je Spawn (Cache, Routenlinie)
services/world/map-placement.service.ts                     - HQ/Spawn per Klick auf die Karte
services/location/best-waves.ts                             - Beste Welle je Ort: Liste, Rekord, localStorage (reine Funktionen)
services/location/best-wave.service.ts                      - Beste Welle je Ort: Aufzeichnung am Event-Bus, neuer Rekord bei Game Over
components/location-dialog/location-dialog.component.ts  - Dialog UI
components/address-autocomplete.component.ts        - Adress-Autocomplete
components/world-globe/world-globe.component.ts             - Weltkarte: Globus auf 2D-Canvas
components/world-globe/globe-projection.ts                  - Orthografische Projektion, Horizont-Schnitt, Drehen, Zoom
components/world-globe/world-outlines.data.ts               - Küsten und Landgrenzen (generiert, Natural Earth)
components/world-globe/world-record.component.ts            - Hinweis "New record" im Game-Over-Overlay
tools/world-outlines/build.mjs                              - Erzeugt world-outlines.data.ts
```

## Interfaces (`location.types.ts`)

Alle Koordinaten-Typen basieren auf `GeoPosition` (`lat`/`lon`/`height?`) aus `game.types.ts`.

```typescript
// Location mit optionalem Namen
interface LocationConfig extends GeoPosition {
  name?: string;              // Full displayName from OSM
  address?: NominatimAddress; // Strukturierte Adresse
}

// Vollständige Location-Info mit Anzeigenamen
interface LocationInfo extends GeoPosition {
  name: string;               // Display name (city/place)
  displayName: string;        // Full Nominatim display name
  address?: NominatimAddress;
}

// Spawn, wie der Ort ihn hält (LocationManagementService.spawns, URL, Favoriten)
interface SavedSpawn extends GeoPosition {
  portalBearing?: number;     // Kompasskurs des Portals, wenn der Spieler es mit R gedreht hat
}

// Spawn-Punkt Konfiguration
interface SpawnLocationConfig extends SavedSpawn {
  id: string;
  name?: string;
  isRandom?: boolean;
}

// Dialog-Eingabe
interface LocationDialogData {
  currentLocation: LocationInfo | null;
  currentSpawn: SpawnLocationConfig | null;
  isGameInProgress: boolean;
}

// Dialog-Ergebnis
interface LocationDialogResult {
  hq: LocationInfo;
  spawn: SpawnLocationConfig;
  confirmed: boolean;
}

// Zufälliger Spawn-Kandidat
interface RandomSpawnCandidate extends GeoPosition {
  distance: number;
  streetName?: string;
  nodeId?: number;
}

// Favoriten-Location; ohne eigenen Namen kommt er aus dem Geocoding-Cache
interface FavoriteLocation {
  id: string;
  hq: GeoPosition;
  spawns: SavedSpawn[];       // mit portalBearing, wo das Portal gedreht war
  createdAt: number;
  name?: string;              // vom Spieler, beim Speichern vorgeschlagen
}
```

## LocationStore (`store/location.store.ts`)

Zentrale Angular Signals für Location-Daten in der UI:

```typescript
@Injectable({ providedIn: 'root' })
export class LocationStore {
  readonly baseCoords = signal<GeoCoord>({ lat: 0, lon: 0 });
  readonly centerCoords = signal<GeoCoordWithHeight>({ lat: 0, lon: 0, height: 400 });
  readonly spawnPoints = signal<StoreSpawnPoint[]>([]);
  readonly streetCount = signal<number>(0);

  resetAll(): void { /* setzt alle Signals auf Defaults */ }
}
```

Geschrieben werden die Signals über `LocationFacadeService` und die Coordinator-Callbacks.
Anzeigename, Favoriten und `isApplyingLocation` hält `LocationManagementService`, die
Favoriten-Namen `LocationChangeCoordinatorService.favoriteNamesMap`.

## LocationManagementService

Verwaltet den aktuellen Location-State und Favorites. Ein Favorit speichert Koordinaten und optional einen eigenen Namen; ohne eigenen Namen wird er über `GeocodingService` aufgelöst (mit Cache).

### Signals

```typescript
readonly hq = signal<{ lat: number; lon: number } | null>(null);
readonly spawns = signal<SavedSpawn[]>([]);                // mit portalBearing, wo das Portal gedreht ist
readonly needsRandomSpawn = signal<boolean>(false);
readonly displayName = signal<string>(NO_LOCATION_NAME);   // 'No location', auch nach reset()
readonly address = signal<NominatimAddress | null>(null);  // Adresse aus dem Reverse Geocoding
readonly missionInfo = computed<MissionInfo | null>(...);  // Straße, PLZ, Ort, Koordinaten für den Ladescreen
readonly isApplyingLocation = signal(false);
readonly favorites = signal<FavoriteLocation[]>([]);
readonly recents = signal<RecentLocation[]>([]);           // zuletzt gespielte Orte, siehe Zuletzt gespielt
readonly hasLocation = computed(() => this.hq() !== null);
readonly editableHqLocation = computed(() => { ... });       // { lat, lon, name }
readonly editableSpawnLocations = computed(() => { ... });    // SpawnLocationConfig[]
readonly recentCandidate = computed(() => { ... });           // der Ort als Recent-Eintrag, sobald er spielbar ist
```

### Methoden

```typescript
// Location setzen und Display-Name via Reverse Geocoding auflösen
setLocation(hq: { lat: number; lon: number }, spawns: SavedSpawn[]): void
// Wenn spawns leer → needsRandomSpawn = true (wird später generiert)
// URL und Favoriten nehmen die Spawns samt portalBearing von hier
// HQ und Spawns in kanonischer Form, siehe Kanonische Koordinaten

// Display-Name abfragen
getLocationDisplayName(): string

// Generierte Spawns setzen (nach Random-Generation)
setGeneratedSpawns(spawns: { lat: number; lon: number }[]): void

// Favorites
saveFavorite(name?: string): void          // Aktuelle Location ans Ende der Liste, ohne Obergrenze
renameFavorite(id: string, name: string): void  // leerer Name: zurück zum Geocoding-Namen
moveFavorite(id: string, offset: number): void  // -1 hoch, 1 runter, an den Enden Schluss
deleteFavorite(id: string): void
getFavoriteDisplayName(fav: FavoriteLocation): Promise<string>
loadFavorites(): void         // Aus localStorage laden (Key: td_favorites_v2)

// Zuruecksetzen
reset(): void                 // Alle Signals auf Defaults
```

### Favorites-System

- Keine Obergrenze (bis 2026-09-14 waren es 10, danach verschwand "Save location" ohne Hinweis); die Liste im Header scrollt
- Gespeichert in `localStorage` unter Key `td_favorites_v2`, in der Reihenfolge des Spielers; Laden, Speichern, Umbenennen und Verschieben als reine Funktionen in `favorite-locations.ts`
- Jeder Favorit hat `id` (crypto.randomUUID), `hq`, `spawns`, `createdAt`, optional `name`
- Ein Spawn trägt `portalBearing`, wenn sein Portal beim Speichern gedreht war (siehe [UrlLocationService](#urllocationservice)); Laden dreht es wieder so
- Einträge von vor dem 2026-09-14 haben keinen `name` und keinen `portalBearing` und lesen sich unverändert (das Portal folgt der Route); defekte Einträge (auch ein `portalBearing`, der keine Zahl ist) werden beim Laden übersprungen
- Namen: der eigene (`name`, getrimmt, höchstens 80 Zeichen), sonst via `GeocodingService.reverseGeocodeWithCache()` aufgelöst (`favoriteNamesMap`, nur für Favoriten ohne eigenen Namen)

Bedienung im Header (Lesezeichen-Knopf):

| Aktion | Ablauf |
|--------|--------|
| Anlegen | "Save location" öffnet an seiner Stelle ein Namensfeld, vorbefüllt mit dem Header-Namen ("DEFEND …"; leer, solange er lädt) und markiert. Enter oder der Haken speichert, Esc oder das Kreuz bricht ab. Ein leeres Feld speichert ohne Namen |
| Umbenennen | Stift je Zeile, dasselbe Namensfeld an Stelle der Zeile, vorbefüllt mit dem angezeigten Namen |
| Ordnen | Pfeil hoch und runter je Zeile; am Anfang bzw. Ende gesperrt |
| Löschen | Kreuz je Zeile |
| Laden | Klick auf Name oder Koordinaten |

### Zuletzt gespielt (Recent)

- `recents` (Signal), gespeichert unter eigenem Key `td_recent_locations_v1`, Logik in `recent-locations.ts`
- Ein `effect()` im Konstruktor schreibt einen Eintrag, sobald HQ, mindestens ein Spawn und ein aufgelöster Name vorliegen. Damit ist jeder Weg abgedeckt (URL, Geolocation, Dialog, Favorit, World Dice, HQ versetzen), ohne jeden einzeln anzufassen
- Max. 8 Einträge, neueste zuerst. HQs näher als 150 m gelten als derselbe Ort: der Eintrag rückt nach oben und übernimmt Spawn und Namen, statt eine zweite Zeile anzulegen
- Der Name wird mitgespeichert (anders als bei Favoriten), die Liste braucht also kein Geocoding
- DevWorld (Fake-Origin 0,0) wird nicht gespeichert; defekte Einträge im Storage werden beim Laden übersprungen

## Weltkarte (beste Welle je Ort)

Ein Globus mit allen verteidigten Orten und der besten Welle je Ort; ein Klick lädt den Ort.

### Speicher (`best-waves.ts`)

- Key `td_best_waves_v1`, ein Eintrag je Ort: HQ, Spawns des Rekordlaufs, Name, Headertext (`detail`), beste Welle, Zeitpunkt. Orte wie bei Recent: HQs näher als 150 m sind derselbe Ort
- Name: Ort aus der Adresse (`GeocodingService.extractLocationName`, city > town > village > ...), sonst der Headertext, solange der noch lädt die Koordinaten. Ein neuer Rekord übernimmt HQ, Spawns und Namen des Laufs
- Max. 200 Orte. Darüber kommt der gerade gespielte Ort trotzdem hinein, der schwächste andere (niedrigste Welle, dann der älteste) fällt heraus
- Unlesbarer Storage liest sich als leere Liste, defekte Einträge werden beim Laden übersprungen

### Aufzeichnung (`BestWaveService`)

- Hängt am Event-Bus, verbunden in `TowerDefenseFacadeService` neben dem Onboarding
- Geschrieben wird bei `wave:started`: Welle N gestartet heißt Welle N erreicht, dieselbe Zahl, die die Game-Over-Bilanz als Wave zeigt. So bleibt der Stand auch bei Läufen, die nicht mit Game Over enden (Restart, anderer Ort, World Dice mit Reload, Reload, Tab geschlossen), ohne einen Hook für jeden dieser Wege
- Nichts in DevWorld und nichts, solange der Bot spielt (`TrainingClientService.botEnabled`). Cheats und Debug-Wellen zählen mit, ein Wellensprung (Dev-Cheat, `wave:jumped`) nicht: ab dem Sprung schreibt der Lauf keinen Rekord mehr und bekommt bei `game:over` keinen `newRecord`. Was vor dem Sprung erreicht war, bleibt stehen; `game:reset` hebt die Sperre auf
- Neuer Rekord: beim ersten Wellenstart eines Laufs merkt sich der Service den bisherigen Rekord des Ortes. Liegt die erreichte Welle bei `game:over` darüber, steht in `newRecord` Ort, Welle und der alte Rekord (0 beim ersten Lauf dort). `game:reset` und Skip leeren ihn

### Einstiege

| Wo | Was |
|----|-----|
| Standort-Dialog, Tab "World" | Globus, darunter die Orte als Zeilen (Name, Welle), höchste Welle zuerst |
| Sidebar-Fuß, "World" | Öffnet den Standort-Dialog auf dem Tab (`openLocationDialog('world')`, `LocationDialogData.initialMode`) |
| Game-Over-Overlay | Unter Restart, blendet nach 1,2 s ein: kleiner Globus auf den Ort gedreht und gold umringt, "New record for <Ort>: wave N", darunter "Best before: wave M" oder "First run here"; "Skip" blendet aus. Der Restart-Button verschiebt sich nicht |

Ein Klick auf einen Marker oder eine Zeile schließt den Dialog wie ein Recent-Eintrag: HQ und erster Spawn des Rekordlaufs (`spawn.id: 'spawn_world'`, ohne Spawn Random), der Coordinator wendet ihn an. Der gerade gespielte Ort ist grau umringt, in der Liste ausgegraut und lädt nicht. Hover oder Fokus auf einer Zeile dreht den Globus zum Ort.

### Globus (`components/world-globe/`)

- 2D-Canvas in orthografischer Projektion (`globe-projection.ts`, ohne Angular und Canvas testbar): dunkle Scheibe (`--td-panel-shadow`), Gradnetz alle 30°, Landgrenzen und Küsten in den Rahmen-Grautönen, Marker in `--td-gold` mit der Welle daneben. Linien werden am Horizont geschnitten und enden am Rand; Beschriftungen, die eine höhere überdecken würden, fallen weg; Marker blassen zum Rand hin aus
- Ziehen dreht (Breite des Mittelpunkts bis ±80°), Mausrad zoomt 1x bis 8x, Hover zeigt Name, Headertext und beste Welle
- Gezeichnet wird außerhalb von Angular per `requestAnimationFrame`, nur bei Änderungen; einziges Signal ist der Hover-Tipp, und das nur, wenn sich der Ort darunter ändert
- Lazy: Globus und Umrisse sind ein eigener Chunk (`world-globe-component`, 32 kB roh, 16 kB übertragen), geladen per `@defer (on immediate)` beim ersten Öffnen des Tabs oder beim ersten Rekord-Hinweis. Kein `@placeholder`, `@loading` oder `on timer`: deren Code käme in den Core-Chunk des Initial-Bundles (für `@placeholder` und `@loading` gemessen: +2,4 kB)

### Umrisse (Natural Earth)

Quelle: Natural Earth 1:110m, Version 5.1.2, `ne_110m_coastline` und `ne_110m_admin_0_boundary_lines_land`, **Public Domain** (https://www.naturalearthdata.com/about/terms-of-use/). In den Credits unter "Map Data".

`node tools/world-outlines/build.mjs` lädt beide GeoJSON-Dateien von GitHub (nvkelso/natural-earth-vector, Tag v5.1.2) oder liest sie aus einem Ordner (`build.mjs <dir>`), vereinfacht jede Linie (Douglas-Peucker, 0,1°), teilt Segmente über 2° (der Globus zieht gerade Sehnen, eine Grenze entlang 49° N soll mitbiegen), rundet auf 0,1° und schreibt kodierte Polylines (Googles Polyline-Algorithmus mit Faktor 10, Breite vor Länge) nach `world-outlines.data.ts`: rund 7200 Punkte in 20 kB Text. `decodePolyline()` liest sie zurück.

## UrlLocationService

URL ist die Single Source of Truth. Format:

```
?l=49.17327,9.26859&s=49.17555,9.26387,187.5;49.18000,9.27000
```

- `l` = HQ (lat,lon) - 5 Dezimalstellen (`COORD_DECIMALS`), die kanonische Form, siehe [Kanonische Koordinaten](#kanonische-koordinaten)
- `s` = Spawns (Semikolon-getrennt), optional; je Spawn `lat,lon` und, wenn der Spieler sein Portal beim Setzen mit R gedreht hat, der Kompasskurs des Portals in Grad (im Uhrzeigersinn ab Nord, 1 Dezimalstelle, `SavedSpawn.portalBearing`)
- Kein `s`-Parameter = Random Spawn wird generiert
- Ein Spawn ohne Kurs (auch in allen URLs von vor 2026-09-14) folgt mit seinem Portal der Route. Ein Kurs, der keine Zahl ist, fällt weg, der Spawn bleibt
- In DevWorld schreibt `LocationFacadeService.syncUrlWithLocation()` nichts in die URL

Die Drehung des Spawn-Portals:

| Weg | Kurs |
|-----|------|
| Spawn setzen mit R-Drehung (`MapRelocationService.applySpawnInPlace`) | `portalHeadingToBearing` der Drehung, in `LocationManagementService.spawns`, von dort in die URL und in einen danach gespeicherten Favoriten |
| Reload, geteilter Link | aus `s`, `addPredefinedSpawns` → `addSpawnPoint(…, portalBearing)` |
| Favorit laden | aus `FavoriteLocation.spawns[0]`, über `applyNewLocation` (Schritt 2 schreibt ihn in Ort und URL, Schritt 5 an den Spawn) |
| HQ versetzen (in place und außerhalb der Straßen), Standort-Dialog, Zuletzt gespielt, Weltkarte, World Dice | keiner, das Portal folgt der Route |

`LocationFacadeService.addSpawnPoint` dreht das Portal nach dem Bau der Route (`MarkerVisualizationService.setPortalHeading`); jeder Bau der Route hält den Kurs im Drehbereich dieser Route (`clampPortalHeading`). Hat sich die Route seit dem Speichern geändert, steht das Portal an der Grenze; im Ort, in der URL und im Favoriten bleibt der Kurs, wie er gegeben wurde. Mehr zum Drehbereich in [SPAWN_PORTAL.md](SPAWN_PORTAL.md#drehbereich).

```typescript
parseFromUrl(): { hq, spawns } | null   // URL parsen
updateUrl(hq, spawns): void              // URL ohne Reload aktualisieren (replaceState), Spawns samt Kurs
getShareUrl(): string                    // Aktuelle URL für Sharing
```

## Kanonische Koordinaten

Ein Ort hat eine Form seiner Koordinaten, gleich über welchen Weg er geladen wird: HQ und Spawns auf 5 Nachkommastellen (`COORD_DECIMALS`), so wie die URL sie schreibt, rund 1,1 m Nord-Süd und 0,7 m Ost-West in Mitteleuropa. `canonicalCoords()` (`utils/geo-utils.ts`) rundet genau wie `toFixed` beim Schreiben der URL, eine URL liest den Punkt also unverändert zurück. Engine-Origin, Routen und Korridor-Zellen hängen an jeder Stelle: Rothenburg, nach einem Ortswechsel mit allen Stellen geladen, lag 0,19 m neben Rothenburg aus seiner URL und bekam bei denselben Tiles einen anderen Korridor (Playtest 747).

Gerundet wird dort, wo Koordinaten ins Spiel kommen, bevor Origin, Routen oder Korridor sie sehen:

| Stelle | Was dort hereinkommt |
|--------|----------------------|
| `LocationManagementService.setLocation`, `setGeneratedSpawns` | Der Ort beim Start (URL, Browser-Standort, Dialog) und nach jedem Wechsel; URL, Favoriten, Zuletzt gespielt und Weltkarte speichern ihn von hier |
| `LocationChangeCoordinatorService.applyNewLocation` | Jeder Ortswechsel: Dialog (Suche, Koordinaten, Zuletzt gespielt, Showcase, Weltkarte), Favorit, HQ außerhalb der Straßen, erneuter Versuch. Der Dialog-Zweig rundet das HQ schon davor, weil er die Straßen für einen Zufalls-Spawn um das HQ lädt |
| `OsmStreetService.findRandomStreetPoint` | Der Zufalls-Spawn: der OSM-Knoten (7 Stellen) gerundet, bevor Abstand und Route geprüft werden. Gerundet kann der Punkt näher an einem anderen Weg liegen; geprüft wird die Route, die der Spawn dann wirklich bekommt |
| `LocationFacadeService.addSpawnPoint` | Jeder Spawn im Spiel |
| `MapPlacementService.updatePreviewPosition` | HQ und Spawn per Klick: Prüfung und Vorschau sehen den Punkt, der gesetzt wird; die Vorschau folgt dem Cursor dadurch in Schritten von rund einem Meter |

- Gespeicherte Orte mit mehr Stellen (Favoriten, Zuletzt gespielt, Weltkarte) bleiben im Speicher, wie sie sind, und werden gerundet, wenn der Ort geladen wird. Neue Einträge kommen aus `LocationManagementService` und sind schon kanonisch; eine Migration gibt es nicht
- Das Runden versetzt einen Punkt um höchstens 0,000005° je Achse: bei 49° N bis 0,56 m nach Nord oder Süd und 0,36 m nach Ost oder West (zusammen 0,66 m), am Äquator bis 0,79 m
- Ein Ort, der bis 2026-09-16 mit voller Genauigkeit geladen wurde (etwa ein Favorit von einem per Klick versetzten HQ), kann dadurch einen anderen Korridor bekommen als bisher, dafür denselben wie über seine URL
- DevWorld: der Origin 0/0 bleibt, die Spawns des Straßengenerators laufen ebenfalls durch `addSpawnPoint`

## GeolocationService

Automatische Standort-Erkennung:

```
1. Browser Geolocation API (GPS/WiFi, 15s Timeout für Permission-Dialog)
   ↓ (bei Fehler/Ablehnung)
2. null → Location-Dialog wird angezeigt
```

```typescript
async detectLocation(): Promise<GeolocationResult | null>
// GeolocationResult = { lat, lon, source: 'browser' }
```

Dazwischen lag früher ein IP-Lookup über ip-api.com. Der ist raus: der
kostenlose Tarif spricht nur http, auf der ausgelieferten https-Seite blockt
der Browser den Request ohnehin als Mixed Content, und die IP jedes Spielers
ging an einen Dritten für eine Schätzung, die der Dialog mit einem Klick
genauer hinbekommt.

## GeocodingService

Nominatim (OpenStreetMap) API für Forward- und Reverse-Geocoding.

### Forward Search (Adresssuche)

```typescript
search(query: string): void
// - Debounced (300ms)
// - Min. 3 Zeichen
// - Max. 8 Ergebnisse
// - AbortController für Request-Cancellation

readonly isLoading = signal(false);
readonly results = signal<GeocodingResult[]>([]);
readonly error = signal<string | null>(null);   // 'Address search failed'

clearResults(): void
```

### Reverse Geocoding

```typescript
reverseGeocodeDetailed(lat, lon): Promise<ReverseGeocodeResult | null>
// Vollständig: displayName + locationName + address + lat/lon

reverseGeocodeWithCache(lat, lon): Promise<string>
// Memory-Cache, beim Start aus localStorage geladen (Key: td_geocode_cache_v1)
// Max. 100 Einträge, 4 Dezimalstellen Präzision (~11m)
// Fallback: "lat, lon" mit 4 Nachkommastellen, wird nicht gecacht
// Kein Retry bei HTTP 429
```

### Helper-Methoden

```typescript
extractLocationName(address: NominatimAddress): string
// Priorität: city > town > village > municipality > suburb > city_district > county
// Sonst UNKNOWN_LOCATION_NAME ('Unknown location')

formatAddressShort(addr: NominatimAddress): string
// Format: "Straße 123, Stadt"; ohne Straße und Ort: UNKNOWN_LOCATION_NAME
```

## Location Detection Flow

Beim App-Start in `LocationFacadeService.initializeLocation()`:

```
1. DevWorld aktiv?
   → Fake-Origin (DEV_WORLD_ORIGIN) ohne Spawn setzen, fertig
     (der Spawn kommt später aus dem Straßengenerator, siehe DEVWORLD.md)

2. URL-Parameter vorhanden? (UrlLocationService.parseFromUrl())
   → Location aus URL laden, fertig

3. Geolocation (GeolocationService.detectLocation())
   → Browser-Geolocation, 15 s Timeout
   → Bei Erfolg: Location ohne Spawn setzen, fertig

4. Nichts gefunden
   → Location-Dialog (disableClose: true) anzeigen
   → Warten bis User eine Location wählt
```

Nach Erkennung wird die URL synchronisiert (`syncUrlWithLocation()`).

## LocationChangeCoordinatorService - 7-Step Sequence

Orchestriert den kompletten Ortswechsel. Extrahiert aus der TowerDefenseComponent um God-Object-Komplexität zu reduzieren.
`applyNewLocation()` verhindert parallele Wechsel, lässt die sieben Schritte in
`LocationChangeExecutorService.executeLocationChange()` laufen und setzt bei einem
Fehler die Loading-Flags zurück.

### Delegate-Pattern

Der Coordinator arbeitet mit einem `LocationFlowDelegate`-Interface, das vom Component (via `LocationFacadeService.buildLocationFlowDelegate()`) implementiert wird:

```typescript
interface LocationFlowDelegate {
  getChangeContext(): LocationChangeContext | null;   // Engine, GameState, StreetNetwork
  getChangeCallbacks(): LocationChangeCallbacks;      // Signal-Updates, Actions
  isGameInProgress(): boolean;
  getCurrentLocationName(): string;
}
```

### Die 7 Steps

```
STEP 1: Initialize Loading State
  - Loading-Flags setzen (tiles, OSM, heights)
  - isApplyingLocation = true
  - Loading-Steps zurücksetzen

STEP 2: Reset & Configure Engine
  - Height-Updates, Route-Animation und Intro-Kamerafahrt stoppen
  - gameState.reset() (Enemies, Towers, Projectiles, Effects)
  - Map-Entities und Pfad-Cache leeren; dazu gehören die Route-Zellen mit
    ihren Overlays (Route Grid, Air Route Grid, Flughöhe der Air-Route,
    `GlobalRouteGridService.clear()`), sonst stünde der alte Korridor bis
    STEP 6 verschoben auf der Karte. Die Route aus STEP 5 entsteht damit wie
    beim ersten Laden ohne Zellen (Linie flach auf HQ-Höhe, Portal auf der
    Terrain-Probe am Routenstart), STEP 6 baut die Zellen neu
  - Engine-Origin auf neue Koordinaten setzen
  - LocationManagementService.setLocation() aufrufen
  - URL synchronisieren
  - Initiale Kamera-Framing berechnen und anwenden

STEP 3: Load Streets
  - OSM-Straßendaten laden (2000m Radius)
  - Cache-Check: Wenn gleiche Location (~100m), Cache wiederverwenden
  - Sonst OsmStreetService.loadStreets(): erst IndexedDB (StreetCacheService,
    Key v2_<lat>_<lon>_<radius>, max. 5 Orte, LRU), dann Overpass mit drei
    Servern der Reihe nach (`OsmStreetService.fetchOverpass`): Scheitert
    einer, kommt sofort der nächste dran; hat einer nach 4 s noch nicht zu
    antworten begonnen (`OVERPASS_HEDGE_MS`, eine Annahme), wird der nächste
    zusätzlich gefragt. Die erste brauchbare Antwort gewinnt, die anderen
    Anfragen werden abgebrochen. Jeder Server hat 15 s bis zu den Headern
    und danach 30 s für den Body, sonst kommt der nächste dran. Jeder Versuch steht als
    `[OSM] streets from ...` in der Konsole, siehe "Zeiten" unten
  - Überlappt die Box die zuletzt geladenen Straßen (`lastLoaded`, eine im
    Speicher, aus Overpass oder dem IndexedDB-Cache), übernimmt
    `loadStreets` deren Ways, die durch die neue Box laufen, und fragt
    Overpass nur nach dem Rest der Box, in bis zu vier Streifen
    (`street-box.ts`: `boxMinus`, `mergeStreets`). Nach einem HQ-Umzug knapp
    über eine Kante der geladenen Straßen ist das etwa die halbe Box, über
    eine Ecke drei Viertel; deckt das geladene Netz die Box ganz ab, geht
    keine Anfrage raus. Ein Way, der in beiden Teilen liegt, kommt einmal
    vor; die Ways sind nach id sortiert wie bei Overpass. Konsole:
    `[OSM] streets: X of Ykm² from the streets loaded before, fetching Zkm² in N boxes`
  - Street-Count aktualisieren
  - Street-Rendering läuft progressiv (50 Nodes/Frame, alte Straßen
    bleiben sichtbar, bis neue fertig sind; `street-rendering.service.ts`)

STEP 4: Place HQ Marker
  - Erste Tiles abwarten (mit 15s Timeout-Fallback), schon unter dem
    Boot-Step "Placing Headquarters"; bis 2026-09-16 lief die Wartezeit
    zwischen zwei Schritten, ohne dass einer aktiv war
  - MarkerVisualizationService initialisieren
  - PathAndRouteService initialisieren
  - CameraControlService initialisieren
  - RouteAnimationService initialisieren
  - IntroCameraFlightService initialisieren
  - KeyboardPanService initialisieren
  - HQ Base-Marker platzieren

STEP 5: Place Spawn Point
  - Spawn-Punkt mit Marker und Pfad hinzufügen
    (addSpawnPoint() → PathAndRouteService.showPathFromSpawn(): A* über das
    Straßennetz, die Route landet im Routen-Cache)
  - Spawn-Name aus Input extrahieren (vor erstem Komma)
  - Farbe: SPAWN_COLORS[0]

STEP 6: Calculate Routes
  - gameState.initialize() mit Engine, HQ, Spawns und den gecachten Routen
  - Validierung: Mindestens 1 Route muss existieren
  - GlobalRouteGrid initialisieren (eigener Boot-Step "Generating Route Grid")
  - Eingeschaltete Overlays (Route Grid, Air Route Grid, Flughöhe der
    Air-Route) gleich auf die neuen Zellen zeichnen (`init…IfEnabled()` wie
    am Ende eines Korridor-Baus); STEP 2 hat sie mit den alten Zellen
    entsorgt
  - TowerPlacement neu initialisieren
  - Street-Network auf Route-Korridor filtern (nicht in DevWorld)
  - Höhen liegen in den Zellen des GlobalRouteGrid, jede mit Tiefe und
    geometricError des Tiles, aus dem ihr Sample stammt. Eine Zelle wird
    einmal beim Erzeugen gesampelt; danach schreibt nur noch der
    Korridor-Bau (`utils/route-cell-sampler.ts`, siehe ROUTE_CORRIDOR.md)

STEP 7: Finalize
  - Höhen-Updates durchführen (await); danach baut `CorridorBuild` den
    Korridor hinter dem Ladescreen (Boot-Step "Measuring the Corridor")
    und friert ihn ein, siehe ROUTE_CORRIDOR.md
  - isApplyingLocation = false
  - Route-Animation starten
  - Intro-Kamerafahrt starten (IntroCameraFlightService.start())
```

### Routen-Cache

`PathAndRouteService` hält je Spawn eine Route als `RouteWaypoint[]` (`getCachedPaths()`,
Key: Spawn-ID). Jeder Waypoint trägt für das Segment ab ihm die Korridor-Halbbreite links
und rechts (`corridorLeft`/`corridorRight`). Woher die Breite kommt:
[ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md). STEP 2 leert den Cache (`clearCache()`).

### Ladescreen und Intro-Kamerafahrt

Beim ersten Laden bleibt der Ladescreen nach Tiles, Straßen und Höhen noch stehen
(`IntroLoadingGate.hold()`, `services/world/intro-loading-gate.ts`, aufgerufen aus
`VisualizationFacadeService.checkAllLoaded()`, Boot-Step "Preparing Intro Flight"):
`IntroCameraFlightService.prepare()` legt die Flugbahn an, `prepareTick()` sampelt die
Route (8 Samples pro Frame). Der Screen schließt, sobald 90 % der Route verlässliche
Höhen haben (`INTRO_GATE_MIN_READY`) oder 8 s nach dem ersten Tile-Load
(`INTRO_GATE_TIMEOUT_MS`, beide in `utils/flight-gate.ts`). Ohne Route oder wenn
`prepare()` scheitert, wartet er nicht. Meldet der Engine nach dem Korridor-Bau noch
keine ersten Tiles (`tilesLoading`), wartet der Screen darauf unter demselben Schritt;
einen eigenen Schritt "Waiting for 3D Tiles" gibt es seit 2026-09-16 nicht mehr, auf die
Tiles des Korridors wartet "Measuring the Corridor".

Ein Ortswechsel wartet darauf nicht, STEP 7 startet die Fahrt direkt. Dann sichert nur die
Fahrt selbst ab: Samples mit mehr als 20 m Tile-Fehler (`maxSampleError`) zählen nicht
als verlässlich, und die Kamera bleibt mindestens 5 m (`hardClearance`) über dem bekannten
Boden.

### Location Flow Methoden

Der Coordinator bietet auch UI-Flow-Methoden:

```typescript
openLocationDialog(initialMode?): void  // Dialog öffnen (optional auf einem Tab), bei Bestätigung applyNewLocation()
onShareLocation(): void          // URL in Clipboard kopieren
onWorldDice(): Promise<void>     // Zufällige Stadt aus der Liste, URL-Reload
onAddFavorite(name?): void       // Aktuelle Location als Favorit
onRenameFavorite(id, name): void // Favorit umbenennen
onMoveFavorite(id, offset): void // Favorit hoch (-1) oder runter (1)
onSelectFavorite(fav): void      // Favorit laden und anwenden
onDeleteFavorite(id): void       // Favorit löschen
resolveFavoriteNames(): void     // Geocoding-Namen für die Favoriten ohne eigenen Namen
```

## LocationFacadeService

Sub-Facade für Location-Management. Verbindet Coordinator mit Component-State.

### Verantwortlichkeiten

- **Location Detection**: URL → Geolocation → Dialog Cascade
- **Coordinator-Initialisierung**: Baut `LocationFlowDelegate` für den Coordinator
- **Spawn-Management**: `addPredefinedSpawns()`, `addSpawnPoint()`
- **Map Cleanup**: `clearMapEntities()` (Marker, Routes, Streets, Route-Zellen mit ihren Overlays)
- **DevWorld**: Regeneration, Visual Cleanup
- **Map-Platzierung**: `handleMapPlacementClick()` gibt an `MapRelocationService` weiter (siehe HQ-Relocation)

### Spawn-Point-Logik (`addPredefinedSpawns`)

```
needsRandomSpawn && streetNetwork vorhanden?
  ├─ DevWorld aktiv?
  │   → ersten generierten Spawn vom DevTerrainProvider nehmen (der Generator liefert bis zu 4)
  │   → Fallback: DEV_WORLD_SPAWNS[devWorld.config.spawn]
  │
  └─ Real World
      → osmService.findRandomStreetPoint(network, hq, 500m, 1000m)
        (Knoten auf befahrbaren Straßentypen, bis zu 50 zufällige Kandidaten per findPath() geprüft)
      → URL mit generiertem Spawn synchronisieren

Spawns aus URL/Service vorhanden?
  → Alle Spawns mit Markern und Pfaden hinzufügen
```

## Location Dialog Component

Angular Material Dialog mit drei Modi:

### Edit Modes

| Modus | Beschreibung |
|-------|--------------|
| `full` | Neuer HQ + Spawn (Standard), Tab "New Location" |
| `spawn-only` | Nur Spawn ändern (HQ bleibt), Tab "Spawn Only"; nur mit bestehender Location, stellt den Spawn-Modus auf `manual` |
| `world` | Weltkarte der verteidigten Orte, Tab "World", siehe [Weltkarte](#weltkarte-beste-welle-je-ort); ohne Confirm-Button, ein Klick lädt |

`LocationDialogData.initialMode` wählt den Tab beim Öffnen (Standard `full`).

### Spawn Modes

| Modus | Beschreibung |
|-------|--------------|
| `random` | Automatisch 500m-1km vom HQ auf Straße platziert |
| `manual` | Adresse per Autocomplete suchen |

### Features

- **Recent / Showcase** (nur `full`-Modus, eine Liste mit zwei Tabs unter dem Spawn-Abschnitt; ohne Recent-Einträge nur Showcase): ein Klick lädt ohne Bestätigung (Ergebnis wie Confirm)
  - Recent: zuletzt gespielte Orte ohne den aktuellen, mit ihrem Spawn (`spawn.id: 'spawn_recent'`)
  - Showcase: 12 Orte aus `configs/showcase-locations.config.ts` (Name, eine Zeile Hinweis), Spawn zufällig wie im Modus Random. Koordinaten gegen OSM (Nominatim) geprüft, auf Fußweg, Straße oder Platz; nicht einzeln im Spiel angespielt. Ein Ort kann einen festen Spawn tragen (`ShowcaseLocation.spawn`, optional mit Kompasskurs, `SavedSpawn`), bisher Rio de Janeiro, Copacabana (`s=-22.96421,-43.17463`) und Tokyo, Shibuya Crossing (`l=35.65924,139.70049&s=35.65208,139.69853`, HQ und Spawn aus einer URL des Users, weil der alte Punkt eine Route um einen Block ergab); diese Orte hat der User gespielt. Ein Klick lädt ihn dann über denselben Pfad wie einen Spawn aus URL oder Favorit (`spawn.id: 'spawn_showcase'`, keine Zufallssuche). `__showcase.line()` in den DevTools druckt ein einfügefertiges `ShowcaseLocation`-Snippet für den aktuellen Ort (id/name/hint als `'TODO'`), zum Weitergeben neuer Einträge
- **Autocomplete-Suche** via `AddressAutocompleteComponent` (Nominatim)
- **Manuelle Koordinaten-Eingabe** (ausklappbar, nur für das HQ: "Enter coordinates")
  - Unterstützte Formate beim Einfügen:
    - Dezimal: `49.5432, 9.1234`
    - Kardinal: `49.5432°N, 9.1234°E`
    - Kardinal vorangestellt: `N 49.5432, E 9.1234`
    - DMS: `49°32'35.5"N 9°7'24.2"E`
    - Google Maps URL: `@49.5432,9.1234`
- **Distanz-Badge**: Zeigt Entfernung Spawn-HQ an
- **Max-Distanz**: 1,5 km, im Dialog fest als 1500 m geprüft (nicht über `MAX_MANUAL_SPAWN_DISTANCE`); darüber bleibt Confirm gesperrt. Eine Mindestdistanz prüft der Dialog nicht
- **Warnung** bei laufendem Spiel (in den Modi `full` und `world`)
- **Validation**: Confirm-Button nur aktiv, wenn ein HQ gewählt ist (im `spawn-only`-Modus: vorhanden) und der Spawn `random` oder ausgewählt ist

### Dialog-Ergebnis

```typescript
{
  hq: LocationInfo,           // { lat, lon, name, displayName, address? }
  spawn: SpawnLocationConfig, // { id, lat, lon, name?, isRandom? }
  confirmed: boolean
}
```

Bei `isRandom: true` (`id: 'spawn_random'`, `lat`/`lon` = 0) lädt der Coordinator die Straßen und sucht den Spawn mit `findRandomStreetPoint()`; findet er keinen, nimmt er einen Punkt ca. 700 m nördlich des HQ.

## HQ-Relocation (interaktives Versetzen)

Wenn der Spieler das HQ über die Map-Platzierung versetzt, wählt `MapRelocationService.applyNewHqPosition()` (`services/facade/map-relocation.service.ts`) zwischen zwei Pfaden:

### Fast Path (innerhalb Street-Bounds)

Wenn das neue HQ innerhalb der geladenen Street-Network-Bounds liegt:
- Kein Street-Reload, kein Loading Screen
- Straßennetz wird wiederverwendet
- Alte Spawns werden via `findPath()` revalidiert
- Wenn kein alter Spawn erreichbar ist → Random Spawn generieren

### Slow Path (außerhalb Street-Bounds)

Wenn das HQ außerhalb der Bounds platziert wird (z.B. 10km entfernt):
- Volle 7-Step Location Change Pipeline (mit Loading Screen)
- **Spawn-Discard-Logik**: Alter Spawn wird verworfen wenn >1500m vom neuen HQ (`SPAWN_DISCARD_DISTANCE`)
- Bei verworfenen/fehlenden Spawns: Streets werden vorab geladen, Random Spawn generiert (500-1000m)
- Street-Network wird gecached → Coordinator reused es in Step 3 (kein doppeltes Laden)
- Tiles-Wait ist schnell (~500ms) wenn der Spieler bereits dorthin gescrollt hat

### Rückmeldung (Hinweis über der Karte)

Solange das HQ umzieht, steht oben mittig ein Hinweis "MOVING HQ" mit dem laufenden Schritt (`RelocationStatusService`, `components/relocation-status/`, Aussehen in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#umzugs-hinweis-canvas)):

- **Fast Path:** "Finding the route", bevor der Umbau beginnt. Der Umbau blockiert den Hauptthread bis zum Ende, deshalb wartet er zwei Animation-Frames (`painted()`), damit der Browser den Hinweis vorher zeichnet. Danach zeigt er die Schritte des Korridor-Baus mit Prozent und 2px-Balken ("Loading the corridor tiles", "Measuring the corridor", "Building the corridor"; `CorridorBuild` meldet sie an `RelocationStatusService.follow()`, je Frame außerhalb von Angular gelesen, das Signal ändert sich nur mit Schritt und Prozentzahl). Mit dem Einfrieren des Korridors verschwindet der Hinweis, danach startet die Routen-Animation auf den eingefrorenen Routen. Ein Tower oder Wellenstart wartet währenddessen auf den Bau (`GameStateManager.corridorPending`), statt ihn abzukürzen; einen Flush gibt es nicht mehr
- **Slow Path:** "Loading streets", solange Straßen und Zufalls-Spawn vor dem Ladescreen gesucht werden; bleibt der alte Spawn, erscheint er nicht. Der Ladescreen des Ortswechsels löst ihn ab, und der Korridor entsteht dort hinter dem Ladescreen
- Spawn umsetzen zeigt denselben Hinweis mit dem Titel "Moving spawn": die neue Route entsteht aus den vorhandenen Messungen, danach baut `CorridorBuild` den Korridor (`applySpawnInPlace`)

### Zeiten (`[Relocation]` in der Konsole)

Jede Zeile nennt die Zeit je Schritt in ms (`StepTimes` in `map-relocation.service.ts`), einen Schritt, der nicht lief, mit 0.0:

```
[Relocation] HQ in place: reset= clear= services= paths= route= random= state= grid= placement= streets= camera= rest= total=ms spawnFrom=old|random|none spawns=
[Relocation] HQ done: paint= work= corridor= total=ms ended=frozen|stopped
[Relocation] HQ outside the streets: streets= spawn= total=ms spawnFrom=old|random|fallback
```

- **`HQ done`** (Fast Path, wenn der Hinweis verschwindet): `paint` = Klick bis Beginn des Umbaus (die zwei Frames für den Hinweis), `work` = der Umbau am Stück (wie `total` der Zeile davor), `corridor` = der Korridor-Bau von den Tiles bis zum Einfrieren, `total` = Klick bis der Hinweis weg ist, also die ganze Wartezeit. `ended` sagt, wie der Bau endete: `frozen` = fertig gebaut und eingefroren, `stopped` = aufgehört, ohne einzufrieren (ein neuer Bau überholte ihn, oder die Routen wurden ersetzt), dann steht der Korridor von vorher. Was der Bau gemessen und gebaut hat, sagt `[Corridor] build` daneben

- **Fast Path** (`HQ in place`): alles bis `corridor` läuft am Stück im Hauptthread, `total` ist also die Zeit, in der das Spiel steht
  - `reset`: Animation und Höhen-Updates stoppen, `gameState.reset()`
  - `clear`: Marker, Routen, Straßen, Origin, Store
  - `services`: Visualisierungsdienste neu, HQ-Marker
  - `paths`: A* vom alten Spawn zum neuen HQ (Prüfung, ob er bleibt)
  - `route`: dessen Route (A* noch einmal, Abzweig zum HQ, Korridor, Linie)
  - `random`: nur ohne gültigen alten Spawn, Suche nach einem neuen (bis zu 50 A*-Läufe) samt seiner Route
  - `state`: `gameState.initialize()`
  - `grid`: Zellen samt erster Höhenprobe je Zelle
  - `placement`: Tower-, Karten-, Fähigkeiten-, Helden-Platzierung neu
  - `streets`: Straßen filtern und zeichnen (das Zeichnen selbst läuft danach in Scheiben)
  - `camera`: Übersicht neu
  - `rest`: Standort, URL. Die Routen-Animation startet erst nach dem Bau, auf den eingefrorenen Routen
  - Der Korridor-Bau selbst läuft danach über mehrere Frames und meldet sich mit `[Corridor] build`, siehe [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md#logs); seine Dauer steht als `corridor` in der Zeile `HQ done`
- **Slow Path** (`HQ outside the streets`): die Zeit vor dem Ladescreen, `streets` = Overpass bzw. Straßen-Cache, `spawn` = Suche nach einem Zufalls-Spawn. Bleibt der alte Spawn, sind beide 0.0. Den Ortswechsel danach zeigt der Ladescreen. Wohin die Zeit von `streets` ging, sagen die `[OSM]`-Zeilen davor

Jeder Versuch bei einem Overpass-Server (`OsmStreetService.fetchOverpass`, für Straßen und Gebäude) steht mit eigener Zeile in der Konsole:

```
[OSM] streets from <host>: headers= body=ms size=MB ways= nodes= [remark="..."]
[OSM] streets from <host> failed after ms: <Grund>
```

- `headers` = Anfrage bis zu den Headern, also bis der Server zu antworten beginnt; bis dahin wartet der Versuch höchstens 15 s (`OVERPASS_HEADER_TIMEOUT_MS`, Grund dann `no answer within 15000ms`). `body` = von dort bis zum Ende der Antwort, höchstens 30 s (`OVERPASS_BODY_TIMEOUT_MS`, Grund dann `answer not complete within 30000ms`)
- `size` = Länge des JSON-Texts in Millionen Zeichen, bei OSM-Daten etwa die Bytes entpackt. `ways`/`nodes` = was kam, vor dem Filter auf die Routen (`[OSM] Filtered: ...`)
- `remark` nur, wenn der Server an eine Grenze stieß (Speicher `maxsize` 4 MB, Zeit 25 s); die Antwort kann dann unvollständig sein und wird trotzdem genommen, sobald sie Straßen enthält
- Gründe beim Scheitern: `OSM API error: <Status>` (z. B. 429, 504), `no answer within 15000ms`, `answer not complete within 30000ms`, `No streets found ...` (Antwort ohne Straßen, der nächste Server wird gefragt) oder der Netzwerkfehler des Browsers
- Ein Server, der abgebrochen wird, weil ein anderer zuerst antwortete, schreibt keine Zeile. Zwei Antwortzeilen zu einer Ladung heißen, dass beide fast gleichzeitig kamen
- Beginnt ein Server erst nach mehr als 4 s zu antworten (`headers=` über 4000), wurde der nächste schon zusätzlich gefragt

### HQ-Placement-Validierung (`MapPlacementService`)

| Modus | Innerhalb Bounds | Außerhalb Bounds |
|-------|------------------|-------------------|
| `hq` | Nähe zu Straße prüfen (max 150m) | Immer erlaubt (Streets werden nachgeladen) |
| `spawn` | 200-1500 m Luftlinie zum HQ, dann ein Way des geladenen Netzes höchstens 30 m entfernt ("Too far from streets"), dann eine Route von dort zum HQ ("No route to HQ") | Gleiche Prüfung; ohne geladenen Way in 30 m "Streets not loaded here" |

Beim Platzieren eines Spawns zeigt die Karte zwei Ringe um das HQ (200 m und 1500 m), `SpawnDistanceRings` (`three-engine/renderers/spawn-distance-rings.ts`): auf dem Boden (eine Säulenprobe je Punkt, 96 Punkte je Ring, ohne Tile die Bodenhöhe am HQ), 3 px gestrichelt über einem durchgehenden dunklen Saum von 7 px (`--td-panel-shadow`, 60 %), Line2 mit Pixelbreite, ohne Tiefentest. Die Canvas-Größe dafür setzt Line2 vor jedem Zeichnen neu aus dem Viewport des Renderers (`LineSegments2.onBeforeRender`), ein Resize wirkt also ab dem nächsten Frame. Die Säulenproben (2 × 96 Punkte plus je eine in der Mitte) laufen beim Start der Platzierung am Stück; `__raycastStats()` bucht ihre Strahlen unter `spawnRings`. Innen `--td-warn-orange` (bis dahin "Too close to HQ"), außen das Grün der gültigen Vorschau (ab da "Too far from HQ"), je Ring 48 Striche. Beim Versetzen des HQ gibt es keine Ringe.

Geladen werden alle Ways der Overpass-Abfrage (auch Fuß-, Rad- und Feldwege, Service-Straßen, Treppen) in einem Kasten von ±2000 m um das HQ des Ortswechsels, jeweils ganz, also auch ihre Stücke außerhalb des Kastens. Gezeichnet werden nur die Straßen bis 100 m um die Routen (`STREET_FILTER_RADIUS`), und nur mit dem Layer "Streets". Der Spawn prüft gegen das ganze geladene Netz, wie `findPath()`, das die Route am Fußpunkt des Klicks auf dem nächsten Way-Segment beginnen lässt, innerhalb von 1 m an einem Knoten auf dem Knoten (`SegmentRoutes`, `utils/route-start.ts`). Von dort geht sie über das Ende des Segments weiter, dessen Weg zum HQ weniger kostet. Bis 2026-09-14 begann sie am ersten Knoten des Segments, bis zu eine Segmentlänge vom Klick entfernt. Bis 2026-09-14 lag die Toleranz bei 150 m, mit Fuß- und Servicewegen im Netz: "Too far from streets" ließ sich im Playtest (531) nicht auslösen, und das Portal stand danach mindestens so weit vom Klick entfernt, wie der Klick neben dem Way lag.

Der Kasten folgt dem HQ nur beim Ortswechsel, nicht beim Versetzen in place. Liegt das HQ danach mehr als 500 m von der Mitte des Kastens entfernt, reicht der äußere Ring über den Kasten hinaus; dort kennt das Spiel nur die hinausreichenden Ways.

Ein angenommener Spawn wird immer in place umgesetzt (`MapRelocationService.applySpawnInPlace`), auch außerhalb des Kastens: er liegt auf einem geladenen Way, `findPath()` findet ihn im geladenen Netz. Früher lief ein Spawn außerhalb des Kastens über einen vollen Ortswechsel mit Ladescreen, der die Straßen um dasselbe HQ neu lud und die Drehung mit R verwarf.

### Relevante Konstanten (`map-constants.config.ts`)

```typescript
SPAWN_DISCARD_DISTANCE = 1500     // Max Distanz bevor alter Spawn verworfen wird
MIN_SPAWN_DISTANCE = 500          // Random Spawn: Mindestdistanz zum HQ
MAX_SPAWN_DISTANCE = 1000         // Random Spawn: Maximaldistanz zum HQ
MIN_MANUAL_SPAWN_DISTANCE = 200   // Spawn per Kartenklick: Mindestdistanz zum HQ (MapPlacementService)
MAX_MANUAL_SPAWN_DISTANCE = 1500  // Spawn per Kartenklick: Maximaldistanz; der Dialog prüft 1500 m separat
MAX_HQ_STREET_DISTANCE = 150      // HQ per Kartenklick: max Distanz zur nächsten Straße (nur im geladenen Kasten)
MAX_SPAWN_STREET_DISTANCE = 30    // Spawn per Kartenklick: max Distanz zum nächsten Way des geladenen Netzes
STREET_FILTER_RADIUS = 100        // Radius für Street-Filter um Routen
SPAWN_COLORS = [0xef4444, 0xf97316, 0x00bcd4, 0xff00ff]  // bis zu 4 Spawns
```

### Concurrent Location Changes Guard

`LocationChangeCoordinatorService.applyNewLocation()` bricht ab, solange
`LocationManagementService.isApplyingLocation` `true` ist (gesetzt in STEP 1,
zurückgesetzt in STEP 7 oder im Fehlerfall). `VisualizationFacadeService` unterscheidet
damit das erste Laden vom Ortswechsel. Keine UI-Komponente liest das Flag.

## Zufallsstadt (World Dice)

Der Würfel im Header wählt eine Stadt aus einer **mitgelieferten Liste**
(`public/assets/data/cities.json`), lädt sie einmal je Sitzung und lädt die Seite
mit den neuen Koordinaten neu (ohne `s=`, den Spawn setzt der Randomizer).
Gewürfelt wird nur unter den Städten, die Google mit photorealistischen 3D-Daten
abdeckt (`google3d`, Stand 2026-09-20: 1100 von 4063); ohne Abdeckung wäre der Ort
eine graue Fläche. Trägt eine Liste gar keine Antworten, sind alle Städte im Spiel.

- **Warum eine Liste:** Bis 2026-09-20 fragte der erste Wurf den Wikidata Query
  Service selbst. Gemessen an dem Tag: 13,4 s für eine erfolgreiche Antwort, direkt
  danach zweimal Abbruch nach 60 s. Der Spieler sah nur, wie der Ladeschirm nach dem
  Timeout verschwand. Die Liste ändert sich ein paarmal im Jahr, der Dienst ist also
  keine Laufzeit-Abhängigkeit wert. Die Desktop-App fragt Wikidata damit gar nicht
  mehr an (Host raus aus CSP und User-Agent-Liste).
- **Inhalt:** alle Städte (`Q515` samt Unterklassen) über 100.000 Einwohnern, je
  Stadt `id` (Wikidata-Q-Nummer), `name`, `country`, `countryCode` (ISO 3166-1
  alpha-2), `continent`, `lat`, `lon`, `population`, `area` (km²), `elevation` (m)
  `capital` und `google3d`. Eine Zeile je Stadt, Felder in der Reihenfolge von
  `fields`; `area` und `elevation` sind `null`, wo Wikidata nichts hat, `google3d`
  ist `null`, solange niemand geprüft hat. Nach Einwohnern sortiert. Die Felder
  jenseits von Name, Koordinaten und `google3d` braucht heute niemand; sie liegen
  bereit, falls der Wurf später gefiltert werden soll (Land, Größe, Höhe).
- **3D-Abdeckung:** `tools/google3d` fährt Googles eigene Coverage-Karte mit
  Playwright ab und trägt `google3d` ein (1, 0 oder `null` bei Fehler), ohne
  eigenen Key und ohne Tiles zu laden; Entscheidung ist der Blau-Anteil einer
  Fläche von 320 px um die Bildmitte. Der Lauf ist wiedereintrittsfähig und
  braucht ein sichtbares Browserfenster, headless zeichnet die Abdeckung nicht.
  Einzelheiten in [tools/google3d/README.md](../tools/google3d/README.md).
- **Erzeugen:** `node tools/wikidata/fetch-cities.mjs` (Optionen `--min`, `--out`).
  Vorhandene `google3d`-Antworten übernimmt der Lauf über die Wikidata-Id.
  Zwei Durchgänge, weil eine Abfrage mit allen Feldern in das 60-s-Limit des
  Endpunkts läuft: erst Koordinaten, Einwohner und Land aller Städte, dann Namen und
  Extras in Blöcken über `VALUES`. Mit Wiederholungen und Pausen, weil der Dienst
  Bursts drosselt.
- **Fehlschlag:** Lädt die Liste nicht, steht der Grund als Banner über dem Spiel
  (`WORLD_DICE_FAILED`), der Ladeschirm geht weg. Ein gescheiterter Ladeversuch wird
  nicht gemerkt: der nächste Wurf versucht es neu.

## Bekannte Einschränkungen

### Nominatim-Geocoding Präzision
Nominatim gibt oft Straßen-Koordinaten statt exakte Gebäude-Koordinaten zurück.

**Workaround:** Manuelle Koordinaten-Eingabe nutzen (Dezimal, DMS, oder Google Maps URL einfügen).

### Rate-Limiting
Nominatim hat strikte Rate-Limits. Der GeocodingService verwendet:
- Debouncing (300ms) bei Suchanfragen
- Kein Retry bei HTTP 429
- Cache (Memory + localStorage) nur in `reverseGeocodeWithCache()` (Favoriten-Namen); `setLocation()` fragt `reverseGeocodeDetailed()` ohne Cache

### Umzug im Hintergrund-Tab
Der Fast Path wartet vor dem Umbau zwei Animation-Frames (`RelocationStatusService.painted()`), damit der Hinweis gezeichnet ist. In einem Hintergrund-Tab laufen keine Animation-Frames: Der Umbau beginnt erst, wenn der Tab wieder vorne ist, bis dahin steht der Hinweis.

### Ladeschritte beim ersten Laden
`VisualizationFacadeService` setzt "grid" auf aktuell, während "routes" noch läuft (`EngineInitializationService.setStepCurrent` hält nur einen Schritt aktuell). "routes" fällt dabei kurz auf `pending` zurück; es fehlt nichts, die Liste ordnet sich nur um.
