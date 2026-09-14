# 3D Model Preview System

**Stand:** 2026-09-14

Das Model Preview System rendert 3D-Vorschauen von Tuermen und Gegnern in der Sidebar.

## Architektur

### Shared Renderer Ansatz
- **Ein WebGL-Kontext** fuer alle Previews (performanter als multiple Kontexte)
- Renderer rendert sequentiell zu verschiedenen Canvas-Elementen
- Jedes Preview hat eigene Scene, Camera und optional AnimationMixer
- **Off-Screen-Render + drawImage**: Renderer rendert in einen einzigen, gemeinsamen
  Off-Screen-Canvas (`128×128` Init-Größe). Der Inhalt wird per
  `ctx.drawImage(renderer.domElement, ...)` in das jeweilige Ziel-Canvas kopiert.

### Renderer Buffer Capacity (kritisch fuer Performance)
- Der Renderer-Drawingbuffer waechst monoton: `setSize(...)` wird nur dann
  aufgerufen, wenn ein Preview groesser ist als alle bisherigen
  (`rendererCapacityCss`). Es wird nie geschrumpft → in einer Session laeuft
  `setSize` insgesamt nur eine Handvoll Mal.
- Pro Preview-Render wird stattdessen `setViewport()` + `setScissor()` auf den
  oberen Bereich des Buffers gesetzt — reine State-Aenderung, keine WebGL-Buffer-
  Realloc.
- **Hintergrund:** Frueher rief der Service pro Frame `setSize()` mit der
  Canvas-Groesse auf. Das reallozierte den WebGL-Drawingbuffer in jedem
  Frame und produzierte bei aktivem Tower-Sidebar-Preview unter Speed
  x2/x4 messbare Frame-Drops (~80% der x4-Cost laut Profile vom 2026-05-07).
  Mit Max-Size + Viewport laeuft x4 jetzt mit ~10% Idle-Reserve (vorher 0%).

### Dateien
- `services/infrastructure/model-preview.service.ts` - Haupt-Service, nicht `providedIn: 'root'`, sondern in den `providers` von `tower-defense.component.ts`
- `components/game-sidebar/wave-panel/wave-panel.component.ts` - Gegner-Previews der laufenden Welle (`mixed-enemy-<index>`)
- `components/game-sidebar/build-panel/build-panel.component.ts` - Tower-Previews der Build-Karten (`tower-preview-<towerId>`), `isHidden`, solange ein Tower gewählt ist
- `components/game-sidebar/game-sidebar.component.ts` - `dispose()` in `ngOnDestroy`; `services/facade/tower-defense-facade.service.ts` ruft es in seinem `dispose()` ebenfalls

## PreviewConfig Optionen

```typescript
interface PreviewConfig {
  modelUrl: string;           // Pfad zum GLB/GLTF
  scale?: number;             // Modell-Skalierung (default: 1)
  rotationSpeed?: number;     // Rotation in rad/s (0 = keine)
  cameraDistance?: number;    // Kamera-Abstand (auto-berechnet wenn nicht gesetzt)
  cameraAngle?: number;       // Kamera-Neigung in rad (default: PI/6 = 30°)
  animationName?: string;     // Name der Animation (z.B. 'Armature|Walk')
  animationTimeScale?: number; // Animations-Geschwindigkeit (default: 1)
  backgroundColor?: number;   // Hex-Farbe oder transparent wenn nicht gesetzt
  lightIntensity?: number;    // Lichtstaerke (default: 1)
  groundModel?: boolean;      // true = Modell steht auf Boden (fuer Charaktere)
  offsetY?: number;           // Vertikaler Offset fuer das Kamera-Target (Bild rauf/runter shiften)
  isHidden?: () => boolean;   // Host meldet verstecktes Canvas: animieren ja, rendern nein
}
```

## Frame-Takt

- Der Animation-Loop laeuft ueber `requestAnimationFrame`, arbeitet aber nur
  mit **30 fps** (`PREVIEW_FPS`), unabhaengig von der Display-Rate. Den Takt
  gibt ein `FramePacer` (`utils/frame-pacer.ts`) vor, derselbe wie beim
  Frame-Cap der Engine.
- Rotation und AnimationMixer rechnen mit der Zeit zwischen den gelaufenen
  Frames, die Drehgeschwindigkeit bleibt also gleich.
- Ein Preview wird nicht gerendert, solange sein Canvas nicht im DOM haengt
  oder `isHidden()` true liefert (z. B. Sidebar-Panel unter `display: none`).
  Rotation und Mixer laufen weiter, damit ein wieder sichtbares Preview den
  Frame zeigt, den es ohnehin gezeigt haette.

## Wichtige technische Details

