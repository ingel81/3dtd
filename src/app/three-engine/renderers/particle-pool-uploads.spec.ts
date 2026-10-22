import { describe, it, expect, vi } from 'vitest';
import { BufferAttribute, Points, Scene, Texture } from 'three';
import { ParticlePoolManager } from './particle-pool-manager';

// The atlases paint on a 2D canvas, which jsdom does not have
vi.mock('./sprite-atlas-generator', () => ({
  generateExplosionAtlas: () => new Texture(),
  generateSmokeAtlas: () => new Texture(),
}));

/** The tower fire pool's four buffers */
function towerFire(pools: ParticlePoolManager): BufferAttribute[] {
  const geometry = (pools as unknown as { towerFireParticles: Points }).towerFireParticles.geometry;
  return ['position', 'size', 'color', 'frameIndex'].map((n) => geometry.attributes[n] as BufferAttribute);
}

describe('ParticlePoolManager uploads', () => {
  it('uploads only the drawn particles, not the pool capacity, and nothing once none is drawn', () => {
    const pools = new ParticlePoolManager(new Scene());
    const buffers = towerFire(pools);
    for (let i = 0; i < 3; i++) {
      const p = pools.getInactiveParticle('towerFire')!;
      p.life = 1;
      p.size = 1;
    }
    const versions = buffers.map((b) => b.version);
    pools.updateBuffers();
    buffers.forEach((b, k) => {
      expect(b.version).toBeGreaterThan(versions[k]);
      expect(b.updateRanges).toEqual([{ start: 0, count: 3 * b.itemSize }]);
    });

    for (const p of pools.getPool('towerFire')) p.life = 0;
    const after = buffers.map((b) => b.version);
    pools.updateBuffers();
    buffers.forEach((b, k) => expect(b.version).toBe(after[k]));
  });
});
