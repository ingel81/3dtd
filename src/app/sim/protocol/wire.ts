/**
 * A packet on its way from the worker (docs/SIM_WORKER.md): the tables stay
 * in the TableStore's memory, the message carries the rest and the row
 * counts. With SharedArrayBuffer only buffers new since the last frame travel
 * (once, then the main thread views them in place); without it every frame
 * carries a copy of the rows it filled.
 */
import type { SimFramePacket, SimTable } from './packet';
import { TABLE_NAMES, TABLE_STRIDES, TableStore, TableViews, type TableBuffer, type TableName } from './table-store';

export type WirePacket = Omit<SimFramePacket, TableName> & {
  counts: Record<TableName, number>;
  /** The store's set the tables were written into (TableStore.set) */
  set: number;
};

export interface WireFrame {
  packet: WirePacket;
  /** New table buffers (shared memory), or this frame's rows (no shared memory) */
  buffers: TableBuffer[];
  /** The tables are in shared memory, in two sets used in turn (TableStore) */
  shared: boolean;
}

/** The worker's side: the packet's tables are the store's own (the writer wrote into store.table()). */
export function toWire(packet: SimFramePacket, store: TableStore): { frame: WireFrame; transfer: ArrayBuffer[] } {
  const counts = {} as Record<TableName, number>;
  const { enemies: _e, projectiles: _p, towers: _t, oozes: _o, worms: _w, ...rest } = packet;
  for (const name of TABLE_NAMES) counts[name] = packet[name].count;
  if (store.shared) {
    return { frame: { packet: { ...rest, counts, set: store.set }, buffers: store.takeReplaced(), shared: true }, transfer: [] };
  }
  store.takeReplaced();
  const buffers: TableBuffer[] = [];
  const transfer: ArrayBuffer[] = [];
  for (const name of TABLE_NAMES) {
    const rows = packet[name];
    const copy = rows.data.slice(0, rows.count * TABLE_STRIDES[name]);
    buffers.push({ name, set: 0, buffer: copy.buffer as ArrayBuffer });
    transfer.push(copy.buffer as ArrayBuffer);
  }
  return { frame: { packet: { ...rest, counts, set: 0 }, buffers, shared: false }, transfer };
}

/** The main thread's side: the packet with its tables viewed in place. */
export function fromWire(frame: WireFrame, views: TableViews): SimFramePacket {
  views.adopt(frame.buffers);
  const { counts, set, ...rest } = frame.packet;
  const tables = {} as Record<TableName, SimTable>;
  for (const name of TABLE_NAMES) tables[name] = views.table(name, counts[name], set);
  return { ...rest, ...tables } as SimFramePacket;
}
