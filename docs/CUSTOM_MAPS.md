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
const view = new CustomMapView(doc, MapAssetLibrary.shared(), { anisotropy: renderer.capabilities.getMaxAnisotropy() });
view.attach(scene);                        // group + losBlockers als direkte Kinder der Szene
view.environment.apply(scene, renderer);   // Himmel, Umgebungslicht, Sonne mit Schatten, Nebel
renderer.shadowMap.enabled = true;         // für die Schatten der Sonne
await view.ready;                          // Materialien und Modelle geladen (vorher: grüner Platzhalter)

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
view.setObjects(objects);                  // alle Objekte ersetzen (Promise)
view.updateObject(obj);                    // eins verschoben/gedreht/skaliert; anderes Asset baut neu
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
  Zellen sind entlang der Diagonale (i, j) → (i+1, j+1) geteilt, wie `HeightField.heightAt` rechnet
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

Eine Fläche auf `water.level` über den nassen Zellen der Maske. Jeder Vertex trägt die Tiefe (Spiegel minus Gelände)
an seinem Rasterpunkt, linear interpoliert wie das Gelände: der Shader kennt die Tiefe je Pixel ohne Tiefentextur.
Klar und hell am Ufer, Schaum im Flachen, Kartenfarbe in der Tiefe; Normalen aus einer kachelbaren Wellentextur in
zwei Richtungen; Spiegelung des Himmels (Fresnel) und Sonnenglanz. `losTransparent`.

Weitere Gewässer: `terrain.waterBodies` (je Körper eigener Spiegel und eigene Maske, in der Datei als
`terrain/water-<n>-mask.u8`), z. B. ein See am Hang oder ein Lavabecken. `kind` je Körper:

- `water` (Standard): wie oben. Nur der Hauptkörper `terrain.water` läuft über den Kartenrand weiter und macht Ufer
  nass
- `lava`: deckend und glühend, Krustenplatten treiben über pulsierenden Rissen in der Körperfarbe, am Ufer erkaltet;
  mit Bloom leuchtet es
- `ice`: deckend und still, graublau mit feinem Reif (zum Ufer dichter), Rissen und schwacher Spiegelung

Lava als Bodenschicht: Katalog-Materialien mit `emissive` (0..1) glühen in den tiefen Stellen ihrer Textur (Risse)
und pulsieren, `flow` (m/s) lässt die Schicht entlang Karten-+x fließen.

### Objekte (`objects/`)

Je Asset und Modellteil ein `InstancedMesh`. Laubkarten behalten ihre gesetzten Normalen auch auf der Rückseite
(three dreht sie bei doppelseitigen Materialien um, das machte Kartenrücken schwarz); Gras- und Blumenkarten zeigen
mit der Normalen nach oben und blenden zur Sichtweite hin aus. Sichtblocker (Katalog `blocksLos`, je Objekt überschreibbar) liegen in
`losBlockers` und behalten immer alle Instanzen, denn der LOS-Würfel rendert von den Türmen aus, nicht von der Kamera.
Alles andere (Gras, Blumen, kleine Requisiten) wird je Instanz auf der CPU nach Sichtweite (`drawDistance`) und
Frustum ausgesiebt. Bäume und Pflanzen wiegen sich im Wind (Vertex-Shader, nach Höhe im Modell und Phase aus der
Position); Laubkarten werden alpha-getestet, doppelseitig, mit Alpha-to-Coverage, und blenden aus, wenn man sie
von der Kante sieht. Vegetation bekommt je Instanz eine leicht andere Helligkeit und einen Farbton. Gebäude stehen auf
dem tiefsten von acht Punkten ihres Fußabdrucks, ihre Fundamente reichen bis 1,5 m in den Boden.

Detailstufen: Katalogeinträge mit `lod` (Datei und Kameraabstand, ab dem sie gilt) bekommen je Stufe eigene
Instanz-Meshes; bei jeder Kamerabewegung wandert jede Instanz in die Stufe ihres Abstands (auch Sichtblocker, der
LOS-Würfel sieht dann die Stufe der Kamera). Ohne `lod` bleiben die Puffer statisch.

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
- **Sonne**: `DirectionalLight` mit 4096er Schattenkarte (PCF, Radius 2,5 Texel), deren Box dem Fokus folgt, auf
  Texel einrastet und mit dem Kameraabstand wächst (70 bis 450 m): nah scharf, von oben weit
