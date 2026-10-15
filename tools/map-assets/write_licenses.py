"""Writes public/maps/assets/LICENSES.md from the `source` of every catalogue entry.

    python -I tools/map-assets/write_licenses.py public/maps/assets

Run it after build_materials.py, build_skies.py, build_planet.py or after
editing the object entries, so the licence record always lists exactly what
the catalogue, the image skies (skies/skies.json) and the Earth ship.
"""
import json
import os
import sys

HEADER = """# Lizenzen der Karten-Assets

Alle Dateien unter `public/maps/assets/` stammen aus CC0-Quellen, aus gemeinfreien NASA-Bildern oder sind daraus
prozedural gebaut. Keine KI-Generatoren, keine Fremdmarken. Die Skripte, die sie erzeugen, liegen unter
`tools/map-assets/` (siehe dort README.md); diese Datei schreibt `write_licenses.py` aus `catalog.json`,
`skies/skies.json` und der Erde.

- Poly Haven (https://polyhaven.com), Lizenz CC0 1.0: https://polyhaven.com/license
- ambientCG (https://ambientcg.com), Lizenz CC0 1.0: https://docs.ambientcg.com/license/
- NASA Visible Earth (https://visibleearth.nasa.gov), gemeinfrei (Werk einer US-Bundesbehörde), Bildnachweis: NASA

## Bodenmaterialien (`materials/<id>/`)

| Id | Quelle |
|----|--------|
"""

OBJECTS = """
## Objekte (`models/<id>.glb`)

„prozedural“: Geometrie in Blender per Skript gebaut (`build_models.py` und die Module daneben), Texturen aus den
genannten CC0-Quellen; Blatt-Karten aus ambientCG-Blattatlanten zusammengesetzt (`make_foliage.py`), Gras, Schilf,
Blüten und Wedel gezeichnet. Poly-Haven-Modelle sind auf Spielbudgets reduziert und neu skaliert.

| Id | Quelle |
|----|--------|
"""

SKIES = """
## Himmelsbilder (`skies/<id>.webp`)

HDRIs von Poly Haven (CC0), von `build_skies.py` skaliert, teils getönt, als obere Halbkugel (WebP) gespeichert.
„nur Sterne“: Himmelsglühen je Zeile abgezogen, Land entfernt.

| Id | Quelle |
|----|--------|
"""

PLANET = """
## Erde über Mondkarten (`skies/earth.webp`)

„The Blue Marble“ (Land, Ozean, Meereis, Wolken) von NASA Visible Earth, gemeinfrei; `build_planet.py` verkleinert es
auf 1024 x 512 und legt die Glanzmaske des offenen Meers (aus der wolkenlosen Fassung) in den Alphakanal.
Bildnachweis: NASA.

| Datei | Quelle |
|-------|--------|
"""

PLANET_SOURCES = [
    ('earth.webp', 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57735/land_ocean_ice_cloud_2048.jpg'),
    ('earth.webp (Glanzmaske)', 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_2048.jpg'),
]


def main():
    root = sys.argv[1]
    catalog = json.load(open(os.path.join(root, 'catalog.json'), encoding='utf8'))
    out = HEADER
    for m in catalog['materials']:
        out += f'| {m["id"]} | {m.get("source", "")} |\n'
    out += OBJECTS
    for o in catalog['objects']:
        out += f'| {o["id"]} | {o.get("source", "")} |\n'
    skies = os.path.join(root, 'skies', 'skies.json')
    if os.path.exists(skies):
        out += SKIES
        for s in json.load(open(skies, encoding='utf8'))['skies']:
            out += f'| {s["id"]} | {s["source"]} |\n'
    if os.path.exists(os.path.join(root, 'skies', 'earth.webp')):
        out += PLANET
        for file, source in PLANET_SOURCES:
            out += f'| {file} | {source} |\n'
    with open(os.path.join(root, 'LICENSES.md'), 'w', encoding='utf8', newline='\n') as f:
        f.write(out)


main()
