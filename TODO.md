# Offene TODOs

> **Philosophie:** Engine first, Game second.
> Erst die Engine stabil, performant und testbar machen - dann Features bauen.


** NEU **

- Attributions: Skybox (day.webp, night.webp) Quelle ermitteln und eintragen
- Attributions: stone-wall.jpg Quelle ermitteln und eintragen
- Attributions: Sound Effects Quellen ergänzen (alle außer Tentacle Slime)

- **LOS-Overlay: Ground vs Air visuell trennen**
      Seit `1f156a4` nutzen Air-Tower (Rocket, Ice, dual-gatling mit aa-retrofit) den
      Skyline-adaptive Air-LOS-Pfad (`global-route-grid.ts:455-465`).
      Im Tower-Selection-Overlay (`createTowerVisualization`, line 878) und im
      Placement-Preview (`createPlacementPreview`, line 1135) wird ein Cell aktuell
      als "visible/grün" markiert wenn **groundVis ODER airVis** frei ist (Zeile 901
      bzw. 1265). Effekt: Air-fähige Tower wirken im Overlay deutlich „mächtiger",
      weil Air-Rays über Gebäuden fast immer frei sind.
      **Lösungsansatz:** 3-Wege-State im Shader-Attribut (statt `aIsBlocked` 0/1):
      `0=ground-visible (grün)`, `1=blocked (rot)`, `2=air-only-visible (cyan/blau)`.
      Beide Methoden + Fragment-Shader anpassen
      (`TOWER_LOS_FRAGMENT`, `global-route-grid.ts:149`).

- **Tower-Upgrade-Skalierung feintunen**
      Aktuell teilen sich alle Combat-Tower exakt dieselben Standard-Multiplikatoren in `tower-types.config.ts:45-47`:
      - Damage: ×1.10/Level (L25 ×10.83)
      - Fire Rate: ×1.07/Level (L25 ×5.42)
      - Range: ×1.04/Level (L25 ×2.67)
      → kombiniert L25 ≈ ×58 Base-DPS bei voller damage+speed-Spec, plus ×2.67 Reichweite.
      Beispiel Archer: auf hohen Leveln viel zu stark in Reichweite + Speed + Damage gleichzeitig — quasi unkillbar/unbalanciert.
      Pro-Tower-Skalierung statt globale Konstanten? Oder andere Curve (z.B. niedrigerer Multiplier ab L15+)? Konzept überlegen, Werte balancen.

- **Line-of-Sight für Air-Tower / Air-Targets**
      Aktuell schießen Tower auf fliegende Enemies visuell durch Gebäude durch — kein LoS-Test.
      Ground-LoS existiert bereits (`towerPlacement.recomputeTowerLOS`, `tower.visibleCells`, `tower.losReady`),
      aber das System sampelt nur Boden-Zellen. Für Air-Targets braucht es einen Raycast gegen die 3D-Tile-Geometrie
      (oder einen vorberechneten "sky-LoS"-Volumencheck) zwischen Tower-Mündung und Air-Enemy-Position.
      Betroffene Tower: Rocket (canTargetAir), Ice (canTargetAir), ggf. weitere bei späterem Air-Targeting-Research-Unlock.
      Stellen: `tower-combat.service.ts` (Targeting-Filter), `tower-placement.service.ts` (LoS-Berechnung), evtl. `enemy.entity.ts` (isAir-Flag).


> **Phase 1 (Engine Foundation) und Phase 2 (Engine Performance) abgeschlossen** → siehe DONE.md

---

# HOUSEKEEPING (Sprint-Plan)

> **Stand:** 2026-05-09 — 16/18 abgestimmten Items in einem /loop-Run erledigt (siehe Markierungen).
> Offen geblieben: `three-effects.renderer` Split + `three-tiles-engine` Split (beides architekturlastig,
> verdient eigene Sessions mit Sign-Off). Verschoben in DONE.md auf manuellen Zuruf.
> Tier 1 wird direkt im aktuellen Sprint erledigt (siehe DONE.md). Tier 2-4 hier persistiert.
> **Doku-Refresh:** bereits am 2026-05-08 erledigt (Phase 5.16 sync), entfällt als Punkt.

