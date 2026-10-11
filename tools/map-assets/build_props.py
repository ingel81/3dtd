"""Props and effect markers of the map asset catalogue (loaded by build_models.py)."""
import math
import random

from mathutils import Matrix, Vector

from blender_kit import (
    Part, box, box_uv, card, card_material, clear_scene, export, flat_material, image_material, import_model,
    oriented_box, pbr_material, tube,
)
import blender_kit


def crate(name):
    clear_scene()
    planks = Part(pbr_material('planks-crate', 'brown_planks_04'), uv_metres=1.0)
    frame = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    box(planks, 0, 0, 0, 0.9, 0.9, 0.9)
    e = 0.08
    for x in (-0.45, 0.45):
        for y in (-0.45, 0.45):
            box(frame, x, y, 0, e, e, 0.9)
    for z in (0.0, 0.9 - e):
        for y in (-0.45, 0.45):
            box(frame, 0, y, z, 0.98, e, e)
        for x in (-0.45, 0.45):
            box(frame, x, 0, z, e, 0.98, e)
    export(name, [planks.to_object(name), frame.to_object(name + '-frame')])


def lamp_post(name):
    clear_scene()
    wood = Part(pbr_material('planks-dark', 'dark_planks'), uv_metres=1.0)
    iron = Part(flat_material('iron', (0.08, 0.08, 0.08), 0.5, 0.8))
    glass = Part(flat_material('lamp-glass', (1.0, 0.8, 0.5), 0.3, 0.0, emission=(1.0, 0.7, 0.35)))
    box(wood, 0, 0, 0, 0.22, 0.22, 3.6)
    oriented_box(wood, Vector((0, 0, 3.3)), Vector((0, -0.9, 3.5)), 0.12)
    box(iron, 0, -0.85, 3.05, 0.34, 0.34, 0.06)
    box(iron, 0, -0.85, 3.45, 0.4, 0.4, 0.06)
    box(glass, 0, -0.85, 3.11, 0.28, 0.28, 0.34)
    export(name, [wood.to_object(name), iron.to_object(name + '-iron'), glass.to_object(name + '-glass')])


def models():
    return {}
