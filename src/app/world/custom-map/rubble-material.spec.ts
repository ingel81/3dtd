import { describe, expect, it } from 'vitest';
import type { MapMass } from './map-document';
import { roofRubbleOf } from './rubble-material';

describe('rubble-material: what a roof leaves in the rubble', () => {
  it("reads a catalogue building's covering from its roof textures, none without one", () => {
    expect(roofRubbleOf({}, ['textures/clay_roof_tiles_02_diff_1k.ktx2', 'textures/grey_plaster_02_diff_1k.ktx2'])).toBe('tiles');
    expect(roofRubbleOf({}, ['textures/roof_slates_diff.ktx2'])).toBe('slate');
    expect(roofRubbleOf({}, ['textures/corrugated_roof_metal.ktx2'])).toBe('metal');
    // Slates on a wall are no roof's
    expect(roofRubbleOf({}, ['textures/castle_wall_slates_diff_1k.ktx2'])).toBe('none');
    expect(roofRubbleOf({})).toBe('none');
  });

  it("takes a raised building's covering, tiles on a pitched roof without one, none on a flat roof", () => {
    const mass = (m: Partial<MapMass>) => ({ mass: { rings: [[0, 0, 1, 0, 1, 1]], height: 6, floors: 2, facade: 'plaster', roof: 'gable', ...m } as MapMass });
    expect(roofRubbleOf(mass({}))).toBe('tiles');
    expect(roofRubbleOf(mass({ roofCover: 'slate' }))).toBe('slate');
    expect(roofRubbleOf(mass({ facade: 'metal' }))).toBe('metal');
    expect(roofRubbleOf(mass({ roof: 'flat' }))).toBe('none');
  });
});
