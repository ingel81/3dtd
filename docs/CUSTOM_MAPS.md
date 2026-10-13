# Eigene Karten: Renderer und Assets

**Status:** Aktuell, seit 0.7.0 auf `main`, im Spiel gesperrt bis zur Freigabe (TODO E134); die nächste Runde plant [CUSTOM_MAPS_NEXT_PLAN.md](CUSTOM_MAPS_NEXT_PLAN.md) (E154). Rahmen in [WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md)

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
leichtem Bogen und mindestens 1 m über dem Wasser. `style: 'stone' | 'lava'` an der Kante nimmt `bridge-deck-stone`
bzw. `bridge-deck-lava`; fehlt das Stück im Katalog, bleibt es beim Holzdeck.

### Wasser (`water/`)

Ein Material für alle Gewässer (`water-material.ts`). Die Tiefe je Pixel ist Spiegelhöhe minus Geländehöhe aus der
Höhentextur: das Ufer liegt dort, wo das Gelände die Fläche schneidet, glatt, unabhängig vom Raster. Flächen-Gewässer
werden über ihrer Maske plus zwei Zellen gezeichnet und mit der bilinearen Maske ausgeblendet (runde Kanten), mit
weichem Saum. `losTransparent`. Wasser empfängt den Schatten der Sonne (Bäume, Brücken, Ufer dunkeln Körper, Glanz und
etwas die Spiegelung) und die Punktlichter des Pools als Glanzpunkte mit schwachem Lichtfleck (Laternen, Fackeln,
Lava spiegeln sich).

- `terrain.water`: der Hauptkörper; nur er läuft über den Kartenrand weiter und macht Ufer nass
- `terrain.waterBodies`: weitere Körper mit eigenem Spiegel und eigener Maske (Datei: `terrain/water-<n>-mask.u8`)
- `terrain.rivers`: Flüsse und Lavaströme als Linie, je Punkt Breite und Spiegelhöhe, fließen vom ersten zum letzten
  Punkt; ein Band entlang der Linie (Catmull-Rom, alle 2 m), Wellen bzw. Kruste wandern stromab, schneller wo es fällt

`kind` je Körper:

- `water` (Standard): klar am Ufer, Kartenfarbe in der Tiefe, Wellen, Spiegelung des Himmels mit Fresnel, Sonnenglanz,
  Schaum im Flachen
- `sea`: stärkere Wellen und Brandungsbänder zum Ufer
- `swamp`: trüb, schwache Spiegelung; Algen und Entengrütze in Flecken nur am Ufer und im Flachen (unter etwa 0,9 m,
  mit verrauschter Kante), halb deckend und dunkler als das Land, nachts kaum sichtbar
- `ice`: deckend und still; hell über flachem, dunkles Petrol über tiefem Grund, mattierte Spiegelung, Risse, Schnee
  im Flachen
- `lava`: deckend und glühend; Krustenplatten über Adern, Farbverlauf Kruste, Dunkelrot, Orange, Gelb nur in den
  heißesten Adern (die Bloom-Schwelle fängt nur diese), am Ufer erkaltet. Lava-Körper und -Ströme bekommen
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
Schatten dithern nicht: in Zellen wirft die Stufe mit dem größeren Anteil, gepackte Objekte werfen im Band beide.
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
  beleuchtet). Die untersten Grad (unter etwa 6°) laufen in die Dunstfarbe aus, in der das Land jenseits des Rands
  versinkt (dieselbe Farbe und derselbe Zug zur Sonne wie im Höhennebel): keine helle Naht über den Hügeln am
  Horizont. Voreinstellungen `day`, `dusk`, `night`, `overcast` setzen Farben und Bedeckung. Dahinter bleibt ein
  auf der CPU gerechneter Equirect-Verlauf als Hintergrund und, vorgefiltert (PMREM), als Umgebungslicht. Das Wasser
  spiegelt denselben Himmel aus einer Textur (`uSkyTex`, obere Halbkugel, 256 × 64, Half-Float), die die Kuppel alle
  drei Frames und sofort nach einem neuen Himmel mit ihrer Funktion füllt (`SkyDome.bake`); vorher rechnete jedes
  Wasserpixel die Funktion zwei- bis dreimal (je zwei Wolkenlagen mit fünf Oktaven). GPU-Zeit Archipel 1,34 → 1,22 ms
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
  verdichten den Dunst; Nebelwetter verdichtet bis zum Sechsfachen. Asche und Glut wachsen höchstens auf das
  1,8-Fache (sonst ein Feld heller Punkte aus der Spielkamera), Asche dunkelgrau, Glut orange statt gelb-weiß
- **Wind** (`wind.ts`, `environment.wind`: `strength` 0..1, `direction` in Grad, aus der er kommt, `gusts` 0..1;
  ohne Feld der Standard des Bioms, auf dem Mond kein Wind): geteilte Uniforms für Bäume, Pflanzen, Gras, Wolken,
  Rauch, Nebelbänke, Laub, Schnee, Regen, Asche, Staub und Glut, alle in dieselbe Richtung. Böen laufen als Fronten
  über die Weltposition (etwa 70 m Abstand, 7 m/s mit dem Wind, quer gewellt), so sieht man eine Bö über Wiese und
  Wald ziehen. Kosten im Messrahmen nicht messbar (Demo-Tal 1,42 / 1,43 ms je Bild)
- **Biome** (`biomes.ts`, `environment.biome`): `temperate`, `hell`, `moon`, `mars`, `arctic`, `apocalypse`,
  `swamp`, `desert`, `mountain`, `city` setzen auf die Himmelsvoreinstellung Himmels- und Lichtfarben, Wolken,
  Dunstdichte und wie eng er am Boden liegt, Grading sowie Sterne, Planet (Mond: die Erde), Polarlicht und
  Umgebungspartikel um den Fokus (Glut, Asche, Staub, Schneetreiben)
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
eines Gegners sich von der Kamera abwendet (`uRimLight` in `vat-material.ts`, Stärke 0,55), damit Gegner sich vom
beleuchteten, detailreichen Boden abheben. Tiles und DevWorld behalten das Aussehen (Stärke 0).

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

- Höchstens 8 Splat-Schichten plus Klippe und zwei Wegmaterialien (12 Array-Ebenen), alle Materialien in einer Größe
- Laubkarten werfen Schatten ohne Windbewegung (Schatten und Krone gehen bei Wind minimal auseinander)
- Gelände-LOD: Geomorphing gleicht die Stufen in einem Abstandsband an, Schürzen verdecken Risse an Kachelkanten
- Der LOS-Würfel sieht Gelände und Objekte in der LOD-Stufe der Kamera (Impostoren als zwei gekreuzte Karten)
- Die Splat-Map ist eine Textur über die ganze Karte (keine virtuellen Kacheln); auf 2-km-Karten mit 1024er Splat
  sind das 2 m je Texel
- Partikel und Wetter werfen keine Schatten; Regen, Schnee, Asche und Staub enden an Dächern und am Boden (CoverMap
  über Gelände und Fußabdrücke der Gebäude), andere Partikel kennen das Gelände nicht
- Lichter: höchstens 6 echte Punktlichter gleichzeitig, ohne Schatten
