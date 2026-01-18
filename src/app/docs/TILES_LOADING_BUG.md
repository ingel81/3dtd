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
