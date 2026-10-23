# Zerstörung in eigenen Welten (Plan)

**Status:** Z1 (Unterbau Simulation) gebaut 2026-10-19, dazu aus Z5 die Regeln, der OSM-Schalter und der Vorschaden
im Format. Z2 (Gebäude in Stufen, Ruinen, Glutnester), Z3 und Z4 (Schutt, Effekte, Gelände) gebaut bis auf den Ton;
die Editor-Werkzeuge (Z5) und das Nachstellen des Verschleißes (Z6) offen. Baut auf
[CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md) (Zerstörbarkeit E131), [OSM_WORLD_PLAN.md](OSM_WORLD_PLAN.md),
[LEVEL_EDITOR.md](LEVEL_EDITOR.md), [SIM_WORKER.md](SIM_WORKER.md), [SIMULATOR_PLAN.md](SIMULATOR_PLAN.md) und
[LOS_PIPELINE.md](LOS_PIPELINE.md) auf.

**Geltung:** nur Welten, deren Geometrie dem Spiel gehört: eigene Karten (`custom-map`) und OSM-Welten (die ebenfalls
eigene Karten sind, `world/osm/convert`). Echte Orte (Photorealistic Tiles), eigene Tilesets und DevWorld bekommen keine
Zerstörung; `capabilities.destructible` bleibt dort aus.

## Ziel

Gebäude, Mauern und Gelände tragen sichtbar, was im Kampf passiert: ein Haus an der Hauptstraße bekommt Risse, verliert
das Dach, stürzt in Staub zusammen und bleibt als Ruine mit Schutthaufen stehen; Raketen und der Atomschlag reißen Krater
ins Gelände, die bis zum Ende des Laufs bleiben. Alles deterministisch aus der Simulation, gleich für Coop-Partner,
Replays und Spielstände, ohne dass die Bildrate es merkt.

Leitlinien (Marschroute): extrem performant, architektonisch sauber und erweiterbar, handgemachte Optik. Daraus folgt:

- Eine Quelle der Wahrheit: die Simulation hält ganze Zahlen (HP, Kraterliste), der Hauptthread leitet jedes Bild daraus
  ab. Kein Zustand, der nur im Bild lebt und beim Replay-Sprung verloren ginge.
- Ein Mechanismus je Sache: Krater und Schutthaufen sind beide Stempel ins Höhenraster (negativ und positiv), dieselbe
  Stempelfunktion für Spiel, Editor und Vorschau.
- Kein Bildbudget für Zerstörung, das mit der Zahl der Ruinen wächst: Ruinen leben in Instanz-Attributen und
  Höhenraster, Animation läuft im Shader.
- Gespielt wird auf Wegen, die feststehen: Zerstörung ändert keine Route.

## Was gebaut ist (E131, Z1)

- **Karte:** `gameplay.destructible` (Editor: Rules, „Destruction“), dazu `craters` (Standard wie `destructible`),
  `wear` (Standard aus) und `structureHp` (50 bis 300 %); je Objekt `destructible: false` (steht immer),
  `damage: 1 | 2 | 3` (Vorschaden, Startstufe) und `damageSeed` (würfelt das Bild der Ruine, sonst die Id). Mitgeliefert
  zerstörbar: `ruined-city`. OSM-Welten sind zerstörbar, außer der Rahmen sagt nein („Buildings take damage and fall“).
- **Bauwerke:** Objekte der Katalogkategorien `building`, `wall`, `structure` (`custom-map-destruction.ts`), ohne die
  Objekte von Wellen-Ereignissen; HP aus dem Zylindervolumen (60 bis 3000) mal `structureHp`. In den Laufregeln
  (`RunStructure`) mit Grundriss (`box`: Mitte, halbe Breite und Tiefe, Drehung, auf cm und 1e-4 rad gerundet), Dach
  (`roof`) und Start-HP (`start`), alles im Weltschlüssel.
- **Simulation:** `WorldDamage` (`managers/game-state/world-damage.ts`) hält `StructureLedger` v2, `CraterLedger` und
  das Stempelraster (`utils/stamp-field.ts`), siehe „Modell“.
- **Hauptthread:** `WorldDamagePresenter` reicht die Stufen an `WorldDestruction.setStages`/`setStage` (die Ansicht
  zeigt sie als Ruinen, siehe „Gebäude in Stufen“), führt dasselbe Stempelraster und gibt es dem
  Routenraster für die Sichtproben (`GlobalRouteGrid.setStampField`).
- **Bauen:** ein gefallenes Objekt sperrt nicht mehr; Dächer zerstörbarer Gebäude tragen wieder Tower
  (`passingObjectIds` nur noch für Wellen-Ereignisse), solange einer oben steht, nimmt das Gebäude keinen Schaden.

Offen: Tower ohne Projektil (Strahl, Kette, Laser,
Säge, Strom) beschädigen nichts, Werkzeuge im Editor (Z5).

## Messungen (2026-10-18)

Produktions-Build dieses Stands, statisch ausgeliefert (`e2e/perf/serve.mjs --isolate`), Chromium mit Fenster und GPU
(RTX 5080), 2048 x 1152, Qualität High, Ruined City (512 m, Raster 257 x 257 bei 2 m, 9 942 Objekte), Startansicht nach
dem Intro. Je Fall 3 s Bilder mit einem `readPixels` je Bild (Bildzeit samt GPU). Der Rechner war von anderen Läufen
belegt: die Grundlinie schwankte zwischen den Läufen von 8 auf 24 ms Median, die Zahlen sind deshalb Richtwerte, die
Vergleiche gelten nur innerhalb eines Laufs. Das erste Bild jedes Falls (400 bis 1 500 ms im ersten `readPixels` nach
der Pause) ist ein Artefakt der Messung und nicht mitgezählt.

| Fall | Synchron im Aufruf | Längstes Bild danach (ohne erstes) | Grundlinie im selben Lauf |
|---|---|---|---|
| ein Bauwerk fällt (Debug-Treffer über die Simulation) | `objectsChanged` 0,1 bis 2,6 ms, Ausreißer 4,5 ms; fertig nach 15 bis 25 ms (asynchron) | 29 bis 48 ms | 29 bis 39 ms |
| 5 Bauwerke nacheinander | je 0,4 bis 4,5 ms | 91 ms (einmal), sonst im Rauschen | 29 ms |
| 20 Bauwerke in einem Befehlsschwall | je 0,1 bis 2,2 ms, 20 einzelne Aufrufe | 30 ms | 29 ms |
| Krater 8 m Radius, 2 m tief (`view.updateHeights(rect)`) | 1,5 bis 2,7 ms | 21 bis 74 ms | 21 bis 41 ms |
| 10 Krater, einer je Bild | 0,8 bis 2,0 ms je Krater | 117 ms (einmal) | 29 ms |
| Krater 25 m Radius, 5 m tief (Atomschlag) | 2,0 bis 2,8 ms | 38 ms | 29 ms |
| ganzes Höhenraster neu (`view.updateHeights()`) | **118 bis 174 ms** | | |
| 128 kleine Krater (3 m) nur ins Raster schreiben | 0,56 ms gesamt | | |

Was die Zahlen sagen:

- Ein einzelner Fall oder Krater kostet heute 1 bis 3 ms auf dem Hauptthread, ohne messbaren Ruckler. Das ist die
  Größenordnung, in der ein Stempel je Bild bleiben darf; mehrere je Bild müssen gebündelt werden.
- Ein Neuaufbau des ganzen Rasters (Spielstand laden, Replay-Sprung mit vielen Kratern) hält das Bild 118 bis 174 ms an.
  Das Wiederherstellen darf deshalb nicht `updateHeights()` rufen, sondern muss die Stempel ins Raster schreiben
  (0,56 ms für 128) und nur die berührten Kacheln neu aufbauen.
- Ein Fall ist heute billig, weil nichts liegen bleibt. Ruinen dürfen das nur nicht verschlechtern: kein neues
  Shader-Programm im Spiel, keine Geometrie je Ruine auf der CPU.

Nicht gemessen: Draw Calls und Dreiecke (das Statistik-Panel liefert im Produktions-Build ohne offenes Panel Nullen),
OSM-Welten (keine mitgelieferte OSM-Karte, Overpass-Last vermieden). Für OSM gelten die Zahlen aus
[OSM_WORLD_PLAN.md](OSM_WORLD_PLAN.md): bis 7 928 Gebäude je Welt, Stuttgart Mitte 1 172 Draw Calls und 9,7 M Dreiecke
in der Startansicht.

Probe: `tmp/destroy-probe.ts` im Worktree (nicht im Repo), Aufruf im Kopf der Datei.

## Lehren aus einem früheren Prototyp

Ein Versuch, Gebäude in fremder Geometrie per Shader zu brechen, hat gezeigt, was trägt und was nicht. Übertragen:

- **Starrer Fall statt Verformung:** Was über der Bruchkante liegt, fällt als ein Stück (gleiche Transformation für alle
  Ecken, 4,9 t², leichter Zug zur Mitte). Sobald Ecken eines Dreiecks verschieden bewegt werden, wird gestreckt.
- **Dreiecke an der Kante verwerfen:** nach der Landung jedes Dreieck weg, das eine Ecke über der Kante hat. Der Rand
  folgt dann den Dreiecken (zackig, wirkt gebrochen) und nichts wächst nach.
- **Randverzerrung nur nach Winkel:** eine Bruchhöhe, die nach Ort verrauscht ist, macht Inseln, also schwebende Stücke.
- **Eine Hülle braucht Ersatz:** jedes Gebäude ohne Innenleben zeigt nach dem Schnitt Löcher. Rückseiten nie verwerfen
  (sonst Löcher), nie schwarz (wirkt selbst wie ein Loch): eigene Farbe gedimmt und verstaubt. Decken je Stockwerk und
  eine Bodenplatte schließen den Blick nach innen.
- **Schutt nach Volumen:** die Höhe des Haufens aus dem, was herunterkam, geglättet, das Volumen bleibt.
- **Effekte, die tragen:** Blitz, Funken, Staubsäule, Bodenwalze, Nachrauch, Glutnester; Shake an der Display-Option, nie
  an ihr vorbei.
- **Was nur im Bild lebte, war die Grenze:** Raycasts, Sichtlinien, Bodenproben und Coop sahen die Schäden nicht. Hier
  gilt deshalb: Simulation zuerst.

Auf eigenen Welten ist es leichter als im Prototyp: Modell, Grundriss (`box`), Höhe, Stockwerke, Material und Instanz
sind bekannt, nichts muss aus Pixeln gemessen werden.

## Modell

Drei Schichten, jede mit einer Aufgabe.

### 1. Simulation (Worker): was zerstört ist (gebaut, Z1)

Alles in `WorldDamage` (`managers/game-state/world-damage.ts`), das der `GameStateManager` als `worldDamage` hält.
Ganze Zahlen und die IEEE-Grundrechenarten, Drehungen über `DetMath`; die Werte stehen in
`configs/destruction.config.ts` und an den Projektiltypen.

**`StructureLedger` v2** (`managers/game-state/structure-ledger.ts`)

- **Stufen aus HP, kein neuer Zustand:** Stufe 0 intakt (über 75 %), 1 angeschlagen (bis 40 %), 2 schwer (unter
  40 %), 3 gefallen (0), `structureStage` mit ganzen Zahlen. Snapshot und Hash tragen nur die HP.
- **Löcher** (E259, `StructureLedger.punch`): ein Treffer mit mindestens 25 Gebäudeschaden (`HOLE_LEAST_DAMAGE`:
  Heldengranate 25, Kanone 30, Rakete 45, Belagerungsgranate; nicht Kugeln, Flak, Magie) hinterlässt ein Loch, wo er
  einschlug: je Bauwerk die letzten sechs, je fünf ganze Zahlen (Versatz zur Mitte in dm, auf der Seite des Treffers
  und höchstens 90 % des Radius weit; Höhe über dem Grund in dm, aus Bauwerk und Lochzähler gewürfelt, 25 bis 80 % der
  Höhe; Radius in dm; die Nummer des Lochs). Der Radius folgt dem Schaden, nicht dem HP-Anteil: 1 m plus ein Viertel
  der Wurzel des Schadens (Kanone 2,4 m, Rakete 2,7 m), mal 6 m durch den Bauwerksradius in 0,6 bis 1,4 (`holeRadiusDm`;
  ein Häuschen von 4 m bekommt von der Rakete 3,7 m, ein Block von 12 m 1,6 m), 0,8 bis 5 m. Ein Treffer innerhalb 1,5 m
  plus Radius eines Lochs vergrößert es um 0,6 m (höchstens 6 m), sonst nimmt er einen freien Platz oder den des ältesten.
  Auch ein Gefallener nimmt weiter Löcher, tief in seinem Stumpf (0,3 bis 2 m über dem Grund); HP und Stufe bleiben,
  es gibt keinen Stufen-Op (`hit` sieht dafür auch gefallene Bauwerke, `near(…, fallen)`). Erreicht der Lochzähler
  einer Ruine dabei 2, 6, 10 … (`WEAR_SIGHT_EVERY`), gilt eine Wand als weg: die Tower in Reichweite rechnen ihre
  Sichtlinie neu (`StructureEvents.worn`, `seeAround`); ein einzelnes Loch tut das nicht.
  Sie gehen einmal je Paket als `structures.holes` an den Hauptthread und ganz mit den Stufen (`setStages`); Snapshot
  und Hash tragen sie, sobald es eines gibt (`structureHoles`, wie die Richtungen: ein Spielstand von davor lädt ohne
  Löcher, ohne neue Formatversion). Instandsetzen nimmt sie. Spec: gleiche Löcher und Prüfsumme auf zwei Clients, im
  Replay ohne Abweichung, aus dem Snapshot zurück (`sim-core.spec.ts`, `structure-ledger.spec.ts`).
- **Typisierte Felder und Raster:** Ort, Radius, HP, Stufe je Bauwerk in Typed Arrays, dazu ein Raster aus 16-m-Feldern
  (CSR, jedes Bauwerk in den Feldern, die sein Kreis deckt). Ein Treffer prüft die Bauwerke der Felder in seiner
  Reichweite und wendet den Schaden in Reihenfolge der Laufregeln an (sortiert), damit Fälle und Sichtanfragen auf
  jedem Client in derselben Reihenfolge kommen. Spec: 200 Abfragen auf 2 001 Bauwerken gleich dem vollen Durchlauf.
