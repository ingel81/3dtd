import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import { GameEventBus } from './game-event-bus';
import { ScreenShakeService, shakeFalloff } from './screen-shake.service';
import type { ThreeTilesEngine } from '../three-engine';
import { SCREEN_SHAKE_CONFIG } from '../configs/visual-effects.config';
import { LEGACY_SCREEN_SHAKE_KEY, STORAGE_KEY } from '../utils/display-options.storage';

const { nearDistance, farDistance, presets } = SCREEN_SHAKE_CONFIG;

function setup(stored?: object) {
  localStorage.clear();
  if (stored) localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  const eventBus = new GameEventBus();
  const engine = {
    triggerScreenShake: vi.fn(),
    // The camera sits at the origin, `lat` stands for the impact's distance on X
    sync: { geoToLocalSimpleInto: (lat: number, _lon: number, _h: number, target: Vector3) => target.set(lat, 0, 0) },
    getCamera: () => ({ position: new Vector3() }),
  };
  const service = new ScreenShakeService(eventBus, engine as unknown as ThreeTilesEngine);
  const impact = (projectileType: string, distance: number) =>
    eventBus.emit({ type: 'vfx:projectile-impact', lat: distance, lon: 0, height: 0, projectileType, targetLost: false });
  return { eventBus, engine, service, impact };
}

describe('shakeFalloff', () => {
  it('is full up to near, gone from far on, linear between', () => {
    expect(shakeFalloff(0, 100, 300)).toBe(1);
    expect(shakeFalloff(100, 100, 300)).toBe(1);
    expect(shakeFalloff(200, 100, 300)).toBeCloseTo(0.5);
    expect(shakeFalloff(300, 100, 300)).toBe(0);
    expect(shakeFalloff(5000, 100, 300)).toBe(0);
  });
});

describe('ScreenShakeService', () => {
  it('shakes near impacts at full strength and fades with distance', () => {
    const { engine, service, impact } = setup();
    impact('rocket', nearDistance / 2);
    impact('cannonball', (nearDistance + farDistance) / 2);
    impact('rocket', farDistance + 10);
    expect(engine.triggerScreenShake.mock.calls).toEqual([
      [presets.rocket.amplitude, presets.rocket.duration],
      [expect.closeTo(presets.cannon.amplitude * 0.5), presets.cannon.duration],
    ]);
    service.destroy();
  });

  it.each(['bullet', 'arrow', 'ice-shard', 'poison-glob', 'arcane-orb'])('does not shake for %s', (type) => {
    const { engine, service, impact } = setup();
    impact(type, 0);
    expect(engine.triggerScreenShake).not.toHaveBeenCalled();
    service.destroy();
  });

  it('shakes for HQ damage and boss deaths wherever the camera is', () => {
    const { eventBus, engine, service } = setup();
    eventBus.emit({ type: 'health:changed', health: 90, delta: -10 });
    eventBus.emit({ type: 'health:changed', health: 95, delta: 5 });
    eventBus.emit({ type: 'enemy:died', enemy: { typeConfig: { isBoss: false } } as never, credits: 0 });
    eventBus.emit({ type: 'enemy:died', enemy: { typeConfig: { isBoss: true } } as never, credits: 0 });
    expect(engine.triggerScreenShake.mock.calls).toEqual([
      [presets.hqDamage.amplitude, presets.hqDamage.duration],
      [presets.bossDeath.amplitude, presets.bossDeath.duration],
    ]);
    service.destroy();
  });

  it('shakes hardest for a nuclear strike, wherever it lands', () => {
    const { eventBus, engine, service } = setup();
    eventBus.emit({
      type: 'ability:impact', abilityId: 'nuclear-strike', strikeId: 1,
      target: { lat: farDistance * 5, lon: 0 }, radiusM: 25, hits: 10, kills: 4,
    });
    expect(engine.triggerScreenShake.mock.calls).toEqual([
      [presets.nuclearStrike.amplitude, presets.nuclearStrike.duration],
    ]);
    expect(presets.nuclearStrike.amplitude).toBeGreaterThan(presets.bossDeath.amplitude);
    service.destroy();
  });

  it('stays still while disabled', () => {
    const { eventBus, engine, service, impact } = setup();
    service.disable();
    impact('rocket', 0);
    eventBus.emit({ type: 'health:changed', health: 90, delta: -10 });
    expect(engine.triggerScreenShake).not.toHaveBeenCalled();

    service.enable();
    impact('rocket', 0);
    expect(engine.triggerScreenShake).toHaveBeenCalledTimes(1);
    service.destroy();
  });

  it('starts from the display options, so a new game state keeps the choice', () => {
    const { engine, service, impact } = setup({ screenShake: false });
    expect(service.enabled).toBe(false);
    impact('rocket', 0);
    expect(engine.triggerScreenShake).not.toHaveBeenCalled();
    service.destroy();
  });

  it('takes the key it used to have of its own', () => {
    localStorage.clear();
    localStorage.setItem(LEGACY_SCREEN_SHAKE_KEY, 'false');
    const service = new ScreenShakeService(new GameEventBus(), {} as ThreeTilesEngine);
    expect(service.enabled).toBe(false);
    expect(localStorage.getItem(LEGACY_SCREEN_SHAKE_KEY)).toBeNull();
    service.destroy();
  });
});
