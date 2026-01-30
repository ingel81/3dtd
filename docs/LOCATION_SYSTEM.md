# Location System

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
models/location.types.ts                            - Interfaces (LocationConfig, LocationInfo, etc.)
store/location.store.ts                             - LocationStore (Angular Signals)
services/location-management.service.ts             - Location State & Favorites
services/location-change-coordinator.service.ts     - 7-Step Change Sequence
services/location-facade.service.ts                 - Sub-Facade (Detection, Spawns, Cleanup)
services/url-location.service.ts                    - URL als Source of Truth
services/geocoding.service.ts                       - Nominatim Forward/Reverse Geocoding
services/geolocation.service.ts                     - Browser/IP Geolocation Cascade
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
  readonly currentLocationName = signal<string>('');
  readonly favorites = signal<StoreFavoriteLocation[]>([]);
  readonly favoriteNamesMap = signal<Map<string, string>>(new Map());
  readonly streetCount = signal<number>(0);
  readonly isApplyingLocation = signal<boolean>(false);

  resetAll(): void { /* setzt alle Signals auf Defaults */ }
}
```

## LocationManagementService

Verwaltet den aktuellen Location-State und Favorites. Speichert nur Koordinaten, Namen werden immer ueber `GeocodingService` aufgeloest (mit Cache).

### Signals

```typescript
readonly hq = signal<{ lat: number; lon: number } | null>(null);
readonly spawns = signal<{ lat: number; lon: number }[]>([]);
readonly needsRandomSpawn = signal<boolean>(false);
readonly displayName = signal<string>('Kein Ort');
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
```

### Favorites-System

- Max 10 Favoriten (`MAX_FAVORITES`)
- Gespeichert in `localStorage` unter Key `td_favorites_v2`
- Jeder Favorit hat `id` (crypto.randomUUID), `hq`, `spawns`, `createdAt`
- Namen werden nicht gespeichert, sondern via `GeocodingService.reverseGeocodeWithCache()` aufgeloest

## UrlLocationService

URL ist die Single Source of Truth. Format:

```
?l=49.17327,9.26859&s=49.17555,9.26387;49.18000,9.27000
```

- `l` = HQ (lat,lon) - 5 Dezimalstellen
- `s` = Spawns (Semikolon-getrennt), optional
- Kein `s`-Parameter = Random Spawn wird generiert

```typescript
parseFromUrl(): { hq, spawns } | null   // URL parsen
updateUrl(hq, spawns): void              // URL ohne Reload aktualisieren (replaceState)
getShareUrl(): string                    // Aktuelle URL fuer Sharing
hasLocationParams(): boolean             // Prueft ob l= Parameter vorhanden
```

## GeolocationService

Automatische Standort-Erkennung mit Fallback-Cascade:

```
1. Browser Geolocation API (GPS/WiFi, 15s Timeout fuer Permission-Dialog)
   ↓ (bei Fehler/Ablehnung)
2. ip-api.com (IP-basiert, 5s Timeout, City-Level Genauigkeit)
   ↓ (bei Fehler)
3. null → Location-Dialog wird angezeigt
```

```typescript
async detectLocation(): Promise<GeolocationResult | null>
// GeolocationResult = { lat, lon, source: 'browser' | 'ip' }
```

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
readonly error = signal<string | null>(null);

clearResults(): void
```

### Reverse Geocoding

```typescript
reverseGeocode(lat, lon): Promise<string | null>
// Einfach: gibt displayName zurueck

reverseGeocodeDetailed(lat, lon): Promise<ReverseGeocodeResult | null>
// Vollstaendig: displayName + locationName + address + lat/lon

reverseGeocodeWithCache(lat, lon): Promise<string>
// Mit Memory-Cache + localStorage-Cache (Key: td_geocode_cache_v1)
// Max. 100 Eintraege, 4 Dezimalstellen Praezision (~11m)
// Retry-Logik bei Rate-Limit (HTTP 429)
```

### Helper-Methoden

```typescript
extractLocationName(address: NominatimAddress): string
// Prioritaet: city > town > village > municipality > suburb > city_district > county

formatAddressShort(addr: NominatimAddress): string
// Format: "Strasse 123, Stadt"
```

## Location Detection Flow

Beim App-Start in `LocationFacadeService.initializeLocation()`:

