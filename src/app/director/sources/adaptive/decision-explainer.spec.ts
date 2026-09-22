import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';

import {
  explainWaveDecision,
  formatExplanation,
  type WaveDecisionTrace,
  type WaveSizing,
} from './decision-explainer';
import { TEMPLATES, type CandidateReason } from './templates';
import type { PressureStatus } from './pressure-controller';
import { WaveDirector } from './wave-director';
import { StateSnapshotService } from './state-snapshot.service';
import { createEmptySnapshot, type GameStateSnapshot } from './models/game-state-snapshot';

const idx = (id: string) => TEMPLATES.findIndex((t) => t.id === id);

function candidateReason(overrides: Partial<CandidateReason> = {}): CandidateReason {
  return {
    rule: 'free',
    bossUnavailable: false,
    cooldownWaived: false,
    heldBack: { antiAir: [], antiEthereal: [] },
    pinnedLacks: null,
    ...overrides,
  };
}

function sizing(overrides: Partial<WaveSizing> = {}): WaveSizing {
  return {
    countRange: [30, 600],
    dpsScaledMax: 600,
    totalDps: 800,
    cap: 900,
    countFactor: 0.5,
    count: 315,
    hpMult: 1,
    endgameHpMult: 1,
    spawnDelay: 200,
    durationCapped: false,
    ...overrides,
  };
}

const WARMING: PressureStatus = {
  multiplier: 1, samples: 2, meanPressure: null, target: 0.02, lastStep: 'warming-up',
};

function trace(overrides: Partial<WaveDecisionTrace> = {}): WaveDecisionTrace {
  return {
    wave: 37,
    templateName: 'Tank Column',
    candidates: candidateReason(),
    director: { candidates: 14, lastRanWavesAgo: null, history: 5, tied: 9, ramp: 0.6 },
    pressure: WARMING,
    sizing: sizing(),
    ...overrides,
  };
}

const reasonsOf = (t: WaveDecisionTrace) => explainWaveDecision(t).reasons;

