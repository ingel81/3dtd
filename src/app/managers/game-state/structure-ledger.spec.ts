import { describe, expect, it, vi } from 'vitest';
import { STRUCTURE_CELL_M, StructureLedger } from './structure-ledger';
import { MAP_METERS_PER_DEGREE as K } from '../../world/custom-map/map-document';
import { HOLE_GROW_DM, HOLE_SLOTS, HOLE_STRIDE, holeRadiusDm, presetHp, structureStage } from '../../configs/destruction.config';
import type { RunStructure } from '../../sim/protocol/run-rules';

function setup(structures: RunStructure[] = [
  // A barn of radius 5 at map (100, 0), a wall of radius 1 at (300, 0)
  { id: 'barn', lat: 0, lon: 100 / K, radius: 5, height: 6, hp: 100 },
  { id: 'wall', lat: 0, lon: 300 / K, radius: 1, height: 2, hp: 1000 },
]) {
  const sink = { structures: { setStages: vi.fn(), stage: vi.fn(), hp: vi.fn(), holes: vi.fn() } };
  const staged = vi.fn();
  const carried = vi.fn((_index: number) => false);
  const ledger = new StructureLedger(sink as never, { staged, carried });
  ledger.load(structures);
  return { sink, staged, carried, ledger };
}

describe('StructureLedger (docs/DESTRUCTION_PLAN.md)', () => {
  it('reaches what lies within the reach plus its radius, in whole HP, through its stages to the fall', () => {
    const { sink, staged, ledger } = setup();
    expect(sink.structures.setStages).toHaveBeenLastCalledWith(new Uint8Array([0, 0]), new Int16Array([-1, -1]), new Int32Array([100, 1000]), expect.any(Int32Array));
    // Just in reach of the barn (100 + 5 + 4), and just out of it
    expect(ledger.hit(108.9, 0, 4, 20)).toBe(0);
    expect(ledger.hpList()).toEqual([80, 1000]);
    ledger.hit(109.1, 0, 4, 20);
    expect(ledger.hpList()).toEqual([80, 1000]);
    // 75 % and below: battered, one op of two numbers
    expect(ledger.hit(100, 0, 0, 5)).toBe(1);
    // A hit on its middle pushes no way: no heading
    expect(sink.structures.stage).toHaveBeenLastCalledWith(0, 1, -1);
    expect(staged).toHaveBeenLastCalledWith(0, 0, 1);
    // Within a stage no op
    ledger.hit(100, 0, 0, 10);
    expect(sink.structures.stage).toHaveBeenCalledTimes(1);
    // 40 % and below: heavily damaged; 0: fallen, once
    ledger.hit(100, 0, 0, 30);
    expect(staged).toHaveBeenLastCalledWith(0, 1, 2);
    ledger.hit(100, 0, 0, 1000);
    expect(staged).toHaveBeenLastCalledWith(0, 2, 3);
    expect(ledger.hpList()).toEqual([0, 1000]);
    expect(ledger.hit(100, 0, 10, 1000)).toBe(0);
    expect(staged).toHaveBeenCalledTimes(3);
    // The stage sets went out with load only: the rest were deltas
    expect(sink.structures.setStages).toHaveBeenCalledTimes(1);
  });

  it('sends the HP that changed once per flush, as pairs of index and HP, and none after the whole set', () => {
    const { sink, ledger } = setup();
    ledger.flushHp();
    expect(sink.structures.hp).not.toHaveBeenCalled();
    // The barn twice, the wall once: each once, in the order they changed, with their HP at the flush
    ledger.hit(100, 0, 0, 10);
    ledger.hit(300, 0, 0, 7);
    ledger.hit(100, 0, 0, 10);
    ledger.flushHp();
    expect(sink.structures.hp).toHaveBeenCalledTimes(1);
    expect(sink.structures.hp).toHaveBeenLastCalledWith(new Int32Array([0, 80, 1, 993]));
    ledger.flushHp();
    expect(sink.structures.hp).toHaveBeenCalledTimes(1);
    // The whole set carries the HP: what changed before it goes with it
    ledger.hit(100, 0, 0, 5);
    ledger.restore(ledger.hpList());
    ledger.flushHp();
    expect(sink.structures.hp).toHaveBeenCalledTimes(1);
    expect(sink.structures.setStages).toHaveBeenLastCalledWith(new Uint8Array([1, 0]), new Int16Array([-1, -1]), new Int32Array([75, 993]), expect.any(Int32Array));
  });

  it("sets a structure's stage for the destruction tool: worse by a hit from the point, better mended (E261)", () => {
    const { sink, staged, carried, ledger } = setup();
    // Heavy from the west: the HP in the middle of the stage, a hit's stage op and heading
    expect(ledger.setStage(0, 2, 95, 0)).toBe(false);
    expect(ledger.hpList()[0]).toBe(presetHp(100, 2));
    expect(sink.structures.stage).toHaveBeenLastCalledWith(0, 2, 0);
    expect(staged).toHaveBeenLastCalledWith(0, 0, 2);
    // Fell now: the fall as a hit brings it
    ledger.setStage(0, 3, 95, 0);
    expect(staged).toHaveBeenLastCalledWith(0, 2, 3);
    expect(ledger.stages()[0]).toBe(3);
    // Mended to full: its stage from the HP, its heading forgotten, no op of a hit (the owner publishes)
    expect(ledger.setStage(0, 0, 95, 0)).toBe(true);
    expect([ledger.hpList()[0], ledger.stages()[0], ledger.headingList()]).toEqual([100, 0, undefined]);
    expect(staged).toHaveBeenCalledTimes(2);
    // The same stage again: nothing; a tower on its roof holds it as against a hit
    expect(ledger.setStage(0, 0, 95, 0)).toBe(false);
    carried.mockReturnValue(true);
    ledger.load([{ id: 'hall', lat: 0, lon: 100 / K, radius: 5, height: 6, hp: 100, roof: true }]);
    ledger.setStage(0, 3, 95, 0);
    expect(ledger.hpList()).toEqual([100]);
    // Out of the list: nothing
    expect(ledger.setStage(5, 3, 0, 0)).toBe(false);
    // A new load starts with the whole set: nothing left to flush
    ledger.flushHp();
    expect(sink.structures.hp).not.toHaveBeenCalled();
  });

  it('fells what stands in reach, but a structure that carries a tower on its roof', () => {
    const roofed: RunStructure = { id: 'hall', lat: 0, lon: 120 / K, radius: 6, height: 9, hp: 500, roof: true, box: [120, 0, 4, 3, 0] };
    const { carried, ledger } = setup([
      { id: 'barn', lat: 0, lon: 100 / K, radius: 5, height: 6, hp: 100 },
      roofed,
    ]);
    carried.mockImplementation((i: number) => i === 1);
    expect(ledger.fell(110, 0, 25)).toBe(1);
    expect(ledger.hpList()).toEqual([0, 500]);
    // The towers are asked about the roofed one only, as it is hit
    expect(carried).toHaveBeenCalledWith(1);
    expect(carried).not.toHaveBeenCalledWith(0);
    carried.mockReturnValue(false);
    expect(ledger.fell(110, 0, 25)).toBe(1);
    // Its box: within, a roof; just past its half width, not
    expect(ledger.onRoof(1, 123.9, 2.9)).toBe(true);
    expect(ledger.onRoof(1, 124.1, 0)).toBe(false);
    expect(ledger.onRoof(0, 100, 0)).toBe(false);
  });

  it("takes a raised building's roof from its outline: a courtyard is no roof, and a fallen one is no roof any more", () => {
    // A 20 x 20 m block turned a quarter, a 10 x 10 m courtyard in its middle, its origin at map (100, 50)
    const rings = [[-10, -10, 10, -10, 10, 10, -10, 10], [-5, -5, 5, -5, 5, 5, -5, 5]];
    const block: RunStructure = {
      id: 'block', lat: 50 / K, lon: 100 / K, radius: 10, height: 12, hp: 100, roof: true,
      box: [100, 50, 10, 10, Math.PI / 2], mass: { x: 100, y: 50, turn: Math.PI / 2, scale: 1, rings },
    };
    const { ledger } = setup([block]);
    expect(ledger.onRoof(0, 100 + 7.5, 50)).toBe(true);
    expect(ledger.onRoof(0, 100, 50 - 7.5)).toBe(true);
    expect(ledger.onRoof(0, 100, 50)).toBe(false);
    expect(ledger.onRoof(0, 100 + 2, 50 + 3)).toBe(false);
    expect(ledger.onRoof(0, 100 + 11, 50)).toBe(false);
    // Twice the scale: twice the outline
    const big = setup([{ ...block, box: [100, 50, 20, 20, Math.PI / 2], mass: { ...block.mass!, scale: 2 } }]).ledger;
    expect([big.onRoof(0, 100 + 15, 50), big.onRoof(0, 100 + 9, 50)]).toEqual([true, false]);
    // Standing it has a roof; fallen there is none to stand on
    expect(ledger.fallenRoofAt(107.5, 50)).toBe(false);
    ledger.fell(100, 50, 0);
    expect(ledger.fallenRoofAt(107.5, 50)).toBe(true);
    expect(ledger.fallenRoofAt(100, 50)).toBe(false);
  });

  it('starts a structure the map damaged beforehand at its stage, and goes back there on a new run and from a snapshot without HP', () => {
    const { sink, ledger } = setup([
      { id: 'ruin', lat: 0, lon: 0, radius: 4, height: 6, hp: 200, start: 0 },
      { id: 'crack', lat: 0, lon: 50 / K, radius: 4, height: 6, hp: 200, start: presetHp(200, 1) },
      { id: 'whole', lat: 0, lon: 100 / K, radius: 4, height: 6, hp: 200 },
    ]);
    expect(ledger.hpList()).toEqual([0, 120, 200]);
    expect(sink.structures.setStages).toHaveBeenLastCalledWith(new Uint8Array([3, 1, 0]), new Int16Array([-1, -1, -1]), new Int32Array([0, 120, 200]), expect.any(Int32Array));
    ledger.hit(100, 0, 0, 200);
    ledger.reset();
    expect(ledger.hpList()).toEqual([0, 120, 200]);
    ledger.restore([0, 10, 50]);
    expect(sink.structures.setStages).toHaveBeenLastCalledWith(new Uint8Array([3, 2, 2]), new Int16Array([-1, -1, -1]), new Int32Array([0, 10, 50]), expect.any(Int32Array));
    ledger.restore(undefined);
    expect(ledger.hpList()).toEqual([0, 120, 200]);
    ledger.load(null);
    expect(ledger.size).toBe(0);
    expect(ledger.hit(0, 0, 1000, 1e6)).toBe(0);
  });

  it('finds the structures near a point through its grid, as a scan of all of them does, in their order', () => {
    // A town of 2 000 structures, one of them a long wall over many cells
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const list: RunStructure[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `s${i}`, lat: (rand() * 800 - 400) / K, lon: (rand() * 800 - 400) / K, radius: 2 + rand() * 10, height: 6, hp: 100,
    }));
    list.push({ id: 'wall', lat: 0, lon: 0, radius: 6 * STRUCTURE_CELL_M, height: 3, hp: 100 });
    const { ledger } = setup(list);
    for (let n = 0; n < 200; n++) {
      const x = rand() * 900 - 450;
      const y = rand() * 900 - 450;
      const reach = rand() * 30;
      const scan = list.flatMap((s, i) => {
        const r = reach + s.radius;
        const dx = s.lon * K - x;
        const dy = s.lat * K - y;
        return dx * dx + dy * dy <= r * r ? [i] : [];
      });
      expect([...ledger.near(x, y, reach)]).toEqual(scan);
    }
  });

  it('keeps its stage a function of the HP: 75 and 40 per cent', () => {
    expect([100, 76, 75, 41, 40, 1, 0].map((hp) => structureStage(hp, 100))).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect([0, 1, 2, 3].map((s) => structureStage(presetHp(333, s as 0 | 1 | 2 | 3), 333))).toEqual([0, 1, 2, 3]);
  });

  it('keeps the heading of the hit that brought each stage, in snapshots and the stages, and forgets it on a new run', () => {
    const { sink, ledger } = setup();
    expect(ledger.headingList()).toBeUndefined();
    expect(ledger.headingView().length).toBe(0);
    // From the west of the barn (map x 100): it is pushed east, heading 0 of 256
    ledger.hit(97, 0, 0, 30);
    expect(sink.structures.stage).toHaveBeenLastCalledWith(0, 1, 0);
    // From the north: pushed south, three quarters of a turn; a hit within the stage changes nothing
    ledger.hit(100, 1, 0, 1);
    ledger.hit(100, 3, 0, 40);
    expect(sink.structures.stage).toHaveBeenLastCalledWith(0, 2, 192);
    // A hit on its middle keeps the heading it had
    ledger.hit(100, 0, 0, 1000);
    expect(sink.structures.stage).toHaveBeenLastCalledWith(0, 3, 192);
    expect(ledger.headingList()).toEqual([192, -1]);
    // A snapshot brings them back with the HP, and they go out with the stages
    const hp = ledger.hpList();
    ledger.reset();
    expect(ledger.headingList()).toBeUndefined();
    ledger.restore(hp, [192, -1]);
    expect(sink.structures.setStages).toHaveBeenLastCalledWith(new Uint8Array([3, 0]), new Int16Array([192, -1]), new Int32Array([0, 1000]), expect.any(Int32Array));
    // A snapshot from before the headings knows none
    ledger.restore(hp);
    expect(ledger.headingList()).toBeUndefined();
  });

  it('leaves a hole where a heavy hit struck, grows one hit near it, keeps the last six, none when mended (E259)', () => {
    const { sink, ledger } = setup([{ id: 'block', lat: 0, lon: 100 / K, radius: 10, height: 12, hp: 200000 }]);
    // A light hit (under 25 structure damage) leaves none
    ledger.hit(115, 0, 10, 20);
    ledger.flushHp();
    expect(ledger.holeList()).toBeUndefined();
    expect(sink.structures.holes).not.toHaveBeenCalled();
    // A heavy one (40 %) from 20 m east: on that side, within 90 % of the radius (9 m), 25 to 80 % of the height up
    ledger.hit(120, 0, 15, 80000);
    ledger.flushHp();
    let holes = ledger.holeList()!;
    expect(holes.slice(0, 2)).toEqual([90, 0]);
    expect(holes[2]).toBeGreaterThanOrEqual(30);
    expect(holes[2]).toBeLessThanOrEqual(96);
    expect(holes[3]).toBe(holeRadiusDm(80000, 10));
    expect(holes[4]).toBe(1);
    expect(sink.structures.holes).toHaveBeenLastCalledWith(new Int32Array([0, 0, ...holes.slice(0, 5)]));
    // Again from there: the same hole grows (the height the second hit rolls, 5 m lower, lies within its reach)
    ledger.hit(120, 0, 15, 80000);
    holes = ledger.holeList()!;
    expect(holes[3]).toBe(holeRadiusDm(80000, 10) + HOLE_GROW_DM);
    expect(holes[4]).toBe(2);
    expect(holes.slice(5).every((v) => v === 0)).toBe(true);
    // From six other sides: the sixth slot fills, then the oldest gives way
    for (const [x, y] of [[80, 0], [100, 20], [100, -20], [86, 14], [114, -14], [86, -14]]) ledger.hit(x, y, 15, 6000);
    holes = ledger.holeList()!;
    const orders = Array.from({ length: HOLE_SLOTS }, (_, s) => holes[s * HOLE_STRIDE + 4]);
    expect(orders.every((n) => n > 0)).toBe(true);
    expect(orders).not.toContain(2);
    // The same holes from the same hits on another client
    const twin = setup([{ id: 'block', lat: 0, lon: 100 / K, radius: 10, height: 12, hp: 200000 }]).ledger;
    for (const [x, y] of [[115, 0], [120, 0], [120, 0], [80, 0], [100, 20], [100, -20], [86, 14], [114, -14], [86, -14]]) twin.hit(x, y, 15, x === 115 ? 20 : x === 120 ? 80000 : 6000);
    expect(twin.holeList()).toEqual(holes);
    expect(Array.from(twin.holeView())).toEqual(holes);
    // From a snapshot and back; one from before the holes has none
    ledger.reset();
    expect(ledger.holeList()).toBeUndefined();
    expect(ledger.holeView()).toHaveLength(0);
    ledger.restore(twin.hpList(), undefined, holes);
    expect(ledger.holeList()).toEqual(holes);
    expect(sink.structures.setStages).toHaveBeenLastCalledWith(expect.any(Uint8Array), expect.any(Int16Array), expect.any(Int32Array), new Int32Array(holes));
    ledger.restore(twin.hpList());
    expect(ledger.holeList()).toBeUndefined();
    // Mended: no hole left
    ledger.restore(twin.hpList(), undefined, holes);
    ledger.setStage(0, 0, 100, 0);
    expect(ledger.holeList()).toBeUndefined();
  });

  it('goes on wearing a fallen structure down: holes low in its stump, its HP and stage as they were (E259)', () => {
    const { sink, ledger } = setup([{ id: 'block', lat: 0, lon: 100 / K, radius: 10, height: 12, hp: 1000 }]);
    ledger.hit(100, 0, 0, 1000);
    expect(ledger.stages()[0]).toBe(3);
    const before = ledger.holeList()!;
    const stageCalls = sink.structures.stage.mock.calls.length;
    for (let k = 0; k < 5; k++) ledger.hit(115, 0, 10, 100);
    // Still fallen, no stage op more; five more holes or grown ones, numbered on, each 0.3 to 2 m up
    expect(ledger.hpList()).toEqual([0]);
    expect(sink.structures.stage.mock.calls.length).toBe(stageCalls);
    const holes = ledger.holeList()!;
    expect(holes).not.toEqual(before);
    const fresh = Array.from({ length: HOLE_SLOTS }, (_, s) => holes.slice(s * HOLE_STRIDE, (s + 1) * HOLE_STRIDE)).filter((h) => h[4] > 1);
    expect(Math.max(...fresh.map((h) => h[4]))).toBe(6);
    for (const h of fresh) expect(h[2] >= 3 && h[2] <= 20).toBe(true);
    // A light hit wears nothing
    ledger.hit(115, 0, 10, 10);
    expect(ledger.holeList()).toEqual(holes);
  });

  it('sizes a hole by the damage, larger in a small structure, smaller in a large one; asks for the sight as a ruin loses a wall', () => {
    expect(holeRadiusDm(45, 6)).toBe(27);
    expect(holeRadiusDm(45, 4)).toBe(37);
    expect(holeRadiusDm(45, 12)).toBe(16);
    expect(holeRadiusDm(30, 6)).toBe(24);
    expect(holeRadiusDm(1200, 6)).toBe(50);
    expect(holeRadiusDm(25, 30)).toBe(14);
    // A fallen one: the sight round it anew at its second hole, its sixth, its tenth (every four from two)
    const worn = vi.fn();
    const sink = { structures: { setStages: vi.fn(), stage: vi.fn(), hp: vi.fn(), holes: vi.fn() } };
    const ledger = new StructureLedger(sink as never, { staged: vi.fn(), carried: () => false, worn });
    ledger.load([{ id: 'block', lat: 0, lon: 100 / K, radius: 10, height: 12, hp: 100 }]);
    ledger.hit(100, 0, 0, 100);
    for (let k = 0; k < 9; k++) ledger.hit(100 + (k % 3) * 8, 0, 10, 45);
    expect(worn).toHaveBeenCalledTimes(3);
    expect(worn).toHaveBeenLastCalledWith(0);
  });
});
