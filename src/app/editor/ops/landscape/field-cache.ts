/**
 * A stroke's memory of values that depend only on the map position (the
 * noise behind a biome's ground mix, its pools, cracks and frayed rim): a
 * held or slowly moving brush passes each texel dozens of times, and
 * reading the stored bytes is far cheaper than the noise. Tiles of 64 x 64
 * cells are made on first touch; past a limit the oldest go. Bytes by
 * default; a landform's noise, which feeds heights, keeps doubles, so the
 * land comes out exactly as computed afresh.
 */

const TILE = 64;
/** Tiles kept, about 12 MB at 16 channels (the biome mix: 12 layers and four more) */
const MAX_TILES = 192;

interface Tile<T> {
  data: T;
  have: Uint8Array;
}

export class FieldCache<T extends Uint8Array | Float64Array = Uint8Array> {
  private readonly tiles = new Map<number, Tile<T>>();
  /** The tile and offset of the last `at`, and whether its values still need filling */
  data: T;
  offset = 0;
  fresh = false;

  constructor(
    readonly columns: number,
    readonly channels: number,
    private readonly make: (length: number) => T = (length) => new Uint8Array(length) as T,
  ) {
    this.data = make(0);
  }

  /** Points `data`/`offset` at cell (i, j); `fresh` says the caller must fill the channels now */
  at(i: number, j: number): void {
    const ti = i >> 6;
    const tj = j >> 6;
    const key = tj * 65536 + ti;
    let tile = this.tiles.get(key);
    if (!tile) {
      if (this.tiles.size >= MAX_TILES) this.tiles.delete(this.tiles.keys().next().value!);
      tile = { data: this.make(TILE * TILE * this.channels), have: new Uint8Array(TILE * TILE) };
      this.tiles.set(key, tile);
    }
    const cell = (j & (TILE - 1)) * TILE + (i & (TILE - 1));
    this.data = tile.data;
    this.offset = cell * this.channels;
    this.fresh = !tile.have[cell];
    tile.have[cell] = 1;
  }
}
