/**
 * The numbers the buildings of an OSM world are placed by (buildings.ts and
 * its parts: models, ground, indexes): fit and scale of the models, doors,
 * rows and parts, slope and retaining walls, the raised buildings' cover.
 */
import type { BuildingKind } from '../building-tags';

/**
 * Share of SCENE_BUDGET the buildings may spend. Off for now (user,
 * 2026-10-15): every footprint stands, the report still gives the cost;
 * 0.6 held Stuttgart to about 2 450 of 7 900 footprints. Set a share (or
 * pass `budget`) to bring the cap back.
 */
export const BUILDING_BUDGET_SHARE = Infinity;
/** A footprint filling less of its turned rectangle than this is cut into rectangles */
export const FILL_SPLIT = 0.8;
/** One scale for all axes, within these */
export const SCALE_MIN = 0.8;
export const SCALE_MAX = 1.25;
/** Footprints smaller than this (m²) are left out */
export const MIN_AREA = 6;
/** A worse fit than this (sum of the logs of both coverages and the penalties) takes the next kind */
export const MAX_FIT_ERROR = 0.5;
/** What the block with a facade may miss of a footprint: it stands where nothing else fits */
export const BLOCK_FIT_ERROR = 1.2;
/** Kinds whose model keeps its front, the door, on the street whenever a model fits that way */
export const DOOR_ON_STREET: ReadonlySet<BuildingKind> = new Set(['house', 'semi', 'terrace']);

/**
 * Entrances OSM maps on building outlines (`entrance`), by how much they say
 * where the door is: the main entrance first; service, exits and emergency
 * doors give no front
 */
export const ENTRANCE_RANKS: Readonly<Record<string, number>> = { main: 0, yes: 1, home: 1, staircase: 1 };
/** Metres an entrance may lie off its building's outline (the node is on it; a cut outline moved it) */
export const ENTRANCE_REACH = 1;
/** Metres a door of a raised building keeps from the corners of its wall, and how long that wall is at least */
export const DOOR_CORNER = 1.2;
export const DOOR_WALL = DOOR_CORNER * 2 + 0.2;
/** Kinds with no door to walk in by (a carport, a car park, a transformer): no door drawn, no footpath, unless OSM maps one */
export const NO_DOOR: ReadonlySet<BuildingKind> = new Set(['garage', 'carport', 'canopy', 'parking', 'transformer', 'gate', 'monument']);

/** What a model with its door on a side (doorSide) costs laid with that side off the street, against its turn to it */
export const SIDE_DOOR = 0.05;

/** What a front turned away from the street costs a fit */
export const ACROSS_PENALTY = 0.15;
/** Most storeys a model may have for a footprint without `building:levels` or `height` */
export const UNTAGGED_FLOORS = 5;
/** Copies of one model a rectangle may be laid with */
export const MAX_COPIES = 24;
/** A part of a cut footprint smaller than this (m², and share of the footprint) is left to its neighbour */
export const MIN_PART_AREA = 18;
export const MIN_PART_SHARE = 0.12;
/** Rectangles a footprint is cut into at most */
export const MAX_PARTS = 8;
/** A side street this near (m) to the end of a row of city-block modules makes the end a corner house */
export const CORNER_REACH = 10;
/** Roads farther than this (m) from every side leave the front to the longer side */
export const FRONT_REACH = 60;
/** Models keep this far (m) from the HQ's middle */
export const HQ_CLEAR = 14;
/** Metres beside a road's edge the cuts leave alone */
export const ROAD_GUARD = 0.5;
/** Metres outside the front wall the ground before the entrance is read (the floor's height) */
export const ENTRANCE_OUT = 1.5;
/** A building's floor stands at most this far (m) over its seat: the deepest drop to its cellar's foot */
export const MAX_BASEMENT = 6;
/** A drop smaller than this (m) lifts no building: the foundation covers it */
export const BASEMENT_FROM = 0.15;
/** Metres beside the walls the hill is cut level with the floor (a yard behind a house dug into the slope) */
export const YARD = 2;
/** Rise over run of the bank from the yard back up to the hill */
export const BANK_SLOPE = 0.9;
/** A bank higher than this (m) is held by a retaining wall at the yard's edge instead */
export const RETAINING_FROM = 2;
/** Metres of hill a retaining wall holds over the floor (its height less a coping's) */
export const RETAINING_HOLD = 2.6;
export const RETAINING_ASSET = 'retaining-wall';
/** Metres a retaining wall keeps from the HQ (the furniture's room round it) */
export const RETAINING_HQ_CLEAR = 25;
/** The retaining wall's length and depth at scale 1 (m) */
export const RETAINING_BOX: readonly [number, number] = [5.4, 1.2];
/** A side of a building faces up the hill when its normal lies this near the way up (cosine): only there retaining walls */
export const UPHILL = 0.5;
/** Metres past a wall's yard the cut's bank reaches at most */
export const BANK_REACH = 8;
/** The buildings within this (m) give a footprint the median size of its neighbourhood (buildingKind's `around`) */
export const AROUND_REACH = 100;
/** Footprints smaller than this (m²) are no house of the neighbourhood (sheds, garages) */
export const AROUND_FROM = 45;
/** What a model of a kind may lose to another (fit error) and still be drawn by the footprint's salt: houses vary */
export const VARIETY = 0.08;
/** What a module (blank sides) standing alone costs in a kind that does not stand in rows: a narrow house only */
export const LONE_MODULE = 0.1;
/**
 * Models stand for a footprint only where they fit it (docs/OSM_LANDMARKS_PLAN.md,
 * decision 1): covering at least MODEL_COVER of it and standing at most
 * MODEL_OVERHANG of its area outside it; else it is raised from its outline
 * (building-mass.ts), and the models stay only where that cannot stand
 */
export const MODEL_COVER = 0.85;
export const MODEL_OVERHANG = 0.1;
/** Footprints from this size (m²) count in the coverage report */
export const COVER_FROM = 40;
/** A footprint filling less of its turned rectangle than this has wings (buildingKind's `winged`) */
export const WINGED_FILL = 0.6;
/**
 * Tints of the small buildings, one per footprint by its id (white walls to
 * cream and sand, the red and anthracite roofs to brown and grey). Instance
 * colours: no draw call more
 */
export const BUILDING_TINTS: readonly (string | null)[] = [null, null, null, '#f6eee2', '#efe5d6', '#f3e3cb', '#e4ddd5', '#e9d6c2', '#dcd2c6'];
export const TINTED_KINDS: ReadonlySet<BuildingKind> = new Set(['house', 'semi', 'terrace', 'garage', 'shed', 'farm']);
