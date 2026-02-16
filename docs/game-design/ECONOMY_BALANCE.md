# ECONOMY_BALANCE.md – 3D Tower Defense (Economy & Reward Balance)

> Ziel: Vorhersagbare, skalierende Economy mit klaren Checkpoints, Anti‑Snowball und Catch‑Up, plus AI‑Director‑kompatible Reward‑Formeln. Alle Zahlen sind Vorschläge, aber konsistent und direkt implementierbar.

---

## 0) Design‑Ziele (kurz)
- **Skill belohnen**, aber **kein Snowball** nach perfektem Start.
- **Rewards skalieren** mit Wave‑Difficulty (HP/Speed‑Multiplikator).
- **Gleiche Formel** für alle Enemies statt manuell pro Typ.
- **Tower‑Kosten** sollen mit effektivem DPS und Armor‑Matrix harmonieren.

---

## 1) Kill‑Reward‑System (Formel‑basiert)

### 1.1 Grundformel (pro Kill)
Wir berechnen den Reward aus HP, Speed, Armor, Air/Flags und Wave‑Skalierung.

**Formel:**
```
KillReward = round(
    BaseHP * HP_Scale * SpeedFactor * ArmorFactor * AirFactor * FlagFactor * WaveFactor
)

BaseHP = max(1, HP / 40)
SpeedFactor = 0.9 + (Speed / 10) * 0.35          // Speed 3..10 → ~1.0..1.25
ArmorFactor = {Unarmored:1.00, Light:1.08, Heavy:1.18, Fortified:1.30, Ethereal:1.25}
AirFactor = Air ? 1.12 : 1.00
FlagFactor = (isBoss ? 1.30 : 1.00) * (isElite ? 1.10 : 1.00)
WaveFactor = 1.0 + 0.035*(Wave-1)                 // +3.5% pro Wave
HP_Scale = WaveHP_Multiplier                      // aus AI‑Director
```

**Rationale:**
- HP ist Haupttreiber, Speed erhöht Bedrohung (weniger Zeit zum DPS).
- Armor/Ethereal erhöhen Reward, da Tower‑Matrix Einschränkungen erzeugt.
- Air +12% (Reichweite/AA‑Check).
- Boss/Elite separat: Baseline hoch, aber zusätzlicher Bonus (s. 1.2).

### 1.2 Spezial‑Rewards

**Boss‑Kill Bonus (zusätzlich zum KillReward):**
```
BossBonus = round(0.35 * TotalBossRewardBase)
TotalBossRewardBase = KillReward
```
→ Boss gibt **+35% extra** bei Tod (kleiner Spike, kein Snowball).

**First‑Kill neuer Typ:**
```
FirstKillBonus = 6 + round(0.08 * KillReward)   // einmalig pro Enemy‑Typ
```
→ Belohnt Entdeckung ohne Economy zu brechen.

**Combo‑Kill (Streak, 3s Window):**
```
ComboMult = 1 + 0.05 * min(ComboCount, 6)        // max +30%
ComboReward = round(KillReward * ComboMult)
```
→ Kurzfristig stärker, aber gedeckelt.

### 1.3 Beispiele (Wave 1, HP_Scale=1.0)
- **Zombie (HP80, Speed5, Unarmored):**
  BaseHP=2.0, SpeedFactor=1.075 → Reward ≈ 2.15 → **2**
- **Rat (HP5, Speed10):**
  BaseHP=1, SpeedFactor=1.25 → **1**
- **Tank (HP250, Speed3, Heavy):**
  BaseHP=6.25, SpeedFactor=1.005, ArmorFactor=1.18 → **7–8**
- **Bat (HP25, Speed8, Light, Air):**
  BaseHP=1, SpeedFactor=1.18, Armor=1.08, Air=1.12 → **1–2**

> Ergebnis ist nahe der bisherigen Werte, aber skaliert automatisch mit Wave‑Multiplikatoren.

### 1.4 Wave‑Skalierung
- **WaveFactor** (+3.5% pro Wave) ist **zusätzlich** zum HP‑Multiplikator.
- Damit steigen Rewards **leicht schneller** als HP, um Upgrades mit wachsender Komplexität zu finanzieren.

---

## 2) Wave Completion Rewards

### 2.1 Grundformel (nicht flat)
```
WaveCompleteBase = 18 + round(2.6 * Wave)        // Wave 1: 21, Wave 10: 44, Wave 30: 96
```

