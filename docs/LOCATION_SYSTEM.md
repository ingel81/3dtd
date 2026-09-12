# Location System

**Stand:** 2026-09-13

Das Location-System ermoeglicht es Spielern, ihren eigenen Spielort zu waehlen. Die URL ist die Single Source of Truth fuer die aktuelle Location.

## Uebersicht

```
URL (?l=...&s=...)                  ← Source of Truth
  ↓
UrlLocationService                  ← Parse/Update URL
  ↓
LocationManagementService           ← State (Signals), Favorites
  ↓
LocationFacadeService               ← Location Detection, Spawn-Logik
  ↓
LocationChangeCoordinatorService    ← 7-Step Location Change Sequence
  ↓
LocationDialogComponent             ← UI fuer Ortswahl
```

## Dateien

```
models/location.types.ts                                    - Interfaces (LocationConfig, LocationInfo, etc.)
store/location.store.ts                                     - LocationStore (Angular Signals)
services/location/location-management.service.ts            - Location State & Favorites
services/location/location-change-coordinator.service.ts    - 7-Step Change Sequence
services/facade/location-facade.service.ts                  - Sub-Facade (Detection, Spawns, Cleanup)
services/location/url-location.service.ts                   - URL als Source of Truth
services/location/geocoding.service.ts                      - Nominatim Forward/Reverse Geocoding
services/location/geolocation.service.ts                    - Browser-Geolocation (kein IP-Lookup)
services/location/osm-street.service.ts                     - Straßen via Overpass, A*, Random-Spawn-Suche
services/location/street-cache.service.ts                   - IndexedDB-Cache für Straßennetze
services/location/world-dice.service.ts                     - Zufällige Stadt via Wikidata
services/world/path-route.service.ts                        - Routen je Spawn (Cache, Routenlinie)
services/world/map-placement.service.ts                     - HQ/Spawn per Klick auf die Karte
components/location-dialog/location-dialog.component.ts  - Dialog UI
components/address-autocomplete.component.ts        - Adress-Autocomplete
```

## Interfaces (`location.types.ts`)

Alle Koordinaten-Typen basieren auf `GeoPosition` (`lat`/`lon`/`height?`) aus `game.types.ts`.

```typescript
// Location mit optionalem Namen
interface LocationConfig extends GeoPosition {
  name?: string;              // Full displayName from OSM
  address?: NominatimAddress; // Strukturierte Adresse
}

// Vollstaendige Location-Info mit Anzeigenamen
interface LocationInfo extends GeoPosition {
  name: string;               // Display name (city/place)
  displayName: string;        // Full Nominatim display name
  address?: NominatimAddress;
}

// Spawn-Punkt Konfiguration
interface SpawnLocationConfig extends GeoPosition {
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

// Zufaelliger Spawn-Kandidat
interface RandomSpawnCandidate extends GeoPosition {
  distance: number;
  streetName?: string;
  nodeId?: number;
}

// Favoriten-Location (nur Koordinaten, Namen via Geocoding Cache)
interface FavoriteLocation {
  id: string;
  hq: GeoPosition;
  spawns: GeoPosition[];
  createdAt: number;
}
```

## LocationStore (`store/location.store.ts`)

Zentrale Angular Signals fuer Location-Daten in der UI:

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

Verwaltet den aktuellen Location-State und Favorites. Speichert nur Koordinaten, Namen werden immer ueber `GeocodingService` aufgeloest (mit Cache).

### Signals

```typescript
readonly hq = signal<{ lat: number; lon: number } | null>(null);
readonly spawns = signal<{ lat: number; lon: number }[]>([]);
readonly needsRandomSpawn = signal<boolean>(false);
readonly displayName = signal<string>(NO_LOCATION_NAME);   // 'No location', auch nach reset()
readonly address = signal<NominatimAddress | null>(null);  // Adresse aus dem Reverse Geocoding
readonly missionInfo = computed<MissionInfo | null>(...);  // Straße, PLZ, Ort, Koordinaten für den Ladescreen
readonly isApplyingLocation = signal(false);
readonly favorites = signal<FavoriteLocation[]>([]);
readonly hasLocation = computed(() => this.hq() !== null);
readonly editableHqLocation = computed(() => { ... });       // { lat, lon, name }
readonly editableSpawnLocations = computed(() => { ... });    // SpawnLocationConfig[]
```

