import { describe, it, expect, beforeEach } from 'vitest';
import { isArrowBoss, isOffscreenThreat, NEAR_HQ_PROGRESS, OffscreenClusterer, sameArrows } from './offscreen-indicators';

describe('isOffscreenThreat', () => {
  it('takes bosses anywhere on the route', () => {
    expect(isOffscreenThreat(true, 0.1)).toBe(true);
  });

  it('takes other enemies on the last stretch only', () => {
    expect(isOffscreenThreat(false, NEAR_HQ_PROGRESS - 0.01)).toBe(false);
    expect(isOffscreenThreat(false, NEAR_HQ_PROGRESS)).toBe(true);
  });
});

describe('isArrowBoss', () => {
  it('takes a boss type without a worm link', () => {
    expect(isArrowBoss(true, null)).toBe(true);
    expect(isArrowBoss(false, null)).toBe(false);
  });

  it('takes of a worm only the head of each piece, not the rings behind it', () => {
    expect(isArrowBoss(true, { head: true })).toBe(true);
    expect(isArrowBoss(true, { head: false })).toBe(false);
  });
});

describe('OffscreenClusterer', () => {
  let c: OffscreenClusterer;

  beforeEach(() => {
    c = new OffscreenClusterer(8);
    c.begin(800, 600, 20);
  });

  it('ignores points on screen', () => {
    expect(c.add(0.5, -0.9, false, true)).toBe(false);
    expect(c.build(6)).toEqual([]);
  });

  it('puts a point right of the view on the right edge, pointing right', () => {
    c.add(3, 0, false, false);
    expect(c.build(6)).toEqual([
      { x: 780, y: 300, angle: 0, labelX: -20, labelY: 0, count: 1, boss: false, target: -1 },
    ]);
  });

  it('points up for a point above the view', () => {
    c.add(0, 2, false, false);
    const [arrow] = c.build(6);
    expect(arrow).toMatchObject({ x: 400, y: 20, angle: -90 });
  });

  it('clusters points in one direction into one arrow with a count', () => {
    c.add(3, 0.1, false, false);
    c.add(3, -0.1, false, false);
    c.add(-3, 0, false, false);
    const arrows = c.build(6);
    expect(arrows.map((a) => a.count)).toEqual([2, 1]);
    expect(arrows[0].x).toBe(780);
    expect(arrows[1].x).toBe(20);
  });

  it('keeps the left edge clear of a HUD strip, the other edges as they were', () => {
    c.begin(800, 600, 20, 60);
    c.add(-3, 0, false, false);
    c.add(3, 0, false, false);
    c.add(0, 2, false, false);
    expect(c.build(6).map((a) => [a.x, a.y])).toEqual([[780, 300], [400, 20], [80, 300]]);
  });

  it('counts a point behind the camera even where it lands inside the view', () => {
    expect(c.add(0.1, 0, true, false)).toBe(true);
    expect(c.build(6)[0]).toMatchObject({ x: 780, angle: 0 });
  });

  it('points down for a point straight behind the camera', () => {
    c.add(0, 0, true, false);
    expect(c.build(6)[0]).toMatchObject({ x: 400, y: 580, angle: 90 });
  });

  it('keeps the boss direction when arrows run short', () => {
    c.add(-3, 0, false, true);
    for (let i = 0; i < 5; i++) c.add(3, 0, false, false);
    const arrows = c.build(1);
    expect(arrows).toHaveLength(1);
    expect(arrows[0]).toMatchObject({ x: 20, boss: true, count: 1 });
  });

  it('draws no more arrows than asked for', () => {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      c.add(3 * Math.cos(a), 3 * Math.sin(a), false, false);
    }
    expect(c.build(8)).toHaveLength(8);
    expect(c.build(3)).toHaveLength(3);
  });

  it('starts every pass empty', () => {
    c.add(3, 0, false, false);
    c.begin(800, 600, 20);
    expect(c.build(6)).toEqual([]);
  });

  it('leads to the enemy furthest along its route, not to one on screen', () => {
    c.add(0, 0, false, false, 0.99, 0);
    c.add(3, 0.1, false, false, 0.9, 1);
    c.add(3, -0.1, false, false, 0.95, 2);
    c.add(3, 0, false, false, 0.86, 3);
    expect(c.build(6)[0]).toMatchObject({ count: 3, target: 2 });
  });

  it('leads to a boss before any enemy further along', () => {
    c.add(3, 0, false, false, 0.99, 0);
    c.add(3, 0.1, false, true, 0.2, 1);
    c.add(3, -0.1, false, true, 0.4, 2);
    c.add(3, 0, false, false, 1, 3);
    expect(c.build(6)[0]).toMatchObject({ boss: true, target: 2 });
  });

  it('keeps a target per direction and forgets it each pass', () => {
    c.add(3, 0, false, false, 0.9, 7);
    c.add(-3, 0, false, false, 0.9, 4);
    const byX = c.build(6).sort((a, b) => a.x - b.x);
    expect(byX.map((a) => a.target)).toEqual([4, 7]);
    c.begin(800, 600, 20);
    c.add(-3, 0, false, false, 0.5);
    expect(c.build(6)[0].target).toBe(-1);
  });
});

describe('sameArrows', () => {
  const arrow = { x: 1, y: 2, angle: 0, labelX: 0, labelY: 0, count: 1, boss: false, target: 0 };

  it('compares what the view shows', () => {
    expect(sameArrows([arrow], [{ ...arrow }])).toBe(true);
    expect(sameArrows([arrow], [{ ...arrow, target: 3 }])).toBe(true);
    expect(sameArrows([arrow], [{ ...arrow, count: 2 }])).toBe(false);
    expect(sameArrows([arrow], [])).toBe(false);
  });
});
