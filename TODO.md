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
> **Engine Cleanup-Pass 2026-05-11 (Commit f26fbe3):** komplette 1.3 Test-Coverage (+99 Tests),
> komplette 1.4 CPU Hot-Path (8 Items), services/-Subfolder-Split, IGameManager-Teilrollout → DONE.md.

---

# PRIO 1 — Engine & Umbauten

> Engine zuerst stabil, performant und testbar machen. Hier sammeln sich die laufenden
> Refactoring-, Test- und Bugfix-Themen.

## 1.1 Engine-Bugs

- [ ] **Route-Grid + Air-Route schweben über Boden bei flachen Karten ohne Tile-Geometrie**
      Beim Map-Reload tritt sporadisch auf, dass das komplette Route-Grid (Ground-
      Aggregate + Air-Aggregate) und die Air-Route-Tube auf einer falschen,
      konstanten Y-Höhe schweben — typisch 20-30m über dem tatsächlichen Terrain.
      Die rote Ground-Route-Polyline ist immer korrekt am Boden (deutet darauf hin,
      dass sie ihre Y pro Frame direkt sampled, nicht aus `cell.terrainHeight`-Cache).
      "Manchmal klappt's" → klares Tile-LOD-Streaming-Race.

      **Tritt vor allem in flachen Karten ohne detaillierte 3D-Tile-Gebäude auf**
      (Photorealistic-Tile zeigt nur eine flache Textur, kein extrudiertes Mesh).
      In Manhattan/Tokyo nicht beobachtet — vermutlich weil dort die Tile-Geometrie
      so dicht ist dass der Erst-Sample-Raycast immer einen gültigen Treffer hat.

      **Vermutung:** Erster `sampleCellY`-Raycast trifft eine grobe Übergangs-LOD
      (z.B. bounding-box-approximation während Tile-Streaming) → `cell.terrainHeight`
      wird mit der approximierten Höhe befüllt, `cell.heightSampled = true`,
      `tileDepth`/`tileGeometricError` gespeichert. Nachträgliches Tile-LOD-Refining
      triggert `setCellsPromotedListener` NICHT, weil der Listener nur bei
      `unsampled → sampled`-Übergängen feuert, nicht bei `sampled → sampled-mit-
      besserer-LOD`. Cells bleiben auf falscher Erst-Sample-Höhe.

      **Diagnose-Plan:**
      1. `tileDepth` / `tileGeometricError` pro Cell ausloggen — vergleiche
         betroffene vs saubere Cells.
      2. DevTools-Hack: alle Cells `heightSampled = false` setzen + `retryUnsampled
         Cells()` aufrufen. Wenn Route dann auf korrekter Höhe landet → bestätigt.
      3. Manhattan-Szene als Gegenprobe — wenn dort nie reproduzierbar → LOD-Race
         spezifisch für tile-arme Regionen.

      **Fix-Richtung:** `sampleCellY` muss bei vorhandener besserer Tile-LOD
      re-sampeln (Vergleich mit gespeicherter `tileGeometricError`), und das
      Listener-System muss diesen Re-Sample propagieren — analog zu wie
      `recomputeAllTowersGroundLOS` heute den Combat-Cache refresht.
      Dateien: `src/app/utils/global-route-grid.ts` (`sampleCellY`,
      `retryUnsampledCells`, `setCellsPromotedListener`),
      `src/app/services/facade/visualization-facade.service.ts` (`onTilesLoaded`).

      Tracking-Hinweis: nicht mit der LOS-Pipeline vermischen — eigener Sample-
      Layer-Bug, der durch die Air-Cells nur visuell sichtbarer wird.

      **Zweite Manifestation (lokale Variante, leichter zu reproduzieren):**
      Auch wenn das Grid initial korrekt am Boden liegt, treten gelegentlich
      LOKALE Cell-Lücken auf — eine schmale Reihe (~2-3 Cells breit) fehlt
      im Aggregate-Mesh komplett. An genau dieser Stelle taucht die Air-Route-
      Tube steil in den Boden (manchmal extrem in den Himmel). Korrelation
      Cell-Lücke ↔ Tube-Outlier ist exakt → dieselbe Bug-Wurzel.

      Erklärung: Cells in dem Streifen haben `heightSampled = false` (vermutlich
      Raycast trifft an der Stelle eine Tile-Lücke / Backface / transparente
      Wasserfläche zwischen Häusern). Aggregate-Mesh skipped sie (heightSampled-
      Filter → sichtbare Lücke). Air-Route-Tube hingegen sampled per Polyline-
      Waypoint via `getAirTargetY(cell)` ohne heightSampled-Check → nimmt den
      Init-Fallback der Cell (anchorY oder ähnlich, kann je nach Map-Origin
      stark abweichen vom echten Terrain).

      Die rote Ground-Route bleibt heil weil sie pro Frame direkt gegen die
      Tile-Geometrie sampled (kein cell-Cache-Lookup), und bei einem Miss
      vermutlich linearinterpoliert oder die letzte gültige Höhe behält.

      Diese lokale Form ist der **bessere Reproduktions-Pfad** für die
      Bug-Hunt: deutlich isolierter als "alle Cells sind hoch", die betroffenen
      Cells sind im DevTools direkt auswählbar. Erweiterung von Schritt 1
      des Diagnose-Plans: an der Stelle wo Tube abtaucht in
      `globalRouteGrid.cells` greifen, prüfen ob die Cell-Reihe
      `heightSampled=false` mit Fallback-`terrainHeight` ist, ODER
      `heightSampled=true` mit Outlier-Wert.

      Fix-Richtungen pro Sub-Fall:
      - heightSampled=false + Fallback: die Air-Route-Tube (und ggf. andere
        Konsumenten) muss heightSampled-Cells skippen oder per Nachbar-Cell
        interpolieren. Plus: `retryUnsampledCells` aggressiver triggern.
      - heightSampled=true + Outlier: `sampleCellY` muss Sanity-Check gegen
        Nachbar-Cells / Polyline-Höhe machen, krasse Sprünge ablehnen
        statt zu cachen.

      ---

      **Stand 2026-05-15 — Fix implementiert, in Beobachtung**

      Diagnose-Sammlung über 14 reproduzierbare Cases (`tmp/case 1` …
      `case 14`, je BEFORE/AFTER-JSON-Dump + Screenshot + info.txt). Diagnose-
      API in DevTools via `__rg.*` und State-Dump-Button im Dev-Menü (Commit
      `9df8f3c feat(debug): route-grid diagnostics + JSON state-dump`).

      **Empirisch bestätigte Wurzeln (zum Teil abweichend von der ursprünglichen
      Hypothese oben):**

      - **Defekt I — Init-Race zwischen `generateFromRoutes` und Tile-Mesh-
        Dekodierung.** Hauptmechanismus: bei aktivem Browser-Cache liefert
        die Tile-Engine schon Hits zurück, bevor das Mesh dekodiert ist —
        BBox/Center-Approximationen werden als Ground gemeldet. Smoking-Gun-
        Indikator: alle Cells mit `tileDepth=0 + tileGeometricError=Infinity`
        bei konsistent falschem Y (z.B. SF Cases 10/12: alle stable @ 504m
        statt -10..52m). Die TODO-These "LOD-Race nach sampled→besseres-LOD-
        Refresh" hat sich in den Daten NICHT bestätigt — kein einziger Case
        zeigte einen `tileDepth=20 → tileDepth=23 mit anderem Y`-Übergang.
      - **Defekt II — Anker=0 / Air-Tube-Knick nach unten bei Tile-Lücken
        (Wasser/Tunnel).** `routeAnchorY` ist in den meisten Karten 0 (Route-
        Polyline ohne Höhen, Ausnahme: Salzburg liefert echte Anker). Unsampled
        Cells fallen visuell auf 0m, die Air-Tube nimmt naiv
        `cell.terrainHeight + 15m = 15m` → 165m unter dem Rest.
      - **Defekt III — Air-Route-Tube wird nicht rebuildet bei Cell-Promotion.**
        Reset/Promotion heilt die Aggregate-Meshes, aber die Magenta-Tube
        bleibt visuell auf alten Höhen stehen (Cases 2/5/6/10/12).
      - **Defekt IV — `resetHeightsAndRetry` zerstörte gute LOD-Daten.** Wenn
        BEFORE-Cells bereits `tileDepth≥18` hatten, machte der Wholesale-Reset
        sie schlechter (Cases 1/7/8: depth → 0 nach Reset). Wegwerfen + Retry
        ist nicht produktiv.

      **Fix (Commit nach diesem TODO-Update):**

      - `sampleCellY` (`src/app/utils/global-route-grid.ts`) lehnt zwei
        Hit-Klassen jetzt ab und lässt Cells `unsampled`:
        1. "noLOD" — Sample-Raycaster wired, aber Hit hat `tileDepth=0` oder
           `tileGeomErr=Infinity` (= Mesh nicht dekodiert)
        2. "outlier" — Hit divergiert >50m vom Median der stable Nachbarn
           (Sub-Fall B / Tunnel-Outlier)
        Beide Pfade greifen nur wenn `terrainSampleRaycaster` verkabelt ist
        (DevWorld/Tests bleiben unverändert).
      - Neuer Helper `medianOfStableNeighbourY` (private) + `estimateTerrainY`
        (public) — 3×3, dann 5×5 Ring, ≥3 stable Nachbarn für Sanity-Check
        nötig (sonst null = keine false positives beim Erst-Sample).
      - `retryUnsampledCells()` returnt jetzt `{ promoted: number }`.
      - **Convergence-Loop** in `visualization-facade.service.ts`
        (`scheduleRouteGridConvergence`): rAF-getakteter Retry nach Tile-Load-
        End; stoppt nach 2 aufeinanderfolgenden Frames mit 0 Promotions, oder
        bei 120 Frames Safety-Cap (~2s @ 60fps). Ersetzt den vorherigen Single-
        Shot-Retry — keine harte Wartekonstante mehr, passt sich an Hardware
        und Cache-State an.
      - `route-altitude-tubes.ts` benutzt `estimateTerrainY` statt naiv
        `cell.terrainHeight` für unsampled-Cells → kein Knick nach unten mehr
        auch wenn Cells dauerhaft unsampled bleiben.
      - `tower-placement.service.ts onCellsPromoted` triggert jetzt zusätzlich
        `rebuildAirRouteLayer()` mit rAF-Debounce (Defekt III).
      - `resetHeightsAndRetry`: nur noch Cells mit `tileDepth=0 ||
        tileGeomErr=Infinity` zurücksetzen, gute Cells bleiben (Defekt IV).

      **Tuning-Konstanten** (eine Stelle, leicht justierbar):
      - Sanity-Threshold: 50m gegen Nachbar-Median in `sampleCellY`. Salzburg-
        Tunnel hatte max 63m Drift → wird vom Filter abgelehnt (gewollt: dort
        bleibt die Cell unsampled statt 63m Müll zu cachen).
      - Convergence-Cap: 120 Frames in `scheduleRouteGridConvergence`.

      **Bewusst NICHT gefixt:**
      - Aggregate-Mesh-Lücken bei dauerhaft unsampled Cells (Wasserflächen,
        Tunnel) — bleiben sichtbar. UX-Entscheidung: keine geratenen Cell-
        Quadrate auf Wasser zeigen. Air-Tube interpoliert trotzdem darüber.
      - Anker-Resample (z.B. terrain-getrieben in `generateCorridorCells`) —
        zu unsicher (Tile-Engine zu Init-Zeit nicht verlässlich). Defekt II
        wird visuell durch Tube-Interpolation entschärft; Combat-LOS für
        dauerhaft-unsampled Cells kann theoretisch noch falsche Cache-Werte
        haben, wurde aber in den 14 Cases nicht als Spielproblem sichtbar.
      - Tunnel/Brücke (Case 7 Salzburg, 63m Drift) — separates Topic mit
        Photorealistic-Tiles-Limitationen, kein eigentlicher Bug.

      **Verifikations-Plan (offen, daher TODO in Beobachtung):**
      Die 14 archivierten Cases mit dem neuen Code nachspielen, BEFORE-Dump
      (sofort nach Reload) und AFTER-Dump (nach ~2s Wartezeit, ohne Reset)
      ziehen. Erwartung pro Case-Familie:
      - Cases 2/5/6/10/12 (alles 200m verschoben): BEFORE viele unsampled,
        AFTER alle stable und korrekt
      - Cases 1/4 (Lücke + Knick nach unten): Aggregate-Lücke bleibt, Air-Tube
        interpoliert glatt
      - Case 14 Dump 1 (lokaler Peak nach oben): Outlier-Cluster bleibt
        unsampled, Air-Tube interpoliert; kein Peak mehr
      - Cases 3/7/8/9/11/13 (gut): bleiben gut, Reset zerstört nichts mehr

      **Rollback-Hinweis falls nötig:** Fix ist in einem Commit gebündelt
      (folgt nach diesem TODO-Update). Diagnose-Infrastruktur (`9df8f3c`)
      bleibt davon unabhängig.

