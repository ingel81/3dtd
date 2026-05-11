# Offene TODOs

> **Philosophie:** Engine first, Game second.
> Erst die Engine stabil, performant und testbar machen — dann Features bauen.
>
> **Stand 2026-05-11:** Reorganisiert nach Prio-Layern.
> - **PRIO 1:** Engine & Umbauten (Engine-Bugs, Refactoring, Test-Coverage, Hot-Path-Optimierungen, Cleanup)
> - **PRIO 2:** Balance & Followups der parked Phase-5.16 + Pre-Production AI-Safeguards
> - **PRIO 3:** Game-Features (Visual Polish, Damage & Armor, AI Build & Deploy, Attributions)
> - **BACKLOG:** Langfristig, bei Bedarf
>
> **Phase 1 (Engine Foundation) und Phase 2 (Engine Performance) abgeschlossen** → siehe DONE.md.
> **Housekeeping 2026-05-09/10:** 16/18 Items + PostProcessingPipeline-Extract erledigt → DONE.md.

---

# PRIO 1 — Engine & Umbauten

> Engine zuerst stabil, performant und testbar machen. Hier sammeln sich die laufenden
> Refactoring-, Test- und Bugfix-Themen.

## 1.1 Engine-Bugs

_(keine offenen Punkte)_

## 1.2 Refactoring (Housekeeping Tier 3)

- [ ] **`three-effects.renderer.ts` aufsplitten** (2675 LOC → 3 Module, Entscheidung 2026-05-11: kompletter Split in einem Rutsch)
      ParticleEffectsRenderer (blood/fire/explosion/smoke), AuraRenderer (frost/poison/inner-fire),
      EnvironmentEffectsRenderer (HQ-Explosion, Tower-Inner-Fire). Single-File macht PR-Reviews unmöglich.
      **Vorgehen:** Erst `ParticlePoolManager` extrahieren (3 Pools + Buffer-Attribute,
      Shader-Materials, Atlas-Texturen, `activeEffects`-Map), dann 3-Wege-Split der Renderer
      die ihre Spawn-Methoden an den Manager delegieren — beides in einem Schritt.

- [ ] **`three-tiles-engine.ts` weiter abspecken — Camera-Setup + Tile-Loading-State**
      Post-Processing ist 2026-05-10 raus (PostProcessingPipeline, siehe DONE.md).
      Noch offen: Camera-Setup (GlobeControls + Initial-Position) und Tile-Loading-State-Machine
      (firstTilesLoaded, retry, debounce). Beide deutlich enger mit `tilesRenderer.initialize()`
      verzahnt — eigene Session mit Plan vorab.

- [ ] **`services/`-Subfolder weiter — `world/`, `location/`, `facade/`, `infrastructure/`**
      `combat/` und `debug/` sind 2026-05-09 raus (siehe DONE.md). Noch flach in services/:
      - `world/` (path-route, route-animation, global-route-grid, marker, building-rendering, street-rendering, height-update, strategic-placement, map-placement, spatial-grid)
      - `location/` (location-management, location-change-coordinator, geocoding, geolocation, osm-street, street-cache, url-location, world-dice, pathfinding-worker)
      - `facade/` (tower-defense-facade, game-loop-facade, visualization-facade, location-facade)
      - `infrastructure/` (asset-manager, engine-initialization, model-preview, game-state-sync)

- [ ] **`IGameManager` konsequent durchziehen** (Entscheidung 2026-05-11)
      Aktuell nur 2 von 6 Managern (EntityManager, WaveManager) implementieren das Interface.
      Vorgehen: alle 6 Manager auf `IGameManager` bringen + polymorphe Iteration in
      `GameStateManager` (Init/Update/Reset über Manager-Array statt hardcoded Aufrufe).

## 1.3 Test-Coverage (Housekeeping Tier 4)

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

