# Eigene Welten und Editor: Performance und Optik (Plan, 2026-10-18)

Zusammenfassung von sechs Analysen (Spiel-Performance, Editor-Performance, Laden und Speicher, Optik Gelände/Wasser/
Licht, Optik Objekte, Zerstörung). Die Zerstörung hat einen eigenen Plan: [DESTRUCTION_PLAN.md](DESTRUCTION_PLAN.md).

Gemessen wurde auf einem stark belasteten Rechner. Belastbar sind Zählungen (Draw Calls, Dreiecke, Programme, Matrizen,
Speicher), Profilanteile und große Unterschiede. Zeitwerte sind Richtwerte und werden bei freiem Rechner nachgemessen.

## Lage

- **OSM-Städte sind pro Bild 8- bis 15-mal so teuer wie mitgelieferte Karten.** Stuttgart: 1433 Draws, 10,5 M Dreiecke,
  9886 Meshes (8909 InstancedMesh mit im Schnitt 11 Instanzen). Die Kosten sitzen fast ganz in der Zahl der Draws und
  Szenenknoten; Gegner, Simulation und Shader sind dort Nebensache. Die Stufe Low spart auf OSM kaum (1283 Draws).
- **Gebäude haben oft keine Fernstufe** (53 von 104), alle anderen schalten fest bei 350 m, ganze 192-m-Zellen auf
  einmal. 85 Modelle über 1500 Dreiecke haben gar keine LOD.
- **Jedes Bild rechnet alle Weltmatrizen neu** (11 447 Multiplikationen in Stuttgart, 71 % davon unnötig), und die
  Kamerasteuerung durchläuft für ihre Bodenabfrage zweimal pro Bild den ganzen Szenengraphen.
- **Weltwechsel leckt**: der alte Renderer samt Spieloberfläche bleibt über Materialien auf Modulebene hängen
  (+24 MB je Wechsel, E195). Der Editor leckt beim Malen über Upload-Bereiche unsichtbarer Meshes (94 → 641 MB).
- **Laden**: OSM bis spielbar 19 s warm, 39 s kalt; Gelände, Wasser und Korridor backen auf dem Hauptthread. Kalt
  warten die Shader 7 bis 16 s; die Zahl der Punktlichter erzeugt Programm-Varianten (~515 Programme je Laden).
- **Editor**: jeder Wechsel Editor ↔ Test baut einen neuen WebGL-Kontext (Sekunden Stillstand); große Auswahl ziehen
  0,5 s je Mausbewegung (ein Linienobjekt je Ring).
- **Optik**: Nebelwand am Kartenrand, milchig von oben, Straßen aus der Ferne unlesbar, Impostoren heller und oranger
  als die Modelle (Farbfront in Zellenblöcken), Gras als Heuwiese bis an die Wand, Laternenpools als harte Scheiben,
  Strata-Maserung im Vorland von Mond und Mars, Staub als Bokeh-Scheiben vor der Kamera.
- **Reserve**: die GPU hat auf mitgelieferten Karten viel Luft (2,5 bis 7,5 ms bei 2048x1152); Optik-Arbeit in Shadern
  ist praktisch kostenlos.

## Pakete

Reihenfolge nach Wirkung, eingeteilt so, dass parallele Worker sich wenig in die Quere kommen. „Wartet“ heißt: erst
nach dem genannten laufenden Worker, weil dieselben Dateien betroffen sind.

