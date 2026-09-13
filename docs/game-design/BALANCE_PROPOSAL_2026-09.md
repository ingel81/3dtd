# Balance-Vorschlag 2026-09: Upgrades, Cannon, Schadensmatrix, Boss-Takt

**Status:** Entwurf zur Entscheidung. Keine Config und kein Spielcode geändert.
**Stand:** 2026-09-11, Code-Stand `3338f4b`.
**Bezug:** TODO.md PRIO 2.1 (drei Punkte) und 2.2 (Boss-Frequenz ab W31).

Alle Zahlen sind aus den Configs und den Formeln im Code berechnet, nicht
gemessen. Es gab keinen Playtest und keinen Bot-Lauf mit den neuen Werten.
Rechenwege stehen jeweils dabei, Abschnitt 8 fasst sie zusammen.

---

## 0. Kurzfassung

1. **Upgrades:** Damage und Feuerrate behalten bis Stufe 15 ungefähr ihr
   heutiges Tempo, die Stufen 16 bis 25 (Tier 4 und 5) bringen nur noch 40 %
   des Zuwachses. Reichweite wird ein eigener Track mit 10 Stufen und maximal
   +34 %. Jeder Tower bekommt ein eigenes Damage/Rate-Verhältnis. L25 liefert
   damit das 5,3- bis 6,4-Fache der Basis-DPS statt des 14,5-Fachen, die
   Cannon kommt auf 94 m statt 213 m.
2. **Cannon:** Die Ursache ist nicht ein Wert, sondern dass die Cannon keine
   schwache Paarung hat und ihr Splash ungedeckelt ist. Vorschlag:
   Splash-Radius 10 → 6 m, höchstens 8 Splash-Ziele, Splash trifft nur, was
   der Tower auch anvisieren darf, `siege` gegen unarmored/light auf 0,5,
   Basisreichweite 80 → 70 m.
3. **Matrix:** Zielspreizung pro Rüstungsart von heute 1,5× bis 11,7× auf 3×
   bis 20×. Jede Schadensart bekommt mindestens eine Paarung ≤ 0,5, jede
   Rüstungsart mindestens zwei Konter ≥ 1,2. Damit das Fairness-Gate die
   Spreizung nicht wegrechnet, bekommt es eine Untergrenze für den
   Matchup-Faktor (0,6, außer bei Ethereal).
4. **Boss-Takt:** Ab W31 kommen heute praktisch keine Bosse mehr (0,7 pro
   100 Wellen, simuliert). Umsetzung über die Template-Maske, die an
   Boss-Wellen auf Boss-Templates kollabiert, plus zwei weitere
   Boss-Templates für Abwechslung.
5. **Reihenfolge:** erst vier Bugfixes, dann Matrix und Cannon zusammen, dann
   Upgrade-Kurven, dann Boss-Takt, zuletzt Gold nach dem Playtest.

---

## 1. Befund: Wie Upgrades heute funktionieren

**Mechanik.** Jeder Combat-Tower hat drei Tracks mit je 25 Stufen: Damage,
Fire Rate, Range (Fire: Damage, Range, Beam Width). Jede Stufe multipliziert
den aktuellen Wert (`tower.entity.ts:427-436`, `*=`), die Multiplikatoren
kompoundieren also. Standard: Damage ×1,05, Rate ×1,06, Range ×1,04
(`tower-types.config.ts:62-64`), Archer-Range ×1,02 (`:91`, `:137-145`).

**Kosten.** `50 × 1,25^Stufe` pro Stufe (`tower-types.config.ts:28-31`,
`:58-60`), für alle Tower gleich, unabhängig vom Basispreis. Ein Track kostet
kumuliert:

| bis Stufe | 5 | 10 | 15 | 20 | 25 |
|---|---:|---:|---:|---:|---:|
| Gold pro Track | 411 | 1.664 | 5.486 | 17.148 | 52.740 |

Die Stufen 21 bis 25 kosten pro Track 35.592 Gold, doppelt so viel wie die
Stufen 1 bis 20 zusammen, und bringen ×1,71 DPS.

**Gating.** Stufen werden in 5er-Bändern durch Forschung freigeschaltet
(`tower-types.config.ts:81-87`, durchgesetzt in
`TowerLifecycle.upgrade()`, `managers/game-state/tower-lifecycle.ts`): T2 Advanced Weaponry 800 Gold, T3 Master
Engineering 1.500, T4 Advanced Engineering 2.500, T5 Transcendent Tech 4.000
(`research-tree.config.ts:153-199`). Forschung erhöht keine Tower-Werte, sie
schaltet nur Tower, Air-Targeting und Tiers frei (`research.types.ts:27-31`).
Den Effekt `global-perk` benutzt keine Forschung. Außer `maxLevel` gibt es
keinen Cap.

**Faktoren bei gleichmäßigem Ausbau** (alle Tracks auf derselben Stufe):

| Stufe | Damage | Rate | Range | DPS |
|---|---:|---:|---:|---:|
| L10 | ×1,63 | ×1,79 | ×1,48 | ×2,92 |
| L15 | ×2,08 | ×2,40 | ×1,80 | ×4,98 |
| L20 | ×2,65 | ×3,21 | ×2,19 | ×8,51 |
| L25 | ×3,39 | ×4,29 | ×2,67 | ×14,53 |

Die Wirkung eines Towers wächst mit DPS mal Verweildauer der Gegner in
Reichweite, also ungefähr mit DPS × Range. Auf L25 sind das ×38,8.

**Nebenbefunde beim Nachrechnen:**

- **Fire: Range-Upgrade schadet.** Der Range-Track erhöht nur die
  Erfassungsreichweite (`tower.entity.ts:185`), die Flamme bleibt 20 m lang
  (`tower-types.config.ts:347`, `tower-combat.service.ts:411`). Getroffen wird
  bis zur Kegellänge plus 2 m (`tower-combat.service.ts:528`, `:556`). Schon
  auf Basis (25 m Erfassung) gibt es einen Ring, in dem der Tower zielt, aber
  nicht trifft. Auf L25 (67 m) zielt er mit der Strategie `first` bevorzugt
  genau auf die Gegner, die am weitesten vorne und damit oft außerhalb der
  Flamme sind.
- **Splash kennt keine Luft/Boden-Trennung.** `getEnemiesInRadius`
  (`global-route-grid.ts:1486-1534`) filtert nur nach 2D-Abstand. Die Cannon
  kann Luftziele nicht anvisieren, trifft Fledermäuse 15 m über dem Boden
  (`enemy-types.config.ts:274`) aber per Splash. Gilt auch für Ice und Poison
  (je 8 m, `projectile-types.config.ts:128`, `:207`).
- **Rocket hat keinen Splash**, zählt im Defense-Modell aber als
  Splash-Tower (`defense-analyzer.ts:45`, Kill-Durchsatz ×3 in `:121-126`).
  Umgekehrt haben Ice und Poison Splash, gelten dort aber nicht als solche.
- **Archer-Basiswerte weichen vom Master-Dokument ab:** Code 30 m und 45 Gold
  (`tower-types.config.ts:220`, `:224`), MASTER_GAME_DESIGN §3.1 nennt 60 m
  und 50 Gold. Auf L25 kommt der Archer heute auf 49 m.
