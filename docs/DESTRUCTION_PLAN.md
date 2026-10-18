# Zerstörung in eigenen Welten (Plan)

**Status:** Konzept, 2026-10-18. Nichts davon ist gebaut außer dem, was „Was es schon gibt“ nennt. Baut auf
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

## Was es schon gibt (E131)

- `gameplay.destructible` an der Karte (Editor: Rules, „World“); mitgeliefert zerstörbar: `ruined-city`.
- Bauwerke sind Objekte der Katalogkategorien `building`, `wall`, `structure`
  (`world/custom-map/custom-map-destruction.ts:6`), HP aus dem Zylindervolumen, 60 bis 3000.
- Simulation: `StructureLedger` (`managers/game-state/structure-ledger.ts`), jede Projektil-Einschlagstelle nimmt jedem
  stehenden Bauwerk in 4 m plus Radius 20 HP; HP in Snapshot und Zustands-Hash (`STATE_HASH_VERSION` 6), Bauwerke im
  Weltschlüssel (`RunRules.structures`).
- Ops: `structures.setFallen(ids)` (ganze Menge) und `main.structureFell` (Moment, Explosion).
- Darstellung: ein gefallenes Objekt schrumpft auf `FALLEN_SCALE` (1e-3) und verschwindet
  (`custom-map-world.ts:703` bis `:732`), dazu eine Explosion in seiner Größe (`presentation/world-damage-presenter.ts:50`).
  Es bleibt nichts liegen.
- Sichtlinien: Tower in Reichweite plus Radius fragen ihre Sicht neu an (`GameStateManager.seeAroundFall`).
- Bauen: ein gefallenes Objekt sperrt nicht mehr; Dächer zerstörbarer Gebäude tragen nie Tower
  (`passingObjectIds`, `custom-map-destruction.ts:21`).

Lücken: keine Schadensstufen, keine Ruine, kein Schutt, kein Gelände, Fähigkeiten beschädigen nichts, alle Projektile
gleich (ein Pfeil wie eine Rakete), Tower ohne Projektil (Strahl, Kette, Laser, Säge, Strom) gar nicht, OSM-Welten
sind nie zerstörbar (die Umwandlung setzt das Feld nicht).

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

### 1. Simulation (Worker): was zerstört ist

**`StructureLedger` v2**

- **Stufen aus HP, kein neuer Zustand:** Stufe 0 intakt (über 75 %), 1 angeschlagen (75 bis 40 %), 2 schwer (unter
  40 %), 3 gefallen (0). Die Stufe ist eine Funktion der HP; Snapshot und Hash tragen wie heute nur die HP.
- **Schadensquellen** (Vorschlag, Zahlen per Rechnung in `tools/balance-calc`, nicht per Bot):
  - Projektil: neues Feld `structureDamage` am Projektiltyp (Pfeil, Bolzen, Kugel 0 oder 1; Kanonenkugel, Rakete
    hoch), Reichweite `splashRadius` plus Bauwerksradius. Heute: jedes Projektil 20 HP in 4 m.
  - Fähigkeiten: Atomschlag nimmt allem in `radiusM` (25 m) genug, dass es fällt; Orbitallaser je Sekunde auf dem Strahl;
    Frost und EMP nichts.
  - Verschleiß an den Routen (wie im Prototyp, aber in der Simulation): jeder Gegner in 6 m eines Bauwerks nimmt je
    Sekunde Spielzeit `wearDps`, Bosse mehr. Vorab je Bauwerk die Routenzellen in Reichweite (beim Laden), je Durchgang
    nur die Gegner auf diesen Zellen, alle 250 ms Spielzeit.
- **Raster statt Liste:** `hit` läuft heute über alle Bauwerke (`structure-ledger.ts:81`). Bei 8 000 OSM-Gebäuden und
  Hunderten Einschlägen je Sekunde ist das unnötig; ein Raster aus 16-m-Feldern (wie `buildBlocker`) macht es O(Treffer).
- **Ops als Delta:** heute schickt jeder Fall die ganze Menge der Gefallenen als Strings (`structure-ledger.ts:115`), über
  einen Lauf mit Tausenden Fällen wächst das quadratisch. Neu: `structures.setDamage(stufen)` als `Uint8Array` in der
  Reihenfolge der Laufregeln, nur nach Restore, Sprung und Neustart; dazwischen `structures.stage(index, stufe)` je
  Stufenwechsel.
