# AI Training - Entwicklungsgeschichte

Chronologische Zusammenfassung der Architektur-Iterationen des AI Wave
Directors. Aktueller Stand siehe `docs/PHASE_5.11_RANGES.md` und
`docs/HANDOVER_PLAYTEST_PHASE5.16.md` im Projekt-Root — diese Datei ist die
**Backend-seitige Vorgeschichte** (v1 → v3.5) plus Kurz-Index der Phase-5.x-Notes.

---

## Phase 5.x — Aktuelle Iterationen

Die Phase-5.x-Geschichte ist nicht hier dokumentiert — sie lebt in den Phase-
spezifischen Dokumenten im Projekt-Root, weil dort gameplay-übergreifende
Frontend-Änderungen (Damage-Matrix, Bot-Strategien, Encoder) gemeinsam mit
den Backend-Änderungen behandelt werden:

| Phase | Doku | Kern-Änderung |
|---|---|---|
| 5.5 | `training-backend/PHASE5.5_TRAINING_RUNBOOK.md` | State 74→93, Multi-Group-Decoder, Reward-Restart |
| 5.10 | `docs/PHASE_5.10_TEMPLATES.md` | Template-basiert, State 156, 4-Term-Reward, 18 Templates |
| 5.11 | `docs/PHASE_5.11_RANGES.md` | Range-Based-Templates, 4 Continuous-Params, Wave-Duration-Cap |
| 5.16 | `docs/HANDOVER_PLAYTEST_PHASE5.16.md` | Wave-Curriculum-Override für W1–W18 |

Die Versionen unten (v1 → v3.5) sind aus archivarischen Gründen erhalten —
die dort beschriebene Architektur ist nicht mehr in Kraft. Lessons Learned
am Ende sind weiterhin gültig und haben Phase 5.x mitgeprägt.

---

## Version 3.5 - Reward Reduction + Training Scaling

### Problem (v3.4 Training)
Training lief stabil mit ~40% Sweet Spot, aber:
- **Rewards zu hoch:** Dynamische Rewards fuehrten zu schneller Wirtschafts-Eskalation
- **Training-Limits zu niedrig:** Tower-Limit 20, Episode-Length 20 → wenig Daten fuer Late-Game DPS
- **Kill Time sinkend:** 3.09s → 2.13s (naehert sich Minimum 2.0s)

### Fixes
- **Reward-Formel angepasst:**
  - HP pro Credit: 50 → 150 (ca. 1/3 der Rewards)
  - Speed-Divisor: /5 → /10
  - Scale-Factor: 0.6 → 0.4
  - Max-Cap: 40 → 25
- **Training-Limits erhoeht:**
  - Tower-Limit: 20 → 50 (strategist bot kann mehr bauen)
  - Episode-Length: 20 → 100 (laengere Spiele, mehr Late-Game Daten)
- **Bugfixes:**
  - Wave 1 Stuck Bug (fehlender Spawn-Counter Reset)
  - Floating Text zeigte statischen statt dynamischen Reward

### Erwartete Verbesserungen
| Metrik | v3.4 | v3.5 Ziel |
|--------|------|-----------|
| Reward pro Kill | 5-15 | 1-8 |
| Late-Game Daten | Waves 1-20 | Waves 1-100 |
| Tower-Variety | Max 20 | Max 50 |
| Kill Time Trend | Sinkend | Stabil bei 2.0-3.0s |

### Training Stand (5267 Episoden)
- Sweet Spot: **40.1%** (Ziel erreicht!)
- Avg Progress: 62.5% (etwas zu schwer, aber akzeptabel)
- Type-Verteilung: Gut (16-20% pro Typ, nur Bat unterreprasentiert mit 9%)
- Game Over Rate: 3.8-4.9% (gut)

---

## Version 3.4 - Anti-Kollaps + Type Diversity

### Problem (v3.3 Training, 32000 Episoden)
Training lief ueber Nacht, kollabierte bei ~E6000-8000:
- **Peak bei E4000-6000:** Avg Reward 0.43, Sweet Spot 43%
- **Kollaps E6000-14000:** Reward fiel von 0.43 auf 0.02
- **Stagnation E14000-32000:** Reward blieb bei ~0.03, Sweet Spot nur 21%

