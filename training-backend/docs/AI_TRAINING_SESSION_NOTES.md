# AI Training - Entwicklungsgeschichte

Chronologische Zusammenfassung der Architektur-Iterationen des AI Wave Directors.

---

## Version 3.3 (aktuell) - Anti-Boring + Balancing

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

---

**Last Updated:** 2026-01-25