### Methoden

```typescript
// Location setzen und Display-Name via Reverse Geocoding aufloesen
setLocation(hq: { lat: number; lon: number }, spawns: { lat: number; lon: number }[]): void
// Wenn spawns leer → needsRandomSpawn = true (wird spaeter generiert)

// Display-Name abfragen
getLocationDisplayName(): string

// Generierte Spawns setzen (nach Random-Generation)
setGeneratedSpawns(spawns: { lat: number; lon: number }[]): void

// Favorites
saveFavorite(): void          // Aktuelle Location als Favorit speichern (max 10)
deleteFavorite(id: string): void
getFavoriteDisplayName(fav: FavoriteLocation): Promise<string>
loadFavorites(): void         // Aus localStorage laden (Key: td_favorites_v2)

// Zuruecksetzen
reset(): void                 // Alle Signals auf Defaults

// Legacy, No-ops (die URL ist Source of Truth)
initializeEditableLocations(), saveLocationsToStorage(), clearLocationsFromStorage()
```

### Favorites-System

- Max 10 Favoriten (`MAX_FAVORITES`)
- Gespeichert in `localStorage` unter Key `td_favorites_v2`
- Jeder Favorit hat `id` (crypto.randomUUID), `hq`, `spawns`, `createdAt`
- Namen werden nicht gespeichert, sondern via `GeocodingService.reverseGeocodeWithCache()` aufgeloest

### Zuletzt gespielt (Recent)

- `recents` (Signal), gespeichert unter eigenem Key `td_recent_locations_v1`, Logik in `recent-locations.ts`
- Ein `effect()` im Konstruktor schreibt einen Eintrag, sobald HQ, mindestens ein Spawn und ein aufgelöster Name vorliegen. Damit ist jeder Weg abgedeckt (URL, Geolocation, Dialog, Favorit, World Dice, HQ versetzen), ohne jeden einzeln anzufassen
- Max. 8 Einträge, neueste zuerst. HQs näher als 150 m gelten als derselbe Ort: der Eintrag rückt nach oben und übernimmt Spawn und Namen, statt eine zweite Zeile anzulegen
- Der Name wird mitgespeichert (anders als bei Favoriten), die Liste braucht also kein Geocoding
- DevWorld (Fake-Origin 0,0) wird nicht gespeichert; defekte Einträge im Storage werden beim Laden übersprungen

## UrlLocationService

URL ist die Single Source of Truth. Format:

```
?l=49.17327,9.26859&s=49.17555,9.26387;49.18000,9.27000
```

- `l` = HQ (lat,lon) - 5 Dezimalstellen
- `s` = Spawns (Semikolon-getrennt), optional
- Kein `s`-Parameter = Random Spawn wird generiert
- In DevWorld schreibt `LocationFacadeService.syncUrlWithLocation()` nichts in die URL

```typescript
parseFromUrl(): { hq, spawns } | null   // URL parsen
updateUrl(hq, spawns): void              // URL ohne Reload aktualisieren (replaceState)
getShareUrl(): string                    // Aktuelle URL fuer Sharing
hasLocationParams(): boolean             // Prueft ob l= Parameter vorhanden
```

## GeolocationService

Automatische Standort-Erkennung:

```
1. Browser Geolocation API (GPS/WiFi, 15s Timeout fuer Permission-Dialog)
   ↓ (bei Fehler/Ablehnung)
2. null → Location-Dialog wird angezeigt
```

```typescript
async detectLocation(): Promise<GeolocationResult | null>
// GeolocationResult = { lat, lon, source: 'browser' }
```

Dazwischen lag frueher ein IP-Lookup ueber ip-api.com. Der ist raus: der
kostenlose Tarif spricht nur http, auf der ausgelieferten https-Seite blockt
der Browser den Request ohnehin als Mixed Content, und die IP jedes Spielers
ging an einen Dritten fuer eine Schaetzung, die der Dialog mit einem Klick
genauer hinbekommt.

## GeocodingService

Nominatim (OpenStreetMap) API fuer Forward- und Reverse-Geocoding.

### Forward Search (Adresssuche)

