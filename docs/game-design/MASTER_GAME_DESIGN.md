# 3DTD — Master Game Design Document

**Stand:** 2026-05-12 (§5 Economy, §6.5 + §8 Wave Director, §7.1 + §10: 2026-09-07)

> **Implementierungsstatus:** Damage-Matrix (§2.3), Status-Effekte Slow/Burn/Mark
> (§2.4), Tower-Katalog (§3) und Forschungszentrum (§6) sind implementiert
> (`src/app/configs/combat/damage-matrix.config.ts`, `src/app/configs/research/`).
> Status-Effekte Phase 2 (Armor Break, Stun) und einzelne Enemy-Flags
> (Camo, Phasing, Aura) sind teilweise noch offen — siehe `TODO.md`.
>
> **Erweitert seit 2026-05-11:** Der **Lightning Tower** mit eigenem `damageType: 'lightning'`
> (8. Schadenstyp im Code, `DAMAGE_TYPES` in `configs/combat/combat.types.ts`) ist
> ausgeliefert und in §2.1 / §2.3 / §3.12 integriert.
>
> **Erweitert 2026-09-12:** Schadenstyp **Chaos** (9. Typ, 1,0 gegen jede
> Rüstung) und der **Chaos Tower** als teurer Generalist, §2.1 / §2.3 / §3.13.

## 1. Design-Philosophie
- **Einfach zu lernen, schwer zu meistern**: klare Basisregeln + Veteranen-Tiefe (Matrix, Status, Flags).
- **Fairness vor Überraschung**: neue Mechaniken werden **geteasert**, harte Checks nur nach Verfügbarkeit von Countern.
- **Strategische Vielfalt**: mehrere gültige Antworten auf jede Bedrohung (kein Ein-Turm-Meta).
- **Lesbarkeit**: Icons, Farben, Damage-Feedback, Wave-Preview.
- **Progressive Komplexität**: neue Armor-Typen, Flags und Air werden schrittweise eingeführt.

---

## 2. Damage & Armor System (Matrix + Status + Flags)

### 2.1 Schadenstypen (9)
- **Physical (⚔️)**: solider Allrounder ohne Stärke, prallt an Panzerung ab.
- **Pierce (🎯)**: hohe Feuerrate, Schwarm- und Flinkkiller, gegen Stein und Stahl nutzlos.
- **Siege (💥)**: langsame AoE, reiner Panzerknacker, gegen weiche Ziele und Geister schwach.
- **Magic (✨)**: bester Ethereal-Counter, zweiter Konter gegen Fortified, flinke Ziele weichen aus.
- **Fire (🔥)**: DoT/Burn, verbrennt Fleisch, gegen Stein und Geister wirkungslos.
- **Ice (❄️)**: Low-DPS, starker Slow/CC, Ethereal-Counter.
- **Poison (☠️)**: DoT-Spezialist gegen Lebendes, eigenstaendiger Schadenstyp.
- **Lightning (⚡)**: Hitscan-Chain (Primary + Jumps mit Falloff), stark gegen Light und Ethereal, gut gegen Heavy (Metall leitet), gegen Stein wirkungslos.
- **Chaos (🌀)**: voller Schaden gegen jede Rüstung, keine Schwäche und keine Stärke. Der Generalist, teuer und spät erforschbar.

### 2.2 Rüstungstypen (5)
- **Unarmored**
- **Light**
- **Heavy**
- **Fortified**
- **Ethereal**

### 2.3 Schadensmatrix (Stand 2026-09)
> **Änderung 2026-09:** Spreizung pro Rüstung von 1,5× bis 11,7× auf 3× bis 20×
> erweitert. Vorher hatten sechs von acht Schadensarten keine Paarung unter 0,5,
> die Cannon keine unter 0,7. Ethereal bleibt **nicht** immun gegen
> Physical/Pierce/Fire, sondern **stark reduziert (0.1×)**.

```
                  Unarmored   Light    Heavy    Fortified   Ethereal
                  ─────────  ──────   ──────   ─────────   ────────
Physical  ⚔️       1.0×      1.0×     0.5×     0.3×        0.1×
Pierce    🎯       1.25×     1.6×     0.35×    0.25×       0.1×
Siege     💥       0.5×      0.5×     1.75×    1.6×        0.3×
Magic     ✨       0.9×      0.5×     0.9×     1.3×        2.0×
Fire      🔥       1.5×      1.2×     0.6×     0.25×       0.1×
Ice       ❄️       1.0×      1.3×     0.8×     0.5×        1.5×
Poison    ☠️       1.4×      1.2×     0.4×     0.3×        0.2×
Lightning ⚡       1.0×      1.5×     1.2×     0.3×        1.5×
Chaos     🌀       1.0×      1.0×     1.0×     1.0×        1.0×
```

