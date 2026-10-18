import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { Lightning, MAX_SEGMENTS, MIN_GAP_S, type LightningStrike } from './lightning';
import { CustomMapEnvironment } from './map-environment';
import { WIND_UNIFORMS } from './wind';
import { HEIGHT_FOG_UNIFORMS } from './height-fog';

const camera = (): PerspectiveCamera => {
  const c = new PerspectiveCamera(50, 1.5, 1, 10000);
  c.position.set(0, 200, -200);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};

/** Runs `seconds` of a storm at 60 frames a second; the strikes heard and the flash of every frame */
function run(l: Lightning, seconds: number, ground = 12): { strikes: (LightningStrike & { at: number })[]; flashes: number[] } {
  const cam = camera();
  const focus = new Vector3(0, ground, 0);
  l.setGround(() => ground);
  const strikes: (LightningStrike & { at: number })[] = [];
  let t = 0;
  l.onStrike = (s) => strikes.push({ ...s, at: t });
  const flashes: number[] = [];
  for (let f = 0; f < seconds * 60; f++) {
    t += 1 / 60;
    l.update(1 / 60, cam, focus, null);
    flashes.push(l.flash);
  }
  return { strikes, flashes };
}

/** Rises of the flash: a stroke each */
function peaks(flashes: number[], from: number, to: number): number {
  let n = 0;
  for (let i = Math.max(1, from); i < Math.min(flashes.length - 1, to); i++) {
    if (flashes[i] > flashes[i - 1] && flashes[i] >= flashes[i + 1] && flashes[i] > 0.05) n++;
  }
  return n;
}

describe('lightning', () => {
  it('strikes only in a storm, never closer together than the least gap', () => {
    const calm = new Lightning(1);
    expect(run(calm, 60).strikes).toHaveLength(0);
    const l = new Lightning(7);
    l.setStorm(1);
    const { strikes } = run(l, 180);
    // The wildest storm: every 6 s on average
    expect(strikes.length).toBeGreaterThan(15);
    for (let i = 1; i < strikes.length; i++) expect(strikes[i].at - strikes[i - 1].at).toBeGreaterThanOrEqual(MIN_GAP_S - 1e-6);
    // Bolts and flashes in the clouds; the sound hears them at a distance, to a side
    expect(strikes.some((s) => s.kind === 'ground')).toBe(true);
    expect(strikes.some((s) => s.kind === 'cloud')).toBe(true);
    for (const s of strikes) {
      expect(s.distance).toBeGreaterThan(50);
      expect(Math.abs(s.pan)).toBeLessThanOrEqual(1);
      expect(s.power).toBeGreaterThan(0);
    }
    l.setStorm(0);
    expect(run(l, 60).strikes).toHaveLength(0);
    l.dispose();
  });

  it('builds a branched bolt from the clouds down to the ground, within its buffer', () => {
    const l = new Lightning(3);
    l.setStorm(1);
    const cam = camera();
    const focus = new Vector3(0, 30, 0);
    l.setGround(() => 30);
    let bolts = 0;
    l.onStrike = (s) => {
      if (s.kind !== 'ground') return;
      bolts++;
      const n = l.segmentCount;
      expect(n).toBeGreaterThan(30);
      expect(n).toBeLessThanOrEqual(MAX_SEGMENTS);
      const shape = l.mesh.geometry.getAttribute('aShape');
      const end = l.mesh.geometry.getAttribute('aEnd');
      const levels = new Set<number>();
      let lowest = Infinity;
      for (let i = 0; i < n; i++) {
        levels.add(shape.getZ(i));
        if (shape.getZ(i) === 0) lowest = Math.min(lowest, end.getY(i));
      }
      // The channel reaches the ground; branches fork off it; the glow lies where it struck
      expect(lowest).toBeCloseTo(30, 5);
      expect(levels.has(1)).toBe(true);
      expect(levels.has(3)).toBe(true);
      expect(l.mesh.geometry.instanceCount).toBe(n);
    };
    for (let f = 0; f < 120 * 60; f++) l.update(1 / 60, cam, focus, null);
    expect(bolts).toBeGreaterThan(3);
    l.dispose();
  });

  it('flashes in at most three strokes, and back to dark after each strike', () => {
    const l = new Lightning(11);
    l.setStorm(1);
    const { strikes, flashes } = run(l, 120);
    for (const s of strikes) {
      const at = Math.round(s.at * 60);
      expect(peaks(flashes, at - 1, at + 60)).toBeLessThanOrEqual(3);
    }
    expect(Math.max(...flashes)).toBeGreaterThan(0.5);
    expect(flashes.filter((f) => f === 0).length).toBeGreaterThan(flashes.length / 2);
    l.dispose();
  });

  it('flashes soft for players sensitive to flashing light: dimmer, one swell, no flicker', () => {
    const l = new Lightning(11);
    l.setStorm(1);
    l.setFlashShare(0.35);
    const { strikes, flashes } = run(l, 120);
    expect(strikes.length).toBeGreaterThan(5);
    for (const s of strikes) {
      const at = Math.round(s.at * 60);
      expect(peaks(flashes, at - 1, at + 60)).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...flashes)).toBeLessThanOrEqual(0.35 + 1e-6);
    l.dispose();
  });

  it('lights the land at each stroke of a bolt where it struck, by the flash share, never for a cloud flash', () => {
    for (const share of [1, 0.35]) {
      const l = new Lightning(5);
      l.setStorm(1);
      l.setFlashShare(share);
      const strokes: { y: number; s: number }[] = [];
      l.onStroke = (_x, y, _z, s) => strokes.push({ y, s });
      const { strikes } = run(l, 120, 20);
      const bolts = strikes.filter((k) => k.kind === 'ground').length;
      expect(bolts).toBeGreaterThan(2);
      // Two or three strokes a bolt in full, one smooth swell when soft; the strike still in flight may be short
      if (share === 1) {
        expect(strokes.length).toBeGreaterThanOrEqual(2 * (bolts - 1));
        expect(strokes.length).toBeLessThanOrEqual(3 * bolts);
      } else expect(strokes.length).toBe(bolts);
      for (const k of strokes) {
        expect(k.y).toBeCloseTo(20, 5);
        expect(k.s).toBeLessThanOrEqual(share + 1e-6);
      }
      l.dispose();
    }
  });

  it('draws the bolt with the logarithmic depth and the haze of the map', () => {
    const l = new Lightning(1);
    const m = l.mesh.material;
    for (const chunk of ['logdepthbuf_pars_vertex', 'logdepthbuf_vertex']) expect(m.vertexShader).toContain(`#include <${chunk}>`);
    for (const chunk of ['logdepthbuf_pars_fragment', 'logdepthbuf_fragment']) expect(m.fragmentShader).toContain(`#include <${chunk}>`);
    // The haze it fades in is the map's, shared
    expect(m.uniforms['uFogDensity']).toBe(HEIGHT_FOG_UNIFORMS.uFogDensity);
    l.dispose();
  });
});

