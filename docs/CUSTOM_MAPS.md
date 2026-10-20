# Eigene Karten: Renderer und Assets

**Status:** Aktuell, seit 0.7.0 auf `main`, im Spiel gesperrt bis zur Freigabe (TODO E134); die nächste Runde plant [CUSTOM_MAPS_NEXT_PLAN.md](CUSTOM_MAPS_NEXT_PLAN.md) (E154). Rahmen in [WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md)

Der Renderer zeichnet ein Kartendokument (`src/app/world/custom-map/map-document.ts`) mit Gelände, Bodentexturen,
Wasser, Objekten, Wegen und Himmel. Editor und Spiel benutzen dieselbe Ansicht. Code unter
`src/app/world/custom-map/render/` (ohne Angular), Assets unter `public/maps/assets/`, Werkzeuge unter
`tools/map-assets/`. Rechnen auf dem Dokument (Raster, Wegenetz, Gelände, Objekte, Generator, Prüfung) liegt in
`src/app/map-ops/`, das Editor, OSM-Import, Demo-Karte und Level-Skripte teilen; Welt und `map-ops` importieren
nichts aus `src/app/editor/` (Lint-Regel). Vorschau: `/map-preview` (Demo-Tal, `?view=village|forest|trees|bridge|game|…`,
`?sky=dusk|night|overcast`, `?skyImage=starry-night`, `?weather=rain|storm|snow|fog`, `?post=bloom`, `?seed=3`).

## Koordinaten

Kartenraum: Meter, Ursprung in der Kartenmitte, `x` nach Osten, `y` nach Norden, Höhe über Null der Karte. Die
Szene folgt `geoToLocalSimple` um den Ursprung (0, 0):

| Karte | Szene |
|-------|-------|
| `x` (Ost) | `-x` |
| `y` (Nord) | `+z` |
| Höhe | `+y` |
| Drehung `r` (gegen den Uhrzeigersinn von oben) | `rotation.y = r` |
| Neigung `pitch`, `roll` (optional, nach der Drehung) | um die eigene x- bzw. z-Achse des Modells |

Das ist eine halbe Drehung um die Hochachse, keine Spiegelung. `map-coords.ts`: `mapToScene(x, y, h, target)`,
`sceneToMap(position, target)`. Modelle stehen mit der Vorderseite nach `+z` (Norden bei Drehung 0).

## API

```ts
const view = new CustomMapView(doc, MapAssetLibrary.shared(), {
  anisotropy: renderer.capabilities.getMaxAnisotropy(),
  renderer,                                // backt Impostoren für ferne Bäume
});
view.attach(scene);                        // group + losBlockers als direkte Kinder der Szene
view.environment.apply(scene, renderer);   // Himmel, Umgebungslicht, Sonne mit Schatten, Nebel
renderer.shadowMap.enabled = true;         // für die Schatten der Sonne
await view.ready;                          // Materialien und Modelle geladen (vorher: grüner Platzhalter)
await view.warmUp(renderer, scene, camera); // alle Shader vorab kompilieren (compileAsync)

// je Frame
view.update(dt, camera, focus?);           // Gelände-LOD, Wind, Wasser, Objekt-Culling, Schattenbox über dem gesehenen Boden

view.heightAt(x, y);                       // Kartenraum, allokationsfrei, exakt die Fläche der feinsten Stufe
view.raycast(ray);                         // Szene-Strahl gegen das Gelände: { point, distance, x, y, height } | null
view.raycastObjects(ray);                  // erstes platziertes Objekt: { object, point, distance } | null
view.losBlockers;                          // Gruppe für den LOS-Würfel: Gelände + sichtblockierende Objekte
                                           // (muss direktes Kind der Szene sein: der Würfel blendet alle anderen aus)

// Editor: Dokument an Ort und Stelle ändern, dann
view.updateHeights(rect?);                 // rect in Kartenmetern { minX, minY, maxX, maxY }; Objekte, Wasser, Brücken folgen
view.updateSplat(rect?);                   // Splat-Gewichte neu hochladen (auch cliffAngle)
view.updateLayers();                       // Bodenschichten oder Klippenmaterial geändert: Material neu laden
view.updateWater(rect?, body?);            // Spiegel, Maske, Farbe; null entfernt das Wasser. Mit rect und body
                                           // (0 Hauptwasser, 1.. weitere) nur dessen Kacheln und Ufer im Rechteck
view.updateWater(rect, k);                 // nur Gewässer k (1.. = waterBodies[k-1]): Pool-Pinsel, Schwimmendes in rect
view.setObjects();                         // doc.objects ersetzt: alle Objekte neu (Promise)
view.objectsChanged(ids);                  // Objekte in doc.objects neu, entfernt oder geändert (auch an Ort und Stelle):
                                           // neue kommen in die Listen ihres Assets, entfernte machen Platz, die übrigen ziehen um (Promise)
view.setVisible(filter);                   // nur Objekte zeigen, die filter annimmt (null: alle); der Editor blendet so
                                           // Kategorien aus. Die Ansicht liest das Dokument nur, die gezeigte Liste hält sie selbst
await view.warmUpAssets(renderer, scene, camera, ids); // Programme und Impostoren noch nicht platzierter Assets
view.updatePaths();                        // Wegemaske (nur wo sich Wege änderten) und Brücken neu
view.setEnvironment(env);                  // Himmel, Sonne, Nebel, Tönung zeigen (doc.environment setzt der Besitzer)
view.dispose();
```

Die Gruppe darf verschoben, aber nicht gedreht werden (die Shader nehmen Objektraum als Weltraum für ihre
Projektionen); `heightAt` folgt einer Verschiebung nicht. `environment.detach()` stellt Hintergrund, Umgebung und
Nebel der Szene wieder her.

## Teile

### Gelände (`terrain/`)

- **Kacheln** (`terrain-chunks.ts`): 64 × 64 Zellen je Kachel, LOD-Stufen mit Schritt 1, 2, 4, 8 Samples nach
  Kameraabstand (Stufe n ab 2^(n-1) × 1,6 Kachelkanten, mit Hysterese), Schürzen an den Kanten gegen Risse.
  **Diagonale je Zelle** (`cellSplit` in `height-field.ts`): jede Zelle wird entlang der Diagonale geteilt, deren Enden
  sich in der Höhe weniger unterscheiden, bei Gleichstand (i, j) → (i+1, j+1). Eine reine Funktion der vier
  Eckhöhen, dieselbe in Mesh (jede LOD-Stufe aus ihren eigenen Ecken, auch beim Umschreiben nach einem Pinselstrich),
  `HeightField.heightAt` (Spiel, Sichtlinie, Editor-Picking), `terrainHeightAt` im Shader, Geomorphing-Ziel,
  Bodenverschattung und Uferschnitt. Grund: mit einer festen Diagonale bekam eine Wand, die innerhalb einer Zelle
  steigt (Grube, Klippe), an jedem zweiten Sample eine Kerbe, Sägezähne an der Oberkante und senkrechte Rippen in
  der Wand; die kürzere Diagonale schneidet die abweichende Ecke immer allein ab, die Kante läuft als gleichmäßige
  Fase von Zelle zu Zelle (Rauheit der Kante innerhalb einer Zelle etwa halbiert, `height-field.spec.ts`). Die Stufen
  der Samples selbst bleiben
  **Geomorphing**: jeder Vertex gleitet im letzten Drittel vor dem Wechsel zur Höhe der nächstgröberen Stufe (nach
  seinem eigenen Kameraabstand), Stufenwechsel springen nicht
  **Höhen auf der GPU** (E229): die Kacheln sind feste Gitter ohne Höhen; der Vertex-Shader liest Höhe, Normale
  (zentrale Differenzen auf dem vollen Raster, in jeder Stufe gleich) und das Geomorphing-Ziel (die vier Ecken der
  gröberen Zelle) aus der Höhentextur (`TERRAIN_VERTEX_PARS`, `TERRAIN_HEIGHT_VERTEX`), ebenso der Schattenpass
  (Tiefenmaterial der Kacheln) und der Sichtlinien-Würfel (`userData.losVertex`, LOS_PIPELINE.md). Auf der CPU hält
  eine Kachel nur ihre Box (Culling, LOD) und je Stufe den Index: ein Höhenwechsel wählt die Diagonalen der berührten
  Zellen neu (die gezeigte Stufe sofort, nur ihre Index-Zeilen gehen zur GPU, die anderen beim Zeigen); Strahlen
  treffen die Fläche von `HeightField.heightAt` (die feinste Stufe). Ein Pinsel lädt damit die Zeilen der
  Höhentextur und einige Index-Zeilen hoch statt Lage, Normale und Ziel jedes Vertex. 1025er-Raster (Node):
  Kacheln nach einem Tupfer mit 200 m Radius 0,7 statt 7,4 ms, alle Kacheln neu 7,6 statt 45 ms, LOD-Wechsel je Bild
  0,09 statt 2,6 ms. Im Editor (Produktionsbuild, 2-km-Karte, gehaltener Hebe-Pinsel) Bildzeit p50 bei 200 m Radius
  8 bis 9,5 statt 13,5 bis 18 ms, p90 10 bis 12 statt 17 bis 38 ms; GPU-Zeit und Abgabe eines Bilds gleich (innerhalb
  der Streuung). Bild gegen vorher pixelgleich (sechs Ansichten auf vier Karten). Die Geometrie trägt ein
  ungelesenes Normalen-Attribut (3 Byte je Vertex): ohne Normalen zeichnet three ein Standardmaterial flach
  schattiert, ein anderes Programm
- **Höhentextur** (`height-texture.ts`): das Raster als Float-Textur; Wasser und Gras lesen die Geländehöhe darunter
  mit denselben zwei Dreiecken je Zelle wie das Mesh
- **Normalen** kommen aus einer Half-Float-Textur über das Raster (`GridNormalTexture`), bilinear gelesen: Klippenkanten
  folgen nicht der Dreiecksdiagonale (vorher Sägezähne)
- **Material** (`terrain-material.ts`): `MeshStandardMaterial` mit `onBeforeCompile`, damit Licht, Schatten, Nebel,
  Log-Tiefe und Tone-Mapping wie bei jedem Standardmaterial greifen. Bis zu 16 Schichten in zwei Texture-Arrays
  (Farbe + Höhe, Normale + Rauheit + AO): die bis zu 12 Splat-Schichten der Karte, Klippe, Straße, Pfad
  (`assignLayerSlots`, jedes Material einmal; die Schleifen laufen über die Zahl der Array-Ebenen, auf Vielfache
  von vier gerundet). Je Pixel: Splat-Gewichte (zwei RGBA-Maps, mit Rauschen verwackelt; eine dritte nur auf Karten
  mit mehr als 8 Schichten, eigenes Programm mit `TERRAIN_SPLATS 12`, die anderen lesen und binden sie nicht), Wegemaske, Klippe ab
  `cliffAngle` mit verrauschter Kante; Höhen-Blend (eine Schicht zeigt sich, wo Höhe + Gewicht nahe am Besten
  liegt); jede Schicht zweimal mit verschobenen UVs je nach langsamem Rauschen (kein sichtbares Kachelmuster, nach
  Inigo Quilez); Variation (Makro, Wackeln der Splat-Kanten, Auswahl, Ausfransen) aus einer kachelbaren Textur
  natürlicher Flecken (`variation-texture.ts`, 512², auf dem CPU mit verzerrtem fbm gebaut) in drei Maßstäben (512, 96
  und 28 m) statt rund zwölf Rechenrauschen je Pixel; das Gras liest dieselbe Textur. Klippen triplanar (die Seitenprojektion übernimmt ab etwa 35°; die Grenze zwischen Fels und
  Geröll folgt keiner Höhenlinie, sondern bricht: Felsblöcke greifen ins Geröll, Geröll läuft in Zungen entlang der
  Falllinie den Fels hinauf, in mehreren Maßstäben; die Zungen sind etwa 7 m lang, 20 m lange zogen Gras und Fels wie
  Pinselstriche die Flanken hinab; die dunklen Rinnen der Felswand laufen quer zur Falllinie gut 2 m breit und brechen
  alle gut 12 m ab, vorher quer zu einer festen Kartenrichtung und 80 m lang: Streifen über die ganze Wand). **Steile gemalte Hänge** (unter dem Klippenwinkel): von 25° an,
  ganz ab 35°, liest die stärkste gemalte Schicht eines Pixels ebenfalls die zwei Seitenebenen, einmal vor der
  Schleife wie die Klippe (zwei Lookups mehr nur dort), bis `uSteepNear` vor der Kamera (Stufe: `steepNear`, Low 0);
  vorher zog die Draufsicht Geröll und Gras an Flanken zu Streifen. Makrovariation und in der Ferne die Durchschnittsfarbe. **Ferne billiger**: ab `uFarSingle`
  (150 m) liest jede Schicht Farbe, Normale und Rauheit einmal statt zweimal (die Wiederholung bricht dort die grobe
  Eigenstruktur, unten), ab
  `uFarFlat` (400 m) gar keine Schichttexturen mehr, nur die Durchschnittsfarben nach Gewicht über der Rasternormale;
  die Grenze zu einer Schicht ist mit Rauschen verzittert, zur flachen Ferne blenden Farbe, Daten und Normale über die
  letzten 30 % vor `uFarFlat` weich hinüber. Vorher lag dort ein verzittertes Band von 30 m: senkte sich die Kamera
  im Einflug aus der Übersicht (fast alles Boden in gleichem Abstand), sprang die Bodenbemalung über das ganze Bild auf
  einmal von flach zu texturiert (E193). `CustomMapView.setFarGround(single, flat, steep)` für die Qualitätsstufen Jede Schicht blendet so weich wie
  ihre Katalog-Kategorie (`MATERIAL_LOOK`: Gras und Sand laufen in die Nachbarn, Fels und Eis schneiden) und bekommt
  deren Rauheitsbereich (Schlamm und Eis glänzender, Gras und Sand matt); der Glanz läuft zum Blickrand hin aus (keine
  weißen Flächen im Gegenlicht). **Eigene Böden** (E214): 28 Materialien (Gras, Wiese, Laub, Moos, Erde, Schlamm, Sumpf, Sand, Dünen, Kies, Schnee und ihre Varianten) sind keine Scans mehr, sondern in Blender aus Geometrie gebacken (`tools/map-assets/bake_grounds.py`, Rezepte `ground_recipes.py`); ihre Höhe ist echte Geometrie (Halme stehen über der Erde, Steine über dem Sand), so wirkt der Höhen-Blend zwischen Schichten wie gewachsen. Gleiche Auflösung und Formate, zusammen 21 statt 25 MB KTX2. **Grobe Eigenstruktur** (E214): die stärkste Schicht eines Pixels liest ihre Farbtextur
  ein zweites Mal im 6,4-fachen Maßstab (rund 20 bis 30 m je Wiederholung, ein Zugriff in jeder Entfernung) und formt
  den Boden mit der verstärkten Abweichung dieses Bilds von ihrer Mittelfarbe in Helligkeit und Ton: Gras zeigt aus
  Spielhöhe Horste und Flecken aus dem eigenen Foto, Erde Steinnester (Stärke je Kategorie, `MATERIAL_LOOK.coarse`;
  nicht auf Klippen und Glut). **Bodenstimmung je Biom** (`ground-mood.ts`): Kuppen, Mulden, Rinnen, große Flecken
  und Flecken von gut 10 m mit festen Rändern (`variationFine`) tönen sich je Biom (gemäßigt Stroh auf Kuppen und
  sattes Blaugrün in Mulden, Sumpf Torf und rostige Eisenrinnen, Wüste gebleichte Kuppen, Wüstenlack und Salz,
  Arktis blaue Schattenmulden), dazu die Sättigung je Biom. **Übergänge** (E214 Teil 3): Wege und Straßen haben ausgetretene Ränder (eine grobe Mip-Stufe der Wegemaske, etwa 2,2 m, ist ein Hof um sie: dort wird die Grasnarbe dunkler und reißt in Zungen zur Erde des Bioms auf, `worn`); am Fuß von Fels und Steilhang liegt Geröll in hellen und dunklen Steinen; am Wasser ein Uferstreifen (`shore`), aus dem Alphakanal der Gitternormalen, der jetzt die Nähe zum Wasser trägt: 1 bis zwei Samples, auf 0 bei sechs (Chamfer-Distanz, `setWater`). Auf ebenem, offenem Gras Kleeinseln in Blüte (`clover`, `flower`), aus der Nähe einzelne Blüten, aus der Ferne ein heller Schimmer. Feste Beläge (Katalog `paved`: Pflaster, Asphalt, Platten, Holz; nicht Erd- und Kieswege) behalten ihre eigene Farbe: Abnutzung, Tönungen, Inseln und Geröll bleiben im Saum außen, auf dem Belag höchstens etwas Schmutz in den Fugen. Alles je Biom in `ground-mood.ts`, gleiche Programmzahl, gilt in Editor, Spiel und OSM-Welten. **Hangabtrag**: auf Hängen von gut 15° bis zum
  Klippenwinkel reißt die Grasnarbe (`MATERIAL_LOOK.turf`) in Zungen entlang der Falllinie auf und zeigt die Erde des
  Bioms, auf Kuppen und in den dunklen Stellen der Eigenstruktur zuerst. Kosten (nur Gelände gezeichnet, 1920 × 1080,
  Stufe High, je zwei Läufe): Demo-Tal Spielkamera vorher 1,69 bis 1,91 ms, nachher 1,65 bis 1,70 ms; Nahkamera 2,13
  bis 2,19 auf 1,31 bis 1,33 ms; Autumn Keep 1,56 bis 1,68 auf 1,06 bis 1,32 ms
