import type { MapPathEdge } from '../../map-document';

/**
 * How a paved road looks by what it is: its street type (OSM `highway`, an
 * OSM world's; none on hand-made maps) and its surface. Asphalt roads carry
 * the markings of their class as on German roads: lane lines on motorways,
 * edge lines and a dashed centre line on main roads, a dashed centre line
 * on district roads, none in residential streets, whose asphalt runs into a
 * gutter of setts along the kerb. Wear grows down the classes: a motorway's
 * asphalt is dark and even, a service road's patched and pale.
 */

/** Ground materials laid as a road surface (road-network.ts); the others (gravel, dirt, planks) stay painted into the ground */
export const PAVED_SURFACES: ReadonlySet<string> = new Set([
  'asphalt', 'asphalt-cracked', 'concrete', 'concrete-damaged', 'pavers', 'sidewalk', 'brick-paving', 'herringbone',
  'cobblestone', 'cobblestone-grey', 'cobblestone-mossy', 'paving', 'crazy-paving', 'sandstone-paving', 'red-paving',
  'stone-path', 'stone-path-grey',
]);

/** Surfaces that take markings and wear like a road's asphalt */
const SEALED: ReadonlySet<string> = new Set(['asphalt', 'asphalt-cracked', 'concrete', 'concrete-damaged']);

export type RoadMarkings = 'none' | 'centre' | 'centre-edges' | 'lanes';

export interface RoadStyle {
  surface: string;
  markings: RoadMarkings;
  /** Lanes the lane lines divide a motorway into */
  lanes: number;
  /** Rows of setts along both edges (a town street's gutter) */
  gutter: boolean;
  /** 0 new and even, 1 patched, cracked and pale */
  wear: number;
  /** A junction's surface: the roads' markings stop at its mouths */
  junction: boolean;
}

/** The look of a paved edge (one with a surface of PAVED_SURFACES) */
export function roadStyle(edge: Pick<MapPathEdge, 'surface' | 'street' | 'width' | 'kind'>, junction = false): RoadStyle {
  const surface = edge.surface ?? 'asphalt';
  const sealed = SEALED.has(surface);
  const street = (edge.street ?? '').replace(/_link$/, '');
  const style: RoadStyle = { surface, markings: 'none', lanes: 0, gutter: false, wear: 0.45, junction };
  switch (street) {
    case 'motorway':
    case 'trunk':
      style.markings = 'lanes';
      style.lanes = Math.max(2, Math.round(edge.width / 3.6));
      style.wear = 0.15;
      break;
    case 'primary':
    case 'secondary':
      style.markings = 'centre-edges';
      style.wear = 0.3;
      break;
    case 'tertiary':
      style.markings = 'centre';
      style.wear = 0.38;
      break;
    case 'unclassified':
      style.wear = 0.55;
      break;
    case 'residential':
    case 'living_street':
      style.gutter = sealed && edge.width >= 5;
      style.wear = 0.5;
      break;
    case 'service':
      style.wear = 0.75;
      break;
    default:
      style.wear = edge.kind === 'path' ? 0.4 : 0.45;
  }
  if (!sealed || junction) style.markings = 'none';
  // Narrow roads have no room for a centre line
  if (edge.width < 5.5 && style.markings !== 'lanes') style.markings = 'none';
  return style;
}

/** One key per look: the styles a map's roads use, each once */
export function styleKey(s: RoadStyle): string {
  return `${s.surface}|${s.markings}|${s.lanes}|${s.gutter ? 1 : 0}|${s.wear}|${s.junction ? 1 : 0}`;
}

/** Surfaces one map's road textures can hold (4 bits of the code) */
export const MAX_ROAD_SURFACES = 15;

/**
 * A look packed into one exact float for the vertices (road-surface.ts
 * decodes it): the surface's layer in the road textures (4 bits, 15 none),
 * markings (2), lanes (3), gutter, sealed asphalt, junction (1 each), wear
 * in 32 steps (5): 18 bits, no table and no limit on looks
 */
export function encodeRoadStyle(s: RoadStyle, layer: number): number {
  const marks = { none: 0, centre: 1, 'centre-edges': 2, lanes: 3 }[s.markings];
  const sealed = SEALED.has(s.surface) ? 1 : 0;
  const wear = Math.round(Math.max(0, Math.min(1, s.wear)) * 31);
  const l = layer >= 0 && layer < MAX_ROAD_SURFACES ? layer : MAX_ROAD_SURFACES;
  return l + 16 * (marks + 4 * (Math.min(7, s.lanes) + 8 * ((s.gutter ? 1 : 0) + 2 * (sealed + 2 * ((s.junction ? 1 : 0) + 2 * wear)))));
}
