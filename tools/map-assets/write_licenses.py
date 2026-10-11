"""Writes public/maps/assets/LICENSES.md from the `source` of every catalogue entry.

    python -I tools/map-assets/write_licenses.py public/maps/assets

Run it after build_materials.py or after editing the object entries, so the
licence record always lists exactly what the catalogue ships.
"""
import json
import os
import sys

HEADER = """# Lizenzen der Karten-Assets

Alle Dateien unter `public/maps/assets/` stammen aus CC0-Quellen (gemeinfrei, keine Namensnennung nötig) oder sind
daraus prozedural gebaut. Keine KI-Generatoren, keine Fremdmarken. Die Skripte, die sie erzeugen, liegen unter
`tools/map-assets/` (siehe dort README.md); diese Datei schreibt `write_licenses.py` aus `catalog.json`.

- Poly Haven (https://polyhaven.com), Lizenz CC0 1.0: https://polyhaven.com/license
- ambientCG (https://ambientcg.com), Lizenz CC0 1.0: https://docs.ambientcg.com/license/

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


def main():
    root = sys.argv[1]
    catalog = json.load(open(os.path.join(root, 'catalog.json'), encoding='utf8'))
    out = HEADER
    for m in catalog['materials']:
        out += f'| {m["id"]} | {m.get("source", "")} |\n'
    out += OBJECTS
    for o in catalog['objects']:
        out += f'| {o["id"]} | {o.get("source", "")} |\n'
    with open(os.path.join(root, 'LICENSES.md'), 'w', encoding='utf8', newline='\n') as f:
        f.write(out)


main()
