# Instanced Enemy Rendering (VAT System)

**Stand:** 2026-02-13

GPU-instanziertes Enemy-Rendering mit Vertex Animation Textures (VAT). Reduziert Draw Calls von ~2 pro Enemy auf ~1 pro Enemy-Typ.

---

## Uebersicht

Das klassische Rendering erzeugt pro Enemy 2 Draw Calls (Mesh + Health Bar Sprite). Bei 500 Enemies sind das ~1000 Draw Calls. Das instanzierte System reduziert das auf ~14 Draw Calls (1 InstancedMesh pro Enemy-Typ + 1 instanzierte Health Bar fuer alle).

| Komponente | Klassisch | Instanziert |
|-----------|-----------|-------------|
| 500 Enemies | ~1000 Draw Calls | ~14 Draw Calls |
| Mesh-Rendering | 1 Object3D pro Enemy | 1 InstancedMesh pro Typ |
| Health Bars | 1 Sprite pro Enemy | 1 InstancedMesh fuer alle |
| Animation | AnimationMixer pro Enemy | Per-Instance VAT Lookup im Shader |
| Max Enemies | ~500 (praktisch) | 20.000 pro Typ |

---

## Architektur

```
instanced-enemy/
├── instanced-enemy.renderer.ts   # Orchestrator (API-kompatibel mit ThreeEnemyRenderer)
├── enemy-instance.manager.ts     # Per-Typ InstancedMesh Pools + Animation State
├── health-bar-instance.manager.ts # Instanzierte Health Bars (1 Draw Call)
├── vat-baker.ts                  # Skeletal → VAT Baking (animiert + statisch)
└── vat-material.ts               # VAT ShaderMaterial (Vertex + Fragment Shader)
```

### Datenfluss

```
Model laden → VAT baken → InstancedMesh Pool erstellen → Pro Frame: Animation updaten → Shader rendert
```

1. **Preload**: Model wird geladen und VAT gebacken (`bakeVAT` oder `bakeStaticVAT`)
2. **Create**: Enemy wird als Instance-Slot im Pool registriert
3. **Update**: Position/Rotation per `setMatrixAt()`, Animation per `aAnimFrame` Attribut
4. **Render**: Shader liest animierte Position aus VAT DataTexture

---

## VAT Baking (vat-baker.ts)

### Konzept

Skelettanimationen werden in eine DataTexture "gebacken": Fuer jeden Frame wird jede Vertex-Position nach Bone-Transform berechnet und als RGBA-Float in die Textur geschrieben. Der Shader liest zur Laufzeit nur noch die Position aus der Textur - kein Skelett noetig.

### Animierte Modelle (`bakeVAT`)

```
Eingabe: SkinnedMesh + AnimationClips
Ausgabe: DataTexture (width=texWidth, height=totalFrames × rowsPerFrame)
```

**Ablauf:**
1. Groesstes SkinnedMesh im Model finden (nach Vertex-Anzahl)
2. Fuer jeden Clip einen frischen `AnimationMixer` erstellen
3. Pro Frame: `mixer.setTime(t)` → `applyBoneTransform(v, pos)` → in Textur schreiben
4. Positionen von Mesh-Local nach Model-Root-Space transformieren

**Wichtig:** `mixer.setTime(t)` intern resettet auf 0 und addiert t. Daher **frischer Mixer pro Clip**, sonst State-Leaking.

### Statische Modelle (`bakeStaticVAT`)

Fuer Modelle ohne Skelettanimation (z.B. Tank):

1. **Alle** Non-Skinned Meshes im Model sammeln
2. Geometrien mergen (Positionen, Normalen, UVs, Indices)
3. Pro Sub-Mesh: Position/Normal in Root-Space transformieren
4. Per-Vertex Color und Texture-Flag setzen (Multi-Material Support)
5. 1-Frame VAT erstellen

### Texture Tiling

WebGL limitiert Texturgroesse auf `MAX_TEXTURE_SIZE` (typisch 16384). Bei Modellen mit >8192 Vertices werden Vertices auf mehrere Zeilen verteilt:

```
texWidth = min(vertexCount, 8192)
rowsPerFrame = ceil(vertexCount / texWidth)
texHeight = totalFrames × rowsPerFrame
```

**Shader-Lookup (tiled):**
```glsl
float col = mod(aVertexIndex, vatWidth);
float localRow = floor(aVertexIndex / vatWidth);
float globalRow = aAnimFrame * rowsPerFrame + localRow;
vec2 vatUV = vec2(
  (col + 0.5) / vatWidth,
  (globalRow + 0.5) / vatHeight
);
```

Das `+ 0.5` ist Texel-Center-Sampling (NearestFilter).

### Multi-Material Support

