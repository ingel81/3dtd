import { InstancedBufferAttribute } from 'three';

/**
 * The instances one detail level of the map's objects draws: a matrix, a
 * colour (when the asset has any), the dissolve of its band (lod-fade.ts)
 * and attributes of its own per slot, for the whole map in one list that
 * every part mesh of the level shares (object-layer.ts). The casters come
 * first: slots [0, casters) cast a shadow, [casters, count) do not, so the
 * shadow pass draws the first `casters` instances only.
 *
 * Objects come and go by moving one or two instances (the last of their
 * partition fills the gap), never by writing the list anew: a level switch
 * costs a few dozen bytes, not the level. An owner is a slot table (an
 * Int32Array from object index to its slot here, -1 for none) and an index
 * in it; a list of one asset has one table, the far boxes of all buildings
 * (far-boxes.ts) one per asset. What changed since the last upload goes up
 * as one range per attribute, and stays pending until three uploaded it:
 * a hidden mesh renders nothing and uploads nothing, and ranges added each
 * frame for it would pile up unread.
 */
export class InstanceList {
  readonly matrices: InstancedBufferAttribute;
  readonly colors: InstancedBufferAttribute | null;
  readonly fades: InstancedBufferAttribute;
  /** Per-slot attributes beyond those, written with each instance from its source */
  readonly extras: InstancedBufferAttribute[];
  count = 0;
  casters = 0;
  /** The owner of each slot: its slot table and its index there */
  private readonly tables: Int32Array[];
  private readonly owners: Int32Array;
  /** Slots written since the last upload, per attribute set (one range covers them) */
  private lo = Infinity;
  private hi = -1;
  /** The range the last flush handed to three, until its upload */
  private pendingLo = Infinity;
  private pendingHi = -1;

  constructor(
    readonly capacity: number,
    colored: boolean,
    extraSizes: readonly number[] = [],
  ) {
    this.matrices = new InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
    this.colors = colored ? new InstancedBufferAttribute(new Float32Array(capacity * 3), 3) : null;
    this.fades = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.extras = extraSizes.map((size) => new InstancedBufferAttribute(new Float32Array(capacity * size), size));
    this.tables = new Array<Int32Array>(capacity);
    this.owners = new Int32Array(capacity);
    for (const a of this.attributes()) {
      a.setUsage(35048); // DynamicDrawUsage
      a.onUpload(() => this.uploaded());
    }
  }

  /** Every attribute of the list */
  attributes(): InstancedBufferAttribute[] {
    return this.colors ? [this.matrices, this.colors, this.fades, ...this.extras] : [this.matrices, this.fades, ...this.extras];
  }

  /**
   * Object `index` of `table` into the list with its instance from `source`
   * (matrices 16, colours 3, extras per object at `index`), casting or not.
   * The caller made sure it is not in yet and that there is room.
   */
  insert(table: Int32Array, index: number, source: InstanceSource, casting: boolean, fade: number): void {
    let slot = this.count++;
    if (casting) {
      // The first non-caster moves to the end, the new one takes its slot at the casters' end
      if (this.casters < slot) this.move(this.casters, slot);
      slot = this.casters++;
    }
    this.own(slot, table, index);
    this.write(slot, source, index);
    this.fades.array[slot] = fade;
  }

  /** Object `index` of `table` out of the list: the last of its partition fills its slot */
  remove(table: Int32Array, index: number): void {
    const slot = table[index];
    table[index] = -1;
    const last = --this.count;
    if (slot < this.casters) {
      const lastCaster = --this.casters;
      if (slot !== lastCaster) this.move(lastCaster, slot);
      if (lastCaster !== last) this.move(last, lastCaster);
    } else if (slot !== last) {
      this.move(last, slot);
    }
  }

  /** Whether object `index` of `table` casts: it moves over the line between casters and the rest */
  setCasting(table: Int32Array, index: number, casting: boolean): void {
    const slot = table[index];
    if (slot < this.casters === casting) return;
    if (casting) {
      // Swapped with the first non-caster, which the line then passes
      this.swap(slot, this.casters);
      this.casters++;
    } else {
      this.swap(slot, this.casters - 1);
      this.casters--;
    }
  }

  /** The dissolve of object `index` of `table` (lod-fade.ts) */
  setFade(table: Int32Array, index: number, fade: number): void {
    const slot = table[index];
    if (this.fades.array[slot] === fade) return;
    this.fades.array[slot] = fade;
    this.mark(slot);
  }

