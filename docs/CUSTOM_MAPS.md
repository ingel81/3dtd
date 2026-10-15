# Eigene Karten: Renderer und Assets

**Status:** Aktuell, seit 0.7.0 auf `main`, im Spiel gesperrt bis zur Freigabe (TODO E134); die nächste Runde plant [CUSTOM_MAPS_NEXT_PLAN.md](CUSTOM_MAPS_NEXT_PLAN.md) (E154). Rahmen in [WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md)

Der Renderer zeichnet ein Kartendokument (`src/app/world/custom-map/map-document.ts`) mit Gelände, Bodentexturen,
Wasser, Objekten, Wegen und Himmel. Editor und Spiel benutzen dieselbe Ansicht. Code unter
`src/app/world/custom-map/render/` (ohne Angular), Assets unter `public/maps/assets/`, Werkzeuge unter
`tools/map-assets/`. Vorschau: `/map-preview` (Demo-Tal, `?view=village|forest|trees|bridge|game|…`,
`?sky=dusk|night|overcast`, `?skyImage=starry-night`, `?weather=rain|snow|fog`, `?post=bloom`, `?seed=3`).

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
view.setObjects(objects);                  // alle Objekte ersetzen (Promise)
view.addObjects(objects);                  // schon in doc.objects: baut nur die 192-m-Zellen neu, in die sie fallen (ein Asset ohne Zellen ganz)
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
  **Geomorphing**: jeder Vertex trägt die Höhe der nächstgröberen Stufe und gleitet im letzten Drittel vor dem
  Wechsel dorthin (nach seinem eigenen Kameraabstand), Stufenwechsel springen nicht
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
  Falllinie den Fels hinauf, in mehreren Maßstäben). **Steile gemalte Hänge** (unter dem Klippenwinkel): von 25° an,
  ganz ab 35°, liest die stärkste gemalte Schicht eines Pixels ebenfalls die zwei Seitenebenen, einmal vor der
  Schleife wie die Klippe (zwei Lookups mehr nur dort), bis `uSteepNear` vor der Kamera (Stufe: `steepNear`, Low 0);
  vorher zog die Draufsicht Geröll und Gras an Flanken zu Streifen. Makrovariation und in der Ferne die Durchschnittsfarbe. **Ferne billiger**: ab `uFarSingle`
  (150 m) liest jede Schicht Normale und Rauheit einmal statt zweimal (die Farbe behält ihr Anti-Kachel-Paar), ab
  `uFarFlat` (400 m) gar keine Schichttexturen mehr, nur die Durchschnittsfarben nach Gewicht über der Rasternormale;
  die Grenze zu einer Schicht ist mit Rauschen verzittert, zur flachen Ferne blenden Farbe, Daten und Normale über die
  letzten 30 % vor `uFarFlat` weich hinüber. Vorher lag dort ein verzittertes Band von 30 m: senkte sich die Kamera
  im Einflug aus der Übersicht (fast alles Boden in gleichem Abstand), sprang die Bodenbemalung über das ganze Bild auf
  einmal von flach zu texturiert (E193). `CustomMapView.setFarGround(single, flat, steep)` für die Qualitätsstufen Jede Schicht blendet so weich wie
  ihre Katalog-Kategorie (`MATERIAL_LOOK`: Gras und Sand laufen in die Nachbarn, Fels und Eis schneiden) und bekommt
  deren Rauheitsbereich (Schlamm und Eis glänzender, Gras und Sand matt); der Glanz läuft zum Blickrand hin aus (keine
  weißen Flächen im Gegenlicht)
- **Rand** (`terrain-apron.ts`): Land jenseits der Karte bis 3 km, ein Punkt je Randsample (der innere Ring trifft die
  Geländekante genau). Nach außen wird das Randprofil entlang der Kante mit wachsendem Radius geglättet und geht in
  flache Hügel über; Wasser am Rand läuft darüber weiter, bis das geglättete Bett über den Spiegel steigt. Bemalt mit
  dem natürlichen Boden des Kartenrands (`apron-paint.ts`: je 1/512 des Rands die Splat-Gewichte eines 24 m tiefen
  Streifens, 30 m entlang geglättet, ohne Straßen, Pflaster und Lava; ein gepflasterter Rand nimmt den natürlichen Boden,
  den die Karte am meisten hat; eine Textur 512 × 3, ein Lookup je Zeile nur jenseits des Rands), vorher die erste
  Schicht (Harbor Town: Pflaster bis zum Horizont). Ab 250 m hinter dem Rand steigt eine **Bergkette** (ab 900 m voll,
  Grat-Rauschen entlang des Rands, Höhe nach Look `BACKDROP_HEIGHT`: Gebirge 420 m, Sumpf 40 m; nicht über dem Meer),
  so endet keine Karte sichtbar in flachem Land; dieselben Ringpunkte, kein Draw Call mehr. **Bäume am Rand**
  (`edge-trees.ts`): die Bäume der 40 m am Rand gespiegelt auf die Schürze, eine eigene Objektschicht außerhalb der
  Sichtlinie (nur Bild, das Spiel liest sie nicht), auf der Höhe der Schürze (`ApronProfile.heightAt`); ein Wald endet
  nicht mehr als Linie vor kahlem Boden. Nicht Teil der Karte (keine Abfragen, `losTransparent`)