- **Schadensquellen:**
  - Projektil: `structureDamage` am Typ (Pfeil 0, Bolzen, Kugel, Gift, Heldenkugel 1, Eis 2, Magie 3, Rune 4,
    Chaos 6, Flak 10, Heldengranate 25, Kanone 30, Rakete 45), Reichweite `splashRadius` plus 1 m plus Bauwerksradius.
    Ein Treffer in der Luft (Ziel ist ein Luftgegner) beschädigt nichts und gräbt nichts.
  - Fähigkeiten über `AbilityWorld.damageWorld(id, at, fromMs, toMs)`: der Atomschlag fällt alles in 25 m plus
    Bauwerksradius und gräbt 25 m und 4 m tief; der Orbitallaser nimmt 150 HP je Sekunde in 5 m um seinen Fußpunkt, je
    Teilschritt die ganzen HP zwischen den Zeiten (`floor(150 · bis) - floor(150 · von)`), über den Strahl genau so viel wie
    am Stück; Frost und EMP nichts.
  - Verschleiß (`gameplay.wear`): jede Sekunde Spielzeit nimmt jeder Gegner am Boden jedem Bauwerk in 6 m plus Radius
    1 HP, ein Boss 10. Je Durchgang eine Rasterabfrage je Gegner.
  - Belagerungsgeschütz eines Gegners (`EnemyTypeConfig.siege`, der Jumper, seit 2026-10-19): `WorldDamage.shell`
    nimmt den Bauwerksschaden des Typs (1200) in seinem Splash plus 1 m plus Radius und gräbt einen Krater; Ziel ist
    das nächste Bauwerk in Reichweite ohne Tower auf dem Dach (`StructureLedger.nearestTarget`). Seine Werte gehen in
    den Weltschlüssel (`destructionKeyParts`). Ablauf in [ENEMY_CREATION.md](ENEMY_CREATION.md#geschützturm-und-belagerung-jumper).
  - Debug: `debug:hit-structures` (im Koop ein Cheat) und das Zerstörungs-Werkzeug (siehe „Werkzeug für Entwickler“).
- **Dach mit Tower:** ein Bauwerk mit `roof` nimmt keinen Schaden, solange ein Tower auf seinem Dach steht: in seinem
  Grundriss-Rechteck und bei einem Bau aus dem Grundriss (`MapObject.mass`, `RunStructure.mass`) in dessen Umriss, ein
  Innenhof zählt nicht (`ringsContain`, nur `+ - * /`). Ein Tower am Boden kann dort nicht stehen, der Grundriss
  sperrt. Geprüft erst, wenn ein Treffer es erreicht.
- **Fall und Dachbefehl im selben Tick:** der Platzierbefehl sagt `roof: true`, wenn er auf ein Dach einer zerstörbaren
  Welt zielt (`TowerPlacementService.onRoof`, auch der Bot). Ist das Gebäude unter diesem Dach gefallen, wenn der Befehl
  wirkt, setzt die Simulation keinen Tower (`WorldDamage.roofFallen`); in der Reihenfolge der Befehle des Ticks, auf
  jedem Client gleich. Ein Tower, der zuerst steht, hält sein Gebäude.
- **Ops:** `structures.setStages(Uint8Array, Int16Array, Int32Array)` nach Laden, Neustart, Restore und Sprung (ein
  Byte je Bauwerk, dazu die Richtungen und die HP); `structures.stage(index, stufe, richtung)` je Stufenwechsel
  (höchstens drei je Bauwerk und Lauf); `structures.hp(Int32Array)` einmal je Paket mit den Paaren aus Index und HP
  der Bauwerke, deren HP sich darin änderten (`StructureLedger.flushHp`, von `SimCore` vor dem Abholen der Ops
  gerufen; keiner, solange nichts getroffen wird); `main.structureFell` im Moment des Falls (flüchtig).
- **Richtung:** jede Stufe, die ein Treffer auslöst, merkt sich dessen Richtung vom Einschlag zur Mitte des Bauwerks
  (`structureHeading`, 256 Schritte je Umdrehung aus `DetMath.atan2`, -1 ohne: Vorschaden, Treffer genau auf die
  Mitte). Spielstand (`structureHeadings`) und Prüfsumme tragen sie, sobald eine bekannt ist; eine Welt ohne Treffer
  speichert und prüft wie vorher.
- **Schaden als Logik:** der `ProjectileManager` ruft beim Einschlag seinen Listener (`WorldDamage.impact`), im selben
  Teilschritt; `vfx:projectile-impact` bleibt reine Darstellung.

**`CraterLedger`** (`managers/game-state/crater-ledger.ts`)

- Ein Krater ist vier ganze Zahlen: Mitte in Dezimetern (x, y der Karte), Radius in Dezimetern, Tiefe in Zentimetern.
- Quellen: Kanonenkugel und Heldengranate (1,5 m), Rakete (2,5 m), Atomschlag (25 m, 4 m); ein Treffer gräbt 14 cm je
  Meter Radius, höchstens 40 cm je Meter.
- **Zusammenlegen:** ein Einschlag in 2 m eines Kraters vertieft ihn und weitet ihn auf den größeren Radius, bis zur
  Höchsttiefe (40 cm je Meter Radius). Hat er die erreicht, weitet ein weiterer Einschlag dort ihn um ein Viertel des
  eigenen Radius, bis zum Doppelten davon, und der weitere Krater darf entsprechend tiefer werden (`widenShare`,
  `widenTo`; ein Atomkrater 25 m und 4 m kommt so über 10 m Tiefe auf 50 m und 20 m). Vorher lief ein Krater auf
  seiner Höchsttiefe still ins Leere.
- **Kein Deckel zum Spielen:** die Liste wächst nach Bedarf (verdoppelt), ein Einschlag findet seinen Krater über ein
  Raster aus Zellen von 2 m (die Krater der neun Zellen um ihn, der zuerst gegrabene gewinnt wie in der Liste), nicht
  über alle. Gemessen bis 16 384 Treffer (rund 16 000 Krater): 4 bis 6 µs je Treffer in der Simulation, Prüfsumme
  unter 1 ms, Restore 10 ms, Snapshot 262 KB JSON (89 KB gzip im Koop-Resync), im Bild kein Unterschied zu 256
  (Messtabelle im Commit). Eine Sicherheitsgrenze bei 65 536 Kratern, weit über jedem Lauf: erreicht, geht der
  kleinste Krater (Radius im Quadrat mal Tiefe, der erste gleicher) in seinen nächsten Nachbarn auf (weiter und so tief
  wie der tiefere), und der neue nimmt seinen Platz; zwei Ops `craters.dig`, nichts verschwindet. Vorher war bei 256
  Schluss, danach grub kein Treffer mehr (zuerst gar keiner, seit dem letzten Fix nur noch größere an Stelle der kleinsten).
- **Spuren:** über 4 096 Marken (`MAX_IMPACT_MARKS`) zeigen die neuesten, auf den Plätzen der ältesten; die Mulden
  im Gelände bleiben alle.
- **Tower:** keine Dämpfung in der Simulation. Das Stempelraster der Simulation liegt nur über den Routenzellen, und
  dort steht nie ein Tower; den Fuß eines Towers neben einem Krater hält das Geländebild (Z4) aus der Mulde heraus.
- Snapshot `craters?: number[]` (nur mit Einträgen), Hash im Teil `health` nur mit Einträgen.
- Ops: `craters.setAll(Int32Array)` (ganz, nach Laden, Neustart, Restore, Sprung), `craters.dig(index, x, y, r, t)`
  je neuem oder vertieftem Krater.

**Stempelraster** (`utils/stamp-field.ts`, Form in `map-ops/impact-stamp.ts`, Entscheid 1)

- Je Routenzelle (2 m, dieselben Indizes wie `GlobalRouteGrid`) die Summe aller Stempel in ganzen Zentimetern: Krater
  (Mulde `(1 - s)² (1 + 2s)` über `s = d² / r²`, Wall von 16 % der Tiefe knapp hinter dem Rand) und Schutthaufen
  gefallener Bauwerke (über dem Grundriss: 60 % davon in voller Höhe, auslaufend über 40 % der kürzeren halben Seite
  plus 2 m; ohne Grundriss über dem Kreis mal 1,35; Höhe 30 % des Bauwerks, 40 bis 350 cm). Nur `+ - * /`, kein
  `sqrt`: jede Engine stempelt dieselben Bits.
- Summen statt Zustand: ein Stempel hinein und wieder heraus lässt die Zellen, wie sie waren, die Reihenfolge zählt
  nicht. Restore und Sprung bauen das Raster aus Stufen und Kraterliste neu und kommen auf dieselben Zellen.
- **Gegner:** die Höhe jedes Gegners (auch in der Luft) ist Zellhöhe plus Stempel, mit der vorhandenen Glättung (8 m/s);
  ein Gegner am Boden auf Schutt ab 30 cm läuft mit 85 % seines Tempos, gelesen an seinem Ort vor dem Schritt (nach
  einem Restore gleich wie im Lauf). Kosten je Gegner und Teilschritt: nichts, solange kein Stempel liegt (Raster
  `null`), sonst ein Nachschlag für die Höhe und für Läufer ein zweiter für die Bremse.
- **Sichtlinien:** der Hauptthread führt dasselbe Raster aus denselben Ops (`WorldDamagePresenter`) und gibt es dem
  Routenraster: die Sichtproben der Tower stehen 1,5 m über Zellhöhe plus Stempel, wo die Gegner stehen. Ein neuer
  Krater unter den Routen, ein Fall, eine Wand, die eine Ruine verliert (`WEAR_SIGHT_EVERY`), und die Objekte eines
  Wellen-Ereignisses lassen die Tower in Reichweite ihre Sicht neu anfragen (`seeAround`, Grund `'world'`; beim Krater
  Reichweite plus 1,35 Kraterradien); ein vertiefter Krater (wenige Zentimeter) nicht. Die Simulation fragt je Ereignis
  an, deterministisch mit Generationen wie jede Sichtanfrage.
- **Neu gerechnet (E291, gebaut 2026-10-21):** der Hauptthread (`TowerLosRegistry`) rendert für `'world'` den Cube
  aus der Welt, wie sie jetzt ist, und probt jede Zelle in Reichweite neu (`registerTower`, nicht inkrementell wie
  ein Reichweiten-Upgrade): die Kraterwand verdeckt, durch die Lücke eines Gefallenen sieht der Tower. Bis dahin
  behielt jede Zelle ihre alte Antwort, ein Krater oder Fall änderte an der Sicht stehender Tower nichts. Gesammelt
  und gedrosselt (`WorldSightBatch`): die wartenden Anfragen gehen als ein Stapel, höchstens einer je Sekunde, je
  Tower die neueste, ein Cube je Bild wie bei jedem Render; ein Stapel beginnt erst, wenn der gezeichnete Boden alle
  Stempel trägt (`CustomMapGroundDamage.pending`, sonst fehlte dem Cube die Mulde), und kein Cube eines Stapels fällt in
  das Bild, mit dem ein Fall oder ein Krater ankommt, noch in das nächste (`WORLD_BUSY_OPS`: ein Cube von 6 bis 13 ms machte
  in einer Stadt ein Fallbild von 34 bis 47 ms). Bau, Upgrade und Nachrüstung
  warten nicht. Nur der Zeitpunkt der Antwort hängt davon ab; die Masken gehen wie immer als `command:los-mask` in die
  Simulation und ins Befehlslog, Coop (der Host rendert) und Replay bleiben gleich.
- **Linie und Overlay folgen dem Boden (E291):** mit jedem Stempel meldet der Presenter dem Routenraster die Zellen,
  die er änderte (`StampField.takeChanged`, `GlobalRouteGridService.stampsChanged`). Die Platten des Routen-Overlays
  in diesen Zellen stehen auf der neuen Höhe (nur sie gehen zur GPU), die rote Routenlinie zeichnet sich dort neu:
  über Stempeln jeden Meter auf dem Boden (`RouteLineLayer.restand`), sonst durch ihre Wegpunkte; nur die Linien, die
  das geänderte Rechteck kreuzen.
- Speicher: drei `Int32Array` über dem Rechteck der Routenzellen, angelegt mit dem ersten Stempel; bei 512 m Kante
  höchstens 256 x 256 Zellen, 786 KB.

### 2. Hauptthread: wie es aussieht

**Gebäude in Stufen** (gebaut, Z2)

- **Ruinen-Batches:** ein beschädigtes Gebäude (ab Stufe 1) verlässt den Batch seines Assets und zeichnet im
  Ruinen-Batch des Assets (`render/objects/object-layer.ts`, `setDamage`): dieselben Modelle und LOD-Stufen, beidseitig
  (`DoubleSide`), mit dem Schaden im Shader (`render/objects/ruin-damage.ts`). Intakte Gebäude behalten ihre Programme,
  `FrontSide` und Early-Z und zahlen nichts; die Ruinen kosten einen Draw Call je Asset und Stufe, nicht je Ruine. Eine
  Ruine zeigt ihr Modell bis zur Pixelgrenze, ohne Impostor oder Fern-Kasten. Gebäude aus dem eigenen Grundriss
  (`mass-layer.ts`) gehen ebenso: ihre Instanzen schrumpfen im intakten Batch auf null, die Ruinen werden als kleiner
  eigener Batch neu gebaut (eine Handvoll Gebäude, nicht die Karte); eine Wand eines Gefallenen wird an der Bruchkante in
  Stumpf und Oberteil geteilt, dazu an drei Höhen darüber (`collapseCuts`): eine Wand ist ein Quad, ein Dreieck fällt
  nur ganz, so fallen die oberen Wandstücke einzeln, wenn die Bruchkante sie unterquert.
- **Je Instanz drei vec4** (`aDamage`: Stufe plus ein Viertel des Wurfs, Fallstart, Richtung, Bruchhöhe; `aDamageB`:
  Mitte des Bisses, sein Radius plus 8 mal der Stumpf in 1/64 m; `aDamageC`: Mitte, Abstand zur Kippkante, Oberkante;
  negativ für einen Turm; die Falldauer folgt aus der Höhe, `fallSeconds`), im Rahmen der Gruppe, für Modelle und Wände gleich. Nicht mehr:
  ein Vertex-Shader hat 16 Attributplätze, und ein Ruinen-Material eines zusammengelegten Hauses braucht schon Position,
  Normale, zwei uv, Vertexfarbe, roughMetal, Instanzmatrix (vier), Instanzfarbe und `lodFade`. Ein vierter vec4 und ein
  eigener Anker brachten es auf 18, das Programm band nicht („Too many attributes“, OSM-Welten); jetzt 15 (die
  Nachtfenster einer Ruine sind aus, ihr Material liest `nightGlow` nicht), die Spec
  `ruin-attributes.spec.ts` zählt jedes Objekt-Material, intakt und als Ruine, samt Schatten. Die Form würfelt `ruinShape` auf der CPU aus der Id (oder `damageSeed`) und dem
  Grundrechteck: Richtung, Stumpf 1,5 bis 4 m (höchstens 55 % der Höhe), Biss in der oberen Ecke zur Kipprichtung,
  Falldauer 1,2 bis 2,5 s, dazu der Wurf, aus dem der Shader die Varianten je Gebäude streut (`collapseRoll`: Wurf mal
  Faktor plus k mal 0,618, der Bruchteil; einfache Rechnung, so kommen Float und Double auf dieselben Schnitthöhen).
  Jeder Partner und jedes Replay sieht dieselbe Ruine; in der Simulation kommt nichts dazu. Die Richtung ist die des Treffers, der die Stufe ausgelöst hat (siehe „Richtung“),
  die Saat würfelt sie nur, wo keiner bekannt ist.
- **Stufe 1:** Risse aus einer gezeichneten Kachel (`crack-texture.ts`: Linien, die laufen und knicken, rot Haarrisse,
  grün lange Risse; im Code gezeichnet, kein Rauschen) von drei Seiten in Metern, dichter zur Kipprichtung; Ruß in
  Flecken, matt; Nachtfenster aus.
- **Stufe 2:** der Biss aus der Ecke, Kante gezackt nach Winkel und Höhe, verkohlt, an wenigen Stellen glühend; innen
  die Wand gedimmt (Rückseiten). Eine Platte über dem Boden (kein Gras innen), Decken je Stockwerk (3 m) und
  Innenwände; ein angeschlagenes Gebäude mit Loch (Stufe 1 der Ansicht) hat sie schon, sobald das Loch aufgeht
  (`RuinSlabs.setHoled`), ohne Loch erst ab Stufe 2. Innenwände je eine quer zu jeder Seite, die für zwei
  Räume lang genug ist (über 5 m), bis unter die Traufe (62 % der Höhe, höchstens 92 % der niedrigsten Höhe über
  ihrer Linie), aus der Saat versetzt (`ruin-slabs.ts`, ein Draw Call für alle Ruinen, Haus und Grundriss-Gebäude
  gleich), mit kleinerem Biss, so ragen sie ins Loch. Sie folgen dem Grund des Gebäudes (E259), nicht seinem
  Rechteck: eine Decke ist eine Handvoll Kästen über den Zellen des Dachrasters (`roof` im Katalog, `massRoof` beim
  Grundriss-Gebäude), über denen das Gebäude mindestens 0,6 m höher steht (`footprintRects`: Läufe je Zeile, gleiche
  Läufe zu einem Kasten, Enden in der Mitte der letzten Zelle, im Grundrechteck); eine Innenwand der Lauf auf ihrer
  Linie, der der Mitte am nächsten liegt (`wallSpan`). Bei einem Modell zählt dazu sein waagrechter Schnitt 0,5 m über
  der Decke (`ruin-section.ts`, einmal je Modell und Höhe): das Raster sieht von oben, ein Zinnenkranz oder eine Traufe
  reicht über die Wand darunter hinaus. Der Schnitt nimmt je Zeile die Spanne vom ersten bis zum letzten Schnittpunkt,
  0,3 m Wand weniger, so teilen Treppen, Balken oder Schutt drinnen keine Zeile. Der Rundturm hat so runde Decken in
  seiner Wand (vorher ragten die Ecken des Quadrats als Simse heraus), ein offenes Hochhaus keine, wo es offen ist; ohne
  Raster das Rechteck wie bisher.
- **Stufe 3:** das Gebäude stürzt in sich zusammen (E259, im Vertex-Shader aus Fallstart, den Zahlen der Instanz und
  der Uhr, keine CPU je Bild; siehe „Einsturz“), ein schlanker Turm kippt. Der Stumpf bleibt mit den Decken, die ganz darin liegen; der Schutthaufen
  (Z3) liegt darin. Ein Gefallener sperrt nicht mehr das Bauen (`CustomMapSurface.setObjectCatalog`), `FALLEN_SCALE`
  bleibt nur für Objekte, die ein Wellen-Ereignis verbirgt.
- **Einsturz** (E259, nach drei Runden mit dem User): Vorbild ist der alte Versuch, die Photo-Tiles zu zerstören, der
  glaubwürdig wirkte, weil er vom Einschlag aus arbeitete, senkrecht nach innen fiel und auf Decken landete. Kippen,
  Zerbrechen in Stücke und Stauchen (Runden 1 und 2) hat der User verworfen.
  - Bruchkante (`dmgCaveCut`): innen niedrige, gezackte Stümpfe (Rauschen auf 4 m und 1,1 m, mindestens 1,2 m), zu den
    Wänden steil ansteigend, dort höchstens 6 m plus ein Viertel der Höhe über dem Sitz, auf der Seite des Treffers
    (gegen die Richtung) niedriger. Der Rand ist nur nach dem Winkel gezackt, so bleibt nichts als Insel stehen. Zurück
    bleibt eine Hülle aus Wandresten.
  - Fall (`dmgCaveFall`): der Fuß gibt 0,35 s nach (ein Viertelmeter, ein Zittern), dann fällt alles über der Kante als
    Ganzes senkrecht und ein wenig nach innen, schwer (2,6 t²), bis es dort ist, wo es landet (`dmgCaveLanding`): auf
    der höchsten Decke unter der Kante (Stockwerk 3 m), in Flecken von 4 m durch bis zu zwei Decken, sonst auf dem
    Boden. Dort ist es weg. Eine Bewegung für alles: kein Dreieck dehnt sich.
  - Fragment: über der Kante wird ein Dreieck nur gezeichnet, solange alle seine Ecken fallen (`vDmgFall`), unter ihr
    nichts, was mitfällt; danach geht, was über der Kante stand. Die Kanten folgen dem Netz.
  - Turm: höher als das 2,5-Fache seiner schmaleren Breite (`RuinShape.tower`, im Vorzeichen der Reichweite): er kippt
    starr um den Fuß der Seite, zu der er fällt, und sinkt dabei (das bisherige `tip`).
  - Staub beim Aufkommen (`fallImpact`): die Ansicht merkt sich beim Fall, wann er aufkommt, und meldet es auf ihrer Uhr
    (`CustomMapView.onImpact`, `WorldDestruction.onImpact`), auf der auch der Shader fällt. Der Presenter wirft dann eine
    Staubwand an fünf Punkten, Rauch ohne Feuerball, Splitter, Brocken und den Schutt-Ton. Beim Einsturz ist das eine
    halbe Sekunde nach dem Nachgeben in seinem Grundriss, beim Turm jenseits seines Fußes, wenn er fast unten ist.
  - Für Entwickler: Fenster „Destruction“, Zeile „Collapse“ (Auto nach Form, alle Tip, alle Cave-in), in der Adresse
    `?collapse=cave-in`, in DevTools `__worldDamage.collapse('tip')`. Vergleich und Messung: `e2e/perf/collapse-probe.ts`
    (Kamera seitlich zum Fall mit `auto`/`autor`, `--continue` lädt einen Spielstand mit Ruinen).
  - Gemessen (Ruined City, Chrome, 60 Hz, ein Browser, während der Aufnahme): kein Bild über 16,7 ms in einem Fall;
    keine neuen Programme, Draw Calls wie vorher.
- **Löcher im Bild** (E259, `ruin-holes.ts`): ein stehendes Bauwerk mit Löchern zeigt die Ansicht als angeschlagen
  (Stufe 1, `CustomMapWorld.shownStage`; die Simulation behält Stufe 0), denn Löcher zeichnen nur die Ruinen-Batches. eine Float-Textur mit einer Zeile je beschädigtem Bauwerk und zwei Texeln
  je Loch (Mitte im Rahmen der Gruppe und Radius; wann es aufging oder wuchs, eine Zahl für den Rand). Die Zeile reist im
  Richtungswert von `aDamage` (Richtung plus 8 mal Zeile plus eins): kein Attribut mehr. Ab Stufe 1 schneidet das
  Fragment die Löcher aus, ein wenig breiter als hoch, der Rand gezackt nach Winkel und Höhe, verkohlt und glühend wie
  der Biss (den zeigt nur noch eine Ruine ohne Löcher, etwa aus einem alten Spielstand); ein neues Loch geht in 0,3 s
  auf, ein gewachsenes behält seine Zeit. Innen kein schwarzer Fleck: die Rückseiten tragen staubigen Putz über ihrer
  Farbe und ein wenig eigenes Licht (sie sehen durch das Loch den Himmel), die Decken und Innenwände sind heller und
  nehmen mehr Umgebungslicht, der Ruß an den Rändern ist schmaler. Über einem großen Loch (ab 2,2 m) sackt eine Säule
  auf die Decke darunter und ist weg (dieselben Regeln wie beim Einsturz); sie ist rundum und nach oben gezackt und
  wird nach oben schmaler (0,85 bis 0,55 des Radius, von 0,4 bis 2 oder 2,9 Radien über dem Loch), kein Zylinder.
  Beim Fall senkt sich die Bruchkante zu den Löchern: der Einsturz beginnt, wo getroffen wurde (`dmgWorn`). Je mehr
  Löcher ein Bauwerk bekam (die höchste Nummer), desto niedriger die ganze Kante, zwölf nach den ersten zwei auf dem
  Boden: eine Ruine unter weiterem Beschuss verschwindet bis auf ihren Schutt. Türme stehen auf den Höhen der Karte
  und dem Schutt, nicht auf dem Stumpf: ein schrumpfender Stumpf verschiebt keinen. Die Sichtlinie sieht den
  niedrigeren Stumpf beim nächsten Rechnen. Die Sichtlinie sieht
  durch die Löcher (der LOS-Patch liest dieselbe Textur), wenn sie das nächste Mal gerechnet wird; ein Loch allein
  fordert sie nicht neu an.
  - Gemessen (Ruined City, Chrome 60 Hz): 60 Bauwerke mit je drei Löchern im Bild, die Bilder vorher und nachher im
    Mittel 16,67 ms, keines länger (vsync-begrenzt, die GPU dieses Rechners hat Luft). Hauptthread je Paket mit 180
    neuen Löchern 0,8 ms (Textur, Layer), also rund 0,01 ms je Bauwerk. Attributplätze unverändert (höchstens 15).
- **Glutnester** (`EffectLayer.setRuinEmbers`): Glut und eine dünne Rauchfahne in den zwölf neuesten Ruinen ab Stufe 2,
  tief im Biss, bei einem Gefallenen im Stumpf.
- **Sichtlinie und Schatten:** was weg ist, sperrt die Sicht der Tower nicht (`LosVertexPatch` mit Fragment-Teil und
  beidseitig), der Fall selbst steht für die Sichtlinie still; der Sonnenschatten fällt und schneidet mit.
- **Stehen:** Gebäude, Mauern und Bauwerke stehen auf den Höhen der Karte mit den Kratern, nicht auf dem Schutt des
  Laufs (`CustomMapViewOptions.standingGround`, `CustomMapGroundDamage.standing`: Grundhöhe plus nur die
  Kraterstempel). Ein Stumpf am Kraterrand sinkt mit dem Boden (auf seiner tiefsten Ecke, nichts schwebt), keiner hebt
  sich auf seinen eigenen Haufen; eine Ruine, die sinkt, nimmt Bruchkante, Biss, Decken und Glutnest mit (E270).
- **Krater löschen aus** (E270, `custom-map/crater-obliteration.ts`): was in einem Krater steht, wo die Krater unter
  seiner Mitte oder einer Ecke seines Grunds 150 cm oder tiefer reichen (`OBLITERATE_CM`), ist weg: ein gefallenes
  Bauwerk ganz (kein Stumpf, keine Decken, kein Glutnest; sein Schutt liegt auf dem Kratergrund), eine gefallene Hecke,
  ein Zaun, eine Mauer, dazu Bäume, Laternen, Bänke und alles, was keinen Schaden nimmt. Ein Bauwerk, das noch steht
  (ein Tower auf dem Dach hält es), und eines, das die Karte stehen lässt, ist nie weg; was nur am Rand steht, sinkt.
  Weg heißt: aus dem Bild (`CustomMapView.setGone`, im Bild nach dem Einschlag, nicht in seinem), aus den Sichtblockern
  und aus dem Bauverbot. Eine Funktion aus Kraterliste und Stufen der Simulation (ganze Zahlen), auf jedem Client,
  im Replay und nach einem Restore gleich; ein Restore ohne den Krater gibt alles zurück. Die Simulation braucht
  nichts davon: ein Gefallenes sperrt schon nicht mehr, Sichtlinien kommen von der Darstellung. Schächte aus vielen
  Atomschlägen bleiben erlaubt (Krater stapeln wie bisher), in ihnen ist alles weg.
- **Bäume fallen** (2026-10-23): ein Baum (Kategorie `tree`) fällt vorher, wo die Krater unter seinem Stamm oder halb
  unter seiner Krone 8 cm tief reichen (`FELL_CM`): die Explosion, die den Krater grub, hat ihn gefällt. Explosion
  heißt alles, was gräbt (Kanone, Rakete, Heldengranate, Atomschlag, Belagerungsgranate); Splash ohne Krater (Magie,
  Frost, Flak) fällt nichts. Wie das Auslöschen eine Funktion der Kraterliste, kein Zustand in Simulation, Laufregeln
  oder Snapshot: Zehntausende Bäume einer OSM-Welt kosten dort nichts, Koop, Replay und Restore kommen auf dieselben
  Bäume. Gefällt heißt: aus dem Bauverbot und aus den Sichtblockern; die Simulation fragt dafür bei jedem neuen oder
  geweiteten Krater, auch abseits der Routen, die Sicht der Tower in Reichweite neu an (`WorldDamage.dig`, 1,35
  Kraterradien plus 4 m; ein nur vertiefter fragt nicht), deterministisch wie jede Sichtanfrage. Im Bild
  (`CustomMapView.setFelled`) kippt der Baum vom Krater weg, der unter ihm am tiefsten ist, bis zu 60° gedreht zur
  Seite, wo die wenigsten stehenden Bäume in seiner Fallbahn stehen (`fall-way.ts`: neun Richtungen, je Nachbar nach
  Nähe zur Bahn gewichtet, die geradere gewinnt bei fast gleich offen; nur aus Objektliste und dem, was die Krater
  fällten), damit seine Krone nicht unter der nächsten liegt (in 1,4 s Spielzeit, langsam zuerst; nach Laden, Restore
  oder Sprung liegt er schon), und bleibt mit welkem Laub auf seinen Ästen liegen: braun-ocker mit etwas Restgrün, der
  Stamm unverändert. Das Welken trägt die Instanzfarbe (`WITHER_FLAG`: 4 auf dem Rot, im Vertex-Shader wieder
  abgezogen, das Laubfragment tauscht die Farbe), kein Programm und keine Variante mehr. Dieselben Instanz-Batches
  über `pitch` und die Instanzfarbe, eine Charge je Baumart für die liegenden
  (sie sperren keine Sicht), kein Impostor (der zeigte ihn stehend; ein liegender endet, wo der Impostor käme). Ein
  tieferer Krater löscht ihn aus wie bisher.
- **Vorab übersetzt:** die Ruinen-Batches zerstörbarer Assets entstehen leer mit der Karte, die Grundriss-Gebäude bekommen
  verborgene Ruinen je Fassade und Dachdeckung, die Decken und Glutnester je einen verborgenen Platzhalter; das
  Warm-up zeigt sie und baut ihre Programme, auch die des Schattens: es zeigt dazu auch die Sichtblocker, die `attach`
  neben die Gruppe hebt (dort warten die Ruinen der Grundriss-Gebäude), und gibt den eigenen Tiefenmaterialien der Ruinen
  Seite und Karten, wie der Schattendurchgang es tut (`asShadowPass`). Vorher baute der erste Fall eines
  Grundriss-Gebäudes drei Schattenprogramme im Bild (67 ms, mit den größeren Shadern der Varianten 180 bis 270 ms).
- **Uhr:** `DAMAGE_UNIFORMS.uDamageTime` läuft mit der Ansicht; ein Fall `now` beginnt jetzt, Stufen nach Laden, Sprung
  oder Restore liegen schon (`FELL_LONG_AGO`).
- **Später:** Bewehrungsstäbe an der Kante, springendes Glas.

**Gelände** (gebaut, Z4)

- **Eine Stempelfunktion** (`map-ops/impact-stamp.ts`): Mulde und Schutthaufen in ganzen Zentimetern aus dem
  Abstandsquadrat (siehe „Stempelraster“), ein Haufen klumpig in Feldern von 1,6 m (`rubbleLump`, Faktor 0,7 bis 1,15
  aus einem Ganzzahl-Hash des Felds). Simulation und Bild fragen sie nach dem Kartenpunkt; Krater und Schutt liegen auch
  auf der Straße (Entscheid 1), die Straßenbänder folgen der Höhentextur.
- **Eigene Höhen je Lauf:** eine Karte mit Zerstörung oder Kratern spielt auf einer Kopie von `grid.heights`
  (`CustomMapWorld`); `CustomMapGroundDamage` behält die Höhen vom Start (`base`) und summiert jeden Stempel in
  Zentimetern (`sum`). Ein Stempel heraus und wieder hinein lässt die Proben, wie sie waren; ein Restore stempelt alles
  neu und kommt auf dieselben Höhen (Spec).
- **Gebündelt aufbauen:** geänderte Proben schreiben in Kacheln von 32 x 32, höchstens zwei Kacheln je Bild als ein
  Rechteck an `CustomMapView.updateHeights` (gemessen 1 bis 3 ms je Aufruf); ein Raketenkrater steht im nächsten Bild,
  der Neuaufbau nach einem Sprung verteilt sich über Bilder statt des ganzen Rasters (118 bis 174 ms). Je Kachel zählt
  nur das Rechteck der Proben, die sich änderten (E256): ein Krater in einer Kachel am Kartenrand baute sonst die
  Schürze um die Karte neu (6 bis 11 ms), obwohl am Rand keine Probe sich bewegte. `MapTerrainLayer.rebuild` schneidet
  das Rechteck auf das Raster zu: mit dem Rand von einer Probe aus `gridRect` ragte es darüber hinaus, der Auftrag
  `heights` im Ground-Worker warf, der Worker fiel aus, und von da an liefen Verdeckung und Fernschatten jedes
  Einschlags auf dem Hauptthread (je Einschlag zwei Bilder von 35 bis 98 und 37 bis 77 ms).
- **Tower im Bild gehalten:** unter einem stehenden Tower (3 m) behält der Boden die Höhe, die er hatte, als der Tower
  kam; ein Krater daneben lässt ihm seinen Fuß, einer unter einem Tower, der in einem Krater gebaut wurde, hebt ihn nicht.
  Die Simulation braucht das nicht: dort liegt das Raster nur über Routenzellen, auf denen nie ein Tower steht.
- **Spuren** (`render/terrain/impact-marks.ts`): ein instanziertes, über den Boden gelegtes Netz für alle. Krater:
  verbrannte Sohle, Erdklumpen am Rand, Ruß in Strahlen; Schutt: zerbrochene Platten der Materialklasse mit Schattenfugen,
  Krümel, Staub über den Fuß hinaus; Korn je Meter, nicht je Spur. Ein Draw Call.
- **Kein Gras auf aufgerissenem Boden:** Proben mit 10 cm oder mehr Stempel kommen als Maske in die Cover-Map
  (`CustomMapView.setGroundBare`), die dort Gras wie an einem Grundriss weglässt. Die Cover-Map rechnet nach einem
  Einschlag nur das Rechteck neu, samt ganzer Dächer, deren Mitte darin steht (`CoverMap.set` mit `rect`, statt jedes
  Grundrisses der Karte: auf Ruined City 4 bis 7 ms je Einschlag), und lädt nur dessen Zeilen hoch.
- **Fall ohne Neuaufbau:** ein gefallenes Bauwerk geht einzeln aus den Bauverboten und Dächern
  (`CustomMapSurface.dropObjects`), statt alle Objekte der Karte neu einzusortieren (3 bis 4 ms auf Ruined City).
- **Verdeckung und Krümmung:** der Ground-Worker des Spiels bekommt die geänderten Höhen als Patch, bevor er sie schattiert
  (`GroundWorker.heightsChanged`).
- Wasser, Brücken, Objektsitze, Straßenbänder und Gras folgen dem Rechteck von `updateHeights`.

**Lebensbalken über Bauwerken** (gebaut, E262)

- Über jedem Bauwerk, das steht und weniger als volle HP hat, ein Balken über dem Dach (Boden plus Höhe plus 1,5 m),
  so breit wie der Grund (1,2 mal Radius, 6 bis 12 m), ein Sechstel davon hoch; voll und gefallen ohne Balken.
- Dieselben Balken wie bei den Gegnern (`HealthBarInstanceManager`, dieselben Programme, Farbe grün, gelb, rot nach
  Anteil), als eigene Instanz `engine.structureBars` (`StructureHealthBars`), nur auf zerstörbaren Welten; ein Draw
  Call für alle, jeder Balken mit Tiefentest (ohne den Vordergrund-Durchgang der Gegner), so verdeckt ein Haus davor ihn.
- Der `WorldDamagePresenter` spiegelt die HP (`setStages` mit den HP, `structures.hp` als Deltas) und setzt einen
  Balken nur, wenn sich dessen HP ändern; je Bild dreht nur die Kamera die Balken (zwei Uniforms), keine Arbeit je
  Bauwerk.
- Ein- und ausgeschaltet mit den Lebensbalken der Gegner: dieselbe Option (Einstellungen, Display) und Alt zum
  Umkehren, solange gehalten (`DebugFacadeService.applyHealthBars`).

**Werkzeug für Entwickler** (gebaut, E261)

- Fenster „Destruction“ in den Entwickleroptionen (Kachel „Destroy“ unter „Waves & Inspect“, nur auf einer
  zerstörbaren Welt). Zwei Modi; solange einer an ist, geht ein Linksklick auf die Karte ans Werkzeug, nicht ans Spiel
  (`DestructionToolService`, `InputHandlerService.setDestructionToolCallbacks`):
  - **Blast:** Kanone, Rakete oder Atomschlag am Klickpunkt, über dieselben Funktionen wie der echte Treffer
    (`WorldDamage.debugBlast`: der Einschlag des Projektiltyps am Boden, der Atomschlag über `ability`), mit dessen
    Darstellung (`vfx:projectile-impact`, beim Atomschlag `ability:impact` mit Strike-Id -1). Gegner nehmen keinen
    Schaden.
  - **Radius** (E284, nur Atomschlag): Regler 5 bis 100 m in ganzen Metern, Start beim echten Schlag (25 m). Er geht
    als optionales Feld `radius` des Befehls `debug:blast` in die Simulation (`DEBUG_BLAST_RADIUS`,
    `DEBUG_RADIUS_BLASTS` in `destruction.config.ts`): was fällt, der Krater (Radius und Tiefe im Verhältnis des echten
    Schlags) und Pilzwolke, Blitz und Brandringe (`radiusM` von `ability:impact`) wachsen mit. Ohne Feld wirkt der
    Befehl wie vorher, der eigene Radius des Schlags rechnet mit Faktor genau 1. Die Befehlsprüfung
    (`command-guard.ts`) weist anderes ab: kein ganzer Meter, außerhalb der Grenzen, ein Radius an Kanone oder Rakete.
    5 m ist etwa ein Haus, 100 m das Vierfache des echten Schlags und der größte Krater, den `debug:dig-crater`
    zulässt. Ganze Meter halten Befehlslog und Replay frei von Bruchteilen des Reglers.
  - **Pick:** wählt das Bauwerk unter dem Klick (im Grundriss, sonst im Kreis; `WorldDamagePresenter.structureAt`) und
    zeigt Id, HP (aktuell, höchste, Prozent) und Stufe aus dem Spiegel; die Stufe 0 bis 3 setzen, „Fell now“ (Stufe 3)
    und „Mend“ (Stufe 0).
- **Stufe setzen** (`debug:set-structure-stage`, `StructureLedger.setStage`): die HP in die Mitte der Stufe
  (`presetHp`, gefallen 0, intakt voll). Schlechter geht als Treffer vom Klickpunkt (Richtung, Stufen-Op, Fall, Schutt,
  Sichtlinien; ein Tower auf dem Dach hält das Gebäude wie gegen jeden Treffer), besser als Reparatur: HP gesetzt,
  Richtung vergessen, Schutt aus dem Stempelraster, alle Stufen neu an den Hauptthread (`setStages`, derselbe Weg wie
  nach einem Restore). Der Klickpunkt der Wahl bleibt, so fällt „Mend, Fell now“ jedes Mal in dieselbe Richtung (für
  den Vergleich der Einsturzvarianten).
- Beide sind Befehle im Befehlslog (`debug:*`, im Koop Cheats nach der Raumregel): der Partner sieht dasselbe, ein
  Replay spielt sie nach, ein Spielstand trägt das Ergebnis (HP und Krater). Spec: zwei Simulationen mit denselben
  Befehlen kommen auf dieselbe Prüfsumme, die Welle läuft im Replay ohne Abweichung (`sim-core.spec.ts`).
- In DevTools dazu `__worldDamage.blast(lat, lon, blast, radius?)`, `.setStage(index, stufe)`, `.hp(index)`.

**Schutt und Effekte** (gebaut, Z3, Ton offen)

- **Materialklassen** (`world/custom-map/rubble-material.ts`): Putz, Beton, Metall, Ziegel, Stein, Holz aus der Fassade
  eines Baus aus dem Grundriss oder den Wörtern des Katalogeintrags; Farben von Schutt und Staub linear.
- **Brocken** (`render/terrain/rubble-pieces.ts`): Platten mit Bewehrung, Ziegel im Mörtel, gebrochene Balken,
  Mauerbrocken, je Klasse eine eigene Mischung, nach der Saat des Haufens gewürfelt; vier instanzierte Netze für alle
  Haufen, der Vertex-Shader setzt jeden auf die Höhentextur.
- **Fliegende Brocken** (`render/terrain/flying-debris.ts`): ein Pool von 768, Parabel, Drehung und Landung im
  Vertex-Shader aus Start, Geschwindigkeit und Zeit; die CPU setzt die Uhr.
- **Fall:** Staubwand über dem Boden, Staubsäule die Höhe hinauf, Splitter in den Farben der Klasse, Rauch, ein kleiner
  Blitz (vorhandene Effekt-Pools, `WorldDamagePresenter.fell`); der Op `main.structureFell` trägt dafür den Index.
- Alle Programme werden im Warm-up mit denen der Karte übersetzt (je eine Instanz ohne Größe).
- **Offen:** Ton für Einsturz und Krater (Auswahl der Klänge läuft); die Glutnester kamen mit Z2.

### 3. Editor

- **Rules, „Destruction“** (gebaut): `destructible`, `craters` (Standard wie `destructible`), `wear` (Verschleiß an
  den Routen), `structureHp` (50 bis 300 %); dazu im Kartenskript dieselben Schlüssel.
- **Je Objekt** (im Format gebaut, im Editor offen): `destructible?: boolean` (ein Rathaus, das nie fällt), `damage?: 1..3`
  als Vorschaden mit `damageSeed`: eine
  Endzeit-Stadt aus intakten Modellen, deren Ruinen dieselbe Optik haben wie im Spiel. Ruined City würde damit echte
  Ruinen statt Ruinen-Modellen tragen können.
- **Werkzeug „Treffer“:** ein Klick im Viewport trifft mit wählbarer Stärke (Projektil, Rakete, Atomschlag) und zeigt
  Stufen, Krater und Effekte wie im Spiel; „Zurücksetzen“ und „als Vorschaden übernehmen“. Nur dieser Schritt ändert
  das Dokument.
- **Geländepinsel „Einschlag“:** setzt Krater mit derselben Stempelfunktion ins Dokument (bleibender Krater der Karte,
  kein Laufzustand).
- **Prüfung:** warnt bei Karten mit mehr als 4 000 zerstörbaren Bauwerken. Schutt auf der Straße ist erlaubt
  (Entscheid 1), er bremst nur.

### OSM-Welten

- Die Umwandlung setzt `gameplay.destructible` nach dem Schalter im Rahmen (gebaut, Standard an,
  `OsmImportOptions.destructible`); offen: Material aus `building:material` und der Art (`brick`, `concrete`,
  `plaster`, Holz für Scheune und Schuppen).
- Bis 8 000 Gebäude: deshalb Raster, Delta-Ops und `Uint8Array` oben. Die Stufen machen OSM-Städte glaubwürdiger als
  Ruinen-Modelle, die es für moderne Häuser nicht gibt.

## Auswirkungen aufs Spiel

| Frage | Vorschlag | Warum |
|---|---|---|
| Ändern Ruinen Wege? | Nein. Schutt darf auf die Straße, Gegner laufen darüber und werden leicht gebremst, er sperrt nie | Routen stehen je Spawn fest (A*), ein Wechsel mitten in der Welle bräche Korridor, Budget und Coop |
| Ändern Krater Wege oder Gegnerhöhe? | Keine Wege; die Gegner laufen durch die Mulde (Höhe aus dem Stempelraster der Simulation) | Ein Nachschlag je Gegner und Tick, ganze Zahlen, gleich für Coop und Replay |
| Sichtlinien | ändern sich beim Fall und beim Krater unter den Routen (gibt es, E291: Cube neu, alle Zellen), bei Stufe 2 nicht | eine Neuanfrage je Fall, nicht je Treffer; gerendert gesammelt, höchstens ein Stapel je Sekunde |
| Bauen | eine Ruine wird bebaubar (auf dem Schutt, Sockel wie am Hang); Stufe 1 und 2 sperren wie intakt | Ruined City verspricht „Build in the fallen blocks“ |
| Tower auf Dächern zerstörbarer Gebäude | erlaubt; ein Gebäude mit Tower auf dem Dach nimmt keinen Schaden | kein Tower in der Luft, die Dach-Bauplätze bleiben |
| Deckung für Gegner | nein | Gegner laufen auf Zellen, Deckung wäre ein neues Kampfsystem |
| Belohnung | keine | Abriss wäre sonst eine Goldquelle |
| Straße absichtlich sperren | nur als Wellen-Ereignis der Karte (`objects`, gibt es) | vom Kartenbauer gewollt, mit vorhandenem Mechanismus |

## Determinismus, Coop, Replay, Spielstand

- **Zustand:** HP und Kraterliste, beide ganze Zahlen, beide im Snapshot und im Hash. Stufen, Stempelraster, Ruinen,
  Schutt und Effekte sind Funktionen davon.
- **Prüfsummen:** keine neue `STATE_HASH_VERSION`. Der Teil `health` liest die HP wie seit Version 6 und die Krater nur,
  wenn es welche gibt: Karten ohne Zerstörung, Tiles und DevWorld behalten Hash und Weltschlüssel (geprüft: dieselbe
  Folge von Prüfsummen über eine Welle vor und nach dem Umbau, mit und ohne eigene Laufregeln). Eine Welt mit Zerstörung
  bekommt einen neuen Weltschlüssel (`d=` mit Kratern, Verschleiß und einem Digest aller Schadenswerte,
  `destructionKeyParts`, dazu Start-HP, Grundriss und Dach je Bauwerk); ein Replay oder Spielstand von vorher dort wird
  als andere Welt abgelehnt, statt falsch geprüft. Die Schadenswerte gehen nicht in den Balance-Hash.
- **Rechnen:** `+ - * /` und Ganzzahlen, Drehungen über `DetMath`; die Stempelform ebenso, so rechnen Simulation und
  Hauptthread dasselbe Raster. Spec: ein Koop-Gast mit absichtlich verfälschten `Math.sin`, `cos` und Co. bleibt über
  eine Welle mit Kanonen, Raketen, Atomschlag, Verschleiß und Schutt Bit für Bit gleich.
- **Replay-Sprung und Restore:** ganze Menge an Stufen und Kratern, Raster neu aus Stufen und Liste, stumm (ohne
  `main.structureFell`). Spec: eine Welle auf einer zerstörbaren Welt läuft im Replay ohne Abweichung, ein Sprung in
  ihre Mitte trifft die Prüfsumme des Laufs an dieser Stelle.
- **Coop:** der Gast baut die Bauwerke aus derselben Karte, die Krater kommen aus seiner eigenen Simulation im
  Lockstep. Sichtlinien laufen über `command:los-mask` im Befehlslog, die GPU des Gasts entscheidet nichts.
- **Spielstand:** Snapshot-Felder; ein alter Spielstand ohne `craters` lädt ohne Krater. Spec: ein Spielstand als Text
  in eine frische Simulation gibt dieselbe Prüfsumme, dieselben Krater und HP.

## Performance-Budget

| Posten | Budget | Heute gemessen |
|---|---|---|
| Ledger je Tick (8 000 Bauwerke, 500 Einschläge je s) | unter 0,05 ms | seit Z1 Raster aus 16-m-Feldern, Zeit noch nicht gemessen (vorher O(Bauwerke) je Einschlag) |
| Fall auf dem Hauptthread, synchron | unter 1 ms, Rest über Bilder verteilt | 0,1 bis 4,5 ms (`objectsChanged`) |
| Krater je Bild | höchstens ein Kachelaufbau, unter 1,5 ms | 1 bis 3 ms je `updateHeights(rect)` |
| Wiederherstellen von 256 Kratern | unter 30 ms, verteilt | ganzer Neuaufbau 118 bis 174 ms |
| Draw Calls durch Ruinen | ein Pool je Asset mit Schaden plus 4 bis 6 Brocken, unabhängig von der Zahl | gezählt: einer je Asset und Stufe mit Schaden, einer für alle Decken, je Fassade und Deckung einer für Grundriss-Ruinen; Ruined City, 40 Bauwerke getroffen (je ein Drittel Stufe 1, 2, 3): sichtbare Draws 160 → 188, davon 21 Ruinen-Meshes |
| CPU je Ruine und Bild | null (Animation im Shader aus Startzeit) | entfällt |
| Neue Shader-Programme im Spiel | null (vorab übersetzt) | Ruined City, 40 Bauwerke getroffen: 271 → 271 Programme |
| Speicher | Grundraster 0,26 bis 1 MB, Brocken-Pools fest | entfällt |

Messen mit einem `e2e/perf`-Läufer: Fall, Kraterserie, Atomschlag auf Ruined City und einer großen OSM-Stadt, Bildzeit
samt GPU wie in `hitch-probe.ts`; Budgets in `npm run test:perf` für Ledger und Stempel.

## Strukturkosten (Z1, gezählt, nicht gemessen)

| Posten | Kosten |
|---|---|
| Treffer eines Projektils | eine Rasterabfrage über die 16-m-Felder in Reichweite (Rakete: Splash 5 m plus 1 m, 1 bis 4 Felder), Abstandsquadrat je Bauwerk darin; Dach-Prüfung nur für ein getroffenes Bauwerk mit `roof`, O(Tower) |
| Ops je Treffer | keiner, solange keine Stufe wechselt; je Stufenwechsel `structures.stage` (3 Zahlen), höchstens 3 je Bauwerk und Lauf; je Krater-Treffer `craters.dig` (5 Zahlen), bis der Krater seine Höchsttiefe hat |
| Ganze Menge | `structures.setStages` ein Byte je Bauwerk (7 928 Gebäude einer OSM-Stadt: 7,9 KB), nur nach Laden, Neustart, Restore, Sprung; vorher bei jedem Fall alle gefallenen Ids als Strings |
| Gegner je Teilschritt | ohne Stempel nichts (Raster `null`); mit: ein Nachschlag für die Höhe, für Läufer am Boden ein Umrechnen nach lokal und ein zweiter für die Bremse |
| Verschleiß | einmal je Sekunde Spielzeit eine Rasterabfrage je Gegner am Boden, nur mit `wear` |
| Snapshot | die HP (wie bisher), `craters` vier Zahlen je Krater (16 000 Krater: 262 KB JSON, 89 KB gzip) |
| Speicher | Raster drei `Int32Array` über dem Rechteck der Routenzellen, angelegt mit dem ersten Stempel (512 m: höchstens 786 KB) |

Zeitmessungen stehen aus (Rechner unter Last), vorgemerkt in den Messnotizen.

**Balance der Bremse** (`tools/balance-calc`, Szenario `rubble`, Abwehr des menschlichen Laufs vom 2026-10-01): mit
85 % Tempo auf 0 bis 30 % der Meter unter Feuer (im Mittel 95 bis 100 % Tempo) liegt das HQ nach W60 zwischen 47 und
65 (ohne Schutt 58), kein Tod vor W60; der Druck-Regler gleicht die längere Zeit unter Feuer aus. Kein Rückfall nötig.

## Phasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| Z1 Unterbau (gebaut) | Ledger v2 (Raster, Stufen, Delta-Ops, Logik statt VFX), Schadenswerte je Projektiltyp, Fähigkeiten, `CraterLedger`, Stempelfunktion und -raster mit Höhe und Bremse der Gegner, Verschleiß in der Simulation; aus Z5 Regeln, OSM-Schalter, Vorschaden im Format | Specs, gleiche Prüfsummen ohne Zerstörung, Koop, Replay, Sprung, Spielstand |
| Z2 Gebäude (gebaut) | Ruinen-Batches mit drei vec4, Stufen 1 und 2 im Shader, Fall im Shader, Decken, Risskachel, Glutnester, Sichtlinie, vorab übersetzen | Vorher/Nachher-Bilder Ruined City und OSM-Stadt |
| Z3 Schutt und Effekte (gebaut bis auf Ton) | Schutthaufen ins Höhenraster (dieselbe Stempelfunktion), Brocken, fliegende Brocken, Staub, Spuren; offen der Ton | Clip eines Falls |
| Z4 Gelände (gebaut) | eigene Höhen je Lauf, Kachelaufbau über Bilder, Grundraster, Krater-Spuren, Tower-Fuß gehalten, kein Gras, Worker-Patch | Clip Kraterserie und Atomschlag |
| Z5 Editor | Vorschaden je Objekt im Editor, Treffer-Werkzeug, Einschlag-Pinsel, Materialklassen | Ruined City mit Vorschaden |
| Z6 Verschleiß | Werte nachstellen, Playtest (die Simulation ist gebaut) | Rechnung in `tools/balance-calc`, Playtest |

## Entschieden (2026-10-18)

1. **Schutt und Krater dürfen auf die Straße, mit Spielwirkung.** Gegner laufen über Schutt und durch Mulden: die
   Simulation liest je Gegner und Tick aus einem kleinen Raster der Krater- und Schuttstempel (ganze Zahlen,
   Simulationsstand) die Höhe und auf Schutt eine leichte Bremse. Wege werden nie umgeleitet, Schutt sperrt nie.
   Coop, Replay und Nachberechnung bleiben deterministisch (nur ganze Zahlen und die IEEE-Grundrechenarten). Kosten je
   Gegner und Tick: ein Nachschlag im Raster. Die Bremse ist vorher in `tools/balance-calc` durchgerechnet. Zeigt sich
   ein Performance- oder Balanceproblem, ist der Rückfall „Höhe nur in der Darstellung“. Sichtlinien proben die
   Gegnerhöhe so, wie die Simulation sie hat.
2. **Ruinen sind bebaubar:** Tower auf dem Schutt ab Stufe 3.
3. **Verschleiß durch Gegner** an der Route ist ein Schalter je Karte (`gameplay.wear`), Standard aus.
4. **OSM-Welten sind standardmäßig zerstörbar**, mit Schalter im OSM-Rahmen.
5. **Fähigkeiten:** der Atomschlag fällt alles in seinem Radius, der Orbitallaser beschädigt, Frost und EMP nicht.
6. **Ein Gebäude mit einem Tower auf dem Dach ist unzerstörbar.** Dach-Bauplätze bleiben auf zerstörbaren Gebäuden
   erlaubt; solange ein Tower oben steht, nimmt das Gebäude keinen Schaden.
7. **Decken und Innenwände** von Anfang an (wie im früheren Prototyp).
8. **Rissatlas handgemalt** (klein, Graustufen).
9. **Vorschaden je Objekt im Editor**, mit Saat.

## Risiken

- **Hülle ohne Inneres:** viele Katalog-Modelle sind offen nach unten oder haben keine Decken. Gegenmittel: Decken und
  Bodenplatte aus der `box`, Rückseiten gedimmt; im Zweifel je Modell eine Prüfung in `tools/map-assets`.
- **Program-Zahl:** ein Zweig `DAMAGE` je Materialvariante verdoppelt die Programme zerstörbarer Assets. Vorab
  übersetzen, nur auf zerstörbaren Karten.
- **Schatten:** ein Fall verändert die Silhouette; die Schattenkarte baut sich über mehrere Bilder (E204). Der Fall
  invalidiert sie einmal am Ende.
- **Balance:** stärkere Raketen gegen Gebäude ändern nichts am Kampf, aber Sichtlinien öffnen sich früher. Rechnung vor
  dem Playtest.
