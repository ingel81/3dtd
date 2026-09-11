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

# PRIO 1 — Engine & Umbauten und Co.

> Engine zuerst stabil, performant und testbar machen. Hier sammeln sich die laufenden
> Refactoring-, Test- und Bugfix-Themen.

## 1.0 Nächste Runde: Top-Priorität

- [ ] **Routenkorridor dynamisch nach Straßenbreite** (Top-Priorität, dem Nutzer sehr wichtig)
      Heute ist der Zellkorridor überall gleich breit (`CORRIDOR_WIDTH` 7 m in
      `global-route-grid.ts`), die Gegner weichen fest bis 3 m seitlich aus.
      An Engstellen liegen Zellen dadurch auf Fassaden, Dächern und Bäumen, auf
      breiten Straßen bleibt Platz ungenutzt. Festgelegt 2026-09-12:
      - **Breite pro Abschnitt, entlang der Route variabel:** nicht ein Wert
        pro Route, sondern pro Kante bzw. Abschnitt, enger und breiter werdend
        wie die Straße. Anzahl Zellen in der Breite folgt der Straße.
      - **Quelle:** OSM `width`/`lanes` (seit `03ffd7b` am Street-Objekt
        gespeichert), sonst Standardbreite je `highway`-Klasse; zusätzlich aus
        den 3D-Tiles messen: seitlich raycasten, wo Fassaden oder Bäume
        beginnen, und den Korridor dort begrenzen.
      - **Gegner nutzen die Breite:** Der Seitenversatz folgt der
        Korridorbreite (breit verteilt auf Hauptstraßen, eng in Gassen).
      - **Minimum 2 Zellen (4 m):** Tower sehen nur Gegner in Zellen, der
        Seitenversatz wird dort auf die Breite begrenzt.
      - Zusammen mit den **Brücken- und Tunnel-Tags** angehen: Auf Brücken
        die Oberkante statt des Bodens darunter nehmen (Tags liegen seit
        `03ffd7b` vor; "Korrektur überspringen" reicht nicht, siehe
        `docs/ROUTE_GEOMETRY_ANALYSIS.md`).
      Folgen: Zellzuordnung, LOS-Registrierung, Targeting und Bodenhöhe der
      Gegner ändern sich; Hot Path (20k Gegner) nicht verlangsamen.

## 1.1 Engine-Bugs

> Air-Enemy-Flughöhe-Drift am Hang wurde 2026-05-21 als kosmetisch
> akzeptiert (Option γ, siehe DONE.md).

- [ ] **Verhaltensprüfung nach Terrain- + Performance-Umbau (2026-08-22)**
      Beide Umbauten sind auf `main`, statisch abgesichert (903 Tests, Lint,
      Build), aber im laufenden Spiel nicht durchgeprüft. Fällt beim normalen
      Spielen mit ab — hier nur als Erinnerung, worauf zu achten ist:
      - **Gift bei Timescale > 1**: in *Spielzeit* messen, nicht mit der
        Stoppuhr. Gleiche Anzahl Ticks und gleicher Gesamtschaden bei 1× und
        10×; die Wanduhr-Zeit unterscheidet sich um den Faktor. Der DOT-
        Akkumulator liegt bewusst im Sub-Step (`enemy.manager.ts`) — wäre er
        im Present-Pass gelandet, würde Gift bei hohem Timescale still
        schwächer.
      - **Frost-Aura, Todesanimation, Healthbars** bei niedriger Framerate:
        die visuellen Toggles laufen jetzt einmal pro Frame statt pro
        Sub-Step.
      - **Luft-Einheiten** auf korrekter Flughöhe (`terrainHeight +
        heightOffset`).
      - **Headless-Trainingslauf**: der Visual-Push ist jetzt auf
        `renderingEnabled` gegatet — vorher lief er bei 75× pro Sub-Step für
        ein Bild, das nie entsteht.
      - **Terrain-Höhen an mehreren Standorten**: der Wegfall des
        Overlay-Space verschiebt Y von Straßen, Gebäuden, Markern, Route-Linie
        und Tower-Preview auf absolute Scene-Koordinaten. Flaches Gelände und
        eine Großstadt gegenprüfen.
      **Entscheidung 2026-09-12:** Diese Punkte kommen in die nächste
      nummerierte Playtest-Liste, danach schließen.

