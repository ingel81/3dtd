/**
 * The packet's tables in memory both threads see (docs/SIM_WORKER.md).
 *
 * The simulation writes its rows straight into a SharedArrayBuffer; the main
 * thread reads them in place when it applies the packet. There are three
 * sets of buffers: the simulation writes one, one holds the newest packet it
 * published, and the main thread may read a third, older one meanwhile. A
 * control word in shared memory (Atomics) says which packet each set holds,
 * which set is the newest and which one the main thread reads; the
 * simulation never writes the newest nor the one being read, so no lock is
 * needed and a frame costs no copy and no allocation.
 *
 * The main thread claims a set before it reads it (TableViews.claim) and lets
 * it go after (release). The claim holds only while the set still holds the
 * packet whose message the main thread has: a set the simulation writes
 * again is refused, and the main thread waits for the next packet. The
 * simulation writes the set of the packet before the newest last, so a
 * message one packet behind still finds its tables.
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

/** Sets of tables in shared memory, see the head of this file */
export const SHARED_SETS = 3;

// The control word: an Int32Array of CONTROL_LENGTH over a SharedArrayBuffer
/** The set of the newest published packet, NO_SET before the first */
const C_LATEST = 0;
/** The set the main thread reads now, NO_SET while it reads none */
const C_READING = 1;
/** From here one per set: the packet (SimFramePacket.frame) it holds, WRITING while the simulation writes it */
const C_FRAME_OF = 2;
const CONTROL_LENGTH = C_FRAME_OF + SHARED_SETS;
const NO_SET = -1;
const WRITING = -1;

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
  /** Per set, the tables: SHARED_SETS in shared memory, one where every frame carries copies */
  private readonly sets: Map<TableName, SimTable>[];
  private current = 0;
  private replaced: TableBuffer[] = [];
  /** The control word (see the head of this file), null without shared memory */
  private readonly control: Int32Array | null = null;
  /** The control word's buffer until it went to the main thread (takeControl) */
  private controlToSend: SharedArrayBuffer | null = null;
  /** The set published before the newest one: written last, see begin() */
  private previous = NO_SET;

  constructor(readonly shared: boolean = sharedMemoryAvailable()) {
    this.sets = Array.from({ length: shared ? SHARED_SETS : 1 }, () => new Map<TableName, SimTable>());
    for (let set = 0; set < this.sets.length; set++) {
      this.current = set;
      for (const name of TABLE_NAMES) this.allocate(name, INITIAL_ROWS[name]);
    }
    this.current = 0;
    if (shared) {
      const buffer = new SharedArrayBuffer(CONTROL_LENGTH * Int32Array.BYTES_PER_ELEMENT);
      this.control = new Int32Array(buffer);
      this.control.fill(WRITING);
      this.control[C_LATEST] = NO_SET;
      this.control[C_READING] = NO_SET;
      this.controlToSend = buffer;
    }
  }

  /** The set the packet being written goes into */
  get set(): number {
    return this.current;
  }

  /**
   * A new packet begins: it goes into a set that is neither the newest
   * published nor the one the main thread reads, the one published before
   * the newest last. A set is marked WRITING before the reader is looked at,
   * and the reader marks before it looks (TableViews.claim): of a claim and a
   * write that meet, at least one sees the other.
   */
  begin(): void {
    const control = this.control;
    if (!control) return;
    const latest = Atomics.load(control, C_LATEST);
    for (;;) {
      for (let set = 0; set < SHARED_SETS; set++) {
        if (set !== latest && set !== this.previous && this.take(control, set)) return;
      }
      if (this.previous !== NO_SET && this.previous !== latest && this.take(control, this.previous)) return;
    }
  }

  /** `set` is marked for writing, unless the main thread reads it */
  private take(control: Int32Array, set: number): boolean {
    const held = Atomics.exchange(control, C_FRAME_OF + set, WRITING);
    if (Atomics.load(control, C_READING) !== set) {
      this.current = set;
      return true;
    }
    Atomics.store(control, C_FRAME_OF + set, held);
    return false;
  }

  /** The packet `frame` is written into the current set, which holds the newest one from now. */
  publish(frame: number): void {
    const control = this.control;
    if (!control) return;
    Atomics.store(control, C_FRAME_OF + this.current, frame);
    this.previous = Atomics.exchange(control, C_LATEST, this.current);
  }

  /** The control word's buffer the first time, for the main thread's TableViews; null after and without shared memory */
  takeControl(): SharedArrayBuffer | null {
    const out = this.controlToSend;
    this.controlToSend = null;
    return out;
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

/** The main thread's side: views of the simulation's buffers, per set, and its claim on one of them. */
export class TableViews {
  private readonly views: Map<TableName, Float64Array>[] = Array.from({ length: SHARED_SETS }, () => new Map());
  private control: Int32Array | null = null;

  adopt(buffers: readonly TableBuffer[], control: SharedArrayBuffer | null = null): void {
    for (const { name, set, buffer } of buffers) this.views[set].set(name, new Float64Array(buffer));
    if (control) this.control = new Int32Array(control);
  }

  table(name: TableName, count: number, set = 0): SimTable {
    const data = this.views[set].get(name);
    if (!data) throw new Error(`TableViews: no buffer for ${name} in set ${set}`);
    return { data, count };
  }

  /**
   * Read `set` as the tables of the packet `frame` until release(): false when
   * the set holds that packet no more (the simulation writes it again).
   * Always true without shared memory, where every frame has copies of its own.
   */
  claim(set: number, frame: number): boolean {
    const control = this.control;
    if (!control) return true;
    Atomics.store(control, C_READING, set);
    if (Atomics.load(control, C_FRAME_OF + set) === frame) return true;
    Atomics.store(control, C_READING, NO_SET);
    return false;
  }

  /** The set claimed is read: the simulation may write it again. */
  release(): void {
    if (this.control) Atomics.store(this.control, C_READING, NO_SET);
  }
}
