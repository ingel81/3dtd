# Fähigkeiten (Player Abilities)

**Stand:** 2026-09-15. Konzept und Entscheidungen zum Nuklearschlag:
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
| Gold | jeder Kill zahlt seinen Anteil am Kill-Budget der Welle wie jeder andere, mit Gold-Popup, und zählt in KILLS und EARNED der Game-Over-Übersicht; kein Tower bekommt ihn gutgeschrieben, auch keinen Veteranenrang. Ein getötetes Skeleton splittet wie bei jedem Kill |
| Schadenszahl | je getroffenem Gegner eine, die getöteten eingeschlossen: sein Anteil an den Max-HP, rot wie ein normaler Tower-Treffer (matrixfrei, `EFFECTIVENESS_COLORS.normal`). Der Schalter Damage Numbers gilt auch hier |
| Wave-Director | Kills zählen im Fairness-Gate als Leck (siehe unten) |

Bosse: `isBoss` tragen `herbert`, der Wurm und die Ooze (Boss-Varianten ab W35). Steingolem und
Drache führen die späteren Boss-Wellen an, laufen aber auch in `golem_squad` und
`dragon_elite` mit, und das Flag gilt pro Typ.

Die Ooze liegt als Körper entlang der Route (ENEMY_CREATION.md). Der Schlag
trifft sie, sobald sein Radius irgendeinen Punkt ihres Körpers erreicht
(`GlobalRouteGrid.getEnemiesInRadius`), einmal und mit dem Boss-Anteil; ihr
Todesblut liegt an dem Punkt, den der Kreis erreicht.

Frostbombe, EMP und Orbitallaser fragen dieselbe Radiusabfrage und behandeln
Ooze und Wurm damit ohne eigenen Zweig:

- **Ooze:** Frostbombe und EMP halten die ganze Ooze an, sobald ihr Radius den
  Körper berührt, als Boss 1 s beziehungsweise 0,75 s; Spitze und Hineinfließen
  an der HQ stehen so lange. Der Laser trifft sie in jedem Sub-Step, in dem
  der Kreis um den Strahl (5 m) den Körper berührt, und zählt sie einmal; die
  Kappe von 20 % begrenzt den Schaden, auch wenn der Strahl über viele Meter
  Körper läuft.
