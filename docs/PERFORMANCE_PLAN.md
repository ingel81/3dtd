# Performance Improvement Plan

> Erstellt: 2026-02-12
> Basierend auf 5 parallelen Codebase-Analysen: Rendering, Game Loop, VFX/Partikel, Audio/Memory, Bestandsaufnahme

---

## Bereits erledigt (Kurzfassung)

Street-Rendering Konsolidierung (600 Lines→1 LineSegments), GPU-Instanced Decals (250→2 Draw Calls), Spatial Grid O(1), Tower Sleep/Wake, Animation LOD, Particle Free-Lists, Skybox 48MB→0.6MB, Sound Budget System, Fast Distance Functions, Cached getAlive(), Reusable Vectors in Renderern, Projectile GPU Instancing (1 Draw Call pro Typ), Post-Processing conditional, Magic Orb Shader optimiert, Health-Bar Texture Caching (10%-Bucketing), etc.

Vollständige Liste: [DONE.md](../DONE.md)

---

## TIER 1: HIGH IMPACT (je 10-20% Frame-Time-Einsparung)

### 1.1 Entity Manager — Array.from() in Hot Path eliminieren
- **Problem:** `getAll()` und `getAllActive()` in `entity-manager.ts:50,57` erzeugen **jedes Mal neue Arrays** via `Array.from()`. Wird dutzende Male pro Frame aufgerufen.
- **Fix:** Interne cached Arrays mit Invalidierung, oder direkt Set/Map iterieren
- **Impact:** HIGH — eliminiert tausende Array-Allokationen/sec
- **Aufwand:** ~1h
- **Dateien:** `src/app/managers/entity-manager.ts`

### 1.2 Position-Konvertierung cachen im Enemy Update Loop
- **Problem:** `geoToLocalSimple()` / `geoToLocal()` wird 2-3x pro Enemy pro Frame aufgerufen (`enemy.manager.ts:312-379`). Jeder Call erzeugt ein neues Vector3. Bei 100 Enemies = 12.000-18.000 Allokationen/sec.
- **Fix:** Einmal konvertieren, Ergebnis für Grid-Update, Rendering und Frost-Visual wiederverwenden. Reusable temp Vector3 statt neue Objekte.
- **Impact:** HIGH — 15-20% Einsparung bei 100+ Enemies
- **Aufwand:** ~2h
- **Dateien:** `src/app/managers/enemy.manager.ts`

### 1.3 Particle Buffer needsUpdate nur bei Änderung
- **Problem:** `three-effects.renderer.ts:2380-2383` setzt **immer** `needsUpdate = true` für 4 Attribute × 3 Pools = 12 GPU-Buffer-Uploads pro Frame — auch wenn 0 Partikel aktiv sind.
- **Fix:** Dirty-Flag tracken, nur bei tatsächlicher Partikeländerung uploaden.
- **Impact:** HIGH — 20-30% der Partikel-Update-Zeit eingespart
- **Aufwand:** ~1h
- **Dateien:** `src/app/three-engine/renderers/three-effects.renderer.ts`

### 1.4 Partikel-Pool: Active List statt Full Iteration
- **Problem:** `updateParticleBuffers()` iteriert durch **alle** 7.800 Partikel (3000+4000+800) pro Frame, auch wenn nur ~50 aktiv sind.
- **Fix:** Separate `activeParticles[]` Liste pflegen. Nur aktive Partikel iterieren.
- **Impact:** HIGH — 60-80% weniger Iterations-Overhead
- **Aufwand:** ~2h
- **Dateien:** `src/app/three-engine/renderers/three-effects.renderer.ts`

---

## TIER 2: MEDIUM IMPACT (je 3-10% Einsparung)

### 2.1 Trig-Funktionen im Targeting-Fallback vorberechnen
- **Problem:** `tower-combat.service.ts:162-169` berechnet `Math.cos()` pro Enemy im Filter-Loop.
- **Fix:** Einmal vor dem Loop berechnen, `rangeSq` vorberechnen.
- **Impact:** MEDIUM — 8-12% im Fallback-Pfad
- **Aufwand:** 15min
- **Dateien:** `src/app/services/tower-combat.service.ts`

### 2.2 Distance² statt sqrt() für Range-Checks
- **Problem:** Mehrere Stellen berechnen `Math.sqrt()` für Distanz, vergleichen dann mit Range. `distSq <= rangeSq` reicht.
- **Fix:** `calculateDistanceFast()` → `calculateDistanceSqFast()` Variante anbieten
- **Impact:** MEDIUM — 2-5% in Tower-Targeting
- **Aufwand:** 30min
- **Dateien:** `src/app/entities/tower.entity.ts`, `src/app/utils/geo-utils.ts`

### 2.3 Frost Visual — redundante Checks eliminieren
- **Problem:** `enemy.manager.ts:362-386` prüft und setzt Frost-Visual **jeden Frame**, auch wenn sich nichts geändert hat.
- **Fix:** Vorherigen State cachen, nur bei Änderung setzen.
- **Impact:** MEDIUM — 3-5% bei vielen Enemies
- **Aufwand:** 30min
- **Dateien:** `src/app/managers/enemy.manager.ts`