## Tier 2 — Fokussierte Cleanup-Aktionen (je <4h, brauchen kurz Sign-Off)

- [ ] **Asset-Cleanup ~199 MB**
      `public/assets/models/enemies/candidates/` (190 MB, 15 GLBs nirgends im Code referenziert),
      `night.webp` (Skybox-Variante nicht geladen), `logo.psd`, `main01.mp3` (Music-Config zeigt nur auf main02),
      `mocks/` (nur Doku), `archive-v3.5/` ONNX-Backup.
      **Achtung:** Working-Tree-Cleanup; Git-History bleibt fett. Optional `git filter-repo` für echte Repo-Schrumpfung.

- [x] **WaveDebug-Doppelmirror auflösen** ✓ 2026-05-09
      `UIStore.enemyCount/Speed/Health/Type/spawnMode/spawnDelay` (`store/ui.store.ts:91-107,226-231`)
      und Re-Exports in `tower-defense.store.ts:283-298` löschen — `WaveDebugService` ist faktisch
      einzige Quelle, aber UIStore-Variante hat **abweichende Defaults** (Inkonsistenz-Bug-Risiko).

- [x] **`models/enemy-types.ts` → `configs/enemy-types.config.ts`** ✓ 2026-05-09
      Datei ist eine Config-Datenbank (`ENEMY_TYPES = {...}`), kein Type-File.
      `configs/index.ts:6` re-exportiert sie bereits — Eingeständnis. Imports projektweit anpassen.

- [x] **`ai/core/wave-curriculum.ts` → `configs/wave-curriculum.config.ts`** ✓ 2026-05-09
      Pure Balance-Daten (CurriculumWave-Tabelle, goldBudgetForWave, enemyBaseDamageForWave),
      wird von `enemy.manager.ts` und `game-state.manager.ts` konsumiert — Layer-Inversion managers→ai.
      Backend-Mirror in `training-backend/wave_curriculum.py` bleibt synchron.

- [x] **`canTargetAirEffective` zirkulär entities↔ai auflösen** ✓ 2026-05-09
      Aktuell: `entities/tower.entity.ts:14` importiert aus `ai/core/tower-dps.util.ts`,
      `tower-dps.util.ts:8` importiert `Tower` aus `entities/`. Methode ist Core-Gameplay (Air-Targeting-Regeln) —
      gehört zu `tower.entity` selbst oder in eine neue `entities/tower-targeting.util.ts`.
      AI-spezifische DPS-Approximation (`computeTowerDPS`) bleibt in `ai/`.

- [x] **CLAUDE.md aktualisieren** ✓ 2026-05-09
      Top-Level-Folder ergänzen: `game/` (nach Cleanup ggf. raus), `integration/`, `interfaces/`, `utils/`.
      Nach `wave-curriculum`-Move auch dort Pfad korrigieren.

- [x] **Unbenutzte npm-Packages prüfen** ✓ 2026-05-09
      `depcheck` flaggt `canvas` und `@gltf-transform/core` (nur in Doku als CLI-Tip erwähnt).
      Nach Entfernung `npm ci && npm run build` testen.
      `@eslint/js` fehlt in `devDependencies` (nur transitiv aufgelöst) — explizit hinzufügen.

## Tier 3 — Strategische Refactorings (>4h, eigener Sprint, Planung nötig)

- [x] **Geo-Konstanten konsolidieren** (~25 Files) ✓ 2026-05-09
      `METERS_PER_DEGREE_LAT` und `DEG_TO_RAD` aus `geo-utils.ts` exportieren, alle Inline-`111320`
      und `0.0174533`/`Math.PI/180`-Stellen migrieren. **Bug-Symptom:** `movement.component.ts:40`
      nutzt `111000` statt `111320` — minimale Lateral-Offset-Abweichung. Test-Pass nach jedem Block.

