# Instanced Enemy Rendering (VAT System)

**Stand:** 2026-09-13

GPU-instanziertes Enemy-Rendering mit Vertex Animation Textures (VAT). Reduziert Draw Calls von ~2 pro Enemy auf ~1 pro Enemy-Typ.

---

## Uebersicht

Das frühere klassische Rendering (`ThreeEnemyRenderer`, entfernt in 2bbf91f) erzeugte pro Enemy 2 Draw Calls (Mesh + Health Bar Sprite), bei 500 Enemies ~1000. Heute läuft jeder Typ instanziert: ein Draw Call pro Enemy-Typ mit belegten Slots plus zwei für alle Health-Bars (zwei Passes). Leere Pools stehen nicht in der Render-Liste (siehe Slot-Vergabe).

| Komponente | Klassisch | Instanziert |
|-----------|-----------|-------------|
| 500 Enemies | ~1000 Draw Calls | ~14 Draw Calls |
| Mesh-Rendering | 1 Object3D pro Enemy | 1 InstancedMesh pro Typ |
| Health Bars | 1 Sprite pro Enemy | 1 InstancedBufferGeometry für alle (2 Passes) |
| Animation | AnimationMixer pro Enemy | Per-Instance VAT Lookup im Shader |
| Max Enemies | ~500 (praktisch) | 20.000 pro Typ |

---

## Architektur

```
src/app/three-engine/renderers/instanced-enemy/
├── instanced-enemy.renderer.ts   # Orchestrator: Bake, Pools, Health-Bars (`tilesEngine.enemies`)
├── enemy-instance.manager.ts     # Per-Typ InstancedMesh Pools + Animation State
├── health-bar-instance.manager.ts # Instanzierte Health Bars (1 Draw Call, Two-Pass)
├── vat-baker.ts                  # VAT Baking (Skinning, Node-Animation, statisch) + Clip-/Layout-Helfer
└── vat-material.ts               # VAT ShaderMaterial (Vertex + Fragment Shader)
```

### Datenfluss

```
Model laden → VAT baken → InstancedMesh Pool erstellen → Pro Frame: Animation updaten → Shader rendert
```

1. **Preload**: Model wird geladen und VAT gebacken (`bakeVAT`, Fallback `bakeObjectAnimVAT`, ohne Animation `bakeStaticVAT`)
2. **Create**: Enemy wird als Instance-Slot im Pool registriert
3. **Update**: Position/Rotation direkt in den `instanceMatrix`-Buffer (dieselbe Rechnung wie `Matrix4.compose()`), Animation per `aAnimFrame` Attribut
4. **Render**: Shader liest animierte Position aus VAT DataTexture

---

## VAT Baking (vat-baker.ts)

### Konzept

Skelettanimationen werden in eine DataTexture "gebacken": Fuer jeden Frame wird jede Vertex-Position nach Bone-Transform berechnet und als RGBA-Float in die Textur geschrieben. Der Shader liest zur Laufzeit nur noch die Position aus der Textur - kein Skelett noetig.

### Animierte Modelle (`bakeVAT`)

```
Eingabe: Model-Root (Clone mit preserveSkeleton) + AnimationClips + vatClips(config)
Ausgabe: DataTexture (width=texWidth, height=totalFrames × rowsPerFrame)
```

**Ablauf:**
1. Alle SkinnedMeshes im Model sammeln (Body, Haare, Anhänge) und ihre Vertices hintereinander in eine Geometrie legen
2. Fuer jeden Clip einen frischen `AnimationMixer` erstellen
3. Pro Frame: `mixer.setTime(t)` → für jedes SkinnedMesh `applyBoneTransform(v, pos)` → in Textur schreiben
4. Positionen von Mesh-Local nach Model-Root-Space transformieren

Ohne SkinnedMesh oder ohne passenden Clip liefert `bakeVAT` `null`.

**Wichtig:** `mixer.setTime(t)` intern resettet auf 0 und addiert t. Daher **frischer Mixer pro Clip**, sonst State-Leaking.

### Node-Animation (`bakeObjectAnimVAT`)

Für Modelle, deren Clips starre Mesh-Teile per Node-Transform bewegen, statt Vertices über
Skin-Gewichte zu verformen (Mech, Hornet, Skeleton). `InstancedEnemyRenderer` ruft es auf,
wenn `bakeVAT` `null` liefert.

