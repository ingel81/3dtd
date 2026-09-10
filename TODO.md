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

## 1.0 Aus dem Merge-Review — bewusst nicht im Merge behoben

> Alle vorbestehend (nicht durch den Merge verursacht), alle mit Datei-Fundstelle
> belegt. Reihenfolge = Einschätzung des Reviews.

- [ ] **Stille Höhenänderungen ohne Emit → dauerhaft stale Tower-LOS**
      `refineCellsInRadius` emittiert nur `promoted`, obwohl es `refreshed`
      mitzählt; `registerTower` / `registerTowerIncremental` rufen `sampleCellY`
      pro Zelle und emittieren nie. Ein LOD-Refresh verschiebt damit
      `terrainHeight`, ohne dass jemand es erfährt — und der Peek-Skip in
      `sampleCellY` sorgt dafür, dass der nächste Sweep für diese Zelle `false`
      liefert. Ein zweiter Turm, dessen Range die Zelle abdeckt, behält seine
      LOS gegen die alte Höhe **permanent**.
      Vorsicht beim Fix: Emit aus `registerTower*` heraus ist reentrant
      (der Listener ruft `recomputeTowerLOS`).
      Datei: `src/app/utils/global-route-grid.ts`.

- [ ] **Tower-LOS-Recompute pro Sweep-Slice statt pro Sweep**
      Das Frame-Budget des Sweeps begrenzt nur die Raycasts. `emitCellsChanged`
      läuft synchron im Slice, und der Handler macht pro betroffenem Turm ein
      `recomputeTowerLOS` → erzwungener Cubemap-Render plus Face-Readbacks.
      Derselbe Turm wird einmal pro Slice neu gerendert. Analog zum
      Route-Refresh über den Sweep akkumulieren und einmal am Ende laufen
      lassen (oder pro Turm pro Sweep dedupen).
      Dateien: `global-route-grid.ts`, `tower-placement.service.ts:onCellsChanged`.

- [ ] **`updateAnimations()` gated auch den GPU-Flush**
      `if (!this._showEnemies || !this._showAnimations) return;` überspringt
      `flushDirtyFlags()` und `updateBillboard()`. Bei „Animationen aus" laufen
      die Gameplay-Positionen weiter, aber `needsUpdate` wird nie gesetzt →
      Gegner und Health-Bars frieren sichtbar ein, Türme schießen scheinbar ins
      Leere. Nur `instanceManager.updateAnimations()` gehört hinter das Gate.
      Datei: `src/app/three-engine/renderers/instanced-enemy/instanced-enemy.renderer.ts`.

- [ ] **Weitere LOS-invalidierende Research-Effekte suchen**
      `recomputeTowerLOS` läuft heute bei Range-Upgrade, Terrain-Änderung und
      (neu im Merge) AA-Retrofit. Prüfen, ob es weitere Effekte gibt, die die
      Registrierung eines platzierten Turms entwerten, ohne einen Recompute
      auszulösen.

- [ ] **`activeCount` schrumpft nie (Instancing)**
      In Health-Bar-, Enemy- und Projectile-Manager ist `activeCount` eine reine
      High-Water-Mark; `remove()` dekrementiert nicht. Nach einer Peak-Wave
      laden die Frame-Flushes dauerhaft Peak-große Ranges hoch (bei 20k-Peak
      ~1,25 MB `instanceMatrix` + ~240 KB `aCenter` pro Frame, bis `clear()`).
      Fix: beim Freigeben des obersten Slots über die trailing freien Indizes
      schrumpfen.

- [ ] **`ProjectileInstanceManager` hat gar keine Update-Ranges**
      Jedes `needsUpdate` lädt den vollen `maxCount`-Buffer (Bullet-Pool
      1000×16×4 = 64 KB pro Frame bei aktiven Projektilen). Gleiche Behandlung
      wie in Enemy-/Health-Bar-Manager.

