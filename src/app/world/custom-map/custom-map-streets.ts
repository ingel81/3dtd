import type { Street, StreetNetwork, StreetNode } from '../../interfaces/street-network-provider.interface';
import type { BuildingData, BuildingFootprint } from '../../services/location/osm-street.service';
import { StreetRouter } from '../../services/location/street-router';
import type { WorldStreetSource } from '../world-provider';
import { MAP_METERS_PER_DEGREE, type CustomMapDocument, type MapPathKind } from './map-document';
import { readFootprints, type MapFootprint } from './map-footprints';

/**
 * What the street network reads of a map: its paths and its size (an OSM world's frame has no more before the
 * making), and the footprints an OSM world kept
 */
export type StreetMap = Pick<CustomMapDocument, 'paths' | 'footprints'> & { terrain: Pick<CustomMapDocument['terrain'], 'width' | 'depth'> };

/** Storeys a footprint is drawn with where OSM gives none (the tiles' default, OsmStreetService) */
const DEFAULT_LEVELS = 2;

/**
 * Street type per path kind: roads route first, paths and bridges as a road
 * does (types of StreetRouter's weights). An edge of a real way (an OSM
 * world's) carries its own type
 */
const STREET_TYPE: Record<MapPathKind, string> = {
  road: 'primary',
  bridge: 'primary',
  path: 'residential',
};

/**
 * The map's paths as the game's street network: every edge one street from
 * node a over its curve points to node b, nodes shared where edges meet, the
 * edge's width as the street's width, bridges tagged `bridge`. Routes, the
 * nearest street point and the spawn preview run on it like on any network
 * (StreetRouter's A*). The whole network is the map's; nothing is fetched.
 */
export class CustomMapStreets extends StreetRouter implements WorldStreetSource {
  readonly network: StreetNetwork;
  /** An OSM world keeps the footprints its import read (TODO E290); other maps have none */
  readonly footprints: 'kept' | 'none';
  /** The kept footprints read back, on the first load of them */
  private footprintList: MapFootprint[] | null = null;

  constructor(private readonly doc: StreetMap) {
    super();
    this.network = mapStreetNetwork(doc);
    this.footprints = doc.footprints?.rings.length ? 'kept' : 'none';
  }

  prefetchStreets(): void {
    // the streets come with the map
  }

  loadStreets(): Promise<StreetNetwork> {
    return Promise.resolve(this.network);
  }

  cancelLoads(): void {
    // nothing loads
  }

  /** The map draws its own roads; the overlay keeps all of them */
  override filterStreetsNearRoutes(network: StreetNetwork): StreetNetwork {
    return network;
  }

  /**
   * All the footprints an OSM world kept, not only those near the routes:
   * on a map of its own making the layer is a developer tool for the whole
   * map (TODO E290). In the frame of its streets, with their kind,
   * courtyards and why the import left one out; none on other maps (their
   * buildings are objects of the map). Nothing is fetched
   */
  loadBuildingsNearRoutes(): Promise<BuildingData> {
    const kept = this.doc.footprints;
    if (!kept) return Promise.resolve({ buildings: [] });
    this.footprintList ??= readFootprints(kept);
    const M = MAP_METERS_PER_DEGREE;
    let id = 1;
    const nodes = (ring: readonly { x: number; y: number }[]) => ring.map((p) => ({ id: id++, lat: p.y / M, lon: p.x / M }));
    const buildings = this.footprintList.map((fp): BuildingFootprint => ({
      id: id++,
      type: 'yes',
      // A part high up stands at least a storey over its foot
      levels: Math.max(fp.levels || DEFAULT_LEVELS, fp.minLevel + 1),
      nodes: nodes(fp.points),
      kind: fp.kind,
      holes: fp.holes.map(nodes),
      minLevel: fp.minLevel,
      dropped: fp.dropped,
    }));
    return Promise.resolve({ buildings });
  }

  /** A map's spawns have names of their own; its roads have none */
  spawnLabel(_network: StreetNetwork, _lat: number, _lon: number, name: string): string {
    return name;
  }
}

/** The street network of a map's paths, lat/lon in the synthetic frame (mapToGeo) */
export function mapStreetNetwork(doc: StreetMap): StreetNetwork {
  const M = MAP_METERS_PER_DEGREE;
  const nodes = new Map<number, StreetNode>();
  const byId = new Map<string, StreetNode>();
  let nextId = 1;
  const node = (x: number, y: number): StreetNode => {
    const n = { id: nextId++, lat: y / M, lon: x / M };
    nodes.set(n.id, n);
    return n;
  };
  for (const p of doc.paths.nodes) byId.set(p.id, node(p.x, p.y));

  const streets: Street[] = [];
  for (const e of doc.paths.edges) {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b || a === b) continue;
    const street: Street = {
      id: streets.length + 1,
      name: e.kind === 'bridge' ? 'Bridge' : e.kind === 'path' ? 'Path' : 'Road',
      type: e.street ?? STREET_TYPE[e.kind],
      nodes: [a, ...(e.via ?? []).map((v) => node(v.x, v.y)), b],
      width: e.width,
    };
    if (e.kind === 'bridge') street.bridge = 'yes';
    if (e.tunnel) street.tunnel = 'yes';
    streets.push(street);
  }

  const t = doc.terrain;
  return {
    streets,
    nodes,
    bounds: {
      minLat: -t.depth / 2 / M,
      maxLat: t.depth / 2 / M,
      minLon: -t.width / 2 / M,
      maxLon: t.width / 2 / M,
    },
  };
}
