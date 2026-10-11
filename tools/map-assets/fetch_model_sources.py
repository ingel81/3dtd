"""Downloads the CC0 sources of the map object models (Poly Haven).

    python -I tools/map-assets/fetch_model_sources.py <download-dir>

Textures (1k: diff, nor_gl, arm) for the procedural models and the glTF
models used as they are (rocks, fern, barrel). Blender reads them from the
download dir (build_models.py).
"""
import json
import os
import sys
import urllib.request

TEXTURES = [
    'bark_brown_02', 'knotted_pine_bark', 'bark_platanus', 'clay_plaster', 'grey_plaster_02',
    'medieval_wood', 'clay_roof_tiles_02', 'grey_roof_tiles', 'castle_wall_slates', 'brown_planks_07',
    'brown_planks_04', 'castle_brick_07', 'stacked_stone_wall', 'dark_planks', 'rough_wood',
    # Trees and plants
    'bark_willow', 'palm_tree_bark', 'pine_bark', 'bark_brown_01',
    # Buildings, castle, bridges
    'thatch_roof_angled', 'reed_roof_04', 'roof_slates_02', 'castle_brick_01', 'castle_brick_02_white',
    'medieval_blocks_02', 'defense_wall', 'mossy_stone_wall', 'broken_wall', 'rock_wall_10',
    'patterned_clay_wall', 'clay_block_wall', 'sandstone_blocks_04', 'white_sandstone_bricks',
    'weathered_planks', 'wood_planks_grey', 'old_planks_02', 'wood_trunk_wall', 'roof_planks',
    'stone_block_wall', 'whitewashed_brick', 'beige_wall_001',
    # Cloth and metal
    'hessian_230', 'rough_linen', 'rusty_metal_02', 'metal_plate',
    # Rock surfaces for procedural rocks (crystals, stalagmites, mesas, pillars)
    'rock_face', 'cliff_side', 'sandstone_cracks', 'dark_rock', 'dark_rock_02', 'rock_boulder_dry',
]
MODELS = [
    'namaqualand_boulder_02', 'namaqualand_boulder_04', 'fern_02', 'Barrel_01', 'dead_tree_trunk',
    # Rocks and cliffs
    'boulder_01', 'rock_07', 'rock_09', 'stone_01', 'rock_face_01', 'rock_face_02', 'rock_moss_set_01',
    'rock_moss_set_02', 'namaqualand_boulder_03', 'namaqualand_boulder_05', 'namaqualand_boulder_06',
    'namaqualand_cliff_01', 'namaqualand_cliff_02', 'namaqualand_rocks_01', 'namaqualand_stones_01',
    'coast_rocks_01', 'coastal_cliff_02', 'moon_rock_01', 'moon_rock_03', 'moon_rock_05', 'sand_rocks_small_01',
    # Plants
    'nettle_plant', 'weed_plant_02',
    'dandelion_01', 'periwinkle_plant', 'flower_gazania', 'flower_ursinia', 'flower_empodium',
    'cheiridopsis_succulent', 'crystalline_iceplant', 'quiver_tree_01', 'quiver_tree_02',
    'dead_quiver_trunk', 'searsia_lucida', 'jacaranda_tree', 'tree_stump_01', 'tree_stump_02',
    'dead_tree_trunk_02', 'root_cluster_01', 'dry_branches_medium_01', 'pine_roots', 'moss_01',
    # Props and structures
    'Barrel_02', 'barrel_03', 'wine_barrel_01', 'wooden_barrels_01', 'wooden_crate_01', 'wooden_crate_02',
    'wooden_bucket_01', 'wooden_bucket_02', 'wooden_lantern_01', 'Lantern_01', 'cannon_01', 'treasure_chest',
    'kite_shield', 'hatchet', 'wooden_axe', 'picke_dirty_01', 'rusted_spade_01', 'wooden_ladder',
    'spinning_wheel_01', 'wicker_basket_01', 'horse_statue_01', 'gothic_statue', 'marble_bust_01',
    'large_castle_door', 'large_iron_gate', 'modular_fort_01', 'modular_wooden_pier', 'dutch_ship_medium',
    'ship_pinnace', 'WoodenTable_01', 'ornate_medieval_mace', 'antique_estoc', 'ornate_war_hammer',
]


def get(url, path):
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers={'User-Agent': '3dtd-map-assets'})
    with urllib.request.urlopen(req) as r, open(path, 'wb') as f:
        f.write(r.read())


def api(asset):
    req = urllib.request.Request(f'https://api.polyhaven.com/files/{asset}', headers={'User-Agent': '3dtd-map-assets'})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def main():
    dl = sys.argv[1]
    for t in TEXTURES:
        files = api(t)
        for key in ('Diffuse', 'nor_gl', 'arm'):
            url = files[key]['1k']['jpg']['url']
            get(url, os.path.join(dl, 'textures', t, os.path.basename(url)))
        print('texture', t, file=sys.stderr)
    for m in MODELS:
        g = api(m)['gltf']['1k']['gltf']
        base = os.path.join(dl, 'models', m)
        get(g['url'], os.path.join(base, os.path.basename(g['url'])))
        for rel, inc in g['include'].items():
            get(inc['url'], os.path.join(base, rel))
        print('model', m, file=sys.stderr)


main()