- **Bodenverdeckung und Geländeform** (`ground-occlusion.ts`, RGBA je Rasterpunkt, ein Zugriff im Shader):
  R Verdeckung (Horizontwinkel in acht Richtungen bis 32 m: Mulden, Rinnen, Hangfüße dunkler; mal weiche
  Kontaktschatten unter Bäumen, Felsen, Gebäuden und Mauern nach Fußabdruck; dämpft das Umgebungslicht und teils das
  direkte), G Krümmung (Höhe gegen Ringe in 4 und 12 m: Kuppen trockener und heller, Mulden feuchter und dunkler),
  B Abfluss (D8-Flussakkumulation, logarithmisch; Rinnen und Talböden dunkler und grüner; beim vollen Backen, ein
  Pinsel lässt ihn bis zum nächsten stehen), A Lava-Nähe (1 auf Lava, 0 ab 12 m: der Boden wird zu erkaltetem Gestein
  und glüht von unten orange mit langsamem Puls). An Hangfüßen unter Steilem rieselt Geröll in der Farbe der Klippe
  heraus. Über jedem Lavapunkt steigen Glut (zusammen höchstens etwa 2000 Teilchen) und etwas Rauch auf. Objekte
  nahe Lava (Häuser, Felsen, Bäume) glühen von unten mit: jedes Kartenmaterial mit Emissive-Anteil liest über den
  Höhennebel-Patch dieselbe Lavanähe an seiner Stelle (ein Lookup, nur auf Karten mit Lava), am stärksten auf Flächen
  nach unten und zur Seite, ohne Lichter
- **Gebrauchsspuren** (`ground-decals.ts`): nach Kartenregeln gebackene Decals, ein instanziertes Netz, ein Draw
  Call (höchstens 3000): Laub unter jedem zweiten Laubbaum (nicht unter Nadelbäumen, Höllen- und Endzeitbäumen),
  festgetretene dunkle Erde vor Hauseingängen und alle 9 bis 15 m an den Rändern von Straßen und Pfaden, Pfützen dort
  bei Regen oder im Sumpf. Jedes ein kleines Gitter, im Vertex-Shader über die Höhentextur auf den Boden gelegt
  (mit dem Abstand etwas höher, gegen die gröberen Geländestufen), beleuchtet, beschattet und im Nebel wie der Boden;
  die Form je Art im Fragment-Shader, am Rand vom Rauschen ausgefranst. Ändern sich Objekte oder Wege (Hinzufügen,
  Entfernen), werden sie nach einer Pause von 0,4 s neu gelegt; ein Verschieben behält sie. Die Erdteppiche um die
  Häuser bleiben gemalt
- **Gras** (`grass/grass-field.ts`): 70 000 instanzierte Halme in einer 64-m-Kachel, die zwischen Kamera und Fokus
  mitwandert (jeder Halm hat einen festen Weltort), auf dem Höhenraster, so dicht wie die Grasschichten der Splat-Map
  (nicht auf Wegen, steilem Boden, außerhalb der Karte), mit Wind, zum Kachelrand hin kleiner. Ab 140 m Kameraabstand
  zum Fokus aus; Ansichtsoption `grass: false`. Jeder Vertex rechnet seinen Halm selbst (Splat, Höhe, Hang, Deckung,
  Farbe). Die Stufe gibt die Zahl der Halme (`grassBlades`, render-quality.ts); unter High sind sie breiter, damit
  die Wiese geschlossen bleibt (Vorschau `?quality=medium`). Verworfen (2026-10-14, zweimal): ein Pass, der jeden
  Halm einmal in Texturen rechnet und die Vertices nur lesen lässt, zuletzt mit Neuberechnung nur bei Fokusbewegung
  und alle 8 Bilder. Mit SwiftShader als Ersatz für eine schwache GPU (Burg im Herbst, Nahansicht, GPU-Median je
  Bild, Gras als Unterschied zu einem Build ohne Gras, ein ruhiger Lauf) High 593 ms mit Pass gegen 639 ms ohne,
  Medium 204 gegen 235 ms: 7 und 13 % weniger, unter den geforderten 15 %, bei einer Streuung zwischen Läufen in
  derselben Größe; dazu 3,2 MB Ziele und kein Rückfall ohne `EXT_color_buffer_float`. Halmsorten aus den Zufallswerten des Halms: meist
  schlicht, manche kurz und breit, manche hoch mit strohfarbenem Samenstand, wenige blühen weiß, gelb oder violett
  (nur auf grüner Wiese, nur nah)
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
angefressen. Brücken (`kind: 'bridge'`) bekommen ein Deck aus instanzierten `bridge-deck`-Stücken zwischen den Uferhöhen, mit
leichtem Bogen und mindestens 1 m über dem Wasser. `style: 'stone' | 'lava'` an der Kante nimmt `bridge-deck-stone`
bzw. `bridge-deck-lava`; fehlt das Stück im Katalog, bleibt es beim Holzdeck.