1. Alle Non-Skinned Meshes sammeln und in eine Geometrie legen
2. Pro Frame: `mixer.setTime(t)` und `updateMatrixWorld()`, dann für jedes Mesh `meshToRoot`
   aus seiner aktuellen `matrixWorld` neu rechnen und seine Vertices damit transformieren
3. Die Pool-Geometrie ist die Ruhepose; Clip-Auswahl, Frame-Zahl und Layout wie bei `bakeVAT`

### Nur sichtbare Frames

`vatClips(config)` legt fest, welche Clips wie weit gebacken werden:

- Walk und Run loopen und kommen ganz in die VAT.
- Todes-Clips laufen mit `animationSpeed`, bis `EnemyManager` den Gegner nach
  `TIMING.deathAnimationDuration` entfernt. Gebacken wird nur diese Clip-Zeit
  (`vatDeathSeconds`), bis einschließlich des Frames `floor(t × fps)`, der beim Entfernen zu
  sehen ist (`vatFrameCount`). Kürzere Todes-Clips kommen ganz in die VAT.
- Idle wird nicht gebacken, kein Spielzustand zeigt es.
- Clips, die das Modell nicht enthält, fallen weg.

`vatClips()`, `vatFrameCount()` und `vatLayout()` sind exportiert. Das Model-Budget-Tool
(`tools/model-budget/generate.spec.ts`, `npm run model-budget`) rechnet mit denselben
Funktionen die VAT-Größen für [ENEMY_MODEL_BUDGET.md](ENEMY_MODEL_BUDGET.md).

Ein toter Gegner hält den letzten gebackenen Frame (Clamp in `updateAnimations`), er springt
nicht auf Frame 0 zurück. Die Position ändert sich nach dem Tod nicht mehr, es gibt kein
Ausblenden und kein Einsinken.

### Statische Modelle (`bakeStaticVAT`)

Für Modelle ohne Animation (`hasAnimations: false` oder keine Clips im Model, z.B. Tank):

1. **Alle** Non-Skinned Meshes im Model sammeln
2. Geometrien mergen (Positionen, Normalen, UVs, Indices)
3. Pro Sub-Mesh: Position/Normal in Root-Space transformieren
4. Per-Vertex Color und Texture-Flag setzen (Multi-Material Support)
5. 1-Frame VAT erstellen

### Texture Tiling

WebGL limitiert Texturgroesse auf `MAX_TEXTURE_SIZE` (typisch 16384). Bei Modellen mit >8192 Vertices werden Vertices auf mehrere Zeilen verteilt (`vatLayout()`):

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

### Texelformat (RGBA16F oder RGBA32F)

`vatEncoding()` wählt das Format pro Gegnertyp aus den gebackenen Positionen:

- Gespeichert wird relativ zur Mitte der Bounding-Box über alle Frames, geteilt durch die
  halbe Ausdehnung je Achse. Jeder Wert liegt damit in [-1, 1], und Half-Float
  (`toHalfFloatRounded`, rundet zum nächsten Wert) weicht höchstens um 2^-12 der halben
  Ausdehnung ab. Wie weit das Modell von seinem eigenen Ursprung entfernt liegt, spielt keine
  Rolle mehr.
- Bleibt dieser Fehler mal `EnemyTypeConfig.scale` bei höchstens `VAT_HALF_FLOAT_MAX_ERROR`
  (2 mm), ist die VAT RGBA16F (`HalfFloatType`, 8 Byte pro Texel), sonst RGBA32F
  (16 Byte) mit den Positionen, wie sie sind.
- Die 2 mm: Die Kamera bleibt mindestens 5 m vom Orbit-Ziel (`CameraRig`, 60° vertikales
  FOV). Ein Pixel deckt dort 5,3 mm bei 1080 und 4,0 mm bei 1440 Bildzeilen ab.
- Der Shader dekodiert mit `vatPos.xyz * vatExtent + vatOrigin`. Für RGBA32F sind Extent 1
  und Origin 0, die Positionen bleiben bitgleich.
- Welcher Typ welches Format bekommt, zeigt [ENEMY_MODEL_BUDGET.md](ENEMY_MODEL_BUDGET.md)
  (Spalten „Format“ und „Half-Fehler mm“). Der Generator backt dafür jedes Modell mit den
  Loadern des Spiels.

### Multi-Material Support

Modelle mit mehreren Materialien (z.B. Tank: Turret mit Textur, Ketten ohne) werden ueber Per-Vertex Attribute gehandhabt:

