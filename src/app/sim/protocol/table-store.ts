/**
 * The packet's tables in memory both threads see (docs/SIM_WORKER.md).
 *
 * The simulation writes its rows straight into a SharedArrayBuffer; the main
 * thread reads them in place when it applies the packet. Only one tick is in
 * flight at a time (SimClient): the simulation writes again only after the
 * main thread asked for the next tick, which it does after it applied the
 * last packet. So one set of buffers needs no locking, and a frame costs no
 * copy and no allocation.
 *
 * A table that needs more rows than it holds is replaced by a bigger one; the
 * new buffer goes to the main thread with the frame that first uses it
 * (TableStore.takeReplaced). Without cross-origin isolation (no
 * SharedArrayBuffer) the same store runs on plain ArrayBuffers, and the
 * transport sends the tables with every frame instead.
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
  buffer: SharedArrayBuffer | ArrayBuffer;
}

/** The simulation's side: tables to write rows into. */
export class TableStore {
  private readonly tables = new Map<TableName, SimTable>();
  private replaced: TableBuffer[] = [];

  constructor(readonly shared: boolean = sharedMemoryAvailable()) {
    for (const name of TABLE_NAMES) this.allocate(name, INITIAL_ROWS[name]);
  }

  private allocate(name: TableName, rows: number): void {
    const bytes = rows * TABLE_STRIDES[name] * Float64Array.BYTES_PER_ELEMENT;
    const buffer = this.shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
    const old = this.tables.get(name);
    const data = new Float64Array(buffer);
    if (old) data.set(old.data.subarray(0, old.count * TABLE_STRIDES[name]));
    this.tables.set(name, { data, count: old?.count ?? 0 });
    this.replaced = this.replaced.filter((r) => r.name !== name);
    this.replaced.push({ name, buffer });
  }

  /** The table, with room for at least `rows` rows (grown by doubling, rows written so far kept). */
  table(name: TableName, rows = 0): SimTable {
    let table = this.tables.get(name)!;
    const capacity = table.data.length / TABLE_STRIDES[name];
    if (rows > capacity) {
      let next = capacity;
      while (next < rows) next *= 2;
      this.allocate(name, next);
      table = this.tables.get(name)!;
    }
    return table;
  }

  /** Every table; `count` as the writer left it. */
  all(): Record<TableName, SimTable> {
    const out = {} as Record<TableName, SimTable>;
    for (const name of TABLE_NAMES) out[name] = this.tables.get(name)!;
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

/** The main thread's side: views of the simulation's buffers. */
export class TableViews {
  private readonly views = new Map<TableName, Float64Array>();

  adopt(buffers: readonly TableBuffer[]): void {
    for (const { name, buffer } of buffers) this.views.set(name, new Float64Array(buffer));
  }

  table(name: TableName, count: number): SimTable {
    const data = this.views.get(name);
    if (!data) throw new Error(`TableViews: no buffer for ${name}`);
    return { data, count };
  }
}
