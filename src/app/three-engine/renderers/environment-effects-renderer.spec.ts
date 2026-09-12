import { describe, it, expect, vi } from 'vitest';
import { Points, Scene, Texture, Vector3 } from 'three';
import { ParticlePoolManager } from './particle-pool-manager';
import { EnvironmentEffectsRenderer } from './environment-effects-renderer';
import type { CoordinateSync } from './index';

// Die Atlanten malen auf ein 2D-Canvas, das jsdom nicht hat.
vi.mock('./sprite-atlas-generator', () => ({
  generateExplosionAtlas: () => new Texture(),
  generateSmokeAtlas: () => new Texture(),
}));

describe('EnvironmentEffectsRenderer tower fire', () => {
  it('uploads the pool again after a frame in which every particle died', () => {
    const scene = new Scene();
    const pools = new ParticlePoolManager(scene);
    const environment = new EnvironmentEffectsRenderer({} as CoordinateSync, pools);
    // Der Tower-Fire-Pool ist der mit 800 Partikeln (Trail-Pools: 3000/4000).
    const towerFire = scene.children.find(
      (child): child is Points =>
        child instanceof Points && child.geometry.getAttribute('position').count === 800
    )!;

    environment.spawnTowerInnerFire('t1', new Vector3(), 3, 0.1);
    pools.updateBuffers();
    const spawned = towerFire.geometry.drawRange.count;
    expect(spawned).toBeGreaterThan(0);

    // Erster Frame nach einem verdeckten Tab: dt ist eine Minute, alle sterben.
    environment.update(60);
    pools.updateBuffers();
    expect(towerFire.geometry.drawRange.count).toBe(0);

    // Der nächste Frame belebt alle wieder, der Pool muss sie auch zeichnen.
    environment.update(0.016);
    pools.updateBuffers();
    expect(towerFire.geometry.drawRange.count).toBe(spawned);
  });

  it('keeps the particle pools out of the render list while they are empty', () => {
    const scene = new Scene();
    const pools = new ParticlePoolManager(scene);
    const environment = new EnvironmentEffectsRenderer({} as CoordinateSync, pools);
    const points = scene.children.filter((child): child is Points => child instanceof Points);
    const towerFire = points.find((p) => p.geometry.getAttribute('position').count === 800)!;
    expect(points).toHaveLength(3);
    expect(points.map((p) => p.visible)).toEqual([false, false, false]);

    environment.spawnTowerInnerFire('t1', new Vector3(), 3, 0.1);
    pools.updateBuffers();
    expect(towerFire.visible).toBe(true);
    // Die Trail-Pools haben weiter nichts zu zeichnen.
    expect(points.filter((p) => p !== towerFire).map((p) => p.visible)).toEqual([false, false]);

    environment.stopTowerInnerFire('t1');
    environment.update(60); // alle sterben
    pools.updateBuffers();
    expect(towerFire.geometry.drawRange.count).toBe(0);
    expect(towerFire.visible).toBe(false);
  });
});
