import { describe, expect, it } from 'vitest';
import {
  BOSS_INTRO_CLEAR_MARGIN_M,
  BossIntroGate,
  bossClearDistance,
  bossIntroBlock,
  type BossIntroContext,
} from './boss-intro';
import { PORTAL_DEPTH } from '../configs/marker-geometry.config';

describe('BossIntroGate', () => {
  it('admits the first boss of a type in a wave and no more of it', () => {
    const gate = new BossIntroGate();
    expect(gate.admit('herbert', 10)).toBe(true);
    expect(gate.admit('herbert', 10)).toBe(false);
    expect(gate.admit('herbert', 10)).toBe(false);
  });

  it('admits a second type in the same wave', () => {
    const gate = new BossIntroGate();
    expect(gate.admit('herbert', 10)).toBe(true);
    expect(gate.admit('worm', 10)).toBe(true);
    expect(gate.admit('worm', 10)).toBe(false);
  });

  it('starts over with the next wave', () => {
    const gate = new BossIntroGate();
    gate.admit('herbert', 10);
    expect(gate.admit('herbert', 20)).toBe(true);
  });

  it('starts over after a reset, even at the same wave number', () => {
    const gate = new BossIntroGate();
    gate.admit('herbert', 10);
    gate.reset();
    expect(gate.admit('herbert', 10)).toBe(true);
  });
});

describe('bossClearDistance', () => {
  it('is the front face plus the margin', () => {
    expect(bossClearDistance(1)).toBeCloseTo(PORTAL_DEPTH / 2 + BOSS_INTRO_CLEAR_MARGIN_M);
  });

  it('grows with a deeper portal on a wide street, not below scale 1', () => {
    expect(bossClearDistance(1.5)).toBeCloseTo(PORTAL_DEPTH * 0.75 + BOSS_INTRO_CLEAR_MARGIN_M);
    expect(bossClearDistance(0.75)).toBeCloseTo(bossClearDistance(1));
  });
});

describe('bossIntroBlock', () => {
  const play: BossIntroContext = {
    enabled: true,
    photoMode: false,
    botEnabled: false,
    trainingConnected: false,
    timescale: 1,
    renderingEnabled: true,
    introFlight: false,
  };

  it('lets a normal game through, at every HUD speed', () => {
    expect(bossIntroBlock(play)).toBeNull();
    expect(bossIntroBlock({ ...play, timescale: 4 })).toBeNull();
  });

  it('names what keeps it from playing', () => {
    expect(bossIntroBlock({ ...play, enabled: false })).toBe('disabled');
    expect(bossIntroBlock({ ...play, photoMode: true })).toBe('photo-mode');
    expect(bossIntroBlock({ ...play, botEnabled: true })).toBe('bot');
    expect(bossIntroBlock({ ...play, trainingConnected: true })).toBe('training');
    expect(bossIntroBlock({ ...play, timescale: 10 })).toBe('timescale');
    expect(bossIntroBlock({ ...play, renderingEnabled: false })).toBe('no-rendering');
    expect(bossIntroBlock({ ...play, introFlight: true })).toBe('intro-flight');
  });
});
