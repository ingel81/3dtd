import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HqDamagePresenter } from './hq-damage-presenter';
import { createMainEventBus, type MainEventBus } from '../sim/client/view-events';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { TIMING } from '../configs/timing.config';
import { GAME_SOUNDS } from '../configs/audio.config';
import type { GeoPosition } from '../models/game.types';

const FULL_HEALTH = GAME_BALANCE.player.startHealth;
const FIRE_THRESHOLD = GAME_BALANCE.fire.permanentThreshold;
const BASE: GeoPosition = { lat: 48.0, lon: 9.0, height: 0 };

function makeEngine(opts: { terrainHeight?: number | null; withAudio?: boolean; originHeight?: number } = {}) {
  return {
    effects: {
      stopFire: vi.fn(),
      stopFireImmediate: vi.fn(),
      spawnFireFlash: vi.fn(),
      spawnScaledFire: vi.fn<(lat: number, lon: number, localY: number, scale: number) => string>(() => 'fire-id-1'),
      spawnHQExplosion: vi.fn(),
      stopAllFires: vi.fn(),
      spawnFloatingText: vi.fn(),
    },
    spatialAudio: opts.withAudio === false ? null : { registerSound: vi.fn(), playAtGeo: vi.fn(() => Promise.resolve(null)) },
    sync: { getOrigin: () => ({ lat: 48.0, lon: 9.0, height: opts.originHeight ?? 0 }) },
    // null is a meaningful value (terrain not loaded yet)
    getTerrainHeightAtGeo: vi.fn(() => (opts.terrainHeight === undefined ? 0 : opts.terrainHeight)),
  };
}

describe('HqDamagePresenter', () => {
  let bus: MainEventBus;

  beforeEach(() => {
    bus = createMainEventBus();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function make(engine = makeEngine()) {
    const hq = new HqDamagePresenter(engine as never, bus);
    hq.setBase(BASE);
    return { hq, engine };
  }

  it('registers the HQ damage sound, and does without audio', () => {
    const { engine } = make();
    expect(engine.spatialAudio!.registerSound).toHaveBeenCalledWith(
      GAME_SOUNDS.hqDamage.id,
      GAME_SOUNDS.hqDamage.url,
      expect.objectContaining({ audibleDistance: GAME_SOUNDS.hqDamage.audibleDistance }),
    );
    expect(() => make(makeEngine({ withAudio: false }))).not.toThrow();
  });

  it('plays the damage sound on the ground under the HQ, as a geo height, throttled', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000);
    // Ground at local y 180, the local frame's origin 20 m above the ellipsoid
    const { engine } = make(makeEngine({ terrainHeight: 180, originHeight: 20 }));
    bus.emit({ type: 'health:changed', health: 90, delta: -10 });
    now.mockReturnValue(10_050);
    bus.emit({ type: 'health:changed', health: 80, delta: -10 });
    now.mockReturnValue(10_200);
    bus.emit({ type: 'health:changed', health: 70, delta: -10 });
    expect(engine.spatialAudio!.playAtGeo.mock.calls).toEqual([
      [GAME_SOUNDS.hqDamage.id, BASE.lat, BASE.lon, 200],
      [GAME_SOUNDS.hqDamage.id, BASE.lat, BASE.lon, 200],
    ]);
  });

  it('shows the leak over the HQ, but not a cheat and not a heal', () => {
    const { engine } = make(makeEngine({ terrainHeight: 10 }));
    bus.emit({ type: 'health:changed', health: 96, delta: -4 });
    bus.emit({ type: 'health:changed', health: 90, delta: -6, cause: 'cheat' });
    bus.emit({ type: 'health:changed', health: FULL_HEALTH, delta: 10 });
    expect(engine.effects.spawnFloatingText).toHaveBeenCalledTimes(1);
    expect(engine.effects.spawnFloatingText.mock.calls[0][0]).toBe('−4');
  });

  it('grows the fire with the damage: none at full health, a flash above the threshold, a lasting fire below', () => {
    const { hq, engine } = make();
    hq.updateFireIntensity(FULL_HEALTH);
    expect(engine.effects.spawnFireFlash).not.toHaveBeenCalled();
    expect(engine.effects.spawnScaledFire).not.toHaveBeenCalled();

    hq.updateFireIntensity((FIRE_THRESHOLD + FULL_HEALTH) / 2);
    expect(engine.effects.spawnFireFlash).toHaveBeenCalledTimes(1);

    hq.updateFireIntensity(FIRE_THRESHOLD / 2);
    expect(engine.effects.spawnScaledFire.mock.calls[0][3]).toBeCloseTo(0.5);

    hq.updateFireIntensity(FULL_HEALTH);
    expect(engine.effects.stopFire).toHaveBeenCalledWith('fire-id-1');
  });

  it('keeps the ground under the HQ once the tiles are in', () => {
    const engine = makeEngine({ terrainHeight: 142.5 });
    const { hq } = make(engine);
    hq.onTilesLoaded();
    engine.getTerrainHeightAtGeo.mockReturnValue(null);
    hq.updateFireIntensity(FIRE_THRESHOLD / 2);
    expect(engine.effects.spawnScaledFire.mock.calls[0][2]).toBe(142.5);
  });

  it('explodes and burns at full size on game:over, the screen after its delay; a reset cancels it', () => {
    vi.useFakeTimers();
    const { hq, engine } = make(makeEngine({ terrainHeight: 10 }));
    bus.emit({ type: 'game:over', reason: 'base-destroyed' });
    expect(engine.effects.spawnHQExplosion).toHaveBeenCalled();
    expect(engine.effects.spawnScaledFire).toHaveBeenCalledWith(BASE.lat, BASE.lon, 10, 1.0);
    expect(hq.showGameOverScreen()).toBe(false);
    vi.advanceTimersByTime(TIMING.gameOverScreenDelay);
    expect(hq.showGameOverScreen()).toBe(true);

    bus.emit({ type: 'game:over', reason: 'base-destroyed' });
    bus.emit({ type: 'game:reset' });
    vi.advanceTimersByTime(TIMING.gameOverScreenDelay * 2);
    expect(hq.showGameOverScreen()).toBe(false);
    expect(engine.effects.stopAllFires).toHaveBeenCalled();
  });

  it('puts every fire out on healBase, and hears nothing after destroy', () => {
    const { hq, engine } = make();
    hq.updateFireIntensity(FIRE_THRESHOLD / 2);
    hq.healBase();
    expect(engine.effects.stopAllFires).toHaveBeenCalled();
    hq.destroy();
    expect(bus.getListenerCount('health:changed')).toBe(0);
  });
});
