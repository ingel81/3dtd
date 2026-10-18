# Eigene Karten im Spiel (CustomMapWorld)

**Status:** Aktuell, seit 0.7.0 auf `main`, im Spiel gesperrt bis zur Freigabe (TODO E134); die nächste Runde plant [CUSTOM_MAPS_NEXT_PLAN.md](CUSTOM_MAPS_NEXT_PLAN.md) (E154). Teil von
[WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md); das Kartendokument beschreibt `map-document.ts`, den
Import aus Warcraft 3 [W3X_IMPORT.md](W3X_IMPORT.md).

`CustomMapWorld` (`src/app/world/custom-map/custom-map-world.ts`) ist der `WorldProvider` für
`WorldRef` `{ kind: 'custom-map', mapId, contentHash }`.

## Start

- `?world=map:<id>` wählt die Karte (`worldRefFromSearch`), `?spawns=N` begrenzt die Spawns
- Auf den Globen: die Welt Built Worlds (`worlds/world-maps.component.ts`), unbearbeitete OSM-Karten unter
  OpenStreetMap (`world-osm.component.ts`), siehe [WORLDS_STATE_PLAN.md](WORLDS_STATE_PLAN.md).
  - Gelistet sind eigene Karten aus dem Map-Store, die von Coop-Hosts und die mitgelieferten aus `maps/index.json`
    (eine eigene gleicher id verdeckt sie); die eigenen Tilesets stehen unter Real places.
  - Jede Zeile zeigt Bild, Name, Herkunft (from OpenStreetMap, copy of …) und Spawn-Zahl.
  - „Play“ öffnet die Karte in der Seite (Startauftrag), „Edit in the editor“ den Editor im Fenster.
- `WorldFactory.startHq` öffnet die Karte über den `MapStore`: eigene Karten aus IndexedDB, sonst
  mitgelieferte aus `public/maps/`. Trägt der Ref einen `contentHash` und passt er nicht, bricht der
  Start ab. Fehlt die Karte, zeigt der Startablauf die Meldung (`WorldUnavailableError`) statt eines
  Ladebildschirms ohne Ende
- `create` baut die Welt aus der geöffneten Karte; `WorldContext.open` übernimmt danach `contentHash`
  und Namen der Karte in den Ref
- Ursprung des Laufs ist das HQ der Karte. `EllipsoidSync` legt den Ursprung einmal über Grad, Bogenmaß,
  Grad fest; Hauptthread und Simulation rechnen mit denselben Bits, sodass Wegpunkte auf 2-m-Zellgrenzen
  (Knoten einer Karte auf ganzen Metern) auf beiden Seiten in derselben Zelle liegen

## Startaufstellung

HQ aus `doc.hq`, Spawns aus `doc.spawns` in ihrer Reihenfolge: die ersten `?spawns=N`, ohne Angabe
alle bis `MAX_SPAWN_PORTALS` (32), mehr Portale kann das Spiel nicht zeigen. Weitere Spawns der Karte
bleiben ungenutzt.

## Spurenwahl (E130)

Volle Last je offener Spur: jede offene Spur bringt die ganze Welle. Dafür wählt der Spieler vor Welle 1, welche Spuren
offen sind.

- **Karte:** ein Spawn mit `optional: true` darf geschlossen werden, ohne das Feld ist er immer offen.
  `gameplay.lanes`: `min` (Standard 1), `max` (Standard alle) offene Spuren, `vacant` für Spuren, die im Koop niemand
  hält: `close` (Standard), `host`, `split`. Die gemeinsame Regel steht in `world/custom-map/lane-choice.ts`
  (`laneChoiceOf` hält die Grenzen in dem, was die Spawns erlauben; `defaultOpenLanes`: immer offene, dann optionale
  in Reihenfolge bis `max`; `laneChoiceProblem`, `toggledLanes`).
- **Welt:** `WorldProvider.lanes()` (`WorldLanes`: Wahl, offene Spuren, `setOpen`), `null` auf echten Orten und in
  DevWorld. `CustomMapWorld.startLayout()` gibt nur die offenen Spawns, jeder mit `slot` (Platz in der Liste der
  Karte, der die Farbe bestimmt, damit eine Spur ihre Farbe behält).
- **Spiel:** `app-lane-choice` im Wellen-Panel vor Welle 1, nur auf Karten mit optionalen Spuren, nicht für einen
  Koop-Gast und nicht im Koop-Spiel (`coopMapLocked`). Ein Schalter ruft `LocationFacadeService.setOpenLanes`;
  `MapRelocationService.applyLayoutSpawns` baut Spawns, Routen und den Lauf mit den eigenen Ids und Namen neu. Eine
  geschlossene Spur ist wie entfernt: kein Portal, keine Route. Darunter der Hinweis zur Last
  („3 lanes open: each brings a full wave, 3 times the enemies“).
- **Koop:** Der Host wählt in der Lobby (die Karte geht wie bei jeder Spawn-Änderung an die Gäste). Freie Spuren
  halten den Start nicht auf, wenn die Karte Spuren bringt (`CoopService.vacantRule`). Beim Start:
  `close` schließt sie (auch immer offene; eine bleibt), die Gäste bekommen die Karte neu und sagen wieder bereit, der
  Host startet erneut; `host` lässt den Host sie vor dem Start nehmen; `split` schickt `vacant: 'split'` mit dem
  Start, das Relay verteilt sie reihum ab dem Host (`Room.shareOutLanes`). Ein Relay vor diesem Stand kennt das Feld
  nicht und lehnt den Start ab.
- Die Wahl gilt für die Seite: ein Neuladen beginnt wieder bei `defaultOpenLanes`.

## Spielwerte (`gameplay`)

Das optionale Feld `gameplay` des Dokuments (`MapGameplay`) setzt Startcredits, HQ-HP, erlaubte
Tower-Typen und die Wellen. Keine Weiche auf die Weltart, die Werte gehen über die vorhandenen Wege:

- `runRules()` macht daraus `RunRules` (`sim/protocol/run-rules.ts`, `runRulesOf`: ganze Zahlen in
  Grenzen, nur bekannte Tower in der Reihenfolge von `TOWER_TYPES`, leere Liste heißt alle). Ohne
  Startcredits, HP und Towerliste gibt es `null`: die Karte spielt die Werte des Spiels.
