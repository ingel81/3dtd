import { CRATERS } from '../../configs/destruction.config';
import { CraterLedger, craterHitDepthCm, craterMaxDepthCm, type CraterDug } from './crater-ledger';

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

  it('grows past any small number, finds the crater of a hit among the near ones, and comes back from its list', () => {
    const ledger = new CraterLedger();
    // 20 000 shells' craters on a grid of 3 m, then a hit beside each tenth: it deepens that one, nothing new
    for (let i = 0; i < 20000; i++) expect(ledger.dig((i % 200) * 30, Math.floor(i / 200) * 30, 15, craterHitDepthCm(15))!.index).toBe(i);
    for (let i = 0; i < 20000; i += 10) expect(ledger.dig((i % 200) * 30 + 15, Math.floor(i / 200) * 30, 15, 5)!.index).toBe(i);
    expect(ledger.size).toBe(20000);
    // Of two craters in reach the first dug wins, as in the list's order
    const two = new CraterLedger();
    two.dig(0, 0, 15, 10);
    two.dig(25, 0, 15, 10);
    expect(two.dig(12, 0, 15, 10)!.index).toBe(0);
    expect(two.dig(-12, 0, 15, 10)!.index).toBe(0);
    expect(two.dig(40, 0, 15, 10)!.index).toBe(1);
    const list = Array.from(ledger.list());
    const back = new CraterLedger();
    back.restore(list);
    expect(Array.from(back.list())).toEqual(list);
    // The index comes back with it: a hit finds the same crater
    expect(back.dig(30 * 7 + 10, 30 * 3, 15, 5)!.index).toBe(3 * 200 + 7);
    back.restore([1, 2, 3.5, 4]);
    expect(back.size).toBe(0);
    back.restore(undefined);
    expect(back.size).toBe(0);
  });

  it('at its guard puts the smallest crater into its nearest neighbour and the new one in its place: nothing is lost', () => {
    const ledger = new CraterLedger();
    // Shells' craters to the guard, every 3 m in rows of 256; crater 1 a little deeper
    for (let i = 0; i < CRATERS.max; i++) ledger.dig((i % 256) * 30, Math.floor(i / 256) * 30, 15, craterHitDepthCm(15));
    ledger.dig(30, 0, 15, 4);
    expect(ledger.size).toBe(CRATERS.max);
    const merged: CraterDug[] = [];
    // A strike far off: crater 0, the first of the smallest, goes into crater 1 (its nearest), the strike in its place
    expect(ledger.dig(5e5, 5e5, 250, 400, (m) => merged.push(m))).toEqual({ index: 0, before: [0, 0, 15, craterHitDepthCm(15)] });
    expect(merged).toEqual([{ index: 1, before: [30, 0, 15, craterHitDepthCm(15) + 4] }]);
    expect(Array.from(ledger.entry(0))).toEqual([5e5, 5e5, 250, 400]);
    expect(Array.from(ledger.entry(1))).toEqual([30, 0, 15, craterHitDepthCm(15) + 4]);
    // A hit on the old place now finds crater 1 (2 m reach) or makes room again; the strike's place deepens
    expect(ledger.dig(5e5, 5e5, 250, 400)).toEqual({ index: 0, before: [5e5, 5e5, 250, 400] });
    expect(ledger.size).toBe(CRATERS.max);
  });
});