- [ ] **Three.js Mock erweitern** — `Sprite`, `SpriteMaterial`, `Box3.setFromObject`, `BufferAttribute.setXYZ`,
      `PositionalAudio`. Schaltet weitere Tests frei (SpatialAudio, combat-vfx, damage-application).

- [ ] **Specs konkretisieren oder löschen** — `game-speed.component.spec.ts`, `three-tiles-engine.spec.ts`,
      `three-effects.renderer.spec.ts` testen Inline-Helper statt der echten Klasse.

- [ ] **MovementComponent DOT-Stacking Spec** — applyStatusEffect-Refresh-Semantik (slow + poison
      no-stack-refresh-only, andere Effects same-source-Refresh). Aus Loop 2026-05-09 als Folge
      des Damage-Application-Specs identifiziert.

## 1.4 CPU Hot-Path Optimierungen

> Kleine Hebel an Hot-Pathes. Ideen aus lokalem `perf:` Commit (Feb 2026), der vor Merge mit
> origin aufgegeben wurde. Enemy-Teile sind durch origin's "5000+ enemies"-Commit abgedeckt —
> folgende Punkte NICHT:

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

# PRIO 2 — Balance & Phase-5.16-Followups

> Aktueller Stand des parked Branches `feature/phase5.5-economy-ai-prep` — nach PRIO 1
> oder zwischendurch wenn Engine-Themen blockiert sind.

## 2.1 Tower-Balance

- [ ] **Tower-Upgrade-Skalierung feintunen**
      Aktuell teilen sich alle Combat-Tower exakt dieselben Standard-Multiplikatoren in `tower-types.config.ts:45-47`:
      - Damage: ×1.10/Level (L25 ×10.83)
      - Fire Rate: ×1.07/Level (L25 ×5.42)
      - Range: ×1.04/Level (L25 ×2.67)
      → kombiniert L25 ≈ ×58 Base-DPS bei voller damage+speed-Spec, plus ×2.67 Reichweite.
      Beispiel Archer: auf hohen Leveln viel zu stark in Reichweite + Speed + Damage gleichzeitig — quasi unkillbar/unbalanciert.
      Pro-Tower-Skalierung statt globale Konstanten? Oder andere Curve (z.B. niedrigerer Multiplier ab L15+)? Konzept überlegen, Werte balancen.

## 2.2 Phase 5.16 Playtest + Followups

> **Stand 2026-05-11:** Branch `feature/phase5.5-economy-ai-prep`, geparkt für andere Themen.
> Checkpoint ep 7350 (ONNX in `public/assets/ai/wave-director/`) wurde gegen das **alte**
> Reward-System trainiert. Curriculum + Difficulty-Knobs (`endgameHpMultiplier`,
> `enemyBaseDamageForWave`) sitzen post-NN — daher trotz alter Sweet-Damage-Kalibrierung
> spielbar. Vollständiger Kontext: [HANDOVER_PLAYTEST_PHASE5.16.md](docs/HANDOVER_PLAYTEST_PHASE5.16.md).
>
> **Architektur-Status:** Phase 5.10 hat das Template-System geshipped (18 Templates,
> 4 Reward-Terme, State 156, Hard-Constraints im Decoder). Bei Tuning gilt:
> **Templates zuerst, nicht Reward-Weights** — Reward-Landscape ist minimal (DEATH,
> DRAMA, SWARM_SIZE, PROGRESSION) und sollte ohne neue Exploits stabil bleiben.

- [ ] **Live-Playtest Phase-5.16-Balance**
      Erwartete Knackpunkte: W1-7 zugänglich (Air-Debüt W7 mit AA-Forschung), W10 Boss
      fordernd (Cannon nötig), W13 Ghost-Surge erfordert Magic, W15-20 sichtbare
      HP-Steigerung, Gold zwischen W10-30 knapp. Notizen sammeln wo's hakt/zu leicht/teuer/billig
      ist. Tool: `npm run economy-chart` regeneriert `docs/economy-chart.html` nach
      jeder Curriculum-Änderung.