- **Rand** (`terrain-apron.ts`): Land jenseits der Karte bis 3 km, ein Punkt je Randsample (der innere Ring trifft die
  Geländekante genau). Nach außen wird das Randprofil entlang der Kante mit wachsendem Radius geglättet und geht in
  flache Hügel über; Wasser am Rand läuft darüber weiter, bis das geglättete Bett über den Spiegel steigt. Bemalt mit
  dem natürlichen Boden des Kartenrands (`apron-paint.ts`: je 1/512 des Rands die Splat-Gewichte eines 24 m tiefen
  Streifens, 30 m entlang geglättet, ohne Straßen, Pflaster und Lava; ein gepflasterter Rand nimmt den natürlichen Boden,
  den die Karte am meisten hat; eine Textur 512 × 3, nur jenseits des Rands gelesen, sieben Lookups je Zeile, die mit
  dem Abstand wie das Höhenprofil entlang des Rands verwischen, 0,6 des Abstands je Seite, höchstens ein Viertel des
  Rands: ein Bodenwechsel am Rand wird auf der Bergkette ein weicher Übergang statt einer senkrechten Naht), vorher die erste
  Schicht (Harbor Town: Pflaster bis zum Horizont). Ab 250 m hinter dem Rand steigt eine **Bergkette** (ab 900 m voll,
  Grat-Rauschen entlang des Rands, Höhe nach Look `BACKDROP_HEIGHT`: Gebirge 420 m, Mond 80 m, Sumpf 40 m; nicht über dem Meer
  (nasser Rand ab 160 m am Stück, `SEA_RUN`; eine schmalere Flussmündung behält das Profil, der Fluss endet kurz hinter dem
  Rand, statt die Kette bis zum Horizont zu schlitzen);
  Land jenseits des Rands versinkt im Höhennebel zu 97 %, auf dem Mond ohne Luft nur zu 60 % (`beyondHaze`, sonst
  verschwände die Kette im schwarzen Dunst),
  so endet keine Karte sichtbar in flachem Land; dieselben Ringpunkte, kein Draw Call mehr. Im Bereich der Kette liegen
  die Ringe alle 80 bis 160 m (21 Ringe, Schürze rund 41 000 Dreiecke), eine dritte Grat-Oktave (60 m) schneidet Sporne
  in die Flanken. Gemalt wird die Kette als ferne Berge (`apron-material.ts`, ab 150 m hinter dem Rand, ein eigenes
  Programm mit den Uniforms des Geländes): Fels des Klippenmaterials an Steilhängen (sechsfacher Maßstab, die Mips
  geben das Detail nach Distanz), Schichtbänder nur an Steilflanken, Rinnen entlang der Falllinie, die die Normale
  biegen und die Furchen abdunkeln (blenden aus, bevor sie in der Ferne flimmern), Farb- und Helligkeitsflecken über
  Hunderte Meter, hellere Grate, Schnee oberhalb der Schneegrenze und Staub auf flachen Hängen je Look (`APRON_LOOK`:
  Gebirge Schnee ab halber Höhe, Arktis fast überall, Mond grauer Regolith, Mars rötlicher Fels und Staub). Die oberen
  Flanken behalten nur einen Teil des Dunsts jenseits des Rands (`clear`, 20 bis 45 %): die Gipfel ragen heraus, der
  Fuß versinkt wie bisher. GPU in der ungünstigsten Ansicht (Schürze füllt das Bild) etwa +0,1 ms. **Bäume am Rand**
  (`edge-trees.ts`): die Bäume der 40 m am Rand gespiegelt auf die Schürze, eine eigene Objektschicht außerhalb der
  Sichtlinie (nur Bild, das Spiel liest sie nicht), auf der Höhe der Schürze (`ApronProfile.heightAt`); ein Wald endet
  nicht mehr als Linie vor kahlem Boden. Keiner im Meer jenseits einer Küste (`ApronProfile.underWater`: wo das
  Hauptwasser über die Schürze weiterläuft und ihr Boden unter Spiegel + 0,3 m liegt; von oben standen sie dort als dunkle
  Kegel mit Schatten im Wasser); nach Höhen- und Wasseränderungen am Rand neu gesetzt. Nicht Teil der Karte (keine
  Abfragen, `losTransparent`)

- **Bodenverdeckung und Geländeform** (`ground-occlusion.ts`, RGBA je Rasterpunkt, ein Zugriff im Shader):
  R Verdeckung (Horizontwinkel in acht Richtungen bis 32 m: Mulden, Rinnen, Hangfüße dunkler; mal weiche
  Kontaktschatten unter Bäumen, Felsen, Gebäuden und Mauern nach Fußabdruck; dämpft das Umgebungslicht und teils das
  direkte), G Krümmung (Höhe gegen Ringe in 4 und 12 m: Kuppen trockener und heller, Mulden feuchter und dunkler),
  B Abfluss (D8-Flussakkumulation, logarithmisch; Rinnen und Talböden dunkler und grüner; beim vollen Backen, ein
  Pinsel lässt ihn bis zum nächsten stehen), A Lava-Nähe (1 auf Lava, 0 ab 12 m: der Boden wird zu erkaltetem Gestein
  und glüht von unten orange mit langsamem Puls). Die Rechnung steht ohne three in `ground-shape.ts` (samt Fernschatten):
  das Spiel und die Kartenvorschau rechnen sie in einem Worker der Ansicht (`GroundWorker`, `ground-jobs.ts`: eine Kopie
  von Höhen und Lava beim Bau der Ansicht, die Karte steht dort still), der Editor im Editor-Worker (`EditorGround`,
  Aufträge `groundShape`, `lava`, `farShadow`), beide von der ersten Rechnung an (`CustomMapViewOptions.groundBaker`);
  bis sie da ist, zeichnet der Boden offen, `ready` wartet auf sie. Die Ergebnisse kommen als Rechteck in die Textur.
  Derselbe Worker rechnet beim Laden die Bodennormalen samt nassen Ufern (`grid-normals.ts`, `GridNormalTexture` bis dahin
  flach und trocken, `settled`) und malt die ganze Pfadmaske (`pathMask`, `path-mask.ts` `pathMaskOf`: Wege, Straßendeckel,
  Flussufer, Plätze), während die Bodenmaterialien laden; geänderte Höhen bekommt seine Kopie über
  `GroundBaker.heightsChanged` (Krater). Auf 1025² (Node): ein
  80-m-Strich vorher 64 ms Horizontsuche im Hauptthread (in Scheiben zu 2 ms je Bild), jetzt 0,4 ms Einschreiben; die
  Lava-Nähe vorher 60 ms, jetzt 2,6 ms (nur Kanal A); ein Vollaufbau (Generieren, Größe) vorher rund 2 s im Bild,
  jetzt 7 ms; der Fernschatten (114 ms in Scheiben) und die Höhenlinien des Editors (2 m: 112 ms je halbe Sekunde im
  Strich) ganz im Worker. Krümmung, Abfluss und Lava-Nähe liegen dafür schon als Bytes vor. An Hangfüßen unter Steilem rieselt Geröll in der Farbe der Klippe
  heraus. Über jedem Lavapunkt steigen Glut (zusammen höchstens etwa 2000 Teilchen) und etwas Rauch auf; nach einem
  Pinsel oder Krater folgen Lichter, Glut und Funken der Lava erst, wenn die Änderungen eine Viertelsekunde ruhen, wie
  die Lava-Nähe (je Schritt eines Lavapinsels neu gebaut kostete das auf 257² 2 bis 5 ms). Objekte
  nahe Lava (Häuser, Felsen, Bäume) glühen von unten mit: jedes Kartenmaterial mit Emissive-Anteil liest über den
  Höhennebel-Patch dieselbe Lavanähe an seiner Stelle (ein Lookup, nur auf Karten mit Lava; quadratisch über die 12 m),
  am stärksten auf Flächen nach unten und zur Seite, ohne Lichter
- **Gebrauchsspuren** (`ground-decals.ts`): nach Kartenregeln gebackene Decals, ein instanziertes Netz, ein Draw
  Call: Laub unter jedem zweiten Laubbaum, Nadelstreu unter drei von vier Nadelbäumen, unter verschneiten Bäumen (oder
  auf einer Schneekarte unter allen) eine Mulde im Schnee mit hineingefallenen Nadeln (nicht unter Höllen- und
  Endzeitbäumen); ein Trampelpfad von der Tür jedes Katalog-Hauses (Vorderkante seines `box`, etwas aus der Mitte) zum
  Rand der nächsten Straße oder des nächsten Pfads bis 32 m, in Stücken von etwa 2,5 m, die leicht pendeln und sich
  überlappen (gestreckte Decals, `stretch`), ohne Straße in Reichweite keiner; festgetretene Erde alle 9 bis 15 m an den
  Rändern von Straßen und Pfaden (jenseits eines Gehwegs, nicht auf ihm: dort schien ein Fleck als dunkle Stelle durch
  das Pflaster, E269), Pfützen dort bei Regen oder im Sumpf. Geplant werden alle der Karte, gezeichnet nur
  die bis 320 m um den Fokus der Kamera, die nächsten zuerst und höchstens 4096, neu gewählt nach 24 m Bewegung, zum
  Rand hin ausgeblendet: eine Stadt mit 8000 Häusern behält ihre Pfade überall, wo die Kamera hinsieht (vorher ein
  fester Deckel von 3000 für die ganze Karte). Jedes ein kleines Gitter, im Vertex-Shader über die Höhentextur auf den Boden gelegt
  (mit dem Abstand etwas höher, gegen die gröberen Geländestufen), beleuchtet, beschattet und im Nebel wie der Boden;
  die Form je Art im Fragment-Shader, am Rand vom Rauschen ausgefranst. Ändern sich Objekte oder Wege (Hinzufügen,
  Entfernen), werden sie nach einer Pause von 0,4 s neu gelegt; ein Verschieben behält sie. Die Erdteppiche um die
  Häuser bleiben gemalt
- **Gras** (`grass/grass-field.ts`, zwei Schichten in `grass/grass-layers.ts`): 70 000 instanzierte Halme in einer
  64-m-Kachel ab dem Fuß der Kamera (Mitte höchstens 19 m plus die halbe Kamerahöhe über Grund voraus, Richtung
  Fokus), dahinter ein Ring aus 60 000 größeren Halmen (zwei Reihen statt vier, 2,2-mal so breit, mit dem
  Kameraabstand bis zum Dreifachen breiter, kräftiger schattiert) in einer 256-m-Kachel, deren Mitte bis zu 46 m
  weiter Richtung Fokus liegt; er reicht bis etwa 190 m voraus. Der Ring wächst genau dort, wo die nahen Halme
  ausdünnen (Dichten blenden über, keine Naht, kein Band mit beiden); jeder Halm hat einen festen Weltort, am
  Kachelrand ist die Dichte null (kein Springen beim Umklappen). Dahinter trägt der gemalte Boden, die Halme haben
  seine Farbe. Auf dem Höhenraster, so dicht wie die Grasschichten der Splat-Map (nicht auf Wegen, steilem Boden,
  außerhalb der Karte), mit Wind, zum Rand hin kleiner. Beide Schichten dünnen zwischen 85 und 100 % ihrer Distanz
  aus (`grassDistance`, `grassFarDistance`), gemessen am Kameraabstand zum Fokus oder dem Dreifachen der Kamerahöhe
  über Grund, was kleiner ist: der Blick aus dem Turm behält sein Gras. Ansichtsoption `grass: false`. Jeder Vertex
  rechnet seinen Halm selbst (Splat, Höhe, Hang, Deckung, Farbe). Die Stufe gibt die Zahl der Halme
  (`grassBlades`, `grassFarBlades`, render-quality.ts); unter High sind sie breiter, damit die Wiese geschlossen
  bleibt (Vorschau `?quality=medium`). Der Ring kostet einen Draw Call. Verworfen (2026-10-14, zweimal): ein Pass, der jeden
  Halm einmal in Texturen rechnet und die Vertices nur lesen lässt, zuletzt mit Neuberechnung nur bei Fokusbewegung
  und alle 8 Bilder. Mit SwiftShader als Ersatz für eine schwache GPU (Burg im Herbst, Nahansicht, GPU-Median je
  Bild, Gras als Unterschied zu einem Build ohne Gras, ein ruhiger Lauf) High 593 ms mit Pass gegen 639 ms ohne,
  Medium 204 gegen 235 ms: 7 und 13 % weniger, unter den geforderten 15 %, bei einer Streuung zwischen Läufen in
  derselben Größe; dazu 3,2 MB Ziele und kein Rückfall ohne `EXT_color_buffer_float`. **Halme je Bodenschicht**
  (Katalog `blades` der Grasmaterialien, `materials.json`): Höhe von und bis, Breite und ob Samenstände und Blüten
  wachsen, nach den Splat-Gewichten gemischt; Rasen (`grass-lush`, OSM `lawn`, `park`, Sportplatz) 6 bis 12 cm und fein,
  das Grundgras 14 bis 32 cm, Wiesen 35 bis 80 cm, ohne Eintrag die Wiese (`DEFAULT_BLADES`). Halmsorten aus den
  Zufallswerten: meist schlicht, manche kurz und breit, auf Schichten mit `heads` manche hoch mit strohfarbenem
  Samenstand, wenige blühen weiß, gelb oder violett (nur auf grüner Wiese, nur nah). Halme sammeln sich zu Büscheln
  (Zellen von 0,8 m, jede zieht ihre Halme verschieden stark zur Mitte, am Rand kürzer), nah an der Kamera sind sie
  schmaler (bis 60 % unter 2 m). Um Gebäude, Bauwerke, stehende Mauern ab 1,5 m und Felsen werden sie über 1,5 m zur
  Wand hin kürzer, ab 0,3 m keiner mehr: der Abstand zum Grundriss (Rechteck `box`, Umriss gehobener Gebäude, sonst
  Fußkreis) liegt als Byte je Sample in `CoverMap.rim` (1,2 cm je Stufe; im Float der Deckung waren es auf einer OSM-Welt 5,8 MB mehr). Die Farbe kommt aus `groundColorAt` (gebackene Bodenfarbe, unten),
  im Gegenlicht leuchtet der Halm zur Spitze hin durch (im Lichtdurchlauf nach dem Schatten der Sonne, GRASS_LIGHTS)
- **Gebackene Bodenfarbe** (`terrain/ground-albedo.ts`): die Farbe, die der Gelände-Shader malt (Schichten,
  Makrovariation, grobe Eigenstruktur, Stimmung des Bioms mit Kuppen, Mulden, Flecken, Trampelrändern, Ufern), einmal
  von oben über die ganze Karte gerendert, wie aus einigen Dutzend Metern gesehen (Variante `albedoBake` des
  Gelände-Materials mit dessen eigenen Uniforms, `TERRAIN_ALBEDO_BAKE`: feste Sichtweite, nur die Farbe). Ein Meter je
  Texel, höchstens 1024 (eine OSM-Welt von 2,4 km bekommt 2,3 m), 4 MB. `groundColorAt` (`ground-color.ts`) liest sie,
  sobald sie steht, vorher die Mittelfarben der Splat-Schichten: Gras und das Land im Wasserspiegel nehmen so die Farbe
  des Bodens, auf dem sie stehen. Gebacken beim Aufwärmen der Karte (Programm vorab abseits des Hauptthreads) und
  wieder 0,35 s nach der letzten Änderung von Höhen, Bemalung, Wegemaske, Wasser oder Biom
- **Schnee und Nässe** (alle Kartenmaterialien, `height-fog.ts`): Schnee liegt auf allem, was nach oben zeigt
  (`environment.snowCover`, sonst aus Biom arctic oder Schneewetter), Regen macht Flächen dunkler und glänzender.
  Auf dem Boden sammelt sich Schnee zuerst in Mulden und im Windschatten (Hänge, deren Gefälle mit dem Wind läuft):
  dort liegt er schon bei leichtem Schneefall dick, in Flecken, nicht auf Fels
- **Nasse Ufer**: die Alpha-Komponente der Normalentextur markiert Raster­punkte nahe Wasser (Maske um zwei Samples
  gewachsen); dort wird Boden bis etwa 1,3 m über dem Spiegel dunkler und glänzender

### Wege (`paths/`)

Wege werden **ins Gelände gemalt**, nicht als Streifen aufgelegt: eine RGBA-Maske (rot Straße, grün Pfad, blau die
Lage quer zum stärksten Weg, 0,5 m je Texel, höchstens 2048²) sagt dem Gelände-Shader, wo die Wegmaterialien
(`cobblestone`, `dirt-path`) liegen. Straßen bekommen Spurrillen, Feldwege zwei Fahrspuren mit Grasstreifen, die
weichen Ränder werden von Rauschen angefressen (Gras wächst herein). So folgt
ein Weg jeder Unebenheit ohne Z-Fighting, und der Höhen-Blend lässt Pflastersteine am Rand ins Gras auslaufen.
Flussufer liegen in der Alpha der Maske: nasser Kies und Erde beidseits jedes Flusses, ungleichmäßig breit (an
der Innenseite einer Biegung bis 2,4-fach, außen schmal, entlang des Flusses wandernd), die Kante vom Rauschen
angefressen. Die Ansicht malt die Maske einmal mit der Karte (`rasterizePathMask`); im Editor hält sie danach der
Editor-Worker (`editor/workers/path-mask-job.ts`, `EditorPathMask`): er merkt sich, was er malte (`PathMaskRaster`: je
gemalte Kante Art, Breite und Linie, je Fluss die Punkte), und malt bei einer Änderung nur das Rechteck um alte und
neue Lage dessen, was sich bewegte, kam oder ging, neu; die Ansicht schreibt dessen Texel in ihre Textur und lädt nur
dessen Zeilen hoch, eine Wasseränderung ohne geänderte Wege malt nichts. Das Rechteck kommt genau wie ein Ganzaufbau
heraus (gleiche Reihenfolge der Kanten; ändert sie sich, malt sie ganz). Einen Knoten ziehen kostete im Hauptthread
auf einer 1024-m-Karte mit 220 Straßen 1,4 ms je Bild, auf einem Netz von 7 500 Knoten und 11 000 Kanten (OSM-Stadt)
30 ms; jetzt nur den Abgleich des Spiegels (1,9 ms auf dem großen Netz) und den Upload. Neue Bodenschichten behalten
die Maske. Brücken (`kind: 'bridge'`) bekommen ein Deck aus instanzierten `bridge-deck`-Stücken zwischen den Uferhöhen, mit
leichtem Bogen und mindestens 1 m über dem Wasser. `style: 'stone' | 'concrete' | 'lava'` an der Kante nimmt
`bridge-deck-stone`, `bridge-deck-concrete` (Asphalt auf Betonplatte, Geländer) bzw. `bridge-deck-lava`; fehlt das
Stück im Katalog, bleibt es beim Holzdeck.
Eine Kante mit `surface` (ein Bodenmaterial, OSM-Welten: Asphalt, Pflaster, Kies) lässt die Maske aus. Ist der Belag
befestigt (Asphalt, Beton, Pflaster, Kopfstein, Platten: `PAVED_SURFACES` in `paths/road-style.ts`), liegt die Straße
als eigene Fläche über dem Boden (`paths/road-network.ts`, `paths/road-surface.ts`): ein Band je Straße mit
geraden Kanten, der Belag läuft entlang der Mittellinie, Kanten mit Abstand gleichen Aussehens laufen ohne Naht als
ein Band weiter; wo Straßen sich treffen, enden die Bänder hinter dem Punkt, an dem sich ihre Bordsteinkanten
treffen, plus einem Bordsteinradius, und eine Kreuzungsfläche mit gerundeten Ecken (quadratische Kurven) füllt den
Raum dazwischen, ihr Belag läuft vom breitesten Band weiter und geht zu jedem anderen Arm hin in dessen Belag über
(jedes Dreieck der Kreuzung trägt die Koordinaten seines Arms und ein Gewicht, 1 an dessen Endquerschnitt, 0 am Knoten
und an den Bordsteinen): keine Naht an einem Arm. Bordsteine laufen um die Ecken, an denen ein Arm einen hat.
Überlappen sich zwei Bänder ohne gemeinsamen Knoten (ein Gehweg in die Breite einer Straße gezeichnet), liegt die
höhere Straßenklasse oben (Rang 0 Pfad bis 7 Autobahn, je Rang ein paar Millimeter mehr zur Kamera hin). Ein Pfad, an dessen Ende nichts anschließt, endet rund.
Das Aussehen folgt der Straßenart (`street`): Spurlinien auf Autobahnen, Rand- und gestrichelte Mittellinie auf
Haupt- und Kreisstraßen (`primary`, `secondary`), Mittellinie auf `tertiary`, keine in Wohnstraßen, deren Asphalt in
einen Bordstein mit einer Rinne aus Pflastersteinen ausläuft; Fahrspuren dunkler, Flickstellen, Querrisse und eine
vergossene Mittelnaht, mit der Abnutzung zur kleineren Straßenart mehr. Markierungen enden an Kreuzungen. Ein Material
für alle Straßen, ein Mesh je 512-m-Kachel; die Texturen sind die Bodenmaterialien des Katalogs als eigenes Array
(nur die Beläge, die die Karte nutzt), Markierungen und Abnutzung zeichnet der Shader aus den Straßenkoordinaten
(quer, längs, Abstand zur Kante, Aussehen in einer Zahl gepackt). Ab etwa 12 cm je Pixel entfallen die feinen Details
(eine Texturabfrage). Die Höhe nimmt jeder Vertex aus der Höhentextur des Geländes (ein Pinsel braucht keinen Neubau),
gezeichnet wird er ein Stück zur Kamera hin statt angehoben (3 cm bis 200 m Abstand, darüber wachsend, wo das Gelände
gröber wird), so kämpft die Fläche nicht mit dem Boden und schwebt von der Seite nicht. Nach dem ersten Bau
(Miltenberg rund 40 bis 60 ms, 160 000 Vertices) legt `RoadNetworkBuilder` bei einer Änderung nur neu, was sie
erreicht: die Bänder mit einer geänderten Kante, die Bänder, die an deren Enden anschließen (ihre Kürzung kann sich
ändern), und die Kreuzungen an deren Enden; eine neu gebaute Kachel setzt sich aus den behaltenen Stücken aller
Bänder und Kreuzungen darin zusammen. Einen Knoten ziehen kostet so in Miltenberg rund 3 ms je Schritt. Ein Belag ohne Befestigung (Kies,
Erde) ist in die Bodenfarbe gemalt und zeigt sich statt Kopfsteinen und Spurrillen. Das Auflegen selbst (Kacheln,
Höhe aus der Höhentextur, Zug zur Kamera, Material-Array, Nebel) teilen Straßen und Flächen in `drape/draped-layer.ts`
(unten, „Flächen“). Unter der Mitte einer
Straßenfläche (bis 25 cm vor ihren Rändern, nicht über die Enden hinaus) trägt die Wegmaske Blau 255 ohne Rot und Grün
(eine Querlage erreicht höchstens 253): der Gelände-Shader liest die Maske dort ohnehin schon (die nassen Ufer,
ohne Kanten-Rauschen) und lässt unter der Decke seine ganze Arbeit aus (keine Splat-, Schicht-, Klippen- oder
Formabfragen, kein Rauschen; die Fläche deckt den Boden), das Gras wächst dort nicht. `street` an der Kante (der `highway`-Typ des
echten Wegs) gibt im Spiel den Straßentyp, nach dem Routen gewichtet und Spawns gewählt werden
(`custom-map-streets.ts`); ohne ihn entscheidet die Art. Beides fehlt auf allen bisherigen Karten
([OSM_WORLD_PLAN.md](OSM_WORLD_PLAN.md)).

### Flächen (`surfaces/`)

Flächen (`doc.surfaces`, `MapSurface`, `map-surfaces.ts`; TODO E237) legen ein Bodenmaterial auf einem Umriss mit
Löchern über den Boden: Plätze, Spielplätze, Sport- und Parkplätze, Bahnsteige; im Editor das Werkzeug Surfaces
(LEVEL_EDITOR.md), aus OSM die Nutzungsflächen ([OSM_WORLD_ROUND2_PLAN.md](OSM_WORLD_ROUND2_PLAN.md)). Rein
darstellend wie die Bodendecals: Routen, Bauverbot und Simulation sehen sie nicht, Koop-Prüfsummen auch nicht.

- **Gemeinsames Auflegen** (`drape/draped-layer.ts`): Straßen und Flächen sind dieselbe Art Oberfläche. `DrapedTiles`
  hält ein Mesh je Kachel (Straßen 512 m, Flächen 1024 m; Grenzen aus den Höhen, bei Geländeänderung neu angepasst), `DrapedTextures` lädt das
  Array der genutzten Materialien (bleibende Schichten, neue hinten an), `DrapedMaterial` nimmt Höhe und Normale aus dem
  Gelände, zieht zur Kamera (`DrapePull`: Grundmaß, Wachstum mit der Entfernung, je Rang mehr) und gibt Nebel und
  Schatten. Jede Art bringt ihre Attribute und ihren Look (`DrapeLook`). Jede Straße liegt vor jeder Fläche (Flächen
  1 cm plus 0,8 mm je Rang bis Rang 15, Straßen ab 3 cm, Flächen wachsen mit der Entfernung etwas langsamer). Von zwei
  Flächen, deren Rechtecke sich überlappen, liegt die kleinere oben, und keine zwei sich überlappenden haben denselben
  Rang (`surfaceRanks`: nach Größe absteigend, je Fläche ein Rang über der höchsten vor ihr, die sie überlappt): zwei
  auf einer Tiefe würden flimmern.
- **Geometrie** (`surface-geometry.ts`): Umriss und Löcher per Earcut trianguliert, jedes Dreieck an Zellen
  geschnitten, die so groß sind, wie der Boden es zulässt (`cutCells`): Zellen von 64 m im Raster des Geländes,
  geviertelt, wo der Boden darunter nicht in einer Ebene liegt (8 mm Abweichung) oder mehr als 15 Kanten nahe kommen,
  bis hinab zur Zelle des Geländes; dort wird zusätzlich an der Diagonale geschnitten, an der das Gelände seine zwei
  Dreiecke teilt (wie `TERRAIN_HEIGHT_GLSL`), so liegt die Fläche zwischen ihren Ecken genau auf dem Gelände und kein
  Boden schaut durch (die erste Fassung mit festem 4-m-Raster zeigte auf dem Tunnelhügel unter der Place de la
  République überall graue Rauten). Flacher Boden (Parkplätze, geebnete Plätze, die Stadt) braucht so kaum Dreiecke:
  Würzburg 432 Flächen rund 15 000, Marais 487 rund 35 000 (das feste Raster: 157 000 und 210 000). Je Vertex: Lage
  im gedrehten Rechteck der Markierung (`u` längs, `v` quer, ohne Markierung der Kartenpunkt) und die halbe
  Platzgröße (`courtOf`), dazu das Aussehen (Schicht, Markierung, Rang), die Kantenliste der Zelle und die Richtung
  des Rechtecks. Die Kantenliste: je Zelle die bis zu 15 nächsten Kanten von Umriss und Löchern im Umkreis von 1 m, in
  einer Float-Textur (`SurfaceEdgeStore`, 1024 Texel je Zeile, ein Block je Fläche, der bleibt, solange die Fläche
  bleibt); der Shader misst daraus den Abstand zur Kante je Pixel genau (ein interpolierter Abstand je Vertex knickt an
  jeder Ecke und machte die Bordsteine dort keilförmig). Nach dem ersten Bau legt die Schicht nur die Kacheln der
  Flächen neu, die kamen, sich änderten oder gingen; ändert der Editor die Höhen unter einer Fläche, wird sie neu
  geschnitten.
- **Aussehen** (`surface-look.ts`): die Textur läuft längs der Markierung (Maserung, Normalen); Linien in echten Maßen,
  dünner als ein Pixel mit ihrem Anteil statt flimmernd: Fußball (Seiten-, Tor-, Mittellinie, Mittelkreis, Straf- und
  Torraum, Punkte, Eckbögen, mit kleinem Platz kleiner), Handball (6-m-Linie mit getöntem Torraum, gestrichelte 9-m-Linie,
  7-m-Marke), Basketball (Dreierlinie, Zone getönt, Kreise), Tennis (Doppel, Einzel, Aufschlagfelder), Volleyball,
  Mehrzweck (Handball weiß, Basketball gelb), Laufbahn (Stadionoval im Rechteck, Bahnen zu 1,22 m, Ziel, Rasen-Innenfeld,
  wo keine eigene Fläche darüber liegt), Parkplatz (Stellplätze 2,5 × 5 m in Reihen Rücken an Rücken, `parkingRows`,
  dieselben Reihen, auf die die OSM-Welt Autos stellt; Öl unter den Motoren, Reifenspuren in der Gasse), Bahnsteig
  (Kantenstein, weiße Linie, gerippter Leitstreifen an beiden Langseiten). Rasenplätze bekommen Mähstreifen und
  ausgetretene Torräume, lose Böden (Hackschnitzel, Sand) eine Holzeinfassung, Hartplätze und Parkplätze einen
  Bordstein, alle einen weichen Kontaktschatten am Rand. Linien sind weiß, im Mehrzweck der zweite Satz gelb.
- **Boden darunter**: die Wegmaske deckt jede Fläche (Blau 255 ohne Rot und Grün, 0,3 m innerhalb des Umrisses,
  `paintSurfaceCovers`): kein Gras wächst durch, der Gelände-Shader lässt dort seine Arbeit aus. Im Editor malt der
  Worker die Maske aus den Flächen seines Spiegels mit (`PathMaskRaster` merkt je Ring die Punkte).
- **Format**: `surfaces?: MapSurface[]` (höchstens `MAX_SURFACES` 4096, je Umriss 3 bis 2048 Punkte, bis 64 Löcher);
  `marking?: { kind, x, y, angle, length, width }`, `kind` aus `MAP_SURFACE_MARKINGS`. Weich geprüft
  (`map-repair.ts`): eine kaputte Fläche fällt weg, eine unbekannte oder kaputte Markierung verliert nur die Linien.
  Ohne Feld liest und hasht eine Karte wie vorher. Höchstens 15 Materialien je Karte (`MAX_SURFACE_MATERIALS`), darüber
  die Mittelfarbe.
- **Probe**: `/map-preview?surfaces` zeigt je Markierung eine Fläche (`preview/surface-showcase.ts`);
  `/map-preview?map=<id>&own` eine eigene Karte des Browsers (eine OSM-Welt).

### Wasser (`water/`)

Ein Material für alle Gewässer (`water-material.ts`). Die Tiefe je Pixel ist Spiegelhöhe minus Geländehöhe aus der
Höhentextur: das Ufer liegt dort, wo das Gelände die Fläche schneidet, glatt, unabhängig vom Raster. Flächen-Gewässer
werden über ihrer Maske plus zwei Zellen gezeichnet und mit der bilinearen Maske ausgeblendet (runde Kanten), mit
weichem Saum. Maske und Strömung eines Gewässers decken nur ein Fenster des Rasters, seine Ausdehnung plus Rand
(`WaterSurface.window`, Rand 40 m plus `SHORE_CUT_RADIUS`: Uferband, Uferfeld der Brandung, der Blick 25 m nach
außen), `uMaskUv` bildet darauf ab; ein Pinsel, der das Wasser darüber hinausträgt, legt ein größeres an
(`fitWindow`). Vorher trug jeder Teich beide über die ganze Karte: Stuttgart (OSM, 1201² Proben, rund 16 Gewässer)
8,6 MB je Gewässer im Speicher und ebenso auf der GPU, zusammen rund 130 MB je Seite. An steilen Ufern reicht das nicht: das Gelände hat je Zelle zwei Dreiecke, eine Wand, die innerhalb
einer Zelle steigt (mit Terrain Lower gegrabene Grube, Kaimauer), schneidet den Spiegel in Stufen entlang der
Samples, eine Fase je Zelle (`cellSplit`). Dafür trägt die Maskentextur (RG8 statt R8, ein Byte mehr je Sample und Gewässer) im G-Kanal den Uferschnitt
(`shore-cut.ts`): je Sample der Abstand zur Wasserlinie des Dreiecksnetzes in Zellen (bis 3, nass positiv), zweimal mit
[1 2 1] geglättet, an steilen Ufern (größter Höhenschritt zum Nachbarn ab 1,5 bis 3 je Meter) um 0,5 Zellen nach innen
geschoben, an flachen um 0,5 nach außen. Zähne an jedem Ufer: wo die Wasserlinie des Netzes auch an einem flachen Hang
zickzackt (Buckel von einer Zelle, die Rippen einer Kraterwand; Stillwaters See hatte so einen Sägezahnrand), weicht der
rohe Abstand vom geglätteten um etwa die Zahntiefe ab; der Schnitt rückt um das Vierfache der größten Abweichung über
0,1 Zellen in zwei Samples Umkreis nach innen (gezählt bis 1,5 Zellen von der Linie, höchstens 2,5 Zellen), also auf
die geglättete Linie innerhalb der Zähne. Ein glattes Ufer weicht um Hundertstel ab (eine runde Schüssel höchstens
0,08) und behält seinen Schnitt. Innerhalb des Schnitts liest das Material die Tiefe höchstens als 0,3 m je Zelle
Abstand zum Schnitt (ab 1,5 bis 2,5 Zellen wieder die Tiefe je Pixel): wo der Schnitt vor der gezeichneten
Wasserlinie liegt (Wand, Zähne), endet das Wasser mit dem hellen Saum und Schaum eines Ufers statt mit einer harten
Kante tiefen Wassers. Das Material schneidet, wo der bilineare Wert unter 0 fällt (weich über eine
Viertelzelle): an der Wand endet das Wasser auf einer glatten Linie knapp vor den Zähnen, ein schmaler Streifen Wand
bleibt sichtbar; am glatten flachen Ufer schneidet weiter die Tiefe je Pixel. Kein zusätzlicher Texturzugriff (derselbe
Maskenzugriff liest R und G). Gebacken über die Maskengrenzen bei neuem Spiegel, neuer Maske oder Ganzneubau (rund 40
bis 70 ms auf einem 1025er-Raster mit Ufer überall; ein kleiner See nur sein Rechteck): immer in einem Worker
(`shore-cut.worker.ts`, Kopien nur des Ausschnitts, den der Schnitt liest: `shoreCutInput`/`pasteShoreCut`), beim Laden ebenso (`WaterSurface.settled`, `ready` wartet), bis
dahin zeigt die Textur den alten Schnitt (beim ersten Mal keinen); ein neuerer Auftrag verwirft den älteren. Sonst um das Pinsel-Rechteck auf dem Hauptthread
(unter 2 ms); ein Pinsel, während der Worker rechnet, wird über dessen Ergebnis noch einmal gebacken. `losTransparent`. Wasser empfängt den Schatten der Sonne (Bäume, Brücken, Ufer dunkeln Körper, Glanz und
etwas die Spiegelung) und die Lichter des Lichtpuffers (Pool der Laternen, Fackeln, Lava, dazu die Schüsse) als
Glanzpunkte (`shotLightGlints`) mit schwachem Lichtfleck (`shotLightAt`).

- `terrain.water`: der Hauptkörper; nur er läuft über den Kartenrand weiter und macht Ufer nass
- `terrain.waterBodies`: weitere Körper mit eigenem Spiegel und eigener Maske (Datei: `terrain/water-<n>-mask.u8`)
- `terrain.rivers`: Flüsse und Lavaströme als Linie, je Punkt Breite und Spiegelhöhe, fließen vom ersten zum letzten
  Punkt; ein Band entlang der Linie (Catmull-Rom, alle 2 m), Wellen bzw. Kruste wandern stromab, schneller wo es fällt,
  mit der halben Fließgeschwindigkeit je Vertex in denselben zwei überblendeten Phasen wie die Strömung der Flächen
  (6 s Wasser, 18 s Lava). Zeit mal Geschwindigkeit je Vertex hätte das Muster überall geschert, wo Tempo oder
  Richtung von Reihe zu Reihe wechseln: nach einigen Minuten Querstreifen über den Strom.
  Der Editor setzt die Spiegelhöhe aus den Ufern (knapp unter dem tieferen, LEVEL_EDITOR.md); das Format bleibt, ältere
  Karten lesen sich unverändert, ihre Flüsse sinken erst beim Bearbeiten oder „Carve the bed“ in ein Bett

`kind` je Körper:

- **Tiefe**: Absorption nach Beer-Lambert aus der Tiefe je Pixel (Rot zuerst, dann Grün): flaches Wasser wird
  grünblau, bevor die Körperfarbe übernimmt, und lässt den Grund durchscheinen (Deckkraft 0,5 bis 0,96). Der Saum, an
  dem das Gelände den Spiegel schneidet, ist 12 cm Tiefe weich; der helle Flachwasserton nur, wo es wirklich flach ist (nach
  dem Quadrat des Durchscheinens): ein Bach oder eine Stufe von zwei Metern zeigt die Körperfarbe statt eines hellen
  Türkis. Flüsse tragen Schwebstoff (etwas grüner und stumpfer als ein See) und sind in der Rinne dunkler als an den
  Rändern
- **Nasser Uferfilm** (Wasser, Meer, Sumpf als weitere Körper, `uWetFilm`): das Gelände macht nur die Ufer des
  Hauptwassers nass. Ein See am Hang oder ein gegossenes Becken traf ein trockenes Ufer: jetzt zeichnet das Wasser über
  der Linie einen dunklen Film mit Glanz zum flachen Blick, 8 bis 40 cm hoch und bis etwa eineinhalb Zellen (Uferschnitt
  auf der trockenen Seite) breit, entlang des Ufers wechselnd und mit ausgefranster Oberkante, ab 150 m ausgeblendet.
  Pixel über der Linie, die vorher verworfen wurden, nehmen einen kurzen Pfad (ein Schaumtexturzugriff)
- **Wellen**: drei Lagen der gekachelten Normalentextur; die feinste blendet zwischen 30 und 160 m Abstand aus (dort
  war sie nur Körnung), Böen (die großräumige Aufbruch-Textur, 17 m) machen Flecken rauer und ruhiger. Auf Flüssen
  liegen die Wellen im Rahmen der Strömung, längs 2,4-fach gestreckt (lange Linien stromab statt runder Kabbelung),
  und statt der Böen treiben Bahnen mit der Strömung (glatte Spiegel und raue Streifen nebeneinander, 9 m breit, 70 m
  lang, in den zwei überblendeten Phasen), in der Rinne ruhiger: der Fluss liest sich auch aus der Spielkamera als
  fließend. Schaumstreifen längs der Strömung erst bei schneller Strömung (langsam wirkten sie wie aufgemalt)
- **Detail ab Medium** (`waterDetail` der Stufe, kein Schalter; Wasser, Meer, Sumpf): tiefes Wasser dunkler (bis
  28 % zwischen 2 und 10 m), der Körper von den Wellen schattiert (Hänge zur Sonne heller, ±20 %), Licht durch die
  Wellen (gegen eine tiefe Sonne leuchten die zum Betrachter gewandten Hänge im Flachwasserton), das Land in der
  Spiegelung, wo kein Spiegelbild der Szene liegt (der gespiegelte Strahl wird 1,5, 4,5, 13,5 und 40,5 m weit über
  die Höhentextur verfolgt, je ein Zugriff auf das nächste Sample, `terrainHeightNear`; trifft er Ufer, Klippe oder
  Hügel, spiegelt das Wasser dort die Bodenfarbe an dieser Stelle, die Mittelfarben der Splat-Schichten nach ihrem
  Gewicht, `terrain/ground-color.ts`, beleuchtet; ferne Hügel dunstiger; nur das Gelände, keine Bäume und Häuser), mit
  Brechung Lichtnetze auf dem flachen Grund (die feine Glitzerlage), auf Flüssen Schaumstreifen längs der Strömung
  über den ganzen Fluss (derselbe Zugriff gestreckt und stromab laufend), Wildwasser, wo er schnell läuft (Gefälle,
  unter einem Fall). Low zeichnet ohne sie. Kosten: vier Höhen- und zwei bis drei Splat-Zugriffe mehr je Wasserpixel
  (vorher 14 bis 17 je nach Gewässer), sonst Arithmetik, kein zusätzlicher Pass
- **Spiegelbild ab High** (`waterReflection` der Stufe, `water/water-reflection.ts`, kein Schalter): die Höhe der
  Flächengewässer, von denen die Kamera am meisten sieht (`water/mirror-choice.ts`, alle 0,25 s: je Wasserkachel im
  Sichtkegel und höchstens 400 m entfernt ihre Wasserfläche durch das Quadrat ihres Abstands, je Höhe summiert;
  Wasser, Meer, Sumpf; Flüsse, Lava und Eis nie) spiegelt die Karte. Gewässer auf derselben Höhe (unter 5 cm
  Unterschied) teilen sich den Spiegel. Eine andere Höhe übernimmt erst mit 30 % mehr im Bild; der Spiegel schaltet
  nie hart: die Höhe, die ihn hat, blendet in 0,4 s aus, dann die nächste ein (`uReflectOn` 0 bis 1). Je Pixel blendet
  er zwischen 60 und 100 % der Reichweite in die über die Höhen verfolgte Spiegelung des Geländes über, so trifft
  fernes Wasser nie auf die Grenze des Spiegels. Ein nicht gespiegeltes Gewässer zeigt seinen Himmel und das verfolgte
  Gelände ab High so stark wie ein gespiegeltes (ruhiges Wasser auch von oben), der Wechsel ändert, was gespiegelt
  wird, nicht wie hell das Wasser wirkt. Vorher spiegelte das Gewässer mit dem meisten Wasser um den Fokus, außerhalb
  dessen Umkreis keins: ein Fluss etwas weiter weg hatte gar kein Spiegelbild, etwas näher sprang es an. Die Wahl
  liest je Kachel einmal deren Fläche aus ihren Dreiecken, danach wenige Dutzend Boxen je Wahl. Der Spiegel: eine Kamera, an seiner Ebene gespiegelt, rendert die Szene in ein Half-Float-Ziel (High 35 % der
  Bildgröße, jedes zweite Bild; Ultra 50 %, jedes Bild), die nahe Ebene schräg in die Wasserebene gelegt (oblique
  Projektion, nichts unter Wasser spiegelt sich), höchstens 400 m weit; der Himmel bleibt (auf der fernen Ebene). Nur
  die Karte: Gruppe, Sichtblocker, Himmel und Lichter; Türme, Gegner und Overlays des Spiels nicht, innerhalb der
  Karte ohne Wasser, Gras, Bodendecals, Partikel, Hitzeflimmern und Objekte, die keine Sicht blockieren (Streu,
  Requisiten, kleine Pflanzen). Im Spiegel-Durchgang wird keine Kopie des Bildes für die Brechung genommen
  (`SceneCopy.without`): sonst nahm ein dort gezeichnetes Flimmern die Kopie vom Spiegelziel, und die Brechung las
  das Spiegelbild in dessen Größe, an Breite und Höhe des Spiegels gerade abgeschnitten (rechteckige Flecken im
  Wasser). Das Wasser liest es über seine projizierte Lage, von den Wellen verschoben; ruhiges Wasser zeigt es auch
  von oben (Anteil mindestens 30 %, Meer 16 %, in rauen Flecken weniger), statt des Himmels und des Landes darin. Das
  Spiegelbild rendert im Zeichnen des ersten Wasserkachels (`onBeforeRender`), so zählt es in die GPU-Zeit des Bildes.
  Kosten (RTX 5080, Dev-Build, Canvas 1100 × 752 High und Ultra, mittlere GPU-Zeit je Bild, Minimum aus zwei Läufen,
  16 Ansichten über Wasser und Lava auf fünf Karten, aus Spielkamera-Höhe und flach): Low 0,66 → 0,68 ms, Medium
  0,69 → 0,67 ms (beide im Rauschen, Draw Calls gleich); High 0,81 → 0,89 ms im Median, in Ansichten mit Spiegelbild
  +0,1 bis +0,4 ms und +23 bis +60 Draw Calls in jedem zweiten Bild; Ultra 0,75 → 1,10 ms im Median, mit Spiegelbild
  +0,4 bis +0,8 ms (Hafenstadt mit vielen Häusern bis +1,3 ms) und +23 bis +62 Draw Calls je Bild. Ohne Spiegelbild
  (sonst gleiche Fassung) liegen High und Ultra bei 0,76 und 0,82 ms, im Rauschen des Ausgangsstands
- **Schaltbare Effekte** (`map-effects.ts`, Ansichtsoption `effects`, `setEffects`, Vorschau `?effects=…`, alle aus
  ohne Angabe): `refraction` (Wasser und Meer zeigen den Grund dahinter, von den Wellen verbogen und nach Tiefe
  getönt; eine Kopie des Bildes nach dem undurchsichtigen Teil, `SceneCopy`, ein Blit je Frame; GPU +0,03 bis 0,06 ms
  bei 1600 × 900), `seaWaves` (Gerstner-Dünung auf dem Meer, drei Wellen 34/21/13 m, zum Ufer flach; nicht messbar),
  `lavaGlow` (die heißesten Adern über 1 für den Bloom-Pass, der Bloom selbst bleibt eine Einstellung des Spiels;
  dazu Hitzeflimmern: ein Blatt 0,4 m über der Lava zeigt die Bildkopie mit aufsteigendem Rauschen verschoben, mit dem
  Abstand schwächer, am flachen Rand aus, `heat-haze.ts`; nah über dem Lavasee GPU +0,03 ms), `shadowCascade` (die
  ferne Kaskade des Sonnenschattens: die gecachte Schattenkarte reicht 70 bis 430 m um die Mitte des gesehenen Bodens, dahinter warf ein
  Berg keinen Schatten. `terrain/far-shadow.ts` backt, wo das Gelände selbst die Sonne verdeckt, über die ganze Karte
  in eine 256er-Textur (ein Byte je Texel, weicher Rand mit der Entfernung; nur der Boden wirft, Bäume und Häuser
  nicht). Der Boden liest sie ab 70 % des Radius der Schattenkarte, ein Lookup; Backen 10 bis 30 ms auf 1025er-Raster,
  nach Sonnenwechsel sofort, nach Höhenänderungen 0,4 s nach der letzten, dann über Tasks verteilt in Bändern von 24
  Zeilen, eine neuere Änderung bricht ab; GPU nicht messbar). Die
  Qualitätsstufen schalten sie, im Menü (Settings, Graphics, Custom maps) kann der Spieler jeden einzeln setzen
  ([RENDER_QUALITY.md](RENDER_QUALITY.md#eigene-teile-je-welt-e156))
- `water` (Standard): klar am Ufer, Kartenfarbe in der Tiefe, Wellen, Spiegelung des Himmels mit Fresnel, Sonnenglanz
  (der scharfe Teil funkelt: feine, schnelle Wellenfacetten fangen die Sonne),
  Uferschaum (siehe unten). Flachwasser ist hell türkis (die Körperfarbe zu 40 % zu `#5fb3a6`; Sumpf
  trüb grün). Der Wasserkörper nimmt bei warmem, tiefem Licht den Farbton der Sonne an (bis 35 % zur eigenen
  Helligkeit im Sonnenton, nur wenn Rot über Blau liegt): bei Dämmerung von oben gedämpft und warm wie die Spiegelung
  aus der Nähe, statt kräftig blau; Tag und Nacht bleiben unverändert (gilt für Wasser, Meer und Sumpf). Das eigene
  Licht des Wassers (Körper, Schaum, gespiegeltes Land; `waterLight` in `water-material.ts`) folgt der Sonne und wird
  mit der Dunkelheit der Szene gedämpft, mit ihrem Quadrat bis auf 30 % (Dämmerung wenig, Nacht stark; Lava nicht):
  vorher hob das Mondlicht einer Nachtkarte die Sonne an, und Hafen und Kanal leuchteten türkis oder grün über
  dunklen Straßen. Laternen auf dem Wasser, Lichtglanz und Spiegelung kommen obendrauf und bleiben; bei Tag
  (Dunkelheit 0) ändert sich nichts. Vorschau: `/map-preview?map=<id>&sky=night&moonlight=1`
- **Strömung** (`flow-map.ts`): jedes Flächengewässer bekommt beim Laden und bei jedem `set` eine gebackene
  Karte auf dem Höhenraster (RGBA8; RG Strömung in Szene x/z, ±1,2 m/s; B Uferabstand bis 32 m, über je 3 Zellen
  geglättet, damit seine Linien die Ecken des Ufers runden; A Steilheit des Ufers bis 1 Zelle daneben, bis 2,5; das
  Uferfeld kostet auf einem nassen 1025er-Raster rund 15 ms mehr):
  Wasser, Meer und Sumpf kreisen entlang der Ufer
  (quer zum Gradienten des Uferabstands; am Ufer still, einige Meter draußen am schnellsten, Engstellen schneller,
  um Inseln herum), Lava wälzt sich in Konvektionszellen (quellenfreies Feld, etwa 30 m). Der Shader schiebt Wellen
  bzw. Kruste in zwei Phasen, die sich überblenden (6 s Wasser, 18 s Lava); Eis steht still. Immer in einem Worker
  (`flow-map.worker.ts`, Kopien von Höhen und Maske; 15 bis 47 ms auf 513er bis 1025er-Raster, auf großen OSM-Welten
  mehr, bleiben so vom Hauptthread): beim Laden sofort (`ready` wartet), nach Änderungen im Editor 0,25 s nach der
  letzten; eine neuere Änderung ersetzt das Ergebnis, bis zur ersten steht das Wasser still
- **Uferschaum** (`foam-noise.ts`, Wasser, Meer, Sumpf; Flächen und Flüsse): Spitze mit Löchern statt einer Linie.
  Eine gebackene, kachelnde Textur (256², RGBA8, einmal auf der CPU): R die Blasen (Abstand zur Wand zweier
  verzerrter Zellraster, grob 9 und fein 22 je Seite, das feine nur fleckweise), G Flecken, B die Reichweite, A feines
  Rauschen. Der Abstand zur Wasserlinie in Metern ist Tiefe durch Uferneigung (Flächen: die gebackene Steilheit,
  Flüsse und Schürze: der Tiefengradient über die Fläche aus den Bildschirmableitungen); an einer Wand die
  geglättete Uferdistanz. Wie weit der Schaum hinausreicht, wechselt entlang des Ufers (0,3 bis 3 m, B im 53-m-Raster;
  Meer x1,5, Sumpf x0,6; am steilen Ufer bis auf ein Drittel), er lässt Lücken (G im 53-m-Raster, etwa ein Drittel des
  Ufers frei) und seine Front läuft das Ufer hinauf und zurück, entlang des Ufers versetzt. Die Dichte fällt zur
  offenen Fläche ab; die Spitze behält, wo das Blasenfeld unter der Dichte liegt (dicht: alles bis auf die
  Blasenmitten, dünn: nur Flocken, das feine Rauschen bricht die Wände), die Blasen ploppen langsam. Zwischen den
  Flocken ist das Wasser milchig, dünner Schaum lässt die Wasserfarbe durch. Deckt ein Pixel mehr als eine Blase
  (Ferne), wird die Schwelle weich (Schaumanteil statt Weiß), und ein Streifen von wenigen Pixeln Breite bleibt ein
  schwacher Schleier statt einer weißen Linie: vorher lief um jedes Gewässer eine mindestens zwei Pixel breite
  Schaumlinie gleicher Breite, aus der Spielkamera ein weißer Rahmen. Auf Flüssen zieht die Spitze in denselben zwei
  überblendeten Phasen wie die Wellen stromab. Kosten: ein bis zwei Texturzugriffe mehr je Wasserpixel (der
  bisherige Schaumzugriff entfällt auf Flächen), kein Pass
- **Uferbänder** (`shore-waves.ts`): breite Schaumbänder laufen über den geglätteten Uferabstand zum Ufer
  (Meer alle 9 m, bis 22 m draußen und 5 m Tiefe, alle 9 s eines; See alle 3,3 m, bis 5 m draußen und 0,6 m Tiefe,
  alle 7 s; Sumpf langsam). Sie entstehen draußen aus dem Nichts, sind entlang des Ufers gewellt und zerfallen in
  dieselbe Spitze wie der Uferschaum (ihre Dichte geht in deren Schwelle ein). Folgten sie der Tiefe, zeichneten sie
  an einer Kaimauer einen dünnen, rechtwinkligen Umriss. An steilem Ufer (Steilheit über 1,3) bleibt wenig Schaum:
  Bänder bis 85 % schwächer, Uferschaum bis 50 %. Das Gelände zeichnet mit derselben Phase den Schwall: nach
  jedem ankommenden Band wird ein Streifen bis 0,3 m über dem Spiegel dunkel und glänzend und trocknet wieder ab
  (nur am Hauptgewässer, `uSwashSpeed`)
- `sea`: stärkere Wellen
- `swamp`: trüb, schwache Spiegelung; Algen und Entengrütze in Flecken nur am Ufer und im Flachen (unter etwa 0,9 m,
  mit verrauschter Kante), halb deckend und dunkler als das Land, nachts kaum sichtbar
- `ice`: deckend und still; hell über flachem, dunkles Petrol über tiefem Grund, mattierte Spiegelung, Schnee im
  Flachen. Nicht ein Eis überall: klare dunkle Flecken über Tiefe, milchige Flecken, Gruppen eingeschlossener Blasen;
  die wandernden Risse wechseln ihr Gewicht und haben eine helle Bruchkante, über Teilen des Sees laufen lange weiße
  Risse zwischen Platten (Zellkanten, vom Rauschen gebogen, die Hälfte verborgen). GPU über dem Eis +0,04 ms
- `lava`: deckend und glühend; dunkle Basaltplatten mit glühenden Rissen dazwischen aus einer gebackenen
  Rauschtextur (`lava-noise.ts`, 256²: R Hitzefeld, G Abstand zum nächsten Riss eines verzerrten, kachelnden
  Zellrasters mit 5 Platten je Seite, BA Verzerrung), deren Koordinaten ein langsam treibendes, atmendes Feld verzieht:
  die Kruste reißt auf und schließt sich. Nicht jeder Riss glüht: wie offen er ist, liest der Shader aus dem Hitzefeld
  am Ort des Riss-Zugriffs (derselbe Texturzugriff, R neben G), also von Riss zu Riss verschieden; geschlossene Risse
  sind dunkle Fugen zwischen den Platten, über heißen Zonen stehen mehr offen (vorher glühte das ganze Netz gleich,
  ein Wabenmuster). Über heißen Zonen sind die offenen Risse breiter und heller, die dünne Kruste schwelt nur leicht
  (vorher färbte sie den ganzen Pool rot), am heißesten schmilzt sie zu offenen Flecken, in denen Krustenschollen
  treiben; die Glut der Risse greift auf die Plattenränder über. Risse bleiben mindestens etwa ein Pixel breit
  (`fwidth`), so werden ferne Ströme nicht schwarz. Die Platten wölben sich von ihren Rissen auf (Relief als
  Höhenfeld; die Normale aus dessen Gradienten über die Fläche, nicht aus den Dreiecken: auf Strömen zeigte das Band
  sonst seine Facetten), glasiger Basalt mit weichem Glanz von Sonne und Himmel. Fließt die Kruste (Strom,
  Konvektion), werden die Risse jeder der zwei Phasen für sich bestimmt und dann überblendet: überblendete Abstände
  glätteten die Kruste mitten im Takt zu rissfreiem Plastik. Farbverlauf Kruste, Dunkelrot, Orange, Gelb nur in den heißesten Rissen (die
  Bloom-Schwelle fängt nur diese; mit `lavaGlow` über 1). Gleich viele Texturzugriffe wie vorher, auf allen Stufen.
  Zum Ufer hin (bis etwa 1,3 m Tiefe) erkaltet sie zu geschlossener, grauerer Kruste, die Risse schließen sich, in
  Wülsten entlang des Ufers. Lava-Körper und -Ströme bekommen
  orange flackernde Punktlichter (je 40-m-Fleck bzw. alle 30 m) aus dem Lichter-Pool

Lava als Bodenschicht: Katalog-Materialien mit `emissive` (0..1) glühen nur in den tiefsten Stellen ihrer Textur
(Risse, Höhenkanal unter etwa 0,27) und pulsieren; die Glut läuft von Dunkelrot über Orange bis Gelb in den tiefsten
Rissen und nicht darüber hinaus (früher Texturfarbe mal Verstärkung, das brannte rosa-weiße Flecken ein), die
Texturfarbe der glühenden Stellen tritt zurück, `flow` (m/s) lässt die Schicht entlang Karten-+x fließen.

### Objekte (`objects/`)

Je Asset, Detailstufe und Modellteil ein `InstancedMesh` für die ganze Karte; die Teile einer Stufe teilen eine
Liste von Instanzen (`instance-list.ts`: Matrix, Farbe, Auflösung im Band, eigene Attribute je Slot). Jedes Objekt
zeigt die Stufe, die seine **Größe im Bild** verlangt: sein Begrenzungsradius durch den Abstand, gegen den Bildanteil
`screen` der `lod`-Modelle des Katalogs (eine Garage nimmt ihr LOD-Modell näher als eine Schule), ein **Impostor**
für ferne Bäume ab 380 m, nichts hinter der Sichtweite (`drawDistance`). Ein weiteres Sichtfeld als 60° schaltet
entsprechend näher. Sichtblocker (Katalog `blocksLos`, je Objekt überschreibbar) liegen in `losBlockers`.

**Draw Calls (V2, ersetzt Zellen und gepackte Assets):** Ein Stufenwechsel verschiebt eine oder zwei Instanzen in der
Liste der Stufe (der letzte seiner Abteilung füllt die Lücke), nie die Liste; hochgeladen wird je Bild ein Bereich je
Attribut, der bis zum Upload durch three offen bleibt (ein verborgenes Mesh lädt nichts, Bereiche je Pinselbild
türmten sich sonst unbesehen). Ein Objekt wird erst wieder angesehen, wenn Kamera oder Fokus so weit gefahren sind wie
bis zu seinem nächsten Band (`slack` aus `blendAt`, `dueAt`): bei ruhender Kamera mit ausgelaufenen Bändern läuft
nichts, bei fahrender nur, wer nahe an einem Band liegt. Die Schattenwerfer stehen in jeder Liste vorn, der
Schattenpass zeichnet nur sie: Objekte nahe dem Fokus (die Schattenbox reicht nicht weiter); `version` zählt nur
Wechsel unter Werfern, die Schattenkarte rendert nur dann neu. Jedes Mesh wird nach den Grenzen aller Objekte seines
Assets verworfen. Stuttgart (OSM, 29 500 Objekte), map-preview High: 9271 Meshes → 808, Spielansicht 922 → 547 Draws
(die 192-m-Zellen zeichneten jedes Asset, jede Stufe und jedes Teil einmal je Zelle und schalteten ganze Zellen auf
einmal). Der Editor pickt über die Grenzkugeln aller Objekte und testet die getroffenen mit ihrem vollen Modell.

**Fernstufe der Gebäude (`far-boxes.ts`, Katalog `far`):** ab dem Bildanteil `far.screen` (4,5 %) zeichnet jedes
Katalog-Gebäude einen Kasten aus 24 Dreiecken: oben ein Raster aus 3 × 3 Höhen (Flachdach, Giebel in beide
Richtungen, Walm, Pult), vier Wände bis zum Fundament, jede mit dem Modell von dieser Seite, oben von oben gesehen,
fünf Kacheln von 64 px je Gebäude in einem Atlas (`models/far-boxes.ktx2`, ETC1S mit Alpha, im Grafikspeicher BC7 statt RGBA). Alle Kästen aller Assets sind EIN
instanzierter Draw (je einer für Sichtblocker und die übrigen); die Form entsteht im Vertex-Shader aus der Vorlage,
der Zeile des Assets in einer kleinen Datentextur und der Instanzmatrix, gleich im Material, im Schatten
(`customDepthMaterial`) und im LOS-Würfel (`userData.losVertex`). Fensterglas (halbes Alpha im Atlas) leuchtet nachts
nach derselben Zellregel wie am Modell. Gebaut von `tools/map-assets/bake_far_boxes.mjs` (Playwright-Chromium, three
lädt die Modelle wie das Spiel, unbeleuchtet): das Raster ist die Kleinste-Quadrate-Fläche über der Oberseite, offene
Randzeilen (Balkone, Vordächer) fallen weg; ein Modell, das der Kasten nicht trägt (L-Form, Turm, Kuppel, Ruine),
bekommt keinen und behält sein LOD-Modell. 76 von 104 Gebäuden haben einen, dazu Rebzeilen und Hecken (fern ein
Block; ihre Lücken im Atlas als Schatten im Laub): Oberbergen, Spielansicht High 7,1 → 1,6 M Dreiecke, 391 → 155 Draws.
101 Modelle ohne LOD (über 1500 Dreiecke, Mauern ab 150) haben eine Fernkopie aus `make_far_lods.mjs`
(meshoptimizer, flach schattiert, Farbe aus `match_lods.py`); Stützmauern 176 → 38 Dreiecke.
Die Stadthäuser (Blockrand `block-row-4/6`, Ecken `block-corner-4/6`) dezimieren ihre Fassaden nicht mehr (E268): das
Zusammenfallen der Kanten machte aus Fensterlöchern und Rahmen Dreiecke. `blender_kit.facade_lod` zeichnet jede
Wandebene als eine Fläche je Material (die Hülle ihrer Teile, eine zurückgesetzte Dachetage und Balkonbrüstungen eine
eigene), Fenster, Türen, Rahmen und Bänke als Rechtecke knapp davor, und dezimiert nur den Rest (Dach, Balkone,
Gauben). Die Fernkopien haben damit 2 bis 48 % weniger Dreiecke (`block-row-4` 1381 → 791).
**Ton der Stufen (E268, Katalog `lod[].tone`, `far.tone`):** die LOD-Modelle tragen das Mittel jeder Textur, aber
nicht die gebackene Verdeckung des Modells, seinen Schmutz (`grime`), Normalen und raue und glatte Stellen; der
Fernkasten ist die unbeleuchtete Farbe des Modells auf einem flach schattierten Kasten. Im Licht des Spiels stand so
ein LOD-Haus 20 bis 60 % heller als sein Modell, eine Hecke als Kasten halb so hell, und beim Stufenwechsel sprangen
Dächer und Wände in der Farbe. Je Stufe ein Faktor für Rot, Grün und Blau gleicht das aus: `object-layer.ts`
multipliziert die Farbe der Materialien des LOD-Modells damit (eigene Materialkopie je Ton), `far-boxes.ts` die des
Kastens im Shader (in der freien Zeile der Datentextur, kein Draw mehr). Gemessen von
`tools/map-assets/stage_tones.mjs`: jedes Objekt allein auf Schwarz in `/map-preview`, jede Stufe an derselben Kamera
erzwungen, 55° von oben aus den vier Diagonalen wie die Spielkamera; der Ton ist das lineare Mittel des vollen
Modells durch das der Stufe, je Kanal, mal dem bisherigen Ton (ein zweiter Lauf verfeinert). `stage-tones.json`,
`stage_tones.py` schreibt ihn in den Katalog (`update_catalog.py` ebenso). Wo eine Stufe anders gebaut ist als ihr
Modell (Formen, die die Dezimierung verliert, offene Bauten als voller Kasten), bleibt der Ton ein Mittel, keine
Gleichheit: er hält die Helligkeit des Ganzen, nicht jedes Teils.
**Schaden (Zerstörung, [DESTRUCTION_PLAN.md](DESTRUCTION_PLAN.md), Z2):** ein beschädigtes Gebäude verlässt den Batch
seines Assets für dessen Ruinen-Batch (`setDamage`, beidseitig, der Schaden im Shader); intakte Instanzen und Fern-Kästen
tragen keinen Schaden und behalten ihre Programme.
Der Wasserspiegel zeichnet je Mesh nur die Instanzen nahe dem Fokus (`nearOnly`, die Schattenwerfer vorn): er reicht
nicht weiter (Stuttgart, Spielansicht: 1,57 → 1,17 M Dreiecke im Spiegel). Gebäude nehmen ihr LOD-Modell dafür
näher (bei 140 m statt 350 m für ein Objekt in Asset-Größe). Stuttgart, map-preview High, Spielansicht: 547 → 339
Draws, 19,4 → 6,6 M Dreiecke; fern 11,6 → 3,4 M.
Dazu werden die Teile eines Modells ohne
Farbtextur mit gleichen übrigen Texturen (oft nur die gebackene Verdeckung des Modells), gleichem Glühen, gleicher
Transparenz und Seitenwahl zu einem Teil zusammengeführt (`merge-parts.ts`): die Farbe als Vertex-Farbe, Rauheit
und Metall als Vertex-Attribut `roughMetal`. Ein Auto mit Lack, Glas, Lichtern und Reifen zeichnet zwei bis drei
statt sieben Teile, ein Haus behält seine texturierten Teile. Hafenstadt in der Spielansicht 1111 → 187 Draw Calls,
Demo-Tal 290 → 155 ([BENCHMARKS.md](BENCHMARKS.md#bildkosten-grafik-benchmark)). Seit dem Zusammenlegen über
Rauheit und Metall (Vertex-Attribut `roughMetal`) zeichnet die Hafenstadt 122 Calls, ein Bürohaus 5 statt 10 Teile.

**Weicher Stufenwechsel (E154, OP-H5, `lod-fade.ts`):** um jede Umschaltdistanz liegt ein Band von 12 % der
Distanz, ebenso an der Sichtweite. Im Band zeigt ein Objekt beide Stufen, die eine löst sich in einem festen
Bildschirm-Dither auf, die andere erscheint im ergänzenden Muster: jedes Pixel zeigt genau eine, nichts springt.
Jedes Objekt blendet nach seinem eigenen Abstand. Der Wert liegt je Instanz im Attribut `lodFade` einer leichten
Geometrie je Mesh, die Puffer des Modells teilt (`fadeGeometry`). Schatten dithern nicht: es wirft die Stufe mit dem
größeren Anteil, und nur nahe der Mitte der Schattenbox (`shadowRadius`). Steht die Kamera 0,15 s still, läuft das Band aus (`settleBlend`): jedes Objekt geht binnen 0,3 s
ganz auf die Stufe, die mehr von ihm zeigt. Das feste Muster steht so nie als Punktfeld auf einem ruhenden Bild
(Hafenstadt, Spielansicht: vorher 44 gepackte Objekte im Band, danach keins). Das Band öffnet sich nur in Frames, in
denen die Kamera sich bewegt, und ein Objekt behält die Stufe, auf der es stand (`holdBlend`, E268): kommt es ins
Band oder hat es sich darin gesetzt, löst es sich erst auf, wenn die Kamera weiter durchs Band fährt, und erreicht am
anderen Rand die andere Stufe wie zuvor. Vorher setzte ein Zoom um eine Raste (die Kamera springt in einem Frame)
Gebäude mitten ins Band; sie zeigten 0,3 s die andere Stufe und kehrten zurück, mit allen Farbunterschieden der
Stufen (Hafenstadt, je Raste 6 bis 42 Objekte, die nach dem Halt der Kamera die Stufe wechselten; danach keins). Die Schwelle
hat damit eine Hysterese von einer Bandbreite.
Kosten: Demo-Tal 151 → 160 Calls in der Spielansicht, beim Schwenk 155 → 171 bis 180; die GPU-Zeit bleibt im
Rauschen des geteilten Messrechners (Spielansicht 1,01 bis 1,06 ms).

**Rand der Schattenbox (E268, `three-engine/shadow-edge-fade.ts`):** der Schatten der Sonne blendet auf den letzten
30 % der halben Breite seiner Karte aus, statt an ihrem Rand abzubrechen (three's `getShadow` für alle Empfänger,
einmal vor dem ersten Programm, `renderer-host.ts`). Von hoher Kamera ist die Box gedeckelt und ihr Rand liegt im
Bild; rastete sie beim Zoomen um, bekamen oder verloren die Gebäude am Rand ihren Schatten auf einen Schlag. Jetzt
wandert ein weicher Übergang mit: OSM-Probe Miltenberg, Raste aus der gedeckelten Höhe, Pixel mit einem Sprung über
30 (von 255) zwischen alter und neuer Box 2965 → 1075, das 99,9-%-Quantil 59 → 36. Ganz weg ist der Wechsel nicht,
dafür müsste die alte Karte in die neue überblenden (zwei Karten in jedem Empfänger). Renderzeit (render plus
`gl.finish`, Median, gleiche Kamera) vorher 1,13 ms, danach 1,24 und 1,28 ms; näher gezoomt vorher 1,29, danach
1,21 ms: im Rauschen des geteilten Rechners. Der Preis: wo der Rand der Box im Bild liegt (zur fernen Seite hin, wo
ihre Reichweite endet), sind die Schatten auf den letzten 30 % davor schwächer; die Bildmitte bleibt gleich.

Impostor (`impostor.ts`, oktaedrisch): das Modell aus 8 x 8 Richtungen über der oberen Halbkugel (hemi-oktaedrisches
Raster) in zwei Atlanten gerendert (mit 4x MSAA gezeichnet, in ein Ziel ohne MSAA kopiert, im Farbatlas leere
Pixel aus den belegten derselben Ansicht aufgefüllt, damit Mipmaps zur Kronenfarbe mischen; im Normalatlas nicht, dort
ist Alpha die Tiefe): Farbe mit Deckung und, in halber
Größe, Normale im Modellrahmen mit der Tiefe vor der Kartenebene. Laubkarten backen mit ihrer gesetzten Normale und
blenden von der Kante gesehen aus wie im Spiel. Gezeigt als eine Karte, die sich zur Kamera dreht; sie nimmt die vier
Ansichten um die Blickrichtung und mischt sie nach Nähe, von unten gelten die Ansichten am Horizont. Beleuchtet wird
je Pixel mit der gebackenen Normale; Schnee legt sich nach ihr (`SURFACE_VIEW_NORMAL` in `height-fog.ts`). Wo die
Schattenkarte reicht, beschattet sich die Karte selbst: ein Punkt liegt in seiner Tiefe, und die Ansicht nächst der
Sonne sagt, ob die Krone zwischen ihm und der Sonne steht. Pixel je Ansicht: 128 für Bäume und große Felsen ab 1400 px
Zeichenhöhe, sonst 64 (`impostorCell`). Beim Backen zeichnet eine Probe Modell und Karte unter den Lichtern der Karte
(Sonne, mindestens 0,12 hoch, Himmel, Umgebungslicht, Environment-Map, gemeinsam so skaliert, dass Weiß nicht
abschneidet) ohne Schatten aus acht Richtungen rundum, denn Impostoren stehen jenseits der Schattenkarte (mit
Eigenschatten gemessen war der ferne Wald in Autumn Keep 6 % dunkler als seine Bäume, jetzt wie Frost und Demo-Tal
unter 1 %); Metall aus einer ORM-Textur zählt dabei 0: die Alpha-Schwelle der Karte ist die, unter der sie so viel deckt wie das Modell (vier
gemischte Ansichten decken mehr als jede einzelne, eine lichte Krone wurde voll und reiner in Laubfarbe), der Ton
(`uImpTone`) das Verhältnis der Mittelfarben je Kanal. Im Schattenpass dreht sich die Karte zur Sonne (eigenes
`customDepthMaterial`) und wirft den Umriss von dort. Die gesehene Karte liest den Schatten anderer Werfer einen Radius
näher zur Sonne (`IMPOSTOR_SUN`), den eigenen nimmt sie aus dem Atlas. Die Geometrie hält weiter zwei gekreuzte Karten
in Modellgröße: was das Mesh mit eigenem Material zeichnet (der LOS-Würfel), sieht diese. Gebacken wird einmal je
Asset für beide Objektschichten der Ansicht (`ImpostorCache`, Karte und Randbäume), Programme vorab abseits des
Hauptthreads, die Probe ohne Stau gelesen. Speicher (Atlanten mit Mipmaps): 1,7 MB je Impostor bei 64 px, 6,7 MB bei
128 px; die Karten mit 9 bis 12 Impostoren bei 900 px Zeichenhöhe 15 bis 20 MB statt 16 bis 24 MB vorher (dort backte
jede Schicht ihre eigenen). Braucht den Renderer (Ansichtsoption `renderer`).

**Alle Impostoren in einem Draw (`impostor-array.ts`):** frisch gebacken kopiert der Cache die beiden Atlanten eines
Assets in je eine Ebene zweier Textur-Arrays seiner Ansichtsgröße (Farbe sRGB, Normale und Tiefe linear, mit Mipmaps)
und gibt sie frei; je Ebene hält eine kleine Datentextur Mitte, Radius, Ton, Alpha-Schwelle, Rauheit, Metall und die
Maße der gekreuzten Karten. Der Shader aus `impostor.ts` liest sein Asset über Makros (`ImpostorAccess`): die Probe
beim Backen aus den eigenen Uniforms, die Karte aus Ebene und Zeile (`IMPOSTOR_ARRAY`). Jede Objektschicht zeichnet
alle Impostoren einer Ansichtsgröße und eines Sichtflags in einem Mesh (`ImpostorDraws`, gemeinsamer Draw wie die
Fern-Kästen, `shared-draws.ts`), Schatten und LOS-Würfel (`userData.losVertex`, die gekreuzten Karten aus der Zeile)
mit derselben Form. Volle Arrays wachsen, indem ihre Ebenen in größere kopiert werden. Stuttgart und Oberbergen, High:
14 bis 19 Draws weniger je Ansicht, Bild gleich.

Materialien (`objectMaterial`): Bäume und Pflanzen bewegen sich im Wind der Karte: Stamm und Krone als Ganzes (der
Stamm biegt sich quadratisch mit der Höhe, steif), sie neigen sich mit dem Druck des Windes an ihrem Ort (Böenfronten
laufen über die Karte) und schwingen langsam um diese Neigung, etwas auch quer dazu; je höher die Pflanze, desto
langsamer (ein 8-m-Baum etwa einmal in vier Sekunden, Kreisfrequenz 1,6 x Wurzel aus 8 / Höhe). Äste abseits der
Stammachse biegen sich etwas weiter und wippen langsam für sich, je Ast als Einheit (die Phase wechselt über einige
Meter, nicht von Vertex zu Vertex); nur Laubkarten flattern, je Karte als Ganzes. Vorher flatterte jeder Vertex
jedes Baums mit eigener schneller Phase, und die Äste schwangen mit mehr als einer Schwingung je Sekunde: Nadelwälder
wobbelten und flimmerten. Dazu liest die schwingende Pflanze den Sonnenschatten an ihrer Ruhelage
(`shadowmap_vertex` mit der Weltposition vor dem Schwingen): die Schattenkarte hält die Pflanzen in Ruhe (threes
Tiefenmaterial kennt kein Schwingen, und die Karte ist über Bilder gecacht), ein Zweig glitt sonst beim Schwingen in
den Schatten seiner eigenen Krone hinein und wieder heraus. Wie weit die Spitze im starken Wind (Druck 1) ausschlägt, rechnet `windSwayAtTop` aus
Katalog-`wind` und Modellhöhe: ein schlanker 18-m-Baum etwa 1 m, eine Eiche (12 m, `wind` 0,5) rund 0,3 m; kleine
Pflanzen schwingen im Verhältnis stärker. Alle Detailstufen eines Modells schwingen mit derselben Rechnung (kein
Sprung beim Stufenwechsel); Impostoren ab 380 m stehen still. Seitliches Biegen senkt die Spitze etwas (Länge bleibt). Laubkarten (`foliage-*`) behalten ihre
Normalen auch auf der Rückseite (three dreht sie bei doppelseitigen Materialien um, das machte Kartenrücken schwarz),
werden alpha-getestet mit Alpha-to-Coverage und blenden aus, wenn man sie von der Kante sieht oder sie die Sichtweite
erreichen; Wasserfall-Karten (`foliage-waterfall*`) fließen, leuchtende Laubkarten (Flammen) flackern. Windstärke und
Ausblendung sind Uniforms, alle Assets teilen sich wenige Shader-Programme. Vegetation bekommt je Instanz eine
leicht andere Helligkeit, einen Farbton und eine Größe (Bäume 0,88 bis 1,12, Pflanzen 0,92 bis 1,08), Bäume dazu eine
Kronenbreite (0,88 bis 1,12, in x und z bis 6 % verschieden, als ungleiche Skalierung der Instanz), eine Neigung (bis 4°,
die meisten fast aufrecht) und im Shader eine Ausbeulung der Krone (oberhalb von 30 % der Höhe, 5 % der Höhe, Phase aus
dem Ort; vor der Ruhelage, nach der der Schatten gelesen wird), so trennen sich die Bäume eines Modells auch im Umriss.
Bäume wachsen in Beständen eines Alters: wer Bäume setzt (Streupinsel des Editors, OSM-Wälder), nimmt ihre Skala aus
dem Ort (`map-ops/tree-stands.ts`: weiches Wertrauschen über Zellen von 42 m; die Mitte des Skalenbereichs mal 0,68 für
einen jungen bis 1,3 für einen alten Bestand, der Baum selbst 0,92 bis 1,08 davon; im Mittel die Mitte des Bereichs).
Das steht als `scale` im Dokument: fertige Karten behalten ihre, Level-Skripte (map-kit) streuen wie bisher. Laub mit
Katalog-Tag `autumn` streut weiter zwischen Rot, Rost und Gelb und in der Helligkeit. Alles in Instanz-Matrix und -Farbe aus einem Hash der Objekt-Id
(`instance-variation.ts`, kein Draw Call mehr, Impostoren tragen dieselbe Instanzfarbe; Sichtlinien sehen die
Bäume so, wie sie gezeichnet sind, die Ausbeulung nicht). **Fernkopien der Bäume**: die Laub- und Nadelbäume aus
`broadleaf` und `conifer` (`build_nature.py`) haben ein handgebautes `-lod1` mit etwa einem Drittel der Dreiecke (Laub:
Stamm auf sechs Seiten, nur Hauptäste, je Blattbüschel vier größere Karten, keine dunklen Innenkarten (zwei Teile, zwei Draws); Nadel: jeder zweite Quirl mit einer Karte je
Ast und dem Kreuz auf jedem zweiten), in der Spielansicht ab etwa 175 m (`screen` des Katalogs; der Impostor bleibt bei 380 m: die Kopie halbiert die Dreiecke der Bäume davor, statt den Impostor hinauszuschieben, was auf Demo Valley eine Million Dreiecke mehr zeichnete). Ihre Materialien heißen
wie die des Modells: `lodModels` gibt ihnen dessen Materialien (`sharedMaterials`, keine zweite Texturkopie, dieselben
Programme), ihre Texturen packt `pack-map-models.mjs` in der Größe des Modells (`lodSharesTextures`): dieselben
geteilten KTX2-Dateien. Die Drehung
um die Hochachse kommt aus dem Dokument (Biom-Pinsel und Pinsel mit Zufallsdrehung). **Fenster bei Nacht** (`night-windows.ts`): das
Fensterglas der Gebäude (Materialien `window-glass…`, `window`; in zusammengelegten Teilen je Vertex `nightGlow`)
leuchtet mit der Dunkelheit warm, etwa jedes zweite Fenster nach einem Hash seiner Zelle in der Welt (2,5 m breit,
3 m hoch), auch an Teilen, die schaukeln oder sich drehen (ein Schiff auf dem Wasser): wenige Shaderzeilen, kein Licht, kein Draw Call. Gebäude stehen auf dem tiefsten von acht Punkten ihres Fußabdrucks (Ecken und Seitenmitten ihres gedrehten Rechtecks `box`, in die Scheibe gezogen, `object-ground.ts`; ohne `box` acht Punkte der Scheibe), ihre
Fundamente reichen bis 1,5 m in den Boden. Zäune und Mauern, die keine Sicht sperren und keinen Tower tragen, folgen
dem Hang (`wallShear` in `object-seat.ts`): die Steigung zwischen dem Boden unter ihren beiden Enden (lange Seite des
`box`) als Scherung der Instanzmatrix, Pfosten bleiben senkrecht, Latten und Fuß laufen am Boden entlang, der Fuß sitzt
an beiden Enden 4 cm tief und sinkt mit, wo der Boden dazwischen tiefer liegt (Steigung höchstens 0,7). Vorher steckte
ein Zaun am Hang mit einem Ende im Boden. Sichtsperren (Burgmauern, Palisaden) und was Tower trägt bleiben waagerecht:
was Sichtlinie und Bauregeln sehen, ändert sich nicht. Die Größen im Katalog prüft `asset-scale.spec.ts` gegen die Welt
(Pilze eine Hand hoch, Laterne 3,4 bis 6 m, Bank, Auto, Fass, Zaun, Tür, Bäume); Pilze sind darauf kleiner gebaut
(0,2 statt 0,5 m), die Laterne steht auf einem Pfosten von 14 statt 20 cm.

**Gebäude aus dem Grundriss (E235, `mass-layer.ts`):** ein Objekt kann seinen Bau selbst tragen (`mass`, Asset
`building-mass`): Außenring und Höfe in den Achsen des Objekts, Wandhöhe, Geschosse, Dach (flach mit Attika, Sattel
oder Walm über einem Rechteck, Mansarde über jedem Umriss ohne Hof), Fassade (Putz, Beton, Blech, Ziegel, Sandstein,
Fachwerk über verputztem Erdgeschoss), Wände mit Laden im Erdgeschoss (`shop`, Indizes der Außenwände: Schaufenster
statt Fenster). `massFronts` gibt die Außenwände auf der Karte mit Normale, Erdgeschoss- und Brüstungshöhe des ersten
Stocks (`sill`) und Index (`edge`), etwa für Schilder. Was die Regeln brauchen, rechnet
`object-mass.ts` aus den Ringen wie der Katalog für Modelle: Grundrechteck, Radius, Höhe und das Dachraster für Tower
auf dem Dach (Hof ohne Dach). Bauverbot (`CustomMapSurface`) und Editor-Prüfung (`objectsOnPaths`) nehmen den Umriss,
nicht das Rechteck: ein Tower darf in den Hof. Zerstörung als Zylinder gleicher Fläche und Höhe, Verdeckung am Boden
und Wetterschutz nach dem Umriss, Szenenkosten mit den eigenen Dreiecken. Gezeichnet werden alle Bauten einer Karte
als wenige instanzierte Grundformen: jede Wand eine Instanz eines Einheitsquads (die Instanzmatrix streckt es entlang
der Wand und bis zur Traufe, ihre dritte Spalte ist die Außennormale), jedes Dachdreieck eine Instanz eines
Einheitsdreiecks (affine Matrix, zweite Spalte die Dachnormale), Attika als nach innen gewandte Wand mit
Betonabdeckung; ein Giebel ist ein Wandquad, dessen obere Ecken der Vertex-Shader zur Mitte zieht (auch im
Schattenpass). Je Fassade, Abdeckung und Dachdeckung ein Mesh: eine Karte mit 2 000 solchen Bauten zeichnet in rund zehn
Calls (dazu der Schatten). Keine Detailstufen: Wand und Dach sind wenige Dreiecke, die Fenster kommen aus dem Shader
(Geschosse und Achsen in Metern je Wand, mittig mit Rand an den Ecken; Rahmen, Fensterkreuz, Bank, Laibung, Jalousie,
Sockel, Gesims, Ecklisenen, Schmutz über dem Sockel und unter den Bänken, Eingang mit Vordachschatten an langen
Wänden; Hallen eine hohe Fensterreihe, Sandstein hohe Rundbogenfenster; nachts Fensterlicht wie `night-windows.ts`)
und gehen in die Mittelfarbe über, wo ein Fenster nur ein paar Pixel misst. Die Oberflächen sind die Texturen des
Katalogeintrags `building-mass` (je Oberfläche ein Quadrat so breit wie eine Wiederholung ihrer Textur,
`build_modern2.py`), Blech nimmt seine Tönung als Lack (eigene Farbe heraus, Licht und Schatten bleiben). Im Spiegel
der Objektebene (`MapObjectLayer`) laufen sie über dieselben Aufrufe (Setzen, Ändern, Picken, Höhen); eine Änderung
baut alle Bauten neu (wenige ms), eine Höhenänderung verschiebt nur die betroffenen Instanzen.

**Schilder** (`sign-text.ts`, `sign-icons.ts`): ein Objekt mit `sign: { text?, icon? }` schreibt auf die Schildfläche
seines Modells (Katalog `signPanel`: Mitte, Breite, Höhe im Modellrahmen, Blickrichtung, `sides: 2` für ein hängendes
Schild, `ink`). Wort in der Spielschrift (Barlow Semi Condensed 700, höchstens 24 Zeichen) und Piktogramm (rund 40,
von Hand mit wenigen Strichen gezeichnet, keine Marken) liegen als Masken in einem Atlas (R8, 1024 breit, höchstens
2048 hoch, eine Zelle je Beschriftung und Flächenform), gezeichnet als instanzierte Quads 6 mm vor der Fläche: ein
Draw Call für alle Schilder einer Karte; die Tafeln sind die Objekte selbst. Tinte aus `ink`, sonst dunkel auf hellem
und hell auf dunklem Brett (die Farbe des Bretts ist das `tint` des Objekts). Die Schrift nimmt Licht, Schatten und
Nebel wie das Brett und blendet zwischen 160 und 220 m aus. Flächen tragen `sign-facade`, `sign-bracket`,
`shop-small` und `shop-office`; die Asset-Vorschau schreibt auf sie (`?sign=Wort,piktogramm`).

### Effekte und Lichter (`effects/`)

Aus Katalogeinträgen mit `effects` und `light` (auch Einträge ohne Modell, `file: ''`, Kategorie `fx`):

- **Partikel** `fire`, `smoke`, `embers`, `sparks`, `fireflies`, `fog`, `leaves`, `snow`, `sparkle`: je Art ein instanziertes
  Feld für die ganze Karte. Zustandslos: jedes Teilchen läuft per Zeit und Zufallswert im Vertex-Shader durch sein
  Leben, die CPU schiebt nur eine Zeit-Uniform. Leuchtende Arten additiv, beleuchtete (Rauch, Nebel, Laub, Schnee)
  werden nachts dunkler. `radius`, `height`, `rate`, `color` je Effekt; `at` setzt den Effekt neben den Ursprung
  (x und z des Modells, mit dem Objekt gedreht und skaliert): so raucht der Schornstein der Häuser (`house`,
  `house-large`, `cottage`, `house-stone`, `house-tall`, die Schnee-Varianten, `watermill`, `log-cabin`, `alpine-hut`,
  `fisher-hut`, `house-stone-balcony`; Lage aus `build_structures.py` `house()`). Steht schon ein von Hand gesetzter
  Rauch (`fx-smoke`, `MapKit.chimney`) im Fußabdruck des Hauses plus 2 m, raucht nur der gesetzte
- **Rauchsäule** (`column`, Objekt `fx-smoke-column`, 40 m bei Skalierung 1): eine hohe, ziehende Säule je Objekt,
  alle Säulen der Karte in einem instanzierten Feld (ein Draw Call). Die Puffs steigen von einem Fuß mit `radius`
  bis `height` auf, unten schnell, oben langsamer, werden breiter und größer, neigen sich mit der Höhe immer weiter
  in den Wind und wandern als Ganzes; unten dicht und dunkel, oben heller und dünner, oben weich ausgeblendet. Ihre
  Phasen liegen gleichmäßig über die Lebenszeit verteilt (kein Loch in der Säule), jeder Puff ist von zwei Lagen
  hochlaufendem Rauschen zerrissen statt einer runden Scheibe. Steht die Säule auf Lava, glüht ihr Fuß orange, trägt
  das Objekt ein Licht, in dessen Farbe; nachts stärker. Skalierung macht Säule und Puffs größer, die Zahl wächst nur
  linear (`rate` 8 je Sekunde, 16 s Leben: 128 Puffs). Tönung färbt den Rauch. Kosten auf Ember Crater (3 Säulen,
  269 Puffs, High): +1 Draw Call, Renderzeit im Rauschen (unter 0,1 ms auch nah vor der Säule). Ersetzt die früher
  gestapelten `fx-smoke`, die im Standbild fleckig wirkten; ein `fx-smoke` bleibt für kleinen Rauch (Schornstein,
  Glut)
- **Wasserfall** (`waterfall`): gebogene Fläche von der Kante (`height`) bis zum Fuß, Breite 2 × `radius`, fällt zur
  Vorderseite (+z) des Objekts und wird nach unten etwas breiter, in der Mitte leicht nach vorn gewölbt, dahinter eine
  schmalere zweite Fläche mit versetzten Streifen; zwei Lagen Streifen laufen herab (langsamer Körper,
  schnelle helle Front), darüber feine Fäden, zwischen den Streifen wird die Fläche dünner; an der Kante glatt und
  glasig mit einem Lichtband, wo das Wasser über sie kippt, nach unten zerfällt es in Streifen und bricht weiß; keine
  Ecken: die Seiten fransen mit einer laufenden Welle aus,
  die Kante beginnt dünn, der Fuß löst sich in der Gischt auf. Die Fläche taucht nicht in den Hang: fällt vor ihr eine
  steile Flanke statt einer Wand ab (die Kaskade des Fluss-Werkzeugs), rückt jede Zeile nach vorn, bis sie höchstens
  0,25 m im Boden und mindestens 0,2 m über dem Flussband liegt, höchstens so weit, wie der Fall hoch ist; ein Ufer oder
  ein Becken davor, das nicht abfällt, hält sie nicht auf. Gischt am Aufprall und eine breitere, langsame
  Nebelwolke, beide auf der Fläche, auf die das Wasser trifft (der Spiegel, wenn er am Fuß liegt oder höchstens
  max(3 m, halbe Fallhöhe) darüber, sonst der Boden; liegt der Boden mehr als 1 m über dem Fuß, keine); liegt der Fuß über stillem
  Wasser (Spiegel am Scheibenrand höchstens 0,3 m anders), eine Scheibe aus wirbelndem Schaum darauf, über einem
  abfallenden Fluss keine. Trifft der Fuß die Kante eines anderen Wasserfalls (eine Stufe einer Kaskade), weder Gischt
  noch Scheibe: das Wasser läuft dort die nächste Fläche hinab, Schaum hinge sonst vor der Klippe in der Luft.
  **Lavafall:** steht Lava unter dem Fuß oder an der Lippe (ein Wasserfall, gesetzt über einer Kante in den Lavasee),
  zeichnet dieselbe Fläche geschmolzenen Fels: dunkle
  Krustenplatten gleiten langsam über glühende Ströme, hell an der Lippe und am Fuß, ohne Tag-Nacht-Dämpfung; am Fuß
  Glut und etwas Rauch statt Gischt, keine Schaumscheibe (Attribut `aLava`, ein Zweig im selben Shader)
- **Lichtkegel** (`beam`, `effects/light-beams.ts`): zwei Kegel gegenüber aus der Lichthöhe (`height`), `radius` lang,
  drehen sich mit den drehenden Teilen des Objekts (unten), additiv, mittig heller, nur bei Dunkelheit; ein Mesh für
  alle. Der Leuchtturm hat einen (Höhe 20 m, 70 m lang, eine Umdrehung in 10 s)
- **Lichtsäule** (`shaft`, `effects/light-shafts.ts`, Objekt `fx-light-shaft`: 1,5 m breit, 40 m hoch bei Skalierung
  1, mit flackerndem Licht am Fuß): eine offene, nach oben leicht weitere Röhre aus Licht vom Fuß des Objekts, additiv,
  quer durch die Mitte gesehen am hellsten (so liest sich beleuchtete Luft), nach oben ausklingend; Lichtbänder steigen
  langsam, die Säule atmet. Am Tag schwächer, nachts voll, nah an der Kamera ausgeblendet. Farbe: die Tönung eines
  Effekt-Objekts, sonst die des Effekts oder des Objektlichts; ein Mesh für alle. Die Tönung eines Effekt-Objekts färbt
  auch sein Licht (Schein und Punktlicht). Ember Crater: die Säule aus dem Höllentor
- **Drehende Teile** (`objects/spin.ts`): Teile eines Modells mit Material `spin-…` drehen sich im Vertex-Shader um
  die senkrechte Achse durch den Ursprung des Modells, eine Umdrehung in `spin` Sekunden (Katalog, Standard 8), jedes
  Objekt mit eigenem Startwinkel aus seiner Lage, auf der Uhr des Winds (das Standbild hält sie an); sie werden nicht
  mit anderen Teilen zusammengelegt (`mergeKey`). Radarschüssel und Leuchtturm-Linse liefert die Modellseite (E179)
- **Rotoren** (`objects/rotor.ts`): Teile mit Material `rotor-…` drehen sich um eine eigene Nabe, eine Umdrehung in
  `rotor` Sekunden (Katalog, Standard 8): Flügel der Windmühle (11 s), Wasserrad (14 s), Windrad (4 s). Nabe und Achse
  stehen nicht im Modell, sie folgen aus der Form: ein Rotor ist drehsymmetrisch (Flügel, Schaufeln, Blätter sind
  gedrehte Kopien), also liegt das Mittel seiner Ecken auf der Achse, und er ist quer zur Achse flach, also läuft sie
  längs seiner dünnsten Ausdehnung; alle Rotorteile eines Modells teilen eine Nabe (`rotorHub`, jede Ecke trägt sie in
  `aRotor`). Gedreht im Vertex-Shader auf der Uhr des Winds, jedes Objekt mit eigenem Startwinkel; der Schatten dreht
  mit (eigenes Tiefenmaterial, `rotorDepthMaterial`). Anders als `spin` ebnet `rotor` den Boden nicht (ein Windrad ist
  kein Gebäude). Modellseite: `rotor-`-Materialien mit Werten, die kein anderes Material des Modells hat
- **Ansichten im Atlas** (`variants`, `objects/atlas-variants.ts`): die gebackenen Texturen eines Modells halten
  `variants` Ansichten desselben Netzes im Raster (2 x 2 für vier; `blender_kit.bake_surface`), die UVs zeigen die
  erste Zelle. Jede Instanz liest im Vertex-Shader die Zelle, die ein Hash ihres Standorts wählt: eine Herde aus einem
  Kuhmodell zeigt Holstein, Fleckvieh, Braunvieh und Angus ohne Draw Call, Textur oder Instanzdaten mehr, auf jedem
  Client gleich. Nur für Objekte, die stehen bleiben (nicht für schwimmende)
- **Lichter** (`light`: Farbe, Stärke, Reichweite, Höhe, `flicker`, `blink`): jedes bekommt einen additiven Schein (am Tag
  schwach, nachts voll); dazu ein Pool von bis zu 6 echten Lichtern (Stufe: 2, 4, 6, 6) für die Lichter nächst dem
  Kamerafokus, nach Dunkelheit eingeblendet (Nacht, Dämmerung, tiefe Sonne). Sie gehen als feste Lichter in den
  Lichtpuffer der Szene (`EffectLayer.steadyLights`, [SHOT_LIGHTS.md](SHOT_LIGHTS.md)), kein three-`PointLight`: am
  Tag kosten sie nichts, und keine Zahl von Lichtern baut ein Programm neu. Abfall wie im Puffer: Kern so breit wie
  die Höhe über dem Boden (darunter weich statt einer weißen Scheibe), weiter weg wie das Punktlicht vorher
  (Candela durch Abstand²), Reichweite das 1,25-Fache des Katalogs. Ein Poollicht blendet aus, je näher es dem Abstand des nächsten ausgelassenen Lichts kommt (ab 0,7
  davon, `poolFade`), so wechselt das echte Licht beim Schwenken an einer Fackelreihe weich statt Fackel für Fackel
  umzuspringen (die Mauer neben einer Fackel sprang von hell auf dunkel). `blink` (Sekunden): ein kurzer Blitz je Periode (Schein und Punktlicht, auch am Tag gut sichtbar),
  backt kein Licht auf den Boden; Antennenmast und Positionslicht (`beacon-post`) blinken alle 1,5 s (der
  Flutlichtmast hat keine roten Lichter und leuchtet stetig), die Bojen wie Seezeichen (rot alle 2,5 s, grün alle 4 s,
  jede Boje mit eigener Phase), `fx-beacon` setzt ein blinkendes Licht frei
- **Leben aus dem Karteninhalt** (`CustomMapView.refreshAmbient`, ohne Bearbeiten): Glühwürmchen nachts (ab
  Dunkelheit 0,35) über den Ufern von Seen und Sümpfen (alle 12 m) und mitten in Wäldern (30-m-Quadrate mit mindestens
  6 Bäumen), höchstens 60 Schwärme, in den Biomen temperate, swamp, mountain. Vogelschwärme am Tag
  (`effects/bird-flocks.ts`): ein instanziertes Mesh für alle (ein Draw Call), Flug, Flügelschlag und Gleiten im
  Vertex-Shader auf der Uhr des Winds (ein Standbild hält sie an). Jeder Schwarm fliegt eine geschlossene Schleife,
  64 Punkte gleichmäßig über ihre Länge in einer Float-Textur (eine Zeile je Schwarm, höchstens 64 Schwärme); die Vögel
  weichen seitlich und in der Höhe von ihr ab, die ganze Schleife driftet langsam. Je ein Schwarm je 300-m-Quadrat
  Karte (höchstens 5) über dem Land mit den wenigsten Bäumen, 45 m und höher, Kreise von 40 bis 56 m, deren Mitte
  langsam wandert; näher als 45 m an der Kamera klappen sie weg, nachts und mit der Pflanzenbewegung „aus“ sind sie
  fort; nicht auf dem Mond, Mars und in der Hölle. Stufe Low (Partikelanteil unter 0,7): keine Vögel, weniger
  Glühwürmchen. Gesetzte Schwärme (Effekt `birds`, `fx-birds`, ein Kreis) und gesetzte Glühwürmchen ersetzen die
  automatischen (LEVEL_EDITOR.md, Objekte), ebenso die der Lebensbereiche (unten). Glut über Feuern und Lava,
  schaukelnde Boote und Wimpel im Wind gab es schon (Katalog `effects`, `float`, `wind`)
- **Lebensbereiche** (`doc.life`, `map-life.ts`, `effects/life-areas.ts`; im Editor das Werkzeug Life, LEVEL_EDITOR.md):
  ein Umriss (`shape: 'area'`), den das Leben füllt, oder eine Linie (`route`), der es folgt, je mit Art, Dichte
  (0,1 bis 3), Höhe, Farbe und der niedrigsten Stufe, die es zeigt (`quality`: Medium, oder High). Vögel: ein Umriss
  gibt eine Schleife in seinem Inneren (neun Strahlen aus der Mitte, je 0,5 bis 0,9 des Wegs zum Rand, als
  Catmull-Rom-Kurve; ein stark eingebuchteter Umriss kann an einer Bucht etwas hinausragen), 10 Vögel je Dichte 1;
  eine Linie eine Schleife auf ihr hin auf der einen Seite und auf der anderen zurück (12 m daneben), 8 Vögel; Höhe
  über dem höchsten Boden der Nachbarpunkte der Schleife (Standard 40 m), damit ein Schwarm über einen Kamm fliegt.
  Art (`species`, `BIRD_LOOK` in `bird-flocks.ts`, Farbe, Größe, Flügelschlag, Gleitanteil, Tempo je Vogel als
  Instanzattribut, weiter ein Draw Call): Singvögel (Standard), Möwen (hell, 1,5-fach, gleiten öfter), Krähen und
  Raben (schwarz, 1,3-fach), Greifvögel (braun, 2,6-fach, meist gleitend, 0,6-fach so schnell, ein Drittel der Zahl,
  Standardhöhe 80 m, weiter gestreut), Fledermäuse (`bats`, fast schwarz, 1,2-fach, schneller Flügelschlag, schlagen
  Haken zur Seite und auf und ab, Standardhöhe 14 m, nur bei Nacht: sie kommen mit der Dunkelheit, die Vögel gehen;
  gesetzte Fledermäuse lassen die Vögel der Karte am Tag fliegen). Witch Marsh: über den großen Inseln, um die
  Riesenweide und über dem offenen Wasser.
  Partikel (`fireflies`, `fog`, `leaves`, `embers`, `sparks`): Emitter auf einem verwackelten Raster im Umriss oder
  entlang der Linie (Abstand je Art 8 bis 28 m, höchstens 160 je Bereich), auf dem Boden oder der Wasserfläche; sie
  gehen in das Feld ihrer Art (eine Art, die die Karte schon hat, kostet keinen Draw Call mehr); Glühwürmchen nur
  nachts wie die automatischen. Funken (`sparks`, neu): stoßweise hoch und zurück, nachts hell, am Tag schwach.
  Schneegestöber (`snow`, alle 12 m, aus 14 m Höhe). Staubteufel (`dust`, neue Partikelart): je 70 m ein Wirbel, der
  etwa 40 m um seine Stelle wandert, Staub schraubt sich bis 18 m hoch und weitet sich oben; jeder lebt etwa 40 s je
  Minute; alle Teilchen eines Wirbels teilen sich dessen Bahn über einen Wert aus seiner Stelle. Brandung (`surf`, neue
  Partikelart, auch als Objekt `fx-surf` für einen Felsen): alle 9 m eine Stelle, von der Oberfläche (Wasser über dem
  Boden) aus; alle 7 s bricht eine Welle (jede Stelle mit eigenem Takt aus ihrer Lage), ihre Gischt steigt in den
  ersten 2,8 s bis 1,5 bis 6 m hoch, hängt, fällt zurück, weitet sich und treibt mit dem Wind; jede Welle an einer neuen
  Stelle der Scheibe. Archipelago: 3 m vor jeder Felsküste. Hitzeflimmern (`haze`,
  `effects/life-haze.ts`): ein Tuch 0,6 m über dem Boden im Umriss (Raster alle 4 m, höchstens 40 000 Punkte) oder in
  einem Band 8 m beiderseits der Linie, mit dem Shader des Lava-Flimmerns (`heatHazeMesh`, `water/heat-haze.ts`), am
  Rand über 12 m ausgeblendet; es liest die Bildkopie der Brechung und steht daher nur mit dem Effekt „Lava glow and
  heat haze“ (High, Ultra oder der Schalter des Spielers), aus der Spielkamera schwach.
  Boote (`boats`, `effects/life-movers.ts`): je Boot eine eigene langsame Schleife im Umriss (0,5 bis 1,2 m/s; 4 Boote
  je Dichte 1, höchstens 24) oder auf einer Linie auf der einen Seite hin und auf der anderen zurück (4 m daneben,
  1,5 bis 2,5 m/s, 3 Boote), auf dem Spiegel des Wassers darunter (über Land behalten sie den des letzten Wassers),
  Bug voraus, mit dem Schaukeln schwimmender Objekte; das Modell ist ein schwimmendes Asset des Katalogs (`asset`,
  Standard `rowboat`). Ein instanziertes Mesh je Teil des Modells, die CPU setzt einige Dutzend Matrizen je Bild; sie
  blockieren weder Sicht noch Bauen und werfen keinen Schatten (die Schattenkarte der Sonne ist gecacht).
  Bewegte Dinge (`movers`, dieselbe Klasse): ein beliebiges Asset (`asset`, Pflicht; ein Rover, ein Karren, Tiere) auf
  dem Boden, mit ihm geneigt, im Umriss je eines auf eigener Schleife (3 je Dichte 1, höchstens 16) oder auf der Linie
  in zwei Spuren 2,5 m neben ihr (2), mit `speed` m/s (Standard 1,5, je eines bis 20 % anders). Mit `height` hängen
  sie an einer Geraden statt am Boden: auf einer Linie von `height` über dem Boden am Anfang zu `height` über dem Boden
  am Ende, im Umriss `height` über seiner Mitte; dann ungeneigt. Liegen unter einer solchen Linie Seile (Objekte mit
  Katalog `cable`: die Seilbahn-Spannen, zwei Seile `gauge` auseinander, `length` lang, geneigt mit ihrem `pitch`;
  `effects/cable-ride.ts`), fahren die Dinge die Seile: die zwei Spuren liegen ein halbes `gauge` neben der Linie, jeder
  Punkt der Schleife nimmt die Höhe des Seils darunter, Lücken (Rolle am Mast, Wende um das Rad der Station) die
  Höhe zwischen den Nachbarn, und das Ding hängt an seinem Griff (Katalog `grip`, die Gondel 4,4 m, sonst seine Höhe).
  Eine Seilbahn bekommt so fahrende Gondeln aus einer Linie von Station zu Station; versetzte Spannen nehmen die Gondeln
  mit (die Ansicht baut sie neu, wenn sich Seil-Objekte ändern). Mountain Pass: vier Gondeln. Die Gegner und Tower sehen sie
  nicht. Der Weg einer Bodenlinie (ohne `height`) bleibt frei: die Schleife, die sie fahren (`moverWays`, map-life.ts),
  und 1,8 m zu jeder Seite; das `lifeRoute` des Kartenwerkzeugs und des Agenten räumt Felsen, Bäume und Pflanzen von
  dort ab, alles Übrige (Gebäude, Mauern, Props) meldet die Prüfung (`object-on-mover-route`)
  Schalter der Karte (`life.auto`): Schornsteinrauch, automatische Glühwürmchen und Vögel (an, wenn nichts gesetzt),
  Funken über Lava (aus, wenn nichts gesetzt); `life.density` 0 bis 2 als Faktor auf das alles. `life.flags`: das Tuch
  der Banner weht im Wind (`objects/cloth.ts`: die Karten `foliage-banner*` werden beim Laden zu einem Raster aus 6 x 14
  Vierecken mit `aHang`, 0 an der Stange, 1 am freien Ende; im Vertex-Shader laufen Wellen das Tuch hinab und der Wind
  bläht es, `WIND_UNIFORMS.uClothWave`, mit der Pflanzenbewegung des Spielers); ohne den Schalter schwankt nur die
  Stange wie bisher. Grafikstufe
  (`render-quality.ts`, `customMaps.life`): Low 0 (keine Lebensbereiche, keine Funken über Lava), Medium 0,7 (ohne die
  Bereiche mit `quality: 'high'`), High und Ultra 1. Eine Karte ohne `life` sieht aus wie vorher

### Umgebungston (`ambience/`)

`ambience/soundscape.ts` spielt den Ton der Karte, gehört von dem Punkt, auf den die Kamera schaut (im Spiel
`CustomMapWorld.hear`, im Editor die Mitte der Ansicht, Schalter „Hear it in the editor“ im Life-Panel, eigener
`AudioContext` erst nach dem Klick). Teile:
- **Ton über der ganzen Karte** (`life.ambience`: `sound` und `volume`): ein Klang, oder `biome`, der des Looks bei Tag
  und bei Nacht, mit der Dunkelheit überblendet (0,3 bis 0,7): temperate Vogelgesang und Grillen, mountain, arctic,
  apocalypse und mars Wind, desert Wind und Grillen, swamp Frösche, city Stadtrauschen, hell Lavagrollen, moon keiner
  (`ambient-sounds.ts`, `BIOME_SOUNDS`). Ohne `ambience` keiner: eine Karte bleibt still, bis man ihn setzt
- **Tonbereiche** (Lebensbereich der Art `sound` mit `sound` und `volume`, Standard 0,7): im Umriss oder auf der Linie
  voll, darüber hinaus über seine Reichweite leiser (`reach` 10 bis 300 m, Standard 70 m, `AREA_REACH`, quadratisch), aus der Seite, auf der er liegt (Stereo-Panner,
  voll seitlich erst 30 m außerhalb); ein Bach entlang einer Linie, Brandung entlang einer Küste, Feuer in einem Hof
- **Ton zu jeder Welle** (`life.waveSound`: `sound`, `volume`, optional `area`): einmal, wenn eine Welle beginnt
  (`wave:started` auf dem Hauptbus, über `PresentationHost` an `WorldProvider.waveStarted`, nicht beim Vorspulen eines
  Replays; die Simulation weiß nichts davon). Mit `area` (Id eines Lebensbereichs beliebiger Art) kommt er von dort:
  über 400 m bis auf 35 % leiser (`WAVE_REACH`, `WAVE_FAR`) und aus seiner Seite; ohne, oder wenn der Bereich fehlt,
  überall gleich. Klänge `WAVE_SOUNDS`: `bell` (Glockenschlag), `siren-distant` (ferne Sirene), `ship-horn`
  (Schiffshorn), ganze Dateien ohne Schleifenpolster, mit ElevenLabs erzeugt und ausgewählt (2026-10-15).
  Life-Panel: „At each wave“, Lautstärke, „Comes from“, „Play“ spielt ihn einmal im Editor
- Von oben leiser: bis 80 m über dem Boden voll, ab 600 m ein Drittel (`lift`)
- Gesamtpegel: Lautstärke des Spielers mal `AMBIENT_LEVEL` (0,35, seit E211). Die Spiel-Sounds hört man aus 100 bis
  400 m Kameraabstand und sie fallen mit der Entfernung, der Umgebungston nicht; vorher lag er über den Schüssen
- Klänge (`AMBIENT_SOUNDS`): `wind`, `birdsong`, `night-insects`, `stream`, `surf`, `swamp`, `lava`, `fire`, `city`,
  `gulls`, `crows`, `sirens-far` (die Sirene der Wellen als Ruf alle 50 bis 120 s, manchmal antwortet eine zweite
  von anderswo; Ruined City über die ganze Karte), `radio-hiss`, `harbor`, `cowbells`, `pine-wind`, `rain`, `cave-wind`, je mit eigenem Pegel. Mit
  ElevenLabs erzeugt und ausgewählt (2026-10-15): `wind`, `stream`, `surf`, `swamp`, `lava`, `fire`, `city`, `radio-hiss`, `harbor`, `cowbells`, `pine-wind`, `rain`, `cave-wind`, `night-insects` (Grillen im
  Gebüsch). `tools/ambient/make_placeholders.py` erzeugt synthetische Platzhalter für neue Klänge, bis eine Aufnahme
  gewählt ist (Rauschen im Frequenzraum über die ganze Schleife gefiltert, daher ohne Naht). Die Datei trägt 0,1 s der Schleife davor
  und danach (`LOOP_PAD`), gespielt wird dazwischen, so verschluckt der MP3-Versatz nichts. Eine unbekannte Id spielt
  nichts (eine Karte aus einem neueren Spiel)
- **Rufe** (`calls`, seit E211): `birdsong`, `gulls` und `crows` sind einzelne Rufe statt einer Schleife
  (`assets/sounds/ambient/calls/`, ElevenLabs, je ein Ruf, auf -20 LUFS): acht Singvögel, drei Möwen, drei Krähen und
  Raben. Solange der Ort gehört wird, fällt ein Ruf nach einer zufälligen Pause (`gap`, Vögel 5 bis 16 s), mit
  `reply` (etwa ein Drittel) antwortet einer schon nach `answer` Sekunden; jeder eine andere Aufnahme als der letzte,
  bis 6 % höher oder tiefer, meist fern (30 % bis voll, zum Fernen gewichtet) und zur Seite gestreut (bei einem
  Bereich um seine Seite). Je Ruf eine kurze Quelle. Unter `birdsong` liegt leiser Wind (dieselben Dateien wie
  `wind`, Anteil 0,2); `gulls` und `crows` haben keine Schleife. Eine Schleife aus Rufen wiederholt ihr Muster und
  nervt nach einer Minute
- **Varianten**: `wind`, `stream` und `surf` haben je zwei Aufnahmen (`variants`, `wind-2.mp3` usw.). Sie spielen
  abwechselnd: jede bis zum Ende ihrer Schleife, die nächste setzt 2 s vorher ein (`CROSSFADE`, Equal-Power-Blende,
  eine Sekunde vorher eingeplant), so fällt die 20-s-Schleife beim langen Zuhören weniger auf
- **Wetterton** (`WEATHER_BEDS`): Regenwetter spielt über alles ein leiseres Regenbett (`rain`, 0,35 + 0,45 k), Schnee
  und Nebel nichts. Von oben mindestens 60 %; ein Klang, den das Bett der Karte schon spielt, nicht doppelt
- **Gewitter** (E243): eine Karte mit Gewitter spielt über alles Starkregen (`storm-rain`) und Wind (`WEATHER_BEDS`,
  lauter je stärker, von oben mindestens 60 %; den Wind nicht doppelt, wenn das Bett ihn schon spielt) und nach jedem
  Blitz Donner (`Soundscape.thunder`, aus `Lightning.onStrike`): verzögert um die Entfernung zum nächsten Punkt des
  Kanals bei 343 m/s, unter 700 m ein Krachen (`crack`), bis 2 km ein rollender Schlag (`roll`), darüber fernes Grollen
  (`rumble`, ein Wolkenblitz kracht nie, `thunderKind`), je zwei Aufnahmen, leiser und dumpfer mit der Entfernung
  (Tiefpass 18 kHz · e^(-d/1200), mindestens 350 Hz), aus seiner Seite, bis 4 % höher oder tiefer, höchstens vier
  zugleich. Starkregen und Donner mit ElevenLabs erzeugt, je drei Varianten, gewählt nach Hüllkurve und Spektrum
  (2026-10-18; Auswahlseite tmp/sound-audition, Ids `amb_storm_rain`, `thunder_*`). Ein Wellen-Ereignis, das das
  Wetter wechselt, wechselt den Ton mit
- Kosten: je hörbarer Stimme eine Quelle (im Audio-Thread); Pegel und Panning rechnet die CPU zehnmal je Sekunde,
  eine Stimme, die drei Sekunden still ist, gibt ihre Quelle ab. Die Grafikstufe ändert nichts am Ton

### Umgebung (`environment/`)

- **Himmel**: eine Kuppel um die Kamera (`sky-dome.ts`), zuerst und ohne Tiefentest gezeichnet: Verlauf vom Dunst am
  Horizont zum Zenit, Sonne mit Hof, prozedurale Wolken (zwei fbm-Lagen, ziehen mit dem Wind, von der Sonnenseite
  beleuchtet). Die untersten Grad (unter etwa 6°) laufen in die Dunstfarbe aus, in der das Land jenseits des Rands
  versinkt (dieselbe Farbe und derselbe Zug zur Sonne wie im Höhennebel): keine helle Naht über den Hügeln am
  Horizont. Voreinstellungen `day`, `dusk`, `night`, `overcast` setzen Farben und Bedeckung. Dahinter bleibt ein
  auf der CPU gerechneter Equirect-Verlauf als Hintergrund und, vorgefiltert (PMREM), als Umgebungslicht. Das Wasser
  spiegelt denselben Himmel aus einer Textur (`uSkyTex`, obere Halbkugel, 256 × 64, Half-Float), die die Kuppel alle
  drei Frames und sofort nach einem neuen Himmel mit ihrer Funktion füllt (`SkyDome.bake`); vorher rechnete jedes
  Wasserpixel die Funktion zwei- bis dreimal (je zwei Wolkenlagen mit fünf Oktaven). GPU-Zeit Archipel 1,34 → 1,22 ms
- **Himmelswechsel im Spiel** (Wellen-Ereignis, neues Preset): Licht, Luft und Kuppel blenden über 2,5 s
  (`SKY_FADE_S`). Die Umgebung blendet auf der GPU (`env-blend.ts`): die gezeigte Karte zu Beginn kopiert, der
  Equirect-Verlauf des Ziels über vier Frames gefüllt und im nächsten einmal vorgefiltert, dann je Frame Texel für Texel
  gemischt (PMREM ist linear in seinem Himmel, das Ergebnis am Ende ist dieselbe Karte wie zuvor). Vorher füllte die
  CPU den Verlauf und PMREM lief fünfmal je Sekunde (je 8 bis 11 ms), und jeder Frame der Blende baute die
  Schattenkarte neu; sie baut jetzt nur, wenn sich die Sonne bewegt. Längster Frame der Umgebung je Wechsel 11 → 2 bis 4 ms
  (Autumn Keep)
- **Bildhimmel** (E172, `environment.skyImage`, `sky-images.ts`): statt der prozeduralen Kuppel ein fotografierter
  Himmel aus `public/maps/assets/skies/` (Poly-Haven-HDRIs, CC0, gebaut von `tools/map-assets/build_skies.py`):
  Fair weather, Sunset, Afterglow, Overcast, Thunderstorm, Moonrise, Starry night, Deep space (Sterne ohne
  Himmelsglühen, für Mond und Mars). Je Bild nur die obere Halbkugel, 4096 × 1024, sRGB-WebP, zusammen 2,1 MB;
  geladen erst, wenn eine Karte das Bild nutzt (über den Kartendaten-Cache), als Textur ohne Mipmaps (16 MB GPU,
  eine Mip-Kette zöge an der Naht des Equirects eine Linie). KTX2 nicht: ETC1S bandet auf weichen Verläufen, UASTC
  wöge ein Vielfaches. Das Bild ersetzt in der Kuppel Verlauf, Wolken, Sterne und Sonne (`skyImageColor`, ein
  einheitlicher Zweig, der Wolken-Noise läuft dann nicht), Dunst am Fuß, Grading und die gebackene Textur fürs Wasser
  bleiben; das Wasser spiegelt also das Bild. Die Umgebung (PMREM) nimmt das Bild oberhalb des Horizonts auf
  512 × 128 verkleinert, darunter wie bisher Horizont zu Boden. Licht und Luft kommen aus dem Bild, gemessen vom
  Build-Skript auf dem linearen HDR und in `skies.json` abgelegt (stehen also vor dem Laden fest): Sonnenfarbe = Farbe
  des hellsten Flecks, Halbkugel- und Umgebungslicht = Farbton des mittleren Himmels bei der Helligkeit des Presets,
  Dunst und Nebel = mittlere Farbe zwischen 0 und 8 Grad, Zenit- und Horizontfarbe für Materialien mit
  Spiegel-Ersatz. Jedes Bild nennt das Preset, dessen Stärken, Belichtung und Dunkelheit es übernimmt (Starry night
  ist `night`, das Mondlicht gilt also). Das Skript skaliert jedes HDR so, dass sein Horizont die Helligkeit dieses
  Presets hat. **Sonne:** die Karte behält ihre Sonne. Das Bild dreht sich um die Senkrechte, bis sein hellster Fleck
  (Sonne oder Mond, nur wenn er den Median des Himmels weit übertrifft) im Azimut der Kartensonne steht
  (`skyImageYaw`); die Wahl im Editor setzt die Sonnenhöhe auf die des Bilds, danach bewegt der Höhenregler nur noch
  das Licht. Bilder ohne Sonne drehen mit dem Azimut von Norden. Bis das Bild geladen ist, zeigt die Kuppel einen
  Verlauf in seinen Farben; `envReady` (und damit `warmUp`) wartet darauf. Eine unbekannte Id (Karte aus einem
  neueren Spiel) zeichnet prozedural. Land der Fotos (Hügel am Horizont) schneidet das Skript ab und zieht den
  Himmel darüber bis zum Horizont herunter (`lift`)
- **Sonne**: `DirectionalLight` mit 4096er Schattenkarte (PCF, Radius 1,5 Texel), deren Box auf Texel einrastet und
  den Boden deckt, den die Kamera sieht (`environment/shadow-fit.ts`): die Punkte des Bildrands bis zur Ebene in
  Höhe des Fokus, höchstens 2,5-mal der Kameraabstand und 430 m vom Fokus entfernt, darum der Kreis (Mitte höchstens
  0,6 der größten Box vom Fokus, Radius 70 bis 430 m, ein Zehntel Zugabe). Nach dem Kameraabstand allein (0,9-mal,
  bis 2026-10-14) fehlten den fernen Ecken einer schrägen Ansicht die Baumschatten, jede Mausrad-Raste nahm einen
  Streifen mehr. Die Box wächst sofort auf die nächste Stufe (Fünftel), schrumpft erst, wenn die Ansicht weniger als
  70 % von ihr braucht: eine Raste hin und zurück lässt Box und Werfer (`shadowRadius` 1,2-mal um ihre Mitte) stehen
  (Grafik-Benchmark Hafenstadt High: Draw Calls je Ansicht gleich, Schattenkarte gleich groß; die GPU-Zeit der größeren
  Box auf einem ruhigen Rechner steht noch aus)
- **Schattenkarte in Teilen** (PF-K2, `environment/shadow-parts.ts`): nach einer Änderung (Box verschoben, Werfer oder
  Detailstufe gewechselt, Tower, Boden) rendert die Karte nicht mehr in einem Frame neu, sondern über vier Frames in
  eine zweite Karte, je Frame ein Viertel der Objekte der Szene (in Szenenreihenfolge, die Stufen einer Zelle bleiben
  zusammen) mit dem Schattenpass von three über ein Hilfslicht, das die ganze Box sieht. Der Tiefenpuffer behält
  den nächsten Werfer, gleich in welcher Reihenfolge, nur der erste Teil leert die Karte. Ist sie ganz, tauscht die
  Sonne Karte und Matrix in einem Frame; bis dahin zeigt sie die alte (kein halbfertiger Zustand, kein Springen).
  Eine Änderung während eines Aufbaus wartet auf ihn (beim Schwenken kommen sie alle paar Frames; neu begonnen würde
  er nie fertig). Eine neue Sonne baut ebenso über vier Frames (bis dahin liegen die Schatten, wo die alte Sonne sie
  warf; in einem Frame kostete das im Editor 100 bis 180 ms je Sonnenwechsel), nur die erste Karte und eine neue
  Kartengröße zeichnen alle Teile in einem Frame. Hat ein Werfer die Szene während des Aufbaus verlassen (eine Zelle
  Bäume für neue Bäume neu gebaut), wird der Aufbau nicht getauscht, sondern beginnt neu: getauscht fehlten die
  Schatten aller Bäume dieser Zellen für einen Aufbau (Flackern unter dem Pinsel). three zeichnet einen
  Schattenpass nur innerhalb eines Renders: die Teile laufen im `onAfterRender` einer leeren Szene, gerendert in ein
  Ziel von einem Texel. Kachelweise (je Kachel ein Teil der Fläche) brachte nichts: ein gepacktes Asset ist ein
  `InstancedMesh` über die ganze Karte und wurde in jeder Kachel gezeichnet (Draw Calls je Frame höher als vorher).
  Gemessen (Hafenstadt, Stufe High, Kamera schwenkt 0,5 m je Frame, 240 Frames, headless): vorher 51 Neuaufbauten
  mit je 151 bis 156 Draw Calls in einem Frame, jetzt höchstens 43 Draw Calls Schatten je Frame, in Summe 7506
  statt 7808; bei 3 m je Frame vorher in fast jedem Frame ein ganzer Aufbau (bis 156), jetzt höchstens 43 (in einem
  von drei Läufen ein einzelner Frame mit 193 kurz nach dem Start, nicht geklärt). Auslöser waren fast immer
  Werfer- und Stufenwechsel der Objekte, selten die Box (49 und 4 von 51). Kosten: eine zweite Karte (bei 4096 Texeln
  64 MB Tiefe und 16 MB R8-Farbe); eine Änderung erscheint bis zu acht Frames später
- **Höhennebel** (`height-fog.ts`): die Materialien der Karte ersetzen das Nebel-Fragment der Szene; die Dichte nimmt
  über dem tiefen Boden der Karte ab und wird entlang des Blickstrahls geschlossen integriert, dazu eine dünne
  Luftschicht überall (Fernes wird auch von oben dunstig), zur Sonne hin färbt sich der Dunst. Die Nebelfarbe wird in
  den Ausgaberaum umgerechnet (three mischt Nebel nach der Farbraumumrechnung) und neigt zum Blau des Zenits. Die
  Szene behält `FogExp2` für Farbe und Dichte
- **Grading** je Himmel (Kontrast, Sättigung, Tönung) in allen Kartenmaterialien nach dem Nebel und auf der Kuppel,
  dazu Split-Toning je Biom (`split`: Tönung der Schatten, meist kühl, und der Lichter, meist warm; auf die Helligkeit
  normiert, verschiebt nur den Farbton)
- **Wetter** (`weather.ts`, `environment.weather`: `rain`, `snow`, `fog`, Stärke `weatherStrength`): Regen und
  Schnee füllen drei ineinander liegende Würfel vor der Kamera (`CASCADES`: 40, 160 und 640 m Kante, Mitte 0,35
  Kanten voraus, je ein Drittel der Teilchen), die beim Bewegen umklappen (zustandslos): Luft vor der Linse, Szene,
  Land bis in den Dunst, in jeder Höhe; jeder Würfel dünnt zu seinen Wänden aus, wo der nächste weitergeht. Teilchen
  wachsen mit dem Abstand höchstens auf das Sechsfache (`GROW_MAX`), damit man sie aus der Spielkamera sieht, ohne
  dass ferne Flocken das Bild grau verschleiern. Vorher füllte ein Kasten von 160 m um den Fokus nur einen Ausschnitt
  (ein Rechteck Schnee über fernem Boden, nichts vor einer tiefen Kamera, aus 500 m Höhe gar nichts); kostet auf der
  RTX 5080 in der Spielansicht 0,15 bis 0,3 ms GPU mehr; Low und Medium zeichnen nur ihren Partikel-Anteil
  (40 und 70 %, `setShare`, RENDER_QUALITY.md). Staub bleibt bis gut 20 m über dem Boden (Deckkarte). Regen und Schnee schließen die Wolken, dämpfen die Sonne und
  verdichten den Dunst; Nebelwetter verdichtet bis zum Sechsfachen. Asche und Glut wachsen höchstens auf das
  1,8-Fache (sonst ein Feld heller Punkte aus der Spielkamera), Asche dunkelgrau, Glut orange statt gelb-weiß
- **Gewitter** (`environment.weather: 'storm'`, E243; `lightning.ts`): Starkregen (Regenteilchen mit Stärke 0,5 + 0,5 k),
  Wolken fast geschlossen und schiefergrau (Wolken, Zenit und Horizont zu festen Sturmfarben `STORM` gezogen), Sonne
  um bis zu 80 % gedämpft (nachts nur ein Viertel davon: die Nacht ist dunkel genug), Himmels- und Umgebungslicht und Umgebungskarte schwächer, Dunst dreifach und blaugrau,
  Grading entsättigt und kühler, nasser Boden, Pfützen; Wind mindestens 0,55 + 0,4 k mit Böen 0,6 + 0,35 k
  (`stormWind`, ein stärkerer Wind der Karte bleibt, die Richtung auch). Dazu Blitze, **nur Darstellung**: eigener
  Zufall (`mulberry32`, nie der des Laufs), nicht in der Simulation, Koop-Gäste und Replays sehen andere Blitze, die
  Prüfsummen merken nichts. Ein Einschlag im Schnitt alle 18 - 12 k Sekunden (k = 0,6: 11 s), ein Viertel als Paar,
  nie dichter als 1,6 s (`MIN_GAP_S`). 40 bis 65 % sind Erdblitze, der Rest Wolkenblitze; 70 % fallen in Blickrichtung,
  ein Drittel der Erdblitze nah im sichtbaren Boden (bis 1,6-fache Kamerahöhe), der Rest 300 bis 2200 m weit.
  - Der **Blitzkanal** wird je Einschlag auf der CPU in einen festen Puffer gebaut (`MAX_SEGMENTS` 512, keine
    Allokation): ein langsames Mäandern des ganzen Kanals (zwei Sinus quer), darauf ein Zickzack aus Schritten von
    etwa 9 m (gedämpfter Zufallsweg, unten auf den Einschlagpunkt gezogen), Äste im oberen Dreiviertel, die abwärts
    und auswärts laufen und vor dem Boden verlöschen, selten ein Ast am Ast (nicht unter halber Partikelstufe). Erst
    kriecht der Leitblitz schwach herab (0,05 s), dann leuchten zwei bis drei Hauptentladungen binnen einer drittel
    Sekunde, die Äste nur bei der ersten; zwischen den Entladungen glimmt der Kanal. Am Boden ein Lichthof, und jede
    Entladung pulst dort das Licht der Schüsse (`Lightning.onStroke` an `ShotLights.pulse`, `STORM_STRIKE_LIGHT`: kaltweiß,
    100 m, 8 m über dem Boden, Stärke mal Blitz-Anteil; Land, Objekte, Wasser, Tower, Held und Gegner nehmen es, Low hat
    keine Plätze, docs/SHOT_LIGHTS.md). Ein
    instanzierter Draw: je Segment ein zur Kamera gedrehtes Band mit weißem Kern und violettem Hof, mindestens 1,3 px
    breit (auch fern sichtbar), oben in die Wolkenbasis ausgeblendet, fern vom Dunst gedämpft, logdepthbuf, additiv,
    keine Tiefe geschrieben; das Gelände verdeckt ihn, das Wasser spiegelt ihn
  - Der **Lichtblitz** hebt Himmels-, Umgebungslicht und Umgebungskarte (`FLASH_HEMI` 3,5, `FLASH_AMBIENT` 1,2,
    `FLASH_ENV` 0,8 bei Blitz 1) und zieht ihre Farbe zum kalten Weiß (`FLASH_COLOR`), hellt Dunst und Hintergrund auf
    und leuchtet die Wolken von innen aus (`uFlash`, `uFlashDir` auf der Kuppel: dichte Wolken stärker, um die
    Blitzrichtung am stärksten, das Wasser bekommt es über die Himmelstextur, die beim Blitz jedes Bild backt). Kein
    Licht kommt dazu, kein Material kompiliert; nach dem Blitz stehen die Werte exakt wie vorher
  - **Lichtblitz-Empfindliche:** Einstellung „Lightning flashes“ (Full, Soft; RENDER_QUALITY.md): Soft dimmt Blitz und
    Lichtblitz auf 35 % und macht aus den Entladungen ein weiches An- und Abschwellen ohne Flackern. Auch in Full
    höchstens drei Pulse je Einschlag und 1,6 s zwischen Einschlägen
  - Auf Google-Tiles-Welten gibt es kein Wetter (die Umgebung gehört den eigenen Karten); Gewitter gibt es auf eigenen
    und OSM-Karten
- **Wind** (`wind.ts`, `environment.wind`: `strength` 0..1, `direction` in Grad, aus der er kommt, `gusts` 0..1;
  ohne Feld der Standard des Bioms, auf dem Mond kein Wind): geteilte Uniforms für Bäume, Pflanzen, Gras, Wolken,
  Rauch, Nebelbänke, Laub, Schnee, Regen, Asche, Staub und Glut, alle in dieselbe Richtung. Böen laufen als Fronten
  über die Weltposition (etwa 70 m Abstand, 7 m/s mit dem Wind, quer gewellt), so sieht man eine Bö über Wiese und
  Wald ziehen. Wie weit Gras, Bäume und Pflanzen mitschwingen, skaliert die Einstellung „Plant motion“ des Spielers
  (Off, Calm, Full: `uPlantSway` 0, 0,4, 1); die Windstärke der Karte bleibt, Wolken, Rauch und Wetter ziehen voll. Kosten im Messrahmen nicht messbar (Demo-Tal 1,42 / 1,43 ms je Bild)
- **Biome** (`biomes.ts`, `environment.biome`): `temperate`, `hell`, `moon`, `mars`, `arctic`, `apocalypse`,
  `swamp`, `desert`, `mountain`, `city` setzen auf die Himmelsvoreinstellung Himmels- und Lichtfarben, Wolken,
  Dunstdichte und wie eng er am Boden liegt, Grading sowie Sterne, Polarlicht und
  Umgebungspartikel um den Fokus (Glut, Asche, Staub, Schneetreiben). Ein Biom kann dem Hof um die Sonne und dem
  Dunst zu ihr hin eine eigene Farbe geben (`glowColor`, sonst das Sonnenlicht). Mars wie auf den Rover-Bildern:
  blasser Butterscotch-Himmel am Tag, Licht fast weiß, Sättigung im Grading 0,74, damit der Boden seine Farben zeigt
  (heller Staub, dunkler Basaltsand, ockerfarbener Kies, rostige, graue und schwarze Steine); in der Dämmerung ein
  blauer Hof um die Sonne über braungrauem Himmel
- **Polarlicht** (`auroraLight` in `sky-dome.ts`, Arktis bei Nacht): zwei Vorhänge über dem Nordhimmel (Karten-Norden,
  nach Süden ausgeblendet, so liegt die Naht des Azimuts nie im Bild). Der Fuß jedes Vorhangs mäandert über den
  Himmel und wandert langsam, er ist scharf und am hellsten, darüber verblasst das Licht über eine Höhe, die entlang
  des Vorhangs wechselt. Wo das Band sich zum Betrachter faltet (der Fuß biegt steil), sieht man es von der Kante und
  es leuchtet heller; die Strahlen laufen in Bündeln, die entlang des Vorhangs wandern und sich an Falten drängen,
  die Helligkeit schwillt entlang des Vorhangs an und ab. Fuß blassgrün, Körper grün, oben rotviolett. Vorher ein
  Band mit 90 gleichen senkrechten Streifen rundum. Rund 18 Rauschzugriffe je Himmelspixel, nur wo Polarlicht an ist
  und kein Boden davor steht
- **Planet** (`environment.planet`: `azimuth`, `elevation` in Grad, `size` als scheinbarer Durchmesser in Grad, 0
  keiner; `planetOf`): die Erde im prozeduralen Himmel (`planetColor` in `sky-dome.ts`, im Kuppel-Shader, kein
  eigener Draw Call; Uniforms `uPlanetDir`, `uPlanet` = Radius in Bogenmaß). Bild: NASA Blue Marble mit Wolken
  (`skies/earth.webp`, 1024 x 512, sRGB, Alpha = Glanz auf offenem Meer, gebaut von `tools/map-assets/build_planet.py`,
  rund 240 KB), geladen erst, wenn eine Karte einen Planeten zeigt (`PLANET_IMAGE`, über den Kartendaten-Cache), mit
  Mipmaps; bis dahin eine schlichte Scheibe in Meeresfarbe. Fest gedreht: Europa und Afrika zur Karte, Nordpol etwas
  zum Betrachter geneigt. Licht nach der Sonnenrichtung mit weichem, zur Grenze hin wärmerem Terminator, Sonnenglanz
  auf dem Meer, dünner blauer Luftsaum auf der Tagseite, der knapp über den Rand reicht. Ohne Einstellung zeigt der Look
  Moon die Erde (`DEFAULT_PLANET`: Nordosten, 33 Grad hoch, 4 Grad), andere Looks keinen. Ein Bildhimmel zeigt keinen.
  Auf dem Mond gilt der schwarze Himmel als dunkel genug für die Lichter der Karte: `darkness` mindestens 0,5 wie in
  der Hölle (Schein der Lampen, Fenster, Punktlichter-Pool)
- **Nebel für Türme und Gegner**: die Kartenmaterialien nutzen den Höhennebel, alles andere den `FogExp2` der
  Szene; dessen Dichte setzt `matchFog` je Frame so, dass beide am Kamerafokus gleich dicht sind
- **Grading** wird immer im sRGB-Raum gerechnet, auch durch die Post-Processing-Kette des Spiels (lineares
  Float-Ziel), sonst würde der Kontrast dunkle Werte schwarz drücken
- Halbkugellicht, `tint` färbt Licht und Himmel. Das Halbkugellicht ist die kühle Füllung der Schattenseiten (Tag 0,75,
  Dämmerung 0,95, Wüste, Hölle und Mars 0,75; der Mond bleibt hart): Schatten bleiben lesbar statt fast schwarz.
  Spielkarten stellen die Sonne auf mindestens etwa 20°, flacher werden die Schatten lang und der Boden dunkel.
  `/map-preview?post=bloom` rendert durch die Post-Processing-Kette des Spiels
- **Tone-Mapping** nur auf eigenen Karten: `apply()` setzt am Renderer Khronos PBR Neutral (`NeutralToneMapping`) und
  die Belichtung des Looks, `detach()` stellt Tone-Mapping und Belichtung des Renderers exakt wieder her (Tiles,
  DevWorld und Globus sehen es nie: in der DevWorld hat keines der 67 Programme `TONE_MAPPING`, ein Standbild ist bis
  auf bewegte Teile pixelgleich). Neutral lässt Farben unter etwa 0,76 stehen und rollt nur die Lichter ab; Tower,
  Gegner und Effekte bleiben so fast unverändert (ihre eigenen Shader rechnen in Anzeigewerten, durch die
  Post-Processing-Kette läuft der OutputPass mit demselben Tone-Mapping). Belichtung je Himmel: Tag und bedeckt 1,4,
  Dämmerung 1,55, Nacht 1,7; Arktis × 0,82, Wüste × 0,9 (heller Boden). Damit bleibt die mittlere Helligkeit der
  Level wie ohne Tone-Mapping, Schatten werden etwas tiefer, Lichter brennen nicht mehr aus

**Randlicht für Gegner** (`WorldCapabilities.enemyRimLight`, nur eigene Karten): ein kühler Saum, wo die Oberfläche
eines Gegners sich von der Kamera abwendet (`uRimLight` in `vat-material.ts`, Stärke 0,2, vierte Potenz für einen schmalen Saum), damit Gegner sich vom
beleuchteten, detailreichen Boden abheben. Tiles und DevWorld behalten das Aussehen (Stärke 0).

**Schatten für Tower, Gegner und Held** (`WorldCapabilities.groundShadows`, nur eigene Karten): Tower werfen ihren
Körper in die gecachte Schattenkarte der Sonne (der drehende Turm nicht), die Karte rendert neu, wenn ein Tower kommt
oder geht (`WorldProvider.invalidateShadows`). Gegner am Boden bekommen weiche runde Blob-Schatten, je Gegnertyp ein
zweites instanziertes Netz, das Matrizen und Gleitversatz des Typs mitbenutzt (keine Arbeit auf der CPU je Frame,
`blob-shadow.ts`); Luftgegner keinen; der Held einen eigenen. Tiles und DevWorld bleiben ohne.

## Assets

`public/maps/assets/catalog.json` (Typen in `render/asset-catalog.ts`), Lizenzen in `LICENSES.md` (auch die
Himmelsbilder unter `skies/`), alles CC0.
Schema (Version 1, alle neuen Felder optional): Materialien mit `tags`, `emissive`, `flow`, Kategorien auch `ice`,
`volcanic`, `wood`; Objekte mit `tags`, `effects`, `light`, `lod`, `base`, Kategorien auch `structure` und `fx`. Den
Bestand baut der Asset-Worker aus; Stand beim Schreiben:

- **117 Bodenmaterialien** (Poly Haven, ambientCG; seit E154 dazu Charakter-Materialien: Wiese mit offenen Stellen,
  Bergwiese mit Felsen, Waldboden mit Wurzeln, Kies mit Laub, sandiger Kies, Felsgelände), je `color.jpg`, `normal.jpg` (OpenGL), `arh.jpg` (AO, Rauheit,
  Höhe), 1024 px; Lava mit `emissive` (Risse tief im Höhenkanal) und `flow`, zusätzlich `emissive.jpg`. Gras- und
  Waldböden, Herbstlaub, Sumpf und Schlamm, Acker, Sande, rissige Wüstenerde, Salzkruste, Klippen aus Granit,
  Sandstein, Basalt und Kalk, Geröll, Vulkangestein, Obsidian, Asche, Schwefel, Lava, Schnee, Eis, Packeis, Gletschereis,
  Asphalt (ganz und kaputt), Gehwegplatten, Pflaster, Beton, Schutt, Mond-Regolith, Mars-Staub und -Fels, Burgböden,
  Bohlen, Kies, Flusskiesel
- **Bodenmaterialien GPU-komprimiert** (E154): `tools/map-assets/pack_textures.py` packt die drei JPGs je
  Material in die zwei Ebenen, die das Gelände liest, als KTX2 mit Mipmaps: `color.ktx2` (Farbe, Höhe im Alpha, sRGB)
  und `data.ktx2` (Normale x/y, Rauheit, Verdeckung, linear), beide Basis ETC1S, je Material in der höchsten Qualität
  (255 abwärts in Stufen), bei der beide Dateien zusammen nicht größer sind als die drei JPGs. UASTC für die Normalen
  ginge nur für die ganze Datenebene (eine Textur, ein Codec; Rauheit und Verdeckung liegen in derselben) und wöge
  allein rund 1,3 MB je Material, mehr als die drei JPGs (Mittel rund 0,85 MB). Der Katalog nennt die Dateien unter
  `files.packed`. Im Spiel und im Editor transcodiert der eine Transcoder der Seite (`compressedTextureLoader`,
  `three-engine/models/ktx2-transcoder.ts`, auch für die Modelle) für die GPU (BC7 auf Desktops, sonst ASTC oder
  ETC2), `MaterialArrays` stapelt die Ebenen zu einem
  `CompressedArrayTexture`. Kommt eine Ebene nicht komprimiert (Datei fehlt, anderes Format), lädt die Karte alle
  Ebenen als Pixel aus den JPGs; ein Array mischt nie; die JPGs bleiben Quelle und Rückfall. 111 Materialien:
  84,7 MiB KTX2 (JPG 92,6 MiB), 67 davon unter Qualität 255; jede mitgelieferte Karte lädt weniger als mit den JPGs
  (Demo-Tal 8,3 statt 10,0 MiB, Hafenstadt 4,6 statt 5,2, knappste `frost-hamlet` 3,31 statt 3,40). Lädt eine Karte
  normal, kommen nur KTX2 (Demo-Tal 35, Hafenstadt 19 Dateien, kein JPG). PSNR gegen die gepackte Quelle, Mittel über
  alle Materialien je Kanal: Farbebene 32,8 / 33,7 / 31,9 dB, Höhe 37,0; Datenebene Normale 28,7 / 28,7, Rauheit
  29,5, Verdeckung 37,6 dB (schlechtester Kanal 22,0). Gemessen (RTX 5080, optimierter Dev-Stand, noch mit UASTC in
  der Datenebene, im Grafikspeicher gleich groß): JS-Heap Demo-Tal 467 bis 470 → 324 bis 338 MB, Hafenstadt 418 →
  315 bis 342 MB; Bodenarrays im Grafikspeicher etwa ein Viertel (11 Ebenen des Demo-Tals: rund 117 MB als RGBA,
  rund 29 MB als BC7); Laden gleich (4,4 bis 4,8 s)
- **Unterseite der Felsen** (`base`, E155): halbe Breite und Tiefe der Fläche, auf der ein Fels steht (Punkte bis
  8 % seiner Höhe, höchstens 15 cm über dem tiefsten), und wie tief dieser Punkt unter dem Ursprung liegt;
  `tools/map-assets/measure_bases.mjs` misst sie an den Modellen nach `bases.json`, `update_catalog.py` übernimmt sie.
  Gescannte Felsen sind unten flach abgeschnitten, und diese Platte reicht oft weit über den Fußabdruck hinaus (der
  Steinhaufen `rock-large`: Fußabdruck 1,8 m, Platte 7,4 mal 3,6 m). 53 Felsen haben eine; Kulissenstücke ohne Platte
  (Kraterränder, Becken, Felsbogen, Klippen- und Küstenwände, Tafelberg, Eisberg, Gletscher, Schneefeld; `NO_PLATE` im Skript) keine. Wie
  der Editor Felsen damit absetzt: [LEVEL_EDITOR.md](LEVEL_EDITOR.md), Objekte
- **Modelltexturen KTX2 und geteilt** (V9, [tools/model-pack/README.md](../tools/model-pack/README.md)): jede Textur
  eines Kartenmodells liegt als `textures/<name>-<hash>.ktx2` (Hash über Inhalt und Kodierung), die GLBs nennen sie per
  URI, der Katalog je Datei unter `textures`. ETC1S, wo es die gelesenen Kanäle hält (Farbe 30 dB, Daten 25 dB PSNR;
  die kleinste Qualitätsstufe innerhalb 1 dB der vollen), sonst UASTC; Normalen UASTC mit 256 px; `advertising-column`
  ganz UASTC (Plakate). Die `MapAssetLibrary` lädt eine geteilte
  Datei einmal und gibt allen Modellen dieselbe Textur (`sharedTexture`), die Dateien eines Modells starten neben
  seinem GLB. Grafikspeicher der Modelltexturen je Karte −85 bis −91 % (Demo-Tal 357,9 → 39,5 MiB, Hafenstadt
  422,8 → 48,0 MiB; Rechnung über die Dateien, vom Zähler an den WebGL-Aufrufen in der Map-Preview bestätigt).
  Download je Karte meist kleiner (Demo-Tal 12,9 → 9,9 MiB, Hafenstadt 15,3 → 13,2 MiB), nur Mars-Canyon
  (3,4 → 3,9) und Mondbasis (1,0 → 1,2) laden mehr
- **402 Katalog-Objekte**, davon 393 Modelle (GLB, meshopt, KTX2 bis 512 px, große Klippen 1024 px) und 9 Effekt-Marker; je
  Kategorie 124 Requisiten, 72 Felsen, 68 Gebäude, 42 Pflanzen, 31 Bäume, 33 Mauern und Zäune, 23 Bauwerke
  (`structure`). Je Biom: Laub- und Nadelbäume mit Herbst-
  und Schneevarianten, Trauerweide, Mangrove, Palmen, Kakteen, Köcherbäume; Sträucher, Hecken, Gras je Biom, Schilf,
  Weizen, Blumen, Seerosen, Pilze; Felsen je Gesteinsart, modulare Klippen, Sandsteinsäulen, Tafelberg, Felsbogen,
  Kristalle, Lavabecken; Burgbaukasten, Dorfhäuser auch mit Schnee, Mühlen, Kapelle, Leuchtturm, Pfahlhütte,
  Lehmhäuser; Brücken, Bohlenweg, Steg, Seilbrücke, Palisade, Zäune; Stadt (Wohnblöcke, Backsteinhäuser, Laden,
  Lagerhalle, Container, Autos, Ampel, Laternen, Bänke, Betonbrücke, Strommasten); Endzeit (Ruinen, Hochhausstumpf,
  Wracks, Schutt, Stacheldraht, Barrikaden, Giftfässer); Mond und Mars (Stationsmodule, Kuppeln, Gewächshaus,
  Antennen, Lander, Rover, Solarfelder, Landeplatz, Kraterränder); Arktis (Iglu, Forschungsstation, Eisberg,
  Eisschollen, Eiszapfen); Hölle (Höllentor, Altar, Lavafelsen, Dornen, Ketten, Obsidian, Galgenkäfig); Fahrzeuge
  (Auto, Pickup, Lkw, Bus, Panzerwrack, je intakt, verrostet, ausgebrannt); Teile der Vorzeige-Level (Seilbahn,
  Hexenhütte, Hafen, Karawanenzelt, Schmiede, Burgruine); Wahrzeichen (E179, `build_landmarks.py`: Tunnelportal aus
  Stein und aus Beton, Burgruine als ein Stück, Gletscherzunge, Séracs, Altschneefeld, Lawinenverbauung blank und eingeschneit,
  Schiffswrack, Rakete mit Startturm, Obsidianturm, Flutlichtmast, Positionslicht, Glockenturm auch mit Schnee,
  Steinkreis, Tribok, eingestürzte Hochstraße); Streu-Steine; Fackeln, Feuer, Wasserfall
- **Wahrzeichen** (E179): `tunnel-portal` und `tunnel-portal-concrete` (Bauwerk, Sicht- und Bausperre) sind
  Tunnelmünder für Straßen: Fassade mit 8 m breiter Öffnung, Flügelmauern, ein 14 m tiefes Gewölbe mit Fahrbahn,
  das in ein schwarzes Ende ausläuft, Fels des Hangs darum; Ursprung am Fuß der Öffnung, die Straße läuft entlang +Z
  (glTF) hinein, ein Portal je Tunnelende. Bauwerke stehen auf dem Boden unter ihrer Mitte und ebnen nichts ein.
  OSM-Welten setzen das Betonportal an jede Tunnelmündung (`tunnel: true` an der Kante, docs/OSM_WORLD_PLAN.md).
  `castle-ruin` (Gebäude, rund 36 mal 30 m, 22 m hoch) und `bell-tower(-snow)` (25 m) ebnen beim Setzen wie jedes
  Gebäude ein. `stone-circle` (15 m) und `highway-collapsed` (rund 50 m entlang X, Hochstraße auf 9 m) sind Bauwerke,
  `trebuchet` (wirft nach vorn, -Z in glTF), `floodlight-mast` und `beacon-post` (mit Katalog-Licht) Requisiten,
  `obsidian-tower` (14 m) ein Fels mit Platte. `glacier` (Fels ohne
  Platte, 90 m lang, 44 m breit, reicht 6 m in den Boden) ist flach und läuft an den Flanken aus, er steigt selbst
  kaum an: mit „An Hang ausrichten“ kippt er mit dem Hang, in einem Tal liegt er zwischen den Hängen; auf ebenem
  Boden wirkt er wie ein flacher Laib. `seracs` sind zerbrochene, schiefe Eistürme (Fels mit Platte), `snowfield`
  ein dünnes Altschneefeld (Fels ohne Platte, keine Bausperre). Alle drei nutzen nur die Schneetextur, getönt. `avalanche-barrier(-snow)` sind 4-m-Felder für Reihen am Hang
  (Bauwerk, Bausperre, die Streben reichen bergauf). `shipwreck` ist eine Requisite (kein Einebnen, liegt 1,5 m im
  Sand), `rocket` ein Gebäude mit eigener Betonplatte. Dreiecke und Draw Calls je Modell: `catalog.json`
  (`triangles`), je Material ein Draw Call (`pack_models.py` fügt gleiche Materialien zusammen)
- **Tiere, Mars-Lander, Hundeschlitten, Belagerungsturm** (E179, `build_extras.py`): `cow`, `sheep` (je stehend,
  `-grazing`, `-lying`) und `deer` (stehend, `-grazing`) sind billige Requisiten für Weiden und Kartenränder: nur
  Flachfarben ohne Texturen, zwei oder drei Materialien, 420 bis 740 Dreiecke, keine Sicht- und Bausperre; eine Herde
  instanziert in wenige Draw Calls, jede Pose ist ein eigenes Modell (einmal gemeinsam gebaut, `quadruped`).
  `dog-sled` (Winter, Arktis, rund 8 m) sind sechs Huskys an der Zugleine vor einem Korbschlitten. `mars-lander`
  (11 m, Mars) ist ein Aufstiegsfahrzeug auf seinem Abstiegsdeck in rotem Staub, anders als der goldene `lander`.
  `siege-tower` (Gebäude, 13 m, Burg) ist ein Belagerungsturm auf sechs Rädern mit halb gesenkter Fallbrücke nach vorn
  (-Z in glTF) und einer Fernstufe
- **Drehteile** (E179 für E190): Teile, die sich drehen sollen, haben Materialien `spin-*` und liegen im GLB als
  eigener Knoten (`spin-<id>`), Drehachse ist die Senkrechte durch den Ursprung des Modells: der Kopf von
  `antenna-dish` (Schüssel, Joch, Speisehorn), die Linse im Laternenraum von `lighthouse`. Die Bauskripte trennen
  sie nach dem AO-Backen ab (`blender_kit.split_spin`); spin-Materialien brauchen Werte, die kein anderes Material des
  Modells hat, sonst führt glTF-Transform sie zusammen. Gedreht wird noch nichts: `collectParts` backt alle Knoten
  flach und `merge-parts.ts` fasst einfarbige Materialien zusammen, das Drehen gehört zu E190
- **Heutige Gebäude für OSM-Welten** (O6, `build_modern.py`, Tag `city`, einige auch `village`/`temperate`): ein Satz
  Materialien für alle (gestrichener Putz in wenigen Tönen, anthrazit oder rote Dachziegel, weiße Fenster in echten
  Laibungen, Rollläden, Zinkrinnen, Betonsockel). Wohnen: `house-modern` (10 × 8,6 m, PV), `house-modern-red`
  (9 × 8,2 m), `house-semi` (14 × 9 m), `house-terrace` (6 × 10 m, Seiten blind und bündig für Reihen),
  `house-terrace-row` (vier Häuser, 24 × 10 m), alle zwei Geschosse mit Satteldach. Nebengebäude: `garage` (3 × 6 m),
  `garage-row` (15 × 6 m), `garden-shed`, `carport`, `carport-double`, `station-canopy` (22 × 13 m, ohne Marke),
  `greenhouse` (6 × 12 m), `kiosk`, `transformer-station`. Innenstadt: `block-row-4` und `block-row-6` (15 × 12 bzw. 16 × 13 m,
  Seiten blind) und `block-corner-4`/`-6` (14 × 14 bzw. 15 × 15 m, Straßenfront vorn und links), Läden im Erdgeschoss
  der Straßenseiten. Gewerbe: `office-mid` (5 Geschosse, 24 × 14 m), `office-high` (8, 22 × 18 m), `supermarket`
  (40 × 26 m), `hall-flat` (30 × 20 m), `industrial-hall` (60 × 30 m, Bürotrakt im Westen). Öffentlich: `school` (46 × 14 m,
  3 Geschosse), `town-hall` (30 × 15 m), `town-church` (Schiff 26 × 13 m, Turm 50 m), `station` (28 × 11 m, Bahnsteigdach
  hinten), `parking-garage` (32 × 40 m, 4 Decks, Rampe hinten). Ohne Gebäude: `rail-track` (10 m entlang X),
  `rail-platform` (20 × 4 m, Kante vorn), `catenary-mast` (Ausleger nach hinten), `buffer-stop`, `power-pylon` (47 m),
  `vine-row` (10 m entlang X), `fruit-tree`, `playground-swing`, `playground-slide`, `football-goal`, `fountain`.
  Front ist die Tür- bzw. Ladenseite; Carports, Tankstellendach und Gewächshaus sperren keine Sicht
- **Weitere Arten** (`build_modern2.py`, E179): `shop-small` (Laden, 10 × 8 m, ein Geschoss, Schaufenster auf
  Steinsockel, Schildband ohne Schrift, Markise), `shop-office` (Geschäftshaus, 12 × 10 m, 4 Geschosse, Läden unter
  Bandfenstern), `office-ribbon` (Bürohochhaus, 16 × 16 m, 10 Geschosse, Bandfenster zwischen hellen Lisenen, Glasaufbau),
  `barn-modern` (Scheune heutiger Art, 12 × 18 m, Giebel mit Schiebetor vorn, Bretter auf Betonsockel, Lichtplatten),
  `outbuilding` (Nebengebäude 4 × 4 m, verputzt, Satteldach, Flügeltor), `shelter-lean-to` (offener Unterstand
  6 × 2,6 m, Pultdach, Brennholz, sperrt keine Sicht), `annex` (Anbau 7 × 5 m, Pultdach zur Front, Rückseite für
  die Hauswand). Die OSM-Welt nimmt sie in ihre Arten auf (`building-tags.ts`).
- **9 Effekt-Marker** (`fx-*`, `file: ''`): Glühwürmchen, Rauch, Glut, Bodennebel, Laub, Schnee, Funkeln, Wasserfall
- **Tags**: Biome `temperate`, `autumn`, `winter`, `mountain`, `desert`, `swamp`, `coast`, `volcanic`, `village`,
  `castle`, `crystal`, `arena`, `city`, `wasteland`, `moon`, `mars`, `arctic`, `hell`; Rollen für Pinsel `conifer`,
  `shore`, `water`, `undergrowth`, `scree`. `category` bleibt die Art. Material- und Objekt-Ids teilen sich einen
  Namensraum
- 89 Objekte haben eine Fernstufe (`lod`, `-lod1.glb` ohne Texturen; Farbe, Rauheit und Metall je Material aus
  den Texturmitteln des vollen Modells per `match_lods.py`, sonst springt die Farbe beim Stufenwechsel: die fünf
  Altstadthäuser trugen bis E265 noch den ersten Schätzwert des Baus, Dächer lachsfarben statt dunkelrot, Wände
  blass; `packed-models.spec.ts` meldet einen LOD, über den das Skript nicht lief); `screen` ist der Anteil an der Bildhöhe, unter
  dem sie übernimmt (Radius durch halbe Bildhöhe im Abstand, Sichtfeld 60°), gebaut aus 350 m bzw. 40 % der Sichtweite
  für ein Objekt in Asset-Größe; 34 ein Licht (`light`), 40 Effekte (`effects`); 10 schwimmen (`float`: Boote, Schiff, Bojen, Seerosen, Eisscholle,
  Steg, Pier; Ursprung des Modells ist die Wasserlinie, ihr z zählt ab dem Spiegel unter ihnen, auf trockenem Boden ab
  dem Boden; eine Wassertiefe in z hebt sie in die Luft, das meldet die Prüfung `object-floating`). 9 stehen absichtlich
  in der Luft (`aloft`: Objekt-Brücken, Seilbahn-Spannen, Gondel); die Prüfung lässt sie aus. Die zwei Tunnelportale
  haben eine Öffnung in den Boden (`groundCut`: halbe Breite, Kämpfer, Scheitel, Länge bei Skala 1, von der Front
  z = 0 nach -z): das Gelände wird darin nicht gezeichnet (`terrain/terrain-cuts.ts`, ein Float-Textur-Index im
  8-m-Raster, eine Texelabfrage je Gelände-Fragment), so liegt der Hügel auf dem Gewölbe und Boden, Gewölbe und
  dunkle Rückwand des Modells zeigen sich. Kippen (pitch, roll) bleibt dabei außen vor; der Schattenpass behält den
  Boden
- Flammen sind alpha-getestete `foliage-*`-Karten mit Eigenleuchten, der Wasserfall eine Karte `foliage-waterfall`;
  Brücken und Stege brauchen eine Höhenangabe, wenn sie nicht schwimmen
- Größe: `public/maps/assets` rund 178 MB (Materialien 94 MB, Modelle 84 MB). Ansehen: `/map-preview?showcase=<tag>` oder `?assets=a,b*&materials=c,d`

`MapAssetLibrary.shared()` lädt Katalog, Materialpixel und Modelle einmal und teilt sie zwischen Ansichten. Fehlt eine
Datei, zeichnet die Karte trotzdem: Material in der Durchschnittsfarbe, Modell als Platzhalterform.

Neu bauen: [tools/map-assets/README.md](../tools/map-assets/README.md) (Python mit PIL/numpy/scipy, Blender 5.1
headless, gltf-transform).

## Leistung

**GPU**, Chromium ohne VSync (`tmp/perf.mjs` im Worktree, `--disable-gpu-vsync --disable-frame-rate-limit`), RTX 5080:

| Karte | Ansicht | fps | Draw Calls | Dreiecke |
|-------|---------|-----|------------|----------|
| Demo-Tal (257², rund 13 000 Objekte), 1080p | Übersicht / Spielkamera / Wald | 545 / 490 / 465 | 418 / 367 / 168 | 1,9 / 2,4 / 2,3 Mio. |
| 1025² (2 km), 50 000 Objekte, 1080p | Übersicht / Spielkamera | 352 / 432 | 886 / 391 | 5,8 / 3,9 Mio. |

**Im Spiel** (`node e2e/perf/sim-load.ts --world demo-valley`, Dev-Server, 1600 × 900, ohne VSync, Spieltempo 1):
mit 2000 Gegnern 359 fps mit Karte, 941 ohne; mit 5000 Gegnern 268 fps mit, 393 ohne. Die Karte kostet also
1,2 bis 1,7 ms je Frame, fast alles GPU: `update()` braucht 0,02 ms Hauptthread.

**Szenenkosten** (`render/objects/scene-cost.ts`): was die Objekte einer Karte das Bild kosten, etwa Dreiecke im Bild
je Objekt (Modell, LOD-Modelle und Impostor in ihren Bändern bis zur Sichtweite, jedes Band mit dem Anteil der Karte
darin, dazu 2 Punkte je Instanz und die Partikel der Effekte). 100 % sind 12 Mio. Punkte (`SCENE_BUDGET`), geeicht 2026-10-15: dort braucht die teuerste Ansicht 3 ms GPU auf
dem Entwicklungsrechner (BENCHMARKS.md, „Eigene Karten und Szenenkosten“). Das Map-Panel des Editors zeigt sie, der Check warnt
darüber, die mitgelieferten Karten bleiben unter 80 %. Formel, Kalibrierung und was nachzumessen ist:
[LEVEL_EDITOR.md](LEVEL_EDITOR.md), „Szenenkosten“. Die Zahl der Objekte allein sagt wenig: eine Large-Wiese mit
91 500 Grasbüscheln und Blumen kostet 4 %, eine City-Karte Medium mit 5 500 Häusern, Laternen und Hochhäusern 100 %.

**CPU-Budgets** (`custom-map-view.perf.spec.ts`, `npm run test:perf` hält sie wörtlich, sonst zehnfach locker):

| Raster, Objekte | Aufbau | `update()` je Frame | 32-m-Pinsel Höhe | 32-m-Pinsel Splat |
|-----------------|--------|---------------------|------------------|-------------------|
| 257², 5 000 | ~90 ms | 0,1 ms | 1,3 ms | < 0,1 ms |
| 513², 20 000 | ~120 ms | 0,2 ms | 1,7 ms | < 0,1 ms |
| 1025², 50 000 | ~430 ms | 0,1 ms | 1,7 ms | < 0,1 ms |

Ohne GPU gemessen (jsdom, Texturen und Modelle als Platzhalter); dazu kommen im Browser das Dekodieren der Texturen
(Laden bis `ready` 1 bis 3,5 s) und `warmUp()` (compileAsync aller Programme, 11 für das Demo-Tal). Pinsel laden nur
die Zeilen ihres Rechtecks hoch und setzen nur Objekte in ihrer Nähe neu.

**Speicher** (`node e2e/perf/map-cycles.ts --url http://localhost:4211`, 20-mal Ansicht öffnen, aufwärmen, schließen):
Geometrien, Texturen und Programme bleiben nach dem ersten Zyklus gleich, der Heap wächst über 19 Zyklen um 0,6 MB
(Demo-Tal; ebenso Hölle bei Nacht mit Regen). Was bleibt, ist der Cache der geteilten `MapAssetLibrary`: die Modelle
und, nur wo sie ohne KTX2 laden, die Bodenmaterialien als Pixel (8 MB je Material bei 1024 px); die komprimierten
Ebenen behält sie nicht, ihre Dateien liegen im Cache der Kartendaten. Die
Textur-Arrays der offenen Ansicht behalten keine Kopie: nach dem Hochladen setzt `onUpdate` ihre Pixel auf `null`
(`terrain-textures.ts`); nach einem Kontextverlust lassen sie sich nicht neu hochladen, die Ansicht muss neu gebaut
werden. Ebenso die Texturen der Modelle und der Fern-Atlas: nach dem Hochladen gehen ihre transcodierten Ebenen
(`keepOnGpuOnly` in `model-loader.ts`; OSM-Stuttgart nach vollem Laden 978 → 915 MB Heap, Demo-Tal und Bergpass
im Wechsel 362 → 324 MB). Darum gehören sie der Seite (`shareGpu`, in `keep`): eine Leihe des Renderers, die sie
zeichnete, lässt sie auf der GPU, frei werden sie nur mit `clear()`; das spart auch das zweite Hochladen beim Wechsel
Editor ⇄ Testlauf. Das Fern-LOD eines Modells gibt seine eigenen Materialien frei, ihre Texturen nicht: es sind die
geteilten Dateien, die das volle Modell zeichnet (`sharedMaterials`). Die Paletten-Bilder des Editors zeichnen in
einem eigenen Kontext und darum aus einer eigenen Bibliothek, die mit diesem Kontext leer wird (`thumbnail-renderer.ts`).
Ist die GPU-Kopie weg, weil der Renderer mit anderem MSAA neu entsteht oder der Kontext nach einem Verlust zurückkommt,
meldet `RendererHost` das (`onGpuReset`), und jede geteilte Bibliothek leert sich (`clear()`); die nächste Ansicht lädt
die Modelle aus dem Cache der Kartendaten neu. Der Editor baut seine Ansicht nach einem Kontextverlust neu, ein
laufendes Spiel nicht: dort fehlen danach Boden und Modelltexturen bis zum nächsten Start der Karte.
Er bleibt, solange seine Karte vorn steht (`map-in-front.ts`: der Editor dieser Karte und ihre Testläufe), so lädt
und dekodiert der Wechsel Editor ⇄ Test nichts neu; jede Ansicht hält ihn mit `retain(mapId)` und lässt ihn mit
`release()`. Leer wird er, sobald keine Ansicht ihn hält und eine andere Karte, ein echter Ort oder die Globen nach vorn
kommen, eine Ansicht einer anderen Karte ihn nimmt oder `KEEP_LEASES` Leihen des Renderers ohne ihn vergingen
(`clear()`, Katalog bleibt). `MapAssetLibrary.dispose()` gibt ihn ganz frei; `shared()` legt danach eine neue an.

**Modelle laden** (E154, PF-K3): Modelle und Detailmodelle aller Assets laden gleichzeitig (`setObjects`,
`lodModels`, beim Kartenstart schon vorab); vorher wartete jedes Asset auf das vorige. Die Transforms der Knoten
offline in die GLBs zu backen lohnt nicht: das Einbacken samt Entquantisieren (`collectParts`) kostet im Browser
23 ms für die 24 Modelle des Demo-Tals und 42 ms für die 56 der Hafenstadt, und entquantisierte Dateien wären größer.
Die Zeit steckt im Parsen der GLBs (meshopt) und im Transcodieren der Texturen (Worker), das ohnehin parallel läuft.

**Tiefenpuffer: logarithmisch bleibt** (E154, PF-S6, geprüft 2026-10-14). Reversed-Z (`reversedDepthBuffer`, ohne
logarithmische Tiefe) nur auf eigenen Karten brachte in Messläufen mit `render-bench.ts --query depth=reversed`
(Probe-Schalter, nicht im Code) 0,1 bis 0,3 ms weniger GPU-Zeit in den Nahansichten (Demo-Tal 0,70 → 0,55 bis 0,61
ms, Hafenstadt 1,17 → 0,88 ms), in den übrigen Ansichten nichts über dem Rauschen. Dafür ist es nicht ohne Umbau
richtig: die Himmelskuppel legt sich an die ferne Ebene (`sky-dome.ts`, `gl_Position.z = w * 0,99999`), unter
Reversed-Z lag sie vor allem und verdeckte Gelände und Objekte; jeder Shader mit eigener Tiefe müsste beide
Konventionen kennen. Der Renderer entsteht je Seite mit seiner Tiefe; ohne `EXT_clip_control` fällt three still auf
die normale Tiefe zurück, zwei Spieler sähen dann verschiedene Tiefenpuffer. Nicht eingebaut.

## Grenzen

- Höchstens 12 Splat-Schichten plus Klippe und zwei Wegmaterialien (16 Array-Ebenen), alle Materialien in einer Größe
- Laubkarten werfen Schatten ohne Windbewegung (Schatten und Krone gehen bei Wind minimal auseinander)
- Gelände-LOD: Geomorphing gleicht die Stufen in einem Abstandsband an, Schürzen verdecken Risse an Kachelkanten
- Der LOS-Würfel sieht Gelände und Objekte in der LOD-Stufe der Kamera (Impostoren als zwei gekreuzte Karten)
- Die Splat-Map ist eine Textur über die ganze Karte (keine virtuellen Kacheln); auf 2-km-Karten mit 1024er Splat
  sind das 2 m je Texel
- Partikel und Wetter werfen keine Schatten; Regen, Schnee, Asche und Staub enden an Dächern und am Boden (CoverMap
  über Gelände und Fußabdrücke der Gebäude), andere Partikel kennen das Gelände nicht
- Lichter: höchstens 6 echte Lichter gleichzeitig (feste Lichter im Lichtpuffer), ohne Schatten. Alle Lichter (Laternen, Fackeln, Feuer, die
  Lavapunkte) sind dazu ins Land gebacken (`effects/lamp-light.ts`): zwei Texturen über die Karte (ein Texel je Meter,
  höchstens 512 je Seite, Half Float), ruhige und flackernde Lichter getrennt, je Licht ein umgekehrtes Quadrat von
  seiner Höhe (Kern mindestens 0,3 der Reichweite breit, dazu ein Sockel von 0,3 des Lichts am Fuß, so trägt der Fleck
  bis an die Reichweite), das dort weich endet; Alpha hält die Bodenhöhe des Lichts. Jedes Kartenmaterial mit
  Höhennebel (Gelände, Objekte, Gras) liest sie an seinem Fragment und gibt ihr Licht mal seiner Farbe dazu, über
  dem Licht 6 bis 12 m nach oben auslaufend (ein Dach über der Laterne bleibt dunkel), Wände und Unterseiten weniger,
  Feuer flackernd mit einer Phase, die über die Karte wandert, mit weicher Grenze statt Weiß; nach Dunkelheit
  eingeblendet wie der Pool. Wasser und Eis nehmen das gebackene Licht ebenfalls (ein warmer Schimmer am Ufer unter
  Laternen und Fackeln). Neu gebacken wird nur das Rechteck, das alte und neue Lichter erreichen. Die Lichthöfe haben
  einen kleinen hellen Kern und einen weiten weichen Hof (Licht in der Nachtluft), nachts mindestens ein Fünfzigstel
  des Abstands breit, so lesen sie aus der Spielkamera. E189 (Laternen nachts zu schwach): Bodenlicht, Hof und Pool
  (Katalogstärke 1 = 28 cd) kräftiger, Lavapunkte backen weiter und stärker; gleiche Draw Calls, Renderzeit im Rauschen
  (Harbor Town 1,11 und 1,13 ms, headless, High). Gemessen
  (Render-Bench headless, High, GPU-Median, belastete Maschine): Harbor Town 1,03 bis 1,08 ms vorher, 1,06 bis 1,20
  nachher; Witch Marsh 0,80 bis 0,86 und 0,82 bis 0,90; Ember Crater 0,70 bis 0,98 und 0,70 bis 0,98