- **Tentacle „+20 % True Damage“** (MASTER §3.1, §3.10) gibt es im Code
  nicht, Tentacle macht reinen `physical`-Schaden.
- **Herbert `immunityPercent: 100`** (`enemy-types.config.ts:354`) wird
  nirgends gelesen.
- **Tower-Stats-Chart** beschreibt die Kostenkurve als ×1,40 pro Stufe
  (`tools/tower-stats-chart/generate.spec.ts:248`, `:272`), gerechnet wird
  mit ×1,25.

---

## 2. Vorschlag A: Upgrade-Skalierung

### 2.1 Ziele

- L25 liefert das 5- bis 6,5-Fache der Basis-DPS (heute 14,5).
- Bis L15 bleibt das Spielgefühl nah am heutigen (−5 bis −25 % DPS), der
  Einschnitt liegt in Tier 4 und 5, wo der Playtest das Problem gesehen hat.
- Reichweite ist gedeckelt und für alle Tower gleich geregelt.
- Tower unterscheiden sich darin, ob sie über Schaden oder über Tempo
  wachsen.

### 2.2 Mechanik

- **Damage und Rate degressiv:** Stufe 1 bis 15 wirkt der tower-eigene
  Multiplikator `m`, Stufe 16 bis 25 nur noch `1 + 0,4 × (m − 1)`.
- **Range:** ein Track, 10 Stufen, ×1,03 pro Stufe, maximal ×1,344, für alle
  Tower. `ARCHER_RANGE_UPGRADE` entfällt.
- **Fire:** Der Range-Track verlängert Erfassung und Flamme im selben
  Verhältnis. Beam Width wird ebenfalls ein 10-Stufen-Track mit ×1,03
  (heute ×1,05 über 25 Stufen: 5 m → 16,9 m, neu maximal 6,7 m).
- **Kosten:** unverändert `50 × 1,25^Stufe`.

Variante ohne Code (nur Konstanten): Damage und Rate je ×1,035 über alle 25
Stufen ergäben L25 = ×5,59, aber schon L15 = ×2,81 statt heute ×4,98. Das
schwächt das Mid-Game um 44 % und ist deshalb nicht die Empfehlung.

### 2.3 Multiplikatoren pro Tower

| Tower | Damage L1-15 | Rate L1-15 | Damage L16-25 | Rate L16-25 | DPS-Faktor L25 | Begründung |
|---|---:|---:|---:|---:|---:|---|
| Archer | 1,05 | 1,04 | 1,020 | 1,016 | ×5,35 | Starttower, trifft Luft und Boden, im Design-Roster dreifach. Das Tempo machte ihn im Endausbau zum Dauerfeuer (4,29 Schuss/s) |
| Dual-Gatling | 1,04 | 1,06 | 1,016 | 1,024 | ×6,41 | Identität ist die Feuerrate, sie bestimmt den Kill-Durchsatz gegen Schwärme |
| Cannon | 1,07 | 1,02 | 1,028 | 1,008 | ×5,30 | schwere Einzelschüsse gegen Panzer. Niedrige Rate hält den Splash-Durchsatz klein |
| Magic | 1,05 | 1,05 | 1,020 | 1,020 | ×6,42 | ausgewogen |
| Rocket | 1,07 | 1,03 | 1,028 | 1,012 | ×6,38 | Anti-Drachen-Rolle: wenige schwere Treffer |
| Ice | 1,04 | 1,05 | 1,016 | 1,020 | ×5,35 | Nutzen ist die Verlangsamung, die Rate bestimmt die Abdeckung |
| Fire | 1,06 | (Beam Width 1,03, max L10) | 1,024 | | ×3,04 | Kegel trifft viele Ziele, die Breite war der versteckte Multiplikator |
| Tentacle | 1,07 | 1,03 | 1,028 | 1,012 | ×6,38 | Nahkampf, wenige harte Schläge |
| Poison | 1,05 | 1,04 | 1,020 | 1,016 | ×3,62 | DoT skaliert mit dem Damage-Track (`combat-effect.service.ts:134-137`) und stapelt nicht (`movement.component.ts:229-238`) |
| Lightning | 1,05 | 1,04 | 1,020 | 1,016 | ×5,35 | die Kette vervielfacht ohnehin (×2,19) |

### 2.4 Werte pro Tower vorher → nachher

Lesart: Stufe = alle Tracks auf dieser Stufe (neu: Range und Beam Width
höchstens L10). DPS = Einzelziel-DPS ohne Splash und Matrix: Schaden ×
Feuerrate, Lightning × 2,19 (Kettensumme 1 + 0,7 + 0,49,
`tower-types.config.ts:419-420`), Poison plus DoT 8/s × Damage-Faktor
(`game-balance.config.ts:51`), Fire = `damagePerSecond`. Gold = Basispreis
plus alle Upgrade-Kosten bis zu dieser Stufe. Ein Wert ohne Pfeil ist
unverändert.

**Archer** (Basis 25 Schaden, 1,0/s, 30 m, 45 Gold; `tower-types.config.ts:219-224`)

| Stufe | Schaden | Rate | Reichweite | DPS | Gold kumuliert |
|---|---|---|---|---|---|
| L0 | 25,0 | 1,00 | 30 | 25,0 | 45 |
| L1 | 26,3 | 1,06 → 1,04 | 31 | 27,8 → 27,3 | 195 |
| L5 | 31,9 | 1,34 → 1,22 | 33 → 35 | 42,7 → 38,8 | 1.278 |
| L10 | 40,7 | 1,79 → 1,48 | 37 → 40 | 72,9 → 60,3 | 5.037 |
| L15 | 52,0 | 2,40 → 1,80 | 40 | 124,6 → 93,6 | 16.503 → 12.681 |
| L20 | 66,3 → 57,4 | 3,21 → 1,95 | 45 → 40 | 212,7 → 111,9 | 51.489 → 36.005 |
| L25 | 84,7 → 63,4 | 4,29 → 2,11 | 49 → 40 | 363,3 → 133,7 | 158.265 → 107.189 |

**Dual-Gatling** (10, 5,0/s, 50 m, 90 Gold; `:245-249`)

| Stufe | Schaden | Rate | Reichweite | DPS | Gold kumuliert |
|---|---|---|---|---|---|
| L0 | 10,0 | 5,00 | 50 | 50,0 | 90 |
| L1 | 10,5 → 10,4 | 5,30 | 52 | 55,7 → 55,1 | 240 |
| L5 | 12,8 → 12,2 | 6,69 | 61 → 58 | 85,4 → 81,4 | 1.323 |
| L10 | 16,3 → 14,8 | 8,95 | 74 → 67 | 145,9 → 132,5 | 5.082 |
| L15 | 20,8 → 18,0 | 11,98 | 90 → 67 | 249,1 → 215,8 | 16.548 → 12.726 |
| L20 | 26,5 → 19,5 | 16,04 → 13,49 | 110 → 67 | 425,5 → 263,0 | 51.534 → 36.050 |
| L25 | 33,9 → 21,1 | 21,46 → 15,19 | 133 → 67 | 726,7 → 320,6 | 158.310 → 107.234 |

