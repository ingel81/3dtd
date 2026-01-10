# Location System

Das Location-System ermöglicht es Spielern, ihren eigenen Spielort zu wählen.

## Features

### Header Location Button
- Klickbarer Ortsname im Header
- Edit-Icon zeigt Bearbeitbarkeit an
- Öffnet Location-Dialog

### Location Dialog (`location-dialog.component.ts`)
- **Autocomplete-Suche** via Nominatim (OpenStreetMap)
- **Manuelle Koordinaten-Eingabe** (Erweitert-Sektion)
- **Spawn-Punkt Optionen**:
  - Zufällig generieren (500m-1km vom HQ, auf Straße)
  - Manuell festlegen
- **Warnung** bei laufendem Spiel

## Architektur

### Neue Dateien
```
models/location.types.ts          - Interfaces (LocationInfo, SpawnLocationConfig, etc.)
components/location-dialog/       - Dialog Component
components/address-autocomplete.component.ts - Adress-Autocomplete
services/location-management.service.ts      - Location State Management
```

### Erweiterte Services

#### `geocoding.service.ts`
```typescript
extractLocationName(address: NominatimAddress): string
// Extrahiert Stadt/Ort aus Nominatim-Adresse
// Priorität: city > town > village > municipality > suburb > county

reverseGeocodeDetailed(lat, lon): Promise<ReverseGeocodeResult>
// Reverse-Geocoding mit vollständigen Adress-Details
```

#### `osm-street.service.ts`
```typescript
clearCache(centerLat?, centerLon?, radiusMeters?): void
// Löscht Street-Cache (spezifisch oder alle)

findRandomStreetPoint(network, centerLat, centerLon, minDistance, maxDistance): RandomSpawnCandidate | null
// Findet zufälligen Spawn-Punkt auf einer Straße
// - Sammelt Kandidaten im Distanzbereich
// - Prüft Pfad-Validität (A* muss echten Pfad finden)
// - Gibt null zurück wenn kein erreichbarer Punkt gefunden
```

#### `location-management.service.ts`
```typescript
// Signals
editableHqLocation: Signal<LocationConfig | null>
editableSpawnLocations: Signal<SpawnLocationConfig[]>
isApplyingLocation: Signal<boolean>

// Methoden
initializeEditableLocations(): void
// Lädt Locations aus localStorage oder setzt Defaults

getLocationDisplayName(): string
// Extrahiert kurzen Anzeigenamen (z.B. "Hauptstraße 15" statt voller Adresse)

validateCoordinates(lat, lon): boolean
// Prüft ob Koordinaten im gültigen Bereich (-90 bis 90, -180 bis 180)

saveLocationsToStorage(): void
// Speichert aktuelle Locations in localStorage

loadLocationsFromStorage(): { hq, spawns } | null
// Lädt gespeicherte Locations aus localStorage
```

#### `AddressAutocompleteComponent`
Wiederverwendbare Autocomplete-Komponente für Adresssuche.

```typescript
// Features
- Debouncing (300ms) für Nominatim-Anfragen
- Keyboard-Navigation (Tab/Enter zur Auswahl)
- Status-Anzeigen:
  - 'idle': "Adresse eingeben..."
  - 'too-short': "Noch X Zeichen"
  - 'searching': "Suche..."
  - 'results': "X Treffer"
  - 'no-results': "Keine Treffer"
  - 'error': "Fehler bei Suche"
  - 'selected': Zeigt ausgewählte Adresse

// Inputs
placeholder: string
currentValue: { lat, lon, name?, address? } | null

// Outputs
locationSelected: { lat, lon, name, address? }
locationCleared: void
```

### Interfaces (`location.types.ts`)

```typescript
// Basis-Koordinaten
interface LocationCoords {
  lat: number;
  lon: number;
  height?: number;
}

// Location mit optionalem Namen (für editierbare Locations)
interface LocationConfig {
  lat: number;
  lon: number;
  name?: string;           // Full displayName from OSM
  address?: NominatimAddress; // Strukturierte Adresse
}

// Vollständige Location-Info mit Anzeigenamen
interface LocationInfo extends LocationCoords {
  name: string;            // Display name (city/place)
  displayName: string;     // Full Nominatim display name
  address?: NominatimAddress;
}

// Spawn-Punkt Konfiguration
interface SpawnLocationConfig extends LocationCoords {
  id: string;
  name?: string;
  isRandom?: boolean;
}

// Daten für Location-Dialog
interface LocationDialogData {
  currentLocation: LocationInfo | null;
  currentSpawn: SpawnLocationConfig | null;
  isGameInProgress: boolean;
}

// Ergebnis vom Location-Dialog
interface LocationDialogResult {
  hq: LocationInfo;
  spawn: SpawnLocationConfig;
  confirmed: boolean;
}

// Zufälliger Spawn-Kandidat vom Straßennetzwerk
interface RandomSpawnCandidate {
  lat: number;
  lon: number;
  distance: number;
  streetName?: string;
  nodeId?: number;
}
```

