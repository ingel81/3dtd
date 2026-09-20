# 3DTD: Master Game Design Document

**Stand:** 2026-09-15, gegen die Configs geprüft.

> **Wie dieses Dokument zu lesen ist.** §1 bis §11 beschreiben, was gebaut ist;
> die Quelle der Wahrheit ist jeweils die genannte Config. Wo ein Punkt der
> früheren Fassung nicht gebaut ist, steht an seiner Stelle ein Verweis nach
> §12. §12 sammelt diese Design-Absicht, jeweils mit dem Abschnitt, aus dem sie
> kam. Gestrichen wurde nichts.
>
> Die Balance-Zahlen geben wieder, was die Configs heute sagen. Eine Bewertung
> steht hier nicht.
>
> **Erweitert seit 2026-05-11:** Der **Lightning Tower** mit eigenem `damageType: 'lightning'`
> (8. Schadenstyp im Code, `DAMAGE_TYPES` in `configs/combat/combat.types.ts`) ist
> ausgeliefert und in §2.1 / §2.3 / §3.12 integriert.
>
> **Erweitert 2026-09-12:** Schadenstyp **Chaos** (9. Typ, 1,0 gegen jede
> Rüstung) und der **Chaos Tower** als teurer Generalist, §2.1 / §2.3 / §3.13.
>
> **Erweitert 2026-09-17:** das **Missile Silo** als zweites Gebäude, von dem
> der Nuklearschlag startet, und das Einmal-Flag `unique`, §6.1b.

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
- **Poison (☠️)**: DoT-Spezialist gegen Lebendes, eigenständiger Schadenstyp.
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
> Anpassungen dort gilt es, diese Tabelle synchron zu halten; die TypeScript-
> Mapped-Types erzwingen Vollständigkeit auf Code-Seite, nicht in der Doku.

**Regeln** (als Test in `damage-calculator.spec.ts`):
1. Jede Schadensart hat mindestens eine Paarung ≤ 0,5: dort beißt sich der Tower die Zähne aus.
2. Jede Schadensart außer Physical hat mindestens eine Paarung ≥ 1,3. Physical bleibt der Allrounder ohne Stärke, er ist der Starttower.
3. Jede Rüstungsart hat mindestens zwei Konter ≥ 1,2, beide erforschbar, bevor die Kampagne die Rüstung zum ersten Mal schickt.

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
- **Überlebbarkeits-Deckel:** Der Wave-Director würde eine schlechte Paarung sonst mit einer kleineren Welle beantworten. Deshalb zählt er gegen Boden-Gegner (außer Ethereal) jeden Tower mit mindestens 0,6 (`FAIRNESS_MATCHUP_FLOOR`), siehe §6.5.

### 2.4 Status-Effekte (Schicht 2)

Gebaut sind fünf Effekte (`StatusEffectType` in `models/status-effects.ts`,
Mechanik in [STATUS_EFFECTS.md](../STATUS_EFFECTS.md)):

| Effekt | Quelle | Wirkung | Dauer |
|---|---|---|---|
| **Slow** | Ice Tower | -50 % Tempo | 3 s |
| **Burn** | Fire Tower | 20 % der Beam-DPS als DoT, Tick 500 ms, pro Turm ein Eintrag | 3 s, im Kegel erneuert |
| **Poison** | Poison Tower | 8 DPS | 4 s |
| **Freeze** | Frostbombe | Halt | 3 s, Bosse 1 s |
| **Stun** | EMP | Halt | 1,5 s, Maschinen 6 s, Bosse 0,75 s |

