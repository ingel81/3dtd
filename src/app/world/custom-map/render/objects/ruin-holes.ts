import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { HOLE_SLOTS } from '../../../../configs/destruction.config';

/**
 * The holes in the ruins (E259) as the shaders read them: a float texture
 * with one row per damaged structure and two texels per hole (HOLE_SLOTS a
 * row): centre in the layer's group frame and radius, m; the time it opened
 * or last grew on the damage clock (uDamageTime) and a number to vary its
 * rim by. A ruin's instance carries its row (writeDamage, in aDamage's
 * heading). Shared by every view, like DAMAGE_UNIFORMS: there is one
 * destructible world at a time. A row is set whole when its holes change,
 * the texture uploaded once (a few kB).
 */
export class RuinHoles {
  /** The texture the shaders sample; a new one when it grows (the uniform follows) */
  texture: DataTexture;
  private data: Float32Array;
  private rows = 0;
  private readonly rowById = new Map<string, number>();
  private readonly listeners: ((t: DataTexture) => void)[] = [];

  constructor(rows = 64) {
    this.data = new Float32Array(HOLE_SLOTS * 2 * 4 * rows);
    this.texture = this.make(rows);
  }

  /** The row of structure `id`, made on first ask */
  rowOf(id: string): number {
    let row = this.rowById.get(id);
    if (row === undefined) {
      row = this.rowById.size;
      if (row >= this.rows) this.grow(this.rows * 2);
      this.rowById.set(id, row);
    }
    return row;
  }

  /**
   * Structure `id`'s holes anew: per hole (x, y, z, radius, opened, rim),
   * group frame and the damage clock; a radius of 0 for a slot without
   */
  set(id: string, holes: readonly (readonly [number, number, number, number, number, number])[]): void {
    const row = this.rowOf(id);
    const at = row * HOLE_SLOTS * 8;
    this.data.fill(0, at, at + HOLE_SLOTS * 8);
    holes.forEach((h, k) => {
      if (k >= HOLE_SLOTS) return;
      this.data.set([h[0], h[1], h[2], h[3], h[4], h[5], 0, 0], at + k * 8);
    });
    this.texture.needsUpdate = true;
  }

  /** Every row forgotten (a new map, the view gone) */
  clear(): void {
    this.rowById.clear();
    this.data.fill(0);
    this.texture.needsUpdate = true;
  }

  /** Hears the texture change when it grows */
  onTexture(listener: (t: DataTexture) => void): void {
    this.listeners.push(listener);
  }

  private grow(rows: number): void {
    const old = this.data;
    this.data = new Float32Array(HOLE_SLOTS * 2 * 4 * rows);
    this.data.set(old);
    this.texture.dispose();
    this.texture = this.make(rows);
    for (const listener of this.listeners) listener(this.texture);
  }

  private make(rows: number): DataTexture {
    this.rows = rows;
    const t = new DataTexture(this.data, HOLE_SLOTS * 2, rows, RGBAFormat, FloatType);
    t.magFilter = NearestFilter;
    t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }
}
