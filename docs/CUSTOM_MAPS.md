# Eigene Karten: Renderer und Assets

**Status:** in Arbeit auf `exp/custom-maps` (ab 2026-10-11), Plan in [WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md)

Der Renderer zeichnet ein Kartendokument (`src/app/world/custom-map/map-document.ts`) mit Gelände, Bodentexturen,
Wasser, Objekten, Wegen und Himmel. Editor und Spiel benutzen dieselbe Ansicht. Code unter
`src/app/world/custom-map/render/` (ohne Angular), Assets unter `public/maps/assets/`, Werkzeuge unter
`tools/map-assets/`. Vorschau: `/map-preview` (Demo-Tal, `?view=village|forest|trees|bridge|game|…`,
`?sky=dusk|night|overcast`, `?seed=3`).

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
scene.add(view.group);
view.environment.apply(scene, renderer);   // Himmel, Umgebungslicht, Sonne mit Schatten, Nebel
renderer.shadowMap.enabled = true;         // für die Schatten der Sonne
await view.ready;                          // Materialien und Modelle geladen (vorher: grüner Platzhalter)

// je Frame
view.update(dt, camera, focus?);           // Gelände-LOD, Wind, Wasser, Objekt-Culling, Schattenbox um focus

view.heightAt(x, y);                       // Kartenraum, allokationsfrei, exakt die Fläche der feinsten Stufe
view.raycast(ray);                         // Szene-Strahl gegen das Gelände: { point, distance, x, y, height } | null
view.raycastObjects(ray);                  // erstes platziertes Objekt: { object, point, distance } | null
view.losBlockers;                          // Gruppe für den LOS-Würfel: Gelände + sichtblockierende Objekte

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
- **Rand** (`terrain-apron.ts`): Land jenseits der Karte bis 3 km, Randhöhen gehen in flache Hügel über, im Shader
  mit der ersten Schicht bemalt. Nicht Teil der Karte (keine Abfragen, `losTransparent`)

### Wege (`paths/`)

Wege werden **ins Gelände gemalt**, nicht als Streifen aufgelegt: eine RG-Maske (rot Straße, grün Pfad, 0,5 m je
Texel, höchstens 2048²) sagt dem Gelände-Shader, wo die Wegmaterialien (`cobblestone`, `dirt-path`) liegen. So folgt
ein Weg jeder Unebenheit ohne Z-Fighting, und der Höhen-Blend lässt Pflastersteine am Rand ins Gras auslaufen.
Brücken (`kind: 'bridge'`) bekommen ein Deck aus instanzierten `bridge-deck`-Stücken zwischen den Uferhöhen, mit
leichtem Bogen und mindestens 1 m über dem Wasser.

### Wasser (`water/`)

Eine Fläche auf `water.level` über den nassen Zellen der Maske. Jeder Vertex trägt die Tiefe (Spiegel minus Gelände)
an seinem Rasterpunkt, linear interpoliert wie das Gelände: der Shader kennt die Tiefe je Pixel ohne Tiefentextur.
Klar und hell am Ufer, Schaum im Flachen, Kartenfarbe in der Tiefe; Normalen aus einer kachelbaren Wellentextur in
zwei Richtungen; Spiegelung als Himmelsfarbe (Fresnel) und Sonnenglanz. `losTransparent`.

### Objekte (`objects/`)

Je Asset und Modellteil ein `InstancedMesh`. Sichtblocker (Katalog `blocksLos`, je Objekt überschreibbar) liegen in
`losBlockers` und behalten immer alle Instanzen, denn der LOS-Würfel rendert von den Türmen aus, nicht von der Kamera.
Alles andere (Gras, Blumen, kleine Requisiten) wird je Instanz auf der CPU nach Sichtweite (`drawDistance`) und
Frustum ausgesiebt. Bäume und Pflanzen wiegen sich im Wind (Vertex-Shader, nach Höhe im Modell und Phase aus der
Position); Laubkarten werden alpha-getestet, doppelseitig, mit Alpha-to-Coverage, und blenden aus, wenn man sie
von der Kante sieht. Vegetation bekommt je Instanz eine leicht andere Helligkeit. Gebäude stehen auf dem tiefsten
Punkt unter ihrem Fußabdruck.

### Umgebung (`environment/`)

Himmel als Equirect-Verlauf mit Sonnenhof, auf der CPU gerechnet (Voreinstellungen `day`, `dusk`, `night`,
`overcast`), als Hintergrund und vorgefiltert (PMREM) als Umgebungslicht. Sonne als `DirectionalLight` mit 4096er
Schattenkarte, deren Box (±300 m) dem Fokus folgt und auf Texel einrastet. Halbkugellicht, exponentieller Nebel in der
Horizontfarbe, `tint` färbt Licht und Himmel. Abgestimmt auf den Renderer des Spiels (kein Tone-Mapping, sRGB).

## Assets

`public/maps/assets/catalog.json` (Typen in `render/asset-catalog.ts`), Lizenzen in `LICENSES.md`, alles CC0:

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

Demo-Tal (257 × 257 Raster, 2 m, 8000 Objekte, Schatten an), 1920 × 1080, RTX 5080, ohne VSync gemessen
(`tmp/perf.mjs` im Worktree, Chromium mit `--disable-gpu-vsync --disable-frame-rate-limit`): 610 bis 730 fps, 75 bis
125 Draw Calls, 1,3 bis 1,5 Mio. Dreiecke je Frame (mit Schattenpass). Einmalig: Demo erzeugen ~0,5 s, Laden bis
`ready` ~1 bis 2,5 s (Texturen dekodieren und packen).

## Grenzen

- Höchstens 8 Splat-Schichten plus Klippe und zwei Wegmaterialien (12 Array-Ebenen), alle Materialien in einer Größe
- Laubkarten werfen Schatten ohne Windbewegung (Schatten und Krone gehen bei Wind minimal auseinander)
- Gelände-LOD wechselt hart (Schürzen verdecken Risse, kein Morphing)
- Der LOS-Würfel sieht das Gelände in der LOD-Stufe der Kamera
