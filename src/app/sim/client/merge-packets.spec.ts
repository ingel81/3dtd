import { describe, it, expect } from 'vitest';
import { mergePackets } from './merge-packets';
import type { SimFramePacket, TowerStateDto } from '../protocol/packet';
import type { ExportedEvent } from '../protocol/events';

function packet(frame: number, parts: Partial<SimFramePacket> = {}): SimFramePacket {
  return {
    frame, stepsRun: 1, presented: true,
    scalars: { gameTimeMs: frame * 16, tickMs: 2, replay: null } as unknown as SimFramePacket['scalars'],
    enemies: { data: new Float64Array(0), count: frame }, projectiles: { data: new Float64Array(0), count: 0 },
    towers: { data: new Float64Array(0), count: 0 }, oozes: { data: new Float64Array(0), count: 0 },
    worms: { data: new Float64Array(0), count: 0 },
    heroes: [], towerStates: [], removedTowers: [], ops: [], events: [],
    ...parts,
  };
}

const state = (id: string, extra: Partial<TowerStateDto> = {}) => ({ id, ...extra }) as TowerStateDto;
const event = (type: string): ExportedEvent => ({ type, payload: {}, live: true, show: true });

describe('mergePackets', () => {
  it('takes the newest one\'s state and every one\'s stream in order', () => {
    const merged = mergePackets([
      packet(1, { ops: [['a']], events: [event('wave:started')] }),
      packet(2, { stepsRun: 0, presented: false }),
      packet(3, { ops: [['b']], events: [event('enemy:killed')] }),
    ]);
    expect(merged.frame).toBe(3);
    expect(merged.enemies.count).toBe(3);
    expect(merged.scalars.gameTimeMs).toBe(48);
    expect(merged.scalars.tickMs).toBe(6);
    expect(merged.stepsRun).toBe(2);
    expect(merged.ops.map((op) => op[0])).toEqual(['a', 'b']);
    expect(merged.events.map((e) => e.type)).toEqual(['wave:started', 'enemy:killed']);
  });

  it('folds the tower changes as one packet would carry them', () => {
    const mask = { cells: [1] } as unknown as TowerStateDto['losMask'];
    const merged = mergePackets([
      packet(1, { towerStates: [state('tower-1', { losMask: mask }), state('tower-2')] }),
      packet(2, { towerStates: [state('tower-1', { totalInvested: 5 })], removedTowers: ['tower-2', 'tower-3'] }),
      // A restore puts tower-3 back
      packet(3, { towerStates: [state('tower-3')] }),
    ]);
    expect(merged.removedTowers).toEqual(['tower-2', 'tower-3']);
    expect(merged.towerStates.map((s) => s.id)).toEqual(['tower-1', 'tower-3']);
    // The later state without a mask keeps the one sent before
    expect(merged.towerStates[0].totalInvested).toBe(5);
    expect(merged.towerStates[0].losMask).toBe(mask);
    expect('losMask' in merged.towerStates[1]).toBe(false);
  });

  it('shows the newest tables when an earlier packet presented, unless a replay\'s jump runs', () => {
    const quiet = { stepsRun: 0, presented: false };
    expect(mergePackets([packet(1), packet(2, quiet)]).presented).toBe(true);
    const seeking = { replay: { seeking: { target: 9, from: 0 } } } as unknown as SimFramePacket['scalars'];
    expect(mergePackets([packet(1), packet(2, { ...quiet, scalars: seeking })]).presented).toBe(false);
  });

  it('hands a single packet on as it is', () => {
    const one = packet(1);
    expect(mergePackets([one])).toBe(one);
  });
});
