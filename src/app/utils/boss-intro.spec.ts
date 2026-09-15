import { describe, expect, it } from 'vitest';
import {
  BOSS_INTRO_BODY_OUT_M,
  BOSS_INTRO_CLEAR_MARGIN_M,
  BOSS_INTRO_TIMING,
  BOSS_SHOT,
  BOSS_SHOT_RAYS,
  BossIntroGate,
  PortalShotSearch,
  SHOT_CANDIDATE_RAYS,
  SHOT_CHECKS,
  bossClearDistance,
  bossIntroBlock,
  bossIntroCutMs,
  bossIntroReturnMs,
  bossIntroStage,
  pointAlongRoute,
  portalShot,
  type BossIntroContext,
  type PortalShot,
  type ShotProbe,
  type ShotPoint,
} from './boss-intro';
import { PORTAL_DEPTH, PORTAL_FRAME_TOP } from '../configs/marker-geometry.config';
import { ENEMY_TYPES } from '../configs/enemy-types.config';
import { OOZE_LOOK } from '../configs/visual-effects.config';

describe('BossIntroGate', () => {
  it('admits the first boss of a type in a wave and no more of it', () => {
    const gate = new BossIntroGate();
    expect(gate.admit('herbert', 10)).toBe(true);
    expect(gate.admit('herbert', 10)).toBe(false);
    expect(gate.admit('herbert', 10)).toBe(false);
  });

  it('admits a second type in the same wave', () => {
    const gate = new BossIntroGate();
    expect(gate.admit('herbert', 10)).toBe(true);
    expect(gate.admit('worm', 10)).toBe(true);
    expect(gate.admit('worm', 10)).toBe(false);
  });

  it('starts over with the next wave', () => {
    const gate = new BossIntroGate();
    gate.admit('herbert', 10);
    expect(gate.admit('herbert', 20)).toBe(true);
  });

  it('starts over after a reset, even at the same wave number', () => {
    const gate = new BossIntroGate();
    gate.admit('herbert', 10);
    gate.reset();
    expect(gate.admit('herbert', 10)).toBe(true);
  });
});

describe('bossClearDistance', () => {
  it('is the front face plus the margin', () => {
    expect(bossClearDistance(1)).toBeCloseTo(PORTAL_DEPTH / 2 + BOSS_INTRO_CLEAR_MARGIN_M);
  });

  it('grows with a deeper portal on a wide street, not below scale 1', () => {
    expect(bossClearDistance(1.5)).toBeCloseTo(PORTAL_DEPTH * 0.75 + BOSS_INTRO_CLEAR_MARGIN_M);
    expect(bossClearDistance(0.75)).toBeCloseTo(bossClearDistance(1));
  });

  it('waits for BOSS_INTRO_BODY_OUT_M of an ooze, past its rounded tip; Herbert and Skarnax keep the margin', () => {
    expect(bossClearDistance(1, ENEMY_TYPES['ooze'])).toBeCloseTo(PORTAL_DEPTH / 2 + BOSS_INTRO_BODY_OUT_M);
    expect(bossClearDistance(1.5, ENEMY_TYPES['ooze'])).toBeCloseTo(PORTAL_DEPTH * 0.75 + BOSS_INTRO_BODY_OUT_M);
    // Two metres at full crest behind the tip's round-off
    expect(BOSS_INTRO_BODY_OUT_M - OOZE_LOOK.capLength).toBeGreaterThanOrEqual(2);
    expect(bossClearDistance(1, ENEMY_TYPES['herbert'])).toBe(bossClearDistance(1));
    expect(bossClearDistance(1, ENEMY_TYPES['worm'])).toBe(bossClearDistance(1));
  });
});

