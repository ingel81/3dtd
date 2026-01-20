# 3DTD Maßnahmenkatalog
## Priorisierte Verbesserungen nach Game Dev Team Review

**Review-Datum:** 20.01.2026
**Gesamt-Note aktuell:** B+ (85/100)
**Ziel:** A+ (98/100)

---

## 🔴 TIER 1: KRITISCH (Diese Woche - 10-12h)

**Fokus:** Spielbarkeit & kritische Bugs
**Impact:** B+ → A- (90/100)

### Game Design (6-8h)

- [ ] **20-Wellen-Progressions-System implementieren**
  - Aufwand: 4-6h
  - Impact: Spiel hat endlich Ziel und Win-Condition
  - Datei: `src/app/managers/wave.manager.ts`
  - Template verwenden mit Scaling: Welle 1 (10 Zombies) → Welle 20 (Boss-Gauntlet)

- [ ] **Tower-Kosten ausbalancieren**
  - Aufwand: 1h
  - Impact: Behebt "Nur Archer bauen"-Problem
  - Datei: `src/app/configs/tower-types.config.ts`
  - Änderungen:
    - Archer: 20 → 25 Credits
    - Gatling: 100 → 75 Credits
    - Cannon: 200 → 175 Credits
    - Ice: 80 → 70 Credits

- [ ] **Enemy-Belohnungen fixen**
  - Aufwand: 30min
  - Impact: Boss-Kämpfe werden lohnend
  - Datei: `src/app/configs/enemy-types.config.ts`
  - Änderungen:
    - Herbert (Boss): 8 → 40 Credits
    - Bat (Flying): 3 → 8 Credits

- [ ] **Schwierigkeitsgrad-Auswahl hinzufügen**
  - Aufwand: 2h
  - Impact: Casual & Hardcore Spieler zufrieden
  - Presets: Easy (150% Credits), Normal, Hard (50% Credits), Expert (25% Credits)

### UI/UX (1h)

- [ ] **CSS-Variable `--td-red` Bug fixen**
  - Aufwand: 2min
  - Impact: Behebt kaputte Styles
  - Datei: `src/app/styles/_theme.scss`
  - Fix: `--td-red` → `--td-health-red` überall ersetzen

- [ ] **Mobile Breakpoints hinzufügen**
  - Aufwand: 20min
  - Impact: Basis-Mobile-Support
  - Dateien: `src/app/components/**/*.scss`
  - Breakpoints: 768px (Tablet), 480px (Mobile)

- [ ] **Touch-Targets auf 44px vergrößern**
  - Aufwand: 15min
  - Impact: Mobile usability
  - Alle Icon-Buttons: `min-width: 44px; min-height: 44px;`

- [ ] **ARIA-Labels zu Icon-Buttons**
  - Aufwand: 30min
  - Impact: Accessibility (Screen Reader)
  - Alle `<button>` mit Icons: `aria-label="Beschreibung"`

### Testing (3-4h)

- [ ] **Vitest Setup**
  - Aufwand: 1h
  - Impact: Testing-Infrastruktur
  - `npm install -D vitest @vitest/ui`
  - `vitest.config.ts` erstellen

- [ ] **Unit Tests: GameObject, Tower, Enemy**
  - Aufwand: 4-6h
  - Impact: 30% Coverage Basis
  - Dateien: `src/app/entities/*.spec.ts`
  - Tests: ID-Generation, Component-System, Lifecycle

- [ ] **Unit Tests: GameEventBus**
  - Aufwand: 2h
  - Impact: Event-System Coverage
  - Datei: `src/app/game-engine/game-event-bus.spec.ts`
  - Tests: Emit, On, Off, Deferred Queue

---

## 🟠 TIER 2: HOCH (Dieser Sprint - 20-25h)

**Fokus:** Performance & Polish
**Impact:** A- → A (95/100)

### Performance (5-7h)

- [ ] **Animation-LOD-System** ⭐ HIGHEST IMPACT
  - Aufwand: 1-2h
  - Impact: **+60-80% FPS** mit vielen entfernten Enemies
  - Datei: `src/app/three-engine/renderers/three-enemy.renderer.ts`
  - Logik:
    ```typescript
    const distance = camera.position.distanceTo(mesh.position);
    if (distance < 50) mixer.update(deltaTime); // Animieren
    else if (distance < 100) updatePosition(); // Nur Position
    // >100m: Skip komplett
    ```