- [ ] **Route folgt der Straße nicht, Route-Cells auf Dach und Baum**
      Playtest 2026-09-10 (Kleinstadt, Engstelle): Die rote Enemy-Route
      schneidet eine Hausecke, während die gelbe OSM-Straße um das Haus biegt.
      Die Route-Cells liegen dadurch auf Dach und Baumkronen, Gegner laufen
      dort zu hoch. Ein Re-Raycast ändert nichts, die Zellen folgen der Linie.
      Nicht durch das Dependency-Update eingeführt (Routengeometrie kommt
      unverändert aus dem Pathfinding), bekannte Routen sind sonst sauber.
      Vermutungen, ungeprüft:
      - Der Pfad läuft nur über Kreuzungsknoten und verliert die Shape-Nodes
        der OSM-Ways, oder die Route wird nachträglich geglättet/vereinfacht.
      - An Engstellen erfasst der 7 m breite Zellkorridor (`CORRIDOR_WIDTH` in
        `global-route-grid.ts`) Fassaden und Bäume auch bei korrekter Route;
        der Korridor müsste sich der Straßenbreite anpassen.
      Kontrolle: Debug → Display → LOD Colors, Route-Linie gegen das
      Straßen-Overlay.
      **Stand 2026-09-11:** Im Playtest an derselben Stelle nicht mehr
      reproduziert. Die Route verliert nachweislich keine Shape-Nodes
      (`fcbe1d8`), der HQ-Abzweig ist korrigiert (`4ad010a`); die Ursache des
      ursprünglichen Befunds ist aber nicht belegt. Offen lassen, bei
      Wiederauftreten `__routes.describe()` aufrufen (Fälle A bis D in
      `docs/ROUTE_GEOMETRY_ANALYSIS.md`).

## 1.2 Refactoring (Housekeeping Tier 3)

- [ ] **`three-tiles-engine.ts` weiter abspecken — Camera-Setup + Tile-Loading-State**
      Post-Processing ist 2026-05-10 raus (PostProcessingPipeline, siehe DONE.md).
      Noch offen: Camera-Setup (GlobeControls + Initial-Position) und Tile-Loading-State-Machine
      (firstTilesLoaded, retry, debounce). Beide deutlich enger mit `tilesRenderer.initialize()`
      verzahnt — eigene Session mit Plan vorab.

## 1.3 Test-Coverage (Housekeeping Tier 4)

> Cleanup-Pass 2026-05-11 + Engine-Deep-Review 2026-05-16 (160 neue Tests) +
> TEST-6..10-Lücken 2026-05-21 (59 neue Tests) → DONE.md.
> Keine offenen Test-Coverage-Lücken.

## 1.4 CPU Hot-Path Optimierungen

- **Bewusst nicht umgesetzt: weitere Enemy-Hot-Path-Hebel**
      Stand nach dem Umbau vom 2026-09-10 (DONE.md, 21 → 48 FPS bei 20k
      Gegnern; Traces unter `tmp/perf/`). Am 2026-09-10 entschieden, nicht zu
      machen:
      - Culling pro Pool (Pools außerhalb des Bildes weder beschreiben noch
        zeichnen). Ein Pool ist ein Gegnertyp über die ganze Route, greift also
        nur, wenn die Kamera ganz woanders hinschaut. Räumliche Pools wären M-L.
      - Kalte Gegner (ohne Tower in Reichweite) nur einmal pro Frame rechnen.
        Größter verbleibender Hebel, ändert aber die Simulation (Wegpunkte,
        Reichweiten-Eintritt, Gift-Ticks, Event-Reihenfolge).
      SoA siehe Backlog, verworfen.

## 1.5 Render-/GPU-Hebel aus Deep-Dive 2026-05 (verschoben, messgestützt)

> Aus PR #5 / [PERF_BUG_ANALYSIS_2026-05-28.md](docs/PERF_BUG_ANALYSIS_2026-05-28.md).
> Die risikoarmen High-Value-Findings sind umgesetzt (Bugs, LOS-Readback-Batching,
> Bounding-Box-Tower-Reg, Targeting-Hot-Path, Health-Bar-Buffer-Sharing, Trail-Material-
> Sharing u.a.). Die folgenden sind größere Shader-/Buffer-Umbauten oder visuelle/
> balance-relevante Änderungen — **vor Umsetzung Frame-Time im echten Render messen**
> (davor/danach), da hier kein Headless-/GPU-Test greift. Sichere Teilvarianten sind
> jeweils bereits drin.

- [ ] **R4-Experiment — `logarithmicDepthBuffer` evaluieren**
      logDepth schreibt `gl_FragDepth` → deaktiviert Early-Z auf vielen GPUs über die
      gesamte Tile-Geometrie. Experiment: entfernen + `camera.near` 1→5-10m anheben (Spiel-
      Skala ~150m, Fern-Z im Fog). Z-Fighting-Risiko → nur mit visuellem Vorher/Nachher.
      Sichere Teilmaßnahme (`powerPreference`/`stencil:false`) ist bereits drin.