### Zentrierung
- **groundModel: false** (default): Modell komplett zentriert (gut fuer Gebaeude/Tuerme)
- **groundModel: true**: Modell steht auf y=0, Kamera schaut auf Koerpermitte (gut fuer Charaktere)
- **Box auf dem frischen Klon:** `loadModel()` misst die Box direkt nach
  `SkeletonUtils.clone`, bevor die Welt-Matrizen der Knochen stehen. Steht im
  Modell das SkinnedMesh vor seinen Knochen, misst `Box3.setFromObject` das
  Skinning mit veralteten Matrizen: bei zombie_v2 2 cm statt 1,7 m hoch, die
  Kamera zielt dann auf die Füße. Betroffen sind laut Messung (jsdom, alle
  Gegnertypen, 2026-09-14) zombie_v2, stone-golem, penguin, herbert,
  zombie-soldier, rat, spider, mammoth, bear, dragon, mech und wraith. Elf
  davon haben ein `previewOffsetY` in `enemy-types.config.ts`, eingestellt
  gegen diese Messung (zombie_v2 seit Playtest 515 mit 5 bei Skala 5, im
  Enemy Debugger eingestellt); mech hat keine Vorschau-Werte und läuft mit
  den Vorgaben aus `initEnemyOverrides()` (Offset 0). Die Messung zu
  korrigieren (`model.updateMatrixWorld(true)` vor der Box) verschiebt alle
  zwölf Vorschauen und verlangt, die elf Offsets neu einzustellen.

### Animation & Caching
- **Alle Modelle**: Werden via `AssetManager.loadModel()` gecached und geklont
- **Mit `animationName`**: Werden mit `cloneModel(url, { preserveSkeleton: true })` geklont
  - Grund: `preserveSkeleton` erhält Bone-Referenzen fuer AnimationMixer
- **Ohne `animationName`**: Werden ohne Skeleton-Erhaltung geklont (`preserveSkeleton: false`), kein Mixer
- **FBX-Modelle**: bekommen nach dem Klonen `assetManager.applyFbxMaterials()`
- **Fallback Animation**: Wenn `animationName` nicht gefunden wird, wird automatisch die erste Animation verwendet

### Pivot-Rotation
- Modell wird in THREE.Group (Pivot) gewrapped
- Rotation erfolgt am Pivot, nicht am Modell direkt
- Verhindert, dass das Modell aus dem Bild rotiert

## Canvas-Dimensionen

| Preview Typ | Canvas-Groesse |
|-------------|----------------|
| Enemy Preview | 64×64 pixel (`width`/`height` im Template) |
| Tower Preview | CSS 100 %×80 px; `createTowerPreview()` setzt die Canvas-Auflösung auf CSS-Größe × `devicePixelRatio` |
| Shared Renderer (intern) | startet 128×128, waechst monoton bis zur groessten Preview-Groesse |

## Renderer Settings

```typescript
this.renderer = new THREE.WebGLRenderer({
  canvas,                       // gemeinsamer off-screen Canvas
  alpha: true,                  // Transparenter Hintergrund
  antialias: true,              // Kantenglättung
  preserveDrawingBuffer: true,
});
this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
this.renderer.outputColorSpace = SRGBColorSpace;
```

Pro Preview-Frame:

```typescript
// Buffer nur vergroessern, niemals schrumpfen.
if (neededCss > this.rendererCapacityCss) {
  this.rendererCapacityCss = neededCss;
  this.renderer.setSize(neededCss, neededCss, false);
}
// Viewport/Scissor auf oberen Bereich des Buffers — billig, keine Realloc.
this.renderer.setViewport(0, capCss - heightCss, widthCss, heightCss);
this.renderer.setScissor(0, capCss - heightCss, widthCss, heightCss);
this.renderer.setScissorTest(true);
this.renderer.render(preview.scene, preview.camera);
// Ergebnis aus dem Off-Screen-Canvas in das Ziel-Canvas kopieren.
ctx.drawImage(this.renderer.domElement, 0, 0, w, h, 0, 0, w, h);
```

## Beleuchtungs-Setup

```typescript
// Ambient Light - Grundbeleuchtung
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);

// Directional Light - Hauptlicht (Intensität konfigurierbar)
const directionalLight = new THREE.DirectionalLight(0xffffff, config.lightIntensity ?? 1.0);
directionalLight.position.set(2, 4, 3);

// Rim Light - Kontur-Licht für bessere Definition
const rimLight = new THREE.DirectionalLight(0x88ccff, 0.3);
rimLight.position.set(-2, 1, -2);
```

### Metall ohne Umgebung

Die Vorschau-Szene hat keine Environment-Map. Ein Material mit `metalness` 1
hat in three.js keinen Diffus-Anteil (`diffuseContribution = diffuseColor *
(1.0 - metalnessFactor)` in `lights_physical_fragment`), das AmbientLight
trägt dann nichts bei, es bleiben die Glanzlichter der zwei gerichteten
Lichter: Das Modell wirkt dunkel. Lässt ein GLB `metallicFactor` weg, setzt
GLTFLoader den glTF-Standard 1,0. Im Spiel betrifft das keinen Gegner, der
VAT-Shader nimmt vom Material nur die Basisfarbe.

