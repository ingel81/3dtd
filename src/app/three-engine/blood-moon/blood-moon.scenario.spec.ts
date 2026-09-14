import { describe, expect, it } from 'vitest';
import { Fog, Scene, Vector3, type BufferAttribute, type InstancedBufferGeometry, type Mesh } from 'three';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { BloodMoonService } from '../../game-engine/blood-moon.service';
import { BloodMoonLook } from './blood-moon-look';
import { BloodMoonMood } from './blood-moon-mood';
import { SearchlightRenderer, searchlightLampHeight } from '../renderers/searchlight/searchlight.renderer';
import { BLOOD_MOON_LOOK } from '../../configs/blood-moon.config';
import { TOWER_TYPES } from '../../configs/tower-types.config';

const { fadeInMs, fadeOutMs } = BLOOD_MOON_LOOK;

/** lat → x, lon → z, height → y, so the lamp reads back as given */
const sync: ConstructorParameters<typeof SearchlightRenderer>[1] = {
  geoToLocal: (lat, lon, height) => new Vector3(lat, height, lon),
  geoToLocalSimple: (lat, lon, height) => new Vector3(lat, height, lon),
  geoToLocalSimpleInto: (lat, lon, height, target) => target.set(lat, height, lon),
};

/**
 * Night-2 playtest 373 to 375 (docs/REVIEW_SPRINT_2026-09-14.md), the logic
 * parts, replayed on the real chain: BloodMoonService on the event bus
 * switches the real BloodMoonLook, which drives the real mood quad and the
 * real searchlights. frame() hands the look what ThreeTilesEngine.animate()
 * hands it: wall time, and whether the renderer timescale is above 0
 * (GameStateManager sets it to 0 while paused). Since 6a42d3a5 a cone
 * points where its turret aims (searchlight.renderer.spec.ts); the sweep of
 * the night-2 list is gone.
 */
describe('Blood moon, night-2 playtest 373 to 375 replayed', () => {
  function setup() {
    const bus = new GameEventBus();
    const scene = new Scene();
    scene.fog = new Fog(0x1a1f25, 2000, 6000);
    const headings = new Map<string, number>();
    const searchlights = new SearchlightRenderer(scene, sync, { aimHeading: (id) => headings.get(id) ?? null });
    const mood = new BloodMoonMood(scene);
    const look = new BloodMoonLook({ mood, searchlights });
    new BloodMoonService(bus, look);
    const beams = scene.getObjectByName('searchlights') as Mesh;
    const frame = (wallMs: number, timescale: number) => look.update(wallMs, timescale > 0, false);
    /** `ms` of wall clock in 16 ms frames at `timescale` */
    const play = (ms: number, timescale: number) => {
      for (let t = 0; t < ms; t += 16) frame(Math.min(16, ms - t), timescale);
    };
    const waveStarts = (wave: number) => bus.emit({ type: 'wave:started', wave, enemyCount: 20 });
    const waveEnds = (wave: number) =>
      bus.emit({ type: 'wave:completed', wave, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
    return { bus, headings, searchlights, mood, look, beams, frame, play, waveStarts, waveEnds };
  }

  it('373: W14 lights the archer on its plinth from above the plinth top, the Research Center gets no cone', () => {
    const { headings, searchlights, beams, play, waveStarts } = setup();
    headings.set('archer', 0.3);
    headings.set('lab', 0.3);
    // TowerManager.placeTower hands the foot, position.height, which is the plinth's top
    searchlights.add('archer', 10, 20, 107.5, TOWER_TYPES.archer);
    searchlights.add('lab', 30, 40, 100, TOWER_TYPES['research-center']);
    expect(searchlights.count).toBe(1);
    const lamp = (beams.geometry as InstancedBufferGeometry).getAttribute('aLamp') as BufferAttribute;
    expect(lamp.getY(0)).toBeCloseTo(107.5 + searchlightLampHeight(TOWER_TYPES.archer)!);
    expect(beams.visible).toBe(false);

    waveStarts(14);
    play(fadeInMs, 1);
    expect(beams.visible).toBe(true);
    expect(searchlights.count).toBe(1);
  });

  it('374: the fade takes 3 s of wall time at 4x as at 1x, stands in the pause, and goes out in 4.5 s after the wave', () => {
    const { mood, look, play, waveStarts, waveEnds } = setup();
    waveStarts(13);
    play(fadeInMs, 4);
    expect(look.amount).toBe(0);

    waveStarts(14);
    play(fadeInMs / 2, 4);
    const half = look.amount;
    expect(half).toBeCloseTo(0.5);
    expect(mood.visible).toBe(true);

    // P in the middle of the fade
    play(10_000, 0);
    expect(look.amount).toBe(half);
    // On without a jump, done after the rest of the 3 s
    play(16, 4);
    expect(look.amount).toBeGreaterThan(half);
    expect(look.amount).toBeLessThan(0.52);
    play(fadeInMs / 2 - 32, 4);
    expect(look.amount).toBeLessThan(1);
    play(16, 4);
    expect(look.amount).toBe(1);

    waveEnds(14);
    play(fadeOutMs - 100, 4);
    expect(look.amount).toBeGreaterThan(0);
    play(100, 4);
    // 4.5 s of 16 ms steps leave a float residue in the progress (about
    // 1e-29 eased); the next step clamps it to 0 and the quad leaves the list
    expect(look.amount).toBeLessThan(1e-6);
    play(16, 4);
    expect(look.amount).toBe(0);
    expect(mood.visible).toBe(false);
  });

  it('375: switching the look off in W14 takes it and the cones away at once, on again fades them back in', () => {
    const { headings, searchlights, mood, look, beams, frame, play, waveStarts } = setup();
    headings.set('archer', 0);
    searchlights.add('archer', 0, 0, 100, TOWER_TYPES.archer);
    waveStarts(14);
    play(fadeInMs, 1);
    expect(beams.visible).toBe(true);

    // ThreeTilesEngine.applyVfxSettings hands VfxSettings.bloodMoon to setEnabled
    look.setEnabled(false);
    expect(look.amount).toBe(0);
    frame(16, 1);
    expect(mood.visible).toBe(false);
    expect(beams.visible).toBe(false);

    look.setEnabled(true);
    play(fadeInMs, 1);
    expect(look.amount).toBe(1);
    expect(beams.visible).toBe(true);
  });

  it('375: a restart in W14 drops the look at once, without the fade-out', () => {
    const { bus, headings, searchlights, mood, look, beams, frame, play, waveStarts } = setup();
    headings.set('archer', 0);
    searchlights.add('archer', 0, 0, 100, TOWER_TYPES.archer);
    waveStarts(14);
    play(fadeInMs, 1);

    bus.emit({ type: 'game:reset' });
    frame(16, 1);
    expect(look.amount).toBe(0);
    expect(mood.visible).toBe(false);
    expect(beams.visible).toBe(false);
  });
});
