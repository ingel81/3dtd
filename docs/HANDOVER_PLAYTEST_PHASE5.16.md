# Handover — Phase 5.16 Balance Pass

**Stand:** Geparkt — Branch ist auf `main` gemerged, offene Followups warten auf Live-Playtest.
**Branch:** `feature/phase5.5-economy-ai-prep` (gemerged 2026-05-08)
**Build-Status:** grün, zuletzt 642/642 Tests pass (Engine Cleanup-Pass 2026-05-11)
**Letzte Aktualisierung:** 2026-05-12

> **Beim Wiederaufsetzen:** Diese Datei + `docs/economy-chart.html` öffnen, dann
> den **Offene Punkte**-Block weiter unten + `TODO.md` PRIO 2 abarbeiten. Konkret
> noch offen: Live-Playtest, Per-Kill-Budget-Rounding-Bug, Boss-Frequenz ab W31,
> Stone-Golem-Aufnahme ins Curriculum, optionales Re-Training, Wave-Deployment-Safeguards.

> **Pfadänderungen seit dem Handover (2026-05-10):**
> - `src/app/models/enemy-types.ts` → `src/app/configs/enemy-types.config.ts`
> - `src/app/ai/core/wave-curriculum.ts` → `src/app/configs/wave-curriculum.config.ts`
>
> Wenn unten Datei-Pfade noch auf die alten Locations zeigen, gelten sinngemäß die
> neuen — die TS-Datei wurde 1:1 verschoben, der Inhalt ist identisch.

---

## 1. Was abgeschlossen ist

### Wave-Curriculum + deterministisches Gold-Budget
- 30 Waves explizit, danach mod-30 Loop für Templates; Gold-Budget linear extrapoliert (`KILL_DELTA_PER_WAVE=50`, `COMPLETE_DELTA_PER_WAVE=30`).
- Per-Kill-Reward = `goldKill / waveSize` (Gesamtsumme durch Gegneranzahl, **NICHT** per-enemy-type-gewichtet).
- Wave-Complete-Reward = `goldComplete + Skill-Bonuses` (Perfect, CloseCall, Milestone, Combo, Comeback).
- Files: `src/app/ai/core/wave-curriculum.ts` (+ Backend-Mirror `training-backend/wave_curriculum.py` — Backend hat nur Template-Sequenz, kein Gold).

### Tower-Upgrades — 25 Stufen, alle Tower symmetrisch
- Pro Combat-Tower 3 Slots: `damage` (×1.10/Lvl), `speed` (×1.07/Lvl), `range` (×1.04/Lvl). Fire bekommt `beam-width` statt `speed` (Beam-basiert).
- maxLevel **25**, costScaling **1.40**, base 50g. L25 ≈ 7000× base.
- Tier-Gating in 5er-Bändern: T1=L1-5, T2=L6-10, T3=L11-15, T4=L16-20, T5=L21-25.
- Files: `src/app/configs/tower-types.config.ts` (STD_*_UPGRADE Helpers).

### Research-Tree
- Verkürzter Anti-Air-Pfad: Rocketry direkt auf Gatling-Tech (war Siege-Eng) → Anti-Air ab W6 plausibel.
- Cost/Duration neu: Cannon-Path 50/20s, Rocketry 60/18s, AA-Retrofit 45/12s, Adv-Weaponry 130/35s, Master-Eng 240/60s.
- **Neu T4/T5:** `advanced-engineering` (380g/90s, prereq Master-Eng), `transcendent-tech` (600g/150s, prereq Adv-Eng).
- Bot-Strategie kennt die neuen Nodes (`research-pick.strategy.ts`).
- Files: `src/app/configs/research/research-tree.config.ts`.

### Research-Center
- T2: 120 → 180g, T3: 220 → 350g.
- Files: `src/app/configs/research/research-center.config.ts`.

### Tower-Costs
- Cannon 140 → 150, Magic 120 → 140, Rocket 100 → 120, Ice damage 2 → 5 (sonst pure Utility).
- Sell-Values an Cost-Erhöhung angepasst (60% Refund-Quote).
- Files: `src/app/configs/tower-types.config.ts`.

### Damage-Matrix-Differenzierung
- Multiplier sind **schon** hart (0.15× bis 1.75×) — Werte-Spread war nie das Problem, nur Sichtbarkeit.
- Floating-Text-Skalen drastischer: weak 0.55× / normal 1.0× / strong 1.35× / devastating 1.75×.
- Tower-Card-Tooltip zeigt Damage-Matrix-Zeile mit ✓✓/✓/·/✗ und konkreten Multipliern.
- Enemy-Group-Tooltip zeigt sortierte Damage-Type-Liste (best→worst).
- Multiline-Tooltip-CSS (`td-tooltip-multiline`) in `src/styles.scss`.
- Files: `src/app/configs/combat/damage-matrix.config.ts`, `src/app/components/game-sidebar/game-sidebar.component.{ts,html}`.