- [x] **`services/`-Subfolder einführen** — **teilweise** ✓ 2026-05-09 (combat/ + debug/ migriert)
      Erledigt: `combat/` (combat-effect, combat-vfx, damage-application, status-effect, hq-damage, tower-combat)
      und `debug/` (wave-debug, sound-debug, tower-debug, enemy-debug, debug-window,
      performance-profiler, debug-facade) — 15 Files in Subfolder, ~22 Import-Sites aktualisiert.
      **Offen:** `world/`, `location/`, `facade/`, `infrastructure/` für eine eigene Session
      (kohärenter, weniger riskant in einem Block).

- [ ] **`three-effects.renderer.ts` aufsplitten** (2675 LOC → 3 Module)
      ParticleEffectsRenderer (blood/fire/explosion/smoke), AuraRenderer (frost/poison/inner-fire),
      EnvironmentEffectsRenderer (HQ-Explosion, Tower-Inner-Fire). Single-File macht PR-Reviews unmöglich.

- [ ] **`three-tiles-engine.ts` schlanker** (2223 LOC → ~1200 + Helper)
      Sub-Module für Post-Processing (Bloom + Color Grading), Camera-Setup (Controls + Initial-Position),
      Tile-Loading-State-Machine (firstTilesLoaded, retry, debounce). Per Composition.

- [x] **`game-state.manager.ts` Command-Handler extrahieren** (1020 LOC → 700 + 300) ✓ 2026-05-09
      EventBus-Subscriptions-Block (~150 Zeilen für `command:place-tower`, `command:upgrade-tower`, etc.)
      in eigenen `GameCommandsHandler`, plus `applyWaveCompletionBonus` (~20 Zeilen) in `EconomyService`.
      Trennt "Game-Loop-Owner" von "Command-Bus-Adapter".

- [x] **Combat-Magic-Numbers konsolidieren in `combat-tuning.config.ts`** ✓ 2026-05-09
      ~20 Stellen in `tower-combat.service.ts` (sleep-checks, beam-margins, blood-throttles, beam-width-defaults),
      plus `Tower.SLEEP_DELAY` (Entity-Static), `BEAM_BLOOD_EFFECT_INTERVAL = 200`,
      `POISON_TICK_INTERVAL_MS = 500` (in EnemyManager). Game-Balancing wird ohne Code-Änderungen zugänglich.

- [x] **Research-Sync-Pfad vereinheitlichen** ✓ 2026-05-09
      Aktuell 50/50: `research:completed` läuft sauber via Event → Store, aber `research:started`/
      `research:cancelled` haben no-op Subscriber, GSM ruft direkt `syncResearchStoreState()` auf.
      Bricht dokumentiertes Pattern (SIGNAL-STORE-ARCHITECTURE.md: "GSM → Event → SyncService → Store").
      Variante A: Events erweitern. Variante B: `research:active-changed` Snapshot-Event einführen.

- [x] **Debug-State in Stores migrieren** (UIStore oder neuer DebugStore) ✓ 2026-05-09
      `WaveDebugService.enemyCount/Speed/Health/Type/spawnMode/spawnDelay`,
      `TowerDebugService.allOverrides/selectedTowerId`,
      `EnemyDebugService.overrides/placementMode` — alle State-Signals gehören laut
      SIGNAL-STORE-ARCHITECTURE in den Store. Services bleiben für Computed/Derived.

- [ ] **`IGameManager` Entscheidung treffen**
      Halbfertige Abstraktion: nur 2 von 6 Managern implementieren das Interface
      (EntityManager, WaveManager). Entweder konsequent durchziehen (alle Manager + polymorphe
      Iteration in GSM) oder Interface löschen.

- [ ] **`game-engine/` Three.js-Coupling klären**
      Anspruch laut `game-engine/index.ts`: framework-agnostic. Realität: voll Three.js-gekoppelt
      (vfx.service, audio.service, screen-shake, background-music importieren `Vector3`, `ThreeTilesEngine`).
      Optionen: (a) Doku ehrlich machen ("Angular-decorator-frei, Three.js-coupled"), oder
      (b) Three-spezifische Adapter nach `three-engine/services/` ziehen.

## Tier 4 — Test-Aufbau (Top 5 Lücken)