**Cannon** (55, 0,5/s, 80 m → neu 70 m, 150 Gold; `:263-267`)

| Stufe | Schaden | Rate | Reichweite | DPS | Gold kumuliert |
|---|---|---|---|---|---|
| L0 | 55,0 | 0,50 | 80 → 70 | 27,5 | 150 |
| L1 | 57,8 → 58,9 | 0,53 → 0,51 | 83 → 72 | 30,6 → 30,0 | 300 |
| L5 | 70,2 → 77,1 | 0,67 → 0,55 | 97 → 81 | 47,0 → 42,6 | 1.383 |
| L10 | 89,6 → 108,2 | 0,90 → 0,61 | 118 → 94 | 80,2 → 65,9 | 5.142 |
| L15 | 114,3 → 151,7 | 1,20 → 0,67 | 144 → 94 | 137,0 → 102,1 | 16.608 → 12.786 |
| L20 | 145,9 → 174,2 | 1,60 → 0,70 | 175 → 94 | 234,0 → 122,0 | 51.594 → 36.110 |
| L25 | 186,2 → 200,0 | 2,15 → 0,73 | 213 → 94 | 399,7 → 145,8 | 158.370 → 107.294 |

**Magic** (40, 1,5/s, 70 m, 140 Gold; `:281-285`)

| Stufe | Schaden | Rate | Reichweite | DPS | Gold kumuliert |
|---|---|---|---|---|---|
| L0 | 40,0 | 1,50 | 70 | 60,0 | 140 |
| L1 | 42,0 | 1,59 → 1,58 | 73 → 72 | 66,8 → 66,2 | 290 |
| L5 | 51,1 | 2,01 → 1,91 | 85 → 81 | 102,5 → 97,7 | 1.373 |
| L10 | 65,2 | 2,69 → 2,44 | 104 → 94 | 175,0 → 159,2 | 5.132 |
| L15 | 83,2 | 3,59 → 3,12 | 126 → 94 | 298,9 → 259,3 | 16.598 → 12.776 |
| L20 | 106,1 → 91,8 | 4,81 → 3,44 | 153 → 94 | 510,6 → 316,1 | 51.584 → 36.100 |
| L25 | 135,5 → 101,4 | 6,44 → 3,80 | 187 → 94 | 872,0 → 385,3 | 158.360 → 107.284 |

**Rocket** (40, 0,5/s, 100 m, 120 Gold, nur Luft; `:299-305`)

| Stufe | Schaden | Rate | Reichweite | DPS | Gold kumuliert |
|---|---|---|---|---|---|
| L0 | 40,0 | 0,50 | 100 | 20,0 | 120 |
| L1 | 42,0 → 42,8 | 0,53 → 0,52 | 104 → 103 | 22,3 → 22,0 | 270 |
| L5 | 51,1 → 56,1 | 0,67 → 0,58 | 122 → 116 | 34,2 → 32,5 | 1.353 |
| L10 | 65,2 → 78,7 | 0,90 → 0,67 | 148 → 134 | 58,3 → 52,9 | 5.112 |
| L15 | 83,2 → 110,4 | 1,20 → 0,78 | 180 → 134 | 99,6 → 86,0 | 16.578 → 12.756 |
| L20 | 106,1 → 126,7 | 1,60 → 0,83 | 219 → 134 | 170,2 → 104,8 | 51.564 → 36.080 |
| L25 | 135,5 → 145,5 | 2,15 → 0,88 | 267 → 134 | 290,7 → 127,7 | 158.340 → 107.264 |

**Ice** (5, 0,33/s, 60 m, 90 Gold, Slow 50 % für 3 s; `:320-324`, `game-balance.config.ts:42-46`)

| Stufe | Schaden | Rate | Reichweite | DPS | Gold kumuliert |
|---|---|---|---|---|---|
| L0 | 5,0 | 0,33 | 60 | 1,7 | 90 |
| L1 | 5,3 → 5,2 | 0,35 | 62 | 1,8 | 240 |
| L5 | 6,4 → 6,1 | 0,44 → 0,42 | 73 → 70 | 2,8 → 2,6 | 1.323 |
| L10 | 8,1 → 7,4 | 0,59 → 0,54 | 89 → 81 | 4,8 → 4,0 | 5.082 |
| L15 | 10,4 → 9,0 | 0,79 → 0,69 | 108 → 81 | 8,2 → 6,2 | 16.548 → 12.726 |
| L20 | 13,3 → 9,7 | 1,06 → 0,76 | 131 → 81 | 14,0 → 7,4 | 51.534 → 36.050 |
| L25 | 16,9 → 10,6 | 1,42 → 0,84 | 160 → 81 | 24,0 → 8,8 | 158.310 → 107.234 |

**Fire** (35 DPS im Kegel, Erfassung 25 m, Flamme 20 m, 110 Gold; `:345-352`)

Schaden = DPS. Neu verlängert der Range-Track auch die Flamme: 20 m → 26,9 m auf L10.

| Stufe | DPS | Erfassung | Gold kumuliert |
|---|---|---|---|
| L0 | 35,0 | 25 | 110 |
| L1 | 36,8 → 37,1 | 26 | 260 |
| L5 | 44,7 → 46,8 | 30 → 29 | 1.343 |
| L10 | 57,0 → 62,7 | 37 → 34 | 5.102 |
| L15 | 72,8 → 83,9 | 45 → 34 | 16.568 → 8.924 |
| L20 | 92,9 → 94,4 | 55 → 34 | 51.554 → 20.586 |
| L25 | 118,5 → 106,3 | 67 → 34 | 158.330 → 56.178 |

**Tentacle** (30, 1,5/s, 25 m, 80 Gold; `:372-378`)

| Stufe | Schaden | Rate | Reichweite | DPS | Gold kumuliert |
|---|---|---|---|---|---|
| L0 | 30,0 | 1,50 | 25 | 45,0 | 80 |
| L1 | 31,5 → 32,1 | 1,59 → 1,55 | 26 | 50,1 → 49,6 | 230 |
| L5 | 38,3 → 42,1 | 2,01 → 1,74 | 30 → 29 | 76,9 → 73,2 | 1.313 |
| L10 | 48,9 → 59,0 | 2,69 → 2,02 | 37 → 34 | 131,3 → 119,0 | 5.072 |
| L15 | 62,4 → 82,8 | 3,59 → 2,34 | 45 → 34 | 224,2 → 193,4 | 16.538 → 12.716 |
| L20 | 79,6 → 95,0 | 4,81 → 2,48 | 55 → 34 | 382,9 → 235,7 | 51.524 → 36.040 |
| L25 | 101,6 → 109,1 | 6,44 → 2,63 | 67 → 34 | 654,0 → 287,3 | 158.300 → 107.224 |

**Poison** (5 + DoT 8/s für 4 s, 1,0/s, 55 m, 100 Gold; `:392-396`)