Spreizung: unarmored 3,0×, light 3,2×, heavy 5,0×, fortified 6,4×, ethereal 20×.
Die Chaos-Zeile liegt in jeder Spalte innerhalb dieser Spannen und ändert sie nicht.

> **Quelle der Wahrheit:** `src/app/configs/combat/damage-matrix.config.ts`. Bei
> Anpassungen dort gilt es, diese Tabelle synchron zu halten — die TypeScript-
> Mapped-Types erzwingen Vollständigkeit auf Code-Seite, nicht in der Doku.

**Regeln** (als Test in `damage-calculator.spec.ts`):
1. Jede Schadensart hat mindestens eine Paarung ≤ 0,5: dort beißt sich der Tower die Zähne aus.
2. Jede Schadensart außer Physical hat mindestens eine Paarung ≥ 1,3. Physical bleibt der Allrounder ohne Stärke, er ist der Starttower.
3. Jede Rüstungsart hat mindestens zwei Konter ≥ 1,2, beide erforschbar, bevor das Curriculum die Rüstung zum ersten Mal schickt.

**Ausnahme Chaos** (seit 2026-09-12): Chaos bricht Regel 1 und 2 bewusst, die
Zeile steht überall auf 1,0. Der Generalist bezahlt nicht mit einer
Matrix-Lücke, sondern mit Preis (Tower 200, Forschung 1.000 hinter Siege
Engineering und Storm Mastery, §3.13) und damit, dass er in keiner Spalte der
beste Konter ist. Auch gegen Ethereal 1,0 statt einer Abwertung: Magic (2,0),
Ice und Lightning (1,5) bleiben deutlich besser, und weil die Chaos-Forschung
Arcane Studies voraussetzt, gibt es Chaos nie vor dem ersten echten
Ethereal-Konter. Chaos zählt damit als Anti-Ethereal-Tower
(`isAntiEtherealTower`, Schwelle 1,0), das Mechanik-Gate aus §6.5 bleibt
unverändert. Der Test prüft beides (`damage-calculator.spec.ts`).

| Rüstung | Konter ≥ 1,2 |
|---|---|
| Unarmored | Fire 1,5 · Poison 1,4 · Pierce 1,25 |
| Light | Pierce 1,6 · Lightning 1,5 · Ice 1,3 · Fire 1,2 · Poison 1,2 |
| Heavy | Siege 1,75 · Lightning 1,2 |
| Fortified | Siege 1,6 · Magic 1,3 |
| Ethereal | Magic 2,0 · Ice 1,5 · Lightning 1,5 |

**Interpretation:**
- **Ethereal** ist **hart, aber nicht unbesiegbar**. Magic/Ice/Lightning bleiben beste Konter, aber Notlösungen existieren.
- **Luft:** Light-Flieger (Fledermaus, Hornisse) kontern Gatling mit AA Retrofit (1,6), Lightning (1,5) und Ice (1,3). Heavy-Flieger (Drache) kontern Rocket (1,75) und Lightning (1,2). Die Rocket ist damit der Anti-Drachen-Tower und gegen Schwärme schwach (0,5).
- **Fairness-Gate:** Der Wave-Director würde eine schlechte Paarung sonst mit einer kleineren Welle beantworten. Deshalb zählt er gegen Boden-Gegner (außer Ethereal) jeden Tower mit mindestens 0,6 (`FAIRNESS_MATCHUP_FLOOR`), siehe §6.5.

### 2.4 Status-Effekte (Schicht 2)
| Effekt | Wirkung | Standarddauer | Gegenmittel (Enemy Flag) |
|---|---|---|---|
| **Slow** | -40% Speed | 2s | `immuneToSlow` |
| **Burn** | X DPS, verhindert Regen | 3s | `immuneToBurn` |
| **Armor Break** | **ArmorType wird 4s lang als *Unarmored* behandelt** | 4s | Ethereal immun |
| **Mark** | +15% Schaden von allen Quellen | 4s | – |
| **Stun** | Stop 0.4–0.5s | 0.5s | Boss immun |

