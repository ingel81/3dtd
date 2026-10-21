import type { OsmImportOptions } from './import-osm';
import type { FrameSpawn, GeoPoint, OsmFrameInfo, OsmMade, OsmOpenRequest } from './osm-frame-core';
import type { OsmProgress } from './osm-progress';
import type { OverpassRetry } from './overpass-client';
import type { OsmErrorText } from './osm-error';
import type { SpawnDropReason } from './convert/layout';
import type { MapFault, MapProblem } from '../custom-map/map-text';
import type { MapPictureColours } from '../../map-ops/map-picture';

/** A call of the frame on the OSM worker (OsmFrameCore's methods) */
export type OsmWorkerRequest =
  | { id: number; kind: 'open'; request: OsmOpenRequest }
  | { id: number; kind: 'draw'; count: number; keep: GeoPoint[] }
  | { id: number; kind: 'drop'; at: GeoPoint }
  | { id: number; kind: 'make'; spawnsAt: GeoPoint[]; options: OsmImportOptions; colours: MapPictureColours };

export type OsmWorkerResponse =
  | { id: number; kind: 'progress'; progress: OsmProgress }
  | { id: number; kind: 'retry'; retry: OverpassRetry }
  | { id: number; kind: 'opened'; frame: OsmFrameInfo }
  | { id: number; kind: 'spawns'; spawns: FrameSpawn[] }
  | { id: number; kind: 'dropped'; spawn: FrameSpawn | { reason: SpawnDropReason } }
  | { id: number; kind: 'made'; made: OsmMade }
  /** A failure: its message, and why as data where the player reads it (an OsmError, a map that is not whole) */
  | { id: number; kind: 'error'; error: string; said?: OsmErrorText; fault?: MapFault; problems?: MapProblem[] };
