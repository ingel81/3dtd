# 3D Model Preview System

Das Model Preview System rendert 3D-Vorschauen von Tuermen und Gegnern in der Sidebar.

## Architektur

### Shared Renderer Ansatz
- **Ein WebGL-Kontext** fuer alle Previews (performanter als multiple Kontexte)
- Renderer rendert sequentiell zu verschiedenen Canvas-Elementen
- Jedes Preview hat eigene Scene, Camera und optional AnimationMixer

### Dateien
- `services/model-preview.service.ts` - Haupt-Service
- `tower-defense.component.ts` - Integration (initPreviews, initEnemyPreview, initTowerPreviews)

## PreviewConfig Optionen

```typescript
interface PreviewConfig {
  modelUrl: string;           // Pfad zum GLB/GLTF
  scale?: number;             // Modell-Skalierung (default: 1)
  rotationSpeed?: number;     // Rotation in rad/s (0 = keine)
  cameraDistance?: number;    // Kamera-Abstand (auto-berechnet wenn nicht gesetzt)
  cameraAngle?: number;       // Kamera-Neigung in rad (default: PI/6)
  animationName?: string;     // Name der Animation (z.B. 'Armature|Walk')
  animationTimeScale?: number; // Animations-Geschwindigkeit (default: 1)
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

### Pivot-Rotation
- Modell wird in THREE.Group (Pivot) gewrapped
- Rotation erfolgt am Pivot, nicht am Modell direkt
- Verhindert, dass das Modell aus dem Bild rotiert

## Verwendung

### Tower Preview (statisch)
```typescript
this.modelPreview.createPreview('tower-archer', canvas, {
  modelUrl: '/assets/.../tower_archer.glb',
  scale: 0.4,
  rotationSpeed: 0.4,
  cameraDistance: 20,
  cameraAngle: Math.PI / 6,
});
```

### Enemy Preview (animiert)
```typescript
this.modelPreview.createPreview('enemy-zombie', canvas, {
  modelUrl: '/assets/.../zombie.glb',
  scale: 1.0,
  rotationSpeed: 0.4,
  cameraDistance: 7,
  cameraAngle: Math.PI / 12,
  animationName: 'Armature|Walk',
  animationTimeScale: 0.7,
  groundModel: true,  // Wichtig fuer Charaktere!
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

## Lifecycle

1. `ngAfterViewInit` -> `initPreviews()`
2. `initPreviews()` -> `modelPreview.initialize()` (Renderer erstellen)
3. `initEnemyPreview()` / `initTowerPreviews()` -> Canvas-spezifische Previews
4. Animation-Loop rendert alle Previews kontinuierlich
5. `ngOnDestroy` -> `modelPreview.dispose()` (Cleanup)
