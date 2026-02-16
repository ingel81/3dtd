# 3DTD — Master Game Design Document

## 1. Design-Philosophie
- **Einfach zu lernen, schwer zu meistern**: klare Basisregeln + Veteranen-Tiefe (Matrix, Status, Flags).
- **Fairness vor Überraschung**: neue Mechaniken werden **geteasert**, harte Checks nur nach Verfügbarkeit von Countern.
- **Strategische Vielfalt**: mehrere gültige Antworten auf jede Bedrohung (kein Ein-Turm-Meta).
- **Lesbarkeit**: Icons, Farben, Damage-Feedback, Wave-Preview.
- **Progressive Komplexität**: neue Armor-Typen, Flags und Air werden schrittweise eingeführt.

---

## 2. Damage & Armor System (Matrix + Status + Flags)

### 2.1 Schadenstypen (6)
- **Physical (⚔️)**: solider Allrounder, fällt vs. Armor ab.
- **Pierce (🎯)**: hohe Feuerrate, Anti-Swarm.
- **Siege (💥)**: langsame AoE, Anti-Heavy/Fortified.
- **Magic (✨)**: Ethereal-Counter, Utility.
- **Fire (🔥)**: DoT/Burn, Anti-Regen.
- **Ice (❄️)**: Low-DPS, starker Slow/CC.

### 2.2 Rüstungstypen (5)
- **Unarmored**
- **Light**
- **Heavy**
- **Fortified**
- **Ethereal**

### 2.3 Schadensmatrix (final)
> **Änderung ggü. v2:** Ethereal ist **nicht** immun gegen Physical/Pierce/Fire — stattdessen **stark reduziert (0.15×)**, um harte Pflicht-Türme zu vermeiden.

```
                  Unarmored   Light    Heavy    Fortified   Ethereal
                  ─────────  ──────   ──────   ─────────   ────────
Physical  ⚔️       1.0×      1.0×     0.7×     0.5×        0.15×
Pierce    🎯       1.2×      1.3×     0.5×     0.6×        0.15×
Siege     💥       0.8×      0.7×     1.5×     1.25×       0.75×
Magic     ✨       1.0×      1.0×     0.85×    0.75×       1.75×
Fire      🔥       1.15×     1.0×     0.9×     0.6×        0.15×
Ice       ❄️       1.0×      1.2×     1.0×     0.75×       1.5×
```

**Interpretation:**
- **Ethereal** ist **hart, aber nicht unbesiegbar**. Magic/Ice bleiben beste Konter, aber Notlösungen existieren.

### 2.4 Status-Effekte (Schicht 2)
| Effekt | Wirkung | Standarddauer | Gegenmittel (Enemy Flag) |
|---|---|---|---|
| **Slow** | -40% Speed | 2s | `immuneToSlow` |
| **Burn** | X DPS, verhindert Regen | 3s | `immuneToBurn` |
| **Armor Break** | **ArmorType wird 4s lang als *Unarmored* behandelt** | 4s | Ethereal immun |
| **Mark** | +15% Schaden von allen Quellen | 4s | – |
| **Stun** | Stop 0.4–0.5s | 0.5s | Boss immun |

> **Armor Break (final definiert):** Für die Dauer werden alle Schadensmultiplikatoren **aus der Unarmored-Spalte** verwendet. Dadurch keine Matrix-Brüche (z. B. Siege bleibt konsistent).

### 2.5 Immunitäts-Flags (Schicht 3)
- **Shielded** (Schild-HP)
- **Camo** (Detection nötig)
- **Regen** (Burn kontert)
- **Split**
- **Phasing** (Slow immun)
- **Aura** (Buff-Aura)

---

## 3. Tower-Katalog (Stats + Upgrade-Bäume)

