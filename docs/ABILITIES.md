# Fähigkeiten (Player Abilities)

**Stand:** 2026-09-14. Konzept und Entscheidungen zum Nuklearschlag:
[PLAYER_AGENCY_CONCEPT.md](game-design/PLAYER_AGENCY_CONCEPT.md), Abschnitte 5,
7 und 8. Die weiteren Fähigkeiten folgen seinem Muster: eigene Forschung, eine
Ladung, eine neue nach je 3 abgeschlossenen Wellen, eigene Taste, Knopf in der
Fähigkeitenleiste, Befehl über `command:use-ability`, Kills zählen als Leck.

| Fähigkeit | Im Spiel | Taste | Wirkung |
|---|---|---|---|
| Nuklearschlag | Nuclear Strike | K | Max-HP-Anteil im Radius |
| Frostbombe | Frost Bomb | F | Freeze im Radius |
| EMP | EMP | E | Stun im Radius, Maschinen länger |
| Orbitallaser | Orbital Laser | L | Strahl läuft die Route entlang Richtung Spawn, Feuerschaden |

Eine Fähigkeit ist eine Aktion des Spielers während einer Welle, im Gegensatz
zum Tower, der von selbst handelt. Sie wird per Forschung freigeschaltet, hat
Ladungen und lädt pro abgeschlossener Welle nach, nicht in Spielzeit: zwischen
den Wellen läuft die Spielzeit weiter, und ein Cooldown in Spielzeit ließe sich
durch Warten vor dem Wellenstart füllen.

---

## Nuklearschlag in Zahlen

Alle Werte stehen in `configs/abilities.config.ts` (`ABILITIES['nuclear-strike']`).

| Punkt | Wert |
|---|---|
| Freischaltung | Forschung `nuclear-strike`: 1.000 Gold, 40 s, Voraussetzung `advanced-weaponry`. Die Forschung gibt die erste Ladung |
| Ladungen | 1, höchstens 1. Eine neue nach je 3 abgeschlossenen Wellen; die Welle des Einsatzes zählt mit. Solange die Ladung steht, sammeln Wellen nichts an |
| Einsatz | nur während einer Welle |
| Ziel | Klick; der Einschlag liegt auf der Mitte der nächsten Route-Zelle im Umkreis von 30 m, sonst wird abgelehnt |
| Vorwarnung | 1500 ms Spielzeit, das sind 90 Sub-Steps à 16,667 ms |
| Wirkung | Radius 25 m, gemessen in 2D, also Boden und Luft; 60 % der Max-HP, Bosse (`isBoss`) 20 %; an der Schadensmatrix vorbei (`effect` der Art `max-hp-fraction`) |
| Gold | jeder Kill zahlt seinen Anteil am Kill-Budget der Welle wie jeder andere; kein Tower bekommt ihn gutgeschrieben. Ein getötetes Skeleton splittet wie bei jedem Kill |
| Wave-Director | Kills zählen im Fairness-Gate als Leck (siehe unten) |

Bosse: `isBoss` tragen `herbert`, der Wurm und die Ooze (Boss-Varianten ab W35). Steingolem und
Drache führen die späteren Boss-Wellen an, laufen aber auch in `golem_squad` und
`dragon_elite` mit, und das Flag gilt pro Typ.

Die Ooze liegt als Körper entlang der Route (ENEMY_CREATION.md). Der Schlag
trifft sie, sobald sein Radius irgendeinen Punkt ihres Körpers erreicht
(`GlobalRouteGrid.getEnemiesInRadius`), einmal und mit dem Boss-Anteil; ihr
Todesblut liegt an dem Punkt, den der Kreis erreicht.

---

## Frostbombe in Zahlen

