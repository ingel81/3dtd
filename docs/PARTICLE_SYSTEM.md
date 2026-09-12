# Particle System Dokumentation

## Übersicht

Das visuelle Effektsystem umfasst mehrere Subsysteme, nicht nur klassische
CPU-Partikel. `ThreeEffectsRenderer` ist seit 2026-05-21 eine Delegations-Facade
ueber fokussierten Modulen (siehe Datei-Tabelle unten). Aktueller Stand:

- **Trail Additive Pool** (3000 Partikel): Feuer, Tracer, Explosionen,
  Glueheffekte, Bullet-Trails, Arcane-Orb-Spirale, Flame-Beam.
- **Trail Normal Pool** (4000 Partikel): Rauch, Staub, opake Cannon-Trails,
  Rocket-Rauchspur, Blood-Splatter.
- **Tower Fire Pool** (800 Partikel, dediziert): Tower-Innenfeuer,
  unabhaengig von Combat-VFX, immer verfuegbar.
- **Sprite-Sheet Atlanten** (`generateExplosionAtlas`, `generateSmokeAtlas`):
  4×4 prozedural generierte Texturen, Atlas-Frame-Animation via
  `frameIndex` Attribut.
- **GPU-instanzierte Decals** (`DecalInstanceManager`): Blood-Decals (max 100),
  Ice-Decals (max 150), Kampfspuren (max 200, eine pro Route-Zelle, siehe unten),
  1 Draw Call pro Decal-Typ. Ausblenden über das Opacity-Attribut.
- **GPU-instanzierte Floating Text** (`FloatingTextInstanceManager`):
  Floating Damage Numbers ueber Gegnern. 1 Draw Call fuer alle Texts.
- **Frost-/Poison-Auren**: Pro-Enemy orbitierende Partikel-Cluster (Tracking
  ueber Maps mit `localPosition` und `orbitAngle`).

Pool-Limits zentral in `configs/visual-effects.config.ts` (`PARTICLE_LIMITS`,
`BLOOD_DECAL_CONFIG`, `ICE_DECAL_CONFIG`, `SCORCH_DECAL_CONFIG`, `FIRE_INTENSITY`,
`EXPLOSION_PRESETS`, `EXPLOSION_LOOK`, `EFFECT_COLORS`).

---

## Trail-Pools (CPU-driven, Points)

Zwei klassische Three.js `Points` mit unterschiedlichen Blending-Modi:

- **Additive Pool**: Für Feuer, Tracer, Explosionen, Glüheffekte
- **Normal Pool**: Für Rauch, Staub, opake Partikel

ShaderMaterial ist **default aktiv** (`useShaderMaterial = true`); per
**P-Taste** kann auf `PointsMaterial` umgeschaltet werden (Fallback ohne
Per-Partikel-Groessen, mit harten Quadrat-Kanten).

### Free-Lists (O(1) Allocation)

Jeder Pool hat eine Free-List (`freeIndicesAdditive`, `freeIndicesNormal`,
`freeIndicesTowerFire`) als Stack freier Indizes plus einen Round-Robin-Cursor
als Fallback. Aktivitaets-Tracking (`_poolDirtyAdditive` etc.) ueberspringt
komplett inaktive Pools im Update-Loop.

Ein Pool mit leerer Draw-Range ist unsichtbar und steht nicht in der
Render-Liste (`DrawGate` aus `renderers/draw-gate.ts`, gesetzt in
`updateBuffers()`). Dasselbe gilt fuer die Decal-Pools und Floating Text ohne
Instanzen. Der Lade-Warm-up zeichnet sie einmal, damit Shader und Uploads nicht
in die erste Welle fallen.

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

  // Trail Typ: 'default' (zufällige Streuung) oder 'spiral' (Railgun-Stil rotierend)
  trailType?: 'default' | 'spiral';

  // Spiral-spezifische Einstellungen (nur bei trailType === 'spiral')
  spiralRadius?: number; // Abstand vom Zentrum (default: 1.0)
  spiralSpeed?: number;  // Rotationen pro Sekunde (default: 3.0)
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

## Spawn-API (ThreeEffectsRenderer)

Die wichtigsten Effekt-Spawner — alle als Methoden auf `ThreeEffectsRenderer`,
typischerweise vom `VFXService` ueber EventBus-Subscriptions aufgerufen:

| Methode | Zweck |
|---------|-------|
| `spawnBloodSplatter(lat, lon, h, count)` | Blut-Partikel (Normal Pool) |
| `spawnBloodDecal(lat, lon, h, size)` | Boden-Decal (GPU-instanced) |
| `spawnIceDecal(lat, lon, h, size)` | Eis-Decal (GPU-instanced) |
| `markScorch(localX, localY, localZ, source)` | Kampfspur am Boden unter einem Treffer, eine pro Route-Zelle |
| `spawnFire(...)` / `spawnFireOnTerrain(...)` / `spawnFireAtLocalY(...)` | Anhaltende Feuerquelle (Intensity-Preset) |
| `spawnFireFlash(lat, lon, localY)` | Kurzer Feuerblitz (z.B. Flame-Beam-Hit) |
| `spawnExplosion(localX, localY, localZ, count, radius, smokePuffs)` | Zweistufige Feuer-Atlas-Explosion am lokalen Punkt, siehe unten |
| `spawnExplosionAtGeo(lat, lon, h, count, radius, smokePuffs)` | Dasselbe an Geo-Position |
| `spawnIceExplosionAtGeo(lat, lon, h, count)` | Runder Funken-Burst, Palette `BURST_PALETTES.ice` |
| `spawnBurstAtGeo(lat, lon, h, count, palette)` | Gleicher Burst in einer Palette aus `BURST_PALETTES`: `arcane` (Arcane Orb, Violett/Cyan), `chaos` (Chaos Orb, Violett/Magenta), `poison` (Poison Glob, Grün) |
| `spawnMuzzleFlash(localX, localY, localZ, profile)` | Muendungsfeuer, Anzahl/Größe/Dauer aus `MUZZLE_FLASH_PROFILES` |
| `spawnTrailParticles(pos, config)` | Konfigurierbarer Projektil-Trail |
| `spawnFloatingText(...)` | GPU-instanced Floating Damage Number |

Decals nutzen Konfigurationen aus `BLOOD_DECAL_CONFIG` / `ICE_DECAL_CONFIG`
(Fade-Delay, Fade-Duration, Base-Color, Color-Variation, Height-Offset).

---

## Explosionen (Feuer-Atlas, zweistufig)

`spawnExplosion(x, y, z, count, radius, smokePuffs)`, Werte in `EXPLOSION_LOOK`
(`visual-effects.config.ts`), Stand 2026-09-12:

1. **Feuerball**: `count` additive Sprites aus dem Explosions-Atlas. Die 16 Frames
   laufen über die Lebensdauer (0,3 bis 0,7 s): Flash (erstes Viertel), Feuerball,
   Auflösen, Rauchfetzen. Die Sprite-Größe läuft von `sizeStart` 1 auf `sizeEnd` 0,4
   (`atlasSpriteSize`). Bis 2026-09-12 schrumpfte sie wie bei runden Partikeln auf 0
   und halbierte den Feuerball, bevor seine Frames an der Reihe waren.
2. **Rauch**: `smokePuffs` Sprites aus dem Rauch-Atlas im Normal-Pool, dunkel getönt.
   Sie warten 0,2 bis 0,35 s (die Lebenszeit startet über 1, `atlasSpriteSize` zeichnet
   sie bis dahin mit Größe 0), steigen dann auf und wachsen von halber auf volle
   Größe, während der Atlas sie bis auf Alpha 0 ausblendet. Vorher gab es keinen
   sichtbaren Rauch: die Rauch-Frames des Explosions-Atlas sind dunkel und gehen im
   additiven Pool unter, der Rauch-Atlas war erzeugt, aber ungenutzt.

Geschwindigkeit und Sprite-Größe skalieren mit `radius / referenceRadius` (6 m). Die
Kanone übergibt ihren Splash-Radius (6 m, Werte wie vorher), die Rakete ihren
Preset-Radius 8 m (ein Drittel größer), der Bullet-Impact keinen Radius. Zurück zum
alten Bild: `fire.sizeEnd = 0` und `smokePuffs = 0` in `EXPLOSION_PRESETS`.

---

## Kampfspuren (Scorch-Decals)

Schicht 1 aus `docs/game-design/COMBAT_HEATMAP_STUDY.md`, seit 2026-09-12. Dunkle
Brandflecken als eigener `DecalInstanceManager`-Pool (`ScorchMarks` in
`scorch-marks.ts`, Shader `createScorchDecalShader`), Werte in `SCORCH_DECAL_CONFIG`:

- **Auslöser:** Einschläge von Cannon und Rocket (`VFXService`, aus
  `vfx:projectile-impact`) und Flammenstrahlen: jeder brennende Strahl markiert sein
  Ziel alle 400 ms (`ThreeFlameBeamRenderer`).
- **Höchstens eine Spur pro Route-Grid-Zelle** (2 × 2 m). Die Decal-ID ist der
  Zellschlüssel. Ein weiterer Treffer in derselben Zelle macht die Spur dunkler
  (Cannon +0,1, Rocket +0,12, Feuer +0,05, höchstens 0,8) und startet ihr Ausblenden
  neu (`DecalInstanceManager.reinforce`).
- **Nur auf der Route und am Boden:** Punkte außerhalb der Korridor-Zellen und Treffer
  mehr als 6 m über dem Zellboden (Flieger) hinterlassen nichts. Die Höhe kommt aus
  dem Route-Grid (`getGroundLocalYAt`, verdrahtet in `GameStateManager.initialize`),
  nicht aus der Einschlagshöhe.
- **Lebensdauer:** Wanduhr wie Blut, 60 s stehen, 30 s ausblenden. Pool 200; ist er
  voll, weicht die Spur, die am längsten nicht mehr getroffen wurde.
- **Reihenfolge:** `renderOrder` 998, also unter Blut und Eis (999).
- **Reset:** `ThreeEffectsRenderer.clear()` (Spielneustart, Standortwechsel).
- Rein optisch, kein Einfluss auf Gameplay oder Training.

Alle Decals sind rund (`DecalInstanceManager.add` nimmt einen Radius). Bei Blood und
Ice ist `size` der Durchmesser, bei Kampfspuren gibt die Config den Radius vor. Bis
2026-09-12 blieb die Z-Achse bei 1, jedes Decal war ein Oval von 2·size × 2 m. Die
Durchmesser der Aufrufer sind so gewählt, dass die Fläche gleich bleibt
(Durchmesser = 2·√alte size): Blut 0,8 → 1,8 und 2,0 → 2,8, Eis 3,5 → 3,7,
1,5 bis 3 → 2,4 bis 3,5 und 2 bis 3 → 2,8 bis 3,5.

---

## Screen Shake

`ScreenShakeService` (`game-engine/`) wählt Stärke und Dauer, `ThreeTilesEngine`
zeichnet ihn. Werte in `SCREEN_SHAKE_CONFIG`, Stand 2026-09-12:

- **Umsetzung:** ein Versatz der Projektionsmatrix im Bildraum, nur für den Draw eines
  Frames (`drawFrame`). Er wird nach `tilesRenderer.update()` gesetzt und danach mit
  den exakten alten Matrizen zurückgesetzt. Bis 2026-09-12 bewegte der Shake
  `camera.position`. `UpdateOnChangePlugin` vergleicht jeden Frame die
  View-Projection-Matrix exakt und hat deshalb in jedem geschüttelten Frame die volle
  Tile-Traversierung laufen lassen; Raycasts (Tower-Platzierung) sahen die geschüttelte
  Kamera. Beides entfällt.
- **Stärke:** Anteil der Bildhöhe (0,005 ≈ 5 px bei 1080p), linear auf 0 über die
  Dauer, nach Wanduhr statt pro Frame (der alte Abbau pro Frame nahm 60 FPS an).
  Cannon 0,0025 / 150 ms, Rocket 0,005 / 200 ms, HQ-Schaden 0,0025 × 0,5 bis 2 /
  300 ms, Boss-Tod 0,004 / 400 ms. Kalibriert auf den alten Meter-Shake: Einschläge wie
  aus 150 m Kameraabstand gesehen, HQ und Boss wie aus 425 m (Startkamera).
- **Nur nahe Einschläge:** volle Stärke bis 150 m Abstand zwischen Kamera und
  Einschlag, dann linear weniger bis 0 bei 450 m. HQ-Schaden und Boss-Tod schütteln
  unabhängig vom Ort.

### Messen