- [ ] **Air-Enemy-Flughöhe divergiert von Air-LOS-Sample-Höhe am Hang**
      Drei Modelle laufen heute parallel, die in flachem Terrain
      übereinstimmen, am Hang aber auseinander gehen:
      - **Air-Route-Tube** (Debug-Viz): `getAirTargetY(cell) = cell.terrainHeight
        + 15m` pro Cell-Mitte
      - **Air-Enemy-Flughöhe** (was der Spieler sieht): `geoHeight + heightOffset`,
        wobei `geoHeight` aus der Pfad-Polyline interpoliert wird (folgt dem
        Pfad, nicht der Cell-Mitte)
      - **Combat-Sample des Towers**: liest `cell.airVisibility`, das wurde mit
        `getAirTargetY(cell)` (= Cell-Mitte + 15m) gefüllt

      Folge: Air-Tower an einem Hang zielt auf einen Punkt 15m über der
      Cell-Mitte am Berg, aber der Enemy fliegt 15m über der Pfad-Höhe im
      Tal. Projektil-Miss möglich, LOS-Disagreement möglich (Tower sieht
      Enemy als blockiert weil der Cell-Sample-Punkt im Berg steckt,
      obwohl der Enemy frei in der Talluft fliegt — oder umgekehrt).

      Visuell sichtbar wenn ein Air-Enemy entlang eines Talpfads fliegt
      während die Air-Route-Tube oben am Hang zackelt (siehe Screenshot
      aus 2026-05-14 Session: zwei Bats folgen Pfad in ~10-15m Höhe über
      Straße, Tube zickzackt 30-40m über ihnen).

      **Vergleich zu Option-B-Wahl in der LOS-Migration**: bei der Wahl
      ausgegangen davon dass Enemy + Combat-Sample + Viz alle auf
      `terrain + 15m` liegen würden. Das stimmt für flaches Terrain.
      Für Hang-Cells war der Fall nicht explizit durchgedacht: die
      Annahme war "`getAirTargetY` ist Single-Source-of-Truth, alle
      drei lesen daraus". Aber Enemy liest `getAirTargetY` NICHT — er
      nutzt seine eigene path-relative `geoHeight`-Berechnung.

      **Fix-Richtungen** (zur Entscheidung in eigener Session):
      - **Option α: Enemy-Y an Cell-Grid binden.** `enemy.position.height
        = cell_unter_enemy.terrainHeight + heightOffset` statt path-
        waypoint-basiert. Enemy zickzackt am Hang sichtbar — möglicherweise
        unschön, aber Combat-konsistent.
      - **Option β: Combat-Sample an Pfad binden.** `getAirTargetY` wird
        bei Tower-Sample mit der nächstgelegenen Pfad-Höhe statt Cell-
        terrainHeight aufgerufen. Aber: Cells haben keine direkte Pfad-
        Korrespondenz, das müsste pro Cell eine "nächstgelegene Polyline-
        Höhe" cachen.
      - **Option γ: Akzeptieren als kosmetischer Visual-Drift.** Combat
        funktioniert mit dem heutigen Mix in der Praxis "gut genug" weil
        Tower-Range typischerweise größer ist als der Höhen-Drift. Air-
        Route-Tube als Debug-Viz dokumentiert "Cell-Sample-Höhe" und
        ist visuell vom Enemy entkoppelt — das wird in der Legende
        klargestellt.

      Test-Plan: Combat tatsächlich messen in einer Hang-Szene. Tower
      auf flachem Bereich, Enemy fliegt am gegenüberliegenden Hang vorbei.
      Tower sollte treffen wenn LOS frei ist. Wenn Misses → Option α
      oder β nötig. Wenn Treffer → Option γ ist hinreichend.

      Datei-Anker: `src/app/managers/enemy.manager.ts` (Enemy-Y),
      `src/app/utils/global-route-grid.ts` (`getAirTargetY`),
      `src/app/services/combat/tower-combat.service.ts` (Targeting).

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

