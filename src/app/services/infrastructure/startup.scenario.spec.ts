/**
 * Logic of playtest 163 and 176 of night 1 (docs/archive/REVIEW_SPRINT_2026-09-13.md)
 * replayed.
 *
 * 163: the init banners of the particle pools and the flame beam are gone,
 *      so are the per-event lines of the tower fire, and with ?devworld the
 *      camera rig's [DevWorld] lines (75f76586, 1f7c867f). The renderers and
 *      the camera rig are built as the engine builds them, console.log
 *      watched. Since f0e547db the camera timeline logs one [Camera] line per
 *      camera setter (utils/camera-timeline.ts), the rig's start pose among
 *      them; that is a later, deliberate line, not one of the old. Only in
 *      the code: the engine's own DevWorld lines (three-tiles-engine.ts needs
 *      WebGL). [Tiles], [Warmup] and [Corridor] staying and the Fire Tower
 *      effects are the user's; Load ONNX without a TypeError is
 *      wave-director.service.spec.ts ("opts into the ONNX policy ...").
 * 176: the loading screen names "Preparing Intro Flight" as its last step, on
 *      the first load and after a location change (resetLoadingSteps). That
 *      the screen holds until the intro route is ready is
 *      visualization-facade.service.spec.ts ("holds the loading screen on the
 *      first load until the intro route is ready").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene, Texture, Vector3 } from 'three';

// jsdom has no 2D canvas for the sprite atlases, as in particle-effects-renderer.spec.ts
vi.mock('../../three-engine/renderers/sprite-atlas-generator', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateExplosionAtlas: () => new Texture(),
  generateSmokeAtlas: () => new Texture(),
}));
// The controls need pointer events and a real tileset, as in camera-rig.spec.ts
vi.mock('3d-tiles-renderer', async (importOriginal) => {
  class FakeControls {
    enableDamping = false;
    enableDoubleTapZoom = true;
    minDistance = 0;
    maxDistance = Infinity;
    minAltitude = 0;
    maxAltitude = Math.PI;
    setScene = vi.fn();
    setEllipsoid = vi.fn();
    update = vi.fn();
    dispose = vi.fn();
  }
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    EnvironmentControls: class EnvironmentControls extends FakeControls {},
    GlobeControls: class GlobeControls extends FakeControls {},
  };
});

import { Injector, NgZone, runInInjectionContext } from '@angular/core';
import { ParticlePoolManager } from '../../three-engine/renderers/particle-pool-manager';
import { ParticleEffectsRenderer } from '../../three-engine/renderers/particle-effects-renderer';
import { EnvironmentEffectsRenderer } from '../../three-engine/renderers/environment-effects-renderer';
import { ThreeFlameBeamRenderer } from '../../three-engine/renderers/three-flame-beam.renderer';
import { CameraRig } from '../../three-engine/camera-rig';
import type { CoordinateSync } from '../../three-engine/renderers/index';
import { EngineInitializationService } from './engine-initialization.service';

/** Hands the NgZone a pass-through and every other service an empty object: the steps need none of them */
class StubInjector extends Injector {
  override get(token: unknown): unknown {
    return token === NgZone ? { run: (fn: () => unknown) => fn() } : {};
  }
}

describe('Startup, logic of playtest 163 and 176 (night 1) replayed', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('163: particle pools, effects, tower fire and flame beam start without a console line', () => {
    const scene = new Scene();
    const sync = { geoToLocal: () => new Vector3() } as unknown as CoordinateSync;
    const pools = new ParticlePoolManager(scene);
    new ParticleEffectsRenderer(scene, sync, pools);
    const environment = new EnvironmentEffectsRenderer(sync, pools);
    new ThreeFlameBeamRenderer();

    // A Fire Tower's inner fire, started and stopped
    environment.spawnTowerInnerFire('t1', new Vector3(), 3, 0.1);
    expect(environment.hasTowerFire('t1')).toBe(true);
    environment.stopTowerInnerFire('t1');

    expect(log).not.toHaveBeenCalled();
  });

  it('163: with ?devworld the camera rig sets its controls up without its old [DevWorld] lines', () => {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('tabindex', '0');
    const rig = new CameraRig(new PerspectiveCamera(60, 16 / 9, 1, 8000), canvas);
    rig.setupEnvironmentControls(new Scene(), new Group());
    expect(rig.getControls()).not.toBeNull();
    // The removed lines all began with [DevWorld]; the camera timeline's [Camera] entries stay
    const lines: string[] = log.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(lines.filter((line) => line.startsWith('[DevWorld]'))).toEqual([]);
    expect(lines.every((line) => line === '[Camera]')).toBe(true);
  });

  it('176: "Preparing Intro Flight" is the last loading step, also after a location change', () => {
    const init = runInInjectionContext(new StubInjector(), () => new EngineInitializationService());
    const titles = () => init.loadingSteps().map((s) => s.title);
    expect(titles().at(-1)).toBe('Preparing Intro Flight');

    // A location change starts the list again, the location step kept once it is done
    init.loadingSteps.update((steps) => [{ id: 'location', title: 'Determining Location', status: 'done' as const }, ...steps]);
    init.resetLoadingSteps();
    expect(titles()[0]).toBe('Determining Location');
    expect(init.loadingSteps()[0].status).toBe('done');
    expect(titles().at(-1)).toBe('Preparing Intro Flight');
    expect(titles().filter((t) => t === 'Preparing Intro Flight')).toHaveLength(1);
  });
});
