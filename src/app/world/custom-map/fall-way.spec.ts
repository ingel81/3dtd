import { FALL_TURN, fallWay, TreeGrid, type TreeSpot } from './fall-way';

const tree = (id: string, x: number, y: number): TreeSpot => ({ id, x, y, crown: 2, height: 12 });

describe('fallWay (docs/DESTRUCTION_PLAN.md, "Bäume fallen")', () => {
  it('falls straight away from its blast in the open, turns towards the open past standing trees, at most 60°', () => {
    const felled = tree('f', 0, 0);
    // Away from a blast in the west: east (0 rad)
    expect(fallWay(felled, 0, new TreeGrid([felled]), () => true)).toBe(0);
    // A wood to the east and north-east, open to the south-east: it turns south (towards -y)
    const wood = [felled, tree('a', 6, 0), tree('b', 10, 1), tree('c', 5, 4), tree('d', 8, 6), tree('e', 4, 8)];
    const way = fallWay(felled, 0, new TreeGrid(wood), () => true);
    expect(way).toBeLessThan(0);
    expect(way).toBeGreaterThanOrEqual(-FALL_TURN - 1e-9);
    // Felled ones are no longer in the way; the same answer every time
    expect(fallWay(felled, 0, new TreeGrid(wood), (id) => id === 'f')).toBe(0);
    expect(fallWay(felled, 0, new TreeGrid(wood), () => true)).toBe(way);
    // Walled in all round: no further than 60°
    const ring = [felled, ...Array.from({ length: 16 }, (_, k) => tree(`r${k}`, 6 * Math.cos((k * Math.PI) / 8), 6 * Math.sin((k * Math.PI) / 8)))];
    expect(Math.abs(fallWay(felled, 0, new TreeGrid(ring), () => true))).toBeLessThanOrEqual(FALL_TURN + 1e-9);
  });
});
