import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAllEnemyTypes } from '../../configs/enemy-types.config';

const template = readFileSync(resolve('src/app/components/debug-window/enemy-debugger.component.html'), 'utf8');

/**
 * A slider of the enemy debugger clamps what it shows to its range, and a
 * drag writes the clamped value back over the type's own. Offset Y reached
 * ±3, while types set their preview up to 7 m up.
 */
describe('Enemy debugger sliders', () => {
  const sliders = [...template.matchAll(
    /<input type="range" min="([-\d.]+)" max="([-\d.]+)"[^>]*\(input\)="onSelectedSliderChange\('(\w+)'/g,
  )].map(([, min, max, key]) => ({ key, min: Number(min), max: Number(max) }));

  it('reaches every value a type sets', () => {
    expect(sliders.map((s) => s.key)).toContain('previewOffsetY');
    for (const { key, min, max } of sliders) {
      for (const type of getAllEnemyTypes()) {
        const value = (type as unknown as Record<string, number | undefined>)[key];
        if (value === undefined) continue;
        expect(value, `${type.id}.${key}`).toBeGreaterThanOrEqual(min);
        expect(value, `${type.id}.${key}`).toBeLessThanOrEqual(max);
      }
    }
  });
});
