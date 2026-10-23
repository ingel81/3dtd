# Karten-Assets bauen

Erzeugt Bodenmaterialien und Objektmodelle für eigene Karten (`public/maps/assets/`, Katalog `catalog.json`,
Lizenzen `LICENSES.md`). Alle Quellen CC0 (Poly Haven, ambientCG) oder in Blender gebaut, keine KI-Generatoren. Downloads in ein eigenes
Verzeichnis außerhalb des Repos (`$DL`). Python mit PIL/numpy/scipy, Blender 5.1 headless, Node (gltf-transform).

```bash
# Bodenmaterialien (materials.json): color.jpg, normal.jpg, arh.jpg (AO, Rauheit, Höhe), emissive.jpg bei Lava,
# 1024 px; schreibt die Materialien in catalog.json. Ids am Ende bauen nur diese neu.
python -I tools/map-assets/build_materials.py $DL/materials public/maps/assets [<id> ...]

# Gebackene Böden (E214, `source: "baked"` in materials.json): ein Stück Boden aus Geometrie (Relief aus kachelbarem
# Rauschen, Halme in Horsten, Klee, Blüten, Laub, Nadeln, Zweige, Wurzeln, Kiesel, Steine, Rippel, Risse,
# Windgangeln), von oben in fünf Durchgängen gerendert (Farbe, Normale, Höhe, AO, Rauheit); Rezepte in
# ground_recipes.py. build_materials.py liest sie aus $DL/grounds/<id>/, legt einen Teil der Verdeckung und des
# kleinen Reliefs in die Farbe (wie ein Foto sie trägt), bringt die Normalen auf die Stärke der Scans (NORMAL_RMS)
# übermalt die Farbe mit einem Kuwahara-Filter (Pinselflächen statt Render-Rauschen, kachelbar) und bringt die Mittelfarbe auf `target` (Helligkeit ganz, Ton halb: die Karten sind darauf abgestimmt)
blender --background --factory-startup --python tools/map-assets/bake_grounds.py -- $DL/grounds [<id> ...]

# Grasschichten tragen in materials.json ihre Halme (`blades`: Höhe von und bis, Breite in m, `heads` für Samenstände
# und Blüten); build_materials.py schreibt sie in den Katalog
# Dieselben als KTX2 (Basis ETC1S) in den zwei Ebenen des Geländes, je Material nicht größer als die drei JPGs
python -I tools/map-assets/pack_textures.py --ktx <ktx.exe> public/maps/assets [<id> ...] [--psnr]

# Blatt-, Gras-, Schilf-, Wedel- und Seerosenkarten (PNG mit Alpha), Kaktushaut
python -I tools/map-assets/make_foliage.py $DL/leafsets $DL/foliage

# Quellen der Modelle (Poly-Haven-Texturen und -Modelle)
python -I tools/map-assets/fetch_model_sources.py $DL/models

# Modelle in Blender bauen (GLB, unkomprimiert); Ids oder Präfixe mit * bauen nur diese
blender --background --factory-startup --python tools/map-assets/build_models.py -- $DL/models $DL/foliage $DL/glb-raw [<id> ...]

# Komprimieren und vermessen: meshopt, dann die Texturen als geteilte KTX2-Dateien in textures/ (512 px, 1024 px für
# textureSize 1024 in objects.json; ETC1S, UASTC für Normalen und wo ETC1S die Textur nicht hält; tools/model-pack).
# Braucht `npm install` in tools/model-pack und KTX_TOOL (ktx.exe aus KTX-Software 4.4)
python -I tools/map-assets/pack_models.py $DL/glb-raw public/maps/assets [<id> ...]

# Laub- und Nadelbäume bauen ihre Fernkopie (-lod1) in broadleaf()/conifer() selbst, auf den Materialien des Modells
# (gleiche Namen: das Spiel zeichnet sie mit dessen Materialien); objects.json `lodSharesTextures` packt ihre Texturen
# in der Größe des Modells, so sind es dieselben geteilten KTX2-Dateien
# Farbe, Rauheit und Metall der LOD-Modelle (-lod1) aus den vollen Modellen (Mittel der Texturen, linear; liest die
# KTX2-Dateien mit KTX_TOOL)
python -I tools/map-assets/match_lods.py public/maps/assets [<id> ...]

# Himmelsbilder (Poly-Haven-HDRIs, 4k): obere Halbkugel als WebP und skies/skies.json mit Sonne und Farben,
# danach LICENSES.md neu (write_licenses.py). Braucht zusätzlich OpenCV (liest .hdr). Ids am Ende bauen nur diese neu.
python -I tools/map-assets/build_skies.py $DL/skies public/maps/assets [<id> ...]
python -I tools/map-assets/write_licenses.py public/maps/assets

# Erde über Mondkarten (NASA Blue Marble, gemeinfrei): skies/earth.webp 1024 x 512, Alpha = Glanz auf offenem Meer;
# danach write_licenses.py
python -I tools/map-assets/build_planet.py $DL/planet public/maps/assets

# Unterseite der Felsen aus objects.json an den gepackten Modellen messen (bases.json)
node tools/map-assets/measure_bases.mjs public/maps/assets

# Grundrechteck der Gebäude und Mauern (boxes.json) und Oberkante dessen, was Tower trägt (roofs.json, aus dem
# Katalog gelesen: nach update_catalog.py messen, dann update_catalog.py noch einmal)
node tools/map-assets/measure_boxes.mjs public/maps/assets
node tools/map-assets/measure_roofs.mjs public/maps/assets

# Fernkopie der Stadthäuser (city_house in build_modern.py) neu aus dem gepackten Modell, wenn dessen Quellen fehlen:
# jede Fassade eine Fläche, Fenster und Türen als Rechtecke darauf (blender_kit.facade_lod; der Bau macht dasselbe über
# export_lod(..., facades=CITY_FACADES)). Braucht `npm install` in tools/model-pack; danach meshopt, match_lods.py,
# count_triangles.py, stage_tones.mjs
node tools/map-assets/unpack_glb.mjs public/maps/assets/models/<id>.glb $TMP/<id>.glb
blender --background --factory-startup --python tools/map-assets/relod_facades.py -- $TMP public/maps/assets/models <id> [<id> ...]
npx -y @gltf-transform/cli@4.5.1 meshopt $TMP/<id>-lod1.glb public/maps/assets/models/<id>-lod1.glb

# Fernkopien (-lod1) für Modelle ohne LOD: über 1500 Dreiecke und Mauern ab 150 (meshoptimizer, flach schattiert, Farben
# danach aus match_lods.py); komprimieren, dann update_catalog.py, match_lods.py <ids>, update_catalog.py
node tools/map-assets/make_far_lods.mjs public/maps/assets [<id> ...]
npx -y @gltf-transform/cli@4.5.1 meshopt public/maps/assets/models/<id>-lod1.glb public/maps/assets/models/<id>-lod1.glb

# Fernstufe der Gebäude (und Rebzeilen, Hecken als Block): Kasten mit 3 x 3 Dachhöhen und gebackenem Atlas (farboxes.json, models/far-boxes.ktx2, KTX_TOOL);
# danach update_catalog.py (Feld `far`). Playwright aus e2e/node_modules
node tools/map-assets/bake_far_boxes.mjs public/maps/assets

# Farben des Fernbands der Linienstücke (Mauern, Zäune, Hecken, Gleise; bands.json, Feld `band`): das volle Modell
# von oben und von beiden Längsseiten gerastert (Farbtextur linear mal Faktor, Alpha schneidet), Mittel oben und
# seitlich, Deckung der Seite (`cover`) unter 85 %; liest die KTX2-Dateien mit dem Basis-Transcoder von three. Dazu
# die Keller unter Gebäuden (cellars.json, Feld `cellar`): am Erdgeschoss die Oberfläche des Kits nach der Wandtextur,
# ihr Ton (verwitterte Modelle mit AO), die Oberkante der Sockelleiste, die Rahmenfarbe. Danach update_catalog.py
# (CELLAR_VERBOSE=1 zeigt je Modell Wandtextur und Werte)
node tools/map-assets/measure_bands.mjs public/maps/assets

# Objekte in catalog.json schreiben (objects.json + Messwerte + bases.json), Dreiecke je Modell und LOD
# (count_triangles.py, auch allein nach einem pack_models.py), LICENSES.md neu; vorher pack-map-models.mjs über alle
# Modelle (räumt Texturen weg, die kein Modell mehr nennt) und je Datei die geteilten Texturen (`textures`). Nicht gebaute Modelle (ein Bau
# einzelner Ids) behalten Fußabdruck, Höhe und LOD aus dem bisherigen catalog.json. Neue LODs: match_lods.py
# braucht ihren Katalogeintrag, also update_catalog.py, match_lods.py, update_catalog.py
python -I tools/map-assets/update_catalog.py $DL/glb-raw public/maps/assets

# Ton der Detailstufen (LOD-Modell, Fernkasten): jede Stufe gegen das volle Modell im Licht des Spiels gemessen
# (/map-preview, ein laufender Dev-Server), Faktor je Kanal in stage-tones.json und per stage_tones.py in den Katalog
# (`lod[].tone`, `far.tone`; update_catalog.py übernimmt ihn). Nach jedem neuen oder geänderten LOD-Modell und
# Fernkasten (match_lods.py, bake_far_boxes.mjs), zweimal (der zweite Lauf verfeinert); --report misst nur.
# packed-models.spec.ts meldet Stufen ohne Ton
node tools/map-assets/stage_tones.mjs --url http://localhost:<port> [--report] [<id> ...]
```