## Reset-Sequenz (KRITISCH)

Bei Location-Wechsel muss diese Reihenfolge eingehalten werden:

```
 1. heightUpdate.stopHeightUpdates()    ← Höhen-Updates stoppen
 2. routeAnimation.stopAnimation()      ← Laufende Animationen stoppen
 3. gameState.reset()                   ← VOR Koordinatenwechsel!
    - enemyManager.clear()
    - towerManager.clear()
    - projectileManager.clear()
    - effects.clear()

 4. clearMapEntities()
    - Spawn-Markers entfernen
    - Route-Lines entfernen
    - Street-Lines entfernen
    - Base-Marker entfernen

 5. pathRoute.clearCache()              ← Pfad-Cache leeren

 6. engine.clearDebugHelpers()          ← Debug-Visualisierungen entfernen

 7. engine.setOrigin(lat, lon)          ← VOR baseCoords.set()!

 8. baseCoords.set()
 9. centerCoords.set()

10. loadStreets() (async)               ← Wartet auf Tile-Callback
11. renderStreets()

12. markerViz.initialize()              ← Marker-Visualisierung neu init
13. pathRoute.initialize()              ← Pfad-Service neu init
14. cameraControl.initialize()          ← Kamera-Controller neu init

15. addBaseMarker()
16. addSpawnPoint()

17. gameState.initialize()

18. locationMgmt.saveLocationsToStorage()

19. correctCameraY() + saveInitialCameraPosition()
```

**Warum diese Reihenfolge?**
- `heightUpdate.stopHeightUpdates()` verhindert Race Conditions mit alten Höhendaten
- `routeAnimation.stopAnimation()` stoppt laufende Pfad-Animationen
- `gameState.reset()` entfernt 3D-Objekte aus der Szene
- Wenn Origin sich ändert BEVOR reset(), bleiben alte Objekte an falschen Positionen sichtbar
- `clearDebugHelpers()` entfernt Debug-Visualisierungen der alten Location
- Services müssen nach Origin-Wechsel neu initialisiert werden

## Bugfixes in dieser Implementation

### 1. Pfad über Fluss/Hindernisse
**Problem:** A* gab bei keinem gefundenen Pfad eine direkte Linie `[start, end]` zurück.

**Fix:** `findPath()` gibt jetzt leeres Array `[]` zurück wenn kein Pfad existiert.

```typescript
// osm-street.service.ts - astar()
// VORHER:
return [start, end];  // Direkte Linie!

// NACHHER:
return [];  // Kein Pfad = leeres Array
```

### 2. Spawn-Marker nicht am Pfad-Start
**Problem:** Spawn-Marker wurde an Input-Koordinaten platziert, Pfad startete aber am nächsten Street-Node.

**Fix:** `showPathFromSpawn()` snappt Marker an tatsächlichen Pfad-Start:

```typescript
const pathStart = path[0];
if (pathStart) {
  this.snapSpawnMarkerToPathStart(spawn.id, pathStart.lat, pathStart.lon);
}
```

### 3. Koordinaten-Input Button nicht klickbar
**Problem:** `coordLat`/`coordLon` waren normale Properties, keine Signals. `canApplyCoords()` computed hat sich nicht aktualisiert.

**Fix:** Konvertierung zu Signals mit `(input)` Event-Handlern.

## Bekannte Einschränkungen

### Nominatim-Geocoding Präzision
Nominatim gibt oft Straßen-Koordinaten statt exakte Gebäude-Koordinaten zurück.

**Workaround:** Manuelle Koordinaten-Eingabe nutzen.

**Mögliche Verbesserungen:**
- Photon API (bessere Adress-Präzision)
- Google Geocoding API (kostenpflichtig, sehr präzis)
- `osm_type=node` Parameter für POI-Suche

## Console Logging

Bei Location-Wechsel werden folgende Logs ausgegeben:

```
[LocationMgmt] Initializing editable locations
[LocationMgmt] Loaded from storage: { hq: {...}, spawns: [...] }
[TowerDefense] Applying location change...
[HeightUpdate] Stopped height updates
[RouteAnimation] Animation stopped
[GameState] Reset complete
[Engine] Origin set to: 49.173268, 9.268588
[OSM] Loading streets for 49.173268, 9.268588
[PathRoute] Cache cleared, initialized for new location
[MarkerViz] Initialized
[addBaseMarker] HQ placed at local: (0.0, 30.0, 0.0)
[addSpawnPoint] Spawn placed, finding path...
[LocationMgmt] Locations saved to storage
```
