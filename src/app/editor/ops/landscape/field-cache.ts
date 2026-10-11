/**
 * A stroke's memory of values that depend only on the map position (the
 * noise behind a biome's ground mix, its pools, cracks and frayed rim): a
 * held or slowly moving brush passes each texel dozens of times, and
 * reading the stored bytes is far cheaper than the noise. Tiles of 64 x 64
 * cells are made on first touch; past a limit the oldest go.
 */

const TILE = 64;
/** Tiles kept, about 8 MB at 12 channels */
const MAX_TILES = 192;

interface Tile {
  data: Uint8Array;
  have: Uint8Array;
}

export class FieldCache {
  private readonly tiles = new Map<number, Tile>();
  /** The tile and offset of the last `at`, and whether its values still need filling */
  data: Uint8Array = new Uint8Array(0);
  offset = 0;
  fresh = false;

  constructor(
    readonly columns: number,
    readonly channels: number,
  ) {}

  /** Points `data`/`offset` at cell (i, j); `fresh` says the caller must fill the channels now */
  at(i: number, j: number): void {
    const ti = i >> 6;
    const tj = j >> 6;
    const key = tj * 65536 + ti;
    let tile = this.tiles.get(key);
    if (!tile) {
      if (this.tiles.size >= MAX_TILES) this.tiles.delete(this.tiles.keys().next().value!);
      tile = { data: new Uint8Array(TILE * TILE * this.channels), have: new Uint8Array(TILE * TILE) };
      this.tiles.set(key, tile);
    }
    const cell = (j & (TILE - 1)) * TILE + (i & (TILE - 1));
    this.data = tile.data;
    this.offset = cell * this.channels;
    this.fresh = !tile.have[cell];
    tile.have[cell] = 1;
  }
}