- **Höhennebel** (`height-fog.ts`): die Materialien der Karte ersetzen das Nebel-Fragment der Szene; die Dichte nimmt
  über dem tiefen Boden der Karte ab und wird entlang des Blickstrahls geschlossen integriert, zur Sonne hin färbt
  sich der Dunst. Die Szene behält `FogExp2` für Farbe und Dichte
- **Wetter** (`weather.ts`, `environment.weather`: `rain`, `snow`, `fog`, Stärke `weatherStrength`): Regen und
  Schnee füllen einen Kasten um den Kamerafokus, der beim Bewegen umklappt (zustandslos), Teilchen wachsen mit dem
  Abstand, damit man sie aus der Spielkamera sieht. Regen und Schnee schließen die Wolken, dämpfen die Sonne und
  verdichten den Dunst; Nebelwetter verdichtet bis zum Sechsfachen
- Halbkugellicht, `tint` färbt Licht und Himmel. Abgestimmt auf den Renderer des Spiels (kein Tone-Mapping, sRGB);
  `/map-preview?post=bloom` rendert durch die Post-Processing-Kette des Spiels

## Assets

`public/maps/assets/catalog.json` (Typen in `render/asset-catalog.ts`), Lizenzen in `LICENSES.md`, alles CC0.
Schema (Version 1, alle neuen Felder optional): Materialien mit `tags`, `emissive`, `flow`, Kategorien auch `ice`,
`volcanic`, `wood`; Objekte mit `tags`, `effects`, `light`, `lod`, Kategorien auch `structure` und `fx`. Den Bestand
baut der Asset-Worker aus; Stand beim Schreiben:

- **17 Bodenmaterialien** (Poly Haven, ambientCG), je `color.jpg`, `normal.jpg` (OpenGL), `arh.jpg` (AO, Rauheit,
  Höhe), 1024 px: Gras, sattes Gras, trockenes Gras, Wiese, Erde, Schlamm, Laubboden, Waldboden, steiniger Boden,
  Kies, Fels (Klippe), moosiger Fels, Sand, Schnee, Kopfsteinpflaster, Steinplatten, Feldweg
- **24 Objekte** (GLB, meshopt, WebP bis 512 px): Eiche, Birke, Kiefer, Tanne, toter Baum, Busch, Farn, Gras, Blumen,
  Stumpf, Stamm, Stein, Fels, Fachwerkhaus, großes Haus, Scheune, Turmruine, Steinmauer, Holzzaun, Kiste, Fass,
  Laterne, Brunnen, Brückenstück
- Größe: Materialien 21 MB, Modelle 5 MB

`MapAssetLibrary.shared()` lädt Katalog, Materialpixel und Modelle einmal und teilt sie zwischen Ansichten. Fehlt eine
Datei, zeichnet die Karte trotzdem: Material in der Durchschnittsfarbe, Modell als Platzhalterform.

Neu bauen: [tools/map-assets/README.md](../tools/map-assets/README.md) (Python mit PIL/numpy/scipy, Blender 5.1
headless, gltf-transform).

## Leistung

Demo-Tal (257 × 257 Raster, 2 m, rund 13 000 Objekte, Schatten, Himmelskuppel, Höhennebel), 1920 × 1080, RTX 5080, ohne VSync gemessen
(`tmp/perf.mjs` im Worktree, Chromium mit `--disable-gpu-vsync --disable-frame-rate-limit`): 500 bis 530 fps, 55 bis
125 Draw Calls, 1,7 bis 1,8 Mio. Dreiecke je Frame (mit Schattenpass). Einmalig: Demo erzeugen ~0,5 s, Laden bis
`ready` ~1 bis 2,5 s (Texturen dekodieren und packen).

## Grenzen

- Höchstens 8 Splat-Schichten plus Klippe und zwei Wegmaterialien (12 Array-Ebenen), alle Materialien in einer Größe
- Laubkarten werfen Schatten ohne Windbewegung (Schatten und Krone gehen bei Wind minimal auseinander)
- Gelände-LOD wechselt hart (Schürzen verdecken Risse, kein Morphing)
- Der LOS-Würfel sieht Gelände und Objekte in der LOD-Stufe der Kamera
- Partikel und Wetter werfen keine Schatten und kennen kein Gelände (Regen fällt durch Dächer)
- Lichter: höchstens 6 echte Punktlichter gleichzeitig, ohne Schatten