```typescript
search(query: string): void
// - Debounced (300ms)
// - Min. 3 Zeichen
// - Max. 8 Ergebnisse
// - AbortController fuer Request-Cancellation

readonly isLoading = signal(false);
readonly results = signal<GeocodingResult[]>([]);
readonly error = signal<string | null>(null);   // 'Address search failed'

clearResults(): void
```

### Reverse Geocoding

```typescript
reverseGeocode(lat, lon): Promise<string | null>
// Einfach: gibt displayName zurueck

reverseGeocodeDetailed(lat, lon): Promise<ReverseGeocodeResult | null>
// Vollstaendig: displayName + locationName + address + lat/lon

reverseGeocodeWithCache(lat, lon): Promise<string>
// Memory-Cache, beim Start aus localStorage geladen (Key: td_geocode_cache_v1)
// Max. 100 Eintraege, 4 Dezimalstellen Praezision (~11m)
// Fallback: "lat, lon" mit 4 Nachkommastellen, wird nicht gecacht
// Kein Retry bei HTTP 429
```

### Helper-Methoden

```typescript
extractLocationName(address: NominatimAddress): string
// Prioritaet: city > town > village > municipality > suburb > city_district > county
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
   → Warten bis User eine Location waehlt
```

Nach Erkennung wird die URL synchronisiert (`syncUrlWithLocation()`).

## LocationChangeCoordinatorService - 7-Step Sequence

Orchestriert den kompletten Ortswechsel. Extrahiert aus der TowerDefenseComponent um God-Object-Komplexitaet zu reduzieren.

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
  - Loading-Steps zuruecksetzen

STEP 2: Reset & Configure Engine
  - Height-Updates, Route-Animation und Intro-Kamerafahrt stoppen
  - gameState.reset() (Enemies, Towers, Projectiles, Effects)
  - Map-Entities und Pfad-Cache leeren
  - Engine-Origin auf neue Koordinaten setzen
  - LocationManagementService.setLocation() aufrufen
  - URL synchronisieren
  - Initiale Kamera-Framing berechnen und anwenden

STEP 3: Load Streets
  - OSM-Strassendaten laden (2000m Radius)
  - Cache-Check: Wenn gleiche Location (~100m), Cache wiederverwenden
  - Sonst OsmStreetService.loadStreets(): erst IndexedDB (StreetCacheService,
    Key v2_<lat>_<lon>_<radius>, max. 5 Orte, LRU), dann Overpass mit drei
    Servern nacheinander (je 15 s Timeout)
  - Street-Count aktualisieren
  - Street-Rendering laeuft progressiv (50 Nodes/Frame, alte Strassen
    bleiben sichtbar bis neue fertig sind — `street-rendering.service.ts`)

  → Tiles-Loading abwarten (mit 15s Timeout-Fallback)

STEP 4: Place HQ Marker
  - MarkerVisualizationService initialisieren
  - PathAndRouteService initialisieren
  - CameraControlService initialisieren
  - RouteAnimationService initialisieren
  - IntroCameraFlightService initialisieren
  - KeyboardPanService initialisieren
  - HQ Base-Marker platzieren

STEP 5: Place Spawn Point
  - Spawn-Punkt mit Marker und Pfad hinzufuegen
    (addSpawnPoint() → PathAndRouteService.showPathFromSpawn(): A* über das
    Straßennetz, die Route landet im Routen-Cache)
  - Spawn-Name aus Input extrahieren (vor erstem Komma)
  - Farbe: SPAWN_COLORS[0]

STEP 6: Calculate Routes
  - gameState.initialize() mit Engine, HQ, Spawns und den gecachten Routen
  - Validierung: Mindestens 1 Route muss existieren
  - GlobalRouteGrid initialisieren (eigener Boot-Step "Generating Route Grid")
  - TowerPlacement neu initialisieren
  - Street-Network auf Route-Korridor filtern (nicht in DevWorld)
  - Höhen liegen in den Zellen des GlobalRouteGrid, jede mit Tiefe und
    geometricError des Tiles, aus dem ihr Sample stammt. Ein Sample aus
    einem strikt schlechteren Tile (geringere Tiefe und größerer
    geometricError) ersetzt ein stabiles nicht (`utils/route-cell-sampler.ts`).