- [ ] **Health-Bar-Meshes tragen 2,56 MB ungenutztes `instanceMatrix`**
      Seit dem GPU-Billboard nutzt der Shader `instanceMatrix` nicht mehr, der
      Renderer lädt es für jedes `InstancedMesh` trotzdem hoch: 2 × 20 000 × 16
      Floats. Kein Logikfehler, nur Ballast — Ausweg wäre `Mesh` +
      `InstancedBufferGeometry` statt `InstancedMesh`.

- [ ] **Beam-Fallback-Query nutzt den falschen Radius**
      `updateBeamTowers` fragt das Grid mit `beamRange` (20 m) ab, `findTarget`
      prüft aber gegen `combat.range` (25 m) — im Fallback ohne `visibleCells`
      sind Gegner im Ring dazwischen unsichtbar.
      Datei: `src/app/services/combat/tower-combat.service.ts`.

- [ ] **Kleinkram aus dem Review**
      `stopTowerBeam` löscht `lastBeamBloodEffect` per Tower-ID, die Map ist per
      Enemy-ID gekeyt (No-op, Einträge bleiben bis Wave-Ende) ·
      `damage-application.service` zählt `kills++` auch wenn `kill()` am
      `killingEnemies`-Guard early-returnt (heute unerreichbar, künftig eine
      Falle) · `movement.effectiveSpeed`-Getter ist ein Legacy-Duplikat von
      `getEffectiveSpeed` mit falscher Semantik, nur noch von Specs benutzt ·
      Melee-Wake-Check nutzt Literal `* 1.1` statt
      `COMBAT_TUNING.rangeMargin.standard` · die vier `update*Towers`-Methoden
      teilen einen fast identischen Kandidaten-Block (Helper-Extraktion).

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

## 1.2 Refactoring (Housekeeping Tier 3)

- [ ] **`three-tiles-engine.ts` weiter abspecken — Camera-Setup + Tile-Loading-State**
      Post-Processing ist 2026-05-10 raus (PostProcessingPipeline, siehe DONE.md).
      Noch offen: Camera-Setup (GlobeControls + Initial-Position) und Tile-Loading-State-Machine
      (firstTilesLoaded, retry, debounce). Beide deutlich enger mit `tilesRenderer.initialize()`
      verzahnt — eigene Session mit Plan vorab.

- [ ] **`game-sidebar.component.ts` in Sub-Components aufteilen** (Engine-Deep-Review MOD-2)
      Inline-CSS ist 2026-05-22 in `game-sidebar.component.scss` ausgelagert (→ DONE.md),
      die Component ist dadurch von 1868 auf 725 LOC geschrumpft. Noch offen: die 4
      vermischten Fachdomänen (Tower-Detail, Wave-Panel, Research, Damage-Tooltips)
      in eigene Sub-Components trennen.

- [ ] **`global-route-grid.ts` aufsplitten** (Engine-Deep-Review MOD-4)
      Daten (`RouteCell`-Modell), Algorithmus (Sampling/LOS-Resolve), Debug-API (`__rg.*`)
      und Viz (Aggregate-Mesh) in getrennte Module ziehen. Hot-Path-Klasse — Split muss
      verhaltenserhaltend bleiben, eigene Session mit Plan vorab.

## 1.3 Test-Coverage (Housekeeping Tier 4)

> Cleanup-Pass 2026-05-11 + Engine-Deep-Review 2026-05-16 (160 neue Tests) +
> TEST-6..10-Lücken 2026-05-21 (59 neue Tests) → DONE.md.
> Keine offenen Test-Coverage-Lücken.

## 1.4 CPU Hot-Path Optimierungen

- [ ] **Tower-LOS Zoom-In-Spike glätten** (optional, niedrige Priorität)
      Beim großen Reinzoomen aus Distanz refreshen 800+ Route-Grid-Cells
      gleichzeitig (echte Massen-LOD-Promotion durch nachstreamende Google-
      Tiles). Der `onCellsChanged`-Listener recomputed die LOS für die
      betroffenen Tower dann synchron in einem ~1-2s Frame-Block.
      Gemessen 2026-05-16: `refreshed=861` → `onTilesLoaded` 2197ms,
      `refreshed=812` → 1038ms. Tritt nur 1-2 Frames nach einem großen
      Zoom-Sprung auf, nicht beim normalen Spielen während einer Wave.
      **Lösung:** LOS-Recompute rAF-budgetiert über mehrere Frames verteilen
      (~150 Cells/Frame) statt synchron — gleiche Gesamtarbeit, aber kein
      einzelner Frame-Stall.
      Nur angehen, falls es im Spielbetrieb auffällig stört — der häufige
      Pan/Zoom-Fall ohne LOD-Wechsel ist bereits gefixt (~8000ms → ~30ms).
      Dateien: `src/app/services/tower-placement.service.ts` (`onCellsChanged`),
      `src/app/utils/global-route-grid.ts` (`updateTerrainHeights`).