describe('bossIntroBlock', () => {
  const play: BossIntroContext = {
    enabled: true,
    photoMode: false,
    botEnabled: false,
    trainingConnected: false,
    timescale: 1,
    renderingEnabled: true,
    introFlight: false,
    dialogOpen: false,
  };

  it('lets a normal game through, at every HUD speed', () => {
    expect(bossIntroBlock(play)).toBeNull();
    expect(bossIntroBlock({ ...play, timescale: 4 })).toBeNull();
  });

  it('names what keeps it from playing', () => {
    expect(bossIntroBlock({ ...play, enabled: false })).toBe('disabled');
    expect(bossIntroBlock({ ...play, photoMode: true })).toBe('photo-mode');
    expect(bossIntroBlock({ ...play, botEnabled: true })).toBe('bot');
    expect(bossIntroBlock({ ...play, trainingConnected: true })).toBe('training');
    expect(bossIntroBlock({ ...play, timescale: 10 })).toBe('timescale');
    expect(bossIntroBlock({ ...play, renderingEnabled: false })).toBe('no-rendering');
    expect(bossIntroBlock({ ...play, introFlight: true })).toBe('intro-flight');
    // A player in the location dialog or the key overview keeps the view behind it
    expect(bossIntroBlock({ ...play, dialogOpen: true })).toBe('dialog');
  });
});

describe('bossIntroStage', () => {
  const cut = bossIntroCutMs();
  const back = bossIntroReturnMs();

  it('runs dip-in, hold, dip-out, reveal and ends', () => {
    expect(bossIntroStage(0)).toBe('dip-in');
    expect(bossIntroStage(cut - 1)).toBe('dip-in');
    expect(bossIntroStage(cut)).toBe('hold');
    expect(bossIntroStage(cut + BOSS_INTRO_TIMING.holdMs - 1)).toBe('hold');
    expect(bossIntroStage(cut + BOSS_INTRO_TIMING.holdMs)).toBe('dip-out');
    expect(bossIntroStage(back)).toBe('reveal');
    expect(bossIntroStage(back + BOSS_INTRO_TIMING.revealMs - 1)).toBe('reveal');
    expect(bossIntroStage(back + BOSS_INTRO_TIMING.revealMs)).toBeNull();
  });

  it('cuts back after a dark beat like the first cut', () => {
    expect(back - cut - BOSS_INTRO_TIMING.holdMs).toBe(cut);
  });
});