STEP 7: Finalize
  - Höhen-Updates durchführen (await); danach erste Anpassung des
    Korridors an die Tiles, siehe ROUTE_CORRIDOR.md
  - saveLocationsToStorage() (No-op, die URL ist schon aktuell)
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
(`VisualizationFacadeService.holdForIntroFlight()`, Boot-Step "Preparing Intro Flight"):
`IntroCameraFlightService.prepare()` legt die Flugbahn an, `prepareTick()` sampelt die
Route (8 Samples pro Frame). Der Screen schließt, sobald 90 % der Route verlässliche
Höhen haben (`INTRO_GATE_MIN_READY`) oder 8 s nach dem ersten Tile-Load
(`INTRO_GATE_TIMEOUT_MS`, beide in `utils/flight-gate.ts`). Ohne Route oder wenn
`prepare()` scheitert, wartet er nicht.

Ein Ortswechsel wartet darauf nicht, STEP 7 startet die Fahrt direkt. Dann sichert nur die
Fahrt selbst ab: Samples mit mehr als 20 m Tile-Fehler (`maxSampleError`) zählen nicht
als verlässlich, und die Kamera bleibt mindestens 5 m (`hardClearance`) über dem bekannten
Boden.

### Location Flow Methoden

Der Coordinator bietet auch UI-Flow-Methoden:

```typescript
openLocationDialog(): void       // Dialog oeffnen, bei Bestaetigung applyNewLocation()
onShareLocation(): void          // URL in Clipboard kopieren
onWorldDice(): Promise<void>     // Zufaellige Stadt via Wikidata, URL-Reload
onAddFavorite(): void            // Aktuelle Location als Favorit
onSelectFavorite(fav): void      // Favorit laden und anwenden
onDeleteFavorite(id): void       // Favorit loeschen
resolveFavoriteNames(): void     // Display-Namen fuer alle Favoriten aufloesen
```

## LocationFacadeService

Sub-Facade fuer Location-Management. Verbindet Coordinator mit Component-State.

### Verantwortlichkeiten

- **Location Detection**: URL → Geolocation → Dialog Cascade
- **Coordinator-Initialisierung**: Baut `LocationFlowDelegate` fuer den Coordinator
- **Spawn-Management**: `addPredefinedSpawns()`, `addSpawnPoint()`
- **Map Cleanup**: `clearMapEntities()` (Marker, Routes, Streets)
- **DevWorld**: Regeneration, Visual Cleanup

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
  → Alle Spawns mit Markern und Pfaden hinzufuegen
```

## Location Dialog Component

Angular Material Dialog mit zwei Modi:

### Edit Modes

| Modus | Beschreibung |
|-------|--------------|
| `full` | Neuer HQ + Spawn (Standard), Tab "New Location" |
| `spawn-only` | Nur Spawn ändern (HQ bleibt), Tab "Spawn Only"; nur mit bestehender Location, stellt den Spawn-Modus auf `manual` |

### Spawn Modes

| Modus | Beschreibung |
|-------|--------------|
| `random` | Automatisch 500m-1km vom HQ auf Strasse platziert |
| `manual` | Adresse per Autocomplete suchen |

### Features

- **Recent** (nur `full`-Modus): zuletzt gespielte Orte ohne den aktuellen, ein Klick lädt den Ort mit seinem Spawn ohne Bestätigung (Ergebnis wie Confirm, `spawn.id: 'spawn_recent'`)
- **Autocomplete-Suche** via `AddressAutocompleteComponent` (Nominatim)
- **Manuelle Koordinaten-Eingabe** (ausklappbar, nur für das HQ: "Enter coordinates")
  - Unterstuetzte Formate beim Einfuegen:
    - Dezimal: `49.5432, 9.1234`
    - Kardinal: `49.5432°N, 9.1234°E`
    - Kardinal vorangestellt: `N 49.5432, E 9.1234`
    - DMS: `49°32'35.5"N 9°7'24.2"E`
    - Google Maps URL: `@49.5432,9.1234`
- **Distanz-Badge**: Zeigt Entfernung Spawn-HQ an
- **Max-Distanz**: 1,5 km, im Dialog fest als 1500 m geprüft (nicht über `MAX_MANUAL_SPAWN_DISTANCE`); darüber bleibt Confirm gesperrt. Eine Mindestdistanz prüft der Dialog nicht
- **Warnung** bei laufendem Spiel (nur im `full`-Modus)
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