- [ ] **DAMAGE_MATRIX + `calculateDamage()` Tests**
      35 Multiplier ungetestet, höchstes Balance-Risiko. `damage-matrix.config.ts` + `damage-calculator.ts`.
      EFFECTIVENESS_THRESHOLDS-Klassifizierung mitabdecken.

- [ ] **`game-state-encoder.encode()` Schema-Test**
      156-Slot-Vektor — silently breakt das ONNX-Model bei Schema-Drift. Slot-Indices verifizieren,
      DPS-Profile/History/Capabilities-Sektionen abgrenzen. Höchster Impact bei AI-Refactoring.

- [ ] **`WaveManager.startScheduledWave()` Tests**
      Mixed-Wave-Schedule ist Production-Default für AI-Director — null Tests. Pause-After,
      Variation-Anwendung, hp_mult-Skalierung, Stuck-Detection.

- [ ] **`GameStateManager` Sub-Step-Loop Tests**
      Fixed-timestep-Akkumulation, MAX_SUBSTEPS_PER_FRAME-Cap, MAX_REMAINDER_MS,
      gameTimeMs-Monotonie. Phase-Transitions setup ↔ wave ↔ gameover über Event-Sequenzen.

- [x] **`TowerCombatService` Tests** ✓ 2026-05-09 (15 Cases)
      Komplett ungetestet, ~27 Methoden. Targeting-Strategien (first/strongest/nearest/lowest-hp),
      LOS via GlobalRouteGrid, Air-vs-Ground-Filter, Beam-Tower-Cone-Collision,
      Melee-Tower, Flame-Sound-Loop-Tracking.
      **Scope:** calculateHeading, getEffectiveDPS, getEffectiveBeamWidth, Beam-State-Cleanup,
      Config-Wiring. Targeting-Strategien sind durch `tower.entity.spec.ts` abgedeckt;
      Beam-Cone-Geometrie + voller Update-Loop bleiben Integration-Test-Territorium.

## Weitere Cleanup-Items (kleiner, aus Reports)

- [x] **Damage-Application + Splash Tests** ✓ 2026-05-09 (12 Cases) — `DamageApplicationService.applyDamage`/`applyBeamDamage`/`killEnemy`,
      DOT-Stacking (Burn, Poison) bei Multi-Source.
      **Scope:** Damage-Matrix-Lookup, VFX/Kill-Flow, Beam-Damage. DOT-Stacking auf
      `MovementComponent.applyStatusEffect` ist eigenes Spec-Item.
- [x] **`GameStateSyncService` echter Service-Test** ✓ 2026-05-09 (21 Cases) (`services/game-state-sync.service.spec.ts` testet aktuell
      nur eine Inline-Re-Implementierung, nicht den injizierten Service).
- [x] **`ResearchStore` Spec hinzufügen** ✓ 2026-05-09 (20 Cases) — Active-Research-Tracking, Slot-Limits, applyResearchEffects, Persistence.
- [ ] **Three.js Mock erweitern** — `Sprite`, `SpriteMaterial`, `Box3.setFromObject`, `BufferAttribute.setXYZ`,
      `PositionalAudio`. Schaltet weitere Tests frei (SpatialAudio, combat-vfx, damage-application).
- [ ] **Specs konkretisieren oder löschen** — `game-speed.component.spec.ts`, `three-tiles-engine.spec.ts`,
      `three-effects.renderer.spec.ts` testen Inline-Helper statt der echten Klasse.

---

---

# PHASE 4: GAME FEATURES

> **Ziel:** Spielbares, poliertes Tower Defense

## 4.1a Visual Feintuning

- [ ] **Muzzle Flash feintunen**
      Grundsätzlich sichtbar, aber Intensität/Größe/Dauer anpassen
      Prüfen: nur bei Projectile-Towern (Archer, Cannon, Gatling, Rocket), NICHT bei Ice/Magic/Fire

- [ ] **Explosions-Partikel feintunen**
      Sprite-Sheet Partikel (Flash→Fireball→Rauch) — Timing, Größe, Farben polieren
      Betrifft Cannon- und Rocket-Einschläge