### 3.1 Basis-Tower (finale Kosten)
| Tower | Typ | Base Stats | Kosten | Air? |
|---|---|---|---:|---|
| **Archer** | Physical | 25 dmg, 1.0/s, Range 60 | 50 | nur per Upgrade |
| **Dual-Gatling** | Pierce | 10 dmg, 5.0/s, Range 50 | 95 | nur per Upgrade |
| **Cannon** | Siege | 55 dmg, 0.5/s, Range 80 | 155 | per Upgrade |
| **Rocket** | Siege | 40 dmg, 0.5/s, Range 100 | 160 | **Air-only** (Basis) |
| **Magic** | Magic | 40 dmg, 1.5/s, Range 70 | 130 | nein |
| **Ice** | Ice | 2 dmg, 0.33/s, Range 60 | 100 | **Air + Ground** |
| **Fire** | Fire | 35 DPS Beam, Range 25 | 170 | per Upgrade |
| **Tentacle** | Physical (+20% True) | 30 dmg, 1.5/s, Range 25 | 185 | nein |

### 3.2 Upgrade-Kosten-Regel (vereinheitlicht)
- **Upgrade-Kosten-Skalierung:** **1.5× pro Tier** (alle Tower, alle Pfade). 
- Level-Costs sind pro Tower bereits so gewählt, dass sie ~1.5× skalieren (Richtwert).

### 3.3 Archer — Physical
**Upgrade-Pfad 3 (Air):**
- **Level 1: „Flak-Pfeile“ — schaltet Air-Targeting frei** (kein reines „Priorisieren“)
- Level 2: +30% Reichweite vs. Air
- Level 3: +20% Trefferchance auf schnelle Air

**Spezialisierungen:** Falkenauge (Camo-Detection) oder Durchschlagsbolzen.

### 3.4 Dual-Gatling — Pierce
**Air-Path:**
- L1 „AA-Gurt“ — Air-Targeting frei
- L2 Reichweite vs Air
- L3 Schaden vs Air

### 3.5 Cannon — Siege
**Armor Break Path:**
- L3 „Risse im Panzer“ — **Armor Break** (4s, Unarmored-Logik)

### 3.6 Rocket — Siege (Air-Only)
- Basis: **Air-only**, späterer Pfad „Bodenfreigabe“ erlaubt Ground.

### 3.7 Magic — Magic
- Stärkster Ethereal-Counter (1.75×).

### 3.8 Ice — Ice
- **Air + Ground** ab Basis. Niedriger DPS, starker Slow.

### 3.9 Fire — Fire
- **Air via Upgrade „Luftflamme“**.

### 3.10 Tentacle — Physical + True Damage
- **True Damage 20%** (Armor-unabhängig).

---

## 4. Enemy-Katalog (Stats + Armor + Flags)

> Zahlenwerte (HP/Speed) werden vom AI Director skaliert. Hier sind **Kategorien** und Armor/Flags.

| Enemy | Armor | Flags/Eigenschaften | Rolle |
|---|---|---|---|
| **Zombie** | Unarmored | – | Standard-Futter |
| **Rat** | Unarmored | Fast, Swarm | Early-Speed-Check |
| **Penguin** | Unarmored | Very Fast, Swarm | High-Speed-Check |
| **Wallsmasher** | Light | Fast | Evasive-Check |
| **Bat** | Light | Air | Air-Teaser |
| **Zombie Soldier** | Heavy | – | Heavy-Check |
| **Tank** | Heavy | Tanky | Armor-Check |
| **Mammoth** | Fortified | Very Slow | DPS-Check |
| **Herbert (Boss)** | Fortified | Boss | Mid-Boss |
| **Ghost** | Ethereal | – | Ethereal-Check |
| **Wraith** | Ethereal | Fast | Late-Game Terror |
| **Lich (Boss)** | Ethereal | Aura | Endgame-Boss |
| **Dragon** | Heavy | Air, Boss | Air-Boss |
| **Spider** | Light | Camo | Camo-Check |
| **Mech** | Heavy | Shielded, immuneToBurn | Shield-Check |
| **Skeleton** | Unarmored | Split | Swarm-Check |
| **Slime** | Unarmored | Regen, Split | Regen-Check |
| **Banshee** | Ethereal | Phasing | Slow-Check |

---

## 5. Economy & Rewards (Formeln + Kurve)

