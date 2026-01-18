# Bug: 3D-Tiles Loading hängt bei "0 Kacheln geladen"

**Status:** Unter Beobachtung (Fix implementiert, sporadisches Auftreten möglich)

## Problem

Nach Browser-Reload (F5) bleibt der Loading-Screen manchmal bei "Warte auf 3D-Kacheln (0 Kacheln geladen)" stecken. Das Problem tritt sporadisch auf - manchmal funktioniert es, manchmal nicht.

## Symptome

1. Loading-Screen zeigt "Warte auf 3D-Kacheln"
2. Kurz werden 7 Tiles angezeigt, dann Reset auf 0
3. Loading bleibt stecken
4. Console zeigt: `tiles-load-end` Event wird gefeuert, aber `visible=0, total=0, groupChildren=0`

## Root Cause Analyse

### Beobachtungen aus Debug-Logs

```
[TilesEngine] load-tile-set event - tileset root loaded  (20+ mal)
[TilesEngine] tiles-load-end event received, rootLoaded=yes, groupPos=(0, -6365901, 21163)
[TilesEngine] Debounce fired: firstTilesLoaded=false, raycast=null, visible=0, total=0
[TilesEngine] Retry #1: raycast=null, visible=0, total=0, groupChildren=0, sceneMeshes=60, downloading=0, parsing=0
```

**Erkenntnisse:**
- `load-tile-set` Events werden 20+ mal gefeuert → Tilesets werden geladen (Metadaten)
- `rootLoaded=yes` → Root-Tileset existiert
- `groupChildren=0` → ABER keine Meshes in der tilesRenderer.group!
- `downloading=0, parsing=0` → Nichts in den Download/Parse Queues
- `sceneMeshes=60` → Andere Meshes (Tower-Models etc.) sind da

### Vermutete Ursachen

1. **Race-Condition bei Cesium Ion Auth**: `tiles-load-end` feuert bevor Auth abgeschlossen ist
2. **3DTilesRendererJS Bug**: Event wird gefeuert wenn Queues leer sind, aber Tiles noch nicht im Scene-Graph
3. **Plugin-Interaktion**: `UpdateOnChangePlugin`, `UnloadTilesPlugin`, oder `TilesFadePlugin` interferieren

## Lösungsversuche

### 1. Fallback auf visible Meshes (teilweise erfolgreich)

**Idee:** Wenn `raycastTerrainHeight()` null zurückgibt, aber `stats.visible > 0`, trotzdem als geladen markieren.

**Code:** `three-tiles-engine.ts:onTilesLoadEnd()`
```typescript
if (freshOriginHeight !== null || stats.visible > 0) {
  this.firstTilesLoaded = true;
  // ...
}
```

**Ergebnis:** Hilft nicht wenn `visible=0`

### 2. Retry-Mechanismus (implementiert)

**Idee:** Wenn `tiles-load-end` feuert aber keine Tiles, alle 200ms erneut prüfen (max 50 Retries = 10s).

**Code:** `three-tiles-engine.ts:scheduleFirstTilesRetry()`

**Ergebnis:** Hilft nicht wenn Tiles wirklich nie laden

### 3. Plugins deaktivieren (getestet)

**Getestete Plugins:**
- `UpdateOnChangePlugin` - deaktiviert: Problem tritt weiter auf
- `UnloadTilesPlugin` - deaktiviert: Problem tritt weiter auf
- `TilesFadePlugin` - deaktiviert: Problem tritt weiter auf
- Alle drei deaktiviert: Tiles verschwinden nach dem Laden!

**Ergebnis:** Plugins sind NICHT die Ursache, werden für korrektes Rendering benötigt

### 4. Trigger basierend auf load-tile-set Events (zurückgerollt)

**Idee:** Nach 5 `load-tile-set` Events den Retry-Mechanismus starten.

**Code:**
```typescript
this.tilesRenderer.addEventListener('load-tile-set', () => {
  this.tilesetLoadCount++;
  if (!this.firstTilesLoaded && this.tilesetLoadCount >= 5) {
    this.scheduleFirstTilesRetry();
  }
});
```

**Ergebnis:** Loading-Screen schließt zu früh (bei nur 2 Tiles), Terrain lädt dann im Hintergrund weiter → schlechte UX

### 5. Höherer Threshold für visible Tiles (aktuell)

**Idee:** Nicht bei 2 Tiles aufhören, sondern warten auf:
- Raycast-Erfolg (primär) - bedeutet Terrain ist stabil
- ODER 50+ sichtbare Tiles (Fallback)