Aufteilung der Blender-Skripte: `build_models.py` (Einstieg, Register, Grundbestand), `build_nature.py` (Bäume,
Pflanzen, Felsen, Klippen, Kristalle), `build_structures.py` (Häuser, Burg, Brücken, Mauern), `build_props.py`
(Requisiten), `build_city.py` (Stadt, Endzeit), `build_space.py` (Mond, Mars), `build_extreme.py` (Arktis, Hölle,
Berge, Sumpf, Wüste), `build_landmarks.py` (Tunnelportale, Burgruine, Gletscher, Séracs, Lawinenverbauung,
Schiffswrack, Rakete, Obsidianturm, Lichtmasten, Glockenturm, Steinkreis, Tribok, eingestürzte Hochstraße),
`build_modern.py` (heutige Gebäude für OSM-Welten: Wohnhäuser, Doppel- und Reihenhäuser, Garagen, Gartenhaus,
Carports, Tankstellendach, Blockrand-Module, Bürohäuser, Supermarkt, Hallen, Schule, Rathaus,
Stadtkirche, Bahnhof, Parkhaus, Gewächshaus, Kiosk, Trafostation; Gleis, Bahnsteig, Oberleitungsmast, Prellbock,
Hochspannungsmast, Rebzeile, Obstbaum, Spielgeräte, Fußballtor, Brunnen),
`build_modern2.py` (weitere Arten für OSM-Welten: Laden, Geschäftshaus, Bürohochhaus mit Bandfenstern, Scheune
heutiger Art, Nebengebäude 4 × 4 m, offener Unterstand, Anbau; `building-mass`: kein Gebäude, je Oberfläche der
Bauten aus dem Grundriss ein Quadrat so breit wie eine Wiederholung ihrer Textur, render/objects/mass-layer.ts),
`build_poi.py` (Sport- und Spielgeräte, Straßenmöbel, Ladenfronten, Markise, Schilder mit leerer Schildfläche für
OSM-Flächen und POIs; Fassadenobjekte haben den Ursprung auf der Wand am Fuß, Front -Y), `build_oldtown.py` (Altstadthäuser für OSM-Welten: Fachwerk über Sandstein- oder Putz-Erdgeschoss, steile Ziegeldächer, Giebel oder Traufe zur Straße, Verwitterung per `bake_ao` grime),
`build_boats.py` (Fischkutter), `build_cattle.py` (Kühe in drei Posen, vier Fellarten im Atlas), gemeinsame Helfer in `blender_kit.py`.