describe('explainWaveDecision', () => {
  it('summarises the planned wave, template, shipped count and HP', () => {
    expect(explainWaveDecision(trace({ sizing: sizing({ hpMult: 2.1 }) })).summary)
      .toBe('Wave 37: Tank Column · 315 enemies · HP ×2.10');
  });

  it('a campaign wave the defense cannot shoot at', () => {
    // W7 pins Bat Swarm even without anti-air; the survivability cap is what keeps it
    // survivable, by shrinking it below the designer's minimum.
    expect(reasonsOf(trace({
      wave: 7,
      templateName: 'Bat Swarm',
      candidates: candidateReason({ rule: 'campaign', pinnedLacks: 'antiAir' }),
      director: { candidates: 1, lastRanWavesAgo: null, history: 5, tied: 1, ramp: 7 / 60 },
      sizing: sizing({ totalDps: 0, dpsScaledMax: 87, cap: 5, count: 5 }),
    }))).toEqual([
      'Campaign: wave 7 is always Bat Swarm (waves 1-30 are fixed).',
      'Pinned although the defense has no anti-air.',
      'DPS ramp: 0 of 500 DPS narrows the count range to 30-87.',
      'Survivability cap is 5, below the template minimum of 30.',
      'Pressure loop still collecting (2 of 3 waves), at ×1.00.',
    ]);
  });

  it('a free pick past the campaign, sized by the survivability cap', () => {
    expect(reasonsOf(trace({
      candidates: candidateReason({ heldBack: { antiAir: [idx('bat_swarm'), idx('hornet_strike')], antiEthereal: [] } }),
      pressure: { multiplier: 1.42, samples: 8, meanPressure: 0.005, target: 0.04, lastStep: 'opened' },
      sizing: sizing({ cap: 212, count: 145, countFactor: 0.64, hpMult: 2.1, endgameHpMult: 1.85 }),
    }))).toEqual([
      'Oldest of 14 allowed templates: not used in the last 5 waves, random among 9 tied.',
      'Held back, no anti-air: Bat Swarm, Hornet Strike.',
      'Survivability cap holds the count at 212.',
      'Pressure loop: waves cost 0.5% of HP on average, under the 2.0%-6.0% target, so it opened to ×1.42.',
      'Ramp 60% (full at wave 60): count at 64% of 30-212.',
      'HP ×2.10 includes the endgame multiplier ×1.85.',
    ]);
  });

  it('a boss wave', () => {
    const reasons = reasonsOf(trace({
      candidates: candidateReason({ rule: 'boss' }),
      director: { candidates: 3, lastRanWavesAgo: 5, history: 5, tied: 1, ramp: 0.75 },
    }));
    expect(reasons[0]).toBe('Boss wave (every 5 waves after wave 30): boss templates only.');
    expect(reasons[1]).toBe('Oldest of 3 allowed templates: last ran 5 waves ago.');
  });

  it('names the candidate fallbacks', () => {
    expect(reasonsOf(trace({ candidates: candidateReason({ bossUnavailable: true }) })))
      .toContain('Boss wave, but no boss template is available: runs as a normal wave.');
    expect(reasonsOf(trace({ candidates: candidateReason({ cooldownWaived: true }) })))
      .toContain('Every eligible template ran in the last 2 waves: cooldown waived.');
  });

  it('words the pick by how much history there was', () => {
    const pick = (d: Partial<WaveDecisionTrace['director']>) =>
      reasonsOf(trace({
        director: { candidates: 4, lastRanWavesAgo: null, history: 5, tied: 1, ramp: 0.6, ...d },
      }))[0];
    expect(pick({ lastRanWavesAgo: 1 })).toBe('Oldest of 4 allowed templates: last ran 1 wave ago.');
    expect(pick({ history: 0, tied: 4 })).toBe('Oldest of 4 allowed templates: no history yet, random among 4 tied.');
    expect(pick({ candidates: 1 })).toBe('The only template allowed.');
    expect(pick({ candidates: 0 })).toBe('No template allowed: fell back to the first one with fixed mid-range factors.');
  });

  it('leaves the pressure loop out when the cap did not bind', () => {
    const reasons = reasonsOf(trace({
      pressure: { multiplier: 2, samples: 8, meanPressure: 0.002, target: 0.04, lastStep: 'opened' },
    }));
    expect(reasons).toContain('Survivability cap 900, not binding.');
    expect(reasons).toContain('Ramp 60% (full at wave 60): count at 50% of 30-600.');
    expect(reasons.some((r) => r.startsWith('Pressure loop'))).toBe(false);
  });

  it('says when there is no finite cap', () => {
    expect(reasonsOf(trace({ sizing: sizing({ cap: null }) })))
      .toContain('Survivability cap: none, the defense kills faster than enemies spawn.');
  });

  it('words each step of the pressure loop', () => {
    const loop = (pressure: PressureStatus) =>
      reasonsOf(trace({ pressure, sizing: sizing({ cap: 100 }) })).find((r) => r.startsWith('Pressure loop'));
    expect(loop({ multiplier: 1.3, samples: 8, meanPressure: 0.04, target: 0.04, lastStep: 'held' }))
      .toBe('Pressure loop: waves cost 4.0% of HP on average, inside the 2.0%-6.0% target, it holds at ×1.30.');
    expect(loop({ multiplier: 0.9, samples: 8, meanPressure: 0.3, target: 0.04, lastStep: 'closed' }))
      .toBe('Pressure loop: waves cost 30% of HP on average, over the 2.0%-6.0% target, so it closed to ×0.90.');
  });

  it('reports a compressed spawn delay', () => {
    expect(reasonsOf(trace({ sizing: sizing({ durationCapped: true, spawnDelay: 90 }) })))
      .toContain('Spawn delay compressed to 90 ms to keep the wave under 3 min.');
  });

  it('formats the same text for the console', () => {
    const e = explainWaveDecision(trace());
    expect(formatExplanation(e).split('\n')).toEqual([e.summary, ...e.reasons.map((r) => `  - ${r}`)]);
  });

  it('writes English without em dashes', () => {
    const all = [
      trace(),
      trace({ candidates: candidateReason({ rule: 'campaign', pinnedLacks: 'antiEthereal' }), sizing: sizing({ cap: 3 }) }),
      trace({ director: { candidates: 3, lastRanWavesAgo: 2, history: 5, tied: 1, ramp: 0.9 }, sizing: sizing({ durationCapped: true }) }),
    ].flatMap((t) => [explainWaveDecision(t).summary, ...reasonsOf(t)]).join('\n');
    expect(all).not.toMatch(/Welle|Gegner|Keine|Grund/);
    expect(all).not.toContain(String.fromCharCode(0x2014));   // em dash
  });
});