- **Schaden als Logik, nicht als VFX:** die Simulation hängt den Schaden heute an `vfx:projectile-impact`
  (`game-state.manager.ts:876`), ein aufgeschobenes Darstellungsereignis. Neu: der `ProjectileManager` meldet den
  Einschlag als Logikereignis (oder ruft den Ledger direkt); die Darstellung bleibt davon frei.

**`CraterLedger`** (neu, `managers/game-state/crater-ledger.ts`)

- Ein Krater ist vier ganze Zahlen: Mitte in Dezimetern (x, y der Karte), Radius in Dezimetern, Tiefe in Zentimetern.
- Quellen: Projektile mit `craterRadius` am Typ (Kanonenkugel, Rakete, Flak: 1,5 bis 3 m), Atomschlag (25 m, 4 m),
  Bossaufschlag später.
- **Zusammenlegen:** ein Einschlag in 2 m eines Kraters vertieft ihn (bis zur Höchsttiefe seines Radius) statt einen
  neuen anzulegen. So wächst die Liste mit den Orten, nicht mit den Treffern; Deckel 256 je Lauf, danach nur noch
  Brandflecken (Decal, ohne Zustand).
- **Tower schützen:** die Simulation kennt die Tower; liegt einer in Radius plus 3 m, wird die Tiefe gedämpft. Die
  fertige Tiefe steht im Eintrag, der Hauptthread rechnet nichts nach.
- Snapshot `craters?: number[]` (flach, vier je Krater), Hash-Teil nur, wenn die Liste Einträge hat.
- Ops: `terrain.setCraters(liste)` (ganz, nach Restore und Sprung), `terrain.crater(eintrag)` je neuem oder vertieftem.

**Spielregeln** (siehe „Auswirkungen aufs Spiel“): Krater ändern keine Route und keine Gegnerhöhe, Ruinen sperren keine
Straße. Die Simulation braucht deshalb keine Höhen des Kraterbilds; ihre Zellhöhen bleiben die vom Korridor-Bau.

### 2. Hauptthread: wie es aussieht

**Gebäude in Stufen** (eigene Katalog-Modelle, instanziert in `render/objects/object-layer.ts`)

- **Instanz-Attribut `aDamage`** (vec4: Stufe mit Übergang, Saat, Richtung des stärksten Treffers, Startzeit des
  Falls) neben den Matrizen. Der Objekt-Shader bekommt einen Zweig `DAMAGE` (wie Wind, Spin, Nachtfenster), nur für
  zerstörbare Assets auf zerstörbaren Karten, vorab übersetzt mit `compileAsync` und beiden Lichtzuständen (Lehre E215:
  kein Programm im Spiel).
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

- **Eine Stempelfunktion** (`map-ops/terrain/impact-stamp.ts`, ohne three und Angular): Mulde `(1 - q)^2` mit Wall bei
  0,85 des Radius, Halt der Straßen wie beim Geländepinsel (die Straße bleibt, wo sie ist; auf ihr nur ein Brandfleck),
  dazu ein Splat-Abdruck (verbrannte Erde, Gras weg). Editor und Spiel benutzen sie gleich.
- **Grundraster behalten:** beim Laden eine Kopie der Höhen (264 KB bei 512 m und 2 m, 1 MB bei 1024 m). Ein Krater
  schreibt in das Raster; ein Wiederherstellen setzt die Kopie zurück und stempelt die Liste neu.
- **Gebündelt aufbauen:** gemessen kostet `updateHeights(rect)` 1 bis 3 ms, ganz 118 bis 174 ms. Ein Kraterbuch auf dem
  Hauptthread sammelt die Rechtecke eines Bilds in Kacheln von 64 x 64 Samples und baut höchstens eine Kachelmenge je
  Bild; Wiederherstellen stempelt alles in unter 1 ms und baut die berührten Kacheln über einige Bilder, nicht das
  ganze Raster.
- Wasser, Brücken, Gras und Objektsitze folgen schon heute einem Rechteck (`custom-map-view.ts:714`).

### 3. Editor

- **Rules, „Destruction“:** `destructible` (gibt es), dazu `wear` (Verschleiß an den Routen), `craters`, `hpScale`
  (50 bis 300 %).
- **Je Objekt:** `destructible?: boolean` (ein Rathaus, das nie fällt), `damage?: 0..3` als Vorschaden mit Saat: eine
  Endzeit-Stadt aus intakten Modellen, deren Ruinen dieselbe Optik haben wie im Spiel. Ruined City würde damit echte
  Ruinen statt Ruinen-Modellen tragen können.
- **Werkzeug „Treffer“:** ein Klick im Viewport trifft mit wählbarer Stärke (Projektil, Rakete, Atomschlag) und zeigt
  Stufen, Krater und Effekte wie im Spiel; „Zurücksetzen“ und „als Vorschaden übernehmen“. Nur dieser Schritt ändert
  das Dokument.
