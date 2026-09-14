/**
 * Playtest 219 of night 1 (docs/REVIEW_SPRINT_2026-09-13.md) replayed: P
 * right after the impact freezes the flash and the cloud, after P it goes
 * on; at a higher speed everything runs faster.
 *
 * The engine hands the clouds game time (three-tiles-engine.ts:987): a
 * paused frame is 0 ms, a frame at 4x four times its wall time.
 * mushroom-cloud.renderer.spec.ts already holds glow and smoke still in a
 * pause and plays one long frame like many short ones; this pins the parts
 * of the moment of detonation on top: the flash sprite, the screen flash,
 * the shock dome, the shockwave ring and the bloom kick. The real renderer,
 * real three.js; how it looks is the user's (216, 217).
 */
import { describe, it, expect } from 'vitest';
import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  Vector3,
} from 'three';
import { MushroomCloudRenderer } from './mushroom-cloud.renderer';

const GROUND = new Vector3(100, 20, -50);
const RADIUS = 25;
/** Wall time of one frame at 60 fps */
const FRAME_MS = 16;

function setup() {
  const scene = new Scene();
  const clouds = new MushroomCloudRenderer(scene, { additive: new ShaderMaterial(), normal: new ShaderMaterial() });
  const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  camera.position.set(100, 250, 350);
  camera.lookAt(GROUND);
  const meshes = scene.children.filter((c): c is Mesh => c instanceof Mesh);
  const rings = meshes.filter((m) => m.material instanceof MeshBasicMaterial);
  const domes = meshes.filter((m) => m.geometry instanceof SphereGeometry);
  const flashes = scene.children.filter((c): c is Sprite => c instanceof Sprite);
  const screen = meshes.find((m) => m.material instanceof ShaderMaterial && m.geometry instanceof PlaneGeometry)!;

  /** One frame of `gameMs` game time, as the engine hands it over */
  const frame = (gameMs: number) => clouds.update(gameMs, camera, 1080);
  /** What the moment of detonation shows right now */
  const moment = () => ({
    flash: flashes.filter((f) => f.visible).map((f) => f.scale.x),
    screen: screen.visible ? ((screen.material as ShaderMaterial).uniforms['uOpacity'].value as number) : 0,
    dome: domes.filter((d) => d.visible).map((d) => d.scale.x),
    ring: rings.filter((r) => r.visible).map((r) => r.scale.x),
    kick: clouds.bloomKick,
  });
  return { clouds, frame, moment };
}

describe('The mushroom cloud in a pause and at speed, playtest 219 (night 1) replayed', () => {
  it('P right after the impact: flash, dome, ring and bloom kick stand, after P they go on as without the pause', () => {
    const paused = setup();
    const straight = setup();
    for (const run of [paused, straight]) {
      run.clouds.detonate(GROUND, RADIUS);
      for (let i = 0; i < 6; i++) run.frame(FRAME_MS);
    }
    const atP = paused.moment();
    expect(atP.flash.length).toBeGreaterThan(0);
    expect(atP.screen).toBeGreaterThan(0);
    expect(atP.dome.length).toBeGreaterThan(0);
    expect(atP.ring.length).toBeGreaterThan(0);
    expect(atP.kick).toBeGreaterThan(0);

    // Ten seconds of pause: frames without game time
    for (let i = 0; i < 600; i++) paused.frame(0);
    expect(paused.moment()).toEqual(atP);

    // After P both run on the same game time and show the same
    for (let i = 0; i < 20; i++) {
      paused.frame(FRAME_MS);
      straight.frame(FRAME_MS);
      expect(paused.moment()).toEqual(straight.moment());
    }
  });

  it('at 4x the flash is over in a quarter of the frames, and each frame shows what 1x shows at the same game time', () => {
    const framesUntilFlashIsOver = (timescale: number) => {
      const run = setup();
      run.clouds.detonate(GROUND, RADIUS);
      let frames = 0;
      do {
        run.frame(FRAME_MS * timescale);
        frames++;
      } while ((run.moment().screen > 0 || run.moment().flash.length > 0) && frames < 1000);
      return frames;
    };
    const single = framesUntilFlashIsOver(1);
    const fourfold = framesUntilFlashIsOver(4);
    expect(single).toBeGreaterThan(8);
    expect(fourfold).toBeGreaterThanOrEqual(Math.floor(single / 4));
    expect(fourfold).toBeLessThanOrEqual(Math.ceil(single / 4) + 1);

    // A frame at 4x shows the moment 1x shows four frames later
    const fast = setup();
    const slow = setup();
    fast.clouds.detonate(GROUND, RADIUS);
    slow.clouds.detonate(GROUND, RADIUS);
    for (let i = 0; i < 5; i++) {
      fast.frame(4 * FRAME_MS);
      for (let k = 0; k < 4; k++) slow.frame(FRAME_MS);
      const a = fast.moment();
      const b = slow.moment();
      expect(a.flash.length).toBe(b.flash.length);
      a.flash.forEach((s, j) => expect(s).toBeCloseTo(b.flash[j], 9));
      expect(a.screen).toBeCloseTo(b.screen, 9);
      a.dome.forEach((s, j) => expect(s).toBeCloseTo(b.dome[j], 9));
      a.ring.forEach((s, j) => expect(s).toBeCloseTo(b.ring[j], 9));
      expect(a.kick).toBeCloseTo(b.kick, 9);
    }
  });
});
