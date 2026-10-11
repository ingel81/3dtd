# Eigene Karten: Renderer und Assets

**Status:** in Arbeit auf `exp/custom-maps` (ab 2026-10-11), Plan in [WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md)

Der Renderer zeichnet ein Kartendokument (`src/app/world/custom-map/map-document.ts`) mit Gelände, Bodentexturen,
Wasser, Objekten, Wegen und Himmel. Editor und Spiel benutzen dieselbe Ansicht. Code unter
`src/app/world/custom-map/render/` (ohne Angular), Assets unter `public/maps/assets/`, Werkzeuge unter
`tools/map-assets/`. Vorschau: `/map-preview` (Demo-Tal, `?view=village|forest|trees|bridge|game|…`,
`?sky=dusk|night|overcast`, `?weather=rain|snow|fog`, `?post=bloom`, `?seed=3`).

## Koordinaten

Kartenraum: Meter, Ursprung in der Kartenmitte, `x` nach Osten, `y` nach Norden, Höhe über Null der Karte. Die
Szene folgt `geoToLocalSimple` um den Ursprung (0, 0):

| Karte | Szene |
|-------|-------|
| `x` (Ost) | `-x` |
| `y` (Nord) | `+z` |
| Höhe | `+y` |
| Drehung `r` (gegen den Uhrzeigersinn von oben) | `rotation.y = r` |

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
view.update(dt, camera, focus?);           // Gelände-LOD, Wind, Wasser, Objekt-Culling, Schattenbox um focus

view.heightAt(x, y);                       // Kartenraum, allokationsfrei, exakt die Fläche der feinsten Stufe
view.raycast(ray);                         // Szene-Strahl gegen das Gelände: { point, distance, x, y, height } | null
view.raycastObjects(ray);                  // erstes platziertes Objekt: { object, point, distance } | null
view.losBlockers;                          // Gruppe für den LOS-Würfel: Gelände + sichtblockierende Objekte
                                           // (muss direktes Kind der Szene sein: der Würfel blendet alle anderen aus)