- [ ] **Tiles-Updates drosseln**
  - Aufwand: 30min
  - Impact: **+5-8% FPS** Baseline
  - Datei: `src/app/three-engine/three-tiles-engine.ts`
  - Logik: Nur Update wenn Kamera >5m bewegt

- [ ] **Partikel-Free-List implementieren**
  - Aufwand: 1h
  - Impact: **+2-5% FPS** bei VFX
  - Datei: `src/app/three-engine/renderers/three-effects.renderer.ts`
  - Änderung: O(n) find() → O(1) pop() mit Free-List-Stack

- [ ] **Mobile-Qualitäts-Presets**
  - Aufwand: 2-3h
  - Impact: **+20-40% FPS** auf Mobile
  - Presets: Low (1.0 pixelRatio, 50% Partikel), Medium, High (Retina)
  - Auto-Detect via `navigator.userAgent`

### Grafik (5-7h)

- [ ] **Precision-Qualifier zu allen Shadern**
  - Aufwand: 30min
  - Impact: Behebt Mobile-Artefakte
  - Dateien: `src/app/game/tower-defense/shaders/*.ts`, `src/app/three-engine/renderers/decal-shaders.ts`
  - Fix: `precision highp float;` am Anfang aller Fragment-Shader

- [ ] **Magic-Orb-Shader optimieren**
  - Aufwand: 1h
  - Impact: **+2-3% FPS** mit vielen Magic-Projektilen
  - Datei: `src/app/game/tower-defense/shaders/magic-orb.shaders.ts`
  - Änderungen:
    - FBM Iterations: 4 → 2
    - Voronoi Cells: 9 → 4
    - Ergebnis: 200 ALU → 100 ALU (-50%)

- [ ] **HQ-Explosion Partikel reduzieren**
  - Aufwand: 30min
  - Impact: **+1-2% FPS** bei Boss-Explosionen
  - Datei: `src/app/three-engine/renderers/three-effects.renderer.ts`
  - Änderung: 1350 Partikel → 450 Partikel (-67%)

- [ ] **Bloom Post-Processing** ⭐ HIGHEST VISUAL IMPACT
  - Aufwand: 1.5h
  - Impact: **+20% wahrgenommene Qualität**
  - Performance-Cost: -2-3% FPS
  - Datei: `src/app/three-engine/three-tiles-engine.ts`
  - Library: `three/examples/jsm/postprocessing/UnrealBloomPass`

- [ ] **Screen Shake bei Explosionen**
  - Aufwand: 1h
  - Impact: **Massiv** - Explosionen fühlen sich 10× mächtiger an
  - Datei: `src/app/services/vfx.service.ts`
  - Logik: Camera-Position Offset mit Decay über 200ms

- [ ] **Muzzle Flash bei Tower-Schüssen**
  - Aufwand: 1.5h
  - Impact: Visuelles Feedback
  - 5 Partikel + 50ms Point-Light bei jedem Schuss

### Game Design (7-11h)

- [ ] **Tower-Targeting-Strategien**
  - Aufwand: 3-4h
  - Impact: Strategische Tiefe
  - Modi: Closest, Lowest HP, Strongest, Flying Priority
  - UI: Dropdown im Tower-Info-Panel

- [ ] **5-Wellen-Tutorial**
  - Aufwand: 4-6h
  - Impact: Onboarding für neue Spieler
  - Schritte: Placement → Upgrade → Targeting → Flying → Boss
  - Tooltips + Forced Pacing

- [ ] **Tower-Synergien implementieren**
  - Aufwand: 4-6h
  - Impact: Strategische Tiefe
  - Beispiele:
    - Ice Slow + Cannon = +20% Damage
    - Laser + Gatling nearby = +10% Fire Rate
    - Archer Circle = +15% Range

### Architektur (4-6h)

