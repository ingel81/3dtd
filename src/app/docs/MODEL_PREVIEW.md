# 3D Model Preview System

Das Model Preview System rendert 3D-Vorschauen von Tuermen und Gegnern in der Sidebar.

## Architektur

### Shared Renderer Ansatz
- **Ein WebGL-Kontext** fuer alle Previews (performanter als multiple Kontexte)
- Renderer rendert sequentiell zu verschiedenen Canvas-Elementen
- Jedes Preview hat eigene Scene, Camera und optional AnimationMixer

### Dateien
- `services/model-preview.service.ts` - Haupt-Service
- `components/game-sidebar/game-sidebar.component.ts` - Integration (initPreviews, initEnemyPreview, initTowerPreviews)

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
}
```

## Wichtige technische Details

### Zentrierung
- **groundModel: false** (default): Modell komplett zentriert (gut fuer Gebaeude/Tuerme)
- **groundModel: true**: Modell steht auf y=0, Kamera schaut auf Koerpermitte (gut fuer Charaktere)

### Animation & Caching
- **Statische Modelle**: Werden gecached und geklont (performant)
- **Animierte Modelle**: Werden NICHT gecached, sondern frisch geladen
  - Grund: `scene.clone()` bricht Skeleton-Referenzen fuer Animationen
  - AnimationMixer braucht die Original-Scene mit korrekten Bone-Referenzen
- **Fallback Animation**: Wenn `animationName` nicht gefunden wird, wird automatisch die erste Animation verwendet

### Pivot-Rotation
- Modell wird in THREE.Group (Pivot) gewrapped
- Rotation erfolgt am Pivot, nicht am Modell direkt
- Verhindert, dass das Modell aus dem Bild rotiert

## Canvas-Dimensionen

| Preview Typ | Canvas-Groesse |
|-------------|----------------|
| Enemy Preview | 72x72 pixel |
| Tower Preview | 120x70 pixel |
| Shared Renderer (intern) | 128x128 pixel |

## Renderer Settings

```typescript
this.renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,              // Transparenter Hintergrund
  antialias: true,          // Kantenglättung
  preserveDrawingBuffer: true,
});
this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

## Verwendung

### Enemy Preview (animiert)
```typescript
this.modelPreview.createPreview('enemy-preview', canvas, {
  modelUrl: enemyConfig.modelUrl,
  scale: enemyConfig.scale * 0.5,  // Dynamisch aus Enemy-Config
  rotationSpeed: 0.4,
  cameraDistance: 7,
  cameraAngle: Math.PI / 12,       // 15° - flacher Blickwinkel
  animationName: 'Armature|Walk',
  animationTimeScale: 0.7,
  lightIntensity: 1.3,
  groundModel: true,               // Wichtig fuer Charaktere!
});
```

### Tower Preview (statisch)
```typescript
this.modelPreview.createPreview('tower-archer', canvas, {
  modelUrl: '/assets/.../tower_archer.glb',
  scale: towerConfig.scale * 0.4,  // Dynamisch aus Tower-Config
  rotationSpeed: 0.4,
  cameraDistance: 20,
  cameraAngle: Math.PI / 5,        // 36° - steilerer Blickwinkel
  lightIntensity: 1.2,
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
|            [50]  |  <- Kosten-Badge (absolute, top-right)
|                  |
|    [3D Model]    |  <- Canvas (100% Breite)
|                  |
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

1. `ngAfterViewInit` -> `initPreviews()` (nach 100ms Verzoegerung)
2. `initPreviews()` -> `modelPreview.initialize()` (Renderer erstellen)
3. `initEnemyPreview()` / `initTowerPreviews()` -> Canvas-spezifische Previews
4. Bei Canvas-Aenderungen: Re-Initialisierung nach 50ms Verzoegerung
5. Animation-Loop rendert alle Previews kontinuierlich
6. `ngOnDestroy` -> `modelPreview.dispose()` (Cleanup)
