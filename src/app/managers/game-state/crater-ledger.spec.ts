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
    // Down to the most its radius allows, then nothing changes
    for (let i = 0; i < 20; i++) ledger.dig(100, 200, 40, 35);
    expect(ledger.entry(0)[3]).toBe(craterMaxDepthCm(40));
    expect(ledger.dig(100, 200, 40, 35)).toBeNull();
    expect(ledger.size).toBe(2);
  });

  it('holds at most CRATERS.max, and comes back from its list; anything else leaves none', () => {
    const ledger = new CraterLedger();
    for (let i = 0; i < CRATERS.max + 10; i++) ledger.dig(i * 100, 0, 15, craterHitDepthCm(15));
    expect(ledger.size).toBe(CRATERS.max);
    expect(ledger.dig(1e6, 0, 15, 20)).toBeNull();
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
