import { DEFAULT_RUN_RULES, runRulesKey, runRulesOf, towerAllowed, towerUnlockedBy } from './run-rules';
import { worldKeyOf } from './world-key';
import { GAME_BALANCE } from '../../configs/game-balance.config';

describe('run rules (a world\'s own gameplay)', () => {
  it('fills what a world leaves out with the game\'s and holds its values in bounds', () => {
    expect(runRulesOf(null)).toBe(DEFAULT_RUN_RULES);
    expect(runRulesOf({ startCredits: 250 })).toEqual({ startCredits: 250, hqHealth: GAME_BALANCE.player.startHealth, towers: null, structures: null, start: null });
    expect(runRulesOf({ startCredits: -5, hqHealth: 1e9 })).toMatchObject({ startCredits: 0, hqHealth: 100_000 });
    expect(runRulesOf({ startCredits: 'x', hqHealth: 12.6 })).toMatchObject({ startCredits: GAME_BALANCE.player.startCredits, hqHealth: 13 });
    // Known types only, in the game's order; none known: every type
    expect(runRulesOf({ towers: ['cannon', 'nope', 'archer'] }).towers).toEqual(['archer', 'cannon']);
    expect(runRulesOf({ towers: ['nope'] }).towers).toBeNull();
  });

  it('locks a type the rules leave out, whatever the research', () => {
    const rules = runRulesOf({ towers: ['archer', 'cannon'] });
    expect(towerAllowed(rules, 'ice')).toBe(false);
    expect(towerUnlockedBy('archer', [], rules)).toBe(true);
    expect(towerUnlockedBy('research-center', [], rules)).toBe(false);
    expect(towerUnlockedBy('research-center', [], DEFAULT_RUN_RULES)).toBe(true);
  });

  it('keeps the key of a world without rules as it was', () => {
    const heights: [number, number][] = [[1, 2.5]];
    const paths = [[{ lat: 1, lon: 2, height: 0 }]];
    const origin = { lat: 0, lon: 0, height: 0 };
    expect(runRulesKey(undefined)).toBe('');
    expect(worldKeyOf(heights, paths, origin, undefined)).toBe(worldKeyOf(heights, paths, origin));
    expect(worldKeyOf(heights, paths, origin, runRulesOf({ hqHealth: 80 }))).not.toBe(worldKeyOf(heights, paths, origin));
  });

  it('carries the structures that fall, checked, and puts them in the key (TODO E131)', () => {
    const barn = { id: 'barn', lat: 0.001, lon: 0.002, radius: 5, height: 6, hp: 120 };
    const rules = runRulesOf({ structures: [barn, { id: 'broken' }, { ...barn, id: 'dead', hp: 0 }] });
    expect(rules.structures).toEqual([barn]);
    expect(runRulesOf({ structures: [] }).structures).toBeNull();
    // Another HP or another place: another world key
    expect(runRulesKey(rules)).not.toBe(runRulesKey(runRulesOf({ structures: [{ ...barn, hp: 121 }] })));
    expect(runRulesKey(rules)).not.toBe(runRulesKey(runRulesOf({})));
    expect(runRulesKey(runRulesOf({ hqHealth: 80 }))).toBe('r=100,80,*');
  });

  it("carries what a map set for its structures and the craters and wear, checked, and keys every value of the damage (docs/DESTRUCTION_PLAN.md)", () => {
    const barn = { id: 'barn', lat: 0.001, lon: 0.002, radius: 5, height: 6, hp: 120 };
    const hall = { ...barn, id: 'hall', start: 60, box: [1, 2, 3, 4, 0.5] as const, roof: true };
    const rules = runRulesOf({ structures: [barn, hall, { ...barn, id: 'over', start: 121 }, { ...barn, id: 'bent', box: [1, 2] }], destruction: { craters: true } });
    expect(rules.structures).toEqual([barn, hall]);
    expect(rules.destruction).toEqual({ craters: true, wear: false });
    // Neither craters nor wear: none, and no key part where nothing can be damaged
    expect(runRulesOf({ destruction: { craters: false } })).not.toHaveProperty('destruction');
    expect(runRulesKey(runRulesOf({ hqHealth: 80, destruction: {} }))).toBe('r=100,80,*');
    // Craters alone: a key part with the damage's values
    expect(runRulesKey(runRulesOf({ destruction: { craters: true } }))).toMatch(/^r=100,500,\*,d=c:[0-9a-f]+$/);
    expect(runRulesKey(runRulesOf({ destruction: { wear: true } }))).toMatch(/,d=w:/);
    // The start, the ground plan and the roof are part of the structure's key
    const key = (s: object) => runRulesKey(runRulesOf({ structures: [s] }));
    expect(key(hall)).not.toBe(key({ ...hall, start: 61 }));
    expect(key(hall)).not.toBe(key({ ...hall, box: [1, 2, 3, 4, 0.6] }));
    expect(key(hall)).not.toBe(key({ ...hall, roof: false }));
    // A raised building's outline, checked, in the key
    const block = { ...hall, mass: { x: 1, y: 2, turn: 0.5, scale: 1, rings: [[0, 0, 4, 0, 4, 4]] } };
    expect(runRulesOf({ structures: [block, { ...block, id: 'torn', mass: { ...block.mass, rings: [[0, 0, 1]] } }] }).structures).toEqual([block]);
    expect(key(block)).not.toBe(key({ ...block, mass: { ...block.mass, rings: [[0, 0, 4, 0, 4, 5]] } }));
  });

  it('carries the wave events, checked, and puts them in the key; a world without keeps its key (TODO E170)', () => {
    const portal = { wave: 4, kind: 'portal', spawn: 's2' } as const;
    const rules = runRulesOf({ events: [portal, { wave: 0, kind: 'message', text: 'x' }, { wave: 2, kind: 'dance' }, { wave: 3, kind: 'objects', show: true, ids: ['g'], objects: [{ id: 'g' }] }] });
    expect(rules.events).toEqual([portal]);
    expect(runRulesOf({ events: [] })).not.toHaveProperty('events');
    expect(runRulesKey(runRulesOf({ hqHealth: 80, events: [] }))).toBe('r=100,80,*');
    expect(runRulesKey(rules)).toMatch(/^r=100,500,\*,e=1:[0-9a-f]+$/);
    expect(runRulesKey(rules)).not.toBe(runRulesKey(runRulesOf({ events: [{ ...portal, wave: 5 }] })));
  });

  it('takes every weather a map knows, a storm too (TODO E243), and no other', () => {
    const storm = { wave: 3, kind: 'weather', weather: 'storm', strength: 0.9 } as const;
    expect(runRulesOf({ events: [storm, { wave: 4, kind: 'weather', weather: 'hail' }] }).events).toEqual([storm]);
  });
});