- Die Regeln reisen in `SimWorld.rules` in den Worker und stehen im Weltschlüssel (`runRulesKey`),
  nur wenn es sie gibt; Tiles und DevWorld haben den Schlüssel wie vorher, alte Replays bleiben gültig.
  Ein Koop-Gast mit anderer Karte oder anderen Werten passt nicht zum Schlüssel des Hosts.
- Im Worker übernimmt `GameStateManager.loadWorld` sie (`takeRunRules`): Start-HP des HQ, Startcredits
  je Spur. Ändern sich die Regeln gegenüber dem Lauf davor, starten HQ und Konten neu.
- Erlaubte Tower: `towerUnlockedBy` ist die eine Prüfung für Simulation (`ResearchManager`) und
  Baumenü (`ResearchStore.runRules`). Ein ausgelassener Typ bleibt gesperrt, auch wenn die Forschung
  ihn freischaltet. Die HQ-Anzeige liest das Maximum aus `WorldContextService.runRules`.
- `worldWaves()`: `budget` setzt die Budget-Quelle, `table` die Tabellen-Quelle mit der Liste der
  Karte (`WaveSourceOptions.table`, `TableWaveSource(table)`). Der Start gibt sie an
  `WaveDirector.useWorldWaves`, der Worker bekommt die Liste über `SimConfig.waveTable`. Eine Liste
  mit Fehlern (`validateWaveTable`) wird mit Warnung übergangen, dann spielt die Wahl des Spielers.
- `gameplay.difficulty` (Prozent, 50 bis 200, ohne Feld 100): `worldWaves()` gibt ihn als Faktor mit
  (`difficultyFactor`), der Start reicht ihn als `WaveSourceOptions.difficulty` an die Budget-Quelle, die ihn
  auf Budget und Deckel jeder Welle legt ([WAVE_RUN_PLAN.md](WAVE_RUN_PLAN.md), Abschnitt 19). Eine Karte ohne
  Wellenwahl mit Schwierigkeit spielt die Quelle des Spielers; die Tabellen-Quelle ignoriert ihn.