describe('storm weather', () => {
  const env = { sky: 'day' as const, sunAzimuth: 200, sunElevation: 40, fogDensity: 0.001, tint: '#ffffff' };

  it('is darker, wetter, windier and thicker than rain, with heavy rain', () => {
    const e = new CustomMapEnvironment(env);
    e.set({ ...env, weather: 'rain', weatherStrength: 0.8 });
    const rain = { sun: e.sun.intensity, fog: e.fog.density, wet: HEIGHT_FOG_UNIFORMS.uWetness.value, drops: e.weather.mesh.geometry.instanceCount, wind: WIND_UNIFORMS.uWindStrength.value };
    e.set({ ...env, weather: 'storm', weatherStrength: 0.8 });
    expect(e.sun.intensity).toBeLessThan(rain.sun);
    expect(e.fog.density).toBeGreaterThan(rain.fog);
    expect(HEIGHT_FOG_UNIFORMS.uWetness.value).toBeGreaterThan(rain.wet);
    expect(e.weather.mesh.geometry.instanceCount).toBeGreaterThan(rain.drops);
    expect(e.weather.mesh.material.uniforms['uKind'].value).toBe(0);
    expect(WIND_UNIFORMS.uWindStrength.value).toBeGreaterThan(rain.wind);
    expect(WIND_UNIFORMS.uWindStrength.value).toBeGreaterThanOrEqual(0.55);
    e.set(env);
    expect(e.lightning.active).toBe(false);
    e.dispose();
  });

  it('lifts the lights for a flash and gives them back exactly, nothing added to the scene', () => {
    const e = new CustomMapEnvironment(env);
    e.set({ ...env, weather: 'storm', weatherStrength: 1 });
    const lights = e.lights.children.length;
    const hemi = e.hemi.intensity;
    const ambient = e.ambient.intensity;
    const fog = e.fog.color.clone();
    const cam = camera();
    let lifted = 0;
    let flashes = 0;
    for (let f = 0; f < 90 * 60; f++) {
      e.update(1 / 60, cam);
      if (e.lightning.flash > 0) {
        flashes++;
        lifted = Math.max(lifted, e.hemi.intensity - hemi);
        expect(e.skyDome.uniforms['uFlash'].value).toBe(e.lightning.flash);
      }
    }
    expect(flashes).toBeGreaterThan(0);
    expect(lifted).toBeGreaterThan(0.5);
    // Until the strike in flight is over
    for (let f = 0; f < 120 && e.lightning.active; f++) e.update(1 / 60, cam);
    e.set(env);
    e.update(1 / 60, cam);
    e.set({ ...env, weather: 'storm', weatherStrength: 1 });
    expect(e.hemi.intensity).toBeCloseTo(hemi, 10);
    expect(e.ambient.intensity).toBeCloseTo(ambient, 10);
    expect(e.fog.color.equals(fog)).toBe(true);
    expect(e.lights.children.length).toBe(lights);
    e.dispose();
  });
});