**Ursachen:**
1. **Type-Kollaps:** herbert/tank/bat = 89%, penguin/wallsmasher = 2.7%
2. **Boring-Wave-Exploitation:** Model generierte zu einfache Wellen (progress ~0.15-0.25), knapp ueber dem Boring-Threshold von 0.20
3. **Entropy reichte nicht:** Trotz 0.04 Koeffizient spezialisierte sich das Model

### Fixes
- **ENTROPY_COEF 0.08** statt 0.04 (verdoppelt, mehr Exploration)
- **REWARD_BORING_THRESHOLD 0.30** statt 0.20 (hoehere Schwelle fuer Boring-Penalty)
- **REWARD_VARIETY_BONUS 0.20** statt 0.15 (staerkerer Anreiz fuer Type-Diversity)
- **TYPE_COOLDOWN_WAVES 4** statt 2 (Typ wird fuer 4 Wellen nach Nutzung gesperrt)
- **Dashboard Mobile-Support:** CSS fuer Smartphones, Server bindet auf 0.0.0.0

### Ergebnisse (E5000-6500, nach Rollback + Fixes)
| Metrik | v3.3 (Kollaps) | v3.4 (Fix) |
|--------|----------------|------------|
| Avg Reward | 0.02-0.04 | **0.30** |
| Sweet Spot | 21% | **36.5%** |
| Progress (Breakdown) | -0.002 | **+0.18** |
| Game Over Rate | 0.4% | 4.1% |

**Type-Verteilung drastisch verbessert:**
| Typ | v3.3 (Kollaps) | v3.4 (Fix) |
|-----|----------------|------------|
| herbert | 30.5% | **19.8%** |
| tank | 29.7% | **20.1%** |
| bat | 28.6% | **19.7%** |
| zombie | 8.4% | **19.8%** |
| wallsmasher | 1.1% | **18.8%** |
| penguin | 1.6% | 1.9% |

5 von 6 Typen jetzt gleichverteilt (~20%). Penguin bleibt unterrepresentiert (Model-Bias aus Checkpoint).

### Rollback-Strategie
1. Checkpoints nach E5000 geloescht (2679 Dateien)
2. Training von checkpoint_5000.pt neu gestartet
3. Kritischer Bereich E6000-8000 wird ueberwacht

### Zweiter Drift (E7000+)
Training driftete erneut bei E7000+ - diesmal ohne Type-Kollaps aber mit Boring-Exploitation.
Modell waehlt kill_time nahe Minimum (1.0-1.3s) → HP zu niedrig → Enemies sterben sofort → Boring Penalty.

**Fix:** KILL_TIME_MIN von 1.0s auf 1.5s erhoeht - verhindert "instant-kill" Wellen.
Rollback zu E7000, Training mit neuem Minimum fortgesetzt.

---

## Version 3.3 - Anti-Boring + Balancing

### Problem (v3.2 Training, 6500 Episoden)
Bimodale Progress-Verteilung: 30% Boring (<20%) + 16.5% Danger (>85%). Sweet Spot nur 24.3%.
Model lernte: niedriger kill_time ist "sicher" (vermeidet Game-Over). Boring-Penalty war zu schwach (skaliert statt flat).
Entropy sank stetig (7.17→6.68) → Wallsmasher nur noch 3.3%, Typ-Spezialisierung.
Zusaetzlich: 10 Schaden/Enemy am HQ → Game Over nach 4-7 Waves. Bot baute nur Archers (konnte sich teure Typen nicht leisten).