**Code:**
```typescript
const MIN_VISIBLE_TILES = 50;
if (freshOriginHeight !== null) {
  // Raycast succeeded - terrain is stable
  this.firstTilesLoaded = true;
} else if (stats.visible >= MIN_VISIBLE_TILES) {
  // Enough tiles as fallback
  this.firstTilesLoaded = true;
}
```

**Ergebnis:** Flow ist besser, aber "0 Tiles" Problem bleibt

### 6. Force TilesRenderer Update (aktuell getestet)

**Idee:** Nach Max-Retries ohne Tiles, manuell `tilesRenderer.update()` forcieren.

**Code:**
```typescript
if (stats.visible === 0 && this.cameraNudgeCount < this.MAX_CAMERA_NUDGES) {
  this.camera.updateMatrixWorld(true);
  this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);
  this.tilesRenderer.setCamera(this.camera);
  this.tilesRenderer.update();
  // Reset und nochmal versuchen
}
```

**Ergebnis:** Noch nicht abschließend getestet

## Aktuelle Implementierung

### Relevante Dateien
- `src/app/three-engine/three-tiles-engine.ts`
  - `onTilesLoadEnd()` - Hauptlogik für Tile-Loading Detection
  - `scheduleFirstTilesRetry()` - Retry-Mechanismus
  - `getTileStats()` - Zählt Meshes in tilesRenderer.group

