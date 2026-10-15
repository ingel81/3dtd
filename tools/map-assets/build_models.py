"""Builds the object models of the custom map asset catalogue in Blender.

    blender --background --factory-startup --python tools/map-assets/build_models.py -- <sources> <foliage> <out> [<id> ...]

<sources>: download dir of fetch_model_sources.py (Poly Haven textures and
models, CC0); <foliage>: cards of make_foliage.py; <out>: one GLB per model,
pivot at the base centre, metres, front towards -Y in Blender (+Z in glTF).
Ids (or prefixes ending in `*`) build only those models.

Trees, plants and buildings are built procedurally from those textures:
trunks and branches as tapered tubes, crowns as foliage cards with normals
bent outwards from the crown centre (soft, round lighting), houses from
boxes with box-mapped UVs. Rocks, fern and barrel are Poly Haven models,
decimated to game budgets. Deterministic for the seeds below. The models
of the biome sets live in build_nature.py, build_structures.py and
build_props.py, build_city.py, build_space.py, build_extreme.py, build_landmarks.py, build_modern.py, build_modern2.py and build_extras.py; the helpers all share are in
blender_kit.py.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import blender_kit  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
blender_kit.configure(argv[0], argv[1], argv[2])
ONLY = argv[3:]

from blender_kit import import_model  # noqa: E402
from build_nature import broadleaf, conifer, dead_tree, grass, log, round_bush, stump  # noqa: E402
from build_props import crate, lamp_post  # noqa: E402
from build_structures import bridge_deck, fence, house, tower_ruin, wall_stone, well  # noqa: E402


def base_models():
    return {
        'tree-oak': lambda: broadleaf('tree-oak', 1, 12.0, 4.2, 0.42, 'bark_brown_02', 'leaves-oak'),
        'tree-birch': lambda: broadleaf('tree-birch', 2, 13.0, 2.6, 0.18, 'bark_platanus', 'leaves-birch',
                                        bark_tint=(1.5, 1.5, 1.45), slender=True),
        'tree-pine': lambda: conifer('tree-pine', 3, 17.0, 3.4, 0.4, 0.32),
        'tree-fir': lambda: conifer('tree-fir', 4, 13.0, 3.3, 0.08, 0.28),
        'tree-dead': lambda: dead_tree('tree-dead', 5),
        'bush': lambda: round_bush('bush', 6, 1.3, 1.5, 'leaves-bush'),
        'grass-clump': lambda: grass('grass-clump', 'grass.png', 1.1, 0.55, 7),
        'flowers': lambda: grass('flowers', 'flowers.png', 1.0, 0.5, 8),
        'stump': lambda: stump('stump'),
        'log': lambda: log('log'),
        'fern': lambda: import_model('fern_02', 0.9, 900, 'fern'),
        'rock-small': lambda: import_model('namaqualand_boulder_04', 0.9, 500, 'rock-small', desaturate=0.7),
        'rock-large': lambda: import_model('namaqualand_boulder_02', 2.6, 1200, 'rock-large', desaturate=0.7),
        'barrel': lambda: import_model('Barrel_01', 1.0, 1200, 'barrel'),
        'house': lambda: house('house', 7.0, 5.0, 3.6, 'clay_roof_tiles_02', 'grey_plaster_02', wall_tint=(1.08, 1.02, 0.9)),
        'house-large': lambda: house('house-large', 10.0, 7.0, 6.4, 'grey_roof_tiles', 'grey_plaster_02', storeys=2,
                                     wall_tint=(1.05, 0.98, 0.8)),
        'barn': lambda: house('barn', 11.0, 7.5, 4.2, 'grey_roof_tiles', 'brown_planks_07', barn=True),
        'tower-ruin': lambda: tower_ruin('tower-ruin', 9),
        'wall-stone': lambda: wall_stone('wall-stone', 10),
        'fence-wood': lambda: fence('fence-wood'),
        'crate': lambda: crate('crate'),
        'lamp-post': lambda: lamp_post('lamp-post'),
        'well': lambda: well('well'),
        'bridge-deck': lambda: bridge_deck('bridge-deck'),
    }


def wanted(name):
    return not ONLY or any(name == o or (o.endswith('*') and name.startswith(o[:-1])) for o in ONLY)


def main():
    import build_city
    import build_extras
    import build_extreme
    import build_landmarks
    import build_levels
    import build_modern
    import build_modern2
    import build_nature
    import build_props
    import build_space
    import build_structures
    import build_vehicles
    registry = base_models()
    for module in (build_nature, build_structures, build_props, build_city, build_space, build_extreme, build_vehicles, build_levels,
                   build_landmarks, build_modern, build_modern2, build_extras):
        for name, fn in module.models().items():
            assert name not in registry, name
            registry[name] = fn
    for name, fn in registry.items():
        if wanted(name):
            fn()


main()
