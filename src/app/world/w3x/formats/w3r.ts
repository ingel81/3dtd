/**
 * war3map.w3r: regions ("rects" in the script), version 5. The script
 * variable of a region is `gg_rct_` + its name with every character that is
 * not a letter or digit replaced by an underscore.
 */

import { BinaryReader, W3xFormatError } from '../binary-reader';

export interface W3Region {
  name: string;
  /** Script variable, e.g. gg_rct_Spawn_001 */
  variable: string;
  left: number;
  bottom: number;
  right: number;
  top: number;
  index: number;
  weather: string;
}

export function regionVariable(name: string): string {
  return 'gg_rct_' + name.replace(/[^A-Za-z0-9]/g, '_');
}

export function parseW3r(bytes: Uint8Array): W3Region[] {
  const r = new BinaryReader(bytes, 'war3map.w3r');
  const version = r.i32();
  if (version !== 5) throw new W3xFormatError(`war3map.w3r: unsupported version ${version}`);
  const n = r.i32();
  if (n < 0 || n > r.left / 30) throw new W3xFormatError(`war3map.w3r: bad region count ${n}`);
  const out: W3Region[] = [];
  for (let i = 0; i < n; i++) {
    const left = r.f32();
    const bottom = r.f32();
    const right = r.f32();
    const top = r.f32();
    const name = r.cstr();
    const index = r.i32();
    const w = r.slice(4);
    r.cstr(); // ambient sound
    r.skip(4); // colour BGR + end byte
    out.push({
      name,
      variable: regionVariable(name),
      left,
      bottom,
      right,
      top,
      index,
      weather: w.every((b) => b === 0) ? '' : String.fromCharCode(...w),
    });
  }
  return out;
}

export function regionCenter(r: { left: number; bottom: number; right: number; top: number }): { x: number; y: number } {
  return { x: (r.left + r.right) / 2, y: (r.bottom + r.top) / 2 };
}
