import { describe, it, expect } from 'vitest';
import { ENEMY_STRIDE, E_LAT, type SimFramePacket } from './packet';
import { TableStore, TableViews } from './table-store';
import { fromWire, toWire } from './wire';

function packetOf(store: TableStore, enemies: number): SimFramePacket {
  const tables = store.all();
  const e = store.table('enemies', enemies);
  for (let i = 0; i < enemies; i++) e.data[i * ENEMY_STRIDE + E_LAT] = i + 0.5;
  e.count = enemies;
  return {
    frame: 1, stepsRun: 1, presented: true, scalars: {} as SimFramePacket['scalars'],
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

  it('sends a shared buffer once and views it in place after', () => {
    const store = new TableStore(true);
    const first = toWire(packetOf(store, 2), store).frame;
    expect(first.buffers.length).toBe(5);
    const views = new TableViews();
    const packet = fromWire(first, views);
    const second = toWire(packetOf(store, 2), store).frame;
    expect(second.buffers).toEqual([]);
    store.table('enemies').data[E_LAT] = 42;
    expect(fromWire(second, views).enemies.data).toBe(packet.enemies.data);
    expect(packet.enemies.data[E_LAT]).toBe(42);
  });
});