describe('pointAlongRoute', () => {
  const route = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 4, z: -10 },
    { x: 20, y: 4, z: -10 },
  ];

  it('walks the bends and interpolates the height', () => {
    expect(pointAlongRoute(route, 5, { x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 2, z: -5 });
    expect(pointAlongRoute(route, 15, { x: 0, y: 0, z: 0 })).toEqual({ x: 5, y: 4, z: -10 });
  });

  it('holds at both ends', () => {
    expect(pointAlongRoute(route, -3, { x: 9, y: 9, z: 9 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(pointAlongRoute(route, 99, { x: 0, y: 0, z: 0 })).toEqual({ x: 20, y: 4, z: -10 });
  });
});

describe('portalShot', () => {
  const straight = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: -200 },
  ];
  /** Herbert up to his health bar (heightOffset 0.5 + healthBarOffset 7) */
  const HERBERT = 7.5;
  /** Angle of `p` above the shot's line of sight, share of the half field of view of 60° */
  const above = (shot: PortalShot, p: ShotPoint) => {
    const { position: c, target: t } = shot;
    const sight = Math.atan2(t.y - c.y, Math.hypot(t.x - c.x, t.z - c.z));
    const to = Math.atan2(p.y - c.y, Math.hypot(p.x - c.x, p.z - c.z));
    return (((to - sight) * 180) / Math.PI) / 30;
  };

  it('stands on the route beyond the boss, looking down at it, its feet above the title card', () => {
    // Smallest portal: Herbert's height decides the distance, not the crown
    const shot = portalShot(straight, 60, 0.75, 8, HERBERT)!;
    expect(shot.target.x).toBeCloseTo(0);
    expect(shot.target.z).toBeCloseTo(-8);
    expect(shot.position.x).toBeCloseTo(0);
    expect(shot.position.z).toBeCloseTo(-8 - HERBERT * BOSS_SHOT.bossHeights);
    const drop = shot.position.y - shot.target.y;
    const across = shot.target.z - shot.position.z;
    expect((Math.atan2(drop, across) * 180) / Math.PI).toBeCloseTo(BOSS_SHOT.pitchDeg);
    expect(above(shot, { x: 0, y: 0, z: -8 })).toBeCloseTo(-BOSS_SHOT.feet);
    expect(above(shot, { x: 0, y: PORTAL_FRAME_TOP * 0.75, z: 0 })).toBeLessThan(BOSS_SHOT.crown);
  });

  it('frames a bigger boss from further away', () => {
    const herbert = portalShot(straight, 60, 0.75, 8, HERBERT)!;
    const bigger = portalShot(straight, 60, 0.75, 8, 10)!;
    expect(bigger.target.z - bigger.position.z).toBeCloseTo(10 * BOSS_SHOT.bossHeights);
    expect(bigger.position.z).toBeLessThan(herbert.position.z);
  });

  it('backs off until the whole portal fits behind the boss', () => {
    const shot = portalShot(straight, 60, 1.75, 12, HERBERT)!;
    expect(shot.target.z - shot.position.z).toBeGreaterThan(HERBERT * BOSS_SHOT.bossHeights);
    expect(above(shot, { x: 0, y: PORTAL_FRAME_TOP * 1.75, z: 0 })).toBeCloseTo(BOSS_SHOT.crown);
    expect(above(shot, { x: 0, y: 0, z: -12 })).toBeCloseTo(-BOSS_SHOT.feet);
  });

  it('frames a bigger portal from further away', () => {
    const small = portalShot(straight, 60, 1, 8, HERBERT)!;
    const big = portalShot(straight, 60, 1.75, 8, HERBERT)!;
    expect(big.position.z).toBeLessThan(small.position.z);
  });

  it('pushes in towards the target over the hold', () => {
    const shot = portalShot(straight, 60, 1, 8, HERBERT, 0.1)!;
    const dist = (a: ShotPoint) => Math.hypot(a.x - shot.target.x, a.y - shot.target.y, a.z - shot.target.z);
    expect(dist(shot.dollyTo)).toBeCloseTo(dist(shot.position) * 0.9);
    const still = portalShot(straight, 60, 1, 8, HERBERT, 0)!;
    expect(still.dollyTo).toEqual(still.position);
  });

  it('follows the street round a bend instead of a straight line', () => {
    const bend = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -10 },
      { x: 100, y: 0, z: -10 },
    ];
    const shot = portalShot(bend, 60, 1, 8, HERBERT)!;
    expect(shot.position.z).toBeCloseTo(-10);
    expect(shot.position.x).toBeGreaterThan(10);
  });

  it('holds the camera at the end of a short route, clear of the ground', () => {
    const short = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 12, z: -10 },
    ];
    const shot = portalShot(short, 60, 1, 4, HERBERT)!;
    expect(shot.position.z).toBeCloseTo(-10);
    expect(shot.position.y).toBeGreaterThanOrEqual(12 + BOSS_SHOT.minClearance);
  });

  it('has no shot without a route', () => {
    expect(portalShot([{ x: 0, y: 0, z: 0 }], 60, 1, 8, HERBERT)).toBeNull();
  });
});

/** A solid block, min and max corners. */
interface Block {
  min: ShotPoint;
  max: ShotPoint;
}

const block = (minX: number, maxX: number, minZ: number, maxZ: number, top = 12, bottom = 0): Block => ({
  min: { x: minX, y: bottom, z: minZ },
  max: { x: maxX, y: top, z: maxZ },
});

const inside = (p: ShotPoint, b: Block) =>
  p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z;

