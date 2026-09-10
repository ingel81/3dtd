import { describe, it, expect } from 'vitest';
import { explainWaveDecision, formatExplanationForUI } from './decision-explainer';
import { createEmptySnapshot } from './models/game-state-snapshot';
import { WaveConfig } from './models/wave-config';

function batSwarm(): WaveConfig {
  return {
    enemies: [{ type: 'bat', count: 12 }],
    totalCount: 12,
    spawnDelay: 800,
    templateName: 'Bat Swarm',
    templateStrength: 1.2,
  };
}

describe('explainWaveDecision', () => {
  it('summarises wave, template, strength and enemy count', () => {
    const state = { ...createEmptySnapshot(), waveNumber: 7 };
    expect(explainWaveDecision(state, batSwarm()).summary)
      .toBe('Wave 7: Bat Swarm (strength 1.20×) · 12 enemies');
  });

  it('leaves the strength out when the config has none', () => {
    const state = { ...createEmptySnapshot(), waveNumber: 3 };
    const config: WaveConfig = { enemies: [{ type: 'zombie', count: 5 }], totalCount: 5, spawnDelay: 800 };
    expect(explainWaveDecision(state, config).summary).toBe('Wave 3: Template · 5 enemies');
  });

  it('names the missing anti-air when flying enemies are sent', () => {
    const { reasons } = explainWaveDecision(createEmptySnapshot(), batSwarm());
    expect(reasons).toContain('No anti-air towers -> sending flying enemies');
    expect(reasons).toContain('No splash damage -> sending a swarm');
  });

  it('formats the debug text in English', () => {
    const text = formatExplanationForUI(explainWaveDecision(createEmptySnapshot(), batSwarm()));
    expect(text).toContain('Confidence: 70%');
    expect(text).toContain('Reasons:');
    expect(text).toContain('Factors:');
    expect(text).not.toMatch(/Welle|Gegner|Keine|Fehlt|Gruende|Faktoren|Konfidenz/);
  });
});