- [ ] **Render-Kleinkram: R6 und R10**
      P6, P8, G8 und R9 sind im Sprint 2026-09-11 erledigt (Nachtrag in
      PERF_BUG_ANALYSIS_2026-05-28.md). Für die nächste Runde festgelegt:
      - **R6:** leere Instanz- und Partikel-Pools nicht zeichnen
        (`visible = count > 0`), zusammen mit einem Shader-Warm-up beim Laden
        (`compileAsync`), damit der Compile nicht in die erste Welle rutscht.
      - **R10:** erst loggen, ob die Tile-Materialien überhaupt Licht rechnen
        (Materialtyp im `load-model`-Event), dann entscheiden. Die Zahl der
        PointLights bleibt bei 1.

## 1.6 Befunde aus dem Sprint 2026-09-11 (nicht behoben)

> Beim Abarbeiten auf `sprint/todo-2026-09-11` aufgefallen, bewusst nicht im
> Sprint erledigt. Übersicht des Sprints: `docs/REVIEW_SPRINT_2026-09-11.md`.

- [ ] **Platzierungsregeln: zwei weitere Kopien mit anderer Distanzformel**
      Maus-Vorschau, Klick und Training-Session prüfen seit dem Sprint über
      `utils/tower-placement-rules.ts` (`checkTowerPlacement`). Daneben stehen
      noch `TowerManager.validatePosition` (`tower.manager.ts:222`, ohne
      Bounds-Check, schnelle Quadrat-Distanz) und die Prüfung in
      `strategic-placement.service.ts:349`. Die sechs Placement-Strategien des
      Bots filtern damit vor; ungültig platziert wird nichts, weil die Session
      zuletzt `checkTowerPlacement` fragt, es fallen nur Kandidaten weg.
      Zusammenlegen ändert die Kandidatenwahl der Bots.
      **Entscheidung 2026-09-12:** zusammenlegen, eine Regelquelle für Spiel
      und Bots.