- [ ] **Screen Shake Performance untersuchen**
      Aktuell deaktiviert wegen Performance-Bedenken
      Messen: tatsächlicher FPS-Impact, ggf. nur bei nahen Explosionen aktivieren
      Dateien: `screen-shake.service.ts`, Display Options Toggle

- [ ] **Wave Preview Model: Pinguin** - Kamera-Position und Modell-Größe anpassen

- [ ] **Wave Preview Model: Herbert** - Kamera-Position und Modell-Größe anpassen

- [ ] **Color Grading Anwendungsfall klären**
      Feature funktioniert (Dark Fantasy, Noir, Warm Sunset)
      Brainstorming: als Gameplay-Element? (z.B. Nacht-Modus, Wetter), oder rein kosmetisch?
      Aktuell nur im Debug-Panel zugänglich — evtl. in Settings verschieben

## 4.1b Visual Settings (Performance-Toggles)

- [ ] **VFX Settings Menu** — Visuelle Effekte einzeln ein/ausschaltbar
      Freeze-Tint, Muzzle Flash, Trail-Streaks, Sprite-Sheet Partikel,
      Screen Shake, Bloom, Color-Grading
      Ziel: Low-End-Geräte können teure Effekte deaktivieren

---

# PHASE 5: DAMAGE & ARMOR SYSTEM

> **Ziel:** Strategische Tiefe durch Schadens-/Rüstungstypen
> **Konzept:** [MASTER_GAME_DESIGN.md](docs/game-design/MASTER_GAME_DESIGN.md)
> **Status (2026-05-08):** Infrastruktur abgeschlossen (siehe DONE.md) — Types,
> Schadensmatrix, damageType/armorType an allen Configs, Flame Tower,
> Damage-Matchup-Tooltips. Offen: weitere Tower-Typen + Wave-Preview-UI.

## 5.2 Tower-Schadenstypen — offen

- [ ] **Tesla Tower (`magic`)** — Kettenblitz, springt zwischen Enemies
- [ ] **Chaos Tower (`chaos`)** — Teuer, voller Schaden gegen alle Armor-Typen
      (Hinweis: `chaos` ist aktuell **nicht** im `DamageType`-Enum
      → Type erst erweitern, Matrix-Eintrag ergänzen)

## 5.3 Enemy-Rüstungstypen — offen

- [ ] **UI: Rüstungstyp im Wave-Preview anzeigen**
      "🛡️ Heavy Armor – Weak to Siege" o.ä.
      Neue Enemy-Ideen mit speziellen Rüstungen siehe BACKLOG → Enemy-Ideen.

---

# PHASE 6: AI WAVE DIRECTOR

> **Ziel:** Adaptive KI die spannende, faire Wellen generiert
> **Voraussetzung:** Phase 5 (Damage/Armor) abgeschlossen — erst Spielinhalt, dann Training
> **Plan:** [AI_WAVE_DIRECTOR_PLAN.md](docs/AI_WAVE_DIRECTOR_PLAN.md)

## 6.1 Training UI

- [ ] **Dashboard Header Styling verbessern**
      Status/Header Metriken besser stylen
      Model Metrics (Entropy, Grad Norm, etc.) als eigene Gruppe rechts
      Dezenter als Hauptmetriken, nach "Game Over" Bereich
      Dateien: `training-backend/dashboard/static/index.html`, `style.css`

## 6.2 Build & Deployment

> Training-Code nicht in Prod Bundle

- [ ] **Build Configuration**
      `angular.json`: fileReplacements für Training-Code
      Production: Training-Module wird zu leerem Stub
      Bundle Size Check: AI < 300KB

- [ ] **Model Validation**
      `scripts/validate-model.js`
      Prüft: Format, Größe, Basis-Inference
      Läuft vor Commit (optional)

## 6.3 Training & Tuning ⏸️ PAUSIERT

> Das eigentliche Training

- [~] **Training Run v3.5** ← PAUSIERT
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

## 6.4 Training Feintuning

> Erkenntnisse aus Testspielen gegen exportiertes ONNX-Model