- **Geländepinsel „Einschlag“:** setzt Krater mit derselben Stempelfunktion ins Dokument (bleibender Krater der Karte,
  kein Laufzustand).
- **Prüfung:** warnt bei zerstörbaren Gebäuden, die eine Route verdecken würden, wenn ihr Schutt liegen bliebe
  (Haufen reicht nie auf die Straße, siehe unten), und bei Karten mit mehr als 4 000 zerstörbaren Bauwerken.

### OSM-Welten

- Die Umwandlung setzt `gameplay.destructible` nach einem Schalter im Rahmen (Vorschlag: an), Material aus
  `building:material` und der Art (`brick`, `concrete`, `plaster`, Holz für Scheune und Schuppen).
- Bis 8 000 Gebäude: deshalb Raster, Delta-Ops und `Uint8Array` oben. Die Stufen machen OSM-Städte glaubwürdiger als
  Ruinen-Modelle, die es für moderne Häuser nicht gibt.

## Auswirkungen aufs Spiel

| Frage | Vorschlag | Warum |
|---|---|---|
| Ändern Ruinen Wege? | Nein. Schutt bleibt im Grundriss und vor der Straße stehen (Halt der Straßen) | Routen stehen je Spawn fest (A*), ein Wechsel mitten in der Welle bräche Korridor, Budget und Coop |
| Ändern Krater Wege oder Gegnerhöhe? | Nein, auf der Straße nur ein Brandfleck | Die Zellhöhen der Simulation bleiben gültig, Gegner schweben nie |
| Sichtlinien | ändern sich beim Fall (gibt es) und bei Stufe 2 nicht | eine Neuanfrage je Fall, nicht je Treffer |
| Bauen | eine Ruine wird bebaubar (auf dem Schutt, Sockel wie am Hang); Stufe 1 und 2 sperren wie intakt | Ruined City verspricht „Build in the fallen blocks“ |
| Tower auf Dächern zerstörbarer Gebäude | weiter nicht (wie heute) | ein Tower in der Luft nach dem Fall braucht eigene Regeln, später |
| Deckung für Gegner | nein | Gegner laufen auf Zellen, Deckung wäre ein neues Kampfsystem |
| Belohnung | keine | Abriss wäre sonst eine Goldquelle |
| Straße absichtlich sperren | nur als Wellen-Ereignis der Karte (`objects`, gibt es) | vom Kartenbauer gewollt, mit vorhandenem Mechanismus |

## Determinismus, Coop, Replay, Spielstand

- **Zustand:** HP (gibt es) und Kraterliste, beide ganze Zahlen, beide im Snapshot und im Hash. Stufen, Ruinen, Schutt
  und Effekte sind Funktionen davon.
- **Prüfsummen:** `STATE_HASH_VERSION` 7 mit Teil `craters`, nur wenn die Liste Einträge hat; Karten ohne Zerstörung,
  Tiles und DevWorld behalten Hash und Schlüssel (Regel wie bei den Wellen-Ereignissen). Neue Laufregeln (`wear`,
  `craters`, `hpScale`, Schadenswerte) gehen in den Weltschlüssel.
- **Rechnen:** die Simulation rechnet mit `+ - * /` und Ganzzahlen (Treffer: Abstandsquadrate gegen Radiusquadrate),
  kein `Math.sin` oder `Math.exp`, die zwischen Browsern abweichen dürfen. Die Stempelform rechnet nur der Hauptthread,
  dort ist eine Abweichung unsichtbar.
- **Replay-Sprung und Restore:** ganze Menge an Stufen und Kratern, stumme Wiederherstellung ohne Effekte (wie
  `main.structureFell`, das im Sprung wegfällt), Gelände aus Kopie plus Liste.
- **Coop:** der Gast baut die Bauwerke aus derselben Karte (gibt es), die Krater kommen aus seiner eigenen Simulation im
  Lockstep. Sichtlinien laufen über `command:los-mask` im Befehlslog, die GPU des Gasts entscheidet nichts.
- **Spielstand:** Snapshot-Felder; ein alter Spielstand ohne `craters` lädt ohne Krater.

## Performance-Budget

