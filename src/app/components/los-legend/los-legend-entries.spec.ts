import { describe, it, expect } from 'vitest';
import { buildLosLegendEntries, losSwatchCss } from './los-legend-entries';
import { LOS_VIZ_CONFIG } from '../../configs/los-viz.config';

const labels = (f: 'both' | 'ground' | 'air', g: boolean, a: boolean) =>
  buildLosLegendEntries(f, g, a).map((e) => e.label);

describe('buildLosLegendEntries', () => {
  it('lists ground, air and blocked for a mixed tower (archer)', () => {
    expect(labels('both', true, true)).toEqual(['Ground', 'Air', 'Blocked']);
  });

  it('gives ground, air and blocked three different swatches', () => {
    const swatches = buildLosLegendEntries('both', true, true).map((e) => e.swatch);
    expect(new Set(swatches).size).toBe(3);
  });

  it('has no air swatch for a pure ground tower', () => {
    expect(labels('both', true, false)).toEqual(['Ground', 'Blocked']);
  });

  it('has no ground swatch for a pure air tower', () => {
    expect(labels('both', false, true)).toEqual(['Air', 'Blocked']);
  });

  it('follows the per-tower filter on a mixed tower', () => {
    expect(labels('ground', true, true)).toEqual(['Ground', 'Blocked']);
    expect(labels('air', true, true)).toEqual(['Air', 'Blocked']);
  });

  it('explains an empty viz instead of showing a blocked swatch', () => {
    const groundFilterOnAirTower = buildLosLegendEntries('ground', false, true);
    expect(groundFilterOnAirTower).toEqual([{ label: 'No ground targeting', swatch: null }]);
    const airFilterOnGroundTower = buildLosLegendEntries('air', true, false);
    expect(airFilterOnGroundTower).toEqual([{ label: 'No air targeting', swatch: null }]);
  });
});

describe('losSwatchCss', () => {
  it('renders the config hex back as sRGB', () => {
    // #5ce6a8 = (92, 230, 168); Alpha auf mindestens 0.6 angehoben
    expect(losSwatchCss(LOS_VIZ_CONFIG.states.ground)).toBe('rgba(92, 230, 168, 0.60)');
    expect(losSwatchCss(LOS_VIZ_CONFIG.states.blocked)).toBe('rgba(213, 94, 0, 0.60)');
  });
});
