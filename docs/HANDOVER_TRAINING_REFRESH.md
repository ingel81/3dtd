# Handover: Training-Backend Refresh (From-Scratch-Retraining)

**Branch:** `feat/training-backend-refresh`
**Stand:** 2026-08-27 — in Arbeit

Ziel: Das Training-Backend auf den aktuellen Spielstand bringen, damit ein
From-Scratch-Trainingslauf überhaupt sinnvolle Gradienten bekommt. Ausgangslage
war eine Drift von ~3,5 Monaten zwischen `training-backend/` (letzter Stand
2026-05-08), dem Frontend-AI-Code (2026-05-23) und der Engine (2026-08-22).

Vollständiger Analysebefund mit Zeilenreferenzen: siehe Abschnitt
[Befunde](#befunde) unten.

---

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

### P0 — Training-Korrektheit
Ohne diese Fixes trainiert der Lauf auf falschen Signalen.

- [ ] `survived` aus `outcome.playerSurvived` lesen statt aus dem nicht
      existierenden `outcome.gameOver` (`server.py:856`).
- [ ] Frontend sendet auch auf dem `game:over`-Pfad `stateAfter`
      (`training-client.service.ts:425-437`).
- [ ] `enemyProgressValues` im Game-Over-Finalize setzen
      (`ai-data-collector.service.ts:455-513`).
- [ ] Curriculum-Forcing in die Maske ziehen: bis W30 Maske = genau ein Template;
      Decoder-Override entfällt und wird zum Assert.
- [ ] Checkpoint um Optimizer-State, Episode-Zähler und Reward-Normalizer
      erweitern; Resume nutzt sie.
- [ ] `transitions` korrekt konsumieren statt die Liste komplett zu leeren
      (`trainer.py:84,185`).
- [ ] `win_streak` aus dem Wave-Ergebnis ableiten (Feature [34] ist sonst konstant 0).
- [ ] `GAMMA` entweder anwenden oder als bewusst ungenutzt dokumentieren.
- [ ] Längen-Assert auf den State-Vektor statt stiller Trunkierung
      (`server.py:721`).

### P1 — Content-Sync via SSOT
- [ ] Generator `tools/ai-schema/generate.spec.ts` → `training-backend/generated/ai-schema.json`
      (Enemies inkl. HP/Armor/Air-Flag, Templates, Curriculum-Sequenz, Decoder-Konstanten).
- [ ] `npm run ai-schema` in `package.json`; Generator läuft mit `npm test` mit.
- [ ] `config.py`, `templates.py`, `wave_curriculum.py` lesen die JSON.
- [ ] `golem_squad` bekommt ein echtes `minWave` (statt 999) und wird Slot 18.
- [ ] `zombie_horde`-Mix vereinheitlichen; `zombie-v2`-Anteil in High-Volume-
      Templates niedrig halten (Perf-Risiko laut TODO.md:276-285).
- [ ] `endgameHpMultiplier` und `enemyBaseDamageForWave` ins Backend spiegeln und
      im Decoder anwenden, damit Training und Spiel dieselbe HP-/Leak-Kurve sehen.
- [ ] Rundungs-Parität bei `spawn_delay` (`Math.round` vs. `int()`).

### P2 — Encoder-Erweiterung (156 → 162)
- [ ] `zombie-v2` + `stone-golem` in Enemy-Order, Armor-Map und Threat-Rating
      (beide Seiten) → Types-History 16 → 18.
- [ ] `lightning` als 10. Tower (Counts, Avg-Level, Unlock-Flags) und 8.
      Damage-Type → +1 je Block.
- [ ] `maxUpgradeTier / 5` statt `/ 3`.
- [ ] Episodenfortschritt gegen `EPISODE_LENGTH` statt `/ 20`.
- [ ] History-Padding-Bug (negative Indizes bei < 5 Einträgen).
- [ ] `gameTimeSeconds` = Zeit seit Spielstart, nicht seit Wave-Start.
- [ ] `expectedArmorDistribution` in der Planungsphase aus dem Curriculum-Template
      ableiten statt Uniform-Fallback.
- [ ] `computeTowerHash` über `computeTowerDPSFromLevels` statt `damage * fireRate`.

### P3 — Bot
- [ ] `lightning` in `ALL_COMBAT_TOWERS`; `storm-mastery` in die Research-Listen.
- [ ] `etherealGap` in `defense-analyzer` + Anti-Ethereal-Placement-Strategie
      (Curriculum erzwingt W13 `ghost_surge`).
- [ ] `getTowerValue` über `computeTowerDPSFromLevels`, damit Beam (`fire`) und
      Chain (`lightning`) nicht mit 0 bewertet werden.
- [ ] Anti-Air-Auswahl nach effektiver Anti-Air-DPS statt `damage * fireRate / cost`.
- [ ] Splash-Auswahl aus `TOWER_CAPABILITIES` statt hardcodierter `cannon`/`rocket`-Liste.
- [ ] Upgrade-Tier-Mapping bis 5.
- [ ] `hasAntiAirCapability` generalisieren (aktuell nur `rocket`).
- [ ] Toten Auswahl-Code in `base-tower-bot.ts:98-231` entfernen oder aktivieren.

### P4 — DevWorld trainingstauglich
- [ ] `getHeightAtLocal` auf die Mesh-Auflösung ausrichten, damit Grundwahrheit
      und GPU-Cubemap-Blocker übereinstimmen.
- [ ] Straßen und Terrain-Skirt aus dem LOS-Blocker-Set nehmen bzw. in beiden
      Pfaden gleich behandeln.
- [ ] Alle generierten Spawn-Punkte übernehmen statt nur `generatedSpawns[0]`.
- [ ] `DevTerrainProvider.dispose()` beim Engine-Dispose aufrufen (Worker-Leak).
- [ ] `onDevWorldRegenerated` re-seedet die WaveManager-Spawns/Pfade.
- [ ] `areTilesVisible()` in DevWorld korrekt `false`.

### P5 — Infrastruktur
- [ ] `--fresh`-Flag in `server.py` (Checkpoints archivieren statt manuell verschieben).
- [ ] `export-ai` auf das höchste vorhandene Checkpoint zeigen lassen
      (`checkpoint_latest.pt` existiert nicht).
- [ ] `pytest` in `requirements.txt`; Tests darauf umstellen.
- [ ] Key-Drift in `tui_logger.py` und `dashboard/app.py` beheben
      (`delay_factor`, `type_probs`, `sampled_type`, `cooldown_override`).
- [ ] Doppelte `PPOTrainer`-Instanziierung bei Resume.
- [ ] Tote Imports und `ExperienceBuffer` entfernen.

### P6 — Dokumentation
Alle unter [Doku-Fehler](#f-doku-fehler) gelisteten Punkte.

### P7 — Trainingslauf
`/training fresh` — Backend + Dashboard + Dev-Server + N sichtbare Chrome-Tabs
auf `?devworld`, headless (Rendering aus), Timescale 75. Beobachtung über
`http://localhost:3002`.

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