| Stufe | Schaden | Rate | Reichweite | DPS inkl. DoT | Gold kumuliert |
|---|---|---|---|---|---|
| L0 | 5,0 | 1,00 | 55 | 13,0 | 100 |
| L1 | 5,3 | 1,06 → 1,04 | 57 | 14,0 → 13,9 | 250 |
| L5 | 6,4 | 1,34 → 1,22 | 67 → 64 | 18,8 → 18,0 | 1.333 |
| L10 | 8,1 | 1,79 → 1,48 | 81 → 74 | 27,6 → 25,1 | 5.092 |
| L15 | 10,4 | 2,40 → 1,80 | 99 → 74 | 41,5 → 35,4 | 16.558 → 12.736 |
| L20 | 13,3 → 11,5 | 3,21 → 1,95 | 121 → 74 | 63,8 → 40,7 | 51.544 → 36.060 |
| L25 | 16,9 → 12,7 | 4,29 → 2,11 | 147 → 74 | 99,8 → 47,0 | 158.320 → 107.244 |

**Lightning** (35 primär, 2 Sprünge × 0,7, 0,8/s, 65 m, 130 Gold; `:413-423`)

| Stufe | Schaden | Rate | Reichweite | DPS | Gold kumuliert |
|---|---|---|---|---|---|
| L0 | 35,0 | 0,80 | 65 | 61,3 | 130 |
| L1 | 36,8 | 0,85 → 0,83 | 68 → 67 | 68,2 → 67,0 | 280 |
| L5 | 44,7 | 1,07 → 0,97 | 79 → 75 | 104,7 → 95,2 | 1.363 |
| L10 | 57,0 | 1,43 → 1,18 | 96 → 87 | 178,9 → 147,9 | 5.122 |
| L15 | 72,8 | 1,92 → 1,44 | 117 → 87 | 305,5 → 229,6 | 16.588 → 12.766 |
| L20 | 92,9 → 80,3 | 2,57 → 1,56 | 142 → 87 | 521,8 → 274,4 | 51.574 → 36.090 |
| L25 | 118,5 → 88,7 | 3,43 → 1,69 | 173 → 87 | 891,2 → 328,0 | 158.350 → 107.274 |

### 2.5 Folge für die Economy

Die Range-Tracks enden bei L10 und kosten dann 1.664 statt 17.148 (L20)
Gold. Rechnung für den Ausbau, gegen den das Curriculum budgetiert ist
(`wave-curriculum.config.ts:39-44`: jeder Tower einmal, Archer dreimal, alle
Tracks L20, alle Forschungen, Research Center Stufe 3):

| Posten | heute | neu |
|---|---:|---:|
| 12 Tower inkl. Upgrades L20 | 618.473 | 417.181 |
| Forschung (Summe `research-tree.config.ts`) | 13.950 | 13.950 |
| Research Center 75 + 120 + 216 (`tower-types.config.ts:445-452`) | 411 | 411 |
| **Summe** | **632.834** | **431.542** |
| Curriculum W1-30 (`wave-curriculum.config.ts:45-74`) | 791.000 | 791.000 |
| Puffer | 25 % | 83 % |

Etwa 200.000 Gold bis W30 werden frei. Die Spieler kaufen davon mehr Tower,
das Fairness-Gate und der Gate-Controller vergrößern die Wellen
entsprechend. Empfehlung: für den ersten Playtest nicht nachsteuern, aber
messen. Wenn Spieler W30 mit mehr als 150.000 unverbrauchtem Gold oder mehr
als 20 Towern erreichen, `goldKill`/`goldComplete` für W16 bis W30 um 20 %
senken.

Nebenbei: Der Kommentar in `wave-curriculum.config.ts:342-346` beziffert das
Design-Roster mit „alle Tracks maxed“ auf 1,39 Mio. Gold. Nachgerechnet
kostet es mit L25 1,90 Mio., mit L20 0,63 Mio.

---

## 3. Vorschlag B: Cannon

### 3.1 Befund

Werte: 55 Schaden `siege`, 0,5 Schuss/s, 80 m, 150 Gold
(`tower-types.config.ts:262-267`). Geschoss `cannonball` mit 50 m/s,
Splash-Radius 10 m, linearer Abfall `1 − d/R`, abgerundet
(`projectile-types.config.ts:68-74`, `combat-effect.service.ts:176-185`).
Kein Zielcap, kein Luft/Boden-Filter, Detonation auch bei verlorenem Ziel
(`combat-effect.service.ts:148-155`).

**Splash im Pulk.** Stehen Gegner im Abstand `s` hintereinander auf der
Route, ist der Schaden eines Schusses in Volltreffer-Äquivalenten
`1 + Σ (1 − k·s/R)` über alle `k` mit `k·s < R`. Weil die Cannon auf `first`
steht (`tower-types.config.ts:255`), sitzt der Einschlag an der Pulkspitze:
nur die Gegner dahinter zählen (einseitig). Mitten im Pulk, etwa wenn die
Spitze schon tot ist, zählen beide Seiten.

| Radius | s = 1 m | s = 2 m | s = 3 m | s = 5 m |
|---|---|---|---|---|
| 10 m, einseitig / beidseitig | 5,5 / 10,0 | 3,0 / 5,0 | 2,2 / 3,4 | 1,5 / 2,0 |
| 8 m | 4,5 / 8,0 | 2,5 / 4,0 | 1,9 / 2,8 | 1,4 / 1,8 |
| 6 m | 3,5 / 6,0 | 2,0 / 3,0 | 1,5 / 2,0 | 1,2 / 1,3 |
| 6 m, max. 8 Ziele | 3,5 / 5,7 | 2,0 / 3,0 | 1,5 / 2,0 | 1,2 / 1,3 |

**Welche Abstände real vorkommen:** `s = Tempo × Spawn-Delay` pro Pfad. W2
`rat_tide`: `spawnFactor ≈ 0,55 − 0,25 × 2/60 = 0,54` (`rule-director.ts:88`),
Delay `10 + 190 × 0,54 ≈ 113 ms` (`templates.ts:64`), Ratten 10 m/s
(`enemy-types.config.ts:406`), also 1,1 m. Ab W60 fällt der Faktor auf 0,30,
das Delay auf 67 ms, `s` auf 0,7 m. Der Wave-Duration-Cap komprimiert große
Wellen zusätzlich (`wave-director.service.ts:475-485`). Verteilen sich die
Gegner auf mehrere Spawnpunkte, wird `s` pro Pfad größer, am Zusammenlauf vor
dem HQ wieder kleiner. Abstände zwischen 0,5 und 3 m sind der Normalfall.

**Das KI-Modell unterschätzt das.** `computeTowerDPS` rechnet Splash
pauschal als ×2 (`tower-dps.util.ts:19-21`, `:107-116`), der Kill-Durchsatz
als 3 Ziele pro Schuss (`defense-analyzer.ts:32`, `:121-126`). Real sind es
im Pulk 3 bis 10.

**Vergleich im Pulk** (Basisstufe, `s = 2 m`, einseitig, Matrix
angewendet, in Klammern DPS pro Gold):