### 5.1 Kill-Reward-Formel (final)
```
KillReward = round(
    BaseHP * HP_Scale * SpeedFactor * ArmorFactor * AirFactor * FlagFactor * WaveFactor
)

BaseHP = max(1, HP / 40)
SpeedFactor = 0.9 + (Speed / 10) * 0.35
ArmorFactor = {Unarmored:1.00, Light:1.08, Heavy:1.18, Fortified:1.30, Ethereal:1.25}
AirFactor = Air ? 1.12 : 1.00
FlagFactor = (Boss ? 1.30 : 1.00) * (Elite ? 1.10 : 1.00)
WaveFactor = 1.0 + 0.02*(Wave-1)   // Anti-Snowball
HP_Scale = WaveHP_Multiplier
```

### 5.2 Wave Completion Rewards
```
WaveCompleteBase = 18 + round(2.6 * Wave)
PerfectBonus = round(0.35 * WaveCompleteBase)
CloseCallBonus = round(0.12 * WaveCompleteBase)
Milestones (Wave 10/20/30/40) = 45 / 80 / 120 / 170
```

### 5.3 Beispiel-Kurve (Richtwerte)
> Erwartungswerte (Kill+Completion) bei ~40–65 Kills/Wave.

| Wave | Ø KillReward | KillCredits | Completion | Total/Wave | Cumulative |
|---:|---:|---:|---:|---:|---:|
| 1 | 2.0 | 64 | 21 | 85 | 85 |
| 3 | 2.4 | 90 | 26 | 116 | 295 |
| 5 | 2.7 | 110 | 31 | 141 | 560 |
| 7 | 3.0 | 128 | 36 | 164 | 880 |
| 10 | 3.6 | 165 | 44 | 209 | 1,520 |
| 12 | 3.9 | 190 | 49 | 239 | 1,990 |
| 15 | 4.4 | 220 | 57 | 277 | 2,820 |
| 20 | 5.2 | 285 | 70 | 355 | 4,650 |
| 25 | 6.2 | 360 | 83 | 443 | 6,900 |
| 30 | 7.2 | 440 | 96 | 536 | 9,400 |

**Ziel:** 1 neuer Tower alle 2–3 Waves, Upgrades alle 3–4 Waves.

### 5.4 Anti-Snowball / Catch-Up
- **Perfect-Bonus gedeckelt (35%)**
- **Combo-Bonus max +30%**
- **Comeback-Bonus:** `min(15, HP_Lost * 0.3)` pro Wave

---

## 6. HQ & Research System

### 6.1 HQ-Level & Unlocks (final, konsistent)
| HQ Level | Kosten | Unlocks |
|---:|---:|---|
| **1** | Start | Archer, Dual-Gatling, Research-Slot 1 |
| **2** | **180** | **Cannon, Ice**, Armor-UI sichtbar |
| **3** | **360** | **Magic, Fire**, Status-Icons sichtbar, Research-Slot 2 |
| **4** | **600** | **Rocket, Tentacle**, Camo möglich, AA-Upgrades freischaltbar |
| **5** | **950** | T2-Upgrades + Global Perks, Research-Slot 3 |
| **6** | **1400** | T3-Upgrades + Spezial-Mods |

**Timing-Ziel:**
- HQ2: Wave 3–4
- HQ3: Wave 6–7
- HQ4: Wave 10–12

### 6.2 Forschung (Beispiele, konsistent)
- **AA Retrofit (Engineering):** Archer & Gatling erhalten Air-Targeting (70% dmg vs Air).
- **Shatter Rounds (Military):** Armor Break Chance +10% (Physical/Pierce).
- **Hexed Mark (Arcane):** Mark +15% für 4s.

### 6.3 Fairness-Regel für AI Director
> **AI darf neue Mechaniken erst testen, wenn der Spieler Zugriff darauf hatte.**
- Air-Waves nur nach HQ2/AA-Optionen.
- Camo nur wenn Detection erforschbar.

---

## 7. Wave Pacing & Air Design

### 7.1 Air-Design (finale Entscheidung)
- **Teaser-Bats** in Mixed Waves ab **Wave 6**.
- **Erste reine Air-Wave fix bei Wave 8**.
- Danach AI-dynamisch, aber:
  - **MIN_AIR_GAP = 4** Waves
  - **AIR_WARNING_LEAD = 2** Waves
  - **Air nur wenn Anti-Air vorhanden** (Ice oder AA-Upgrades)

