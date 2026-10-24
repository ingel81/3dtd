import { describe, expect, it } from 'vitest';
import { CELLAR_FOOTING, CELLAR_PLINTH_SHARE, CELLAR_STOREY, cellarDepth, cellarForDrop, cellarFrame, cellarOf, cellarPlinthDown, DEFAULT_CELLAR, isMapCellar, takesCellar } from './object-cellar';

describe('object-cellar: a building\'s cellar', () => {
  it('gives a building the default cellar where its map has none, nothing to anything else or with mode none', () => {
    expect(cellarOf({}, true)).toEqual(DEFAULT_CELLAR);
    expect(cellarOf({ cellar: { mode: 'buried', storeys: 2 } }, true)).toEqual({ mode: 'buried', storeys: 2 });
    expect(cellarOf({ cellar: { mode: 'none', storeys: 1 } }, true)).toBeNull();
    expect(cellarOf({ cellar: { mode: 'auto', storeys: 2 } }, false)).toBeNull();
  });

  it('lets a building on the ground have one, not a floating one (a ship) or anything else', () => {
    expect(takesCellar({ category: 'building' })).toBe(true);
    expect(takesCellar({ category: 'building', float: true })).toBe(false);
    expect(takesCellar({ category: 'prop' })).toBe(false);
    expect(takesCellar(undefined)).toBe(false);
  });

  it('reaches its storeys and the footing down from the floor, its depth from its storeys alone', () => {
    expect(cellarDepth(null)).toBe(0);
    expect(cellarDepth({ mode: 'auto', storeys: 1 })).toBeCloseTo(CELLAR_STOREY + CELLAR_FOOTING);
    expect(cellarDepth({ mode: 'buried', storeys: 3 })).toBeCloseTo(3 * CELLAR_STOREY + CELLAR_FOOTING);
    expect(cellarFrame({ mode: 'auto', storeys: 2 })).toEqual({ cellar: cellarDepth({ mode: 'auto', storeys: 2 }), cellarStoreys: 2 });
    expect(cellarFrame(null)).toEqual({});
  });

  it('opens the cellar of a house on a slope with as many storeys as reach the ground, buries it on level ground', () => {
    expect(cellarForDrop(0)).toEqual({ mode: 'buried', storeys: 1 });
    expect(cellarForDrop(0.5)).toEqual({ mode: 'buried', storeys: 1 });
    expect(cellarForDrop(1.2)).toEqual({ mode: 'auto', storeys: 1 });
    expect(cellarForDrop(3.1)).toEqual({ mode: 'auto', storeys: 1 });
    expect(cellarForDrop(3.2)).toEqual({ mode: 'auto', storeys: 2 });
    expect(cellarForDrop(7.4)).toEqual({ mode: 'auto', storeys: 3 });
    expect(cellarForDrop(20)).toEqual({ mode: 'auto', storeys: 3 });
    // Its foot always under the ground at the lowest point
    for (const drop of [0.6, 2, 3.1, 5.9, 8.7]) expect(cellarDepth(cellarForDrop(drop))).toBeGreaterThanOrEqual(drop - 1e-9);
  });

  it('takes a map\'s cellar only as one this game draws', () => {
    expect(isMapCellar({ mode: 'auto', storeys: 1 })).toBe(true);
    expect(isMapCellar({ mode: 'none', storeys: 3 })).toBe(true);
    for (const v of [null, 2, [], { mode: 'deep', storeys: 1 }, { mode: 'auto', storeys: 0 }, { mode: 'auto', storeys: 4 }, { mode: 'auto', storeys: 1.5 }, { mode: 'auto' }]) {
      expect(isMapCellar(v)).toBe(false);
    }
  });

  it("gives one house in five a cellar in its plinth's surface, the same house always", () => {
    const ids = Array.from({ length: 2000 }, (_, k) => `osm-b${k}`);
    const share = ids.filter(cellarPlinthDown).length / ids.length;
    expect(share).toBeGreaterThan(CELLAR_PLINTH_SHARE - 0.04);
    expect(share).toBeLessThan(CELLAR_PLINTH_SHARE + 0.04);
    expect(ids.map(cellarPlinthDown)).toEqual(ids.map(cellarPlinthDown));
  });
});
