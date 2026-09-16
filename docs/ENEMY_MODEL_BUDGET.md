# Enemy Model Budget

**Stand:** 2026-09-15 (Tabellen neu erzeugt: neues Tank-Modell mit gebackenem Anstrich, Ghost und Mech im Budget, siehe [Runde vom 2026-09-15](#runde-vom-2026-09-15); davor Todes-Clips von Zombie v2, Stone Golem und Zombie Soldier ganz gebacken, `deathDuration`)

Was die Gegnermodelle die GPU kosten, aus den Modelldateien gerechnet, und ein Budget je
Gegnerklasse. Die Tabellen unter [Messwerte](#messwerte) schreibt `npm run model-budget`
(`tools/model-budget/`). Sie laufen auch bei `npm test` mit und folgen damit Modell- und
Config-Änderungen. Alles andere in diesem Dokument ist von Hand geschrieben.

Anlass: Bei sehr großen Wellen (über 2.000 Gegner) ist `zombie_v2.glb` deutlich langsamer als
das alte `zombie.glb` (TODO.md, Performance - Advanced).

## Kurzfassung

- Die Blender-Runde vom 2026-09-13 hat zwölf Modelle geändert (`tools/blender/optimize_enemy.py`,
  ein Rezept je Modell, siehe [Empfehlungen](#empfehlungen-je-modell)). Beim Start backt das
  Spiel jeden Typ außer der Ooze (`preloadAllModels`; ihr Körper ist ein Band, `slime.glb`
  dient nur der Sidebar-Vorschau). Was die VATs zusammen belegen, steht als Summe unter
  [Laufzeitkosten](#laufzeitkosten-pro-gegner), am 2026-09-15 97,4 MB (die Ooze mit 0,1 MB
  eingerechnet; in der Runde vom 2026-09-15 kam der neue Tank mit 0,9 MB dazu, Ghost und Mech
  wurden 0,8 und 0,2 MB kleiner, die Clips und der Schwanz des Wurms kamen mit 1,1 MB dazu;
  88,2 MB, bevor die Todes-Clips von Zombie v2, Stone Golem und Zombie Soldier ganz in die VAT
  kamen), alle Typen RGBA16F außer dem Stone Golem (RGBA32F; alles in RGBA32F wären 168,0 MB). Vor der Runde vom 2026-09-13 waren es
  264,2 MB, bis 2026-09-12 (RGBA32F, Todes-Clips ungekappt) 664,6 MB.
  Die Runde vom 2026-09-14 (Tank, Ghost, Mech) steht unter
  [Runde vom 2026-09-14](#runde-vom-2026-09-14), die vom 2026-09-15 (neues Tank-Modell,
  Ghost, Mech) unter [Runde vom 2026-09-15](#runde-vom-2026-09-15).
- Die teuersten Wellen nach Vertex-Last sind jetzt `rat_tide` (5,0 Mio.), `zombie_horde`
  (3,6), `skeleton_swarm` (3,3), `armor_gauntlet` (2,4), `wraith_storm` (2,4) und `bat_swarm`
  (2,1); `mech_army` fiel mit der Runde vom 2026-09-14 von 4,2 auf 0,5. Vorher führten
  `hornet_strike` (14,9) und `zombie_horde` (14,4). Kein Template liegt über dem Richtwert von
  5 Mio.
- Über dem Budget je Modell liegen noch Herbert (30.831 VAT-Vertices, höchstens drei pro
  Welle), Wraith (8.126), Mammoth (5.557), Bat, Spider und Penguin.
- Die Ratten-Animation ist seit der Runde nicht mehr exakt (siehe Rat). Bei den anderen
  geänderten Modellen backt three.js dieselben Posen wie vorher; sie weichen nur durch das
  Decimate ab und bei Dragon und Golem in den Blend-Frames am Loop-Ende.
- Knochen und Dreiecke sind mit VAT zweitrangig. Die Knochen sind weggebacken, die Last ist
  Vertices × Instanzen.

Die Zahlen sind aus den Dateien gerechnet, nicht im Browser gemessen. Wie viel Frame-Zeit ein
Vertex kostet, zeigt erst ein Chrome-Trace.

## Kostenmodell

Der VAT-Shader (`vat-material.ts`) läuft einmal pro Vertex und Instanz und liest dabei eine
Position aus der VAT (RGBA16F, 8 Byte; RGBA32F, 16 Byte, wo Half-Float zu grob wäre, siehe
Spalte „Format“). Pro Frame kostet ein Gegnertyp:

- **Vertex-Last** = VAT-Vertices × lebende Instanzen.
- **VAT-Lesezugriffe** = Vertex-Last × 8 Byte. Für 2.000 zombie_v2 sind das rechnerisch
  rund 500 MB pro Frame, für 2.000 alte Zombies 72 MB. Caches senken beides, das Verhältnis
  bleibt.
- **Fragment-Last** nach Bildschirmfläche, unabhängig von der Vertexzahl.

„VAT-Vertices“ sind die Vertices, die der Loader erzeugt, nicht die im Modellierprogramm.
GLTFLoader übernimmt die Vertex-Buffer des GLB mit allen Splits an harten Kanten und
UV-Nähten, FBXLoader baut drei Vertices pro Dreieck.

Einmalig beim Laden:

- **VAT-Speicher** = Texturbreite × Texturhöhe × 8 Byte (RGBA16F) bzw. 16 Byte (RGBA32F).
  Die Breite ist die Vertexzahl
  (höchstens 8.192, darüber belegt ein Frame mehrere Zeilen), die Höhe sind die Frames aller
  gebackenen Clips (30 fps) × Zeilen pro Frame. Die Framezahl bestimmt Speicher und
  Bake-Zeit, nicht die Last pro Frame.
- **Bake-Zeit** wächst mit Vertices × Frames (CPU-Skinning pro Vertex und Frame).
- **Texturen**: Der Shader nutzt eine Diffuse-Textur pro Typ, die des Meshes mit den meisten
  Vertices. Weitere Bilder im GLB kosten Download und Dekodieren und werden in der
  Sidebar-Vorschau benutzt.
- **Knochen** kosten nur Bake-Zeit und die Sidebar-Vorschau (AnimationMixer).

## Budget je Klasse (Vorschlag)

Die Klasse richtet sich nach der größten Anzahl, die eine Welle von dem Gegner bringen kann
(Anteil × Obergrenze von `countRange`, Spalte „max./Welle“): Swarm ab 400, Normal ab 100,
darunter Elite/Boss.

Richtwert: **Die größte Welle eines Templates bleibt bei höchstens 5 Mio. VAT-Vertices.**
Das ist gut die Hälfte dessen, was 2.000 alte Zombies heute kosten (9,1 Mio.), und lässt Luft
für Tiles, Türme und Effekte. Der Wert ist nicht gemessen. Vor dem Festschreiben im Browser
prüfen, etwa mit der GPU-Zeit bei 2.000 Gegnern je Budgetstufe.

| Klasse | VAT-Vertices | Diffuse | Walk-Loop |
|---|---:|---:|---|
| Swarm | ≤ 1.500 (Ratte ≤ 1.000, bis 5.000 pro Welle) | ≤ 512² | ≤ 45 Frames (1,5 s) |
| Normal | ≤ 5.000 | ≤ 1024² | ≤ 60 Frames |
| Elite/Boss | ≤ 15.000 | ≤ 2048² | ≤ 90 Frames |

Todes-Clips brauchen kein eigenes Budget: Sie laufen mit `animationSpeed`, der Gegner
verschwindet nach `deathDuration` (Standard `TIMING.deathAnimationDuration`, 2 s), und
`vatClips` in `vat-clips.ts` backt nur bis dahin. Idle backt der Baker nicht.

Mit diesem Budget läge die teuerste Welle (`rat_tide`, 5.000 Ratten) bei 5,0 Mio. und
`zombie_horde` bei 3,7 Mio. (zombie-v2 als Normal-Gegner); alle anderen Templates lägen
darunter.

## Empfehlungen je Modell

### Stand nach der Blender-Runde (2026-09-13)

Je Modell: VAT-Vertices, VAT-Speicher (wie in der Tabelle, RGBA16F außer Stone Golem) und
Datei vorher → nachher. Jedes Rezept in `tools/blender/optimize_enemy.py` liest das Original
aus Git (`39fbb18`). Geprüft wurde, indem altes und neues GLB in three.js wie im Baker
gebacken und Frame für Frame verglichen wurden (Prozent beziehen sich auf die Modellhöhe).

- **Wallsmasher** 17.010 → 3.444, 19,5 → 2,7 MB, 3,4 → 0,4 MB: GLB statt FBX, nur Walk, Run
  und Death. Die GLB ist in Metern, `scale` 0,037 → 3,7. Gleiche Posen. Der FBX-Ladepfad im
  AssetManager und im Generator ist entfernt.
- **Hornet** 69.297 → 4.915, 33,2 → 2,2 MB, 4,4 → 1,1 MB: jedes Körperteil auf 3,6 % der
  Dreiecke, die vier Flügel unverändert. Zum Zusammenfassen gab es nichts: Jeder animierte
  Empty trägt ein Mesh, der Kopf zwei mit verschiedenen Materialien. Kopf, Brust und
  Hinterleib werden mit Nahtgewicht decimiert (UV-Nahtvertices kollabieren später); ohne das
  zog die Textur schwarze Streifen über die Mandibeln. Aus der Nähe sind die Beinsegmente
  facettiert.
- **Rat** 2.150 → 999, 0,2 → 0,1 MB, 2,5 → 0,2 MB: Decimate auf 42 %, eine 512²-Basisfarbe.
  **Animation nicht exakt**: Blender gibt `Run` zwischen den Keys anders wieder als die Datei,
  bei Frame 3 und 7 von 11 bis 9,4 % am hinteren Rücken, mit jeder getesteten
  Export-Einstellung. Mit geratener Bind-Pose exportiert das Rig kaputt.
- **Spider** 13.173 → 2.140, 3,1 → 0,4 MB, 1,6 → 0,6 MB: Körper 11 %, Augen 30 %, nur der
  Basis-Walk. Über dem Swarm-Richtwert, weil 8 % (1.649) die Beine zu Dreikantstäben machte.
- **Bat** 3.559 unverändert, 5,5 → 0,3 MB Datei: eine 512²-Basisfarbe statt drei
  2048²-Bildern, kein Decimate.
- **Dragon** 49,3 → 12,4 MB, 12,6 → 5,9 MB: `flying` auf einen Flugzyklus von 99 Frames
  (3,3 s). Kürzer wiederholt sich der Clip nicht, bei 1 s liegen die Posen 7 % auseinander.
- **Stone Golem** 42,8 → 21,5 MB, 17,8 → 3,1 MB: `Casual_Walk` auf 1,33 s (40 Frames). Die
  alte Loop-Naht sprang um 3,2 %, die neue schließt ohne Sprung. Texturen 1024². Bleibt
  RGBA32F (Half-Fehler 2,64 mm).
- **Zombie v2** 31.342 → 4.870, 52,8 → 10,1 MB, 3,8 → 1,9 MB: geschweißt, auf 12 %
  decimiert, neue UVs (Smart UV Project, Inseln nach Form gepackt). Jedes Texel nimmt die
  Atlasfarbe am nächstgelegenen Punkt des unveränderten Meshes in Ruhepose (2 × 2 Samples
  je Texel). 62 % der Vertices liegen auf UV-Nähten des alten Atlas; darauf decimiert
  verschmierte die Textur an den Nähten, Nahtgewichte änderten nichts. Ein Cycles-Bake
  (Selected-to-Active) sprenkelte Schädel und Hemd, weil Strahlen andere Flächen trafen.
  Aus der Nähe sind Schädel, Brust-Chevron und Gürtel wieder da; die Textur ist etwas
  weicher als im Original, der Schädelumriss facettiert. `Electrocuted_Fall` ist auf den
  Sturz (3,0 bis 5,0 s) geschnitten und wieder im Todes-Pool.
- **Wraith** 30.228 → 8.126, 3,8 → 0,9 MB, 3,4 → 1,8 MB: geschweißt, dann 17 %. Über dem
  Richtwert, weil die UV-Nähte rund 2,5 Vertices pro Position übrig lassen; 10,5 % (5.799)
  verschmierte den Brustkorb. Aus der Nähe verschmiert die Textur am Brustkorb auch bei 17 %.
  Nahtgewichte (41 % Nahtvertices) änderten nichts; neu gebacken wurde die dünne,
  doppellagige Robe dunkel und fleckig, mit mehr VAT-Vertices (12.267 bei 17 %).
- **Zombie** 4.525 → 1.453, 7,2 → 2,3 MB: geglättete Normalen, eine Look-Änderung (glatt
  statt facettiert) im eigenen Commit.
- **Penguin** 1.993 unverändert, 1,3 → 0,3 MB Datei: eine 512²-Basisfarbe (PNG, das
  Material blendet), nur Walk und Fall.
- **Mammoth** 5.541 → 5.557, 4,9 → 2,6 MB Datei: nur Walk und Die.

Beim Roundtrip durch Blender verschob der Standard-Import (geratene Bind-Pose) bei Zombie,
Penguin und Mammoth Knochen; mit `rest_from_file` war er exakt. Beim Mech war er nur ohne
geratene Bind-Pose exakt, bei der Ratte mit keiner Einstellung.

Der hier bis 2026-09-15 offene Ghost (5.248, doppelte Schleier) ist seit der
[Runde vom 2026-09-15](#runde-vom-2026-09-15) im Budget.

### Runde vom 2026-09-14

Wie oben: ein Rezept je Modell in `optimize_enemy.py`, Original aus Git (`39fbb18`),
Vergleich mit `bake-compare.mjs`; Normalen zusätzlich Vertex für Vertex verglichen.

- **Tank** (Modell von Zsky, seit 2026-09-15 ersetzt, siehe unten) 5.094 → 4.477, 0,2 MB
  Datei: Die Datei speichert 319 Vertices doppelt (gleiche
  Position, Normale und UV). Beim Import zusammengeführt (`merge`), schreibt der Export jeden
  einmal. Positionen gleich, Normalen höchstens 0,02° verschieden, der facettierte Look
  bleibt. Nach Position geschweißt wären es 4.466, dabei drehten sich die Normalen von 12
  Vertices um bis zu 47°. Geglättet wären es 2.269, eine Look-Änderung.
- **Ghost** 5.245 → 5.248, 8,0 → 4,2 MB, 2,7 → 2,5 MB: `Take 001` (6,67 s) läuft einen
  Schwebezyklus von 3,5 s knapp zweimal; geschnitten auf Frame 13 bis 118 (105 Frames), die
  Posen dort liegen 0,49 % auseinander, die letzten 4 Frames gleiten in die erste. Geometrie,
  Normalen (höchstens 0,03° verschieden) und Texturen bleiben, die Vertex-Last auch. Exakt nur
  mit `rest_from_file`; zu den doppelten Lagen siehe Runde vom 2026-09-15.
- **Mech** 42.455 → 5.416, 15,0 → 1,7 MB, 6,3 → 0,6 MB, `mech_army` 4,2 → 0,5 Mio.: Die 34
  starren Teile hingen je an einem Empty auf einem Knochen (Objekt-Anim.-Pfad).
  `rigid_to_skin` fügt sie zu einem geskinnten Mesh zusammen, jedes Teil voll auf seinem
  Knochen, jedes vorher für sich geschweißt; der Baker nimmt jetzt den Skinning-Pfad. Dann
  Decimate auf 12 % (3.457 Dreiecke), Normalen ab 60° getrennt, neue UVs und die Basisfarbe
  aus dem unveränderten Mesh neu gebacken (eine 1024²-JPEG für beide alten Materialien), nur
  Walk. Ohne geratene Bind-Pose wie in der Runde davor. Vergleich über den Walk-Clip:
  Bounding-Box höchstens 1,2 % verschieden, jeder neue Vertex im Mittel 0,28 % (p99 1,32 %)
  vom nächsten alten, in allen geprüften Frames gleich; der Vertex-Schwerpunkt liegt bis 4,2 %
  daneben, weil das Decimate die Vertices anders verteilt. Aus der Nähe ist die Textur
  weicher, Kolben und Füße sind vereinfacht, Splitter oder Löcher waren in Blender nicht zu
  sehen. Über dem Normal-Richtwert: Die neuen UV-Nähte trennen die 2.009 Positionen in 4.919
  Vertices, die harten Kanten in 5.416 (seit der Runde vom 2026-09-15 mit 10 % im Budget).
  Die Emissions-Textur fällt weg (im Spiel kommt das
  Leuchten aus der Config); `strip_to_base_color` setzt die Emission dafür auf Schwarz, sonst
  hätte die Sidebar-Vorschau den Mech weiß gezeigt.

### Runde vom 2026-09-15

Nach der Playtest-Entscheidung E18 (docs/archive/PLAYTEST_2026-09.md). Rezepte wie oben in
`optimize_enemy.py`; Vergleich mit `bake-compare.mjs` und mit Workbench-Renders aus Blender
(vier Ansichten, vorher und nachher).

- **Tank**, neues Modell: „Tank“ von Quaternius (CC0, https://poly.pizza/m/cW3zvvkMOM)
  ersetzt den Tank von Zsky (CC-BY 3.0). Die Quelle liegt unverändert unter
  `candidates/quaternius-tank/tank.glb` (Herkunft in `candidates/LICENSES.md`), das Rezept
  liest sie aus dem Arbeitsbaum (`rev: None`). Rumpf und Ketten sind auf 45 Knochen geskinnt,
  `Tank_Forward` (0,79 s) rollt die 44 Kettenglieder; Turm und Rohr hingen starr am
  Wurzelknoten, `bakeVAT` hätte sie weggelassen. Quelle 12.093 VAT-Vertices, gebaut 4.904,
  mit dem Anstrich (`paint`, unten) **4.932** (2.705 Dreiecke, VAT 0,9 MB, Datei 0,49 MB);
  der alte Tank hatte 4.477, statisch.
  - `join_skin`: alles in einen Skin, Turm und Rohr voll auf dem Knochen `Root`, den kein
    Clip bewegt.
  - `vertex_colors: False`: `COLOR_0` ist überall weiß und wird vom VAT-Shader nicht gelesen;
    die Materialfarben bleiben.
  - `cull_hidden`: 2.265 der 6.544 Flächen sieht keine Blickrichtung ab 10° unter dem
    Horizont, geprüft in sechs Posen über den Clip (Wannenboden, Laufräder hinter den Ketten,
    Innenseiten der Glieder); danach 7.334 Vertices. Eine Fläche bleibt, sobald ein Strahl von
    ihr ins Freie geht, auch durch die Lücke zwischen zwei Gliedern. Die Kamera hat keine
    Grenze nach unten (nur Abstand 5 bis 2.000 m); die −10° decken eine Kamera knapp unter dem
    Modell ab, etwa am Hang.
  - `decimate_materials`: die fast schwarzen Laufräder (`Wheels`) auf 20 %, die Kettenglieder
    auf 50 % der Dreiecke; Wanne, Turm und Rohr bleiben. In der flachen Seitenansicht wirken
    die Glieder dünner als ohne Decimate, von schräg oben kaum. Laufräder 30 % und Glieder
    40 % (4.874) zeigten die Glieder von der Seite als Striche; 10 % und 60 % (4.927) ließen
    die Laufräder verschwinden, ohne dass die Glieder besser aussahen; 15 % und 60 % ergaben
    5.046.
  - `root`: Rohr nach +z gedreht, auf Meter skaliert (0,45), Grundfläche mittig auf dem
    Ursprung, tiefster Punkt darauf. Im Spiel 4,7 m breit, 3,0 m hoch und 6,6 m lang (der
    alte 3,7 × 3,2 × 9,2 m mit Rohrüberstand); `scale` 1, `headingOffset` 0, `heightOffset` 0.
  - `paint` (`weathered_paint`, nach Playtest 735: „Textur könnte moderner sein“): neue UVs
    und eine im Skript erzeugte 1024²-Basisfarbe (JPEG, ohne Bildquellen) statt der sechs
    flachen Materialfarben. Tarnflecken in zwei Tönen auf Wanne und Turm (30 % braun, 18 %
    schwarzgrün, 3D-Rauschen mit rund 1 m großen Flecken), heller Abrieb an konvexen Kanten
    über 35° bis 2 cm breit (Wanne, Turm, Details, Rohr; auf den kleinen Kettengliedern hätte
    er das ganze Glied bedeckt), Laufspuren an steilen Flächen, Staub bis 1,2 m über dem
    Boden, Umgebungsverdeckung an den Dreiecksecken. Jedes Material behält die mittlere
    Helligkeit seiner flachen Farbe (Wanne im Mittel sRGB 0,54, vorher 0,55; ohne Ausgleich
    0,41). Danach ein Material; die UV-Nähte kosten 28 VAT-Vertices (4.904 → 4.932).
    Geprüft mit EEVEE-Renders vorher und nachher, nicht im Spiel.

  Die untere Kettenbahn läuft 0,81 m pro Clip-Sekunde, mit `animationSpeed` 3,72 laufen die
  Ketten bei 3 m/s mit dem Boden. Der Loop ist nahtlos: Nach 0,79 s steht jedes Glied auf dem
  Platz des nächsten, die Vertex-Mengen von Anfang und Ende liegen p99 0,3 mm auseinander
  (einzelne Vertices bis 12 cm, weil die decimierten Glieder nicht mehr gleich geformt sind).
  Einen Todes-Clip hat das Modell nicht: Beim Kill spielt der Renderer den Fahr-Clip einmal ab
  Frame 0 und hält den letzten (rund 0,2 s bei 3,72), wie beim Mech. `lateralSpread` 0,85 →
  0,7, damit der breitere Tank auf einer 10-m-Straße so weit vom Rand bleibt wie der alte.
- **Ghost** 5.248 → **4.270**, VAT 4,2 → 3,4 MB, 2,5 → 2,4 MB Datei, `ghost_surge` 2,0 →
  1,8 Mio.: Die Schleier (Material_26, Opacity 0,403, Textur-Alpha überall 1) sind 77
  zusammenhängende Stücke unter einem doppelseitigen, blendenden Material, und jedes Stück
  wiederholt ein anderes Fläche für Fläche an denselben Positionen mit umgekehrter Windung.
  `single_layer` entfernt je Paar das spätere Stück ganz (1.299 Dreiecke, 978 Vertices) und
  setzt die Opacity auf 1 − (1 − 0,403)² = 0,644, das Ergebnis beider Lagen zusammen; bei
  gleicher Farbe und Textur-Alpha 1 gibt das dieselbe Farbe. Flächenweise entfernt (die erste
  jedes Paars bleibt) sparte es nur 292 Vertices, weil die erste Fläche mal im einen, mal im
  anderen Stück lag und beide Stücke Vertices behielten. Vergleich über `Take 001`:
  Bounding-Box und jede Position gleich (0,00 %), der
  Schwerpunkt liegt 1,01 % daneben, weil eine Lage fehlt. Körper, Normalen und Texturen
  bleiben. Über dem Normal-Richtwert bleibt der Walk-Loop mit 105 Frames (Richtwert 60, siehe
  Runde vom 2026-09-14); das kostet VAT-Speicher, keine Last pro Frame.
- **Mech** 5.416 → **4.771**, VAT 1,7 → 1,5 MB, 0,6 MB Datei: Decimate 12 % → 10 % (2.877
  statt 3.457 Dreiecke), sonst dasselbe Rezept; 11 % ergaben 5.082, 10,5 % 5.003. Vergleich
  mit dem Original (`39fbb18`) über den Walk-Clip: Bounding-Box höchstens 1,2 % verschieden
  wie vorher, jeder neue Vertex im Mittel 0,32 % (vorher 0,28 %), p99 1,94 % (vorher 1,32 %)
  vom nächsten alten. Im Render sieht er aus wie mit 12 %, Kleinteile am Rücken sind etwas
  gröber.

### Ausgangslage (2026-09-12)

Die folgenden Abschnitte sind die Empfehlungen vor der Runde, mit den damaligen Zahlen.
Reihenfolge nach Wirkung auf die teuersten Wellen. Die Decimate-Anteile waren Startwerte für
Blender. Die VAT-MB-Angaben rechnen noch mit RGBA32F (vor 2026-09-13); mit RGBA16F ist es
jeweils die Hälfte, außer beim Stone Golem.

### 1. Hornet: 69.297 VAT-Vertices, Ziel ≤ 5.000

- 122.736 Dreiecke in 16 starren Meshes, animiert über Node-Transforms (Objekt-Anim.-Pfad).
- Decimate je Teil auf etwa 7 %. Starre Teile, die am selben animierten Node hängen, zu
  einem Mesh zusammenfassen; die Flügel bleiben eigene Meshes, weil die Objekt-Animation
  Meshes bewegt und keine Knochen.
- Wirkung: `hornet_strike` 14,9 → rund 1,4 Mio. (Bat unverändert), VAT 66,4 → rund 4,5 MB.

### 2. Zombie v2: 31.342 VAT-Vertices, Ziel ≤ 5.000

- 30.887 Dreiecke. UV-Nähte trennen fast jede Kante: 15.418 Positionen, aber 30.999
  Kombinationen aus Position und UV. Welding bringt deshalb nichts. Erst Decimate auf etwa
  16 %, besser Retopologie mit neuer Abwicklung und gebackener Textur.
- Soll zombie-v2 in `zombie_horde` mehr als die heutigen 10 % stellen, gilt das
  Swarm-Budget (≤ 1.500).
- Die beiden Todes-Clips sind auf die sichtbaren 2 s gekürzt (je 61 Frames). Seit dem
  Playtest vom 2026-09-15 laufen alle Todes-Clips von zombie-v2 ganz (`deathDuration` 3000),
  `Dead` fiel nach 2 s noch.
  `Electrocuted_Fall` (6,33 s) ist nicht mehr im Pool: Die Hüfte des Clips bleibt bis 3,0 s
  auf Standhöhe, der Sturz beginnt bei etwa 3,25 s und endet bei etwa 5 s. Der Gegner
  verschwand also zuckend im Stehen (aus den Keyframes gelesen, nicht im Browser gesehen).
  Soll die Variante zurück, den Sturz in Blender herausschneiden (etwa 3,0 bis 5,0 s).
  So geschehen in der Runde vom 2026-09-13, der Clip ist wieder im Pool (siehe Zombie v2 oben).
- Wirkung: VAT 105,5 → rund 16 MB (5.000 Vertices), `zombie_horde` 14,4 → 9,1 Mio. (das
  alte Zombie bleibt der größere Posten, siehe Nr. 6).
- Das Backup `zombie_v2.original.glb.bak`, auf das die TODO verweist, liegt nicht im
  Hauptcheckout.

### 3. Rat: 2.150 VAT-Vertices, Ziel ≤ 1.000

- Wenig pro Instanz, aber bis zu 5.000 pro Welle.
- Decimate auf etwa 47 %. Die Textur 1024² reicht bei der Bildschirmgröße einer Ratte auch
  als 512²; das GLB enthält zudem drei 1024²-Bilder, von denen der Shader eines nutzt.
- Wirkung: `rat_tide` 10,8 → 5,0 Mio.

### 4. Spider: 13.173 VAT-Vertices, Ziel ≤ 1.500

- 21.128 Dreiecke in zwei Meshes (Körper 12.833, Anhängsel 340), bis zu 800 pro Welle.
- Decimate auf etwa 11 %. Die 113 Knochen kosten mit VAT nur Bake-Zeit.
- Wirkung: `spider_swarm` 10,5 → 1,2 Mio.

### 5. Wraith: 30.228 VAT-Vertices, Ziel ≤ 5.000

- 39.986 Dreiecke; wie bei zombie_v2 an UV-Nähten gespalten (Position + UV = 30.226).
- Decimate auf etwa 17 %, besser Retopologie mit neuer Abwicklung.
- Wirkung: `wraith_storm` 9,1 → 1,5 Mio.

### 6. Zombie: 4.525 VAT-Vertices, Ziel ≤ 1.500

- Nur 2.157 Dreiecke, aber facettiert: Jeder Vertex ist an den Normalen gespalten. Mit
  geglätteten Normalen bleiben 1.453 Vertices (−68 %), ganz ohne Decimate. Der Look ändert
  sich dabei von facettiert zu glatt, das ist eine Designentscheidung.
- Wirkung: `zombie_horde` (1.800 Zombies) 8,1 → 2,6 Mio. für den Zombie-Anteil.

### 7. Mech: 42.455 VAT-Vertices, Ziel ≤ 5.000

- 28.850 Dreiecke in 34 starren Meshes (Objekt-Anim.-Pfad; die 62 Knochen im GLB skinnen
  nichts). Harte Kanten spalten viel (Position + UV = 28.395), der Haupthebel ist aber
  Decimate auf etwa 12 %.
- Wirkung: `mech_army` 4,2 → 0,5 Mio.

### 8. Wallsmasher: 17.010 VAT-Vertices, Ziel ≤ 5.000 (ohne Decimate erreichbar)

- FBXLoader lädt nicht indiziert, drei Vertices pro Dreieck. Indiziert wären es 3.444
  Vertices (−80 %) bei gleichem Aussehen.
- In Blender importieren, nur Walk, Run und Death behalten (heute 14 Clips) und als GLB
  exportieren. Danach Clip-Namen prüfen (die Config erwartet `CharacterArmature|Walk`,
  `|Run`, `|Death`) und `scale`/`headingOffset` nachziehen, weil sich die Einheiten ändern.
- Wirkung: `wallsmasher_crew` 3,4 → 0,7 Mio., `light_mix` 6,0 → 3,3 Mio. (Spider
  unverändert), VAT 38,6 → rund 5,4 MB.

### 9. Dragon: VAT 98,5 MB

- 12.267 Vertices liegen im Elite-Budget. Teuer ist der Clip `flying` mit 13,13 s
  (394 Frames). Einen Flügelschlag-Zyklus als Loop herausschneiden; bei 1,5 s wären es rund
  11 MB. Die 220 Knochen kosten nur Bake-Zeit.
- Über die Clip-Wahl geht es nicht: Das Modell hat nur `idle` (12,43 s), `running`
  (9,97 s) und `flying`. Der Loop muss in Blender geschnitten werden.

### 10. Stone Golem: VAT 43,0 MB

- 13.614 Vertices, im Elite-Budget. Diffuse 2048² auf 1024² senken, `Casual_Walk` (4,17 s,
  125 Frames) auf einen kürzeren Loop kürzen. Unter 8.192 Vertices entfiele die zweite
  VAT-Zeile pro Frame.
- Einziger Typ mit RGBA32F: Die Bounding-Box seiner gebackenen Frames ist in x rund 21,6 m
  breit, der Half-Fehler liegt bei 2,64 mm. Bis rund 16,4 m je Achse wäre es RGBA16F (halber
  Speicher).

### 11. Bat: 3.559 VAT-Vertices, Ziel ≤ 1.500

- Bis zu 600 pro Welle. UV-Nähte (1.345 Positionen). Das GLB (5,5 MB) enthält drei
  2048²-Bilder; eine Diffuse mit 512² reicht.
- Wirkung: `bat_swarm` 2,1 → 0,9 Mio.

### Übrige

Penguin (1.993, Swarm), Ghost (5.245), Mammoth (5.541) und Tank (5.094) liegen knapp über
ihrem Budget, ihre Wellen aber unter 1,5 Mio. Herbert hat 30.831 Vertices, kommt aber
höchstens dreimal pro Welle. Bear und Zombie Soldier liegen im Budget.

## Stellschrauben ohne Modelländerung

Die Config hat keine VAT-Stellschraube pro Typ; Bake-fps und VAT-Breite sind Konstanten in
`vat-clips.ts` (`DEFAULT_BAKE_FPS`) und `vat-encoding.ts` (`MAX_VAT_WIDTH`). In der Config lassen sich nur Clips weglassen; das spart Speicher und
Bake-Zeit, keine Frame-Zeit. Die Swarm-Gegner mit der größten Vertex-Last (Ratte, Spinne)
backen je nur einen Clip mit 11 bzw. 25 Frames, da gibt es nichts wegzulassen.

Code-seitig umgesetzt (2026-09-12):

- **Nur zeigbare Frames backen**: `vatClips` kappt Todes-Clips bei
  `deathAnimationDuration × animationSpeed`. Idle wird nicht mehr gebacken; das Config-Feld
  `idleAnimation` und der Idle-Knopf im Debug-Fenster sind entfernt, denn Idle lief nur dort.
  VAT 664,6 → 516,1 MB.
- **`Electrocuted_Fall` aus dem zombie-v2-Pool**: Der Sturz käme erst nach dem Entfernen
  (siehe Nr. 2). −61 Frames, −30,5 MB, VAT gesamt 485,6 MB. Seit der Runde vom 2026-09-13
  ist der Clip auf den Sturz geschnitten wieder im Pool.

Code-seitig umgesetzt (2026-09-13):

- **VAT als RGBA16F** (`vatEncoding` in `vat-encoding.ts`): Positionen relativ zur
  Bounding-Box, je Typ RGBA16F, wenn der Rundungsfehler im Spiel höchstens 2 mm beträgt,
  sonst RGBA32F. VAT gesamt 486,6 → 264,7 MB, halb so viele Bytes pro VAT-Zugriff. RGBA32F
  bleibt nur der Stone Golem (2,64 mm). Begründung der 2 mm in
  [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md#texelformat-rgba16f-oder-rgba32f).
- **Opake VAT-Materialien** (`vatAlpha` in `vat-surface.ts`): Transparent sind nur noch Typen,
  deren Materialien Alpha brauchen. Bear (Alpha in der Textur), Ghost und Hornet (Opacity
  unter 1, beim Hornet die Flügel) blenden, Dragon schneidet mit `alphaTest` 0,5 aus
  (glTF MASK), die übrigen Typen zeichnen opak (Liste unter [Alpha](#alpha)). `aOpacity` ist entfernt, es war immer 1.
  Ob opak messbar schneller ist, ist nicht gemessen. Vorher verwarf der Shader bei jedem Typ
  Texel unter Alpha 0,05, opake Typen zeichnen sie jetzt deckend (wie three.js bei glTF
  OPAQUE). Keiner der ausgelieferten opaken Typen hat solche Texel in seiner Basisfarbe; der
  Generator prüft das (Tabelle „Alpha“ unter [Messwerte](#messwerte)).
- **Kein doppelter Loop-Frame** (`vatFrameCount`): Die Loader lesen Key-Zeiten als float32,
  `ceil(Dauer × fps)` zählte deshalb bei sechs Loop-Clips einen Frame zu viel, der die
  Startpose ein zweites Mal zeigte (Mech Walk, Wallsmasher Walk und Run, Mammoth Walk,
  Zombie Soldier Run, Bear Walk). Jetzt mit 0,001 Frames Toleranz. Todes-Clips, die vor dem
  Entfernen enden, haben ihre Endpose als letzten Frame (Wallsmasher Death +1). VAT gesamt
  264,7 → 264,0 MB.
- **VAT nur noch auf der GPU**: Nach dem Upload gibt der Pool die CPU-Kopie frei, so viel
  weniger im Speicher des Tabs, wie die VATs belegen. Nach einem WebGL-Context-Loss backt der Renderer die Typen
  neu ([INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md#cpu-kopie-und-context-loss)).

## Neue Gegner: Skeleton (Swarm)

Budget: ≤ 1.500 VAT-Vertices, Diffuse ≤ 512². Kandidaten mit Lizenz und Quelle in
[`public/assets/models/enemies/candidates/LICENSES.md`](../public/assets/models/enemies/candidates/LICENSES.md):

- **KayKit Skeleton_Minion** (CC0): 4.858 Vertices, 5.288 Dreiecke, 9 geskinnte Meshes,
  41 Knochen, Walk-, Run- und drei Todes-Clips. Umhang (344) und Augen (80) entfernen, den
  Rest auf etwa 35 % decimaten, nur die benötigten der 95 Clips behalten. Der Skeleton_Warrior
  aus demselben Paket hat einen ungeskinnten Helm, den `bakeVAT` weglassen würde.
- **Kenney character-skeleton** (CC0): 1.156 Vertices, 658 Dreiecke, sechs starre Teile mit
  Node-Animation, läuft über `bakeObjectAnimVAT` und liegt ohne Umbau im Budget. Blockiger
  Stil, `die` dauert nur 0,33 s.

Umgesetzt mit dem Kenney-Modell (2026-09-12). Seit dem Split (2026-09-13) hinterlässt jedes
getötete Skeleton zwei `skeleton-minion`: dasselbe Modell bei 0,6 der Größe in einem eigenen
VAT-Pool (+0,2 MB als RGBA16F). Ein Skeleton bringt damit drei Körper, `skeleton_swarm` ging deshalb von
höchstens 1.500 auf 940 Skeletons (2.820 Körper, 3,3 Mio. VAT-Vertices; ungekürzt wären es
5,2 Mio. gewesen). Die Tabellen zählen die Minions, als lebten alle Körper gleichzeitig;
tatsächlich entstehen sie erst beim Tod ihres Skeletons.

## Modelle außerhalb der Tabellen

Nicht in der Gegner-Config, deshalb nicht in den Tabellen unten; von Hand gemessen mit
`model-inspect.ts`.

- **Held** (`public/assets/models/hero/mercenary.glb`, `tools/blender/hero_mercenary.py`,
  Lizenz in `public/assets/models/hero/LICENSES.md`): 14.665 Vertices, 7.892 Dreiecke,
  62 Knochen, keine Texturen, 1,1 MB. Eine Einheit auf dem Feld, kein VAT; das Budget für
  eine einzelne Einheit (≤ 10.000 Dreiecke, Texturen ≤ 1024²) hält es ein. Höhe 1,82
  Modelleinheiten, Blick nach +z. Der Knoten `Muzzle` hängt am Handknochen `Wrist.R`
  (three.js: `WristR`) an der Mündung.

## Boss-Variante: Skarnax (Wurm)

Modelle: `worm_head.glb`, `worm_segment.glb` und `worm_tail.glb`
(`tools/blender/worm_boss.py`, eigenes Werk ohne fremde Quellen), geskinnte Meshes mit
starren Teilen (ein Knochen je Bein, Mandibel, Fühler und Cercus, Gewicht 1) und je einem
Clip (Kopf `Jaws`, 48 Frames; Ring und Schwanz `Crawl`, 32 Frames), je eine Basisfarbe
(JPEG; Kopf 1024², Ring und Schwanz 512²), aus Vertexfarben, einer Chitin-Maserung und einer
Umgebungsverdeckung gebacken; der VAT-Pfad liest Textur oder Materialfarbe, keine
Vertexfarben. Blick nach +z, Pivot am Boden unter der Ringmitte, Kettenabstand 1,0
Modelleinheiten (Segment z −0,58 bis 0,52, Schwanz bis −2,70, Breite mit Beinen 2,88, Höhe
1,78); im Spiel Skala 2,5.

Der Wurm (`worm`, `worm-segment`, `worm-tail`) steht in keinem Template, die Tabellen führen
ihn deshalb „in keiner Welle“. Er kommt über die Boss-Rotation ab W35
(`configs/boss-variants.config.ts`), einer pro Varianten-Welle, dazu über Custom Wave und Enemy
Debug. Ein Wurm hat höchstens `WORM_MAX_SEGMENTS` = 240 Segmente: ein Kopf aus dem Pool `worm`
(1.700 VAT-Vertices), das letzte aus `worm-tail` (1.214), der Rest aus `worm-segment` (634);
jeder Split macht ein Körpersegment zum Kopf und eines zum Schwanz. Bei 240 lebenden Segmenten
sind das rund 0,15 Mio. VAT-Vertices, gut 3 % des Richtwerts von 5 Mio.; auch mit einem Kopf
und einem Schwanz je Teil nach mehreren Splits bleibt es in dieser Größe. Die drei VATs
belegen zusammen etwa 1,1 MB (RGBA16F: 1.700 × 48, 1.214 × 32 und 634 × 32 Texel).

## Werkzeug

- `npm run model-budget` schreibt die Tabellen zwischen den Markern unten; der Test läuft
  auch bei `npm test`.
- `tools/model-budget/model-inspect.ts` liest GLB, glTF und binäres FBX ohne Abhängigkeit
  (FBX-Arrays über `node:zlib`). Meshes und Vertices zählt es so, wie GLTFLoader und
  FBXLoader sie erzeugen; die Clip-Dauer ist die letzte Keyframe-Zeit, als float32 wie in
  den Loadern.
- `tools/model-budget/generate.spec.ts` wählt den Bake-Pfad wie
  `InstancedEnemyRenderer.bakeAndCreatePool` und rechnet Clips und VAT-Maße mit
  `vatClips`, `vatFrameCount` (`vat-clips.ts`) und `vatLayout` (`vat-encoding.ts`). Der Test schlägt fehl,
  wenn ein Typ nicht backbar ist oder ein konfigurierter Clip im Modell fehlt.
- Für Format, Half-Fehler und Alpha-Modus lädt `generate.spec.ts` jedes Modell zusätzlich
  mit GLTFLoader und backt es mit `bakeEnemyVAT` wie das Spiel. Von den Texturen kommen nur
  die PNG-Basisfarben mit, dekodiert in Node (`decodePng` in `model-inspect.ts`), damit
  `vatAlpha` ihr Alpha liest wie im Spiel. Weicht die aus der Datei geplante VAT-Größe von
  der gebackenen ab, schlägt der Test fehl.
- `tools/blender/optimize_enemy.py` hält ein Rezept je geändertem Modell (Clips behalten und
  schneiden, schweißen, decimaten mit oder ohne Nahtgewicht oder nur einzelne Materialien,
  neu backen, Normalen, nur Basisfarbe, Bildgröße, Ruhepose aus der Datei, alles in einen
  Skin, Vertexfarben weg, verdeckte Flächen weg, gespiegelte Doppellagen weg, Anstrich mit
  Tarnung, Kantenabrieb und Staub backen, Wurzel drehen und skalieren). Headless:
  `blender --background --python tools/blender/optimize_enemy.py -- rat`; liest das Original
  aus Git (mit `rev: None` aus dem Arbeitsbaum, so beim Tank) und schreibt nach
  `public/assets/models/enemies/`. Der Rebake-Schritt braucht kein Cycles und lief headless
  (Blender 5.1.2).
- Vergleich vorher/nachher ohne Browser (Node 24, aus dem Repo-Wurzelverzeichnis):
  `node tools/model-budget/bake-compare.mjs alt.glb neu.glb --clips Walk --death Die` backt
  beide GLBs wie der Baker und meldet Abweichung pro Frame in Prozent der Modellhöhe;
  `loop-find.mjs` sucht nahtlose Loop-Fenster in einem Clip, `clip-trace.mjs` zeigt den
  Höhenverlauf eines Clips, `glb-summary.mjs` listet Materialien, Bilder und Clips aus dem
  GLB-JSON.
- Ein Modell ohne Config-Eintrag prüfen (Node 24):
  `node -e "import('./tools/model-budget/model-inspect.ts').then((m) => console.dir(m.inspectModel('pfad/zum/modell.glb'), { depth: 3 }))"`
- Grenzen: kein ASCII-FBX. Bei Draco oder Meshopt stimmen die Vertexzahlen, die
  Weld-Spalte nicht. Morph-Targets werden gezählt, der Baker ignoriert sie. Basisfarben als
  WebP, KTX2 oder interlaced PNG dekodiert der Generator nicht; `vatAlpha` zählt sie dort
  als transparent, im Spiel liest es sie über ein Canvas.

## Messwerte

<!-- model-budget:begin -->

### Laufzeitkosten pro Gegner

Sortiert nach VAT-Vertices pro Instanz. „max./Welle“ ist Anteil × Obergrenze von
`countRange` über alle Templates, vor dem Fairness-Gate, das die meisten Wellen kleiner
macht; was ein Kill abspaltet (`splitOnDeath`), zählt mit. „Mio. Vertices“ = VAT-Vertices ×
max./Welle, also die Vertex-Shader-Last, wenn alle Gegner der größten Welle gleichzeitig
leben. Für abgespaltene Gegner ist das eine Obergrenze: Sie entstehen erst, wenn der
Gegner stirbt, der sie abspaltet. „Half-Fehler“ ist der größte Fehler, den
RGBA16F einer Position im Spiel zufügt (`vatEncoding` in `vat-encoding.ts`, aus den gebackenen
Positionen). Bis 2 mm ist die VAT RGBA16F (8 Byte pro Texel), darüber RGBA32F (16 Byte).

| Gegner | Klasse | max./Welle | VAT-Vertices | Dreiecke | Mio. Vertices | Bake-Pfad | VAT-Frames | VAT-Textur | Format | Half-Fehler mm | VAT-MB | Diffuse |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: | ---: | ---: |
| Herbert (`herbert`) | Elite/Boss | 3 | 30.831 | 31.949 | 0,1 | Skinning | 32 | 8192×128 | RGBA16F | 0,56 | 8,0 | 512² |
| Stone Golem (`stone-golem`) | Elite/Boss | 60 | 13.614 | 10.368 | 0,8 | Skinning | 107 | 8192×214 | RGBA32F | 2,64 | 26,8 | 1024² |
| Dragon (`dragon`) | Elite/Boss | 60 | 12.272 | 19.541 | 0,7 | Skinning | 99 | 8192×198 | RGBA16F | 1,78 | 12,4 | 1024² |
| Wraith (`wraith`) | Normal | 300 | 8.126 | 6.790 | 2,4 | Skinning | 15 | 8126×15 | RGBA16F | 0,47 | 0,9 | 1024² |
| Mammoth (`mammoth`) | Normal | 150 | 5.557 | 8.685 | 0,8 | Skinning | 321 | 5557×321 | RGBA16F | 1,51 | 13,6 | 1024² |
| Tank (`tank`) | Normal | 150 | 4.932 | 2.705 | 0,7 | Skinning | 24 | 4932×24 | RGBA16F | 0,82 | 0,9 | 1024² |
| Hornet (`hornet`) | Normal | 210 | 4.915 | 6.440 | 1,0 | Objekt-Anim. | 59 | 4915×59 | RGBA16F | 0,35 | 2,2 | 1024² |
| Zombie v2 (`zombie-v2`) | Normal | 200 | 4.870 | 3.704 | 1,0 | Skinning | 306 | 4870×306 | RGBA16F | 1,08 | 11,4 | 1024² |
| Mech (`mech`) | Normal | 100 | 4.771 | 2.877 | 0,5 | Skinning | 40 | 4771×40 | RGBA16F | 1,44 | 1,5 | 1024² |
| Ghost (`ghost`) | Normal | 280 | 4.270 | 6.474 | 1,2 | Skinning | 105 | 4270×105 | RGBA16F | 0,46 | 3,4 | 1024² |
| Zombie Soldier (`zombie-soldier`) | Elite/Boss | 60 | 4.266 | 7.176 | 0,3 | Skinning | 160 | 4266×160 | RGBA16F | 0,84 | 5,2 | 1024² |
| Bear (`bear`) | Normal | 120 | 4.083 | 6.135 | 0,5 | Skinning | 41 | 4083×41 | RGBA16F | 0,74 | 1,3 | 1024² |
| Bat (`bat`) | Swarm | 600 | 3.559 | 2.684 | 2,1 | Skinning | 50 | 3559×50 | RGBA16F | 0,96 | 1,4 | 512² |
| Wallsmasher (`wallsmasher`) | Normal | 200 | 3.444 | 5.670 | 0,7 | Skinning | 104 | 3444×104 | RGBA16F | 1,28 | 2,7 | 512² |
| Spider (`spider`) | Swarm | 800 | 2.140 | 2.417 | 1,7 | Skinning | 25 | 2140×25 | RGBA16F | 0,56 | 0,4 | 512² |
| Penguin (`penguin`) | Swarm | 450 | 1.993 | 3.408 | 0,9 | Skinning | 87 | 1993×87 | RGBA16F | 0,42 | 1,3 | 512² |
| Skarnax (`worm`) | in keiner Welle | 0 | 1.700 | 1.662 | 0,0 | Skinning | 48 | 1700×48 | RGBA16F | 0,93 | 0,6 | 1024² |
| Zombie (`zombie`) | Swarm | 1.800 | 1.453 | 2.157 | 2,6 | Skinning | 209 | 1453×209 | RGBA16F | 0,83 | 2,3 | 1024² |
| Skarnax Tail (`worm-tail`) | in keiner Welle | 0 | 1.214 | 1.214 | 0,0 | Skinning | 32 | 1214×32 | RGBA16F | 1,05 | 0,3 | 512² |
| Skeleton (`skeleton`) | Swarm | 940 | 1.156 | 658 | 1,1 | Objekt-Anim. | 26 | 1156×26 | RGBA16F | 0,51 | 0,2 | 512² |
| Skeleton Minion (`skeleton-minion`) | Swarm | 1.880 | 1.156 | 658 | 2,2 | Objekt-Anim. | 26 | 1156×26 | RGBA16F | 0,31 | 0,2 | 512² |
| Rat (`rat`) | Swarm | 5.000 | 999 | 1.529 | 5,0 | Skinning | 11 | 999×11 | RGBA16F | 0,26 | 0,1 | 512² |
| Skarnax Segment (`worm-segment`) | in keiner Welle | 0 | 634 | 556 | 0,0 | Skinning | 32 | 634×32 | RGBA16F | 0,95 | 0,2 | 512² |
| Ooze (`ooze`) | in keiner Welle | 0 | 282 | 504 | 0,0 | Objekt-Anim. | 24 | 282×24 | RGBA16F | 0,50 | 0,1 | – |
| Slime Clump (`slime-clump`) | in keiner Welle | 0 | 282 | 504 | 0,0 | Objekt-Anim. | 38 | 282×38 | RGBA16F | 0,47 | 0,1 | – |

VAT-Speicher aller Typen zusammen: **97,4 MB** (30 fps), alles in RGBA32F wären **168,0 MB**.
Todes-Clips sind auf den sichtbaren Teil gekürzt; ganz gebacken kämen **0,4 MB** dazu.

### Alpha

Wie der VAT-Shader Alpha behandelt (`vatAlpha` in `vat-surface.ts`, aus den Materialien der
gebackenen Meshes und dem Alpha ihrer Basisfarb-Texturen): opak ignoriert Alpha, Maske verwirft
unter dem Cutoff, Blend ist transparent und verwirft unter 0,05. „Texel unter 0,05“ zählt in den
Basisfarb-Texturen der gebackenen Meshes alle Texel mit Alpha darunter, auch solche, die kein UV
trifft; JPEG hat kein Alpha. Die Tabelle nennt die Typen, die nicht opak sind oder solche Texel haben.

| Gegner | Alpha | Texel unter 0,05 |
| --- | --- | ---: |
| Dragon | Maske 0,50 | 80.170 (7,6 %) |
| Hornet | Blend | 0 |
| Ghost | Blend | 0 |
| Bear | Blend | 33.852 (3,2 %) |

Opak ohne Texel unter 0,05 (21): Herbert, Stone Golem, Wraith, Mammoth, Tank, Zombie v2, Mech, Zombie Soldier, Bat, Wallsmasher, Spider, Penguin, Skarnax, Zombie, Skarnax Tail, Skeleton, Skeleton Minion, Rat, Skarnax Segment, Ooze, Slime Clump.
Texel unter 0,05, die der Shader deckend zeichnet (opak oder Maske mit Cutoff bis 0,05): **keine**.

### Modellinhalt

„Weld“ zählt die gebackenen Meshes: Vertices indiziert / nach Glätten der Normalen
(Position + UV) / nur Positionen. Liegt „indiziert“ unter den VAT-Vertices, lädt der
Loader das Modell nicht indiziert (FBX) oder das Modell enthält doppelte Vertices.

| Gegner | Datei | MB | Meshes (skinned) | Knochen | Morph | Materialien | Bilder im Modell | Clips | Weld |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| Herbert | `herbert_optimized.glb` | 2,1 | 1 (1) | 24 | 0 | 1 | 512² | 1 | 30.831 / 30.208 / 26.048 |
| Stone Golem | `stone_golem.glb` | 3,1 | 1 (1) | 24 | 0 | 1 | 1024² | 2 | 13.612 / 13.415 / 5.205 |
| Dragon | `dragon.glb` | 5,9 | 1 (1) | 220 | 0 | 1 | 4× 1024² | 1 | 12.082 / 11.868 / 10.208 |
| Wraith | `wraith.glb` | 1,8 | 1 (1) | 25 | 0 | 1 | 1024² | 1 | 8.126 / 8.126 / 3.268 |
| Mammoth | `mammoth.glb` | 2,6 | 1 (1) | 43 | 0 | 1 | 2× 1024² | 2 | 5.557 / 5.541 / 5.121 |
| Tank | `tank.glb` | 0,5 | 1 (1) | 45 | 0 | 1 | 1024² | 1 | 4.932 / 4.893 / 2.439 |
| Hornet | `hornet.glb` | 1,1 | 16 (0) | 0 | 0 | 4 | 512², 2× 1024² | 1 | 4.915 / 4.913 / 3.370 |
| Zombie v2 | `zombie_v2.glb` | 1,9 | 1 (1) | 24 | 0 | 1 | 1024² | 4 | 4.870 / 4.870 / 1.827 |
| Mech | `mech.glb` | 0,6 | 1 (1) | 62 | 0 | 1 | 1024² | 1 | 4.771 / 4.300 / 1.723 |
| Ghost | `ghost.glb` | 2,4 | 2 (2) | 26 | 0 | 2 | 3× 1024² | 1 | 4.270 / 3.894 / 3.467 |
| Zombie Soldier | `zombie_soldier.glb` | 3,5 | 1 (1) | 56 | 0 | 1 | 3× 1024² | 6 | 4.249 / 4.249 / 3.603 |
| Bear | `bear.glb` | 2,0 | 1 (1) | 36 | 0 | 1 | 1024², 512² | 1 | 4.083 / 3.838 / 3.243 |
| Bat | `bat.glb` | 0,3 | 1 (1) | 28 | 0 | 1 | 512² | 1 | 3.559 / 3.559 / 2.520 |
| Wallsmasher | `wallsmasher.glb` | 0,4 | 1 (1) | 61 | 0 | 1 | 512² | 3 | 3.444 / 3.025 / 2.956 |
| Spider | `spider.glb` | 0,6 | 2 (2) | 113 | 0 | 2 | 512² | 1 | 2.140 / 2.133 / 1.716 |
| Penguin | `penguin.glb` | 0,3 | 1 (1) | 21 | 0 | 1 | 512² | 2 | 1.993 / 1.993 / 1.723 |
| Skarnax | `worm_head.glb` | 0,2 | 1 (1) | 5 | 0 | 1 | 1024² | 1 | 1.700 / 1.627 / 873 |
| Zombie | `zombie.glb` | 1,8 | 1 (1) | 49 | 0 | 1 | 1024² | 13 | 1.453 / 1.453 / 1.086 |
| Skarnax Tail | `worm_tail.glb` | 0,1 | 1 (1) | 7 | 0 | 1 | 512² | 1 | 1.214 / 1.137 / 633 |
| Skeleton | `skeleton.glb` | 0,2 | 6 (0) | 0 | 0 | 1 | 512² | 32 | 737 / 363 / 347 |
| Skeleton Minion | `skeleton.glb` | 0,2 | 6 (0) | 0 | 0 | 1 | 512² | 32 | 737 / 363 / 347 |
| Rat | `rat.glb` | 0,2 | 1 (1) | 21 | 0 | 1 | 512² | 1 | 999 / 999 / 767 |
| Skarnax Segment | `worm_segment.glb` | 0,1 | 1 (1) | 5 | 0 | 1 | 512² | 1 | 634 / 580 / 296 |
| Ooze | `slime.glb` | 0,0 | 2 (0) | 0 | 0 | 2 | – | 2 | 282 / 282 / 282 |
| Slime Clump | `slime.glb` | 0,0 | 2 (0) | 0 | 0 | 2 | – | 2 | 282 / 282 / 282 |

### Gebackene Clips

Todes-Clips laufen mit `animationSpeed`, bis der Gegner nach `deathDuration` (Standard 2.000 ms)
entfernt wird. Gebacken wird nur dieser Teil (`vatClips` in `vat-clips.ts`), „gekürzt“ zählt
die weggelassenen Frames.

| Gegner | Clip | Rolle | Dauer s | Frames | gekürzt |
| --- | --- | --- | ---: | ---: | ---: |
| Herbert | `Armature\|walking_man\|baselayer` | walk | 1,04 | 32 | – |
| Stone Golem | `Casual_Walk` | walk | 1,33 | 40 | – |
| Stone Golem | `dying_backwards` | death | 2,21 | 67 | – |
| Dragon | `flying` | walk | 3,30 | 99 | – |
| Wraith | `Armature\|RunFast\|baselayer` | walk | 0,50 | 15 | – |
| Mammoth | `Walk` | walk | 4,97 | 149 | – |
| Mammoth | `Die` | death | 6,00 | 172 | 9 |
| Tank | `TankArmature\|Tank_Forward` | walk | 0,79 | 24 | – |
| Hornet | `Take 001` | walk | 1,96 | 59 | – |
| Zombie v2 | `Unsteady_Walk` | walk | 2,96 | 89 | – |
| Zombie v2 | `Dead` | death | 2,96 | 89 | – |
| Zombie v2 | `dying_backwards` | death | 2,21 | 67 | – |
| Zombie v2 | `Electrocuted_Fall` | death | 2,00 | 61 | – |
| Mech | `Armature\|Walk` | walk | 1,33 | 40 | – |
| Ghost | `Take 001` | walk | 3,50 | 105 | – |
| Zombie Soldier | `zombie_02_Run` | walk | 0,80 | 24 | – |
| Zombie Soldier | `zombie_02_Death` | death | 4,50 | 136 | – |
| Bear | `GltfAnimation 0` | walk | 1,37 | 41 | – |
| Bat | `fly.001` | walk | 1,67 | 50 | – |
| Wallsmasher | `CharacterArmature\|Walk` | walk | 1,33 | 40 | – |
| Wallsmasher | `CharacterArmature\|Run` | run | 0,80 | 24 | – |
| Wallsmasher | `CharacterArmature\|Death` | death | 1,30 | 40 | – |
| Spider | `Armature\|Walk-Cycle-Basic` | walk | 0,83 | 25 | – |
| Penguin | `Walk` | walk | 1,00 | 30 | – |
| Penguin | `Fall` | death | 1,88 | 57 | – |
| Skarnax | `Jaws` | walk | 1,60 | 48 | – |
| Zombie | `Armature\|Walk` | walk | 4,00 | 120 | – |
| Zombie | `Armature\|Die` | death | 2,96 | 89 | – |
| Skarnax Tail | `Crawl` | walk | 1,07 | 32 | – |
| Skeleton | `sprint` | walk | 0,50 | 15 | – |
| Skeleton | `die` | death | 0,33 | 11 | – |
| Skeleton Minion | `sprint` | walk | 0,50 | 15 | – |
| Skeleton Minion | `die` | death | 0,33 | 11 | – |
| Rat | `Run` | walk | 0,34 | 11 | – |
| Skarnax Segment | `Crawl` | walk | 1,07 | 32 | – |
| Ooze | `Wobble` | walk | 0,80 | 24 | – |
| Slime Clump | `Wobble` | walk | 0,80 | 24 | – |
| Slime Clump | `Splat` | death | 0,45 | 14 | – |

### Vorkommen in Wellen

Kurrikulum W1-W30 pinnt die Templates; danach wählt der Director frei (Boss jede fünfte
Welle). „Mio. Vertices“ = Summe über die Mischung bei der Obergrenze von `countRange`,
mit allem, was ein Kill abspaltet.

| Template | Kurrikulum | max. Anzahl | Mischung | Mio. Vertices |
| --- | --- | ---: | --- | ---: |
| `rat_tide` | W2 | 5.000 | rat 100 % | 5,0 |
| `zombie_horde` | W1 | 2.000 | zombie 90 %, zombie-v2 10 % | 3,6 |
| `skeleton_swarm` | W19 | 940 | skeleton 100 % (je Kill +2 skeleton-minion) | 3,3 |
| `wraith_storm` | W17, W27 | 300 | wraith 100 % | 2,4 |
| `armor_gauntlet` | W18 | 600 | rat 25 %, tank 25 %, mammoth 25 %, ghost 25 % | 2,4 |
| `bat_swarm` | W7, W21 | 600 | bat 100 % | 2,1 |
| `chaos_wave` | W16, W29 | 500 | zombie 30 %, tank 30 %, hornet 20 %, bear 20 % | 1,9 |
| `ghost_surge` | W13, W23 | 350 | ghost 80 %, wraith 20 % | 1,8 |
| `spider_swarm` | W6 | 800 | spider 100 % | 1,7 |
| `hornet_strike` | W8, W26 | 300 | hornet 70 %, bat 30 % | 1,4 |
| `light_mix` | W4 | 400 | wallsmasher 50 %, spider 50 % | 1,1 |
| `penguin_rush` | W3 | 500 | penguin 90 %, rat 10 % | 0,9 |
| `dragon_elite` | W12, W24 | 100 | dragon 60 %, hornet 40 % | 0,9 |
| `golem_squad` | W15 | 60 | stone-golem 100 % | 0,8 |
| `tank_column` | W9, W22 | 150 | tank 60 %, zombie-soldier 40 % | 0,7 |
| `wallsmasher_crew` | W5 | 200 | wallsmasher 100 % | 0,7 |
| `boss_dragon` | – | 80 | dragon 50 %, hornet 50 % | 0,7 |
| `boss_golem` | – | 80 | stone-golem 30 %, mammoth 70 % | 0,6 |
| `mammoth_siege` | W14, W25 | 120 | mammoth 70 %, wallsmasher 30 % | 0,6 |
| `bear_pack` | W11 | 120 | bear 100 % | 0,5 |
| `mech_army` | W28 | 100 | mech 100 % | 0,5 |
| `boss_herbert` | W10, W20, W30 | 100 | herbert 3 %, tank 48 %, zombie 48 % | 0,4 |

| Gegner | Kurrikulum-Wellen | max. im Static-Fallback |
| --- | --- | ---: |
| Bat | W7, W8, W21, W26 | 150 |
| Bear | W11, W16, W29 | 10 |
| Dragon | W12, W24 | 9 |
| Ghost | W13, W18, W23 | 40 |
| Herbert | W10, W20, W30 | 3 |
| Hornet | W8, W12, W16, W24, W26, W29 | 80 |
| Mammoth | W14, W18, W25 | 12 |
| Mech | W28 | 20 |
| Ooze | – | 0 |
| Penguin | W3 | 25 |
| Rat | W2, W3, W18 | 60 |
| Skeleton | W19 | 310 |
| Skeleton Minion | W19 | 620 |
| Slime Clump | – | 0 |
| Spider | W4, W6 | 35 |
| Stone Golem | W15 | 6 |
| Tank | W9, W10, W16, W18, W20, W22, W29, W30 | 25 |
| Wallsmasher | W4, W5, W14, W25 | 15 |
| Skarnax | – | 0 |
| Skarnax Segment | – | 0 |
| Skarnax Tail | – | 0 |
| Wraith | W13, W17, W23, W27 | 80 |
| Zombie | W1, W10, W16, W20, W29, W30 | 60 |
| Zombie Soldier | W9, W22 | 6 |
| Zombie v2 | W1 | 0 |

<!-- model-budget:end -->
