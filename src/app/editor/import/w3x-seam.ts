/**
 * Where the editor meets the Warcraft 3 importer (`world/w3x/`). The editor
 * needs one call: bytes of a `.w3x` in, a map document and a short report
 * out. The importer runs in a Web Worker and is loaded on first use, so the
 * editor's bundle does not carry it.
 */
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import type { W3xImportReport as ImporterReport } from '../../world/w3x/import-w3x';
import type { Messages } from '../../i18n/messages/en';
import { say } from '../../i18n/said';
import { enemyName } from '../../i18n/lookups';

export interface W3xImportOptions {
  /** File name, for the map's source and the report */
  fileName: string;
  /** Metres per Warcraft tile (128 units) */
  metresPerTile: number;
  /** Only the playable area, without the black border */
  cropToPlayable: boolean;
  /** Most objects; more are thinned evenly */
  maxObjects: number;
  /** Repaint the ground by its role in play (meadow, paving with gravel rims, forest rims) or map the tiles as they are */
  style: 'enhanced' | 'original';
  /** Take the map's own waves over as the map's wave list */
  waves: boolean;
}

/** The importer's defaults (docs/W3X_IMPORT.md) */
export const DEFAULT_W3X_OPTIONS = { metresPerTile: 4, cropToPlayable: true, maxObjects: 6000, style: 'enhanced', waves: false } as const;

export interface W3xImportReport {
  /** What came over: "312 x 256 tiles to 1248 x 1024 m", "4120 of 4500 doodads placed" */
  mapped: string[];
  /** What did not, or only roughly */
  warnings: string[];
}

export interface W3xImportResult {
  doc: CustomMapDocument;
  report: W3xImportReport;
}

/** `signal` aborts the import; it also ends by itself after two minutes */
export type W3xImporter = (bytes: ArrayBuffer, options: W3xImportOptions, signal?: AbortSignal) => Promise<W3xImportResult>;

/** `words`: the player's language, read when the report comes */
export async function loadW3xImporter(words: () => Messages): Promise<W3xImporter> {
  const { importW3xInWorker } = await import('../../world/w3x/w3x-import-client');
  return async (bytes, options, signal) => {
    const { doc, report } = await importW3xInWorker(bytes, { ...options }, { signal });
    return { doc, report: summarizeReport(words(), report) };
  };
}

/** The importer's report in lines for the editor's import panel, in the language of `t` */
export function summarizeReport(t: Messages, report: ImporterReport): W3xImportReport {
  const w = t.editor.w3x;
  const s = report.stats;
  const strategy = (id: string) => (w.strategies as Record<string, string>)[id] ?? id;
  const mapped: string[] = [];
  mapped.push(s.tileset ? w.mapTileset(s.mapName, s.tileset) : s.mapName);
  mapped.push(w.size(s.tiles.width, s.tiles.height, Math.round(s.metres.width), Math.round(s.metres.depth)));
  const tiles = Object.keys(s.groundMaterials).length;
  if (tiles) mapped.push(w.layers(tiles, s.layers.length, s.layers.join(', ')));
  if (s.waterSamples) mapped.push(w.water(s.waterSamples));
  if (report.strategy) mapped.push(w.roads(strategy(report.strategy), s.pathEdges, s.pathNodes, s.spawns));
  const lengths = Object.values(s.routeLengths);
  if (lengths.length) mapped.push(w.lanes(Math.round(Math.min(...lengths)), Math.round(Math.max(...lengths))));
  mapped.push(w.objects(s.objects.placed, s.objects.doodads));
  const waves = report.waves;
  if (waves?.rows.length) {
    mapped.push(w.waves(waves.rows.length, waves.rows.filter((r) => r.boss).length));
    for (const r of waves.rows.slice(0, 5)) {
      const boss = r.boss ? { name: r.boss.name, as: enemyName(t, r.boss.enemy) } : null;
      mapped.push(w.wave(r.wave, r.count, r.name, r.hp, enemyName(t, r.enemy), boss));
    }
    if (waves.rows.length > 5) mapped.push(w.moreWaves(waves.rows.length - 5));
  }
  for (const a of report.attempts) if (a.strategy !== report.strategy) mapped.push(w.tried(strategy(a.strategy), say(t.importNotes, a.result)));
  const warnings = report.warnings.map((note) => say(t.importNotes, note));
  if (!report.strategy) warnings.unshift(say(t.importNotes, { key: 'noRoadsFound' }));
  return { mapped, warnings };
}
