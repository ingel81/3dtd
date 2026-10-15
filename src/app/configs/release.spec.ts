import { describe, it, expect } from 'vitest';
import {
  isPathReleased,
  isReleased,
  isTowerReleased,
  releasedPathsOf,
  releasedResearch,
  releasedTowerTypes,
  unreleasedInSave,
} from './release';
import { TOWER_TYPES } from './tower-types.config';
import { RESEARCH_TREE } from './research/research-tree.config';

/** Not yet released (user decision 2026-10-15): the new towers of E102 and the new paths of E101 */
const UNRELEASED_TOWERS = ['bastion', 'sentinel', 'chainsaw', 'shawarma'];
const UNRELEASED_PATHS = ['incendiary', 'multirole', 'seal', 'corrode'];

describe('release switch', () => {
  it('shows everything in a dev build', () => {
    expect(releasedTowerTypes(false)).toHaveLength(Object.keys(TOWER_TYPES).length);
    expect(releasedResearch(false)).toHaveLength(Object.keys(RESEARCH_TREE).length);
    for (const id of UNRELEASED_TOWERS) expect(isTowerReleased(id, false), id).toBe(true);
    for (const id of UNRELEASED_PATHS) expect(isPathReleased(id, false), id).toBe(true);
    expect(releasedPathsOf('archer', false).map((p) => p.id)).toEqual(['scout', 'incendiary']);
  });

  it('hides the unreleased towers and paths in a production build, and the research that unlocks them', () => {
    const towers = releasedTowerTypes(true).map((t) => t.id);
    for (const id of UNRELEASED_TOWERS) expect(towers, id).not.toContain(id);
    expect(towers).toContain('archer');
    expect(towers).toContain('chaos');
    for (const id of UNRELEASED_PATHS) expect(isPathReleased(id, true), id).toBe(false);
    expect(releasedPathsOf('archer', true).map((p) => p.id)).toEqual(['scout']);
    expect(releasedPathsOf('rocket', true)).toEqual([]);

    const research = releasedResearch(true).map((r) => r.id);
    for (const id of ['flak-artillery', 'laser-optics', 'cybernetics', 'rotisserie', 'incendiary-arrows', 'multirole-warheads',
      'binding-sigils', 'caustic-compounds']) {
      expect(research, id).not.toContain(id);
    }
    expect(research).toContain('scouting');
    expect(research).toContain('chaos-rift');
  });

  it('leaves no released research waiting for a hidden one', () => {
    const shown = new Set(releasedResearch(true).map((r) => r.id));
    for (const research of releasedResearch(true)) {
      for (const prerequisite of research.prerequisites) expect(shown, `${research.id} needs ${prerequisite}`).toContain(prerequisite);
    }
  });

  it('a config without the field counts as released', () => {
    expect(isReleased({}, true)).toBe(true);
    expect(isReleased({ released: false }, true)).toBe(false);
    expect(isReleased({ released: false }, false)).toBe(true);
  });

  it('names the first unreleased tower or path of a save, in a production build only', () => {
    const towers = [
      { typeId: 'archer', state: { pathId: 'scout' } },
      { typeId: 'magic', state: { pathId: 'seal' } },
      { typeId: 'bastion', state: { pathId: null } },
    ];
    expect(unreleasedInSave(towers, true)).toBe('Binding Sigil');
    expect(unreleasedInSave(towers.slice(2), true)).toBe('Iron Bastion');
    expect(unreleasedInSave(towers.slice(0, 1), true)).toBeNull();
    expect(unreleasedInSave(towers, false)).toBeNull();
  });
});
