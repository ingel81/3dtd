import { beforeEach, describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { ShotLights, type ShotLightSource, type SteadyLightSource } from './shot-lights';
import { SHOT_GRID, SHOT_LIGHT_UNIFORMS, SHOT_LIGHTS_MAX } from './shot-light-shader';
import type { ShotLightLook, ShotLightPulseLook } from '../../configs/shot-lights.config';

const FLASH: ShotLightPulseLook = { color: [1, 0.5, 0.25], intensity: 4, radius: 10, durationS: 0.1 };
const TRACER: ShotLightLook = { color: [1, 1, 1], intensity: 1, radius: 6 };

/** A camera at (0, 50, 100) looking at the origin */
function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(60, 16 / 9, 1, 5000);
  c.position.set(0, 50, 100);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

const count = () => SHOT_LIGHT_UNIFORMS.uShotLightCount.value;
const light = (k: number) => Array.from(SHOT_LIGHT_UNIFORMS.uShotLights.value.subarray(k * 8, k * 8 + 8));

describe('ShotLights', () => {
  let lights: ShotLights;
  let cam: PerspectiveCamera;

  beforeEach(() => {
    lights = new ShotLights();
    lights.setMax(16);
    cam = camera();
  });

  it('gathers nothing on Low or switched off', () => {
    for (const off of [
      () => lights.setMax(0),
      () => lights.setEnabled(false),
    ]) {
      const l = new ShotLights();
      lights = l;
      l.setMax(16);
      off();
      expect(l.active).toBe(false);
      l.pulse(0, 2, 0, FLASH);
      l.update(0.016, cam);
      expect(count()).toBe(0);
    }
  });

  it('hands a pulse to the materials, fading squared over its duration', () => {
    lights.pulse(1, 2, 3, FLASH);
    // Full in the frame after it came
    lights.update(0.05, cam);
    expect(count()).toBe(1);
    expect(light(0)[4]).toBeCloseTo(4);
    lights.update(0.05, cam);
    const [x, y, z, invR2, r, g, b, invCore2] = light(0);
    expect([x, y, z]).toEqual([1, 2, 3]);
    expect(invR2).toBeCloseTo(1 / 100);
    // Half its duration gone: a quarter of its light left
    expect(r).toBeCloseTo(4 * 0.25);
    expect(g).toBeCloseTo(2 * 0.25);
    expect(b).toBeCloseTo(1 * 0.25);
    expect(invCore2).toBeGreaterThan(invR2);
    lights.update(0.06, cam);
    expect(count()).toBe(0);
  });

  it('cools a pulse to its fade colour', () => {
    lights.pulse(0, 2, 0, { ...FLASH, color: [1, 1, 1], fade: [1, 0, 0] });
    lights.update(0.05, cam);
    lights.update(0.05, cam);
    // Half way: green and blue half gone towards the fade, the whole a quarter as strong
    const [, , , , r, g, b] = light(0);
    expect(r).toBeCloseTo(4 * 0.25);
    expect(g).toBeCloseTo(4 * 0.25 * 0.5);
    expect(b).toBeCloseTo(4 * 0.25 * 0.5);
  });

  it('asks its sources every frame, and their lights last that frame only', () => {
    let on = true;
    const source: ShotLightSource = { shotLights: (l) => on && l.add(0, 5, 0, TRACER) };
    lights.addSource(source);
    lights.update(0.016, cam);
    expect(count()).toBe(1);
    on = false;
    lights.update(0.016, cam);
    expect(count()).toBe(0);
  });

  it('merges lights close to each other into one, weighted by their light', () => {
    lights.add(0.5, 1, 0.5, TRACER, 1);
    lights.add(1.5, 1, 1.5, TRACER, 3);
    lights.update(0.016, cam);
    expect(count()).toBe(1);
    const [x, , z, , r] = light(0);
    expect(x).toBeCloseTo(1.25);
    expect(z).toBeCloseTo(1.25);
    expect(r).toBeCloseTo(4);
    expect(lights.stats).toMatchObject({ candidates: 2, merged: 1, shown: 1 });
  });

  it('leaves out lights behind the camera', () => {
    lights.add(0, 5, 400, TRACER);
    lights.add(0, 5, 0, TRACER);
    lights.update(0.016, cam);
    expect(count()).toBe(1);
    expect(light(0)[2]).toBe(0);
  });

  it('keeps the strongest over their distance when there are more lights than places', () => {
    lights.setMax(2);
    lights.add(-40, 2, 0, TRACER);
    lights.add(0, 2, 0, { ...TRACER, intensity: 5 });
    lights.add(40, 2, 0, { ...TRACER, intensity: 3 });
    lights.update(0.016, cam);
    expect(count()).toBe(2);
    expect(light(0)[0]).toBe(0);
    expect(light(1)[0]).toBe(40);
  });

  it('keeps a light that had a place over one just as strong, instead of flickering between them', () => {
    lights.setMax(1);
    lights.add(-20, 2, 0, TRACER);
    lights.update(0.016, cam);
    expect(light(0)[0]).toBe(-20);
    // A rival a little stronger does not take the place; a much stronger one does
    lights.add(-20, 2, 0, TRACER);
    lights.add(20, 2, 0, { ...TRACER, intensity: 1.2 });
    lights.update(0.016, cam);
    expect(light(0)[0]).toBe(-20);
    lights.add(-20, 2, 0, TRACER);
    lights.add(20, 2, 0, { ...TRACER, intensity: 2 });
    lights.update(0.016, cam);
    expect(light(0)[0]).toBe(20);
  });

  it('never hands over more than the shader holds', () => {
    lights.setMax(1000);
    expect(lights.places).toBe(SHOT_LIGHTS_MAX);
    for (let i = 0; i < 100; i++) lights.add(-200 + i * 5, 1, 0, TRACER);
    lights.update(0.016, cam);
    expect(count()).toBe(SHOT_LIGHTS_MAX);
  });

  /** V1: a custom map's lamps were three.js PointLights, each change of their number a program variant of every lit material */
  it('puts the steady lights first, unmerged, also on Low, and the shots in the places left', () => {
    const lamps: SteadyLightSource = {
      steadyLights: (l) => {
        // Two lamps 1 m apart: they stay two lights
        l.steadyLight(0, 3, 0, 0.5, 0.4, 0.2, 12, 2);
        l.steadyLight(1, 3, 0, 0.5, 0.4, 0.2, 12, 2);
      },
    };
    lights.addSteadySource(lamps);
    lights.update(0.016, cam);
    expect(count()).toBe(2);
    [0, 3, 0, 1 / 144, 0.5, 0.4, 0.2, 0.25].forEach((v, k) => expect(light(0)[k]).toBeCloseTo(v, 6));
    expect(lights.stats.steady).toBe(2);
    // The shots after them, in the places the steady ones leave of the shader's
    lights.setMax(SHOT_LIGHTS_MAX);
    for (let i = 0; i < 100; i++) lights.add(-200 + i * 5, 1, 0, TRACER);
    lights.update(0.016, cam);
    expect(count()).toBe(SHOT_LIGHTS_MAX);
    expect(light(0)[0]).toBe(0);
    expect(light(1)[0]).toBe(1);
    // Low: no shots, the lamps still light
    lights.setMax(0);
    lights.pulse(0, 2, 0, FLASH);
    lights.update(0.016, cam);
    expect(count()).toBe(2);
    lights.removeSteadySource(lamps);
    lights.update(0.016, cam);
    expect(count()).toBe(0);
  });

  it('drops the pulses when switched off', () => {
    lights.pulse(0, 2, 0, FLASH);
    lights.setEnabled(false);
    lights.setEnabled(true);
    lights.update(0.016, cam);
    expect(count()).toBe(0);
  });

  it('names in each cell of the grid only the lights whose circle reaches it', () => {
    lights.add(-40, 2, 0, TRACER);
    lights.add(40, 2, 0, TRACER);
    lights.update(0.016, cam);
    const cells = SHOT_LIGHT_UNIFORMS.uShotCells.value;
    const grid = SHOT_LIGHT_UNIFORMS.uShotGrid.value;
    // The grid spans both circles: from -46 to 46 along x
    expect(grid[0]).toBeCloseTo(-46);
    expect(grid[2]).toBeCloseTo(SHOT_GRID / 92);
    const cellAt = (x: number, z: number) => cells[Math.floor((z - grid[1]) * grid[3]) * SHOT_GRID + Math.floor((x - grid[0]) * grid[2])];
    const first = light(0)[0] === -40 ? 1 : 2;
    expect(cellAt(-40, 0)).toBe(first);
    expect(cellAt(40, 0)).toBe(3 - first);
    // Between them neither reaches
    expect(cellAt(0, 0)).toBe(0);
    for (const mask of cells) expect(mask & ~3).toBe(0);
  });

  it('draws without its lights or without the grid for a measurement, and keeps them for after', () => {
    lights.add(-40, 2, 0, TRACER);
    lights.add(40, 2, 0, TRACER);
    lights.update(0.016, cam);
    const cells = Array.from(SHOT_LIGHT_UNIFORMS.uShotCells.value);
    expect(lights.withoutLights(() => count())).toBe(0);
    expect(lights.withoutGrid(() => Array.from(new Set(SHOT_LIGHT_UNIFORMS.uShotCells.value)))).toEqual([3]);
    expect(count()).toBe(2);
    expect(Array.from(SHOT_LIGHT_UNIFORMS.uShotCells.value)).toEqual(cells);
  });
});