- [ ] **Per-Kill-Budget-Rounding-Bug fixen**
      `Math.max(1, Math.round(budget / count))` overshoot bei Mega-Swarms: W19 rat_tide
      mit 5000 Ratten × 1g floor = 5000g statt 305g Budget. Saubere Lösung:
      deterministischer Akkumulator.
      Datei: `src/app/managers/enemy.manager.ts` (gold-budget per-kill-Logik).

- [ ] **Boss-Frequenz ab W31 verdichten**
      Plan war: ab W31 Bosse alle 5 Waves statt 10. Nicht implementiert — Curriculum
      loopt einfach mod-30. Override in `templateForWave()` für
      `wave > 30 && wave % 5 === 0`.
      Datei: `src/app/ai/core/wave-curriculum.ts`.

- [ ] **Wave-Curriculum Gold-Budget feinjustieren**
      Nach Live-Playtest: `goldKill`/`goldComplete` in `wave-curriculum.ts` anpassen.
      Nach jeder Änderung `npm run economy-chart` für Sanity-Check.

- [ ] **Re-Training nach Balance-Verifikation** (Optional)
      Checkpoint ep 7350 wurde gegen ALTES Reward-System trainiert. Re-Training optional,
      ~30-45 min mit 8 headless Tabs. Nur sinnvoll **nachdem** Balance live verifiziert ist.
      Bei Bedarf gleichzeitig 2.3-Safeguards einbauen (siehe unten).

## 2.3 Pre-Production Wave-Deployment Safeguards

> **Status:** Konzept festgehalten, **nicht implementiert**. Implementierung **nach**
> erfolgreichem Training-Run, **vor** Production-Release. Ziel: verhindern dass die AI
> auf einen einzelnen Enemy-Typ/Armor-Category kollabiert (Spider/Bat/Penguin-Spam)
> ohne die AI komplett zu überschreiben.
>
> Hintergrund: Im Training-Betrieb (Phase 5.10) ist das durch Template-System +
> Cooldowns strukturell gemildert. Beim **echten Spieler-Deployment** sind aber
> zusätzliche Inference-seitige Schichten geplant, weil ein differenziertes Netz
> trotzdem Single-Type-Waves erzeugen kann wenn Mixed-Wave-Threshold ungünstig liegt.

- [ ] **Temperature-Sampling im Decoder**
      Bei Inference `softmax(probs / T)` mit T=1.5-2.0 statt `argmax`. Secondary Types
      bekommen mehr Raum ohne Neutraining. Null Training-Kosten, reiner Inference-Parameter.
      Datei: `src/app/ai/wave-director/wave-director.service.ts` (Decoder-Pfad).

- [ ] **Hard-Monotony-Cap im Decoder**
      Notbremse: max. 3 Waves in Folge mit demselben dominanten Typ — über alle
      Mixed-Groups hinweg getrackt, nicht nur `groups[0]`. Wenn Cap triggert:
      nächst-stärkster Typ im Softmax wird promoted.

