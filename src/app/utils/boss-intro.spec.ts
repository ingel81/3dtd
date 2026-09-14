import { describe, expect, it } from 'vitest';
import {
  BOSS_INTRO_CLEAR_MARGIN_M,
  BOSS_INTRO_TIMING,
  BOSS_SHOT,
  BossIntroGate,
  bossClearDistance,
  bossIntroBlock,
  bossIntroCutMs,
  bossIntroReturnMs,
  bossIntroStage,
  pointAlongRoute,
  portalShot,
  type BossIntroContext,
  type PortalShot,
  type ShotPoint,
} from './boss-intro';
import { PORTAL_DEPTH, PORTAL_FRAME_TOP } from '../configs/marker-geometry.config';

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