```
1. DevWorld aktiv?
   → Fake-Origin (DEV_WORLD_ORIGIN) setzen, fertig

2. URL-Parameter vorhanden? (UrlLocationService.parseFromUrl())
   → Location aus URL laden, fertig

3. Geolocation-Cascade (GeolocationService.detectLocation())
   → Browser GPS / IP-API probieren
   → Bei Erfolg: Location setzen, fertig

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
  - Height-Updates und Route-Animation stoppen
  - gameState.reset() (Enemies, Towers, Projectiles, Effects)
  - Map-Entities und Pfad-Cache leeren
  - Engine-Origin auf neue Koordinaten setzen
  - LocationManagementService.setLocation() aufrufen
  - URL synchronisieren
  - Initiale Kamera-Framing berechnen und anwenden

STEP 3: Load Streets
  - OSM-Strassendaten laden (2000m Radius)
  - Cache-Check: Wenn gleiche Location (~100m), Cache wiederverwenden
  - Street-Count aktualisieren

  → Tiles-Loading abwarten (mit 15s Timeout-Fallback)

STEP 4: Place HQ Marker
  - MarkerVisualizationService initialisieren
  - PathAndRouteService initialisieren
  - CameraControlService initialisieren
  - RouteAnimationService initialisieren
  - KeyboardPanService initialisieren
  - HQ Base-Marker platzieren

STEP 5: Place Spawn Point
  - Spawn-Punkt mit Marker und Pfad hinzufuegen
  - Spawn-Name aus Input extrahieren (vor erstem Komma)
  - Farbe: SPAWN_COLORS[0]

STEP 6: Calculate Routes
  - A* Pathfinding ausfuehren
  - gameState.initialize() mit Engine, Streets, HQ, Spawns, Pfaden
  - Validierung: Mindestens 1 Route muss existieren
  - GlobalRouteGrid initialisieren
  - TowerPlacement neu initialisieren
  - Street-Network auf Route-Korridor filtern

STEP 7: Finalize
  - Hoehen-Updates durchfuehren (await)
  - Location in Storage speichern
  - isApplyingLocation = false
  - Route-Animation starten
```

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
  │   → Spawns von DevTerrainProvider holen
  │   → Fallback: devWorld.config.spawn Position
  │
  └─ Real World
      → osmService.findRandomStreetPoint(network, hq, 500m, 1000m)
      → URL mit generiertem Spawn synchronisieren

Spawns aus URL/Service vorhanden?
  → Alle Spawns mit Markern und Pfaden hinzufuegen
```

## Location Dialog Component

Angular Material Dialog mit zwei Modi:

### Edit Modes

| Modus | Beschreibung |
|-------|--------------|
| `full` | Neuer HQ + Spawn (Standard) |
| `spawn-only` | Nur Spawn aendern (HQ bleibt) |

### Spawn Modes

| Modus | Beschreibung |
|-------|--------------|
| `random` | Automatisch 500m-1km vom HQ auf Strasse platziert |
| `manual` | Adresse/Koordinaten manuell eingeben |

### Features

- **Autocomplete-Suche** via `AddressAutocompleteComponent` (Nominatim)
- **Manuelle Koordinaten-Eingabe** (ausklappbare Sektion)
  - Unterstuetzte Formate beim Einfuegen:
    - Dezimal: `49.5432, 9.1234`
    - Kardinal: `49.5432°N, 9.1234°E`
    - DMS: `49°32'35.5"N 9°7'24.2"E`
    - Google Maps URL: `@49.5432,9.1234`
- **Distanz-Badge**: Zeigt Entfernung Spawn-HQ an
- **Max-Distanz**: 1.5 km (Spawn wird blockiert wenn weiter)
- **Warnung** bei laufendem Spiel (nur im `full`-Modus)
- **Validation**: Confirm-Button nur aktiv wenn HQ + Spawn gesetzt

### Dialog-Ergebnis

```typescript
{
  hq: LocationInfo,           // { lat, lon, name, displayName, address? }
  spawn: SpawnLocationConfig, // { id, lat, lon, name?, isRandom? }
  confirmed: boolean
}
```

Bei `isRandom: true` wird der Spawn-Punkt vom Coordinator nachtraeglich generiert (Street-Loading + `findRandomStreetPoint()`).

## Bekannte Einschraenkungen

### Nominatim-Geocoding Praezision
Nominatim gibt oft Strassen-Koordinaten statt exakte Gebaeude-Koordinaten zurueck.

**Workaround:** Manuelle Koordinaten-Eingabe nutzen (Dezimal, DMS, oder Google Maps URL einfuegen).

### Rate-Limiting
Nominatim hat strikte Rate-Limits. Der GeocodingService verwendet:
- Debouncing (300ms) bei Suchanfragen
- Exponential Backoff Retry bei HTTP 429
- Cache (Memory + localStorage) fuer Reverse Geocoding