### Wasser (`water/`)

Ein Material für alle Gewässer (`water-material.ts`). Die Tiefe je Pixel ist Spiegelhöhe minus Geländehöhe aus der
Höhentextur: das Ufer liegt dort, wo das Gelände die Fläche schneidet, glatt, unabhängig vom Raster. Flächen-Gewässer
werden über ihrer Maske plus zwei Zellen gezeichnet und mit der bilinearen Maske ausgeblendet (runde Kanten), mit
weichem Saum. An steilen Ufern reicht das nicht: das Gelände hat je Zelle zwei Dreiecke, eine Wand, die innerhalb
einer Zelle steigt (mit Terrain Lower gegrabene Grube, Kaimauer), schneidet den Spiegel in Stufen entlang der
Samples, eine Fase je Zelle (`cellSplit`). Dafür trägt die Maskentextur (RG8 statt R8, ein Byte mehr je Sample und Gewässer) im G-Kanal den Uferschnitt
(`shore-cut.ts`): je Sample der Abstand zur Wasserlinie des Dreiecksnetzes in Zellen (bis 3, nass positiv), zweimal mit
[1 2 1] geglättet, an steilen Ufern (größter Höhenschritt zum Nachbarn ab 1,5 bis 3 je Meter) um 0,5 Zellen nach innen
geschoben, an flachen um 0,5 nach außen. Das Material schneidet, wo der bilineare Wert unter 0 fällt (weich über eine
Viertelzelle): an der Wand endet das Wasser auf einer glatten Linie knapp vor den Zähnen, ein schmaler Streifen Wand
bleibt sichtbar; am flachen Ufer schneidet weiter die Tiefe je Pixel. Kein zusätzlicher Texturzugriff (derselbe
Maskenzugriff liest R und G). Gebacken über die Maskengrenzen bei neuem Spiegel, neuer Maske oder Ganzneubau (rund 40
bis 70 ms auf einem 1025er-Raster mit Ufer überall; ein kleiner See nur sein Rechteck): beim Laden auf dem Hauptthread,
danach (Level-Regler, Rückgängig) in einem Worker (`shore-cut.worker.ts`, Kopien von Höhen und Maske), bis dahin zeigt
die Textur den alten Schnitt; ein neuerer Auftrag verwirft den älteren. Sonst um das Pinsel-Rechteck auf dem Hauptthread
(unter 2 ms); ein Pinsel, während der Worker rechnet, wird über dessen Ergebnis noch einmal gebacken. `losTransparent`. Wasser empfängt den Schatten der Sonne (Bäume, Brücken, Ufer dunkeln Körper, Glanz und
etwas die Spiegelung) und die Punktlichter des Pools als Glanzpunkte mit schwachem Lichtfleck (Laternen, Fackeln,
Lava spiegeln sich).

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
  dem das Gelände den Spiegel schneidet, ist 12 cm Tiefe weich
