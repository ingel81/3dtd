# Offene TODOs

> **Philosophie:** Engine first, Game second.
> Erst die Engine stabil, performant und testbar machen - dann Features bauen.

> Siehe auch: [EXPERT_REVIEW_2026.md](docs/archive/EXPERT_REVIEW_2026.md) | [PERFORMANCE_REPORT.md](docs/archive/PERFORMANCE_REPORT.md)

---

# PHASE 1: ENGINE FOUNDATION

> **Ziel:** Stabile, testbare, wartbare Basis

## 1.1 EventBus-Entkopplung (Langfristig)

- [ ] **GameStateManager God-Object reduzieren**
      Importiert direkt: Tower/Enemy/Projectile/Wave Manager + 5 Services
      Schrittweise über Event-Koordination entkoppeln

> ⚠️ **NICHT anfassen:** Audio/Sound Events (bekannte Themen, separat behandeln)

## 1.2 Performance Monitoring (Prio 1)

- [ ] **Performance Instrumentation**
      PerformanceMonitorService mit mark/measure, Memory, Long Tasks
      → [Teil 15](docs/archive/PERFORMANCE_REPORT.md#teil-15-performance-instrumentation--kritisch-fehlt)
      Ohne Monitoring kein gezieltes Optimieren

---

# PHASE 2: ENGINE PERFORMANCE

> **Ziel:** 60 FPS auf allen Geräten, schnelle Ladezeiten

## 2.1 Kritische Performance-Optimierungen

- [ ] **TowerCombatService Fallback-Path optimieren**
      `tower-combat.service.ts:59-121` - O(towers × enemies × losCheck)
      Problem: Ground towers ohne visibleCells = 5000 LOS-Checks/Frame
      Lösung: `globalRouteGrid.getEnemiesInRadius()` auch im Fallback nutzen

- [ ] **Animation LOD System** ⭐ HIGHEST IMPACT - 60-80% FPS Gewinn
      Enemies @ 200m+ mit 6 FPS statt 60 FPS animieren
      Datei: `three-engine/renderers/three-enemy.renderer.ts`
      Logik: `if (distance < 50) mixer.update(dt); else if (distance < 100) updatePosition(); // >100m: Skip`
      → [Teil 3.1](docs/archive/PERFORMANCE_REPORT.md#31-kritisch-kein-animation-lod-system-)

- [ ] **Tiles Update Throttling** - 5-10% FPS
      `three-tiles-engine.ts:965-969` - Nur Update wenn Kamera >5m bewegt
      → [Teil 1.2](docs/archive/PERFORMANCE_REPORT.md#12-kritisches-problem-tiles-update-ohne-throttling)

- [ ] **Partikel Free-List** - O(n) → O(1) Pool-Suche
      `three-effects.renderer.ts:1926-1933` - 1000× schneller bei voller Auslastung
      → [Teil 6.1](docs/archive/PERFORMANCE_REPORT.md#61-linearer-pool-search)

## 2.2 Shader-Optimierungen

- [ ] **Precision Qualifiers in Shadern** - Mobile Artefakte vermeiden
      Alle Fragment Shader: `precision highp float;` am Anfang
      Dateien: `game/tower-defense/shaders/*.ts`, `three-engine/renderers/decal-shaders.ts`
      → [Teil 5.3](docs/archive/PERFORMANCE_REPORT.md#53-fehlende-precision-qualifiers)

- [ ] **Magic Orb Shader vereinfachen** - 200-300 ALU → 100 ALU
      `magic-orb.shaders.ts` - FBM 4→2 Iterationen, Voronoi 3×3→2×2
      → [Teil 5.1](docs/archive/PERFORMANCE_REPORT.md#51-magic-orb-shader---zu-komplex)

## 2.3 Rendering-Optimierungen

- [ ] **Bounding Sphere Culling** - Große Enemies korrekt cullen
      `three-enemy.renderer.ts:440` - intersectsSphere statt containsPoint
      → [Teil 3.2](docs/archive/PERFORMANCE_REPORT.md#32-frustum-culling---gut-aber-verbesserungsfähig)

- [ ] **Tower Frustum Culling** - Unsichtbare Towers nicht animieren
      `three-tower.renderer.ts:659`
      → [Teil 4.4](docs/archive/PERFORMANCE_REPORT.md#44-draw-call-analyse)

- [ ] **Selection Ring Geometry teilen** - Memory sparen
      `three-tower.renderer.ts:315-322` - Shared Geometry + Material
      → [Teil 4.3](docs/archive/PERFORMANCE_REPORT.md#43-selection-ring-geometry-nicht-geteilt)

- [ ] **Partikel-Systeme konsolidieren** - 4 → 2 Draw Calls
      `three-effects.renderer.ts` - Additive + Normal zusammenfassen
      → [Teil 6.2](docs/archive/PERFORMANCE_REPORT.md#62-konsolidierung-der-partikel-systeme)

- [ ] **HQ Explosion Partikel reduzieren** - 1350 → 500 Partikel
      `game-state.manager.ts:990-1103` - Massive Overdraw
      → [Teil 5.2](docs/archive/PERFORMANCE_REPORT.md#52-overdraw-durch-additive-blending)

## 2.4 Asset-Optimierungen

- [ ] **Draco Model Compression** - 132MB → 30MB Models
      gltf-pipeline mit Draco, DRACOLoader in asset-manager
      → [Teil 10.1](docs/archive/PERFORMANCE_REPORT.md#101-unkomprimierte-3d-models--kritisch-132mb)

- [ ] **Progressive Asset Loading** - 3-8s → 0.5-1s TTI
      Nur Critical Assets upfront, Rest im Background
      → [Teil 10.4](docs/archive/PERFORMANCE_REPORT.md#104-fehlende-progressive-loading)

## 2.5 Pathfinding-Optimierungen

- [ ] **A* MinHeap statt Linear Search** - 50-100ms gespart
      `osm-street.service.ts:323-354` - TinyQueue für O(log n)
      → [Teil 9.1](docs/archive/PERFORMANCE_REPORT.md#91-route-calculation--kritisch-100-500ms)

- [ ] **Sleeping Towers** - Idle Towers nicht updaten
      `tower.manager.ts` - Sleep/Wake System für Towers ohne Target
      → [Teil 2.4](docs/archive/PERFORMANCE_REPORT.md#24-sleeping-towers--fehlt)

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

- [ ] **Schwierigkeitsgrad-Auswahl hinzufügen**
      Presets: Easy (150% Credits), Normal, Hard (50%), Expert (25%)

## 4.3 Gameplay Features

- [ ] **Spielgeschwindigkeit-Auswahl (Timescale)**
      UI: Prominente Buttons/Toggle im Spiel (3 Stufen)
      Stufen: Normal (1x), Mittel (2x), Schnell (4x)
      Analog zu AI-Training-Panel timescale
      Beeinflusst: `trainingTimescale` Signal in GameStateManager

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

---

# PHASE 5: AI WAVE DIRECTOR

> **Ziel:** Adaptive KI die spannende, faire Wellen generiert
> **Dauer:** ~8 Wochen
> **Plan:** [AI_WAVE_DIRECTOR_PLAN.md](docs/AI_WAVE_DIRECTOR_PLAN.md)

## 5.1 Training UI (Offen)

- [ ] **Dashboard Header Styling verbessern**
      Status/Header Metriken besser stylen
      Model Metrics (Entropy, Grad Norm, etc.) als eigene Gruppe rechts
      Dezenter als Hauptmetriken, nach "Game Over" Bereich
      Dateien: `training-backend/dashboard/static/index.html`, `style.css`

## 5.2 Build & Deployment

> Training-Code nicht in Prod Bundle

- [ ] **Build Configuration**
      `angular.json`: fileReplacements für Training-Code
      Production: Training-Module wird zu leerem Stub
      Bundle Size Check: AI < 300KB

- [ ] **Model Conversion Script**
      PyTorch → TensorFlow.js Format
      Für Browser-Inference ohne Backend
      Kopiert nach `public/assets/ai/`

- [ ] **Model Validation**
      `scripts/validate-model.js`
      Prüft: Format, Größe, Basis-Inference
      Läuft vor Commit (optional)

## 5.3 Training & Tuning 🔄 IN PROGRESS

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

## 5.4 Training Feintuning

> Erkenntnisse aus Testspielen gegen exportiertes ONNX-Model

- [ ] **HP-Skalierung erweitern**
      `HEALTH_MULTIPLIER_MAX`: 20 → 100
      Problem: Im Endgame kann AI HP nicht mehr skalieren (Cap erreicht)
      Dateien: `config.py`, `wave-director.service.ts`

- [ ] **Bot Tower-Limit entfernen**
      `strategist.maxTowers`: 50 → 0 (unlimited)
      Problem: Training sieht nie Endgame-DPS-Levels
      Datei: `tower-bot.interface.ts`

- [ ] **Kill-Time Range erweitern**
      `KILL_TIME_MAX`: 5.0 → 8.0
      Mehr Spielraum für HP-Skalierung bei hoher DPS
      Datei: `config.py`

- [ ] **Wave-Schedule System implementieren**
      Feste Typen für bestimmte Waves (z.B. Wave 7, 14, 21 = Air)
      AI bestimmt nur Parameter (HP, Count, Delay), nicht Typ
      Spieler kann sich auf Air/Boss-Waves vorbereiten
      Frontend: `wave-director.service.ts`
      Backend: `server.py` (forced_type im State)

- [ ] **Enemy Properties System** (SPÄTER - wenn neue Gegner kommen)
      Statt Typ-Encoding: Property-basiertes Encoding
      Properties: `isAir`, `isTanky`, `isSwarm`, `isBoss`
      Vorteil: Neue Gegner funktionieren ohne Neutraining
      Voraussetzung: Properties in `EnemyTypeConfig` definieren
      ```typescript
      // Neue Felder in enemy-types.ts:
      isTanky?: boolean;   // Viel HP, langsam (tank, wallsmasher)
      isSwarm?: boolean;   // Wenig HP, viele (penguin)
      isBoss?: boolean;    // Boss-Einheit (herbert)
      // isAirUnit existiert bereits
      ```
      State-Vektor: +6 Features (5 Properties + force_active)
      Model lernt Konzepte statt spezifische Typen

---

# PHASE 6: DAMAGE & ARMOR SYSTEM

> **Ziel:** Strategische Tiefe durch Schadens-/Rüstungstypen
> **Konzept:** [DAMAGE_ARMOR_SYSTEM.md](docs/DAMAGE_ARMOR_SYSTEM.md)
> **Reihenfolge:** Erst Tower-Schadenstypen, dann Enemy-Rüstungen

## 6.1 Infrastruktur

- [ ] **DamageType und ArmorType Types definieren**
      Types: `physical`, `pierce`, `siege`, `magic`, `fire`, `ice`, `chaos`
      Armor: `unarmored`, `light`, `medium`, `heavy`, `fortified`, `ethereal`

- [ ] **Schadensmatrix implementieren**
      `calculateDamage(base, damageType, armorType)` in CombatEffectService
      Erstmal alle Multiplikatoren = 1.0 (neutral)

## 6.2 Tower-Schadenstypen

- [ ] **damageType zu Tower-Configs hinzufügen**
      Archer/Gatling: `physical`, Sniper: `pierce`, Cannon/Rocket: `siege`
      Magic: `magic`, Ice: `ice`

- [ ] **Neue Tower mit neuen Schadenstypen**
      Flame Tower (`fire`), Tesla Tower (`magic`), Chaos Tower (`chaos`)

- [ ] **UI: Schadenstyp im Tower-Panel anzeigen**
      Icon + Label: "⚔️ Physical Damage"

## 6.3 Enemy-Rüstungstypen

- [ ] **armorType zu Enemy-Configs hinzufügen**
      Zombie: `light`, Bat/Penguin: `unarmored`, Tank: `heavy`
      Wallsmasher: `medium`, Herbert: `fortified`

- [ ] **Schadensmatrix aktivieren**
      Multiplikatoren gemäß Konzept-Doc

- [ ] **Neue Enemies mit speziellen Rüstungen**
      Ghost (`ethereal`), Golem (`fortified`), Dragon (`heavy` + Air)

- [ ] **UI: Rüstungstyp im Wave-Preview anzeigen**
      "🛡️ Heavy Armor - Weak to Siege"

## 6.4 AI-Training Anpassung

- [ ] **State-Vektor erweitern: dpsByDamageType**
      Aufschlüsselung der DPS nach Schadenstyp

- [ ] **Enemy-Properties für Rüstung**
      AI lernt: "Nur Physical-Tower → Heavy Enemies effektiv"

---

# BACKLOG

> Langfristig, bei Bedarf

## Training Backend Refactoring

- [ ] **training-backend Struktur verbessern**
      Aktuell alles flach, besser in Module aufteilen:
      - `core/` - model.py, trainer.py, reward.py
      - `utils/` - logger (tui_logger + auto_logger mergen)
      - `scripts/` - export, analyze (bereits teilweise)
      Import-Pfade in server.py anpassen

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

> Siehe auch: [DAMAGE_ARMOR_SYSTEM.md](docs/DAMAGE_ARMOR_SYSTEM.md)

- [ ] Poison Tower (`magic`)
- [ ] Flame Tower (`fire`)
- [ ] Tesla Tower (`magic`) - Kettenblitz
- [ ] Chaos Tower (`chaos`) - Teuer, voller Schaden vs alle

## Enemy-Ideen

> Siehe auch: [DAMAGE_ARMOR_SYSTEM.md](docs/DAMAGE_ARMOR_SYSTEM.md)

- [ ] **MechaCat** - Roboter-Katze als neuer Gegner-Typ
- [ ] **Ghost** - `ethereal` Rüstung, nur Magic/Chaos wirkt
- [ ] **Skeleton** - `unarmored`, Swarm
- [ ] **Golem** - `fortified`, Boss
- [ ] **Spider** - `light`, schnell, immun gegen Slow
- [ ] **Dragon** - `heavy` + Air, fliegender Boss
      Model bereits vorhanden: `public/assets/models/enemies/mechacat_01.glb`

---

# EASY WINS / CLEANUP

> Kleine Aufräumarbeiten, schnell erledigt

## TODO-Kommentare im Code (Feature-Requests)

- [ ] `tower-defense.component.ts:1919` - Sell execution (Bot-Action)
- [ ] `three-tiles-engine.ts:849` - Smooth camera animation (flyTo)
- [ ] `strategy-bot.factory.ts:84` - Advanced Bot strategies
- [ ] `camera-control.service.ts:342` - Smooth camera animation
- [ ] `game-engine/vfx.service.ts:30,36` - Blood/Explosion effects

## Code Quality

- [ ] **console.log Cleanup** - 152 Stellen in 27 Dateien
      Viele Debug-Logs, ggf. durch proper Logging ersetzen oder entfernen

---

# BEKANNTE ISSUES

> Beobachten, bei Reproduktion fixen

- [ ] Mobs laufen z.T. unterirdisch an bestimmten Stellen (Vermutung: Unterbrechung der Route)
- [ ] **3D-Tiles Loading bei F5** - sporadisch "0 Kacheln geladen" nach Reload
      Fix: Retry-Mechanismus + Force-Update, siehe [TILES_LOADING_BUG.md](docs/TILES_LOADING_BUG.md)
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