  /** Object `index` of `table` writes its instance anew from `source` (it moved, turned, was reseated) */
  rewrite(table: Int32Array, index: number, source: InstanceSource): void {
    this.write(table[index], source, index);
  }

  /**
   * Object `index` of `source` written into the first slot of an empty list,
   * owned by nobody: what a warm-up render draws of a level nothing shows
   */
  placeholder(source: InstanceSource, index: number): void {
    if (this.count) return;
    this.write(0, source, index);
    this.fades.array[0] = 0;
  }

  /** The owner of object `from` of `table` is now its object `to` (the asset moved its last object into a gap) */
  rename(table: Int32Array, from: number, to: number): void {
    const slot = table[from];
    table[from] = -1;
    table[to] = slot;
    this.owners[slot] = to;
  }

  /** The object index in its table of the instance at `slot` */
  ownerAt(slot: number): number {
    return this.owners[slot];
  }

  /** Whether `slot` belongs to `table` */
  ownedBy(slot: number, table: Int32Array): boolean {
    return this.tables[slot] === table;
  }

  /** Hands the slots changed since the last flush to three as one range per attribute */
  flush(): void {
    if (this.hi < 0) return;
    this.pendingLo = Math.min(this.pendingLo, this.lo);
    this.pendingHi = Math.max(this.pendingHi, this.hi);
    this.lo = Infinity;
    this.hi = -1;
    const from = this.pendingLo;
    const n = this.pendingHi - from + 1;
    for (const a of this.attributes()) {
      a.clearUpdateRanges();
      a.addUpdateRange(from * a.itemSize, n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  private uploaded(): void {
    this.pendingLo = Infinity;
    this.pendingHi = -1;
  }

  private own(slot: number, table: Int32Array, index: number): void {
    this.tables[slot] = table;
    this.owners[slot] = index;
    table[index] = slot;
  }

  /** The instance at `from` into slot `to`, its owner with it */
  private move(from: number, to: number): void {
    copy(this.matrices, from, to);
    if (this.colors) copy(this.colors, from, to);
    copy(this.fades, from, to);
    for (const a of this.extras) copy(a, from, to);
    this.own(to, this.tables[from], this.owners[from]);
    this.mark(to);
  }

  private swap(a: number, b: number): void {
    if (a === b) return;
    const table = this.tables[a];
    const owner = this.owners[a];
    for (const attr of this.attributes()) swapItems(attr, a, b);
    this.own(a, this.tables[b], this.owners[b]);
    this.own(b, table, owner);
    this.mark(a);
    this.mark(b);
  }

  private write(slot: number, source: InstanceSource, index: number): void {
    const m = this.matrices.array as Float32Array;
    const at = slot * 16;
    const from = index * 16;
    for (let k = 0; k < 16; k++) m[at + k] = source.matrices[from + k];
    if (this.colors) {
      const c = this.colors.array as Float32Array;
      if (source.colors) for (let k = 0; k < 3; k++) c[slot * 3 + k] = source.colors[index * 3 + k];
      else c[slot * 3] = c[slot * 3 + 1] = c[slot * 3 + 2] = 1;
    }
    for (let e = 0; e < this.extras.length; e++) {
      const attr = this.extras[e];
      const size = attr.itemSize;
      const values = source.extras?.[e];
      // Per object, or one value set for every object of the source (an asset's far box)
      const base = values && values.length > size ? index * size : 0;
      for (let k = 0; k < size; k++) attr.array[slot * size + k] = values ? values[base + k] : 0;
    }
    this.mark(slot);
  }

  private mark(slot: number): void {
    if (slot < this.lo) this.lo = slot;
    if (slot > this.hi) this.hi = slot;
  }
}

/** Where an owner's instances come from: per object 16 matrix values, 3 colour values, each extra's values */
export interface InstanceSource {
  matrices: Float32Array;
  colors: Float32Array | null;
  /** Per extra attribute: its values per object, or one set for all of them */
  extras?: readonly ArrayLike<number>[];
}

function copy(a: InstancedBufferAttribute, from: number, to: number): void {
  const s = a.itemSize;
  const arr = a.array;
  for (let k = 0; k < s; k++) arr[to * s + k] = arr[from * s + k];
}

function swapItems(a: InstancedBufferAttribute, x: number, y: number): void {
  const s = a.itemSize;
  const arr = a.array;
  for (let k = 0; k < s; k++) {
    const t = arr[x * s + k];
    arr[x * s + k] = arr[y * s + k];
    arr[y * s + k] = t;
  }
}