- [ ] **Service-Destroy-Hooks hinzufügen**
  - Aufwand: 2h
  - Impact: Verhindert Memory Leaks
  - Dateien: Alle `src/app/services/*.service.ts`
  - Logik: `ngOnDestroy()` mit Event-Listener-Cleanup

- [ ] **IGameManager Lifecycle-Interface**
  - Aufwand: 3h
  - Impact: Konsistenz, formaler Contract
  - Interface: `initialize()`, `update(dt)`, `destroy()`
  - Alle Manager implementieren lassen

- [ ] **Timeout-Tracking in Managern**
  - Aufwand: 2h
  - Impact: Cleanup-Sicherheit
  - Pattern: `this.timeouts.push(setTimeout(...))` + `clearAll()` in destroy

---

## 🟡 TIER 3: OPTIMIERUNG (Nächstes Quartal - 40-50h)

**Fokus:** Exzellenz & Skalierbarkeit
**Impact:** A → A+ (98/100)

### Testing (20-30h)

- [ ] **Integration-Tests: Manager-Interaktionen**
  - Aufwand: 12-16h
  - Impact: 50% Coverage
  - Tests: GameState + TowerManager + EnemyManager Zusammenspiel

- [ ] **E2E-Tests mit Playwright**
  - Aufwand: 16-20h
  - Impact: 70% Coverage + Regression-Sicherheit
  - Flows: Komplette Spielrunde, Tower-Placement, Wave-Progression

- [ ] **Performance-Regression-Tests**
  - Aufwand: 4-6h
  - Impact: FPS-Garantien
  - Benchmarks: 100 Enemies @ 60 FPS, <200 Draw Calls

### Performance - Advanced (15-20h)

- [ ] **Spatial-Grid für Kollisionserkennung**
  - Aufwand: 8h
  - Impact: O(n²) → O(n log n)
  - Für 500+ Entities notwendig

- [ ] **Object-Pooling für Projektile**
  - Aufwand: 8h
  - Impact: Reduziert GC-Pressure
  - Pool-Größe: 500 pro Projektil-Typ

- [ ] **Tower-Model-LOD-System**
  - Aufwand: 4h
  - Impact: +5-10% mit vielen Towers
  - Three.js LOD: High (<30m), Medium (30-60m), Low (>60m)

- [ ] **Frustum-Culling verbessern**
  - Aufwand: 3h
  - Impact: +1-2%
  - `containsPoint()` → `intersectsSphere()`

### Grafik - Advanced (10-15h)

- [ ] **Sprite-Sheet-Partikel-System**
  - Aufwand: 6-8h
  - Impact: Vielfalt ohne Performance-Cost
  - Texture-Atlas: 4×4 Particle-Varianten

- [ ] **Freeze-Visual-Effect für Ice-Slow**
  - Aufwand: 2h
  - Impact: Gameplay-Clarity
  - Blaue Partikel-Aura + Emissive-Tint auf Enemy

- [ ] **Projektil-Trail-Streaks**
  - Aufwand: 2h
  - Impact: Tracking-Verbesserung
  - Shader mit Fade entlang Trail-Länge

- [ ] **Advanced-Explosion-Staging**
  - Aufwand: 3h
  - Impact: Realistischere Explosionen
  - 2-Stage: Initial Flash (50 Partikel, weiß) + Main Burst (150, orange-rot)

- [ ] **Color-Grading-LUT**
  - Aufwand: 2-3h
  - Impact: +10-15% visuelle Identität
  - Dark-Fantasy-LUT für atmosphärische Stimmung

### Code Quality (10-15h)

- [ ] **CombatEffectService refactoren**
  - Aufwand: 6h
  - Impact: SRP, Wartbarkeit
  - Extraktion: `StatusEffectService` (Slow, Burn, Poison)
  - Aktuell: ~1000 LOC, 5+ Verantwortlichkeiten

- [ ] **spatial-audio.manager.ts splitten**
  - Aufwand: 6h
  - Impact: Übersicht (aktuell 1015 Zeilen)
  - Module: `PoolManager`, `PannerManager`, `ListenerManager`, `SpatialAudioFacade`

- [ ] **Tower-Distance-Berechnungen zentralisieren**
  - Aufwand: 1h
  - Impact: DRY
  - Nutze `geoDistanceFast()` aus `geo-utils.ts` statt Duplikation

