import { describe, it, expect, vi } from 'vitest';
import { Scene, Texture, Vector3 } from 'three';
import { AuraRenderer, ICE_CRYSTAL_CAP } from './aura-renderer';
import { ParticlePoolManager } from './particle-pool-manager';

// The atlases paint on a 2D canvas, which jsdom does not have
vi.mock('./sprite-atlas-generator', () => ({
  generateExplosionAtlas: () => new Texture(),
  generateSmokeAtlas: () => new Texture(),
}));

function setup() {
  const pools = new ParticlePoolManager(new Scene());
  const auras = new AuraRenderer(pools);
  const live = () => pools.getPool('trailAdditive').filter((p) => p.life > 0);
  return { pools, auras, live };
}

describe('AuraRenderer ice crystals', () => {
  it('stands four still crystals around a frozen enemy, kept alive frame after frame', () => {
    const { auras, live } = setup();
    auras.spawnIceCrystals('frozen', new Vector3(10, 5, -3));
    expect(auras.hasIceCrystals('frozen')).toBe(true);
    const crystals = live();
    expect(crystals).toHaveLength(4);
    const before = crystals.map((p) => p.position.clone());

    for (let i = 0; i < 100; i++) auras.update(0.1); // ten seconds of frames
    expect(live()).toHaveLength(4);
    crystals.forEach((p, i) => expect(p.position.equals(before[i])).toBe(true));
    for (const p of crystals) {
      expect(Math.hypot(p.position.x - 10, p.position.z + 3)).toBeLessThan(1.5);
      expect(p.position.y).toBeGreaterThan(5);
    }
  });

  it('follows its enemy and gives the particles back once stopped', () => {
    const { auras, live } = setup();
    auras.spawnIceCrystals('frozen', new Vector3());
    auras.updateIceCrystalsPosition('frozen', new Vector3(0, 20, 0));
    auras.update(0.016);
    expect(live().every((p) => p.position.y > 20)).toBe(true);

    auras.stopIceCrystals('frozen');
    expect(auras.hasIceCrystals('frozen')).toBe(false);
    expect(live()).toHaveLength(0);
  });

  it(`stands crystals on ${ICE_CRYSTAL_CAP} frozen enemies at most`, () => {
    const { auras, live } = setup();
    for (let i = 0; i < ICE_CRYSTAL_CAP + 10; i++) auras.spawnIceCrystals(`e${i}`, new Vector3());
    expect(live()).toHaveLength(ICE_CRYSTAL_CAP * 4);
    expect(auras.hasIceCrystals(`e${ICE_CRYSTAL_CAP}`)).toBe(false);
    // Past the cap the calls for it do nothing
    auras.updateIceCrystalsPosition(`e${ICE_CRYSTAL_CAP}`, new Vector3(1, 1, 1));
    auras.stopIceCrystals(`e${ICE_CRYSTAL_CAP}`);
    expect(live()).toHaveLength(ICE_CRYSTAL_CAP * 4);

    auras.clear();
    expect(live()).toHaveLength(0);
  });
});
