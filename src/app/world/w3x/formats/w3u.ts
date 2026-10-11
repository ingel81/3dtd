/**
 * war3map.w3u: the map's changes to unit types (object data). Two tables,
 * changed standard units and custom units, each object a list of field
 * changes (`uhpm` hit points, `umvs` move speed, `umvt` move type, `udef`
 * armour, `unam` name ...). Version 1/2 (The Frozen Throne) and 3 (1.33+,
 * changes in sets per skin; the first set is read). Units carry no level
 * columns.
 */

import { BinaryReader, W3xFormatError } from '../binary-reader';
import { type WtsTable, resolveTrigStr } from './wts';

export interface W3UnitType {
  /** The unit's id ('h001'), or the standard unit's for changed originals */
  id: string;
  /** The standard unit it is made from ('hfoo') */
  base: string;
  /** Changed fields by id; numbers for int, real and unreal, strings resolved through the wts */
  fields: Map<string, number | string>;
}

const VALUE = { INT: 0, REAL: 1, UNREAL: 2, STRING: 3 } as const;

export function parseW3u(bytes: Uint8Array, strings: WtsTable | null = null): Map<string, W3UnitType> {
  const r = new BinaryReader(bytes, 'war3map.w3u');
  const version = r.i32();
  if (version < 1 || version > 3) throw new W3xFormatError(`war3map.w3u: unsupported version ${version}`);
  const out = new Map<string, W3UnitType>();
  for (let table = 0; table < 2; table++) {
    const count = r.i32();
    if (count < 0 || count > 100000) throw new W3xFormatError('war3map.w3u: bad object count');
    for (let o = 0; o < count; o++) {
      const base = r.id4();
      const own = r.id4();
      const sets = version >= 3 ? r.i32() : 1;
      const fields = new Map<string, number | string>();
      for (let s = 0; s < sets; s++) {
        if (version >= 3) r.i32(); // set flags
        const mods = r.i32();
        if (mods < 0 || mods > 10000) throw new W3xFormatError('war3map.w3u: bad field count');
        for (let m = 0; m < mods; m++) {
          const field = r.id4();
          const type = r.i32();
          let value: number | string;
          if (type === VALUE.INT) value = r.i32();
          else if (type === VALUE.REAL || type === VALUE.UNREAL) value = r.f32();
          else if (type === VALUE.STRING) value = resolveTrigStr(r.cstr(), strings);
          else throw new W3xFormatError(`war3map.w3u: bad value type ${type}`);
          r.id4(); // end marker
          if (s === 0) fields.set(field, value);
        }
      }
      const id = own === '\0\0\0\0' || table === 0 ? base : own;
      out.set(id, { id, base, fields });
    }
  }
  return out;
}

/** A unit id as the script writes it ('h001'), from its integer raw code */
export function rawcodeToId(code: number): string {
  return String.fromCharCode((code >>> 24) & 255, (code >>> 16) & 255, (code >>> 8) & 255, code & 255);
}

/** Integer raw codes of unit ids look like four printable characters */
export function looksLikeRawcode(code: number): boolean {
  for (let shift = 24; shift >= 0; shift -= 8) {
    const c = (code >>> shift) & 255;
    if (c < 0x30 || c > 0x7a) return false;
  }
  return true;
}