### Fixes
- **Boring-Penalty flat -0.30** statt skaliert (gleich hart wie Overflow)
- **kill_time Minimum 1.0s** statt 0.5s (verhindert ultra-schwache Enemies)
- **Entropy Coef 0.04** statt 0.02 (mehr Exploration, weniger Spezialisierung)
- **Enemy Base Damage 1** statt 10 (100 Enemies bis Game Over, Spiele dauern 15-20 Waves)
- **Spawn Delay [500, 2000]ms** statt [150, 600]ms (kein Pulk-Spam, echtes TD-Feeling)
- **Bot Spar-Logik:** Persistenter savingForType-State, 60% Spar-Chance fuer fehlende Tower-Typen
- **Bot Tower-Variety:** Alle 6 Typen werden ueber die ersten 10 Waves aufgebaut

### Erwartete Verbesserungen
| Metrik | v3.2 (6500 Ep.) | v3.3 Ziel |
|--------|-----------------|-----------|
| Boring (<20%) | 30.2% | <10% |
| Sweet (40-70%) | 24.3% | >50% |
| Danger (>85%) | 16.5% | <10% |
| Avg Reward | 0.265 | >0.60 |
| Entropy | 6.68 (sinkend) | >6.5 (stabil) |
| Tower Variety | nur Archer | alle 6 Typen |

---

## Version 3.2 - Herbert Skalierbar + Raw Progress

### Problem (v3.1 Training, 6000 Episoden)
Herbert-Dominanz (58%): Feste HP=500 + Count-Cap=3 gab dem Model kein Gradient-Signal.
`compute_effective_progress()` erzeugt binaere 0/1.0-Spruenge bei konzentrierter Verteidigung.
Sweet Spot (0.90 effective) war physisch unerreichbar. Entropy-Kollaps (7.1→5.9).

### Fixes
- **Herbert skalierbar:** Keine feste HP/Count mehr. `enemy_hp = DPS * kill_time` wie alle
- **Raw progress fuer Reward:** Keine DPS-Normalisierung mehr. DPS-Profil nur als Model-Input
- **Progress Center 0.55** statt 0.90 (angemessen fuer raw progress mit konzentrierter Defense)
- **Progress Sigma 0.15** statt 0.08 (breiteres Gradient-Signal)
- **Overflow-Grenze 0.85** statt 0.95 (passt zum neuen Center)
- **Entropy Coef 0.02** statt 0.005 (verhindert Typ-Kollaps)

### Distributed Placement Strategy
Problem: Konzentrierte Verteidigung (15-25% des Pfades) erzeugt binaere Progress-Verteilung (0.22 oder 1.0).
AI kann keinen sauberen Sweet Spot bei 0.55 treffen weil Enemies entweder sofort sterben oder komplett durchlaufen.

Loesung: `DistributedPlacementStrategy` fuer den Strategist-Bot:
- Pfad in 5 Zonen aufgeteilt, Towers gleichmaessig verteilt
- Scoring: 50% Zone-Bedarf, 30% Path-Coverage, 20% Street-Distance
- Ersetzt `CoverageFillStrategy` im Strategist-Bot (Priority 65)
- Enemies sterben an verschiedenen Stellen → kontinuierliche Progress-Werte

### Dynamic Dashboard
Dashboard-Thresholds (Sweet Spot, Overflow, etc.) dynamisch vom Backend:
- Neuer `/api/config` Endpoint liefert alle Reward-Parameter
- JS klassifiziert Progress, Chart-Linien, Badge-Farben, Legend dynamisch
- Keine hardcodierten Werte mehr im Frontend

### Erwartete Reward-Werte
| Situation | v3.1 | v3.2 |
|-----------|------|------|
| progress=0.55 (sweet spot) | +0.02 | +1.00 |
| progress=0.90 | +1.12 | -0.30 |
| progress=0.30 | +0.00 | +0.25 |
| progress=0.85 | -0.30 | -0.30 |

---

## Version 3.1 - Anti-Exploitation Fixes

### Problem (v3.0 Training)
Model fand degenerierte Strategie: 3 Zombies mit kill_time=7-8s (unkillbar).
Alle Enemies erreichen Base (progress=1.0). Reward war +0.71 (Gauss-Schwanz + Bonuses).
Game-Over-Penalty (-0.5) zu mild. 100% Game-Over-Rate, Sweet Spot nie getroffen.

