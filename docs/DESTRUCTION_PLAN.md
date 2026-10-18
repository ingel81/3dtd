# Zerstörung in eigenen Welten (Plan)

**Status:** Z1 (Unterbau Simulation) gebaut 2026-10-19 auf `wt/r8-destroy`, dazu aus Z5 die Regeln, der OSM-Schalter
und der Vorschaden im Format; Z2 bis Z6 offen (Darstellung, Schutt- und Kraterbild, Editor-Werkzeuge). Baut auf
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
  `damage: 1 | 2 | 3` (Vorschaden, Startstufe) und `damageSeed` (würfelt das Bild, erst ab Z2 gelesen). Mitgeliefert
  zerstörbar: `ruined-city`. OSM-Welten sind zerstörbar, außer der Rahmen sagt nein („Buildings take damage and fall“).
- **Bauwerke:** Objekte der Katalogkategorien `building`, `wall`, `structure` (`custom-map-destruction.ts`), ohne die
  Objekte von Wellen-Ereignissen; HP aus dem Zylindervolumen (60 bis 3000) mal `structureHp`. In den Laufregeln
  (`RunStructure`) mit Grundriss (`box`: Mitte, halbe Breite und Tiefe, Drehung, auf cm und 1e-4 rad gerundet), Dach
  (`roof`) und Start-HP (`start`), alles im Weltschlüssel.
- **Simulation:** `WorldDamage` (`managers/game-state/world-damage.ts`) hält `StructureLedger` v2, `CraterLedger` und
  das Stempelraster (`utils/stamp-field.ts`), siehe „Modell“.
- **Hauptthread:** `WorldDamagePresenter` reicht die Stufen an `WorldDestruction.setStages`/`setStage` (ein gefallenes
  Objekt schrumpft noch auf `FALLEN_SCALE`, bis Z2 die Ruine zeigt), führt dasselbe Stempelraster und gibt es dem
  Routenraster für die Sichtproben (`GlobalRouteGrid.setStampField`).
- **Bauen:** ein gefallenes Objekt sperrt nicht mehr; Dächer zerstörbarer Gebäude tragen wieder Tower
  (`passingObjectIds` nur noch für Wellen-Ereignisse), solange einer oben steht, nimmt das Gebäude keinen Schaden.