### Debug-Logs (aktiv)
```typescript
console.log(`[TilesEngine] tiles-load-end event received, rootLoaded=..., groupPos=...`);
console.log(`[TilesEngine] Debounce fired: firstTilesLoaded=..., raycast=..., visible=...`);
console.log(`[TilesEngine] Retry #N: cam(...), raycast=..., visible=..., groupMeshes=...`);
```

### Konstanten
```typescript
TILES_LOAD_DEBOUNCE_MS = 500;  // Debounce nach tiles-load-end
FIRST_TILES_RETRY_MS = 200;    // Retry-Intervall
FIRST_TILES_MAX_RETRIES = 50;  // Max 10 Sekunden
MAX_CAMERA_NUDGES = 3;         // Max Force-Update Versuche
MIN_VISIBLE_TILES = 50;        // Fallback wenn Raycast fehlschlägt
```

## Offene Fragen

1. Warum laden die Tile-Geometrien manchmal nicht, obwohl `load-tile-set` Events gefeuert werden?
2. Ist es ein Cesium Ion Auth Timing-Problem?
3. Gibt es ein bekanntes Issue in 3DTilesRendererJS 0.4.19?
4. Hängt es mit dem Browser-Cache zusammen?

## Nächste Schritte

1. Force-Update Ansatz weiter testen
2. Prüfen ob Hard-Reload (Ctrl+Shift+R) das Problem verhindert → Cache-Problem?
3. 3DTilesRendererJS GitHub Issues durchsuchen
4. Eventuell: TilesRenderer komplett neu erstellen wenn keine Tiles nach Timeout

## Finaler Fix (implementiert)

Der Fix besteht aus drei Komponenten:

1. **Retry-Mechanismus** (`scheduleFirstTilesRetry`)
   - Wenn `tiles-load-end` feuert aber keine Tiles → alle 200ms erneut prüfen
   - Max 50 Retries (10 Sekunden)

2. **Strengere Kriterien für "geladen"**
   - Primär: Raycast muss funktionieren (bedeutet Terrain ist stabil)
   - Fallback: 50+ sichtbare Tiles (z.B. wenn Origin über Wasser)

3. **Force-Update bei persistentem 0-Tiles Problem**
   - Nach 50 Retries ohne Tiles → `tilesRenderer.update()` manuell forcieren
   - Max 3 Versuche, dann aufgeben

## Workaround für User

Falls das Problem noch auftritt: Seite nochmal neu laden (F5).

---

## Tiefergehende Analyse (2026-01-18)

### Neues Symptom entdeckt

**Wichtig:** Das Problem ist **standortabhängig** - nicht alle Locations sind betroffen!

**Problematische Location (100% reproduzierbar):**
```
/?l=47.37690,8.54169&s=47.38190,8.54169  (Bahnhofquai, Zürich)
```

**Andere Locations funktionieren problemlos** - sowohl bei URL-Load als auch nach F5.

Das Problem tritt **konsistent** auf bei:
- Direktem URL-Zugriff mit problematischen Location-Parametern
- Browser-Reload (F5) bei problematischen Locations

Das Problem tritt **NICHT** auf bei:
- Wechsel zu einem Favorite im Spiel (funktioniert immer, auch bei problematischen Locations!)
- Danach F5 → Problem tritt wieder auf
- Bestimmte Locations, die generell unproblematisch sind

### Kernunterschied: URL-Load vs. Favorite-Wechsel

**URL-Load (BROKEN):**
```
CONSTRUCTOR: origin=(47.37, 8.54)
initialize() called
tiles-load-end fired, rootLoaded=true, groupChildren=0
debounced check: visible=0, cam=(0,400,-145), tiles=(0,-6366567,21314)
→ tilesGroup ist in ECEF-Koordinaten (Y = -6.3 Millionen = Erdradius!)
→ Kamera sieht die Tiles nicht → visible=0
```

**Favorite-Wechsel (WORKS):**
```
setOrigin(47.37, 8.54) - resetting all flags
tiles-load-end fired
debounced check: visible=144, raycast=455.7, tiles=(0,0,0)
→ tilesGroup ist bei Origin (0,0,0)
→ Tiles sind sichtbar
```

### Root Cause identifiziert

Das **ReorientationPlugin** funktioniert unterschiedlich:

1. **Bei initialer Erstellung (initialize):**
   - Plugin wird mit lat/lon/height und `recenter: true` erstellt
   - ABER: Die tilesGroup bleibt in ECEF-Koordinaten `(0, -6366567, 21314)`
   - `transformLatLonHeightToOrigin()` wird nicht automatisch aufgerufen

2. **Bei Favorite-Wechsel (setOrigin):**
   - `transformLatLonHeightToOrigin()` wird explizit aufgerufen
   - Die tilesGroup wird korrekt auf `(0,0,0)` positioniert
   - Tiles werden geladen und sind sichtbar

### Versuchte Fixes (alle gescheitert)

#### 1. setOrigin() nach initialize() aufrufen
```typescript
await this.engine.initialize();
this.engine.setOrigin(this.baseCoords.lat, this.baseCoords.lon);
```
**Ergebnis:** `transformLatLonHeightToOrigin()` wird aufgerufen, aber tilesGroup bleibt bei ECEF-Position. Die Funktion scheint nur zu funktionieren wenn bereits Tiles geladen sind.

#### 2. setOrigin() nach Render-Loop-Start mit Delay
```typescript
engine.startRenderLoop();
await new Promise(resolve => setTimeout(resolve, 100));
this.engine.setOrigin(...);
```
**Ergebnis:** Gleiches Problem - keine Tiles zum Zeitpunkt des Aufrufs.

#### 3. Manuell Position auf (0,0,0) setzen wenn rootLoaded=true
```typescript
if (rootLoaded && !this.tilesWereLoaded) {
  this.tilesRenderer.group.position.set(0, 0, 0);
  this.tilesRenderer.group.updateMatrixWorld(true);
  this.tilesRenderer.update(); // Force recalculate
}
```
**Ergebnis:** Position wird auf (0,0,0) gesetzt, ABER `tilesChildren` bleibt 0. Die Tiles werden nie zur Gruppe hinzugefügt, obwohl Network-Requests (HAR) zeigen dass `.glb` Dateien geladen werden.

### Offene Hypothesen

1. **Standortabhängigkeit:**
   - Das Problem tritt nur bei bestimmten Koordinaten auf
   - Möglicherweise hängt es mit der Tile-Hierarchie zusammen (welche Root-Tiles geladen werden)
   - Oder mit der ECEF-Position relativ zum Erdmittelpunkt
   - Bahnhofquai Zürich: `47.37690, 8.54169` → ECEF Y ≈ -6.366.567

2. **Frustum-Culling Race Condition:**
   - TilesRenderer berechnet initial welche Tiles im Frustum sind
   - Da tilesGroup bei ECEF ist, sind keine Tiles sichtbar
   - Renderer entscheidet "keine Tiles nötig" und lädt keine Meshes
   - Selbst wenn wir später die Position korrigieren, werden keine Meshes nachgeladen

3. **Plugin-Initialisierungsreihenfolge:**
   - ReorientationPlugin muss möglicherweise NACH dem ersten `tilesRenderer.update()` konfiguriert werden
   - Bei Favorite-Wechsel läuft der Renderer bereits → Plugin-Änderungen greifen

4. **Cesium Ion Session:**
   - Bei Favorite wird dieselbe Session wiederverwendet
   - Bei URL-Load wird neue Session erstellt
   - Möglicherweise unterschiedliches Verhalten bei Session-Initialisierung

### Nächste Schritte

1. **3DTilesRendererJS Issues durchsuchen** nach ähnlichen Problemen mit ReorientationPlugin
2. **Reihenfolge ändern:** TilesRenderer erst nach erstem Frame initialisieren?
3. **Workaround:** Nach URL-Load automatisch `setOrigin()` mit minimal anderem Wert aufrufen um Plugin zu "aktivieren"?
4. **Alternativ:** Engine komplett neu erstellen wenn nach Timeout keine Tiles