Modelle mit mehreren Materialien (z.B. Tank: Turret mit Textur, Ketten ohne) werden ueber Per-Vertex Attribute gehandhabt:

| Attribut | Typ | Beschreibung |
|----------|-----|-------------|
| `aVertexColor` | vec3 | Material-Farbe pro Vertex |
| `aUseMap` | float | 1.0 = Diffuse Texture nutzen, 0.0 = Vertex Color nutzen |

Der Fragment Shader entscheidet pro Fragment:
```glsl
if (vUseMap > 0.5 && hasDiffuse > 0.5) {
  baseColor = texture2D(diffuseMap, vUv).rgb;
} else {
  baseColor = vVertexColor;
}
```

---

## VAT Material (vat-material.ts)

### Uniforms

| Uniform | Typ | Beschreibung |
|---------|-----|-------------|
| `vatTexture` | sampler2D | VAT DataTexture (RGBA32F) |
| `vatWidth` | float | Texturbreite (texWidth) |
| `vatHeight` | float | Texturhoehe (totalFrames × rowsPerFrame) |
| `rowsPerFrame` | float | Zeilen pro Frame (Tiling) |
| `diffuseMap` | sampler2D | Diffuse Texture (optional) |
| `hasDiffuse` | float | 1.0 wenn Texture vorhanden |
| `isUnlit` | float | 1.0 fuer unbeleuchtete Modelle |
| `emissiveIntensity` | float | Additiver Helligkeitsboost (aus EnemyTypeConfig) |
| `emissiveColor` | vec3 | Emissive-Farbe (default weiss) |

### Per-Vertex Attribute

| Attribut | Typ | Quelle |
|----------|-----|--------|
| `aVertexIndex` | float | Vertex-ID fuer VAT Lookup |
| `aVertexColor` | vec3 | Material-Farbe (Fallback) |
| `aUseMap` | float | Texture vs Color Flag |

### Per-Instance Attribute

| Attribut | Typ | Beschreibung |
|----------|-----|-------------|
| `aAnimFrame` | float | Aktueller VAT Frame |
| `aTintColor` | vec3 | Tint-Overlay (Freeze-Effekt) |
| `aOpacity` | float | Transparenz (Death Fade) |

### Beleuchtung

World-Space Lighting mit 4 Lichtquellen:

```
Sun:     (-0.44, 0.89, -0.27), warm, Intensitaet 1.5
Fill:    (0.63, 0.63, 0.38),   neutral, Intensitaet 0.8
Hemi:    Sky/Ground Blend,      kuehl, Intensitaet 0.75
Ambient: neutral,               Intensitaet 0.5
```

**Wichtig:** Normalen werden in World-Space transformiert (`mat3(instanceMatrix) * normal`), NICHT View-Space. Die Lichtrichtungen sind hardcodiert in World-Space.

### LogDepthBuf

Beide Shader (VAT + Health Bar) enthalten die Three.js `logdepthbuf` Chunks fuer korrekte Tiefendarstellung mit 3D Tiles.

---

## Enemy Instance Manager (enemy-instance.manager.ts)

### Pool-Architektur

Pro Enemy-Typ ein `TypePool`:
- 1 `InstancedMesh` (max 20.000 Instances)
- Free-List Pool (O(1) Alloc/Free)
- Per-Instance Attribute Arrays (animFrame, tintColor, opacity)

### Animation State

Pro Enemy-Instance:

```typescript
interface EnemyInstanceState {
  id: string;
  typeId: string;
  index: number;        // Instance-Slot
  config: EnemyTypeConfig; // Typ-Konfiguration
  currentAnim: string;  // Clip-Name
  animTime: number;     // Akkumulierte Zeit
  animSpeed: number;    // Playback Speed
  speedMultiplier: number; // Aus Movement
  isWalking: boolean;
  isDead: boolean;
  frozen: boolean;
}
```

### Frame-Update

`updateAnimations(deltaTime)` wird einmal pro Render-Frame aufgerufen:

1. `animTime += deltaTime × animSpeed × speedMultiplier`
2. Frame berechnen: `localFrame = floor((animTime / totalTime) % 1.0 × frameCount)`
3. Looping fuer Walk/Run, Clamping fuer Death
4. `aAnimFrame` Attribut setzen → Shader liest naechsten Frame

---

## Health Bar Instance Manager (health-bar-instance.manager.ts)

Alle Health Bars in einem einzigen InstancedMesh:

- `PlaneGeometry(1, 1)` mit prozeduralem Shader
- Billboard-Orientierung per Camera Quaternion
- Per-Instance: `aHealth` (0-1), `aBarColor` (RGB), `aIsBoss` (float)
- Farbverlauf: Gruen (>60%) → Gelb (>30%) → Rot (<30%)
- Max 20.000 Health Bars