Ein Lauf ab Welle N (der Test des Editors, `?fromWave=N`, [LEVEL_EDITOR.md](LEVEL_EDITOR.md#speichern-und-dateien)):
`runRules()` gibt dann auch ohne eigene Werte Regeln mit `start` (`runStartAt` mit den Goldregeln der Wellen der
Karte). Im Worker setzt `GameStateManager.applyRunStart` den Zähler auf N−1, gibt jedem Spieler die Forschung und
die Ability-Aufladung der übersprungenen Wellen; das Gold kommt mit den Startcredits (`setStartCredits`). Das
geschieht nach `loadWorld` und nach jedem `reset`, einmal je Lauf.

Alle Anteile an der HQ-HP rechnen mit der HP des Laufs (`RunRules.hqHealth`), nicht mit
`GAME_BALANCE.player.startHealth`:

- in der Simulation die Knapp-Grenze am Wellenende (`closeCallHp(max)`, `WaveManager`) und der
  Trostpreis (`EconomyService.computeWaveCompletionBonus`)
- auf dem Hauptthread die Ausgänge der Welle (`WaveOutcomeTracker`: `damagePercent`, `wasCloseCall`),
  der Spielerzustand des Snapshots (`playerState`), `GameStore.healthPercent` und `healthCritical`
  (aus `GameStore.maxHealth`, gesetzt beim Öffnen der Welt) und das HQ-Feuer

Der Druck-Regler selbst misst gegen die HP zu Wellenbeginn und braucht kein Maximum. Ohne eigene
Regeln ist das Maximum `startHealth`, die Rechnung bleibt bitgleich: Tiles, DevWorld und alte Replays
ändern sich nicht.

## Viele Spuren: Optionen

**Stand:** Rechnung (2026-10-11); entschieden am selben Tag, siehe „Entschieden“ unten (die Option ist entfernt).

**Wie das Spiel heute rechnet:**

- Allein ist jeder Spawn eine Spur, und jede Spur bekommt die ganze Welle.
- Die Budget-Quelle plant jede Spur gegen 1/N der Abwehr (`shareDefense`) und 1/N der HQ-HP (`hpRemaining`).
- Startgeld und Kill-Gold kommen je Spur, also N-fach; das Abschlussgold kommt einmal.
- Die Lecks aller Spuren gehen auf das eine HQ.

Der w3x-Import schneidet seine Wellen schon auf 1/Wurzel(N) je Spur (`wave-convert.ts`). Eine Karte mit 10 Spuren und
Budget-Wellen (Mafa) war ab Welle 3 verloren.

**Rechnung:** `tools/balance-calc/lanes.ts`, Tabelle mit
`BALANCE_OUT=<dir> npx vitest run tools/balance-calc/lanes.spec.ts`. Grundlage ist die echte Budget-Quelle gegen die
Abwehr des menschlichen Laufs vom 2026-10-01:

- Die Abwehr wird mit dem Gold mal N genommen und gleichmäßig auf die Spuren verteilt.
- Die Leck-Schätzung ist die des Rechners (`tools/balance-calc/README.md`).
- Die Aufbauwellen W1 bis W7 kosten je Spur ihren aufgezeichneten Verlust mal dem Anteil der Körper.

Die Annahme zu den Aufbauwellen ist die unsicherste; deshalb steht die Rechnung auch ohne sie da (`buildUpWaves` 0).

HQ nach W3 / 5 / 10 / 20 / 30 / 40 und Tod, mit den aufgezeichneten Aufbauverlusten:

| Variante | 1 Spur | 2 Spuren | 4 Spuren | 10 Spuren |
|---|---|---|---|---|
| heute | 500/485/363/331/247/166, lebt | 469/227/217/132/41 bei W40, Tod W44 | Tod W7 | Tod W6 (W5: 346) |
| (a) Wellenanteil 1/Wurzel(N) | wie heute | 307 bei W10 und W20, 181 bei W30, 156 bei W40, Tod W60 | 227 bei W10 und W20, 1 ab W30, Tod W60 | 68 bei W10 bis W29, Tod W30 |
| (b) doppeltes Start- und Kill-Gold | wie heute | wie heute | wie heute | wie heute |
| (c) Leckschaden 1/N (nicht gebaut) | wie heute | 485/363/331/243/167, lebt | 485/363/333/249/172, lebt | 485/363/342/219/169, lebt |

Ohne Aufbauverluste:

| Variante | 2 Spuren | 4 Spuren | 10 Spuren |
|---|---|---|---|
| heute | Tod W55 | 397 bei W10, Tod W44 | 443 bei W10, 69 bei W20, Tod W22 |
| (a) Wurzel | 460 bei W10, 280 bei W40 | 420 bei W10, 194 bei W30, Tod W60 | 300 bei W10, Tod W30 |
| (c) 1/N | 474/349/243/175 | 474/354/249/180 | 474/357/253/183 |

Eine Spur in allen Varianten: 474/342/263/191.

**Was die Zahlen sagen:**

- **(a) Wurzel** hält einen Spieler auf vielen Spuren über die ersten Wellen, aber nicht bei vergleichbarer Last.
  Bei 10 Spuren kosten die Aufbauwellen 432 HP (eine Spur: 137). Danach liegt die Last je Spur bei 0,3 bis 0,55 und
  es leckt nichts mehr. Der Druck-Regler öffnet bis 2,5, und die erste schwere Welle (W30, Last 1,23) beendet den
  Lauf auf dem Rest-HQ. Zwischen W11 und W29 hat der Spieler keine Spannung, danach eine Wand.
- **(b) Gold** ändert in der Rechnung nichts: Die Budget-Quelle bemisst die HP gegen die Abwehr, mehr Tower bringen
  mehr HP. Die Aufbauverluste hängen in der Rechnung nicht vom Gold ab; im Spiel hilft mehr Startgeld dort,
  wie viel, kann die Rechnung nicht sagen. Startgeld und Kill-Gold je Spur sind heute schon so gebaut.
- **(c) Leckschaden 1/N** hält jede Spurzahl auf der Kurve einer Spur (Abweichung höchstens 28 HP bis W40). Das ist
  der einzige der drei Hebel mit vergleichbarer Last. Er ist nicht gebaut: Der Leckschaden entsteht in der
  Simulation, er gehörte als Lauf-Regel in die `RunRules` (Weltschlüssel) und gilt nur für Karten, die ihn wählen.

**Entschieden (2026-10-11):** volle Last je offener Spur bleibt, auch kein Leckschaden 1/N. Die vorbereitete Option
`gameplay.laneScaling: 'sqrt'` ist entfernt (E130); ein altes Kartendokument mit dem Feld liest sich weiter, das Feld
wirkt nicht. Stattdessen wählt der Spieler vor Welle 1, welche Spuren offen sind (siehe Spurenwahl). Die Variante (a)
rechnet nur noch `tools/balance-calc/lanes.ts`.

## Kartenprobe (`?bot=trial`)

`?world=map:<id>&bot=trial&trialWaves=N` lässt den Experten-Bot die ersten N Wellen (Standard 10, höchstens
50) der Karte allein spielen, mit Timescale 75 und ohne Bot-Server; der Tab läuft auch versteckt weiter.
Die Probe gilt für jede Welt ohne echten Ort (`capabilities.realPlace` aus), also auch DevWorld. Sie
zählt ab `game:started`, die Start-HP kommen aus den Spielwerten der Karte (`MapTrial`,
`world/map-trial.ts`). Ergebnis `MapTrialResult`:

- `passed`: N Wellen gehalten
- `lost`: das HQ fiel vorher
- `stuck`: fünf Minuten Wanduhr lang endete keine Welle

Dazu kommen die HQ-HP am Ende, die verlorenen HP je Welle, die Zahl der Tower und die Spielzeit. Danach
stoppt der Bot, die Spielgeschwindigkeit geht auf 1, und das Spiel bleibt stehen, wie es ist. Das
Ergebnis landet an vier Stellen:

- als Zeile im Banner
- auf der Konsole (`[MapTrial] {...}`)
- in `window.__mapTrial`
- beim Editor, der die Probe gestartet hat: sein Bot-Check läuft seit E195 Phase 5 im selben Fenster
  (Startauftrag `WorldStart.trial`), das Ergebnis geht an `AppScreen.trial` und steht in der Prüfung, sobald der
  Editor wieder zeigt. Per Link (`?bot=trial&trialWaves=N`) wird der Schalter beim Start zum Startauftrag

## Zerstörbarkeit (E131)

Eine Karte sagt es selbst: `gameplay.destructible: true` (im Editor unter Rules, „Destruction“), dazu `craters`
(Standard wie `destructible`), `wear` (Verschleiß durch vorbeilaufende Gegner, Standard aus) und `structureHp`
(50 bis 300 %); je Objekt `destructible: false` und der Vorschaden `damage` (1 bis 3). Der frühere Link-Schalter
`?destructible` ist entfallen. Mitgeliefert zerstörbar: die Endzeit-Stadt (`ruined-city`); OSM-Welten sind es, wenn der
Rahmen es nicht abschaltet. Plan, Modell und Entscheide: [DESTRUCTION_PLAN.md](DESTRUCTION_PLAN.md).

- **Bauwerke:** die Objekte, deren Katalogeintrag `building`, `wall` oder `structure` ist, ohne die Objekte der
  Wellen-Ereignisse (`CustomMapDestruction`); HP nach dem Volumen als Zylinder aus Grundradius und Höhe, 60 bis 3000,
  mal `structureHp`. Die Welt lädt den Katalog vor dem Senden an die Simulation (`attach` wartet darauf).
- **In der Simulation:** Die Bauwerke reisen in den Lauf-Regeln (`RunRules.structures` mit Grundriss, Dach und
  Start-HP, `RunRules.destruction` mit Kratern und Verschleiß) und damit im Weltschlüssel; ein Koop-Gast baut dieselbe
  Liste aus derselben Karte. `WorldDamage` (managers/game-state) hält die HP (`StructureLedger`, Stufen aus den HP), die
  Krater (`CraterLedger`) und das Stempelraster, auf dem die Gegner stehen und auf Schutt langsamer laufen. Snapshot und
  Zustands-Hash (Teil `health`) tragen HP und Krater; ein neuer Lauf stellt alles auf den Start der Karte.
- **Zum Hauptthread:** Ops `structures.setStages` (ein Byte je Bauwerk, nach Laden, Neustart, Restore, Sprung),
  `structures.stage` je Stufenwechsel, `craters.setAll` und `craters.dig`, dazu im Moment des Falls der flüchtige Op
  `main.structureFell` (Explosion in der Größe). `WorldDamagePresenter` reicht die Stufen an
  `WorldDestruction.setStages`/`setStage`: was fällt, schrumpft auf `FALLEN_SCALE` und blockiert das Bauen nicht mehr,
  was wieder steht, kommt zurück. Dasselbe Stempelraster bekommt das Routenraster für die Sichtproben.
- **Sichtlinien:** Tower, deren Reichweite plus Bauwerksradius einen Fall oder einen neuen Krater unter den Routen
  erreicht, fragen ihre Sicht neu an (`TowerLos.recompute`, Grund `world`; ein Tower, der noch auf seine erste wartet,
  bleibt bei `place`).
- **Bauen auf Dächern:** auch zerstörbare Gebäude tragen Tower; solange einer oben steht, nimmt das Gebäude keinen
  Schaden.
- **Debug:** In der Entwicklung trifft `__worldDamage.hit(lat, lon, reach, amount)` über die Simulation
  (`debug:hit-structures`, im Koop ein Cheat); `structures()` zeigt die Stufen.

## Ereignisse je Welle (E170)

Eine Karte sagt, was vor welcher Welle geschieht: `gameplay.events` (`MapWaveEvent`, höchstens 64, Wellen 1 bis 200),
gesetzt im Editor unter Rules, „Wave events“ ([LEVEL_EDITOR.md](LEVEL_EDITOR.md)). Arten: `message` (Text auf dem
Bildschirm), `weather` (Wetter und Stärke), `time` (Stunde, wie der Regler Tageszeit des Editors, `timeOfDay`),
`portal` (ein Spawn bringt erst ab dieser Welle Gegner), `objects` (Objekte erscheinen oder gehen: Tor, Brücke, Mauer).
Kein allgemeines Skriptsystem.

- **Zeitpunkt:** die Ereignisse von Welle N geschehen, wenn die Bauphase vor Welle N beginnt: am Ende von Welle N−1,
  für Welle 1 beim Start. Der Spieler sieht ein neues Portal, das Wetter und die Nachricht also, bevor die Welle kommt.
  Was gilt, ist eine Funktion der erreichten Welle (`reachedWave`: zwischen den Wellen die nächste, während einer Welle
  und nach dem Fall des HQ die laufende), eine Regel für Simulation, Hauptthread und Editor
  (`world/custom-map/wave-events.ts`: `portalWaves`, `hiddenObjectsAt`, `environmentAt`). Ereignisse einer Welle
  laufen in der Reihenfolge der Liste. Ein Objekt, dessen erstes Ereignis es zeigt, ist davor verborgen
- **Simulation:** die Ereignisse reisen in den Laufregeln (`RunRules.events`, die Objekte mit Ort und Grundradius,
  `CustomMapWorld.runRules`) und damit im Weltschlüssel (`runRulesKey`, Teil `e=`); `WaveEvents`
  (`managers/game-state/wave-events.ts`) führt sie. Ein Spawn mit Portal-Ereignis ist vor seiner Welle keine Spur
  (`CoopRoom.lanes` fragt `laneOpen`): seine Welle läuft dort nicht, er zählt nicht für Startcredits, Kill-Gold und
  Forschungspreise, und der Budget-Source plant die Welle auf die offenen Spuren. Öffnet er, hört die Forschung die
  neuen Preise (`announceState`). Sind alle Spawns erst später offen, laufen alle (der Check meldet das als Fehler).
  Erscheint oder geht ein Objekt, fragen die Tower in Reichweite plus Objektradius ihre Sicht neu an (wie ein
  gefallenes Bauwerk). Gesetzt wird beim Laden, nach jeder Welle (`wave:completed`), bei Neustart, Sprung und nach
  jeder Wiederherstellung (`syncWaveEvents`); ohne eigenen Zustand im Snapshot, denn die Wellenzahl liegt schon darin
- **Prüfsummen:** Karten mit Ereignissen haben einen anderen Weltschlüssel als ohne; der Zustands-Hash bleibt, wie er
  war (nichts Neues darin). Karten ohne Ereignisse, Tiles und DevWorld behalten Schlüssel und Hashes
- **Hauptthread:** Op `waveEvents.setReached(wave)` (auch nach Restore und Replay-Sprung) an
  `WorldProvider.showWaveEvents`: `CustomMapWorld` setzt Himmel und Wetter (`view.setEnvironment`, ab dem
  Kartenhimmel) und nimmt verborgene Objekte aus Bild, Sichtblockern und Baublockade (auf `FALLEN_SCALE` wie gefallene
  Bauwerke, auf der eigenen Kopie der Objektliste). Schon beim Anlegen der Welt gilt der Stand der ersten Welle, nichts
  blitzt auf. Live (nicht beim Sprung, Restore oder Replay-Sprung) kommt `map:wave-events` mit den Nachrichten und den
  Namen der geöffneten Spawns; `app-map-event-banner` zeigt sie einige Sekunden über dem Bild (länger bei mehr Text),
  Screenreader hören sie
- **Grenzen:** das Portal eines später öffnenden Spawns steht von Anfang an (mit Route), es bringt nur keine Gegner;
  Wetter und Tageszeit springen ohne Übergang; auf einer Karte mit Himmelsbild bewegt die Tageszeit nur die Sonne; ein
  zu Beginn verborgenes Bauwerk einer zerstörbaren Karte nimmt keinen Schaden

## Darstellung

`CustomMapView` (Renderer der Karte, `render/`) wird beim ersten Anhängen nachgeladen und so
verschoben, dass der Ursprung des Laufs (das HQ) der Ursprung der Szene ist. Darüber
`EnvironmentControls` wie in DevWorld, die Kamera beginnt über dem HQ; der Intro-Flug startet am HQ
und landet in der Übersicht über HQ, Spawns und Routen, wie auf echten Orten. Hat die Karte einen eigenen Flug
(`intro`, Orbit oder Kamerapfad aus dem Editor), spielt `introShot()` ihn statt der Tour: die Kamera schwenkt in
`enterSec` (3 s) aus der Startansicht hinein, folgt dem Flug (nie tiefer als 3 m über dem Boden oder dem Wasser darunter) und zieht
danach wie sonst in die Übersicht; ein Klick, das Rad oder Esc überspringen ihn. Kein Abtasten der Skyline: wohin die
Kamera fliegt, bestimmt der Kartenbauer. Die Säule der Karte kennt nur Boden
und Brückendecks; der Flug nimmt dazu `skylineAt` (Oberkante des höchsten Objekts, das das Bauen sperrt, über einem
Punkt, aus Fußabdruck und Höhe des Katalogs), sonst flog er auf Harbor Town durch Dächer. `view.attach(scene)`
hängt die Gruppe und die Sichtblocker (Gelände, blockierende Objekte) als direkte Kinder an die
Szene; `losBlockers()` gibt die Sichtblocker (der Sichtlinien-Würfel blendet alle anderen Kinder
aus). Himmel, Sonne mit Schatten, Licht und Nebel bringt die Karte mit
(`view.environment.apply`); die Fähigkeit `ownEnvironment` sagt der Engine, dass sie ihre eigenen
Lichter und ihren Himmel weglässt. Ihren Umgebungston (`life`, CUSTOM_MAPS.md „Umgebungston“) spielt
`CustomMapWorld` selbst (`hear`, jedes Bild): ein `Soundscape` am Audio-Kontext und Master-Bus, die die Engine beim
`attach` mitgibt (`WorldAttachContext.audio`), gehört vom Boden, auf den die Kamera schaut, mit der SFX-Lautstärke
des Spielers. Die Simulation liest `life` nicht, die Prüfsummen eines Laufs hängen nicht daran; den `contentHash` der Karte ändert es
wie jede andere Änderung.

## Minikarte

`WorldProvider.minimap()` gibt die Draufsicht einer Welt mit dem Szenen-Rechteck, das sie zeigt (Norden oben,
Westen links); Tiles und DevWorld geben `null`. Auf echten Orten (E142) zeichnet die Minikarte ihr Bild selbst aus OSM
(`components/world-minimap/osm-minimap.ts`): dunkler Grund, Gebäude als Flächen (die Footprints nahe der Routen, die
`BuildingOverlay` jetzt nach jedem Routenwechsel lädt, auch bei ausgeschalteter Ebene), Straßen als Linien (Hauptstraßen
breiter, Fußwege nicht), als Quadrat um HQ, Spawns und Routen mit Rand, mindestens 400 m; ebenso in DevWorld, deren
Straßen erzeugt sind. Die Szene hat Norden bei +Z und Osten bei -X, das Rechteck (`osmArea`) legt deshalb links den
größeren X-Wert an. Der Ebenen-Knopf schaltet auf eine Straßenkarten-Ansicht (`minimapLook: 'map'`): helle Gebäude und Straßen,
Straßen 12 m und Nebenstraßen 7 m breit mit dunklem Rand, Farben `TD_THEME.map*`. Die eigene Karte rendert sie einmal
nach ihrem ersten gezeichneten Bild (`custom-map-minimap.ts`): orthografisch von oben, nur die Szenenkinder, die
`view.attach` und `environment.apply` angehängt haben (Gelände, Wasser, Objekte, Licht), 512 px an der längeren
Seite. Sie braucht keine eigenen Shader-Programme: der Nebel bleibt mit Dichte 0 an der Szene, alle Lichter bleiben an
(Nebel und Zahl der Lichter gehören zum Programm), und das Ziel ist wie das der Bilder: ohne Nachbearbeitung gilt es
three als Bildschirm (`isXRRenderTarget`, sRGB heraus), mit Bloom oder Grading ist es ein lineares Ziel wie das des
Composers (danach nach sRGB gewandelt). Mit eigenem Programm je Material warteten kalte Ladevorgänge 3 bis 4 s auf
deren Linken.

`app-world-minimap` (unter dem Kompass, `td-overlay`) zeichnet jeden Frame außerhalb Angulars in ein Canvas: Bild,
Routen in der Farbe ihres Spawns, Spawns und HQ einmal in ein Grundbild (neu, wenn Welt, Routen oder HQ wechseln),
Tower und Gegner höchstens alle 50 ms in ein Punkte-Canvas (Bosse größer, je Bildpunkt höchstens ein Gegner gezeichnet),
darüber jeden Frame das Sichtfeld der Kamera (die vier Bildecken auf der Bodenhöhe des HQ). Ein Klick führt die Kamera per `focusGeo` dorthin, Ziehen mit gedrückter Taste setzt sie sofort
mit (`focusGeo(lat, lon, true)`, Pointer Capture). Das Minus klappt sie zu einem Stein „Map“ ein (`minimapOpen`), offen
und Ansicht bleiben im UI-Store gespeichert.

## Laden

**Kartendaten nachladen (Vorbereitung E134, 2026-10-12):** `world/custom-map/map-data.ts`. `maps/index.json`, die
mitgelieferten Karten und `maps/assets/` (rund 190 MB) kommen über `mapDataFetch`: aus der Cache Storage des Browsers
(`3dtd-map-data-<Version>`), sonst vom Netz und dann dort abgelegt. Der Index fragt zuerst das Netz (offline der
Cache), eine mitgelieferte Karte wird mit ihrem Inhalts-Hash angefragt (`?v=`), Modelle laufen über denselben Weg
(`loadGlb` mit `parseAsync`). Woher: `mapData` in `runtime-config.json`, sonst neben der Seite (der Dev-Server liefert
`public/maps`). Ein neuer Build beginnt mit leerem Cache, `dropOldMapData` räumt die alten (beim Lesen der
runtime-config). Die Ladeplatte zeigt „Map data 12 of 48 files, 3.4 MB“, solange Dateien vom Netz kommen. Die
Desktop-App hält die Cache Storage im Profil auf der Platte (`app://` ist als sicheres Schema registriert).
Jede Datei hinterlässt ein `performance.measure` `map-data <Quelle> <Pfad>` (Quelle `cache`, `network`, `stale` oder
`failed`, Bytes im `detail`; vom Netz der ganze Download, aus dem Cache das Nachschlagen): ein langsamer Start nennt
die Datei und woher sie kam. `e2e/perf/shipped-maps.ts` druckt dazu je Ladevorgang Dateien, MB und summierte ms je
Quelle und die langsamsten Dateien (2026-10-14, optimierter Dev-Stand, frischer Browser-Kontext: Demo-Tal 60 Dateien,
20,2 MB, Hafenstadt 83 Dateien, 19,2 MB, alle vom Netz, kalt 4,4 und 4,7 s).
Offen für die Freigabe: die Daten auf den Webserver legen, dort CORS für die Seite und `app://`, im CSP der
Desktop-App (`desktop/src/protocol.js`, `connect-src`) den Host eintragen, `mapData` in die runtime-config.
Die Desktop-App, ungepackt aus einem Checkout gestartet (`electron .` nach `web:build`), liefert eine Kartendatei, die
dem Build fehlt, aus dem `public/maps` des Checkouts (`mapDataRoot` in `createAppProtocolHandler`, nur Pfade unter
`maps/`); sonst fänden Editor und KI-Agent dort weder Katalog noch mitgelieferte Karten. Die gepackte App nicht.

- `startHq` öffnet die Karte und beginnt sofort, ihre Bodenmaterialien und Modelle zu laden
  (`prefetchCustomMapAssets`), während Engine, Straßen und Routen entstehen
- Die Karte zeichnet ihr erstes Bild erst, wenn ihre Texturen und Modelle da sind und alle ihre
  Shader-Programme parallel abseits des Hauptthreads übersetzt sind (`compileAsync` mit
  `KHR_parallel_shader_compile`, die ganze Szene wie `view.warmUp`); bis dahin hält `ready()` die Bilder zurück.
  Vorher übersetzte jedes neue Material sein Programm synchron im ersten Bild, das es zeigte. Zeichnen die Bilder
  durch die Nachbearbeitung (Bloom oder Grading an, `WorldAttachContext.drawsToTarget`), wird für ein lineares Ziel
  übersetzt, sonst linkt das erste Bild alles neu; die Engine bekommt die gespeicherten VFX-Einstellungen deshalb
  schon beim Anlegen. Kalt mit Bloom: 9,4 bis 17,6 s vorher, 5,6 bis 5,7 s danach (Demo-Tal)
- Die Lichter einer Karte (Laternen, Fackeln, Feuer) ändern kein Programm: die echten Lichter des Pools gehen als
  feste Lichter in den Lichtpuffer der Szene (`WorldAttachContext.lights`, `three-engine/shot-lights`), nicht als
  three-`PointLight`. Tag, Nacht und jede Stufe zeichnen mit denselben Programmen, nichts wird für einen zweiten
  Lichtzustand übersetzt. Vorher übersetzte die Karte beide Zustände (Pool an und aus) und die Engine für Tower,
  Sockel und Pools ebenso. Harbor Town, High (Browser-Probe 2026-10-19, Zählung `linkProgram`): bis `ready` 397 bis
  405 Programme vorher, 212 bis 215 danach; nach den Stufen im Hintergrund 557 bis 642 gegen 277; die erste Nacht
  linkte vorher trotzdem 60 bis 85 Programme, danach keins. Engine und Ladeschirm warten weiter auf den ersten Boden
  (`warmupLoading`)
- Die Kamerasteuerung raycastet die Karte analytisch (`MapGroundPick`: Höhenfeld und Dächer, die Tower tragen, über
  `CustomMapSurface.pickRay`), mit dem Cache von `GroundPickRoot`; dessen Version zählt die Dächer
  (`surface.pickVersion`) und die Verschiebungen der Karte, statt jeden Knoten der Sichtblocker zweimal je Bild zu
  durchlaufen. Bäume halten den Zoom nicht mehr an, Gelände und Dächer schon
- Die Karte steht still: `view.group` und `view.losBlockers` sind `StaticGroup`s (`three-engine/static-group.ts`),
  ihre Weltmatrizen rechnen nach einem Verschieben (`view.placeAt` aus `setOrigin`) oder für Hinzugekommenes neu,
  nicht in jedem Bild. Demo-Tal im Spiel: 523 Multiplikationen je Bild in der Matrixaktualisierung für die Karte
  vorher, keine danach; im Editor 349 gegen keine (Browser-Probe)
- Solange Programme vor dem ersten Bild übersetzen (die Karte nach ihren Assets, `WorldProvider.compiling`, und das
  Aufwärmen der Engine-Modelle), zeigt der Ladeschirm den Schritt „Compiling Shaders“ mit der Zahl fertiger Programme
  aller im Renderer (`ThreeTilesEngine.compileProgress`, alle 250 ms gelesen, `EngineInitializationService.compilingAhead`);
  vorher stand dort sekundenlang „Preparing Intro Flight“. Zwischen den Ladeschritten wartet der Ablauf nur dann ein
  gezeichnetes Bild ab, wenn sich ein Schritt geändert hat (`afterNextPaint`), statt fest 50 ms je Wechsel
- Beim Verlassen gibt die Welt die geteilte `MapAssetLibrary` frei (etwa 88 MB Materialpixel); die nächste Karte
  legt eine neue an
- Höhen für das Overlay: eine Runde sofort statt vier Runden zu 500 ms, weil der Boden nicht streamt
  (`HeightUpdateService`, `capabilities.streaming`)
- Messen: `e2e/perf/map-load.ts` gegen einen Produktions-Build (Schritte als `performance.mark`
  `load:<schritt>`, mit `--profile` die CPU-Zeit je Funktion). Stand 2026-10-11, Chromium mit Fenster:
  2,3 bis 2,9 s bis spielbar, beim ersten Start des Browsers 3,1 bis 3,8 s (vorher 7,6 bis 9,3 s beim
  Demo-Tal)

## Abfragen (`CustomMapSurface`)

- Höhen aus dem Höhenraster der Karte über `HeightField`, dieselben zwei Dreiecke je Zelle, die der
  Renderer zeichnet (eine Funktion `gridHeightAt` in `render/height-field.ts`; seit E225 rechnen auch Editor, Prüfung,
  Kartenoperationen, Level-Bake, Agent `map.h()` und die OSM-Umwandlung damit statt bilinear;
  Diagonale je Zelle nach `cellSplit`, der kürzeren Höhendifferenz, aus den vier Eckhöhen,
  deterministisch); allokationsfrei bis auf das Spalten-Objekt, das die Schnittstelle zurückgibt. Seit der Diagonale
  je Zelle liegen Gegner an steilen Wänden anders als vorher: Prüfsummen und Replays eigener Karten von davor passen
  nicht mehr; echte Orte und DevWorld nutzen `HeightField` nicht
- Brücken: Kanten der Art `bridge` tragen ein Deck (`bridge-decks.ts`, dasselbe für Renderer, Spiel und Editor:
  Enden über dem Wasser, leichter Bogen); `topY` der Spalte und die Straßenhöhe liegen darauf, `groundY` bleibt der
  Boden darunter
- Sichtlinie über das Gelände (Schritte von einer halben Zelle); Objekte sieht der Sichtlinien-Würfel
- Kein Streaming, keine LOD-Stufen, kein Messen der Straßenbreite (die Kanten haben ihre Breite)
- `buildBlocker` sagt, warum ein Tower nicht stehen darf, `null` wo er darf. Die Platzierungsregel fragt mit
  dem Radius eines Towers (3 m, `PLACEMENT_CONFIG.TOWER_BUILD_RADIUS`) und zeigt den Grund als Hinweis:
  - „Water there“ (`inWater`): die Mitte oder ein Punkt des Rings (0,7 x Radius) liegt in einem Gewässer
    (`terrain.water` und `waterBodies`, jede Art auch Eis und Lava: Maske gesetzt und Boden mehr als
    0,3 m unter dem Spiegel, `WATER_DEPTH_M`), oder näher an der Linie eines Flusses (`terrain.rivers`)
    als seine halbe Breite plus der halbe Towerradius. Flache Ufer bleiben bebaubar, Brücken nicht
  - „Something stands there“: Objekte, die das Bauen verbieten (eigenes `blocksBuild`, sonst das ihres
    Katalogeintrags), in 16-m-Feldern: die Scheibe aus Grundfläche mal Skala, bei Gebäuden und Mauern geschnitten
    mit ihrem gedrehten Rechteck (Katalog `box`, 0,9 der Modellhülle wie die Grundfläche,
    `tools/map-assets/measure_boxes.mjs`, `object-ground.ts`). Eine 46-m-Schule sperrt quer zu ihrer Länge 7,6 m
    statt 21 m (E201); ohne `box` gilt die Scheibe wie bisher. Dieselbe Regel gilt für die Bauflächen des Editors
  - Tiles und DevWorld antworten immer `null` (Tower stehen dort auf Dächern)
- **Dächer** (E217, `object-roof.ts`): Gebäude, Mauern und Bauwerke, deren Katalogeintrag ein `roof` hat, tragen
  Tower auf ihrer Oberkante wie die Dächer der Tiles. `roof` ist ein Höhenraster über die Modellhülle bei Skala 1
  (höchstens 24 Zellen je Seite, mindestens 0,5 m, ein Byte je Zelle, Base64), senkrecht von oben gemessen von
  `tools/map-assets/measure_roofs.mjs` (Gebäude, Mauern und Bauwerke, die das Bauen sperren, mindestens 2,5 m hoch,
  weder `float` noch `aloft`; Zaun, Hecke und Brücke tragen nichts). Auf der Karte wird es gedreht, skaliert und auf
  den Sitz des Modells gehoben (`seatHeight` plus z wie der Renderer). Es gilt für:
  - `pickRay`: der Cursor trifft das Dach statt des Bodens dahinter (Strahl gegen jedes Dach, Vortest per Kugel)
  - `roofAt`: Cursor-Fläche des Towers ist das Dach
  - `footprintColumn`: `topY` ist das Dach, `groundY` der Boden, dazu `built`: von einer gebauten Oberkante führt kein
    Hang hinab, die Fassade ist eine Kante (`carryingHeights`); der Sockel endet am Dach und ragt mit Kragsteinen
    hinaus, statt ein kleines Haus bis zum Boden einzuhüllen
  - `buildBlocker`: steht die Mitte auf einem tragenden Dach, sperren tragende Objekte nicht, Wand und Kante
    entscheiden wie auf den Tiles (`resolveTowerFootprint`); am Boden neben einem Haus sperrt es wie vorher, Bäume
    und Objekte ohne `roof` überall
  - die Bauflächen des Editors (`build-areas.ts`) mit denselben Regeln
  Ein Dach ist das Höchste aus 3 x 3 Strahlen je Zelle (der dünne Pfahl einer Palisade fällt nicht durch); zwischen
  vier Zellen wird nur gemischt, wo sie weniger als 1 m auseinanderliegen (Satteldach), eine Stufe (Mauerflucht,
  Brüstung) bleibt eine Kante.
- **Kronen** (`roof.kind: 'crown'`, Mauern und Torhäuser: Katalogkategorie `wall` oder `roadThrough`, aber nur mit
  festem Wehrgang im gebackenen Raster: auf mindestens 80 % der Länge ein Lauf fester Zellen quer von mindestens
  1 m, Nachbarn höchstens 1 m Stufe; fest heißt, mindestens 6 der 9 Strahlen einer Zelle treffen höchstens 0,6 m
  unter ihrer Oberkante. Eine Mauer ohne ihn trägt gar keinen Tower und sperrt wie vorher: Zaun, Eisentor, Ketten,
  Palisade aus Einzelpfählen, Stützmauer; ein Torhaus ohne ihn behält ein gewöhnliches Dach): der Tower
  steht auf der Mittellinie der Krone, quer zum Cursor verschoben (`crownAt`, `TowerPlacementService.onCrownLine`,
  ebenso die Editor-Bauflächen), und darf mit dem inneren Ring über beide Seiten ragen, solange die Mitte auf der
  Krone steht und die Dächer ihn den halben Radius in beide Richtungen entlang der Krone tragen (`crownCarries`, alle
  0,5 m ein Dach höchstens `MAX_DROP` unter und `MAX_RISE` über der Mitte, auch das nächste Mauerstück). Achse der
  Krone: die längere oder kürzere Seite des Modells; wo Mauerstücke und Eck- oder Torteile übereinanderliegen,
  zählt das Teil und die Richtung, die am weitesten trägt (dann das höhere, dann die nächste Mittellinie), höchstens
  4 m halbe Breite. Darunter tragen Kragsteine den Sockel auf beiden Seiten der Mauer (`crownBraces`, dieselben
  Steine wie an der Dachkante, `TowerPlinthRenderer` fragt `crownAt`, ebenso die Bauvorschau), die Sockelwand reicht
  dort nicht zum Boden hinab. So passen alle Tower auf Burgmauer und fort-wall (Spec
  `object-roof.spec.ts`). Die Regel der echten Orte bleibt: ohne `crown` an der Säule gilt die Kante wie bisher
- Keine Dächer tragen Objekte, die den Lauf verlassen können (`passingObjectIds`: von einem Wellen-Ereignis gezeigt
  oder verborgen, auf zerstörbaren Karten alle Gebäude, Mauern und Bauwerke) und gekippte Objekte; sie sperren wie
  vorher. Ob eine Karte zerstörbar ist, sagt allein `gameplay.destructible`: das Spiel startet sie so (der Parameter
  `destructible` von `CustomMapWorld` gibt es nur für Specs, der einzige Aufrufer lässt ihn weg), die Bauflächen des
  Editors lesen denselben Wert. Die Simulation prüft keine Platzierung, `command:place-tower` trägt Fuß und Sockel: Prüfsummen und Replays
  bleiben.

`CustomMapFrame` rechnet Szene und Karte ineinander um: Szene x = Ursprung x - Karte x, Szene z =
Karte y - Ursprung y. Der Kosinus der Ursprungsbreite fehlt: eine Karte reicht höchstens wenige
Kilometer vom Äquator, der Fehler bleibt unter einem Millimeter.

## Straßen (`CustomMapStreets`)

Jede Kante des Wegenetzes wird eine Straße von Knoten a über die Kurvenpunkte zu Knoten b; Knoten, an
denen Kanten zusammentreffen, sind gemeinsam. `width` ist die Breite der Kante, Brücken tragen
`bridge: 'yes'`, Wege den Typ `residential`, Straßen und Brücken `primary`. Routen über die A*-Suche
von `StreetRouter`, wie auf jedem Netz; die Richtung der Kanten zählt dabei nicht (Karten aus dem
Import führen ohnehin zum HQ). Keine Gebäude, Spawn-Namen aus der Karte.

`StreetStyle`: Overlay 0,5 m und Routenlinie 1,5 m über dem Boden, in 4-m-Stücke geteilt (Rampen und
Klippen), Höhen vom Gelände, kein Mitführen der Höhe zum HQ. Der Boden ist eben im Sinn des Korridors
(`plainGround`): Über einer Straße steht nichts, eine Kuppe auf der Straße wird kein Durchgang (Tunnel durch den
Hügel) und die Zellen hinter einem Brückenende liegen auf dem Ufer, nicht auf der Höhe des Deckendes
([ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md), Band und Strecke hinter dem Brückenende; TODO E160). Gegner, Routenlinie
und Sichtlinien lesen dieselben Zellen; über einer Brücke ihr Deck (TODO E161, im Spiel geprüft: Ember Crater,
Gegnerhöhe auf der Brücke 7,0 bis 7,9 m, Lava darunter 0,8 bis 5,5 m). Die Karte zeichnet ihre Straßen selbst;
das gelbe Straßen-Overlay ist eine Debug-Ebene und standardmäßig aus, es entsteht also nichts doppelt.

## Fähigkeiten

Kein echter Ort (keine Ortssuche, kein Speichern über den Ort, kein Globus), keine Zugangsdaten, kein
ECEF, kein Streaming, nicht neu würfelbar, zerstörbar, wenn die Karte es sagt (`gameplay.destructible`), `controls: 'environment'`.
Unter der Karte stehen ihr Name und Autor und „Assets: CC0, see licences“; der OSM-Hinweis erscheint nur
auf echten Orten.

## Koop, Spielstand, Replay

- Koop: Der Host schickt die Karte über das Relay in Stücken, der Gast legt sie in seinen Map-Store und
  lädt die Seite auf ihr neu ([COOP_PLAN.md](COOP_PLAN.md) C1c). Ein Gast ohne Cesium-Token wartet auf
  keinen Schlüssel (`capabilities.credentials`).
- Spielstand und Replay tragen den `WorldRef` mit `contentHash`; eine geänderte Karte lehnt der Start ab.
  Die Spielwerte stehen im Dokument und damit im Hash.

## Geprüft

Specs in `custom-map-world.spec.ts`: Frame gegen `geoToLocalSimple`, Höhen nach Geo und Szene,
Brückendeck, Sichtlinie, Bodenpick, Straßennetz und Route über Kurvenpunkt und Brücke,
Kuppe ohne Durchgang auf ebenem Boden (`corridor-band.spec.ts`), Zellen hinter einer niedrigen Brücke auf dem
Ufer (`global-route-grid.spec.ts`),
Startaufstellung, Spawn-Grenze, Spielwerte und Wellen der Karte, Fallen und Aufstehen von Bauwerken auf
der eigenen Kopie, Öffnen einer gespeicherten, fehlenden und geänderten Karte; dazu
`custom-map-destruction.spec.ts`, `world-damage-presenter.spec.ts`, `map-trial.spec.ts`,
`world-choice.service.spec.ts`, `worlds/worlds-stage.scenario.spec.ts`.

E2E ohne Kartensitzung (`e2e/tests/custom-map.e2e.ts`): Demo-Tal per Link mit Tower und Welle, Kartenprobe
des Bots, „Test map“ aus dem Editor, Spielstand speichern und laden, Replay einer Welle, ein Bauwerk der
Endzeit-Stadt fällt per Debug-Treffer und steht nach „Restart here“ wieder, Koop auf einer eigenen
Kopie des Demo-Tals mit einem Gast ohne sie (Kartenversand, eine Welle, kein DESYNC). Im Browser (Dev-Server, die importierte Testkarte in IndexedDB): Karte lädt in 12 bis 18 s (Dev-Server),
8 Portale, Wellen laufen die Wege zum HQ, gebaute Tower schießen.