`__perf.shakeBench(seconds = 5)` in der DevTools-Konsole, nur mit echten Tiles (nicht
DevWorld). Drei Phasen à `seconds`: `off` (kein Shake), `shake` (Shake läuft
durchgehend in Rocket-Stärke, auch wenn er in den Display Options aus ist),
`camera-move` (Kamera jeden Frame um bis zu 0,8 m versetzt und nach dem Zeichnen
zurückgesetzt, wie beim alten Shake). Danach `console.table` mit einer Zeile pro
Phase: `frameMs` / `frameP95Ms` (Abstand zwischen Frames), `renderMs` (`render()` auf
der CPU), `tilesUpdateMs` (`tilesRenderer.update()`), `traversals` (Frames mit voller
Tile-Traversierung). Während der Messung Kamera nicht bewegen, Spiel am besten
pausiert.

---

## VFX-Einstellungen

Spieler-Schalter im Display-Menü der Quick Actions (Panel über dem Augen-Button),
Stand 2026-09-12. Typ und Presets in `three-engine/vfx-settings.ts`,
`ThreeTilesEngine.applyVfxSettings()` verteilt sie an die Renderer,
`DebugFacadeService` hält und speichert sie. Umschalten wirkt sofort, ohne Reload.

Aus heißt: nicht erzeugen und nicht zeichnen. Die Schalter sitzen an den
Spawn-Stellen, nicht an der Sichtbarkeit. Die Spiel-Logik liest sie nicht, Schaden,
Status-Effekte und Events laufen gleich, Training und Headless-Betrieb auch.

| Schalter | Default | Aus heißt |
|----------|---------|-----------|
| Muzzle Flash | an | `spawnMuzzleFlash` erzeugt keine Partikel, `ThreeTowerRenderer.triggerMuzzleFlash` zündet das Licht nicht. Das PointLight bleibt dunkel in der Szene, sonst bräuchten alle beleuchteten Materialien ein neues Shader-Programm. |
| Projectile Trails | an | `TrailStreakRenderer.create` vergibt keinen Streak, laufende fallen weg (je Projektil ein eigenes Mesh mit eigenem Draw Call, Geometrie jeden Frame neu). `spawnConfigurableTrail` erzeugt keine Trail-Partikel. |
| Impact Effects | an | Keine Feuer-Atlas-Explosionen samt Rauch (die einzigen Sprite-Sheet-Partikel), keine Funken-Bursts (Eis, Arcane, Chaos, Poison), keine Blutspritzer. |
| Ground Marks | an | Keine Blut-, Eis- und Brand-Decals. Beim Ausschalten werden die liegenden gelöscht, die leeren Pools fallen per `DrawGate` aus der Render-Liste. `VFXService` und `CombatVfxService` sparen die Terrain-Raycasts für ein Decal (einer pro Blut-Decal, bis zu vier pro Eis-Explosion). |
| Bloom | aus | `UnrealBloomPass` aus. Sind Bloom und Color Grading beide aus, zeichnet die Engine ohne Composer. |
| Color Grading | None | LUT-Pass aus. |
| Freeze Tint | an | Kein blauer Tint und keine Frost-Aura auf verlangsamten Gegnern. Der Slow bleibt vermerkt, beim Einschalten kommen Tint und Aura sofort zurück. |

Die Presets `Low`, `Medium` und `High` (`VFX_PRESETS`) setzen die ersten sechs
Schalter; die Einzelschalter bleiben einstellbar, weicht einer ab, steht "Custom"
im Kopf. Freeze Tint und Screen Shake setzt kein Preset: der Tint kostet so gut wie
nichts, und wer den Shake wegen Übelkeit aus hat, bekommt ihn durch einen Klick auf
High nicht zurück.

- **Low:** Muzzle Flash, Trails, Impact Effects und Ground Marks aus, Bloom aus, Grading None.
- **Medium:** nur die Projectile Trails aus.
- **High:** das Spiel wie ausgeliefert. Bloom gehört nicht dazu, er lässt jedes
  emissive Material dauerhaft leuchten (Kommentar in `VFXService.handleChainLightning`).

Die Kosten sind nicht gemessen. Die Reihenfolge der Presets folgt dem Code: Draw
Calls pro Projektil bei den Trails, Partikelzahl und Fill-Rate großer additiver
Sprites bei den Explosionen, drei instanzierte Draw Calls bei den Bodenspuren.

Gespeichert werden die Schalter flach in `td_display_options`
(`utils/display-options.storage.ts`), zusammen mit Health Bars, Damage Numbers,
Screen Shake und Frame-Limit. Die früheren Einzelschlüssel `3dtd-fps-limit` und
`td_screen_shake_enabled` werden beim Laden übernommen und gelöscht.

