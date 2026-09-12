# Enemy Model Budget

**Stand:** 2026-09-13

Was die Gegnermodelle die GPU kosten, aus den Modelldateien gerechnet, und ein Budget je
Gegnerklasse. Die Tabellen unter [Messwerte](#messwerte) schreibt `npm run model-budget`
(`tools/model-budget/`). Sie laufen auch bei `npm test` mit und folgen damit Modell- und
Config-Änderungen. Alles andere in diesem Dokument ist von Hand geschrieben.

Anlass: Bei sehr großen Wellen (über 2.000 Gegner) ist `zombie_v2.glb` deutlich langsamer als
das alte `zombie.glb` (TODO.md, Performance - Advanced).

## Kurzfassung

- **zombie_v2** hat 31.342 VAT-Vertices pro Instanz, das alte Zombie 4.525 (knapp 7×).
  2.000 Instanzen sind 62,7 Mio. Vertex-Shader-Aufrufe pro Frame statt 9,1 Mio. Seine VAT
  belegt 52,8 MB (RGBA16F, drei Clips, zusammen 211 Frames).
- Die teuerste Welle nach Vertex-Last ist `hornet_strike`, nicht die Zombie-Horde: Hornet hat
  69.297 VAT-Vertices (122.736 Dreiecke in 16 starren Meshes), 210 Hornets sind 14,6 Mio.
  Danach folgen `zombie_horde` (14,4), `rat_tide` (10,8), `spider_swarm` (10,5) und
  `wraith_storm` (9,1).
- Alle 19 Typen werden beim Start gebacken (`preloadAllModels`). Zusammen belegen die VATs
  264,0 MB GPU-Speicher: 18 Typen als RGBA16F, der Stone Golem als RGBA32F (alles in
  RGBA32F wären 485,2 MB). Gebacken wird nur, was das Spiel zeigt: Todes-Clips bis zum
  Entfernen des Gegners, Idle gar nicht (bis 2026-09-12 waren es 664,6 MB).
- Der Wallsmasher lädt als FBX nicht indiziert: 17.010 Vertices für 5.670 Dreiecke. Als GLB
  wären es 3.444, ohne sichtbare Änderung.
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
verschwindet nach `TIMING.deathAnimationDuration` (2 s), und `vatClips` in `vat-baker.ts`
backt nur bis dahin. Idle backt der Baker nicht.

Mit diesem Budget läge die teuerste Welle (`rat_tide`, 5.000 Ratten) bei 5,0 Mio. und
`zombie_horde` bei 3,7 Mio. (zombie-v2 als Normal-Gegner); alle anderen Templates lägen
darunter.

## Empfehlungen je Modell

Reihenfolge nach Wirkung auf die teuersten Wellen. Die Decimate-Anteile sind Startwerte für
Blender; das Ergebnis mit `npm run model-budget` nachmessen. Die VAT-MB-Angaben rechnen noch
mit RGBA32F (vor 2026-09-13); mit RGBA16F ist es jeweils die Hälfte, außer beim Stone Golem.

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
- Die beiden Todes-Clips sind auf die sichtbaren 2 s gekürzt (je 61 Frames).
  `Electrocuted_Fall` (6,33 s) ist nicht mehr im Pool: Die Hüfte des Clips bleibt bis 3,0 s
  auf Standhöhe, der Sturz beginnt bei etwa 3,25 s und endet bei etwa 5 s. Der Gegner
  verschwand also zuckend im Stehen (aus den Keyframes gelesen, nicht im Browser gesehen).
  Soll die Variante zurück, den Sturz in Blender herausschneiden (etwa 3,0 bis 5,0 s).
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
`vat-baker.ts`. In der Config lassen sich nur Clips weglassen; das spart Speicher und
Bake-Zeit, keine Frame-Zeit. Die Swarm-Gegner mit der größten Vertex-Last (Ratte, Spinne)
backen je nur einen Clip mit 11 bzw. 25 Frames, da gibt es nichts wegzulassen.

Code-seitig umgesetzt (2026-09-12):

- **Nur zeigbare Frames backen**: `vatClips` kappt Todes-Clips bei
  `deathAnimationDuration × animationSpeed`. Idle wird nicht mehr gebacken; das Config-Feld
  `idleAnimation` und der Idle-Knopf im Debug-Fenster sind entfernt, denn Idle lief nur dort.
  VAT 664,6 → 516,1 MB.
- **`Electrocuted_Fall` aus dem zombie-v2-Pool**: Der Sturz käme erst nach dem Entfernen
  (siehe Nr. 2). −61 Frames, −30,5 MB, VAT gesamt 485,6 MB.

Code-seitig umgesetzt (2026-09-13):

- **VAT als RGBA16F** (`vatEncoding` in `vat-baker.ts`): Positionen relativ zur
  Bounding-Box, je Typ RGBA16F, wenn der Rundungsfehler im Spiel höchstens 2 mm beträgt,
  sonst RGBA32F. VAT gesamt 486,6 → 264,7 MB, halb so viele Bytes pro VAT-Zugriff. RGBA32F
  bleibt nur der Stone Golem (2,64 mm). Begründung der 2 mm in
  [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md#texelformat-rgba16f-oder-rgba32f).
- **Opake VAT-Materialien** (`vatAlpha` in `vat-baker.ts`): Transparent sind nur noch Typen,
  deren Materialien Alpha brauchen. Bear (Alpha in der Textur), Ghost und Hornet (Opacity
  unter 1, beim Hornet die Flügel) blenden, Dragon schneidet mit `alphaTest` 0,5 aus
  (glTF MASK), die übrigen 15 Typen zeichnen opak. `aOpacity` ist entfernt, es war immer 1.
  Ob opak messbar schneller ist, ist nicht gemessen.
- **Kein doppelter Loop-Frame** (`vatFrameCount`): Die Loader lesen Key-Zeiten als float32,
  `ceil(Dauer × fps)` zählte deshalb bei sechs Loop-Clips einen Frame zu viel, der die
  Startpose ein zweites Mal zeigte (Mech Walk, Wallsmasher Walk und Run, Mammoth Walk,
  Zombie Soldier Run, Bear Walk). Jetzt mit 0,001 Frames Toleranz. Todes-Clips, die vor dem
  Entfernen enden, haben ihre Endpose als letzten Frame (Wallsmasher Death +1). VAT gesamt
  264,7 → 264,0 MB.
- **VAT nur noch auf der GPU**: Nach dem Upload gibt der Pool die CPU-Kopie frei, 264,0 MB
  weniger im Speicher des Tabs. Nach einem WebGL-Context-Loss backt der Renderer die Typen
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

## Werkzeug

- `npm run model-budget` schreibt die Tabellen zwischen den Markern unten; der Test läuft
  auch bei `npm test`.
- `tools/model-budget/model-inspect.ts` liest GLB, glTF und binäres FBX ohne Abhängigkeit
  (FBX-Arrays über `node:zlib`). Meshes und Vertices zählt es so, wie GLTFLoader und
  FBXLoader sie erzeugen; die Clip-Dauer ist die letzte Keyframe-Zeit, als float32 wie in
  den Loadern.
- `tools/model-budget/generate.spec.ts` wählt den Bake-Pfad wie
  `InstancedEnemyRenderer.bakeAndCreatePool` und rechnet Clips und VAT-Maße mit
  `vatClips`, `vatFrameCount` und `vatLayout` aus `vat-baker.ts`. Der Test schlägt fehl,
  wenn ein Typ nicht backbar ist oder ein konfigurierter Clip im Modell fehlt.
- Für Format und Half-Fehler lädt `generate.spec.ts` jedes Modell zusätzlich mit GLTFLoader
  bzw. FBXLoader (ohne Texturen) und backt es mit `bakeEnemyVAT` wie das Spiel (rund 6 s).
  Weicht die aus der Datei geplante VAT-Größe von der gebackenen ab, schlägt der Test fehl.
- Ein Modell ohne Config-Eintrag prüfen (Node 24):
  `node -e "import('./tools/model-budget/model-inspect.ts').then((m) => console.dir(m.inspectModel('pfad/zum/modell.glb'), { depth: 3 }))"`
- Grenzen: kein ASCII-FBX. Bei Draco oder Meshopt stimmen die Vertexzahlen, die
  Weld-Spalte nicht. Morph-Targets werden gezählt, der Baker ignoriert sie.

## Messwerte

<!-- model-budget:begin -->

### Laufzeitkosten pro Gegner

Sortiert nach VAT-Vertices pro Instanz. „max./Welle“ ist Anteil × Obergrenze von
`countRange` über alle Templates, vor dem Fairness-Gate, das die meisten Wellen kleiner
macht. „Mio. Vertices“ = VAT-Vertices × max./Welle, also die Vertex-Shader-Last, wenn alle
Gegner der größten Welle gleichzeitig leben. „Half-Fehler“ ist der größte Fehler, den
RGBA16F einer Position im Spiel zufügt (`vatEncoding` in `vat-baker.ts`, aus den gebackenen
Positionen). Bis 2 mm ist die VAT RGBA16F (8 Byte pro Texel), darüber RGBA32F (16 Byte).

| Gegner | Klasse | max./Welle | VAT-Vertices | Dreiecke | Mio. Vertices | Bake-Pfad | VAT-Frames | VAT-Textur | Format | Half-Fehler mm | VAT-MB | Diffuse |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: | ---: | ---: |
| Hornet (`hornet`) | Normal | 210 | 69.297 | 122.736 | 14,6 | Objekt-Anim. | 59 | 8192×531 | RGBA16F | 0,35 | 33,2 | 1024² |
| Mech (`mech`) | Normal | 100 | 42.455 | 28.850 | 4,2 | Objekt-Anim. | 40 | 8192×240 | RGBA16F | 1,45 | 15,0 | 1024² |
| Zombie v2 (`zombie-v2`) | Normal | 200 | 31.342 | 30.887 | 6,3 | Skinning | 211 | 8192×844 | RGBA16F | 0,85 | 52,8 | 1024² |
| Herbert (`herbert`) | Elite/Boss | 3 | 30.831 | 31.949 | 0,1 | Skinning | 32 | 8192×128 | RGBA16F | 0,56 | 8,0 | 512² |
| Wraith (`wraith`) | Normal | 300 | 30.228 | 39.986 | 9,1 | Skinning | 15 | 8192×60 | RGBA16F | 0,48 | 3,8 | 1024² |
| Wallsmasher (`wallsmasher`) | Normal | 200 | 17.010 | 5.670 | 3,4 | Skinning | 104 | 8192×312 | RGBA16F | 1,28 | 19,5 | – |
| Stone Golem (`stone-golem`) | Elite/Boss | 60 | 13.614 | 10.368 | 0,8 | Skinning | 171 | 8192×342 | RGBA32F | 2,64 | 42,8 | 2048² |
| Spider (`spider`) | Swarm | 800 | 13.173 | 21.128 | 10,5 | Skinning | 25 | 8192×50 | RGBA16F | 0,56 | 3,1 | 512² |
| Dragon (`dragon`) | Elite/Boss | 60 | 12.267 | 19.542 | 0,7 | Skinning | 394 | 8192×788 | RGBA16F | 1,78 | 49,3 | 1024² |
| Mammoth (`mammoth`) | Normal | 150 | 5.541 | 8.685 | 0,8 | Skinning | 321 | 5541×321 | RGBA16F | 1,51 | 13,6 | 1024² |
| Ghost (`ghost`) | Normal | 280 | 5.245 | 7.773 | 1,5 | Skinning | 200 | 5245×200 | RGBA16F | 0,46 | 8,0 | 1024² |
| Tank (`tank`) | Normal | 150 | 5.094 | 2.796 | 0,8 | statisch | 1 | 5094×1 | RGBA16F | 1,12 | 0,0 | – |
| Zombie (`zombie`) | Swarm | 1.800 | 4.525 | 2.157 | 8,1 | Skinning | 209 | 4525×209 | RGBA16F | 0,83 | 7,2 | 1024² |
| Zombie Soldier (`zombie-soldier`) | Elite/Boss | 60 | 4.266 | 7.176 | 0,3 | Skinning | 107 | 4266×107 | RGBA16F | 0,56 | 3,5 | 1024² |
| Bear (`bear`) | Normal | 120 | 4.083 | 6.135 | 0,5 | Skinning | 41 | 4083×41 | RGBA16F | 0,74 | 1,3 | 1024² |
| Bat (`bat`) | Swarm | 600 | 3.559 | 2.684 | 2,1 | Skinning | 50 | 3559×50 | RGBA16F | 0,96 | 1,4 | 2048² |
| Rat (`rat`) | Swarm | 5.000 | 2.150 | 3.642 | 10,8 | Skinning | 11 | 2150×11 | RGBA16F | 0,26 | 0,2 | 1024² |
| Penguin (`penguin`) | Swarm | 450 | 1.993 | 3.408 | 0,9 | Skinning | 87 | 1993×87 | RGBA16F | 0,42 | 1,3 | 1024² |
| Skeleton (`skeleton`) | Swarm | 1.500 | 1.156 | 658 | 1,7 | Objekt-Anim. | 26 | 1156×26 | RGBA16F | 0,51 | 0,2 | 512² |

VAT-Speicher aller Typen zusammen: **264,0 MB** (30 fps), alles in RGBA32F wären **485,2 MB**.
Todes-Clips sind auf den sichtbaren Teil gekürzt; ganz gebacken kämen **15,9 MB** dazu.

### Modellinhalt

„Weld“ zählt die gebackenen Meshes: Vertices indiziert / nach Glätten der Normalen
(Position + UV) / nur Positionen. Liegt „indiziert“ unter den VAT-Vertices, lädt der
Loader das Modell nicht indiziert (FBX) oder das Modell enthält doppelte Vertices.

| Gegner | Datei | MB | Meshes (skinned) | Knochen | Morph | Materialien | Bilder im Modell | Clips | Weld |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| Hornet | `hornet.glb` | 4,4 | 16 (0) | 0 | 0 | 4 | 2× 1024², 512² | 1 | 69.297 / 69.191 / 61.776 |
| Mech | `mech.glb` | 6,3 | 34 (0) | 62 | 0 | 2 | 8× 1024² | 6 | 42.455 / 28.395 / 15.041 |
| Zombie v2 | `zombie_v2.glb` | 3,8 | 1 (1) | 24 | 0 | 1 | 1024² | 5 | 31.339 / 30.999 / 15.418 |
| Herbert | `herbert_optimized.glb` | 2,1 | 1 (1) | 24 | 0 | 1 | 512² | 1 | 30.831 / 30.208 / 26.048 |
| Wraith | `wraith.glb` | 3,4 | 1 (1) | 25 | 0 | 1 | 1024² | 1 | 30.228 / 30.226 / 19.863 |
| Wallsmasher | `wallsmasher.fbx` | 3,4 | 1 (1) | 61 | 0 | 1 | – | 14 | 3.444 / 3.025 / 2.956 |
| Stone Golem | `stone_golem.glb` | 17,8 | 1 (1) | 24 | 0 | 1 | 2× 2048² | 6 | 13.611 / 13.415 / 5.205 |
| Spider | `spider.glb` | 1,6 | 2 (2) | 113 | 0 | 2 | 512² | 6 | 13.091 / 12.823 / 10.644 |
| Dragon | `dragon.glb` | 12,6 | 1 (1) | 220 | 0 | 1 | 5× 1024² | 3 | 11.941 / 11.868 / 10.208 |
| Mammoth | `mammoth.glb` | 4,9 | 1 (1) | 43 | 0 | 1 | 2× 1024² | 12 | 5.541 / 5.541 / 5.121 |
| Ghost | `ghost.glb` | 2,7 | 2 (2) | 26 | 0 | 2 | 3× 1024² | 1 | 5.245 / 3.894 / 3.467 |
| Tank | `tank.glb` | 0,2 | 7 (0) | 0 | 0 | 7 | – | 0 | 5.094 / 2.269 / 1.676 |
| Zombie | `zombie.glb` | 2,0 | 1 (1) | 49 | 0 | 1 | 1024² | 13 | 4.525 / 1.453 / 1.086 |
| Zombie Soldier | `zombie_soldier.glb` | 3,5 | 1 (1) | 56 | 0 | 1 | 3× 1024² | 6 | 4.249 / 4.249 / 3.603 |
| Bear | `bear.glb` | 2,0 | 1 (1) | 36 | 0 | 1 | 1024², 512² | 1 | 4.083 / 3.838 / 3.243 |
| Bat | `bat.glb` | 5,5 | 1 (1) | 28 | 0 | 1 | 3× 2048² | 2 | 3.559 / 3.559 / 1.345 |
| Rat | `rat.glb` | 2,5 | 1 (1) | 21 | 0 | 1 | 3× 1024² | 1 | 2.150 / 2.150 / 1.823 |
| Penguin | `penguin.glb` | 1,3 | 1 (1) | 21 | 0 | 1 | 3× 1024² | 5 | 1.993 / 1.993 / 1.723 |
| Skeleton | `skeleton.glb` | 0,2 | 6 (0) | 0 | 0 | 1 | 512² | 32 | 737 / 363 / 347 |

### Gebackene Clips

Todes-Clips laufen mit `animationSpeed`, bis der Gegner nach 2.000 ms
entfernt wird. Gebacken wird nur dieser Teil (`vatClips` in `vat-baker.ts`), „gekürzt“ zählt
die weggelassenen Frames.

| Gegner | Clip | Rolle | Dauer s | Frames | gekürzt |
| --- | --- | --- | ---: | ---: | ---: |
| Hornet | `Take 001` | walk | 1,96 | 59 | – |
| Mech | `Armature\|Walk` | walk | 1,33 | 40 | – |
| Zombie v2 | `Unsteady_Walk` | walk | 2,96 | 89 | – |
| Zombie v2 | `Dead` | death | 2,96 | 61 | 28 |
| Zombie v2 | `dying_backwards` | death | 2,21 | 61 | 6 |
| Herbert | `Armature\|walking_man\|baselayer` | walk | 1,04 | 32 | – |
| Wraith | `Armature\|RunFast\|baselayer` | walk | 0,50 | 15 | – |
| Wallsmasher | `CharacterArmature\|Walk` | walk | 1,33 | 40 | – |
| Wallsmasher | `CharacterArmature\|Run` | run | 0,80 | 24 | – |
| Wallsmasher | `CharacterArmature\|Death` | death | 1,30 | 40 | – |
| Stone Golem | `Casual_Walk` | walk | 4,17 | 125 | – |
| Stone Golem | `dying_backwards` | death | 2,21 | 46 | 21 |
| Spider | `Armature\|Walk-Cycle-Basic` | walk | 0,83 | 25 | – |
| Dragon | `flying` | walk | 13,13 | 394 | – |
| Mammoth | `Walk` | walk | 4,97 | 149 | – |
| Mammoth | `Die` | death | 6,00 | 172 | 9 |
| Ghost | `Take 001` | walk | 6,67 | 200 | – |
| Zombie | `Armature\|Walk` | walk | 4,00 | 120 | – |
| Zombie | `Armature\|Die` | death | 2,96 | 89 | – |
| Zombie Soldier | `zombie_02_Run` | walk | 0,80 | 24 | – |
| Zombie Soldier | `zombie_02_Death` | death | 4,50 | 83 | 53 |
| Bear | `GltfAnimation 0` | walk | 1,37 | 41 | – |
| Bat | `fly.001` | walk | 1,67 | 50 | – |
| Rat | `Run` | walk | 0,34 | 11 | – |
| Penguin | `Walk` | walk | 1,00 | 30 | – |
| Penguin | `Fall` | death | 1,88 | 57 | – |
| Skeleton | `sprint` | walk | 0,50 | 15 | – |
| Skeleton | `die` | death | 0,33 | 11 | – |

### Vorkommen in Wellen

Kurrikulum W1-W30 pinnt die Templates; danach wählt der Director frei (Boss jede fünfte
Welle). „Mio. Vertices“ = Summe über die Mischung bei der Obergrenze von `countRange`.

| Template | Kurrikulum | max. Anzahl | Mischung | Mio. Vertices |
| --- | --- | ---: | --- | ---: |
| `hornet_strike` | W8, W26 | 300 | hornet 70 %, bat 30 % | 14,9 |
| `zombie_horde` | W1 | 2.000 | zombie 90 %, zombie-v2 10 % | 14,4 |
| `rat_tide` | W2 | 5.000 | rat 100 % | 10,8 |
| `spider_swarm` | W6 | 800 | spider 100 % | 10,5 |
| `wraith_storm` | W17, W27 | 300 | wraith 100 % | 9,1 |
| `chaos_wave` | W16, W29 | 500 | zombie 30 %, tank 30 %, hornet 20 %, bear 20 % | 8,8 |
| `light_mix` | W4 | 400 | wallsmasher 50 %, spider 50 % | 6,0 |
| `mech_army` | W28 | 100 | mech 100 % | 4,2 |
| `ghost_surge` | W13, W23 | 350 | ghost 80 %, wraith 20 % | 3,6 |
| `dragon_elite` | W12, W24 | 100 | dragon 60 %, hornet 40 % | 3,5 |
| `wallsmasher_crew` | W5 | 200 | wallsmasher 100 % | 3,4 |
| `boss_dragon` | – | 80 | dragon 50 %, hornet 50 % | 3,3 |
| `armor_gauntlet` | W18 | 600 | rat 25 %, tank 25 %, mammoth 25 %, ghost 25 % | 2,7 |
| `bat_swarm` | W7, W21 | 600 | bat 100 % | 2,1 |
| `skeleton_swarm` | W19 | 1.500 | skeleton 100 % | 1,7 |
| `mammoth_siege` | W14, W25 | 120 | mammoth 70 %, wallsmasher 30 % | 1,1 |
| `penguin_rush` | W3 | 500 | penguin 90 %, rat 10 % | 1,0 |
| `golem_squad` | W15 | 60 | stone-golem 100 % | 0,8 |
| `tank_column` | W9, W22 | 150 | tank 60 %, zombie-soldier 40 % | 0,7 |
| `boss_golem` | – | 80 | stone-golem 30 %, mammoth 70 % | 0,6 |
| `boss_herbert` | W10, W20, W30 | 100 | herbert 3 %, tank 48 %, zombie 48 % | 0,6 |
| `bear_pack` | W11 | 120 | bear 100 % | 0,5 |

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
| Penguin | W3 | 25 |
| Rat | W2, W3, W18 | 60 |
| Skeleton | W19 | 500 |
| Spider | W4, W6 | 35 |
| Stone Golem | W15 | 6 |
| Tank | W9, W10, W16, W18, W20, W22, W29, W30 | 25 |
| Wallsmasher | W4, W5, W14, W25 | 15 |
| Wraith | W13, W17, W23, W27 | 80 |
| Zombie | W1, W10, W16, W20, W29, W30 | 60 |
| Zombie Soldier | W9, W22 | 6 |
| Zombie v2 | W1 | 0 |

<!-- model-budget:end -->