### 2.2 Perfekt / Close‑Call Bonus
- **Perfect Wave (0 HP lost):**
  `PerfectBonus = round(0.35 * WaveCompleteBase)`
- **Close‑Call (<=10% HP lost):**
  `CloseCallBonus = round(0.12 * WaveCompleteBase)`

> Close‑Call gibt **weniger** als Perfect, aber motiviert trotz Fehler.

### 2.3 Milestone Rewards
- Wave **10/20/30/40**:
  `MilestoneBonus = 45, 80, 120, 170` (steigend, aber kontrolliert)
- Milestone ersetzt **nicht** die Base‑Completion.

---

## 3) Tower‑Kosten‑Balancing

### 3.1 Cost‑to‑DPS Ratio
Ziel‑Baseline: **1 Credit = 1.1 Effective DPS** (Kern‑Damage)

**Effective DPS Formel:**
```
EffectiveDPS = RawDPS * AvgArmorMultiplier * UtilityFactor
AvgArmorMultiplier = (sum of tower damage multipliers vs all armor types) / 5
UtilityFactor = 1.00 bis 1.25 (Slow, Splash, AoE, Pierce etc.)
```

**Beispiel‑Bewertung:**
- Tower mit starken Heavy‑Multiplikatoren (1.5×) und schwach vs Unarmored (0.8×)
  → höherer AvgArmorMultiplier und damit **höherer Kostenwert**.

**Cost‑Ziel:**
```
TargetCost = EffectiveDPS / 1.1
```
- Wenn EffectiveDPS=110 → TargetCost≈100

### 3.2 Tower‑Kosten‑Korridor
- **Ranged Single‑Target:** 0.95–1.10 × TargetCost
- **AoE/Splash:** 1.10–1.25 × TargetCost
- **CC/Utility (Slow/Freeze/Mark):** +10–20% auf Cost

### 3.3 Upgrade‑Kosten‑Kurve
**Regel:** Upgrades dürfen **teurer** werden, aber mit klarer Effizienzkurve.

```
Upgrade1 = 0.75 × BaseCost   // Effizienz leicht besser als Neu‑Tower
Upgrade2 = 1.00 × BaseCost
Upgrade3 = 1.35 × BaseCost
Upgrade4 = 1.80 × BaseCost
```
→ Early Upgrades sind attraktiv, später wird Diversifizierung belohnt.

### 3.4 Sell‑Value (60% fair?)
- Basis: **60%** ist ok, aber Upgrades sollten etwas weniger geben:
```
SellValue = BaseCost*0.60 + UpgradesCost*(0.50)  // reduziert Abuse
```
- Alternative: gestaffelt
  - T1: 60%
  - T2: 58%
  - T3: 55%
  - T4: 50%

---

## 4) Economy‑Kurve (30+ Waves)

### 4.1 Annahmen
- Durchschnittlich **40 Kills/Wave** (variiert durch Director)
- Mittel‑KillReward pro Wave steigt durch WaveFactor + HP‑Scaling
- Ziel: **1 neuer Tower alle 2–3 Waves**, Upgrades alle 3–4 Waves

### 4.2 Beispiel‑Tabelle (Wave 1–30)
> Werte sind **Erwartungswerte** (Kill + Completion). AI‑Director kann schwanken.

| Wave | Ø KillReward | Kills | KillCredits | Completion | Total/Wave | Cumulative | Leistenbar |
|------|-------------:|------:|-----------:|-----------:|-----------:|-----------:|------------|
| 1 | 2.0 | 32 | 64 | 21 | 85 | 85 | Archer (50), Start‑Tower |
| 2 | 2.2 | 35 | 77 | 23 | 100 | 185 | 2. Tower möglich |
| 3 | 2.4 | 38 | 91 | 26 | 117 | 302 | Gatling (95) |
| 5 | 2.8 | 40 | 112 | 31 | 143 | 585 | Ice (100), Magic (130) |
| 7 | 3.2 | 42 | 134 | 36 | 170 | 925 | Cannon (155) |
| 10 | 3.9 | 45 | 176 | 44 | 220 | 1,555 | Rocket/Fire (160–170) + Upgrades |
| 12 | 4.3 | 48 | 206 | 49 | 255 | 2,065 | Tentacle (185) |
| 15 | 4.9 | 50 | 245 | 57 | 302 | 2,830 | Upgrade T2–T3 |
| 20 | 6.0 | 55 | 330 | 70 | 400 | 4,800 | 2× High Tier + Upgrades |
| 25 | 7.4 | 60 | 444 | 83 | 527 | 7,500 | Mehrfach T3 |
| 30 | 9.0 | 65 | 585 | 96 | 681 | 11,200 | End‑Tier Ausbau |

