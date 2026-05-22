import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Injectable decorator → no-op. `signal` is passed through from the real
// module (it works standalone, no Angular platform needed).
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
  };
});

import { HQDamageService } from './hq-damage.service';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { GAME_BALANCE } from '../../configs/game-balance.config';
import { TIMING } from '../../configs/timing.config';
import { GAME_SOUNDS } from '../../configs/audio.config';
import type { GeoPosition } from '../../models/game.types';

const FULL_HEALTH = GAME_BALANCE.player.startHealth;     // 100
const FIRE_THRESHOLD = GAME_BALANCE.fire.permanentThreshold; // 50

/** Stub of ThreeTilesEngine.effects — every method the service may call. */
function makeEffects() {
  return {
    stopFire: vi.fn(),
    stopFireImmediate: vi.fn(),
    spawnFireFlash: vi.fn(),
    spawnScaledFire: vi.fn(() => 'fire-id-1'),
    spawnHQExplosion: vi.fn(),
    stopAllFires: vi.fn(),
    spawnDebugSphere: vi.fn(),
  };
}

/** Stub of ThreeTilesEngine — only the surface HQDamageService touches. */
function makeEngine(opts: { terrainHeight?: number | null; withAudio?: boolean } = {}) {
  return {
    effects: makeEffects(),
    spatialAudio: opts.withAudio === false ? null : { registerSound: vi.fn() },
    // null is a meaningful return value (terrain not yet loaded) — preserve it.
    getTerrainHeightAtGeo: vi.fn(() =>
      opts.terrainHeight === undefined ? 0 : opts.terrainHeight,
    ),
  };
}

const BASE_POS: GeoPosition = { lat: 48.0, lon: 9.0, height: 0 };