| Attribut | Typ | Beschreibung |
|----------|-----|-------------|
| `aVertexColor` | vec3 | Material-Farbe pro Vertex |
| `aVertexAlpha` | float | Material-Opazität pro Vertex (bei eigener Textur × Textur-Alpha) |
| `aUseMap` | float | 1.0 = Diffuse Texture nutzen, 0.0 = Vertex Color nutzen |

Die Diffuse Texture des Pools ist die des Meshes mit den meisten Vertices. Meshes mit
derselben Textur (auch derselben glTF-Bildquelle) setzen `aUseMap = 1`. Meshes mit einer
eigenen, anderen Textur werden beim Bake auf der CPU abgetastet: Farbe und Alpha am UV des
Vertex landen in `aVertexColor`/`aVertexAlpha`.

Der Fragment Shader entscheidet pro Fragment:
```glsl
if (vUseMap > 0.5 && hasDiffuse > 0.5) {
  vec4 texSample = texture2D(diffuseMap, vUv);
  baseColor = texSample.rgb;
  baseAlpha = texSample.a;
} else {
  baseColor = vVertexColor;
  baseAlpha = vVertexAlpha;
}
```

---

## VAT Material (vat-material.ts)

### Uniforms

| Uniform | Typ | Beschreibung |
|---------|-----|-------------|
| `vatTexture` | sampler2D | VAT DataTexture (RGBA16F oder RGBA32F) |
| `vatWidth` | float | Texturbreite (texWidth) |
| `vatHeight` | float | Texturhoehe (totalFrames × rowsPerFrame) |
| `rowsPerFrame` | float | Zeilen pro Frame (Tiling) |
| `vatOrigin` | vec3 | Mitte der Bounding-Box (RGBA16F), sonst 0 |
| `vatExtent` | vec3 | Halbe Ausdehnung der Bounding-Box (RGBA16F), sonst 1 |
| `diffuseMap` | sampler2D | Diffuse Texture (optional) |
| `hasDiffuse` | float | 1.0 wenn Texture vorhanden |
| `isUnlit` | float | 1.0 fuer unbeleuchtete Modelle |
| `emissiveIntensity` | float | Additiver Helligkeitsboost (aus EnemyTypeConfig) |
| `emissiveColor` | vec3 | Emissive-Farbe (default weiss) |
| `colorMultiplier` | float | Helligkeitsfaktor vor dem Emissive (aus EnemyTypeConfig, default 1.0) |
| `alphaCutoff` | float | Alpha-Grenze im Modus Maske (siehe Alpha) |

### Per-Vertex Attribute

| Attribut | Typ | Quelle |
|----------|-----|--------|
| `aVertexIndex` | float | Vertex-ID fuer VAT Lookup |
| `aVertexColor` | vec3 | Material-Farbe (Fallback) |
| `aVertexAlpha` | float | Alpha zur Vertex-Farbe |
| `aUseMap` | float | Texture vs Color Flag |

### Per-Instance Attribute

| Attribut | Typ | Beschreibung |
|----------|-----|-------------|
| `aAnimFrame` | float | Aktueller VAT Frame |
| `aTintColor` | vec3 | Tint-Overlay, 50 % gemischt (0,0,0 = keiner) |

Tint-Priorität (`applyTint()`): Hit-Flash vor Freeze vor Burn vor Poison. Den Freeze-Tint
schaltet die VFX-Einstellung `freezeTint` ab (`setFreezeTintEnabled()`).

### Alpha

`vatAlpha()` bestimmt pro Typ aus den Materialien der gebackenen Meshes, wie der Shader Alpha
behandelt, so wie three.js die Materialien zeichnen würde:

| Modus | Wann | Material |
|---|---|---|
| opak | kein Material braucht Alpha | `transparent: false`, Alpha wird ignoriert |
| Maske | ein Material hat `alphaTest` (glTF MASK) | `transparent: false`, `discard` unter `alphaCutoff` |
| Blending | ein transparentes Material (glTF BLEND) mit Opacity unter 1 oder durchscheinenden Texeln | `transparent: true`, `discard` unter 0,05 |

- Ein transparentes Material ohne Alpha unter 1 (Opacity 1, kein durchscheinender Texel in
  der Map, per Canvas gelesen) zählt als opak. Lässt sich die Map nicht lesen, bleibt es beim
  Blending.
