"""Recipes of the baked ground materials (bake_grounds.py, E214): one entry
per material id, the patch's size in metres (the material's `scale` in
materials.json), its ground and what lies on it.

Colours are written as sRGB 0..255 (as a painter picks them) and turned
into linear albedo here. Counts are per square metre.
"""


def c(r, g, b):
    """sRGB 0..255 to linear 0..1"""
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b))


# ---- shared pieces

SOIL_DARK = (c(58, 44, 32), c(96, 76, 54))
SOIL_MID = (c(84, 64, 44), c(128, 102, 72))
SAND_PALE = (c(196, 176, 140), c(222, 206, 172))
SAND_RED = (c(178, 104, 62), c(206, 132, 84))
SNOW = (c(222, 228, 236), c(246, 248, 252))

GREEN_BLADES = [(c(80, 120, 36), 3), (c(98, 138, 42), 3), (c(64, 106, 38), 2), (c(118, 146, 50), 1.5), (c(136, 142, 66), 0.5)]
LUSH_BLADES = [(c(52, 92, 34), 3), (c(66, 108, 38), 3), (c(46, 82, 40), 2), (c(84, 116, 44), 1)]
DRY_BLADES = [(c(168, 150, 92), 3), (c(150, 128, 76), 2), (c(186, 170, 112), 1.5), (c(128, 120, 70), 1)]
WITHERED_BLADES = [(c(140, 124, 64), 3), (c(118, 104, 52), 2), (c(104, 106, 54), 2), (c(160, 132, 76), 1.5), (c(96, 112, 48), 1)]
THATCH = [(c(78, 102, 40), 2), (c(98, 106, 52), 1.2), (c(66, 96, 38), 2)]
AUTUMN_LEAVES = [(c(176, 70, 26), 2), (c(204, 120, 30), 2.5), (c(220, 168, 46), 1.5), (c(140, 60, 30), 1.5), (c(120, 84, 44), 2)]
BROWN_LEAVES = [(c(110, 76, 44), 3), (c(92, 62, 38), 2), (c(134, 98, 56), 2), (c(76, 54, 34), 1)]
NEEDLES = [(c(120, 82, 46), 3), (c(98, 70, 42), 2), (c(140, 104, 62), 1)]
TWIG_BROWN = [(c(86, 64, 44), 3), (c(64, 50, 38), 2), (c(110, 90, 66), 1)]
MOSS = [(c(70, 98, 36), 3), (c(92, 112, 40), 2), (c(56, 82, 34), 2), (c(110, 118, 52), 1)]
STONE_GREY = [(c(120, 116, 108), 3), (c(96, 92, 86), 2), (c(146, 140, 128), 1.5), (c(108, 98, 86), 1)]
STONE_WARM = [(c(132, 118, 100), 3), (c(108, 96, 82), 2), (c(156, 142, 120), 1.5), (c(118, 100, 80), 1)]
CLODS = [(c(104, 82, 60), 3), (c(132, 108, 80), 2), (c(80, 62, 46), 2), (c(150, 128, 98), 1)]
STONE_RED = [(c(150, 92, 62), 3), (c(124, 74, 50), 2), (c(176, 120, 82), 1.5), (c(104, 68, 50), 1)]


def _common(layer, clumps, patchy):
    if clumps:
        layer['clumps'] = clumps
    if patchy is not None:
        layer['patchy'] = patchy
    return layer


def blades(count, colours, length=(0.08, 0.16), width=(0.006, 0.011), tilt=(0.3, 1.1), clumps=(18, 0.07), tip=None, rough=0.82,
           patchy=None):
    layer = {'kind': 'blades', 'count': count, 'colours': colours, 'length': length, 'width': width, 'tilt': tilt, 'rough': rough}
    if tip:
        layer['tip'] = tip
    return _common(layer, clumps, patchy)


def leaves(count, colours, size=(0.025, 0.045), stretch=1.7, pile=0.012, cup=0.2, notch=0.0, clumps=None, patchy=None, rough=0.8):
    layer = {'kind': 'leaves', 'count': count, 'colours': colours, 'size': size, 'stretch': stretch, 'pile': pile, 'cup': cup,
             'notch': notch, 'rough': rough}
    return _common(layer, clumps, patchy)


