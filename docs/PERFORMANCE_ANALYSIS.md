# Performance Analysis: 500 Enemies Benchmark

**Datum:** 2026-01-30
**Testumgebung:** Real World Map, 500 Enemies pro Typ, keine Towers/Projectiles

## Profiling-Ergebnisse

| Metrik | Tank | Bat | Penguin | Zombie | Herbert | Wallsmasher |
|--------|------|-----|---------|--------|---------|-------------|
| **FPS** | **75** | **44** | **39** | **31** | **30** | **24** |
| Draw Calls | 4079 | 1079 | 1579 | 1079 | 1079 | 1079 |
| Tris/Enemy | 3.0K | 2.8K | 7.0K | 2.4K | 213K | 5.8K |
| Tris Total | 1.5M | 1.4M | 3.5M | 1.2M | 106.6M | 2.9M |
| Scene Nodes/Enemy | ? | 31 | 31 | 62 | 27 | ? |
| Textures | 1167 | 2171 | 616 | 1117 | 2673 | 1668 |
| Update Loop | 0.73ms | 0.97ms | 1.15ms | 0.93ms | 1.10ms | 1.03ms |

## Erkenntnisse

### 1. Update Loop ist NICHT der Flaschenhals

Alle Enemy-Typen liegen bei 0.7-1.2ms fuer die komplette Update-Loop (move + grid + height + render) bei 500 Enemies. Das ist <5% eines 60 FPS Frame-Budgets (16.6ms). Die Performance-Probleme liegen ausschliesslich auf der Rendering-Seite.

**Bugfix waehrend der Analyse:** `hasCurrentSegmentHeights()` in `movement.component.ts` prueftee `height !== 0`, was auf flachem DevWorld-Terrain alle vorberechneten Pfad-Hoehen verwarf. Fix: `!= null` statt `!== 0`. Ausserdem `getHeightAtLocal()` in `dev-terrain.provider.ts` von Raycast auf O(1) Heightmap-Sampling umgestellt. DevWorld height-Phase: 130ms → 0.04ms.

### 2. Skeletal Animation ist der groesste Performance-Faktor

**Tank (keine Animation): 75 FPS** — das ist die Baseline ohne AnimationMixer.

Alle animierten Enemies liegen bei 24-44 FPS. Der AnimationMixer.update() mit Bone-Matrix-Berechnungen fuer jedes SkinnedMesh ist der teuerste Einzelfaktor. Differenz: ~30-50 FPS Verlust durch Skeletal Animation allein.

### 3. Scene Nodes per Enemy skalieren schlecht

Zombie hat 62 Scene Nodes pro Enemy vs. 31 bei Bat — bei fast identischer Triangle-Count (1.2M vs 1.4M) und gleichen Draw Calls (1079). Ergebnis: 31 FPS vs 44 FPS.

500 Zombies = 31.000 Nodes im Szenegraph. Three.js traversiert diese komplett pro Frame (Frustum Culling, Matrix Updates, Render List Sorting). Doppelte Nodes ≈ 13 FPS Verlust.

### 4. Triangle Count wird erst ab ~100K/Enemy zum Problem

Herbert mit 213K Tris/Enemy (106.6M total) erreicht noch 30 FPS — die GPU ist hier Triangle-Bound. Alle anderen Enemies liegen bei 2-7K Tris und haben kein Geometrie-Problem. Herbert braucht Decimation.

### 5. Draw Calls sind kein Flaschenhals

Tank hat 4079 Draw Calls (hoechster Wert) bei 75 FPS. Alle anderen haben ~1079. Moderne GPUs und der Three.js Renderer kommen damit problemlos klar.

### 6. Texture-Anzahl ist kein Flaschenhals

Bat hat 2171 Textures (hoechster Wert der animierten Enemies) bei 44 FPS, waehrend Zombie mit 1117 Textures nur 31 FPS erreicht. Kein Korrelation zwischen Texture-Count und FPS-Verlust.

## Bottleneck-Analyse pro Enemy

| Enemy | FPS | Primaeres Problem | Empfohlene Massnahme |
|-------|-----|-------------------|---------------------|
| **Tank** | 75 | Keins (Referenz-Baseline) | — |
| **Bat** | 44 | Skeletal Animation | Animation LOD (reduced tick rate bei Distanz) |
| **Penguin** | 39 | Alpha Blending + 7K Tris | Opaque-Pass erzwingen, evtl. Tris reduzieren |
| **Zombie** | 31 | 62 Scene Nodes (2x andere) | Mesh-Merge im GLB (weniger Nodes) |
| **Herbert** | 30 | 213K Tris/Enemy | Decimation auf 5-10K Tris |
| **Wallsmasher** | 24 | 5.8K Tris + Animation | Decimation + Animation LOD |

## Optimierungs-Prioritaeten

### Hoher Impact (alle animierten Enemies)
- **Animation LOD:** AnimationMixer nur alle N Frames updaten fuer entfernte Enemies
- **Frustum Culling auf Enemy-Ebene:** Enemies ausserhalb des Sichtfelds komplett skippen (Animation + Render)

### Mittlerer Impact (modell-spezifisch)
- **Herbert:** GLB-Modell mit Decimation auf 5-10K Tris reduzieren
- **Zombie:** Meshes im GLB mergen (62 → ~30 Nodes)
- **Penguin:** `alphaMode: OPAQUE` im GLB oder Material-Override

### Niedriger Impact
- Draw Call Batching / Instancing — nicht noetig bei aktuellen Zahlen
- Texture Atlas — kein messbarer Effekt
