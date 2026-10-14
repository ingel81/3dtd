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
});
