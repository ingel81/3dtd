import { describe, expect, it } from 'vitest';
import { contourRows } from './contour-rows';

/** Degrees of a slope rising `grade` metres a metre */
const degrees = (grade: number) => (Math.atan(grade) * 180) / Math.PI;

describe('contourRows', () => {
  it('lays rows along the contours of a slope, a gap apart across it', () => {
    // Rising 0.2 m a metre to the north: contours run east-west
    const pieces = contourRows((_x, y) => y * 0.2, () => degrees(0.2), { center: { x: 0, y: 0 }, radius: 40 }, { gap: 4, length: 10 });
    expect(pieces.length).toBeGreaterThan(20);
    for (const p of pieces) {
      expect(Math.abs(p.dy)).toBeLessThan(0.05);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(40);
    }
    const rows = [...new Set(pieces.map((p) => Math.round(p.y * 10) / 10))].sort((a, b) => a - b);
    for (let k = 1; k < rows.length; k++) expect(rows[k] - rows[k - 1]).toBeCloseTo(4, 0);
    // Along a row the pieces lie end to end
    const row = pieces.filter((p) => Math.abs(p.y - rows[Math.floor(rows.length / 2)]) < 0.1).map((p) => p.x).sort((a, b) => a - b);
    for (let k = 1; k < row.length; k++) expect(row[k] - row[k - 1]).toBeCloseTo(10, 0);
  });

  it('follows terraces along their edges and leaves the risers out', () => {
    // Terraces 10 m high and 25 m deep, rising north, risers 3 m deep and steep
    const h = (_x: number, y: number) => {
      const step = Math.floor((y + 100) / 25);
      const into = (y + 100) % 25;
      return step * 10 + (into > 22 ? ((into - 22) / 3) * 10 : 0);
    };
    const slope = (_x: number, y: number) => ((y + 100) % 25 > 22 ? 73 : 0);
    const pieces = contourRows(h, slope, [{ x: -50, y: -50 }, { x: 50, y: -50 }, { x: 50, y: 50 }, { x: -50, y: 50 }], { gap: 4, length: 10 });
    expect(pieces.length).toBeGreaterThan(20);
    for (const p of pieces) {
      expect(Math.abs(p.dy)).toBeLessThan(0.1);
      expect((p.y + 100) % 25).toBeLessThanOrEqual(22);
    }
  });

  it('lays none on flat ground', () => {
    expect(contourRows(() => 5, () => 0, { center: { x: 0, y: 0 }, radius: 30 }, { gap: 3, length: 10 })).toEqual([]);
  });
});
