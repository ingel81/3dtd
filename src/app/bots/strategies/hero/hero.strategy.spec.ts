import { describe, it, expect } from 'vitest';
import { HeroStrategy } from './hero.strategy';
import { createEmptySnapshot, type GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { HERO } from '../../../configs/hero.config';
import type { GameStateManager } from '../../../managers/game-state.manager';

/**
 * The bot's hero: hire him, load the right rounds, stand where the crowd is
 * (BALANCING_PLAN.md, D15). No bot used him before 2026-09-20.
 */

interface World {
  unlocked: boolean;
  hired: boolean;
  ammo: string;
  anchor: { lat: number; lon: number } | null;
  enemies: { position: { lat: number; lon: number } }[];
}

function strategy(world: Partial<World> = {}) {
  const w: World = { unlocked: true, hired: false, ammo: 'standard', anchor: null, enemies: [], ...world };
  const gameState = {
    heroManager: {
      getStatus: () => ({ unlocked: w.unlocked, hired: w.hired, ammo: w.ammo }),
      getAnchor: () => w.anchor,
    },
    enemyManager: { getAlive: () => w.enemies },
  } as unknown as GameStateManager;
  return { hero: new HeroStrategy(gameState), world: w };
}

function state(credits: number, armor?: Partial<Record<string, number>>): GameStateSnapshot {
  const snapshot = createEmptySnapshot();
  snapshot.player.credits = credits;
  if (armor) {
    snapshot.expectedArmorDistribution = {
      unarmored: 0, light: 0, heavy: 0, fortified: 0, ethereal: 0, ...armor,
    } as GameStateSnapshot['expectedArmorDistribution'];
  }
  return snapshot;
}

const at = (lat: number, lon: number) => ({ position: { lat, lon } });

describe('the bot and the hero', () => {
  it('waits while the research is missing', () => {
    const { hero } = strategy({ unlocked: false });
    expect(hero.canExecute(state(10_000))).toBe(false);
  });

  it('hires him once he is researched and paid for', () => {
    const { hero } = strategy();
    expect(hero.canExecute(state(HERO.cost - 1))).toBe(false);
    expect(hero.canExecute(state(HERO.cost))).toBe(true);
    expect(hero.execute(state(HERO.cost))).toMatchObject({ type: 'hire-hero' });
  });

  it('loads the rounds the wave calls for', () => {
    const { hero } = strategy({ hired: true });
    expect(hero.execute(state(0, { ethereal: 0.6 }))).toMatchObject({ type: 'hero-ammo', ammo: 'rune' });
    expect(hero.execute(state(0, { heavy: 0.3, fortified: 0.2 }))).toMatchObject({ type: 'hero-ammo', ammo: 'explosive' });
  });

  it('leaves the rounds alone when they already fit', () => {
    const { hero } = strategy({ hired: true, ammo: 'rune' });
    expect(hero.execute(state(0, { ethereal: 0.6 }))).toBeNull();
  });

  it('sends him to the crowd, and not again while he stands in it', () => {
    const enemies = [at(48.0, 9.0), at(48.00005, 9.00005), at(48.0001, 9.0001)];
    const away = strategy({ hired: true, enemies, anchor: { lat: 49, lon: 10 } });
    expect(away.hero.execute(state(0))).toMatchObject({ type: 'hero-move' });

    const there = strategy({ hired: true, enemies, anchor: { lat: 48.00005, lon: 9.00005 } });
    expect(there.hero.execute(state(0))).toBeNull();
  });

  it('sends him nowhere for a handful of enemies', () => {
    const { hero } = strategy({ hired: true, enemies: [at(48, 9)], anchor: { lat: 49, lon: 10 } });
    expect(hero.execute(state(0))).toBeNull();
  });
});