Werte aus `game-balance.config.ts` (`effects`), `combat-tuning.config.ts`
(`burnTickIntervalMs`) und `abilities.config.ts`. Beim Burn bleibt die Summe im
Kegel gleich: der Fire Tower gibt 20 % seines Schadens als Burn aus statt
direkt. Details in [STATUS_EFFECTS.md](../STATUS_EFFECTS.md#burn-effect-dot),
die Fähigkeiten in [ABILITIES.md](../ABILITIES.md).

Nicht gebaut: Armor Break, Mark, ein Stun als Tower-Effekt, die Gegenmittel
`immuneToSlow` und `immuneToBurn` sowie Regen, gegen den Burn helfen sollte.
Die Design-Werte stehen in §12.1.

### 2.5 Gegner-Eigenschaften (Schicht 3)

Gebaut sind diese Eigenschaften je Gegnertyp (`EnemyTypeConfig` in
`enemy-types.config.ts`):

| Eigenschaft | Feld | Wirkung | Typen |
|---|---|---|---|
| Luft | `isAirUnit` | nur von Towern mit Luftziel zu treffen | Bat, Hornet, Dragon |
| Boss | `isBoss` | Boss-Leiste, Boss-Intro, Fähigkeiten wirken schwächer | Herbert, Skarnax, Ooze |
| Maschine | `mechanical` | das EMP hält sie 6 statt 1,5 s | Tank, Mech |
| Split | `splitOnDeath` | ein Kill (kein Leck) teilt den Gegner | Skeleton (2 Minions), Ooze (bis zu 10 Slime Clumps) |
| Kette | `chain` | ein Spawn bringt einen Wurm aus Segmenten | Skarnax |

`immunityPercent: 100` steht bei Herbert in der Config, gelesen wird es im
Spiel nicht (nur ein Spec prüft, dass das Feld nicht negativ ist).

Die geplanten Flags Shielded, Camo, Regen, Phasing und Aura sind nicht gebaut,
siehe §12.2.

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

Andere Upgrade-Pfade als diese Tracks gibt es nicht. Die früher je Tower
geplanten Pfade (Air-Pfade, Armor Break, Luftflamme, Spezialisierungen) stehen
in §12.3.

### 3.3 Archer: Physical
- Starttower, trifft Luft und Boden ab Basis.
- Der geplante Air-Upgrade-Pfad und die Spezialisierungen sind nicht gebaut (§12.3).

### 3.4 Dual-Gatling: Pierce
- Trifft Luft erst mit der Forschung AA Retrofit (`aa-retrofit`), die nur die
  Gatling betrifft (`AA_RETROFIT_TOWERS` in `tower-targeting.util.ts`).
- Der geplante Air-Upgrade-Pfad („AA-Gurt") ist nicht gebaut (§12.3).

### 3.5 Cannon: Siege
- Splash 6 m, höchstens 8 Ziele (`splashMaxTargets`), trifft nur Boden.
- Der geplante Armor-Break-Pfad ist nicht gebaut (§12.3).

### 3.6 Rocket: Siege (Air-Only)
- Trifft nur Luft (`canTargetGround: false`), kein Splash.
- Die geplante „Bodenfreigabe" ist nicht gebaut (§12.3).

### 3.7 Magic: Magic
- Stärkster Ethereal-Counter (2.0×), zweiter Konter gegen Fortified (1.3×, Runen gegen Stein).
- Schwach gegen Light (0.5×): flinke Ziele weichen den Geschossen aus.

### 3.8 Ice: Ice
- **Air + Ground** ab Basis. Niedriger DPS, starker Slow.

### 3.9 Fire: Fire
- Flammen-Beam mit Burn (§2.4), trifft nur Boden (`canTargetAir: false`).
- Die geplante „Luftflamme" ist nicht gebaut (§12.3).

### 3.10 Tentacle: Physical
- Reiner Physical-Schaden. Die früher geplanten 20 % True Damage (Armor-unabhängig)
  sind gestrichen: sie würden die Matrix-Spreizung wieder aufweichen
  (BALANCE_PROPOSAL_2026-09, Entscheidung 7).

### 3.11 Poison: Poison
- DoT-Spezialist mit Splash-Projektil.
- Eigenständiger Schadenstyp (nicht Fire-Subtyp).
- Poison-DoT und Burn-DoT sind getrennte Effekte, können gleichzeitig wirken.

### 3.12 Lightning: Lightning
- **Chain-Hitscan** (`attackType: 'chain'`): Primary-Treffer + 2 Jumps, je `chainFalloff 0.7` (100% → 70% → 49%), `jumpRange 15m` zwischen Chain-Links.
- **Air + Ground** ab Basis, Anti-Air ohne Forschungspflicht.
- **Niche:** zweiter glaubwürdiger Ethereal-Counter (1.5×), stark gegen Light-Swarms (1.5×, profitiert zusätzlich vom Chain-Pattern) und neben der Rocket der zweite Anti-Drachen-Tower (1.2× gegen Heavy, Metall leitet). **Wirkungslos gegen Fortified** (0.3×): Cannon/Siege oder Magic bleibt der Pflichtbau gegen Mammoth/Stone-Golem.
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
- **Modell:** Kenney „tower-round-crystals“ (CC0, Tower Defense Kit). Der mittlere Kristall dreht sich zum Ziel (`turretNode`), aus ihm kommt der Orb. Der Sound ist vorerst der Magic-Cast.
- **Wave-Director:** zählt als Anti-Air und als Anti-Ethereal (Ethereal-Multiplikator 1,0 erreicht die Schwelle von `isAntiEtherealTower`).

---

## 4. Gegner-Katalog (Rüstung + Eigenschaften)

> HP und Tempo stehen in `enemy-types.config.ts` und in der Tabelle von
> [ENEMY_CREATION.md](../ENEMY_CREATION.md); der Wave-Director skaliert die HP je
> Welle. Hier stehen Rüstung, Eigenschaften (§2.5) und die Rolle in der Kampagne.
> Stand 2026-09-15: 24 Einträge in `ENEMY_TYPES`.

| Enemy | Armor | Eigenschaften | Rolle |
|---|---|---|---|
| **Zombie** | Unarmored | – | Standard-Futter (`zombie_horde`, W1) |
| **Zombie v2** | Unarmored | langsamer (3 m/s) | 10 % von `zombie_horde` |
| **Rat** | Unarmored | sehr schnell, Schwarm | Schwarm-Check (`rat_tide`, W2) |
| **Penguin** | Unarmored | sehr schnell | Tempo-Check (`penguin_rush`, W3) |
| **Wallsmasher** | Light | wechselt zwischen Gehen und Rennen | Light-Check (`light_mix` W4, `wallsmasher_crew` W5) |
| **Spider** | Light | schnell | Light-Schwarm (`spider_swarm`, W6) |
| **Bat** | Light | Luft | Luft-Debüt (`bat_swarm`, W7) |
| **Hornet** | Light | Luft, Schwarm | mehr Luft (`hornet_strike`, W8) |
| **Tank** | Heavy | Maschine | Heavy-Check (`tank_column`, W9) |
| **Zombie Soldier** | Heavy | – | Begleitung in `tank_column` |
| **Bear** | Heavy | schnell | Heavy und schnell (`bear_pack`, W11) |
| **Dragon** | Heavy | Luft | Luft-Elite (`dragon_elite`, W12); ab W31 im Boss-Template `boss_dragon`, selbst kein Boss |
| **Mech** | Heavy | Maschine | Heavy-Masse (`mech_army`, W28) |
| **Ghost** | Ethereal | – | Ethereal-Debüt (`ghost_surge`, W13) |
| **Wraith** | Ethereal | schnell | Ethereal-Schwarm (`wraith_storm`, W17) |
| **Mammoth** | Fortified | langsam | DPS-Check (`mammoth_siege`, W14) |
| **Stone Golem** | Fortified | langsam | DPS-Check (`golem_squad`, W15); ab W31 im Boss-Template `boss_golem` |
| **Herbert** | Fortified | Boss | Boss W10, W20, W30 (`boss_herbert`), danach einer der Director-Bosse |
| **Skeleton** | Unarmored | Schwarm, Split: ein Kill teilt ihn in 2 Skeleton Minions, ein Leck nicht | Mega-Schwarm (`skeleton_swarm`, W19), Split seit 2026-09-13 |
| **Skeleton Minion** | Unarmored | schnell, entsteht nur aus dem Split, teilt sich nicht weiter | kein eigenes Template |
| **Skarnax** (Wurm) | Heavy | Boss, Kette aus 16 bis 240 Segmenten, die Länge folgt der Route | Boss-Variante W35, W55, W75, … |
| **Skarnax Segment** | Heavy | Körperring des Wurms | einzeln nur per Custom Wave oder Enemy Debug |
| **Ooze** | Unarmored | Boss, Körper als Schleimband entlang der Route (bis 80 m), fließt Meter für Meter in die Basis, Split in bis zu 10 Slime Clumps | Boss-Variante W45, W65, W85, … |
| **Slime Clump** | Unarmored | entsteht nur aus dem Split der Ooze | kein eigenes Template |

Boss-Rotation nach W30: [WAVE_SYSTEM.md](../WAVE_SYSTEM.md#boss-waves). Nicht
gebaut sind Lich, Slime (mit Regen) und Banshee sowie die früher hier geführten
Flags für Spider (Camo) und Mech (Shielded, immuneToBurn), siehe §12.4.

---

## 5. Economy & Rewards (Formeln + Kurve)

### 5.1 Kill-Reward: Kill-Budget je Welle

Jede Welle hat ein festes Kill-Budget (`killGold` aus `waveGold`,
§5.2). Der EnemyManager teilt es auf die Körper der Welle
(`getExpectedBodyCount`, Split-Kinder und Wurm-Segmente zählen mit):

```
Reward = floor(Restbudget / offene Slots)      // je bezahltem Kill
```

Der letzte Slot bekommt den Rundungsrest, eine ganz geräumte Welle zahlt also
genau das Budget. Ein durchgelaufener Gegner verliert seinen Slot und die
seiner nie entstandenen Kinder, ein Split erhöht das Gold der Welle nicht, ein
Debug-Kill zahlt nichts (`calculateDynamicReward` in `enemy.manager.ts`). Die
Größe der Welle liest er bei jedem Kill neu, weil ein Wurm seine Segmente erst
beim Spawn zur Welle bringt.

Die frühere Formel aus Gegner-HP, Tempo, Rüstung, Luft, Flags und Wellennummer
ist nicht gebaut; sie steht in §12.5.

### 5.2 Wave Completion Rewards

> **Superseded seit Phase 5.16.** Die früher hier stehende Formel
> `WaveCompleteBase = 18 + round(2.6 * Wave)` ist **nicht mehr implementiert**.
> Das Gold pro Wave ist jetzt **deterministisch pro Wave-Nummer** und steht als
> `CAMPAIGN` in `src/app/configs/campaign.config.ts`, abgefragt
> über `waveGold()`.

Warum: die Formel band das Einkommen an das, was die Wave-Faktoren gerade
ausspuckten. Mit einem festen Budget pro Wave ist das kumulative Einkommen
planbar; erst damit lassen sich Tower- und Forschungskosten überhaupt
balancen.

```
{ kill, complete } = waveGold(Wave)     // W1-30 aus der Tabelle
PerfectBonus   = 0.35 * complete                 // 0 HP verloren
CloseCallBonus = 0.12 * complete                 // HP <= 25 am Wave-Ende
ComboBonus     = min(0.30, 0.05 * PerfectStreak) * complete
Milestones (Wave 10/20/30/40) = 45 / 80 / 120 / 170
```

Nach W30 wählt der Director das Template, und das Gold-Budget wird ab dort
**getapert**: ×0,5 je Welle (`GOLD_TAPER_PER_WAVE`) bis auf 5 % des
W30-Budgets (`GOLD_SUSTAIN_FRACTION`), statt neu bei W1 zu beginnen;
Boss-Wellen zahlen das Doppelte (`BOSS_GOLD_MULTIPLIER = 2`). Ein reiner Loop ließ Wave 31 von 180.000 auf 200 Gold fallen und
zahlte über 100 Wellen 2,64 Mio. gegen ein Design-Roster von 1,39 Mio., die
Verteidigung erreichte den Vollausbau und tötete ab W11 alles.

### 5.3 Beispiel-Kurve (Ist-Werte aus der Kampagne)

> `killGold` + `completionGold` je Wave, ohne Skill-Boni. Vollständige Tabelle:
> `CAMPAIGN` in `configs/campaign.config.ts`.
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
Summe damals 468.702 Gold, Puffer 69 %. Die eingecheckte
`docs/economy-chart.html` (zuletzt generiert in `7d5992da`, 2026-09-14) nennt
474.302 Gold und 67 % Puffer; den aktuellen Stand rechnet `npm run economy-chart`
im Abschnitt „Design-Roster vs. Kampagne-Budget". Nachgesteuert wird bewusst
erst nach dem Playtest (BALANCE_PROPOSAL_2026-09 §2.5).

### 5.4 Anti-Snowball / Catch-Up
- **Perfect-Bonus gedeckelt (35%)**
- **Combo-Bonus max +30%** (+5% pro Perfect-Streak-Wave)
- **Comeback-Bonus:** `min(15, HP_Lost * 0.3)` pro Wave

### 5.5 Schwierigkeits-Knöpfe (post-Director)

Drei Größen skalieren die Schwierigkeit **nach** der Entscheidung des Wave
Directors. Sie sind Design-Parameter, keine gelernten Werte:

| Knopf | Wo | Kurve |
|---|---|---|
| `endgameHpMultiplier(wave)` | `campaign.config.ts` | 1.0× bis W20, danach +5%/Wave, Cap 4.0× (W30 ≈ 1.5×, W50 ≈ 2.5×) |
| `enemyBaseDamageForWave(wave)` | `campaign.config.ts` | HP-Verlust pro Durchkommen: 1 (W1–10), 2 (W11–20), 3 (W21–30), … |
| `maxLeakDamagePerWave` | `game-balance.config.ts` | **18**, Obergrenze dessen, was eine einzelne Welle kostet |

Der Leck-Cap ist die wichtigste der drei. Der Spieler hat 100 Start-HP und
**heilt nie**; ab W91 kostet ein einzelnes Durchkommen 10 HP. Ohne Cap kann eine
schlecht gekonterte Welle (Ghost-Swarm gegen ein Roster ohne Magic) 30–50 HP
nehmen und den Run beenden, ohne dass der Spieler noch etwas hätte tun können.
Der Cap macht aus der Todesspirale eine Todesschräge: eine katastrophale Welle
ist ein schwerer, aber überlebbarer Treffer.

---

## 6. Forschungszentrum & Tech-Tree

> **Ersetzt das alte HQ-Level-Konzept.** Das Forschungszentrum ist ein platzierbares Gebäude
> das als einziges Progressionssystem Tower, Perks und Upgrade-Tiers freischaltet.

### 6.1 Forschungszentrum (Gebäude)

| Eigenschaft | Wert |
|---|---|
| **Typ** | Platzierbares Gebäude, ein Eintrag in `TOWER_TYPES` mit `attackType: 'passive'` |
| **Kosten** | 75 Credits |
| **Verfügbar** | Sofort (ab Spielstart) |
| **Anzahl** | Genau eines erlaubt (`unique: true`, siehe 6.1b) |
| **Angriff** | Keiner |
| **Platzierung** | Gleiche Mechanik wie Tower |
| **Zerstörbar** | Nein, Gegner greifen nur die Basis an |
| **Verkaufen** | derselbe Weg wie bei Towern (`TowerLifecycle.sell`); `ResearchManager.onCenterRemoved()` bricht dabei alle laufenden Forschungen ab und setzt die Stufe auf 0 |
| **3D-Modell** | `assets/models/buildings/research_building.glb` |

**Level-Upgrades** über den Upgrade-Track „Research Wing" (`research-slots`,
Basis 120, `costScaling` 1,8, `getUpgradeCost`); die Slots je Stufe stehen in
`RESEARCH_CENTER_LEVELS`:

| Level | Upgrade-Kosten | Research-Slots |
|---:|---:|---:|
| **1** | – (Basis) | 1 |
| **2** | 120 | 2 |
| **3** | 216 | 3 |

Die Felder `upgradeCost` (180, 350) und `baseCost` (150) in
`research-center.config.ts` liest kein Code.

### 6.1b Missile Silo (Gebäude, seit 2026-09-17)

Das zweite passive Gebäude. Von ihm startet der Nuklearschlag
([ABILITIES.md](../ABILITIES.md#nuklearschlag-in-zahlen)); ohne stehendes Silo
hat die Fähigkeit keinen Knopf und lässt sich nicht einsetzen.

| Eigenschaft | Wert |
|---|---|
| **Typ** | `TOWER_TYPES['missile-silo']`, `attackType: 'passive'`, ohne Upgrades |
| **Kosten** | 400 Credits |
| **Verfügbar** | nach der Forschung `nuclear-strike` (Effekt `unlock-tower`, neben ihrem `global-perk`) |
| **Anzahl** | Genau eines erlaubt (`unique: true`) |
| **Angriff** | Keiner; der Nuklearschlag ist eine Fähigkeit des Spielers |
| **Platzierung** | Gleiche Mechanik wie Tower |
| **Verkaufen** | derselbe Weg wie bei Towern (`TowerLifecycle.sell`), 75 % zurück (300). Ladung und Nachladen des Schlags laufen weiter, eine Rakete im Flug schlägt ein |
| **3D-Modell** | `assets/models/buildings/missile_silo.glb` (Nodes `silo`, `missile`) |

**Einmal-Gebäude.** Ob ein Gebäudetyp nur einmal stehen darf, steht als
`unique` am `TowerTypeConfig`, nicht mehr als Prüfung auf die ID des
Research Centers. Es prüfen `TowerLifecycle.place` (Befehl, auch des Bots) und
`canPickTowerCard` (Karte im BUILD-Panel, dazu ihre Zifferntaste, falls sie
unter den ersten neun Karten liegt; Research Center und Silo liegen dahinter); was steht, führt
`GameStore.placedUniqueTypes`, geschrieben aus `tower:placed` und
`tower:sold`. Der Tooltip einer gebauten Karte sagt "Already placed.", sonst
den Text aus `description`.

### 6.2 Forschungsmechanik

- **Kosten:** Credits, abgezogen beim Start.
- **Dauer:** läuft in Spielzeit im Sub-Step (`ResearchManager.update`), folgt
  also der Spielgeschwindigkeit, steht in der Pause und läuft zwischen den
  Wellen weiter.
- **Slots:** pro Slot eine parallele Forschung.
- **Warteschlange:** Forschungen mit erfüllten Voraussetzungen lassen sich
  einreihen, auch ohne freien Slot und ohne Credits. Bezahlt wird beim Start;
  der Kopf der Schlange wartet auf seine Credits, eine billigere Forschung
  dahinter überholt ihn nicht.
- **Abbruch:** 50 % der Credits zurück (`cancellationRefundPercent`,
  abgerundet); eine eingereihte Forschung kostet beim Entfernen nichts.
- **Start-Tower:** Archer und Research Center. Alle anderen Tower müssen
  erforscht werden (`research.store.ts`).

### 6.3 Tech-Tree (Forschungsbaum)

Frei wählbar mit Voraussetzungen, 20 Knoten in drei Kategorien
(`research-tree.config.ts`), zusammen 19.550 Credits.

#### Tower-Unlocks

| ID | Name | Kosten | Dauer | Voraussetzung | Schaltet frei |
|---|---|---:|---:|---|---|
| `gatling-tech` | Gatling Technology | 400 | 15 s | – | Dual-Gatling |
| `ice-magic` | Ice Magic | 400 | 15 s | – | Ice Tower |
| `tentacle-biology` | Tentacle Biology | 450 | 15 s | – | Tentacle |
| `toxic-compounds` | Toxic Compounds | 450 | 15 s | – | Poison Tower |
| `siege-engineering` | Siege Engineering | 500 | 20 s | Gatling Technology | Cannon |
| `rocketry` | Rocketry | 600 | 18 s | Gatling Technology | Rocket Tower |
| `fire-alchemy` | Fire Alchemy | 550 | 20 s | Toxic Compounds | Fire Tower |
| `arcane-studies` | Arcane Studies | 650 | 20 s | Ice Magic | Magic Tower |
| `storm-mastery` | Storm Mastery | 700 | 20 s | Arcane Studies | Lightning Tower |
| `chaos-rift` | Chaos Rift | 1.000 | 30 s | Siege Engineering + Storm Mastery | Chaos Tower |

#### Global Perks

| ID | Name | Kosten | Dauer | Voraussetzung | Effekt |
|---|---|---:|---:|---|---|
| `aa-retrofit` | AA Retrofit | 450 | 12 s | Rocketry | Dual-Gatling trifft Luft |
| `nuclear-strike` | Nuclear Strike | 1.000 | 40 s | Advanced Weaponry | Fähigkeit Nuklearschlag und das Missile Silo, von dem sie startet |
| `frost-bomb` | Frost Bomb | 700 | 25 s | Arcane Studies | Fähigkeit Frostbombe |
| `emp` | EMP | 800 | 30 s | Storm Mastery | Fähigkeit EMP |
| `orbital-laser` | Orbital Laser | 1.500 | 45 s | Master Engineering | Fähigkeit Orbitallaser |
| `mercenary-contract` | Mercenary Contract | 600 | 30 s | Siege Engineering | Held anheuern |

Die Fähigkeiten beschreibt [ABILITIES.md](../ABILITIES.md), den Held
[HERO.md](../HERO.md).

#### Upgrade-Tier-Freischaltungen

| ID | Name | Kosten | Dauer | Voraussetzung | Effekt |
|---|---|---:|---:|---|---|
| `advanced-weaponry` | Advanced Weaponry | 800 | 35 s | Siege Engineering + Arcane Studies | T2, Stufen 6–10 |
| `master-engineering` | Master Engineering | 1.500 | 60 s | Advanced Weaponry | T3, Stufen 11–15 |
| `advanced-engineering` | Advanced Engineering | 2.500 | 90 s | Master Engineering | T4, Stufen 16–20 |
| `transcendent-tech` | Transcendent Tech | 4.000 | 150 s | Advanced Engineering | T5, Stufen 21–25 |

### 6.4 UI im Forschungszentrum

Wenn das Forschungszentrum selektiert ist, zeigt die Sidebar das
Research-Panel:
- **Gebäude-Level** mit Upgrade-Knopf und Kosten.
- **Laufende Forschungen** mit Fortschritt und verbleibender Spielzeit, dazu
  ein Abbruch-Knopf.
- **Tech-Tree** mit einem Status-Icon je Knoten (`researchNodeIcon`): Haken
  (abgeschlossen), Pfeilkreis (läuft), Stapel (eingereiht), Schloss (gesperrt,
  Tooltip `Requires: …` mit den fehlenden Voraussetzungen), sonst das Icon aus
  der Config.

**Gesperrte Tower im Build-Panel:** Schloss-Icon, Tooltip `Requires: [Forschungsname]`.

### 6.5 Fairness-Regeln für den Wave Director

**Regel 1: Mechanik-Gate.** Ab W31 lässt die Template-Maske ein Template mit
`requiresCapability` nur zu, wenn die Verteidigung die Fähigkeit hat:
- `antiAir`: mindestens ein platzierter Tower trifft Luft
  (`canTargetAirEffective`: Archer, Ice, Rocket, Lightning und Chaos ab Basis,
  Dual-Gatling mit AA Retrofit). Der Held zählt hier nicht.
- `antiEthereal`: mindestens ein platzierter Tower macht gegen Ethereal
  mindestens 1,0 (`isAntiEtherealTower`: Magic 2,0, Ice und Lightning 1,5,
  Chaos 1,0).

Im Kampagne (W1 bis W30) greift das Gate nicht: das gepinnte Template kommt
auch ohne Konter, der Überlebbarkeits-Deckel hält die Welle überlebbar. Camo und
Detection sind nicht gebaut (§12.6).

*Implementiert* als `requiresCapability` in der Template-Maske
(`candidateTemplates()`), zusammen mit `minWave` und der Boss-Kadenz.

**Regel 2: Größen-Gate.** Eine Welle darf nicht größer sein, als die
Verteidigung sie plausibel bekämpfen kann. `survivableCount()` schätzt aus
Defense-DPS, Kill-Durchsatz und Gegnerwerten die tötbare Menge und addiert eine
in HP bepreiste Leck-Toleranz (6 % der Rest-HP). Gegen Boden-Gegner (außer
Ethereal) zählt jeder Tower dabei mit mindestens 0,6 seines Schadens
(`FAIRNESS_MATCHUP_FLOOR`): ein falsch zusammengestelltes Roster soll als Leck
spürbar werden, nicht als kleinere Welle. Der `LeakController` korrigiert die
Schätzung laufend an der tatsächlichen Leck-Quote, Zielband 8 bis 16 % der
Welle. Warum es den Regelkreis braucht (ohne ihn töteten 70 % der Wellen
alles) und alle Konstanten:
[WAVE_DIRECTOR.md](../WAVE_DIRECTOR.md#fairness-cap-im-einzelnen),
Abschnitte 5 und 6.

---

## 7. Wave Pacing & Air Design

### 7.1 Air-Design
- **Air-Debüt bei Wave 7** (`bat_swarm`), Nachschlag W8 (`hornet_strike`),
  danach Luft in der Kampagne auf W12, W16, W21, W24, W26 und W29, so gepinnt in
  `CAMPAIGN`.
- Im Kampagne kommt Luft auch ohne Anti-Air (der Pin umgeht das Gate, §6.5).
  Ab W31 wählt der Director Luft-Templates nur mit Anti-Air.
- **Air-Alert** im Wave-Panel mit Ton, sobald die nächste oder übernächste
  Welle Luft bringt (`AIR_ALERT_LOOKAHEAD = 2`). Er sieht nur Kampagnenwellen:
  ab W31 steht das Template erst beim Wellenstart fest.
- Einen festen Mindestabstand zwischen Luftwellen und eine eigene Vorwarnzeit
  im Director gibt es nicht (§12.6).

### 7.2 Air-Optionen
Ab Basis treffen **Archer**, **Ice**, **Lightning** und **Chaos** Luft und
Boden, die **Rocket** nur Luft. Per Forschung kommt die **Dual-Gatling** mit AA
Retrofit dazu, außerdem der **Held** ([HERO.md](../HERO.md)), der Luft und
Boden trifft. Cannon, Magic, Fire, Tentacle und Poison treffen keine Luft; die
geplanten Luftpfade für Cannon und Fire stehen in §12.3.

---

## 8. Wave Director Regeln

> **Stand 2026-09-20:** Der Director ist **regelbasiert und clientseitig**
> (`director/director-rules.ts`) und die einzige Wellenquelle. Das ONNX-Modell ist
> entfallen ([BALANCING_PLAN.md](../BALANCING_PLAN.md), Phase 1a).
> Grund: gemessen über A/B-Runs mit identischen Bots, Kampagne und
> Überlebbarkeits-Deckel war das trainierte Netz dreimal statistisch ununterscheidbar
> von gleichverteiltem Zufall (mittlere Run-Länge 45,6 gegen 44,7), während
> zwei triviale Heuristiken messbar mehr Spannung erzeugten (Near-Miss 0,067
> gegen 0,045). Ursache lag vor dem Lernen: die Kampagne pinnt auf 49% der
> Wellen das Template, der Überlebbarkeits-Deckel bindet auf 63% der Wellen, es gab
> kaum etwas zu entscheiden.

### 8.1 Was der Director tatsächlich entscheidet

Zwei Dinge, beide bewusst ohne Lernen:

- **Abwechslung wird erzwungen:** gewählt wird das *älteste erlaubte*
  Template. Ein Reward-Term und ein Cooldown haben Wiederholung nur teuer
  gemacht; die Regel macht sie unmöglich.
- **Schwierigkeit ist eine geschriebene Kurve** über die Wave-Nummer
  (count/hp hoch, Spawn-Delay runter, voll ab W60). Der Spieler heilt nie,
  seine HP sind ein Run-Budget, das schreibt man auf, statt es aus einem
  Skalar-Reward pro Welle zu erschließen.

### 8.2 Counter-Logik

Hard Counter (Luft, Ethereal) sind gebaut, über `requiresCapability` in der
Template-Maske (§6.5). Soft Counter (mehr Spawns eines Konters) und eine
Heuristik gegen Spieler-Schwächen sind nicht gebaut: der Regel-Director liest
keine Spieler-Schwächen. Beides steht in §12.7.

Mechanik, Konstanten und Messungen:
[WAVE_DIRECTOR.md](../WAVE_DIRECTOR.md).

---

## 9. Visuelles Feedback
- **Damage Numbers**: Größe/Farbe nach Effektivität (weak < 0,6 grau, normal rot, strong ≥ 1,2 orange, devastating ≥ 1,5 gold; `EFFECTIVENESS_THRESHOLDS`). Jede Paarung ≤ 0,5 erscheint grau und klein. Chaos (1,0) erscheint immer normal.
- **Schadensart im Tower-Panel:** Icon und Name der Schadensart des gewählten Towers.
- **Rüstung in NEXT:** das Wave-Panel zeigt Rüstung und „Weak to" der
  kommenden Welle (`wave-timeline.component`).
- **Air-Alert:** Hinweis und Ton im Wave-Panel bis zwei Wellen vorher, nur für
  Kampagnenwellen (§7.1).

Nicht gebaut: Rüstungs-Icons am Lebensbalken und ein eigener Shader für
Ethereal-Gegner (§12.8).

---

## 10. Progression in der Kampagne (W1 bis W30)

> Verbindlich ist `CAMPAIGN` (`configs/campaign.config.ts`): es
> pinnt Template und Gold-Budget für W1 bis W30. Der Spieler startet mit
> Archer und Research Center und 100 Credits
> (`GAME_BALANCE.player.startCredits`); das Research Center kostet 75.
> Visualisierung: `docs/wave-planner.html` (`npm run wave-planner`).

- **W1 bis W10:** `zombie_horde`, `rat_tide`, `penguin_rush`, `light_mix`,
  `wallsmasher_crew`, `spider_swarm`, `bat_swarm`, `hornet_strike`,
  `tank_column`, `boss_herbert`
- **W11 bis W20:** `bear_pack`, `dragon_elite`, `ghost_surge`,
  `mammoth_siege`, `golem_squad`, `chaos_wave`, `wraith_storm`,
  `armor_gauntlet`, `skeleton_swarm`, `boss_herbert`
- **W21 bis W30:** `bat_swarm`, `tank_column`, `ghost_surge`, `dragon_elite`,
  `mammoth_siege`, `hornet_strike`, `wraith_storm`, `mech_army`, `chaos_wave`,
  `boss_herbert`

Danach wählt der Director das Template, jede fünfte Welle ist eine Boss-Welle,
ab W35 mit Boss-Varianten ([WAVE_SYSTEM.md](../WAVE_SYSTEM.md#boss-waves)).

Die frühere Wave-für-Wave-Planung aus der Zeit vor der Kampagne steht in §12.9.

---

## 11. Offene Entscheidungen
1. **Ghost-Visuals** (Asset final).
2. **Camo-Detection UI** (Radar-Icon vs. Tower-Halo). Hängt an Camo, das nicht gebaut ist (§12.2).
3. **Exact DPS-Werte** je Tower für TargetCost-Validierung. Das DPS-Modell steht in `director/tower-dps.util.ts`, die Kurven in `docs/tower-stats-chart.html`.
4. ~~**Poison-Schadenstyp**: eigener Typ oder Fire-Subtyp?~~ → **Entschieden: eigener Typ (Poison).**
5. **Endless-Scaling** (HP/Speed-Kurven nach Wave 30). Die Mechanik steht (§5.2, §5.5, Boss jede fünfte Welle); die Bewertung ist offen.
6. **Forschungszeiten balancen:** die Startwerte (15 bis 45 s) sind überholt, heute 12 bis 150 s (§6.3). Die Bewertung ist offen.
7. **Forschungskosten feintunen:** heute 400 bis 4.000 Credits je Knoten (§6.3). Die Abstimmung mit der Economy-Kurve ist offen.
8. ~~**Forschungszentrum 3D-Model**~~ → **Erledigt:** `research_building.glb` (§6.1).
9. **Status-Effekte Phase 2:** Freeze und Stun sind über Fähigkeiten gebaut (Frostbombe, EMP, §2.4); Armor Break und Mark sind offen (§12.1).

---

## 12. Design-Absicht, nicht gebaut

Was bis 2026-09-15 in §2 bis §10 als Plan stand, gesammelt und nach
Herkunft sortiert. Nichts davon ist im Code.

### 12.1 Status-Effekte (aus §2.4)

Die ursprüngliche Tabelle. Gebaut ist davon Slow mit anderen Werten (50 %,
3 s) und Burn ohne Regen und ohne Gegenmittel; einen Stun gibt es nur als
Wirkung des EMP, nicht als Tower-Effekt.

| Effekt | Wirkung | Standarddauer | Gegenmittel (Enemy Flag) |
|---|---|---|---|
| **Slow** | -40% Speed | 2s | `immuneToSlow` |
| **Burn** | X DPS, verhindert Regen | 3s | `immuneToBurn` |
| **Armor Break** | **ArmorType wird 4s lang als *Unarmored* behandelt** | 4s | Ethereal immun |
| **Mark** | +15% Schaden von allen Quellen | 4s | – |
| **Stun** | Stop 0.4–0.5s | 0.5s | Boss immun |

> **Armor Break (final definiert):** Für die Dauer werden alle Schadensmultiplikatoren **aus der Unarmored-Spalte** verwendet. Dadurch keine Matrix-Brüche (z. B. Siege bleibt konsistent).

### 12.2 Immunitäts-Flags (aus §2.5)
- **Shielded** (Schild-HP)
- **Camo** (Detection nötig)
- **Regen** (Burn kontert)
- **Phasing** (Slow immun)
- **Aura** (Buff-Aura)

Split stand ebenfalls in dieser Liste; er ist gebaut (§2.5).

### 12.3 Upgrade-Pfade je Tower (aus §3.3 bis §3.9 und §7.2)

Gebaut sind nur die Tracks aus §3.2. Geplant waren:

- **Archer, Upgrade-Pfad 3 (Air):**
  - Level 1: „Flak-Pfeile“: schaltet Air-Targeting frei (kein reines „Priorisieren“)
  - Level 2: +30% Reichweite vs. Air
  - Level 3: +20% Trefferchance auf schnelle Air
  - Spezialisierungen: Falkenauge (Camo-Detection) oder Durchschlagsbolzen.
- **Dual-Gatling, Air-Path:** L1 „AA-Gurt“: Air-Targeting frei, L2 Reichweite
  vs Air, L3 Schaden vs Air. Gebaut ist stattdessen die Forschung AA Retrofit.
- **Cannon, Armor Break Path:** L3 „Risse im Panzer“: **Armor Break** (4s,
  Unarmored-Logik). Dazu ein Air-Upgrade-Pfad (aus §7.2).
- **Rocket:** späterer Pfad „Bodenfreigabe“ erlaubt Ground.
- **Fire:** Air via Upgrade „Luftflamme“.

### 12.4 Gegner (aus §4)

| Enemy | Armor | Flags/Eigenschaften | Rolle |
|---|---|---|---|
| **Lich (Boss)** | Ethereal | Aura | Endgame-Boss |
| **Slime** | Unarmored | Regen, Split | Regen-Check |
| **Banshee** | Ethereal | Phasing | Slow-Check |

Außerdem waren geplant: **Spider** mit Camo (Camo-Check), **Mech** mit
Shielded und `immuneToBurn` (Shield-Check), **Dragon** mit Boss-Flag
(Air-Boss). Gebaut sind Spider und Mech ohne diese Flags und Dragon ohne
`isBoss`; die Boss-Welle mit Drachen ist das Template `boss_dragon`. Ooze und
Slime Clump (§4) sind etwas anderes als der geplante Slime: sie haben keinen
Regen.

### 12.5 Kill-Reward-Formel (aus §5.1)

Stand als „final" im Dokument, gebaut ist stattdessen das Kill-Budget (§5.1).
Einen `WaveFactor` gibt es im Code nicht.

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

### 12.6 Air-Pacing und Camo (aus §6.5 und §7.1)
- Nach der Kampagne sollte der Director Luft dynamisch setzen, mit
  - **MIN_AIR_GAP = 4** Waves
  - **AIR_WARNING_LEAD = 2** Waves
  - **Air nur wenn Anti-Air vorhanden** (Ice oder AA-Upgrades)
- Ethereal nur wenn Magic/Ice erforscht.
- Camo nur wenn Detection erforschbar.

Gebaut ist das Gate aus §6.5: Luft und Ethereal ab W31 nur mit einem
platzierten Tower, der sie trifft; die Konstanten gibt es nicht. Die UI-Warnung
schaut zwei Wellen voraus (§7.1).

### 12.7 Soft Counter und Heuristik (aus §8.2 und §8.3)

| Ebene | Status |
|---|---|
| **Soft Counter** (+20–30% Spawn-Rate eines Konters) | **nicht implementiert**, Design-Absicht |

| Spieler-Schwäche | AI-Antwort |
|---|---|
| Kein Siege | mehr Heavy/Fortified (soft) |
| Kein Magic/Ice | Ethereal-Teaser + Ghost-Check (hard einmalig) |
| Kein Anti-Air | keine Air, stattdessen Ground-Check |
| Nur Siege | Swarm + Light |

### 12.8 Visuelles Feedback (aus §9)
- **Armor-Icons** am HP-Bar-Rahmen.
- **Ethereal**: lila/transparenter Shader.

### 12.9 Wave-für-Wave-Planung vor der Kampagne (aus §10)

Die Design-Absicht vom Mai 2026. `CAMPAIGN` weicht davon ab, unter
anderem: Luft ab W7, Herbert als Boss auf W10, W20 und W30, kein Lich, keine
Camo- und Shield-Wellen.

**Wave 1**: Unarmored (Zombie/Rat). Nur Archer verfügbar. Start-Credits 100.
**Wave 2**: Swarm-Pressure. Nach Wave 1 reicht es für Forschungszentrum (200 Gold aus W1). Erste Forschung starten (z.B. Gatling Tech, 15s).
**Wave 3**: Gatling/Ice sollte erforscht sein. Light Armor-Teaser (Wallsmasher). Zweite Forschung starten.
**Wave 4**: Mehr Tower verfügbar. Upgrade-Entscheidungen.
**Wave 5**: Light-Wave, Ice-Slow relevant (falls erforscht).
**Wave 6**: **Teaser Air (1-2 Bats)**. Ice muss erforscht sein für Anti-Air. Siege/Magic-Forschung läuft.
**Wave 7**: Heavy-Teaser (Zombie Soldier). Cannon/Magic sollte verfügbar werden.
**Wave 8**: **Erste reine Air-Wave (fix)**. Anti-Air verfügbar (Ice oder AA Retrofit).
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
**Wave 20**: **Air-Elite** (1 Dragon). T2-Upgrades sollten verfügbar sein.
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
