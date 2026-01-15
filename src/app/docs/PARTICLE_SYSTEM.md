# Particle System Dokumentation

## Übersicht

Das Partikelsystem verwendet zwei separate Pools mit unterschiedlichen Blending-Modi:

- **Additive Pool**: Für Feuer, Tracer, Explosionen, Glüheffekte
- **Normal Pool**: Für Rauch, Staub, opake Partikel

## Grundlagen: Was ist ein Partikelsystem?

Ein **Partikelsystem** ist eine Technik, um viele kleine Objekte (Partikel) effizient zu rendern. Statt tausende einzelne 3D-Objekte zu verwalten, werden alle Partikel in einem einzigen Objekt (`THREE.Points`) zusammengefasst.

**Jedes Partikel hat eigene Eigenschaften:**
- Position (x, y, z)
- Geschwindigkeit (velocity)
- Farbe
- Größe
- Lebensdauer

**Die CPU** berechnet jeden Frame die neuen Positionen und schreibt sie in einen Puffer.
**Die GPU** rendert dann alle Punkte auf einmal - extrem schnell.

## PointsMaterial vs ShaderMaterial - Für Laien erklärt

Beide Ansätze rendern das **gleiche Partikelsystem**. Der Unterschied liegt nur darin, **wie** die GPU die Punkte malt.

### Was ist ein Shader überhaupt?

Ein **Shader** ist ein kleines Programm, das auf der **Grafikkarte (GPU)** läuft. Er bestimmt, wie etwas auf dem Bildschirm aussieht.

```
Material = "Wie soll das aussehen?" (Farbe, Transparenz, Glanz...)
Shader   = "Das Programm, das es tatsächlich malt" (läuft auf GPU)
```

**Jedes Material hat intern einen Shader:**
- `PointsMaterial` → Three.js liefert einen fertigen Standard-Shader
- `ShaderMaterial` → Wir schreiben den Shader selbst

**Shader bestehen aus zwei Teilen:**
1. **Vertex Shader**: Berechnet, WO jeder Punkt auf dem Bildschirm erscheint
2. **Fragment Shader**: Berechnet, WELCHE FARBE jeder Pixel hat

```
Vertex Shader:    "Wo sitzt der Punkt?"     → Position auf Bildschirm
Fragment Shader:  "Wie sieht er aus?"       → Farbe, Transparenz, Form
```

**Also ja: Shader sind quasi die "Rezepte", nach denen die GPU Materialien malt.**
Bei PointsMaterial bekommen wir ein Fertigrezept, bei ShaderMaterial kochen wir selbst.

### PointsMaterial (Three.js Standard)

```
CPU berechnet: Position, Farbe, Größe, Lifetime
     ↓
Three.js übersetzt das in GPU-Befehle (automatisch)
     ↓
GPU malt quadratische Punkte
```

**Vorteile:**
- Einfach zu benutzen
- Funktioniert immer (auch mit 3D Tiles)
- Automatische Kompatibilität mit allen Renderer-Features

**Nachteile:**
- **Alle Partikel haben die gleiche Größe** (globale `size` Property)
- Keine weichen Kanten (harte Quadrate)
- Kein individuelles Aussehen pro Partikel

### ShaderMaterial (Custom GPU Code)

```
CPU berechnet: Position, Farbe, Größe, Lifetime
     ↓
EIGENER Shader-Code läuft auf der GPU
     ↓
GPU malt Partikel nach unseren Regeln
```

**Vorteile:**
- **Jedes Partikel kann eigene Größe haben** (Größen-Fadeout möglich!)
- Weiche, runde Kanten (soft edges via `smoothstep`)
- Volle kreative Kontrolle über das Aussehen
- Bessere visuelle Qualität

**Nachteile:**
- Komplexer zu implementieren
- Muss speziellen Code für Features wie Log-Depth-Buffer enthalten

### Visueller Vergleich

```
PointsMaterial:          ShaderMaterial:
┌──┐  ┌──┐  ┌──┐         ●    ◦    ○
│  │  │  │  │  │        groß klein mittel
└──┘  └──┘  └──┘
 alle gleich groß        individuelle Größen
 harte Kanten            weiche Kanten
```

### Warum ShaderMaterial besser ist für Effekte

1. **Rauch expandiert**: Rauchpartikel starten klein und werden größer → nur mit ShaderMaterial
2. **Funken schrumpfen**: Funken starten groß und werden kleiner → nur mit ShaderMaterial
3. **Weiche Wolken**: Runde, weiche Ränder statt pixelige Quadrate → nur mit ShaderMaterial

### Das Log-Depth-Buffer Problem (gelöst)

**Das Problem war:**
- 3D Tiles (Google Maps Terrain) verwenden einen **logarithmischen Tiefenpuffer**
- Das ist nötig für korrekte Darstellung bei riesigen Entfernungen (1m bis 8km)
- Standard ShaderMaterial schreibt **lineare** Tiefenwerte
- → Partikel wurden vom Terrain "verschluckt" (unsichtbar)

