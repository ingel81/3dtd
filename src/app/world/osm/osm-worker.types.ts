import type { OsmImportOptions, OsmImportResult } from './import-osm';

/** One step of an OSM world's making, for the progress line */
export type OsmImportStep = 'download' | 'convert';

/** What the download took, for the report */
export interface OsmDownloadStats {
  osmMs: number;
  /** JSON characters of the Overpass answers */
  osmChars: number;
  osmRequests: number;
  demMs: number;
  demTiles: number;
  demBytes: number;
}

export interface OsmWorkerRequest {
  id: number;
  lat: number;
  lon: number;
  address?: string;
  options: OsmImportOptions;
}

export type OsmWorkerResponse =
  | { id: number; kind: 'step'; step: OsmImportStep }
  | { id: number; kind: 'done'; result: OsmImportResult; download: OsmDownloadStats; convertMs: number }
  | { id: number; kind: 'error'; error: string };