### Wave-Schwierigkeit (strukturell)
- `endgameHpMultiplier(wave)` post-NN: ab W20 +5%/Wave, cap 4× bei W80. Compoundet auf NN's hp_mult.
- `enemyBaseDamageForWave(wave)`: 1 (W1-10) → 2 (W11-20) → 3 (W21-30) → 4 (W31+) — späte Leaks tun weh.
- Files: `src/app/ai/core/wave-curriculum.ts` + Anwendung in `wave-director.service.ts`, `enemy.manager.ts`.

### UI-Polish (Tower-Detail-Panel)
- 3×2 Stats-Grid mit Damage-Type als Tile auf Pos 0.
- Range/Damage gerundet (`| number:'1.0-0'`), Fire Rate auf 2 Nachkommastellen.
- DPS-Tile zusätzlich (für Beam-Towers `damagePerSecond`).
- Sell-Button im Header (rechts), nicht mehr absolut-positioniert am Bottom → kein Overlap mehr während Wave.
- Wave-Panel hat keinen Teal-Stripe links mehr.

### Critical Bugfix
- `command:upgrade-tower`-Handler nutzte alte 3-Tier-Logik während Sidebar schon 5-Bänder-Logik hatte → Upgrades ab L2 wurden still geblockt. Manager-Tier-Logik synchronisiert.
- Datei: `src/app/managers/game-state.manager.ts:288-300`.

### Debug-Behavior
- "Kill all enemies" gibt **kein Gold mehr**. `enemyManager.kill(enemy, awardCredits=false)`-Parameter.

### Visualisierungs-Tool
- `npm run economy-chart` regeneriert `docs/economy-chart.html` aus Configs.
- Charts: Cumulative Income (W1-W50), Per-Wave Breakdown, Difficulty-Curve (HP-Multi + Leak-Damage), Milestone-Affordability, Upgrade-Cost-Curve-Tabelle.
- Tools-Files: `tools/economy-chart/generate.spec.ts`, `vitest.config.ts` (include erweitert), `package.json` (npm-script).

---

## 2. Offene Punkte (für Wiederaufsetzen)

### A) Live-Playtest-Befunde sammeln
Stand: Bot/Spieler-Test mit den neuen Werten ist noch nicht durchlaufen. Erwartet:
- Wave 1-7 sollte sich nicht überfordern (Air-Debüt W7 mit AA-Forschung machbar).
- Wave 10 Boss soll fordernd sein (Cannon nötig).
- Wave 13 Ghost-Surge soll Magic erfordern.
- Wave 15-20 sollten noch sichtbar Schwierigkeit hochziehen (HP-Multi setzt ein).
- Gold zwischen W10 und W30 sollte knapp wirken (T2/T3-Research konkurriert mit Tower-Maxing).

### B) Eventuelles Re-Training
- Aktueller Checkpoint (Episode 7350, ONNX in `public/assets/ai/wave-director/`) wurde gegen das ALTE Reward-System trainiert.
- Mit den neuen Difficulty-Knobs (post-NN HP-Multi, Leak-Damage) und Curriculum-Override sollte er trotzdem spielbar sein, aber die Sweet-Damage-Kalibrierung passt nicht mehr exakt.
- Re-Training optional, ~30-45 min mit 8 headless Tabs. Nur sinnvoll **nachdem** Balance live verifiziert ist.

### C) Boss-Frequenz ab W31
Im Plan war: ab W31 Bosse alle 5 Waves statt 10. **Nicht implementiert** — Curriculum loopt einfach. Falls gewünscht, in `templateForWave()` ein Override für `wave > 30 && wave % 5 === 0` einbauen.

### D) Per-Kill-Budget-Rounding-Bug
**Bekannt offen.** `Math.max(1, Math.round(budget / count))` overshoot bei Mega-Swarms (z.B. W19 rat_tide 5000 Ratten × 1g floor = 5000g statt 305g Budget). Saubere Lösung: deterministischer Akkumulator (im Verlaufsgespräch als Option 1 vorgeschlagen).

### E) Wave-Curriculum Gold-Budget feinjustieren
Falls Live-Test zeigt dass Spieler zu viel/wenig Gold hat: `goldKill`/`goldComplete` in `wave-curriculum.ts` direkt anpassen, danach `npm run economy-chart` für aktualisierte Visualisierung.

