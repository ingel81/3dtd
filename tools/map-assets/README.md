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

# Objekte in catalog.json schreiben (objects.json + Messwerte), LICENSES.md neu
python -I tools/map-assets/update_catalog.py $DL/glb-raw public/maps/assets
```

Aufteilung der Blender-Skripte: `build_models.py` (Einstieg, Register, Grundbestand), `build_nature.py` (Bäume,
Pflanzen, Felsen, Klippen, Kristalle), `build_structures.py` (Häuser, Burg, Brücken, Mauern), `build_props.py`
(Requisiten), `build_city.py` (Stadt, Endzeit), `build_space.py` (Mond, Mars), `build_extreme.py` (Arktis, Hölle,
Berge, Sumpf, Wüste), gemeinsame Helfer in `blender_kit.py`.

`objects.json` hält je Objekt, was ein Mensch entscheidet: Name, Kategorie, Biom-Tags, Lizenzquelle und, wo der
Kategorie-Standard nicht passt, Sichtlinie, Bauverbot, Wind, Sichtweite, Skalierbereich. Fußabdruck und Höhe misst
`pack_models.py`, solange `objects.json` sie nicht setzt. Material- und Objekt-Ids teilen sich einen Namensraum.

Biom-Tags: `temperate`, `autumn`, `winter`, `mountain`, `desert`, `swamp`, `coast`, `volcanic`, `village`, `castle`,
`crystal`, `arena`, `city`, `wasteland`, `moon`, `mars`, `arctic`, `hell`; Rollen für Pinsel: `conifer`, `shore`,
`water`, `undergrowth`, `scree`. Effekt-Marker ohne Modell stehen mit `"file": ""` in objects.json. Ansehen: `/map-preview?showcase=<tag>` oder `?assets=a,b*&materials=c,d` (Dev-Server).