`ABILITIES['frost-bomb']`, Wirkung `freeze` (Status Freeze, siehe
[STATUS_EFFECTS.md](STATUS_EFFECTS.md#freeze-stopp)).

| Punkt | Wert |
|---|---|
| Freischaltung | Forschung `frost-bomb`: 700 Gold, 25 s, Voraussetzung `arcane-studies` |
| Ladungen | wie der Nuklearschlag: 1, eine neue nach je 3 abgeschlossenen Wellen |
| Ziel | Klick, Route-Zelle im Umkreis von 30 m |
| Vorwarnung | 500 ms Spielzeit, 30 Sub-Steps |
| Wirkung | Radius 20 m in 2D, Boden und Luft: Freeze für 3000 ms, Bosse 1000 ms. Kein Schaden. Eingefrorene Luftgegner hängen still in der Luft |
| Wave-Director | `hits` sind die Eingefrorenen, `kills` 0; was die Tower währenddessen töten, sind normale Kills |

**Warum diese Zahlen.** Der Ice Tower bremst auf die Hälfte für 3 s; die
Frostbombe hält 3 s ganz an, einmal alle 3 Wellen. Ein Zombie (5 m/s) verliert
15 m Weg, ein Tank (3 m/s) 9 m, das ist ein Moment mehr Feuer auf eine Gruppe,
kein Wellengewinn. Der Radius liegt unter dem des Nuklearschlags (20 statt
25 m). Die Forschung setzt Arcane Studies voraus: Mit Ice Magic (400) und
Arcane Studies (650) kostet der Weg dahin 1.750 Gold Forschung, frühestens um
W5 bis W6, praktisch nach dem ersten Luftangriff (W7), also nicht in den
ersten Wellen, die das Curriculum ohne Fähigkeiten austariert. Bosse bleiben
nur 1 s stehen, damit ein Boss-Lauf nicht mit einer Taste halbiert wird.

---

## EMP in Zahlen

`ABILITIES['emp']`, Wirkung `stun` (Status Stun, siehe
[STATUS_EFFECTS.md](STATUS_EFFECTS.md#stun-stopp-elektrisch)).

| Punkt | Wert |
|---|---|
| Freischaltung | Forschung `emp`: 800 Gold, 30 s, Voraussetzung `storm-mastery` |
| Ladungen | wie der Nuklearschlag: 1, eine neue nach je 3 abgeschlossenen Wellen |
| Ziel | Klick, Route-Zelle im Umkreis von 30 m |
| Vorwarnung | 500 ms Spielzeit, 30 Sub-Steps |
| Wirkung | Radius 30 m in 2D, Boden und Luft: Stun, Maschinen (`mechanical`, Stand heute Tank und Mech) 6000 ms, Bosse 750 ms (auch ein Boss, der Maschine ist), alle anderen 1500 ms. Kein Schaden |
| Wave-Director | `hits` sind die Betäubten, `kills` 0 |

**Warum diese Zahlen.** Was eine Maschine ist, steht als Feld am Gegnertyp
(`EnemyTypeConfig.mechanical`), nicht in der Fähigkeit. Ein Tank (3 m/s)
verliert in 6 s 18 m Weg, ein Zombie (5 m/s) in 1,5 s 7,5 m: gegen eine
Maschinenwelle ist das EMP die stärkere Kontrolle, gegen alles andere eine
kurze. Der Radius ist deshalb größer als bei der Frostbombe (30 statt 20 m).
Die Forschung hängt an Storm Mastery (Lightning Tower); mit Ice Magic, Arcane
Studies und Storm Mastery kostet der Weg 2.550 Gold Forschung, sie kommt also
nach den ersten Wellen. Im Curriculum laufen Maschinen sicher in W9 und W22
(`tank_column`) und W28 (`mech_army`).

---

## Orbitallaser in Zahlen

`ABILITIES['orbital-laser']`, Wirkung `beam`.

| Punkt | Wert |
|---|---|
| Freischaltung | Forschung `orbital-laser`: 1.500 Gold, 45 s, Voraussetzung `master-engineering` |
| Ladungen | wie der Nuklearschlag: 1, eine neue nach je 3 abgeschlossenen Wellen |
| Ziel | Klick; der Strahl setzt auf dem Punkt der Gegnerroute auf, der dem Klick am nächsten liegt (Route-Polylinie, nicht Route-Zelle), im Umkreis von 30 m, sonst abgelehnt. Bei mehreren Routen die nächste, bei Gleichstand die erste in Spawn-Reihenfolge |
| Vorwarnung | 1000 ms Spielzeit, 60 Sub-Steps |
| Weg | vom Aufsetzpunkt die Route zurück Richtung Spawn-Portal, 18 m/s für 4000 ms, also höchstens 72 m (`abilityBeamReachM`). Beginnt die Route früher, endet der Strahl dort früher |
| Wirkung | Radius 5 m um den Strahl in 2D, Boden und Luft. Je Sub-Step verliert jeder Gegner darunter 100 % seiner Max-HP pro Sekunde mal Sub-Step-Länge, mal dem Multiplikator von `fire` gegen seine Rüstung (Schadensmatrix), Bosse 30 % pro Sekunde; über den ganzen Strahl höchstens 60 %, Bosse 20 % (`abilityBeamFraction`, `abilityBeamCap`). Der Schaden läuft über `DamageApplicationService.applyMaxHpFraction` wie beim Nuklearschlag, kein Tower bekommt Kill oder Schaden gutgeschrieben |
| Wave-Director | `ability:resolved` kommt nach dem letzten Tick: `hits` sind die Gegner, die der Strahl getroffen hat, `kills` alle seine Kills. Sie zählen als Leck wie beim Nuklearschlag |

**Richtung.** Der Strahl läuft gegen den Strom, vom Klick Richtung Spawn:
Er trifft die Kolonne frontal, jeden Gegner des Abschnitts einmal, und ein
Klick vor die Spitze einer Gruppe brennt sich durch die Gruppe dahinter. Mit
dem Strom Richtung HQ hätte ein Strahl in Gegnertempo dieselben wenigen
Gegner lange getroffen und wäre auf das HQ zugelaufen.

**Warum diese Zahlen.** Ein Gegner steht frontal etwa 10 m / (18 + v) m/s
unter dem Strahl: ein Zombie (5 m/s) 0,43 s, ein Tank (3 m/s) 0,48 s. Mit
Feuer 1,5 gegen ungepanzert erreicht ein Zombie in 0,4 s die 60 %-Kappe, ein
leichter Gegner (1,2) knapp, ein Tank (schwer, 0,6) verliert gut 25 %, ein
Golem oder Mammut (befestigt, 0,25) um 10 %, Geister (ätherisch, 0,1) kaum
etwas; Bosse (Herbert, befestigt) um 3 %. Die Kappe ist die des
Nuklearschlags: Der Laser nimmt keinem Gegner mehr als der Schlag, reicht
aber 72 m die Route entlang statt 25 m um einen Punkt und zeigt über die
Schadensart, wogegen er taugt (die Schwächen stehen in der NEXT-Zeile des
WAVE-Panels). Die Kappe hält auch einen eingefrorenen oder langen Gegner (der
Gallert-Boss, der eine Strecke der Route einnimmt) bei 60 % beziehungsweise
20 %. Die Forschung hängt an Master Engineering (T3-Upgrades, laut
Bot-Planung W15 bis W18), hinter dem Nuklearschlag.

---

## Ablauf

```
UI (AbilityTargetingService)            Bot (NuclearStrikeStrategy)
          └────────── command:use-ability { abilityId, target } ─────────┘
                                   │
                    GameCommandsHandler → AbilityManager.use()
                                   │  Forschung, Ladung, Wellenphase
                                   │  Ziel auf die Route-Zelle snappen (30 m)
                  ┌────────────────┴────────────────┐
         ability:rejected { reason }     ability:used { strikeId, target, radiusM, warningMs }
                                                    + ability:state-changed
GameStateManager.runSubStep
  researchManager.update → abilityManager.update(stepMs)     Countdown in Spielzeit
                                   │  nach 90 Sub-Steps
       GlobalRouteGridService.getEnemiesInRadiusGeo (25 m)
       CombatEffectService.applyAbilityStrike
       DamageApplicationService.applyMaxHpFraction           matrixfrei, kein Tower-Kill
                                   │
       ability:impact { target, radiusM }, ability:resolved { hits, kills }
                                  + ability:state-changed
```

| Event | Abnehmer |
|---|---|
| `ability:used` | VFXService (Zielmarker), je `abilityId` |
| `ability:impact` | VFXService, AudioService, ScreenShakeService, je `abilityId` (siehe [Darstellung](#darstellung)) |
| `ability:resolved` | AIDataCollectorService (`abilityKills`, alle Fähigkeiten). Beim Nuklearschlag im selben Sub-Step direkt nach `ability:impact` |
| `ability:rejected` | niemand fest; die UI prüft vor dem Klick selbst |
| `ability:state-changed` | GameStateSyncService → `GameStore.abilities` |

Gründe für `ability:rejected`: `unknown`, `locked`, `no-charge`, `no-wave`,
`no-route`. Die Ladung wird mit dem Befehl verbraucht, nicht beim Einschlag.

---

## Determinismus

- Der Befehl wirkt beim Emit wie die anderen Commands; der Countdown beginnt im
  nächsten Sub-Step und wird pro Sub-Step um 16,667 ms verringert.
- Kein Zufall. Die Radius-Abfrage liefert die Gegner in Zellen-Reihenfolge; das
  Ergebnis hängt davon nicht ab, jeder Gegner verliert seinen eigenen Anteil.
- Ein Strahl (Orbitallaser) brennt nach dem Einschlag Sub-Step für Sub-Step
  weiter: Er steht nach verbrannter Zeit mal 18 m/s auf dem Weg, den der
  Manager beim Befehl gefegt hat (`routeSweepToward` in
  `utils/route-sweep.ts`, reine Geometrie auf den Routen des WaveManager), und
  trifft dort, was im Radius steht. Der Einschlag-Sub-Step brennt den ersten
  Tick; 4000 ms sind 240 Ticks, `ability:resolved` kommt im Sub-Step des
  letzten.
- Die Welle endet nicht, solange ein Schlag unterwegs ist oder ein Strahl
  brennt (`AbilityManager.hasPendingStrikes()` in der Sub-Step-Schleife vor
  `checkWaveComplete()`); beim Orbitallaser höchstens 5 s nach dem Befehl. Stirbt oder leakt der Rest der Welle in der
  Vorwarnung, bleibt die Welle bis zum Einschlag offen, höchstens 1,5 s
  Spielzeit, und endet im Sub-Step des Einschlags. Der Schlag landet damit immer
  in seiner Welle: nie in der Aufbauphase und mit Auto-Start nie in der nächsten
  Welle, deren Kills und `abilityKills` er sonst verfälschte.
- Nachweis: `integration/ability-strike.spec.ts` schickt den Befehl über den
  echten Sub-Step-Loop des GameStateManager mit echten Gegnern und dem echten
  Schadensweg. Der Einschlag liegt auf Sub-Step 90 nach dem Befehl, und HP,
  Kills und Gold sind bei Timescale 1 und 10 gleich.
- Im Mehrspielerbetrieb wäre `command:use-ability` der achte Command und liefe
  über dieselbe Pipeline ([MULTIPLAYER_CONCEPT.md](MULTIPLAYER_CONCEPT.md) §4.3).

---

## Wave-Director und Gate

Entscheidung 6.1 b: Kills durch Fähigkeiten zählen für den Leck-Regler als
Leck. Der Einsatz rettet HP und Gold in seiner Welle, macht aber die Wellen
danach nicht größer.

- `AIDataCollectorService` addiert die `kills` jedes `ability:resolved` einer
  Welle in `WaveOutcome.abilityKills`.
- `gateLeakRatio(progress, abilityKills)` (`ai/core/gate-controller.ts`) zählt
  sie zu den Ankünften. Ein getroffener Gegner hat als Fortschritt die Stelle,
  an der er starb, also unter 1, und zählt dadurch genau einmal.
- Split: Ein Skeleton, das der Schlag tötet, geht durch `EnemyManager.kill()`
  mit der Ursache `'combat'` und splittet wie bei jedem Kill. Die Minions
  entstehen erst nach der Zielliste, bekommen keinen Schaden und zählen nicht
  in `abilityKills`. Als eigene Körper stehen sie im Nenner; ein
  durchgelaufener Minion ist ein Leck, ein von Towern getöteter keins.
- Das Trainings-Backend spiegelt das in `gate_leak_share` (`server.py`), nur für
  das Gate. Der Reward liest weiter nur die Ankünfte (`leakRatio`).
- Im DPS-Modell des Directors taucht die Fähigkeit nicht auf (punktuell).

---

## Darstellung

**Zielmarker** (`three-engine/renderers/ability-marker.renderer.ts`): orange
Ring im Strike-Radius über einer schwach pulsierenden Scheibe, dazu ein
goldener Ring, der sich in Spielzeit vom Radius auf die Mitte zusammenzieht.
Flache Meshes mit Standard-Materialien, Tiefentest aus, damit der Marker
zwischen Gebäuden lesbar bleibt.

**Einschlag: Atompilz** (`MUSHROOM_CLOUD_LOOK` in `visual-effects.config.ts`,
gezeichnet von `three-engine/renderers/mushroom-cloud.renderer.ts`). Er läuft
in Spielzeit: Pause (P) hält ihn an, der Timescale spielt ihn schneller ab.
Zeiten in Spielsekunden nach dem Einschlag, Längen bei 25 m Radius; sie
skalieren mit dem Radius. Nach dem Playtest 2026-09-13 ("es fehlt an
optischem Wumms") ist die Detonation dichter gestaffelt und der Pilz etwa
doppelt so hoch:

| Zeit | Phase |
|---|---|
| 0 bis 0,55 s | Blitz: additiver Sprite (150 m, dreifache Helligkeit) über dem Einschlag, dazu eine Aufhellung des ganzen Bildes, Spitze 0,65, quadratisch abklingend. Mit Bloom an (VFX-Einstellungen) zieht der Blitz 0,9 s lang die Bloom-Stärke von 0,3 auf bis zu 1,4 und die Schwelle von 0,85 auf 0,55 |
| 0 bis 0,6 s | Weißglühender Kern im Feuerball |
| 0 bis 0,75 s | Schockkuppel: helle Halbkugel, am Umriss am hellsten, bis 46 m |
| 0,05 bis 1,05 s | Zweite Feuerfront: flache Schale aus Feuer, läuft bis 38 m aus |
| 0 bis 1,6 s | Druckwelle: heller Ring am Boden bis 70 m, auf ihrer Front eine Staubwand, die bis 3,2 s stehen bleibt |
| 0 bis 3,1 s | Feuerball: Halbkugel am Boden, in 0,15 s auf 18 m, ihr Zentrum schießt in der ersten halben Sekunde 14 m hoch; bis 0,7 s von weißglühend zu orange; ab 0,5 s steigt er in die Kappe |
| 0 bis 2,9 s | Glutbrocken: 48 Funkenschweife fliegen mit 22 bis 55 m/s nach außen und oben, gebremst von Luft und Schwerkraft, und verlöschen am Boden |
| 0,35 bis 7,5 s | Bodenfeuer: flackernde Glut bis 24 m um den Stammfuß |
| ab 0,05 s | Staub: Bodenwalze bis etwa 50 m, dazu dunklerer Staub am Stammfuß |
| ab 0,3 s | Stamm: Rauch steigt in die Kappe, am Fuß breit, unten anfangs feuerbeleuchtet; bis 3,8 s Feuer im Kern |
| ab 0,35 s | Kappe: Rauch-Torus, schießt in der ersten Sekunde auf gut 55 m und steigt dann langsam weiter, bei 5 s knapp 100 m, beim Auflösen über 110 m. Rollt oben nach außen und unten nach innen, in Wülsten, die um den Stamm wandern. Oben dunkel, die Unterseite glüht bis etwa 7,5 s orange (additive Randglut), eine Kuppel deckt die Mitte |
| 0,5 bis 3,8 s | Kondensationsring (Wilson-Wolke): weißer Ring um den Stamm auf halber Höhe, breitet sich von 8 auf 42 m aus |
| 8 bis 14 s | Auflösen: breiter und höher, treibt mit dem Wind, blendet aus |

Budget: 432 additive Partikel (Explosions-Atlas, davon 192 für die 48
Glutschweife à 4 Punkte) und 546 Rauchpartikel (Rauch-Atlas) pro Pilz, in
eigenen Puffern für zwei gleichzeitige Pilze (864 und 1092), nicht in den
Trail-Pools. Vor dem Playtest-Nachtrag waren es 106 und 270. Details in
[PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md#atompilz-nuklearschlag).

**Brandflecken:** auf dem Einschlagpunkt und auf zwei Ringen, 6 bei 0,45 und 9
bei 0,85 des Radius (`NUCLEAR_STRIKE_SCORCH_RINGS`), alle beim Einschlag, nur
auf Route-Zellen und mit Ground Marks an.

**VFX-Einstellungen:** Mit Impact Effects aus (Preset Low) bleibt die
Detonation: Blitz mit Bildaufhellung, Kern, Feuerball, zweite Feuerfront,
Schockkuppel und Druckwelle; kein Rauch, keine Glutbrocken, kein Bodenfeuer.
Bloom ist im Low-Preset aus und damit auch der Bloom-Kick. Bis 2026-09-13 bestand der Einschlag aus
gestaffelten Feuer-Atlas-Explosionen auf Wanduhr-Timern, und Low zeigte davon
nichts.

**Massentode:** Todesblut nur für die ersten `ABILITY_DEATH_BLOOD_CAP` (24)
Kills eines Schlags. Jede Blutwolke sind 40 Partikel im normalen Pool und ein
Decal mit Terrain-Raycast; 200 auf einmal liefen über den Pool. Der
Blut-Decal-Pool (100) verdrängt ohnehin seine ältesten Decals. Die
Gold-Floating-Texts eines Schlags (je bezahltem Kill einer) bleiben unter dem
Limit von 2048 Instanzen.

**Shake und Sound:** Screen-Shake `nuclearStrike` 0,014 der Bildhöhe für
1600 ms (vorher 0,008 für 700 ms). Er nimmt mit der Entfernung zur Kamera ab
wie bei Einschlägen, aber mit eigener Reichweite: voll bis 350 m, keiner mehr
ab 1500 m (`strikeNearDistance`, `strikeFarDistance`); aus der
Übersichtskamera (etwa 425 m) bleiben gut 90 %. Der Schalter Screen Shake in
den Display Options gilt auch hier. Sound `nuclear_strike`: das vorhandene
`explosion.mp3` (1,3 s), lauter und mit größerer Reichweite, dazu nach 350 und
900 ms zwei leisere Wiederholungen (55 und 35 % der Lautstärke) als Grollen
(`GAME_SOUNDS.nuclearStrike.tail`). Die Wiederholungen laufen in Spielzeit
(`AudioService.update()` je Sub-Step): eine Pause hält sie an, höheres Tempo
verkürzt sie, `game:reset` verwirft ausstehende. Eine
Warnsirene gibt es nicht, im Repo liegt kein passendes Sample.

**Frostbombe:** derselbe Zielmarker in 20 m. Beim Einschlag der Frostausbruch
(`FrostBurstRenderer`, `FROST_BURST_LOOK`, in Spielzeit wie der Atompilz):
weiß-cyaner Blitz, Kältering bis 1,15 × Radius, Reif über dem Radius, der
genau so lange hält wie der Freeze (3 s) und dann in 1 s ausblendet, 64
Eissplitter, die liegen bleiben, bis sie verlöschen, und ein niedriger
Nebelring. Mit Impact Effects aus nur Blitz, Ring und Reif. Dazu Frostflecken
(die Eis-Decals des Ice Towers) auf dem Einschlag und auf zwei Ringen, 6 bei
0,45 und 10 bei 0,85 des Radius (`FROST_BOMB_ICE_RINGS`), nur mit Ground Marks
an. An den Gegnern der Eis-Tint und die Eiskristalle des Freeze. Ton
`frost_bomb`: der Cast des Ice Towers, lauter und weiter hörbar, mit zwei
schnellen leiseren Wiederholungen nach 110 und 260 ms als Knistern. Shake
`frostBomb` 0,004 für 350 ms, voll bis 150 m, keiner ab 700 m
(`abilityNearDistance`, `abilityFarDistance`); aus der Übersichtskamera
bleibt etwa die Hälfte.

**EMP:** derselbe Zielmarker in 30 m. Beim Einschlag der Puls
(`EmpPulseRenderer`, `EMP_PULSE_LOOK`, in Spielzeit): blau-weißer Blitz, zwei
elektrische Fronten, die gezackt und knisternd über den Radius laufen, eine
schwache Hülle darüber und Funken entlang der ersten Front. An den Gegnern
Tint und Funken des Stun. Ton `emp`: der Kettenblitz des Lightning Towers,
lauter, mit zwei leiseren Wiederholungen nach 180 und 420 ms. Shake `emp`
0,005 für 450 ms, dieselbe Reichweite wie die Frostbombe. Keine Bodenspuren.

**Orbitallaser:** während der Vorwarnung der Zielmarker im Strahlradius
(5 m) und ein orangefarbenes Band so breit wie der Strahl über den Weg, den er
nehmen wird (`ability:used` trägt ihn als `path`). Beim Einschlag verschwindet
beides und der Strahl kommt herunter (`OrbitalBeamRenderer`,
`ORBITAL_BEAM_LOOK`, in Spielzeit): eine Lichtsäule 320 m hoch, weißglühender
Kern, orange Glut, mit Tiefentest, sodass Gebäude davor sie verdecken; am Fuß
ein Glühen, ein Ring im Strahlradius, Funken und alle 3 m des Wegs ein
Brandfleck (Quelle `rocket`, mit Ground Marks an). Der Fuß läuft mit 18 m/s
die Route entlang wie in der Simulation und endet mit ihr. Ton
`orbital_laser`: der Blitz des Lightning Towers, nach 1,3 und 2,5 s noch
zweimal leiser, damit das Knistern etwa so lange dauert wie der Strahl. Shake
`orbitalLaser` 0,003 für 1200 ms, dieselbe Reichweite wie Frostbombe und EMP.

**Je Fähigkeit:** VFX, Ton und Shake wählen nach der `abilityId` im Event aus
je einer Tabelle: `abilityVfx` im VFXService (was `ability:used` und
`ability:impact` zeigen), `ABILITY_IMPACT_SOUNDS` in `audio.config.ts` und
`ABILITY_IMPACT_SHAKE` in `visual-effects.config.ts`. Alle drei sind
vollständig je `AbilityId` typisiert, eine neue Fähigkeit kompiliert erst mit
ihren Einträgen; bei Ton und Shake heißt `null` keiner. Für den
Nuklearschlag stehen dort die Werte von oben, sein Verhalten ist dasselbe.
`game:reset` räumt Marker, Pilze und ausstehende Wiederholungen aller
Fähigkeiten.

---

## Bedienung

Knopf in der Fähigkeitenleiste am linken Rand des Spielfelds (siehe unten,
Aussehen in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#fähigkeitenleiste-canvas)). Bis
zur fertigen Forschung steht er gesperrt da, sein Tooltip nennt die Forschung
und ihren Preis. Ein Druck schaltet den Zielmodus ein (`UIStore.abilityTargeting`,
geführt vom `AbilityTargetingService`):

- Ein Ring im Strike-Radius folgt dem Cursor, gesnappt auf die Route-Zelle, auf
  der der Schlag landen würde: gold, wo er landet, rot mit dem Hinweis
  "No route within 30 m", wo keine Zelle in Reichweite ist. Beim Orbitallaser
  sitzt der Ring, wo der Strahl aufsetzen würde, und ein goldenes Band zeigt
  den Weg, den er brennen würde (`AbilityManager.previewSweep`).
- Linksklick feuert und verlässt den Modus; auf einem ungültigen Punkt bleibt
  der Modus an. Tower-Auswahl und Bauen sind im Modus aus.
- Esc und ein kurzer Rechtsklick brechen ab. Wellenende, verbrauchte Ladung,
  Build-Mode und Kartenplatzierung beenden den Modus ebenfalls.
- Die Taste der Fähigkeit (Nuklearschlag: K) wirkt wie ein Klick auf den Knopf (`AbilityConfig.hotkey`, aufgelöst in
  `services/hotkey-map.ts`, ausgeführt vom `HotkeyService`): schaltet den
  Modus an, wenn der Schlag feuern kann, ein zweiter Druck schaltet ihn ab. Die
  Tastenübersicht (H) führt die Taste auf.

### Fähigkeitenleiste

`app-ability-bar` (`components/ability-bar/`) zeigt jede Fähigkeit aus
`ABILITIES`, in der Reihenfolge der Einträge, und liest ihren Zustand aus
`GameStore.abilities`. Was ein Knopf zeigt, kommt aus dem Eintrag und dem
Snapshot des `AbilityManager`:

| Anzeige | Quelle |
|---|---|
| Icon | `AbilityConfig.icon` (td-icon) |
| Taste oben rechts, Tastenkappe im Tooltip | `AbilityConfig.hotkey` |
| gesperrt, Forschung und Preis im Tooltip | `AbilityStatus.unlocked`, `AbilityConfig.researchId` |
| Ladungen (als Zahl nur ab `maxCharges` 2) | `AbilityStatus.charges` |
| ein Strich je Welle bis zur nächsten Ladung | `AbilityConfig.rechargeWaves`, `AbilityStatus.wavesUntilCharge` |
| Schlag unterwegs | `AbilityStatus.pending` |
| Zielmodus an | `AbilityTargetingService.targeting()` |

Zustand und Texte berechnen `abilityButtonView()` und `abilityTooltip()`
(`ability-bar/ability-button.ts`), reine Funktionen mit Spec.

**Held.** Über den Fähigkeiten ist Platz für den Knopf des Helden. Die Leiste
kennt den Helden nicht, sie bekommt ihn als Eingang und meldet den Druck:

```html
<app-ability-bar [hero]="heroBar()" (heroPressed)="onHeroBarPressed()" />
```

`hero` ist ein `AbilityBarHero` (`icon`, `name`, `hotkey` oder null,
`selected`, optional `detail` als Tooltip-Zeile) oder `null`, der Standard;
dann fehlen Knopf und Trennlinie. Was ein Druck tut (auswählen, Kamera
hinfahren), entscheidet der Aufrufer. Im Spiel füllt ihn `heroBarView()`
(`ability-bar/hero-bar.ts`): erst das Anheuern, dann der Held, siehe
[HERO.md](HERO.md#bedienung).

Zum Testen: Cheat "Abilities" im Dev-Menü (Gruppe Cheats; bis 2026-09-14
"Nuke", nur für den Nuklearschlag). Er schließt für jede Fähigkeit aus
`ABILITIES` die Forschung samt Voraussetzungen ab
(`ResearchManager.completeResearch`, je Forschung ein `research:completed`) und
füllt die Ladungen auf (`AbilityManager.refillCharges`), beliebig oft
hintereinander. Die UI schickt je Fähigkeit ein `debug:ready-ability`
verzögert (`emitDeferred`), der `GameCommandsHandler` setzt es im nächsten
Sub-Step um; in der Pause erst beim Weiterlaufen. Feuern geht weiter nur
während einer Welle.

---

## Bot

- Aktion `use-ability` mit `abilityId` und Ziel (`position`, x = lon, z = lat);
  `TrainingSession` schickt sie als `command:use-ability`.
- `NuclearStrikeStrategy` (Priorität 97, über allen anderen) feuert während
  einer Welle, sobald der Schlag bereit ist und mindestens 10 Gegner im letzten
  Fünftel ihrer Route stehen (Pfadfortschritt ab 0,8). Ziel ist der Gegner in
  diesem Abschnitt mit den meisten anderen im Radius; geprüft werden höchstens
  48 Kandidaten.
- Die Factory hängt die Strategie an alle Skill-Stufen. Erforschen tun sie nur
  strategist und meta; für beginner und casual bleibt sie wirkungslos. Folge
  für Messungen: siehe [BOT_SYSTEM.md](BOT_SYSTEM.md#nuclearstrike-97).
- `FrostBombStrategy` (96): wirft die Frostbombe auf die dichteste Gruppe von
  mindestens 8 Gegnern in der zweiten Hälfte der Route
  ([BOT_SYSTEM.md](BOT_SYSTEM.md#frostbomb-96)).
- `EmpStrategy` (94): setzt das EMP auf mindestens 3 Maschinen beisammen ab
  Pfadfortschritt 0,4, sonst auf eine Menge von mindestens 12 Gegnern ab 0,6
  ([BOT_SYSTEM.md](BOT_SYSTEM.md#emp-94)).
- `OrbitalLaserStrategy` (93): zielt auf den Gegner ab Pfadfortschritt 0,5
  mit den meisten Gegnern hinter sich auf derselben Route in 72 m, ab 10
  ([BOT_SYSTEM.md](BOT_SYSTEM.md#orbitallaser-93)).

---

## Dateien

| Datei | Rolle |
|---|---|
| `configs/abilities.config.ts` | Werte, `AbilityStatus`, Ablehnungsgründe |
| `managers/ability.manager.ts` | Ladungen, Nachladen, Zeitplan und Auflösung der Einschläge |
| `managers/game-commands.handler.ts` | `command:use-ability`, Cheat `debug:ready-ability` |
| `services/combat/damage-application.service.ts` | `applyMaxHpFraction`, der matrixfreie Schadensweg |
| `services/world/global-route-grid.service.ts`, `utils/global-route-grid.ts` | `snapToRouteCell`, `findNearestCell` |
| `ai/core/gate-controller.ts` | `gateLeakRatio` |
| `services/ability-targeting.service.ts` | Zielmodus |
| `components/ability-bar/` | Fähigkeitenleiste; `ability-button.ts`: Zustand und Tooltip der Knöpfe |
| `services/hotkey-map.ts` | Taste je Fähigkeit aus `AbilityConfig.hotkey` |
| `three-engine/renderers/ability-marker.renderer.ts` | Zielmarker und Zielring |
| `three-engine/renderers/mushroom-cloud.renderer.ts` | Atompilz des Einschlags |
| `three-engine/renderers/frost-burst.renderer.ts` | Frostausbruch der Frostbombe |
| `three-engine/renderers/emp-pulse.renderer.ts` | Puls des EMP |
| `three-engine/renderers/orbital-beam.renderer.ts` | Strahl des Orbitallasers |
| `utils/route-sweep.ts` | Weg des Strahls: Routenabschnitt vom Aufsetzpunkt Richtung Spawn, Punkt nach Metern |
| `services/combat/combat-effect.service.ts` | `applyAbilityStrike`, `applyAbilityHalt` (Freeze und Stun über den `StatusEffectService`) |
| `three-engine/post-processing/bloom-kick.ts` | Bloom-Kick des Blitzes, stellt den Bloom-Pass exakt zurück |
| `ai/training/strategies/ability/nuclear-strike.strategy.ts` | Bot |
| `ai/training/strategies/ability/frost-bomb.strategy.ts` | Bot der Frostbombe; `ability-aim.ts`: Zielhilfen der Fähigkeits-Strategien |
| `ai/training/strategies/ability/emp.strategy.ts` | Bot des EMP |
| `ai/training/strategies/ability/orbital-laser.strategy.ts` | Bot des Orbitallasers |

Tests: `abilities.config.spec.ts`, `ability.manager.spec.ts`,
`integration/ability-strike.spec.ts`, `gate-controller.spec.ts`,
`gate-wiring.spec.ts`, `ai-data-collector.ability-kills.spec.ts`,
`vfx.service.spec.ts`, `mushroom-cloud.renderer.spec.ts`, `bloom-kick.spec.ts`, `audio.service.spec.ts`, `screen-shake.service.spec.ts`,
`combat-effect.service.spec.ts`, `ability-targeting.service.spec.ts`,
`integration/ability-frost.spec.ts`, `frost-burst.renderer.spec.ts`,
`integration/ability-emp.spec.ts`, `emp-pulse.renderer.spec.ts`,
`integration/ability-laser.spec.ts`, `orbital-beam.renderer.spec.ts`,
`route-sweep.spec.ts`, `ability-marker.renderer.spec.ts`,
`ability-button.spec.ts`, `nuclear-strike.strategy.spec.ts`,
`strategy-bot.factory.spec.ts`, Backend `tests/test_gate_loop.py`.

---

## Eine weitere Fähigkeit

Der Manager ist auf mehrere Fähigkeiten ausgelegt (Ladungen und Einschläge pro
`AbilityId`), die Leiste und die Tasten ebenso:

1. `AbilityId` erweitern und einen Eintrag in `ABILITIES` anlegen, mit `icon`
   und `hotkey`. Knopf in der Leiste, Taste und Zeile in der Tastenübersicht
   kommen aus diesem Eintrag; `hotkey-map.spec.ts` prüft, dass die Taste frei
   ist (vergeben: siehe Tastenkürzel in DESIGN_SYSTEM.md).
2. Eine Forschung mit einem `global-perk`, dessen `perkId` dem Eintrag
   entspricht, und `researchId` im Eintrag; der gesperrte Knopf nennt sie.
3. Die Wirkung: `AbilityConfig.effect`, eine Art aus `AbilityEffect`;
   `AbilityManager.resolve` hat je Art einen Zweig. Eine neue Art kommt mit
   ihrem Zweig.
4. Einträge in `abilityVfx` (VFXService), `ABILITY_IMPACT_SOUNDS` und
   `ABILITY_IMPACT_SHAKE`, siehe [Darstellung](#darstellung); ohne sie
   kompiliert der Code nicht. Der Zielmarker (`abilityMarkers.showStrike`)
   passt zu jeder Fähigkeit mit Vorwarnung.
5. `aimHint` im Eintrag: was ein Klick im Zielmodus tut, die
   Kontext-Hinweis-Box zeigt "Click" und diesen Text
   (`abilityTargetingHints` in `tower-defense.component.ts`).

---

## Bewusst nicht gemacht

- Keine Warnsirene.
- Kein eigenes Grollen-Sample und keine tiefere Tonlage: das Grollen sind
  zwei leisere Wiederholungen von `explosion.mp3`, `SpatialAudioManager` hat
  keine Option für Tonhöhe oder Abspieltempo.
- Keine Rückgabe der Ladung, wenn der Einschlag niemanden trifft, auch nicht,
  wenn der Rest der Welle in den 1,5 s der Vorwarnung stirbt oder durchläuft.
- Der Event-Debugger hat keine eigene Kategorie für `ability:*`; die Events
  stehen unter "All".