/**
 * Solid blocks on flat ground at 0. A sight line stops half a metre short
 * of its end like TerrainQueries.raycastLineOfSight; unlike the tiles, a
 * block also stops a line that starts inside it.
 */
function blockProbe(blocks: readonly Block[]): ShotProbe {
  return {
    blocked(from, to) {
      const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
      const length = Math.hypot(d.x, d.y, d.z);
      const end = (length - 0.5) / length;
      return blocks.some((b) => {
        // Slab test on the segment from + t d, t in [0, end]
        let t0 = 0;
        let t1 = end;
        for (const axis of ['x', 'y', 'z'] as const) {
          if (Math.abs(d[axis]) < 1e-12) {
            if (from[axis] <= b.min[axis] || from[axis] >= b.max[axis]) return false;
            continue;
          }
          const a = (b.min[axis] - from[axis]) / d[axis];
          const c = (b.max[axis] - from[axis]) / d[axis];
          t0 = Math.max(t0, Math.min(a, c));
          t1 = Math.min(t1, Math.max(a, c));
          if (t0 > t1) return false;
        }
        return true;
      });
    },
    column(x, z) {
      let topY = 0;
      for (const b of blocks) {
        if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z) topY = Math.max(topY, b.max.y);
      }
      return { groundY: 0, topY };
    },
  };
}