## 1.5 Render-/GPU-Hebel aus Deep-Dive 2026-05 (verschoben, messgestützt)

> Aus PR #5 / [PERF_BUG_ANALYSIS_2026-05-28.md](docs/PERF_BUG_ANALYSIS_2026-05-28.md).
> Die risikoarmen High-Value-Findings sind umgesetzt (Bugs, LOS-Readback-Batching,
> Bounding-Box-Tower-Reg, Targeting-Hot-Path, Health-Bar-Buffer-Sharing, Trail-Material-
> Sharing u.a.). Die folgenden sind größere Shader-/Buffer-Umbauten oder visuelle/
> balance-relevante Änderungen — **vor Umsetzung Frame-Time im echten Render messen**
> (davor/danach), da hier kein Headless-/GPU-Test greift. Sichere Teilvarianten sind
> jeweils bereits drin.

- [ ] **P2 — Lightning-Bolts auf `InstancedMesh`** (größter offener VFX-Hebel)
      192 Mesh+Material dauerhaft in der Szene; Geometrie wird komplett im Shader aus
      `uStart/uEnd/uSeed` erzeugt → ideal für 1 InstancedMesh mit Per-Instance-Attributen.
      Bis zu 192 Draw Calls → 1, 192 Materialien → 1. Voller Rewrite des Renderers.
      Datei: `src/app/three-engine/renderers/lightning-bolt.renderer.ts`.

- [ ] **R4-Experiment — `logarithmicDepthBuffer` evaluieren**
      logDepth schreibt `gl_FragDepth` → deaktiviert Early-Z auf vielen GPUs über die
      gesamte Tile-Geometrie. Experiment: entfernen + `camera.near` 1→5-10m anheben (Spiel-
      Skala ~150m, Fern-Z im Fog). Z-Fighting-Risiko → nur mit visuellem Vorher/Nachher.
      Sichere Teilmaßnahme (`powerPreference`/`stencil:false`) ist bereits drin.

- [ ] **G5-`addUpdateRange` — Rest: `ProjectileInstanceManager`**
      Enemy- und Health-Bar-Manager laden seit dem Merge nur noch die aktive
      Scheibe hoch (`clearUpdateRanges()` + `addUpdateRange(0, activeCount*n)`
      im Frame-Flush, per-Slot-Ranges auf den Einzelpfaden). Offen ist nur noch
      der Projektil-Pool — siehe 1.0b.

- [ ] **Render-Kleinkram (LOW)** — R6 Empty-Frame-Guards, R9 Skybox als CubeTexture/weglassen,
      R10 Lichtquellen reduzieren, G8 gecachte Instanz-Arrays, P6 Decal-Fade-Idle-Skip,
      P8 `markPoolDirty`-Edge-Case (erst zentralen Pool-Flush-Mechanismus verifizieren —
      die im Report genannte API existiert im Renderer nicht direkt).

- [ ] **L3 — 3D-Range für Luftziele** (balance-relevant)
      Range-Check ist rein horizontal (2D). Für Air ggf. echte 3D-Distanz inkl. Flughöhe
      (~15-20m) — würde Air-Türme nerfen. Aktuell bewusst als horizontale Reichweite
      dokumentiert; bei Bedarf als bewusste Balance-Entscheidung umstellen.