- **Wellen**: drei Lagen der gekachelten Normalentextur; die feinste blendet zwischen 30 und 160 m Abstand aus (dort
  war sie nur Körnung), Böen (die großräumige Aufbruch-Textur, 17 m) machen Flecken rauer und ruhiger
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
- **Spiegelbild ab High** (`waterReflection` der Stufe, `water/water-reflection.ts`, kein Schalter): das Flächengewässer
  mit dem meisten Wasser um den Fokus (alle 0,25 s gewählt; Wasser, Meer, Sumpf; Flüsse, Lava und Eis nie) spiegelt
  die Karte: eine Kamera, an seiner Ebene gespiegelt, rendert die Szene in ein Half-Float-Ziel (High 35 % der
  Bildgröße, jedes zweite Bild; Ultra 50 %, jedes Bild), die nahe Ebene schräg in die Wasserebene gelegt (oblique
  Projektion, nichts unter Wasser spiegelt sich), höchstens 400 m weit; der Himmel bleibt (auf der fernen Ebene). Nur
  die Karte: Gruppe, Sichtblocker, Himmel und Lichter; Türme, Gegner und Overlays des Spiels nicht, innerhalb der
  Karte ohne Wasser, Gras, Bodendecals, Partikel und Objekte, die keine Sicht blockieren (Streu, Requisiten, kleine
  Pflanzen). Das Wasser liest es über seine projizierte Lage, von den Wellen verschoben; ruhiges Wasser zeigt es auch
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
  Schaum im Flachen (etwas vom Ufer abgerückt, zur Wasserlinie dünner, an der Maskenkante mit dem Wasser aus; wo der
  flache Streifen nur wenige Pixel breit ist, an steilem Ufer oder in der Ferne, blendet er nach der Tiefenänderung je
  Pixel aus), dazu auf allen Stufen eine weiche Schaumlinie an der Wasserlinie, die mit kleinen Wellen das Ufer hinauf
  und zurück läuft (einige Sekunden, entlang des Ufers versetzt; mindestens zwei Pixel breit, so zeigt sie sich auch
  am steilen Ufer und aus der Spielkamera). Flachwasser ist hell türkis (die Körperfarbe zu 40 % zu `#5fb3a6`; Sumpf
  trüb grün). Der Wasserkörper nimmt bei warmem, tiefem Licht den Farbton der Sonne an (bis 35 % zur eigenen
  Helligkeit im Sonnenton, nur wenn Rot über Blau liegt): bei Dämmerung von oben gedämpft und warm wie die Spiegelung
  aus der Nähe, statt kräftig blau; Tag und Nacht bleiben unverändert (gilt für Wasser, Meer und Sumpf)
- **Strömung** (`flow-map.ts`): jedes Flächengewässer bekommt beim Laden und bei jedem `set` eine gebackene
  Karte auf dem Höhenraster (RGBA8; RG Strömung in Szene x/z, ±1,2 m/s; B Uferabstand bis 32 m, über je 3 Zellen
  geglättet, damit seine Linien die Ecken des Ufers runden; A Steilheit des Ufers bis 1 Zelle daneben, bis 2,5; das
  Uferfeld kostet auf einem nassen 1025er-Raster rund 15 ms mehr):
  Wasser, Meer und Sumpf kreisen entlang der Ufer
  (quer zum Gradienten des Uferabstands; am Ufer still, einige Meter draußen am schnellsten, Engstellen schneller,
  um Inseln herum), Lava wälzt sich in Konvektionszellen (quellenfreies Feld, etwa 30 m). Der Shader schiebt Wellen
  bzw. Kruste in zwei Phasen, die sich überblenden (6 s Wasser, 18 s Lava); Eis steht still. Beim Laden am Stück,
  nach Änderungen im Editor (0,25 s nach der letzten) in einem Worker (`flow-map.worker.ts`, Kopien von Höhen und
  Maske; 15 bis 47 ms auf 513er bis 1025er-Raster blieben so vom Hauptthread), eine neuere Änderung ersetzt das
  Ergebnis
- **Uferbänder** (`shore-waves.ts`): breite, weiche Schaumbänder laufen über den geglätteten Uferabstand zum Ufer
  (Meer alle 9 m, bis 22 m draußen und 5 m Tiefe, alle 9 s eines; See alle 3,3 m, bis 5 m draußen und 0,6 m Tiefe,
  stärker aufgebrochen, alle 7 s; Sumpf langsam). Sie entstehen draußen aus dem Nichts, sind entlang des Ufers
  gewellt und von den Wellen aufgebrochen. Folgten sie der Tiefe, zeichneten sie an einer Kaimauer einen dünnen,
  rechtwinkligen Umriss. An steilem Ufer (Steilheit über 1,3) bleibt wenig Schaum: Bänder bis 85 % schwächer,
  Flachschaum bis 60 %. Das Gelände zeichnet mit derselben Phase den Schwall: nach
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
  die Kruste reißt auf und schließt sich. Über heißen Zonen (Hitzefeld, atmet langsam, örtlich versetzt) sind die Risse
  breiter und heller, die dünne Kruste glüht dunkelrot, am heißesten schmilzt sie zu offenen Flecken; die Glut der
  Risse greift auf die Plattenränder über. Risse bleiben mindestens etwa ein Pixel breit (`fwidth`), so werden ferne
  Ströme nicht schwarz. Die Platten wölben sich von ihren Rissen auf (Relief als Höhenfeld, Normale per `dFdx/dFdy`)
  und werden von der Sonne beleuchtet. Farbverlauf Kruste, Dunkelrot, Orange, Gelb nur in den heißesten Rissen (die
  Bloom-Schwelle fängt nur diese; mit `lavaGlow` über 1). Gleich viele Texturzugriffe wie vorher, auf allen Stufen.
  Zum Ufer hin (bis etwa 1,3 m Tiefe) erkaltet sie zu geschlossener, grauerer Kruste, die Risse schließen sich, in
  Wülsten entlang des Ufers. Lava-Körper und -Ströme bekommen
  orange flackernde Punktlichter (je 40-m-Fleck bzw. alle 30 m) aus dem Lichter-Pool

