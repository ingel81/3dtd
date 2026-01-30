# Offene TODOs

> **Philosophie:** Engine first, Game second.
> Erst die Engine stabil, performant und testbar machen - dann Features bauen.

> Siehe auch: [EXPERT_REVIEW_2026.md](docs/archive/EXPERT_REVIEW_2026.md) | [PERFORMANCE_REPORT.md](docs/archive/PERFORMANCE_REPORT.md)

---

# PHASE 1: ENGINE FOUNDATION

> **Ziel:** Stabile, testbare, wartbare Basis

## 1.1 Performance Monitoring (Prio 1)

- [x] **Performance Instrumentation** ✅ `febf3bb`
      Subsystem-Timings (Tower/Projectile/Combat/Events), Frame-Budget-Tracking, Bottleneck-Erkennung

---

# PHASE 2: ENGINE PERFORMANCE

> **Ziel:** 60 FPS auf allen Geräten, schnelle Ladezeiten

## 2.1 Kritische Performance-Optimierungen

- [x] **TowerCombatService Fallback-Path optimieren** ✅ `78031de`
      Nutzt jetzt `getEnemiesInRadius()` direkt statt brute-force

- [x] **Animation LOD System** ⭐ ✅ `397d6f8`
      Distance-LOD: <50m=jeder Frame, 50-100m=jeder 3., 100-200m=jeder 6., >200m=skip
      Staggered per Enemy, DeltaTime-Kompensation

- [x] **Tiles Update Throttling** ✅ (bereits auf Branch)
      Nur Update wenn Kamera >5m bewegt

- [x] **Partikel Free-List** ✅
      O(1) Spawning per Free-Stack pro Pool, Fallback auf Round-Robin

## 2.2 Shader-Optimierungen

- [x] **Precision Qualifiers in Shadern** ✅
      `precision highp float;` in 8 Fragment-Shadern ergänzt

- [x] **Magic Orb Shader vereinfachen** ✅ `44bdacd`
      FBM 4→1, Voronoi 3×3→2×2, ~60-80 ALU (von 200-300)

## 2.3 Rendering-Optimierungen

- [x] **Bounding Sphere Culling** ✅ `44bdacd`
      `intersectsSphere` statt `containsPoint` in Tower-Renderer

- [x] **Tower Frustum Culling** ✅ `2a47f45`

- [x] **Selection Ring Geometry teilen** ✅ `4e89cc3`
      Static shared Geometry + Material mit Ref-Counting

- [x] **Partikel-Systeme konsolidieren** - 4 → 2 Draw Calls ✅ `fd5d524`
      `three-effects.renderer.ts` - Blood+Fire Pools entfernt, in Trail-Pools integriert

- [x] **HQ Explosion Partikel reduzieren** ✅ `2a47f45`
      1350 → 500 Partikel, größere Sizes als Kompensation

## 2.4 Collision & Spatial Queries

- [x] **Spatial-Grid für Kollisionserkennung** ⭐ ✅
      Uniform Grid, O(1) Insert/Remove, O(k) Radius-Queries
      Integriert in TowerCombatService (Sleep-Check, Targeting)

## 2.5 Pathfinding-Optimierungen

- [x] **A* MinHeap** ✅ (bereits auf Branch)
      MinHeap Binary Heap in OsmStreetService + Pathfinding Worker

- [x] **Sleeping Towers** ✅ `7f3e3e2`
      Sleep nach 2s ohne Target, Wake via SpatialGrid hasEnemyInRadius

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

- [x] **CombatEffectService refactoren** ✅ `a8bd3ce`
      Aufgeteilt in: StatusEffectService, CombatVfxService, DamageApplicationService + Facade

- [x] **spatial-audio.manager.ts splitten** ✅ `b521837`
      4 Module: AudioBufferCache, AudioPoolManager, SpatialAudioPlayback, SpatialAudioManager

- [x] **Tower-Distance-Berechnungen zentralisieren** ✅ `a8bd3ce`
      Nutzt jetzt `geoDistanceFast()` aus `geo-utils.ts`

## 3.4 Error Handling

- [x] **Custom-Error-Klassen** ✅ `a8bd3ce`
      `GameError`, `AssetLoadError`, `PathfindingError`, `GameStateError` in `src/app/models/errors.ts`

## 3.5 Integration Tests

- [x] **Integration-Tests: Manager-Interaktionen** ✅ `b140a8a`
      46 Tests in 5 Suites (Combat, Waves, Movement, Effects, Lifecycle)

---

# PHASE 4: GAME FEATURES

> **Ziel:** Spielbares, poliertes Tower Defense

## 4.1 Visual Polish (Engine-nah)

- [x] **Bloom Post-Processing** ⭐ ✅ `7f05a6c`
      UnrealBloomPass, default OFF, togglebar

- [x] **Screen Shake bei Explosionen** ⭐ ✅
      XZ-Shake mit Intensity-Presets (Bullet→Cannon→Rocket→HQ→Boss), togglebar

- [x] **Muzzle Flash bei Tower-Schüssen** ✅
      3-5 Additive Partikel + PointLight bei Projectile-Towers

- [x] **Freeze-Visual-Effect für Ice-Slow** ✅
      Blaue Emissive-Tint + 3 orbitierende Frost-Partikel

- [x] **Sprite-Sheet-Partikel-System** ✅
      4×4 Atlas prozedural generiert, animierte Explosionen

- [x] **Projektil-Trail-Streaks** ✅ `d6b1a17`
      Ribbon-Renderer mit 6 Styles, 60 Instanzen/Typ, Alpha-Fade

- [x] **Color-Grading-LUT** ✅ `b6fac01`
      Dark Fantasy, Noir, Warm Sunset Presets, localStorage-Persistenz

## 4.2 Gameplay Features

- [x] **Spielgeschwindigkeit-Auswahl (Timescale)** ✅ `3dc21fc`
      UI ↔ GameStateManager bidirektional synchronisiert

- [x] **Rechtsklick bricht Baumodus ab** ✅
      contextmenu-Handler cancelt Placement + preventDefault

- [x] **Tower-Targeting-Strategien** ✅
      Implementiert: closest, lowest-hp, highest-hp, first, air-priority
      Defaults pro Tower-Typ konfiguriert

- [ ] **Range-Upgrade System implementieren**
      Tower-Upgrades die Range erhöhen
      ⚠️ LOS-Zellen müssen bei Range-Upgrade neu berechnet werden!

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

- [ ] **Object-Pooling für Projektile** - Pool-Größe: 500 pro Typ
      ⚠️ GPU-Instancing existiert bereits — Entity-Pooling (JS-Objekte) nochmal prüfen ob GC-Druck messbar ist
- [ ] **Tower-Model-LOD-System** - Three.js LOD: High/Medium/Low
- [ ] **BVH für Terrain Raycasts** - 50ms → 0.5ms (weniger kritisch, siehe Hinweis in PERFORMANCE_REPORT)
- [ ] **Web Worker Offloading** - Pathfinding + weitere rechenintensive Logik
      Pathfinding: 200-600ms → 0ms Main Thread
      Auch prüfen: Collision-Checks, Wave-Director-Inference, Audio-Decoding
- [ ] **Tower GPU Instancing** - Schwierig wegen Rotationen

## Gameplay - Backlog

- [ ] **Tower-Synergien** - Ice+Cannon = +20% Damage, etc.

## Visual Effects - Advanced

- [ ] **Advanced-Explosion-Staging** - 2-Stage Explosionen

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