**Checkpoint‑Interpretation:**
- **Wave 1–3:** 1–2 Basic‑Towers
- **Wave 7–12:** Mid‑Tier erreichbar
- **Wave 15–20:** Core‑Build + 1–2 Upgrades
- **Wave 25–30:** End‑Build / mehrere T3

### 4.3 Anti‑Snowball
- **Perfect‑Bonus gedeckelt**: max 35% von Completion.
- **Combo‑Bonus gedeckelt**: max +30%.
- **Milestones** sind fix → kein Turbo für perfektes Early‑Play.

### 4.4 Catch‑Up Mechanik
- **HP‑Verlust** gibt kleinen „Comeback‑Bonus“:
```
ComebackBonus = round( min(15, HP_Lost * 0.3) )  // pro Wave, max +15
```
- Dadurch verliert man nicht komplett den Anschluss.

---

## 5) Research/HQ System (NEU)

### 5.1 Konzept
- **HQ‑Level** muss upgegradet werden.
- Jedes Level schaltet **Tower‑Tiers** und **Upgrades** frei.

### 5.2 HQ‑Kosten & Unlocks (integriert in Economy‑Kurve)
| HQ Level | Kosten | Unlocks |
|---------:|-------:|---------|
| 1 | Start | Basic Tower (Archer) |
| 2 | 220 | Gatling, Ice | 
| 3 | 420 | Magic, Cannon |
| 4 | 750 | Rocket, Fire |
| 5 | 1,200 | Tentacle + T2 Upgrades |
| 6 | 1,800 | T3 Upgrades |
| 7 | 2,600 | Spezial‑Mods (AA‑Buff, Boss‑Debuff) |

**Timing:**
- HQ2 nach Wave 3–4 erreichbar
- HQ4 um Wave 10
- HQ5 um Wave 12–13
- HQ6+ ab Wave 18–20

### 5.3 Warum passt es?
- HQ‑Costs liegen bei **~1–1.5×** einer Wave‑Einnahme um diese Phase.
- Spielende müssen in **Entscheidung** investieren: Tower vs HQ.

---

## 6) Air Wave Scheduling (Fairness)

### 6.1 Problem
Random Air‑Waves sind unfair ohne AA.

### 6.2 Lösungsvorschlag (Hybrid)
1. **Fixe Air‑Slots**: ab Wave **6** jede **4. Wave** enthält Air.
   - W6, W10, W14, W18, W22, W26, W30
2. **Wave‑Preview**: 1–2 Waves vorher wird Air angekündigt.
3. **AI Director darf Air nur**, wenn Spieler **AA‑fähig** (mind. 1 Tower mit Air‑Hit).

### 6.3 Andere TDs (kurz)
- **Bloons TD**: feste Air‑Wellen (z.B. Lead/Camo) mit klarer Vorschau.
- **Kingdom Rush**: Flug‑Enemies sind in festen Campaign‑Karten, nicht random.

**Empfehlung:** Fix‑Slots + AI‑Check für Fairness.

---

## 7) Quick‑Summary (Implementierung)
- **KillReward‑Formel** mit HP, Speed, Armor, Air, Flags + WaveFactor.
- **Wave Completion** skalierend mit Perfect/Close‑Call.
- **Tower‑Cost** via EffectiveDPS + UtilityFactor.
- **Upgrades** progressiv teurer; Sell‑Value sinkt leicht.
- **Economy‑Kurve** erlaubt 1 Tower alle 2–3 Waves.
- **HQ‑System** integriert als Progress‑Gate.
- **Air‑Wellen**: fixe Slots + AA‑Check.

---

## 8) To‑Do / Nächste Schritte
- DPS‑Daten pro Tower sammeln → TargetCost validieren.
- Armor‑Matrix finalisieren → AvgArmorMultiplier exakt berechnen.
- AI‑Director Output testen (HP_Scale, SpeedMult) → Reward‑Skalierung validieren.
- Playtest mit 2 Skill‑Levels (Noob/Pro) → Anti‑Snowball & Catch‑Up prüfen.