### Fixes
- **kill_time [0.5, 4.0]s** statt [0.5, 8.0]s
- **progress > 0.95 → reward = -0.30** (war +0.46 via Gaussian)
- **Game-Over-Penalty proportional:** -0.5 * (20/wave), cap -5.0
- **Bonuses nur bei progress < 0.95** (near_miss, max_progress)
- **Count-Minimum: max(5, towers+1)** statt 3
- **zone_time Minimum 8s** statt 2s (kill_capacity weniger restriktiv)

### Erwartete Reward-Werte
| Situation | v3.0 | v3.1 |
|-----------|------|------|
| progress=1.0, survived | +0.71 | -0.30 |
| progress=1.0, game_over wave 3 | +0.21 | -3.63 |
| progress=0.90 (sweet spot) | +1.07 | +1.12 |
| progress=0.88 + variety | +1.07 | +1.14 |

---

## Version 3.0 - DPS-Profil + Web Dashboard

### Architektur
- **Input:** 74-dim State-Vektor (34 Scalar + 40 Spatial)
- **Spatial:** DPS-Profil (20 Bins Ground + 20 Bins Air) via Conv1D
- **Output:** Enemy-Type (Categorical, 5), Params (Gaussian, 4: kill_time, count, delay, variation)
- **Training:** PPO, Batch=16, LR=0.0003, Clip=0.2, Entropy=0.005

### Reward
- Gaussian Peak bei 90% effective progress (Sigma=0.08)
- Bonus: Near-Miss (+0.15), Max-Progress (+0.10), Spread (+0.05), Variety (+0.15)
- Game Over: -0.50

### Key Changes vs. v2.0
- DPS-Profil (20 Bins) ersetzt einzelne Defense-Metriken
- Conv1D Branch fuer raeumliche Feature-Verarbeitung
- `compute_effective_progress()` mit DPS-Normalisierung
- Web Dashboard (FastAPI + Chart.js) ersetzt TUI
- Reward-Peak verschoben: 65% → 90% (mit DPS-Normalisierung ist 90% angemessen)
- Trendlinien im Dashboard (Rolling Average 30/50)

---

## Version 2.0 - DPS-Relative HP + Path-Progress

### Architektur
- **Input:** 52-dim State-Vektor (Player, Defense, Vulnerabilities, History)
- **Model:** Dense (128→64→32), keine Spatial Branch
- **Output:** Enemy-Type (5), kill_time, count, delay, variation (Gaussian)
- **Training:** PPO, Batch=16, LR=0.0003

### Reward
- Gaussian Peak bei 65% raw path progress
- `effective_progress = raw_progress / defense_reach`
- Game Over: -0.50

### Key Changes vs. v1.0
- DPS-relative HP: `enemy_hp = effective_dps * kill_time` (statt absoluter HP-Multiplier)
- Path-Progress als Reward-Signal (statt Damage-Prozent)
- Air-DPS Unterscheidung fuer Bats
- Frontend sendet `enemyBaseHp` (Single Source of Truth)
- Linearer Korridor entfernt (nicht mehr noetig mit DPS-relativer HP)

---

## Version 1.0 - Initial (Damage-Based)

### Architektur
- **Input:** 52-dim State-Vektor
- **Model:** Dense (128→64→32)
- **Output:** Enemy-Type (5), HP-Mult, Count, Speed-Mult, Delay (Gaussian)
- **Training:** REINFORCE → PPO

### Reward
- Sweet Spot: 3-7% Damage pro Wave
- Lineare Interpolation ausserhalb des Sweet Spots
- Game Over: -1.0 bis -1.9 (stark)

### Probleme (geloest in v2.0)
- **HP-Multiplikator zu abstrakt:** Model konnte nicht lernen was "zu viel HP" bedeutet, weil DPS unbekannt
- **Linearer Korridor noetig:** Ohne DPS-Bezug mussten HP/Count/Speed per-Wave geclampt werden
- **Damage-basierter Reward instabil:** 3-7% Damage war unrealistisch eng, Sweet Spot wurde nie getroffen
- **Speed-Multiplikator:** Kaum Effekt auf Gameplay, entfernt in v2.0