- Ein Pool hat ein Material: Blendet ein Mesh, blendet der ganze Typ.
- Stand 2026-09-13: Bear (Alpha in der Textur), Ghost und Hornet (Opacity unter 1, beim
  Hornet die Flügel) blenden, Dragon ist Maske (Cutoff 0,5), die übrigen 15 Typen sind opak.
- Eine Opazität pro Instanz gibt es nicht, Gegner werden beim Tod nicht ausgeblendet.

### Beleuchtung

World-Space Lighting mit 4 Lichtquellen:

```
Sun:     (-0.44, 0.89, -0.27), warm, Intensitaet 1.5
Fill:    (0.63, 0.63, 0.38),   neutral, Intensitaet 0.8
Hemi:    Sky/Ground Blend,      kuehl, Intensitaet 0.75
Ambient: neutral,               Intensitaet 0.5
```

**Wichtig:** Normalen werden in World-Space transformiert (`mat3(instanceMatrix) * normal`), NICHT View-Space. Die Lichtrichtungen sind hardcodiert in World-Space.

Danach rechnet der Fragment-Shader `colorMultiplier`, das additive Emissive, den Tint und ein
ACES-Filmic-Tonemapping ein. Lichter der Szene wirken nicht auf die Gegner.

### LogDepthBuf

Beide Shader (VAT + Health Bar) enthalten die Three.js `logdepthbuf` Chunks fuer korrekte Tiefendarstellung mit 3D Tiles.

---

## Enemy Instance Manager (enemy-instance.manager.ts)

### Pool-Architektur

Pro Enemy-Typ ein `TypePool`:
- 1 `InstancedMesh` (max 20.000 Instances)
- Slot-Vergabe über `InstanceSlotAllocator` (siehe unten)
- Per-Instance Attribute Arrays (animFrame, tintColor)
- Ein `DrawGate`, das das Mesh bei leerem Pool aus der Render-Liste nimmt

### Slot-Vergabe und Uploads

Enemy-Pools, Health-Bars, die Projektil-Pools (`three-projectile.renderer.ts`), die
Decal-Pools (`decal-instance.manager.ts`) und die Lightning-Bolts
(`lightning-bolt.renderer.ts`) vergeben ihre Slots über
`renderers/instance-slot-allocator.ts`:

- Freie Slots kommen auf eine Free-List und werden vor dem Wachsen wieder vergeben.
- `activeCount` ist der höchste belegte Slot + 1. Er ist Draw-Count (`mesh.count`
  bzw. `geometry.instanceCount`) und Länge der Frame-Uploads.
- Wird der oberste Slot frei, fällt `activeCount` über alle freien Slots darunter
  zurück. Nach einer Peak-Wave zeichnet und lädt der Pool also nicht mehr die
  Peak-Größe hoch.
- Abgeschnittene Slots bleiben auf der Free-List und werden beim nächsten
  `alloc()` verworfen. Der Pool wächst erst wieder, wenn die Liste leer ist, ein
  Eintrag unter `activeCount` ist also immer frei.
- Ist der Pool voll, gibt es keinen Slot (`addEnemy` → `null`, Health-Bar → `-1`,
  Projektil wird nicht gezeichnet) statt über den Buffer hinaus zu schreiben.
- Ein leerer Pool (`activeCount` 0) ist unsichtbar und steht nicht in der
  Render-Liste (`renderers/draw-gate.ts`, R6). Das Gate schaltet nur beim Wechsel
  zwischen leer und nicht leer. Die Schalter "Gegner ausblenden" und "Health-Bars"
  laufen über `DrawGate.setShown()`, nicht über `mesh.visible`. Weil ein
  unsichtbarer Pool seine Buffer und die VAT-Textur erst beim ersten Zeichnen
  hochlädt, zeichnet der Lade-Warm-up (`three-engine/scene-warmup.ts`) alle
  leeren Pools einmal. Davor kompiliert er per `renderer.compileAsync()` die
  Shader aller Materialien der Szene, versteckte Pools eingeschlossen, damit die
  erste Welle keine Programme mehr baut.

Frame-Flushes laden `(0, activeCount × n)` hoch (`clearUpdateRanges()` +
`addUpdateRange()`), nie den vollen MAX-Buffer. Bei `activeCount = 0` wird keine
Range gesetzt: `bufferSubData` liest Länge 0 als "bis zum Ende", `(0, 0)` wäre ein
Voll-Upload.

