import { boxTarget, CraterObliteration, FELL_CM, OBLITERATE_CM, roundTarget } from './crater-obliteration';

/** A crater as craterCmAt gives it: `depth` cm at (cx, cy), falling to 0 at radius `r` */
const pit = (cx: number, cy: number, r: number, depth: number) => (x: number, y: number) => {
  const d = Math.hypot(x - cx, y - cy);
  return d >= r ? 0 : -depth * (1 - d / r);
};

describe('CraterObliteration (docs/DESTRUCTION_PLAN.md)', () => {
  it('wipes out what stands deep in a crater, a structure once it fell, and nothing at a rim', () => {
    const o = new CraterObliteration();
    o.setTargets([
      roundTarget('tree', false, 0, 0, 4),
      roundTarget('lamp', false, 18, 0, 0.5),
      boxTarget('house', true, [5, 5, 4, 3, 0.3]),
      // Its corner reaches the deep middle, its own middle lies at the rim
      boxTarget('hall', true, [14, 0, 10, 2, 0]),
    ]);
    const crater = pit(0, 0, 25, 400);
    let fallen = new Set<string>();
    const first = o.update(null, crater, (id) => fallen.has(id));
    // The tree in the middle goes, the lamp 18 m out (112 cm deep) stays; the standing house and hall stay
    expect(first).toEqual({ gone: ['tree'], back: [], felled: [], rose: [] });
    expect(crater(18, 0)).toBeGreaterThan(-OBLITERATE_CM);
    // Fallen: both go, the hall by its corner 4 m from the middle
    fallen = new Set(['house', 'hall']);
    expect(o.updateOne('house', crater, (id) => fallen.has(id))).toEqual({ gone: ['house'], back: [], felled: [], rose: [] });
    expect(o.update({ minX: 3, minY: -3, maxX: 30, maxY: 3 }, crater, (id) => fallen.has(id))).toEqual({ gone: ['hall'], back: [], felled: [], rose: [] });
    expect(o.goneIds().sort()).toEqual(['hall', 'house', 'tree']);
    // The crater out again (a restore to before it): all back; nothing outside the rectangle looked at
    const none = () => 0;
    expect(o.update({ minX: 100, minY: 100, maxX: 110, maxY: 110 }, none, () => true)).toEqual({ gone: [], back: [], felled: [], rose: [] });
    expect(o.update(null, none, () => true).back.sort()).toEqual(['hall', 'house', 'tree']);
  });

  it('gives back what is no longer a target', () => {
    const o = new CraterObliteration();
    o.setTargets([roundTarget('bench', false, 0, 0, 1)]);
    o.update(null, pit(0, 0, 10, 300), () => false);
    expect(o.isGone('bench')).toBe(true);
    expect(o.setTargets([]).back).toEqual(['bench']);
    expect(o.goneIds()).toEqual([]);
  });

  it('fells a tree a shallow crater reaches, lies it till a deep one wipes it out, and stands it again without one', () => {
    const o = new CraterObliteration();
    o.setTargets([roundTarget('oak', false, 3, 0, 4, true), roundTarget('bench', false, 3, 0, 1), roundTarget('far', false, 30, 0, 4, true)]);
    // 20 cm under its trunk: felled; the bench stays, as does the tree beyond the crater
    const shallow = pit(0, 0, 6, 40);
    expect(shallow(3, 0)).toBeLessThan(-FELL_CM);
    expect(o.update(null, shallow, () => false)).toEqual({ gone: [], back: [], felled: ['oak'], rose: [] });
    expect(o.felledIds()).toEqual(['oak']);
    // Deep: gone, no longer lying
    expect(o.update(null, pit(0, 0, 10, 400), () => false)).toEqual({ gone: ['oak', 'bench'], back: [], felled: [], rose: ['oak'] });
    expect(o.felledIds()).toEqual([]);
    // Back to the shallow one (a restore): lying again; none: standing
    expect(o.update(null, shallow, () => false)).toEqual({ gone: [], back: ['oak', 'bench'], felled: ['oak'], rose: [] });
    expect(o.update(null, () => 0, () => false)).toEqual({ gone: [], back: [], felled: [], rose: ['oak'] });
  });
});