**Die Lösung:**
- Spezielle Shader-Chunks von Three.js einbinden: `#include <logdepthbuf_*>`
- Diese berechnen die korrekten logarithmischen Tiefenwerte
- → Partikel werden korrekt vor/hinter Terrain gerendert

## Aktuelle Implementierung (ShaderMaterial mit Log-Depth-Support)

### Was funktioniert ✅

| Feature | Status |
|---------|--------|
| Per-Partikel Farben | ✅ via `vertexColors: true` |
| Per-Partikel Größen | ✅ via `size` Attribut im Shader |
| Größen-Fadeout | ✅ `size * life` im Update |
| Soft Edges | ✅ `smoothstep()` im Fragment Shader |
| Per-Partikel Lifetime | ✅ |
| Per-Partikel Velocity | ✅ |
| Additive Blending | ✅ Feuer, Tracer |
| Normal Blending | ✅ Rauch |
| Konfigurierbar via Config | ✅ `TrailParticleConfig` |
| Funktioniert mit 3D Tiles | ✅ via Log-Depth-Support |
| Korrekte Terrain-Okklusion | ✅ |

### Was NICHT funktioniert ❌

| Feature | Status | Grund |
|---------|--------|-------|
| Texturen/Sprites | ❌ | Würde `map` Property + UV-Koordinaten brauchen |

### Fallback: PointsMaterial

Mit **P-Taste** kann auf PointsMaterial umgeschaltet werden (keine Per-Partikel-Größen, keine Soft Edges).

## Technische Details: Der Log-Depth-Buffer Fix

### Das ursprüngliche Problem (Januar 2026)

**ShaderMaterial funktionierte NICHT mit Google 3D Tiles:**
- Partikel waren unsichtbar wenn Terrain sichtbar war
- Partikel wurden sichtbar wenn Terrain ausgeblendet wurde (T-Taste)
- Das Problem trat NUR im Zusammenspiel mit 3D Tiles auf

### Fehlgeschlagene Lösungsansätze (zur Referenz)

| Ansatz | Ergebnis | Warum es nicht half |
|--------|----------|---------------------|
| `renderOrder = 999` | ❌ | Ändert nur Render-Reihenfolge, nicht Depth |
| `depthTest: false` | ⚠️ | Partikel auch durch Gebäude sichtbar |
| `depthWrite: false` | ❌ | Problem war der Depth-**Test**, nicht -Write |
| `polygonOffset` | ❌ | Wird bei `gl_FragDepth` Override ignoriert |

### Die Lösung: Shader Chunks einfügen

Three.js stellt vier Shader-Chunks bereit, die Log-Depth-Support hinzufügen:

**Korrigierter Vertex Shader:**
```glsl
attribute float size;
varying vec3 vColor;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (3000.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;

  #include <logdepthbuf_vertex>
}
```

**Korrigierter Fragment Shader (Additive):**
```glsl
varying vec3 vColor;

#include <logdepthbuf_pars_fragment>

void main() {
  vec2 center = gl_PointCoord - vec2(0.5);
  float dist = length(center);
  if (dist > 0.5) discard;

  float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
  gl_FragColor = vec4(vColor * alpha, alpha);

  #include <logdepthbuf_fragment>
}
```

#### Was die Shader Chunks machen

| Chunk | Deklariert/Berechnet |
|-------|---------------------|
| `logdepthbuf_pars_vertex` | `varying float vFragDepth, vIsPerspective` |
| `logdepthbuf_vertex` | `vFragDepth = 1.0 + gl_Position.w` |
| `logdepthbuf_pars_fragment` | `uniform float logDepthBufFC` (Scaling-Faktor) |
| `logdepthbuf_fragment` | `gl_FragDepthEXT = log2(vFragDepth) * logDepthBufFC * 0.5` |

**Wichtig:** `#include <common>` muss vor den anderen Chunks stehen, da es die `isPerspectiveMatrix()` Hilfsfunktion definiert.

### Zukünftige Erweiterungsmöglichkeiten

Falls noch mehr Features gewünscht:

1. **Texturen/Sprites**: Würde `sampler2D` Uniform + Texture-Koordinaten erfordern
2. **Rotation**: Mit Instanced Quads statt Points (aber komplexer)
3. **Post-Processing**: Bloom/Glow als Fullscreen-Effekt

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

  // Größe (funktioniert mit ShaderMaterial, bei PointsMaterial ignoriert)
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
- **P**: Toggle zwischen PointsMaterial und ShaderMaterial für Trail-Partikel
  - PointsMaterial: Funktioniert immer, aber keine Per-Partikel-Größen
  - ShaderMaterial: Per-Partikel-Größen und Soft Edges, erfordert Log-Depth-Support

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