> **Burn (umgesetzt 2026-09-11):** Der Fire Tower gibt 20 % seiner Beam-DPS als
> Burn aus (3 s, pro Turm ein Eintrag, Tick 500 ms), die Summe im Kegel bleibt
> gleich. Regen gibt es im Spiel nicht; `immuneToBurn` ist noch nicht umgesetzt.
> Details in [STATUS_EFFECTS.md](../STATUS_EFFECTS.md#burn-effect-dot).

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

### 3.1 Basis-Tower
> Werte aus `tower-types.config.ts` (Quelle der Wahrheit), Stand 2026-09.

| Tower | Typ | Base Stats | Kosten | Air? |
|---|---|---|---:|---|
| **Archer** | Physical | 25 dmg, 1.0/s, Range 30 | 45 | **Air + Ground** |
| **Dual-Gatling** | Pierce | 10 dmg, 5.0/s, Range 50 | 90 | per Forschung (AA Retrofit) |
| **Cannon** | Siege | 55 dmg, 0.5/s, Range 70, Splash 6 m (max. 8 Ziele) | 150 | nein |
| **Rocket** | Siege | 40 dmg, 0.5/s, Range 100 | 120 | **Air-only** |
| **Magic** | Magic | 40 dmg, 1.5/s, Range 70 | 140 | nein |
| **Ice** | Ice | 5 dmg, 0.33/s, Range 60, Slow 50 % 3 s, Splash 8 m | 90 | **Air + Ground** |
| **Fire** | Fire | 35 DPS Beam, Range 20 (= Flammenlänge) | 110 | nein |
| **Tentacle** | Physical | 30 dmg, 1.5/s, Range 25 | 80 | nein |
| **Poison** | Poison | 5 dmg + DoT 8/s für 4 s, 1.0/s, Range 55, Splash 8 m | 100 | nein |
| **Lightning** | Lightning | 35 dmg primary, Chain ×0.7/Jump, 2 Jumps, 0.8/s, Range 65 | 130 | **Air + Ground** |
| **Chaos** | Chaos | 50 dmg, 1.2/s, Range 60, 1,0 gegen jede Rüstung | 200 | **Air + Ground** |

### 3.2 Upgrade-Regeln (Stand 2026-09)
- **Kosten:** `50 × 1,25^Stufe` pro Stufe und Track, für alle Tower gleich.
- **Damage und Fire Rate:** 25 Stufen. Stufe 1–15 wirkt der tower-eigene
  Multiplikator `m`, Stufe 16–25 nur noch `1 + 0,4 × (m − 1)`. L25 liefert das
  5,3- bis 6,4-Fache der Basis-DPS (vorher 14,5 mit ×1,05/×1,06 für alle).
- **Range:** 10 Stufen × 1,03 (max. ×1,34), für alle Tower gleich (vorher 25 Stufen
  × 1,04, also ×2,67; Archer ×1,02). Beim Fire Tower verlängert Range die Flamme,
  Beam Width ist ebenfalls ein 10-Stufen-Track × 1,03.
- **Tier-Gating:** 5er-Bänder hinter Forschung (T2 Advanced Weaponry … T5
  Transcendent Tech). Der Range-Track endet in Tier 2.
- Der Tower wächst über Schaden oder über Tempo:

| Tower | Damage `m` | Fire Rate `m` | Idee |
|---|---:|---:|---|
| Archer | 1,05 | 1,04 | Starttower, im Endausbau kein Dauerfeuer |
| Dual-Gatling | 1,04 | 1,06 | Feuerrate ist der Kill-Durchsatz gegen Schwärme |
| Cannon | 1,07 | 1,02 | schwere Einzelschüsse, Splash-Durchsatz bleibt klein |
| Magic | 1,05 | 1,05 | ausgewogen |
| Rocket | 1,07 | 1,03 | wenige schwere Treffer gegen Drachen |
| Ice | 1,04 | 1,05 | Rate bestimmt die Slow-Abdeckung |
| Fire | 1,06 | (Beam Width 1,03) | Kegel trifft viele Ziele |
| Tentacle | 1,07 | 1,03 | Nahkampf, wenige harte Schläge |
| Poison | 1,05 | 1,04 | DoT skaliert mit dem Damage-Track |
| Lightning | 1,05 | 1,04 | Kette vervielfacht ohnehin |
| Chaos | 1,05 | 1,04 | Generalist, soll die Spezialisten auch im Endausbau nicht überholen |

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
- Stärkster Ethereal-Counter (2.0×), zweiter Konter gegen Fortified (1.3×, Runen gegen Stein).
- Schwach gegen Light (0.5×): flinke Ziele weichen den Geschossen aus.

### 3.8 Ice — Ice
- **Air + Ground** ab Basis. Niedriger DPS, starker Slow.

### 3.9 Fire — Fire
- **Air via Upgrade „Luftflamme“**.

### 3.10 Tentacle — Physical
- Reiner Physical-Schaden. Die früher geplanten 20 % True Damage (Armor-unabhängig)
  sind gestrichen: sie würden die Matrix-Spreizung wieder aufweichen
  (BALANCE_PROPOSAL_2026-09, Entscheidung 7).

### 3.11 Poison — Poison
- DoT-Spezialist mit Splash-Projektil.
- Eigenstaendiger Schadenstyp (nicht Fire-Subtyp).
- Poison-DoT und Burn-DoT sind getrennte Effekte, koennen gleichzeitig wirken.

### 3.12 Lightning — Lightning
- **Chain-Hitscan** (`attackType: 'chain'`): Primary-Treffer + 2 Jumps, je `chainFalloff 0.7` (100% → 70% → 49%), `jumpRange 15m` zwischen Chain-Links.
- **Air + Ground** ab Basis — Anti-Air ohne Forschungspflicht.
- **Niche:** zweiter glaubwürdiger Ethereal-Counter (1.5×), stark gegen Light-Swarms (1.5×, profitiert zusätzlich vom Chain-Pattern) und neben der Rocket der zweite Anti-Drachen-Tower (1.2× gegen Heavy, Metall leitet). **Wirkungslos gegen Fortified** (0.3×) — Cannon/Siege oder Magic bleibt der Pflichtbau gegen Mammoth/Stone-Golem.
- Visuell: dauerhaftes Idle-Crackle am Turm-Tip, additive Aufhell-Halos pro Hit (Workaround, weil Photorealistic 3D Tiles dynamische Lichter ignorieren).

### 3.13 Chaos (seit 2026-09-12)
- **Generalist:** 1,0 gegen jede Rüstung (§2.3), Luft und Boden, Einzelziel-Projektil (`chaos-orb`, kein Splash).
- **Teuer und spät:** 200 Gold, der teuerste Tower. Freischaltung über **Chaos Rift** (1.000 Gold, 30 s) hinter Siege Engineering und Storm Mastery, damit auch hinter Arcane Studies. Der ganze Pfad kostet 3.650 Gold Forschung (Gatling Tech, Siege Engineering, Ice Magic, Arcane Studies, Storm Mastery, Chaos Rift).
- **Kein Pflicht-Tower:** 60 DPS wie Magic. Nach dem DPS-Modell (`computeTowerDPSFromLevels`, Basisstufe, nicht gemessen) bringt Chaos gegen jede Rüstung 0,30 DPS pro Gold, der beste Tower je Rüstung 0,56 (Fortified: Magic) bis 0,89 (Light: Gatling). Auch pro Bauplatz liegt Chaos in keiner Spalte vorn:

| Basisstufe, DPS × Matrix | Unarmored | Light | Heavy | Fortified | Ethereal |
|---|---:|---:|---:|---:|---:|
| Chaos | 60 | 60 | 60 | 60 | 60 |
| bester Spezialist | Fire 79 | Lightning 92 | Cannon 77 | Magic 78 | Magic 120 |

  Die Stärke ist, dass eine gemischte Welle (`chaos_wave`, `armor_gauntlet`) keine Lücke findet, nicht die Menge. Der Test `tower-types.config.spec.ts` hält Preis und DPS pro Gold fest.
- **Upgrades:** Damage 1,05, Fire Rate 1,04, L25 ×5,35 wie Archer und Lightning (§3.2).
- **Platzhalter-Modell:** Es gibt noch kein Chaos-Modell. Bis eines kommt, steht das Poison-Modell schwarz-violett getönt (`modelTint`) im Spiel, Werte für Maße und Schusshöhe von dort. Der Sound ist der Magic-Cast.
- **Wave-Director:** zählt als Anti-Air und als Anti-Ethereal (Ethereal-Multiplikator 1,0 erreicht die Schwelle von `isAntiEtherealTower`).

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
| **Bear** | Heavy | Tanky | Ground-Tank |
| **Hornet** | Light | Air, Swarm | Air-Swarm |
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

> **Superseded seit Phase 5.16.** Die frueher hier stehende Formel
> `WaveCompleteBase = 18 + round(2.6 * Wave)` ist **nicht mehr implementiert**.
> Das Gold pro Wave ist jetzt **deterministisch pro Wave-Nummer** und steht als
> `WAVE_CURRICULUM` in `src/app/configs/wave-curriculum.config.ts`, abgefragt
> ueber `goldBudgetForWave()`.

Warum: die Formel band das Einkommen an das, was die Wave-Faktoren gerade
ausspuckten. Mit einem festen Budget pro Wave ist das kumulative Einkommen
planbar — erst damit lassen sich Tower- und Forschungskosten ueberhaupt
balancen.

```
{ kill, complete } = goldBudgetForWave(Wave)     // W1-30 aus der Tabelle
PerfectBonus   = 0.35 * complete                 // 0 HP verloren
CloseCallBonus = 0.12 * complete                 // HP <= 25 am Wave-Ende
ComboBonus     = min(0.30, 0.05 * PerfectStreak) * complete
Milestones (Wave 10/20/30/40) = 45 / 80 / 120 / 170
```

Nach W30 loopt das Template, das Gold-Budget nicht: es wird ab dort **getapert**
(`GOLD_TAPER_PER_WAVE`, Untergrenze `GOLD_SUSTAIN_FRACTION`) statt neu bei W1 zu
beginnen. Ein reiner Loop liess Wave 31 von 180.000 auf 200 Gold fallen und
zahlte ueber 100 Wellen 2,64 Mio. gegen ein Design-Roster von 1,39 Mio. — die
Verteidigung erreichte den Vollausbau und toetete ab W11 alles.

### 5.3 Beispiel-Kurve (Ist-Werte aus dem Curriculum)

> `goldKill` + `goldComplete` je Wave, ohne Skill-Boni. Vollstaendige Tabelle:
> `WAVE_CURRICULUM` in `configs/wave-curriculum.config.ts`.
> Visualisierung: `npm run economy-chart` → `docs/economy-chart.html`.

| Wave | Kill | Completion | Total/Wave |
|---:|---:|---:|---:|
| 1 | 133 | 67 | 200 |
| 3 | 333 | 167 | 500 |
| 5 | 433 | 217 | 650 |
| 7 | 533 | 267 | 800 |
| 10 (Boss) | 933 | 467 | 1.400 |
| 15 | 3.000 | 1.500 | 4.500 |
| 20 (Boss) | 12.000 | 6.000 | 18.000 |
| 30 (Boss) | 120.000 | 60.000 | 180.000 |

**Ziel:** 1 neuer Tower alle 2–3 Waves, Upgrades alle 3–4 Waves. Das Budget ist
gegen einen W30-Vollausbau gerechnet (jeder Tower 1×, Archer 3×, alle
Upgrade-Tracks L20, alle Forschungen, RC Lv 3). Gesetzt wurde es mit ~25 %
Puffer. Seit den degressiven Upgrade-Kurven (Range endet bei L10) kostet dieser
Ausbau 431.542 statt 632.834 Gold, der Puffer lag bei 83 %. Seit dem Chaos
Tower (2026-09-12) gehört er mit L20 und seiner Forschung zum Roster (+37.160),
Summe 468.702 Gold, Puffer 69 %. Bewusst erst nach
dem Playtest nachsteuern (BALANCE_PROPOSAL_2026-09 §2.5); den Stand zeigt
`npm run economy-chart` im Abschnitt „Design-Roster vs. Curriculum-Budget".

### 5.4 Anti-Snowball / Catch-Up
- **Perfect-Bonus gedeckelt (35%)**
- **Combo-Bonus max +30%** (+5% pro Perfect-Streak-Wave)
- **Comeback-Bonus:** `min(15, HP_Lost * 0.3)` pro Wave

### 5.5 Schwierigkeits-Knoepfe (post-Director)

Drei Groessen skalieren die Schwierigkeit **nach** der Entscheidung des Wave
Directors. Sie sind Design-Parameter, keine gelernten Werte:

| Knopf | Wo | Kurve |
|---|---|---|
| `endgameHpMultiplier(wave)` | `wave-curriculum.config.ts` | 1.0× bis W20, danach +5%/Wave, Cap 4.0× (W30 ≈ 1.5×, W50 ≈ 2.5×) |
| `enemyBaseDamageForWave(wave)` | `wave-curriculum.config.ts` | HP-Verlust pro Durchkommen: 1 (W1–10), 2 (W11–20), 3 (W21–30), … |
| `maxLeakDamagePerWave` | `game-balance.config.ts` | **18** — Obergrenze dessen, was eine einzelne Welle kostet |

Der Leck-Cap ist die wichtigste der drei. Der Spieler hat 100 Start-HP und
**heilt nie**; ab W91 kostet ein einzelnes Durchkommen 10 HP. Ohne Cap kann eine
schlecht gekonterte Welle (Ghost-Swarm gegen ein Roster ohne Magic) 30–50 HP
nehmen und den Run beenden, ohne dass der Spieler noch etwas haette tun koennen.
Der Cap macht aus der Todesspirale eine Todesschraege: eine katastrophale Welle
ist ein schwerer, aber ueberlebbarer Treffer.

---

## 6. Forschungszentrum & Tech-Tree

> **Ersetzt das alte HQ-Level-Konzept.** Das Forschungszentrum ist ein platzierbares Gebaeude
> das als einziges Progressionssystem Tower, Perks und Upgrade-Tiers freischaltet.

### 6.1 Forschungszentrum (Gebaeude)

| Eigenschaft | Wert |
|---|---|
| **Typ** | Platzierbares Gebaeude (wie ein Tower) |
| **Kosten** | 75 Credits |
| **Verfuegbar** | Sofort (ab Spielstart) |
| **Anzahl** | Genau eines erlaubt |
| **Angriff** | Keiner (passives Gebaeude) |
| **Zerstoerbar** | Nein (wie alle Tower) |
| **Verkaufbar** | Nein |
| **Platzierung** | Gleiche Mechanik wie Tower (nimmt Tower-Slot ein) |

**Level-Upgrades:**
| Level | Upgrade-Kosten | Research-Slots | Beschreibung |
|---:|---:|---:|---|
| **1** | — (Basis) | 1 | Basic Research |
| **2** | 120 | 2 | Expanded Research |
| **3** | 220 | 3 | Advanced Research |

### 6.2 Forschungsmechanik

- **Kosten:** Jede Forschung kostet Credits (abgezogen bei Start)
- **Dauer:** Echtzeit-Countdown (laeuft auch zwischen Waves)
- **Slots:** Pro Slot eine parallele Forschung. Mehr Slots = mehr gleichzeitige Forschungen
- **Abbruch:** Moeglich, 50% der Credits werden erstattet
- **Start-Tower:** **Nur Archer** ist von Anfang an verfuegbar. Alle anderen Tower muessen erforscht werden

### 6.3 Tech-Tree (Forschungsbaum)

Frei waehlbar mit Voraussetzungen (Directed Acyclic Graph).
Drei Kategorien: **Tower-Unlock**, **Global Perk**, **Upgrade-Tier**.

#### Tower-Unlocks

**Tier 0 (keine Voraussetzungen):**
| ID | Name | Kosten | Dauer | Schaltet frei |
|---|---|---:|---:|---|
| `gatling-tech` | Gatling Technology | 40 | 15s | Dual-Gatling |
| `ice-magic` | Ice Magic | 40 | 15s | Ice Tower |
| `tentacle-biology` | Tentacle Biology | 45 | 15s | Tentacle |
| `toxic-compounds` | Toxic Compounds | 45 | 15s | Poison Tower |

**Tier 1 (mit Voraussetzungen):**
| ID | Name | Kosten | Dauer | Prereq | Schaltet frei |
|---|---|---:|---:|---|---|
| `siege-engineering` | Siege Engineering | 60 | 20s | Gatling Tech | Cannon |
| `fire-alchemy` | Fire Alchemy | 55 | 20s | Toxic Compounds | Fire Tower |
| `arcane-studies` | Arcane Studies | 65 | 20s | Ice Magic | Magic Tower |

**Tier 2:**
| ID | Name | Kosten | Dauer | Prereq | Schaltet frei |
|---|---|---:|---:|---|---|
| `rocketry` | Rocketry | 80 | 25s | Siege Engineering | Rocket Tower |

**Tier 3** (Werte aus `research-tree.config.ts`, Stand 2026-09-12; die Tabellen
darüber zeigen noch die Startwerte, die Config ist inzwischen um etwa das
Zehnfache teurer):
| ID | Name | Kosten | Dauer | Prereq | Schaltet frei |
|---|---|---:|---:|---|---|
| `chaos-rift` | Chaos Rift | 1.000 | 30s | Siege Engineering + Storm Mastery | Chaos Tower |

#### Global Perks
| ID | Name | Kosten | Dauer | Prereq | Effekt |
|---|---|---:|---:|---|---|
| `aa-retrofit` | AA Retrofit | 70 | 20s | Rocketry | Archer + Gatling erhalten Air-Targeting |

#### Upgrade-Tier-Freischaltungen
| ID | Name | Kosten | Dauer | Prereq | Effekt |
|---|---|---:|---:|---|---|
| `advanced-weaponry` | Advanced Weaponry | 100 | 30s | 3 Tower-Unlocks | T2-Upgrades verfuegbar |
| `master-engineering` | Master Engineering | 180 | 45s | Advanced Weaponry | T3-Upgrades verfuegbar |

### 6.4 UI im Forschungszentrum

Wenn das Forschungszentrum selektiert ist, zeigt die Sidebar:
- **Gebaeude-Level** mit Upgrade-Button und Kosten
- **Aktive Forschungen** mit Fortschrittsbalken und verbleibender Zeit
- **Tech-Tree** gruppiert nach Kategorie:
  - Abgeschlossen: Gruener Haken
  - Verfuegbar: Gold-Rand, "Research"-Button mit Kosten
  - In Arbeit: Fortschrittsbalken + Cancel-Button
  - Gesperrt: Grau, Lock-Icon, Tooltip mit fehlenden Voraussetzungen

**Gesperrte Tower im Build-Panel:**
- Dunkle Silhouette mit Lock-Icon
- Tooltip: "Requires: [Forschungsname]"

### 6.5 Fairness-Regeln fuer den Wave Director

**Regel 1 — Mechanik-Gate: der Director darf neue Mechaniken erst einsetzen,
wenn der Spieler Zugriff darauf hatte.**
- Air-Waves nur wenn Anti-Air verfuegbar (Ice erforscht oder AA Retrofit)
- Ethereal nur wenn Magic/Ice erforscht
- Camo nur wenn Detection erforschbar

*Implementiert* als `requiresCapability` in der Template-Maske
(`getAvailableTemplateMask()`), zusammen mit `minWave` und der Boss-Kadenz.

**Regel 2 — Groessen-Gate: eine Welle darf nie groesser sein, als die
Verteidigung sie plausibel bekaempfen kann.** `fairMaxCount()` schaetzt aus
Defense-DPS, Kill-Throughput und Gegner-Stats die toetbare Menge und addiert
eine in HP bepreiste Leck-Toleranz (6% der Rest-HP). Gegen Boden-Gegner (außer
Ethereal) zählt jeder Tower dabei mit mindestens 0,6 seines Schadens
(`FAIRNESS_MATCHUP_FLOOR`): ein falsch zusammengestelltes Roster soll als Leck
spürbar werden, nicht als kleinere Welle. Ein Regelkreis
(`GateController`) korrigiert diese Schaetzung laufend anhand der tatsaechlichen
Leck-Quote — Zielband 8–16% der Welle.

Der Grund fuer Regel 2 ist gemessen: **ohne** den Regelkreis landet der Cap
genau auf „was die Tuerme toeten koennen", was garantiert, dass sie es toeten.
Ueber 1834 Wellen toeteten 70% der Wellen alles und 80% richteten keinen Schaden
an — und vier voellig verschiedene Wave-Designer (trainiertes Netz, Regeln,
Zufall) produzierten statistisch ununterscheidbare Runs, weil nicht der Designer,
sondern der Cap die Wellengroesse bestimmte. Mechanik siehe
[WAVE_SYSTEM.md](../WAVE_SYSTEM.md#fairness-cap-fairmaxcount).

---

## 7. Wave Pacing & Air Design

### 7.1 Air-Design (finale Entscheidung)
- **Air-Debuet bei Wave 7** (`bat_swarm`), Nachschlag W8 (`hornet_strike`) —
  so gepinnt in `WAVE_CURRICULUM`. Die frueher hier notierte Staffelung
  (Teaser ab W6, erste reine Air-Wave W8) ist vom Curriculum ueberholt.
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
- **Chaos** (Base, 1,0 gegen Light- und Heavy-Flieger, spät und teuer)

---

## 8. Wave Director Regeln

> **Stand 2026-09-07:** Der Director ist **regelbasiert und clientseitig**
> (`ai/core/rule-director.ts`). Das ONNX-Modell ist nicht mehr im Betriebspfad.
> Grund: gemessen ueber A/B-Runs mit identischen Bots, Curriculum und
> Fairness-Gate war das trainierte Netz dreimal statistisch ununterscheidbar
> von gleichverteiltem Zufall (mittlere Run-Laenge 45,6 gegen 44,7), waehrend
> zwei triviale Heuristiken messbar mehr Spannung erzeugten (Near-Miss 0,067
> gegen 0,045). Ursache lag vor dem Lernen: das Curriculum pinnt auf 49% der
> Wellen das Template, der Fairness-Cap bindet auf 63% der Wellen — es gab
> kaum etwas zu entscheiden.

### 8.1 Was der Director tatsaechlich entscheidet

Zwei Dinge, beide bewusst ohne Lernen:

- **Abwechslung wird erzwungen:** gewaehlt wird das *aelteste erlaubte*
  Template. Ein Reward-Term und ein Cooldown haben Wiederholung nur teuer
  gemacht — die Regel macht sie unmoeglich.
- **Schwierigkeit ist eine geschriebene Kurve** ueber die Wave-Nummer
  (count/hp hoch, Spawn-Delay runter, voll ab W60). Der Spieler heilt nie,
  seine HP sind ein Run-Budget — das schreibt man auf, statt es aus einem
  Skalar-Reward pro Welle zu erschliessen.

### 8.2 Counter-Logik (soft/hard)

| Ebene | Status |
|---|---|
| **Hard Counter** (Air, Ethereal) | **implementiert** — ueber `requiresCapability` in der Template-Maske, siehe 6.5 |
| **Soft Counter** (+20–30% Spawn-Rate eines Konters) | **nicht implementiert** — Design-Absicht |

### 8.3 Heuristik (Design-Absicht, nicht implementiert)

Der Regel-Director liest **keine** Spieler-Schwaechen; die folgende Tabelle
beschreibt eine geplante Erweiterung, kein aktuelles Verhalten:

| Spieler-Schwäche | AI-Antwort |
|---|---|
| Kein Siege | mehr Heavy/Fortified (soft) |
| Kein Magic/Ice | Ethereal-Teaser + Ghost-Check (hard einmalig) |
| Kein Anti-Air | keine Air, stattdessen Ground-Check |
| Nur Siege | Swarm + Light |

---

## 9. Visuelles Feedback
- **Damage Numbers**: Groesse/Farbe nach Effektivitaet (weak < 0,6 grau, normal rot, strong ≥ 1,2 orange, devastating ≥ 1,5 gold; `EFFECTIVENESS_THRESHOLDS`). Jede Paarung ≤ 0,5 erscheint grau und klein. Chaos (1,0) erscheint immer normal.
- **Armor-Icons** am HP-Bar-Rahmen.
- **DamageType Badge** im Tower-Stats-Panel (Icon + Label).
- **ArmorType Badge** im Wave-Preview (Icon + "Weak to X").
- **Ethereal**: lila/transparenter Shader.
- **Air-Alert**: rotes Air-Icon + Sound, 2 Waves vorher.

---

## 10. Progression Timeline (Wave-fuer-Wave)

> **Konsistenz-Check** — jede Einfuehrung entspricht Forschungs-Verfuegbarkeit, Economy und AI-Regeln.
> Spieler startet mit **nur Archer** + 100 Credits (`GAME_BALANCE.player.startCredits`).
> Forschungszentrum kostet 75 Credits.
>
> **Verbindlich ist `WAVE_CURRICULUM`** (`configs/wave-curriculum.config.ts`) —
> es pinnt Template und Gold-Budget fuer W1–W30. Die Liste unten ist die
> Design-Absicht dahinter und weicht an einzelnen Stellen ab (z.B. Air-Debuet
> W7 statt W8). Bei Abweichung gilt die Config.

**Wave 1**: Unarmored (Zombie/Rat). Nur Archer verfuegbar. Start-Credits 100.
**Wave 2**: Swarm-Pressure. Nach Wave 1 reicht es fuer Forschungszentrum (200 Gold aus W1). Erste Forschung starten (z.B. Gatling Tech, 15s).
**Wave 3**: Gatling/Ice sollte erforscht sein. Light Armor-Teaser (Wallsmasher). Zweite Forschung starten.
**Wave 4**: Mehr Tower verfuegbar. Upgrade-Entscheidungen.
**Wave 5**: Light-Wave, Ice-Slow relevant (falls erforscht).
**Wave 6**: **Teaser Air (1-2 Bats)**. Ice muss erforscht sein fuer Anti-Air. Siege/Magic-Forschung laeuft.
**Wave 7**: Heavy-Teaser (Zombie Soldier). Cannon/Magic sollte verfuegbar werden.
**Wave 8**: **Erste reine Air-Wave (fix)**. Anti-Air verfuegbar (Ice oder AA Retrofit).
**Wave 9**: Breather (leichter Ground).
**Wave 10**: Heavy-Check (Tank). Rocket-Forschung in Reichweite.
**Wave 11**: Mixed Ground + Air-Teaser.
**Wave 12**: **Air-Swarm** (Bats/Hornets). Rocket + Tentacle sollten erforscht sein.
**Wave 13**: Fortified-Teaser (Mammoth).
**Wave 14**: Heavy+Light Mixed.
**Wave 15**: **Hybrid Check** (Air + Heavy). Advanced Weaponry (T2) in Reichweite.
**Wave 16**: Breather.
**Wave 17**: Shielded-Teaser (Mech-lite).
**Wave 18**: Mini-Boss Ground (Herbert lite).
**Wave 19**: **Fortified-Wave**.
**Wave 20**: **Air-Elite** (1 Dragon). T2-Upgrades sollten verfuegbar sein.
**Wave 21**: Ethereal-Teaser (1 Ghost).
**Wave 22**: **Ethereal-Check** (Ghost-Wave, soft). Magic muss erforscht sein (1.75x vs Ethereal).
**Wave 23**: Mixed Ground + Ghost Escort.
**Wave 24**: Breather.
**Wave 25**: Air-Swarm + Ground Rush. Master Engineering (T3) in Reichweite.
**Wave 26**: Camo-Teaser (1-2 Spider) falls Detection erforschbar.
**Wave 27**: Heavy+Fortified Check.
**Wave 28**: **Air-Elite** (2 Dragons).
**Wave 29**: Mixed Ethereal + Heavy.
**Wave 30**: Final Boss (Lich) + Mixed.

---

## 11. Offene Entscheidungen
1. **Ghost-Visuals** (Asset final).
2. **Camo-Detection UI** (Radar-Icon vs. Tower-Halo).
3. **Exact DPS-Werte** je Tower fuer TargetCost-Validierung.
4. ~~**Poison-Schadenstyp**: eigener Typ oder Fire-Subtyp?~~ → **Entschieden: eigener Typ (Poison).**
5. **Endless-Scaling** (HP/Speed-Kurven nach Wave 30).
6. **Forschungszeiten balancen** — aktuelle Werte (15-45s) sind Startwerte, muessen getestet werden.
7. **Forschungskosten feintunen** — Economy-Kurve muss mit Research-Kosten abgestimmt werden.
8. **Forschungszentrum 3D-Model** — Asset muss erstellt werden (Placeholder vorerst).
9. **Status-Effekte Phase 2** — Armor Break, Mark, Stun als spaetere Erweiterung geplant.