three leert die `updateRanges` eines Attributs nur beim Upload. Im Headless-Training
wird nichts gerendert, während Gegner und Projektile kommen und gehen, also darf
kein Einzelpfad unbegrenzt Ranges anhängen:

- Attribute mit Frame-Flush setzen auf den Einzelpfaden nur ein Dirty-Flag: Enemy
  `instanceMatrix` (auch beim Entfernen), `aAnimFrame`, `aTintColor`, Health-Bar
  `aCenter`/`aHealth`, Projektil-Matrizen (`ThreeProjectileRenderer.commitToGPU()`
  flusht einmal pro Frame), Lightning-Bolt-Instanzdaten (`aStart`/`aEnd`/`aTiming`/
  `aShape` in einem Interleaved-Buffer, Flush am Ende von
  `LightningBoltRenderer.update()`, nur in Frames mit Spawns).
- Attribute ohne Frame-Flush (Health-Bar `aSize`, `aBarColor`, `aIsBoss`) laufen über
  `InstanceSlotAllocator.uploadSlot()`: eine Range pro Slot, ab 64 wartenden Ranges
  zusammengefasst zu einer über die gezeichneten Slots.

### Animation State

Pro Enemy-Instance:

```typescript
interface EnemyInstanceState {
  id: string;
  typeId: string;
  index: number;           // Instance-Slot
  config: EnemyTypeConfig; // Typ-Konfiguration
  pool: TypePool;          // Pool des Slots, spart den typeId-Lookup pro Frame
  currentAnim: string;     // Clip-Name
  animTime: number;        // Akkumulierte Zeit (s)
  animSpeed: number;       // animationSpeed bzw. Debug-Override
  speedMultiplier: number; // aktuelle Geschwindigkeit / Basisgeschwindigkeit
  isWalking: boolean;
  isDead: boolean;
  frozen: boolean;
  poisoned: boolean;
  burning: boolean;
  hitFlashEnd: number;     // performance.now() am Ende des Hit-Flash, 0 = keiner
  lastFrame: number;       // zuletzt geschriebener VAT-Frame
  released: boolean;       // Slot freigegeben, der State wird nicht wiederverwendet
  healthBarIndex: number;  // Health-Bar-Slot, -1 = keiner
  // dazu gecachte Heading-Quaternion und Debug-Overrides (debugScale, ...)
}
```

### Frame-Update

`updateAnimations(deltaTime)` wird einmal pro Render-Frame aufgerufen:

1. `animTime += deltaTime × animSpeed × speedMultiplier` (tote Gegner ohne `speedMultiplier`)
2. Frame berechnen: `localFrame = floor((animTime / totalTime) % 1.0 × frameCount)`
3. Looping fuer Walk/Run, Clamping fuer Death (hält den letzten gebackenen Frame)
4. `aAnimFrame` nur schreiben, wenn sich der globale Frame geändert hat (`lastFrame`), sonst entfällt der Upload

`speedMultiplier` setzt `updateEnemyState()`: aktuelle Geschwindigkeit geteilt durch
`baseSpeed`, beim Run-Clip durch `baseSpeed × runSpeedMultiplier`.

`InstancedEnemyRenderer.updateAnimations(deltaTime, camera)` ruft danach
`flushDirtyFlags()` und `updateBillboard()`. Der Debug-Schalter "Animationen aus"
hält nur die VAT-Frames an, die Flushes laufen weiter, sonst frieren Gegner und
Health-Bars auf dem Bildschirm ein. Nur bei ausgeblendeten Gegnern entfällt der
ganze Schritt. Hit-Flash-Tints (Lightning) laufen über `expireHitFlashes()` vor
dem Schalter ab; die Methode geht nur die gerade blitzenden Instanzen durch.

---

## Health Bar Instance Manager (health-bar-instance.manager.ts)

Alle Health Bars auf einer gemeinsamen `InstancedBufferGeometry`, gezeichnet von
zwei `Mesh`-Passes:

- Einheits-Quad aus `PlaneGeometry(1, 1)` mit prozeduralem Shader
- Billboard im Vertex-Shader über die Uniforms `uCameraRight`/`uCameraUp`
- Per-Instance: `aCenter` (Weltposition), `aSize` (0 = versteckt), `aHealth` (0-1),
  `aBarColor` (RGB), `aIsBoss` (float)