Wenn der Spieler das HQ ueber die Map-Platzierung versetzt, waehlt `LocationFacadeService.applyNewHqPosition()` zwischen zwei Pfaden:

### Fast Path (innerhalb Street-Bounds)

Wenn das neue HQ innerhalb der geladenen Street-Network-Bounds liegt:
- Kein Street-Reload, kein Loading Screen
- Strassennetz wird wiederverwendet
- Alte Spawns werden via `findPath()` revalidiert
- Wenn kein alter Spawn erreichbar ist → Random Spawn generieren

### Slow Path (ausserhalb Street-Bounds)

Wenn das HQ ausserhalb der Bounds platziert wird (z.B. 10km entfernt):
- Volle 7-Step Location Change Pipeline (mit Loading Screen)
- **Spawn-Discard-Logik**: Alter Spawn wird verworfen wenn >1500m vom neuen HQ (`SPAWN_DISCARD_DISTANCE`)
- Bei verworfenen/fehlenden Spawns: Streets werden vorab geladen, Random Spawn generiert (500-1000m)
- Street-Network wird gecached → Coordinator reused es in Step 3 (kein doppeltes Laden)
- Tiles-Wait ist schnell (~500ms) wenn der Spieler bereits dorthin gescrollt hat

### HQ-Placement-Validierung (`MapPlacementService`)

| Modus | Innerhalb Bounds | Ausserhalb Bounds |
|-------|------------------|-------------------|
| `hq` | Naehe zu Strasse pruefen (max 150m) | Immer erlaubt (Streets werden nachgeladen) |
| `spawn` | Straße des geladenen Netzes höchstens 150 m entfernt, 200-1500 m Luftlinie zum HQ | Gleiche Prüfung, scheitert ohne nahe Straße des geladenen Netzes |

Beim Platzieren eines Spawns zeigt die Karte zwei Ringe um das HQ (200 m und 1500 m).

### Relevante Konstanten (`map-constants.config.ts`)

```typescript
SPAWN_DISCARD_DISTANCE = 1500     // Max Distanz bevor alter Spawn verworfen wird
MIN_SPAWN_DISTANCE = 500          // Random Spawn: Mindestdistanz zum HQ
MAX_SPAWN_DISTANCE = 1000         // Random Spawn: Maximaldistanz zum HQ
MIN_MANUAL_SPAWN_DISTANCE = 200   // Spawn per Kartenklick: Mindestdistanz zum HQ (MapPlacementService)
MAX_MANUAL_SPAWN_DISTANCE = 1500  // Spawn per Kartenklick: Maximaldistanz; der Dialog prüft 1500 m separat
MAX_PLACEMENT_STREET_DISTANCE = 150  // Max Distanz zur naechsten Strasse fuer Placement
STREET_FILTER_RADIUS = 100        // Radius fuer Street-Filter um Routen
SPAWN_COLORS = [0xef4444, 0xf97316, 0x00bcd4, 0xff00ff]  // bis zu 4 Spawns
```

### Concurrent Location Changes Guard

`LocationChangeCoordinatorService.applyNewLocation()` bricht ab, solange
`LocationManagementService.isApplyingLocation` `true` ist (gesetzt in STEP 1,
zurückgesetzt in STEP 7 oder im Fehlerfall). `VisualizationFacadeService` unterscheidet
damit das erste Laden vom Ortswechsel. Keine UI-Komponente liest das Flag.

## Bekannte Einschraenkungen

### Nominatim-Geocoding Praezision
Nominatim gibt oft Strassen-Koordinaten statt exakte Gebaeude-Koordinaten zurueck.

**Workaround:** Manuelle Koordinaten-Eingabe nutzen (Dezimal, DMS, oder Google Maps URL einfuegen).

### Rate-Limiting
Nominatim hat strikte Rate-Limits. Der GeocodingService verwendet:
- Debouncing (300ms) bei Suchanfragen
- Kein Retry bei HTTP 429
- Cache (Memory + localStorage) nur in `reverseGeocodeWithCache()` (Favoriten-Namen); `setLocation()` fragt `reverseGeocodeDetailed()` ohne Cache