- [ ] **`IGameManager` durchziehen — Restrollout (3 von 6 Managern offen)**
      Stand 2026-05-11 (siehe DONE.md): ResearchManager + `GameStateManager.subManagers[]`
      + polymorphe `dispose()` sind drin. Offen: EnemyManager, ProjectileManager, TowerManager
      auf `IGameManager` bringen, und Init/Update ebenfalls polymorph über das Manager-Array
      statt hardcoded Aufrufe.

## 1.3 Test-Coverage (Housekeeping Tier 4)

_(keine offenen Punkte — Cleanup-Pass 2026-05-11, siehe DONE.md)_

## 1.4 CPU Hot-Path Optimierungen

_(keine offenen Punkte — Cleanup-Pass 2026-05-11, siehe DONE.md)_

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

- [ ] **Stone Golem ins Wave-Curriculum aufnehmen** (vor Re-Training)
      Stone Golem ist als Config registriert (`enemy-types.config.ts`, Fortified, 480 HP, Speed 2.5),
      aber AI-Wave-Director kennt ihn nicht. Vor Re-Training: Template in
      `src/app/ai/core/templates.ts` ergänzen (z.B. `stone_golem_squad`) + ggf. Slot im
      `wave-curriculum.ts` öffnen. Sonst lernt das Netz nichts über die neue Fortified-Variante
      und Stone Golem taucht im AI-Mode nie auf.

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