Lava als Bodenschicht: Katalog-Materialien mit `emissive` (0..1) glühen nur in den tiefsten Stellen ihrer Textur
(Risse, Höhenkanal unter etwa 0,27) und pulsieren; die Glut läuft von Dunkelrot über Orange bis Gelb in den tiefsten
Rissen und nicht darüber hinaus (früher Texturfarbe mal Verstärkung, das brannte rosa-weiße Flecken ein), die
Texturfarbe der glühenden Stellen tritt zurück, `flow` (m/s) lässt die Schicht entlang Karten-+x fließen.

### Objekte (`objects/`)

Je Asset, **Zelle** (192 m) und Detailstufe ein `InstancedMesh` je Modellteil, mit engen Grenzen: das Frustum-Culling
von three wirft ganze Zellen weg, für Kamera, Sonnenschatten und LOS-Würfel gleichermaßen; nichts wird je Frame
umgepackt. Je Frame zeigt eine Zelle eine Stufe nach ihrem Abstand (Modell, `lod`-Modelle des Katalogs, **Impostor**
für ferne Bäume ab 380 m) und verschwindet hinter der Sichtweite (`drawDistance`); nur Zellen nahe dem Fokus werfen
Schatten. Sichtblocker (Katalog `blocksLos`, je Objekt überschreibbar) liegen in `losBlockers`.

