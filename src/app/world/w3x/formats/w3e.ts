/**
 * war3map.w3e: the terrain ("W3E!", version 11). A grid of corners, row 0 in
 * the south, 7 bytes each:
 *
 * ```
 * i16 height            ground height, 0x2000 = 0
 * u16 water             low 14 bits water level, 0x4000 map edge
 * u8  texture | flags   low 4 bits ground texture index, high 4 bits flags
 *                       (0x10 ramp, 0x20 blight, 0x40 water, 0x80 boundary)
 * u8  variation         low 5 bits texture variation, high 3 cliff variation
 * u8  cliff | layer     high 4 bits cliff texture, low 4 bits cliff layer
 * ```
 *
 * Corner (i, j) sits at x = offsetX + i * 128, y = offsetY + j * 128.
 */

import { BinaryReader, W3xFormatError, expectMagic } from '../binary-reader';

/** World units per tile */
export const W3_TILE = 128;

export const W3E_FLAG = {
  RAMP: 0x10,
  BLIGHT: 0x20,
  WATER: 0x40,
  BOUNDARY: 0x80,
} as const;

export interface W3eTerrain {
  version: number;
  tileset: string;
  customTilesets: boolean;
  /** Ground tile ids such as 'Ldrt', indexed by `texture` */
  groundTiles: string[];
  cliffTiles: string[];
  /** Corners per row and per column (tiles + 1) */
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  groundHeight: Int16Array;
  waterLevel: Uint16Array;
  mapEdge: Uint8Array;
  flags: Uint8Array;
  texture: Uint8Array;
  variation: Uint8Array;
  cliffTexture: Uint8Array;
  layer: Uint8Array;
}

export function parseW3e(bytes: Uint8Array): W3eTerrain {
  const r = new BinaryReader(bytes, 'war3map.w3e');
  expectMagic(r, 'W3E!');
  const version = r.i32();
  if (version !== 11) throw new W3xFormatError(`war3map.w3e: unsupported version ${version}`);
  const tileset = String.fromCharCode(r.u8());
  const customTilesets = r.i32() === 1;
  const groundTiles = Array.from({ length: r.i32() }, () => r.id4());
  const cliffTiles = Array.from({ length: r.i32() }, () => r.id4());
  const width = r.i32();
  const height = r.i32();
  const offsetX = r.f32();
  const offsetY = r.f32();
  if (width < 2 || height < 2 || width > 1025 || height > 1025) {
    throw new W3xFormatError(`war3map.w3e: bad size ${width} x ${height}`);
  }
  const n = width * height;
  if (r.left < n * 7) throw new W3xFormatError('war3map.w3e: corner data truncated');
  const t: W3eTerrain = {
    version,
    tileset,
    customTilesets,
    groundTiles,
    cliffTiles,
    width,
    height,
    offsetX,
    offsetY,
    groundHeight: new Int16Array(n),
    waterLevel: new Uint16Array(n),
    mapEdge: new Uint8Array(n),
    flags: new Uint8Array(n),
    texture: new Uint8Array(n),
    variation: new Uint8Array(n),
    cliffTexture: new Uint8Array(n),
    layer: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    t.groundHeight[i] = r.i16();
    const w = r.u16();
    t.waterLevel[i] = w & 0x3fff;
    t.mapEdge[i] = w & 0x4000 ? 1 : 0;
    const ft = r.u8();
    t.texture[i] = ft & 0x0f;
    t.flags[i] = ft & 0xf0;
    t.variation[i] = r.u8();
    const cl = r.u8();
    t.cliffTexture[i] = cl >> 4;
    t.layer[i] = cl & 0x0f;
  }
  return t;
}

/** Height of corner `i` in world units, cliff layer included */
export function cornerZ(t: W3eTerrain, i: number): number {
  return (t.groundHeight[i] - 0x2000) / 4 + (t.layer[i] - 2) * W3_TILE;
}

/** Ground height without the cliff layer */
export function cornerGroundZ(t: W3eTerrain, i: number): number {
  return (t.groundHeight[i] - 0x2000) / 4;
}

/** Water surface height of corner `i` in world units (meaningful where the water flag is set) */
export function cornerWaterZ(t: W3eTerrain, i: number): number {
  return (t.waterLevel[i] - 0x2000) / 4 - 89.6;
}
