# Offene TODOs

> **Philosophie:** Engine first, Game second.
> Erst die Engine stabil, performant und testbar machen - dann Features bauen.

> Siehe auch: [EXPERT_REVIEW_2026.md](src/app/docs/archive/EXPERT_REVIEW_2026.md) | [PERFORMANCE_REPORT.md](src/app/docs/archive/PERFORMANCE_REPORT.md)

---

# PHASE 1: ENGINE FOUNDATION

> **Ziel:** Stabile, testbare, wartbare Basis

## 1.1 Testing-Infrastruktur (Prio 1)

> Ohne Tests keine sichere Weiterentwicklung

- [ ] **Vitest Setup**
      `npm install -D vitest @vitest/ui`
      `vitest.config.ts` erstellen

- [ ] **Unit Tests: GameEventBus**
      Tests: Emit, On, Off, Deferred Queue
      Datei: `game-engine/game-event-bus.spec.ts`
      → Kern der Engine-Kommunikation

- [ ] **Unit Tests: GameObject, Tower, Enemy**
      Tests: ID-Generation, Component-System, Lifecycle
      Dateien: `entities/*.spec.ts`

- [ ] **Performance-Regression-Tests**
      Benchmarks: 100 Enemies @ 60 FPS, <200 Draw Calls
      Verhindert Performance-Regressionen

## 1.2 Architektur-Stabilität (Prio 1)

- [ ] **IGameManager Lifecycle-Interface**
      Formaler Contract: `initialize()`, `update(dt)`, `destroy()`
      Alle Manager implementieren lassen für Konsistenz

- [ ] **Timeout-Tracking in Managern**
      Pattern: `this.timeouts.push(setTimeout(...))` + `clearAll()` in destroy
      Cleanup-Sicherheit, verhindert Memory Leaks

- [ ] **Model Templates korrekt disposen**
      Datei: `three-tower.renderer.ts:1479` - Geometry/Material nicht disposed

## 1.3 Performance Monitoring (Prio 1)