- [ ] **Loading Screen optimieren**
      Layout/Wirkung des Initial-Loading-Screens überarbeiten. Detaillierter Stats-Block
      und 3D-Tiles-Counter sind 2026 vorhandene Basis (siehe DONE.md), aber Polish steht
      aus. Konkretisieren beim Anpacken (Bullet-Liste was raus/rein soll).

- [ ] **Loading-Screen-Tipps inhaltlich überarbeiten**
      In `src/app/components/loading-screen/field-tips.ts` stehen Tipps, die sachlich nicht
      stimmen (z.B. falsche Werte, veraltete Mechaniken, nicht-existierende Features).
      Alle Tipps gegen aktuellen Spielstand prüfen (Schadenstypen, Armor-Matrix, Tower-Stats,
      Forschungs-Effekte) und falsche Aussagen entfernen oder korrigieren. Wenn beim Drüber-
      gehen Lücken auffallen (z.B. Stone Golem fehlt, Magic-vs-Fortified-Hinweis fehlt),
      gerne ergänzen — aber Korrektheit zuerst.

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

- [ ] **Chaos Tower (`chaos`)** — Teuer, voller Schaden gegen alle Armor-Typen
      (Hinweis: `chaos` ist aktuell **nicht** im `DamageType`-Enum
      → Type erst erweitern, Matrix-Eintrag ergänzen)

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