---

## VFXService (Event-Bridge)

Der `VFXService` (`game-engine/vfx.service.ts`) lauscht auf Events:

- `vfx:blood` → `spawnBloodSplatter` + optional `spawnBloodDecal`
  (Decal-Durchmesser haengt von `intensity` ab: ≥30 → 2,8 m, ≥10 → 1,8 m, sonst keins)
- `vfx:projectile-impact` → Feuer-Atlas-Explosion mit rocket/cannon/bullet-Preset
  (`EXPLOSION_PRESETS`); `arcane-orb`, `chaos-orb` und `poison-glob` bekommen statt
  dessen einen Funken-Burst (`spawnBurstAtGeo` mit ihrer Palette aus
  `BURST_PALETTES`); `ice-shard` und `arrow` nichts, der Eis-Burst kommt vom Treffer
  selbst (`CombatVfxService.emitIceExplosion`)
- `vfx:muzzle-flash` → Partikel + gepoolter `PointLight`, nur für Tower mit Eintrag in
  `MUZZLE_FLASH_PROFILES` (`visual-effects.config.ts`): Archer (schwacher Glanz, kein Licht),
  Dual-Gatling (klein, kurz), Rocket (mittel), Cannon (groß, am längsten). Ice, Magic und
  Poison schießen zwar Projektile, blitzen aber nicht; Fire, Lightning und Tentacle spawnen
  keine. Das eine PointLight bleibt dauerhaft in der Szene, nur die Intensität wechselt pro
  Profil (sonst Programmwechsel für alle beleuchteten Materialien)

---

## Dateien

| Datei | Beschreibung |
|-------|--------------|
| `three-engine/renderers/three-effects.renderer.ts` | Delegations-Facade (FloatingText, Debug-Spheres, `update`/`clear`/`dispose`-Orchestrierung) |
| `three-engine/renderers/particle-pool-manager.ts` | 3 GPU-Partikel-Pools (Trail-Additive/Normal, Tower-Fire), Free-Lists, Buffer-Caches, Atlas, Shader-Toggle |
| `three-engine/renderers/particle-shaders.ts` | GLSL-Vertex/Fragment-Shader + ShaderMaterial-Factory fuer die Partikel-Pools |
| `three-engine/renderers/particle-effects-renderer.ts` | Combat-VFX (Blood/Fire/Explosion/Smoke/Trails/Muzzle), Decals, `activeEffects`-Lifecycle |
| `three-engine/renderers/environment-effects-renderer.ts` | HQ-Explosion, Fire-Flash, Tower-Inner-Fire |
| `three-engine/renderers/aura-renderer.ts` | Orbitierende Frost-/Poison-Status-Auren |
| `three-engine/renderers/decal-instance.manager.ts` | GPU-instanced Blood/Ice/Scorch-Decals |
| `three-engine/renderers/decal-shaders.ts` | Decal-Shader (Fade, Color-Variation) |
| `three-engine/renderers/scorch-marks.ts` | Kampfspuren: eine pro Route-Zelle, Verstärken bei Wiederholung |
| `three-engine/renderers/floating-text/floating-text-instance.manager.ts` | GPU-instanced Floating Damage Numbers |
| `three-engine/renderers/floating-text/floating-text-material.ts` | Custom ShaderMaterial fuer Text-Atlas |
| `three-engine/renderers/floating-text/floating-text-atlas.ts` | Prozedurale Text-Atlas-Generierung |
| `three-engine/renderers/sprite-atlas-generator.ts` | Sprite-Sheet-Atlanten (Explosion 4×4, Smoke 4×4) |
| `configs/projectile-types.config.ts` | Trail-Partikel Konfiguration (TrailParticleConfig) |
| `configs/visual-effects.config.ts` | Partikel-Limits, Decal-Configs, Explosion-Presets, Farben |
| `game-engine/vfx.service.ts` | VFX Event Handler (Blood, Explosion, Muzzle-Flash, Projectile Impact) |
| `three-engine/vfx-settings.ts` | Spieler-Schalter und Presets Low/Medium/High, siehe [VFX-Einstellungen](#vfx-einstellungen) |
| `components/engine-test/engine-test.component.ts` | Engine Test Sandbox |