| Paket | Inhalt | Ziel (strukturell) | Status |
|---|---|---|---|
| **V1 Statische Szene** | `matrixAutoUpdate` aus für statische Kartengruppen (bewegte Teile in eigener Gruppe); eigene Bodenwurzel der Kamera über Höhenfeld und Dächer mit Versionszähler; Punktlichter als festes Array mit Uniform-Schleife statt Programm-Varianten; `forceContextLoss` erst nach dem Wechsel; Himmel, PMREM und Impostor ins Vorab-Übersetzen | Multiplikationen pro Bild −70 %, kein Traversieren in der Bodenabfrage, Programme je Laden etwa halbiert | gebaut (siehe unten) |
| **V2 Objekte: LOD und Draws** | LOD nach Bildgröße statt fester Distanz, LOD je Instanz auch in Zellen, Kastenstufe (LOD2) für Gebäude mit gebackener Fassade, fehlende LODs nachziehen; Zellen eines Assets bzw. Gebäude je Material als `BatchedMesh`; Sichtlinie und Schattencaster unverändert | Stuttgart High unter 300 Draws, unter 4 M Dreiecke; Low unter 50 % der GPU-Zeit von High | gebaut (r8-objlod): eine InstancedMesh je Asset/Stufe/Teil für die ganze Karte statt `BatchedMesh` (Firefox hat kein `WEBGL_multi_draw`, three zeichnet dann je Instanz einzeln), LOD je Instanz nach Bildanteil, Kastenstufe aller Gebäude in einem Draw, 101 Fernkopien, Rebzeilen und Hecken als Kasten. Stuttgart High, Spielansicht (mit Spiegel): 920 → 335 Draws, 12,2 → 4,5 M Dreiecke (Hauptpass 235 / 3,3 M), Meshes 9188 → 817; Low 458 / 7,2 M → 198 / 2,5 M; Oberbergen High 391 / 7,1 M → 155 / 1,6 M. Offen: unter 300 Draws gesamt braucht V8 (Gelände 150 bis 330), Impostoren aller Baumarten in einem Draw (mit r8-veg) |
| **V3 Lecks und Laden** | Materialien auf Modulebene je Engine (tower-scaffold, blob-shadow, Rauschtexturen), Probe gegen abgehängte Canvases; Upload-Bereiche zusammenfassen; GroundOcclusion und Wasser-Backen im Worker auch im Spiel, Eckenprüfung des Korridors im Worker; Rauschtexturen gebacken; feste 50-ms-Pausen raus; Shader-Fortschritt auf dem Ladeschirm; Cache über Releases, `put` nicht abwarten, Ton nach `ready` | Renderer-Prozess über 10 Wechsel höchstens +5 %; kein Task über 200 ms beim Laden | Worker r8-load |
| **V4 Atmosphäre und Licht** | Dunstfarbe richtungsabhängig aus dem Himmel, Luftperspektive höhenabhängig statt Rand-Stufe, Vorland sichtbar mit Fernbäumen; Sumpf- und Endzeit-Look lesbar; Strata nur auf Steilflanken; Laternenpools weich mit Ausläufer und Glanz; Wasser ohne Kachelmuster, Schaum weich und beleuchtet; Eisrand; Staub als Schlieren; Rauch am Kamin; Untergrenze fürs Umgebungslicht nachts | Vorher/Nachher je Karte (horizon, top, game); höchstens +0,5 ms GPU je Paket | Worker r8-atmo (Abstimmung r7-storm, r7-muzzle) |
| **V5 Editor** | Auswahlringe in einer Geometrie bzw. instanziert mit weichem Bodenring-Shader, beim Ziehen nur Lage nachführen; fortlaufende Ids statt Kopie je Klick, Streu-Raster einmal halten; Aufbau der Kartenansicht über mehrere Bilder; Vorschaupunkte nur bei Änderung; Paletten-Bilder zwischenspeichern | Ziehen von 8000 Objekten ohne Neubau je Bild; kein Bild über 100 ms beim Öffnen | Worker r8-editor |
| **V6 Vegetation und Bodenkontakt** | Impostoren neu gebacken (Normalen, Tiefe, beleuchtet wie das Modell, Farbabgleich, 128 px je Ansicht), LOD1 für Bäume; Gras je Bodenschicht (Rasen kurz, Wiese hoch), Rand um Gebäude, Halmfarbe aus gebackener Bodenalbedo, Gegenlicht; Erdflecken als Trampelpfade; Decal-Deckel nach Fläche; Zäune am Hang; mehr Altersklassen und Kronenvarianten | Kein Farbsprung Modell/Impostor im Vorher/Nachher; keine Heuwiese an Fassaden | Worker r8-veg |
| V7 Straßen-Fernbild | Kantenbänder mit Mindestbreite in Pixeln, Markierungen mit erhaltener Deckung, dunklerer Asphalt, AO-Saum, Makroflecken unter Siedlungen dämpfen, Gehwege aus OSM | Straßen in der Spielübersicht lesbar | wartet: r6-surface (gemeinsames Oberflächenmodul) |
| V8 Gelände-Shader und Raster | Sampler packen (17 → höchstens 13), Quadtree mit gröberen Fernstücken, Fernprogramm mit gebackener Farbe | Keine Warnung „17 texture units“, Gelände-Draws in Stuttgart halbiert | wartet: r6-surface (Terrain-Material) |
| V9 Texturen und Modelle komprimiert | KTX2 (ETC1S/UASTC) und Meshopt für Karten- und Spielmodelle, geteilte Materialbibliothek, Laden nach Bedarf, VAT offline | Grafikspeicher der Modelltexturen −50 %, Spielmodelle 90 → ~25 MB | danach, mit Sichtabnahme |
| V10 Fassaden und Stilsätze | Fassaden-Bausatz (Laibungen, Simse, Attika, Sockel), gebackene Verwitterung, Altstadt-Stilsatz mit Fachwerk, Endstücke für Reihen, Fassadenvarianten | Kontaktbögen Rothenburg, Miltenberg, Harbor | wartet: r6-bldg, r6-maps (E179) |
| V11 Renderer behalten | ein Renderer und Kontext über Editor, Test und Weltwechsel | kein Neu-Linken beim Wechsel | nach V1 und V3 |