| Posten | Budget | Heute gemessen |
|---|---|---|
| Ledger je Tick (8 000 Bauwerke, 500 Einschläge je s) | unter 0,05 ms | Liste, O(Bauwerke) je Einschlag |
| Fall auf dem Hauptthread, synchron | unter 1 ms, Rest über Bilder verteilt | 0,1 bis 4,5 ms (`objectsChanged`) |
| Krater je Bild | höchstens ein Kachelaufbau, unter 1,5 ms | 1 bis 3 ms je `updateHeights(rect)` |
| Wiederherstellen von 256 Kratern | unter 30 ms, verteilt | ganzer Neuaufbau 118 bis 174 ms |
| Draw Calls durch Ruinen | ein Pool je Asset mit Schaden plus 4 bis 6 Brocken, unabhängig von der Zahl | nicht gemessen |
| CPU je Ruine und Bild | null (Animation im Shader aus Startzeit) | entfällt |
| Neue Shader-Programme im Spiel | null (vorab übersetzt) | entfällt |
| Speicher | Grundraster 0,26 bis 1 MB, Brocken-Pools fest | entfällt |

Messen mit einem `e2e/perf`-Läufer: Fall, Kraterserie, Atomschlag auf Ruined City und einer großen OSM-Stadt, Bildzeit
samt GPU wie in `hitch-probe.ts`; Budgets in `npm run test:perf` für Ledger und Stempel.

## Phasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| Z1 Unterbau | Ledger v2 (Raster, Stufen, Delta-Ops, Logikereignis statt VFX), Schadenswerte je Projektiltyp, Atomschlag, Hash 7 vorbereitet | Specs, gleiche Hashes ohne Zerstörung |
| Z2 Gebäude | `aDamage`, Stufen 1 und 2 im Shader, Ruinen-Pool, Fall, Decken, Rissatlas, vorab übersetzen | Vorher/Nachher-Bilder Ruined City und OSM-Stadt |
| Z3 Schutt und Effekte | Schutthaufen als Stempel, Brocken, fliegende Brocken, Staub, Glut, Ton | Clip eines Falls je Materialklasse |
| Z4 Gelände | `CraterLedger`, Stempelfunktion, Kraterbuch mit Kachelaufbau, Brandflecken, Snapshot | Clip Raketenserie und Atomschlag, Sprung im Replay |
| Z5 Editor und OSM | Rules „Destruction“, Vorschaden je Objekt, Treffer-Werkzeug, Einschlag-Pinsel, OSM-Schalter und Material | Ruined City mit Vorschaden, eine OSM-Stadt zerstörbar |
| Z6 Verschleiß | Gegner an den Routen, Bosse | Rechnung in `tools/balance-calc`, Playtest |

## Offene Entscheidungen

1. **Schutt sperrt nie die Straße.** Empfehlung: ja, nie (Routen bleiben fest).
2. **Krater ändern weder Weg noch Gegnerhöhe.** Empfehlung: ja, auf Straßen nur Brandfleck.
3. **Ruinen bebaubar.** Empfehlung: ja, ab Stufe 3 auf dem Schutt.
4. **Verschleiß durch Gegner** als eigener Schalter der Karte. Empfehlung: ja, standardmäßig aus.
5. **OSM-Welten standardmäßig zerstörbar.** Empfehlung: ja, mit Schalter im Rahmen.
6. **Fähigkeiten zerstören:** Atomschlag fällt alles in seinem Radius. Empfehlung: ja, Orbitallaser beschädigt, Frost und
   EMP nicht.
7. **Tower auf Dächern zerstörbarer Gebäude** bleiben verboten. Empfehlung: ja für jetzt.
8. **Innenwände** (der Prototyp hatte sie) oder nur Decken. Empfehlung: nur Decken, Innenwände erst, wenn Bilder sie
   fordern.
9. **Rissatlas handgemalt** statt Rauschen. Empfehlung: handgemalt, klein, Graustufen.
10. **Vorschaden je Objekt im Editor.** Empfehlung: ja, mit Saat.

## Risiken

- **Hülle ohne Inneres:** viele Katalog-Modelle sind offen nach unten oder haben keine Decken. Gegenmittel: Decken und
  Bodenplatte aus der `box`, Rückseiten gedimmt; im Zweifel je Modell eine Prüfung in `tools/map-assets`.
- **Program-Zahl:** ein Zweig `DAMAGE` je Materialvariante verdoppelt die Programme zerstörbarer Assets. Vorab
  übersetzen, nur auf zerstörbaren Karten.
- **Schatten:** ein Fall verändert die Silhouette; die Schattenkarte baut sich über mehrere Bilder (E204). Der Fall
  invalidiert sie einmal am Ende.
- **Balance:** stärkere Raketen gegen Gebäude ändern nichts am Kampf, aber Sichtlinien öffnen sich früher. Rechnung vor
  dem Playtest.
