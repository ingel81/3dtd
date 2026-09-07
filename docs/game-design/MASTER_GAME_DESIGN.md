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

## 1. Design-Philosophie
- **Einfach zu lernen, schwer zu meistern**: klare Basisregeln + Veteranen-Tiefe (Matrix, Status, Flags).
- **Fairness vor Überraschung**: neue Mechaniken werden **geteasert**, harte Checks nur nach Verfügbarkeit von Countern.
- **Strategische Vielfalt**: mehrere gültige Antworten auf jede Bedrohung (kein Ein-Turm-Meta).
- **Lesbarkeit**: Icons, Farben, Damage-Feedback, Wave-Preview.
- **Progressive Komplexität**: neue Armor-Typen, Flags und Air werden schrittweise eingeführt.

---

## 2. Damage & Armor System (Matrix + Status + Flags)

### 2.1 Schadenstypen (8)
- **Physical (⚔️)**: solider Allrounder, fällt vs. Armor ab.
- **Pierce (🎯)**: hohe Feuerrate, Anti-Swarm.
- **Siege (💥)**: langsame AoE, Anti-Heavy/Fortified.
- **Magic (✨)**: Ethereal-Counter, Utility.
- **Fire (🔥)**: DoT/Burn, Anti-Regen.
- **Ice (❄️)**: Low-DPS, starker Slow/CC.
- **Poison (☠️)**: DoT-Spezialist, Anti-Regen, eigenstaendiger Schadenstyp.
- **Lightning (⚡)**: Hitscan-Chain (Primary + Jumps mit Falloff), starker Light-Bonus + Ethereal-Counter, schwach gegen Fortified.

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
Poison    ☠️       1.1×      1.1×     0.6×     0.6×        0.5×
Lightning ⚡       1.0×      1.25×    1.0×     0.6×        1.5×
```

> **Quelle der Wahrheit:** `src/app/configs/combat/damage-matrix.config.ts`. Bei
> Anpassungen dort gilt es, diese Tabelle synchron zu halten — die TypeScript-
> Mapped-Types erzwingen Vollständigkeit auf Code-Seite, nicht in der Doku.

**Interpretation:**
- **Ethereal** ist **hart, aber nicht unbesiegbar**. Magic/Ice/Lightning bleiben beste Konter, aber Notlösungen existieren.
- **Lightning** ist neben Magic der zweite glaubwürdige Ethereal-Counter (1.5×) — gleichzeitig stark gegen Light-Swarms (1.25×) dank Chain-Jumps, aber schwach gegen Fortified-Bossen (0.6×). Dort bleibt Cannon/Siege Pflicht.

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
| **Poison** | Poison | DoT-Projektil, Splash, Range 65 | 100 | nein |
| **Lightning** | Lightning | 35 dmg primary, Chain ×0.7/Jump, 2 Jumps, 0.8/s, Range 65 | 130 | **Air + Ground** |

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
- **True Damage 20%** (Armor-unabhaengig).

### 3.11 Poison — Poison
- DoT-Spezialist mit Splash-Projektil.
- Eigenstaendiger Schadenstyp (nicht Fire-Subtyp).
- Poison-DoT und Burn-DoT sind getrennte Effekte, koennen gleichzeitig wirken.

### 3.12 Lightning — Lightning
- **Chain-Hitscan** (`attackType: 'chain'`): Primary-Treffer + 2 Jumps, je `chainFalloff 0.7` (100% → 70% → 49%), `jumpRange 15m` zwischen Chain-Links.
- **Air + Ground** ab Basis — Anti-Air ohne Forschungspflicht.
- **Niche:** zweiter glaubwürdiger Ethereal-Counter (1.5×) und stark gegen Light-Swarms (1.25×, profitiert zusätzlich vom Chain-Pattern). **Schwach gegen Fortified** (0.6×) — Cannon/Siege bleibt der Pflichtbau gegen Mammoth/Stone-Golem.
- Visuell: dauerhaftes Idle-Crackle am Turm-Tip, additive Aufhell-Halos pro Hit (Workaround, weil Photorealistic 3D Tiles dynamische Lichter ignorieren).

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
Upgrade-Tracks L20, alle Forschungen, RC Lv 3) plus ~26% Puffer.

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
eine in HP bepreiste Leck-Toleranz (6% der Rest-HP). Ein Regelkreis
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
- **Damage Numbers**: Groesse/Farbe nach Effektivitaet (weak=grau, normal=rot, strong=orange, devastating=gold).
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