### 2.4 Floating Text — Canvas-Texture wiederverwenden
- **Problem:** `three-effects.renderer.ts:2004` erstellt pro Damage-Text ein **neues Canvas + CanvasTexture**. Bei 10+ sterbenden Enemies = 10+ Canvas-Operationen/sec.
- **Fix:** Kleinen Pool von Canvas-Elementen vorallokieren und wiederverwenden.
- **Impact:** MEDIUM — 40-60% weniger Floating-Text-CPU
- **Aufwand:** ~1h
- **Dateien:** `src/app/three-engine/renderers/three-effects.renderer.ts`

### 2.5 Audio stop() — In-Place Array-Modifikation
- **Problem:** `spatial-audio-playback.ts:283-291` erstellt bei jedem `stop()` ein neues Array.
- **Fix:** `splice()` in-place statt neues Array.
- **Impact:** MEDIUM — weniger GC-Druck bei vielen Sound-Events
- **Aufwand:** 15min
- **Dateien:** `src/app/managers/audio/spatial-audio-playback.ts`

### 2.6 Buffer Attribute Referenzen cachen
- **Problem:** `three-effects.renderer.ts:2341-2348` sucht pro Frame pro Pool `geometry.attributes['position']` etc. via String-Lookup.
- **Fix:** Referenzen einmalig bei Init speichern.
- **Impact:** LOW-MEDIUM — kleine aber konstante Einsparung
- **Aufwand:** 15min
- **Dateien:** `src/app/three-engine/renderers/three-effects.renderer.ts`

### 2.7 Freeze-Material pro Typ cachen statt pro Enemy clonen
- **Problem:** `three-enemy.renderer.ts:461-535` klont bei `setFreezeVisual(true)` ALLE Materials pro Enemy. Bei häufigem Freeze/Unfreeze entsteht Material-Churn.
- **Fix:** Freeze-Material-Varianten pro Enemy-Typ vorberechnen und wiederverwenden.
- **Impact:** MEDIUM — 1-2ms bei 100 gefrorenen Enemies
- **Aufwand:** ~1h
- **Dateien:** `src/app/three-engine/renderers/three-enemy.renderer.ts`

### 2.8 Tower Animation LOD (wie Enemy LOD)
- **Problem:** Towers haben Frustum-Culling aber kein Distance-LOD für Animationen.
- **Fix:** 2-3 Tier LOD analog zum Enemy-System (full/every 3rd/skip)
- **Impact:** MEDIUM — 2-5ms bei 30+ Towers
- **Aufwand:** 30min
- **Dateien:** `src/app/three-engine/renderers/three-tower.renderer.ts`

---

## TIER 3: LOW IMPACT / POLISH (je <3%)

### 3.1 Early-Exit bei 0 Enemies im Game Loop
- `game-state.manager.ts:326` — Guard Clause vor Enemy-Update
- **Aufwand:** 5min

### 3.2 Trail-Partikel Throttling
- Projectile-Trails spawnen jeden Frame. Jeden 2. Frame reicht visuell.
- **Aufwand:** 15min
- **Dateien:** `src/app/managers/projectile.manager.ts`

### 3.3 Floating Text Free-List statt linearer Suche
- `floatingTexts.find(t => !t.active)` → Free-Stack O(1)
- **Aufwand:** 20min
- **Dateien:** `src/app/three-engine/renderers/three-effects.renderer.ts`

### 3.4 Konfigurierbares FPS-Limit (60/30/unlimited)
- `three-tiles-engine.ts` → `startRenderLoop()` — ~20 Zeilen
- Spart GPU-Budget für 3D-Tiles-Streaming
- **Aufwand:** 30min
- **Dateien:** `src/app/three-engine/three-tiles-engine.ts`

### 3.5 Range-Indicator Material teilen statt pro Tower clonen
- `three-tower.renderer.ts:971` klont Material pro Tower
- **Aufwand:** 10min
- **Dateien:** `src/app/three-engine/renderers/three-tower.renderer.ts`

### 3.6 Audio LRU — indexOf+splice durch Map ersetzen
- `audio-buffer-cache.ts:81-83` — O(n) LRU-Operation
- **Aufwand:** 30min
- **Dateien:** `src/app/managers/audio/audio-buffer-cache.ts`

---

## Geschätzte Gesamtverbesserung

| Szenario | Nur Tier 1 | Tier 1+2 | Alle Tiers |
|----------|------------|----------|------------|
| 50 Enemies, wenig VFX | +15-25% FPS | +25-35% FPS | +30-40% FPS |
| 100 Enemies, volle VFX | +25-35% FPS | +35-50% FPS | +40-55% FPS |
| 200+ Enemies, Explosionen | +30-40% FPS | +45-60% FPS | +50-65% FPS |

---

## Nicht in Scope (bewusst ausgelassen)

- **WebGPU** — Explizit ausgeschlossen
- **Tower GPU Instancing** — Schwierig wegen individueller Turret-Rotationen, separates Projekt
- **Web Worker Offloading** — Pathfinding Worker existiert, weitere Worker sind größeres Refactoring
- **BVH für Terrain Raycasts** — Weniger kritisch da Height-Cache existiert
- **Mobile Quality Presets** — Separates Feature, kein reines Performance-Improvement