| heute | unarmored | light | heavy | fortified | ethereal |
|---|---|---|---|---|---|
| Archer | 25 (0,56) | 25 (0,56) | 17,5 (0,39) | 12,5 (0,28) | 3,8 (0,08) |
| Dual-Gatling | 60 (0,67) | 65 (0,72) | 25 (0,28) | 30 (0,33) | 7,5 (0,08) |
| **Cannon** | **66 (0,44)** | 57,8 (0,38) | **123,8 (0,83)** | **103,1 (0,69)** | 61,9 (0,41) |
| Magic | 60 (0,43) | 60 (0,43) | 51 (0,36) | 45 (0,32) | 105 (0,75) |
| Lightning | 61,3 (0,47) | 76,7 (0,59) | 61,3 (0,47) | 36,8 (0,28) | 92 (0,71) |

### 3.2 Ursachen, nach Gewicht

1. **Keine schwache Paarung.** `siege` liegt bei 0,8 / 0,7 / 1,5 / 1,25 /
   0,75 (`damage-matrix.config.ts:25`). Unter den fünf verglichenen Towern
   ist die Cannon pro Tower in drei von fünf Spalten die stärkste und in den
   anderen beiden die drittstärkste, gegen Ethereal im Pulk also noch vor
   Archer und Gatling.
2. **Splash ohne Cap.** 10 m Radius ergeben im Pulk das 3- bis 10-Fache.
3. **Reichweite.** 80 m ist die zweithöchste Basisreichweite, auf L25
   213 m.
4. **Splash trifft Luft**, obwohl die Cannon Luft nicht anvisieren kann.
5. **Der Preis bremst nicht.** Bis W9 hat der Spieler 4.800 Gold eingenommen
   (100 Start, `game-balance.config.ts:13`, plus W1-8 aus
   `wave-curriculum.config.ts:45-52`). Cannon samt Forschung (75 + 400 + 500 +
   150) kostet 1.125.

Pro Gold ist die Cannon gegen unarmored nicht vorne. Der Playtest nimmt aber
Tower pro Bauplatz wahr: Bauplätze sind durch Mindestabstände und
Sichtlinien knapp (`placement.config.ts:10-22`).

### 3.3 Vorschlag

| Hebel | heute | neu | Datei |
|---|---|---|---|
| Splash-Radius | 10 m | 6 m | `projectile-types.config.ts:73` |
| Splash-Ziele | unbegrenzt | höchstens 8, nächste zuerst | neues Feld `splashMaxTargets`, Umsetzung `combat-effect.service.ts:170-186` |
| Splash-Ziele Luft/Boden | alle | nur was der Quell-Tower anvisieren darf | `combat-effect.service.ts:178` |
| `siege` gegen unarmored / light | 0,8 / 0,7 | 0,5 / 0,5 | Abschnitt 4 |
| `siege` gegen heavy / fortified / ethereal | 1,5 / 1,25 / 0,75 | 1,75 / 1,6 / 0,3 | Abschnitt 4 |
| Basisreichweite | 80 m | 70 m | `tower-types.config.ts:264` |
| Upgrades | Standard | Damage 1,07, Rate 1,02, Range max L10 (94 m) | Abschnitt 2 |
| Preis | 150 | 150 | |

Ergebnis im selben Pulk-Szenario (Radius 6 m, max. 8 Ziele, neue Matrix):

| neu | unarmored | light | heavy | fortified | ethereal |
|---|---|---|---|---|---|
| Archer | 25 (0,56) | 25 (0,56) | 12,5 (0,28) | 7,5 (0,17) | 2,5 (0,06) |
| Dual-Gatling | 62,5 (0,69) | 80 (0,89) | 17,5 (0,19) | 12,5 (0,14) | 5 (0,06) |
| **Cannon** | 27,5 (0,18) | 27,5 (0,18) | **96,3 (0,64)** | **88 (0,59)** | 16,5 (0,11) |
| Magic | 54 (0,39) | 30 (0,21) | 54 (0,39) | 78 (0,56) | 120 (0,86) |
| Lightning | 61,3 (0,47) | 92 (0,71) | 73,6 (0,57) | 18,4 (0,14) | 92 (0,71) |

Die Cannon bleibt der Tower gegen heavy und fortified, gegen weiche Pulks und
Geister beißt sie sich die Zähne aus.

**Verworfen:** nur den Preis erhöhen (verschiebt die Dominanz um ein, zwei
Wellen), nur den Schaden senken (schwächt genau die gewollte Rolle), nur die
Matrix ändern (10 m Radius lässt den Pulk-Faktor bei 3 bis 10).

**Mitziehen im KI-Modell:** Der Splash-Faktor in `tower-dps.util.ts:113-115`
ergibt bei 6 m automatisch ×1,6. Den Rocket-Eintrag in `defense-analyzer.ts:45`
auf `{}` setzen, Ice und Poison dort als Splash führen, damit Modell und
Spiel dasselbe meinen.

---

## 4. Vorschlag C: Schadensmatrix

### 4.1 Befund

Spreizung heute pro Rüstungsart (`damage-matrix.config.ts:22-31`):

| Rüstung | Spanne | bester / schlechtester |
|---|---|---:|
| unarmored | 0,8 bis 1,2 | 1,5 |
| light | 0,7 bis 1,3 | 1,9 |
| heavy | 0,5 bis 1,5 | 3,0 |
| fortified | 0,5 bis 1,25 | 2,5 |
| ethereal | 0,15 bis 1,75 | 11,7 |

Sechs von acht Schadensarten haben keine Paarung unter 0,5. Die Cannon hat
keine unter 0,7 (siehe 3.2).

### 4.2 Regeln für die neue Matrix

1. **Zielspreizung:** unarmored und light etwa 3×, heavy 5×, fortified 6×,
   ethereal 20×. Unarmored bleibt die gutmütigste Spalte, weil W1 bis W3 nur
   mit dem Archer gespielt werden (Start nur Archer,
   `research.manager.ts:79-81`).
2. **Jede Schadensart hat mindestens eine Paarung ≤ 0,5.** Dort beißt sich
   der Tower die Zähne aus.
3. **Jede Schadensart außer `physical` hat mindestens eine Paarung ≥ 1,3.**
   `physical` bleibt der Allrounder ohne Stärke, er ist der Starttower.
4. **Jede Rüstungsart hat mindestens zwei Konter ≥ 1,2,** und beide sind
   erforschbar, bevor das Curriculum die Rüstung zum ersten Mal schickt
   (unarmored W1, light W4, heavy W9, fortified W10, ethereal W13;
   `wave-curriculum.config.ts:45-57`).

### 4.3 Neue Matrix