- [ ] **Performance Instrumentation**
      PerformanceMonitorService mit mark/measure, Memory, Long Tasks
      → [Teil 15](src/app/docs/archive/PERFORMANCE_REPORT.md#teil-15-performance-instrumentation--kritisch-fehlt)
      Ohne Monitoring kein gezieltes Optimieren

## 1.4 Config-Konsolidierung

- [ ] **timing.config.ts erstellen** - Animation/Game Timings
      Aktuell: Death-Animation (2000ms), LOS-Recheck (300ms), Spawn-Delays etc.
      Magic Numbers eliminieren

---

# PHASE 2: ENGINE PERFORMANCE

> **Ziel:** 60 FPS auf allen Geräten, schnelle Ladezeiten

## 2.1 Kritische Performance-Optimierungen

- [ ] **Animation LOD System** ⭐ HIGHEST IMPACT - 60-80% FPS Gewinn
      Enemies @ 200m+ mit 6 FPS statt 60 FPS animieren
      Datei: `three-engine/renderers/three-enemy.renderer.ts`
      Logik: `if (distance < 50) mixer.update(dt); else if (distance < 100) updatePosition(); // >100m: Skip`
      → [Teil 3.1](src/app/docs/archive/PERFORMANCE_REPORT.md#31-kritisch-kein-animation-lod-system-)

- [ ] **Tiles Update Throttling** - 5-10% FPS
      `three-tiles-engine.ts:965-969` - Nur Update wenn Kamera >5m bewegt
      → [Teil 1.2](src/app/docs/archive/PERFORMANCE_REPORT.md#12-kritisches-problem-tiles-update-ohne-throttling)

- [ ] **Partikel Free-List** - O(n) → O(1) Pool-Suche
      `three-effects.renderer.ts:1926-1933` - 1000× schneller bei voller Auslastung
      → [Teil 6.1](src/app/docs/archive/PERFORMANCE_REPORT.md#61-linearer-pool-search)

## 2.2 Shader-Optimierungen

- [ ] **Precision Qualifiers in Shadern** - Mobile Artefakte vermeiden
      Alle Fragment Shader: `precision highp float;` am Anfang
      Dateien: `game/tower-defense/shaders/*.ts`, `three-engine/renderers/decal-shaders.ts`
      → [Teil 5.3](src/app/docs/archive/PERFORMANCE_REPORT.md#53-fehlende-precision-qualifiers)

- [ ] **Magic Orb Shader vereinfachen** - 200-300 ALU → 100 ALU
      `magic-orb.shaders.ts` - FBM 4→2 Iterationen, Voronoi 3×3→2×2
      → [Teil 5.1](src/app/docs/archive/PERFORMANCE_REPORT.md#51-magic-orb-shader---zu-komplex)

## 2.3 Rendering-Optimierungen

- [ ] **Bounding Sphere Culling** - Große Enemies korrekt cullen
      `three-enemy.renderer.ts:440` - intersectsSphere statt containsPoint
      → [Teil 3.2](src/app/docs/archive/PERFORMANCE_REPORT.md#32-frustum-culling---gut-aber-verbesserungsfähig)

- [ ] **Tower Frustum Culling** - Unsichtbare Towers nicht animieren
      `three-tower.renderer.ts:659`
      → [Teil 4.4](src/app/docs/archive/PERFORMANCE_REPORT.md#44-draw-call-analyse)

- [ ] **Selection Ring Geometry teilen** - Memory sparen
      `three-tower.renderer.ts:315-322` - Shared Geometry + Material
      → [Teil 4.3](src/app/docs/archive/PERFORMANCE_REPORT.md#43-selection-ring-geometry-nicht-geteilt)

- [ ] **Partikel-Systeme konsolidieren** - 4 → 2 Draw Calls
      `three-effects.renderer.ts` - Additive + Normal zusammenfassen
      → [Teil 6.2](src/app/docs/archive/PERFORMANCE_REPORT.md#62-konsolidierung-der-partikel-systeme)

- [ ] **HQ Explosion Partikel reduzieren** - 1350 → 500 Partikel
      `game-state.manager.ts:990-1103` - Massive Overdraw
      → [Teil 5.2](src/app/docs/archive/PERFORMANCE_REPORT.md#52-overdraw-durch-additive-blending)

## 2.4 Asset-Optimierungen

- [ ] **Draco Model Compression** - 132MB → 30MB Models
      gltf-pipeline mit Draco, DRACOLoader in asset-manager
      → [Teil 10.1](src/app/docs/archive/PERFORMANCE_REPORT.md#101-unkomprimierte-3d-models--kritisch-132mb)

- [ ] **Progressive Asset Loading** - 3-8s → 0.5-1s TTI
      Nur Critical Assets upfront, Rest im Background
      → [Teil 10.4](src/app/docs/archive/PERFORMANCE_REPORT.md#104-fehlende-progressive-loading)

## 2.5 Pathfinding-Optimierungen

- [ ] **A* MinHeap statt Linear Search** - 50-100ms gespart
      `osm-street.service.ts:323-354` - TinyQueue für O(log n)
      → [Teil 9.1](src/app/docs/archive/PERFORMANCE_REPORT.md#91-route-calculation--kritisch-100-500ms)

- [ ] **Sleeping Towers** - Idle Towers nicht updaten
      `tower.manager.ts` - Sleep/Wake System für Towers ohne Target
      → [Teil 2.4](src/app/docs/archive/PERFORMANCE_REPORT.md#24-sleeping-towers--fehlt)

---

# PHASE 3: ENGINE POLISH

> **Ziel:** Mobile-Ready, Accessible, Clean Code

## 3.1 Mobile Support

- [ ] **Mobile-Qualitäts-Presets**
      Low (1.0 pixelRatio, 50% Partikel), Medium, High (Retina)
      Auto-Detect via `navigator.userAgent`

- [ ] **Mobile Breakpoints hinzufügen**
      Breakpoints: 768px (Tablet), 480px (Mobile)
      Dateien: Components mit responsiven Styles

- [ ] **Touch-Targets auf 44px vergrößern**
      Mobile usability (Apple/Google Guidelines)
      Alle Icon-Buttons: `min-width: 44px; min-height: 44px;`

## 3.2 Accessibility

- [ ] **ARIA-Labels zu Icon-Buttons**
      Accessibility (Screen Reader)
      Alle `<button>` mit Icons: `aria-label="Description"`

## 3.3 Code Quality Refactoring

- [ ] **CombatEffectService refactoren**
      Aktuell: ~1000 LOC, 5+ Verantwortlichkeiten
      Extraktion: `StatusEffectService` (Slow, Burn, Poison)
      Impact: SRP, Wartbarkeit

- [ ] **spatial-audio.manager.ts splitten**
      Aktuell: 1015 Zeilen, zu groß
      Module: `PoolManager`, `PannerManager`, `ListenerManager`, `SpatialAudioFacade`

- [ ] **Tower-Distance-Berechnungen zentralisieren**
      Nutze `geoDistanceFast()` aus `geo-utils.ts` statt Duplikation

## 3.4 Error Handling & DevOps

- [ ] **Custom-Error-Klassen**
      Klassen: `GameError`, `AssetLoadError`, `PathfindingError`
      Besseres Error-Handling und Debugging

- [ ] **Pre-Commit-Hooks (Husky + Lint-Staged)**
      Hooks: ESLint, Prettier, Type-Check vor Commit

## 3.5 Integration Tests

- [ ] **Integration-Tests: Manager-Interaktionen**
      Tests: GameState + TowerManager + EnemyManager Zusammenspiel
      Ziel: 50% Coverage

- [ ] **E2E-Tests mit Playwright**
      `npm install -D @playwright/test`
      Flows: Komplette Spielrunde, Tower-Placement, Wave-Progression

---

# PHASE 4: GAME FEATURES

> **Ziel:** Spielbares, poliertes Tower Defense

## 4.1 Visual Polish (Engine-nah)

- [ ] **Bloom Post-Processing** ⭐ HIGHEST VISUAL IMPACT
      +20% wahrgenommene Qualität, -2-3% FPS
      Datei: `three-tiles-engine.ts`
      Library: `three/examples/jsm/postprocessing/UnrealBloomPass`

- [ ] **Screen Shake bei Explosionen** ⭐ HIGH IMPACT
      Explosionen fühlen sich 10× mächtiger an
      Camera-Position Offset mit Decay über 200ms

- [ ] **Muzzle Flash bei Tower-Schüssen**
      5 Partikel + 50ms Point-Light bei jedem Schuss

- [ ] **Freeze-Visual-Effect für Ice-Slow**
      Blaue Partikel-Aura + Emissive-Tint auf Enemy

## 4.2 Game Design & Balance

- [ ] **20-Wellen-Progressions-System implementieren**
      Spiel braucht Ziel und Win-Condition
      Datei: `wave.manager.ts`
      Scaling: Welle 1 (10 Zombies) → Welle 20 (Boss-Gauntlet)

- [x] **Tower-Kosten neu balancieren** ✅ DONE 2026-01-25
      Archer: 20→45, Magic: 150→120, Cannon: 175→140, Ice: 120→90
      Siehe: `src/app/docs/REBALANCING.md`

- [x] **Enemy-Belohnungen dynamisch** ✅ DONE 2026-01-25
      Dynamische Rewards basierend auf HP + Speed (reduziert auf ~1/3)
      Formel: HP/150 + Speed/10, Scale 0.4, Cap 25
      Siehe: `enemy.manager.ts`

- [ ] **Schwierigkeitsgrad-Auswahl hinzufügen**
      Presets: Easy (150% Credits), Normal, Hard (50%), Expert (25%)

## 4.3 Gameplay Features

- [ ] **Rechtsklick bricht Baumodus ab**
      Rechtsklick im Baumodus soll das Bauen abbrechen und den Turm nicht platzieren
      Datei: `tower-placement.service.ts` oder `input-handler.service.ts`

- [ ] **Tower-Targeting-Strategien**
      Modi: Closest, Lowest HP, Strongest, Flying Priority
      UI: Dropdown im Tower-Info-Panel

- [ ] **Range-Upgrade System implementieren**
      Tower-Upgrades die Range erhöhen
      LOS-Zellen müssen bei Upgrade neu berechnet werden

- [ ] **Tower-Synergien implementieren**
      Beispiele: Ice Slow + Cannon = +20% Damage

## 4.4 Onboarding

- [ ] **5-Wellen-Tutorial**
      Onboarding für neue Spieler
      Schritte: Placement → Upgrade → Targeting → Flying → Boss

## 4.5 Event-System Erweiterungen

- [ ] **Pause-System Events** - `game:started`, `game:paused`, `game:resumed`
      Für zukünftiges Pause-Feature

---

# PHASE 5: AI WAVE DIRECTOR

> **Ziel:** Adaptive KI die spannende, faire Wellen generiert
> **Dauer:** ~8 Wochen
> **Plan:** [AI_WAVE_DIRECTOR_PLAN.md](docs/AI_WAVE_DIRECTOR_PLAN.md)

## 5.1 Foundation - Data Collection (Prio 1) ✅

> Daten sammeln ist Voraussetzung für alles weitere. Immer aktiv, auch in Prod.

- [x] **AIDataCollectorService erstellen**
      Passives Event-Listening auf GameEventBus
      Dateien: `src/app/ai/core/ai-data-collector.service.ts`
      Events: tower:placed, enemy:died, wave:completed, health:changed, etc.
      → Sammelt IMMER, auch ohne AI aktiv

- [x] **GameStateSnapshot Interface**
      Datei: `src/app/ai/core/models/game-state-snapshot.ts`
      Inhalt: Player State, Defense-Analyse, Vulnerabilities, History
      74 Features inkl. DPS-Profil (20 Bins Ground + 20 Bins Air)

- [x] **WaveResult Interface**
      Datei: `src/app/ai/core/models/wave-result.ts`
      Inhalt: Config, Outcome (kills, damage, duration), Spannungs-Metriken
      Für Reward-Berechnung

- [x] **Defense-Analyse Utilities**
      Dateien: `src/app/ai/core/defense-analyzer.ts`
      Features: DPS-Berechnung, Path-Coverage, Vulnerability Detection
      → Welche Schwächen hat die Spieler-Defense?

## 5.2 Inference Pipeline (Prio 2) ✅

> AI kann Wellen generieren (erst mit Fallback, später mit Model)

- [x] **GameStateEncoder**
      Datei: `src/app/ai/core/game-state-encoder.ts`
      GameStateSnapshot → Float32Array (74 Features inkl. DPS-Profile)
      Normalisierung auf 0-1, deterministische Encoding

- [x] **WaveDirectorService (Inference)**
      Datei: `src/app/ai/core/wave-director.service.ts`
      TensorFlow.js Model laden (lazy)
      Fallback-Regeln wenn kein Model
      Error Boundary → Graceful Degradation

- [x] **Fallback Wave Generator**
      Datei: `src/app/ai/core/fallback-rules.ts`
      Regelbasierte Wellen ohne Model
      Skaliert mit Wave-Nummer
      Spielbar ohne trainiertes Model!

- [x] **WaveManager Integration**
      Datei: `tower-defense.component.ts` (minimal invasiv)
      Optional Injection von WaveDirectorService
      Signal `useAIDirector` - auto-enabled in DevWorld
      Bestehende Logik bleibt als Fallback

- [x] **Decision Explainer (Debug Mode)**
      Datei: `src/app/ai/core/decision-explainer.ts`
      Erklärt WARUM AI diese Welle gewählt hat
      UI-Overlay in DevMode aktivierbar
      Auch in Prod als Debug-Option

## 5.3 Training Infrastructure (Prio 3) ✅

> Lokales Training auf Dev-Machine

- [x] **Training Backend Setup (Python)**
      Ordner: `training-backend/`
      Dateien: `server.py`, `model.py`, `trainer.py`, `reward.py`
      WebSocket Server auf :3001
      Kein Docker, einfacher Python-Start

- [x] **TrainingClientService (Browser)**
      Datei: `src/app/ai/training/training-client.service.ts`
      WebSocket Verbindung zu Backend
      State/Result Streaming
      Graceful Fallback wenn Backend nicht läuft

- [x] **Tower Bots implementieren**
      Ordner: `src/app/ai/training/bots/`
      BeginnerBot: Platziert zufällig, upgradet nie
      CasualBot: Platziert am Pfad, manchmal Upgrades
      StrategistBot: Plant voraus, nutzt Synergien
      MetaBot: Noch nicht implementiert

- [x] **Reward Function implementieren**
      Datei: `training-backend/reward.py`
      Gaussian Peak bei 55% raw path progress
      Bonus: Near-Miss, Max-Progress, Spread, Variety
      DPS-relative HP (Kill-Time basiert)

- [x] **Wave Archetypen System**
      In `src/app/ai/core/fallback-rules.ts` integriert
      Typen: Swarm, Elite, Rush, Siege, Mixed, Boss, Air
      AI wählt erst Archetyp, dann Details

## 5.4 Training UI (Prio 4) ✅

> Implementiert als Python Web Dashboard statt Angular Components

- [x] **Training Debugger (In-Game)**
      Datei: `src/app/components/debug-window/training-debugger.component.ts`
      Bot-Status, Wave-Info, Connection-Status
      Aktivierbar über Debug-Panel

- [x] **Web Dashboard (Python/FastAPI)**
      Ordner: `training-backend/dashboard/`
      URL: http://localhost:3002
      Live Charts (Reward, Progress, Near-Miss, Distribution)
      Model Metrics, DPS-Profile, Wave Log

- [x] **Bot Selection (Backend-gesteuert)**
      Backend wählt Bot-Typ via WebSocket `select_bot`
      Rotation: Beginner → Casual → Strategist
      Konfiguration in `config.py`

- [x] **Model Export (ONNX)**
      Backend exportiert nach `checkpoints/`
      Format: PyTorch (.pt) + ONNX (.onnx)
      Metadaten in Checkpoint enthalten

- [ ] **Dashboard Header Styling verbessern**
      Status/Header Metriken besser stylen
      Model Metrics (Entropy, Grad Norm, etc.) als eigene Gruppe rechts
      Dezenter als Hauptmetriken, nach "Game Over" Bereich
      Dateien: `training-backend/dashboard/static/index.html`, `style.css`

## 5.5 Build & Deployment (Prio 5)

> Training-Code nicht in Prod Bundle

- [ ] **Build Configuration**
      `angular.json`: fileReplacements für Training-Code
      Production: Training-Module wird zu leerem Stub
      Bundle Size Check: AI < 300KB

- [x] **Start Scripts**
      `training-backend/start.bat` (Windows)
      Startet WebSocket :3001 + Dashboard :3002
      Ein-Befehl-Start

- [ ] **Model Conversion Script**
      PyTorch → TensorFlow.js Format
      Für Browser-Inference ohne Backend
      Kopiert nach `public/assets/ai/`

- [ ] **Model Validation**
      `scripts/validate-model.js`
      Prüft: Format, Größe, Basis-Inference
      Läuft vor Commit (optional)

## 5.6 Training & Tuning (Prio 6) 🔄 IN PROGRESS

> Das eigentliche Training

- [~] **Training Run v3.5** ← AKTUELL
      5267+ Episoden, 40.1% Sweet Spot erreicht
      Reward-Formel auf ~1/3 reduziert
      Tower-Limit: 50, Episode-Length: 100
      Dashboard auf http://localhost:3002

- [ ] **Model Selection**
      Beste Version auswählen
      Gegen alle Bots testen
      Dokumentieren welches Model deployed

- [ ] **Playtesting**
      Interne Tests mit echten Spielern
      Feedback sammeln
      Reward Function anpassen wenn nötig

---

# BACKLOG

> Langfristig, bei Bedarf

## Performance - Advanced

- [ ] **Spatial-Grid für Kollisionserkennung** - O(n²) → O(n log n), ab 500+ Entities
- [ ] **Object-Pooling für Projektile** - Pool-Größe: 500 pro Typ
- [ ] **Tower-Model-LOD-System** - Three.js LOD: High/Medium/Low
- [ ] **BVH für Terrain Raycasts** - 50ms → 0.5ms (weniger kritisch, siehe Hinweis in PERFORMANCE_REPORT)
- [ ] **Web Worker Pathfinding** - 200-600ms → 0ms Main Thread
- [ ] **Tower GPU Instancing** - Schwierig wegen Rotationen

## Visual Effects - Advanced

- [ ] **Sprite-Sheet-Partikel-System** - Texture-Atlas 4×4
- [ ] **Projektil-Trail-Streaks** - Shader mit Fade
- [ ] **Advanced-Explosion-Staging** - 2-Stage Explosionen
- [ ] **Color-Grading-LUT** - Dark-Fantasy Atmosphäre

## Terrain & Routing Experimente

- [ ] **Route Resampling für feinere Terrain-Anpassung** - max 10m Abstand
- [ ] **Verbessertes Height-Smoothing** - Median-Filter, asymmetrische Behandlung

## Tower-Ideen

- [ ] Poison Tower
- [ ] Flame Tower

## Enemy-Ideen

- [ ] **MechaCat** - Roboter-Katze als neuer Gegner-Typ
      Model bereits vorhanden: `public/assets/models/enemies/mechacat_01.glb`

---

# EASY WINS / CLEANUP

> Kleine Aufräumarbeiten, schnell erledigt

## Dead Code entfernen

- [x] **Legacy Bot-Klassen geloescht** ✅ DONE 2026-01-25
      smart-tower-bot.ts, beginner-bot.ts, casual-bot.ts, strategist-bot.ts
      Nur noch StrategyBot mit Strategy-Pattern

- [ ] **Ungenutzte AI Interfaces löschen**
      `ComplexWaveConfig`, `SubWave` in `src/app/ai/core/models/wave-config.ts`
      Exportiert aber nirgends verwendet

- [ ] **DpsProfileVisualizer prüfen** - Unvollständige Integration
      Datei: `src/app/ai/core/dps-profile-visualizer.ts`
      Wird importiert, aber `getMesh()` nie aufgerufen → entweder integrieren oder löschen

## Type Duplikate konsolidieren

- [ ] **GamePhase Type Duplikat** ⚠️
      `wave.manager.ts:7` → `'setup' | 'wave' | 'gameover'`
      `models/game.types.ts:32` → `'setup' | 'wave' | 'paused' | 'gameover' | 'victory'`
      Sollte eine einzige Definition geben

## Ungenutzte Type Exports prüfen

- [ ] `DistanceCalculator` in `models/game.types.ts` - exportiert, nicht importiert
- [ ] `TowerConfig` in `models/game.types.ts` - exportiert, nur intern verwendet
- [ ] `EnemyConfig` in `models/game.types.ts` - exportiert, nur intern verwendet

## TODO-Kommentare im Code auflösen

- [ ] `tower-defense.component.ts:1893` - "TODO: Implement sell execution"
- [ ] `three-tiles-engine.ts:849` - "TODO: Implement smooth animation"
- [ ] `strategy-bot.factory.ts:84` - "TODO: Add advanced strategies"
- [ ] `camera-control.service.ts:342` - "TODO: Implement smooth animation"
- [ ] `vfx.service.ts:30,36` - "TODO: Implement blood/explosion effect"

## Code Quality

- [ ] **console.log Cleanup** - 152 Stellen in 27 Dateien
      Viele Debug-Logs, ggf. durch proper Logging ersetzen oder entfernen

---

# BEKANNTE ISSUES

> Beobachten, bei Reproduktion fixen

- [ ] Mobs laufen z.T. unterirdisch an bestimmten Stellen (Vermutung: Unterbrechung der Route)
- [ ] **3D-Tiles Loading bei F5** - sporadisch "0 Kacheln geladen" nach Reload
      Fix: Retry-Mechanismus + Force-Update, siehe [TILES_LOADING_BUG.md](src/app/docs/TILES_LOADING_BUG.md)
- [ ] Nominatim-Geocoding gibt oft Straßen-Koordinaten statt Gebäude-Koordinaten

---

# ZU BEWERTEN

- [ ] **Konfigurierbares FPS-Limit** (60/30/unlimited)
      Reduziert GPU-Last bei guter Hardware, mehr Budget fuer 3D-Tiles-Streaming
      Stelle: `three-tiles-engine.ts` → `startRenderLoop()`
      ~20 Zeilen Core, optional UI-Setting in localStorage
- [ ] Gatling Dual Fire mit exakten Positionen der Barrels abwechselnd links und rechts
- [ ] **Wave Preview Model: Pinguin** - Kamera-Position und Modell-Größe anpassen
- [ ] **Wave Preview Model: Herbert** - Kamera-Position und Modell-Größe anpassen
