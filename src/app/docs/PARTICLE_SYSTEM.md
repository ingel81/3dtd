# Particle System Dokumentation

## Übersicht

Das Partikelsystem verwendet zwei separate Pools mit unterschiedlichen Blending-Modi:

- **Additive Pool**: Für Feuer, Tracer, Explosionen, Glüheffekte
- **Normal Pool**: Für Rauch, Staub, opake Partikel

## Aktuelle Implementierung (PointsMaterial)

### Was funktioniert ✅

| Feature | Status |
|---------|--------|
| Per-Partikel Farben | ✅ via `vertexColors: true` |
| Per-Partikel Lifetime | ✅ |
| Per-Partikel Velocity | ✅ |
| Additive Blending | ✅ Feuer, Tracer |
| Normal Blending | ✅ Rauch |
| Konfigurierbar via Config | ✅ `TrailParticleConfig` |
| Funktioniert mit 3D Tiles | ✅ |

### Was NICHT funktioniert ❌

| Feature | Status | Grund |
|---------|--------|-------|
| Per-Partikel Größen | ❌ | `PointsMaterial` hat nur eine globale `size` |
| Größen-Fadeout | ❌ | Kein Zugriff auf `size` Attribut |
| Soft Edges | ❌ | Keine Custom Fragment Shader |
| Texturen/Sprites | ❌ | Würde `map` Property brauchen |

## ShaderMaterial Experimente

### Test-Umgebung

Eine isolierte Test-Route existiert unter `/engine-test`:
- Standalone Angular Component
- Nur Three.js, keine 3D Tiles
- **Shader funktionieren hier perfekt!**

### Das Problem

**ShaderMaterial funktioniert NICHT mit Google 3D Tiles:**
- Partikel sind unsichtbar wenn Terrain sichtbar ist
- Partikel werden sichtbar wenn Terrain ausgeblendet wird (T-Taste)
- Das Problem tritt NUR im Zusammenspiel mit 3D Tiles auf

### Getestete Lösungsansätze

| Ansatz | Ergebnis |
|--------|----------|
| `renderOrder = 999` | ❌ Keine Wirkung |
| `depthTest: false` | ⚠️ Funktioniert, aber Partikel immer sichtbar (auch durch Gebäude) |
| `depthWrite: false` | ❌ War bereits gesetzt, keine Wirkung |
| `polygonOffset: true` mit Factor/Units -1 | ❌ Keine Wirkung |

### Shader Code (funktioniert in /engine-test)

```glsl
// Vertex Shader
attribute float size;
varying vec3 vColor;
void main() {
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (300.0 / -mvPosition.z);  // 3000.0 für Game-Scale
  gl_Position = projectionMatrix * mvPosition;
}

// Fragment Shader (Additive)
varying vec3 vColor;
void main() {
  vec2 center = gl_PointCoord - vec2(0.5);
  float dist = length(center);
  if (dist > 0.5) discard;
  float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
  gl_FragColor = vec4(vColor * alpha, alpha);
}
```

### Mögliche Ursachen (ungetestet)

1. **Logarithmic Depth Buffer**: 3D Tiles könnten einen logarithmischen Depth Buffer verwenden für bessere Präzision bei großen Distanzen. Custom Shader müssten das berücksichtigen.

2. **Depth Buffer Precision**: Bei Earth-Scale Koordinaten könnte die Float-Präzision im Shader problematisch sein.

3. **Tile Renderer WebGL State**: Der 3D Tiles Renderer könnte WebGL States setzen die nicht zurückgesetzt werden.

4. **Coordinate System Mismatch**: Die Tiles verwenden ECEF-Koordinaten, unsere Partikel lokale Koordinaten.

### Nächste Schritte (TODO)

1. **Logarithmic Depth Buffer untersuchen**:
   - Prüfen ob `renderer.logarithmicDepthBuffer` aktiviert ist
   - Shader entsprechend anpassen: `gl_FragDepth` manuell berechnen

2. **3D Tiles Renderer analysieren**:
   - WebGL State vor/nach Tile-Rendering loggen
   - Depth Buffer Konfiguration prüfen

3. **Alternative Ansätze**:
   - Separate Render Pass für Partikel
   - Instanced Sprites statt Points
   - Post-Processing Particle Layer

## Konfiguration

### TrailParticleConfig Interface

```typescript
interface TrailParticleConfig {
  enabled: boolean;
  spawnChance: number;      // 0-1, Chance pro Frame
  countPerSpawn: number;    // Partikel pro Spawn

  // Farbe (RGB 0-1)
  colorMin: { r: number; g: number; b: number };
  colorMax: { r: number; g: number; b: number };

  // Größe (wird bei PointsMaterial ignoriert!)
  sizeMin: number;
  sizeMax: number;

  // Lifetime in Sekunden
  lifetimeMin: number;
  lifetimeMax: number;

  // Velocity
  velocityX: { min: number; max: number };
  velocityY: { min: number; max: number };
  velocityZ: { min: number; max: number };

  // Spawn Offset
  spawnOffset: number;

  // Blending Mode: 'additive' (default) oder 'normal'
  blending?: 'additive' | 'normal';
}
```

### Beispiel: Cannon Smoke

```typescript
cannonball: {
  trailParticles: {
    enabled: true,
    spawnChance: 0.3,
    countPerSpawn: 1,
    colorMin: { r: 0.05, g: 0.05, b: 0.05 },  // Near black
    colorMax: { r: 0.2, g: 0.2, b: 0.2 },      // Dark grey
    sizeMin: 0.4,
    sizeMax: 0.8,
    lifetimeMin: 0.3,
    lifetimeMax: 0.7,
    velocityY: { min: 0.5, max: 1.5 },         // Drift upward
    spawnOffset: 0.3,
    blending: 'normal',  // Wichtig für opaken Rauch!
  },
}
```

### Beispiel: Bullet Tracer

```typescript
bullet: {
  trailParticles: {
    enabled: true,
    spawnChance: 0.5,
    countPerSpawn: 1,
    colorMin: { r: 1.0, g: 0.8, b: 0.0 },  // Pure yellow
    colorMax: { r: 1.0, g: 0.9, b: 0.1 },
    sizeMin: 0.3,
    sizeMax: 0.5,
    lifetimeMin: 0.03,
    lifetimeMax: 0.06,  // Very short
    spawnOffset: 0.05,
    // blending: 'additive' (default)
  },
}
```

## Debug Tools

### Keyboard Shortcuts

- **T**: Toggle 3D Tiles Sichtbarkeit (zum Debuggen von Rendering-Problemen)

### Test Route

`/engine-test` - Isolierte Partikel-Testumgebung ohne 3D Tiles

Features:
- Spawn Additive/Normal Partikel
- Toggle zwischen PointsMaterial und ShaderMaterial
- Size Slider
- FPS und Partikel-Count Anzeige

## Dateien

| Datei | Beschreibung |
|-------|--------------|
| `three-effects.renderer.ts` | Haupt-Partikel-Renderer |
| `projectile-types.config.ts` | Trail-Partikel Konfiguration |
| `engine-test.component.ts` | Engine Test Sandbox |
