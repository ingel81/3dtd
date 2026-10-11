# Karten-Assets bauen

Erzeugt Bodenmaterialien und Objektmodelle für eigene Karten (`public/maps/assets/`, Katalog `catalog.json`,
Lizenzen `LICENSES.md`). Alle Quellen CC0 (Poly Haven, ambientCG). Downloads in ein eigenes Verzeichnis außerhalb
des Repos (`$DL`).

```bash
# Bodenmaterialien: color.jpg, normal.jpg, arh.jpg (AO, Rauheit, Höhe) je Material, 1024 px
python -I tools/map-assets/build_materials.py $DL/materials public/maps/assets

# Blatt- und Graskarten (PNG mit Alpha)
python -I tools/map-assets/make_foliage.py $DL/leafsets $DL/foliage

# Quellen der Modelle (Texturen, Felsen, Farn, Fass)
python -I tools/map-assets/fetch_model_sources.py $DL/models

# Modelle in Blender bauen (GLB, unkomprimiert)
blender --background --factory-startup --python tools/map-assets/build_models.py -- $DL/models $DL/foliage $DL/glb-raw

# Komprimieren: meshopt-Geometrie, WebP-Texturen bis 512 px
for f in $DL/glb-raw/*.glb; do
  npx @gltf-transform/cli optimize $f public/maps/assets/models/$(basename $f) --compress meshopt \
    --texture-compress webp --texture-size 512 --simplify false --instance false --flatten true --join true --palette false
done
```

`build_materials.py` gibt die Katalogeinträge der Materialien als JSON aus; die Objekteinträge pflegt man in
`catalog.json` von Hand (Fußabdruck, Höhe, Sichtlinie, Wind, Sichtweite).