Offen: Darstellung der Stufen, Ruinen, Schutt und Krater (Z2 bis Z4), Tower ohne Projektil (Strahl, Kette, Laser,
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
  - Debug: `debug:hit-structures` (im Koop ein Cheat).
- **Dach mit Tower:** ein Bauwerk mit `roof` nimmt keinen Schaden, solange ein Tower auf seinem Dach steht: in seinem
  Grundriss-Rechteck und bei einem Bau aus dem Grundriss (`MapObject.mass`, `RunStructure.mass`) in dessen Umriss, ein
  Innenhof zählt nicht (`ringsContain`, nur `+ - * /`). Ein Tower am Boden kann dort nicht stehen, der Grundriss
  sperrt. Geprüft erst, wenn ein Treffer es erreicht.
- **Fall und Dachbefehl im selben Tick:** der Platzierbefehl sagt `roof: true`, wenn er auf ein Dach einer zerstörbaren
  Welt zielt (`TowerPlacementService.onRoof`, auch der Bot). Ist das Gebäude unter diesem Dach gefallen, wenn der Befehl
  wirkt, setzt die Simulation keinen Tower (`WorldDamage.roofFallen`); in der Reihenfolge der Befehle des Ticks, auf
  jedem Client gleich. Ein Tower, der zuerst steht, hält sein Gebäude.
- **Ops:** `structures.setStages(Uint8Array)` nach Laden, Neustart, Restore und Sprung (ein Byte je Bauwerk);
  `structures.stage(index, stufe)` je Stufenwechsel (höchstens drei je Bauwerk und Lauf); `main.structureFell` im
  Moment des Falls (flüchtig).
- **Schaden als Logik:** der `ProjectileManager` ruft beim Einschlag seinen Listener (`WorldDamage.impact`), im selben
  Teilschritt; `vfx:projectile-impact` bleibt reine Darstellung.

**`CraterLedger`** (`managers/game-state/crater-ledger.ts`)

- Ein Krater ist vier ganze Zahlen: Mitte in Dezimetern (x, y der Karte), Radius in Dezimetern, Tiefe in Zentimetern.
- Quellen: Kanonenkugel und Heldengranate (1,5 m), Rakete (2,5 m), Atomschlag (25 m, 4 m); ein Treffer gräbt 14 cm je
  Meter Radius, höchstens 40 cm je Meter.
- **Zusammenlegen:** ein Einschlag in 2 m eines Kraters vertieft ihn und weitet ihn auf den größeren Radius, bis zur
  Höchsttiefe; Deckel 256 je Lauf, danach nur noch Brandflecken ohne Zustand.
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
  Krater unter den Routen und ein Fall lassen die Tower in Reichweite ihre Sicht neu anfragen; ein vertiefter Krater
  (wenige Zentimeter) nicht.
- Speicher: drei `Int32Array` über dem Rechteck der Routenzellen, angelegt mit dem ersten Stempel; bei 512 m Kante
  höchstens 256 x 256 Zellen, 786 KB.

### 2. Hauptthread: wie es aussieht

**Gebäude in Stufen** (eigene Katalog-Modelle, instanziert in `render/objects/object-layer.ts`)

- **Instanz-Attribut `aDamage`** (vec4: Stufe mit Übergang, Saat, Richtung des stärksten Treffers, Startzeit des
  Falls) neben den Matrizen. Der Objekt-Shader bekommt einen Zweig `DAMAGE` (wie Wind, Spin, Nachtfenster), nur für
  zerstörbare Assets auf zerstörbaren Karten, vorab übersetzt mit `compileAsync` (Lehre E215: kein Programm im
  Spiel; Lichtzustände gibt es seit V1 keine mehr, die Lampen gehen in den Lichtpuffer).
- **Stufe 1, angeschlagen:** Risse und Ruß im Objektraum (triplanar über die `box`-Koordinaten, unabhängig von den UVs),
  dichter zur Trefferseite; Fenster brechen (Nachtfenster aus, Glas dunkel und gesprungen); Putz blättert an Kanten.
  Risse und Ruß aus einem kleinen handgemalten Atlas (vier Rissbilder, zwei Rußverläufe, Graustufen), nicht aus
  Rauschen: Rauschen wirkt generisch.
- **Stufe 2, schwer:** ein Biss aus Ecke oder Dach. Verworfen wird, was in einer Kugel um die Trefferecke liegt, mit
  zackiger Kante (Winkelrauschen, Lehre oben); innen Rückseiten in gedimmter Wandfarbe, eine Decke je Stockwerk
  (3 m, aus Katalog-Höhe und Name), Bewehrungsstäbe als kurze Linien an der Kante. Brennt bei Stufe 2 ein Glutnest mit
  Rauchfahne (vorhandene Partikel), höchstens 12 gleichzeitig.
- **Stufe 3, Fall:** der Teil über einer verrauschten Bruchhöhe (1,5 bis 4 m, Stumpf) fällt starr in 1,2 bis 2,5 s,
  kippt leicht zur Trefferseite, verschwindet beim Aufschlag; die Dreiecke an der Kante gehen. Danach bleibt die Ruine:
  dasselbe Modell bis zur Bruchhöhe, Decken offen, Schutt darauf.
- **Ruinen-Pool:** Instanzen ab Stufe 2 wandern in ein eigenes `InstancedMesh` je Asset mit `DoubleSide` und dem
  Zweig für Innenseiten. Intakte Gebäude behalten `FrontSide` und Early-Z; der Pool kostet einen Draw Call je Asset mit
  Schaden, nicht je Ruine. Heute schrumpft ein Fall das Objekt in seiner Zelle (`FALLEN_SCALE`), der Pool ersetzt das.
- **Schutt:** (a) ein positiver Stempel ins Höhenraster innerhalb der `box` (Volumen aus Höhe mal einem Drittel,
  geglättet), Splat-Schicht „Schutt“ darüber: der Haufen bekommt Licht, Schatten, Gras-Aussparung und Fußpunkte der
  Tower vom Gelände, ohne eigenes System. (b) Brocken: vier bis sechs handmodellierte Stücke (Ziegelplatte, Betonplatte
  mit Eisen, Balken, Dachziegelscholle), instanziert, nach Saat auf dem Haufen verteilt, gefärbt nach `material` des
  Katalogs; ein Draw Call je Stück für alle Ruinen. (c) fliegende Brocken mit ballistischem Vertex-Shader aus Startwerten
  (keine CPU je Bild), aus einem Pool.
- **Staub und Rauch:** Blitz, Staubsäule, Bodenwalze, Nachrauch 20 bis 30 s, Glut; in die vorhandenen Effekt-Pools
  (`three-engine/renderers`), gestaffelt nach Größe, gedeckelt (älteste weicht).
- **Materialklassen** am Katalog: `material: brick | plaster | concrete | stone | wood | metal | glass`, gemessen oder
  gesetzt in `tools/map-assets` (Farbe des Schutts, Rissbild, Staubfarbe, Bruchgeräusch). Holz bricht in Balken und
  Splitter, Beton in Platten, Glas in Scherben.
- **Zufall:** jede Ruine würfelt aus der Bauwerks-Id und dem Tick ihres Falls. Alle Partner und jedes Replay sehen
  dieselbe Ruine.

**Gelände**

- **Eine Stempelfunktion** (`map-ops/impact-stamp.ts`, gebaut, ohne three und Angular): Mulde und Schutthaufen in ganzen
  Zentimetern aus dem Abstandsquadrat (siehe „Stempelraster“), dazu ein Splat-Abdruck (verbrannte Erde, Gras weg). Krater
  und Schutt liegen auch auf der Straße (Entscheid 1); das Bild muss dort dieselben Zentimeter zeigen wie das Raster der
  Simulation, daneben darf es feiner sein (der Fuß eines Towers bleibt aus der Mulde). Editor und Spiel benutzen sie gleich.
- **Grundraster behalten:** beim Laden eine Kopie der Höhen (264 KB bei 512 m und 2 m, 1 MB bei 1024 m). Ein Krater
  schreibt in das Raster; ein Wiederherstellen setzt die Kopie zurück und stempelt die Liste neu.
- **Gebündelt aufbauen:** gemessen kostet `updateHeights(rect)` 1 bis 3 ms, ganz 118 bis 174 ms. Ein Kraterbuch auf dem
  Hauptthread sammelt die Rechtecke eines Bilds in Kacheln von 64 x 64 Samples und baut höchstens eine Kachelmenge je
  Bild; Wiederherstellen stempelt alles in unter 1 ms und baut die berührten Kacheln über einige Bilder, nicht das
  ganze Raster.
- Wasser, Brücken, Gras und Objektsitze folgen schon heute einem Rechteck (`custom-map-view.ts:714`).

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
| Sichtlinien | ändern sich beim Fall (gibt es) und bei Stufe 2 nicht | eine Neuanfrage je Fall, nicht je Treffer |
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
| Draw Calls durch Ruinen | ein Pool je Asset mit Schaden plus 4 bis 6 Brocken, unabhängig von der Zahl | nicht gemessen |
| CPU je Ruine und Bild | null (Animation im Shader aus Startzeit) | entfällt |
| Neue Shader-Programme im Spiel | null (vorab übersetzt) | entfällt |
| Speicher | Grundraster 0,26 bis 1 MB, Brocken-Pools fest | entfällt |

Messen mit einem `e2e/perf`-Läufer: Fall, Kraterserie, Atomschlag auf Ruined City und einer großen OSM-Stadt, Bildzeit
samt GPU wie in `hitch-probe.ts`; Budgets in `npm run test:perf` für Ledger und Stempel.

## Strukturkosten (Z1, gezählt, nicht gemessen)

| Posten | Kosten |
|---|---|
| Treffer eines Projektils | eine Rasterabfrage über die 16-m-Felder in Reichweite (Rakete: Splash 5 m plus 1 m, 1 bis 4 Felder), Abstandsquadrat je Bauwerk darin; Dach-Prüfung nur für ein getroffenes Bauwerk mit `roof`, O(Tower) |
| Ops je Treffer | keiner, solange keine Stufe wechselt; je Stufenwechsel `structures.stage` (2 Zahlen), höchstens 3 je Bauwerk und Lauf; je Krater-Treffer `craters.dig` (5 Zahlen), bis der Krater seine Höchsttiefe hat |
| Ganze Menge | `structures.setStages` ein Byte je Bauwerk (7 928 Gebäude einer OSM-Stadt: 7,9 KB), nur nach Laden, Neustart, Restore, Sprung; vorher bei jedem Fall alle gefallenen Ids als Strings |
| Gegner je Teilschritt | ohne Stempel nichts (Raster `null`); mit: ein Nachschlag für die Höhe, für Läufer am Boden ein Umrechnen nach lokal und ein zweiter für die Bremse |
| Verschleiß | einmal je Sekunde Spielzeit eine Rasterabfrage je Gegner am Boden, nur mit `wear` |
| Snapshot | die HP (wie bisher), `craters` vier Zahlen je Krater, höchstens 1 024 Zahlen |
| Speicher | Raster drei `Int32Array` über dem Rechteck der Routenzellen, angelegt mit dem ersten Stempel (512 m: höchstens 786 KB) |

Zeitmessungen stehen aus (Rechner unter Last), vorgemerkt in den Messnotizen.

**Balance der Bremse** (`tools/balance-calc`, Szenario `rubble`, Abwehr des menschlichen Laufs vom 2026-10-01): mit
85 % Tempo auf 0 bis 30 % der Meter unter Feuer (im Mittel 95 bis 100 % Tempo) liegt das HQ nach W60 zwischen 47 und
65 (ohne Schutt 58), kein Tod vor W60; der Druck-Regler gleicht die längere Zeit unter Feuer aus. Kein Rückfall nötig.

## Phasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| Z1 Unterbau (gebaut) | Ledger v2 (Raster, Stufen, Delta-Ops, Logik statt VFX), Schadenswerte je Projektiltyp, Fähigkeiten, `CraterLedger`, Stempelfunktion und -raster mit Höhe und Bremse der Gegner, Verschleiß in der Simulation; aus Z5 Regeln, OSM-Schalter, Vorschaden im Format | Specs, gleiche Prüfsummen ohne Zerstörung, Koop, Replay, Sprung, Spielstand |
| Z2 Gebäude | `aDamage`, Stufen 1 und 2 im Shader, Ruinen-Pool, Fall, Decken und Innenwände, Rissatlas, vorab übersetzen | Vorher/Nachher-Bilder Ruined City und OSM-Stadt |
| Z3 Schutt und Effekte | Schutthaufen ins Höhenraster (dieselbe Stempelfunktion), Brocken, fliegende Brocken, Staub, Glut, Ton | Clip eines Falls je Materialklasse |
| Z4 Gelände | Kraterbuch mit Kachelaufbau, Grundraster, Brandflecken, Tower-Fuß aus der Mulde | Clip Raketenserie und Atomschlag, Sprung im Replay |
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
