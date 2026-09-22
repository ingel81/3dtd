import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { buildWaveContext, deriveCapabilities } from './wave-context';
import { analyzeDefense } from './defense-analyzer';
import { explainWaveDecision } from './decision-explainer';
import { createEmptySnapshot, type GameStateSnapshot } from './models/game-state-snapshot';
import { Tower } from '../entities/tower.entity';
import type { TowerTypeId } from '../configs/tower-types.config';

describe('deriveCapabilities()', () => {
  /** A snapshot without analysed capabilities, so only the unlock fallback decides. */
  const unlocked = (towerUnlocked: Record<string, boolean>): GameStateSnapshot =>
    ({ research: { towerUnlocked, airTargetingUnlocked: false } }) as unknown as GameStateSnapshot;

  it('counts an unlocked chaos tower as anti-air and anti-ethereal', () => {
    expect(deriveCapabilities(unlocked({ chaos: true }))).toEqual({
      hasAntiAir: true,
      hasAntiEthereal: true,
    });
  });

  it('a defense with neither counter unlocked gets neither gate', () => {
    expect(deriveCapabilities(unlocked({ cannon: true, fire: true }))).toEqual({
      hasAntiAir: false,
      hasAntiEthereal: false,
    });
  });

  it('prefers the analysed capabilities over the unlock flags', () => {
    const state = {
      research: { towerUnlocked: { chaos: true } },
      defense: { capabilities: { hasAntiAir: false, hasAntiEthereal: false } },
    } as unknown as GameStateSnapshot;
    expect(deriveCapabilities(state)).toEqual({ hasAntiAir: false, hasAntiEthereal: false });
  });
});

/**
 * Through the real defense analysis, so a tower-only defense reaches the mask
 * and the explainer the way it does in the game.
 */
describe('buildWaveContext() mask reason', () => {
  const POS = { lat: 10, lon: 20, height: 0 };

  function defenseOf(typeId: TowerTypeId, waveNumber: number): GameStateSnapshot {
    const state = createEmptySnapshot();
    state.waveNumber = waveNumber;
    state.defense = { ...state.defense, ...analyzeDefense([new Tower(POS, typeId), new Tower(POS, typeId)], false) };
    return state;
  }

  function reasonsFor(state: GameStateSnapshot): string[] {
    const { candidateReason } = buildWaveContext(state);
    return explainWaveDecision({
      wave: state.waveNumber + 1,
      templateName: 'Any',
      candidates: candidateReason,
      director: { candidates: 3, lastRanWavesAgo: null, history: 0, tied: 3, ramp: 0.7 },
      pressure: { multiplier: 1, samples: 0, meanPressure: null, target: null, lastStep: 'warming-up' },
      sizing: {
        countRange: [10, 100], dpsScaledMax: 100, totalDps: 120, cap: null, countFactor: 0.5,
        count: 55, hpMult: 1, endgameHpMult: 1, spawnDelay: 200, durationCapped: false,
      },
    }).reasons;
  }

  it('holds nothing back when only chaos towers stand, normal and boss wave', () => {
    for (const wave of [40, 44]) {                 // planning 41 (free) and 45 (boss)
      const state = defenseOf('chaos', wave);
      expect(buildWaveContext(state).candidateReason.heldBack, `wave ${wave + 1}`)
        .toEqual({ antiAir: [], antiEthereal: [] });
      expect(reasonsFor(state).some((r) => r.startsWith('Held back')), `wave ${wave + 1}`).toBe(false);
    }
  });

  it('still holds air and ethereal back for a cannon-only defense', () => {
    const state = defenseOf('cannon', 40);
    const { heldBack } = buildWaveContext(state).candidateReason;
    expect(heldBack.antiAir.length).toBeGreaterThan(0);
    expect(heldBack.antiEthereal.length).toBeGreaterThan(0);
    expect(reasonsFor(state).some((r) => r.startsWith('Held back, no anti-air'))).toBe(true);
  });
});