- [ ] **Scripted Milestone-Waves (Constraint-based Blueprints)**
      Statt fester Typen-Listen: Designer setzt Constraints, AI komponiert innerhalb frei.
      Constraint-Typen kombinierbar:
      - `category: 'air' | 'ethereal' | 'fortified' | 'swarm'` — Armor-Klassen-Lock
      - `anchor: <EnemyTypeId>` — min. 1 Exemplar garantiert (z.B. Boss)
      - `min-count: N` — Swarm-Pflicht (Typen egal)
      - `exclude: <category | enemy>` — Blacklist
      - `preferredPattern: 'burst' | 'drip' | 'interleaved'`

      Beispiele: W10 `{ anchor: 'herbert' }`, W14 `{ category: 'air' }`,
      W22 `{ category: 'ethereal', min-count: 150 }`, W30 `{ category: 'fortified', anchor: 'mammoth' }`,
      W25 `{ min-count: 300 }`, W5 `{ exclude: 'boss' }`.

      AI kontrolliert innerhalb: konkrete Typen (aus Category-erlaubten), Verhältnisse,
      `totalCount`, `killTime`, `hpMultiplier`, `spawnDelay` + Variation, Boss-Verstärkungs-Level.
      Designer pinselt nur die **Thematik**, nicht die Bausteine.

      Skizze:
      ```ts
      interface WaveBlueprint {
        triggerWave: number;
        name: string;
        composition: Array<{ type: EnemyTypeId; countWeight: number; minCount?: number }>;
        archetype: 'boss' | 'elite' | 'mixed-heavy' | 'swarm' | 'ethereal-storm';
        preferredPattern?: SpawnPattern;
      }
      // wave-director.service.ts:
      const blueprint = blueprintLibrary.find(b => b.triggerWave === currentWave);
      return blueprint ? buildFromBlueprint(blueprint, aiParams) : normalAIGenerate(aiParams);
      ```

      Bewusst NICHT gewählt: feste Wellenliste (killt den AI-Point), Ensemble mit
      Preference-Switch (3× Training-Aufwand), rein Soft-Signals via Reward-Bonus
      (Training-Runs zeigten: reicht nicht).

---

# PRIO 3 — Game Features

> Spielbares, poliertes Tower Defense. Nach PRIO 1+2 oder als Lückenfüller.

## 3.1 Visual Feintuning

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

- [ ] **Color Grading Anwendungsfall klären**
      Feature funktioniert (Dark Fantasy, Noir, Warm Sunset)
      Brainstorming: als Gameplay-Element? (z.B. Nacht-Modus, Wetter), oder rein kosmetisch?
      Aktuell nur im Debug-Panel zugänglich — evtl. in Settings verschieben

- [ ] **InfoOverlay collapsed-State minimal halten**
      Im zugeklappten Zustand soll die FPS-Anzeige nur die nackte Zahl zeigen — aktuell
      ist da noch zu viel Schnickschnack drumherum. Datei:
      `components/info-overlay/info-overlay.component.ts` (Template + Styles für den
      Nicht-`infoOverlayVisible`-Pfad).

- [ ] **Loading Screen optimieren**
      Layout/Wirkung des Initial-Loading-Screens überarbeiten. Detaillierter Stats-Block
      und 3D-Tiles-Counter sind 2026 vorhandene Basis (siehe DONE.md), aber Polish steht
      aus. Konkretisieren beim Anpacken (Bullet-Liste was raus/rein soll).

- [ ] **Kompass: Reset-Bearing-Button neu positionieren**
      „Reset bearing"-Button gehört aus Sicht des Kompass nach oben rechts (statt aktueller
      Position). Datei: `components/compass/compass.component.ts` (Template + Styles für
      den Reset-Button).

- [ ] **Enemy-Tooltip in laufender Wave wie Tower-Tooltip im Build-Menü stylen**
      Der Tooltip der Enemies während der laufenden Wave soll optisch identisch zum
      Tower-Tooltip im Build-Menü gestaltet werden (gleiche Card-Optik, Header,
      Stat-Layout, Typografie). Aktuell weichen die beiden Tooltips visuell voneinander
      ab — Stil vereinheitlichen für konsistentes UI-Empfinden.

- [ ] **Wallsmasher: kein Spawn-Sound**
      Der Wallsmasher soll beim Spawnen keinen Sound abspielen. Aktuell triggert er den
      Spawn-Sound aus der Audio-Config. Vermutlich in `src/app/configs/audio.config.ts`
      (Enemy-Spawn-Map) den Eintrag für wallsmasher entfernen / auf null setzen, bzw.
      in `enemy-types.config.ts` den Spawn-Sound-Verweis prüfen.

## 3.2 Visual Settings (Performance-Toggles)

- [ ] **VFX Settings Menu** — Visuelle Effekte einzeln ein/ausschaltbar
      Freeze-Tint, Muzzle Flash, Trail-Streaks, Sprite-Sheet Partikel,
      Screen Shake, Bloom, Color-Grading
      Ziel: Low-End-Geräte können teure Effekte deaktivieren