- [ ] **cellsInRange — Range-Monotonie absichern, falls Range-Debuffs kommen**
      Die Bounding-Box-Tower-Registrierung (`global-route-grid.ts`) setzt voraus, dass
      Tower-Range nie schrumpft (aktuell garantiert: `range *= 1.04/1.02`). Wird je ein
      Range-Debuff / Downgrade eingeführt, müssen Stale-Visibility-Entries für Zellen
      außerhalb der neuen (kleineren) Box wieder bereinigt werden (z.B. alte Range merken
      und die Differenz-Annulus aufräumen, oder `unregisterTower`+full re-register).

---

# PRIO 2 — Balance & Phase-5.16-Followups

> Aktueller Stand des parked Branches `feature/phase5.5-economy-ai-prep` — nach PRIO 1
> oder zwischendurch wenn Engine-Themen blockiert sind.

## 2.1 Tower-Balance

- [ ] **Tower-Upgrade-Skalierung feintunen**
      Aktuell teilen sich fast alle Combat-Tower dieselben Standard-Multiplikatoren
      (`tower-types.config.ts:62-65`; Archer hat eine eigene Range-Kurve ×1.02):
      - Damage: ×1.05/Level (L25 ≈ ×3.39)
      - Fire Rate: ×1.06/Level (L25 ≈ ×4.29)
      - Range: ×1.04/Level (L25 ≈ ×2.67)
      → kombiniert L25 ≈ ×14.5 Base-DPS bei voller damage+speed-Spec, plus ×2.67 Reichweite.
      (costScaling ist 1.25, nicht 1.40 — die früher hier notierten Werte waren veraltet.)
      Beispiel Archer: auf hohen Leveln viel zu stark in Reichweite + Speed + Damage gleichzeitig — quasi unkillbar/unbalanciert.
      Pro-Tower-Skalierung statt globale Konstanten? Oder andere Curve (z.B. niedrigerer Multiplier ab L15+)? Konzept überlegen, Werte balancen.


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

- [ ] **Wave-Curriculum Gold-Budget feinjustieren**
      Nach Live-Playtest: `goldKill`/`goldComplete` in `wave-curriculum.config.ts` anpassen.
      Nach jeder Änderung `npm run economy-chart` für Sanity-Check.

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

- [ ] **Diskussion: Türme nach Wegfall des Ziels nicht in Grundstellung zurückdrehen**
      Aktuell drehen Türme ihren Turret zurück in die Grundausrichtung,
      sobald kein Gegner mehr in Sichtweite ist (`updateTowerIdleRotations`
      → `resetRotation` in `tower-combat.service.ts`).
      Vorschlag/TBD: stattdessen in der zuletzt eingenommenen Ausrichtung
      stehen bleiben — wirkt „wacher" und spart die Rück-Animation.
      Erst als Diskussionspunkt aufnehmen: die Grundstellung kann auch
      gewollt sein (aufgeräumtes Bild zwischen Waves). Pro/Contra klären,
      bevor implementiert wird.
      Datei-Anker: `src/app/services/combat/tower-combat.service.ts`
      (`updateTowerIdleRotations`, `resetRotation`).

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

- [ ] **`burn` Status-Effekt: totlegen oder fertig bauen**
      `burn` ist im `StatusEffectType`-Union (`status-effects.ts:4`), wird aber von
      `MovementComponent.updateStatusEffects` nicht behandelt — nur slow/freeze/poison
      haben Tick-/Gameplay-Logik. `burn` ist damit aktuell ein toter Typ ohne Wirkung.
      Erst prüfen, ob überhaupt etwas `burn` appliziert (Flame Tower?). Dann entscheiden:
      entweder vollwertigen DOT-Tick analog `poison` implementieren (Game-Time-skaliert,
      kein Wall-Clock — High-Timescale muss identische Ergebnisse liefern) — oder den Typ
      ersatzlos entfernen. Größerer Status-Effekt-/Enemy-Trait-Ausbau (Regen, Shielded,
      Camo, Mark) ist ein separates Game-Design-Thema (MASTER_GAME_DESIGN.md).
      Dateien: `models/status-effects.ts`, `game-components/movement.component.ts`,
      `entities/enemy.entity.ts`.

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

- [ ] **Training-Bot-Snapshots lazy berechnen** (LOW PRIO)
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
