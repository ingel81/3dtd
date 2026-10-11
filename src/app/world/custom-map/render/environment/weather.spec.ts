import { describe, expect, it } from 'vitest';
import { CustomMapEnvironment } from './map-environment';

const env = { sky: 'day' as const, sunAzimuth: 200, sunElevation: 40, fogDensity: 0.001, tint: '#ffffff' };

describe('weather', () => {
  it('shows particles for rain and snow, scaled by strength, none when clear or foggy', () => {
    const e = new CustomMapEnvironment(env);
    const count = (): number => e.weather.mesh.geometry.instanceCount;
    expect(count()).toBe(0);
    e.set({ ...env, weather: 'rain', weatherStrength: 1 });
    const full = count();
    expect(full).toBeGreaterThan(0);
    e.set({ ...env, weather: 'rain', weatherStrength: 0.5 });
    expect(count()).toBe(Math.round(full / 2));
    e.set({ ...env, weather: 'snow', weatherStrength: 1 });
    expect(e.weather.mesh.material.defines['KIND']).toBe(1);
    e.set({ ...env, weather: 'fog', weatherStrength: 1 });
    expect(count()).toBe(0);
    e.dispose();
  });

  it('thickens the fog and dims the sun with bad weather', () => {
    const e = new CustomMapEnvironment(env);
    const clearSun = e.sun.intensity;
    e.set({ ...env, weather: 'fog', weatherStrength: 1 });
    expect(e.fog.density).toBeCloseTo(env.fogDensity * 6);
    e.set({ ...env, weather: 'rain', weatherStrength: 1 });
    expect(e.sun.intensity).toBeLessThan(clearSun);
    expect(e.fog.density).toBeGreaterThan(env.fogDensity);
    e.dispose();
  });

  it('counts darkness from the sky and a low sun', () => {
    const e = new CustomMapEnvironment(env);
    expect(e.darkness).toBe(0);
    e.set({ ...env, sky: 'night' });
    expect(e.darkness).toBe(1);
    e.set({ ...env, sunElevation: 3 });
    expect(e.darkness).toBeGreaterThan(0.7);
    e.dispose();
  });

  it('biomes change sky, air and particles', () => {
    const e = new CustomMapEnvironment(env);
    e.set({ ...env, biome: 'moon' });
    expect(e.fog.density).toBe(0);
    expect(e.skyDome.uniforms['uStars'].value).toBe(1);
    expect(e.skyDome.uniforms['uPlanet'].value).toBe(1);
    e.set({ ...env, biome: 'hell' });
    expect(e.weather.mesh.visible).toBe(true);
    expect(e.weather.mesh.material.defines['KIND']).toBe(2);
    e.set({ ...env, biome: 'arctic', sky: 'night' });
    expect(e.skyDome.uniforms['uAurora'].value).toBe(1);
    e.set({ ...env, biome: 'swamp' });
    expect(e.fog.density).toBeGreaterThan(env.fogDensity * 2);
    e.set(env);
    expect(e.weather.mesh.visible).toBe(false);
    e.dispose();
  });
});