## 3.3 Damage & Armor System

> **Konzept:** [MASTER_GAME_DESIGN.md](docs/game-design/MASTER_GAME_DESIGN.md)
> **Status (2026-05-08):** Infrastruktur abgeschlossen (siehe DONE.md) — Types,
> Schadensmatrix, damageType/armorType an allen Configs, Flame Tower,
> Damage-Matchup-Tooltips. Offen: weitere Tower-Typen + Wave-Preview-UI.

- [ ] **Lightning / Tesla Tower (`magic`)** — Kettenblitz, springt zwischen Enemies
      Model bereit: `public/assets/models/towers/lightning.glb` → kann implementiert werden.

- [ ] **Chaos Tower (`chaos`)** — Teuer, voller Schaden gegen alle Armor-Typen
      (Hinweis: `chaos` ist aktuell **nicht** im `DamageType`-Enum
      → Type erst erweitern, Matrix-Eintrag ergänzen)

- [ ] **UI: Rüstungstyp im Wave-Preview anzeigen**
      "🛡️ Heavy Armor – Weak to Siege" o.ä.
      Neue Enemy-Ideen mit speziellen Rüstungen siehe BACKLOG → Enemy-Ideen.

- [ ] **Globale Damage-Matrix-Übersicht im UI** (Optional, niedrige Priorität)
      Tooltips zeigen aktuell nur Multiplier per Tower und per Enemy. Eine globale
      "vs"-Tabelle (alle Tower × alle Armor) gibt es nicht. Eigener Sidebar-Tab oder
      Hilfe-Dialog möglich.

## 3.4 AI Wave Director — Build & Deployment

> Training-Code nicht in Prod Bundle

- [ ] **Build Configuration**
      `angular.json`: fileReplacements für Training-Code
      Production: Training-Module wird zu leerem Stub
      Bundle Size Check: AI < 300KB

- [ ] **Model Validation**
      `scripts/validate-model.js`
      Prüft: Format, Größe, Basis-Inference
      Läuft vor Commit (optional)

## 3.5 AI Training UI

- [ ] **Dashboard Header Styling verbessern**
      Status/Header Metriken besser stylen
      Model Metrics (Entropy, Grad Norm, etc.) als eigene Gruppe rechts
      Dezenter als Hauptmetriken, nach "Game Over" Bereich
      Dateien: `training-backend/dashboard/static/index.html`, `style.css`

## 3.6 Attributions

- [ ] Skybox (day.webp, night.webp) Quelle ermitteln und eintragen
- [ ] stone-wall.jpg Quelle ermitteln und eintragen
- [ ] Sound Effects Quellen ergänzen (alle außer Tentacle Slime)

---

# BACKLOG

> Langfristig, bei Bedarf.

## Training Backend Refactoring

- [ ] **training-backend Struktur verbessern**
      Aktuell alles flach, besser in Module aufteilen:
      - `core/` - model.py, trainer.py, reward.py
      - `utils/` - logger (tui_logger + auto_logger mergen)
      - `scripts/` - export, analyze (bereits teilweise)
      Import-Pfade in server.py anpassen

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
> Tesla / Chaos sind bereits in PRIO 3.3 (Damage & Armor) gelistet — hier nur Verweis.

## Enemy-Ideen

> Siehe auch: [MASTER_GAME_DESIGN.md](docs/game-design/MASTER_GAME_DESIGN.md)

- [ ] **MechaCat** - Roboter-Katze als neuer Gegner-Typ
      Model bereits vorhanden: `public/assets/models/enemies/candidates/mechacat_01.glb`
- [ ] **Ghost** - `ethereal` Rüstung, nur Magic/Chaos wirkt
- [ ] **Skeleton** - `unarmored`, Swarm
- [ ] **Golem** - `fortified`, Boss
- [ ] **Dragon** - `heavy` + Air, fliegender Boss