## Gebaut

### V1 Statische Szene (r8-scene, 2026-10-19)

Belege strukturell, gezählt in Specs und Browser-Proben (Entwicklungs-Build, Rechner unter Last; Zeiten in der
Messliste für später).

- **Statische Matrizen:** `StaticGroup` (`three-engine/static-group.ts`) für `view.group` und `view.losBlockers`:
  der Teilbaum rechnet nach einem Verschieben (`view.placeAt`), einem neuen Elternteil, `invalidate()` oder für ein
  hinzugekommenes Objekt (`childadded`, nur dessen Teilbaum), Teile mit eigener Bewegung über `addMoving` jedes Bild.
  Auf der Karte bewegt sich nichts über Knoten-Transformationen (Mover, Boote, Vögel, Rotoren, Stoff, Gondeln laufen
  in Instanzpuffern und Shadern), die Gruppe für Bewegtes steht bereit. Die Szene des Editors setzt
  `matrixAutoUpdate` aus wie die des Spiels. Multiplikationen in der Matrixaktualisierung je Bild: Stuttgart (OSM)
  11 966 → 668 (−94 %; der Rest sind versteckte Pool-Meshes des Spiels, nicht die Karte), alle Multiplikationen je
  Bild 12 809 → 1430; Demo-Tal Kartenanteil 523 → 0, Editor 349 → 0
- **Bodenwurzel der Kamera:** `MapGroundPick` raycastet Höhenfeld und Dächer analytisch (`CustomMapSurface.pickRay`),
  Version aus `surface.pickVersion` und den Verschiebungen statt `SceneGraphVersion` über 8400 Knoten zweimal je Bild
- **Punktlichter:** die Lampen der Karte gehen als feste Lichter in den Lichtpuffer (`shot-lights`, gemeinsam mit
  r7-muzzle), keine three-`PointLight`s mehr; alle Lichtzustände im Vorab-Übersetzen entfallen. Harbor Town, High:
  Programme bis `ready` 397 bis 405 → 212 bis 215 (−47 %), nach dem Vorbereiten der Stufen 557 bis 642 → 277
  (−50 bis −57 %), erste Nacht 60 bis 85 → 0; Editor 226 → 160. Stuttgart danach: 215 bis `ready`, 253 nach 15 s.
  Optik nachts gleich bis auf weichere Fleck-Mitte unter den Laternen ([SHOT_LIGHTS.md](SHOT_LIGHTS.md))
- **Kontextverlust:** `releaseContext`/`settleContexts` (`three-engine/context-release.ts`): der alte Kontext geht,
  wenn die neue Ansicht steht (Spiel `load:ready`, Editor nach dem Vorab-Übersetzen), im nächsten Leerlauf. Editor →
  Test → Editor (Demo-Tal): `loseContext` 16 + 21 ms und 22 + 63 ms; vorher 0,9 und 2,3 s (Messung r7-eperf) und
  4 s für den Kontext der Paletten-Bilder (erste Probe, noch sofort verloren). Nicht entfernt: der Browser hält nur wenige Kontexte, und ein festgehaltener alter Kontext ließe beim
  Limit den ältesten lebenden verlieren
- **Vorab-Übersetzen:** Himmels-Bake (`SkyDome.link`, `envReady` wartet), Erstbenutzung der PMREM-Programme je Task,
  Impostor-Bake zeichnet mit dem vorab kompilierten Kopier-Quad (vorher entsorgt und neu gelinkt)
- Offen außerhalb V1: rund 500 versteckte, unbenannte Pool-Meshes des Spiels (ShaderMaterial) rechnen ihre Matrix
  jedes Bild (Demo-Tal 801, Stuttgart 534 Multiplikationen je Bild); der Wechsel Editor → Test hat weiter ein langes
  Bild beim Abbau des Editors und Aufbau des Spiels (2,4 bis 7 s unter Last), nicht der Kontextverlust

## Regeln für alle Pakete

- Marschroute: extrem performant, architektonisch sauber und erweiterbar, handgemachte unverwechselbare Optik.
- Belege strukturell, solange der Rechner unter Last ist; Zeitmessungen als Zeile in der Messliste für später.
- Sichtlinien, Simulation, Coop-Prüfsummen und Kartenhashes bleiben unverändert, wo nicht ausdrücklich anders geplant.
- Jede Optik-Änderung mit Vorher/Nachher-Bildern gleicher Kamera.

## Zerstörung

Konzept in [DESTRUCTION_PLAN.md](DESTRUCTION_PLAN.md) (Simulation führt den Zustand als ganze Zahlen, Darstellung
leitet ab; Phasen Z1 bis Z6). Gebaut wird nach den zehn offenen Entscheidungen dort.
