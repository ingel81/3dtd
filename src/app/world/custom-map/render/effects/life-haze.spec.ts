import { describe, expect, it } from 'vitest';
import { HeightField } from '../height-field';
import { hazeGeometry, LifeHaze } from './life-haze';
import { SceneCopy } from '../water/scene-copy';

const field = new HeightField({ columns: 3, rows: 3, cellSize: 100, heights: new Float32Array(9).fill(2) }, 200, 200);

describe('LifeHaze', () => {
  it('drapes a sheet over the outline 0.6 m up, faded towards its rim', () => {
    const g = hazeGeometry({ id: 'h', kind: 'haze', shape: 'area', points: [{ x: -40, y: -40 }, { x: 40, y: -40 }, { x: 40, y: 40 }, { x: -40, y: 40 }] }, field)!;
    const pos = g.getAttribute('position');
    const depth = g.getAttribute('aDepth');
    expect(pos.getY(0)).toBeCloseTo(2.6, 5);
    let full = 0;
    for (let k = 0; k < depth.count; k++) if (depth.getX(k) === 1) full++;
    expect(full).toBeGreaterThan(100);
    // The rim's samples fade out
    expect(depth.getX(0)).toBe(0);
    // Along a line: a band
    const band = hazeGeometry({ id: 'r', kind: 'haze', shape: 'route', points: [{ x: -50, y: 0 }, { x: 50, y: 0 }] }, field)!;
    expect(band.getIndex()!.count).toBeGreaterThan(0);
  });

  it('shows only with the frame copy (the lava glow effect)', () => {
    const haze = new LifeHaze(field);
    const area = { id: 'h', kind: 'haze' as const, shape: 'area' as const, points: [{ x: -40, y: -40 }, { x: 40, y: -40 }, { x: 0, y: 40 }] };
    haze.set([area], null);
    expect(haze.group.children).toHaveLength(0);
    const copy = new SceneCopy();
    haze.set([area, { ...area, id: 'x', kind: 'fog' as const }], copy);
    expect(haze.group.children).toHaveLength(1);
    haze.dispose();
    copy.dispose();
  });
});
