import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { CustomMapEnvironment } from './map-environment';
import { CASCADES, WeatherLayer } from './weather';

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
    expect(e.weather.mesh.material.uniforms['uKind'].value).toBe(1);
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
    expect(e.weather.mesh.material.uniforms['uKind'].value).toBe(2);
    e.set({ ...env, biome: 'arctic', sky: 'night' });
    expect(e.skyDome.uniforms['uAurora'].value).toBe(1);
    e.set({ ...env, biome: 'swamp' });
    expect(e.fog.density).toBeGreaterThan(env.fogDensity * 2);
    e.set(env);
    expect(e.weather.mesh.visible).toBe(false);
    e.dispose();
  });

  it('hangs its boxes ahead of the camera, nested, the particles shared out evenly, wherever the camera is', () => {
    const layer = new WeatherLayer();
    const map = new Group();
    map.position.set(500, 0, -200);
    map.add(layer.mesh);
    map.updateMatrixWorld(true);
    layer.set('snow', 1, 1);
    const centers = layer.mesh.material.uniforms['uCenters'].value as Vector3[];
    const cascade = layer.mesh.geometry.getAttribute('aCascade');
    const per = CASCADES.map((_, c) => Array.from({ length: layer.mesh.geometry.instanceCount }, (__, k) => cascade.getX(k)).filter((x) => x === c).length);
    expect(Math.max(...per) - Math.min(...per)).toBeLessThanOrEqual(1);
    for (const [eye, look] of [[new Vector3(0, 400, 0), new Vector3(1, 0, 0)], [new Vector3(800, 2, -200), new Vector3(0, 2, -200)]] as const) {
      const camera = new PerspectiveCamera();
      camera.position.copy(eye);
      camera.lookAt(look);
      camera.updateMatrixWorld(true);
      layer.update(0.016, camera);
      const local = map.worldToLocal(eye.clone());
      const dir = look.clone().sub(eye).normalize();
      CASCADES.forEach((size, c) => {
        // Ahead along the view, the camera inside every box: near and far ground both in some box
        expect(centers[c].clone().sub(local).dot(dir)).toBeCloseTo(size * 0.35, 3);
        expect(centers[c].distanceTo(local)).toBeLessThan(size / 2);
      });
    }
    layer.dispose();
  });
});
