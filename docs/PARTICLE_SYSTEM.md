# Particle System Dokumentation

## Übersicht

Das visuelle Effektsystem umfasst mehrere Subsysteme, nicht nur klassische
CPU-Partikel. `ThreeEffectsRenderer` ist seit 2026-05-21 eine Delegations-Facade
ueber fokussierten Modulen (siehe Datei-Tabelle unten). Aktueller Stand:

- **Trail Additive Pool** (3000 Partikel): Feuer, Tracer, Explosions-Feuerball,
  Glüheffekte, Bullet-Trails, Arcane-Orb-Spirale, Flame-Beam, Mündungsfeuer, Funken-Bursts.
- **Trail Normal Pool** (4000 Partikel): Explosionsrauch, opake Cannon-Trails,
  Rocket- und Chaos-Orb-Rauchspur, Blood-Splatter.
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
- **Atompilz** (`MushroomCloudRenderer`): eigene Points mit den ShaderMaterials
  der Trail-Pools, in Spielzeit, siehe [Atompilz](#atompilz-nuklearschlag).

Pool-Limits und Effektwerte in `configs/visual-effects.config.ts` (`PARTICLE_LIMITS`,
`BLOOD_DECAL_CONFIG`, `ICE_DECAL_CONFIG`, `SCORCH_DECAL_CONFIG`, `EXPLOSION_PRESETS`,
`EXPLOSION_LOOK`, `MUSHROOM_CLOUD_LOOK`, `BURST_PALETTES`, `MUZZLE_FLASH_PROFILES`,
`SCREEN_SHAKE_CONFIG`, `FIRE_INTENSITY` mit Anzahl und Radius für `spawnFire*`).
Der Tower-Fire-Pool (800) ist `MAX_TOWER_FIRE_PARTICLES` in `particle-pool-manager.ts`.

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

Das Tower-Innenfeuer belebt seine Partikel selbst wieder, an `getInactiveParticle()`
vorbei, und meldet das per `markPoolDirty('towerFire')`. Ohne diese Meldung würde
`updateBuffers()` den Pool nach einem langen Frame (Tab aus dem Hintergrund), der alle
Partikel auf einmal tötet, dauerhaft überspringen.

Pro Frame bewegt und altert `ParticleEffectsRenderer.update()` jedes lebende Partikel
der beiden Trail-Pools genau einmal, auch die Partikel eines Effekts. Der Effekt-Durchlauf
danach ergänzt nur Schwerkraft (Blut), das Wiederbeleben brennender Feuer und das
Ablaufen. Ausgebrannte Partikel eines nicht brennenden Effekts nimmt er sofort aus
seiner Liste, damit ein späteres Ablaufen nicht das Partikel eines neuen Besitzers
tötet. Die Werte für Blut und Feuer sind auf diesen einen Schritt umgerechnet
(Kommentar `BLOOD_GRAVITY` in `particle-effects-renderer.ts`).

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
| Größen-Verlauf | ✅ runde Partikel `size * life` (`updateBuffers`), Sprite-Partikel von `sizeStart` nach `sizeEnd` (`atlasSpriteSize`) |
| Soft Edges | ✅ `smoothstep()` im Fragment Shader |
| Sprite-Sheet-Atlanten | ✅ `frameIndex`-Attribut; additiver Pool mit Explosions-Atlas, Normal-Pool mit Rauch-Atlas (je 4×4) |
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
| Rotation pro Partikel | ❌ | `Points` sind bildschirmparallele Quadrate, der Shader dreht `gl_PointCoord` nicht |
| Eigene Textur pro Effekt | ❌ | Ein Atlas pro Pool (`uAtlas`) |

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

Three.js stellt vier Shader-Chunks bereit, die Log-Depth-Support hinzufügen. Die
Snippets sind gekürzt; die Shader in `particle-shaders.ts` haben zusätzlich das
`frameIndex`-Attribut und den Atlas-Zweig.

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
| `logdepthbuf_vertex` | `vFragDepth = 1.0 + gl_Position.w`, `vIsPerspective = float(isPerspectiveMatrix(projectionMatrix))` |
| `logdepthbuf_pars_fragment` | `uniform float logDepthBufFC` (Scaling-Faktor) plus die beiden Varyings |
| `logdepthbuf_fragment` | `gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2(vFragDepth) * logDepthBufFC * 0.5` |

Alle vier greifen nur mit `USE_LOGARITHMIC_DEPTH_BUFFER` (Stand three r186).

**Wichtig:** `#include <common>` muss vor den anderen Chunks stehen, da es die `isPerspectiveMatrix()` Hilfsfunktion definiert.

### Zukünftige Erweiterungsmöglichkeiten

Falls noch mehr Features gewünscht:

1. **Rotation**: Mit Instanced Quads statt Points (aber komplexer)

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
    spawnChance: 0.5,
    countPerSpawn: 2,
    colorMin: { r: 0.06, g: 0.06, b: 0.06 },  // Near black
    colorMax: { r: 0.28, g: 0.28, b: 0.28 },  // Medium grey
    sizeMin: 0.5,
    sizeMax: 1.4,
    lifetimeMin: 0.5,
    lifetimeMax: 1.2,
    velocityX: { min: -1.0, max: 1.0 },
    velocityY: { min: 0.3, max: 1.0 },         // Gentle upward drift
    velocityZ: { min: -1.0, max: 1.0 },
    spawnOffset: 0.4,
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
    countPerSpawn: 2,
    colorMin: { r: 1.0, g: 0.7, b: 0.05 },   // Warm yellow
    colorMax: { r: 1.0, g: 0.85, b: 0.25 },  // Golden
    sizeMin: 0.4,
    sizeMax: 0.85,
    lifetimeMin: 0.08,
    lifetimeMax: 0.20,  // Short tracer puffs
    velocityX: { min: -0.4, max: 0.4 },
    velocityY: { min: -0.4, max: 0.4 },
    velocityZ: { min: -0.4, max: 0.4 },
    spawnOffset: 0.15,
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
| `spawnFire(...)` / `spawnFireOnTerrain(...)` / `spawnFireAtLocalY(...)` | Anhaltende Feuerquelle, Stufe `tiny` bis `inferno` (Anzahl und Radius aus `FIRE_INTENSITY`) |
| `spawnFireFlash(lat, lon, localY)` | Kurzer Feuerblitz (z.B. Flame-Beam-Hit) |
| `spawnExplosion(localX, localY, localZ, count, radius, smokePuffs)` | Zweistufige Feuer-Atlas-Explosion am lokalen Punkt, siehe unten |
| `spawnExplosionAtGeo(lat, lon, h, count, radius, smokePuffs)` | Dasselbe an Geo-Position |
| `spawnIceExplosionAtGeo(lat, lon, h, count)` | Runder Funken-Burst, Palette `BURST_PALETTES.ice` |
| `spawnBurstAtGeo(lat, lon, h, count, palette)` | Gleicher Burst in einer Palette aus `BURST_PALETTES`: `arcane` (Arcane Orb, Violett/Cyan), `chaos` (Chaos Orb, Violett/Magenta), `poison` (Poison Glob, Grün) |
| `spawnMuzzleFlash(localX, localY, localZ, profile)` | Muendungsfeuer, Anzahl/Größe/Dauer aus `MUZZLE_FLASH_PROFILES` |
| `spawnConfigurableTrail(localX, localY, localZ, config)` | Projektil-Trail nach `TrailParticleConfig`, Pool nach `blending`, `trailType: 'spiral'` für die Arcane-Orb-Spirale |
| `spawnFloatingText(...)` | GPU-instanced Floating Damage Number |

Decals nutzen Konfigurationen aus `BLOOD_DECAL_CONFIG` / `ICE_DECAL_CONFIG`
(Fade-Delay, Fade-Duration, Base-Color, Color-Variation, Height-Offset).

`DecalInstanceManager` vergibt Instanz-Slots über `InstanceSlotAllocator`, die
Draw-Anzahl folgt dessen `activeCount`. Ist ein Pool voll, entfernt der Aufrufer vorher
das Decal mit der frühesten Spawn-Zeit (`removeOldest`). `updateFades()` tut nichts, bis
das früheste Ausblenden fällig ist, und läuft danach jeden Frame, solange ein Decal
ausblendet.

---

## Explosionen (Feuer-Atlas, zweistufig)

`spawnExplosion(x, y, z, count, radius, smokePuffs)`, Werte in `EXPLOSION_LOOK`
(`visual-effects.config.ts`), Stand 2026-09-12. Ein Einschlag erzeugt eine Explosion;
`VFXService` wählt die Werte nach Projektiltyp (`EXPLOSION_PRESETS`):

| Projektil | Feuerball-Sprites | Radius | Rauch-Puffs |
|-----------|-------------------|--------|-------------|
| `rocket` und Typen mit `homing` | 50 | 8 m (Preset, rein optisch) | 6 |
| `cannonball` | 50 | `splashRadius` des Projektils (6 m), Fallback Preset 6 m | 5 |
| `bullet` | 2 | keiner, also `referenceRadius` (6 m) | 0 |

Poison Glob, Arcane Orb und Chaos Orb bekommen statt dessen einen Funken-Burst, siehe
[VFXService](#vfxservice-event-bridge).

1. **Feuerball, ab dem Einschlag:** `count` additive Sprites aus dem Explosions-Atlas,
   alle am Einschlagpunkt. Richtung zufällig über die Kugel, Tempo 5 bis 20 m/s, der
   senkrechte Anteil halbiert und um 2 m/s nach oben verschoben. Lebensdauer 0,3 bis
   0,7 s; die 16 Frames laufen gleichmäßig über diese Zeit: Flash (Frames 0 bis 3),
   Feuerball (4 bis 7), Auflösen (8 bis 11), Rauchfetzen (12 bis 15). Sprite-Größe 2,5
   bis 5,5, über die Lebensdauer von `sizeStart` 1 auf `sizeEnd` 0,4 (`atlasSpriteSize`):
   die Frames lassen den Feuerball schon wachsen, ein Schrumpfen auf 0 hätte ihn
   halbiert, bevor die Feuerball-Frames an der Reihe sind. Tönung: 40 % Atlasfarbe,
   30 % warm, 30 % orange.
2. **Rauch, nach 0,2 bis 0,35 s:** `smokePuffs` Sprites aus dem Rauch-Atlas im
   Normal-Pool, grau getönt (0,3 bis 0,45), Startpunkt zufällig im Kreis mit 0,3 × Radius
   um den Einschlag. Die Verzögerung wartet das Ende der hellen Feuerball-Hälfte ab:
   die Lebenszeit startet bei `1 + delay / maxLife`; solange sie über 1 liegt, gibt
   `atlasSpriteSize` 0 zurück und `updateBuffers` lässt das Partikel aus dem Draw-Range
   (manche GPUs rastern `gl_PointSize` 0 als 1-px-Punkt). Danach lebt jeder Puff 1,2 bis
   2,0 s, steigt mit 1 bis 2,5 m/s, driftet seitlich bis 0,5 m/s und wächst von halber auf
   volle Größe (2,5 bis 4,0), während der Atlas ihn auf Alpha 0 ausblendet. Mit Rauch ist
   die Explosion nach spätestens 2,35 s weg, ohne nach 0,7 s. Der Rauch sitzt im
   Normal-Pool, weil die dunklen Rauch-Frames des Explosions-Atlas im additiven Pool
   nicht zu sehen sind.

**Skalierung mit dem Blast-Radius:** `scale = radius / referenceRadius` (6 m). Mit
`scale` wachsen Tempo und Sprite-Größe des Feuerballs und die Sprite-Größe des Rauchs;
der Streukreis des Rauchs wächst direkt mit dem Radius. Anzahl, Lebensdauern,
Verzögerung sowie Steig- und Driftgeschwindigkeit des Rauchs hängen nicht vom Radius ab.
Die Kanone (6 m) bleibt so bei den Referenzwerten, die Rakete (8 m) fliegt um ein
Drittel schneller und größer auseinander.

Zurück zum alten Bild: `EXPLOSION_LOOK.fire.sizeEnd = 0` und `smokePuffs = 0` in
`EXPLOSION_PRESETS`.

---

## Atompilz (Nuklearschlag)

`MushroomCloudRenderer` (`three-engine/renderers/mushroom-cloud.renderer.ts`), Werte in
`MUSHROOM_CLOUD_LOOK`, seit 2026-09-13. `VFXService` ruft `engine.mushroomClouds.detonate`
beim `ability:impact`; die Phasen stehen in [ABILITIES.md](ABILITIES.md#darstellung).
Die Glut schreibt `CloudGlow` (`mushroom-cloud-glow.ts`), den Rauch samt Sortierung
`CloudSmoke` (`mushroom-cloud-smoke.ts`), beide aus der Form von `CloudShape`
(`mushroom-cloud-shape.ts`); Ring, Dom, Blitz und Bildschirmblitz stehen in `CloudBlast`
(`mushroom-cloud-blast.ts`), die Puffer-Helfer in `effect-buffers.ts`.

- **Spielzeit:** `ThreeTilesEngine.update` reicht den Frame in Spielzeit weiter
  (Wanduhr mal Timescale, in der Pause 0). Jedes Partikel ist eine Funktion aus dem
  Alter des Pilzes und vier Zufallszahlen vom Einschlag, jeden Frame neu berechnet:
  Pause hält den Pilz an, ein langer Frame bei hohem Timescale endet im selben Bild
  wie viele kurze. Die Trail-Pools dagegen altern in Wanduhrzeit.
- **Eigene Puffer, geteilte Materialien:** zwei `Points` (additiv mit dem
  Explosions-Atlas, normal mit dem Rauch-Atlas) mit den ShaderMaterials der
  Trail-Pools (`ParticlePoolManager.shaderMaterials`), also Log-Depth und Atlas wie
  dort. Nicht aus den Pools, weil ein Schlag auf eine große Welle trifft, die sie
  füllt. Budget pro Pilz 432 Glut- und 546 Rauchpartikel (vor dem
  Playtest-Nachtrag vom 2026-09-13 106 und 270), Puffer für zwei gleichzeitige
  Pilze (864 und 1092); ein dritter nimmt den Platz des ältesten. Pro Frame keine
  Allokation.
- **Deckkraft über den Frame:** Der Normal-Shader kennt kein Alpha pro Partikel. Der
  Rauch-Atlas wird von Frame zu Frame breiter und blasser; der Renderer wählt den
  Frame nach der gewünschten Deckkraft und gleicht die Größe über den Anteil aus, den
  der Puff im Frame bedeckt.
- **Größe in Metern:** Der Partikel-Shader rechnet in Pixeln
  (`PARTICLE_POINT_SCALE`, `size * 3000 / Tiefe`). Der Pilz rechnet Meter über die
  Höhe des Zeichenpuffers und das FOV um, damit er auf jeder Auflösung gleich groß
  ist. Die übrigen Effekte tun das nicht.
- **Sortierung:** Rauch blendet normal und schreibt keine Tiefe, er wird jeden Frame
  von hinten nach vorn geschrieben (Insertion Sort über die Reihenfolge des
  Vorframes). Die Glut zeichnet vorher (`renderOrder` 996 vor 997), damit Rauch davor
  sie dämpft.
- **Blitz, Druckwelle, Bildschirm:** Sprite und Ring mit eingebauten Materialien und
  prozeduralen `DataTexture`s, Tiefentest aus wie beim Zielmarker; ein
  Vollbild-Quad (ShaderMaterial mit Log-Depth-Chunks) hellt das Bild 0,55 s lang
  additiv auf, Spitze 0,65, quadratisch abklingend (`flash.screenPeak`, 0 schaltet
  ihn ab).
- **Schockkuppel:** eine Halbkugel (`SphereGeometry`, 32 × 10 Segmente) mit eigenem
  ShaderMaterial samt Log-Depth-Chunks, additiv, am Umriss am hellsten
  (`1 - |n·v|` hoch 2,5). Anders als Ring und Blitz mit Tiefentest: Gebäude davor
  verdecken sie.
- **Glutbrocken:** 48 Schweife aus je 4 Glutpunkten im additiven Puffer, der Kopf und
  seine Positionen 45, 90 und 135 ms früher, kleiner und dunkler. Die Flugbahn mit
  linearer Luftreibung und Schwerkraft ist eine geschlossene Formel des Alters, also
  in Spielzeit wie der Rest; ein Punkt unter der Höhe des Einschlagpunkts fällt weg.
  Nicht über den `TrailStreakRenderer` (ein Mesh und Draw Call pro Schweif, jeden
  Frame neu gebaut, am Schalter Projectile Trails) und nicht über die Trail-Pools
  (Wanduhr).
- **Bodenfeuer:** 32 Glutpunkte bis 24 m um den Einschlag, flackern über Größe,
  Helligkeit und Atlas-Frame in Spielzeit, aus bis 7,5 s. Sie stehen auf der Höhe
  des Einschlagpunkts; auf Hängen sitzen sie zu hoch oder im Boden.
- **Bloom-Kick:** `MushroomCloudRenderer.bloomKick` (1 beim Einschlag, quadratisch
  auf 0 über 0,9 s Spielzeit) geht jeden Frame an
  `PostProcessingPipeline.setBloomKick`: Bloom-Stärke von 0,3 bis 1,4, Schwelle von
  0,85 bis 0,55 (`MUSHROOM_CLOUD_LOOK.bloomKick`). `BloomKick`
  (`post-processing/bloom-kick.ts`) merkt sich die Werte des Passes und schreibt
  genau diese zurück, sobald der Kick vorbei ist oder Bloom ausgeschaltet wird. Nur
  mit Bloom an, der Kick schaltet den Pass nie ein. Eine Belichtung zum Hochziehen
  gibt es nicht, der Renderer hat kein Tone Mapping.
- **Draw Calls:** Glut und Rauch je ein Points-Draw, solange ein Pilz steht; dazu
  Ring (1,6 s), Kuppel (0,75 s), Blitz-Sprite (0,5 s) und Bild-Quad (0,55 s). Alle
  Objekte hängen an `DrawGate`s, ohne Pilz steht nichts in der Render-Liste.
- **VFX-Einstellungen:** Impact Effects aus (`setFullCloud(false)` aus
  `applyVfxSettings`) lässt den nächsten Pilz auf die Detonation schrumpfen: Blitz,
  Kern, Feuerball, zweite Feuerfront (zusammen bis 120 Glutpunkte), Schockkuppel und
  Druckwelle; kein Rauch, keine Glutbrocken, kein Bodenfeuer.
- **Reset:** `game:reset` leert die Pilze (`VFXService`).

---

## Frostbombe

`FrostBurstRenderer` (`three-engine/renderers/frost-burst.renderer.ts`), Werte in
`FROST_BURST_LOOK`, seit 2026-09-14. Gebaut wie der Atompilz: jedes Partikel ist eine
Funktion aus dem Alter des Ausbruchs (Spielzeit, Pause hält ihn an) und fünf
Zufallszahlen vom Einschlag, eigene Puffer mit den Materialien der Trail-Pools
(Hilfsfunktionen in `effect-buffers.ts`, geteilt mit dem Atompilz).

| Teil | Darstellung |
|---|---|
| Blitz | additiver Sprite, weiß-cyan, 0,35 s |
| Ring | Kältefront am Boden bis 1,15 × Radius, 1,2 s, Tiefentest aus |
| Reif | Fläche über dem ganzen Radius mit Eiskristall-Muster (Wertrauschen aus einem Hash, jedes Mal gleich), hält so lange wie der Freeze und blendet in 1 s aus, Tiefentest aus |
| Eissplitter | 64 runde additive Partikel, nach außen und oben geworfen, Luftwiderstand und Schwerkraft, bleiben am Boden liegen, bis 1,3 s |
| Nebel | 28 Puffs aus dem Rauch-Atlas (Normal-Blending), Ring über dem Radius, rollt aus und steigt leicht, bis etwa 3,2 s |

Zwei Ausbrüche gleichzeitig, ein dritter nimmt den Platz des ältesten. Mit Impact
Effects aus (VFX-Einstellungen) nur Blitz, Ring und Reif. `game:reset` leert sie.

---

## EMP

`EmpPulseRenderer` (`three-engine/renderers/emp-pulse.renderer.ts`), Werte in
`EMP_PULSE_LOOK`, seit 2026-09-14, in Spielzeit wie Atompilz und Frostbombe.

| Teil | Darstellung |
|---|---|
| Blitz | additiver Sprite, blau-weiß, 0,25 s |
| Fronten | zwei elektrische Ringe am Boden, eigene ShaderMaterials (Log-Depth-Chunks, `colorspace_fragment`, additiv, Tiefentest aus): ein schmales Band am Rand des Quads, rundherum von Rauschen gezackt, das mit dem Alter des Pulses wandert und knistert; die Bandbreite bleibt in Metern gleich, während die Front wächst. Die erste bis 1,05 × Radius in 0,75 s, die zweite 0,14 s später bis 0,85 × |
| Hülle | Halbkugel, flach (0,55), am Umriss am hellsten, 0,45 s |
| Funken | 96 runde additive Partikel, entstehen auf der ersten Front, wo sie gerade steht, bis 0,7 s, und knistern 0,12 bis 0,35 s an ihrem Platz |

Zwei Pulse gleichzeitig. Mit Impact Effects aus keine Funken. `game:reset` leert sie.
An den betäubten Gegnern selbst: Tint und Funken des Stun
([STATUS_EFFECTS.md](STATUS_EFFECTS.md#stun-effect)).

---

## Orbitallaser

`OrbitalBeamRenderer` (`three-engine/renderers/orbital-beam.renderer.ts`), Werte in
`ORBITAL_BEAM_LOOK`, seit 2026-09-14, in Spielzeit: der Fuß steht nach
Geschwindigkeit mal Alter auf dem Pfad, den der `AbilityManager` gefegt hat, so wie
der Strahl in der Simulation. Die Pause hält ihn an.

| Teil | Darstellung |
|---|---|
| Säule | Quad 9 m breit, 320 m hoch, um die Senkrechte zur Kamera gedreht; eigenes ShaderMaterial (Log-Depth-Chunks, `colorspace_fragment`, additiv, **mit** Tiefentest, Gebäude davor verdecken ihn): weißglühender Kern (0,9 m), orange Glut (3,2 m), nach oben ausblendend, am Boden am hellsten, mit Wellen, die in Spielzeit nach unten laufen |
| Fuß | Glüh-Sprite (3,2 × Radius), pulsierend, Tiefentest aus |
| Ring | am Boden im Strahlradius (5 m), die Zone, die Schaden nimmt, Tiefentest aus |
| Blitz | Sprite 60 m, wo der Strahl aufsetzt, 0,3 s |
| Funken | 220 je Sekunde vom Fuß, fliegen hinaus und fallen, 0,55 s; Funke k entsteht bei k/220 s dort, wo der Fuß da stand (Funktion seiner Nummer, kein Speicher) |
| Brandspur | alle 3 m des Wegs ein Brandfleck (Quelle `rocket`), wo der Fuß vorbeikommt, nur auf Route-Zellen und mit Ground Marks an |

Der Fuß steht auf dem Boden des Route-Grids (`setGround`, wie die Brandflecken), wo
das Grid eine Zelle hat, sonst auf der Höhe des Pfads. Zwei Strahlen gleichzeitig. Mit
Impact Effects aus keine Funken. `game:reset` leert sie.

---

## Tod der Ooze

`OozeBandRenderer.collapse()` (`three-engine/renderers/ooze/`), Werte in
`OOZE_LOOK.collapse` und `OOZE_DEATH_LOOK`, seit 2026-09-14, in Spielzeit: Die Pause
hält alles an, die Spielgeschwindigkeit beschleunigt es, ein Frame bei hoher
Geschwindigkeit lässt alles los, was in ihm fällig wurde. `OozeBodies.died` gibt dem
Band die Strecke des Kill-Sub-Steps und startet den Kollaps; dabei plant
`planOozeDeath` die Teile für die Länge des Körpers, mit den VFX-Einstellungen dieses
Moments.

| Teil | Darstellung |
|---|---|
| Band | kollabiert über 2 s (Shader-Uniform `uCollapse`): schwillt bis 0,2 s an und kocht bis etwa 1,2 s (mehr, schnellere und hellere Blasen), sackt von 0,3 bis 1,7 s zur Pfütze zusammen, die um bis zu 30 % über die Ränder läuft, reißt ab 0,6 s entlang eines Rauschmusters mit leuchtenden Kanten auf und blendet ab 1,4 s aus. Leck und Entfernen sinken wie bisher in 0,6 s |
| Blasen | eine je 2,5 m Körper (mindestens 4), bis 0,8 des Kollapses: 8 additive Funken (`BURST_PALETTES.slime`) 0,9 m über dem Boden und 14 Schleimtropfen (`spawnBloodSplatter`, Normal-Pool, `OOZE_DEATH_LOOK.goo`) |
| Pfützen | eine je 5 m (mindestens 2), zwischen 0,2 und 0,85 des Kollapses: Blut-Decal in Schleimgrün, 2,2 bis 3,8 m, im Blutmond getönt wie jede Bodenspur |
| Trümmer | 0,75 je Meter (mindestens 6), zwischen 0,05 und 0,6 des Kollapses, 0,8 m über dem Boden aus dem ganzen Körper geworfen: 5 bis 11 m/s hoch (die schweren Stücke 0,8 davon), 1 bis 4,5 m/s seitlich, drehend; sie springen einmal auf, liegen 2 bis 3,5 s und sinken in 1 s ein (`OozeDebrisRenderer`) |

Die Trümmer kommen in der Reihenfolge von `OOZE_DEBRIS_DECK`, einer Runde aus 20:
Knochen, Rippe, Schädel, Knochen, Kiefer mit Zähnen, Helm und so weiter. Ein voller
Körper (60 Stück) ergibt 18 Knochen, 12 Rippen, 6 Schädel, 6 Kiefer, 6 Bleche und je 3
Helme, Stiefel, Stoppschilder und Dosen; schon ein Körper von wenigen Metern (6 Stück)
wirft einen Schädel. Die Stücke sind prozedural aus Three-Grundkörpern mit
Vertexfarben gebaut, 1,6-fach vergrößert, damit sie aus der Übersichtskamera lesbar
bleiben, manche grün angeschleimt (Instanzfarbe).

Verteilung: Jede Art legt je Stück einen eigenen, gleich langen Abschnitt des Körpers
fest, deckt also die ganze Länge; quer bis 0,85 der bedeckten Halbbreite. Boden ist der
des Route-Grids, sonst der des Bands unter der Station.

Budget eines 80-m-Körpers: 32 Blasen (256 additive Funken und 448 Tropfen, 704
Partikel über 1,6 s), 16 der 100 Blut-Decals, 60 Trümmer. Je Trümmerart ein
`InstancedMesh` mit festem Pool (acht Runden, 160 Stück: zwei volle Oozes und etwas
mehr; ist der Pool einer Art voll, fällt das Stück weg), ein gemeinsames
`MeshStandardMaterial` und ein `DrawGate`: höchstens 9 Draw Calls, solange Trümmer
fliegen oder liegen, danach keiner. Der Warm-up beim Laden zeichnet die Pools einmal.

**Low-Preset** (Impact Effects und Ground Marks aus): keine Blasen, keine Tropfen, keine
Pfützen und ein Drittel der Trümmer (mindestens 3). Der Plan steht beim Kill; die
Spawner prüfen ihre Schalter zusätzlich selbst.

**Gemessen** (`ooze-death.spec.ts`, "Ooze death cost", jsdom ohne GPU): zwei volle
Oozes im selben Frame getötet; je Frame Band und Trümmer, das Partikel-Update und die
Pool-Puffer. Median 0,05 bis 0,06 ms je Frame, bis 717 lebende Partikel auf dem
Höhepunkt. Die langsamsten Frames waren Frame 2 oder 3 nach dem Kill mit 3,5 bis 7,0 ms
(vier Läufe); die Ursache dieser frühen Spitzen ist nicht isoliert. Nicht gemessen sind
die GPU-Kosten im Browser (Fill-Rate der additiven Funken, Draw Calls der Trümmer).

Grenzen: Der Replay kollabiert das Band eines getöteten Ooze genauso, samt Blasen und
Trümmern, aber ohne Pfützen (er hält die Bodenspuren an). Ein Neustart, bei dem keine
Ooze mehr lebt, räumt liegende Trümmer nicht ab (`OozeBodies.clear` ruft den Renderer
dann nicht); sie sinken wie ein absinkendes Band von selbst ein, spätestens etwa 7,6 s
nach dem Kill (geworfen bis 1,2 s, Flug mit Aufsprung bis 1,9 s, 3,5 s Liegen, 1 s
Einsinken).

---

## Kampfspuren (Scorch-Decals)

Schicht 1 aus `docs/game-design/COMBAT_HEATMAP_STUDY.md`, seit 2026-09-12. Dunkle
Brandflecken als eigener `DecalInstanceManager`-Pool (`ScorchMarks` in
`scorch-marks.ts`, Shader `createScorchDecalShader`), Werte in `SCORCH_DECAL_CONFIG`:

- **Auslöser:** Einschläge von Cannon und Rocket (`VFXService`, aus
  `vfx:projectile-impact`) und Flammenstrahlen: jeder brennende Strahl markiert sein
  Ziel alle 400 ms (`ThreeFlameBeamRenderer`).
- **Größe:** Radius Cannon 2,2 m, Rocket 2,6 m, Feuer 1,6 m, je ±15 %; Deckkraft einer
  neuen Spur 0,5 / 0,55 / 0,3.
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
  300 ms, Boss-Tod 0,004 / 400 ms, Nuklearschlag 0,014 / 1600 ms (seit 2026-09-13).
  Kalibriert auf den alten Meter-Shake: Einschläge wie aus 150 m Kameraabstand
  gesehen, HQ und Boss wie aus 425 m (Startkamera).
- **HQ-Schaden gedrosselt:** höchstens ein Shake je `hqDamageMinIntervalMs` (900 ms
  Wanduhr, wie der rote Leck-Rand), außer ein härterer Treffer kommt dazwischen. Ein
  einfließendes Ooze verliert HP Punkt für Punkt, bei 4x etwa siebenmal pro Sekunde,
  und schüttelte bis 2026-09-14 ohne Pause. "Härter" heißt: mehr HP verloren als beim
  letzten Shake, nicht ein größerer Faktor. Der Faktor ist für 1 bis 5 HP gleich 0,5,
  ein Zombie-Leck von 5 HP (W45) mitten im Ooze-Fluss schüttelt deshalb trotzdem
  sofort; die Amplitude bleibt beim geklemmten Faktor.
- **Nur nahe Einschläge:** volle Stärke bis 40 m Abstand zwischen Kamera und
  Einschlag (`nearDistance`), dann linear weniger bis 0 ab 100 m (`farDistance`,
  `shakeFalloff`). Es schütteln nur Cannon- und Rocket-Einschläge (auch `homing`-Typen).
  HQ-Schaden und Boss-Tod schütteln unabhängig vom Ort. Der Nuklearschlag nimmt mit
  eigener Reichweite ab: voll bis 350 m, keiner ab 1500 m (`strikeNearDistance`,
  `strikeFarDistance`), aus der Übersichtskamera (etwa 425 m) gut 90 %.
- **Überlagerung:** Der stärkere laufende Shake gewinnt, ein schwächerer, der
  währenddessen kommt, entfällt (`ScreenShake.trigger` in `three-engine/screen-shake.ts`).

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
| Impact Effects | an | Keine Feuer-Atlas-Explosionen samt Rauch, keine Funken-Bursts (Eis, Arcane, Chaos, Poison), keine Blutspritzer. Der Atompilz des Nuklearschlags schrumpft auf Blitz, Feuerball und Druckwelle. |
| Ground Marks | an | Keine Blut-, Eis- und Brand-Decals. Beim Ausschalten werden die liegenden gelöscht, die leeren Pools fallen per `DrawGate` aus der Render-Liste. `VFXService` und `CombatVfxService` sparen die Terrain-Raycasts für ein Decal (einer pro Blut-Decal, bis zu vier pro Eis-Explosion). |
| Bloom | aus | `UnrealBloomPass` aus. Sind Bloom und Color Grading beide aus, zeichnet die Engine ohne Composer. |
| Color Grading | None | LUT-Pass aus. |
| Freeze Tint | an | Kein blauer Tint und keine Frost-Aura auf verlangsamten Gegnern. Der Slow bleibt vermerkt, beim Einschalten kommen Tint und Aura sofort zurück. |
| Blood Moon | an | Kein Look auf Blutmond-Wellen: keine Tönung, kein Glühen, keine Suchscheinwerfer, kein Banner, kein Mond auf NEXT. Ausschalten nimmt den Look sofort weg, Einschalten während einer Blutmond-Welle blendet ihn ein. Siehe [WAVE_SYSTEM.md](WAVE_SYSTEM.md#blutmond-wellen). |

Die Presets `Low`, `Medium` und `High` (`VFX_PRESETS`) setzen die ersten sechs
Schalter; die Einzelschalter bleiben einstellbar, weicht einer ab, steht "Custom"
im Kopf. Freeze Tint, Blood Moon und Screen Shake setzt kein Preset: Tint und
Blutmond kosten wenig und sind Geschmackssache, und wer den Shake wegen Übelkeit aus
hat, bekommt ihn durch einen Klick auf High nicht zurück.

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
  selbst (`CombatVfxService.emitIceExplosion`). Bei `rocket` (auch `homing`-Typen) und
  `cannonball` zusätzlich `markScorch`, siehe [Kampfspuren](#kampfspuren-scorch-decals)
- `enemy:split` → Knochen-Burst (`BURST_PALETTES.bone`) einen Meter über dem Elternteil,
  außer bei der Ooze: deren Trümmer kommen beim Kollaps aus dem ganzen Körper, siehe
  [Tod der Ooze](#tod-der-ooze). Ein blutender Elternteil spritzt zusätzlich in seiner
  Blutfarbe, wo jedes Kind landet
- `vfx:chain-lightning` → ein Blitz pro aufeinanderfolgendem Punktpaar
  (`lightningBolts.spawnBolt` mit `attachLight`, additiver Halo am Blitzende); der
  Bloom-Pass bleibt unberührt
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
| `three-engine/renderers/particle-effects-renderer.ts` | Combat-VFX (Blood, Fire, Explosion mit Rauchstufe, Funken-Bursts, Trails, Muzzle), Decals, `activeEffects`-Lifecycle |
| `three-engine/renderers/environment-effects-renderer.ts` | HQ-Explosion, Fire-Flash, Tower-Inner-Fire |
| `three-engine/renderers/aura-renderer.ts` | Orbitierende Frost-/Poison-Status-Auren |
| `three-engine/renderers/decal-instance.manager.ts` | GPU-instanced Blood/Ice/Scorch-Decals |
| `three-engine/renderers/decal-shaders.ts` | Decal-Shader (Fade, Color-Variation) |
| `three-engine/renderers/scorch-marks.ts` | Kampfspuren: eine pro Route-Zelle, Verstärken bei Wiederholung |
| `three-engine/renderers/instance-slot-allocator.ts` | Slot-Vergabe für instanzierte Pools, hier die Decals |
| `three-engine/renderers/draw-gate.ts` | `DrawGate`: leere Pools raus aus der Render-Liste, der Warm-up zeichnet sie einmal |
| `three-engine/renderers/floating-text/floating-text-instance.manager.ts` | GPU-instanced Floating Damage Numbers |
| `three-engine/renderers/floating-text/floating-text-material.ts` | Custom ShaderMaterial fuer Text-Atlas |
| `three-engine/renderers/floating-text/floating-text-atlas.ts` | Prozedurale Text-Atlas-Generierung |
| `three-engine/renderers/sprite-atlas-generator.ts` | Sprite-Sheet-Atlanten (Explosion 4×4, Smoke 4×4) |
| `three-engine/renderers/mushroom-cloud.renderer.ts` | Atompilz des Nuklearschlags, in Spielzeit |
| `three-engine/renderers/mushroom-cloud-shape.ts`, `-glow.ts`, `-smoke.ts`, `-blast.ts` | Teile des Atompilzes: Form, Glut, Rauch, Ring/Dom/Blitz |
| `three-engine/renderers/ooze/ooze-death-plan.ts` | Tod der Ooze: was der Kollaps wann und wo loslässt (`planOozeDeath`, `oozeMessCounts`) |
| `three-engine/renderers/ooze/ooze-debris.renderer.ts` | Tod der Ooze: prozedurale Trümmer, instanziert je Art, Flug, Aufprall, Liegen, Einsinken |
| `configs/projectile-types.config.ts` | Trail-Partikel Konfiguration (TrailParticleConfig) |
| `configs/visual-effects.config.ts` | Partikel-Limits, Decal-Configs, Explosion-Presets, Farben |
| `game-engine/vfx.service.ts` | VFX Event Handler (Blood, Explosion, Muzzle-Flash, Projectile Impact) |
| `three-engine/vfx-settings.ts` | Spieler-Schalter und Presets Low/Medium/High, siehe [VFX-Einstellungen](#vfx-einstellungen) |
| `game-engine/screen-shake.service.ts` | Screen Shake: Preset je Ereignis, Abfall mit dem Kameraabstand |
| `three-engine/screen-shake.ts` | Hüllkurve (`ScreenShake`) und Projektionsversatz (`offsetProjection`) |
| `three-engine/screen-shake-benchmark.ts` | Messung `__perf.shakeBench` |
| `components/engine-test/engine-test.component.ts` | Engine Test Sandbox |