### 7.2 Air-Optionen (mind. 3 viable)
- **Ice** (Base)
- **Rocket** (Air-only, hoher DPS)
- **Archer/Gatling** (über AA Retrofit oder Upgrade-Pfad)
- **Cannon** (Air-Upgrade Pfad)
- **Fire** (Luftflamme)

---

## 8. AI Wave Director Regeln

### 8.1 Counter-Logik (soft/hard)
- **Soft Counter:** +20–30% Spawn-Rate eines Konters
- **Hard Counter:** nur für neue Mechaniken (Ethereal, Camo, Air)

### 8.2 Heuristik
| Spieler-Schwäche | AI-Antwort |
|---|---|
| Kein Siege | mehr Heavy/Fortified (soft) |
| Kein Magic/Ice | Ethereal-Teaser + Ghost-Check (hard einmalig) |
| Kein Anti-Air | keine Air, stattdessen Ground-Check |
| Nur Siege | Swarm + Light |

---

## 9. Visuelles Feedback
- **Damage Numbers**: Größe/Farbe nach Effektivität.
- **Armor-Icons** am HP-Bar-Rahmen.
- **Ethereal**: lila/transparenter Shader.
- **Air-Alert**: rotes Air-Icon + Sound, 2 Waves vorher.

---

## 10. Progression Timeline (Wave-für-Wave)

> **Ultimativer Konsistenz-Check** — jede Einführung entspricht HQ-Level, Economy und AI-Regeln.

**Wave 1**: Unarmored (Zombie/Rat). HQ1 (Archer, Gatling). Start-Credits 60.
**Wave 2**: Swarm-Pressure, erste Upgrade-Entscheidung.
**Wave 3**: HQ2 erreichbar → **Cannon + Ice**.
**Wave 4**: Light Armor-Teaser (Wallsmasher).
**Wave 5**: Light-Wave, Ice-Slow relevant.
**Wave 6**: **Teaser Air (1–2 Bats)**, HQ3 erreichbar → **Magic + Fire**.
**Wave 7**: Heavy-Teaser (Zombie Soldier).
**Wave 8**: **Erste reine Air-Wave (fix)**. Anti-Air verfügbar (Ice / AA-Pfad).
**Wave 9**: Breather (leichter Ground).
**Wave 10**: Heavy-Check (Tank). HQ4 in Reichweite.
**Wave 11**: Mixed Ground + Air-Teaser.
**Wave 12**: **Air-Swarm** (Bats), HQ4 → **Rocket + Tentacle**.
**Wave 13**: Fortified-Teaser (Mammoth).
**Wave 14**: Heavy+Light Mixed.
**Wave 15**: **Hybrid Check** (Air + Heavy).
**Wave 16**: Breather.
**Wave 17**: Shielded-Teaser (Mech-lite).
**Wave 18**: Mini-Boss Ground (Herbert lite).
**Wave 19**: **Fortified-Wave**.
**Wave 20**: **Air-Elite** (1 Dragon). HQ5 erreichbar (T2 Upgrades).
**Wave 21**: Ethereal-Teaser (1 Ghost).
**Wave 22**: **Ethereal-Check** (Ghost-Wave, soft).
**Wave 23**: Mixed Ground + Ghost Escort.
**Wave 24**: Breather.
**Wave 25**: Air-Swarm + Ground Rush.
**Wave 26**: Camo-Teaser (1–2 Spider) falls Detection verfügbar.
**Wave 27**: Heavy+Fortified Check.
**Wave 28**: **Air-Elite** (2 Dragons).
**Wave 29**: Mixed Ethereal + Heavy.
**Wave 30**: Final Boss (Lich) + Mixed.

---

## 11. Offene Entscheidungen
1. **Ghost-Visuals** (Asset final).
2. **Camo-Detection UI** (Radar-Icon vs. Tower-Halo).
3. **Exact DPS-Werte** je Tower für TargetCost-Validierung.
4. **Poison-Schadenstyp**: eigener Typ oder Fire-Subtyp?
5. **Endless-Scaling** (HP/Speed-Kurven nach Wave 30).
