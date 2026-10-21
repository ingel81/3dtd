import { describe, it, expect } from 'vitest';
import { commandProblem } from './command-guard';
import { ABILITIES } from '../configs/abilities.config';
import { clampDebugBlastRadius, DEBUG_BLAST_RADIUS } from '../configs/destruction.config';

const at = { lat: 48.78, lon: 9.18, height: 250 };

describe('commandProblem (COOP_PLAN S4)', () => {
  it('lets the commands through that the UI sends', () => {
    for (const command of [
      { type: 'command:place-tower', position: at, typeId: 'archer', rotation: 1.2, plinthHeight: 2, plinthOverhang: [0, 3] },
      { type: 'command:tower-aim', heading: -2.5, pitch: 0.3 },
      { type: 'command:give-credits', to: 'p2', amount: 100 },
      { type: 'command:use-ability', abilityId: Object.keys(ABILITIES)[0], target: at },
      { type: 'command:hero-ammo', ammo: 'explosive' },
      { type: 'command:start-wave', director: { enemies: [{ type: 'zombie', count: 40 }] } },
      { type: 'command:restart-game', seed: 123456 },
      { type: 'command:move-queued-research', researchId: 'ice-magic', toIndex: 2 },
      { type: 'command:leave-game' },
    ]) {
      expect(commandProblem(command)).toBeNull();
    }
  });

  it('refuses values out of range, of the wrong kind or unknown', () => {
    expect(commandProblem({ type: 'command:place-tower', position: { lat: NaN, lon: 9 }, typeId: 'archer' })).toBe('position');
    expect(commandProblem({ type: 'command:place-tower', position: at, typeId: 'death-star' })).toBe('tower type');
    expect(commandProblem({ type: 'command:place-tower', position: at, typeId: 'toString' })).toBe('tower type');
    expect(commandProblem({ type: 'command:place-tower', position: at, typeId: 'archer', plinthHeight: 1e9 })).toBe('plinth height');
    expect(commandProblem({ type: 'command:tower-aim', heading: 0, pitch: 3 })).toBe('aim');
    expect(commandProblem({ type: 'command:give-credits', to: 'p2', amount: -50 })).toBe('gift');
    expect(commandProblem({ type: 'command:give-credits', to: 'p2', amount: 1.5 })).toBe('gift');
    expect(commandProblem({ type: 'command:hero-ammo', ammo: 'nuke' })).toBe('hero ammo');
    expect(commandProblem({ type: 'command:start-wave', director: { enemies: [{ type: 'zombie', count: 1e9 }] } })).toBe('wave');
    expect(commandProblem({ type: 'command:set-ready', ready: 'yes' })).toBe('ready');
    expect(commandProblem({ type: 'command:sell-tower', towerId: 'x'.repeat(500) })).toBe('tower id');
  });

  it("takes the destruction tool's blast with or without a radius, whole metres within its bounds on the nuke only (E284)", () => {
    const blast = (extra: object) => commandProblem({ type: 'debug:blast', lat: 0.001, lon: 0.002, height: 12, blast: 'nuclear-strike', ...extra });
    // Without one, as every command before the radius
    expect(blast({})).toBeNull();
    expect(blast({ blast: 'rocket' })).toBeNull();
    expect(blast({ radius: DEBUG_BLAST_RADIUS.min })).toBeNull();
    expect(blast({ radius: DEBUG_BLAST_RADIUS.max })).toBeNull();
    expect(blast({ radius: 60 })).toBeNull();
    expect(blast({ radius: DEBUG_BLAST_RADIUS.min - 1 })).toBe('blast');
    expect(blast({ radius: DEBUG_BLAST_RADIUS.max + 1 })).toBe('blast');
    expect(blast({ radius: 0 })).toBe('blast');
    expect(blast({ radius: -25 })).toBe('blast');
    expect(blast({ radius: 25.5 })).toBe('blast');
    expect(blast({ radius: NaN })).toBe('blast');
    expect(blast({ radius: Infinity })).toBe('blast');
    expect(blast({ radius: '25' })).toBe('blast');
    expect(blast({ radius: null })).toBe('blast');
    // A projectile's impact keeps its type's radius: a radius on it is no command of the tool
    expect(blast({ blast: 'rocket', radius: 25 })).toBe('blast');
    expect(blast({ blast: 'cannonball', radius: 25 })).toBe('blast');
  });

  it('clamps the radius the tool sends to whole metres within its bounds', () => {
    expect(clampDebugBlastRadius(25)).toBe(25);
    expect(clampDebugBlastRadius(37.4)).toBe(37);
    expect(clampDebugBlastRadius(0)).toBe(DEBUG_BLAST_RADIUS.min);
    expect(clampDebugBlastRadius(-10)).toBe(DEBUG_BLAST_RADIUS.min);
    expect(clampDebugBlastRadius(1e6)).toBe(DEBUG_BLAST_RADIUS.max);
    expect(clampDebugBlastRadius(NaN)).toBe(DEBUG_BLAST_RADIUS.min);
    // What it clamps to passes the guard
    for (const r of [-1, 0, 4.4, 5, 25, 99.6, 100, 250]) {
      expect(commandProblem({ type: 'debug:blast', lat: 0, lon: 0, height: 0, blast: 'nuclear-strike', radius: clampDebugBlastRadius(r) })).toBeNull();
    }
    // The real strike's radius is within them, so the tool's start value is the strike as it is
    expect(ABILITIES['nuclear-strike'].radiusM).toBeGreaterThanOrEqual(DEBUG_BLAST_RADIUS.min);
    expect(ABILITIES['nuclear-strike'].radiusM).toBeLessThanOrEqual(DEBUG_BLAST_RADIUS.max);
  });

  describe('waves from another client: every client builds them, a bad one would stop them all', () => {
    const wave = (extra: object) => commandProblem({ type: 'command:start-wave', ...extra });
    const entry = { enemyType: 'zombie', speed: 5, health: 80 };

    it('takes the waves the game sends: a planned one with its plan, the debug panel’s schedule', () => {
      expect(wave({
        director: { enemies: [{ type: 'rat', count: 30, healthMultiplier: 1.4 }], totalCount: 30, spawnDelay: 300, spawnDelayVariation: 0.3, pattern: 'interleaved', spawnMode: 'random' },
        plan: { waveSource: 'budget', log: ['row 2', 'budget 20.5 s'] },
      })).toBeNull();
      expect(wave({ config: { schedule: { entries: [entry, { ...entry, delay: 0, pauseAfter: 2000 }], baseDelay: 0, spawnFloor: false } } })).toBeNull();
    });

    it('refuses enemy types that are no own key, as "constructor"', () => {
      expect(wave({ director: { enemies: [{ type: 'constructor', count: 1 }] } })).toBe('wave');
      expect(wave({ config: { schedule: { entries: [{ ...entry, enemyType: 'toString' }], baseDelay: 100 } } })).toBe('wave');
    });

    it('refuses gaps, speeds, HP and patterns out of range, and too many entries', () => {
      expect(wave({ director: { enemies: [{ type: 'zombie', count: 1 }], spawnDelay: NaN } })).toBe('wave');
      expect(wave({ director: { enemies: [{ type: 'zombie', count: 1 }], pattern: 'spiral' } })).toBe('wave');
      expect(wave({ director: { enemies: [{ type: 'zombie', count: 1, speedMultiplier: -1 }] } })).toBe('wave');
      expect(wave({ config: { schedule: { entries: [{ ...entry, speed: Infinity }], baseDelay: 100 } } })).toBe('wave');
      expect(wave({ config: { schedule: { entries: [{ ...entry, delay: 1e12 }], baseDelay: 100 } } })).toBe('wave');
      expect(wave({ config: { schedule: { entries: [entry], baseDelay: 100, spawnMode: 'all' } } })).toBe('wave');
      expect(wave({ config: { schedule: { entries: new Array(20_001).fill(entry), baseDelay: 100 } } })).toBe('wave');
      expect(wave({ config: { entries: [entry] } })).toBe('wave');
    });

    it('refuses a plan too large for every client’s run log', () => {
      expect(wave({ director: { enemies: [{ type: 'zombie', count: 1 }] }, plan: { log: ['x'.repeat(40_000)] } })).toBe('wave');
    });
  });
});
