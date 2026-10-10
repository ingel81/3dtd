/**
 * Opens a .w3x/.w3m and parses every file the importer reads. Only the
 * terrain is required; a missing or unreadable other file becomes a warning
 * and the import goes on without it.
 */

import { W3xFormatError } from './binary-reader';
import { type DooFile, type W3Unit, parseDoo, parseUnits } from './formats/doo';
import { type W3eTerrain, parseW3e } from './formats/w3e';
import { type W3iInfo, isReforged, parseW3i } from './formats/w3i';
import { type W3Region, parseW3r } from './formats/w3r';
import { type PathingMap, parseWpm } from './formats/wpm';
import { type WtsTable, parseWts } from './formats/wts';
import { MpqArchive } from './mpq';

export interface MapScript {
  language: 'jass' | 'lua';
  file: string;
  text: string;
}

export interface W3xMapFiles {
  info: W3iInfo | null;
  strings: WtsTable | null;
  terrain: W3eTerrain;
  doodads: DooFile | null;
  units: W3Unit[];
  regions: W3Region[];
  pathing: PathingMap | null;
  script: MapScript | null;
  warnings: string[];
}

const SCRIPT_FILES: [string, MapScript['language']][] = [
  ['war3map.j', 'jass'],
  ['scripts\\war3map.j', 'jass'],
  ['war3map.lua', 'lua'],
  ['scripts\\war3map.lua', 'lua'],
];

export function readW3xFiles(bytes: Uint8Array): W3xMapFiles {
  const mpq = new MpqArchive(bytes);
  const warnings = mpq.notes.map((n) => `archive: ${n}`);
  const read = (name: string): Uint8Array | null => {
    try {
      return mpq.read(name);
    } catch (e) {
      warnings.push(`${name}: ${(e as Error).message}`);
      return null;
    }
  };
  const parse = <T>(name: string, fn: (b: Uint8Array) => T): T | null => {
    const b = read(name);
    if (!b) return null;
    try {
      return fn(b);
    } catch (e) {
      warnings.push(`${name}: ${(e as Error).message}`);
      return null;
    }
  };

  const terrainBytes = read('war3map.w3e');
  if (!terrainBytes) throw new W3xFormatError('The map has no readable terrain (war3map.w3e); protected or not a map');
  const terrain = parseW3e(terrainBytes);
  const strings = parse('war3map.wts', parseWts);
  const info = parse('war3map.w3i', (b) => parseW3i(b, strings));
  if (!info) warnings.push('war3map.w3i missing: no playable area, name or fog');
  const reforged = isReforged(info);
  const doodads = parse('war3map.doo', (b) => parseDoo(b, reforged));
  const units = parse('war3mapUnits.doo', (b) => parseUnits(b, reforged)) ?? [];
  const regions = parse('war3map.w3r', parseW3r) ?? [];
  const pathing = parse('war3map.wpm', parseWpm);

  let script: MapScript | null = null;
  const preferLua = info?.scriptLanguage === 1;
  const order = preferLua ? [...SCRIPT_FILES].reverse() : SCRIPT_FILES;
  for (const [file, language] of order) {
    const b = read(file);
    if (b) {
      script = { language, file, text: new TextDecoder('utf-8').decode(b) };
      break;
    }
  }
  if (!script) warnings.push('no map script found: routes come from the terrain only');

  return { info, strings, terrain, doodads, units, regions, pathing, script, warnings };
}
