import { ObjectIds, WALL_KITS, simplifyLine, wallAlong, wallKitOf } from './object-ops';

const kit = WALL_KITS[0];
const options = { corners: 'blocks', front: 'left' } as const;

/** The straight pieces' extents along X (a line along X), as [from, to] */
function spans(objects: ReturnType<typeof wallAlong>) {
  return objects
    .map((o) => ({ o, piece: kit.pieces.find((p) => p.asset === o.asset) }))
    .filter((q) => q.piece)
    .map(({ o, piece }) => [o.x - piece!.length / 2, o.x + piece!.length / 2] as const)
    .sort((a, b) => a[0] - b[0]);
}

describe('wall kit', () => {
  it('knows the kit by any of its pieces', () => {
    for (const a of ['castle-wall', 'castle-wall-half', 'castle-wall-corner', 'castle-wall-end']) expect(wallKitOf(a)).toBe(kit);
    expect(wallKitOf('castle-tower')).toBeNull();
    expect(wallKitOf(null)).toBeNull();
  });

  it('fills a straight line with whole pieces between two end blocks, no gaps and no overlap', () => {
    const out = wallAlong([{ x: 0, y: 0 }, { x: 20, y: 0 }], kit, options, new ObjectIds([]));
    expect(out.filter((o) => o.asset === kit.end).map((o) => o.x)).toEqual([0, 20]);
    const s = spans(out);
    expect(s.map(([a, b]) => b - a)).toEqual([8, 8, 2]);
    for (let k = 1; k < s.length; k++) expect(s[k][0]).toBeCloseTo(s[k - 1][1], 6);
    // Both ends inside their blocks
    expect(s[0][0]).toBeGreaterThanOrEqual(0);
    expect(s[0][0]).toBeLessThanOrEqual(kit.reach.end);
    expect(s[s.length - 1][1]).toBeGreaterThanOrEqual(20 - kit.reach.end);
    expect(s[s.length - 1][1]).toBeLessThanOrEqual(20);
    // Along X the pieces turn a quarter from the line's direction: battlements to the left (north) at turn 0
    for (const o of out) expect(o.rotation).toBeCloseTo(0, 3);
    const right = wallAlong([{ x: 0, y: 0 }, { x: 20, y: 0 }], kit, { ...options, front: 'right' }, new ObjectIds([]));
    for (const o of right) expect(o.rotation).toBeCloseTo(Math.PI, 3);
  });

  it('fits every leg length on its 2 m grid inside the blocks', () => {
    for (let length = 4; length <= 60; length += 0.7) {
      const s = spans(wallAlong([{ x: 0, y: 0 }, { x: length, y: 0 }], kit, options, new ObjectIds([])));
      if (!s.length) continue;
      expect(s[0][0]).toBeGreaterThanOrEqual(-1e-6);
      expect(s[0][0]).toBeLessThanOrEqual(kit.reach.end + 1e-6);
      expect(s[s.length - 1][1]).toBeLessThanOrEqual(length + 1e-6);
      expect(s[s.length - 1][1]).toBeGreaterThanOrEqual(length - kit.reach.end - 1e-6);
    }
  });

  it('straightens a drawn line, sets corners at its bends, and closes a ring without ends', () => {
    // A drawn square, 40 m a side, points every 2 m with a little wobble, back to its start
    const line = [];
    const corners = [[0, 0], [40, 0], [40, 40], [0, 40], [0, 0]];
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = corners[k];
      const [bx, by] = corners[k + 1];
      for (let t = 0; t < 20; t++) line.push({ x: ax + ((bx - ax) * t) / 20 + Math.sin(t) * 0.4, y: ay + ((by - ay) * t) / 20 + Math.cos(t) * 0.4 });
    }
    line.push({ x: 1, y: 1 });
    expect(simplifyLine(line, 2).length).toBeLessThan(8);
    const out = wallAlong(line, kit, options, new ObjectIds([]));
    expect(out.filter((o) => o.asset === kit.end)).toHaveLength(0);
    expect(out.filter((o) => o.asset === kit.corner)).toHaveLength(4);
    const towers = wallAlong(line, kit, { ...options, corners: 'towers' }, new ObjectIds([]));
    expect(towers.filter((o) => o.asset === kit.tower)).toHaveLength(4);
    expect(new Set(out.map((o) => o.id)).size).toBe(out.length);
  });
});
