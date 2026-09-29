import { describe, it, expect, vi, afterEach } from 'vitest';
import { Object3D, PerspectiveCamera, Scene } from 'three';

/**
 * Playtest 649: the HQ damage sound was missing where the location came up
 * at boot and there after a location change. HqDamagePresenter and
 * SpatialAudioManager are real, with the real distance culling; only Web
 * Audio is faked (jsdom has none). The HP come as health:changed on the main
 * bus, as the simulation's BaseHealthLedger sends them for a leak and for the
 * debug "+HP" right click (a cheat).
 *
 * The camera stands in its start pose over the HQ ground (CameraRig: 400 m
 * up, 145 m south, 425 m away). Boot and location change set the HQ up in
 * their own order; what decided whether the sound was heard was
 * the height of the ground under the HQ: the sound played at height 0, on
 * the ellipsoid, and at 180 m of ground it lay 598 m from the camera.
 */

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  const param = () => ({ setValueAtTime: vi.fn() });

  class AudioListener extends three.Object3D {
    gain = { connect: vi.fn(), disconnect: vi.fn() };
    context = {
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => undefined),
      createGain: () => ({ gain: param(), connect: vi.fn() }),
      createDynamicsCompressor: () => ({
        threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect: vi.fn(),
      }),
    };
  }

  class AudioBase extends three.Object3D {
    isPlaying = false;
    buffer: { duration: number } | null = null;
    setBuffer(b: { duration: number }) { this.buffer = b; return this; }
    setVolume() { return this; }
    setLoop() { return this; }
    setRefDistance() { return this; }
    setRolloffFactor() { return this; }
    setDistanceModel() { return this; }
    setMaxDistance() { return this; }
    play() { this.isPlaying = true; return this; }
    pause() { this.isPlaying = false; return this; }
    stop() { this.isPlaying = false; return this; }
    disconnect() { return this; }
  }

  class AudioLoader {
    load(_url: string, onLoad: (b: { duration: number }) => void) {
      onLoad({ duration: 1.2 });
    }
  }

  return { ...three, AudioListener, PositionalAudio: AudioBase, Audio: AudioBase, AudioLoader };
});

import { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import { GameEventBus } from '../game-engine/game-event-bus';
import { createMainEventBus, type MainEventBus } from '../sim/client/view-events';
import { HqDamagePresenter } from './hq-damage-presenter';
import { EllipsoidSync } from '../three-engine/ellipsoid-sync';
import { GAME_SOUNDS } from '../configs/audio.config';
import type { GeoPosition } from '../models/game.types';

const FIRST: GeoPosition = { lat: 50.0212, lon: 9.1587 };
const SECOND: GeoPosition = { lat: 53.5511, lon: 9.9937 };

/** A leak reaching the base and the debug "+HP" right click (-10 HP) */
const HITS: [string, (bus: MainEventBus) => void][] = [
  ['a leak', (bus) => bus.emit({ type: 'health:changed', health: 490, delta: -10 })],
  ['the +HP right click', (bus) => bus.emit({ type: 'health:changed', health: 490, delta: -10, cause: 'cheat' })],
];

/** Engine, audio and the HQ the way the PresentationHost wires them. */
function world() {
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const audio = new SpatialAudioManager(scene, camera);
  const sync = new EllipsoidSync(FIRST.lat, FIRST.lon, 0);
  audio.setGeoToLocal((lat, lon, height, target) => sync.geoToLocalSimpleInto(lat, lon, height, target));
  // The audio manager reports to a bus of its own
  const debugBus = new GameEventBus();
  audio.setEventBus(debugBus);
  const bus = createMainEventBus();
  const culled: string[] = [];
  debugBus.on('debug:sound', (e) => {
    if (e.eventType === 'distance_culled') culled.push(e.soundId);
  });

  let groundY = 0;
  const engine = {
    spatialAudio: audio,
    sync,
    effects: {
      stopFire: vi.fn(), stopFireImmediate: vi.fn(), spawnFireFlash: vi.fn(),
      spawnScaledFire: vi.fn(() => 'fire'), stopAllFires: vi.fn(), spawnHQExplosion: vi.fn(),
      spawnFloatingText: vi.fn(),
    },
    getTerrainHeightAtGeo: () => groundY,
  };
  const hq = new HqDamagePresenter(engine as never, bus);

  /** The tiles of a place: its ground at the HQ and the camera's start pose over it. */
  const arrive = (ground: number) => {
    groundY = ground;
    camera.position.set(0, ground + 400, -145);
    camera.updateMatrixWorld();
  };
  return {
    scene, camera, audio, culled, hq,
    /** Boot: the engine is built at the place, the game state initialised once. */
    boot(ground: number) {
      arrive(ground);
      hq.setBase(FIRST);
      hq.onTilesLoaded();
    },
    /**
     * Location change (LocationChangeExecutor): the game is reset, the
     * origin moves, the HQ is set up again at the new place.
     */
    changeLocation(firstGround: number, ground: number) {
      this.boot(firstGround);
      bus.emit({ type: 'game:reset' });
      sync.setOrigin(SECOND.lat, SECOND.lon);
      arrive(ground);
      hq.setBase(SECOND);
      hq.onTilesLoaded();
    },
    /** One hit: the async playback done, then its deferred debug:sound (a culled sound says so there). */
    async hit(apply: (bus: MainEventBus) => void) {
      await audio.getBuffer(GAME_SOUNDS.hqDamage.id);
      apply(bus);
      await new Promise((resolve) => setTimeout(resolve, 0));
      debugBus.processQueue();
    },
    dispose() {
      hq.destroy();
      audio.dispose();
    },
  };
}

/** The sound sources in the scene: containers holding a positional audio. */
function sources(scene: Scene): Object3D[] {
  return scene.children.filter((c) => c.children.length === 1);
}

describe('HQ damage sound (playtest 649)', () => {
  let w: ReturnType<typeof world> | null = null;

  afterEach(() => {
    w?.dispose();
    w = null;
    vi.restoreAllMocks();
  });

  for (const ground of [30, 180]) {
    for (const [what, apply] of HITS) {
      it(`is heard from the start camera after ${what}, location loaded at boot, HQ ground ${ground} m`, async () => {
        vi.spyOn(performance, 'now').mockReturnValue(10_000);
        w = world();
        w.boot(ground);

        await w.hit(apply);

        expect(w.culled).toEqual([]);
        expect(w.audio.isPlaying(GAME_SOUNDS.hqDamage.id)).toBe(true);
        expect(sources(w.scene).map((c) => c.position.y)).toEqual([ground]);
      });

      it(`is heard from the start camera after ${what}, after a location change, HQ ground ${ground} m`, async () => {
        vi.spyOn(performance, 'now').mockReturnValue(10_000);
        w = world();
        w.changeLocation(ground === 30 ? 180 : 30, ground);

        await w.hit(apply);

        expect(w.culled).toEqual([]);
        expect(w.audio.isPlaying(GAME_SOUNDS.hqDamage.id)).toBe(true);
        expect(sources(w.scene).map((c) => c.position.y)).toEqual([ground]);
      });
    }
  }

  /** The camera `distance` m from the HQ ground, at the start pose's angle. */
  const zoomOut = (at: ReturnType<typeof world>, ground: number, distance: number) => {
    const k = distance / 425;
    at.camera.position.set(0, ground + 400 * k, -145 * k);
    at.camera.updateMatrixWorld();
  };

  it('is heard from a wide overview 1000 m away, beyond the common 500 m', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(10_000);
    w = world();
    w.boot(180);
    zoomOut(w, 180, 1000);

    await w.hit(HITS[0][1]);

    expect(w.culled).toEqual([]);
    expect(w.audio.isPlaying(GAME_SOUNDS.hqDamage.id)).toBe(true);
  });

  it('is culled beyond its own audible distance of 1500 m', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(10_000);
    w = world();
    w.boot(180);
    zoomOut(w, 180, 1600);

    await w.hit(HITS[0][1]);

    expect(w.culled).toEqual([GAME_SOUNDS.hqDamage.id]);
    expect(w.audio.isPlaying(GAME_SOUNDS.hqDamage.id)).toBe(false);
  });
});
