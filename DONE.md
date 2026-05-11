# Changelog

Chronologische Liste aller erledigten Features und Fixes (neueste zuerst).

---

## 2026-05-11

### Route-Cell-Grid Polish-Block — 4 zusammenhängende Themen

> Eine Session, vier verzahnte Verbesserungen am Route-Cell-Grid und seinen
> Visualisierungen. Reihenfolge entspricht der Implementation.

- [x] **LOS-Overlay: Ground vs Air visuell trennen**
      Vorher färbte der Shader Cells grün sobald **ground ODER air** sichtbar war —
      Air-fähige Tower (Rocket/Ice/aa-Gatling) wirkten dadurch im Overlay überzeichnet
      mächtig, weil Air-Rays über Gebäuden fast immer frei sind.
      **Lösung:** Zwei InstancedBufferAttribute (`aGroundVisible`, `aAirVisible`),
      Fragment-Shader rendert 3-Wege-State: grün=ground (Priorität), blau=air-only,
      rot=blocked. Gleiche Logik in `createTowerVisualization`, `createPlacementPreview`,
      `continuePreviewBuild`. Globaler Debug-Overlay (`LOS_CELL_FRAGMENT`) zusätzlich
      erweitert: State 3 (muted blue) für air-only, Enemy-Color auf Lila verschoben
      um Verwechslung mit Air-Blau zu vermeiden, `isAirVisibleByAnyTower` + Air-
      Registration werden im State-Computing berücksichtigt.
      Dateien: `src/app/utils/global-route-grid.ts` (Shaders + alle drei Cell-Viz-Pfade).

- [x] **LOS-Raycast-Doppelarbeit eliminiert: Preview→Place Transfer + Range-Upgrade Diff**
      Hot-Path-Optimierung. Zwei klare Doppel-Raycast-Quellen identifiziert per
      systematischer Exploration aller LOS-Call-Sites:
      1. **Preview→Place:** `continuePreviewBuild` raycastete alle Cells für die
         Shader-Visualisierung, danach raycastete `continueTowerRegistration`
         dieselben Cells mit identischen Origin/Target/tipY für die Cell-Maps.
         **Fix:** Neue `consumePreviewIntoTower(towerId, ...)` validiert
         Position/Range/Targeting-Flags der aktiven Preview gegen die Place-Params
         und transferiert die bereits berechneten Float32-Arrays direkt in
         `cell.towerVisibility` / `cell.airVisibility`. Restliche Cells (falls
         Preview noch nicht fertig war) laufen durch neue
         `registerTowerProgressiveForCells` weiter.
      2. **Range-Upgrade:** `recomputeTowerLOS` rief vorher `unregisterTowerFromGrid`
         (löschte alle Cell-Map-Einträge) und dann `registerTower` (raycastete
         alle Cells im neuen Range). Da Range-Upgrades nur erhöhen, waren die
         alten Daten korrekt aber wurden weggeworfen.
         **Fix:** Neue `registerTowerIncremental(...)` — für Cells mit
         existierendem Cache-Eintrag Raycast skippen, nur neue Cells im Annulus
         raycasten. Stale Cells außerhalb new range werden gelöscht.
         `recomputeTowerLOS` disposed nur noch das Visualization-Mesh, der
         Cell-Map-Cache bleibt erhalten.
      Zusätzlich: `raycastLineOfSight` (`three-tiles-engine.ts`) allokationsfrei
      gemacht — drei wiederverwendete Member-Buffer (`_losOrigin`, `_losDirection`,
      `_losResults`) statt `new Vector3()` + `clone()` pro Aufruf. `batchSize`
      in `createPlacementPreview` von 25 → 50 (doppelte Cells/Frame).
      Dateien: `src/app/utils/global-route-grid.ts`, `src/app/services/global-route-grid.service.ts`,
      `src/app/services/tower-placement.service.ts`, `src/app/three-engine/three-tiles-engine.ts`.

- [x] **Cell-Y-Plausibilisierung: Brücken / Bäume / Stale-Y bei Toggle-Race**
      Top-Down-Raycaster trifft das jeweils höchste Objekt — bei Fußgängerbrücken
      und Straßenbäumen klebten Cells optisch auf Deck/Krone statt auf der Straße
      darunter. Zusätzlich behielten Cells nach dem ersten Debug-Toggle ihre
      Stale-Y aus der initialen Sample-Phase wenn Tiles noch nicht geladen waren.
      **Lösung — Route-anchored Multi-Hit Sampling:**
      - `RouteCell.routeAnchorY` neu — pro Cell der lineare-interpolierte Y-Wert
        des nächstgelegenen Route-Punkts (Routes haben in `path-route.service.ts`
        bereits geglättete terrain-Y-Werte). Wird in `generateFromRoutes`
        durchgereicht über `generateCorridorCells(centerX, centerZ, anchorY, ...)`.
      - `raycastTerrainHeight` (`three-tiles-engine.ts`) erweitert um optionalen
        `anchorY`: nutzt `intersectObject` das ohnehin alle Hits sortiert zurückgibt.
        Default = erster Hit (Legacy). Wenn erster Hit **klar überhalb**
        (`> anchorY + tolerance`) → suche unter den weiteren Hits den höchsten
        innerhalb `±tolerance` des Anchors und nimm den. Fällt **nicht** auf den
        Anchor selbst zurück (unzuverlässige Anchor dürfen nichts kaputt machen) —
        Worst Case = Legacy.
      - `TerrainRaycaster`-Typ erweitert um `anchorY?`-Parameter.
        `getTerrainHeightAtLocal` Public-Wrapper analog.
      - Alle Re-Sample-Sites geben jetzt `cell.routeAnchorY` mit:
        `updateTerrainHeights`, `registerTower`, `registerTowerIncremental`,
        `continueTowerRegistration`, `continuePreviewBuild`, `initializePositions`.
      - `updateTerrainHeights` ruft am Ende `initializePositions` für aktive
        Viz auf → Mesh-Y wird auf neue Cell-Y aktualisiert, fixt Stale-Y-Toggle-Race.
      Konstante `GROUND_ANCHOR_TOLERANCE_M = 3m` in `three-tiles-engine.ts` —
      typische Bürgersteig/Rampen passen rein, Brückendecks (4-6m) und Baumkronen
      werden verworfen.

- [x] **Y-Divergenz zwischen Global-Overlay und Per-Tower-Overlay behoben**
      Symptom: Bei aktivem Global-Debug-Overlay + selektiertem Tower waren die
      Cells im Tower-Range als zwei leicht versetzte Layer sichtbar.
      Ursache: System A (`initializePositions`) machte einen Live-Raycast für
      jede Cell, System B (`createTowerVisualization`) und C
      (`createPlacementPreview`) nutzten den gecachten `cell.terrainHeight`.
      Bei minimalen Tile-State-Unterschieden zwischen den Sample-Zeitpunkten
      kamen leicht unterschiedliche Y heraus.
      **Fix:** Live-Raycast in `initializePositions` entfernt — alle drei Systeme
      lesen jetzt aus derselben Quelle `cell.terrainHeight`. Cache bleibt aktuell
      durch `updateTerrainHeights → initializePositions` (siehe oben).
      Die drei Viz-Systeme bleiben getrennt (unterschiedliche Daten, Lifecycles,
      Shader), aber stacken jetzt auf identischer Y.

