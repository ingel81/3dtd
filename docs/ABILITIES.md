# Fähigkeiten (Player Abilities)

**Stand:** 2026-09-13. Erste und bisher einzige Fähigkeit: der Nuklearschlag
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

Bosse: `isBoss` trägt nur `herbert`. Steingolem und Drache führen die späteren
Boss-Wellen an, laufen aber auch in `golem_squad` und `dragon_elite` mit, und
das Flag gilt pro Typ.

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
| `ability:used` | VFXService (Zielmarker) |
| `ability:impact` | VFXService (Atompilz, Brandflecken), AudioService, ScreenShakeService, AIDataCollectorService (`abilityKills`) |
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
skalieren mit dem Radius.

| Zeit | Phase |
|---|---|
| 0 bis 0,4 s | Blitz: additiver Sprite (80 m) über dem Einschlag, 0,3 s lang zusätzlich eine schwache Aufhellung des ganzen Bildes |
| 0 bis 1,1 s | Druckwelle: heller Ring am Boden, läuft schnell auf 36 m aus und verblasst |
| 0 bis 2,8 s | Feuerball: Halbkugel am Boden (bis 12 m); ab 0,35 s steigt er auf und wird zum glühenden Kern der Kappe |
| ab 0,05 s | Staub: Bodenwalze bis etwa 34 m, dazu dunklerer Staub am Stammfuß |
| ab 0,3 s | Stamm: Rauch steigt in die Kappe, am Fuß breit, unten anfangs feuerbeleuchtet; bis 3 s Feuer im Kern |
| ab 0,4 s | Kappe: Rauch-Torus, steigt auf knapp 60 m, rollt oben nach außen und unten nach innen. Unterseite bis etwa 5 s orange angeleuchtet (additive Randglut), Außenseite dunkler, eine Kuppel deckt die Mitte |
| 5,5 bis 10 s | Auflösen: breiter und höher, treibt mit dem Wind, blendet aus |