---

## Instanced Enemy Renderer (instanced-enemy.renderer.ts)

Orchestrator mit Boss-Fallback:

```
Normal Enemy → InstancedMesh (VAT)
Boss Enemy   → Klassischer ThreeEnemyRenderer (Object3D + AnimationMixer)
```

**API-kompatibel** mit ThreeEnemyRenderer: `create()`, `update()`, `remove()`, `startWalkAnimation()`, etc.

### Preloading

```typescript
await renderer.preloadModel('zombie');  // Bake + Pool erstellen
await renderer.preloadAllModels();      // Alle Typen parallel
```

### Fallback-Strategie

1. Boss-Enemy → immer klassisch
2. VAT Bake fehlgeschlagen → klassisch
3. Clone fehlgeschlagen → klassisch

---

## Geloeste Herausforderungen

### 1. Grosse Vertex-Counts (Wallsmasher: 17010, Herbert: 30831)

**Problem:** VAT DataTexture breiter als WebGL MAX_TEXTURE_SIZE (16384).
**Loesung:** Texture Tiling - Vertices werden auf mehrere Zeilen verteilt (MAX_VAT_WIDTH = 8192).

### 2. Multi-Mesh Modelle (Tank: 7 Sub-Meshes)

**Problem:** `bakeStaticVAT` nahm nur das groesste Mesh, Rest fehlte.
**Loesung:** Alle Non-Skinned Meshes mergen mit korrekten Transforms.

### 3. Multi-Material (Tank: Textur + Farb-Meshes)

**Problem:** Eine Diffuse Texture auf alle Vertices angewendet → falsche Farben.
**Loesung:** Per-Vertex `aVertexColor` + `aUseMap` Flag. Meshes mit passender Texture nutzen diese, andere nutzen Material-Farbe.

### 4. Beleuchtung (Tank: komplett schwarz)

**Problem:** Normalen in View-Space transformiert, aber Lichtrichtungen in World-Space.
**Loesung:** `normalMatrix` entfernt, nur `mat3(instanceMatrix) * normal` fuer World-Space Normalen.

### 5. Multi-SkinnedMesh (Spider: 2 SkinnedMeshes)

**Problem:** Erstes SkinnedMesh war nur 340 Vertices (Attachment), nicht der 12833-Vertex Body.
**Loesung:** Groesstes SkinnedMesh nach Vertex-Count waehlen.

---

## Konfiguration

### EnemyTypeConfig Felder (relevant fuer Instancing)

| Feld | Beschreibung |
|------|-------------|
| `hasAnimations` | true → `bakeVAT`, false → `bakeStaticVAT` |
| `walkAnimation` | Clip-Name fuer Walk |
| `runAnimation` | Clip-Name fuer Run |
| `deathAnimation` | Clip-Name fuer Death |
| `idleAnimation` | Clip-Name fuer Idle |
| `animationSpeed` | Playback Speed Multiplier |
| `randomAnimationStart` | Zufaelliger Start-Offset (verhindert Sync) |
| `unlit` | true → kein Lighting (Cartoon-Modelle) |
| `scale` | Model-Skalierung (in Instance Matrix) |
| `headingOffset` | Rotations-Korrektur |
| `bossName` | Wenn gesetzt → klassischer Renderer |

### Limits

| Konstante | Wert | Datei |
|-----------|------|-------|
| `MAX_INSTANCES_PER_TYPE` | 20.000 | enemy-instance.manager.ts |
| `MAX_HEALTH_BARS` | 20.000 | health-bar-instance.manager.ts |
| `MAX_VAT_WIDTH` | 8.192 | vat-baker.ts |

---

## Performance

| Szenario | Draw Calls | JS-Zeit | FPS |
|----------|-----------|---------|-----|
| 500 Enemies (klassisch) | ~1000 | ~1.3ms | ~45 |
| 500 Enemies (instanziert) | ~14 | ~1.3ms | ~60 |
| 5000 Enemies (instanziert) | ~14 | ~9ms | ~67 |
| 20000 Enemies (instanziert) | ~14 | ~35ms | ~28 |

Der JS-Overhead (Animation-Update, Matrix-Setzen) skaliert linear. Der GPU-Overhead bleibt nahezu konstant da die Draw Call Anzahl gleich bleibt.

**Optimierungen (Stand 2026-03-15):** ~37% Reduktion des JS-Overheads pro Enemy durch:
gecachtes `performance.now()`, Single-Pass Status-Effects, gebatchte GPU-Flags,
Integer-Hash Spatial-Grid-Keys, inlined `geoToLocalSimple()` mit gecachtem Cosinus,
eliminiertes `Math.pow`/`Math.sqrt` in Hot-Paths. Details: siehe ARCHITECTURE.md.
