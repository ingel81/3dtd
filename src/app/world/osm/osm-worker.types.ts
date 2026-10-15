import type { OsmImportOptions } from './import-osm';
import type { FrameSpawn, GeoPoint, OsmFrameInfo, OsmMade, OsmStep } from './osm-frame-core';

/** A call of the frame on the OSM worker (OsmFrameCore's methods) */
export type OsmWorkerRequest =
  | { id: number; kind: 'open'; place: GeoPoint & { address?: string }; count: number; spawnsAt: GeoPoint[] }
  | { id: number; kind: 'draw'; count: number; keep: GeoPoint[] }
  | { id: number; kind: 'drop'; at: GeoPoint }
  | { id: number; kind: 'make'; spawnsAt: GeoPoint[]; options: OsmImportOptions };

export type OsmWorkerResponse =
  | { id: number; kind: 'step'; step: OsmStep }
  | { id: number; kind: 'opened'; frame: OsmFrameInfo }
  | { id: number; kind: 'spawns'; spawns: FrameSpawn[] }
  | { id: number; kind: 'dropped'; spawn: FrameSpawn | { reason: string } }
  | { id: number; kind: 'made'; made: OsmMade }
  | { id: number; kind: 'error'; error: string };