// Editor: Dokument an Ort und Stelle ändern, dann
view.updateHeights(rect?);                 // rect in Kartenmetern { minX, minY, maxX, maxY }; Objekte, Wasser, Brücken folgen
view.updateSplat(rect?);                   // Splat-Gewichte neu hochladen (auch cliffAngle)
view.updateLayers();                       // Bodenschichten oder Klippenmaterial geändert: Material neu laden
view.updateWater();                        // Spiegel, Maske, Farbe; null entfernt das Wasser
view.updateWater(rect, k);                 // nur Gewässer k (1.. = waterBodies[k-1]): Pool-Pinsel, Schwimmendes in rect
view.setObjects(objects);                  // alle Objekte ersetzen (Promise)
view.addObjects(objects);                  // schon in doc.objects: baut nur die 192-m-Zellen neu, in die sie fallen
view.removeObjects(objects);               // schon aus doc.objects entfernt: nur deren Zellen und Kontaktschatten
view.updateObject(obj);                    // eins verschoben/gedreht/skaliert; anderes Asset baut neu
await view.warmUpAssets(renderer, scene, camera, ids); // Programme und Impostoren noch nicht platzierter Assets
view.updatePaths();                        // Wegemaske und Brücken neu
view.setEnvironment(env);                  // Himmel, Sonne, Nebel, Tönung
view.dispose();
```

Die Gruppe darf verschoben, aber nicht gedreht werden (die Shader nehmen Objektraum als Weltraum für ihre
Projektionen); `heightAt` folgt einer Verschiebung nicht. `environment.detach()` stellt Hintergrund, Umgebung und
Nebel der Szene wieder her.

## Teile

### Gelände (`terrain/`)

- **Kacheln** (`terrain-chunks.ts`): 64 × 64 Zellen je Kachel, LOD-Stufen mit Schritt 1, 2, 4, 8 Samples nach
  Kameraabstand (Stufe n ab 2^(n-1) × 1,6 Kachelkanten, mit Hysterese), Schürzen an den Kanten gegen Risse. Die
  Zellen sind entlang der Diagonale (i, j) → (i+1, j+1) geteilt, wie `HeightField.heightAt` rechnet.
  **Geomorphing**: jeder Vertex trägt die Höhe der nächstgröberen Stufe und gleitet im letzten Drittel vor dem
  Wechsel dorthin (nach seinem eigenen Kameraabstand), Stufenwechsel springen nicht
- **Höhentextur** (`height-texture.ts`): das Raster als Float-Textur; Wasser und Gras lesen die Geländehöhe darunter
  mit denselben zwei Dreiecken je Zelle wie das Mesh
- **Normalen** kommen aus einer Half-Float-Textur über das Raster (`GridNormalTexture`), bilinear gelesen: Klippenkanten
  folgen nicht der Dreiecksdiagonale (vorher Sägezähne)
- **Material** (`terrain-material.ts`): `MeshStandardMaterial` mit `onBeforeCompile`, damit Licht, Schatten, Nebel,
  Log-Tiefe und Tone-Mapping wie bei jedem Standardmaterial greifen. Bis zu 12 Schichten in zwei Texture-Arrays
  (Farbe + Höhe, Normale + Rauheit + AO): die 8 Splat-Schichten der Karte, Klippe, Straße, Pfad
  (`assignLayerSlots`). Je Pixel: Splat-Gewichte (zwei RGBA-Maps, mit Rauschen verwackelt), Wegemaske, Klippe ab
  `cliffAngle` mit verrauschter Kante; Höhen-Blend (eine Schicht zeigt sich, wo Höhe + Gewicht nahe am Besten
  liegt); jede Schicht zweimal mit verschobenen UVs je nach langsamem Rauschen (kein sichtbares Kachelmuster, nach
  Inigo Quilez); Klippen triplanar; Makrovariation und in der Ferne die Durchschnittsfarbe
- **Rand** (`terrain-apron.ts`): Land jenseits der Karte bis 3 km, ein Punkt je Randsample (der innere Ring trifft die
  Geländekante genau). Nach außen wird das Randprofil entlang der Kante mit wachsendem Radius geglättet und geht in
  flache Hügel über; Wasser am Rand läuft darüber weiter, bis das geglättete Bett über den Spiegel steigt. Im Shader
  mit der ersten Schicht bemalt. Nicht Teil der Karte (keine Abfragen, `losTransparent`)

- **Bodenverdeckung** (`ground-occlusion.ts`): je Rasterpunkt gebacken, Horizontwinkel in acht Richtungen bis 32 m
  (Mulden, Rinnen, Hangfüße dunkler) mal weiche Kontaktschatten unter Bäumen, Felsen, Gebäuden und Mauern nach
  Fußabdruck; dämpft das Umgebungslicht und teils das direkte
- **Gras** (`grass/grass-field.ts`): 70 000 instanzierte Halme in einer 64-m-Kachel, die zwischen Kamera und Fokus
  mitwandert (jeder Halm hat einen festen Weltort), auf dem Höhenraster, so dicht wie die Grasschichten der Splat-Map
  (nicht auf Wegen, steilem Boden, außerhalb der Karte), mit Wind, zum Kachelrand hin kleiner. Ab 140 m Kameraabstand
  zum Fokus aus; Ansichtsoption `grass: false`
- **Schnee und Nässe** (alle Kartenmaterialien, `height-fog.ts`): Schnee liegt auf allem, was nach oben zeigt
  (`environment.snowCover`, sonst aus Biom arctic oder Schneewetter), Regen macht Flächen dunkler und glänzender
- **Nasse Ufer**: die Alpha-Komponente der Normalentextur markiert Raster­punkte nahe Wasser (Maske um zwei Samples
  gewachsen); dort wird Boden bis etwa 1,3 m über dem Spiegel dunkler und glänzender

### Wege (`paths/`)

Wege werden **ins Gelände gemalt**, nicht als Streifen aufgelegt: eine RGBA-Maske (rot Straße, grün Pfad, blau die
Lage quer zum stärksten Weg, 0,5 m je Texel, höchstens 2048²) sagt dem Gelände-Shader, wo die Wegmaterialien
(`cobblestone`, `dirt-path`) liegen. Straßen bekommen Spurrillen, Feldwege zwei Fahrspuren mit Grasstreifen, die
weichen Ränder werden von Rauschen angefressen (Gras wächst herein). So folgt
ein Weg jeder Unebenheit ohne Z-Fighting, und der Höhen-Blend lässt Pflastersteine am Rand ins Gras auslaufen.
Brücken (`kind: 'bridge'`) bekommen ein Deck aus instanzierten `bridge-deck`-Stücken zwischen den Uferhöhen, mit
leichtem Bogen und mindestens 1 m über dem Wasser.

### Wasser (`water/`)

Ein Material für alle Gewässer (`water-material.ts`). Die Tiefe je Pixel ist Spiegelhöhe minus Geländehöhe aus der
Höhentextur: das Ufer liegt dort, wo das Gelände die Fläche schneidet, glatt, unabhängig vom Raster. Flächen-Gewässer
werden über ihrer Maske plus zwei Zellen gezeichnet und mit der bilinearen Maske ausgeblendet (runde Kanten), mit
weichem Saum. `losTransparent`.

- `terrain.water`: der Hauptkörper; nur er läuft über den Kartenrand weiter und macht Ufer nass
- `terrain.waterBodies`: weitere Körper mit eigenem Spiegel und eigener Maske (Datei: `terrain/water-<n>-mask.u8`)
- `terrain.rivers`: Flüsse und Lavaströme als Linie, je Punkt Breite und Spiegelhöhe, fließen vom ersten zum letzten
  Punkt; ein Band entlang der Linie (Catmull-Rom, alle 2 m), Wellen bzw. Kruste wandern stromab, schneller wo es fällt

`kind` je Körper:

- `water` (Standard): klar am Ufer, Kartenfarbe in der Tiefe, Wellen, Spiegelung des Himmels mit Fresnel, Sonnenglanz,
  Schaum im Flachen
- `sea`: stärkere Wellen und Brandungsbänder zum Ufer
- `swamp`: trüb, schwache Spiegelung, treibende Algen
- `ice`: deckend und still; hell über flachem, dunkles Petrol über tiefem Grund, mattierte Spiegelung, Risse, Schnee
  im Flachen
- `lava`: deckend und glühend; Krustenplatten über Adern, Farbverlauf Kruste, Dunkelrot, Orange, Gelb nur in den
  heißesten Adern (die Bloom-Schwelle fängt nur diese), am Ufer erkaltet. Lava-Körper und -Ströme bekommen
  orange flackernde Punktlichter (je 40-m-Fleck bzw. alle 30 m) aus dem Lichter-Pool

Lava als Bodenschicht: Katalog-Materialien mit `emissive` (0..1) glühen in den tiefen Stellen ihrer Textur (Risse)
und pulsieren, `flow` (m/s) lässt die Schicht entlang Karten-+x fließen.

### Objekte (`objects/`)

Je Asset, **Zelle** (192 m) und Detailstufe ein `InstancedMesh` je Modellteil, mit engen Grenzen: das Frustum-Culling
von three wirft ganze Zellen weg, für Kamera, Sonnenschatten und LOS-Würfel gleichermaßen; nichts wird je Frame
umgepackt. Je Frame zeigt eine Zelle eine Stufe nach ihrem Abstand (Modell, `lod`-Modelle des Katalogs, **Impostor**
für ferne Bäume ab 380 m) und verschwindet hinter der Sichtweite (`drawDistance`); nur Zellen nahe dem Fokus werfen
Schatten. Sichtblocker (Katalog `blocksLos`, je Objekt überschreibbar) liegen in `losBlockers`.

Impostor (`impostor.ts`): das Baummodell einmal von der Seite und von oben in eine kleine Textur gerendert, als zwei
gekreuzte und eine waagerechte Karte gezeigt (4 Dreiecke). Braucht den Renderer (Ansichtsoption `renderer`).

Materialien (`objectMaterial`): Bäume und Pflanzen wiegen sich im Wind; Laubkarten (`foliage-*`) behalten ihre
Normalen auch auf der Rückseite (three dreht sie bei doppelseitigen Materialien um, das machte Kartenrücken schwarz),
werden alpha-getestet mit Alpha-to-Coverage und blenden aus, wenn man sie von der Kante sieht oder sie die Sichtweite
erreichen; Wasserfall-Karten (`foliage-waterfall*`) fließen, leuchtende Laubkarten (Flammen) flackern. Windstärke und
Ausblendung sind Uniforms, alle Assets teilen sich wenige Shader-Programme. Vegetation bekommt je Instanz eine
leicht andere Helligkeit und einen Farbton. Gebäude stehen auf dem tiefsten von acht Punkten ihres Fußabdrucks, ihre
Fundamente reichen bis 1,5 m in den Boden.

### Effekte und Lichter (`effects/`)

Aus Katalogeinträgen mit `effects` und `light` (auch Einträge ohne Modell, `file: ''`, Kategorie `fx`):

- **Partikel** `fire`, `smoke`, `embers`, `fireflies`, `fog`, `leaves`, `snow`, `sparkle`: je Art ein instanziertes
  Feld für die ganze Karte. Zustandslos: jedes Teilchen läuft per Zeit und Zufallswert im Vertex-Shader durch sein
  Leben, die CPU schiebt nur eine Zeit-Uniform. Leuchtende Arten additiv, beleuchtete (Rauch, Nebel, Laub, Schnee)
  werden nachts dunkler. `radius`, `height`, `rate`, `color` je Effekt
- **Wasserfall** (`waterfall`): gebogene Fläche von der Kante (`height`) bis zum Fuß, Breite 2 × `radius`, fällt zur
  Vorderseite (+z) des Objekts; Streifen laufen herab, die Seiten fransen aus; Gischt am Aufprall
- **Lichter** (`light`: Farbe, Stärke, Reichweite, Höhe, `flicker`): jedes bekommt einen additiven Schein (am Tag
  schwach, nachts voll); dazu ein fester Pool von 6 `PointLight`s für die Lichter nächst dem Kamerafokus, nach
  Dunkelheit eingeblendet (Nacht, Dämmerung, tiefe Sonne). Am Tag kosten sie nichts, die feste Poolgröße vermeidet
  Shader-Neubau

### Umgebung (`environment/`)

- **Himmel**: eine Kuppel um die Kamera (`sky-dome.ts`), zuerst und ohne Tiefentest gezeichnet: Verlauf vom Dunst am
  Horizont zum Zenit, Sonne mit Hof, prozedurale Wolken (zwei fbm-Lagen, ziehen mit dem Wind, von der Sonnenseite
  beleuchtet). Voreinstellungen `day`, `dusk`, `night`, `overcast` setzen Farben und Bedeckung. Dahinter bleibt ein
  auf der CPU gerechneter Equirect-Verlauf als Hintergrund und, vorgefiltert (PMREM), als Umgebungslicht. Das Wasser
  spiegelt dieselbe Himmelsfunktion (geteilte Uniforms)
- **Sonne**: `DirectionalLight` mit 4096er Schattenkarte (PCF, Radius 1,5 Texel), deren Box dem Fokus folgt, auf
  Texel einrastet und mit dem Kameraabstand wächst (70 bis 450 m): nah scharf, von oben weit
- **Höhennebel** (`height-fog.ts`): die Materialien der Karte ersetzen das Nebel-Fragment der Szene; die Dichte nimmt
  über dem tiefen Boden der Karte ab und wird entlang des Blickstrahls geschlossen integriert, dazu eine dünne
  Luftschicht überall (Fernes wird auch von oben dunstig), zur Sonne hin färbt sich der Dunst. Die Nebelfarbe wird in
  den Ausgaberaum umgerechnet (three mischt Nebel nach der Farbraumumrechnung) und neigt zum Blau des Zenits. Die
  Szene behält `FogExp2` für Farbe und Dichte
- **Grading** je Himmel (Kontrast, Sättigung, Tönung) in allen Kartenmaterialien nach dem Nebel und auf der Kuppel
- **Wetter** (`weather.ts`, `environment.weather`: `rain`, `snow`, `fog`, Stärke `weatherStrength`): Regen und
  Schnee füllen einen Kasten um den Kamerafokus, der beim Bewegen umklappt (zustandslos), Teilchen wachsen mit dem
  Abstand, damit man sie aus der Spielkamera sieht. Regen und Schnee schließen die Wolken, dämpfen die Sonne und
  verdichten den Dunst; Nebelwetter verdichtet bis zum Sechsfachen
- **Biome** (`biomes.ts`, `environment.biome`): `temperate`, `hell`, `moon`, `mars`, `arctic`, `apocalypse`,
  `swamp`, `desert`, `mountain`, `city` setzen auf die Himmelsvoreinstellung Himmels- und Lichtfarben, Wolken,
  Dunstdichte und wie eng er am Boden liegt, Grading sowie Sterne, Planet (Mond: die Erde), Polarlicht und
  Umgebungspartikel um den Fokus (Glut, Asche, Staub, Schneetreiben)
- **Nebel für Türme und Gegner**: die Kartenmaterialien nutzen den Höhennebel, alles andere den `FogExp2` der
  Szene; dessen Dichte setzt `matchFog` je Frame so, dass beide am Kamerafokus gleich dicht sind
- **Grading** wird immer im sRGB-Raum gerechnet, auch durch die Post-Processing-Kette des Spiels (lineares
  Float-Ziel), sonst würde der Kontrast dunkle Werte schwarz drücken
- Halbkugellicht, `tint` färbt Licht und Himmel. Abgestimmt auf den Renderer des Spiels (kein Tone-Mapping, sRGB);
  `/map-preview?post=bloom` rendert durch die Post-Processing-Kette des Spiels

## Assets

`public/maps/assets/catalog.json` (Typen in `render/asset-catalog.ts`), Lizenzen in `LICENSES.md`, alles CC0.
Schema (Version 1, alle neuen Felder optional): Materialien mit `tags`, `emissive`, `flow`, Kategorien auch `ice`,
`volcanic`, `wood`; Objekte mit `tags`, `effects`, `light`, `lod`, Kategorien auch `structure` und `fx`. Den Bestand
baut der Asset-Worker aus; Stand beim Schreiben:

- **111 Bodenmaterialien** (Poly Haven, ambientCG), je `color.jpg`, `normal.jpg` (OpenGL), `arh.jpg` (AO, Rauheit,
  Höhe), 1024 px; Lava mit `emissive` (Risse tief im Höhenkanal) und `flow`, zusätzlich `emissive.jpg`. Gras- und
  Waldböden, Herbstlaub, Sumpf und Schlamm, Acker, Sande, rissige Wüstenerde, Salzkruste, Klippen aus Granit,
  Sandstein, Basalt und Kalk, Geröll, Vulkangestein, Obsidian, Asche, Schwefel, Lava, Schnee, Eis, Packeis, Gletschereis,
  Asphalt (ganz und kaputt), Gehwegplatten, Pflaster, Beton, Schutt, Mond-Regolith, Mars-Staub und -Fels, Burgböden,
  Bohlen, Kies, Flusskiesel
- **374 Katalog-Objekte**, davon 366 Modelle (GLB, meshopt, WebP bis 512 px, große Klippen 1024 px) und 8 Effekt-Marker; je
  Kategorie 118 Requisiten, 68 Felsen, 64 Gebäude, 42 Pflanzen, 31 Bäume, 29 Mauern und Zäune, 14 Bauwerke
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
  Hexenhütte, Hafen, Karawanenzelt, Schmiede, Burgruine); Streu-Steine; Fackeln, Feuer, Wasserfall
- **8 Effekt-Marker** (`fx-*`, `file: ''`): Glühwürmchen, Rauch, Glut, Bodennebel, Laub, Schnee, Funkeln, Wasserfall
- **Tags**: Biome `temperate`, `autumn`, `winter`, `mountain`, `desert`, `swamp`, `coast`, `volcanic`, `village`,
  `castle`, `crystal`, `arena`, `city`, `wasteland`, `moon`, `mars`, `arctic`, `hell`; Rollen für Pinsel `conifer`,
  `shore`, `water`, `undergrowth`, `scree`. `category` bleibt die Art. Material- und Objekt-Ids teilen sich einen
  Namensraum
- 73 Objekte haben eine Fernstufe (`lod`, `-lod1.glb` ohne Texturen, ab 350 m bzw. 40 % der Sichtweite), 32 ein
  Licht (`light`), 24 Effekte (`effects`); 10 schwimmen (`float`: Boote, Schiff, Bojen, Seerosen, Eisscholle,
  Steg, Pier; Ursprung des Modells ist die Wasserlinie)
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
(Demo-Tal; ebenso Hölle bei Nacht mit Regen). Was bleibt, ist der Cache der geteilten `MapAssetLibrary`: die
Bodenmaterialien als Pixel (8 MB je Material bei 1024 px, 88 MB für die 11 des Demo-Tals, dazu dieselbe Menge in
den Textur-Arrays der offenen Ansicht, die three für einen Kontextverlust behält) und die Modelle.
`MapAssetLibrary.dispose()` gibt ihn frei; `shared()` legt danach eine neue an.

## Grenzen

- Höchstens 8 Splat-Schichten plus Klippe und zwei Wegmaterialien (12 Array-Ebenen), alle Materialien in einer Größe
- Laubkarten werfen Schatten ohne Windbewegung (Schatten und Krone gehen bei Wind minimal auseinander)
- Gelände-LOD: Geomorphing gleicht die Stufen in einem Abstandsband an, Schürzen verdecken Risse an Kachelkanten
- Der LOS-Würfel sieht Gelände und Objekte in der LOD-Stufe der Kamera (Impostoren als Karten)
- Die Splat-Map ist eine Textur über die ganze Karte (keine virtuellen Kacheln); auf 2-km-Karten mit 1024er Splat
  sind das 2 m je Texel
- Partikel und Wetter werfen keine Schatten; Regen, Schnee, Asche und Staub enden an Dächern und am Boden (CoverMap
  über Gelände und Fußabdrücke der Gebäude), andere Partikel kennen das Gelände nicht
- Lichter: höchstens 6 echte Punktlichter gleichzeitig, ohne Schatten
