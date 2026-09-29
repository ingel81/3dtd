/**
 * The packet's tables in memory both threads see (docs/SIM_WORKER.md).
 *
 * The simulation writes its rows straight into a SharedArrayBuffer; the main
 * thread reads them in place when it applies the packet. There are two sets
 * of buffers, used in turn packet by packet: while the main thread still
 * reads one packet's set, the simulation already writes the next packet into
 * the other. SimClient sends a tick only when the set it will write is free
 * (the packet two ticks back is applied), so no locking is needed, and a
 * frame costs no copy and no allocation.
 *
 * A table that needs more rows than it holds is replaced by a bigger one; the
 * new buffer goes to the main thread with the frame that first uses it
 * (TableStore.takeReplaced). Without cross-origin isolation (no
 * SharedArrayBuffer) the same store runs on one set of plain ArrayBuffers,
 * and the transport sends the tables with every frame instead.
 */
import {
  ENEMY_STRIDE, OOZE_STRIDE, PROJECTILE_STRIDE, TOWER_STRIDE, WORM_STRIDE, type SimTable,
} from './packet';

export type TableName = 'enemies' | 'projectiles' | 'towers' | 'oozes' | 'worms';

export const TABLE_STRIDES: Readonly<Record<TableName, number>> = {
  enemies: ENEMY_STRIDE,
  projectiles: PROJECTILE_STRIDE,
  towers: TOWER_STRIDE,
  oozes: OOZE_STRIDE,
  worms: WORM_STRIDE,
};

export const TABLE_NAMES = Object.keys(TABLE_STRIDES) as TableName[];

/** Rows a table starts with; it grows by doubling. */
const INITIAL_ROWS: Readonly<Record<TableName, number>> = {
  enemies: 2048,
  projectiles: 1024,
  towers: 256,
  oozes: 16,
  worms: 64,
};

/** SharedArrayBuffer where the page is cross-origin isolated, else ArrayBuffer. */
export function sharedMemoryAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined'
    && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

/** A replaced table's new buffer, for the main thread to view instead of the old one. */
export interface TableBuffer {
  name: TableName;
  /** The store's set it belongs to (TableStore.set) */
  set: number;
  buffer: SharedArrayBuffer | ArrayBuffer;
}

/** The simulation's side: tables to write rows into. */
export class TableStore {
  /** Per set, the tables: two sets in shared memory, one where every frame carries copies */
  private readonly sets: Map<TableName, SimTable>[];
  private current = 0;
  private replaced: TableBuffer[] = [];

  constructor(readonly shared: boolean = sharedMemoryAvailable()) {
    this.sets = Array.from({ length: shared ? 2 : 1 }, () => new Map<TableName, SimTable>());
    for (let set = 0; set < this.sets.length; set++) {
      this.current = set;
      for (const name of TABLE_NAMES) this.allocate(name, INITIAL_ROWS[name]);
    }
    this.current = 0;
  }

  /** The set the packet being written goes into */
  get set(): number {
    return this.current;
  }

  /** A new packet begins: it goes into the other set, the main thread may still read the last one. */
  begin(): void {
    this.current = (this.current + 1) % this.sets.length;
  }

  private allocate(name: TableName, rows: number): void {
    const bytes = rows * TABLE_STRIDES[name] * Float64Array.BYTES_PER_ELEMENT;
    const buffer = this.shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
    const tables = this.sets[this.current];
    const old = tables.get(name);
    const data = new Float64Array(buffer);
    if (old) data.set(old.data.subarray(0, old.count * TABLE_STRIDES[name]));
    tables.set(name, { data, count: old?.count ?? 0 });
    const set = this.current;
    this.replaced = this.replaced.filter((r) => r.name !== name || r.set !== set);
    this.replaced.push({ name, set, buffer });
  }

  /** The table in the current set, with room for at least `rows` rows (grown by doubling, rows written so far kept). */
  table(name: TableName, rows = 0): SimTable {
    const tables = this.sets[this.current];
    let table = tables.get(name)!;
    const capacity = table.data.length / TABLE_STRIDES[name];
    if (rows > capacity) {
      let next = capacity;
      while (next < rows) next *= 2;
      this.allocate(name, next);
      table = tables.get(name)!;
    }
    return table;
  }

  /** Every table of the current set; `count` as the writer left it. */
  all(): Record<TableName, SimTable> {
    const tables = this.sets[this.current];
    const out = {} as Record<TableName, SimTable>;
    for (const name of TABLE_NAMES) out[name] = tables.get(name)!;
    return out;
  }

  /**
   * Buffers allocated since the last call (all of them the first time): the
   * transport sends them with the frame so the main thread views the new ones.
   */
  takeReplaced(): TableBuffer[] {
    const out = this.replaced;
    this.replaced = [];
    return out;
  }
}

/** The main thread's side: views of the simulation's buffers, per set. */
export class TableViews {
  private readonly views: Map<TableName, Float64Array>[] = [new Map(), new Map()];

  adopt(buffers: readonly TableBuffer[]): void {
    for (const { name, set, buffer } of buffers) this.views[set].set(name, new Float64Array(buffer));
  }

  table(name: TableName, count: number, set = 0): SimTable {
    const data = this.views[set].get(name);
    if (!data) throw new Error(`TableViews: no buffer for ${name} in set ${set}`);
    return { data, count };
  }
}