| | unarmored | light | heavy | fortified | ethereal |
|---|---:|---:|---:|---:|---:|
| physical | 1,0 | 1,0 | **0,5** ← 0,7 | **0,3** ← 0,5 | **0,1** ← 0,15 |
| pierce | 1,25 ← 1,2 | **1,6** ← 1,3 | **0,35** ← 0,5 | **0,25** ← 0,6 | **0,1** ← 0,15 |
| siege | **0,5** ← 0,8 | **0,5** ← 0,7 | **1,75** ← 1,5 | **1,6** ← 1,25 | **0,3** ← 0,75 |
| magic | 0,9 ← 1,0 | **0,5** ← 1,0 | 0,9 ← 0,85 | **1,3** ← 0,75 | **2,0** ← 1,75 |
| fire | **1,5** ← 1,15 | 1,2 ← 1,0 | 0,6 ← 0,9 | **0,25** ← 0,6 | **0,1** ← 0,15 |
| ice | 1,0 | 1,3 ← 1,2 | 0,8 ← 1,0 | **0,5** ← 0,75 | 1,5 |
| poison | **1,4** ← 1,1 | 1,2 ← 1,1 | **0,4** ← 0,6 | **0,3** ← 0,6 | **0,2** ← 0,5 |
| lightning | 1,0 | 1,5 ← 1,25 | 1,2 ← 1,0 | **0,3** ← 0,6 | 1,5 |

Neue Spreizung: unarmored 0,5 bis 1,5 (3,0×), light 0,5 bis 1,6 (3,2×),
heavy 0,35 bis 1,75 (5,0×), fortified 0,25 bis 1,6 (6,4×), ethereal 0,1 bis
2,0 (20×).

**Begründung pro Zeile:**

- **physical** (Archer, Tentacle): Allrounder gegen weiche Ziele, prallt an
  Panzerung ab. Der Archer bleibt auf Luft und Boden nützlich, verliert aber
  seine Rolle als Alles-Tower im Endausbau.
- **pierce** (Dual-Gatling): Schwarm- und Flinkkiller, gegen light der beste
  Tower im Spiel. Gegen Stein und Stahl nutzlos.
- **siege** (Cannon, Rocket): reiner Panzerknacker. Gegen weiche und schnelle
  Ziele verschwendet, Geister fliegen durch.
- **magic** (Magic): bester Ethereal-Konter, zweiter Konter gegen fortified
  (Runen gegen Stein). Flinke Ziele (Spinne, Wallsmasher, Fledermaus,
  Hornisse) weichen den Geschossen aus.
- **fire** (Fire): verbrennt Fleisch, gegen Stein und Geister wirkungslos.
- **ice** (Ice): bleibt Utility und Ethereal-Konter, der Schaden (5) macht
  die Zeile ohnehin klein. Gefroren splittert Stein nicht.
- **poison** (Poison): DoT gegen Lebendes, gegen Rüstung, Stein und Geister
  schwach.
- **lightning** (Lightning): Kette gegen Schwärme und Geister. Neu 1,2 gegen
  heavy, weil Metall leitet (Tank, Mech, Zombie Soldier). Damit ist Lightning
  neben der Rocket der zweite Anti-Drachen-Tower. Gegen Stein wirkungslos.

**Konter pro Rüstung (Regel 4):**

| Rüstung | Konter ≥ 1,2 | erforschbar ab |
|---|---|---|
| unarmored | fire 1,5 · poison 1,4 · pierce 1,25 | W1 (Tier-0/1-Forschung) |
| light | pierce 1,6 · lightning 1,5 · ice 1,3 · fire 1,2 · poison 1,2 | W1 |
| heavy | siege 1,75 · lightning 1,2 | Cannon über Gatling Tech + Siege Engineering (900 Gold), Lightning über drei Forschungen (1.750 Gold) |
| fortified | siege 1,6 · magic 1,3 | wie oben, Magic über Ice Magic + Arcane Studies (1.050 Gold) |
| ethereal | magic 2,0 · ice 1,5 · lightning 1,5 | Ice ab W1 (400 Gold) |

Für Luftgegner gilt: light-Luft (Fledermaus, Hornisse) kontern Gatling mit
AA Retrofit (1,6), Lightning (1,5) und Ice (1,3). Heavy-Luft (Drache) kontern
Rocket (1,75) und Lightning (1,2). Die Rocket wird damit gegen Schwärme
schwach (0,5), siehe offene Entscheidung 1.

### 4.4 Schadenszahlen-Farben

`EFFECTIVENESS_THRESHOLDS` (`damage-matrix.config.ts:39-46`): `weak` von
< 0,7 auf < 0,6, `strong` ≥ 1,2 und `devastating` ≥ 1,5 bleiben. Damit ist
jede Paarung ≤ 0,5 grau und klein, 0,6 bis unter 1,2 normal.

Optional ein fünfter Tier `resisted` für ≤ 0,3 (dunkelgrau, Skalierung 0,45
statt 0,55). Er macht das „Zähne ausbeißen“ im Kampf sichtbar. Aufwand S:
Typ `DamageEffectiveness` in `combat.types.ts`, `getEffectiveness`, Farben und
Skalen in `damage-matrix.config.ts:49-77`.

Die Sidebar rechnet mit eigenen, hart codierten Schwellen
(`components/game-sidebar/sidebar-tooltips.ts:87` und `:139`, jeweils
`mul < 0.7`). Beide Stellen sollen `EFFECTIVENESS_THRESHOLDS` lesen.

### 4.5 Folgen für Wave-Director, Bots und Economy

**Capability-Gates.** `isAntiEtherealTower` gilt ab Ethereal-Multiplikator
1,0 (`defense-analyzer.ts:35`, `:296-300`). Magic, Ice und Lightning bleiben
darüber, alle anderen darunter: keine Änderung. Anti-Air hängt nicht an der
Matrix. Der Regel-Director liest die Matrix nicht (`rule-director.ts`).

**Fairness-Gate.** `fairMaxCount` rechnet mit `effectiveDPSPerArmor`, also
Tower-DPS × Matrix (`defense-analyzer.ts:325-355`, `templates.ts:455-460`).
Eine schlechte Paarung schrumpft die Welle, bis hinunter auf
`FAIRNESS_MIN_COUNT = 5` plus Leck-Toleranz (`templates.ts:396`, `:507-510`).
Die größere Spreizung würde also nicht zu harten Wellen führen, sondern zu
kleinen. Der Gate-Controller regelt anschließend auf 8 bis 16 % Leck
(`gate-controller.ts:52-53`). Wer mit Gatlings gegen Panzer antritt, bekäme
ohne Gegenmaßnahme einfach weniger Panzer.

Vorschlag: `FAIRNESS_MATCHUP_FLOOR = 0,6`. Das Gate rechnet für unarmored,
light, heavy und fortified mit `max(Matrix, 0,6)`. Ethereal und Luft bleiben
ausgenommen, sie sind harte Gates mit eigener Capability-Prüfung. Der Schaden
einer schlecht gekonterten Welle bleibt durch `maxLeakDamagePerWave = 18`
begrenzt (`game-balance.config.ts:36`). Umsetzung: zweites Feld
`gateDpsPerArmor` in `DefenseAnalysis`, berechnet neben
`calculateEffectiveDPSPerArmor`, gelesen von `fairMaxCount`. Der Python-Spiegel
`schema.fair_max_count` muss mitziehen.

Nebenwirkung: Eine Welle mit schlechter Paarung leckt mehr, der
Gate-Controller nimmt daraufhin das Budget für alle folgenden Wellen zurück,
nicht nur für diese Rüstung (`gate-controller.ts:99-110`).

**DPS-Ramp** rechnet mit roher DPS (`wave-director.service.ts:409-411`),
unverändert.

