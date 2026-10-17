import type { OsmImportOptions } from './import-osm';
import type { FrameSpawn, GeoPoint, OsmFrameInfo, OsmMade, OsmOpenRequest } from './osm-frame-core';
import type { OsmProgress } from './osm-progress';
import type { OverpassRetry } from './overpass-client';

/** A call of the frame on the OSM worker (OsmFrameCore's methods) */
export type OsmWorkerRequest =
  | { id: number; kind: 'open'; request: OsmOpenRequest }
  | { id: number; kind: 'draw'; count: number; keep: GeoPoint[] }
  | { id: number; kind: 'drop'; at: GeoPoint }
  | { id: number; kind: 'make'; spawnsAt: GeoPoint[]; options: OsmImportOptions };

export type OsmWorkerResponse =
  | { id: number; kind: 'progress'; progress: OsmProgress }
  | { id: number; kind: 'retry'; retry: OverpassRetry }
  | { id: number; kind: 'opened'; frame: OsmFrameInfo }
  | { id: number; kind: 'spawns'; spawns: FrameSpawn[] }
  | { id: number; kind: 'dropped'; spawn: FrameSpawn | { reason: string } }
  | { id: number; kind: 'made'; made: OsmMade }
  | { id: number; kind: 'error'; error: string };