### TODO-Cleanup: Air-LoS bereits umgesetzt
- [x] **Line-of-Sight für Air-Tower / Air-Targets**
      Bereits in `1f156a4` (2026-05-09) implementiert — TODO-Eintrag war veraltet.
      Grid-Layer (`global-route-grid.ts:455-465`) berechnet pro Cell `airVisibility`
      gegen `skylineHeight + AIR_CLEARANCE_M`. Targeting (`tower-combat.service.ts:122-163`)
      dispatcht per `enemy.typeConfig.isAirUnit`: Air-Enemies gehen durch
      `isAirPositionVisibleFromTower`, Ground durch `isPositionVisibleFromTower`,
      mit Runtime-Raycast-Fallback auf die korrekte Air-Höhe (`hasLineOfSight`).
      `visibleCells` ist seitdem Union aus Ground+Air-sichtbaren Zellen.
      Verbleibendes Visualisierungs-Symptom (Overlay zeigt grün sobald Ground ODER Air frei)
      wurde im selben Run mit erledigt (siehe oben „LOS-Overlay: Ground vs Air visuell trennen").

---

## 2026-05-10

### Refactor: PostProcessingPipeline aus three-tiles-engine extrahiert
- [x] **Post-Processing-Pipeline (Bloom + Color Grading) als eigene Klasse**
      EffectComposer + Render-/Bloom-/ColorGrading-/Output-Pass plus 9 Setter
      aus `three-tiles-engine.ts` herausgelöst in
      `three-engine/post-processing/post-processing-pipeline.ts`. three-tiles-engine
      delegiert nur noch (`postProcessing.render()`, `setSize()`, `needsRender()`).
      Net: −46 LOC im Mainfile, +93 LOC in eigener single-responsibility Klasse.
      **Offen:** Camera-Setup (GlobeControls + Initial-Position) und Tile-Loading-State
      sind noch im Mainfile — eigene Sessions, weil enger mit `tilesRenderer.initialize()`
      verzahnt als Post-Processing. Bleibt als TODO.

---

## 2026-05-09

### Housekeeping-Sprint (Tier 2 + Tier 3 + Tests, 16 Items in einem Loop)

> 19 Commits, 556 Tests grün, Build clean. Zwei Items (`three-effects` Komplett-Split,
> `services/` Komplett-Reorg in 6 Subfolder) bewusst zurückgestellt.

#### Tier 2 — Cleanup-Aktionen
- [x] **`canTargetAirEffective` Zirkular-Dep entities↔ai aufgelöst**
      Funktion + `AA_RETROFIT_TOWERS`-Set aus `ai/core/tower-dps.util.ts` in eine neue
      `entities/tower-targeting.util.ts` gezogen. tower.entity.ts importiert nicht mehr aus
      ai/. ai/core/tower-dps.util.ts re-exportiert für bestehende Konsumenten
      (dps-profile, defense-analyzer).
- [x] **`canvas` + `@gltf-transform/core` aus npm entfernt**
      depcheck-Treffer (in keinem Code referenziert, gltf-transform nur in Docs als CLI-Tip).
      `@eslint/js` als explizite devDep gepinnt (vorher nur transitiv).
- [x] **`enemy-types.ts` → `configs/enemy-types.config.ts`**
      models/enemy-types.ts war eine Config-Datenbank (`ENEMY_TYPES = {…}`), kein Type-File —
      configs/index.ts re-exportierte sie bereits als Eingeständnis. 18 Import-Sites umgezogen.
- [x] **`ai/core/wave-curriculum.ts` → `configs/wave-curriculum.config.ts`**
      Pure Balance-Daten — beendet die Layer-Inversion managers→ai. Backend-Mirror in
      `training-backend/wave_curriculum.py` strukturell synchron, nur TS-Import-Pfade ändern sich.
- [x] **CLAUDE.md Folder-Tree-Refresh**
      `integration/`, `interfaces/`, `utils/` ergänzt; `models/`-Beschreibung präzisiert;
      `entities/` zeigt jetzt auf `tower-targeting.util`; `game-engine/`-Wording auf
      "Three.js-coupled, Angular-frei" korrigiert (vorher "framework-agnostic").
- [x] **WaveDebug-Doppelmirror in UIStore entfernt**
      6 Mirror-Signals (`enemyCount/Speed/Health/Type/spawnMode/spawnDelay`) auf UIStore
      und Re-Exports in tower-defense.store gelöscht — `WaveDebugService` ist alleinige
      Quelle. Beseitigt das Inkonsistenz-Bug-Risiko durch divergierende Defaults.

#### Tier 3 — Strategische Refactorings
- [x] **Geo-Konstanten zentralisiert (`METERS_PER_DEGREE_LAT`, `DEG_TO_RAD`)**
      Aus `utils/geo-utils.ts` exportiert; ~14 Inline-Vorkommen (`111320`, `111000`,
      `0.0174533`, `Math.PI/180`-in-Geo-Kontext) in managers, entities, three-engine,
      services migriert. **Bug-Fix:** `movement.component.ts:40` und
      `ai/core/defense-analyzer.ts:329-330` nutzten `111000` statt `111320` — ~0.3%
      Lateral-Offset-Drift in Movement-Cache + Tower-Distance-Heuristik behoben.
- [x] **Combat-Magic-Numbers in `combat-tuning.config.ts` extrahiert**
      Sleep-Delay (Tower.SLEEP_DELAY), Sleep-Check-Intervall (500ms), Range-Margins
      (standard 1.1×, beam 1.2×), Beam-Blood-Throttle (200ms), Poison-Tick-Intervall (500ms)
      aus `tower-combat.service.ts`, `tower.entity.ts` und `enemy.manager.ts` in eine
      Config gezogen. Game-Balancing ohne Code-Änderungen zugänglich.
- [x] **Research-Sync via `research:state-changed` Snapshot-Event vereinheitlicht**
      Vorher 50/50: completed via Event→Store, started/cancelled direkt von GSM via
      `syncResearchStoreState()`. ResearchManager emittiert jetzt nach jeder State-Mutation
      einen Snapshot-Event (active/completed/centerLevel/maxSlots); GameStateSyncService
      konsumiert ihn. GSM hat 6 syncResearchStoreState-Calls + den Helper komplett verloren.
- [x] **GameCommandsHandler + EconomyService aus GameStateManager extrahiert**
      `managers/game-commands.handler.ts` ownt jetzt alle 11 `command:*`/`debug:*`-EventBus-
      Subscriptions (~150 LOC). `services/economy.service.ts` ownt Wave-Completion-Bonus-
      Mathematik + Perfect-Streak-Counter (~25 LOC). GSM hat einen neuen
      `recomputeTowerRangeAfterUpgrade(tower)` Helper, der den geteilten LOS-/Range²-/
      Range-Disc-Refresh-Pfad bündelt.
- [x] **DebugStore eingeführt (10 Signals migriert)**
      WaveDebugService/TowerDebugService/EnemyDebugService delegieren jetzt ihre State-
      Signals an `store/debug.store.ts` (waveEnemy*, waveSpawnMode/Delay, towerSelectedId,
      towerOverrides, enemyPlacementMode, enemyOverrides). Public API der Services
      unverändert — Konsumenten lesen weiter `waveDebug.enemyCount()` etc., aber State
      lebt in der Store-Schicht (SIGNAL-STORE-ARCHITECTURE.md).
- [x] **`services/`-Subfolder eingeführt — teilweise (combat/ + debug/)**
      `services/combat/` (8 Files: combat-effect, combat-vfx, damage-application+spec,
      hq-damage, status-effect, tower-combat+spec) und `services/debug/` (7 Files:
      wave-debug, tower-debug, enemy-debug, debug-window, sound-debug, performance-profiler,
      debug-facade). 22 Import-Sites aktualisiert. **Offen:** `world/`, `location/`,
      `facade/`, `infrastructure/` für eine separate Session.

#### Tier 4 + Cleanup-Tests — 68 neue Test-Cases
- [x] **ResearchStore Spec (20 Cases)**
      Initial defaults (4), availableSlots/centerPlaced computed (4), isTowerUnlocked (5),
      applyResearchEffects (6 — tier raise, no-regress, perk add, airTargeting,
      unlock-tower no-op, multi-effect), resetResearchState (1).
- [x] **GameStateSyncService echter Service-Test (21 Cases)**
      Vorher testete der Spec eine Inline-Re-Implementierung der Subscriptions — jetzt
      wird der echte Service mit gemockter Angular-DI instanziiert und durch echte
      `eventBus.emit()`-Calls validiert. Inkl. tower:sold-clearing-selection-only-on-match,
      research:state-changed-Snapshot, dispose()-detach.
- [x] **DamageApplicationService Spec (12 Cases)**
      Damage-Matrix-Passthrough, multiplier propagation, not-initialized→null, hit-blood-
      gating, splash-flag forwarding, lethal-hit→deathBlood+kill, skipBloodEffects suppression,
      kill-credit auf source tower, missing-tower no-throw, beam-damage canBleed-gating und
      lethal-tick. DOT-Stacking auf MovementComponent ist eigenes Spec-Item.
- [x] **TowerCombatService Spec (15 Cases)**
      calculateHeading (4 — N/E/S/W), getEffectiveDPS (4 — config default, fallback,
      damage-upgrade compounding, level-0), getEffectiveBeamWidth (3), Beam-State-Cleanup
      (3 — stopTowerBeam removes per-tower entry, tolerates missing engine; stopAllBeams
      clears throttle map), Config-Wiring (1 — BEAM_BLOOD_EFFECT_INTERVAL ⇔ COMBAT_TUNING).

#### Lint-Pass (vor dem Sprint, gehört dazu)
- [x] **60 ESLint-Errors bereinigt**
      11 via `--fix` automatisch (Imports, const vs let). 49 manuell: unused imports/vars
      entfernt oder mit `_` prefixed; `any` durch konkrete Typen ersetzt; `for-of` statt
      Index-Loops in enemy.manager.ts; readonly Felder statt Getter mit Literalen in
      instanced-enemy.renderer.ts; A11y (`tabindex`, `keydown`-Handler) bei click-only
      Elementen; `td` als zusätzlicher Selector-Prefix in eslint.config.js zugelassen
      (für TdIcon/TdRichTooltip aus dem UI-Refresh).

---

## 2026-05-08

### Phase 5: Damage & Armor System (Infrastruktur komplett)
- [x] **DamageType / ArmorType Types definiert**
      Damage: `physical`, `pierce`, `siege`, `magic`, `fire`, `ice`, `poison`.
      Armor: `unarmored`, `light`, `heavy`, `fortified`, `ethereal`.
      Datei: `src/app/configs/combat/combat.types.ts`
- [x] **Schadensmatrix mit echten Multiplikatoren**
      Strategische Werte (z.B. `magic` vs `ethereal` ×1.75), keine
      neutralen 1.0-Platzhalter mehr. Pipeline läuft über
      `damage-application.service.ts` + `damage-calculator.ts`.
      Datei: `src/app/configs/combat/damage-matrix.config.ts`
- [x] **damageType an allen Tower-Configs**
      Archer=physical, Gatling=pierce, Sniper=pierce, Cannon/Rocket=siege,
      Magic=magic, Ice=ice, Fire=fire, Poison=poison.
      Datei: `src/app/configs/tower-types.config.ts`
- [x] **Flame Tower (`fire`)**
      Kegel-Beam-Tower mit prozeduralem `ThreeFlameBeamRenderer`.
      Wide-Burn-Upgrade modifiziert `beamWidth` (nicht Range).
      Dateien: `tower-types.config.ts`, `tower-combat.service.ts`,
      `three-engine/renderers/three-flame-beam.renderer.ts`
- [x] **UI: Schadenstyp + Damage-Matchup-Tooltips im Tower-Panel**
      Sidebar zeigt pro Tower welche Armor-Typen effektiv getroffen werden.
      Dateien: `components/game-sidebar/game-sidebar.component.{ts,html}`
- [x] **armorType an allen 16 Enemy-Configs**
      zombie/rat/penguin (unarmored), bat/wallsmasher/hornet/spider (light),
      tank/bear/zombie-soldier/dragon/mech (heavy), mammoth/herbert
      (fortified), ghost/wraith (ethereal).
      Datei: `src/app/models/enemy-types.ts`

### Phase 6: AI Wave Director (Trainings-Pipeline)
- [x] **PyTorch → ONNX Export Pipeline**
      `npm run export-ai` exportiert das aktuelle Checkpoint nach
      `public/assets/ai/`. Browser-Inferenz ohne Python-Backend.
      Datei: `training-backend/scripts/export_to_tfjs.py`
- [x] **Bot Tower-Limit erhöht (50 → 300)**
      Strategist-Bot sieht im Training jetzt Endgame-DPS-Levels.
      Voraussetzung für Phase-5.16-Curriculum + Endgame-Knobs.
      Datei: `src/app/ai/training/bots/tower-bot.interface.ts`
- [x] **Wave-Schedule / forced Templates pro Wave**
      30 explizit gepinnte Waves, danach mod-30-Loop. Decoder forciert
      das Curriculum-Template, NN tunt nur noch die 4 Continuous-Faktoren.
      Dateien: `training-backend/wave_curriculum.py`,
      `src/app/ai/core/wave-curriculum.ts`
- [x] **State-Vektor: dpsByDamageType (Phase 5.9 Gap-5-Helper)**
      10 Features im 156-State (Gap-5-effective-DPS-per-armor). NN
      sieht direkt, gegen welche Armor-Klassen die verfügbare DPS
      schwach ist — Voraussetzung für strategisches Tower-Mix-Lernen.
      Datei: `src/app/ai/core/game-state-encoder.ts`
- [x] **Phase 5.16 Wave-Curriculum + Endgame-Knobs + Gold-Budget**
      Endgame-HP-Multiplier (W20+: +5 %/Wave, Cap ×4 bei W80),
      Per-Leak-Damage-Skalierung (W1–10: 1 HP, …, W31+: 4 HP+),
      deterministisches Gold-Budget (W1: 30/15, W30: 650/325, linear
      extrapoliert). Frontend-Mirror in `wave-curriculum.ts`.

### Visual / Performance
- [x] **Freeze-Effect Performance via aTintColor**
      Instanced VAT Shader nimmt Tint-Farbe pro Instanz (`aTintColor`-
      Attribut) statt Material-Cloning. Kein FPS-Impact mehr beim
      Einfrieren großer Mengen Enemies.
      Datei: `src/app/three-engine/renderers/instanced-enemy/`

---

## 2026-03-15

### Performance: Enemy System Optimierung (~37% schneller pro Enemy)
- [x] **Runde 1 — JS-Hotpath Optimierungen**
      `performance.now()` einmal pro Frame cachen (war 9000+ Calls), Single-Pass
      Status-Effect-Update mit In-Place Array Compact (ersetzt 3 separate Iterationen),
      `needsUpdate` GPU-Flags pro Pool batchen statt pro Instance, Integer-Hash-Keys
      fuer Spatial Grids (keine String-Allokation), sqrt-Elimination im Heading-Check,
      Segment-Perpendikularvektor cachen, statisches lookAt-Target, In-Place
      `transform.setPosition()`. Ergebnis: ~2.83µs → ~1.84µs pro Enemy.
      Dateien: `enemy.manager.ts`, `movement.component.ts`, `transform.component.ts`,
      `spatial-grid.service.ts`, `global-route-grid.ts`, `enemy-instance.manager.ts`,
      `health-bar-instance.manager.ts`, `instanced-enemy.renderer.ts`, `ellipsoid-sync.ts`
- [x] **Runde 2 — Koordinaten & Math Optimierungen**
      `geoToLocalSimple/Into()` inlined mit gecachtem Origin-Cosinus (kein Math.cos/sqrt),
      doppelte Koordinaten-Konvertierung eliminiert (localPos zum Renderer durchgereicht),
      `slowMultiplier` aus Status-Update durchgereicht (keine Re-Iteration),
      `Math.pow` durch lineare Approximation ersetzt, Height-Cache Integer-Keys (Szudzik
      Pairing statt toFixed), VAT totalTime pro Animationstyp vorberechnet, tintDirty
      Bug-Fix (GPU-Flag wurde nie gesetzt). Ergebnis: ~1.84µs → ~1.79µs pro Enemy.
      5000+ Enemies bei 67 FPS (vorher 3000 bei 61 FPS).

### Performance: Progressive LOS & Street Rendering
- [x] **Tower-Platzierung ruckelfrei**
      `registerTowerProgressive()` berechnet LOS in Batches von 50 Zellen/Frame.
      Tower bleibt inaktiv (`losReady=false`) bis Berechnung abgeschlossen (~130ms).
      Combat-System ueberspringt Towers mit ausstehender LOS. Vorher: 95-380ms
      Frame-Drop pro Platzierung. Nachher: 0ms pro Frame.
      Dateien: `global-route-grid.ts`, `tower-placement.service.ts`,
      `tower-combat.service.ts`, `tower.entity.ts`, `game-loop-facade.service.ts`
- [x] **Street-Rendering ruckelfrei**
      `renderStreets()` sammelt Arbeit und gibt sofort zurueck.
      `continueStreetRender()` verarbeitet 50 Nodes/Frame progressiv.
      Alte Strassen bleiben sichtbar bis neue fertig (kein Flackern).
      Tile-Reload-Callback von 350-600ms auf 14-34ms reduziert.
      Dateien: `street-rendering.service.ts`, `game-loop-facade.service.ts`,
      `visualization-facade.service.ts`

### Code Review: Projekt-weite Bereinigung (12 Agenten)
- [x] **CombatEffectService.destroy()** hinzugefuegt + Aufruf in GameStateManager.dispose()
- [x] **Wave-Completion Race Condition** — `getKillingCount()` pruefen bevor Wave complete
- [x] **--td-red CSS-Variable** im Theme definiert (war undefiniert, 8+ Stellen)
- [x] **TYPE_COOLDOWN_WAVES** Frontend 2→4 synced mit Backend
- [x] **Concurrent Location Changes** Guard mit `isApplyingLocation()`
- [x] **VARIATION_MAX** aus config.py importiert statt hardcoded in model.py
- [x] **CombatComponent Dead Code** entfernt (setTarget, clearTarget, hasTarget, isInRange)
- [x] **Three.js Mock** komplett ueberarbeitet (30+ Klassen, fixt 26 vorher fehlende Tests)
- [x] **487/487 Tests** gruen, 39/39 Test-Files passed

---

## 2026-02-27

### Fix: Gegner spawnen unter der Erde nach radikalem Zoom
- [x] **Tile-Quality-Aware Route Protection**
      Beim schnellen Rein-/Rauszoomen wechselten 3D Tiles auf Low-LOD, was zu
      20m+ niedrigeren Terrain-Hoehen fuehrte. Route-Neuberechnung gegen diese
      Low-LOD Tiles liess Gegner unter dem Terrain spawnen (620 betroffene Enemies
      mit exakt 20.132m Desync im Debug-Log nachgewiesen).
      **Fix:** Tile-Qualitaets-Tracking per `geometricError` (3D-Tiles-Standard LOD-Metrik).
      Bei jeder Route-Berechnung wird via `forEachLoadedModel()` eine Scene→Tile Lookup-Map
      gebaut. Waehrend der Hoehen-Raycasts wird per Parent-Walk das getroffene Tile
      identifiziert und dessen `geometricError` aufgezeichnet. Neue Routen-Hoehen werden
      nur akzeptiert wenn die Tile-Qualitaet nicht schlechter als 2× gegenueber der
      vorherigen Berechnung ist. Visuelle Route-Linien werden immer aktualisiert.
      Kein zusaetzlicher Raycast, Performance-Impact < 0.1ms pro Route.
      Dateien: `three-tiles-engine.ts` (Tile Quality Tracking API),
      `path-route.service.ts` (Quality-gated cachedPaths)

### Nachtraegliche Bereinigung: bereits erledigte TODOs
- [x] **Air Priority Sub-Strategie**
      `closest`/`lowest-hp`/`highest-hp` als AirSubStrategy implementiert.
      Tower-Entity, Targeting-Logik und Sidebar-UI unterstuetzen Auswahl.
      Dateien: `tower-types.config.ts`, `tower.entity.ts`, `game-sidebar.component.ts`
- [x] **Fire Tower "Wide Burn" Upgrade**
      Modifiziert `beamWidth` (Flammen-Kegelbreite, ×1.3 pro Level), nicht Range.
      Eigene `getEffectiveBeamWidth()` Logik in `tower-combat.service.ts`.
      Dateien: `tower-types.config.ts`, `tower-combat.service.ts`
- [x] **Kamera-Boundaries**
      `minDistance=5`, `maxDistance=2000` auf EnvironmentControls gesetzt.
      Dateien: `three-tiles-engine.ts`
- [x] **Poison Tower**
      DOT Damage, gruene Visuals, Splash Poisoning.
      Dateien: `tower-types.config.ts`, `projectile-types.config.ts`
- [x] **Floating Damage Numbers**
      GPU-instanzierte Schadenszahlen ueber Gegnern, togglebar.
      Dateien: `floating-text-instance.manager.ts`, `floating-text-material.ts`, `floating-text-atlas.ts`
- [x] **Route-Terrain-Desync (BEKANNTE ISSUES)**
      Durch Tile-Quality-Aware Route Protection behoben — Low-LOD Routen
      werden nicht mehr als Gameplay-Hoehen akzeptiert.

### TODO.md Cleanup
- Erledigte Eintraege entfernt (Poison Tower, Floating Damage Numbers, Route-Desync,
  Height-Refinement obsolet durch Tile-Quality-Fix)
- console.log Zahl aktualisiert: ~196 → ~68 Stellen in ~18 Dateien

---

## 2026-02-25

### Mixed Waves (Multi-Type Spawning)
- [x] **Mixed Waves Infrastruktur**
      Mehrere Enemy-Typen pro Wave mit 7 konfigurierbaren Spawn-Patterns
      (interleaved, sequential, clustered, random, front-loaded, back-loaded, wave-in-wave).
      SpawnSchedule-System loest Pattern-Logik zur Build-Time auf, WaveManager spielt
      den Schedule sequentiell ab. Backwards-kompatibel via optionales `schedule` Feld
      auf `WaveConfig`.
      Dateien: `wave.manager.ts`, `spawn-schedule-builder.ts` (neu), `wave-config-adapter.ts`
- [x] **Mixed Wave Debug Panel**
      Mode-Toggle (Single/Mixed) im Wave-Debug-Panel. Mixed-Mode bietet
      Gruppen-Karten (Typ, Count, HP/Speed-Multiplier), Pattern-Auswahl mit Icons,
      konditionale Controls (Cluster Size, Sub-Wave Pause), Delay-Variation.
      Dateien: `wave-debugger.component.ts`, `wave-debug.service.ts`, `game-loop-facade.service.ts`
- [x] **Theme-Erweiterung: Teal/Gold Button-Varianten**
      `tealLight`, `tealDark`, `goldLight` CSS-Variablen zum Design-System hinzugefuegt.
      Dateien: `td-theme.ts`

---

## 2026-02-21

### HQ-Placement ausserhalb der Street-Bounds
- [x] **HQ kann jetzt ueberall auf der Karte platziert werden**
      Auch in Bereichen ohne geladenes Strassennetz. Streets werden automatisch
      nachgeladen, alter Spawn wird verworfen wenn >1500m entfernt und ein neuer
      Random Spawn nahe dem neuen HQ generiert.
      Dateien: `map-placement.service.ts`, `location-facade.service.ts`, `map-constants.config.ts`

### Unused Enemy Model Candidates entfernt
- [x] **6 GLB-Dateien aus `candidates/` entfernt**
      asian_giant_hornet, bipedal_mech, dragon, fantasma_animado, flying_hornet, uber_soldier

## 2026-02-15

### Attributions Dialog
- [x] **Attributions & Licenses Dialog** in Sidebar-Footer
      WC3-styled Dialog mit allen 3D-Model-Lizenzen (Sketchfab, Poly Pizza),
      Fonts, Sound Effects und Open Source Libraries. Strukturierte Config
      in `attributions.config.ts` fuer einfache Pflege.

### Info Overlay Caret
- [x] **Info-Overlay Toggle an FPS-Anzeige verschoben**
      Button aus Quick-Actions entfernt. Klickbares Caret neben FPS-Zeile
      expanded/collapsed die Detail-Stats (Tiles, Enemies, Sounds, Streets).

## 2026-02-14

### Background Music Service
- [x] **Phasen-basierte Hintergrundmusik**
      Two-Channel A/B Crossfade-System spielt zufaellige Tracks pro Phase
      (Build vs Wave). Neuer Track bei jeder Wave, Loop mit Crossfade.
      Config in `background-music.config.ts`, 15 Tracks (2 Build, 13 Wave).
- [x] **Main Theme beim Start**
      Spielt via HTMLAudioElement vor Engine-Init, geloopt bis Game Ready,
      dann Crossfade zu Build-Musik.
- [x] **Musik-Dateien getrimmt**
      Trailing Silence aus allen 15+1 Music-Files entfernt (ffmpeg).

### Mammoth Enemy
- [x] **Neuer Mammoth-Gegner**
      Langsam (Speed 3), stark (400 HP), Siege-Archetyp ab Wave 7+.
      Walk/Die-Animationen, seltener Mammoth-Call Sound (15-40s Intervall).

### VAT Shader Emissive Support
- [x] **Emissive-Unterstuetzung im instanced VAT Shader**
      `emissiveIntensity` und `emissiveColor` Uniforms im Fragment Shader.
      Behebt dunkle Darstellung von Mammoth, Rat, Spider, Zombie Soldier.

### Tentacle Tower
- [x] **Tentacle Tower mit GPU Bezier-Rendering**
      Melee-Tower mit prozeduralem Tentakel-Rendering (kubische Bezier-Kurven).
      `attackType: 'melee'`, `meleeStrikeDuration` fuer Nahkampf.

### Zombie Soldier + Rat
- [x] **Zwei neue Gegner-Typen**
      Zombie Soldier (humanoid, mittel) und Rat (schnell, schwach).
      Beide mit Walk/Die-Animationen und Instanced Rendering.

### Two-Pass Health Bars
- [x] **Verbessertes Health-Bar-Rendering**
      Korrektes Depth-Testing mit Two-Pass Rendering.

## 2026-02-13

### Floating Damage Numbers

- [x] **Rote Schadenszahlen bei Treffer**
      GPU-instanced floating text (`-25`) über Gegnern bei Projektil-Hits.
      Farbe `#FF4444`, schwebt hoch und blendet aus (800ms).
      Textgröße skaliert mit Schaden (0.25 bei kleinem Splash → 0.55 bei vollem Hit).
      Toggle via Display Options (persistiert in localStorage).
- [x] **Splash-Damage Numbers**
      Auch Splash-Treffer (Cannon, Ice-Shard) zeigen individuelle Schadenszahlen
      pro getroffenen Gegner. Logik in CombatEffectService statt GameStateManager,
      da dort Direct Hits + Splash zusammenlaufen.
- [x] **Splash Radius reduziert**
      Cannonball: 16m → 10m, Ice-Shard: 12m → 8m. Engerer, realistischerer AOE.

### Performance Tier 2+3: Micro-Optimizations

- [x] **Trig vorberechnen im Targeting-Fallback (2.1)**
      `Math.cos()` und Range-Squaring aus dem per-Enemy-Filter gehoisted in tower-combat.service.ts
- [x] **Distance² statt sqrt() fuer Range-Checks (2.2)**
      Neue `fastDistanceSq()`/`geoDistanceFastSq()` in geo-utils.ts, Caller in tower.manager.ts und projectile.entity.ts konvertiert
- [x] **Canvas Pool fuer Floating Text (2.4)**
      Shared Canvas-Element statt `document.createElement('canvas')` pro Text in three-effects.renderer.ts
- [x] **Audio stop() In-Place (2.5)**
      Backward-Iteration + splice statt Array-Neuallokation in spatial-audio-playback.ts
- [x] **Tower Animation Distance-LOD (2.8)**
      3-Tier LOD (<50m full, <100m every 2nd, <200m every 4th, >200m skip) in three-tower.renderer.ts
- [x] **Early-Exit bei 0 Enemies (3.1)**
      Guard clause in game-state.manager.ts, ueberspringt enemyManager.update() wenn leer
- [x] **Trail-Partikel Throttling (3.2)**
      Spawn nur jeden 2. Frame in projectile.manager.ts (bitwise & 1)
- [x] **Floating Text Free-Stack (3.3)**
      O(1) Free-Index-Stack statt O(n) `.find()` in three-effects.renderer.ts
- [x] **Konfigurierbares FPS-Limit (3.4)**
      `setFpsLimit()`/`getFpsLimit()` in three-tiles-engine.ts, skip-frame in rAF-Loop, localStorage-Persistenz
- [x] **Range-Indicator Material teilen (3.5)**
      Shared Material statt `.clone()` pro Tower in three-tower.renderer.ts
- [x] **Audio LRU Map (3.6)**
      Map-basiertes LRU mit Zeitstempel-Counter statt indexOf+splice in audio-buffer-cache.ts
- [x] **Floating Text Limit erhoeht**
      maxFloatingTexts 50 → 200 in visual-effects.config.ts
- [x] **17 neue Tests**
      geo-utils (7), effects-renderer (4), audio-buffer-cache (6), Test-Mocks aktualisiert

### GPU Instanced Enemy Rendering (VAT System)

- [x] **GPU Instanced Enemy Renderer mit VAT-Animation**
      Neues Rendering-System: Skelettanimationen in DataTextures gebacken (Vertex Animation Textures),
      pro Enemy-Typ nur 1 InstancedMesh statt 1 Object3D pro Enemy. ~1000 → ~14 Draw Calls bei 500 Enemies.
- [x] **VAT Texture Tiling fuer grosse Modelle**
      Modelle mit >8192 Vertices (Wallsmasher: 17010, Herbert: 30831) werden auf mehrere Zeilen
      in der VAT-Textur verteilt, um WebGL MAX_TEXTURE_SIZE nicht zu ueberschreiten.
- [x] **Multi-Mesh Merge fuer statische Modelle**
      `bakeStaticVAT` merged alle Sub-Meshes eines Modells in eine Geometrie (z.B. Tank: 7 Meshes).
      Positionen und Normalen werden korrekt in Root-Space transformiert.
- [x] **Per-Vertex Multi-Material Support**
      Per-Vertex `aVertexColor` und `aUseMap` Attribute erlauben korrekte Darstellung von
      Multi-Material-Modellen (Textur-Meshes + Farb-Meshes gemischt).
- [x] **World-Space Beleuchtung im VAT Shader**
      4-Punkt-Beleuchtung (Sun + Fill + Hemi + Ambient) in World-Space.
      Normalen via `mat3(instanceMatrix) * normal` transformiert.
- [x] **Instanzierte Health Bars**
      Alle Health Bars in 1 Draw Call via InstancedMesh + prozeduralem Shader.
      Billboard-Orientierung, Farbverlauf (Gruen→Gelb→Rot), Boss-Support.
- [x] **Largest SkinnedMesh Selection**
      Bei Modellen mit mehreren SkinnedMeshes (z.B. Spider) wird automatisch
      das groesste nach Vertex-Count gewaehlt.
- [x] **Enemy-Limit auf 20.000 erhoeht**
      MAX_INSTANCES_PER_TYPE, MAX_HEALTH_BARS, Wave-Debug UI + Service Limits angepasst.
- [x] **Boss-Fallback auf klassischen Renderer**
      Boss-Enemies nutzen weiterhin ThreeEnemyRenderer mit vollem Object3D + AnimationMixer.
- [x] **Dokumentation: INSTANCED_ENEMY_RENDERING.md**
      Umfassende technische Dokumentation des VAT Instancing Systems.

---

## 2026-02-12

- [x] **GameSpeedComponent ins UI eingebaut** `73818a1`
      Speed-Button (1x/2x/4x) erscheint oben-mittig während aktiver Welle
- [x] **Gatling Dual Fire** `84167e8`
      Neues `firePoints` Config-Feld für Multi-Barrel-Tower, Projektile alternieren links/rechts (±0.9m)
- [x] **Animation LOD Schwellen gelockert** `73818a1`
      50/100/200m → 80/150/250m, >250m jetzt jeden 10. Frame statt komplett skip
- [x] **Rechtsklick-Kontextmenü auf gesamtem Game-UI deaktiviert** `81b2f0a`
      `contextmenu.preventDefault()` auf dem Root-Container, blockt Browser-Menü auf Canvas, Sidebar, Header, Buttons
- [x] **Rechtsklick im Build-Mode fixt** `0b50cce`
      Rechtsklick platziert keinen Turm mehr, stationärer Rechtsklick bricht Build ab, Rechts-Drag rotiert Kamera

---

## 2026-01-31

### Phase 1: Engine Foundation (abgeschlossen)

- [x] **Performance Instrumentation** `febf3bb`
      Subsystem-Timings (Tower/Projectile/Combat/Events), Frame-Budget-Tracking, Bottleneck-Erkennung

### Phase 2: Engine Performance (abgeschlossen)

- [x] **TowerCombatService Fallback-Path optimieren** `78031de`
      Nutzt jetzt `getEnemiesInRadius()` direkt statt brute-force
- [x] **Animation LOD System** `397d6f8`
      Distance-LOD: <50m=jeder Frame, 50-100m=jeder 3., 100-200m=jeder 6., >200m=skip
      Staggered per Enemy, DeltaTime-Kompensation
- [x] **Tiles Update Throttling**
      Nur Update wenn Kamera >5m bewegt
- [x] **Partikel Free-List**
      O(1) Spawning per Free-Stack pro Pool, Fallback auf Round-Robin
- [x] **Precision Qualifiers in Shadern**
      `precision highp float;` in 8 Fragment-Shadern ergänzt
- [x] **Magic Orb Shader vereinfachen** `44bdacd`
      FBM 4→1, Voronoi 3×3→2×2, ~60-80 ALU (von 200-300)
- [x] **Bounding Sphere Culling** `44bdacd`
      `intersectsSphere` statt `containsPoint` in Tower-Renderer
- [x] **Tower Frustum Culling** `2a47f45`
- [x] **Selection Ring Geometry teilen** `4e89cc3`
      Static shared Geometry + Material mit Ref-Counting
- [x] **Partikel-Systeme konsolidieren** `fd5d524`
      4 → 2 Draw Calls — Blood+Fire Pools entfernt, in Trail-Pools integriert
- [x] **HQ Explosion Partikel reduzieren** `2a47f45`
      1350 → 500 Partikel, größere Sizes als Kompensation
- [x] **Spatial-Grid für Kollisionserkennung**
      Uniform Grid, O(1) Insert/Remove, O(k) Radius-Queries
      Integriert in TowerCombatService (Sleep-Check, Targeting)
- [x] **A* MinHeap**
      MinHeap Binary Heap in OsmStreetService + Pathfinding Worker
- [x] **Sleeping Towers** `7f3e3e2`
      Sleep nach 2s ohne Target, Wake via SpatialGrid hasEnemyInRadius

### Phase 3: Engine Polish (teilweise abgeschlossen)

- [x] **CombatEffectService refactoren** `a8bd3ce`
      Aufgeteilt in: StatusEffectService, CombatVfxService, DamageApplicationService + Facade
- [x] **spatial-audio.manager.ts splitten** `b521837`
      4 Module: AudioBufferCache, AudioPoolManager, SpatialAudioPlayback, SpatialAudioManager
- [x] **Tower-Distance-Berechnungen zentralisieren** `a8bd3ce`
      Nutzt jetzt `geoDistanceFast()` aus `geo-utils.ts`
- [x] **Custom-Error-Klassen** `a8bd3ce`
      `GameError`, `AssetLoadError`, `PathfindingError`, `GameStateError` in `src/app/models/errors.ts`
- [x] **Integration-Tests: Manager-Interaktionen** `b140a8a`
      46 Tests in 5 Suites (Combat, Waves, Movement, Effects, Lifecycle)

### Phase 4: Game Features (teilweise abgeschlossen)

- [x] **Bloom Post-Processing** `7f05a6c`
      UnrealBloomPass, default OFF, togglebar
- [x] **Screen Shake bei Explosionen**
      XZ-Shake mit Intensity-Presets (Bullet→Cannon→Rocket→HQ→Boss), togglebar
- [x] **Muzzle Flash bei Tower-Schüssen**
      3-5 Additive Partikel + PointLight bei Projectile-Towers
- [x] **Freeze-Visual-Effect für Ice-Slow**
      Blaue Emissive-Tint + 3 orbitierende Frost-Partikel
- [x] **Sprite-Sheet-Partikel-System**
      4×4 Atlas prozedural generiert, animierte Explosionen
- [x] **Projektil-Trail-Streaks** `d6b1a17`
      Ribbon-Renderer mit 6 Styles, 60 Instanzen/Typ, Alpha-Fade
- [x] **Color-Grading-LUT** `b6fac01`
      Dark Fantasy, Noir, Warm Sunset Presets, localStorage-Persistenz
- [x] **Spielgeschwindigkeit-Auswahl (Timescale)** `3dc21fc`
      UI ↔ GameStateManager bidirektional synchronisiert
- [x] **Rechtsklick bricht Baumodus ab**
      contextmenu-Handler cancelt Placement + preventDefault
- [x] **Tower-Targeting-Strategien**
      Implementiert: closest, lowest-hp, highest-hp, first, air-priority
      Defaults pro Tower-Typ konfiguriert
- [x] **Tower-Targeting-UI Selector**
      Button-Leiste in Sidebar zwischen Stats und Upgrades
      5 Strategien mit Material Icons + Tooltips, Teal-Highlight für aktive Strategie

---

## 2026-01-29

### Engine Foundation — Phase 1 Abschluss

- [x] **IGameManager Lifecycle-Interface**
      Interface mit `initialize()`, `update(dt)`, `destroy()` — formaler Contract für alle Manager
      EntityManager (abstrakt) + WaveManager implementieren IGameManager
      Dateien: `game-engine/game-manager.interface.ts`, `managers/entity-manager.ts`, `managers/wave.manager.ts`

- [x] **Timeout-Tracking in EnemyManager**
      `activeTimeouts: Set` trackt alle setTimeout-Aufrufe (Death-Animations, Spawn-Delays)
      Self-Cleaning Pattern: Callback löscht sich selbst aus dem Set
      `clear()` + `destroy()` clearen alle pending Timeouts — verhindert Ghost-Callbacks nach Reset

- [x] **Performance-Regression-Tests (8 Tests)**
      EntityManager: add/update/remove/getById mit 200 Entities, explizite ms-Schwellenwerte
      GameEventBus: 100 Handler × 100 Events, 1000 Emits, 500 deferred Queue, Subscribe/Unsubscribe
      Datei: `game-engine/performance.spec.ts`

- [x] **timing.config.ts — Magic Numbers eliminiert**
      5 zentrale Konstanten: deathAnimationDuration (2000ms), defaultSpawnStartDelay (300ms),
      losRecheckInterval (300ms), gameOverScreenDelay (3000ms), rewardPopupDuration (1200ms)
      Ersetzt in: EnemyManager, GameStateManager, Tower Entity, HQDamageService

- [x] **GamePhase Type Duplikat aufgelöst**
      Zentraler Type `GamePhase` in `models/game.types.ts` (Single Source of Truth)
      Re-Export in `wave.manager.ts` für Abwärtskompatibilität
      `game-state-snapshot.ts` + `ai-data-collector.service.ts` auf Import umgestellt

- [x] **Three.js Resource Disposal verbessert**
      `disposeObject()` disposed jetzt alle Texture-Maps (roughnessMap, metalnessMap, emissiveMap, aoMap)
      `dispose()` cleared towers Map explizit für GC
      Datei: `three-engine/renderers/three-tower.renderer.ts`

### Vitest Test-Infrastruktur

- [x] **Vitest Setup + 79 Unit Tests**
      `vitest.config.ts` (jsdom, globals), Three.js Mock, npm Scripts
      12 Test-Dateien: GameEventBus (21), GameObject (7), HealthComponent (6),
      TransformComponent (3), MovementComponent (6), CombatComponent (3),
      Enemy Entity (5), Tower Entity (4), Projectile Entity (3),
      EntityManager (9), Tower Types Config (8), Enemy Types Config (4)
      Alle Tests grün in ~2.8s

### EventBus-Entkopplung (Refactoring)

- [x] **credits:changed Events** — Alle Credit-Mutationen emitten via `updateCredits()` Helper
- [x] **VFX über EventBus** — `vfx:blood`/`vfx:explosion` via deferred Events statt Direct-Calls
- [x] **Game Lifecycle Events** — game:started/paused/resumed bei Wave-Transitions
- [x] **tower:upgraded Event** — Emittiert nach Upgrade mit tower, level, cost
- [x] **Debug-Commands entkoppelt** — debug:spawn-enemy/kill-all/reset-wave als Events
      Dateien: game-event-bus.ts, game-state.manager.ts, combat-effect.service.ts,
      vfx.service.ts, enemy.manager.ts, wave.manager.ts, tower-defense.component.ts

### Bugfixes

- [x] **AI Wave NaN-Bug gefixt (Event-Reihenfolge)**
      Problem: `game:started` wurde NACH `wave:started` emittiert → AIDataCollector.clearHistory()
      löschte das gerade initialisierte Wave-Tracking → `damagePercent: undefined` in History →
      `reduce(a + undefined) = NaN` → ONNX Model Input NaN → alle Outputs NaN → `enemyCount: NaN` →
      Endlos-Spawn ab Wave 2.
      Fix: `game:started`/`game:resumed` werden jetzt VOR `startWave()`/`beginWave()` emittiert.
      Datei: `managers/game-state.manager.ts`

- [x] **NaN-Guard in WaveManager (Sicherheitsnetz)**
      `startWave()` validiert `enemyCount` gegen NaN/Infinity/negativ → Fallback auf 10.
      Consecutive-Failure-Guard bricht Spawning ab wenn keine Paths verfügbar.
      Datei: `managers/wave.manager.ts`

### GameEventBus Analyse

- [x] **Abhängigkeits-Analyse erstellt**
      `docs/EVENTBUS-ANALYSIS.md` — 10 harte Abhängigkeiten, 5 fehlende Events,
      2 suboptimale Nutzungen, Refactoring-Reihenfolge dokumentiert.
      Hauptproblem: GameStateManager als God-Object, fehlende Event-Emissionen
      (credits:changed, game:started/paused/resumed, tower:upgraded)

---

## 2026-01-28

### Floating Text (Reward Popup) Bugfix

- [x] **Exponentielle Vergroesserung gefixt**
      Problem: Reward-Text (+Credits) wurde mit jedem Frame groesser
      Ursache: `sprite.scale.clone()` holte aktuelle (bereits vergroesserte) Scale
      Fix: `baseScaleX`/`baseScaleY` in FloatingTextInstance gespeichert
      Dateien: `three-effects.renderer.ts`

- [x] **Reward-Text Groesse angepasst**
      Scale von 2.5 auf 0.75 reduziert (war viel zu gross)
      Datei: `game-state.manager.ts`

---

## 2026-01-27

### Tower Turret Rotation Fix

- [x] **Neues Config-Feld `turretBarrelOffset` eingefuehrt**
      Problem: Tuerme zielten ~180° falsch nach Config-Aenderungen (rotationY fuer visuelle Ausrichtung)
      Ursache: `rotationY` wurde fuer zwei Zwecke verwendet:
      1. Visuelle Basis-Ausrichtung (z.B. 180° damit Tower nach Sueden zeigt)
      2. Turret-Barrel-Orientierung im Model (z.B. -90° bei dual-gatling)
      Fix: Neues Feld `turretBarrelOffset` fuer Barrel-Orientierung im Model-Space
      - archer: 0 (default, Laeufe zeigen -Z)
      - dual-gatling: -1.5708 (-90°, Laeufe zeigen +X)
      - ice: 1.047 (60°, Model-spezifisch)
      - cannon, magic, rocket: 0 (default)
      Dateien: `tower-types.config.ts`, `three-tower.renderer.ts`

### Tower Placement Verbesserungen

- [x] **Scan-Animation nach Tower-Platzierung**
      Feature: Turrets drehen nach Platzierung 75° links, 75° rechts, dann zurueck zur Mitte
      - 800ms Verzoegerung vor Scan-Start
      - Scan wird sofort abgebrochen wenn Feind erkannt wird
      - Magic Tower behaelt spezielles Idle-Spin-Verhalten nach Scan
      Datei: `three-tower.renderer.ts`

- [x] **Placement Sound hinzugefuegt**
      Sound `building_placed.mp3` wird bei Tower-Platzierung abgespielt
      - Raeumlicher Sound an Tower-Position (refDistance: 50, volume: 0.6)
      - Sound wird als 'tower-placed' registriert bei Manager-Initialisierung
      Datei: `tower.manager.ts`

### Magic Tower Visual Improvements

- [x] **Spiral Trail fuer Magic Tower**
      Neuer Trail-Typ `spiral` fuer railgun-artigen Effekt statt feuer-artige Partikel
      Config-Optionen:
      - `trailType: 'spiral'` - Partikel rotieren um Projektil
      - `spiralRadius: 1.5` - Radius der Spirale
      - `spiralSpeed: 8.0` - Rotationsgeschwindigkeit
      Magic Fireball verwendet jetzt Spiral-Trail mit roten Farben
      Dateien: `projectile-types.config.ts`, `three-effects.renderer.ts`

### Bugfixes

- [x] **Debug Enemy Cleanup bei Wave-Ende**
      Problem: Nach Wave-Ende blieben orphaned Debug-Enemy-Referenzen erhalten
      - Enemies verschwanden visuell aber wurden weiter beschossen
      - Combat lief weiter wegen `hasDebugEnemies` Check
      Fix: `clearDebugEnemies()` wird jetzt aufgerufen bei:
      - Wave Complete (checkWaveComplete)
      - Game Over (triggerGameOver)
      - Reset
      Datei: `game-state.manager.ts`

---

## 2026-01-25

### Bugfixes & Training Verbesserungen

- [x] **Wave 1 Stuck Bug gefixt**
      Problem: Nach Game Over blieb das Spiel manchmal auf Wave 1 stecken
      Ursachen:
      - `waveManager.reset()` setzte nicht `expectedEnemyCount`/`spawnedEnemyCount` zurueck
      - Race Condition in `startWaveWithAI()` (mehrfache Aufrufe)
      - `AutoStartWaveStrategy` blockierte wenn Bot auf 2. Tower wartete
      Fix:
      - Spawn-Counter Reset in `wave.manager.ts`
      - `pendingAIWaveRequest` Flag gegen Race Conditions
      - 5-Sekunden Timeout in `AutoStartWaveStrategy` zum Erzwingen des Wave-Starts
      Dateien: `wave.manager.ts`, `tower-defense.component.ts`, `auto-start-wave.strategy.ts`

- [x] **Reward-Anzeige Bug gefixt**
      Problem: Floating Text zeigte statischen `typeConfig.reward` statt dynamischen Reward
      (z.B. Herbert mit 55 HP zeigte +15 statt +1)
      Fix: Floating Text von `combat-effect.service.ts` nach `game-state.manager.ts` verschoben
      wo korrektes `event.credits` verfuegbar ist
      Dateien: `combat-effect.service.ts`, `game-state.manager.ts`

- [x] **Dynamische Rewards auf ~1/3 reduziert**
      Vorher: HP/50, Speed/5, Scale 0.6, Cap 40
      Nachher: HP/150, Speed/10, Scale 0.4, Cap 25
      Grund: Rewards waren zu grosszuegig, Wirtschaft eskalierte zu schnell
      Datei: `enemy.manager.ts`

- [x] **Training-Limits erhoeht (nur AI Training)**
      Tower-Limit: 20 → 50 (strategist bot)
      Episode-Length: 20 → 100 Waves
      Grund: Mehr Daten fuer spaete Spielphasen mit hoher DPS
      Dateien: `tower-bot.interface.ts`, `config.py`

### Game Rebalancing - Schwierigkeitsanpassung

- [x] **Tower Balancing**
      Archer: cost 20→45, sellValue 12→27 (Cost/DPS 0.80→1.80)
      Magic: cost 150→120, sellValue 90→72
      Cannon: cost 175→140, sellValue 120→84
      Ice: cost 120→90, sellValue 72→54
      Rocket: sellValue 120→60 (Bug-Fix: war > cost!)
      Datei: `src/app/configs/tower-types.config.ts`

- [x] **Wirtschaft verlangsamt**
      startCredits: 70→50, waveBonus: 50→35
      Kill-Rewards werden relevanter (~40% statt ~20%)
      Datei: `src/app/configs/game-balance.config.ts`

- [x] **Dynamische Enemy-Rewards**
      HP-basierte Berechnung mit Speed-Bonus
      scaleFactor mit sqrt() verhindert Inflation
      Cap bei 1-40 Credits
      Datei: `src/app/managers/enemy.manager.ts`

- [x] **Bot-Fixes (StrategyBot)**
      makeSuboptimalAction() implementiert (war leer)
      Spar-Rate 60%→30% reduziert
      Archer-Limit: max 4, dann Alternativen
      Dateien: `strategy-bot.ts`, `distributed-placement.strategy.ts`

- [x] **AI Parameter angepasst**
      KILL_TIME_MIN: 1.5→2.0s (laengere Kaempfe)
      KILL_TIME_MAX: 4.0→5.0s (mehr Range)
      HEALTH_MULTIPLIER_MAX: 20.0 (neuer Cap)
      Dateien: `config.py`, `server.py`

- [x] **Legacy Bot-Klassen entfernt**
      Geloescht: beginner-bot.ts, casual-bot.ts, strategist-bot.ts, smart-tower-bot.ts
      Nur noch StrategyBot mit Strategy-Pattern
      Datei: `src/app/ai/training/bots/index.ts`

- [x] **Enemy-Types Cleanup**
      damage-Feld komplett entfernt (wird nicht verwendet)
      reward-Werte mit Kommentar "only without AI"
      Datei: `src/app/models/enemy-types.ts`

- [x] **Balancing-Dokumentation**
      Vollstaendiger Plan in `docs/REBALANCING.md`
      HP-Tabelle fuer alle Enemy-Typen bei verschiedenen healthMultiplier

### AI Training v3.4 - Anti-Kollaps Fixes

- [x] **Kollaps-Analyse nach 32k Episoden**
      Training kollabierte bei E6000-8000 (Reward 0.43→0.02)
      Ursachen: Type-Kollaps (89% herbert/tank/bat), Boring-Exploitation
      Analyse-Script `analyze_log.py` fuer Trend-Erkennung

- [x] **Config-Anpassungen**
      ENTROPY_COEF: 0.04 → 0.08 (mehr Exploration)
      REWARD_BORING_THRESHOLD: 0.20 → 0.30 (hoehere Schwelle)
      REWARD_VARIETY_BONUS: 0.15 → 0.20 (staerkerer Diversity-Anreiz)
      TYPE_COOLDOWN_WAVES: 2 → 4 (laengere Typ-Sperre)

- [x] **Rollback zu Checkpoint 5000**
      2679 Checkpoints nach E5000 geloescht
      Training neu gestartet mit v3.4 Config
      Type-Verteilung jetzt: 5 von 6 Typen bei ~20%

- [x] **Dashboard Mobile-Support**
      Server bindet auf 0.0.0.0:3002
      Responsive CSS fuer Smartphones (<600px)
      Zugriff via http://<ip>:3002 vom Handy

- [x] **Dashboard Fixes**
      JSON-Fehler bei best_reward=-inf gefixt
      Progress Distribution Flatline-Bug gefixt

### AI Wave Director System

- [x] **AI Data Collection (Phase 5.1)**
      AIDataCollectorService, GameStateSnapshot (74 Features inkl. DPS-Profile)
      WaveResult Interface, Defense-Analyzer mit Vulnerability Detection
      Dateien: `src/app/ai/core/`

- [x] **Inference Pipeline (Phase 5.2)**
      GameStateEncoder (74 Features), WaveDirectorService mit TensorFlow.js
      Fallback Wave Generator (regelbasiert), Decision Explainer
      WaveConfigAdapter für WaveManager-Integration

- [x] **Training Infrastructure (Phase 5.3)**
      Python Backend: WebSocket Server (:3001), PPO Trainer, Reward Function
      Conv1D + Dense Model (DPS-Profile als räumlicher Input)
      TrainingClientService (Browser), Strategy Bot System
      Dateien: `training-backend/`, `src/app/ai/training/`

- [x] **Training UI (Phase 5.4)**
      Web Dashboard (FastAPI :3002): Live Charts, Model Metrics, DPS-Profiles
      Training-Debugger Component (In-Game)
      Bot-Selection via Backend, ONNX Model Export

- [x] **Strategy Bot System**
      StrategyBot mit Composition Pattern (pluggable Strategies)
      5+ Strategies: AntiAir, Splash, Distributed, Upgrade, AutoWave
      4 Skill Levels: Beginner, Casual, Strategist, Meta
      Datei: `src/app/ai/training/bots/`, `strategies/`

### Dokumentation

- [x] **AI-Dokumentation reorganisiert**
      AI_TRAINING_BACKEND.md → training-backend/docs/
      AI_TRAINING_SESSION_NOTES.md → training-backend/docs/
      BOT_SYSTEM.md → docs/
      DEVWORLD.md erstellt (basierend auf Code-Analyse)

- [x] **Veraltete Docs bereinigt**
      MASSNAHMEN_review_20260120.md gelöscht (Duplikat von TODO.md)
      DEVWORLD_PLAN.md gelöscht (bereits implementiert)
      tasks/FPS_LIMIT.md gelöscht (in TODO.md integriert)

- [x] **CLAUDE.md aktualisiert**
      Neue Pfade für AI-Dokumentation
      Training-Backend Sektion hinzugefügt

### Code Quality

- [x] **53 ESLint Fehler behoben**
      Unused vars mit `_` prefix oder entfernt
      Explicit any: proper types oder eslint-disable
      Case declarations: block scope
      Empty functions: eslint-disable

---

## 2026-01-20

- [x] **Codebase auf Englisch umgestellt** - Vollständige Übersetzung
      ~20 Dateien: UI-Strings, Tooltips, Error-Messages, Loading-States, Kommentare
      Services, Components, HTML-Templates, Config-Dateien

---

## 2026-01-19

- [x] **Koordinaten-Typen vereinheitlichen** - GeoPosition als Standard
      Alle Typen auf `GeoPosition` ({lat, lon, height?}) konsolidiert
      `LocationCoords` entfernt, `latitude/longitude` überall zu `lat/lon`

- [x] **Scrollbar Styling** - Einheitliches Theme für Debug-Panels
      Globale `TD_SCROLLBAR_STYLES` und `TD_SCROLLBAR_WEBKIT` in `td-theme.ts`
      Angewendet auf: `event-debugger`, `sound-debugger`, `draggable-debug-panel`

- [x] **TowerDefenseComponent Aufteilung abgeschlossen** - Keine weitere Aufteilung nötig
      ~1797 Zeilen, davon Großteil Signal-Proxies, Lifecycle-Hooks und Service-Delegierungen
      21 Services injiziert, Komponente fungiert korrekt als Orchestrator

- [x] **Event Debug Panel Position Fix** - Panel springt nicht mehr beim Öffnen
      `constrainToViewport()` mit `requestAnimationFrame` verzögert, damit DOM korrekte Größe hat

- [x] **Browser Geolocation API** - Automatische Standortermittlung implementiert
      `GeolocationService` mit Fallback-Kaskade: Browser GPS/WLAN → IP-API (ip-api.com)

- [x] **World Dice** - Random Street Generator
      Wikidata SPARQL für zufällige Stadt + Overpass API für Straße
      Würfel-Button in Header + Location-Dialog

- [x] **World Dice Loading Feedback** - Loading Overlay beim Würfeln
      Steps: "Würfle Stadt..." (mit Detail) → "Lade Karte..." (mit Stadtname)

- [x] **Location Sharing via URL** - Shareable Links funktionieren
      URL-Parameter `?l=lat,lon&s=spawns` aktiv, Share-Button kopiert Link

### Game Engine - Event Bus System (Phase 10 abgeschlossen)

- [x] **game:over Event (Phase 10a)**
      - `onGameOverCallback` aus GameStateManager entfernt
      - GameStateManager emittiert `game:over` Event mit `reason: 'base-destroyed' | 'quit'`
      - `getEventBus()` Getter hinzugefügt für externe Subscriptions
      - TowerDefenseComponent subscribed zu `game:over` Event
      - LocationChangeCoordinatorService: `onGameOver` aus Interface entfernt

- [x] **EventBusDebugPanel (Phase 10b)**
      - Neue Komponente: `event-debugger.component.ts`
      - Zeigt alle Events in Echtzeit via `eventBus.onAny()`
      - Filter nach Kategorie: enemy, tower, wave, game, vfx, audio
      - Farbcodierte Event-Typen mit Timestamp
      - Pause/Resume und Clear-Funktion
      - **Resizable Panel** mit persistierter Größe
      - Button in QuickActions (cell_tower Icon)
      - GameEventBus erweitert um `onAny()` und `debugListeners`

- [x] **DraggableDebugPanel Resize-Feature**
      - `[resizable]` Input (default: false)
      - `[size]` Input und `(sizeChange)` Output
      - Resize-Handle unten rechts (drag_indicator Icon)
      - Min-Size: 300x200px, Viewport-Constraints
      - DebugWindowService: `WindowSize` Interface, `updateSize()`, `getSize()`
      - Größe wird im localStorage persistiert (v4)

- [x] **Event Cleanup**
      - `damage:dealt` Event entfernt (redundant mit `projectile:hit`)
      - Lint-Fixes: eslint-disable für legitimes `any`, unused vars

- [x] **Event Bus Core implementiert**
      - `GameEventBus` mit 20 Event-Typen (discriminated unions)
      - Immediate Events (`emit`) für game-kritische Aktionen
      - Deferred Events (`emitDeferred`) für VFX/Audio
      - `processQueue()` am Frame-Ende
      - WeakMap-basiertes Subscription-Tracking

- [x] **Manager auf Event-System umgestellt**
      - `ProjectileManager`: emittiert `projectile:hit`, `vfx:projectile-impact`
      - `EnemyManager`: emittiert `enemy:died`, `enemy:reached-base`
      - `WaveManager`: emittiert `wave:started`, `wave:completed`
      - Alle drei: `@Injectable` entfernt, Constructor Injection
      - Provider aus TowerDefenseComponent entfernt

- [x] **Services event-driven**
      - `VFXService`: subscribed zu `vfx:projectile-impact`
      - `CombatEffectService`: subscribed zu `projectile:hit`
      - `handleProjectileHit()` aus GameStateManager entfernt

- [x] **Audio via Events (Phase 7)**
      - `AudioService`: subscribed zu `audio:play` Events
      - Event-Typ `audio:play` auf Geo-Koordinaten erweitert (`lat`, `lon`, `height`)
      - `ProjectileManager`: emittiert `audio:play` statt direktem `spatialAudio.playAtGeo()`
      - `HQDamageService`: emittiert `audio:play`, `initialize()` um `eventBus` erweitert
      - Neue Datei: `src/app/game-engine/audio.service.ts` (56 LOC)

- [x] **TowerManager refactored (Phase 8)**
      - `@Injectable()` entfernt, Constructor Injection `(eventBus, osmService)`
      - Emittiert `tower:placed` mit cost, neue `sell()` Methode emittiert `tower:sold`
      - Event-Typ `tower:placed` auf `GeoPosition` geändert (statt Vector3)
      - GameStateManager: `inject(OsmStreetService)` + manuelle TowerManager-Erstellung
      - Provider aus TowerDefenseComponent entfernt
      - **Alle 4 Entity-Manager jetzt framework-agnostic!**

- [x] **health:changed Event (Phase 9)**
      - GameStateManager emittiert `health:changed` statt direkter HQDamageService-Aufrufe
      - HQDamageService subscribed zu `health:changed` (Fire-Intensity + Damage-Sound)
      - Direkter `updateFireIntensity()` Aufruf aus Game-Loop entfernt
      - HQDamageService jetzt vollständig event-driven

- [x] **Architektur-Prinzip umgesetzt**
      - Angular nur fuer UI, Game Engine framework-agnostic
      - Hybrid: Events fuer Broadcasts, Spatial Grid fuer Queries
      - Dokumentation: [EVENT_SYSTEM.md](EVENT_SYSTEM.md)

### Refactoring
- [x] **Koordinaten-Typen vereinheitlicht**
      - Alle Typen auf `GeoPosition` ({lat, lon, height?}) konsolidiert
      - `LocationCoords` Interface entfernt (war identisch zu GeoPosition)
      - `latitude/longitude` überall zu `lat/lon` geändert (~50 Stellen)
      - `SpawnPoint` Interfaces konsolidiert (marker-visualization.service.ts als Quelle)
      - Betroffene Dateien: location.types.ts, wave.manager.ts, tower-placement.service.ts,
        street-rendering.service.ts, location-change-coordinator.service.ts, tower-defense.component.ts, u.a.

- [x] **LocationChangeCoordinatorService extrahiert**
      - Neue Datei: `src/app/services/location-change-coordinator.service.ts` (406 Zeilen)
      - `onApplyNewLocation()` von 215 auf 60 Zeilen reduziert
      - 7 Step-Methoden für Location-Change-Sequenz
      - Callback-Pattern für Component-Interaktion
      - TowerDefenseComponent: 1.954 → 1.799 Zeilen (-155)
      - GOD Object Refactoring Phase 2 komplett abgeschlossen

### Bugfixes
- [x] **Route Overlay "Routen anzeigen"** funktioniert wieder korrekt
      - Problem: Bei fehlendem Terrain (`originTerrainY === null`) wurde `showPathFromSpawn()` beendet ohne Route Line zu erstellen
      - Fix: Fallback auf `0` statt `return` - Route Line wird immer erstellt
      - Datei: `path-route.service.ts`

- [x] **Wave Debug Panel Delay** wirkt sich jetzt auf laufende Welle aus
      - Problem: `spawnDelay` wurde einmal zu Beginn der Welle gespeichert und nie aktualisiert
      - Fix: Neues `getSpawnDelay?: () => number` in `WaveConfig` - wird bei jedem Spawn aufgerufen
      - Dateien: `wave.manager.ts`, `tower-defense.component.ts`

- [x] **Route-Grid Animation beschleunigt sich mit jeder Wave**
      - Game Loop wurde bei jeder Wave erneut gestartet ohne den alten zu stoppen
      - Mehrere Loops liefen parallel → `updateAnimation()` wurde N-mal pro Frame aufgerufen
      - Fix: Guard in `startGameLoop()` verhindert mehrfache Loops

### UI
- [x] **Scrollbar Styling für Debug Panels**
      - Neue Theme-Konstanten: `TD_SCROLLBAR_STYLES`, `TD_SCROLLBAR_WEBKIT`
      - Dunkles Theme passend zum WC3-Style (Frame-Farben)
      - Cross-browser: Firefox (scrollbar-color) + Webkit (::-webkit-scrollbar)
      - Angewendet auf: event-debugger, sound-debugger, draggable-debug-panel

- [x] **Text-Selektion in UI deaktiviert**
      - `user-select: none` auf body
      - Input/Textarea bleiben selektierbar

### Architektur
- [x] **Game Loop Refactoring - Immer laufend**
      - **Problem**: Game Loop stoppte bei Wave-Ende → Projektile froren ein, Türme drehten nicht zu Idle
      - **Lösung**: Kein separater Game Loop mehr, alles über Engine-Callback `onEngineUpdate()`
      - Phase kontrolliert WAS passiert, nicht OB der Loop läuft
      - `startGameLoop()` komplett entfernt
      - `gameState.update()` refactored: Projektile + Tower-Idle immer, Rest nur während Wave
      - `killAllEnemies()` vereinfacht: Wave endet automatisch via `checkWaveComplete()`

---

## 2026-01-18

### Pathfinding
- [x] **Gewichtetes Pathfinding nach Straßentyp**
      - Primäre Straßen (primary, secondary, tertiary) bevorzugt
      - Residential/Service Straßen mit höherem Gewicht bestraft
      - Sauberer A* Algorithmus mit Typ-basiertem Weighting

### Loading & UX
- [x] **3D-Tiles Stats im Loading Screen**
      - Zeigt "Warte auf 3D-Kacheln (X Kacheln geladen)"
      - Retry-Mechanismus für sporadische 0-Tiles Probleme
      - Detaillierte Debug-Logs für Troubleshooting
- [x] **Detaillierter Loading-Screen**
      - Separater Loading-Step "Warte auf 3D-Kacheln"
      - Benutzerfreundliche Fehlermeldungen für OSM und WebGL
      - Zeigt einzelne Schritte: Route, Assets, Tiles
- [x] **Console-Trenner bei Location-Wechsel**
      - `═══════ Location Change: [Name] ═══════` zur besseren Übersicht
- [x] **Internationale Nominatim-Suche**
      - `accept-language: *` Header für weltweite Ergebnisse
      - Nicht mehr auf deutsche Ergebnisse beschränkt
- [x] **Robustes Location-Loading**
      - Error-Handling für fehlgeschlagene OSM-Requests
      - Graceful Degradation bei Netzwerkproblemen

### Bugfixes
- [x] **Retry-Mechanismus für 3D-Tiles Loading nach F5**
      - Fix für sporadisches "0 Kacheln geladen" Problem
      - Max 50 Retries á 200ms (10 Sekunden gesamt)
      - Force-Update bei persistentem Problem
      - Siehe [TILES_LOADING_BUG.md](TILES_LOADING_BUG.md) für Details
- [x] **Zombie-Textur Dateiname korrigiert**

### Refactoring
- [x] **Asset-Struktur vereinheitlicht und reorganisiert**
      - Konsistente Ordnerstruktur für Models, Textures, Audio
      - Alle Assets unter `assets/` mit klarer Hierarchie

### Performance: Assets
- [x] **Skybox WebP Conversion** - 48MB → 0.6MB (99% Reduktion!)
      - 8192×4096 JPEG → 4096×2048 WebP
      - `kloppenheim_06_puresky.webp`: 124KB (vorher 19MB)
      - `qwantani_night_puresky.webp`: 532KB (vorher 29MB)

### Audio System Refactoring
- [x] **Sound-Systeme konsolidiert** - Zentrale Loop-Verwaltung im SpatialAudioManager
      - `AudioComponent.activeLoops` → `SpatialAudioManager.activeLoops`
      - Neue API: `createLoop()`, `updateLoopPosition()`, `pauseLoop()`, `resumeLoop()`, `stopLoop()`
      - AudioComponent ist jetzt dünner Wrapper mit `loopHandles` Map
      - Distance-Culling und Enemy-Budget zentral verwaltet
      - Audio-Pool wird jetzt auch für Loops genutzt (vorher nur One-Shots)
- [x] **LRU Audio Buffer Cache** - Begrenzt auf 20 Buffers
      - `bufferAccessOrder[]` für LRU-Tracking
      - `evictOldestBuffers()` entfernt älteste Einträge bei Überschreitung
      - Verhindert unbegrenztes Wachstum (~30MB decoded Audio)

### 🔴 Performance Prio 1: Kritisch (alle erledigt)

- [x] **Shadow Flags entfernen** - GPU-Zyklen verschwendet für nie gerenderte Shadows
- [x] **Event Listener Cleanup** - Memory Leak bei Location-Wechsel behoben
- [x] **Timeout Cleanup bei Reset** - Timeouts feuern nicht mehr nach Game-Reset
- [x] **RxJS takeUntilDestroyed** - Subscription Leaks behoben
- [x] **Three.js Named Imports** - Tree-Shaking ermöglicht, -400KB Bundle
- [x] **herbert_talk.mp3 gelöscht** - 1.6MB unbenutzte Datei entfernt
- [x] **localStorage → IndexedDB** - StreetCacheService für große Caches
- [x] **OnPush ChangeDetection** - Alle 16 Components umgestellt
- [x] **Distance Audio Culling** - Sounds pausieren bei 500m+ Entfernung
- [x] **Material Pooling** - Shared Materials pro Enemy-Typ statt Clone pro Instanz

### UI/UX
- [x] **Tooltips im Baumenü nach links**
  - `matTooltipPosition="left"` für Tower-Cards und Upgrade-Buttons
  - Verhindert Überlappen mit rechtem Bildschirmrand

### Camera & Controls
- [x] **Shift + WASD/Pfeiltasten für schnelleres Panning**
  - Normal: 80 m/s, mit Shift: 200 m/s
  - `KeyboardPanService` trackt jetzt Shift-Modifier

### Air Tower Visualisierung
- [x] **Air Tower zeigen alle Zellen in Reichweite grün**
  - Pure Air Tower (`canTargetAir && !canTargetGround`) überspringen LOS-Checks
  - `isPureAirTower` Parameter in `registerTower()` und `createPlacementPreview()`
  - Sowohl nach dem Bauen als auch im Baumodus (Preview) korrekt

### Performance & Storage
- [x] **Straßen-Cache von LocalStorage auf IndexedDB migriert**
  - `StreetCacheService` (bereits implementiert) jetzt in `OsmStreetService` integriert
  - Unterstützt 50-100+ MB statt 5-10 MB localStorage Limit
  - LRU-Eviction (max. 5 Locations gecacht)

### Bugfix
- [x] **Grid/Tower-Visualisierung Flashing - präventiver Fix**
  - `animationTime` wird jetzt gewrappt um Float-Präzisionsprobleme bei langen Sessions zu vermeiden
  - Problem war schwer reproduzierbar (1x aufgetreten)

### Monetarisierung
- [x] **Ad-Banner System implementiert**
  - `AdBannerComponent` mit WC3-Style Design
  - Monetag Vignette Banner Integration (Zone 10479931)
  - Ads werden nur in Production geladen (`environment.production`)
  - Adblocker-Detection mit Bait-Element-Methode
  - Fallback-Panel bei Adblocker: Ko-fi Spenden-Button + GitHub Star
  - Komponente in Sidebar integriert (über Footer)
  - Kontextabhängige Größe vorbereitet (compact-Mode für aktive Wellen)

### Code Quality
- [x] **Environment-basierte Ad-Konfiguration**
  - Kein Ad-Script in index.html (dynamisches Laden)
  - Nur Production-Builds zeigen Werbung
  - Development bleibt werbefrei für bessere DX

### Performance & Privacy
- [x] **Self-hosted Fonts (kein Google CDN)**
  - `@fontsource/roboto` und `material-icons` npm Packages
  - Fonts werden lokal aus dem Bundle geladen
  - Keine externen Requests zu Google (DSGVO-konform)
  - Schnelleres Laden (kein DNS-Lookup, kein Roundtrip)

### DevOps
- [x] **FTP-Deploy optimiert (nur geänderte Dateien)**
  - `dangerous-clean-slate: false` statt true
  - FTP-Action speichert State in `.ftp-deploy-sync-state.json`
  - Nur neue/geänderte Dateien werden hochgeladen
  - Alte Dateien mit alten Hashes werden automatisch gelöscht
  - Deutlich schnellere Deploys nach initialem Sync

---

## 2026-01-17

### Neue Features
- [x] **Magic Tower mit animiertem Orb**
  - Neues `magic_tower.glb` Model mit `tower_top` Orb-Teil
  - Hover-Animation: sanftes Auf/Ab-Schweben (Amplitude 0.006, Speed 0.6 Hz)
  - Idle-Rotation: langsame kontinuierliche Drehung wenn kein Ziel (0.3 rad/s)
  - Zufälliger Phasen-Offset pro Tower für desynchronisierte Animationen
  - `tower_top` zu erkannten Turret-Part-Namen hinzugefügt
  - Sound bereits konfiguriert (`magic_cast.mp3` für fireball)

### Bugfixes
- [x] **Platzierte Tower bleiben grün nach Build-Preview**
  - `cloneModel()` im AssetManager klont jetzt alle Materialien tief
  - Verhindert Shared-State zwischen Model-Instanzen
  - Betrifft: Build-Preview, platzierte Tower, Baumenü-Previews

### Code Quality & Architektur
- [x] **Globaler Asset Manager** - 4 separate Model-Caches konsolidiert
  - Neuer `AssetManagerService` mit zentralem GLTFLoader/FBXLoader
  - Reference Counting fuer korrekte GPU-Resource Disposal (Memory Leak gefixt!)
  - Betroffene: ThreeTowerRenderer, ThreeEnemyRenderer, ModelPreviewService, TowerPlacementService
  - ~218 Zeilen duplizierter Code entfernt
  - Siehe: [EXPERT_REVIEW_2026.md#62-empfehlung-globaler-asset-manager](EXPERT_REVIEW_2026.md#62-empfehlung-globaler-asset-manager)

### Bugfixes
- [x] **Wave endet nicht wenn alle Gegner tot sind**
  - Root Cause: `kill()` dekrementierte `aliveCount` nur wenn `enemy.alive` true war
  - Problem: `takeDamage()` setzte bereits `alive=false` bevor `kill()` aufgerufen wurde
  - Fix: `aliveCount` wird jetzt immer in `kill()` dekrementiert (killingEnemies Set verhindert doppelte Zählung)
- [x] **Gegneranzahl zeigte gespawnte statt lebende Gegner**
  - Gleiche Ursache wie oben - `aliveCount` wurde bei Kills nicht reduziert
  - Fix behebt beide Bugs gleichzeitig

### Performance Optimierungen
- [x] **Splash-Damage via Grid-Lookup optimiert**
  - `GlobalRouteGrid.getEnemiesInRadius()` nutzt Zellen-basierte Suche
  - O(cells_in_radius) statt O(all_enemies) mit Haversine-Distanz
  - Betrifft: Cannon (16m), Ice-Shard (12m) Splash-Damage
  - `EnemyManager.getEnemiesInRadius()` als @deprecated markiert
- [x] **Reusable Vectors in ThreeEffectsRenderer**
  - `tempVelocity` als Klassenvariable statt `velocity.clone()` pro Partikel
  - 3 Hotspots in update() optimiert (Effect-Particles, Trail-Additive, Trail-Normal)
  - ~99% weniger GC-Druck bei Partikel-Updates
- [x] **Cached getAlive() Result im EnemyManager**
  - Array wird gecacht und nur bei spawn/kill/remove/clear invalidiert
  - getAliveCount() nutzt jetzt direkt das Signal statt Array-Allokation
- [x] **Fast-Distance statt Haversine fuer lokale Berechnungen**
  - `geoDistanceFast()` Wrapper in geo-utils.ts hinzugefuegt
  - projectile.entity.ts: 2x geoDistance → geoDistanceFast
  - ellipsoid-sync.ts: haversineDistance → fastDistance (6x schneller)
  - Flat-Earth Approximation ausreichend genau fuer <200m Game-Distanzen

### Sound System Audit & Performance Fixes
- [x] **Kritische Memory Leaks behoben**
  - setTimeout-Referenzen werden jetzt getrackt und bei Cleanup gecleaned
  - stopAll() entfernt jetzt ordentlich alle Container aus der Scene
  - Audio.disconnect() wird bei jedem Cleanup aufgerufen
  - Enemy Timer (randomSoundTimer) werden bei destroy() robuster gestoppt
- [x] **PositionalAudio-Pooling implementiert**
  - Pool von 20 vorallozierten PositionalAudio-Objekten (wächst bis 50)
  - Reduziert Garbage Collection Pressure erheblich
  - Bei 100 Arrow-Sounds/Sekunde: 0 neue Objekte statt 100/s
- [x] **Race Condition im Budget-System gefixt**
  - Enemy-Sound-Budget wird sofort registriert (vor await-Calls)
  - Verhindert Budget-Überschreitung bei parallelen Sound-Anfragen
  - Alle Early-Exit-Pfade cleanen jetzt ordentlich das Budget
- [x] **Algorithmus-Optimierungen**
  - stop() Methode: O(n²) → O(n) durch direktes Filtern statt indexOf+splice
  - update() bereits optimal (Position wird 1x berechnet für alle Loops)
- [x] **Error Recovery verbessert**
  - Retry-Mechanismus: 3 Versuche bei Buffer-Ladefehlern mit 1s Delay
  - Besseres Logging für Debugging
- [x] **Code-Vereinheitlichung**
  - Enemy-Sound-Erkennung zentralisiert in SpatialAudioManager
  - Nutzt ENEMY_SOUND_PATTERNS aus audio.config.ts (inkl. herbert)
  - Duplizierte isEnemySound() Methode in AudioComponent entfernt
- [x] **Dokumentation aktualisiert**
  - SPATIAL_AUDIO.md mit Performance-Optimierungen-Sektion erweitert

### Dokumentation (Phase 2 - Lücken schließen)
- [x] **Geo-Utils vollständig dokumentiert** (ARCHITECTURE.md Sektion 8.1)
  - haversineDistance vs fastDistance erklärt
  - Wann welche Funktion verwenden (Hot-Path vs Einmalig)
  - Performance-Vergleich (7x schneller bei fastDistance)
  - Beispiele und Migration-Guide
  - "Jedes Mal ein Thema" → Jetzt klar dokumentiert
- [x] **Blood & Fire Effects ausführlich dokumentiert** (ARCHITECTURE.md Sektion 11)
  - Blood Decal System: Instanced Rendering, Custom Shader, Config
  - Fire Effects: Intensitätsstufen, Partikel+Sound+Licht, Lifecycle
  - Performance-Details (500 Decals = 2 Draw Calls statt 700)
  - Konfiguration in visual-effects.config.ts
- [x] **Tower Upgrade System dokumentiert** (TOWER_CREATION.md)
  - Upgrade-Konfiguration (Stats, Multi-Level, Kosten)
  - Code-Beispiele für applyUpgrade()
  - Range-Upgrade Spezialfall (LOS-Grid Neuberechnung)
  - Praktische Beispiele (Archer Single, Magic Multi-Level)
- [x] **ARCHITECTURE.md Animation-Sektion gekürzt**
  - Von 40 auf 25 Zeilen reduziert
  - Verweise auf ENEMY_CREATION.md für Details
  - Fokus auf Architektur-Übersicht

### Dokumentation (Phase 1 - Neue Docs)
- [x] **ENEMY_CREATION.md erstellt**
  - Analog zu TOWER_CREATION.md
  - Enemy-Typen erstellen mit Animationen, Audio, Visual Effects
  - Run-Animation-System, Air Units, Boss Enemies dokumentiert
  - Checkliste und Troubleshooting
- [x] **STATUS_EFFECTS.md erstellt**
  - Status-Effekt-System vollständig dokumentiert
  - Slow-Effect Stacking-Verhalten erklärt
  - Freeze und Burn (geplant) beschrieben
  - Performance-Optimierungen dokumentiert
- [x] **WAVE_SYSTEM.md erstellt**
  - Wave-Management und Spawning-System dokumentiert
  - Gathering-Phase, Spawn-Modi (each/random)
  - Progressive Difficulty, Boss Waves
  - Testing und Debugging
- [x] **ARCHITECTURE.md Dateistruktur korrigiert**
  - `game/` Subfolder-Fehler behoben (Zeilen 728-813)
  - Korrekte Ordnerstruktur (kein game/ Subfolder)
  - Config-Dateien und Utils ergänzt
  - Docs-Liste aktualisiert
- [x] **INDEX.md aktualisiert**
  - Drei neue Dokumentationen hinzugefügt
  - Schnellnavigation erweitert
- [x] **TODO.md aktualisiert**
  - Erledigte Dokumentations-Tasks entfernt

### Magic Tower
- [x] **Magic Tower implementiert**
  - Grundgerüst mit Stats: 40 DMG, 70 Range, 1.5 Feuerrate, 150 Credits
  - Upgrade: "Arkane Macht" (+50% Schaden, 3 Stufen)
  - Custom GLSL Shader für magische Projektile:
    - Pulsierender Glow-Effekt (wirbelnde Voronoi + FBM Patterns)
    - Farbverlauf: Violett → Cyan → Weiß
    - Fresnel Edge-Glow, Additive Blending
  - Trail-Partikel (violett-cyan, additive)
  - Sound-Config vorbereitet (magic_cast.mp3)
  - Verwendet Archer-Model als Placeholder

### Performance
- [x] **Instanced Decal Rendering**
  - Blood/Ice Decals auf InstancedMesh umgestellt
  - Custom Shader für Decals (fade-out, color tinting)
  - ~250 Draw Calls → 2 Draw Calls (1 Blood-Pool, 1 Ice-Pool)
  - Decal-Farben und Settings in visual-effects.config.ts ausgelagert

### LOS & Tower Placement
- [x] **LOS Berechnung performanter machen**
  - Progressive LOS Preview: 25 Zellen pro Frame statt alle auf einmal
  - Radiiert vom Turm-Zentrum nach außen (visuell ansprechend)
  - Debounced bei 150ms um FPS-Drops zu vermeiden
- [x] **Keine LOS Berechnung bei ungültiger Position**
  - LOS Preview wird nur berechnet wenn Turm-Position valid ist
  - Bei "zu nah an Straße" etc. wird Preview übersprungen

### UI Improvements
- [x] **Tower Info Panel redesigned**
  - Stats als 2x2 Kacheln mit Icons (Schaden, Reichweite, Feuerrate, Kills)
  - Upgrade-Button größer und prominenter mit Gold-Gradient
  - Verkaufen-Button subtiler (transparent, rot bei Hover)
  - Baumenü versteckt wenn Tower selektiert (CSS display:none)
- [x] **Range Indicator vereinfacht**
  - Doppelter Ring (weiß + gold) durch einzelnen Gold-Ring ersetzt

### Fixes
- [x] **Game Over Cleanup**
  - Tower-Overlays und LOS-Visualisierungen korrekt bei Game Over
  - Particle Pool Exhaustion bei HQ Explosion gefixt (stopFireImmediate)
- [x] **Game Restart nach Game Over**
  - GlobalRouteGrid wird bei Restart neu initialisiert
  - Debug-Visualisierung wird korrekt neu erstellt
  - Enemies werden aus Grid entfernt bei clear()

---

## 2026-01-16

### Dokumentation
- [x] **DONE.md zu Changelog umstrukturiert**
  - Chronologische Sortierung (neueste zuerst)
  - Datumsabschnitte für bessere Übersicht
- [x] **CLAUDE.md aktualisiert**
  - TODO/DONE Beschreibung erweitert (Changelog-Format erklärt)
  - Service/Manager-Anzahl war bereits korrekt (19/7)
  - Dokumentations-Tabelle bereits vollständig
- [x] **src/app/README.md gelöscht**
  - Komplett veraltet (POC-Status, falsche Tower-Liste, alte APIs)
  - Ersetzt durch CLAUDE.md und docs/

### Effects & Explosions
- [x] **Projektile fliegen weiter wenn Ziel stirbt**
  - Projektil speichert letzte Zielposition wenn Gegner mid-flight stirbt
  - Flugbahn wird fortgesetzt zur letzten bekannten Position
  - Explosion am Boden (terrainHeight + 1)
  - Kein Damage-Handler bei Ground-Impact (nur visueller Effekt)
  - Betrifft alle Projektiltypen (Cannon, Rocket, Ice, etc.)
- [x] **Explosionshöhe für Air Units korrigiert**
  - Ice/Fire Explosionen erscheinen jetzt auf korrekter Höhe bei Luftgegnern
  - Berechnung: terrainHeight + heightOffset (+ 2 nur für Bodeneinheiten)
  - Fledermäuse: Explosion auf 15m Flughöhe statt am Boden
- [x] **HQ Explosion bei Zerstörung**
  - Massive 3-Phasen-Explosion (1350 Partikel total)
  - Phase 1: 450 Partikel zentrale Explosion
  - Phase 2: 600 Partikel Ring-Expansion
  - Phase 3: 300 Partikel aufsteigende Glut
  - Bestehendes Feuer wird zu Inferno skaliert (nicht ersetzt)
  - Feuer bleibt permanent (auch während Game Over Screen)
  - Game Over Screen nach 3 Sekunden
- [x] **Explosionen bei Rocket/Cannon Treffern**
  - Rocket: 50 Partikel, Radius 8
  - Cannon: 35 Partikel, Radius 6
  - Konfigurierbar via EXPLOSION_PRESETS in visual-effects.config.ts

### Code Quality (Expert Review Quick Wins)
- [x] **visual-effects.config.ts erstellen** - Partikel/Decal-Configs zentralisiert
  - Neues `configs/visual-effects.config.ts` mit PARTICLE_LIMITS, DECAL_CONFIG, FIRE_INTENSITY, EXPLOSION_PRESETS, EFFECT_COLORS
  - Entfernt hardcoded Werte aus three-effects.renderer.ts
- [x] **audio.config.ts erstellen** - Sound-Configs zentralisiert
  - Neues `configs/audio.config.ts` mit AUDIO_LIMITS, ENEMY_SOUND_PATTERNS, SPATIAL_AUDIO_DEFAULTS, GAME_SOUNDS
  - Entfernt aus: spatial-audio.manager.ts, game-state.manager.ts
- [x] **game-balance.config.ts erstellen** - Game Balance Werte zentralisiert
  - Neues `configs/game-balance.config.ts` mit player, waves, combat, effects, fire
  - Entfernt hardcoded Werte aus game-state.manager.ts
- [x] **PROJECTILE_SOUNDS in Config verschoben**
  - Sound-Konfiguration von projectile.manager.ts nach projectile-types.config.ts
  - Saubere Config-Struktur mit Interface `ProjectileSoundConfig`
- [x] **placement.config.ts erstellen** - Placement-Constraints dedupliziert
  - Neues `configs/placement.config.ts` mit MIN/MAX_DISTANCE Konstanten
  - Entfernt aus: tower.manager.ts, tower-placement.service.ts
- [x] **Reusable Vectors in ProjectileRenderer** - Object Allocation in Update-Loop eliminiert
  - Statische `_tempPos`, `_tempRot`, `_tempScale` in ProjectileInstanceManager
  - Keine `new Vector3()`/`new Quaternion()` mehr pro Frame
- [x] **GeoUtilsService erstellen** - Haversine-Distanzberechnung 5x dedupliziert
  - Neues `utils/geo-utils.ts` mit `haversineDistance()`, `fastDistance()`, `geoDistance()`
  - Entfernt aus: enemy.manager.ts, tower.manager.ts, game-state.manager.ts, projectile.entity.ts, movement.component.ts

---

## Frühere Änderungen (undatiert)

### Tower
- [x] **ICE Tower mit Slow Effekt**
  - Splash Damage Type (Gegner im Radius betroffen)
  - Generelles Debuff-System mit Statuseffekten
  - Kann Air und Ground Targets treffen
  - Wenig Schaden, primär für Slow-Effekt
  - Blauer Ice Partikel-Effekt für Projektil-Trail
  - Eis-Explosion beim Auftreffen
  - Hellblaue Eis-Decals auf dem Boden (analog Blutflecken)

### LOS (Line of Sight)
- [x] **Statisches Pfad-LOS-Grid**
  - 2m Grid entlang Route (±7m Korridor)
  - Bei Tower-Platzierung vorberechnet
  - O(1) Lookup zur Laufzeit
  - Shader-basierte Visualisierung mit Pulsing-Animation
- [x] **Tower LOS-Prüfung von Hülle statt Mitte**
  - Tower prüfen LOS ab ihrer äußeren Hülle, nicht vom Mittelpunkt
  - Relevant wenn Tower auf Gebäuden steht
- [x] **Hex-Grid Line-of-Sight Visualisierung**
  - Flat-Top Hexagon-Grid über Turm-Reichweite
  - Grün = sichtbar, Rot = blockiert (durch Gebäude)
  - LineOfSightRaycaster raycastet von Turm-Spitze zu Hex-Zellen
  - hasLineOfSight() API für Targeting-Entscheidungen
  - Gebäude-Verdeckung funktioniert via 3D-Tiles Mesh-Intersection

### Rendering
- [x] **Rocket Tower Helligkeit angepasst** - War dunkler texturiert als andere Tower
- [x] **Partikeleffekte für Projektile**
  - Raketen: große Partikel + Explosion
  - Normale Projektile: kleinere Partikel, keine Explosion
  - Archer: keine Partikel
- [x] **Dual Gatling Bogen-Bug gefixt** - Schoss fälschlicherweise im Bogen statt geradeaus
- [x] **Leuchtspurmunition für Dual Gatling** - Dezente, kleine Leuchtspureffekte
- [x] **Cannon, Magic, Sniper Tower deaktiviert** - Vorübergehend aus dem Spiel genommen

### Performance
- [x] **Animationen laufen langsamer bei niedrigen FPS** - Gefixt
  - Ursache war hardcoded 16ms statt echter deltaTime
  - Fix: Echte deltaTime Berechnung in three-tiles-engine.ts
- [x] **Straßen-Overlay FPS-Drop gefixt** (35 FPS → 144 FPS)
  - Problem: 200-600 separate THREE.Line Objekte mit je geklontem Material
  - Fix: Alle Straßensegmente in ein THREE.LineSegments mit Merged BufferGeometry
  - Ergebnis: 1 Draw Call statt 600+, ~10x bessere Performance
- [x] **Straßen-Rendering in großen Städten optimiert** (Berlin: 14s → <1s)
  - Problem: renderStreets() rief getTerrainHeightAtGeo() für jeden Node auf
  - Fix: Route-Korridor-Filterung (nur Straßen im 100m-Korridor um Route)
  - Ergebnis: 5000 → 150 Straßen, 50.000 → 1.500 Nodes
- [x] **A* Graph-Caching**
  - Problem: buildGraph() wurde bei jedem findPath() Aufruf neu erstellt
  - Fix: Graph einmal bauen und cachen (getOrBuildGraph)

### UI
- [x] **Location Dialog Styling** - An TD-Style angepasst (gleicher Background, kein Purple)
- [x] **Info Overlay** als transparente Angular Component oben links
  - Zuschaltbar über Button in Quick Actions
  - Zeigt: FPS, Tiles, Aktive Gegner, Aktive Sounds, Straßen-Count
- [x] **Wave Debug Component optimiert**
  - Kamera Debug und Log Textarea entfernt
  - Heal HQ und Kill Wave Buttons repariert
  - Slider erweitert: Anzahl bis 5000, Speed bis 100 m/s
- [x] **Sidebar neu strukturiert** (WC3/Ancient Command Style)
  - WELLE Section: Wave-Nummer, Gegner-Count, "Naechste Welle" Button
  - BAUEN Section: Tower-Buttons mit Kosten
  - TOWER Section: Details bei Selektion (Name, Stats, Upgrade/Verkaufen)
  - DEBUG Section
- [x] **3D Model Previews in Sidebar**
  - ModelPreviewService mit geteiltem WebGL-Renderer
  - Tower-Grid: 2x2 Kacheln mit rotierenden 3D-Modellen
  - Enemy-Preview: Animierter Gegner (Walk-Animation)
  - Siehe docs/MODEL_PREVIEW.md

### Kamera
- [x] **Kamera zurücksetzen Button repariert**
- [x] **Initiale Position optimiert** - 45° Blickwinkel, Blickrichtung Norden, HQ im Zentrum
- [x] **Automatisches Framing von HQ + Spawns**
  - Initiale Kamera zeigt HQ und alle Spawn-Punkte im Bild
  - Dynamische Kamera-Positionierung seitlich zur HQ-Spawn-Achse
- [x] **Kompass-Overlay** - Oben rechts, rotiert mit Kamera-Heading

### Gegner
- [x] **Spawn-Verhalten optimiert**
  - Gegner spawnen verzögert (konfigurierbar via Slider)
  - "Gegner sammeln sich..." Phase optional (Gathering Mode)
- [x] **Blutsystem**
  - Blutflecken bei Treffer und Tod
  - Decals faden nach 20s aus

### Projektile
- [x] **Line-of-Sight für Projektile** - Projektile erreichen Ziel nur bei bestehender Sichtverbindung

### Türme
- [x] **Tower Selektion** - Klick auf Tower selektiert ihn, Selection Ring Animation
- [x] **Tower-Details in Sidebar** - Name, Schaden, Reichweite, Feuerrate, Kills, Verkaufen-Button
- [x] **Radius-Anzeige** - Terrain-konform via TerrainRaycaster

### Gameplay
- [x] **Location-System** - User kann eigene Location wählen (siehe docs/LOCATION_SYSTEM.md)
- [x] **Spawn-Punkte** - Zufällig 500m-1km vom HQ, muss auf Straße liegen

### Audio
- [x] **Spatial Audio** - Soundlautstärke abhängig von Kameraentfernung (siehe docs/SPATIAL_AUDIO.md)

### Allgemein
- [x] **Route-Animation (Knight Rider Effekt)**
  - Animierte Visualisierung der Gegner-Route beim Spielstart
  - Leuchtende rote/orange Dashes laufen von Spawn → HQ
- [x] **Koordinaten-Paste im Location-Dialog**
  - Unterstützte Formate: Dezimal, DMS, Cardinal, Google Maps URLs

### Bug Fixes
- [x] **CesiumIonAuthPlugin Import-Pfad aktualisiert**
- [x] **Feuer am HQ bei Damage** funktioniert jetzt zuverlässig
- [x] **Gegner laufen nicht mehr in der Luft** am HQ
- [x] **Tower Selektion bei Pan** - Kein Deselect mehr bei Mausbewegung
- [x] **Tower Selektion/Deselektion** - Frischer Raycaster pro Aufruf (LoS korrumpierte Zustand)
- [x] **WASD in Eingabefeldern** - Keyboard-Events werden in Input-Feldern nicht mehr abgefangen