### Training Sessions (historisch)

| Session | Ergebnis | Problem |
|---------|----------|---------|
| 1 (ohne Ceilings) | avg HP 3.34x, 48% Game Over | HP sofort zu hoch |
| 2 (HP Ceiling) | avg HP 1.52, Count 17 | Count zu hoch |
| 3 (HP+Count+Speed Ceiling) | Wave 1: 0% Damage, Wave 3: 57% | Steiler Sprung |
| 4 (Linearer Korridor) | avg_reward -0.3, langsame Konvergenz | Sweet Spot zu eng |

---

## Lessons Learned

1. **DPS-Relative HP ist essentiell:** Absolut HP-Werte sind bedeutungslos ohne Kontext der Verteidigung
2. **Path-Progress > Damage:** Progress ist stetiger, weniger varianzreich, besseres Lernsignal
3. **Raeumliches Profil > Skalare:** Ein einzelner DPS-Wert verliert die Information wo die Verteidigung ist
4. **Gaussian Reward > Linear:** Gauss-Peak gibt staerkeres Gradient-Signal im Sweet Spot
5. **Web Dashboard > TUI:** Live-Charts sind wesentlich informativer als Console-Output
6. **DPS-Profil als Input, nicht Reward:** Normalisierung im Reward erzeugt binaere Spruenge. Besser als Conv1D-Input fuer das Model
7. **Keine festen HP/Count pro Typ:** Fixed-Werte entziehen dem Model das Gradient-Signal und werden zur Exploitation-Luecke
8. **Symmetrische Penalties:** Boring und Overflow muessen gleich hart bestraft werden. Asymmetrie fuehrt zu Risk-Aversion (Model waehlt "sicher aber langweilig")
9. **Action-Space-Minimum begrenzen:** kill_time min 1.0s statt 0.5s verhindert degenerierte "instant-kill" Waves die keinen Lernwert haben
10. **Game-Laenge ermoeglicht DPS-Skalierung:** 1 Schaden/Enemy (statt 10) → Spiele dauern 15-20 Waves → Bot baut diverse teure Towers → AI sieht breites DPS-Spektrum
11. **Type-Cooldown ist kritisch:** Ohne expliziten Cooldown kollabiert das Model auf 2-3 bevorzugte Typen. 4-Wellen-Cooldown erzwingt Diversity
12. **Entropy muss hoch genug sein:** 0.04 reichte nicht fuer stabiles Training ueber 30k Episoden. 0.08 verhindert Spezialisierung
13. **Boring-Threshold nicht zu niedrig:** 0.20 erlaubt dem Model "knapp drueber" zu exploiten. 0.30 schliesst diese Luecke
14. **Checkpoints regelmaessig analysieren:** Kollaps passierte schleichend (E6000-14000). Fruehe Erkennung durch Analyse in 2000er-Chunks
15. **Rollback-Strategie vorbereiten:** Checkpoints alle 10 Episoden ermoeglichen praezises Zuruecksetzen zum besten Zeitpunkt
16. **Reward-Skalierung beachten:** Zu hohe Rewards fuehren zu schneller Wirtschafts-Eskalation. Sublineare Skalierung (HP/150 statt HP/50) verhindert Inflation
17. **Training-Limits grosszuegig waehlen:** Niedrige Tower/Wave-Limits schraenken den DPS-Range ein. 50 Towers + 100 Waves ermoeglicht Training ueber breites DPS-Spektrum
18. **Race Conditions in async Code:** Wave-Start kann mehrfach getriggert werden. Flags (`pendingAIWaveRequest`) schuetzen vor doppelten Requests
19. **State vollstaendig zuruecksetzen:** Spawn-Counter, Flags und temporaerer State muessen in `reset()` explizit zurueckgesetzt werden

---

**Last Updated (v1–v3.5 Inhalte):** 2026-01-25
**Doku zuletzt strukturiert:** 2026-05-08 — Phase-5.x-Index oben ergänzt, Inhalte unverändert.
