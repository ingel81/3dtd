/**
 * The work behind the frame of an OSM world (components/osm-frame): load a
 * place's data (frame store or download), draw the spawns on its streets and
 * drop dragged ones there, then make and pack the map with the spawns the
 * player chose. One instance per frame holds the place's data between the
 * calls, so the making fetches nothing. Runs in the OSM worker
 * (osm.worker.ts), or on the calling thread where workers are missing.
 */
import { newMapUid } from '../custom-map/map-create';
import { contentHash, packMapFile } from '../custom-map/map-file';
import { sketchMapPicture } from '../custom-map/map-sketch';
import type { MapPoint } from '../custom-map/map-document';
import type { DemDecoder } from './dem-tiles';
import type { OsmFrameStore } from './osm-frame-store';
import type { OverpassRetry } from './overpass-client';
import {
  convertOsm,
  loadOsmInput,
  osmStreets,
  OSM_WORLD_SIDE,
  type OsmDownloadStats,
  type OsmImportInput,
  type OsmImportOptions,
  type OsmImportResult,
  type OsmStreets,
} from './import-osm';
import type { OsmProgress } from './osm-progress';
import type { LaidSpawn } from './convert/layout';
import { areaWithin, OSM_HQ_EDGE_M, type OsmArea } from './osm-area';
import type { LandmarkKind } from './convert/anchors';

/** A point on the earth */
export interface GeoPoint {
  lat: number;
  lon: number;
}

/** A spawn as the frame draws it, in real coordinates */
export interface FrameSpawn extends GeoPoint {
  name: string;
  /** Straight from the HQ, metres */
  distanceM: number;
  routeM: number;
  /** Its route to the HQ as [lon, lat] pairs */
  route: [number, number][];
}

/** A landmark the frame offers for the HQ, in real coordinates */
export interface FrameLandmark extends GeoPoint {
  /** OSM `name`, else empty */
  name: string;
  kind: LandmarkKind;
  /** Straight from the searched place, metres */
  distanceM: number;
}

/** Landmarks the frame offers at most */
const FRAME_LANDMARKS = 3;

/** What the frame opens: the place, the square of the map and the spawns to lay out */
export interface OsmOpenRequest {
  /** Where the HQ goes (the place searched for, or a landmark the player chose), and what the player searched for */
  place: GeoPoint & { address?: string };
  /** The place searched for when the HQ goes elsewhere (a landmark): the landmarks are offered round it */
  searched?: GeoPoint;
  /** Spawns wanted; drawn when `spawnsAt` gives none (or, with `topUp`, fewer stand) */
  count: number;
  /** Spawns to start from (a running real place's, the ones standing before the square moved), each dropped on its street */
  spawnsAt?: GeoPoint[];
  /** Spawns of `spawnsAt` that may not stand are drawn anew up to `count` */
  topUp?: boolean;
  /** The map's square; a square of the default side round the place when absent */
  area?: OsmArea;
  /** The square whose data to load when the core holds none for `area` (from the store: what an earlier opening loaded) */
  data?: OsmArea;
}

/** What the frame shows of a loaded place */
export interface OsmFrameInfo {
  /** The map's square as laid out */
  area: OsmArea;
  /** The square the loaded data covers: a square within it needs no download */
  data: OsmArea;
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
  /** Landmarks near the place searched for, inside the square with room for the HQ, the best first */
  landmarks: FrameLandmark[];
}

/** A map made and packed, ready for the map store: its file, content hash and sketch worked out beside the making */
export interface OsmMade extends OsmImportResult {
  file: Uint8Array;
  /** MapStore.save takes it (SaveOptions.contentHash) instead of working it out on the page */
  hash: string;
  /** The sketch for the lists (map-sketch.ts), null where there is no 2D canvas */
  preview: Uint8Array | null;
  convertMs: number;
}

export class OsmFrameCore {
  /** The place's data as loaded, and the square it covers */
  private data: { input: OsmImportInput; area: OsmArea; download: OsmDownloadStats } | null = null;
  /** The data cropped to the map's square, its HQ on the place */
  private input: OsmImportInput | null = null;
  private area: OsmArea | null = null;
  private streets: OsmStreets | null = null;
  /** The default side, and the least the data covers */
  private readonly side: number;

  constructor(private readonly deps: { store?: OsmFrameStore; decode?: DemDecoder; sideM?: number } = {}) {
    this.side = deps.sideM ?? OSM_WORLD_SIDE;
  }

