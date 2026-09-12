import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';

import {
  explainWaveDecision,
  formatExplanation,
  type WaveDecisionTrace,
  type WaveSizing,
} from './decision-explainer';
import { TEMPLATES, type TemplateMaskReason } from './templates';
import type { GateStatus } from './gate-controller';
import { WaveDirectorService } from './wave-director.service';
import { AIDataCollectorService } from './ai-data-collector.service';
import { createEmptySnapshot, type GameStateSnapshot } from './models/game-state-snapshot';

const idx = (id: string) => TEMPLATES.findIndex((t) => t.id === id);

function mask(overrides: Partial<TemplateMaskReason> = {}): TemplateMaskReason {
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

const WARMING: GateStatus = { multiplier: 1, samples: 2, meanLeak: null, lastStep: 'warming-up' };

function trace(overrides: Partial<WaveDecisionTrace> = {}): WaveDecisionTrace {
  return {
    wave: 37,
    templateName: 'Tank Column',
    mask: mask(),
    director: { by: 'rules', candidates: 14, lastRanWavesAgo: null, history: 5, tied: 9, ramp: 0.6 },
    gate: WARMING,
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

  it('a curriculum wave the defense cannot shoot at', () => {
    // W7 pins Bat Swarm even without anti-air; the gate is what keeps it
    // survivable, by shrinking it below the designer's minimum.
    expect(reasonsOf(trace({
      wave: 7,
      templateName: 'Bat Swarm',
      mask: mask({ rule: 'curriculum', pinnedLacks: 'antiAir' }),
      director: { by: 'rules', candidates: 1, lastRanWavesAgo: null, history: 5, tied: 1, ramp: 7 / 60 },
      sizing: sizing({ totalDps: 0, dpsScaledMax: 87, cap: 5, count: 5 }),
    }))).toEqual([
      'Curriculum: wave 7 is always Bat Swarm (waves 1-30 are fixed).',
      'Pinned although the defense has no anti-air.',
      'DPS ramp: 0 of 500 DPS narrows the count range to 30-87.',
      'Fairness gate caps it at 5, below the template minimum of 30.',
      'Leak loop still collecting (2 of 4 waves), gate at ×1.00.',
    ]);
  });

  it('a free pick past the curriculum, sized by the gate', () => {
    expect(reasonsOf(trace({
      mask: mask({ heldBack: { antiAir: [idx('bat_swarm'), idx('hornet_strike')], antiEthereal: [] } }),
      gate: { multiplier: 1.42, samples: 4, meanLeak: 0.03, lastStep: 'opened' },
      sizing: sizing({ cap: 212, count: 145, countFactor: 0.64, hpMult: 2.1, endgameHpMult: 1.85 }),
    }))).toEqual([
      'Oldest of 14 allowed templates: not used in the last 5 waves, random among 9 tied.',
      'Held back, no anti-air: Bat Swarm, Hornet Strike.',
      'Fairness gate caps the count at 212.',
      'Leak loop: last 4 waves leaked 3%, under the 8%-16% target, so the gate opened to ×1.42.',
      'Ramp 60% (full at wave 60): count at 64% of 30-212.',
      'HP ×2.10 includes the endgame multiplier ×1.85.',
    ]);
  });

  it('a boss wave', () => {
    const reasons = reasonsOf(trace({
      mask: mask({ rule: 'boss' }),
      director: { by: 'rules', candidates: 3, lastRanWavesAgo: 5, history: 5, tied: 1, ramp: 0.75 },
    }));
    expect(reasons[0]).toBe('Boss wave (every 5 waves after wave 30): boss templates only.');
    expect(reasons[1]).toBe('Oldest of 3 allowed templates: last ran 5 waves ago.');
  });

  it('names the mask fallbacks', () => {
    expect(reasonsOf(trace({ mask: mask({ bossUnavailable: true }) })))
      .toContain('Boss wave, but no boss template is available: runs as a normal wave.');
    expect(reasonsOf(trace({ mask: mask({ cooldownWaived: true }) })))
      .toContain('Every eligible template ran in the last 2 waves: cooldown waived.');
  });

  it('words the pick by how much history there was', () => {
    const pick = (d: Partial<Extract<WaveDecisionTrace['director'], { by: 'rules' }>>) =>
      reasonsOf(trace({
        director: { by: 'rules', candidates: 4, lastRanWavesAgo: null, history: 5, tied: 1, ramp: 0.6, ...d },
      }))[0];
    expect(pick({ lastRanWavesAgo: 1 })).toBe('Oldest of 4 allowed templates: last ran 1 wave ago.');
    expect(pick({ history: 0, tied: 4 })).toBe('Oldest of 4 allowed templates: no history yet, random among 4 tied.');
    expect(pick({ candidates: 1 })).toBe('The only template allowed.');
    expect(pick({ candidates: 0 })).toBe('No template allowed: fell back to the first one with fixed mid-range factors.');
  });

  it('leaves the leak loop out when the gate did not bind', () => {
    const reasons = reasonsOf(trace({ gate: { multiplier: 2, samples: 4, meanLeak: 0.02, lastStep: 'opened' } }));
    expect(reasons).toContain('Fairness gate: cap 900, not binding.');
    expect(reasons).toContain('Ramp 60% (full at wave 60): count at 50% of 30-600.');
    expect(reasons.some((r) => r.startsWith('Leak loop'))).toBe(false);
  });

  it('says when there is no finite cap', () => {
    expect(reasonsOf(trace({ sizing: sizing({ cap: null }) })))
      .toContain('Fairness gate: no cap, the defense kills faster than enemies spawn.');
  });

  it('words each step of the leak loop', () => {
    const loop = (gate: GateStatus) =>
      reasonsOf(trace({ gate, sizing: sizing({ cap: 100 }) })).find((r) => r.startsWith('Leak loop'));
    expect(loop({ multiplier: 1.3, samples: 4, meanLeak: 0.11, lastStep: 'held' }))
      .toBe('Leak loop: last 4 waves leaked 11%, inside the 8%-16% target, gate holds at ×1.30.');
    expect(loop({ multiplier: 0.9, samples: 4, meanLeak: 0.3, lastStep: 'closed' }))
      .toBe('Leak loop: last 4 waves leaked 30%, over the 8%-16% target, so the gate closed to ×0.90.');
    expect(loop({ multiplier: 0.8, samples: 4, meanLeak: 0.5, lastStep: 'backed-off' }))
      .toBe('Leak loop: the last wave ended the run, gate backed off to ×0.80.');
  });

  it('reports a compressed spawn delay', () => {
    expect(reasonsOf(trace({ sizing: sizing({ durationCapped: true, spawnDelay: 90 }) })))
      .toContain('Spawn delay compressed to 90 ms to keep the wave under 3 min.');
  });

  it('attributes an ONNX pick to the model', () => {
    const reasons = reasonsOf(trace({ director: { by: 'model', candidates: 14, probability: 0.42 } }));
    expect(reasons).toContain('ONNX model pick among 14 allowed templates (p 0.42).');
    expect(reasons).toContain('Model factor: count at 50% of 30-600.');
  });

  it('formats the same text for the console', () => {
    const e = explainWaveDecision(trace());
    expect(formatExplanation(e).split('\n')).toEqual([e.summary, ...e.reasons.map((r) => `  - ${r}`)]);
  });

  it('writes English without em dashes', () => {
    const all = [
      trace(),
      trace({ mask: mask({ rule: 'curriculum', pinnedLacks: 'antiEthereal' }), sizing: sizing({ cap: 3 }) }),
      trace({ director: { by: 'model', candidates: 3, probability: 0.9 }, sizing: sizing({ durationCapped: true }) }),
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
  let director: WaveDirectorService;

  beforeEach(() => {
    snapshot = createEmptySnapshot();
    const collector = {
      onWaveResult: () => () => undefined,
      getStateSnapshot: () => snapshot,
      setCurrentWaveConfig: () => undefined,
    };
    const injector = Injector.create({ providers: [{ provide: AIDataCollectorService, useValue: collector }] });
    director = runInInjectionContext(injector, () => new WaveDirectorService());
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
      'Curriculum: wave 7 is always Bat Swarm (waves 1-30 are fixed).',
      'Pinned although the defense has no anti-air.',
    ]);
    expect(explanation?.reasons).toContain('Fairness gate caps it at 5, below the template minimum of 30.');
  });

  it('names the stalest pick and the templates held back past the curriculum', async () => {
    groundDefense(40);                                        // planning 41, not a boss wave
    const { explanation } = await director.getNextWave();
    const heldBack = TEMPLATES.filter((t) => !t.bossOnly && t.requiresCapability === 'antiAir' && t.minWave <= 41)
      .map((t) => t.name);
    expect(explanation?.reasons.some((r) => r.startsWith('Oldest of '))).toBe(true);
    expect(explanation?.reasons).toContain(`Held back, no anti-air: ${heldBack.join(', ')}.`);
    expect(explanation?.reasons.some((r) => r.startsWith('Curriculum'))).toBe(false);
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