### F) Optional: Damage-Matrix-Übersicht im UI
Die Tooltips zeigen jetzt Multiplier per Tower und per Enemy. Eine globale "vs"-Tabelle (alle Tower × alle Armor) gibt es nicht. Wäre als eigener Sidebar-Tab oder Hilfe-Dialog denkbar — niedrige Priorität.

---

## 3. Wie weiter machen — Empfohlene Reihenfolge nach Wiederkehr

1. **Live-Playtest** mit `?devworld` (Cesium-Quota-Workaround) oder normaler Map.
2. Notizen sammeln zu A) — wo's hakt, wo's zu leicht/schwer/teuer/billig ist.
3. Live-Iterieren über `wave-curriculum.ts` + Tower-Costs + Research-Costs, nach jeder Änderung `npm run economy-chart` für Sanity-Check.
4. Wenn die Werte sich gut anfühlen: D) (Akkumulator) fixen, dann optional B) (Re-Training).
5. Wenn alles solide: Commit-Stapel bauen, dann Branch mergen.

---

## 4. Kommandos zum Wiederaufsetzen

```bash
# Status-Check
git status
git diff --stat

# Build + Tests
npm run build
npx vitest run

# Live-Spielen
npm start                       # http://localhost:4200
# bei 429 Cesium-Limit: http://localhost:4200/?devworld

# Economy-Chart regenerieren
npm run economy-chart
# dann docs/economy-chart.html im Browser öffnen
```

---

## 5. Geänderte Files (Working-Tree-Snapshot)

### Modified
```
M  package.json                                                      (npm script economy-chart)
M  src/app/ai/core/templates.ts                                      (Wave 1 = pure zombies, EN descriptions)
M  src/app/ai/core/wave-director.service.ts                          (Curriculum-Override + endgameHpMultiplier)
M  src/app/ai/training/strategies/research/research-pick.strategy.ts (T4/T5 in Bot-Order)
M  src/app/components/game-sidebar/game-sidebar.component.html       (3×2 Grid, header sell, multiline tooltips)
M  src/app/components/game-sidebar/game-sidebar.component.ts         (5-tier-band logic, getDps, tooltip helpers)
M  src/app/configs/combat/damage-matrix.config.ts                    (drastischere Effectiveness-Skalen)
M  src/app/configs/game-balance.config.ts                            (alte Reward-Formeln raus)
M  src/app/configs/research/research-center.config.ts                (T2/T3 teurer)
M  src/app/configs/research/research-tree.config.ts                  (T4/T5 + verkürzter AA-Path)
M  src/app/configs/tower-types.config.ts                             (25-level Upgrades, alle Tower symmetrisch)
M  src/app/entities/tower.entity.spec.ts                             (config-driven multiplier check)
M  src/app/managers/enemy.manager.ts                                 (gold-budget reward, kill awardCredits param)
M  src/app/managers/game-state.manager.ts                            (5-tier-band Bugfix in command:upgrade-tower)
M  src/app/managers/wave.manager.spec.ts                             (kill spec: awardCredits=false)
M  src/app/managers/wave.manager.ts                                  (kill-all ohne Credits)
M  src/app/models/enemy-types.ts                                     (Comment-Cleanup eliteFactor)
M  src/styles.scss                                                   (.td-tooltip-multiline)
M  training-backend/server.py                                        (Curriculum-Override im Decoder)
M  training-backend/templates.py                                     (Wave 1 = pure zombies, EN descriptions)
M  vitest.config.ts                                                  (tools/**/*.spec.ts include)
```

### New
```
?? docs/HANDOVER_PLAYTEST_PHASE5.16.md  (diese Datei)
?? docs/economy-chart.html              (regenerated artifact)
?? src/app/ai/core/wave-curriculum.ts   (Curriculum + Gold-Budget + Difficulty-Knobs)
?? tools/economy-chart/                 (Generator-Spec)
?? training-backend/wave_curriculum.py  (Backend-Mirror, nur Template-Sequenz)
```

---

## 6. Kontext-Pointer für die nächste Session

- Vollständiger Plan + Audit-Befunde stehen im aktuellen Conversation-Transcript (vor Park).
- Damage-Matrix-Werte: `src/app/configs/combat/damage-matrix.config.ts` Zeilen 22-29.
- Tier-Gating-Mapping (muss in 2 Files gleich bleiben): `game-sidebar.component.ts` `getRequiredUpgradeTier` UND `game-state.manager.ts:288-300`.
- Curriculum + Difficulty-Knobs: `src/app/ai/core/wave-curriculum.ts`.
- Gold-Budget-Visualisierung: `docs/economy-chart.html`.