describe('HQDamageService', () => {
  let service: HQDamageService;
  let bus: GameEventBus;

  beforeEach(() => {
    service = new HQDamageService();
    bus = new GameEventBus();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ────────────────────────────────────────────────────────────────
  // initialize
  // ────────────────────────────────────────────────────────────────
  describe('initialize', () => {
    it('registers the HQ damage sound when spatial audio is available', () => {
      const engine = makeEngine();
      service.initialize(engine as never, BASE_POS, bus);
      expect(engine.spatialAudio!.registerSound).toHaveBeenCalledWith(
        GAME_SOUNDS.hqDamage.id,
        GAME_SOUNDS.hqDamage.url,
        expect.any(Object),
      );
    });

    it('does not throw when spatial audio is unavailable', () => {
      const engine = makeEngine({ withAudio: false });
      expect(() => service.initialize(engine as never, BASE_POS, bus)).not.toThrow();
    });

    it('subscribes exactly one health:changed listener', () => {
      service.initialize(makeEngine() as never, BASE_POS, bus);
      expect(bus.getListenerCount('health:changed')).toBe(1);
    });

    it('disposes the previous subscription on re-init (no listener leak)', () => {
      service.initialize(makeEngine() as never, BASE_POS, bus);
      service.initialize(makeEngine() as never, BASE_POS, bus);
      expect(bus.getListenerCount('health:changed')).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // health:changed handler
  // ────────────────────────────────────────────────────────────────
  describe('health:changed event handling', () => {
    it('updates fire + queues a damage sound when health drops', () => {
      const engine = makeEngine();
      service.initialize(engine as never, BASE_POS, bus);
      bus.emit({ type: 'health:changed', health: 40, delta: -10 });
      // 40 < threshold(50) → permanent scaled fire
      expect(engine.effects.spawnScaledFire).toHaveBeenCalled();
      // damage sound is emitted deferred
      expect(bus.getQueueSize()).toBe(1);
    });

    it('does not queue a damage sound when health increases (heal)', () => {
      const engine = makeEngine();
      service.initialize(engine as never, BASE_POS, bus);
      bus.emit({ type: 'health:changed', health: FULL_HEALTH, delta: +20 });
      expect(bus.getQueueSize()).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // updateFireIntensity
  // ────────────────────────────────────────────────────────────────
  describe('updateFireIntensity', () => {
    let engine: ReturnType<typeof makeEngine>;

    beforeEach(() => {
      engine = makeEngine();
      service.initialize(engine as never, BASE_POS, bus);
    });

    it('spawns no fire at full health', () => {
      service.updateFireIntensity(FULL_HEALTH);
      expect(engine.effects.spawnFireFlash).not.toHaveBeenCalled();
      expect(engine.effects.spawnScaledFire).not.toHaveBeenCalled();
    });

    it('shows a brief fire flash between threshold and full health', () => {
      // 75 sits between threshold(50) and startHealth(100)
      service.updateFireIntensity((FIRE_THRESHOLD + FULL_HEALTH) / 2);
      expect(engine.effects.spawnFireFlash).toHaveBeenCalled();
      expect(engine.effects.spawnScaledFire).not.toHaveBeenCalled();
    });

    it('spawns a permanent scaled fire at/below the threshold', () => {
      // half the threshold → scale = 1 - (25/50) = 0.5
      service.updateFireIntensity(FIRE_THRESHOLD / 2);
      expect(engine.effects.spawnScaledFire).toHaveBeenCalled();
      const scaleArg = engine.effects.spawnScaledFire.mock.calls[0][3];
      expect(scaleArg).toBeCloseTo(0.5);
    });

    it('stops the active fire once health is restored to full', () => {
      service.updateFireIntensity(FIRE_THRESHOLD / 2); // active fire
      service.updateFireIntensity(FULL_HEALTH);        // full → stop it
      expect(engine.effects.stopFire).toHaveBeenCalledWith('fire-id-1');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // playDamageSound — throttled
  // ────────────────────────────────────────────────────────────────
  describe('playDamageSound', () => {
    it('emits a deferred audio:play event', () => {
      service.initialize(makeEngine() as never, BASE_POS, bus);
      vi.spyOn(performance, 'now').mockReturnValue(10_000);
      service.playDamageSound();
      expect(bus.getQueueSize()).toBe(1);
    });

    it('throttles repeated calls within the cooldown window', () => {
      service.initialize(makeEngine() as never, BASE_POS, bus);
      const nowSpy = vi.spyOn(performance, 'now');
      nowSpy.mockReturnValue(10_000);
      service.playDamageSound();
      nowSpy.mockReturnValue(10_050); // +50ms, inside the 150ms cooldown
      service.playDamageSound();
      expect(bus.getQueueSize()).toBe(1); // second call suppressed
    });

    it('allows another sound once the cooldown elapses', () => {
      service.initialize(makeEngine() as never, BASE_POS, bus);
      const nowSpy = vi.spyOn(performance, 'now');
      nowSpy.mockReturnValue(10_000);
      service.playDamageSound();
      nowSpy.mockReturnValue(10_200); // +200ms, past the cooldown
      service.playDamageSound();
      expect(bus.getQueueSize()).toBe(2);
    });

    it('is a no-op before initialization', () => {
      expect(() => service.playDamageSound()).not.toThrow();
      expect(bus.getQueueSize()).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // onTilesLoaded / getHqTerrainHeight
  // ────────────────────────────────────────────────────────────────
  describe('onTilesLoaded / getHqTerrainHeight', () => {
    it('caches the HQ terrain height from the engine', () => {
      const engine = makeEngine({ terrainHeight: 142.5 });
      service.initialize(engine as never, BASE_POS, bus);
      expect(service.getHqTerrainHeight()).toBeNull();
      service.onTilesLoaded();
      expect(service.getHqTerrainHeight()).toBe(142.5);
    });

    it('leaves the height null when the engine returns null', () => {
      const engine = makeEngine({ terrainHeight: null });
      service.initialize(engine as never, BASE_POS, bus);
      service.onTilesLoaded();
      expect(service.getHqTerrainHeight()).toBeNull();
    });

    it('is a no-op before initialization', () => {
      expect(() => service.onTilesLoaded()).not.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // triggerGameOverEffects
  // ────────────────────────────────────────────────────────────────
  describe('triggerGameOverEffects', () => {
    it('spawns the explosion plus a max-intensity inferno', () => {
      const engine = makeEngine({ terrainHeight: 10 });
      service.initialize(engine as never, BASE_POS, bus);
      service.onTilesLoaded();
      service.triggerGameOverEffects();
      expect(engine.effects.spawnHQExplosion).toHaveBeenCalled();
      expect(engine.effects.spawnScaledFire).toHaveBeenCalledWith(
        BASE_POS.lat, BASE_POS.lon, 10, 1.0,
      );
    });

    it('shows the game-over screen + runs onComplete after the delay', () => {
      vi.useFakeTimers();
      service.initialize(makeEngine() as never, BASE_POS, bus);
      const onComplete = vi.fn();
      service.triggerGameOverEffects(onComplete);

      expect(service.showGameOverScreen()).toBe(false);
      expect(onComplete).not.toHaveBeenCalled();

      vi.advanceTimersByTime(TIMING.gameOverScreenDelay);

      expect(service.showGameOverScreen()).toBe(true);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('runs onComplete immediately when not initialized', () => {
      const onComplete = vi.fn();
      service.triggerGameOverEffects(onComplete);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // healBase
  // ────────────────────────────────────────────────────────────────
  describe('healBase', () => {
    it('stops all fires', () => {
      const engine = makeEngine();
      service.initialize(engine as never, BASE_POS, bus);
      service.updateFireIntensity(FIRE_THRESHOLD / 2); // light a fire
      service.healBase();
      expect(engine.effects.stopAllFires).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // reset
  // ────────────────────────────────────────────────────────────────
  describe('reset', () => {
    it('clears the pending game-over timeout', () => {
      vi.useFakeTimers();
      service.initialize(makeEngine() as never, BASE_POS, bus);
      const onComplete = vi.fn();
      service.triggerGameOverEffects(onComplete);

      service.reset();
      vi.advanceTimersByTime(TIMING.gameOverScreenDelay * 2);

      expect(onComplete).not.toHaveBeenCalled();          // timeout was cancelled
      expect(service.showGameOverScreen()).toBe(false);
    });

    it('clears cached terrain height, fires and the game-over signal', () => {
      const engine = makeEngine({ terrainHeight: 50 });
      service.initialize(engine as never, BASE_POS, bus);
      service.onTilesLoaded();
      service.showGameOverScreen.set(true);

      service.reset();

      expect(engine.effects.stopAllFires).toHaveBeenCalled();
      expect(service.getHqTerrainHeight()).toBeNull();
      expect(service.showGameOverScreen()).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // spawnDebugPoint
  // ────────────────────────────────────────────────────────────────
  describe('spawnDebugPoint', () => {
    it('spawns a debug sphere once the terrain height is cached', () => {
      const engine = makeEngine({ terrainHeight: 30 });
      service.initialize(engine as never, BASE_POS, bus);
      service.onTilesLoaded();
      service.spawnDebugPoint();
      expect(engine.effects.spawnDebugSphere).toHaveBeenCalled();
    });

    it('is a no-op while the terrain height is still unknown', () => {
      const engine = makeEngine({ terrainHeight: 30 });
      service.initialize(engine as never, BASE_POS, bus);
      service.spawnDebugPoint(); // onTilesLoaded never called
      expect(engine.effects.spawnDebugSphere).not.toHaveBeenCalled();
    });
  });
});
