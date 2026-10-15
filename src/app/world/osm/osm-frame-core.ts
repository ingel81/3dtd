/**
 * The work behind the frame of an OSM world (components/osm-frame): load a
 * place's data (frame store or download), draw the spawns on its streets and
 * drop dragged ones there, then make and pack the map with the spawns the
 * player chose. One instance per frame holds the place's data between the
 * calls, so the making fetches nothing. Runs in the OSM worker
 * (osm.worker.ts), or on the calling thread where workers are missing.
 */
import { newMapUid } from '../custom-map/map-create';
import { packMapFile } from '../custom-map/map-file';
import type { MapPoint } from '../custom-map/map-document';
import type { DemDecoder } from './dem-tiles';
import type { OsmFrameStore } from './osm-frame-store';
import {
  convertOsm,
  loadOsmInput,
  osmStreets,
  OSM_WORLD_SIDE,
  type OsmConvertStep,
  type OsmDownloadStats,
  type OsmImportInput,
  type OsmImportOptions,
  type OsmImportResult,
  type OsmLoadStep,
  type OsmStreets,
} from './import-osm';
import type { LaidSpawn } from './convert/layout';

/** A point on the earth */
export interface GeoPoint {
  lat: number;
  lon: number;
}

/** One step of loading or making, for the progress list */
export type OsmStep = OsmLoadStep | OsmConvertStep | 'pack';

/** A spawn as the frame draws it, in real coordinates */
export interface FrameSpawn extends GeoPoint {
  name: string;
  /** Straight from the HQ, metres */
  distanceM: number;
  routeM: number;
  /** Its route to the HQ as [lon, lat] pairs */
  route: [number, number][];
}

/** What the frame shows of a loaded place */
export interface OsmFrameInfo {
  /** The HQ on the road nearest the place; null for a place without streets */
  hq: GeoPoint | null;
  hqShiftM: number;
  spawns: FrameSpawn[];
  /** ISO time the OSM data was fetched */
  fetchedAt: string;
  download: OsmDownloadStats;
  roads: { edges: number; roadKm: number; pathKm: number; bridges: number; tunnels: number };
  /** Where the heights come from, null for flat ground */
  dem: string | null;
}

/** A map made and packed, ready for the map store */
export interface OsmMade extends OsmImportResult {
  file: Uint8Array;
  convertMs: number;
}

export class OsmFrameCore {
  private input: OsmImportInput | null = null;
  private streets: OsmStreets | null = null;

  constructor(private readonly deps: { store?: OsmFrameStore; decode?: DemDecoder; sideM?: number } = {}) {}

  /**
   * Loads `place`'s data and lays out its spawns: at `spawnsAt` where given
   * (a running real place's), each dropped on its street; else `count`
   * drawn as on a real place
   */
  async open(
    place: GeoPoint & { address?: string },
    count: number,
    spawnsAt: readonly GeoPoint[] = [],
    onStep?: (step: OsmStep) => void,
    signal?: AbortSignal,
  ): Promise<OsmFrameInfo> {
    const side = this.deps.sideM ?? OSM_WORLD_SIDE;
    const { input, download } = await loadOsmInput(place, { sideM: side, store: this.deps.store, decode: this.deps.decode, signal, onStep });
    return this.read(input, download, count, spawnsAt);
  }

  /** As `open`, with the data in hand (specs, tools) */
  read(input: OsmImportInput, download: OsmDownloadStats, count: number, spawnsAt: readonly GeoPoint[] = []): OsmFrameInfo {
    this.input = input;
    const streets = (this.streets = osmStreets(input, this.deps.sideM ?? OSM_WORLD_SIDE));
    const given = spawnsAt.map((p) => this.drop(p)).filter((s): s is FrameSpawn => !('reason' in s));
    const { layout, roads, frame } = streets;
    return {
      hq: layout.hq ? frame.geo(layout.hq) : null,
      hqShiftM: layout.hqShiftM,
      spawns: given.length ? given : this.draw(count),
      fetchedAt: input.fetchedAt,
      download,
      roads: {
        edges: roads.edges,
        roadKm: Math.round(roads.km.road + roads.km.bridge),
        pathKm: Math.round(roads.km.path),
        bridges: roads.bridges,
        tunnels: roads.tunnels,
      },
      dem: input.dem?.source ?? null,
    };
  }

  /** `count` more spawns drawn apart from `keep` */
  draw(count: number, keep: readonly GeoPoint[] = []): FrameSpawn[] {
    const { layout, frame } = this.opened();
    return layout.draw(count, keep.map((p) => frame.point(p))).map((s) => this.geo(s));
  }

  /** A spawn dropped at `p`, on its street, or why it may not stand there */
  drop(p: GeoPoint): FrameSpawn | { reason: string } {
    const { layout, frame } = this.opened();
    const laid = layout.at(frame.point(p));
    return 'reason' in laid ? laid : this.geo(laid);
  }

  /** The map with the spawns at `spawnsAt`, packed */
  make(spawnsAt: readonly GeoPoint[], options: OsmImportOptions, onStep?: (step: OsmStep) => void): OsmMade {
    const input = this.input;
    if (!input) throw new Error('The place is not loaded');
    const start = performance.now();
    const result = convertOsm(input, { ...options, sideM: this.deps.sideM ?? options.sideM, spawnsAt: [...spawnsAt] }, onStep);
    onStep?.('pack');
    // The store gives a map its identity at the first save; the file packed here carries it already
    result.doc.meta.uid = newMapUid();
    const file = packMapFile(result.doc);
    return { ...result, file, convertMs: Math.round(performance.now() - start) };
  }

  private opened(): OsmStreets {
    if (!this.streets) throw new Error('The place is not loaded');
    return this.streets;
  }

  private geo(s: LaidSpawn): FrameSpawn {
    const frame = this.streets!.frame;
    const at = frame.geo(s);
    const route = s.route.map((p: MapPoint): [number, number] => {
      const g = frame.geo(p);
      return [round6(g.lon), round6(g.lat)];
    });
    return { lat: at.lat, lon: at.lon, name: s.name, distanceM: s.distanceM, routeM: s.routeM, route };
  }
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;
