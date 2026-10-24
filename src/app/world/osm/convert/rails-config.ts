/**
 * The numbers and assets the railways of an OSM world are laid by
 * (rails.ts, rails-ground.ts, rails-pieces.ts): track kinds and their
 * models, bed, rails and crossings, clearances and bridge decks,
 * abutments and piers, signals, masts, ramps and the levelling field.
 */


/** Railway kinds that get a track (no disused, abandoned or platform lines) */
export const TRACK_KINDS: ReadonlySet<string> = new Set(['rail', 'light_rail', 'tram', 'narrow_gauge', 'subway', 'funicular']);
/** Railway kinds whose level crossings with a road have a St Andrew's cross unless tagged otherwise (trams cross by traffic lights) */
export const SALTIRE_KINDS: ReadonlySet<string> = new Set(['rail', 'narrow_gauge']);
/** Railway kinds whose overhead line (`electrified=contact_line`) gets masts beside the track (trams hang theirs on span wires) */
export const MASTED_KINDS: ReadonlySet<string> = new Set(['rail', 'light_rail', 'narrow_gauge']);

/** The catalogue's railway models; the 10 m and 2.5 m pieces run along model X, the others face model -Y (glTF +Z) */
export const RAIL_ASSETS = {
  track: 'rail-track',
  trackShort: 'rail-track-short',
  trackWood: 'rail-track-wood',
  trackWoodShort: 'rail-track-wood-short',
  bridge: 'rail-bridge',
  bridgeShort: 'rail-bridge-short',
  crossing: 'rail-crossing',
  street: 'rail-street',
  saltire: 'crossing-saltire',
  signal: 'crossing-signal',
  barrier: 'crossing-barrier',
  abutment: 'bridge-abutment',
  pier: 'bridge-pier',
  mast: 'catenary-mast',
} as const;

/** Every asset the railway may place, for the catalogue's costs */
export const RAIL_ASSET_IDS: readonly string[] = Object.values(RAIL_ASSETS);

/** Metres of the lattice the stretches snap to: the short pieces' length */
export const LATTICE = 2.5;
/** Metres of a long piece */
export const LONG = 10;
/** Half width of the levelled bed (the ballast's foot is 4.8 m wide), metres */
export const BED_HALF = 2.6;
/** Metres between the samples of a profile */
export const PROFILE_STEP = 2;
/** Metres along the track the profile averages over, and on a way tagged `embankment` or `cutting` */
export const SMOOTHING = 30;
export const SMOOTHING_BUILT = 60;
/** Metres over which the track comes to a level crossing's height */
export const CROSSING_RAMP = 25;
/** Metres from the formation (a track piece's origin) to its rail heads, and from the road to a crossing panel's top (tools/map-assets/build_modern.py) */
export const RAIL_HEAD = 0.62;
export const PANEL_TOP = 0.08;
/**
 * Metres the formation lies under the road at a level crossing: the rail
 * heads flush with the panels, these a little over the road, the ballast
 * and sleepers under it, so bed and crossing pieces meet rail to rail
 */
export const CROSSING_SINK = RAIL_HEAD - PANEL_TOP;
/** Metres from the road to the top of street track (its asphalt, flush with the rail heads), and the formation under the road there */
export const STREET_TOP = 0.05;
export const STREET_SINK = RAIL_HEAD - STREET_TOP;
/** Grade of the ramp up to a raised bridge or down into a cutting, and its shortest and longest run, metres */
export const RAMP_GRADE = 0.025;
export const RAMP_MIN = 20;
export const RAMP_MAX = 200;
/** Metres past a road's edge within which a track's middle runs in the road (street running: embedded rails) */
export const STREET_RUNNING = 0.4;
/** Metres the crossing panels reach past the road's edge, along the track */
export const CROSSING_MARGIN = 0.75;
/** Least sine of the angle between track and road the spans are measured with (a crossing at 20 degrees) */
export const MIN_SIN = 0.35;
/** Metres a track's own bridge over an underpass reaches past the road's edge */
export const UNDERPASS_MARGIN = 3.5;
/** Headroom under a rail bridge, metres: over a road, a path, the water */
export const UNDER_CLEARANCE = { road: 4.7, path: 2.7, water: 1.5 } as const;
/** Headroom over the track under a road bridge, metres, and with an overhead line */
export const OVER_CLEARANCE = { plain: 4.9, electrified: 5.7 } as const;
/** Metres from a rail bridge's formation (the bed's level) to its underside, and from a road deck's top to its underside */
export const RAIL_DECK_DEPTH = 1.3;
export const ROAD_DECK_DEPTH = 1.25;
/** The abutment and pier models: width (model X) and height at scale 1, origin at the foot; a pier's thickness */
export const ABUTMENT = { width: 6.4, height: 10 };
export const PIER = { width: 6, height: 12, thick: 1.6 };
/**
 * Metres an abutment's face stands inside its bridge's end: the ground the
 * bed is levelled to falls to the ground under the span within a cell or
 * so (2 m), behind the face
 */
export const ABUTMENT_SET = 2.5;
/** Metres the ground must lie under a road bridge's deck before its abutment stands there */
export const ABUTMENT_HEADROOM = 1;
/** Spans longer than this get piers, about PIER_SPACING apart, metres */
export const PIER_SPAN = 30;
export const PIER_SPACING = 25;
/** Metres a pier keeps from a track's middle and beyond a road's edge */
export const PIER_TRACK_CLEAR = 3.2;
export const PIER_ROAD_CLEAR = 1;
/** Where a crossing's signals stand: metres from the track's middle (across it), past the road's edge; the barrier stands farther from the track */
export const SIGNAL_FROM_TRACK = 3.6;
export const SIGNAL_OUT = 0.9;
export const BARRIER_BACK = 1.4;
export const BARRIER_OUT = 0.6;
/** Overhead line masts: metres between, from the track's middle (the arm reaches back over it), from another track's middle */
export const MAST_SPACING = 50;
export const MAST_OFFSET = 3.2;
export const MAST_CLEAR = 2.5;
/** Metres from another line's middle within which a line's end lies on it (a branch at a switch), and over which it comes to that line's height */
export const BRANCH_REACH = 1;
export const BRANCH_RAMP = 20;
/** Metres across which the lines of a track field come to one level, and the passes they take to it (agreeField) */
export const FIELD_REACH = 7;
export const FIELD_PASSES = 8;
/** Cosine of the sharpest bend a line takes through a switch (30 degrees off straight); the other ways branch off it */
export const THROUGH_COS = Math.cos((30 * Math.PI) / 180);
/** Width a rail tunnel's mouth counts with (the portal's opening is a road's) */
export const TUNNEL_WIDTH = 5;
/** Metres the lines stay inside the map's edge for their tunnels' portals */
export const EDGE_INSET = 1;
