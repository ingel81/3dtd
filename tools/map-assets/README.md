# Karten-Assets bauen

Erzeugt Bodenmaterialien und Objektmodelle für eigene Karten (`public/maps/assets/`, Katalog `catalog.json`,
Lizenzen `LICENSES.md`). Alle Quellen CC0 (Poly Haven, ambientCG), keine KI-Generatoren. Downloads in ein eigenes
Verzeichnis außerhalb des Repos (`$DL`). Python mit PIL/numpy/scipy, Blender 5.1 headless, Node (gltf-transform).

```bash
# Bodenmaterialien (materials.json): color.jpg, normal.jpg, arh.jpg (AO, Rauheit, Höhe), emissive.jpg bei Lava,
# 1024 px; schreibt die Materialien in catalog.json. Ids am Ende bauen nur diese neu.
python -I tools/map-assets/build_materials.py $DL/materials public/maps/assets [<id> ...]

# Dieselben als KTX2 (Basis ETC1S) in den zwei Ebenen des Geländes, je Material nicht größer als die drei JPGs
python -I tools/map-assets/pack_textures.py --ktx <ktx.exe> public/maps/assets [<id> ...] [--psnr]

# Blatt-, Gras-, Schilf-, Wedel- und Seerosenkarten (PNG mit Alpha), Kaktushaut
python -I tools/map-assets/make_foliage.py $DL/leafsets $DL/foliage

# Quellen der Modelle (Poly-Haven-Texturen und -Modelle)
python -I tools/map-assets/fetch_model_sources.py $DL/models

# Modelle in Blender bauen (GLB, unkomprimiert); Ids oder Präfixe mit * bauen nur diese
blender --background --factory-startup --python tools/map-assets/build_models.py -- $DL/models $DL/foliage $DL/glb-raw [<id> ...]

# Komprimieren (meshopt, WebP 512 px, 1024 px für textureSize 1024 in objects.json) und vermessen
python -I tools/map-assets/pack_models.py $DL/glb-raw public/maps/assets [<id> ...]

# Farbe, Rauheit und Metall der LOD-Modelle (-lod1) aus den vollen Modellen (Mittel der Texturen, linear)
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

# Objekte in catalog.json schreiben (objects.json + Messwerte + bases.json), Dreiecke je Modell und LOD
# (count_triangles.py, auch allein nach einem pack_models.py), LICENSES.md neu. Nicht gebaute Modelle (ein Bau
# einzelner Ids) behalten Fußabdruck, Höhe und LOD aus dem bisherigen catalog.json. Neue LODs: match_lods.py
# braucht ihren Katalogeintrag, also update_catalog.py, match_lods.py, update_catalog.py
python -I tools/map-assets/update_catalog.py $DL/glb-raw public/maps/assets
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
heutiger Art, Nebengebäude 4 × 4 m, offener Unterstand, Anbau),
gemeinsame Helfer in `blender_kit.py`. Klippen-Scans sind nur Wand und Krone: `import_model(..., close=True)`
schließt Rückseite und Unterseite (`close_shell`), sonst sieht man von oben oder hinten in den Fels hinein. Ein flacher
Rand (Höhe unter einem Zehntel der Breite) ist eine Unterseite und bekommt einen ebenen Boden aus seiner Mitte: so
ist der unten offene Haufen `namaqualand_boulder_02` (`rock-large`, `rock-sandstone-large`) geschlossen.

`objects.json` hält je Objekt, was ein Mensch entscheidet: Name, Kategorie, Biom-Tags, Lizenzquelle und, wo der
Kategorie-Standard nicht passt, Sichtlinie, Bauverbot, Wind, Sichtweite, Skalierbereich. Fußabdruck und Höhe misst
`pack_models.py`, solange `objects.json` sie nicht setzt. Material- und Objekt-Ids teilen sich einen Namensraum.

Biom-Tags: `temperate`, `autumn`, `winter`, `mountain`, `desert`, `swamp`, `coast`, `volcanic`, `village`, `castle`,
`crystal`, `arena`, `city`, `wasteland`, `moon`, `mars`, `arctic`, `hell`; Rollen für Pinsel: `conifer`, `shore`,
`water`, `undergrowth`, `scree`. Effekt-Marker ohne Modell stehen mit `"file": ""` in objects.json. Ansehen: `/map-preview?showcase=<tag>` oder `?assets=a,b*&materials=c,d` (Dev-Server).