- [ ] **HP-Skalierung erweitern**
      `HEALTH_MULTIPLIER_MAX`: 20 → 100
      Problem: Im Endgame kann AI HP nicht mehr skalieren (Cap erreicht)
      Dateien: `config.py`, `wave-director.service.ts`

- [ ] **Kill-Time Range erweitern**
      `KILL_TIME_MAX`: 5.0 → 8.0
      Mehr Spielraum für HP-Skalierung bei hoher DPS
      Datei: `config.py`

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

# BACKLOG

> Langfristig, bei Bedarf

## Training Backend Refactoring

- [ ] **training-backend Struktur verbessern**
      Aktuell alles flach, besser in Module aufteilen:
      - `core/` - model.py, trainer.py, reward.py
      - `utils/` - logger (tui_logger + auto_logger mergen)
      - `scripts/` - export, analyze (bereits teilweise)
      Import-Pfade in server.py anpassen

## CPU Hot-Path Optimierungen (neu aufsetzen)

> Ideen aus lokalem `perf:` Commit (Feb 2026), der vor Merge mit origin aufgegeben wurde.
> Enemy-Teile sind durch origin's "5000+ enemies"-Commit abgedeckt — folgende Punkte NICHT:

- [ ] **Tower Placement Validation debouncen**
      60Hz → ~3Hz bei statischer Cursor-Position. Schwellwert ~1m Bewegung,
      Validierung nur bei Überschreitung erneut ausführen.
      Datei: `src/app/services/tower-placement.service.ts`

- [ ] **Projectile Trails distance-basiert statt frame-basiert**
      Trail-Partikel spawnen pro gereister Strecke (z.B. alle 0.5m), nicht pro N Frames.
      Gleichmäßigere Trails bei schwankender Framerate und variabler Projektil-Geschwindigkeit.
      Datei: `src/app/entities/projectile.entity.ts`

- [ ] **Projectile Arc Tangent + Homing Recalc Rate**
      Cachen der Arc-Tangenten-Richtung zwischen Frames, Homing-Richtung nicht jeden Frame neu berechnen.

- [ ] **UIStore localStorage Persistenz debouncen (500ms)**
      Aktuell wird bei jeder Store-Mutation sofort geschrieben — stattdessen Trailing-Debounce.
      Datei: `src/app/store/ui.store.ts`

- [ ] **GameEventBus: Empty debugListeners Set Iteration überspringen**
      Guard: wenn Set leer ist, `for`-Loop komplett überspringen (Hot Path mit hoher Event-Rate).
      Datei: `src/app/game-engine/game-event-bus.ts`

- [ ] **Wave Completion Dirty-Flag statt Polling**
      Statt jeden Frame prüfen: Flag setzen bei enemy:died/reached-base, prüfen nur wenn dirty.
      Datei: `src/app/managers/wave.manager.ts`

- [ ] **Poison DOT Tick: deltaTime-Accumulator statt performance.now()**
      Pro Enemy einen Akkumulator hochzählen, bei 500ms Tick feuern und resetten.
      Robuster bei pausiertem Spiel / timescale ≠ 1.
      Datei: `src/app/managers/enemy.manager.ts`

- [ ] **Wave Debugger: 0ms Spawn + konfigurierbares Batching**
      Spawn-Delay-Minimum von 0.01ms auf 0ms (synchrones Spawnen statt setTimeout(0)).
      Batch-Size Slider (1–100 spawns/frame, default 3) im Wave Debug Panel.
      `maxSpawnsPerFrame` als konfigurierbares Property auf WaveManager.
      Dateien: `wave-debugger.component.ts`, `wave.manager.ts`, `game-state.manager.ts`, `wave-debug.service.ts`

---

## Performance - Advanced