- `geometry.instanceCount` ist der Draw-Count beider Passes
- Kein `InstancedMesh`: der Shader liest `instanceMatrix` nicht, ein
  `InstancedMesh` legt es trotzdem an und lädt es hoch (2 × 20.000 × 16 Floats =
  2,56 MB). `frustumCulled` bleibt aus, die Bounding-Sphere der Geometrie ist nur
  das Quad am Ursprung.
- Farbverlauf: Grün (>60%) → Gelb (>30%) → Rot, außer `aBarColor` ist gesetzt (`healthBarColor` des Typs)
- Max 20.000 Health Bars
- **Two-Pass Rendering**: Pass 1 (`renderOrder` 999) zeichnet alle Bars mit
  Tiefen-Test, Geometrie verdeckt sie. Pass 2 (`renderOrder` 1000) zeichnet ohne
  Tiefen-Test nur beschädigte Bars (`aHealth` < 0.999), die sind also auch hinter
  Verdeckungen zu sehen. Keiner der Passes schreibt Tiefe.

---

## Instanced Enemy Renderer (instanced-enemy.renderer.ts)

Orchestrator über `EnemyInstanceManager` und `HealthBarInstanceManager`. Alle Typen laufen
instanziert, Bosse eingeschlossen; einen klassischen Renderer gibt es nicht mehr.

API: `create()`, `resolveSlot()` + `updateSlot()` (Push pro Render-Frame aus
`EnemyManager.presentFrame()`), `remove()`, `startWalkAnimation()`, `startRunAnimation()`,
`playDeathAnimation()`, `updateAnimations()`, Status-Visuals (`setFreezeVisual()`,
`setPoisonVisual()`, `setBurnVisual()`, `triggerHitFlash()`) und `applyDebugOverrides()`.

### Preloading

```typescript
await renderer.preloadModel('zombie');  // Bake + Pool erstellen
await renderer.preloadAllModels();      // Alle Typen parallel
```

### Bake-Auswahl und Fehlerfälle

1. `hasAnimations` und Clips im Model → `bakeVAT`, bei `null` → `bakeObjectAnimVAT`
2. sonst → `bakeStaticVAT`
3. Clone oder Bake fehlgeschlagen → `console.error` ("... enemy type will not render"), kein
   Pool; `create()` liefert `null`, Gegner dieses Typs sind unsichtbar

Nach dem Bake überschreibt `config.unlit` den erkannten `isUnlit`-Wert, und
`registerEnemyModelCenterY()` (`utils/enemy-aim.util.ts`) bekommt die Modellmitte aus
`modelMinY`/`modelMaxY`.

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
**Lösung:** Zuerst das größte SkinnedMesh gewählt; heute merged `bakeVAT` alle SkinnedMeshes (Spider: 13.173 VAT-Vertices, siehe ENEMY_MODEL_BUDGET.md).

---

## Konfiguration

### EnemyTypeConfig Felder (relevant fuer Instancing)

| Feld | Beschreibung |
|------|-------------|
| `hasAnimations` | true (und Clips im Model) → `bakeVAT` bzw. `bakeObjectAnimVAT`, sonst `bakeStaticVAT` |
| `walkAnimation` | Clip-Name fuer Walk |
| `runAnimation` | Clip-Name fuer Run |
| `deathAnimation` | Clip-Name fuer Death (gebacken bis zum Entfernen) |
| `deathAnimations` | Pool von Todes-Clips, einer pro Kill (gebacken wie `deathAnimation`) |
| `animationSpeed` | Playback Speed Multiplier |
| `randomAnimationStart` | Zufaelliger Start-Offset (verhindert Sync) |
| `unlit` | true → kein Lighting (Cartoon-Modelle) |
| `scale` | Model-Skalierung (in Instance Matrix) |
| `headingOffset` | Rotations-Korrektur |
| `emissiveIntensity`, `emissiveColor`, `colorMultiplier` | Uniforms des VAT-Materials |
| `healthBarColor` | Feste Farbe der Health-Bar |

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
eliminiertes `Math.pow`/`Math.sqrt` in Hot-Paths. 5000 Enemies @ 67 FPS
(vorher 3000 @ 61 FPS). Details: siehe ARCHITECTURE.md / DONE.md.

**VAT Shader Emissive (Stand 2026-02-14):** `emissiveIntensity` und `emissiveColor`
Uniforms im Fragment Shader zur Korrektur dunkel dargestellter Modelle (Mammoth, Rat,
Spider, Zombie Soldier). Werte stammen aus `EnemyTypeConfig`.
