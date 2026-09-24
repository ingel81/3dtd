import { describe, it, expect } from 'vitest';
import { commandProblem } from './command-guard';
import { ABILITIES } from '../configs/abilities.config';

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
});