- [ ] **Enemy Movement auf SoA (Structure of Arrays) umziehen**
      Ziel: Cache-freundliche Batch-Verarbeitung für Movement + Koordinaten-Konvertierung.
      Idee aus lokalem Experiment (vor Merge aufgegeben, da origin den klassischen Renderer entfernt hat):
      - Neue Klasse `EnemySoA` mit Typed Arrays (`Float64Array` für lat/lon, `Float32Array` für speed/progress/heights, `Uint8Array` für Flags).
      - Slot-Management: `allocSlot(id)`, `freeSlots[]`, `idToSlot` Map.
      - Update-Loop in Phasen statt Per-Entity-Mix:
        1. Status-Effekte + Slow/Speed/Pause → SoA syncen
        2. `batchMove(dt, timescale)` — tight Loop über Typed Arrays (ersetzt `MovementComponent.move()`)
        3. `batchGeoToLocal(originLat, originLon, originHeight)` — vektorisierte Koordinaten-Umrechnung
        4. Per-Entity Sync (reached-end, currentIndex, progress) + Grid + Height + Render
      - Grid-Throttle: Spatial/Route-Grid-Updates nur jedes 2. Frame (`_gridFrameCounter & 1`).
      - Enemy-Entity behält `soaSlot` Property, bei Kill: `setAlive(slot, false)` → batchMove skippt.
      - Neuaufsatz gegen aktuelles main (instanced-only Renderer, ohne classic Fallback).

- [ ] **Object-Pooling für Projektile** - Pool-Größe: 500 pro Typ
      ⚠️ GPU-Instancing existiert bereits — Entity-Pooling (JS-Objekte) nochmal prüfen ob GC-Druck messbar ist
- [ ] **Tower-Model-LOD-System** - Three.js LOD: High/Medium/Low
- [ ] **BVH für Terrain Raycasts** - 50ms → 0.5ms (weniger kritisch, siehe Hinweis in PERFORMANCE_REPORT)
- [ ] **Web Worker Offloading** - Pathfinding + weitere rechenintensive Logik
      Pathfinding: 200-600ms → 0ms Main Thread
      Auch prüfen: Collision-Checks, Wave-Director-Inference, Audio-Decoding
- [ ] **Tower GPU Instancing** - Schwierig wegen Rotationen
- [ ] **Konfigurierbares FPS-Limit** (60/30/unlimited)
      Reduziert GPU-Last bei guter Hardware, mehr Budget fuer 3D-Tiles-Streaming
      Stelle: `three-tiles-engine.ts` → `startRenderLoop()`
      ~20 Zeilen Core, optional UI-Setting in localStorage

## Game-Loop Performance (Speed-Multiplikator)

> **Kontext:** Beim AI-Training mit hohen Speed-Multiplikatoren (x75) wurde Mitte 2026-05 der Substep-Fix eingebaut — Movement/Hittest/Status-Restzeit laufen jetzt mathematisch korrekt N× pro Frame. Beim normalen Gameplay mit aktivem Rendering brachen daraufhin die FPS bei x2/x4 sichtbar ein. Erste Hypothese (microStep/frameStep-Refactor) wurde profilet (`.profiles/`, 2026-05-07) und **falsifiziert**: ~80% der x4-Cost waren **gar nicht der Game-Loop**, sondern der `ModelPreviewService` (rotierende 3D-Modelle in der Sidebar) der pro Frame `WebGLRenderer.setSize()` aufrief und damit den WebGL-Drawingbuffer reallozierte. Der Fix (Renderer auf Max-Size + setViewport pro Preview) hat den Hot-Path eliminiert: x4 läuft jetzt mit 10.8% Idle-Reserve und 1.3% Dropped-Frames (vorher 0% Idle, 46% Drops). Damit ist das Symptom weitgehend gelöst, die folgenden Punkte sind nur noch optionale Mini-Hebel.

- [ ] **microStep/frameStep-Trennung** (LOW PRIO, nur bei Bedarf)
      `update()`-Kette aufteilen: `microStep(dt)` läuft N× pro Frame und enthält nur substep-kritisches (Movement, Hittest, Status-Restzeit-Decrement). `frameStep(totalDt)` läuft 1× pro Frame und enthält Targeting, Spatial-Grid-Rebuild, VFX/Audio-Trigger, Three.js-Sync, Signal-Emits.
      Aktuell **nicht dringend** — bei x4 mit ~1000 Enemies bleibt 10% Idle-Reserve. Erst bei extremen Setups (>2000 Enemies, x10+) wieder relevant. Determinismus für x75-Training muss erhalten bleiben.
      Startpunkte: `src/app/services/game-loop-facade.service.ts`, `src/app/managers/enemy.manager.ts:285`, `src/app/managers/projectile.manager.ts`, `src/app/managers/status-effect.manager.ts`.

