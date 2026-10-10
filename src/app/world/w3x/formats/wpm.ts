/**
 * war3map.wpm: the pathing map ("MP3W", version 0), four cells per tile
 * (32 world units each), row 0 in the south, one byte per cell.
 */

import { BinaryReader, W3xFormatError, expectMagic } from '../binary-reader';

export const WPM = {
  NO_WALK: 0x02,
  NO_FLY: 0x04,
  NO_BUILD: 0x08,
  BLIGHT: 0x20,
  /** Set on land cells, clear on water */
  LAND: 0x40,
} as const;

/** World units per pathing cell */
export const WPM_CELL = 32;

export interface PathingMap {
  width: number;
  height: number;
  cells: Uint8Array;
}

export function parseWpm(bytes: Uint8Array): PathingMap {
  const r = new BinaryReader(bytes, 'war3map.wpm');
  expectMagic(r, 'MP3W');
  const version = r.i32();
  if (version !== 0) throw new W3xFormatError(`war3map.wpm: unsupported version ${version}`);
  const width = r.i32();
  const height = r.i32();
  if (width <= 0 || height <= 0 || width * height > r.left) throw new W3xFormatError('war3map.wpm: bad size');
  return { width, height, cells: r.slice(width * height) };
}

/** Walkable by ground units */
export function walkable(v: number): boolean {
  return (v & WPM.NO_WALK) === 0;
}

/** Walkable but not buildable: the lanes of a tower defense map */
export function laneCell(v: number): boolean {
  return (v & WPM.NO_WALK) === 0 && (v & WPM.NO_BUILD) !== 0;
}
