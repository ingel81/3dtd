import { describe, it, expect, vi } from 'vitest';
import { Color, Scene, Texture, Vector3 } from 'three';
import { EXPLOSION_LOOK } from '../../configs/visual-effects.config';
import { ParticlePoolManager, atlasSpriteFrame, atlasSpriteSize, type Particle } from './particle-pool-manager';
import { ParticleEffectsRenderer } from './particle-effects-renderer';
import type { CoordinateSync } from './index';

// Die Atlanten malen auf ein 2D-Canvas, das jsdom nicht hat.
vi.mock('./sprite-atlas-generator', () => ({
  generateExplosionAtlas: () => new Texture(),
  generateSmokeAtlas: () => new Texture(),
}));

const sprite = (life: number, sizeStart: number, sizeEnd: number): Particle => ({
  position: new Vector3(),
  velocity: new Vector3(),
  life,
  maxLife: 1,
  size: 4,
  color: new Color(),
  frameIndex: 0,
  totalFrames: 16,
  sizeStart,
  sizeEnd,
});

describe('atlas sprite size and frame', () => {
  it('scales the sprite from sizeStart at birth to sizeEnd at death', () => {
    expect(atlasSpriteSize(sprite(1, 1, 0.4))).toBeCloseTo(4);
    expect(atlasSpriteSize(sprite(0.5, 1, 0.4))).toBeCloseTo(2.8);
    expect(atlasSpriteSize(sprite(0, 1, 0.4))).toBeCloseTo(1.6);
  });

  it('matches the old size * life curve with sizeStart 1 and sizeEnd 0', () => {
    for (const life of [1, 0.7, 0.3, 0.05]) {
      expect(atlasSpriteSize(sprite(life, 1, 0))).toBeCloseTo(4 * life);
    }
  });

  it('hides a particle while its spawn delay runs and holds it on the first frame', () => {
    expect(atlasSpriteSize(sprite(1.3, 0.5, 1))).toBe(0);
    expect(atlasSpriteFrame(sprite(1.3, 0.5, 1))).toBe(0);
  });

  it('runs through all 16 frames over the life', () => {
    expect(atlasSpriteFrame(sprite(1, 1, 0))).toBe(0);
    expect(atlasSpriteFrame(sprite(0.5, 1, 0))).toBe(8);
    expect(atlasSpriteFrame(sprite(0.001, 1, 0))).toBe(15);
  });
});

describe('ParticleEffectsRenderer explosion', () => {
  const setup = () => {
    const pools = new ParticlePoolManager(new Scene());
    const sync = { geoToLocal: () => new Vector3() } as unknown as CoordinateSync;
    const effects = new ParticleEffectsRenderer(new Scene(), sync, pools);
    const alive = (pool: 'trailAdditive' | 'trailNormal') => pools.getPool(pool).filter((p) => p.life > 0);
    return { pools, effects, alive };
  };

  it('spawns the fireball in the additive pool and delayed smoke in the normal pool', () => {
    const { effects, alive } = setup();
    effects.spawnExplosion(0, 10, 0, 20, EXPLOSION_LOOK.referenceRadius, 4);

    const fire = alive('trailAdditive');
    expect(fire).toHaveLength(20);
    for (const p of fire) {
      expect(p.totalFrames).toBe(16);
      expect(p.sizeStart).toBe(EXPLOSION_LOOK.fire.sizeStart);
      expect(p.sizeEnd).toBe(EXPLOSION_LOOK.fire.sizeEnd);
    }

    const smoke = alive('trailNormal');
    expect(smoke).toHaveLength(4);
    for (const p of smoke) {
      expect(p.totalFrames).toBe(16);
      expect(p.life).toBeGreaterThan(1); // still waiting
      expect(atlasSpriteSize(p)).toBe(0);
    }
  });

  it('shows the smoke once the delay has run, before the fireball sprites are gone', () => {
    const { effects, alive } = setup();
    effects.spawnExplosion(0, 10, 0, 10, EXPLOSION_LOOK.referenceRadius, 3);

    // Frame steps of 16 ms, like update() gets them
    for (let t = 0; t < EXPLOSION_LOOK.smoke.delayMax + 0.02; t += 0.016) effects.update(0.016, 0);
    for (const p of alive('trailNormal')) expect(atlasSpriteSize(p)).toBeGreaterThan(0);
  });

  it('scales speed and sprite size with the blast radius', () => {
    const { effects, alive } = setup();
    const fire = EXPLOSION_LOOK.fire;
    effects.spawnExplosion(0, 0, 0, 30, EXPLOSION_LOOK.referenceRadius * 2);

    for (const p of alive('trailAdditive')) {
      expect(p.size).toBeGreaterThanOrEqual(fire.sizeMin * 2);
      expect(p.size).toBeLessThanOrEqual(fire.sizeMax * 2);
      // Horizontal speed only, the vertical part carries a fixed upward bias
      expect(Math.hypot(p.velocity.x, p.velocity.z)).toBeLessThanOrEqual(fire.speedMax * 2);
    }
    expect(alive('trailNormal')).toHaveLength(0); // no smoke unless asked for
  });
});