- [ ] **Preview-RAF-Drosselung** (optional)
      `ModelPreviewService` läuft mit voller Display-Refresh-Rate (60 fps). Auf 15–30 fps drosseln oder via IntersectionObserver pausieren wenn Sidebar-Canvas nicht im Viewport. Spart weitere ~5% bei sichtbarer Build-Sidebar.

## Visual Effects - Advanced

- [ ] **Advanced-Explosion-Staging** - 2-Stage Explosionen
- [ ] **Terrain-Decals bei Waffenbeschuss** — Scorch Marks, Krater-Optik, Einschusslöcher, Burn Areas
      Basiert auf existierendem GPU-Instanced Decal System (Blood/Ice Decals)
      Neue Shader in `decal-shaders.ts`, Configs in `visual-effects.config.ts`
      Dateien: `decal-instance.manager.ts`, `three-effects.renderer.ts`, `vfx.service.ts`

## Mobile Support & Accessibility

- [ ] **Mobile-Qualitäts-Presets**
      Low (1.0 pixelRatio, 50% Partikel), Medium, High (Retina)
      Auto-Detect via `navigator.userAgent`
- [ ] **Mobile Breakpoints hinzufügen**
      Breakpoints: 768px (Tablet), 480px (Mobile)
- [ ] **Touch-Targets auf 44px vergrößern**
      Mobile usability (Apple/Google Guidelines)
- [ ] **ARIA-Labels zu Icon-Buttons**
      Accessibility (Screen Reader)

## Terrain & Routing Experimente

- [ ] **OSM bridge/tunnel Tags abfragen** - `bridge=yes`/`tunnel=yes`/`layer=*` in Overpass-Query mitabfragen, im Street-Interface speichern, bei Höhenkorrektur berücksichtigen (bridge → Korrektur überspringen)
- [ ] **Laterales Sampling nur auf Routen** - Aktuell wird getGroundHeightEstimate für alle gefilterten Straßen aufgerufen (4 Extra-Raycasts pro Punkt). Optimierung: nur für Straßen die tatsächlich Routen sind das teure laterale Sampling nutzen, restliche Straßen im Korridor mit einfachem Raycast + Smoothing rendern
- [ ] **Gewässer von OSM laden** - `natural=water`, `waterway=river/stream/canal` über Overpass abfragen. Gewässer als unpassierbare Zonen ins Routing einbeziehen → Brücken werden natürliche Chokepoints (Engstellen). Optional: Gewässerflächen visuell auf der Karte darstellen

## Tower-Ideen

> Siehe auch: [MASTER_GAME_DESIGN.md](docs/game-design/MASTER_GAME_DESIGN.md)
> Tesla / Chaos sind bereits in Phase 5.2 oben gelistet — hier nur Verweis.

## Enemy-Ideen

> Siehe auch: [MASTER_GAME_DESIGN.md](docs/game-design/MASTER_GAME_DESIGN.md)

- [ ] **MechaCat** - Roboter-Katze als neuer Gegner-Typ
      Model bereits vorhanden: `public/assets/models/enemies/candidates/mechacat_01.glb`
- [ ] **Ghost** - `ethereal` Rüstung, nur Magic/Chaos wirkt
- [ ] **Skeleton** - `unarmored`, Swarm
- [ ] **Golem** - `fortified`, Boss
- [ ] **Dragon** - `heavy` + Air, fliegender Boss

---

# BEKANNTE ISSUES

> Beobachten, bei Reproduktion fixen

- [ ] **3D-Tiles Loading bei F5** - sporadisch "0 Kacheln geladen" nach Reload
      Fix: Retry-Mechanismus + Force-Update, siehe [TILES_LOADING_BUG.md](docs/TILES_LOADING_BUG.md)
- [ ] Nominatim-Geocoding gibt oft Straßen-Koordinaten statt Gebäude-Koordinaten
