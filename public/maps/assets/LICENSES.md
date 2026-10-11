# Lizenzen der Karten-Assets

Alle Dateien unter `public/maps/assets/` stammen aus CC0-Quellen (gemeinfrei, keine Namensnennung nötig) oder sind
daraus prozedural gebaut. Keine KI-Generatoren, keine Fremdmarken. Die Skripte, die sie erzeugen, liegen unter
`tools/map-assets/` (siehe dort README.md).

- Poly Haven (https://polyhaven.com), Lizenz CC0 1.0: https://polyhaven.com/license
- ambientCG (https://ambientcg.com), Lizenz CC0 1.0: https://docs.ambientcg.com/license/

## Bodenmaterialien (`materials/<id>/`)

| Id | Quelle |
|----|--------|
| grass | https://ambientcg.com/view?id=Grass004 |
| grass-lush | https://ambientcg.com/view?id=Grass001 |
| grass-dry | https://ambientcg.com/view?id=Ground037 |
| meadow | https://ambientcg.com/view?id=Ground003 |
| dirt | https://polyhaven.com/a/brown_mud_dry |
| mud | https://polyhaven.com/a/brown_mud_02 |
| forest-floor | https://polyhaven.com/a/forest_leaves_04 |
| forest-ground | https://polyhaven.com/a/forest_ground_04 |
| rocky-ground | https://polyhaven.com/a/rocky_trail |
| gravel | https://polyhaven.com/a/rock_ground |
| cliff | https://polyhaven.com/a/aerial_rocks_02 |
| rock-mossy | https://polyhaven.com/a/mossy_rock |
| sand | https://polyhaven.com/a/sand_01 |
| snow | https://polyhaven.com/a/snow_01 |
| cobblestone | https://polyhaven.com/a/cobblestone_floor_05 |
| paving | https://polyhaven.com/a/stone_tiles_02 |
| dirt-path | https://polyhaven.com/a/grass_path_2 |

## Objekte (`models/<id>.glb`)

„prozedural“: Geometrie in Blender per Skript gebaut (`build_models.py`), Texturen aus den genannten CC0-Quellen;
Blatt-Karten aus ambientCG-Blattatlanten zusammengesetzt (`make_foliage.py`), Gras und Blumen gezeichnet.

| Id | Quelle |
|----|--------|
| tree-oak | procedural (tools/map-assets/build_models.py); Rinde https://polyhaven.com/a/bark_brown_02; Blätter https://ambientcg.com/view?id=LeafSet024, LeafSet016 |
| tree-birch | procedural (tools/map-assets/build_models.py); Rinde https://polyhaven.com/a/bark_platanus; Blätter https://ambientcg.com/view?id=LeafSet014 |
| tree-pine | procedural (tools/map-assets/build_models.py); Rinde https://polyhaven.com/a/knotted_pine_bark; Nadeln https://ambientcg.com/view?id=LeafSet019 |
| tree-fir | procedural (tools/map-assets/build_models.py); Rinde https://polyhaven.com/a/knotted_pine_bark; Nadeln https://ambientcg.com/view?id=LeafSet019 |
| tree-dead | procedural (tools/map-assets/build_models.py); Rinde https://polyhaven.com/a/bark_brown_02 |
| bush | procedural (tools/map-assets/build_models.py); Blätter https://ambientcg.com/view?id=LeafSet002 |
| fern | https://polyhaven.com/a/fern_02 |
| grass-clump | procedural (tools/map-assets/build_models.py) |
| flowers | procedural (tools/map-assets/build_models.py) |
| stump | procedural (tools/map-assets/build_models.py); https://polyhaven.com/a/bark_brown_02, https://polyhaven.com/a/rough_wood |
| log | procedural (tools/map-assets/build_models.py); https://polyhaven.com/a/bark_brown_02 |
| rock-small | https://polyhaven.com/a/namaqualand_boulder_04 |
| rock-large | https://polyhaven.com/a/namaqualand_boulder_02 |
| house | procedural (tools/map-assets/build_models.py); https://polyhaven.com/a/clay_plaster, medieval_wood, clay_roof_tiles_02, castle_wall_slates |
| house-large | procedural (tools/map-assets/build_models.py); https://polyhaven.com/a/grey_plaster_02, medieval_wood, grey_roof_tiles, castle_wall_slates |
| barn | procedural (tools/map-assets/build_models.py); https://polyhaven.com/a/brown_planks_07, grey_roof_tiles, castle_wall_slates |
| tower-ruin | procedural (tools/map-assets/build_models.py); https://polyhaven.com/a/castle_brick_07 |
| wall-stone | procedural (tools/map-assets/build_models.py); https://polyhaven.com/a/stacked_stone_wall |
| fence-wood | procedural (tools/map-assets/build_models.py); https://polyhaven.com/a/rough_wood |
| crate | procedural (tools/map-assets/build_models.py); https://polyhaven.com/a/brown_planks_04, dark_planks |
| barrel | https://polyhaven.com/a/Barrel_01 |
| lamp-post | procedural (tools/map-assets/build_models.py); https://polyhaven.com/a/dark_planks |
| well | procedural (tools/map-assets/build_models.py); https://polyhaven.com/a/castle_wall_slates, rough_wood, clay_roof_tiles_02 |
| bridge-deck | procedural (tools/map-assets/build_models.py); https://polyhaven.com/a/brown_planks_07, dark_planks |