  /**
   * Loads the place's data for the request's square and lays out its
   * spawns: at `spawnsAt` where given, each dropped on its street; else
   * `count` drawn as on a real place. Data in hand that covers the square
   * is cropped, nothing fetched; else a square of at least the default side
   * round it loads (frame store or download), so sizing down and small moves
   * after it fetch nothing either. A failed load keeps what was laid out.
   */
  async open(request: OsmOpenRequest, onProgress?: (progress: OsmProgress) => void, signal?: AbortSignal, onRetry?: (retry: OverpassRetry) => void): Promise<OsmFrameInfo> {
    const { place } = request;
    const area = request.area ?? { lat: place.lat, lon: place.lon, sideM: this.side };
    if (!this.data || !areaWithin(area, this.data.area)) {
      const wanted = request.data && areaWithin(area, request.data) ? request.data : { lat: area.lat, lon: area.lon, sideM: Math.max(area.sideM, this.side) };
      const { input, download } = await loadOsmInput(
        { lat: wanted.lat, lon: wanted.lon, address: place.address },
        { sideM: wanted.sideM, store: this.deps.store, decode: this.deps.decode, signal, onProgress, onRetry },
      );
      this.data = { input, area: wanted, download };
    }
    onProgress?.({ step: 'streets' });
    const info = this.lay(place, area, request.count, request.spawnsAt ?? [], request.topUp ?? false, request.searched);
    onProgress?.({ step: 'streets', state: 'done', detail: `${info.roads.roadKm} km of road, ${info.spawns.length} ${info.spawns.length === 1 ? 'spawn' : 'spawns'}` });
    return info;
  }

  /** As `open`, with the data in hand (specs, tools): its square round its centre */
  read(input: OsmImportInput, download: OsmDownloadStats, count: number, spawnsAt: readonly GeoPoint[] = []): OsmFrameInfo {
    const area = { lat: input.lat, lon: input.lon, sideM: this.side };
    this.data = { input, area, download };
    return this.lay(input, area, count, spawnsAt, false);
  }

  private lay(place: GeoPoint, area: OsmArea, count: number, spawnsAt: readonly GeoPoint[], topUp: boolean, searched: GeoPoint = place): OsmFrameInfo {
    const data = this.data!;
    const input: OsmImportInput = { ...data.input, lat: area.lat, lon: area.lon, place: { lat: place.lat, lon: place.lon } };
    // The landmarks round the place searched for, wherever the HQ stands now
    const streets = osmStreets(input, area.sideM, searched);
    const landmarks = this.landmarks(streets, area, searched);
    this.input = input;
    this.area = area;
    this.streets = streets;
    const given = spawnsAt.map((p) => this.drop(p)).filter((s): s is FrameSpawn => !('reason' in s));
    const spawns = !given.length ? this.draw(count) : topUp && given.length < count ? [...given, ...this.draw(count - given.length, given)] : given;
    const { layout, roads, frame } = streets;
    return {
      area,
      data: data.area,
      hq: layout.hq ? frame.geo(layout.hq) : null,
      hqShiftM: layout.hqShiftM,
      spawns,
      fetchedAt: input.fetchedAt,
      download: data.download,
      roads: {
        edges: roads.edges,
        roadKm: Math.round(roads.km.road + roads.km.bridge),
        pathKm: Math.round(roads.km.path),
        bridges: roads.bridges,
        tunnels: roads.tunnels,
      },
      dem: input.dem?.source ?? null,
      landmarks,
    };
  }

  /** The landmarks a frame offers: inside the square with room for the HQ, in real coordinates */
  private landmarks(streets: OsmStreets, area: OsmArea, searched: GeoPoint): FrameLandmark[] {
    const reach = area.sideM / 2 - OSM_HQ_EDGE_M;
    const from = streets.frame.point(searched);
    return streets.landmarks
      .filter((l) => Math.abs(l.x) <= reach && Math.abs(l.y) <= reach)
      .slice(0, FRAME_LANDMARKS)
      .map((l) => {
        const at = streets.frame.geo(l);
        return { lat: round6(at.lat), lon: round6(at.lon), name: l.name, kind: l.kind, distanceM: Math.round(Math.hypot(l.x - from.x, l.y - from.y)) };
      });
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

  /** The map with the spawns at `spawnsAt`, packed, with its content hash and sketch (the page only stores them) */
  async make(spawnsAt: readonly GeoPoint[], options: OsmImportOptions, onProgress?: (progress: OsmProgress) => void): Promise<OsmMade> {
    const input = this.input;
    if (!input) throw new Error('The place is not loaded');
    const start = performance.now();
    onProgress?.({ step: 'parse' });
    const result = convertOsm(input, { ...options, sideM: this.area?.sideM ?? options.sideM, spawnsAt: [...spawnsAt] }, (step) => onProgress?.({ step }), (step, share) => onProgress?.({ step, share }));
    onProgress?.({ step: 'pack' });
    // The store gives a map its identity at the first save; the file packed here carries it already
    result.doc.meta.uid = newMapUid();
    const file = packMapFile(result.doc);
    onProgress?.({ step: 'pack', share: 0.8, detail: 'its picture and fingerprint' });
    const [hash, preview] = await Promise.all([contentHash(result.doc), sketchMapPicture(result.doc).catch(() => null)]);
    return { ...result, file, hash, preview, convertMs: Math.round(performance.now() - start) };
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