describe('ParticleEffectsRenderer effect particles', () => {
  const setup = () => {
    const pools = new ParticlePoolManager(new Scene());
    const sync = { geoToLocal: () => new Vector3() } as unknown as CoordinateSync;
    const effects = new ParticleEffectsRenderer(new Scene(), sync, pools);
    const alive = (pool: 'trailAdditive' | 'trailNormal') => pools.getPool(pool).filter((p) => p.life > 0);
    // One engine frame: effects, then the buffer pass that frees dead particles
    const frame = (dt: number, now = 0) => {
      effects.update(dt, now);
      pools.updateBuffers();
    };
    return { pools, effects, alive, frame };
  };

  it('moves and ages a blood splatter particle once per frame', () => {
    const { effects, alive, frame } = setup();
    effects.spawnBloodSplatter(0, 0, 0, 1);
    const [p] = alive('trailNormal');
    const { maxLife } = p;
    const vx = p.velocity.x;

    const dt = 0.016;
    const frames = 10;
    for (let i = 0; i < frames; i++) frame(dt);
    expect(p.life).toBeCloseTo(1 - (frames * dt) / maxLife, 6);
    expect(p.position.x).toBeCloseTo(vx * frames * dt, 6); // gravity only acts on y
  });

  it('draws the blood splatter arc the double update used to draw', () => {
    const { effects, alive, frame } = setup();
    effects.spawnBloodSplatter(0, 0, 0, 1);
    const [p] = alive('trailNormal');

    // The old code: half this velocity, twice this life, real gravity, and
    // every frame two moves and two agings around one gravity step
    const old = { pos: new Vector3(), vel: p.velocity.clone().multiplyScalar(0.5), life: 1 };
    const oldMaxLife = p.maxLife * 2;
    const dt = 0.016;
    while (p.life > 0) {
      frame(dt);
      old.pos.addScaledVector(old.vel, dt);
      old.vel.y += -9.8 * dt;
      old.pos.addScaledVector(old.vel, dt);
      old.life -= (2 * dt) / oldMaxLife;
      if (p.life > 0) {
        expect(p.life).toBeCloseTo(old.life, 6);
        // One gravity step per frame lands in a different sub-step: g * dt² per frame
        expect(p.position.distanceTo(old.pos)).toBeLessThan(0.15);
      }
    }
    expect(old.life).toBeLessThanOrEqual(1e-9); // both gone in the same frame
  });

  it('leaves a particle alone that another effect took over after it died', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { effects, alive, frame } = setup();
    effects.spawnBloodSplatter(0, 0, 0, 3); // the effect expires at 1.5 s
    const blood = alive('trailNormal');

    let t = 0;
    for (; t < 1.0; t += 0.016) frame(0.016, t * 1000); // the splatter lives 0.5-0.75 s
    expect(alive('trailNormal')).toHaveLength(0);

    effects.spawnExplosion(0, 0, 0, 0, EXPLOSION_LOOK.referenceRadius, 1); // one smoke puff, 1.4 s or more
    const [smoke] = alive('trailNormal');
    expect(blood).toContain(smoke); // it took a slot the splatter had

    for (; t < 1.6; t += 0.016) frame(0.016, t * 1000);
    expect(smoke.life).toBeGreaterThan(0);
    now.mockRestore();
  });

  it('keeps every particle of a burning fire alive', () => {
    const { effects, alive, frame } = setup();
    effects.spawnFire(0, 0, 0, 'small');
    const count = alive('trailAdditive').length;
    expect(count).toBeGreaterThan(0);

    for (let t = 0; t < 5; t += 0.016) frame(0.016);
    expect(alive('trailAdditive')).toHaveLength(count);
  });
});