**Trainings-Bots.**
- `ResearchPickStrategy` bewertet Forschung mit Matrix × erwarteter
  Rüstungsverteilung (`research-pick.strategy.ts:231-233`), passt sich an.
- `AntiEtherealPlacementStrategy` wählt nach Wert gegen Ethereal
  (`anti-ethereal-placement.strategy.ts:57-61`), passt sich an.
- `SplashDefensePlacementStrategy` wählt nach roher DPS pro Gold
  (`splash-defense-placement.strategy.ts:46-48`, `tower-strategy.interface.ts:97-101`)
  und würde die Cannon gegen Schwärme bauen, wo sie neu schwach ist. Ändern
  auf `getTowerValueVsArmor` gegen die erwartete Rüstungsverteilung.
- Die A/B-Werte in `AI_WAVE_DIRECTOR_PLAN.md` gelten für die alte Matrix.
  Vor und nach der Änderung einen Bot-Baseline-Lauf fahren (mittlere
  Runlänge, Leck-Quote, Near-Miss).
- Das generierte Schema für das Backend enthält die Matrix nicht
  (`tools/ai-schema/generate.spec.ts`), der State-Encoder normiert
  effektive DPS mit 500 (`ai-schema.ts:174`). Keine Änderung nötig.

**Economy.** Das Gold pro Welle ist fest (`goldBudgetForWave`), die Matrix
ändert es nicht. Das Design-Roster enthält bereits jeden Tower-Typ, die
Spreizung verlangt also keinen Ausbau, den das Budget nicht vorsieht.
`npm run economy-chart` kennt die Matrix nicht, `npm run tower-stats-chart`
zeigt nur rohe DPS. Eine Ansicht „DPS gegen Rüstung“ im Tower-Stats-Chart
wäre für die Feinabstimmung nützlich (optional).

**Dokumentation.** MASTER_GAME_DESIGN §2.3 (Tabelle und Interpretation),
§3.1 (veraltete Archer-Werte), §3.10 (True Damage) nachziehen.

### 4.6 Wechselwirkung mit A und B

- Matrix und Cannon gehören in denselben Schritt: Der Cannon-Vorschlag
  rechnet mit der neuen `siege`-Zeile, und ohne kleineren Splash bliebe die
  Cannon trotz 0,5 im Pulk konkurrenzfähig.
- Upgrade-Kurven und Matrix multiplizieren sich. Beispiel Archer gegen heavy
  auf L25: heute 363 × 0,7 = 254 DPS, neu 134 × 0,5 = 67 DPS (−74 %).
  Deshalb die Upgrades erst nach einem Bot-Lauf mit der neuen Matrix
  umstellen, sonst ist nicht zu trennen, welche Änderung was bewirkt.
- Der Fairness-Floor wirkt stärker, je weiter die Matrix spreizt. Ohne Floor
  schluckt das Gate die Matrix-Änderung weitgehend.

---

## 5. Boss-Frequenz ab W31

### 5.1 Befund

- W1 bis W30 sind die Bosse gepinnt: W10, W20, W30 `boss_herbert`
  (`wave-curriculum.config.ts:54`, `:64`, `:74`).
- Ab W31 liefert `templateForWave()` `null` (`wave-curriculum.config.ts:136-139`),
  der Director wählt frei. Die TODO-Notiz „Curriculum loopt mod-30“ ist
  überholt, nur `staticWaveProfileForWave` loopt noch (`:298-301`).
- Die Maske erlaubt `bossOnly`-Templates nur bei `wave % 10 === 0`
  (`templates.ts:567`), sie **erzwingt** sie aber nicht. Der Regel-Director
  nimmt das älteste erlaubte Template, Gleichstand zufällig
  (`rule-director.ts:112-125`), bei einer Historie von 5 Wellen
  (`wave-director.service.ts:499-502`). An W40 steht der Boss im Gleichstand
  mit rund 14 anderen Templates.
- **Simulation** (2.000 Läufe W1 bis W130 mit `getAvailableTemplateMask` und
  `RuleDirector`, alle Capabilities vorhanden): 0,72 Bosswellen zwischen W31
  und W130. Gedacht waren 10.
- Es gibt genau ein Boss-Template (`templates.ts:282-295`).

### 5.2 Umsetzung

1. `isBossWave(wave)` neben `templateForWave` in
   `wave-curriculum.config.ts`: bis W30 `wave % 10 === 0`, danach
   `wave % 5 === 0`.
2. `getAvailableTemplateMask` bekommt das Ergebnis als Parameter (wie heute
   `forcedTemplateId`, weil `templates.ts` die Curriculum-Datei nicht
   importieren darf, `templates.ts:536-538`). An Boss-Wellen jenseits des
   Curriculums kollabiert die Maske auf die `bossOnly`-Templates, die die
   Capability-Gates bestehen. An allen anderen Wellen bleiben sie gesperrt.
   Fallback wie heute, falls kein Boss-Template passt.
3. Python-Spiegel `training-backend/schema.py:372-394` (`current_wave % 10`)
   anpassen, danach `npm run ai-schema`. Der Test
   `tools/ai-schema/generate.spec.ts:257-268` prüft nur die Curriculum-Pins
   und bleibt grün.
4. Zwei weitere Boss-Templates, damit nicht jede fünfte Welle gleich
   aussieht: `boss_golem` (Stone Golem mit Mammut-Eskorte, fortified) und
   `boss_dragon` (Drachen mit Hornissen, `requiresCapability: 'antiAir'`).
   Die Älteste-zuerst-Regel rotiert sie dann von selbst. Slots sind frei
   (19 von 32, `templates.ts:315-319`).

### 5.3 Folgen

- **Schwierigkeit:** Boss-Wellen tragen `hpMultRange` bis 6 × Endgame-Faktor
  (`templates.ts:289`, `wave-curriculum.config.ts:101-104`). Alle fünf statt
  praktisch nie macht das Late Game spürbar härter und kürzt die Runs.
- **Gold:** Ab W35 zahlt jede Welle den Boden von 6.000 + 3.000 Gold
  (`wave-curriculum.config.ts:337-386`), Bosse bekommen keinen Aufschlag.
  Meilensteinbonus gibt es nur für W10/20/30/40 (`game-balance.config.ts:74`).
  Vorschlag: Boss-Wellen ab W31 zahlen das doppelte Budget.
- **Fairness-Gate:** gewichtet Herbert mit seinem Anteil 0,0334, die
  Wellengröße passt sich an. Keine Änderung nötig.
- **Gate-Controller:** Boss-Wellen lecken voraussichtlich mehr, der Regler
  nimmt danach für alle Wellen zurück. Alternative: Boss-Wellen nicht ins
  Leck-Fenster aufnehmen (offene Entscheidung 5).
- **Bots:** keine neue Strategie nötig.
- **Zusammenspiel mit C:** Boss-Wellen sind fortified oder heavy. Mit der
  neuen Matrix sind sie die Prüfung, ob der Spieler Siege oder Magic hat.

---

## 6. Umsetzungsreihenfolge und Patch-Beschreibung

**Schritt 0: Bugfixes ohne Balance-Absicht** (je S)

