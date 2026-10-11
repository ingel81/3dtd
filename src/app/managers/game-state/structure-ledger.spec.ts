import { describe, expect, it, vi } from 'vitest';
import { IMPACT_DAMAGE, IMPACT_REACH_M, StructureLedger } from './structure-ledger';
import { MAP_METERS_PER_DEGREE as K } from '../../world/custom-map/map-document';

function setup() {
  const sink = { structures: { setFallen: vi.fn() }, main: { structureFell: vi.fn() } };
  const onFall = vi.fn();
  const ledger = new StructureLedger(sink as never, onFall);
  // A barn of radius 5 at map (100, 0), a wall of radius 1 at (300, 0)
  ledger.load([
    { id: 'barn', lat: 0, lon: 100 / K, radius: 5, height: 6, hp: 2 * IMPACT_DAMAGE },
    { id: 'wall', lat: 0, lon: 300 / K, radius: 1, height: 2, hp: 1000 },
  ]);
  return { sink, onFall, ledger };
}

describe('StructureLedger (TODO E131)', () => {
  it('wears down what an impact reaches, its reach plus the radius, and lets it fall at zero once', () => {
    const { sink, onFall, ledger } = setup();
    expect(sink.structures.setFallen).toHaveBeenLastCalledWith([]);
    // Just in reach of the barn: 5 + IMPACT_REACH_M
    const edge = (100 + 5 + IMPACT_REACH_M - 0.1) / K;
    ledger.impact(0, edge);
    expect(ledger.hpList()).toEqual([IMPACT_DAMAGE, 1000]);
    // Just out of reach: nothing
    ledger.impact(0, (100 + 5 + IMPACT_REACH_M + 0.1) / K);
    expect(ledger.hpList()).toEqual([IMPACT_DAMAGE, 1000]);
    ledger.impact(0, edge);
    expect(ledger.hpList()).toEqual([0, 1000]);
    expect(sink.structures.setFallen).toHaveBeenLastCalledWith(['barn']);
    expect(sink.main.structureFell).toHaveBeenCalledWith(0, 100 / K, 5, 6);
    expect(onFall).toHaveBeenCalledWith(100, 0, 5);
    // Fallen: no second fall
    ledger.impact(0, edge);
    expect(sink.main.structureFell).toHaveBeenCalledTimes(1);
  });

  it('stands everything up on a new run and from a snapshot, and holds nothing for a world without structures', () => {
    const { sink, ledger } = setup();
    ledger.hit(0, 100 / K, 0, 1e6);
    ledger.reset();
    expect(ledger.hpList()).toEqual([2 * IMPACT_DAMAGE, 1000]);
    expect(sink.structures.setFallen).toHaveBeenLastCalledWith([]);
    ledger.restore([0, 500]);
    expect(ledger.hpList()).toEqual([0, 500]);
    expect(sink.structures.setFallen).toHaveBeenLastCalledWith(['barn']);
    // A snapshot from before structures stands them all
    ledger.restore(undefined);
    expect(ledger.hpList()).toEqual([2 * IMPACT_DAMAGE, 1000]);
    ledger.load(null);
    expect(ledger.size).toBe(0);
    expect(ledger.hit(0, 0, 1000, 1e6)).toEqual([]);
  });
});