- [ ] **Custom-Error-Klassen**
  - Aufwand: 2h
  - Impact: Error-Handling
  - Klassen: `GameError`, `AssetLoadError`, `PathfindingError`

- [ ] **Pre-Commit-Hooks (Husky + Lint-Staged)**
  - Aufwand: 1h
  - Impact: Code-Quality-Gate
  - Hooks: ESLint, Prettier, Type-Check vor Commit

---

## 📊 Impact-Übersicht

### Performance-Gewinne (kumulativ)

| Maßnahme | FPS-Gewinn | Aufwand |
|----------|------------|---------|
| Animation-LOD | +60-80% | 1-2h |
| Tiles-Throttling | +5-8% | 30min |
| Partikel-Free-List | +2-5% | 1h |
| Magic-Orb-Optimierung | +2-3% | 1h |
| Mobile-Presets | +20-40% (Mobile) | 2-3h |
| **GESAMT** | **+70-90%** | **6-8h** |

### Visuelle Qualität

| Maßnahme | Qualitäts-Gewinn | Aufwand |
|----------|------------------|---------|
| Bloom Post-Processing | +20% | 1.5h |
| Screen Shake | Massiv (10× Impact) | 1h |
| Precision-Qualifier | Mobile-Fix | 30min |
| **GESAMT** | **+25-30%** | **3h** |

### Game Balance

| Maßnahme | Impact | Aufwand |
|----------|--------|---------|
| 20-Wellen-Progression | Win-Condition! | 4-6h |
| Tower-Rebalancing | Strategie-Vielfalt | 1h |
| Enemy-Rewards-Fix | Boss-Kämpfe lohnend | 30min |
| **GESAMT** | **Spielbar → Spaßig** | **6-7h** |

---

## 🎯 Empfohlene Reihenfolge

### Woche 1 (10-12h) - Tier 1
1. CSS-Bug fixen (2min)
2. Tower-Kosten ausbalancieren (1h)
3. Enemy-Belohnungen fixen (30min)
4. 20-Wellen-Progression (4-6h)
5. Mobile-Breakpoints (20min)
6. ARIA-Labels (30min)
7. Vitest-Setup (1h)
8. GameEventBus Tests (2h)

**Ergebnis:** B+ → A- (Spiel ist spielbar und balanced)

### Woche 2-3 (20-25h) - Tier 2
1. Animation-LOD (1-2h) ⭐
2. Precision-Qualifier (30min)
3. Bloom (1.5h) ⭐
4. Screen Shake (1h) ⭐
5. Tiles-Throttling (30min)
6. Partikel-Free-List (1h)
7. Magic-Orb-Optimierung (1h)
8. Targeting-Strategien (3-4h)
9. Tutorial (4-6h)
10. Service-Destroy-Hooks (2h)

**Ergebnis:** A- → A (Performance & Visuals exzellent)

### Quartal 1 (40-50h) - Tier 3
Fokus: Testing-Coverage 70%, Advanced-Optimierungen, Code-Refactoring

**Ergebnis:** A → A+ (Production-Ready, Industry-Reference)

---

## 📝 Notizen

### Was NICHT tun
- ❌ Keine neuen Features vor Tier 1+2
- ❌ Kein Refactoring ohne Tests
- ❌ Keine Shader-Experimente vor Precision-Fix
- ❌ Kein Spatial-Grid vor 200+ Entities

### Quick-Wins für Demo/Pitch
1. CSS-Bug (2min)
2. Bloom (1.5h)
3. Screen Shake (1h)
4. Tower-Balance (1h)
→ **3.5h für massiven Qualitäts-Sprung**

### Dependencies
- Bloom benötigt: `npm install three@0.182` (bereits vorhanden)
- Vitest benötigt: `npm install -D vitest @vitest/ui`
- Playwright benötigt: `npm install -D @playwright/test`

---

**Gesamt-Aufwand:**
- Tier 1: 10-12h → Note A-
- Tier 2: 20-25h → Note A
- Tier 3: 40-50h → Note A+

**Aktueller Code ist B+. Mit Tier 1+2 (30-35h) erreicht er A-Qualität.**