describe('PortalShotSearch', () => {
  /** Portal at the origin, the route along -z */
  const straight = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: -200 },
  ];
  const out = bossClearDistance(1);
  /** Up to the health bar: Herbert, the worm's head, the ooze's tip */
  const BOSSES = { herbert: 7.5, worm: 6, ooze: 3 };
  /** Houses on both sides of an 8 m street along the route */
  const street = [block(-40, -4, -200, 30), block(4, 40, -200, 30)];

  const search = (blocks: readonly Block[], route: readonly ShotPoint[] = straight, height = BOSSES.herbert) =>
    PortalShotSearch.create(route, 60, 1, out, height, blockProbe(blocks))!;

  /** The boss on the route and the points of it the camera must see */
  const bossAt = (route: readonly ShotPoint[]) => pointAlongRoute(route, out, { x: 0, y: 0, z: 0 });
  const sees = (blocks: readonly Block[], eye: ShotPoint, route: readonly ShotPoint[], height: number) => {
    const boss = bossAt(route);
    const probe = blockProbe(blocks);
    return [0.2, 0.55, 0.95].every(
      (share) =>
        !probe.blocked({ x: boss.x, y: boss.y + share * height, z: boss.z }, eye) &&
        !probe.blocked(eye, { x: boss.x, y: boss.y + share * height, z: boss.z }),
    );
  };

  it('keeps the shot portalShot composes where nothing is in the way', () => {
    for (const height of Object.values(BOSSES)) {
      for (const scale of [0.75, 1, 1.75]) {
        const found = PortalShotSearch.create(straight, 60, scale, bossClearDistance(scale), height, blockProbe([]))!;
        const choice = found.result();
        expect(choice.label).toBe('route');
        expect(choice.clear).toBe(true);
        expect(choice.shot).toEqual(portalShot(straight, 60, scale, bossClearDistance(scale), height));
        // The column, chest, feet, head, lintel, crown and both sides
        expect(choice.rays).toBe(SHOT_CANDIDATE_RAYS);
      }
    }
  });

  it('also on a street between houses, as long as the view along it is clear', () => {
    const choice = search(street).result();
    expect(choice.label).toBe('route');
    expect(choice.shot).toEqual(portalShot(straight, 60, 1, out, BOSSES.herbert));
  });

  it('turns around the boss when a crown on the route hides it, before it goes closer', () => {
    const tree = block(-1.5, 1.5, -24, -20, 11, 4);
    expect(sees([tree], portalShot(straight, 60, 1, out, BOSSES.herbert)!.position, straight, BOSSES.herbert)).toBe(false);

    const choice = search([tree]).result();
    expect(choice.label).toBe('p14-far+25');
    expect(choice.clear).toBe(true);
    expect(sees([tree], choice.shot.position, straight, BOSSES.herbert)).toBe(true);
  });

  /**
   * Night-2 playtest 366, screenshot 1: the portal in a narrow street, the
   * route turns into a side street right behind the boss. Along the route
   * the camera looks back across the corner house; straight down the street
   * it would stand in the house across the junction.
   */
  const bend = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: -16 },
    { x: 200, y: 0, z: -16 },
  ];
  const junction = [
    block(-40, -4, -20, 30), // west of the street
    block(4, 200, -12, 30), // the corner house
    block(-40, 200, -60, -20), // across the side street
  ];

  it('in a narrow street with a bend: goes closer down the street instead of looking through the corner house', () => {
    for (const height of Object.values(BOSSES)) {
      const old = portalShot(bend, 60, 1, out, height)!;
      expect(sees(junction, old.position, bend, height)).toBe(false);

      const choice = search(junction, bend, height).result();
      expect(choice.clear).toBe(true);
      expect(choice.label).toMatch(/^p14-(mid|near)/);
      expect(sees(junction, choice.shot.position, bend, height)).toBe(true);
      expect(junction.some((b) => inside(choice.shot.position, b))).toBe(false);
      expect(choice.rays).toBeLessThanOrEqual(BOSS_SHOT_RAYS.total);
    }
  });

  it('looks from higher up over a hedge right in front of the boss that hides it from every low camera', () => {
    const hedge = block(-4, 4, -12.5, -11.5, 4);
    const blocks = [...street, hedge];
    const choice = search(blocks).result();
    expect(choice.label).toBe('p30-far');
    expect(choice.clear).toBe(true);
    expect(choice.shot.position.y).toBeGreaterThan(12);
    expect(sees(blocks, choice.shot.position, straight, BOSSES.herbert)).toBe(true);
  });

  it('with nothing clear keeps the shot that got furthest, the one portalShot composes on a tie', () => {
    // A roof over the whole square: every sight line to a camera above it is cut
    const roof = block(-100, 100, -100, 100, 10, 9);
    const choice = search([roof]).result();
    expect(choice.clear).toBe(false);
    expect(choice.label).toBe('route');
    expect(choice.score).toBe(1);
    expect(choice.shot).toEqual(portalShot(straight, 60, 1, out, BOSSES.herbert));
    expect(choice.rays).toBeLessThanOrEqual(BOSS_SHOT_RAYS.total);
  });

  it('stays in its ray budget, per step and in all', () => {
    // Every candidate fails only at the last check, room at its sides, so each costs almost all its rays
    const cramped: ShotProbe = { blocked: (from, to) => from.y === to.y, column: () => null };
    const found = PortalShotSearch.create(straight, 60, 1, out, BOSSES.herbert, cramped)!;
    let rays = 0;
    let steps = 0;
    while (!found.done) {
      found.step(BOSS_SHOT_RAYS.perFrame);
      // Paused between two rays, also inside a candidate
      expect(found.raysCast - rays).toBeLessThanOrEqual(BOSS_SHOT_RAYS.perFrame);
      rays = found.raysCast;
      steps++;
    }
    const choice = found.result();
    expect(choice.rays).toBe(rays);
    expect(choice.rays).toBeLessThanOrEqual(BOSS_SHOT_RAYS.total);
    expect(steps).toBeGreaterThan(1);
    expect(choice.score).toBe(SHOT_CHECKS - 1);
    expect(choice.label).toBe('route');
  });

  it('has no search where portalShot has no shot', () => {
    expect(PortalShotSearch.create([{ x: 0, y: 0, z: 0 }], 60, 1, out, 7.5, blockProbe([]))).toBeNull();
  });
});