| Was | Datei | Änderung |
|---|---|---|
| Fire zielt außerhalb der Flamme | `tower-combat.service.ts:339`, `:411` | Flammenlänge aus `beamRange × combat.range / typeConfig.range`, oder Zielsuche für Beam-Tower auf `beamRange + 2` begrenzen |
| Splash trifft nicht anvisierbare Ziele | `combat-effect.service.ts:178` | Luftziel überspringen, wenn der Quell-Tower kein Air-Targeting hat (`canTargetAirEffective`) |
| Sidebar-Schwellen doppelt | `sidebar-tooltips.ts:87`, `:139` | aus `EFFECTIVENESS_THRESHOLDS` lesen |
| Splash-Kennzeichnung im Modell | `defense-analyzer.ts:42-50` | Rocket ohne, Ice und Poison mit `splash` |
| Chart-Texte | `tools/tower-stats-chart/generate.spec.ts:248`, `:272` | Kostenfaktor aus `UPGRADE_COST_SCALING` |

**Schritt 1: Matrix und Cannon** (M), danach Bot-Baseline-Lauf

| Datei | Änderung |
|---|---|
| `damage-matrix.config.ts:22-31` | Matrix aus 4.3 |
| `damage-matrix.config.ts:41` | `weak: 0.6` (optional Tier `resisted`) |
| `projectile-types.config.ts:53-55`, `:73` | Feld `splashMaxTargets?: number`, Cannon `splashRadius: 6`, `splashMaxTargets: 8` |
| `combat-effect.service.ts:170-186` | Kandidaten nach Abstand sortieren, auf `splashMaxTargets` kürzen |
| `tower-types.config.ts:264` | Cannon `range: 70` |
| `templates.ts` (neben `:362`) | `FAIRNESS_MATCHUP_FLOOR = 0.6` |
| `defense-analyzer.ts:325-355`, `models/game-state-snapshot.ts` | `gateDpsPerArmor` mit Floor, `fairMaxCount` liest es |
| `training-backend/schema.py` | Floor in `fair_max_count` spiegeln |
| `splash-defense-placement.strategy.ts:46-48` | Wert gegen erwartete Rüstungsverteilung |
| `docs/game-design/MASTER_GAME_DESIGN.md` §2.3, §3 | Tabellen nachziehen |

**Schritt 2: Upgrade-Kurven** (M)

| Datei | Änderung |
|---|---|
| `tower-types.config.ts:10-21` | `TowerUpgrade` um `lateMultiplier?` und `lateFromLevel?` erweitern |
| `tower-types.config.ts:62-65`, `:89-145` | Standard-Upgrades durch eine Fabrik `combatUpgrades({ damage, rate })` ersetzen, Range-Track `maxLevel: 10`, `multiplier: 1.03`, `ARCHER_RANGE_*` entfernen |
| `tower-types.config.ts:227-426` | pro Tower die Werte aus 2.3 |
| neue Hilfsfunktion `upgradeFactor(upgrade, level)` | an einer Stelle, genutzt von allen folgenden |
| `tower.entity.ts:427-436` | Werte aus Basis × `upgradeFactor` neu berechnen statt `*=` |
| `tower-dps.util.ts:47-56`, `:126-143` | `statMultiplier` über `upgradeFactor`, Stufe auf `maxLevel` begrenzen |
| `tower-combat.service.ts:474-506` | Beam-DPS und -Breite über `upgradeFactor`, Flammenlänge mit Range |
| `tools/tower-stats-chart/generate.spec.ts:45` | `MAX_LEVEL` pro Track statt vom ersten Track |
| `tower.entity.spec.ts`, `tower-types.config.spec.ts` | Erwartungen anpassen |

`requiredUpgradeTier` bleibt unverändert. Der Range-Track endet in Tier 2.

**Schritt 3: Boss-Takt** (S bis M): Abschnitt 5.2, plus doppeltes Budget für
Boss-Wellen ab W31 in `goldBudgetForWave` (`wave-curriculum.config.ts:368-386`).

**Schritt 4: Economy** nach dem Playtest, siehe 2.5.

---

## 7. Offene Entscheidungen

1. **Rocket gegen Schwärme.** Mit `siege` 0,5 gegen light wird die Rocket
   zum Anti-Drachen-Tower, Fledermaus- und Hornissen-Schwärme übernehmen
   Gatling mit AA Retrofit, Lightning und Ice. Alternative: eigener Splash
   (4 m) für die Rocket. *Empfehlung:* akzeptieren, das Luftspiel bekommt
   dadurch zwei Rollen statt einer.
2. **Fairness-Floor 0,6.** Mit Floor spürt der Spieler ein falsches Roster
   (höchstens 18 HP pro Welle). Ohne Floor schrumpft das Gate die Welle, die
   Spreizung bleibt fast unsichtbar. *Empfehlung:* Floor.
3. **Degressive Tiers (Code) oder nur Konstanten.** Konstanten allein
   (×1,035) halbieren das Mid-Game. *Empfehlung:* degressiv.
4. **Range-Track mit 10 Stufen** macht rund 200.000 Gold bis W30 frei.
   *Empfehlung:* erst playtesten, dann Gold nachsteuern.
5. **Boss-Wellen im Leck-Fenster des Gate-Controllers.** *Empfehlung:*
   drinlassen, bis ein Bot-Lauf zeigt, dass der Regler danach zu weit
   zurücknimmt.
6. **Boss-Bonus ab W31** (doppeltes Budget). *Empfehlung:* ja.
7. **Herbert `immunityPercent`** und **Tentacle True Damage**: bauen oder aus
   Config und Master-Dokument streichen. *Empfehlung:* streichen, beides
   würde die Matrix-Spreizung wieder aufweichen.

---

## 8. Rechenweg

- **Upgrade-Werte:** `Basis × m^L` (heute), neu
  `Basis × m^min(L,15) × (1 + 0,4 (m − 1))^max(0, L − 15)`, Range
  `Basis × 1,03^min(L,10)`.
- **Gold kumuliert:** `Basispreis + Σ Tracks Σ_{i<L} round(50 × 1,25^i)`
  (`getUpgradeCost`, `tower-types.config.ts:28-31`), neu mit Range und Beam
  Width bis höchstens L10.
- **Splash:** `1 + Σ_{k: k·s<R} (1 − k·s/R)`, einseitig; beidseitig doppelte
  Summe, mit Cap nur die ersten 8 Summanden (nächste zuerst). Abrunden des
  Splash-Schadens (`Math.floor`) vernachlässigt.
- **Pulk-DPS:** Einzelziel-DPS × Splash-Faktor (nur Cannon) × Matrix.
- **Boss-Simulation:** 2.000 Läufe, pro Welle `getAvailableTemplateMask(w,
  true, true, recent, templateForWave(w))`, dann `RuleDirector.decide`,
  Historie auf 5 gekürzt wie in `wave-director.service.ts:499-502`.

Das Rechenskript lag unter `tmp/balance-calc.ts` (nicht eingecheckt, `/tmp`
steht in `.gitignore`). Es importiert die Configs direkt, die Zahlen lassen
sich damit nach jeder Config-Änderung neu erzeugen.