Gebackene Oberflächen (`blender_kit.bake_surface`, Materialien mit `Nodes`): statt gekachelter Texturen rechnen
prozedurale Materialien Farbe über Planken, Kantenabrieb (Bevel-Knoten), Schmutz in Ecken (AO-Knoten), Rostläufe,
Algen an der Wasserlinie usw. aus der Geometrie; Cycles backt sie in eigene Texturen des Modells (Farbe, Normale,
AO/Rauheit/Metall in einer ORM-Textur, eine UV-Karte, ein Material). Fensterglas, Lampen und Alpha-Karten bleiben
eigene Materialien (`keep`). `export_lod(..., textured=True)` behält im LOD die gebackene Textur. Die Fernstufen
dezimiert `decimate_keeping`: Materialien mit höchstens 24 Flächen bleiben ganz (ein Dach aus vier großen Flächen
verschwand sonst, E236), und der Bau bricht ab, wenn ein Material in der Fernstufe keine Fläche mehr hat.
Die Dachrinne (`blender_kit.gutter`) ist eine offene Halbrundrinne mit Wulst und Böden, keine Röhre. Ihre Flächen
und die der Fallrohre sind schmaler als ein Texel der AO-Textur (`bake_ao`) und bekämen beim Backen keinen eigenen Wert (sie lasen, was der
Rand des Backens dort hinterließ, oft Schwarz). `mark_ao_flat` legt sie auf einen Streifen am rechten Bildrand
(`AO_FLAT_TEXELS`), der fest bei `AO_FLAT_VALUE` bleibt.
`variants=(n, set_look)` backt n Ansichten desselben Netzes in ein Raster-Atlas (Katalog `variants`).
Texturierte LODs packt `pack_models.py` mit der halben Texturgröße ihres Modells (mindestens 256 px). Klippen-Scans sind nur Wand und Krone: `import_model(..., close=True)`
schließt Rückseite und Unterseite (`close_shell`), sonst sieht man von oben oder hinten in den Fels hinein. Ein flacher
Rand (Höhe unter einem Zehntel der Breite) ist eine Unterseite und bekommt einen ebenen Boden aus seiner Mitte: so
ist der unten offene Haufen `namaqualand_boulder_02` (`rock-large`, `rock-sandstone-large`) geschlossen.

`objects.json` hält je Objekt, was ein Mensch entscheidet: Name, Kategorie, Biom-Tags, Lizenzquelle und, wo der
Kategorie-Standard nicht passt, Sichtlinie, Bauverbot, Wind, Skalierbereich (wie weit ein Objekt gezeichnet wird,
folgt aus seiner Größe, `drawPixels` in `render-quality.ts`). Fußabdruck und Höhe misst
`pack_models.py`, solange `objects.json` sie nicht setzt. Material- und Objekt-Ids teilen sich einen Namensraum.

Biom-Tags: `temperate`, `autumn`, `winter`, `mountain`, `desert`, `swamp`, `coast`, `volcanic`, `village`, `castle`,
`crystal`, `arena`, `city`, `wasteland`, `moon`, `mars`, `arctic`, `hell`; Rollen für Pinsel: `conifer`, `shore`,
`water`, `undergrowth`, `scree`. Effekt-Marker ohne Modell stehen mit `"file": ""` in objects.json. Ansehen: `/map-preview?showcase=<tag>` oder `?assets=a,b*&materials=c,d` (Dev-Server).
