import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import { GameEventBus } from './game-event-bus';
import { ScreenShakeService, shakeFalloff } from './screen-shake.service';
import type { ThreeTilesEngine } from '../three-engine';
import { ABILITY_IMPACT_SHAKE, ABILITY_LAUNCH_SHAKE, SCREEN_SHAKE_CONFIG } from '../configs/visual-effects.config';
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
    eventBus.emit({ type: 'enemy:died', enemy: { typeConfig: { isBoss: false } } as never, credits: 0 , killedBy: null });
    eventBus.emit({ type: 'enemy:died', enemy: { typeConfig: { isBoss: true } } as never, credits: 0 , killedBy: null });
    expect(engine.triggerScreenShake.mock.calls).toEqual([
      [presets.hqDamage.amplitude, presets.hqDamage.duration],
      [presets.bossDeath.amplitude, presets.bossDeath.duration],
    ]);
    service.destroy();
  });

  it('shakes for HQ damage at most once per interval, unless a hit costing more HP comes in', () => {
    const { eventBus, engine, service } = setup();
    const { hqDamageMinIntervalMs } = SCREEN_SHAKE_CONFIG;
    const now = vi.spyOn(performance, 'now');
    const hurt = (ms: number, delta: number) => {
      now.mockReturnValue(ms);
      eventBus.emit({ type: 'health:changed', health: 50, delta });
    };

    // An ooze flowing in at 4x: a point every 130 ms of wall time
    for (let t = 0; t < hqDamageMinIntervalMs; t += 130) hurt(1000 + t, -1);
    // A harder leak in between still shakes
    hurt(1500, -20);
    hurt(1900, -1);
    // The next point once the interval since the last shake has run
    hurt(1500 + hqDamageMinIntervalMs, -1);

    const { amplitude, duration } = presets.hqDamage;
    expect(engine.triggerScreenShake.mock.calls).toEqual([
      [amplitude * 0.5, duration],
      [amplitude * 2, duration],
      [amplitude * 0.5, duration],
    ]);
    now.mockRestore();
    service.destroy();
  });

  it('lets a hit through by the HP it costs, though its amplitude is clamped like the last one', () => {
    const { eventBus, engine, service } = setup();
    const now = vi.spyOn(performance, 'now');
    const hurt = (ms: number, delta: number) => {
      now.mockReturnValue(ms);
      eventBus.emit({ type: 'health:changed', health: 50, delta });
    };

    // 1 HP and 5 HP both shake at the floor of 0.5; the 5 HP one still comes through
    hurt(1000, -1);
    hurt(1200, -5);
    // No more than the last shake's 5 HP: held back
    hurt(1400, -5);
    hurt(1500, -3);
    hurt(1600, -6);

    const { amplitude, duration } = presets.hqDamage;
    expect(engine.triggerScreenShake.mock.calls).toEqual([
      [amplitude * 0.5, duration],
      [amplitude * 0.5, duration],
      [expect.closeTo(amplitude * 0.6), duration],
    ]);
    now.mockRestore();
    service.destroy();
  });

  it('shakes once for a worm, when its last segment dies', () => {
    const { eventBus, engine, service } = setup();
    const segment = (remaining: number) =>
      ({ typeConfig: { isBoss: true }, worm: { group: { remaining } } }) as never;
    eventBus.emit({ type: 'enemy:died', enemy: segment(40), credits: 0 , killedBy: null });
    eventBus.emit({ type: 'enemy:died', enemy: segment(1), credits: 0 , killedBy: null });
    expect(engine.triggerScreenShake).not.toHaveBeenCalled();
    eventBus.emit({ type: 'enemy:died', enemy: segment(0), credits: 0 , killedBy: null });
    expect(engine.triggerScreenShake.mock.calls).toEqual([[presets.bossDeath.amplitude, presets.bossDeath.duration]]);
    service.destroy();
  });

  it('shakes hardest and longest for a nuclear strike, fading over a range of its own', () => {
    const { eventBus, engine, service } = setup();
    const { strikeNearDistance, strikeFarDistance } = SCREEN_SHAKE_CONFIG;
    const strike = (distance: number) => eventBus.emit({
      type: 'ability:impact', abilityId: 'nuclear-strike', strikeId: 1,
      target: { lat: distance, lon: 0 }, radiusM: 25,
    });
    strike(farDistance * 3);
    strike((strikeNearDistance + strikeFarDistance) / 2);
    strike(strikeFarDistance + 10);
    expect(engine.triggerScreenShake.mock.calls).toEqual([
      [presets.nuclearStrike.amplitude, presets.nuclearStrike.duration],
      [expect.closeTo(presets.nuclearStrike.amplitude * 0.5), presets.nuclearStrike.duration],
    ]);
    // The overview camera stands about 425 m away and gets most of it
    expect(shakeFalloff(425, strikeNearDistance, strikeFarDistance)).toBeGreaterThan(0.9);
    for (const [name, preset] of Object.entries(presets)) {
      if (name === 'nuclearStrike') continue;
      expect(presets.nuclearStrike.amplitude).toBeGreaterThan(preset.amplitude);
      expect(presets.nuclearStrike.duration).toBeGreaterThan(preset.duration);
    }
    service.destroy();
  });

  it('shakes a little for a frost bomb, fading over the ability range', () => {
    const { eventBus, engine, service } = setup();
    const { abilityNearDistance, abilityFarDistance } = SCREEN_SHAKE_CONFIG;
    expect(ABILITY_IMPACT_SHAKE['frost-bomb']).toEqual({
      preset: presets.frostBomb,
      nearDistance: abilityNearDistance,
      farDistance: abilityFarDistance,
    });
    const frost = (distance: number) => eventBus.emit({
      type: 'ability:impact', abilityId: 'frost-bomb', strikeId: 1,
      target: { lat: distance, lon: 0 }, radiusM: 20,
    });
    frost(abilityNearDistance);
    frost(abilityFarDistance + 10);
    expect(engine.triggerScreenShake.mock.calls).toEqual([[presets.frostBomb.amplitude, presets.frostBomb.duration]]);
    // The overview camera stands about 425 m away and gets about half
    expect(shakeFalloff(425, abilityNearDistance, abilityFarDistance)).toBeCloseTo(0.5, 1);
    service.destroy();
  });

  it('shakes a little for an EMP, over the ability range, less than the nuclear strike', () => {
    const { eventBus, engine, service } = setup();
    expect(ABILITY_IMPACT_SHAKE['emp']).toEqual({
      preset: presets.emp,
      nearDistance: SCREEN_SHAKE_CONFIG.abilityNearDistance,
      farDistance: SCREEN_SHAKE_CONFIG.abilityFarDistance,
    });
    eventBus.emit({
      type: 'ability:impact', abilityId: 'emp', strikeId: 1,
      target: { lat: 0, lon: 0 }, radiusM: 30,
    });
    expect(engine.triggerScreenShake.mock.calls).toEqual([[presets.emp.amplitude, presets.emp.duration]]);
    expect(presets.emp.amplitude).toBeLessThan(presets.nuclearStrike.amplitude);
    service.destroy();
  });

  it('shakes harder than the EMP where the orbital laser comes down, and longer, far short of the nuke, over the ability range', () => {
    expect(ABILITY_IMPACT_SHAKE['orbital-laser']).toEqual({
      preset: presets.orbitalLaser,
      nearDistance: SCREEN_SHAKE_CONFIG.abilityNearDistance,
      farDistance: SCREEN_SHAKE_CONFIG.abilityFarDistance,
    });
    expect(presets.orbitalLaser.amplitude).toBeGreaterThan(presets.emp.amplitude);
    expect(presets.orbitalLaser.amplitude).toBeLessThan(presets.nuclearStrike.amplitude / 2);
    expect(presets.orbitalLaser.duration).toBeGreaterThan(presets.emp.duration);
    expect(presets.orbitalLaser.duration).toBeLessThan(presets.nuclearStrike.duration);
  });

  it('rumbles a little where the nuclear strike\'s missile lifts off, fading over a range of its own, far below the impact', () => {
    const { eventBus, engine, service } = setup();
    const { launchNearDistance, launchFarDistance } = SCREEN_SHAKE_CONFIG;
    expect(ABILITY_LAUNCH_SHAKE['nuclear-strike']).toEqual({
      preset: presets.missileLaunch,
      nearDistance: launchNearDistance,
      farDistance: launchFarDistance,
    });
    const used = (distance: number, abilityId: 'nuclear-strike' | 'frost-bomb' = 'nuclear-strike', launch = true) =>
      eventBus.emit({
        type: 'ability:used', abilityId, strikeId: 1,
        // The target far off, so only the launch site could shake
        target: { lat: 5000, lon: 0 }, radiusM: 25, warningMs: 6500,
        ...(launch ? { launch: { towerId: 'silo', position: { lat: distance, lon: 0 } } } : {}),
      });
    used(launchNearDistance);
    used((launchNearDistance + launchFarDistance) / 2);
    used(launchFarDistance + 10);
    used(0, 'nuclear-strike', false);
    used(0, 'frost-bomb');
    expect(engine.triggerScreenShake.mock.calls).toEqual([
      [presets.missileLaunch.amplitude, presets.missileLaunch.duration],
      [expect.closeTo(presets.missileLaunch.amplitude * 0.5), presets.missileLaunch.duration],
    ]);
    // The overview camera stands about 425 m away and gets about three quarters
    expect(shakeFalloff(425, launchNearDistance, launchFarDistance)).toBeCloseTo(0.75, 1);
    expect(presets.missileLaunch.amplitude).toBeLessThan(presets.nuclearStrike.amplitude / 3);
    service.destroy();
  });

  it('shakes by the ability that landed: one without an entry does not shake', () => {
    const { eventBus, engine, service } = setup();
    expect(ABILITY_IMPACT_SHAKE['nuclear-strike']).toEqual({
      preset: presets.nuclearStrike,
      nearDistance: SCREEN_SHAKE_CONFIG.strikeNearDistance,
      farDistance: SCREEN_SHAKE_CONFIG.strikeFarDistance,
    });
    // Stands for an ability added later; the typed table would not compile without its entry
    eventBus.emit({
      type: 'ability:impact', abilityId: 'later-ability' as never, strikeId: 1,
      target: { lat: 0, lon: 0 }, radiusM: 25,
    });
    expect(engine.triggerScreenShake).not.toHaveBeenCalled();
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