- **Wurm:** Jedes Segment ist ein eigener Gegner mit eigener HP. Frostbombe
  und EMP treffen die Segmente im Radius; ist eines angehalten, steht der
  ganze Wurm (siehe [STATUS_EFFECTS.md](STATUS_EFFECTS.md#wurm-kette-aus-segmenten)).
  Der Laser brennt die Segmente unter sich, jedes bis zu seiner eigenen Kappe
  von 20 %. Maschinen sind beide nicht, das EMP hält sie nur als Boss.

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
| Gold | wie beim Nuklearschlag: jeder Kill zahlt seinen Anteil am Kill-Budget, mit Gold-Popup |
| Schadenszahl | je Gegner eine mit der Summe seiner Ticks, sobald der Strahl mit ihm fertig ist: weitergezogen, Kappe erreicht, Gegner tot oder Strahl vorbei. Auf einem Gegner, auf dem er länger steht (Körper der Ooze), mindestens jede Sekunde Spielzeit eine (`BEAM_NUMBER_EVERY_MS`). Farbe und Größe nach der Wirkung von `fire` gegen seine Rüstung wie bei einem Tower-Treffer: gegen ungepanzert gold, gegen schwer rot, gegen befestigt grau. Ein Frontal-Durchlauf (etwa 0,5 s) gibt eine Zahl |
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
       CombatEffectService.showAbilityDamage                 Schadenszahl je Treffer (Laser: je Gegner summiert)
                                   │
       ability:impact { target, radiusM }, ability:resolved { hits, kills }
                                  + ability:state-changed
```

| Event | Abnehmer |
|---|---|
| `ability:used` | VFXService (Zielmarker), AudioService (Warnsirene des Nuklearschlags), je `abilityId` |
| `ability:impact` | VFXService, AudioService, ScreenShakeService, je `abilityId` (siehe [Darstellung](#darstellung)) |
| `ability:resolved` | AIDataCollectorService (`abilityKills`, alle Fähigkeiten). Beim Nuklearschlag im selben Sub-Step direkt nach `ability:impact` |
| `ability:rejected` | RefusalHintService: Name und Grund in der Kontext-Hinweis-Box, nicht für Befehle des Bots. Die UI prüft vor dem Scharfschalten und vor dem Klick selbst; was ihre eigene Prüfung ablehnt, meldet sie dort genauso ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#context-hint-box)) |
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
- Im Mehrspielerbetrieb liefe `command:use-ability` über dieselbe Pipeline wie
  die übrigen Commands ([MULTIPLAYER_CONCEPT.md](MULTIPLAYER_CONCEPT.md) §4.3;
  das Konzept zählt sieben, der Bus kennt heute 14 `command:*`).

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
skalieren mit dem Radius. Nach dem Playtest 2 (2026-09-14: "optisch und
klanglich noch nicht gut, zu wenig Wumms, nicht typisch genug"; Entscheidung:
realistisch wie Archivaufnahmen, aber größer) neu gebaut: der Feuerball eine
Kugel mit brodelnder Oberfläche, der Rauch aus beleuchteten Billboards, der
Pilz etwa 1,6-mal so groß wie vorher und 22 statt 14 s zu sehen:

| Zeit | Phase |
|---|---|
| 0 bis 1,1 s | Blitz: das ganze Bild 0,08 s lang um 0,92 Weiß aufgehellt, dann quadratisch abklingend und wärmer werdend; ein additiver Sprite (520 m) 60 m über dem Einschlag hellt den Himmel auf, bis 1,4 s. Mit Bloom an (VFX-Einstellungen) zieht der Blitz 1,4 s lang die Bloom-Stärke von 0,3 auf bis zu 1,6 und die Schwelle von 0,85 auf 0,5 |
| 0 bis 6 s | Feuerball: Kugel mit brodelnder Oberfläche, in 0,4 s gut 23 m im Radius; weißglühend, um 0,35 s gelb, um 1 s orange, ab 3 s dunkelrot, mit Ruß, wo er abkühlt. Steigt bis 1 s als Kopf der Säule auf die Höhe der Kappe (75 m), flacht bis 3 s zu ihrem Kern ab, blendet von 2,8 bis 6 s aus |
| 0 bis 0,9 s | Schockkuppel: weiße Halbkugel, am Umriss am hellsten, bis 75 m |
| 0,03 bis 0,93 s | Feuerfront: flache Schale aus Feuer am Boden, läuft bis 45 m aus |
| 0 bis 2,2 s | Druckwelle: heller Ring am Boden bis 135 m, auf ihrer Front eine Staubwand, die bis 4 s stehen bleibt |
| 0 bis 7 s | Bodenlicht: additive Scheibe (130 m) um den Fuß, hell beim Einschlag, dunkler mit dem Feuerball; die Tiles nehmen kein Licht an |
| 0 bis 3,1 s | Glutbrocken: 48 Funkenschweife fliegen mit 30 bis 75 m/s nach außen und oben, gebremst von Luft und Schwerkraft, und verlöschen am Boden |
| 0,3 bis 9 s | Bodenfeuer: flackernde Glut bis 36 m um den Stammfuß |
| ab 0,25 s | Stamm: unten Staub, oben Rauch, steigt in die Kappe; Radius am Fuß 22 m, in der Mitte 8 m, oben zur Kappe ausgestellt; bis 4,5 s Feuer im Kern |
| ab 0,5 s | Base Surge: ein Staubring rollt am Boden nach außen, bei 8 s über 100 m, blendet bis 20 s aus |
| ab 0,8 s | Staub wird am Boden spiralförmig zum Stammfuß gezogen und steigt dort auf |
| ab 1 s | Kappe: Rauch-Torus um den Feuerball, von 1 bis 2,6 s eingeblendet. Ihr Zentrum steht bei 1,5 s auf gut 95 m, bei 5 s auf gut 140 m, bei 10 s auf gut 160 m, der Rauch reicht 15 bis 20 m darüber. Rollt oben nach außen und unten nach innen, bei 6 s schon mehr als eine halbe Umdrehung; jeder Puff dreht sich auf dem Bild mit, die beiden Seiten des Rings gegenläufig. Wülste wandern um den Stamm. Oben rußig und von oben beleuchtet, dunkler werdend, die Unterseite glüht orange, bis etwa 11 s zu Dunkelrot abkühlend |
| 0,6 bis 3,6 s | Kondensationsring (Wilson-Wolke): weißer Ring um den Stamm auf 0,42 der Kappenhöhe, breitet sich von 10 auf 62 m aus |
| 12 bis 22 s | Auflösen: breiter und höher, treibt mit dem Wind, blendet aus |

Bei 5 s reichen die Puffs der Kappe mehr als 2,5-mal so weit vom Zentrum wie
die des Stamms (`mushroom-cloud.renderer.spec.ts`). Vorher (Stand
2026-09-13): Druckwelle 70 m, Kappe bei 5 s knapp 100 m hoch, 14 s Dauer.

Budget: 740 Rauch- und 402 Glut-Sprites pro Pilz (Low 294 und 88), in
eigenen Puffern für zwei gleichzeitige Pilze, dazu je Pilz ein Feuerball.
Ein Pilz zeichnet höchstens 1090 Sprites (bei 1,4 s) mit höchstens 9 Draw
Calls; Aufbau und Messwerte in
[PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md#atompilz-nuklearschlag).

**Brandflecken:** auf dem Einschlagpunkt und auf zwei Ringen, 6 bei 0,45 und 9
bei 0,85 des Radius (`NUCLEAR_STRIKE_SCORCH_RINGS`), alle beim Einschlag, nur
auf Route-Zellen und mit Ground Marks an.

**VFX-Einstellungen:** Mit Impact Effects aus (Preset Low) läuft derselbe
Pilz mit derselben Silhouette aus weniger, größeren Sprites (294 Rauch, 88
Glut statt 740 und 402), ohne Glutbrocken, mit unbeleuchtetem Rauch (Farbe
und Feuerlicht ohne Normalen) und einem Feuerball mit zwei statt vier
Rausch-Oktaven. Die Anzahl gilt ab dem nächsten Schlag, die Beleuchtung
sofort. Bloom ist im Low-Preset aus und damit auch der Bloom-Kick. Vor dem
Umbau nach Playtest 2 zeigte Low nur die Detonation ohne Rauch.

**Massentode:** Todesblut nur für die ersten `ABILITY_DEATH_BLOOD_CAP` (24)
Kills eines Schlags. Jede Blutwolke sind 40 Partikel im normalen Pool und ein
Decal mit Terrain-Raycast; 200 auf einmal liefen über den Pool. Der
Blut-Decal-Pool (100) verdrängt ohnehin seine ältesten Decals. Schadenszahlen
(je Treffer eine) und Gold-Floating-Texts (je bezahltem Kill einer) gehen
ungedeckelt an den `FloatingTextInstanceManager` und teilen sich seine 2048
Instanzen in einem Draw Call; 200 Treffer mit 200 Kills sind 400 Texte. Ist er
voll, verdrängt jeder neue Text den ältesten. Die Zahlen eines Schlags haben
je Gegnertyp denselben Text, der Atlas zeichnet jeden nur einmal. Bis
2026-09-15 zeigten Fähigkeiten keine Schadenszahlen.

**Shake und Sound:** Screen-Shake `nuclearStrike` 0,017 der Bildhöhe für
2200 ms, etwa so lange wie der Knall (2,4 s); bis Playtest 2 0,014 für
1600 ms, bis 2026-09-13 0,008 für 700 ms. Er nimmt mit der Entfernung zur Kamera ab
wie bei Einschlägen, aber mit eigener Reichweite: voll bis 350 m, keiner mehr
ab 1500 m (`strikeNearDistance`, `strikeFarDistance`); aus der
Übersichtskamera (etwa 425 m) bleiben gut 90 %. Der Schalter Screen Shake in
den Display Options gilt auch hier. Sound: im Code synthetisiert
(`utils/nuke-sound.ts`, kein Asset). Beim Einschlag der Knall `nuclear_strike`
(2,4 s): ein scharfer Crack, darunter ein Sub-Bass-Boom, der von 70 auf 28 Hz
fällt, und das Tosen des Feuerballs. Danach drei Stücke Grollen
(`nuclear_strike_rumble_1` bis `_3`, je 3 s, ineinander übergeblendet) nach
450, 2600 und 4800 ms mit 85, 65 und 45 % der Lautstärke
(`GAME_SOUNDS.nuclearStrike.tail`), zusammen etwa 8 s. Die Stücke starten in
Spielzeit (`AudioService.update()` je Sub-Step): eine Pause hält das Grollen,
das noch kommt, höheres Tempo verkürzt es, `game:reset` verwirft ausstehende;
ein Stück, das schon spielt, spielt zu Ende. Alle Stücke haben Vorrang beim
Voice-Stealing und sind bis 1500 m zu hören, so weit wie der Shake (Details in
[SPATIAL_AUDIO.md](SPATIAL_AUDIO.md#nuklearschlag-synthetisiert-nachhall-in-spielzeit)).
Warnsirene (seit 2026-09-15, E18): Während der Vorwarnung heult am Ziel, wo der
Zielmarker steht, eine Luftschutzsirene (`nuclear_strike_siren`,
`abilities/nuke_siren.mp3`, 2 s, mit ElevenLabs erzeugt), vom `ability:used`
bis zum `ability:impact`; der Knall überdeckt den Schnitt. Sie ist ein Loop:
Pause hält sie an, bei 4x endet sie nach einem Viertel der Zeit mit dem
Einschlag, ein Neustart beendet sie. Loops sind nur bis 500 m zu hören.

**Frostbombe:** derselbe Zielmarker in 20 m. Beim Einschlag der Frostausbruch
(`FrostBurstRenderer`, `FROST_BURST_LOOK`, in Spielzeit wie der Atompilz):
weiß-cyaner Blitz (0,2 s), Kältering bis an den Rand des Radius (0,9 s), Reif
über dem Radius, der genau so lange hält wie der Freeze (3 s) und dann in
0,6 s ausblendet, 40 Eissplitter, die innerhalb von etwa 13 m liegen bleiben,
bis sie verlöschen, und ein dünner Nebel unter 2 m am Rand des Radius (bis etwa
2 s). Der Reif liegt mit Tiefentest im Normal-Blending: Gegner und Dächer
verdecken ihn. Seit Playtest 625 so zurückgenommen, damit die eingefrorenen
Gegner in der Fläche erkennbar bleiben; die Werte davor stehen im Kommentar
von `FROST_BURST_LOOK`. Mit Impact Effects aus nur Blitz, Ring und Reif. Dazu
Frostflecken (die Eis-Decals des Ice Towers) auf dem Einschlag und auf zwei
Ringen, 6 bei 0,35 und 10 bei 0,65 des Radius (`FROST_BOMB_ICE_RINGS`), in der
Höhe der Routenzelle, nur mit Ground Marks an. An den Gegnern der Eis-Tint und
die Eiskristalle des Freeze. Ton
`frost_bomb` (`abilities/frost_bomb.mp3`, 2,5 s, mit ElevenLabs erzeugt): ein
eisiger Knall und Aufbruch, dann knisterndes Gefrieren mit glasigem Schimmer;
bis 2026-09-15 der Cast des Ice Towers mit zwei leiseren Wiederholungen. Shake
`frostBomb` 0,004 für 350 ms, voll bis 150 m, keiner ab 700 m
(`abilityNearDistance`, `abilityFarDistance`); aus der Übersichtskamera
bleibt etwa die Hälfte.

**EMP:** derselbe Zielmarker in 30 m. Beim Einschlag der Puls
(`EmpPulseRenderer`, `EMP_PULSE_LOOK`, in Spielzeit): blau-weißer Blitz, zwei
elektrische Fronten, die gezackt und knisternd über den Radius laufen, eine
schwache Hülle darüber und Funken entlang der ersten Front. An den Gegnern
Tint und Funken des Stun. Ton `emp` (`abilities/emp.mp3`, 2,5 s, mit
ElevenLabs erzeugt): ein elektrischer Schlag mit Hochspannungs-Zap, dann
knisternde Entladung; bis 2026-09-15 der Kettenblitz des Lightning Towers mit
zwei leiseren Wiederholungen. Shake `emp`
0,005 für 450 ms, dieselbe Reichweite wie die Frostbombe. Keine Bodenspuren.

**Orbitallaser:** während der Vorwarnung der Zielmarker im Strahlradius
(5 m) und ein orangefarbenes Band so breit wie der Strahl über den Weg, den er
nehmen wird (`ability:used` trägt ihn als `path`). Beim Einschlag verschwindet
beides und der Strahl kommt herunter (`OrbitalBeamRenderer`,
`ORBITAL_BEAM_LOOK`, in Spielzeit; nach Playtest 636 am 2026-09-15 breiter,
heller und mit Brocken, Rauch und Glut): eine Lichtsäule 340 m hoch und 24 m
breit, weißglühender Kern, gelb-orange und rote Korona mit Energiestreifen,
Pulsen und flimmernden Rändern, mit Tiefentest, sodass Gebäude davor sie
verdecken; am Fuß ein Glühen, ein flackerndes Bodenlicht (18 m), ein Ring im
Strahlradius, Funken, glühende Brocken und Rauch und Staub, die entlang des
Wegs stehen bleiben. Alle 2,5 m des Wegs ein Brandfleck (Quelle `beam`: 5 m
Radius, fast schwarz, 150 s, mit Ground Marks an) und ein Glutfleck, der in
6 s Spielzeit von Weißglut über Orange nach Dunkelrot abkühlt, im Blutmond
getönt wie die Bodenspuren. Der Fuß läuft mit 18 m/s die Route entlang wie in
der Simulation und endet mit ihr. Mit Impact Effects aus (Preset Low) nur die
Säule ohne Streifen, Fuß, Ring und Blitz. Aufbau und Budget in
[PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md#orbitallaser). Ton `orbital_laser`, im
Code synthetisiert (`utils/laser-sound.ts`): Zap, Crack und Schlag beim
Einschlag, nach 1,3 und 2,5 s zwei Stücke Brennen (Dröhnen und Zischen), das
letzte fährt herunter, zusammen etwa so lange, wie der Strahl brennt
([SPATIAL_AUDIO.md](SPATIAL_AUDIO.md#orbitallaser-synthetisiert-stücke-in-spielzeit));
bis Playtest 636 der Blitz des Lightning Towers, zweimal leiser wiederholt.
Shake `orbitalLaser` 0,006 für 1400 ms (bis Playtest 636 0,003 für 1200 ms),
dieselbe Reichweite wie Frostbombe und EMP.

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
Aussehen in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#fähigkeitenleiste-canvas)). Er
erscheint erst mit der fertigen Forschung, vorher hat die Fähigkeit keinen
Knopf (Entscheidung des Users 2026-09-14; bis dahin stand sie gesperrt mit
Schloss in der Leiste). Ein Druck schaltet den Zielmodus ein (`UIStore.abilityTargeting`,
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

`app-ability-bar` (`components/ability-bar/`) zeigt jede erforschte Fähigkeit
aus `ABILITIES`, in der Reihenfolge der Einträge, und liest ihren Zustand aus
`GameStore.abilities`. Was ein Knopf zeigt, kommt aus dem Eintrag und dem
Snapshot des `AbilityManager`:

| Anzeige | Quelle |
|---|---|
| Knopf da, sobald die Forschung fertig ist | `AbilityStatus.unlocked` (`abilityBarIds`) |
| Icon | `AbilityConfig.icon` (td-icon) |
| Taste oben rechts, Tastenkappe im Tooltip | `AbilityConfig.hotkey` |
| Ladungen (als Zahl nur ab `maxCharges` 2) | `AbilityStatus.charges` |
| ein Strich je Welle bis zur nächsten Ladung | `AbilityConfig.rechargeWaves`, `AbilityStatus.wavesUntilCharge` |
| Schlag unterwegs | `AbilityStatus.pending` |
| Zielmodus an | `AbilityTargetingService.targeting()` |

Welche Knöpfe es gibt, Zustand und Texte berechnen `abilityBarIds()`,
`abilityButtonView()` und `abilityTooltip()` (`ability-bar/ability-button.ts`),
reine Funktionen mit Spec. Ohne Held und ohne erforschte Fähigkeit fehlt die
Leiste ganz.

**Held.** Über den Fähigkeiten ist Platz für den Knopf des Helden. Die Leiste
kennt den Helden nicht, sie bekommt ihn als Eingang und meldet den Druck:

```html
<app-ability-bar [hero]="heroBar()" [topInset]="uiStore.infoOverlayBottom()" (heroPressed)="onHeroBarPressed()" />
```

`topInset` ist die gemessene Unterkante des Info-Overlays; die Leiste bleibt
darunter (Einpassen in die Höhe: [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#fähigkeitenleiste-canvas)).

`hero` ist ein `AbilityBarHero` (`icon`, `name`, `hotkey` oder null,
`selected`, optional `detail` als Tooltip-Zeile) oder `null`, der Standard;
dann fehlt sein Knopf. Die Trennlinie steht nur zwischen Held und erforschten
Fähigkeiten. Was ein Druck tut (auswählen, Kamera
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
- `OrbitalLaserStrategy` (93): bewertet je Kandidat ab Pfadfortschritt 0,5
  den Strahl, den die Fähigkeit feuern würde (Weg aus `previewSweep`,
  Radius, Tempo, Brenndauer), gegen die Gegner in Bewegung; feuert ab 10
  erwarteten Treffern auf den Kandidaten mit dem größten erwarteten Schaden
  ([BOT_SYSTEM.md](BOT_SYSTEM.md#orbitallaser-93)).

---

## Dateien

| Datei | Rolle |
|---|---|
| `configs/abilities.config.ts` | Werte, `AbilityStatus`, Ablehnungsgründe |
| `managers/ability.manager.ts` | Ladungen, Nachladen, Zeitplan und Auflösung der Einschläge |
| `managers/game-commands.handler.ts` | `command:use-ability`, Cheat `debug:ready-ability` |
| `services/refusal-hint.service.ts` | Warum ein Druck nichts tat, in der Kontext-Hinweis-Box (auch für den Helden) |
| `services/combat/damage-application.service.ts` | `applyMaxHpFraction`, der matrixfreie Schadensweg |
| `services/world/global-route-grid.service.ts`, `utils/global-route-grid.ts` | `snapToRouteCell`, `findNearestCell` |
| `ai/core/gate-controller.ts` | `gateLeakRatio` |
| `services/ability-targeting.service.ts` | Zielmodus |
| `components/ability-bar/` | Fähigkeitenleiste; `ability-button.ts`: Zustand und Tooltip der Knöpfe |
| `services/hotkey-map.ts` | Taste je Fähigkeit aus `AbilityConfig.hotkey` |
| `three-engine/renderers/ability-marker.renderer.ts` | Zielmarker und Zielring |
| `three-engine/renderers/mushroom-cloud.renderer.ts` | Atompilz des Einschlags |
| `three-engine/renderers/mushroom-cloud-shape.ts`, `-sprites.ts`, `-fireball.ts`, `-glow.ts`, `-smoke.ts`, `-blast.ts` | Form, Billboards samt Billow-Atlas und Materialien, Feuerball, Glut, Rauch, Bodenlicht/Ring/Kuppel/Blitz des Atompilzes |
| `three-engine/renderers/frost-burst.renderer.ts` | Frostausbruch der Frostbombe |
| `three-engine/renderers/emp-pulse.renderer.ts` | Puls des EMP |
| `three-engine/renderers/orbital-beam.renderer.ts` | Strahl des Orbitallasers |
| `utils/route-sweep.ts` | Weg des Strahls: Routenabschnitt vom Aufsetzpunkt Richtung Spawn, Punkt nach Metern |
| `services/combat/combat-effect.service.ts` | `applyAbilityStrike`, `applyAbilityHalt` (Freeze und Stun über den `StatusEffectService`), `showAbilityDamage` (Schadenszahl wie bei einem Tower-Treffer) |
| `three-engine/post-processing/bloom-kick.ts` | Bloom-Kick des Blitzes, stellt den Bloom-Pass exakt zurück |
| `utils/nuke-sound.ts` | Ton des Nuklearschlags, im Code synthetisiert: Knall und drei Stücke Grollen |
| `utils/laser-sound.ts` | Ton des Orbitallasers, im Code synthetisiert: Einschlag und zwei Stücke Brennen |
| `utils/synth.ts` | Seed-Zufall, Tiefpass-Koeffizient und Normalisieren, geteilt mit den Ooze-Sounds |
| `ai/training/strategies/ability/nuclear-strike.strategy.ts` | Bot |
| `ai/training/strategies/ability/frost-bomb.strategy.ts` | Bot der Frostbombe; `ability-aim.ts`: Zielhilfen der Fähigkeits-Strategien |
| `ai/training/strategies/ability/emp.strategy.ts` | Bot des EMP |
| `ai/training/strategies/ability/orbital-laser.strategy.ts` | Bot des Orbitallasers |

Tests: `abilities.config.spec.ts`, `ability.manager.spec.ts`,
`integration/ability-strike.spec.ts`, `gate-controller.spec.ts`,
`gate-wiring.spec.ts`, `ai-data-collector.ability-kills.spec.ts`,
`vfx.service.spec.ts`, `mushroom-cloud.renderer.spec.ts`, `mushroom-cloud-pause.scenario.spec.ts`, `bloom-kick.spec.ts`, `audio.service.spec.ts`, `nuke-sound.spec.ts`, `screen-shake.service.spec.ts`,
`combat-effect.service.spec.ts`, `ability-targeting.service.spec.ts`,
`integration/ability-frost.spec.ts`, `frost-burst.renderer.spec.ts`,
`integration/ability-emp.spec.ts`, `emp-pulse.renderer.spec.ts`,
`integration/ability-laser.spec.ts`, `orbital-beam.renderer.spec.ts`, `laser-sound.spec.ts`,
`scorch-marks.spec.ts` (Brandspur des Lasers),
`integration/ability-ooze.spec.ts` (Frost, EMP und Laser gegen den Körper der Ooze),
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
   entspricht, und `researchId` im Eintrag; ist sie fertig, erscheint der
   Knopf in der Leiste.
3. Die Wirkung: `AbilityConfig.effect`, eine Art aus `AbilityEffect`;
   `AbilityManager.resolve` hat je Art einen Zweig. Eine neue Art kommt mit
   ihrem Zweig. Macht sie Schaden, ruft der Zweig `AbilityWorld.showDamage`
   für die Schadenszahlen; wer in kurzen Ticks trifft, summiert je Gegner wie
   der Orbitallaser.
4. Einträge in `abilityVfx` (VFXService), `ABILITY_IMPACT_SOUNDS` und
   `ABILITY_IMPACT_SHAKE`, siehe [Darstellung](#darstellung); ohne sie
   kompiliert der Code nicht. Der Zielmarker (`abilityMarkers.showStrike`)
   passt zu jeder Fähigkeit mit Vorwarnung.
5. `aimHint` im Eintrag: was ein Klick im Zielmodus tut, die
   Kontext-Hinweis-Box zeigt "Click" und diesen Text
   (`abilityTargetingHints` in `tower-defense.component.ts`).

---

## Bewusst nicht gemacht

- Keine Sirene im Wave-Replay: Das Replay reicht `ability:used` nicht an seinen
  AudioService weiter, und während des Replays ist das Spiel pausiert, Loops stehen.
- Keine Pause für einen Ton, der schon spielt: One-Shots kennen keine Pause.
  Ein Stück Grollen, das beim Pausieren läuft, spielt zu Ende, höchstens 3 s;
  die Stücke danach warten auf das Weiterspielen.
- Keine Rückgabe der Ladung, wenn der Einschlag niemanden trifft, auch nicht,
  wenn der Rest der Welle in den 1,5 s der Vorwarnung stirbt oder durchläuft.
- Der Event-Debugger hat keine eigene Kategorie für `ability:*`; die Events
  stehen unter "All".