Budget: 106 additive Partikel (Explosions-Atlas) und 270 Rauchpartikel
(Rauch-Atlas) pro Pilz, in eigenen Puffern für zwei gleichzeitige Pilze (212
und 540), nicht in den Trail-Pools. Details in
[PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md#atompilz-nuklearschlag).

**Brandflecken:** auf dem Einschlagpunkt und auf zwei Ringen, 6 bei 0,45 und 9
bei 0,85 des Radius (`NUCLEAR_STRIKE_SCORCH_RINGS`), alle beim Einschlag, nur
auf Route-Zellen und mit Ground Marks an.

**VFX-Einstellungen:** Mit Impact Effects aus (Preset Low) bleiben Blitz,
Feuerball und Druckwelle, kein Rauch. Bis 2026-09-13 bestand der Einschlag aus
gestaffelten Feuer-Atlas-Explosionen auf Wanduhr-Timern, und Low zeigte davon
nichts.

**Massentode:** Todesblut nur für die ersten `ABILITY_DEATH_BLOOD_CAP` (24)
Kills eines Schlags. Jede Blutwolke sind 40 Partikel im normalen Pool und ein
Decal mit Terrain-Raycast; 200 auf einmal liefen über den Pool. Der
Blut-Decal-Pool (100) verdrängt ohnehin seine ältesten Decals. Die
Gold-Floating-Texts eines Schlags (je bezahltem Kill einer) bleiben unter dem
Limit von 2048 Instanzen.

**Shake und Sound:** Screen-Shake `nuclearStrike` (0,008 für 700 ms), unabhängig
von der Entfernung zur Kamera, wie HQ-Schaden. Sound `nuclear_strike`: das
vorhandene `explosion.mp3`, lauter und mit größerer Reichweite. Eine Warnsirene
gibt es nicht, im Repo liegt kein passendes Sample.

---

## Bedienung

Knopf rechts neben START WAVE, sichtbar ab der fertigen Forschung (Aussehen in
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#nuclear-strike-knopf-sidebar)). Ein Druck
schaltet den Zielmodus ein (`UIStore.abilityTargeting`, geführt vom
`AbilityTargetingService`):

- Ein Ring im Strike-Radius folgt dem Cursor, gesnappt auf die Route-Zelle, auf
  der der Schlag landen würde: gold, wo er landet, rot mit dem Hinweis
  "No route within 30 m", wo keine Zelle in Reichweite ist.
- Linksklick feuert und verlässt den Modus; auf einem ungültigen Punkt bleibt
  der Modus an. Tower-Auswahl und Bauen sind im Modus aus.
- Esc und ein kurzer Rechtsklick brechen ab. Wellenende, verbrauchte Ladung,
  Build-Mode und Kartenplatzierung beenden den Modus ebenfalls.
- K wirkt wie ein Klick auf den Knopf (`services/hotkey-map.ts`,
  `HotkeyService`): schaltet den Modus an, wenn der Schlag feuern kann, ein
  zweites K schaltet ihn ab. Die Tastenübersicht (H) führt die Taste auf.

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
| `managers/game-commands.handler.ts` | `command:use-ability` |
| `services/combat/damage-application.service.ts` | `applyMaxHpFraction`, der matrixfreie Schadensweg |
| `services/world/global-route-grid.service.ts`, `utils/global-route-grid.ts` | `snapToRouteCell`, `findNearestCell` |
| `ai/core/gate-controller.ts` | `gateLeakRatio` |
| `services/ability-targeting.service.ts` | Zielmodus |
| `components/game-sidebar/wave-panel/ability-button.ts` | Zustand des Knopfs |
| `three-engine/renderers/ability-marker.renderer.ts` | Zielmarker und Zielring |
| `three-engine/renderers/mushroom-cloud.renderer.ts` | Atompilz des Einschlags |
| `ai/training/strategies/ability/nuclear-strike.strategy.ts` | Bot |

Tests: `abilities.config.spec.ts`, `ability.manager.spec.ts`,
`integration/ability-strike.spec.ts`, `gate-controller.spec.ts`,
`gate-wiring.spec.ts`, `ai-data-collector.ability-kills.spec.ts`,
`vfx.service.spec.ts`, `mushroom-cloud.renderer.spec.ts`, `audio.service.spec.ts`, `screen-shake.service.spec.ts`,
`combat-effect.service.spec.ts`, `ability-targeting.service.spec.ts`,
`ability-button.spec.ts`, `nuclear-strike.strategy.spec.ts`,
`strategy-bot.factory.spec.ts`, Backend `tests/test_gate_loop.py`.

---

## Eine weitere Fähigkeit

Der Manager ist auf mehrere Fähigkeiten ausgelegt (Ladungen und Einschläge pro
`AbilityId`), der Rest noch nicht:

1. `AbilityId` erweitern und einen Eintrag in `ABILITIES` anlegen.
2. Eine Forschung mit einem `global-perk`, dessen `perkId` dem Eintrag entspricht.
3. Die Wirkung: `AbilityManager.resolve` kennt nur den Max-HP-Anteil im Radius.
4. VFXService, AudioService und ScreenShakeService behandeln jedes
   `ability:used` und `ability:impact` wie den Nuklearschlag.
5. Das Wave-Panel zeigt fest den Knopf des Nuklearschlags.

---

## Bewusst nicht gemacht

- Keine Warnsirene.
- Kein längerer Grollen-Nachhall: im Repo liegt nur `explosion.mp3`, und
  `SpatialAudioManager` hat keine Option für Tonhöhe oder Abspieltempo.
- Keine Rückgabe der Ladung, wenn der Einschlag niemanden trifft, auch nicht,
  wenn der Rest der Welle in den 1,5 s der Vorwarnung stirbt oder durchläuft.
- Der Event-Debugger hat keine eigene Kategorie für `ability:*`; die Events
  stehen unter "All".