- [ ] **Decision-Explainer ist halb tot**
      `ai/core/decision-explainer.ts` schreibt seine Zusammenfassung nach
      `aiExplanation` im Game-Store, kein Template zeigt sie an;
      `lastExplanation` liest niemand. Übrig bleibt die Konsolen-Ausgabe im
      `debugMode`.
      **Entscheidung 2026-09-12:** im Wave-Debug-Fenster anzeigen (Zeile "Why
      this wave"), `aiExplanation` dafür nutzen, `lastExplanation` entfernen.

- [ ] **Debug-Fenster gemeinsam per `@defer` laden**
      Die elf Debug-Fenster liegen mit ~160 kB im Start-Bundle. Einzeln lohnt
      `@defer` nicht (8 kB Defer-Runtime gegen 13,8 kB beim Training-Fenster),
      gemeinsam schon. Befund aus dem Lazy-Training-Umbau (`85d8402`).

- [ ] **Kleinkram**
      Rocket-Düsenglühen (Trail-Streak) ist in der Länge FPS-abhängig ·
      `training-backend/scripts/analyze_log.py` hat kein argparse und liest
      `--help` als Logdatei · die Tower-Debug-Slider verschieben den Tip des
      CPU-Fallbacks, nicht die gecachte Grid-LOS (nur Debug) ·
      `SpatialGridService` rechnet Zellschlüssel mit `| 0` (Zelle 0 doppelt
      breit, beim Einfügen und Abfragen gleich, also kein Fehler) · elf Buttons
      in einzelnen Debug-Fenstern haben noch kein `aria-label` (meist `title`)
      · ein im Browser gecachter Fehlschlag beim Nachladen des Training-Chunks
      lässt sich per Retry eventuell nicht beheben, dann hilft nur ein Reload.

---

# PRIO 2 — Balance & Phase-5.16-Followups

> Aktueller Stand des parked Branches `feature/phase5.5-economy-ai-prep` — nach PRIO 1
> oder zwischendurch wenn Engine-Themen blockiert sind.

## 2.1 Tower-Balance

- [ ] **Schadensarten gegen Rüstungsarten viel deutlicher spreizen**
      Playtest 2026-09-10: Das Schadens- und Rüstungssystem hat zu wenig Einfluss.
      An manchen Gegnern sollen sich bestimmte Tower wirklich die Zähne
      ausbeißen, das Delta zwischen guter und schlechter Paarung muss deutlich
      größer werden.
      Stand in `combat/damage-matrix.config.ts` (Quelle MASTER_GAME_DESIGN.md
      2.3): Außer bei `ethereal` (0,15 bis 1,75) liegen fast alle Werte zwischen
      0,5 und 1,5. Gegen `unarmored` reicht die Spanne nur von 0,8 bis 1,2,
      gegen `light` von 0,7 bis 1,3, der beste Tower macht dort also nur das
      1,5- bis 1,9-Fache des schlechtesten.
      Beim Anpacken:
      - Ziel-Spreizung pro Rüstungsart festlegen, erst in MASTER_GAME_DESIGN.md,
        dann in der Matrix.
      - Folgen prüfen: Die Capability-Gates und der Fairness-Gate des
        Wave-Directors setzen voraus, dass die passende Tower-Art verfügbar ist;
        die Trainings-Bots und die Economy-Kurve (`npm run economy-chart`,
        `npm run tower-stats-chart`) ebenfalls.
      - Die Schwellen für die Schadenszahlen-Farben (`EFFECTIVENESS_THRESHOLDS`)
        an die neue Spreizung anpassen.
      Verwandt: 3.3 Damage & Armor System.
      **Stand 2026-09-12:** umgesetzt auf dem Sprint-Branch (`5b3102e`, Matrix
      nach `BALANCE_PROPOSAL_2026-09.md`, Fairness-Floor 0,6). Bestätigung im
      Playtest steht noch aus.


## 2.2 Phase 5.16 Playtest + Followups

> **Stand 2026-09-07:** Der Wave Director ist **regelbasiert und clientseitig**
> (`src/app/ai/core/rule-director.ts` + `gate-controller.ts`). Das ONNX-Modell
> liegt noch unter `public/assets/ai/wave-director/`, wird aber nicht mehr geladen
> — nur noch per explizitem `WaveDirectorService.loadModel()`. Die Difficulty-Knobs
> (`endgameHpMultiplier`, `enemyBaseDamageForWave`) und das Curriculum sitzen
> unverändert **hinter** dem Director und gelten für beide Pfade.
>
> **Ältere Notiz (2026-05-11):** Checkpoint ep 7350 wurde gegen das alte
> Reward-System trainiert; Schema v2 (162 Features) macht ihn ohnehin unladbar.
> Kontext: [HANDOVER_PLAYTEST_PHASE5.16.md](docs/HANDOVER_PLAYTEST_PHASE5.16.md).
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

- [ ] **Boss-Frequenz ab W31 verdichten**
      Plan war: ab W31 Bosse alle 5 Waves statt 10. Nicht implementiert — Curriculum
      loopt einfach mod-30. Override in `templateForWave()` für
      `wave > 30 && wave % 5 === 0`.
      Datei: `src/app/configs/wave-curriculum.config.ts`.
      **Stand 2026-09-12:** umgesetzt auf dem Sprint-Branch (`9e46b11`: jede
      fünfte Welle ab W31 Boss, zwei neue Boss-Templates, Boss-Gold ×2).
      Bestätigung im Playtest steht noch aus.

- [ ] **Wave-Curriculum Gold-Budget feinjustieren**
      Nach Live-Playtest: `goldKill`/`goldComplete` in `wave-curriculum.config.ts` anpassen.
      Nach jeder Änderung `npm run economy-chart` für Sanity-Check.
      **Stand 2026-09-12:** Nach dem Balance-Umbau steigt der Puffer bis W30 von
      25 % auf 83 %. Wer W30 mit mehr als 150k Gold oder über 20 Towern
      erreicht: Gold für W16 bis W30 um 20 % kürzen (Vorschlag §2.5).

- [x] **Stone Golem ins Wave-Curriculum aufnehmen** — erledigt 2026-08-27.
      `golem_squad` hat `minWave: 14`, steht auf W15 im Curriculum und ist über
      das generierte Schema auch im Backend sichtbar.
- [x] **Frontend/Backend Wave-Template-Drift beheben** — erledigt 2026-08-27.
      Strukturell gelöst statt nur synchronisiert: `templates.py`,
      `wave_curriculum.py` und die Enemy-Tabellen in `config.py` sind gelöscht.
      Das Backend liest `training-backend/generated/ai-schema.json`, erzeugt von
      `npm run ai-schema` aus den TS-Configs. `zombie_horde` mischt jetzt
      90 % `zombie` / 10 % `zombie-v2`.
- [x] **Lightning in AI/Bot integrieren** — erledigt 2026-08-27. Schema v2 nimmt
      Lightning als 10. Tower und 8. Damage-Type auf (162 statt 156 Features);
      der Bot hat es in `ALL_COMBAT_TOWERS` und `storm-mastery` in der
      Research-Reihenfolge.
- [ ] **Re-Training auswerten** — *Ergebnis liegt vor, Konsequenz gezogen (2026-09-07)*
      Der From-Scratch-Lauf ist ausgewertet: das trainierte Netz war in A/B-Runs
      dreimal statistisch ununterscheidbar von gleichverteiltem Zufall (mittlere
      Run-Länge 45,6 [42,49] gegen 44,7 [41,48]), während zwei triviale Heuristiken
      messbar mehr Spannung erzeugten (Near-Miss 0,067–0,069 gegen 0,045). Das Netz
      hatte nie gelernt — `log_std` unverändert, alle Faktor-Mittel auf sigmoid(0).
      Ursache lag **vor** dem Lernen: das Curriculum pinnt auf 49% der Wellen das
      Template, der Fairness-Cap bindet auf 63% — die volle Spanne des
      count-Faktors bewegte eine Welle von 19 auf 28 Gegner.
      Konsequenz: Betrieb läuft auf dem Regel-Director. Offen bleibt nur noch die
      **Entscheidung**, ob das Training weiterverfolgt wird (dann zuerst
      Aktionsraum aufmachen, nicht Reward tunen) oder ob der ONNX-Pfad entfällt.
      Vollständiger Befund: [docs/HANDOVER_TRAINING_REFRESH.md](docs/HANDOVER_TRAINING_REFRESH.md).

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
>
> **Hinfällig für den Regel-Director (2026-09-07):** Die beiden Decoder-Punkte
> unten adressieren beide Monotonie im Softmax des Netzes. Der Regel-Director hat
> gar keinen Softmax — er wählt das *älteste erlaubte* Template, Wiederholung ist
> damit strukturell ausgeschlossen statt nur bestraft. Relevant bleiben die Punkte
> ausschließlich, falls der ONNX-Pfad wieder produktiv wird.

- [ ] ~~**Temperature-Sampling im Decoder**~~ — nur bei ONNX relevant
      Bei Inference `softmax(probs / T)` mit T=1.5-2.0 statt `argmax`. Secondary Types
      bekommen mehr Raum ohne Neutraining. Null Training-Kosten, reiner Inference-Parameter.
      Datei: `src/app/ai/core/wave-director.service.ts` (`decodeModelOutput()`).

- [ ] ~~**Hard-Monotony-Cap im Decoder**~~ — durch die Stalest-Template-Regel erledigt
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

- [ ] **Explosions-Partikel feintunen** (nächste Runde, festgelegt 2026-09-12)
      Sprite-Sheet Partikel (Flash→Fireball→Rauch) — Timing, Größe, Farben polieren
      Betrifft Cannon- und Rocket-Einschläge. Zusammen mit
      "Advanced-Explosion-Staging" (zweistufig, Backlog) denken.

- [ ] **Screen Shake Performance untersuchen** (nächste Runde, festgelegt 2026-09-12)
      Aktuell deaktiviert wegen Performance-Bedenken
      Messen: tatsächlicher FPS-Impact, ggf. nur bei nahen Explosionen aktivieren
      Dateien: `screen-shake.service.ts`, Display Options Toggle

- [ ] **Loading Screen optimieren**
      Layout/Wirkung des Initial-Loading-Screens überarbeiten. Detaillierter Stats-Block
      und 3D-Tiles-Counter sind 2026 vorhandene Basis (siehe DONE.md), aber Polish steht
      aus. Konkretisieren beim Anpacken (Bullet-Liste was raus/rein soll).

- [ ] **Türme nach Zielverlust nicht in die Grundstellung drehen**
      Heute drehen Türme zurück, sobald kein Gegner mehr in Sicht ist
      (`updateTowerIdleRotations` → `resetRotation` in
      `tower-combat.service.ts`); das kostet bis 1 s bis zum nächsten Schuss,
      weil ein Tower erst schießt, wenn er ausgerichtet ist
      (`docs/game-design/UX_DISCUSSION_NOTES.md`).
      **Entscheidung 2026-09-12:** Während der Welle in der letzten Richtung
      stehen bleiben; nach der Welle zur Stelle drehen, an der die Route in die
      Reichweite eintritt (Wachrichtung).

- [ ] **Kampfspuren (Heatmap Schicht 1)**
      Studie: `docs/game-design/COMBAT_HEATMAP_STUDY.md` (machbar).
      **Entscheidung 2026-09-12:** Schicht 1 umsetzen: Brand- und Kampfspuren
      als Decals auf dem vorhandenen Decal-Pool, höchstens einer pro
      Route-Grid-Zelle (dedupliziert), rein optisch, Aufwand S. Die
      Kill-Heatmap (Schicht 2) bleibt vorerst weg.

- [ ] **Rocket Tower: Abschuss-Sound ersetzen**
      Geschoss und Schweif sind seit dem Sprint 2026-09-11 erledigt (DONE.md
      2026-09-12). Offen ist nur der Sound: `assets/sounds/towers/rocket/launch.mp3`
      ist ein tiefer Knall (87 % der Energie unter 150 Hz), per Pitch oder
      Filter wird daraus kein Zischen, und im Repo passt kein anderer Sound.
      Anforderung an ein neues Asset in `docs/PROJECTILES.md` unter "Bekannte
      Einschränkungen" (CC0, Zischen mit Schwerpunkt 1-6 kHz, 0,6-0,9 s, mono).

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
      Nächste Runde (festgelegt 2026-09-12).

- [ ] **Globale Damage-Matrix-Übersicht im UI** (Optional, niedrige Priorität)
      Tooltips zeigen aktuell nur Multiplier per Tower und per Enemy. Eine globale
      "vs"-Tabelle (alle Tower × alle Armor) gibt es nicht. Eigener Sidebar-Tab oder
      Hilfe-Dialog möglich.
      **Stand 2026-09-12:** Dialog auf dem Sprint-Branch (`46c350d` bis
      `324ca45`); nach dem Playtest überarbeitet (gesperrte Tower ausblenden,
      Breite, Optik) auf `wt/fix-matrixui`, Retest steht aus.

## 3.4 Wave Director — Build & Deployment

> Training-Code nicht in Prod Bundle

- [ ] **Build Configuration**
      `angular.json`: fileReplacements für Training-Code
      Production: Training-Module wird zu leerem Stub
      Bundle Size Check: AI < 300KB
      *Teilweise entschärft (2026-09-07):* `onnxruntime-web` wird nicht mehr beim
      Start importiert, sondern nur in `loadModel()` — die 404 kB liegen damit
      hinter einem Lazy-Chunk, den niemand mehr anfordert. Offen bleibt der
      Training-Code (`ai/training/`).
      **Stand 2026-09-12:** per Lazy-Loading statt fileReplacements umgesetzt
      (`85d8402`, `ab6a7c1`, `88ddc55`); Test mit Backend und DevWorld-Tab
      steht aus.

- [ ] **Model Validation** — nur relevant, falls der ONNX-Pfad produktiv wird
      `scripts/validate-model.js`
      Prüft: Format, Größe, Basis-Inference
      Läuft vor Commit (optional)

## 3.5 AI Training UI

- [ ] **Dashboard Header Styling verbessern**
      Status/Header Metriken besser stylen
      Model Metrics (Entropy, Grad Norm, etc.) als eigene Gruppe rechts
      Dezenter als Hauptmetriken, nach "Game Over" Bereich
      Dateien: `training-backend/dashboard/static/index.html`, `style.css`
      **Stand 2026-09-12:** umgesetzt (`c2ee884`), Sichtprüfung beim nächsten
      Trainingslauf steht aus.

## 3.7 UI-Feinschliff und Debug-Oberfläche

- [ ] **Design-Runde: Header, Next-Wave-Button, Dev-Menü**
      Playtest 2026-09-11 nach dem Sprint: Dev-Menü (zwei Spalten) und Header
      (bündig mit der Sidebar) sind funktional erledigt (DONE.md 2026-09-12),
      sehen aber noch nicht gut aus. Der Next-Wave-Button wirkt weiterhin
      billig, auch im Teal der Restart-Buttons (Idee: anderes Icon und Farbe,
      z. B. Gold für die wichtigste Aktion), die Header-Optik ist
      unspektakulär, das Dev-Menü mit seinen zwei Button-Spalten ist nicht
      hübsch. Gemeinsam gestalten statt einzeln, mit visuellem Feedback.
      **Entscheidung 2026-09-12:** über Design-Canvas-Mockups (Artifact), die
      der Nutzer zurechtklickt; danach setzt ein Worker exakt das um.

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
      **Stand 2026-09-12:** umgesetzt (`058df7a`), Test mit einem echten
      Trainingslauf (Checkpoint laden) steht aus.

## Performance - Advanced

- [ ] **zombie_v2-Modell extern weiter optimieren**
      Frames gegenüber dem alten `zombie.glb` aktuell deutlich schlechter, sichtbar
      vor allem bei sehr großen Waves (>2k Enemies). Externe Mesh-/Material-/
      Animations-Optimierung am Modell selbst (Polycount, Skeleton-Komplexität,
      Texturgrößen, VAT-Frame-Count, ggf. Splitting in LOD-Stufen) — kein
      Code-Fix, sondern Asset-Pass. Backup liegt als
      `public/assets/models/enemies/zombie_v2.original.glb.bak` vor.
      **Festgelegt 2026-09-12:** auf alle Gegnermodelle ausweiten: erst alle
      vermessen (Dreiecke, Knochen, Texturgrößen, VAT-Frames), die schwersten
      zuerst optimieren; das Blender-Werkzeug (MCP) ist angebunden.

- **Verworfen: Enemy Movement auf SoA (Structure of Arrays)**
      Nicht erneut als Teilumbau angehen. Gebaut in `bd1d3a5`, zurückgenommen in
      `731f454` (2026-08-22): 13 % langsamer als die Objektvariante (0,071 gegen
      0,063 ms pro 1000 Gegner und Substep). Die Gegner bleiben Objekte, weil
      Combat, Targeting, Events und Route-Grid sie so ansprechen; `setPosition`
      und `lookAt` schreiben dadurch weiter in verstreute Objekte, und der
      Staging-Pass kostet mehr, als die Lokalität der Eingabe-Arrays bringt.
      Sinnvoll nur als Komplettumbau, bei dem auch Position und Rotation in Arrays
      liegen und `presentFrame` direkt daraus liest. Vorbehalt aus dem Revert:
      gemessen unter jsdom, im Browser nie nachgemessen.

- [ ] **Object-Pooling für Projektile** - Pool-Größe: 500 pro Typ
      ⚠️ GPU-Instancing existiert bereits — Entity-Pooling (JS-Objekte) nochmal prüfen ob GC-Druck messbar ist
- [ ] **Tower-Model-LOD-System** - Three.js LOD: High/Medium/Low
- [ ] **BVH für Terrain Raycasts** - 50ms → 0.5ms (weniger kritisch, siehe Hinweis in PERFORMANCE_REPORT)
      Stand 2026-09-12: three-mesh-bvh ist nicht im Projekt, Raycasts gegen die
      Tiles laufen Dreieck für Dreieck. Nutzen bei Laden, Terrain-Sweeps,
      Platzier-Vorschau und Intro-Sampling, nicht bei den FPS in Wellen;
      Kosten: BVH-Aufbau pro Tile beim Laden, mehr Speicher. Erst messen, wie
      viel Zeit Raycasts heute kosten.
- [ ] **Web Worker Offloading** - weitere rechenintensive Logik
      Pathfinding läuft bereits im Worker (`pathfinding-worker.service.ts`).
      Übrige Kandidaten (Collision-Checks, Wave-Director-Inference,
      Audio-Decoding) bringen wenig; für die FPS in Wellen kein Hebel.
- [ ] **Tower GPU Instancing** - Schwierig wegen Rotationen

## Game-Loop Performance (Speed-Multiplikator)

> **Kontext:** Beim AI-Training mit hohen Speed-Multiplikatoren (x75) wurde Mitte 2026-05 der Substep-Fix eingebaut — Movement/Hittest/Status-Restzeit laufen jetzt mathematisch korrekt N× pro Frame. Beim normalen Gameplay mit aktivem Rendering brachen daraufhin die FPS bei x2/x4 sichtbar ein. Erste Hypothese (microStep/frameStep-Refactor) wurde profilet (`.profiles/`, 2026-05-07) und **falsifiziert**: ~80% der x4-Cost waren **gar nicht der Game-Loop**, sondern der `ModelPreviewService` (rotierende 3D-Modelle in der Sidebar) der pro Frame `WebGLRenderer.setSize()` aufrief und damit den WebGL-Drawingbuffer reallozierte. Der Fix (Renderer auf Max-Size + setViewport pro Preview) hat den Hot-Path eliminiert: x4 läuft jetzt mit 10.8% Idle-Reserve und 1.3% Dropped-Frames (vorher 0% Idle, 46% Drops). Damit ist das Symptom weitgehend gelöst, die folgenden Punkte sind nur noch optionale Mini-Hebel.

- [ ] **microStep/frameStep-Trennung** (LOW PRIO, nur bei Bedarf)
      `update()`-Kette aufteilen: `microStep(dt)` läuft N× pro Frame und enthält nur substep-kritisches (Movement, Hittest, Status-Restzeit-Decrement). `frameStep(totalDt)` läuft 1× pro Frame und enthält Targeting, Spatial-Grid-Rebuild, VFX/Audio-Trigger, Three.js-Sync, Signal-Emits.
      Aktuell **nicht dringend** — bei x4 mit ~1000 Enemies bleibt 10% Idle-Reserve. Erst bei extremen Setups (>2000 Enemies, x10+) wieder relevant. Determinismus für x75-Training muss erhalten bleiben.
      Startpunkte: `src/app/services/game-loop-facade.service.ts`, `src/app/managers/enemy.manager.ts:285`, `src/app/managers/projectile.manager.ts`, `src/app/managers/status-effect.manager.ts`.
      Einschätzung 2026-09-12: Nach dem Hot-Path-Umbau (21 → 48 FPS bei 20k)
      lohnt das nur noch bei extremen Speed-Faktoren im Training und gefährdet
      die Deterministik; weit hinten lassen.

- [ ] **Training-Bot-Snapshots lazy berechnen** (LOW PRIO)
      Stand 2026-09-11: war bereits umgesetzt (`updateBot(() => snapshot, dt)`
      mit `tickCooldown`), im Sprint nur Tests ergänzt (`f3b0c79`). Kann nach
      einem Trainingslauf geschlossen werden.
      Im Substep wird für den Bot ein kompletter State-Snapshot erzeugt, bevor klar ist,
      ob der Bot wegen Reaction-Cooldown überhaupt eine Entscheidung trifft. Bei x75 viele
      teure Snapshots pro gerendertem Frame.
      Lösung: Lazy-API (`needsBotDecision(dt)` oder `updateBotLazy(() => snapshot, dt)`) —
      der Cooldown tickt weiter pro Substep, der Snapshot wird erst nach Cooldown-Ablauf
      gebaut. Tests: Bot im Cooldown → Snapshot-Funktion nicht aufgerufen; nach Cooldown
      → genau einmal.
      Dateien: `src/app/services/facade/game-loop-facade.service.ts`,
      `src/app/ai/core/ai-data-collector.service.ts`,
      `src/app/ai/training/bots/base-tower-bot.ts`.

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

## Electron Desktop-Build

- [ ] **3DTD als Windows-Desktop-App (Electron) ausliefern**
      Eigenes `desktop/`-Unterprojekt mit `app://`-Protokoll, Dev-/Prod-Modus und
      NSIS-Installer. Proof-of-Concept am 2026-05-16 erfolgreich durchgespielt
      (Spiel lief im Fenster, Installer gebaut) und wieder zurueckgebaut. Vollstaendiger
      Plan inkl. Architektur-Entscheidungen, Best-Practice-Haertung, Cesium-Token-
      Runtime-Config und Code-Signing-Kostenuebersicht:
      [ELECTRON_DESKTOP_PLAN.md](docs/ELECTRON_DESKTOP_PLAN.md).

## Terrain & Routing Experimente

- [ ] **Laterales Sampling nur auf Routen** - Aktuell wird getGroundHeightEstimate für alle gefilterten Straßen aufgerufen (4 Extra-Raycasts pro Punkt). Optimierung: nur für Straßen die tatsächlich Routen sind das teure laterale Sampling nutzen, restliche Straßen im Korridor mit einfachem Raycast + Smoothing rendern
- [ ] **Gewässer von OSM laden** - `natural=water`, `waterway=river/stream/canal` über Overpass abfragen. Gewässer als unpassierbare Zonen ins Routing einbeziehen → Brücken werden natürliche Chokepoints (Engstellen). Optional: Gewässerflächen visuell auf der Karte darstellen

## Gameplay-Konzepte

- [ ] **Konzept: Spieler aktiver ins Geschehen einbinden**
      Idee 2026-09-10. Heute baut der Spieler nur und schaut zu; er braucht
      eine Möglichkeit, während einer Wave aktiv mitzumischen. Kandidaten:
      - **Held**, der aktiv mitkämpft und vom Spieler herumgeschickt wird
        (Klick auf ein Ziel, Bewegung über das Straßennetz).
      - **Weitere Gebäude mit Aufgaben** statt Schaden: Gold farmen, Drohnen
        aussenden, Pickup-Items aufsammeln usw. Vorbild für ein Nicht-Kampf-
        Gebäude ist das Research Center.
      - **Nuklearschlag** mit Cooldown, über den Research-Tree freischaltbar.
      Beim Ausarbeiten mitdenken:
      - Economy: Gold-Farm und Pickups greifen ins Gold-Budget des
        Wave-Curriculums (`npm run economy-chart`).
      - Wave-Director und Fairness-Gate lesen die Verteidigungsstärke aus den
        Towern; Held, Drohnen und Nuke müssen dort mitzählen, sonst passt der
        Director die Waves nicht an.
      - Die Trainings-Bots brauchen eine Strategie dafür oder ignorieren es
        bewusst.
      - Spieleraktionen im Sub-Step verarbeiten, damit die Simulation
        deterministisch bleibt (siehe MULTIPLAYER_CONCEPT.md).
      Ergebnis sollte ein Konzept in `docs/game-design/` sein, bevor gebaut wird.
      **Stand 2026-09-12:** Konzept liegt vor
      (`docs/game-design/PLAYER_AGENCY_CONCEPT.md`, Empfehlung Nuklearschlag
      zuerst). Nächster Schritt laut Nutzer: Konzept gemeinsam schärfen (Name
      der Fähigkeit, ob Fähigkeits-Kills für den Gate-Regler als Leck zählen,
      Ladungen pro Welle), erst danach bauen.

## Tower-Ideen

> Siehe auch: [MASTER_GAME_DESIGN.md](docs/game-design/MASTER_GAME_DESIGN.md)
> Tesla / Chaos sind bereits in PRIO 3.3 (Damage & Armor) gelistet — hier nur Verweis.

## Enemy-Ideen

> Siehe auch: [MASTER_GAME_DESIGN.md](docs/game-design/MASTER_GAME_DESIGN.md)

- [ ] **MechaCat** - Roboter-Katze als neuer Gegner-Typ
      Model bereits vorhanden: `public/assets/models/enemies/candidates/mechacat_01.glb`
- [ ] **Ghost** - `ethereal` Rüstung, nur Magic/Chaos wirkt (nächste Runde, festgelegt 2026-09-12)
- [ ] **Skeleton** - `unarmored`, Swarm (nächste Runde, festgelegt 2026-09-12)
