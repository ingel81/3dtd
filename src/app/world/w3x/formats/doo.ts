/**
 * war3map.doo (doodads and destructables) and war3mapUnits.doo (preplaced
 * units). Both start with "W3do", a version (7 Reign of Chaos, 8 The Frozen
 * Throne) and a subversion (9 or 11).
 *
 * Maps saved by 1.32+ (Reforged) insert a skin id after the scale. Whether a
 * file has it is not stored in the file itself; the parser takes the hint
 * from war3map.w3i and otherwise tries both layouts and keeps the one that
 * reads to the exact end.
 */

import { BinaryReader, W3xFormatError, expectMagic } from '../binary-reader';

export interface W3Doodad {
  id: string;
  variation: number;
  x: number;
  y: number;
  z: number;
  /** Radians, counter-clockwise from east */
  angle: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  /** 0 invisible non-solid, 1 visible non-solid, 2 visible solid; 4 fixed z (1.32+) */
  flags: number;
  life: number;
}

export interface W3SpecialDoodad {
  id: string;
  /** Tile coordinates */
  x: number;
  y: number;
}

export interface DooFile {
  version: number;
  subversion: number;
  skins: boolean;
  doodads: W3Doodad[];
  special: W3SpecialDoodad[];
}

function readDropSets(r: BinaryReader): void {
  const sets = r.i32();
  if (sets < 0 || sets > 10000) throw new W3xFormatError(`${r.file}: bad item set count`);
  for (let s = 0; s < sets; s++) {
    const items = r.i32();
    if (items < 0 || items > 10000) throw new W3xFormatError(`${r.file}: bad item count`);
    r.skip(items * 8);
  }
}

function parseDooLayout(bytes: Uint8Array, skins: boolean): DooFile {
  const r = new BinaryReader(bytes, 'war3map.doo');
  expectMagic(r, 'W3do');
  const version = r.i32();
  const subversion = r.i32();
  if (version !== 7 && version !== 8) throw new W3xFormatError(`war3map.doo: unsupported version ${version}`);
  const count = r.i32();
  if (count < 0 || count > r.left / 40) throw new W3xFormatError(`war3map.doo: bad doodad count ${count}`);
  const doodads: W3Doodad[] = [];
  for (let i = 0; i < count; i++) {
    const d: W3Doodad = {
      id: r.id4(),
      variation: r.i32(),
      x: r.f32(),
      y: r.f32(),
      z: r.f32(),
      angle: r.f32(),
      scaleX: r.f32(),
      scaleY: r.f32(),
      scaleZ: r.f32(),
      flags: 0,
      life: 0,
    };
    if (skins) r.skip(4);
    d.flags = r.u8();
    d.life = r.u8();
    if (version >= 8) {
      r.i32(); // item table
      readDropSets(r);
    }
    r.i32(); // editor id
    doodads.push(d);
  }
  const special: W3SpecialDoodad[] = [];
  if (r.left >= 8) {
    r.i32(); // special doodad version
    const n = r.i32();
    if (n < 0 || n * 16 > r.left) throw new W3xFormatError('war3map.doo: bad special doodad count');
    for (let i = 0; i < n; i++) {
      const id = r.id4();
      r.i32(); // variation (z in older notes)
      special.push({ id, x: r.i32(), y: r.i32() });
    }
  }
  if (r.left !== 0) throw new W3xFormatError(`war3map.doo: ${r.left} bytes left over`);
  return { version, subversion, skins, doodads, special };
}

/** Parses war3map.doo; `reforged` from the w3i decides which layout is tried first */
export function parseDoo(bytes: Uint8Array, reforged = false): DooFile {
  try {
    return parseDooLayout(bytes, reforged);
  } catch (first) {
    try {
      return parseDooLayout(bytes, !reforged);
    } catch {
      throw first;
    }
  }
}

export interface W3Unit {
  id: string;
  x: number;
  y: number;
  z: number;
  angle: number;
  player: number;
}

function parseUnitsLayout(bytes: Uint8Array, skins: boolean): W3Unit[] {
  const r = new BinaryReader(bytes, 'war3mapUnits.doo');
  expectMagic(r, 'W3do');
  const version = r.i32();
  const subversion = r.i32();
  if (version !== 7 && version !== 8) throw new W3xFormatError(`war3mapUnits.doo: unsupported version ${version}`);
  const tft = subversion >= 11;
  const count = r.i32();
  if (count < 0 || count > r.left / 50) throw new W3xFormatError(`war3mapUnits.doo: bad unit count ${count}`);
  const units: W3Unit[] = [];
  for (let i = 0; i < count; i++) {
    const id = r.id4();
    r.i32(); // variation
    const x = r.f32();
    const y = r.f32();
    const z = r.f32();
    const angle = r.f32();
    r.skip(12); // scale
    if (skins) r.skip(4);
    r.u8(); // flags
    const player = r.i32();
    r.skip(2); // unknown bytes
    r.i32(); // hit points
    r.i32(); // mana
    if (tft) r.i32(); // item table
    readDropSets(r);
    r.i32(); // gold
    r.f32(); // target acquisition
    r.i32(); // hero level
    if (tft) r.skip(12); // strength, agility, intelligence
    const inventory = r.i32();
    if (inventory < 0 || inventory > 6) throw new W3xFormatError('war3mapUnits.doo: bad inventory');
    r.skip(inventory * 8);
    const abilities = r.i32();
    if (abilities < 0 || abilities > 1000) throw new W3xFormatError('war3mapUnits.doo: bad ability count');
    r.skip(abilities * 12);
    const random = r.i32();
    if (random === 0) r.skip(4);
    else if (random === 1) r.skip(8);
    else if (random === 2) {
      const n = r.i32();
      if (n < 0 || n > 1000) throw new W3xFormatError('war3mapUnits.doo: bad random list');
      r.skip(n * 8);
    }
    r.i32(); // custom colour
    r.i32(); // waygate target region
    r.i32(); // creation number
    units.push({ id, x, y, z, angle, player });
  }
  if (r.left !== 0) throw new W3xFormatError(`war3mapUnits.doo: ${r.left} bytes left over`);
  return units;
}

export function parseUnits(bytes: Uint8Array, reforged = false): W3Unit[] {
  try {
    return parseUnitsLayout(bytes, reforged);
  } catch (first) {
    try {
      return parseUnitsLayout(bytes, !reforged);
    } catch {
      throw first;
    }
  }
}
