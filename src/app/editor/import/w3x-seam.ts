/**
 * Where the editor meets the Warcraft 3 importer (`world/w3x/`). The editor
 * needs one call: bytes of a `.w3x` in, a map document and a short report
 * out. The importer runs in a Web Worker and is loaded on first use, so the
 * editor's bundle does not carry it.
 */
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import type { W3xImportReport as ImporterReport } from '../../world/w3x/import-w3x';

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

export async function loadW3xImporter(): Promise<W3xImporter> {
  const { importW3xInWorker } = await import('../../world/w3x/w3x-import-client');
  return async (bytes, options, signal) => {
    const { doc, report } = await importW3xInWorker(bytes, { ...options }, { signal });
    return { doc, report: summarizeReport(report) };
  };
}

const STRATEGY_NAMES: Record<string, string> = {
  'script-pattern': 'the map script (trigger patterns)',
  'script-eval': 'the map script (evaluated)',
  terrain: 'the terrain (pathing)',
};

/** The importer's report in lines for the editor's import panel */
export function summarizeReport(report: ImporterReport): W3xImportReport {
  const s = report.stats;
  const mapped: string[] = [];
  mapped.push(`${s.mapName}${s.tileset ? ` | tileset ${s.tileset}` : ''}`);
  mapped.push(`${s.tiles.width} x ${s.tiles.height} tiles to ${Math.round(s.metres.width)} x ${Math.round(s.metres.depth)} m`);
  const tiles = Object.keys(s.groundMaterials).length;
  if (tiles) mapped.push(`${tiles} ground tile kinds to ${s.layers.length} layers: ${s.layers.join(', ')}`);
  if (s.waterSamples) mapped.push(`Water on ${s.waterSamples} height points`);
  if (report.strategy) {
    mapped.push(`Roads from ${STRATEGY_NAMES[report.strategy] ?? report.strategy}: ${s.pathEdges} roads, ${s.pathNodes} nodes, ${s.spawns} spawns`);
  }
  const lengths = Object.values(s.routeLengths);
  if (lengths.length) mapped.push(`Lanes ${Math.round(Math.min(...lengths))} to ${Math.round(Math.max(...lengths))} m long`);
  mapped.push(`${s.objects.placed} of ${s.objects.doodads} doodads placed as objects`);
  const waves = report.waves;
  if (waves?.rows.length) {
    const bosses = waves.rows.filter((r) => r.boss).length;
    mapped.push(`${waves.rows.length} waves taken over as the map's own list${bosses ? `, ${bosses} with a boss` : ''}`);
    for (const r of waves.rows.slice(0, 5)) mapped.push(`Wave ${r.wave}: ${r.count} ${r.name} (${r.hp} HP) as ${r.enemy}${r.boss ? ` + boss ${r.boss.name} as ${r.boss.enemy}` : ''}`);
    if (waves.rows.length > 5) mapped.push(`… and ${waves.rows.length - 5} more waves (Gameplay tool, G)`);
  }
  for (const a of report.attempts) if (a.strategy !== report.strategy) mapped.push(`Tried ${STRATEGY_NAMES[a.strategy] ?? a.strategy}: ${a.result}`);
  const warnings = [...report.warnings];
  if (!report.strategy) warnings.unshift('No roads found: draw them with the path tool, then place spawns and the HQ.');
  return { mapped, warnings };
}
