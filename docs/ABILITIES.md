# Fähigkeiten (Player Abilities)

**Stand:** 2026-09-14. Erste und bisher einzige Fähigkeit: der Nuklearschlag
(im Spiel "Nuclear Strike"). Konzept und Entscheidungen:
[PLAYER_AGENCY_CONCEPT.md](game-design/PLAYER_AGENCY_CONCEPT.md), Abschnitte 5,
7 und 8.

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
| Wirkung | Radius 25 m, gemessen in 2D, also Boden und Luft; 60 % der Max-HP, Bosse (`isBoss`) 20 %; an der Schadensmatrix vorbei |
| Gold | jeder Kill zahlt seinen Anteil am Kill-Budget der Welle wie jeder andere; kein Tower bekommt ihn gutgeschrieben. Ein getötetes Skeleton splittet wie bei jedem Kill |
| Wave-Director | Kills zählen im Fairness-Gate als Leck (siehe unten) |

Bosse: `isBoss` tragen `herbert` und die Ooze (Boss-Gast ab W35). Steingolem und
Drache führen die späteren Boss-Wellen an, laufen aber auch in `golem_squad` und
`dragon_elite` mit, und das Flag gilt pro Typ.

Die Ooze liegt als Körper entlang der Route (ENEMY_CREATION.md). Der Schlag
trifft sie, sobald sein Radius irgendeinen Punkt ihres Körpers erreicht
(`GlobalRouteGrid.getEnemiesInRadius`), einmal und mit dem Boss-Anteil; ihr
Todesblut liegt an dem Punkt, den der Kreis erreicht.

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
                    ability:impact { hits, kills } + ability:state-changed
```

| Event | Abnehmer |
|---|---|
| `ability:used` | VFXService (Zielmarker), je `abilityId` |
| `ability:impact` | VFXService (Atompilz, Brandflecken), AudioService, ScreenShakeService, je `abilityId`; AIDataCollectorService (`abilityKills`, alle Fähigkeiten) |
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
- Die Welle endet nicht, solange ein Schlag unterwegs ist
  (`AbilityManager.hasPendingStrikes()` in der Sub-Step-Schleife vor
  `checkWaveComplete()`). Stirbt oder leakt der Rest der Welle in der
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

- `AIDataCollectorService` addiert die `kills` jedes `ability:impact` einer
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
  "No route within 30 m", wo keine Zelle in Reichweite ist.
- Linksklick feuert und verlässt den Modus; auf einem ungültigen Punkt bleibt
  der Modus an. Tower-Auswahl und Bauen sind im Modus aus.
- Esc und ein kurzer Rechtsklick brechen ab. Wellenende, verbrauchte Ladung,
  Build-Mode und Kartenplatzierung beenden den Modus ebenfalls.
- K wirkt wie ein Klick auf den Knopf (`AbilityConfig.hotkey`, aufgelöst in
  `services/hotkey-map.ts`, ausgeführt vom `HotkeyService`): schaltet den
  Modus an, wenn der Schlag feuern kann, ein zweites K schaltet ihn ab. Die
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
<app-ability-bar [hero]="heroSlot()" (heroPressed)="onHeroSlotPressed()" />
```

`hero` ist ein `AbilityBarHero` (`icon`, `name`, `hotkey` oder null,
`selected`, optional `detail` als Tooltip-Zeile) oder `null`, der Standard;
dann fehlen Knopf und Trennlinie. Was ein Druck tut (auswählen, Kamera
hinfahren), entscheidet der Aufrufer.

Zum Testen: Cheat "Nuke" im Dev-Menü (Gruppe Cheats). Er schließt die
Forschung `nuclear-strike` samt Voraussetzungen ab (`ResearchManager.completeResearch`,
je Forschung ein `research:completed`) und füllt die Ladungen auf
(`AbilityManager.refillCharges`), beliebig oft hintereinander. Die UI schickt
`debug:ready-ability` verzögert (`emitDeferred`), der `GameCommandsHandler`
setzt es im nächsten Sub-Step um; in der Pause erst beim Weiterlaufen. Feuern
geht weiter nur während einer Welle.

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
| `three-engine/post-processing/bloom-kick.ts` | Bloom-Kick des Blitzes, stellt den Bloom-Pass exakt zurück |
| `ai/training/strategies/ability/nuclear-strike.strategy.ts` | Bot |

Tests: `abilities.config.spec.ts`, `ability.manager.spec.ts`,
`integration/ability-strike.spec.ts`, `gate-controller.spec.ts`,
`gate-wiring.spec.ts`, `ai-data-collector.ability-kills.spec.ts`,
`vfx.service.spec.ts`, `mushroom-cloud.renderer.spec.ts`, `bloom-kick.spec.ts`, `audio.service.spec.ts`, `screen-shake.service.spec.ts`,
`combat-effect.service.spec.ts`, `ability-targeting.service.spec.ts`,
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
3. Die Wirkung: `AbilityManager.resolve` kennt nur den Max-HP-Anteil im Radius.
4. Einträge in `abilityVfx` (VFXService), `ABILITY_IMPACT_SOUNDS` und
   `ABILITY_IMPACT_SHAKE`, siehe [Darstellung](#darstellung); ohne sie
   kompiliert der Code nicht. Der Zielmarker (`abilityMarkers.showStrike`)
   passt zu jeder Fähigkeit mit Vorwarnung.
5. Die Kontext-Hinweis-Box im Zielmodus sagt fest "Click Strike"
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
