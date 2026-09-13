import { describe, it, expect } from 'vitest';
import { ENEMY_TYPES, WORM_MAX_SEGMENTS } from '../../configs/enemy-types.config';
import { PORTAL_DEPTH } from '../../configs/marker-geometry.config';
import type { Enemy } from '../../entities/enemy.entity';
import { WormGroup, WORM_SWAY_RAMP_M, wormSegmentCount, wormSway } from './worm-group';

const worm = ENEMY_TYPES['worm'];
const chain = worm.chain!;

/** Just what WormGroup reads from a segment enemy */
const segment = (hp: number) => ({ health: { hp } }) as unknown as Enemy;

const group = (size: number, front = 0) =>
  new WormGroup(worm, chain, [], size, worm.baseSpeed, 50, front, false);

describe('wormSegmentCount', () => {
  it('fits the route: head at the HQ as the tail leaves the start', () => {
    const n = wormSegmentCount(chain, 300);
    expect(n).toBe(Math.floor(300 / chain.spacing) + 1);
    expect((n - 1) * chain.spacing).toBeLessThanOrEqual(300);
    expect(n * chain.spacing).toBeGreaterThan(300);
  });

  it('keeps a short route to the minimum and a long one to the cap', () => {
    expect(wormSegmentCount(chain, 10)).toBe(chain.minSegments);
    expect(wormSegmentCount(chain, 0)).toBe(chain.minSegments);
    expect(wormSegmentCount(chain, 5000)).toBe(WORM_MAX_SEGMENTS);
    expect(chain.maxSegments).toBe(WORM_MAX_SEGMENTS);
  });
});

describe('wormSway', () => {
  it('comes out of the portal straight', () => {
    for (const d of [-5, 0, 2, PORTAL_DEPTH / 2]) expect(wormSway(chain, d)).toBe(0);
  });

  it('reaches the full sway after the ramp and never more', () => {
    // A quarter wavelength past a whole one, well after the ramp: sin = 1
    const d = chain.swayWavelength * 1.25;
    expect(d).toBeGreaterThan(PORTAL_DEPTH / 2 + WORM_SWAY_RAMP_M);
    expect(wormSway(chain, d)).toBeCloseTo(chain.sway, 9);
    for (let s = 0; s < 400; s += 0.7) {
      expect(Math.abs(wormSway(chain, s))).toBeLessThanOrEqual(chain.sway + 1e-12);
    }
  });

  it('depends on the distance only, so the body passes where the head passed', () => {
    expect(wormSway(chain, 123.4)).toBe(wormSway(chain, 123.4));
    expect(wormSway(chain, 60)).toBeCloseTo(wormSway(chain, 60 + chain.swayWavelength), 9);
  });
});

describe('WormGroup', () => {
  it('starts with every slot in the portal, as one chain', () => {
    const g = group(5, -3);
    expect(g.pending).toBe(5);
    expect(g.remaining).toBe(5);
    expect(g.chains).toEqual([{ first: 0, last: 4, front: -3 }]);
    expect(g.maxHp).toBe(250);
    expect(g.hp()).toBe(250);
  });

  it('places each slot a spacing behind the one before', () => {
    const g = group(5, 20);
    const c = g.chains[0];
    expect(g.distanceOf(c, 0)).toBe(20);
    expect(g.distanceOf(c, 3)).toBeCloseTo(20 - 3 * chain.spacing, 12);
    expect(g.tailOf(c)).toBeCloseTo(20 - 4 * chain.spacing, 12);
  });

  it('counts slots out, lost and still in the portal', () => {
    const g = group(5);
    g.emerge(0, segment(30));
    g.emerge(1, segment(50));
    expect(g.pending).toBe(3);
    expect(g.remaining).toBe(5);
    expect(g.isAlive(0)).toBe(true);
    expect(g.hp()).toBe(30 + 50 + 3 * 50);

    g.lose(0);
    g.lose(0);
    expect(g.remaining).toBe(4);
    expect(g.segments[0]).toBeNull();

    g.lose(4); // a pending slot that will never come out
    expect(g.pending).toBe(2);
    g.dropPending();
    expect(g.pending).toBe(0);
    expect(g.remaining).toBe(1);
    expect(g.hp()).toBe(50);
  });

  describe('losing a segment', () => {
    const s = chain.spacing;

    it('splits the worm into the part in front and the part behind', () => {
      const g = group(10, 30);
      g.lose(4);
      expect(g.chains).toEqual([
        { first: 0, last: 3, front: 30 },
        { first: 5, last: 9, front: 30 - 5 * s },
      ]);
    });

    it('shortens the worm at either end', () => {
      const g = group(10, 30);
      g.lose(0);
      g.lose(9);
      expect(g.chains).toEqual([{ first: 1, last: 8, front: 30 - s }]);
    });

    it('splits the worm the slot is in and keeps the order front to back', () => {
      const g = group(10, 30);
      g.lose(4);
      g.lose(7);
      g.lose(6);
      expect(g.chains).toEqual([
        { first: 0, last: 3, front: 30 },
        { first: 5, last: 5, front: 30 - 5 * s },
        { first: 8, last: 9, front: 30 - 5 * s - 3 * s },
      ]);
      g.lose(5);
      expect(g.chains.map((c) => [c.first, c.last])).toEqual([[0, 3], [8, 9]]);
    });

    it('leaves no worm once every slot is gone', () => {
      const g = group(3, 5);
      g.dropPending();
      expect(g.chains).toEqual([]);
      expect(g.remaining).toBe(0);
    });
  });

  it('does not bring a lost slot back', () => {
    const g = group(3);
    g.lose(2);
    g.emerge(2, segment(50));
    expect(g.segments[2]).toBeNull();
    expect(g.remaining).toBe(2);
  });
});