/**
 * Through the real director, so the reasons have to arrive from the decision
 * that was made rather than from a hand-built trace.
 */
describe('explanations from the wave director', () => {
  let snapshot: GameStateSnapshot;
  let director: WaveDirector;

  beforeEach(() => {
    snapshot = createEmptySnapshot();
    const collector = {
      onWaveResult: () => () => undefined,
      getStateSnapshot: () => snapshot,
      setCurrentWaveConfig: () => undefined,
    };
    const injector = Injector.create({ providers: [{ provide: StateSnapshotService, useValue: collector }] });
    director = runInInjectionContext(injector, () => new WaveDirector());
  });

  /** Enough defense for a finite gate, but no anti-air. */
  function groundDefense(waveNumber: number): void {
    snapshot.waveNumber = waveNumber;
    snapshot.defense.totalDPS = 400;
    const dps = { unarmored: 120, light: 120, heavy: 120, fortified: 120, ethereal: 120 };
    snapshot.defense.gateDpsPerArmor = { ground: dps, air: dps };
    snapshot.defense.killThroughput = { ground: 3, air: 3 };
    snapshot.defense.capabilities = { ...snapshot.defense.capabilities, hasAntiAir: false, hasAntiEthereal: true };
  }

  it('explains the wave being planned, not the one that just finished', async () => {
    snapshot.waveNumber = 6;                                  // wave 6 done, planning 7
    const { explanation, totalCount } = await director.getNextWave();
    expect(explanation?.summary).toMatch(new RegExp(`^Wave 7: Bat Swarm · ${totalCount} enemies · HP ×`));
    expect(explanation?.reasons.slice(0, 2)).toEqual([
      'Campaign: wave 7 is always Bat Swarm (waves 1-30 are fixed).',
      'Pinned although the defense has no anti-air.',
    ]);
    expect(explanation?.reasons).toContain('Survivability cap is 5, below the template minimum of 30.');
  });

  it('names the stalest pick and the templates held back past the campaign', async () => {
    groundDefense(40);                                        // planning 41, not a boss wave
    const { explanation } = await director.getNextWave();
    const heldBack = TEMPLATES.filter((t) => !t.bossOnly && t.requires === 'antiAir' && t.minWave <= 41)
      .map((t) => t.name);
    expect(explanation?.reasons.some((r) => r.startsWith('Oldest of '))).toBe(true);
    expect(explanation?.reasons).toContain(`Held back, no anti-air: ${heldBack.join(', ')}.`);
    expect(explanation?.reasons.some((r) => r.startsWith('Campaign'))).toBe(false);
  });

  it('marks a boss wave and scopes the held-back list to boss templates', async () => {
    groundDefense(44);                                        // planning 45
    const { explanation } = await director.getNextWave();
    expect(explanation?.reasons[0]).toBe('Boss wave (every 5 waves after wave 30): boss templates only.');
    expect(explanation?.reasons).toContain('Held back, no anti-air: Boss: Dragon Flight.');
  });

  it('prints the same text to the console in debug mode', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    director.setDebugMode(true);
    const { explanation } = await director.getNextWave();
    expect(log).toHaveBeenCalledWith(`[AI] Why this wave:\n${formatExplanation(explanation!)}`);
    log.mockRestore();
  });
});
