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

## Reset-Sequenz (KRITISCH)

Bei Location-Wechsel muss diese Reihenfolge eingehalten werden:

```
1. gameState.reset()           ← VOR Koordinatenwechsel!
   - enemyManager.clear()
   - towerManager.clear()
   - projectileManager.clear()
   - effects.clear()

2. clearMapEntities()
   - Spawn-Markers entfernen
   - Route-Lines entfernen
   - Street-Lines entfernen
   - Base-Marker entfernen

3. cachedPaths.clear()

4. engine.setOrigin(lat, lon)  ← VOR baseCoords.set()!

5. baseCoords.set()
   centerCoords.set()

6. loadStreets()
   renderStreets()

7. addBaseMarker()
   addSpawnPoint()

8. gameState.initialize()

9. saveLocationsToStorage()
   flyToCenter()
```

**Warum diese Reihenfolge?**
- `gameState.reset()` entfernt 3D-Objekte aus der Szene
- Wenn Origin sich ändert BEVOR reset(), bleiben alte Objekte an falschen Positionen sichtbar

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
[Location] Input HQ coords: 49.173268, 9.270312 (Hauptstraße 15...)
[Location] baseCoords set to: 49.173268, 9.270312
[addBaseMarker] HQ at geo: 49.173268, 9.270312
[addBaseMarker] HQ at local: (0.0, 30, 0.0)
[OSM] Found 127 street nodes in 500-1000m range
[OSM] Found valid spawn point at 49.17234, 9.26543 (723m from HQ, path has 15 nodes)
[snapSpawnMarker] Snapped spawn-1 to path start: (120.1, -450.2)
```
