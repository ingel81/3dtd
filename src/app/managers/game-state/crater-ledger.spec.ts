import { CRATERS } from '../../configs/destruction.config';
import { CraterLedger, craterHitDepthCm, craterMaxDepthCm } from './crater-ledger';

describe('CraterLedger (docs/DESTRUCTION_PLAN.md)', () => {
  it('digs a new crater per place and deepens it per hit near its middle, up to what its radius allows', () => {
    const ledger = new CraterLedger();
    expect(ledger.dig(100, 200, 25, 35)).toEqual({ index: 0, before: null });
    // 1.9 m off: the same crater, deeper
    expect(ledger.dig(119, 200, 25, 35)).toEqual({ index: 0, before: [100, 200, 25, 35] });
    expect(Array.from(ledger.list())).toEqual([100, 200, 25, 70]);
    // 2.1 m off: another
    expect(ledger.dig(121, 200, 25, 35)!.index).toBe(1);
    // A wider hit widens the crater it lands in
    ledger.dig(100, 200, 40, 10);
    expect(Array.from(ledger.entry(0))).toEqual([100, 200, 40, 80]);
    // Down to the most its radius allows
    for (let i = 0; i < 3; i++) ledger.dig(100, 200, 40, 35);
    expect(Array.from(ledger.entry(0))).toEqual([100, 200, 40, craterMaxDepthCm(40)]);
    // Then a hit there widens it by a quarter of the hit's radius, and the wider one goes deeper
    expect(ledger.dig(100, 200, 40, 35)).toEqual({ index: 0, before: [100, 200, 40, 160] });
    expect(Array.from(ledger.entry(0))).toEqual([100, 200, 50, 195]);
    // Up to twice the hit's radius as deep as that allows; then nothing changes
    for (let i = 0; i < 20; i++) ledger.dig(100, 200, 40, 35);
    expect(Array.from(ledger.entry(0))).toEqual([100, 200, 80, craterMaxDepthCm(80)]);
    expect(ledger.dig(100, 200, 40, 35)).toBeNull();
    expect(ledger.size).toBe(2);
  });

  it('full, puts a bigger crater in the place of the smallest (the oldest of equals), a smaller one nowhere', () => {
    const ledger = new CraterLedger();
    // The list full of shells' craters (1.5 m), one of them a little deeper
    for (let i = 0; i < CRATERS.max; i++) ledger.dig(i * 100, 0, 15, craterHitDepthCm(15));
    ledger.dig(0, 0, 15, craterHitDepthCm(15));
    expect(ledger.size).toBe(CRATERS.max);
    // Another shell at a new place: none smaller, it keeps only its scorch mark
    expect(ledger.dig(1e6, 0, 15, craterHitDepthCm(15))).toBeNull();
    // A nuclear strike (25 m, 4 m) far off takes the place of the oldest of the smallest, crater 1 (crater 0 is deeper)
    expect(ledger.dig(5e5, 5e5, 250, 400)).toEqual({ index: 1, before: [100, 0, 15, craterHitDepthCm(15)] });
    expect(Array.from(ledger.entry(1))).toEqual([5e5, 5e5, 250, 400]);
    // Beside it another (10 m off): a crater of its own, in the next place
    expect(ledger.dig(5e5 + 100, 5e5, 250, 400)).toEqual({ index: 2, before: [200, 0, 15, craterHitDepthCm(15)] });
    // On it again: deeper, the same place
    expect(ledger.dig(5e5, 5e5, 250, 400)).toEqual({ index: 1, before: [5e5, 5e5, 250, 400] });
    expect(ledger.size).toBe(CRATERS.max);
  });

  it('holds at most CRATERS.max, and comes back from its list; anything else leaves none', () => {
    const ledger = new CraterLedger();
    for (let i = 0; i < CRATERS.max + 10; i++) ledger.dig(i * 100, 0, 15, craterHitDepthCm(15));
    expect(ledger.size).toBe(CRATERS.max);
    expect(ledger.dig(1e6, 0, 15, craterHitDepthCm(15))).toBeNull();
    const list = Array.from(ledger.list());
    const back = new CraterLedger();
    back.restore(list);
    expect(Array.from(back.list())).toEqual(list);
    back.restore([1, 2, 3.5, 4]);
    expect(back.size).toBe(0);
    back.restore(undefined);
    expect(back.size).toBe(0);
  });
});