- [ ] **zombie_v2-Modell extern weiter optimieren**
      Frames gegenüber dem alten `zombie.glb` aktuell deutlich schlechter, sichtbar
      vor allem bei sehr großen Waves (>2k Enemies). Externe Mesh-/Material-/
      Animations-Optimierung am Modell selbst (Polycount, Skeleton-Komplexität,
      Texturgrößen, VAT-Frame-Count, ggf. Splitting in LOD-Stufen) — kein
      Code-Fix, sondern Asset-Pass. Backup liegt als
      `public/assets/models/enemies/zombie_v2.original.glb.bak` vor.

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

- [ ] **Selective / lokales Post-Processing für Effekt-Hotspots**
      Bloom (und ggf. weitere Post-FX) nur an konkreten Effekt-Positionen statt global.
      Hintergrund: erste Lightning-Tower-Iteration hat Auto-Bloom global eingeschaltet —
      Fullscreen-Pass mit Threshold 0.75 ließ alle emissiven Materialien dauerhaft leuchten
      (Gegner, Health-Bars, Particles). Sauberer Weg: Three.js Selective Bloom via
      Render-Layers — Bolts/Hotspot-Meshes auf eigener Bloom-Layer, zweiter EffectComposer
      rendert nur diese Layer in ein Off-Screen-Render-Target, das additiv über die normale
      Szene komponiert wird. Erst experimentell evaluieren (Lightning-Bolts, Explosions-Cores,
      ggf. Magic-Orb-Highlights) bevor in die Pipeline gehoben.
      **Stand 2026-05-11:** Pragmatischer Workaround für Lightning-Impacts sitzt in
      `lightning-bolt.renderer.ts` (additive Billboard-Halos via Sprite-Pool, AdditiveBlending,
      Radial-Gradient-CanvasTexture). Funktioniert weil additiv komponiert wird — Tiles
      reagieren bekanntlich nicht auf dynamische Lichter. Echtes Selective-Bloom-Setup für
      weitere Effekt-Kategorien (Explosions-Cores, Magic-Orb-Highlights) steht weiterhin aus.
      Dateien: `three-engine/post-processing/post-processing-pipeline.ts`,
      `three-engine/renderers/lightning-bolt.renderer.ts`, `three-engine/three-tiles-engine.ts`.

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
