# Handover: Training-Backend Refresh (From-Scratch-Retraining)

**Branch:** `feat/training-backend-refresh`
**Stand:** 2026-08-27 — Trainingslauf aktiv

Ziel: Das Training-Backend auf den aktuellen Spielstand bringen, damit ein
From-Scratch-Trainingslauf überhaupt sinnvolle Gradienten bekommt. Ausgangslage
war eine Drift von ~3,5 Monaten zwischen `training-backend/` (letzter Stand
2026-05-08), dem Frontend-AI-Code (2026-05-23) und der Engine (2026-08-22).

Vollständiger Analysebefund mit Zeilenreferenzen: siehe Abschnitt
[Befunde](#befunde) unten.

---

## Was sich beim Umsetzen als der eigentliche Kern herausstellte

Die ursprüngliche Analyse (Drift, Schema, Bot, DevWorld) war richtig, aber
nicht der Grund, warum das Training nichts taugte. Zwei Reviews und der
Messbetrieb haben drei tiefere Ursachen freigelegt:

1. **Die Reward-Funktion machte es optimal, den Spieler zu töten.** Der Spieler
   heilt nie (`healBase()` hat keinen Produktivaufruf), das Wave-Optimum
   verlangt aber 1-5 % HP-Verlust — nach ~33 Waves ist er konstruktionsbedingt
   tot. Der Tod kostete einmalig −3,5, der Weg dorthin brachte ~+3 pro Wave.
   „Ausbluten und erledigen" schlug jede nachhaltige Strategie.
2. **Waves wurden isoliert bewertet.** Ein Tod in Wave 11 entsteht aus den
   Entscheidungen in Wave 8-10; keine davon wurde dafür belangt. Der Value-Head
   war kein Value-Head, sondern ein Reward-Prediktor.
3. **Das Fairness-Gate rechnete zweimal falsch.** Erst in Schaden statt in
   Tötungen (ein Turm trifft ein Ziel pro Schuss und verwirft den Überschuss),
   dann mit einer festen Feuerzeit von 30 s statt der Zeit, die ein Gegner
   tatsächlich in Reichweite ist. Beides ließ Schwärme durch, die rechnerisch
   trivial aussahen.

## Getroffene Grundsatzentscheidungen

1. **Curriculum-Scope:** W1-30 werden forciert, indem die Template-Maske auf
   genau das Curriculum-Template reduziert wird (Sample == gelieferte Wave).
   Ab W31 wählt der Template-Head frei mit der normalen Maske. Damit ist die
   Credit-Assignment wieder korrekt und der Head lernt auf ~70 % der Waves einer
   100-Wave-Episode echte Entscheidungen.
2. **State-Schema erweitern:** `INPUT_SIZE` 156 → 162. Das alte Checkpoint 7350
   wird dadurch unbrauchbar — bei From-Scratch irrelevant, und es ist der einzige
   saubere Zeitpunkt für die Schema-Änderung.
3. **Single Source of Truth:** Ein Generator (`npm run ai-schema`) leitet
   `training-backend/generated/ai-schema.json` aus den TypeScript-Configs ab;
   Python liest ausschließlich diese Datei. Die Doppelpflege
   `templates.ts`/`templates.py` und `wave-curriculum.config.ts`/`wave_curriculum.py`
   entfällt strukturell.

---

## Phasen

### P0 — Training-Korrektheit — **erledigt**

- [x] `survived` aus `outcome.playerSurvived` statt aus dem nicht existierenden
      `outcome.gameOver`. Der DEATH-Term hatte deshalb **nie** gefeuert.
- [x] Frontend sendet `stateAfter` auch auf dem `game:over`-Pfad.
- [x] `enemyProgressValues` im Game-Over-Finalize gesetzt.
- [x] Curriculum-Forcing sitzt in der Maske: bis W30 genau ein Template, damit
      die gesampelte Aktion die gelieferte Wave IST. Der Decoder-Override
      trainierte den Template-Head zuvor auf nie gespielte Aktionen.
- [x] Checkpoint trägt Optimizer-State, Episode und Reward-Statistik.
- [x] `transitions` verbrauchen die ältesten statt die Liste zu leeren.
- [x] `win_streak` aus dem Wave-Ergebnis abgeleitet.
- [x] Discounting ist da (GAMMA 0.9 + GAE), nicht mehr nur ein toter Parameter.
- [x] Längen-Assert statt stiller Trunkierung.

### P1 — Content-Sync via SSOT — **erledigt**
- [x] Generator `tools/ai-schema/generate.spec.ts` → `training-backend/generated/ai-schema.json`.
- [x] `npm run ai-schema`; läuft mit `npm test` mit, eine stale JSON zeigt sich als dirty tree.
- [x] `templates.py`, `wave_curriculum.py` und die Enemy-Tabellen in `config.py`
      **gelöscht** — Python liest nur noch die generierte JSON.
- [x] `golem_squad` mit `minWave: 14` statt 999.
- [x] `zombie_horde` auf 90 % `zombie` / 10 % `zombie-v2` (Perf-Risiko bei Mega-Hordes).
- [x] `endgameHpMultiplier` im Backend-Decoder angewandt.
- [x] Rundungs-Parität bei `spawn_delay`.

### P2 — Encoder-Erweiterung — **erledigt** (156 → 203, Schema v3)
- [x] `zombie-v2` + `stone-golem` in Enemy-Order, Armor-Map und Threat-Rating.
- [x] `lightning` als 10. Tower und 8. Damage-Type.
- [x] `maxUpgradeTier / 5`; Episodenfortschritt gegen `EPISODE_LENGTH`.
- [x] `gameTimeSeconds` ab Spielstart statt ab Wave-Start.
- [x] `expectedArmorDistribution` aus dem Curriculum-Template statt Uniform-Fallback.
- [x] `computeTowerHash` über die echte DPS-Funktion.
- [x] Wave-Kontext (Maske + Ranges + Fairness-Headroom) und AoE-Anteil ergänzt.
- Nicht gemacht: der „History-Padding-Bug" war ein Fehlalarm — beide Seiten
  fangen den negativen Index ab und padden korrekt links.

### P3 — Bot — **erledigt**
- [x] `lightning` in `ALL_COMBAT_TOWERS`, `storm-mastery` in den Research-Listen.
- [x] `etherealGap` + `AntiEtherealPlacementStrategy`.
- [x] Tower-Bewertung über `computeTowerDPSFromLevels` (Beam/Chain zählten mit 0).
- [x] Anti-Air und Splash nach Wirksamkeit statt hartkodierter Liste.
- [x] Upgrade-Tier-Regel geteilt (`requiredUpgradeTier`) und bis Tier 5.
- [x] Toter Auswahl-Code entfernt.
- [x] `maxTowers` 300 → 80 und Upgrade-Strategie über 8 statt 1 Tower — der Bot
      baute 298 Tower und drückte damit den Sub-Step-Loop auf 2 FPS.

### P4 — DevWorld — **erledigt**
- [x] Höhenabfragen auf die Mesh-Auflösung ausgerichtet (Grundwahrheit vs. LOS-Blocker).
- [x] Straßen und Skirt über `userData.losTransparent` aus dem Cube-Render.
- [x] `dispose()` beim Engine-Teardown (Worker-Leak).
- [x] `onDevWorldRegenerated` re-seedet die Wave-Pipeline.
- [x] `areTilesVisible()` korrekt.
- Bewusst **nicht** gemacht: alle vier Spawns übernehmen. Der Realwelt-Pfad
  erzeugt ebenfalls genau einen; die vier im Generator sind Vorarbeit für einen
  späteren Multi-Lane-Modus. Vier Routen gegen dasselbe Tower-Budget wäre ein
  anderes Spiel als das ausgelieferte.

### P5 — Infrastruktur — **erledigt**
- [x] `--fresh` in `server.py` und `manage_server.py` (archiviert, löscht nicht).
- [x] `checkpoint_latest.pt` wird geschrieben — `export-ai` lief vorher immer auf Fehler.
- [x] `pytest` in `requirements.txt`, Tests umgestellt und erweitert.
- [x] Key-Drift in `tui_logger.py` und `dashboard/app.py`.
- [x] Doppelte `PPOTrainer`-Instanziierung, tote Imports, `ExperienceBuffer`.

### P6 — Dokumentation — **erledigt**
Alle unter [Doku-Fehler](#f-doku-fehler) gelisteten Punkte korrigiert.

### P7 — Trainingslauf
`/training fresh` — Backend + Dashboard + Dev-Server + N sichtbare Chrome-Tabs
auf `?devworld`, headless (Rendering aus), Timescale 75. Beobachtung über
`http://localhost:3002`.

### P8 — RL-Umbau (aus zwei Reviews) — **erledigt**

- [x] Trajektorien pro Client, discounted Returns + GAE, `done`-Flag.
- [x] Death-Penalty −3,5 → −30, dominiert den Run der ihn verursacht hat.
- [x] Swarm und Progression nur noch im 1-5 %-Band; Swarm zusätzlich an
      Mindest-Progress gekoppelt. Swarm-Cap 2,0 → 0,5.
- [x] Batch 16 → 128 mit Minibatches, KL-Early-Stop, Advantages einmal
      standardisiert, Reward-Normalisierung nur skalierend und einmalig beim
      Einsammeln (vorher rechnete GAE roh gegen skalierte Values — der Critic
      war damit wirkungslos).
- [x] Entropie nur auf dem Template-Head, `log_std` geklemmt und unterhalb der
      Grenze initialisiert.
- [x] Deterministische Evaluation alle 25 Runs, getrennt ausgewiesen.
- [x] Fairness-Gate in Kills/s statt Schaden/s, Feuerzeit aus Gegnergeschwindigkeit.

### Offene Punkte

- [ ] Wave 1 bleibt die Schwachstelle — dort sterben noch die meisten Runs.
- [ ] Zielwerte festzurren, sobald der Lauf stabil ist (siehe Abnahmekriterien).
- [ ] ONNX exportieren und im Browser gegen den Backend-freien Pfad prüfen.

---

## Befunde

### A. Training-Korrektheit

| # | Befund | Ort |
|---|---|---|
| A1 | DEATH-Term feuert nie: `survived` liest `outcome.gameOver`, das Feld heißt `playerSurvived`. Game-Over-Pfad sendet ohne `stateAfter`. | `server.py:856`, `wave-result.ts:66`, `training-client.service.ts:433` |
| A2 | Template-Head trainiert auf Rauschen: PPO speichert den gesampelten Index, der Decoder ersetzt ihn durchs Curriculum. | `server.py:490-497` vs. `:755-756` |
| A3 | Curriculum umgeht die Maske → `boss_herbert` (min_wave 20, boss_only) auf W10; `confidence` dann exakt 0.0. | `server.py:755-756`, `:811` |
| A4 | Checkpoint = nacktes `state_dict`; Adam-Momente und Reward-Normalizer resetten bei jedem Serverstart. | `model.py:203` |
| A5 | PPO ohne Discounting/GAE; `GAMMA` importiert, nie benutzt. | `trainer.py:14,112` |
| A6 | `transitions = []` verwirft ungenutzte Übergänge über `BATCH_SIZE` hinaus. | `trainer.py:84,185` |
| A7 | `win_streak` bleibt 0 — `notifyGameOver` wird nie aufgerufen. | `training-client.service.ts:619` |
| A8 | `enemyProgressValues` fehlt auf dem Game-Over-Pfad. | `ai-data-collector.service.ts:455-513` |

### B. Frontend/Backend-Drift

| # | Befund |
|---|---|
| B1 | Enemies: FE 18, BE 16 — `zombie-v2` und `stone-golem` fehlen. |
| B2 | Templates: FE 19 (Slot 18 `golem_squad`, minWave 999), BE 18. Slot 18 bedeutet auf beiden Seiten Unterschiedliches. |
| B3 | `zombie_horde`: FE `zombie 0.5 / zombie-v2 0.5`, BE `zombie 1.0`. |
| B4 | Curriculum W15: FE `golem_squad`, BE `mech_army`. |
| B5 | `endgameHpMultiplier` fehlt im Backend-Trainingspfad. |
| B6 | `enemyBaseDamageForWave` (Leak-Schaden ab W11) fehlt im Backend. |
| B7 | `spawn_delay`-Rundung: FE `Math.round`, BE `int()`. |
| B8 | BE sendet `speedMultiplier`/`useGathering`, FE-Decoder nicht. |
| B9 | `TrainingStats.currentBotType` erwartet FE, BE sendet es nie. |
| B10 | BE sendet nie `{"type":"error"}`, FE modelliert es. |

### C. Encoder-Blindstellen

| # | Befund | Ort |
|---|---|---|
| C1 | Enemy-Order/Armor-Map/Threat-Rating: 16 Einträge, 2 fehlen. | `game-state-encoder.ts:55-120`, `server.py:648` |
| C2 | Tower-Order 9 statt 11 — `lightning` und `research-center` unsichtbar. | `game-state-encoder.ts:76`, `server.py:550` |
| C3 | Damage-Type-Order 7, `lightning` bewusst ausgeschlossen. | `game-state-encoder.ts:86` |
| C4 | `maxUpgradeTier / 3` bei Tiers bis 5. | `research-tree.config.ts:186,198` |
| C5 | `wave_num / 20.0` als Episodenfortschritt bei `EPISODE_LENGTH = 100`. | `server.py:588` |
| C6 | History-Slicing erzeugt negative Indizes bei < 5 Einträgen. | `game-state-encoder.ts:194,200,285,312` |
| C7 | `gameTimeSeconds` misst ab Wave-Start, kodiert wird `gameTime/3600`. | `ai-data-collector.service.ts:143` |
| C8 | `expectedArmorDistribution` wird nach jeder Wave genullt → Uniform-Fallback in der Planungsphase. | `ai-data-collector.service.ts:578` |
| C9 | Features [15-19] und [74-78] sind identisch. | `game-state-encoder.ts` |
| C10 | `computeTowerHash` nutzt `damage * fireRate` → Beam/Chain/DoT-Upgrades invalidieren den DPS-Cache nicht. | `ai-data-collector.service.ts:637` |
| C11 | Keine Längenvalidierung, nur stille Trunkierung. | `server.py:721` |

### D. Bot

| # | Befund | Ort |
|---|---|---|
| D1 | Keine Anti-Ethereal-Strategie; `etherealGap` existiert nicht. | `defense-analyzer.ts:82-85` |
| D2 | `lightning` fehlt in `ALL_COMBAT_TOWERS`. | `tower-bot.interface.ts:105-107` |
| D3 | `fire` bewertet sich zu 0 (Beam hat `damage: 0`). | `tower-strategy.interface.ts:90-94` |
| D4 | Anti-Air wählt immer `archer` statt `rocket`/`ice`. | `anti-air-placement.strategy.ts:31-46` |
| D5 | Splash hardcodet `cannon`/`rocket`, ignoriert `fire`/`lightning`. | `splash-defense-placement.strategy.ts:31,39` |
| D6 | Upgrade-Tier-Mapping endet bei 3, Tiers 4/5 unerreichbar. | `near-spawn-upgrade.strategy.ts:77` |
| D7 | `hasAntiAirCapability` prüft nur `rocket`. | `research-pick.strategy.ts:190` |
| D8 | Damage-Matrix-Auswahl ist toter Code. | `base-tower-bot.ts:98-231` |

### E. DevWorld

| # | Befund | Ort |
|---|---|---|
| E1 | Nur `generatedSpawns[0]` wird übernommen → immer genau 1 Spawn. | `location-facade.service.ts:294-301` |
| E2 | Grundwahrheit aus 1024²-Heightmap, LOS-Blocker-Mesh mit 64 Segmenten → Divergenz bis zig Meter auf hügeligem Terrain. | `dev-terrain.provider.ts:315,567,816` |
| E3 | Straßen blocken in der GPU-Cubemap, im CPU-Raycast nicht. | `dev-terrain.provider.ts:26,799-805` |
| E4 | `dispose()` wird nie aufgerufen → Generator-Worker leakt bei jedem Tab-Reload. | `three-tiles-engine.ts:2199-2258` |
| E5 | `onDevWorldRegenerated` re-seedet die WaveManager-Spawns/Pfade nicht. | `location-facade.service.ts:722-762` |
| E6 | `areTilesVisible()` liefert in DevWorld `true`. | `three-tiles-engine.ts:2014` |
| E7 | `hydraulicErosion` nutzt fest `mulberry32(42)` statt `config.seed`. | `terrain-generator.ts:162` |

### F. Doku-Fehler

| # | Befund |
|---|---|
| F1 | `reward.py:16-17` + `AI_TRAINING_BACKEND.md:257`: "Hard Constraints (Monotony, Armor-Dominance, Fairness) live in the decoder" — in Phase 5.11 entfernt, existiert nicht mehr. |
| F2 | `reward.py:9`: Sweet-Zone "1-10%" → real 1-5%. |
| F3 | `reward.py:12`: Swarm-Cap "~2700 enemies" → real 1353. |
| F4 | `wave_curriculum.py:14`: Mirror-Pfad `src/app/ai/core/wave-curriculum.ts` existiert nicht. |
| F5 | `templates.py:10-11` + `templates.ts:11-12`: "Slots 0-17 aktiv" → FE hat 19. |
| F6 | `game-state-encoder.ts:35-38`: "Backend encodes 181 features" — falsch, identisch 156. |
| F7 | `game-state-encoder.ts:168` "(74 features)", `wave-director.service.ts:207` "shape: [1, 74]". |
| F8 | `models/wave-config.ts:13`: Pfad `models/enemy-types.ts` existiert nicht. |
| F9 | Curriculum-Override gilt laut Docs "W1-18" — real jede Wave im mod-30-Loop. |
| F10 | Gold-Budget in `HANDOVER:25-26` / `PHASE_5.11_RANGES.md:167-173`: W1 30/15, W30 650/325, lineare Extrapolation → real 133/67 … 120000/60000, mod-30-Loop. |
| F11 | Upgrade-Skalierung in `HANDOVER:31-33` / `TODO.md:226-232`: ×1.10/×1.07, costScaling 1.40 → real ×1.05/×1.06/×1.04, costScaling 1.25. |
| F12 | `HANDOVER:49`: "60% Refund" → real `SELL_RATIO = 0.75`. |
| F13 | `HANDOVER:104-105`: Per-Kill-Rounding-Bug "bekannt offen" → gefixt in `enemy.manager.ts:265-289`. |
| F14 | `PHASE5.5_TRAINING_RUNBOOK.md`: Banner INPUT_SIZE=93/OUTPUT_SIZE=20; Dashboard-Start `cd dashboard && python app.py` ist nicht lauffähig. |
| F15 | `docs/BOT_SYSTEM.md` breit veraltet: `mistakeRate`/`plansAhead`/`knownTowerTypes` existieren nicht, Prioritäten falsch, Archer-Limit dynamisch statt 4, NearSpawn 70/90 % statt 33 %, Game-Time- statt `Date.now()`-Cooldown, `research-start`/`research-cancel` fehlen. |
| F16 | `model.py:34,121`: "2 continuous params" → 4. |
| F17 | `RESEARCH_CENTER_CONFIG.baseCost = 150` unreferenziert; realer Preis 75. |
| F18 | `visualization-facade.service.ts:698`: "DevWorld path (no column sampler)" — seit `b8df8d0` falsch. |
| F19 | `devworld.service.ts:9`: Presets `hills`/`valleys` existieren nicht. |
| F20 | `README.md:105` / `AI_TRAINING_BACKEND.md:93`: `checkpoints/archive-v3.5/` existiert nicht. |

### G. Reward-Struktur — Befund aus dem ersten vollständigen Lauf (2026-08-28)

Der Lauf mit allen Fixes aus A–F lief bis Episode ~9.900 / 72 Model-Updates,
vier parallele Clients. `avgReward` stieg von −1,99 auf −1,00 und
`gameOverRate` fiel von 100 % auf 9,3 %. Die AI hat also gelernt — aber sie hat
gelernt, *nichts zu tun*. Die folgenden Befunde erklären, warum das die korrekte
Lösung des gestellten Optimierungsproblems ist.

| # | Befund | Beleg |
|---|---|---|
| G1 | **Das Damage-Sweet-Band ist ab Wave 51 mathematisch unerreichbar.** Leak-Schaden ist `1 + floor((w-1)/10)` HP bei 100 max HP, das Band ist [1 %, 5 %]. Ab W51 kostet ein Leak 6 %: 0 Leaks = 0 % (unter MIN), 1 Leak = 6 % (über MAX). Es gibt keinen Wert dazwischen. | `wave-curriculum.config.ts:116`, `config.py:122-123` |
| G2 | **Drei der vier Reward-Terme gaten auf dieses Band.** Near-Miss-Peak, Swarm-Bonus und Progression liefern ab W51 strukturell 0. Übrig bleibt `-0,10 + progress·0,30`. | `reward.py` `_drama_reward`, `_swarm_size_reward`, `_progression_bonus` |
| G3 | **Gemessene Folge: die Reward-Landschaft ist flach.** `lastBreakdown` bei allen vier Clients gleichzeitig: `death 0, drama −0,07…−0,10, swarm 0, progression 0`. Garantierte −0,08/Wave schlagen jeden Versuch mit Risiko −20. | `/api/clients/summary` |
| G4 | **Das Verhalten ist entsprechend kollabiert.** `avgProgress50` = 0,06 / 0,08 / 0,14 / 0,27 gegen ein Zielband von 0,65–0,90. `avgDamage50` = 0,000 / 0,000 / 0,003 / 0,018. Ein Client stand bei `winStreak 133` — 133 Waves ohne einen einzigen HP-Verlust. | `/api/clients/summary` |
| G5 | **Es ist kein Physik-Problem.** Historisch lagen 28 % der Waves im Progress-Sweet-Band (`dist.sweet` 624–774 von ~2.500). Die AI *kann* Near-Miss-Waves bauen und hat damit aufgehört. | `dist` je Client |
| G6 | **Auch die Fairness-Gate ist nicht die Ursache.** Sie bindet auf 40 % der Waves, aber die AI wählt `count_factor` ≈ 0,42 bei `countRange [30,600]` und `spawn_factor` ≈ 0,93 bei `spawnDelayRange [40,500]` — also 270 Gegner à 467 ms statt möglicher 600 à 40 ms. Sie nutzt ihren Spielraum freiwillig nicht aus. | `wave_generated`-Logeintrag W61 |
| G7 | **Grundwiderspruch im Design.** Das Spiel hat keinen Sieg-Zustand (endlos) und keine Heilung — `healBase()` hat nur Test-Aufrufer, im Research-Tree gibt es keine Lebensregeneration. 100 HP sind das Budget des gesamten Runs. Ein Ziel von 1–5 % HP-Verlust *pro Wave* bedeutet den Tod nach spätestens 100 Waves, den der DEATH-Term mit −15…−30 bestraft. Das Reward-Optimum und die Reward-Strafe zeigen in entgegengesetzte Richtungen. | `game-state.manager.ts:651`, `game-balance.config.ts:12` |
| G8 | **Der diskrete Kopf lernt, der kontinuierliche nicht.** `template_probs` sind klar differenziert (`wraith_storm` 0,108 … `boss_herbert` 0,0 — die AI bevorzugt Ethereal-Gegner, was gegen diese Verteidigung sinnvoll ist). Die *Faktor-Mittelwerte je Template* sind dagegen über alle 19 Templates uniform (`count` 0,38–0,47, `variation` 0,46–0,60 ≈ Initialisierung 0,5). Template-Wahl verändert die Ergebnisverteilung genug, um den flachen Reward zu überleben; Count/Delay/HP waschen sich alle zu −0,08 aus. | `templateFactors`, `template_probs` |
| G9 | **`variation_factor` ist eine wirkungsarme Aktionsdimension.** Er jittert den Spawn-Delay um ±v bei gleichbleibendem Erwartungswert. Kein messbarer Reward-Effekt, kein Gradient — der Kopf bleibt zurecht auf der Initialisierung. Effektiv sind nur drei der vier Faktoren nutzbar. | `spawn-schedule-builder.ts:76-83` |
| G10 | **Messlücke:** `sweetSpotPct` ist nach dem Reward-Sweet-Spot benannt, misst aber den **Pfad-Progress** (0,65–0,90). Der Damage-Anteil, an dem drei Terme hängen, wurde nie gemessen. Behoben durch `damageSweetPct` und `avgDamagePct`. | `dashboard/app.py:_calc_sweet_spot_pct` |

### H. Der Befund, der alles davor relativiert: eingefrorene Tabs (2026-08-28)

Beim Neustart des Laufs nach dem Reward-Umbau blieben alle vier Clients in der
Setup-Phase stehen. Die Ursache stellte sich als gravierender heraus als der
gesamte Reward-Befund aus Abschnitt G:

**Chrome friert `requestAnimationFrame` in unsichtbaren Tabs vollständig ein.**
Gemessen in einem Hintergrund-Tab: `document.hidden === true`, **0 rAF-Callbacks
in 2 Sekunden**. Die Render-Loop hängt an rAF, der Bot tickt in der Loop
(`game-loop-facade.service.ts:460`, innerhalb `gameState.update`). Ein
Trainings-Tab, der die Sichtbarkeit verliert, wird also nicht langsamer — er
steht.

Von außen war davon nichts zu sehen. Der Status-Push läuft auf `setInterval`,
das weiterläuft: vier eingefrorene Clients meldeten sich sekündlich als
verbunden und gesund ans Dashboard.

Konsequenzen:

- **Nächtliches Training produzierte bisher nichts.** Der Lauf lief nur, solange
  jemand die Tabs sichtbar hatte.
- Jede bisherige Messung — auch die aus Abschnitt G — entstand unter
  Beobachtung. Die Zahlen sind gültig, aber die Datenmenge pro Nacht war null.

**Fix** (`three-tiles-engine.ts`, `workers/heartbeat.worker.ts`): Ein dedizierter
Worker treibt die Loop, solange der Tab versteckt ist. Worker-Timer hängen nicht
am Frame-Clock. Details:

- Der Heartbeat-Pfad überspringt `render()` — nichts ist sichtbar, und die
  GPU-Hälfte ist die teure.
- Jeder Schritt ist auf 50 ms Wall-Clock gedeckelt. Ohne Deckel liefert ein
  gedrosselter Tab Lücken von Sekunden; bei Timescale 75 sind 1 s Lücke
  75 s Spielzeit in einem Schritt — genau der Substep-Stau, der früher als
  225 Substeps/Frame und 2 FPS auffiel. Spielzeit läuft im Hintergrund also
  langsamer als die Wall-Clock, was der richtige Tausch ist.
- rAF und Heartbeat treiben die Welt nie gleichzeitig. Ein Tab kann einen
  nachlaufenden Frame liefern, während er unsichtbar wird; zwei Treiber auf
  derselben Fixed-Substep-Loop würden die Spielgeschwindigkeit verdoppeln.
- Nur DevWorld schaltet das ein.

Zusätzlich behoben: `enableBot` kehrte still zurück, wenn es vor `initialize()`
aufgerufen wurde — genau die Reihenfolge, die ein `reload` erzeugt (gemessen:
`[Training] Control command received: start` um 01:42:43, DevWorld-Init um
01:42:45). Der Wunsch wird jetzt gepuffert, und ein DevWorld-Tab aktiviert
seinen Bot selbst, statt auf einen `start`-Broadcast zu warten, den er
möglicherweise verpasst hat.

**Erste Messung nach beiden Fixes** (Episode 170, erst 1 Model-Update, also
praktisch untrainiert) gegen den v3-Endstand (Episode 9800, 72 Updates):

| Metrik | v3 | v4 |
|---|---|---|
| `avgProgress50` | 0,06–0,27 | **0,70–0,77** |
| `avgDamagePct` | 0,000 | 0,124 |
| `nearMissBandPct` | — | 35 % |
| aktive Reward-Terme | nur `drama` | alle vier |
| `drama`-Spanne | konstant −0,08 | −0,26 … +0,72 |

Die letzte Zeile ist die entscheidende: Es existiert wieder ein Gradient. Die
AI ist zum Startzeitpunkt deutlich zu aggressiv (`avgNearMissRatio` 0,52 gegen
Ziel 0,25, `hpCurveError` −0,43, Game-Over-Rate 20 %) — erwartbar bei einem
untrainierten Modell, und der Gradient zeigt in die Gegenrichtung.