def stones(count, colours, size=(0.02, 0.05), flat=(0.4, 0.7), embed=0.4, clumps=None, patchy=None, rough=0.75):
    layer = {'kind': 'stones', 'count': count, 'colours': colours, 'size': size, 'flat': flat, 'embed': embed, 'rough': rough}
    return _common(layer, clumps, patchy)


def twigs(count, colours, length=(0.08, 0.25), radius=(0.003, 0.007), branches=2, rough=0.85):
    return {'kind': 'twigs', 'count': count, 'colours': colours, 'length': length, 'radius': radius, 'branches': branches, 'rough': rough}


def flowers(count, colours, size=(0.008, 0.013), height=(0.06, 0.14), patchy=None, centre=None):
    layer = {'kind': 'flowers', 'count': count, 'colours': colours, 'size': size, 'height': height}
    if centre:
        layer['centre'] = centre
    return _common(layer, None, patchy)


def clover(count, colours=None, patchy=0.55):
    return {'kind': 'clover', 'count': count, 'colours': colours or [(c(70, 118, 42), 3), (c(86, 128, 48), 1)], 'size': (0.008, 0.012),
            'height': (0.02, 0.05), 'patchy': patchy, 'clumps': (10, 0.06), 'rough': 0.7}


RECIPES = {
    # ---- grass
    # Temperate grass: clumps of fresh blades in several greens over a thatch of old ones, a few dry ones, clover in
    # patches, daisies here and there
    'grass': {
        'size': 3, 'seed': 11, 'ao': 0.1,
        'base': {'colours': SOIL_DARK, 'relief': 0.02, 'rough': 0.95},
        'layers': [
            blades(1400, THATCH, length=(0.05, 0.09), width=(0.005, 0.008), tilt=(1.25, 1.5), clumps=None),
            blades(3200, GREEN_BLADES, length=(0.06, 0.12), width=(0.008, 0.013), clumps=(24, 0.06), tip=c(140, 166, 70)),
            blades(220, DRY_BLADES, length=(0.06, 0.11), clumps=(6, 0.05)),
            clover(70),
            flowers(3, [(c(236, 234, 226), 4), (c(232, 206, 70), 1)], patchy=0.5),
        ],
    },
    # Lush grass: deeper and bluer greens, longer and denser, clover everywhere, nothing dry
    'grass-lush': {
        'size': 3, 'seed': 12, 'ao': 0.12,
        'base': {'colours': SOIL_DARK, 'relief': 0.02, 'rough': 0.95, 'damp': 0.3},
        'layers': [
            blades(1600, [(c(58, 90, 36), 2), (c(70, 98, 40), 1)], length=(0.06, 0.1), width=(0.005, 0.008), tilt=(1.25, 1.5), clumps=None),
            blades(3800, LUSH_BLADES, length=(0.08, 0.15), width=(0.008, 0.014), clumps=(28, 0.07), tip=c(104, 146, 60)),
            clover(160, patchy=0.4),
        ],
    },
    # Meadow: long grass gone to seed, flowers in drifts (white, yellow, purple), tan seed heads
    'meadow': {
        'size': 4, 'seed': 13, 'ao': 0.14,
        'base': {'colours': SOIL_DARK, 'relief': 0.025, 'rough': 0.95},
        'layers': [
            blades(1300, THATCH, length=(0.06, 0.1), width=(0.005, 0.008), tilt=(1.2, 1.5), clumps=None),
            blades(2800, GREEN_BLADES, length=(0.1, 0.2), width=(0.007, 0.012), clumps=(26, 0.08), tip=c(150, 160, 80)),
            blades(500, DRY_BLADES, length=(0.12, 0.22), width=(0.004, 0.007), clumps=(8, 0.06), tip=c(200, 184, 130)),
            flowers(40, [(c(238, 236, 228), 3)], patchy=0.5),
            flowers(25, [(c(236, 204, 60), 3)], patchy=0.55),
            flowers(18, [(c(150, 110, 190), 3), (c(120, 90, 170), 1)], patchy=0.6, centre=(0.9, 0.85, 0.7)),
        ],
    },
    # Dry grass: straw-coloured tufts on pale earth, a little green at their hearts
    'grass-dry': {
        'size': 4, 'seed': 14, 'ao': 0.1,
        'base': {'colours': (c(96, 80, 58), c(140, 118, 86)), 'relief': 0.02, 'rough': 0.95},
        'layers': [
            blades(1200, DRY_BLADES, length=(0.05, 0.1), width=(0.004, 0.007), tilt=(1.2, 1.5), clumps=None),
            blades(2400, DRY_BLADES, length=(0.08, 0.16), width=(0.006, 0.01), clumps=(26, 0.06), tip=c(214, 198, 148)),
            blades(600, [(c(112, 120, 56), 2), (c(128, 128, 64), 1), (c(96, 110, 52), 1)], length=(0.05, 0.1), clumps=(10, 0.04)),
            stones(25, STONE_WARM, size=(0.01, 0.025)),
        ],
    },
    # Withered grass: olive, ochre and brown tufts, fallen leaves caught in them
    'grass-withered': {
        'size': 4, 'seed': 15, 'ao': 0.12,
        'base': {'colours': SOIL_MID, 'relief': 0.022, 'rough': 0.95},
        'layers': [
            blades(1500, [(c(110, 98, 54), 2), (c(92, 86, 46), 2), (c(124, 104, 64), 1)], length=(0.05, 0.1), width=(0.005, 0.008),
                   tilt=(1.25, 1.5), clumps=None),
            blades(2600, WITHERED_BLADES, length=(0.08, 0.15), width=(0.007, 0.012), clumps=(22, 0.07), tip=c(176, 150, 92)),
            leaves(25, AUTUMN_LEAVES, patchy=0.5),
        ],
    },

    # ---- soil
    # Dirt: dry, trodden earth, lumps and small stones, a dead twig, a few blades at the edges of patches
    'dirt': {
        'size': 4, 'seed': 21, 'ao': 0.06,
        'base': {'colours': SOIL_MID, 'relief': 0.03, 'grain': 0.008, 'rough': 0.92},
        'layers': [
            stones(900, CLODS, size=(0.003, 0.009), flat=(0.5, 0.8), embed=0.5),
            stones(160, CLODS, size=(0.008, 0.02), flat=(0.5, 0.8), embed=0.5),
            stones(40, STONE_WARM, size=(0.012, 0.035)),
            twigs(4, TWIG_BROWN),
            blades(200, WITHERED_BLADES, length=(0.04, 0.08), clumps=(12, 0.05), patchy=0.6),
        ],
    },
    # Mud: dark, wet earth with standing water in the hollows (glossy), stones half sunk
    'mud': {
        'size': 4, 'seed': 22, 'ao': 0.06,
        'base': {'colours': (c(52, 40, 30), c(84, 66, 48)), 'relief': 0.03, 'grain': 0.006, 'rough': 0.7, 'damp': 0.9},
        'layers': [
            stones(700, [(c(66, 52, 40), 2), (c(84, 68, 52), 2), (c(52, 42, 34), 1)], size=(0.004, 0.012), flat=(0.4, 0.7), embed=0.5,
                   rough=0.55),
            stones(30, [(c(84, 74, 62), 2), (c(70, 60, 50), 2)], size=(0.01, 0.03), embed=0.6, rough=0.5),
            blades(60, WITHERED_BLADES, length=(0.05, 0.1), tilt=(1.3, 1.55), clumps=None, rough=0.5),
        ],
    },
    # Swamp floor: black peat, water in the hollows, moss cushions, rotting leaves and fallen reed
    'swamp-ground': {
        'size': 4, 'seed': 23, 'ao': 0.1,
        'base': {'colours': (c(34, 30, 22), c(64, 56, 38)), 'relief': 0.03, 'rough': 0.8, 'damp': 1.0},
        'layers': [
            stones(1800, MOSS, size=(0.005, 0.014), flat=(0.5, 0.8), embed=0.45, clumps=(40, 0.12), patchy=0.45, rough=0.95),
            blades(300, [(c(120, 112, 62), 2), (c(92, 96, 50), 2), (c(70, 82, 44), 1)], length=(0.15, 0.3), width=(0.006, 0.01),
                   tilt=(1.35, 1.55), clumps=None),
            leaves(80, BROWN_LEAVES, size=(0.02, 0.04), pile=0.004, rough=0.6),
        ],
    },
    # Red earth: laterite, iron-red, with small dark stones
    'red-earth': {
        'size': 4, 'seed': 24, 'ao': 0.06,
        'base': {'colours': (c(132, 62, 36), c(176, 92, 56)), 'relief': 0.025, 'grain': 0.008, 'rough': 0.93},
        'layers': [
            stones(140, [(c(90, 48, 34), 3), (c(60, 40, 32), 2), (c(150, 86, 58), 1)], size=(0.006, 0.02), flat=(0.5, 0.8)),
            stones(25, STONE_RED, size=(0.02, 0.05)),
        ],
    },
    # Cracked red ground: dried clay plates, their rims curled, dust in the cracks
    'desert-cracked-red': {
        'size': 4, 'seed': 25, 'ao': 0.05,
        'base': {'colours': (c(160, 90, 56), c(196, 124, 82)), 'relief': 0.01, 'grain': 0.004, 'rough': 0.95,
                 'cracks': {'per_m': 4, 'width': 0.07, 'depth': 0.03, 'curl': 0.03}, 'crack_colour': c(92, 52, 34)},
        'layers': [stones(8, STONE_RED, size=(0.015, 0.03))],
    },
    # Stony desert: hard red-brown ground strewn with sharp stones and gravel
    'desert-stony': {
        'size': 4, 'seed': 26, 'ao': 0.06,
        'base': {'colours': (c(146, 112, 78), c(184, 148, 108)), 'relief': 0.02, 'grain': 0.006, 'rough': 0.95},
        'layers': [
            stones(260, [(c(120, 92, 64), 2), (c(98, 78, 58), 2), (c(160, 128, 94), 1)], size=(0.006, 0.016), flat=(0.4, 0.7)),
            stones(70, STONE_RED + STONE_WARM[:2], size=(0.02, 0.07), flat=(0.35, 0.6), clumps=(5, 0.25)),
        ],
    },

    # ---- forest
    # Leaf litter: last season's leaves in drifts, brown and grey-brown, twigs and needles between
    'forest-floor': {
        'size': 3, 'seed': 31, 'ao': 0.1,
        'base': {'colours': SOIL_DARK, 'relief': 0.02, 'rough': 0.9},
        'layers': [
            leaves(700, BROWN_LEAVES + [(c(150, 120, 74), 1), (c(160, 138, 96), 1)], size=(0.03, 0.06), pile=0.02, notch=0.2),
            leaves(250, [(c(120, 112, 70), 1), (c(96, 104, 58), 1)], size=(0.02, 0.04), pile=0.01, notch=0.2, clumps=(10, 0.12)),
            blades(1200, NEEDLES, length=(0.03, 0.05), width=(0.002, 0.003), tilt=(1.4, 1.55), clumps=(20, 0.15)),
            twigs(14, TWIG_BROWN, length=(0.1, 0.35), radius=(0.004, 0.01)),
        ],
    },
    # Autumn leaves: a fresh fall, red, orange, gold and brown, piled
    'leaves-autumn': {
        'size': 3, 'seed': 32, 'ao': 0.1,
        'base': {'colours': SOIL_DARK, 'relief': 0.02, 'rough': 0.9},
        'layers': [
            leaves(700, BROWN_LEAVES, pile=0.01, notch=0.25),
            leaves(800, AUTUMN_LEAVES, size=(0.03, 0.05), pile=0.025, notch=0.3, clumps=(30, 0.25)),
            twigs(5, TWIG_BROWN),
        ],
    },
    # Scattered leaves: autumn grass with leaves blown into it
    'leaves-scattered': {
        'size': 4, 'seed': 33, 'ao': 0.1,
        'base': {'colours': SOIL_DARK, 'relief': 0.02, 'rough': 0.95},
        'layers': [
            blades(1300, THATCH, length=(0.05, 0.09), width=(0.005, 0.008), tilt=(1.25, 1.5), clumps=None),
            blades(2200, WITHERED_BLADES + GREEN_BLADES[:2], length=(0.06, 0.12), width=(0.007, 0.012), clumps=(22, 0.06)),
            leaves(220, AUTUMN_LEAVES + BROWN_LEAVES, size=(0.025, 0.045), pile=0.03, notch=0.3, clumps=(8, 0.2)),
        ],
    },
    # Brown leaves: decaying, dark and flattened, damp in places
    'leaves-brown': {
        'size': 3, 'seed': 34, 'ao': 0.1,
        'base': {'colours': (c(46, 36, 26), c(76, 60, 42)), 'relief': 0.02, 'rough': 0.85, 'damp': 0.4},
        'layers': [
            leaves(1500, [(c(92, 66, 40), 3), (c(70, 52, 34), 3), (c(112, 86, 54), 1), (c(60, 48, 34), 2)], pile=0.012, cup=0.08, notch=0.2),
            twigs(6, TWIG_BROWN),
        ],
    },
    # Moss: a deep green carpet of cushions
    'moss': {
        'size': 2, 'seed': 35, 'ao': 0.05,
        'base': {'colours': (c(46, 64, 28), c(76, 96, 38)), 'relief': 0.015, 'grain': 0.01, 'rough': 0.95},
        'layers': [
            stones(9000, MOSS, size=(0.004, 0.01), flat=(0.6, 0.9), embed=0.45, rough=0.95),
            blades(9000, MOSS + [(c(140, 140, 70), 0.5)], length=(0.006, 0.012), width=(0.002, 0.003), tilt=(0.2, 0.9), clumps=(30, 0.02),
                   tip=c(150, 160, 80)),
        ],
    },
    # Mossy forest floor: moss cushions with leaves and needles between
    'forest-moss': {
        'size': 3, 'seed': 36, 'ao': 0.08,
        'base': {'colours': SOIL_DARK, 'relief': 0.02, 'rough': 0.9},
        'layers': [
            stones(5000, MOSS, size=(0.004, 0.011), flat=(0.6, 0.9), embed=0.45, clumps=(60, 0.18), rough=0.95),
            leaves(250, BROWN_LEAVES, pile=0.01, notch=0.2),
            blades(300, NEEDLES, length=(0.03, 0.05), width=(0.002, 0.003), tilt=(1.4, 1.55), clumps=None),
        ],
    },
    # Roots: exposed roots across the forest floor, leaves and moss between
    'forest-roots': {
        'size': 3, 'seed': 37, 'ao': 0.12,
        'base': {'colours': SOIL_DARK, 'relief': 0.03, 'rough': 0.9},
        'layers': [
            leaves(500, BROWN_LEAVES, pile=0.01, notch=0.2),
            stones(1500, MOSS, size=(0.004, 0.011), flat=(0.6, 0.9), embed=0.45, clumps=(40, 0.15), patchy=0.5, rough=0.95),
            twigs(3, [(c(96, 76, 56), 2), (c(76, 60, 46), 2)], length=(0.6, 1.2), radius=(0.015, 0.03), branches=3),
            twigs(6, TWIG_BROWN),
        ],
    },

    # ---- sand and stone
    # Sand: fine pale sand in small wind ripples, a few pebbles and shells
    'sand': {
        'size': 4, 'seed': 41, 'ao': 0.05,
        'base': {'colours': SAND_PALE, 'relief': 0.01, 'grain': 0.003, 'rough': 0.9, 'relief_tone': 0.6, 'ripples': {'count': 30, 'amp': 0.006, 'angle': 0.5}},
        'layers': [
            stones(12, STONE_GREY, size=(0.008, 0.02)),
            leaves(6, [(c(236, 226, 206), 2), (c(214, 190, 160), 1)], size=(0.008, 0.014), stretch=1.2, cup=0.4),
        ],
    },
    # Red sand: desert sand in ripples, iron-red
    'sand-red': {
        'size': 5, 'seed': 42, 'ao': 0.05,
        'base': {'colours': SAND_RED, 'relief': 0.012, 'grain': 0.003, 'rough': 0.92, 'relief_tone': 0.6, 'ripples': {'count': 34, 'amp': 0.008, 'angle': 0.9}},
        'layers': [stones(8, STONE_RED, size=(0.01, 0.025))],
    },
    # Dunes: long ripples over large swells
    'sand-dunes': {
        'size': 12, 'seed': 43, 'ao': 0.3,
        'base': {'colours': (c(168, 142, 128), c(204, 182, 168)), 'relief': 0.12, 'grain': 0.004, 'rough': 0.92, 'relief_tone': 0.6,
                 'ripples': {'count': 60, 'amp': 0.018, 'angle': 0.7, 'warp': 1.2}},
    },
    # Dry riverbed: rounded pebbles over sand, larger cobbles in bars
    'riverbed-dry': {
        'size': 5, 'seed': 44, 'ao': 0.08,
        'base': {'colours': (c(170, 142, 112), c(200, 176, 144)), 'relief': 0.02, 'rough': 0.9},
        'layers': [
            stones(500, STONE_RED + STONE_WARM, size=(0.008, 0.025), flat=(0.5, 0.75), embed=0.3),
            stones(60, STONE_RED + STONE_WARM, size=(0.03, 0.08), flat=(0.45, 0.65), embed=0.35, clumps=(8, 0.3)),
        ],
    },
    # Rocky ground: stones of every size sunk in grassy soil
    'rocky-ground': {
        'size': 4, 'seed': 45, 'ao': 0.1,
        'base': {'colours': SOIL_MID, 'relief': 0.03, 'rough': 0.92},
        'layers': [
            stones(500, CLODS, size=(0.003, 0.009), flat=(0.5, 0.8), embed=0.5),
            stones(200, STONE_WARM + STONE_GREY, size=(0.008, 0.025), flat=(0.5, 0.8)),
            stones(45, STONE_WARM + STONE_GREY, size=(0.03, 0.09), flat=(0.4, 0.65), embed=0.45, clumps=(4, 0.3)),
            blades(900, GREEN_BLADES + WITHERED_BLADES[:2], length=(0.05, 0.1), clumps=(18, 0.06), patchy=0.45),
        ],
    },

    # ---- snow
    # Snow: soft, settled, gently uneven
    'snow': {
        'size': 5, 'seed': 51, 'ao': 0.15,
        'base': {'colours': SNOW, 'relief': 0.03, 'grain': 0.0008, 'rough': 0.7, 'speckle': 0.02, 'relief_tone': 0.4},
    },
    # Fresh snow: smooth and bright, small lumps where it fell from branches
    'snow-fresh': {
        'size': 6, 'seed': 52, 'ao': 0.12,
        'base': {'colours': SNOW, 'relief': 0.02, 'grain': 0.0005, 'rough': 0.6, 'speckle': 0.01, 'relief_tone': 0.3},
    },
    # Windswept snow: sastrugi, sharp ripples carved by the wind
    'snow-windswept': {
        'size': 10, 'seed': 53, 'ao': 0.3,
        'base': {'colours': SNOW, 'relief': 0.05, 'grain': 0.0008, 'rough': 0.65, 'relief_tone': 0.5, 'speckle': 0.02,
                 'sastrugi': {'along': 0.4, 'across': 1.1, 'amp': 0.06}},
    },
    # Rocky snow: snow with dark stones and gravel showing through
    'snow-rocky': {
        'size': 4, 'seed': 54, 'ao': 0.12,
        'base': {'colours': SNOW, 'relief': 0.03, 'rough': 0.7, 'speckle': 0.03},
        'layers': [
            stones(60, [(c(80, 78, 76), 2), (c(104, 100, 96), 2), (c(62, 60, 58), 1)], size=(0.02, 0.07), flat=(0.4, 0.6), embed=0.55,
                   clumps=(5, 0.3)),
            stones(150, [(c(96, 92, 88), 1)], size=(0.005, 0.012), embed=0.5),
        ],
    },
    # Frozen ground: dark earth under hoar frost, frozen pale blades
    'frozen-ground': {
        'size': 4, 'seed': 55, 'ao': 0.08,
        'base': {'colours': (c(70, 64, 58), c(108, 100, 92)), 'relief': 0.02, 'rough': 0.8},
        'layers': [
            blades(800, [(c(150, 150, 136), 2), (c(124, 122, 104), 2)], length=(0.04, 0.08), width=(0.004, 0.007), tilt=(1.1, 1.5),
                   clumps=(14, 0.05)),
            leaves(2500, [(c(226, 232, 240), 3), (c(200, 210, 222), 1)], size=(0.003, 0.007), stretch=1.0, pile=0.002, cup=0.0, rough=0.4),
            stones(40, STONE_GREY, size=(0.01, 0.03)),
        ],
    },
}
