/**
 * Where the editor meets the Warcraft 3 importer (`world/w3x/`). The editor
 * only needs one call: bytes of a `.w3x` in, a map document and a report
 * out. Until the importer is wired, `loadW3xImporter` returns null and the
 * editor says so instead of offering a broken import.
 */
import type { CustomMapDocument } from '../../world/custom-map/map-document';

export interface W3xImportOptions {
  /** File name, for the map's source and the report */
  fileName: string;
  /** Metres per Warcraft tile (128 units) */
  metersPerTile?: number;
  /** Progress 0..1 with the step being read */
  onProgress?: (share: number, step: string) => void;
}

export interface W3xImportReport {
  /** What came over: "4096 doodads to 3120 objects", "Lordaeron Summer tiles to 6 materials" */
  mapped: string[];
  /** What did not, or only roughly */
  warnings: string[];
}

export interface W3xImportResult {
  doc: CustomMapDocument;
  report: W3xImportReport;
}

export type W3xImporter = (bytes: ArrayBuffer, options: W3xImportOptions) => Promise<W3xImportResult>;

/** The importer, loaded on first use; null while this build has none */
export async function loadW3xImporter(): Promise<W3xImporter | null> {
  return null;
}