**Draw Calls (E154, PF-M2):** Zellen nur für Assets mit vielen Objekten (über `PACK_MAX` = 512: Wälder, Streuung).
Ein Asset mit wenigen Objekten (Häuser, Autos, Laternen, der größte Teil einer Stadt) hat keine Zellen, sondern je
Detailstufe und Modellteil ein `InstancedMesh`; die Teile einer Stufe teilen sich die Instanzdaten. Seine Objekte
werden je Objekt nach ihrem Abstand in die Stufen sortiert, erneut sobald die Kamera 2 m weiter steht
(`writePacked`); geschrieben werden nur Stufen, deren Objekte wechselten, und die Schattenkarte rendert nur dann neu.
Der Editor pickt über eigene, nie gezeichnete Meshes mit allen Objekten. Dazu werden die Teile eines Modells ohne
Farbtextur mit gleichen übrigen Texturen (oft nur die gebackene Verdeckung des Modells), gleichem Glühen, gleicher
Transparenz und Seitenwahl zu einem Teil zusammengeführt (`merge-parts.ts`): die Farbe als Vertex-Farbe, Rauheit
und Metall als Vertex-Attribut `roughMetal`. Ein Auto mit Lack, Glas, Lichtern und Reifen zeichnet zwei bis drei
statt sieben Teile, ein Haus behält seine texturierten Teile. Hafenstadt in der Spielansicht 1111 → 187 Draw Calls,
Demo-Tal 290 → 155 ([BENCHMARKS.md](BENCHMARKS.md#bildkosten-grafik-benchmark)). Seit dem Zusammenlegen über
Rauheit und Metall (Vertex-Attribut `roughMetal`) zeichnet die Hafenstadt 122 Calls, ein Bürohaus 5 statt 10 Teile.

**Weicher Stufenwechsel (E154, OP-H5, `lod-fade.ts`):** um jede Umschaltdistanz liegt ein Band von 12 % der
Distanz, ebenso an der Sichtweite. Im Band zeigt ein Objekt beide Stufen, die eine löst sich in einem festen
Bildschirm-Dither auf, die andere erscheint im ergänzenden Muster: jedes Pixel zeigt genau eine, nichts springt.
Gepackte Assets blenden je Objekt nach seinem Abstand, Zellen als Ganzes nach dem Abstand der Zelle. Der Wert liegt
je Instanz im Attribut `lodFade` einer leichten Geometrie je Mesh, die Puffer des Modells teilt (`fadeGeometry`).
Schatten dithern nicht: es wirft die Stufe mit dem größeren Anteil, in Zellen wie bei gepackten Objekten (deren
Instanzen liegen je Stufe mit den Werfern vorn, der Schattenpass zeichnet nur die), und nur nahe der Mitte der
Schattenbox (`shadowRadius`). Steht die Kamera 0,15 s still, läuft das Band aus (`settleBlend`): jedes Objekt geht binnen 0,3 s
ganz auf die Stufe, die seinem Abstand näher liegt, und öffnet das Band ebenso wieder, sobald die Kamera sich
bewegt. Das feste Muster steht so nie als Punktfeld auf einem ruhenden Bild (Hafenstadt, Spielansicht: vorher 44
gepackte Objekte im Band, danach keins).
Kosten: Demo-Tal 151 → 160 Calls in der Spielansicht, beim Schwenk 155 → 171 bis 180; die GPU-Zeit bleibt im
Rauschen des geteilten Messrechners (Spielansicht 1,01 bis 1,06 ms).

Impostor (`impostor.ts`, oktaedrisch): das Modell aus 8 x 8 Richtungen über der oberen Halbkugel (hemi-oktaedrisches
Raster, Albedo, unbeleuchtet) in eine Textur von 512 x 512 gerendert (64 px je Ansicht, mit 4x MSAA gezeichnet und in
ein Ziel ohne MSAA kopiert), gezeigt als eine Karte, die sich zur Kamera dreht. Sie nimmt die vier Ansichten um die
Blickrichtung und mischt sie nach Nähe; von unten gelten die Ansichten am Horizont. Die Normale zeigt zur Kamera und
nach oben. Im Schattenpass dreht sich die Karte zur Sonne (eigenes `customDepthMaterial`) und wirft den Umriss von
dort. Die gesehene Karte liest ihren Schatten einen Radius näher zur Sonne (`IMPOSTOR_SUN`): beide Karten laufen durch
die Modellmitte, die halbe gesehene Karte lag sonst hinter ihrem eigenen Werfer (ein dunkler Kasten in der Krone). Die Geometrie hält weiter zwei gekreuzte Karten in Modellgröße: was das Mesh mit eigenem Material zeichnet (der
LOS-Würfel), sieht diese. Kosten (RTX 5080, Burg im Herbst, High): Backen auf dem Hauptthread 55 bis 60 ms je Karte
statt 41 bis 43 (alle Bäume und Felsen zusammen); je Bild 0,23 bis 0,29 ms für alle Impostoren samt Schatten statt
0,22 bis 0,26; Speicher je Impostor 1,4 MB statt etwa 4,7 MB (die alte Textur hielt ihre MSAA-Puffer). Braucht den
Renderer (Ansichtsoption `renderer`).

Materialien (`objectMaterial`): Bäume und Pflanzen bewegen sich im Wind der Karte, in drei Stufen: der Stamm neigt
sich kaum (quadratisch mit der Höhe), Äste schwingen abseits der Stammachse je Kronenteil im eigenen Takt, Blätter
flattern (Laubkarten stärker). Wie weit die Spitze im starken Wind (Druck 1) ausschlägt, rechnet `windSwayAtTop` aus
Katalog-`wind` und Modellhöhe: ein schlanker 18-m-Baum etwa 1 m, eine Eiche (12 m, `wind` 0,5) rund 0,3 m; kleine
Pflanzen schwingen im Verhältnis stärker. Seitliches Biegen senkt die Spitze etwas (Länge bleibt). Laubkarten (`foliage-*`) behalten ihre
Normalen auch auf der Rückseite (three dreht sie bei doppelseitigen Materialien um, das machte Kartenrücken schwarz),
werden alpha-getestet mit Alpha-to-Coverage und blenden aus, wenn man sie von der Kante sieht oder sie die Sichtweite
erreichen; Wasserfall-Karten (`foliage-waterfall*`) fließen, leuchtende Laubkarten (Flammen) flackern. Windstärke und
Ausblendung sind Uniforms, alle Assets teilen sich wenige Shader-Programme. Vegetation bekommt je Instanz eine
leicht andere Helligkeit und einen Farbton, Bäume dazu eine Größe (0,88 bis 1,12) und eine Neigung (bis 4°, die meisten
fast aufrecht), alles im Instanz-Matrix und -Farbe aus einem Hash der Objekt-Id (`instance-variation.ts`, kein Draw Call
mehr; Sichtlinien sehen die Bäume so, wie sie gezeichnet sind). **Fenster bei Nacht** (`night-windows.ts`): das
Fensterglas der Gebäude (Materialien `window-glass…`, `window`; in zusammengelegten Teilen je Vertex `nightGlow`)
leuchtet mit der Dunkelheit warm, etwa jedes zweite Fenster nach einem Hash seiner Zelle in der Welt (2,5 m breit,
3 m hoch): wenige Shaderzeilen, kein Licht, kein Draw Call. Gebäude stehen auf dem tiefsten von acht Punkten ihres Fußabdrucks, ihre
Fundamente reichen bis 1,5 m in den Boden.

### Effekte und Lichter (`effects/`)

Aus Katalogeinträgen mit `effects` und `light` (auch Einträge ohne Modell, `file: ''`, Kategorie `fx`):

- **Partikel** `fire`, `smoke`, `embers`, `fireflies`, `fog`, `leaves`, `snow`, `sparkle`: je Art ein instanziertes
  Feld für die ganze Karte. Zustandslos: jedes Teilchen läuft per Zeit und Zufallswert im Vertex-Shader durch sein
  Leben, die CPU schiebt nur eine Zeit-Uniform. Leuchtende Arten additiv, beleuchtete (Rauch, Nebel, Laub, Schnee)
  werden nachts dunkler. `radius`, `height`, `rate`, `color` je Effekt; `at` setzt den Effekt neben den Ursprung
  (x und z des Modells, mit dem Objekt gedreht und skaliert): so raucht der Schornstein der Häuser (`house`,
  `house-large`, `cottage`, `house-stone`, `house-tall`, die Schnee-Varianten, `watermill`, `log-cabin`, `alpine-hut`,
  `fisher-hut`, `house-stone-balcony`; Lage aus `build_structures.py` `house()`). Steht schon ein von Hand gesetzter
  Rauch (`fx-smoke`, `MapKit.chimney`) im Fußabdruck des Hauses plus 2 m, raucht nur der gesetzte
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
  noch Scheibe: das Wasser läuft dort die nächste Fläche hinab, Schaum hinge sonst vor der Klippe in der Luft
- **Lichter** (`light`: Farbe, Stärke, Reichweite, Höhe, `flicker`): jedes bekommt einen additiven Schein (am Tag
  schwach, nachts voll); dazu ein fester Pool von 6 `PointLight`s für die Lichter nächst dem Kamerafokus, nach
  Dunkelheit eingeblendet (Nacht, Dämmerung, tiefe Sonne). Am Tag kosten sie nichts, die feste Poolgröße vermeidet
  Shader-Neubau
- **Leben aus dem Karteninhalt** (`CustomMapView.refreshAmbient`, ohne Bearbeiten): Glühwürmchen nachts (ab
  Dunkelheit 0,35) über den Ufern von Seen und Sümpfen (alle 12 m) und mitten in Wäldern (30-m-Quadrate mit mindestens
  6 Bäumen), höchstens 60 Schwärme, in den Biomen temperate, swamp, mountain. Vogelschwärme am Tag
  (`effects/bird-flocks.ts`): ein instanziertes Mesh für alle (ein Draw Call), Flug, Flügelschlag und Gleiten im
  Vertex-Shader auf der Uhr des Winds (ein Standbild hält sie an), je ein Schwarm je 300-m-Quadrat Karte (höchstens 5)
  über dem Land mit den wenigsten Bäumen, 45 m und höher, Kreise von 40 bis 56 m, deren Mitte langsam wandert; näher
  als 45 m an der Kamera klappen sie weg, nachts und mit der Pflanzenbewegung „aus“ sind sie fort; nicht auf dem Mond,
  Mars und in der Hölle. Stufe Low (Partikelanteil unter 0,7): keine Vögel, weniger Glühwürmchen. Gesetzte Schwärme
  (Effekt `birds`, `fx-birds`) und gesetzte Glühwürmchen ersetzen die automatischen (LEVEL_EDITOR.md, Objekte). Glut über Feuern und
  Lava, schaukelnde Boote und Wimpel im Wind gab es schon (Katalog `effects`, `float`, `wind`). Umgebungston je Biom
  fehlt noch, die Klänge gibt es nicht: Wind (Wiese, Pass), Bach und Fluss, Wellen am Ufer, Vogelgesang, Möwen,
  Krähen, Grillen und Frösche bei Nacht, Lavagrollen und Blubbern, eine Glocke

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
- **Wind** (`wind.ts`, `environment.wind`: `strength` 0..1, `direction` in Grad, aus der er kommt, `gusts` 0..1;
  ohne Feld der Standard des Bioms, auf dem Mond kein Wind): geteilte Uniforms für Bäume, Pflanzen, Gras, Wolken,
  Rauch, Nebelbänke, Laub, Schnee, Regen, Asche, Staub und Glut, alle in dieselbe Richtung. Böen laufen als Fronten
  über die Weltposition (etwa 70 m Abstand, 7 m/s mit dem Wind, quer gewellt), so sieht man eine Bö über Wiese und
  Wald ziehen. Wie weit Gras, Bäume und Pflanzen mitschwingen, skaliert die Einstellung „Plant motion“ des Spielers
  (Off, Calm, Full: `uPlantSway` 0, 0,4, 1); die Windstärke der Karte bleibt, Wolken, Rauch und Wetter ziehen voll. Kosten im Messrahmen nicht messbar (Demo-Tal 1,42 / 1,43 ms je Bild)
- **Biome** (`biomes.ts`, `environment.biome`): `temperate`, `hell`, `moon`, `mars`, `arctic`, `apocalypse`,
  `swamp`, `desert`, `mountain`, `city` setzen auf die Himmelsvoreinstellung Himmels- und Lichtfarben, Wolken,
  Dunstdichte und wie eng er am Boden liegt, Grading sowie Sterne, Planet (Mond: die Erde), Polarlicht und
  Umgebungspartikel um den Fokus (Glut, Asche, Staub, Schneetreiben). Ein Biom kann dem Hof um die Sonne und dem
  Dunst zu ihr hin eine eigene Farbe geben (`glowColor`, sonst das Sonnenlicht). Mars wie auf den Rover-Bildern:
  blasser Butterscotch-Himmel am Tag, Licht fast weiß, Sättigung im Grading 0,74, damit der Boden seine Farben zeigt
  (heller Staub, dunkler Basaltsand, ockerfarbener Kies, rostige, graue und schwarze Steine); in der Dämmerung ein
  blauer Hof um die Sonne über braungrauem Himmel
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
  `files.packed`. Im Spiel und im Editor transcodiert ein Worker (`MapAssetLibrary.useCompressedTextures`, derselbe
  wie beim Globus) für die GPU (BC7 auf Desktops, sonst ASTC oder ETC2), `MaterialArrays` stapelt die Ebenen zu einem
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
- **402 Katalog-Objekte**, davon 393 Modelle (GLB, meshopt, WebP bis 512 px, große Klippen 1024 px) und 9 Effekt-Marker; je
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
- **9 Effekt-Marker** (`fx-*`, `file: ''`): Glühwürmchen, Rauch, Glut, Bodennebel, Laub, Schnee, Funkeln, Wasserfall
- **Tags**: Biome `temperate`, `autumn`, `winter`, `mountain`, `desert`, `swamp`, `coast`, `volcanic`, `village`,
  `castle`, `crystal`, `arena`, `city`, `wasteland`, `moon`, `mars`, `arctic`, `hell`; Rollen für Pinsel `conifer`,
  `shore`, `water`, `undergrowth`, `scree`. `category` bleibt die Art. Material- und Objekt-Ids teilen sich einen
  Namensraum
- 89 Objekte haben eine Fernstufe (`lod`, `-lod1.glb` ohne Texturen, ab 350 m bzw. 40 % der Sichtweite), 34 ein
  Licht (`light`), 40 Effekte (`effects`); 10 schwimmen (`float`: Boote, Schiff, Bojen, Seerosen, Eisscholle,
  Steg, Pier; Ursprung des Modells ist die Wasserlinie, ihr z zählt ab dem Spiegel unter ihnen, auf trockenem Boden ab
  dem Boden; eine Wassertiefe in z hebt sie in die Luft, das meldet die Prüfung `object-floating`). 9 stehen absichtlich
  in der Luft (`aloft`: Objekt-Brücken, Seilbahn-Spannen, Gondel); die Prüfung lässt sie aus
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
werden.
`MapAssetLibrary.dispose()` gibt ihn frei; `shared()` legt danach eine neue an.

**Modelle laden** (E154, PF-K3): Modelle und Detailmodelle aller Assets laden gleichzeitig (`setObjects`,
`lodModels`, beim Kartenstart schon vorab); vorher wartete jedes Asset auf das vorige. Die Transforms der Knoten
offline in die GLBs zu backen lohnt nicht: das Einbacken samt Entquantisieren (`collectParts`) kostet im Browser
23 ms für die 24 Modelle des Demo-Tals und 42 ms für die 56 der Hafenstadt, und entquantisierte Dateien wären größer.
Die Zeit steckt im Parsen der GLBs (meshopt, WebP-Texturen), das ohnehin parallel läuft.

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
- Lichter: höchstens 6 echte Punktlichter gleichzeitig, ohne Schatten. Alle Lichter (Laternen, Fackeln, Feuer, die
  Lavapunkte) sind dazu ins Land gebacken (`effects/lamp-light.ts`): zwei Texturen über die Karte (ein Texel je Meter,
  höchstens 512 je Seite, Half Float), ruhige und flackernde Lichter getrennt, je Licht ein umgekehrtes Quadrat von
  seiner Höhe, das an seiner Reichweite weich endet; Alpha hält die Bodenhöhe des Lichts. Jedes Kartenmaterial mit
  Höhennebel (Gelände, Objekte, Gras) liest sie an seinem Fragment und gibt ihr Licht mal seiner Farbe dazu, über
  dem Licht 6 bis 12 m nach oben auslaufend (ein Dach über der Laterne bleibt dunkel), Wände und Unterseiten weniger,
  Feuer flackernd mit einer Phase, die über die Karte wandert, mit weicher Grenze statt Weiß; nach Dunkelheit
  eingeblendet wie der Pool. Neu gebacken wird nur das Rechteck, das alte und neue Lichter erreichen. Die Lichthöfe
  sind nachts mindestens ein Hundertstel des Abstands breit, so lesen sie aus der Spielkamera. Gemessen
  (Render-Bench headless, High, GPU-Median, belastete Maschine): Harbor Town 1,03 bis 1,08 ms vorher, 1,06 bis 1,20
  nachher; Witch Marsh 0,80 bis 0,86 und 0,82 bis 0,90; Ember Crater 0,70 bis 0,98 und 0,70 bis 0,98
