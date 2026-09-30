import { describe, it, expect } from 'vitest';
import { ENEMY_STRIDE, E_LAT, type SimFramePacket } from './packet';
import { TableStore, TableViews } from './table-store';
import { fromWire, toWire } from './wire';

let frames = 0;

/** A packet as PacketWriter writes one: into the store's next set, then published */
function packetOf(store: TableStore, enemies: number): SimFramePacket {
  store.begin();
  const tables = store.all();
  const e = store.table('enemies', enemies);
  for (let i = 0; i < enemies; i++) e.data[i * ENEMY_STRIDE + E_LAT] = i + 0.5;
  e.count = enemies;
  store.publish(++frames);
  return {
    frame: frames, stepsRun: 1, presented: true, scalars: {} as SimFramePacket['scalars'],
    ...tables, enemies: e, heroes: [], towerStates: [], removedTowers: [], ops: [], events: [],
  };
}

describe('Packet tables across the worker boundary', () => {
  for (const shared of [true, false]) {
    it(`reads the rows the simulation wrote (${shared ? 'shared memory' : 'copies'})`, () => {
      const store = new TableStore(shared);
      const views = new TableViews();
      const first = fromWire(toWire(packetOf(store, 3), store).frame, views);
      expect(first.enemies.count).toBe(3);
      expect(first.enemies.data[2 * ENEMY_STRIDE + E_LAT]).toBe(2.5);

      // More rows than the table held: it grows, rows written so far are kept
      const big = fromWire(toWire(packetOf(store, 5000), store).frame, views);
      expect(big.enemies.count).toBe(5000);
      expect(big.enemies.data[4999 * ENEMY_STRIDE + E_LAT]).toBe(4999.5);
      expect(big.towers.count).toBe(0);
    });
  }

  it('sends the shared buffers of every set once and views them in place after, the sets in turn', () => {
    const store = new TableStore(true);
    const first = toWire(packetOf(store, 2), store).frame;
    expect(first.buffers.length).toBe(15);
    expect(first.control).not.toBeNull();
    const views = new TableViews();
    const a = fromWire(first, views);
    const second = toWire(packetOf(store, 2), store).frame;
    expect(second.buffers).toEqual([]);
    expect(second.control).toBeNull();
    // Each packet goes into another set: the main thread may still read an earlier one
    const b = fromWire(second, views);
    const c = fromWire(toWire(packetOf(store, 2), store).frame, views);
    expect(new Set([a.enemies.data, b.enemies.data, c.enemies.data]).size).toBe(3);
    const d = fromWire(toWire(packetOf(store, 2), store).frame, views);
    expect(d.enemies.data).toBe(a.enemies.data);
    store.table('enemies').data[E_LAT] = 42;
    expect(a.enemies.data[E_LAT]).toBe(42);
    expect(b.enemies.data[E_LAT]).not.toBe(42);
  });

  it('never writes the set the main thread claimed, and refuses a claim on a set written again', () => {
    const store = new TableStore(true);
    const views = new TableViews();
    const wires = [1, 2, 3].map(() => toWire(packetOf(store, 1), store).frame);
    const packets = wires.map((wire) => fromWire(wire, views));
    // The oldest packet's set is written next unless it is read
    expect(views.claim(wires[0].packet.set, packets[0].frame)).toBe(true);
    const held = wires[0].packet.set;
    for (let i = 0; i < 6; i++) {
      toWire(packetOf(store, 1), store);
      expect(store.set).not.toBe(held);
    }
    views.release();
    // Released, it is written again: its old packet is gone
    for (let i = 0; i < 3; i++) toWire(packetOf(store, 1), store);
    expect(views.claim(held, packets[0].frame)).toBe(false);
  });

  for (const shared of [true, false]) {
    it(`hands the main thread's demand over once, the first packet asked for from the start (${shared ? 'control word' : 'message'})`, () => {
      const store = new TableStore(shared);
      const views = new TableViews();
      expect(store.takeDemand()).toBe(true);
      expect(store.takeDemand()).toBe(false);
      fromWire(toWire(packetOf(store, 1), store).frame, views);

      // With the control word the main thread writes it itself; without, its message does
      expect(store.demandPending()).toBe(false);
      expect(views.demand()).toBe(shared);
      store.demand();
      expect(store.demandPending()).toBe(true);
      expect(store.takeDemand()).toBe(true);
      expect(store.takeDemand()).toBe(false);
      // The message of a demand the control word brought already asks for no second packet
      if (shared) {
        store.demand();
        expect(store.takeDemand()).toBe(false);
      }
    });
  }

  it('keeps the newest packet and the one before it while the next is written', () => {
    const store = new TableStore(true);
    const views = new TableViews();
    const wires = [1, 2].map(() => toWire(packetOf(store, 1), store).frame);
    const packets = wires.map((wire) => fromWire(wire, views));
    store.begin();
    expect(views.claim(wires[0].packet.set, packets[0].frame)).toBe(true);
    views.release();
    expect(views.claim(wires[1].packet.set, packets[1].frame)).toBe(true);
    views.release();
  });
});