- `zombie_v2.glb` hatte seit dem Import (2026-05-15) kein `metallicFactor`,
  seit 2026-09-14 steht dort 0 (Playtest 515, "etwas dunkel"). Den
  zombie-v2-Lauf von `tools/blender/optimize_enemy.py` liest und schreibt
  dieselbe Datei; dass ein neuer Lauf die 0 übernimmt, ist nicht mit Blender
  nachgeprüft.
- Ebenfalls ohne `metallicFactor` (Stand 2026-09-14): bear ohne Emissive,
  stone_golem, herbert_optimized und wraith mit einer Emissive-Textur bei
  Faktor 1, die unabhängig vom Licht leuchtet. Nicht geändert.

## Verwendung

### Enemy Preview (animiert)
```typescript
// wave-panel.component.ts; overrides = Enemy-Debugger, sonst Config, sonst Fallback
this.modelPreview.createPreview(`mixed-enemy-${idx}`, canvas, {
  modelUrl: enemyConfig.modelUrl,
  scale: overrides?.previewScale ?? enemyConfig.previewScale ?? enemyConfig.scale * 0.5,
  rotationSpeed: 0.4,
  cameraDistance: overrides?.previewCameraDistance ?? enemyConfig.previewCameraDistance ?? 7,
  cameraAngle: overrides?.previewCameraAngle ?? enemyConfig.previewCameraAngle ?? Math.PI / 12, // 15°
  offsetY: overrides?.previewOffsetY ?? enemyConfig.previewOffsetY ?? 0,
  animationName: enemyConfig.walkAnimation || undefined,
  animationTimeScale: 0.7,
  lightIntensity: 1.3,
  groundModel: true,               // Wichtig fuer Charaktere!
});
```

### Tower Preview (statisch)
```typescript
this.modelPreview.createPreview(`tower-preview-${towerId}`, canvas, {
  modelUrl: towerConfig.modelUrl,
  scale: previewScale,              // Aus TowerDebugService Overrides
  rotationSpeed: 0.4,
  cameraDistance: 20,
  cameraAngle: Math.PI / 5,        // 36° - steilerer Blickwinkel
  lightIntensity: 1.2,
  isHidden: this.isBuildPanelHidden, // true, solange ein Tower gewählt ist
});
```

## Anpassung der Groesse

| Parameter | Effekt |
|-----------|--------|
| `cameraDistance` erhoehen | Modell erscheint kleiner |
| `cameraDistance` verringern | Modell erscheint groesser |
| `scale` erhoehen | Modell wird groesser |
| `cameraAngle` erhoehen | Mehr von oben schauen |

## UI Layout (Tower Cards)

```
+------------------+
| [**]       [50]  |  <- Tier-Marken (top-left), Kosten-Badge (absolute, top-right)
|                  |
|    [3D Model]    |  <- Canvas (100% Breite, 80 px)
| [AA]             |  <- Anti-Air-Badge (bottom-left, nur Tower mit Luftziel)
+------------------+
|   Tower Name     |  <- Name-Leiste (unten)
+------------------+
```

## API Methoden

### createPreview(id, canvas, config)
Erstellt ein neues Preview. Ueberschreibt existierendes Preview mit gleicher ID.

### pausePreview(id)
Pausiert die Animation eines spezifischen Previews.

### resumePreview(id)
Setzt die Animation eines pausierten Previews fort.

### destroyPreview(id)
Entfernt ein spezifisches Preview und gibt Ressourcen frei.

### dispose()
Entfernt alle Previews und gibt alle Ressourcen frei.

## Lifecycle

Jedes Sidebar-Panel meldet seine Previews selbst an und ab.

1. `ngAfterViewInit` des Panels -> erste Previews nach 100ms (WAVE: `initMixedEnemyPreviews()`, BUILD: `initTowerPreviews()`)
2. Das erste `createPreview()` startet Renderer und Animation-Loop (`initialize()`)
3. Bei Canvas-Änderungen (`QueryList.changes`): Re-Initialisierung nach 100ms (WAVE, zerstört vorher die alten Gegner-Previews) bzw. 50ms (BUILD)
4. WAVE: ein `effect` auf die Wellen-Gruppen und die Enemy-Debug-Overrides baut alle Gegner-Previews neu. BUILD: ein `effect` auf die Tower-Debug-Overrides baut das Preview des im Debugger gewählten Towers neu
5. Animation-Loop rendert alle sichtbaren Previews mit 30 fps (siehe Frame-Takt)
6. Abbau eines Panels -> `destroyPreview()` für seine IDs; Abbau der Sidebar -> `modelPreview.dispose()`
