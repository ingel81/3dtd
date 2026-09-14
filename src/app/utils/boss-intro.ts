import { PORTAL_DEPTH, PORTAL_FRAME_TOP, portalDepthScale } from '../configs/marker-geometry.config';
import { GAME_SPEEDS } from '../configs/game-speed.config';

/**
 * Boss intro: once a wave's boss has stepped out of its spawn portal, the
 * camera cuts to the portal, the boss's name shows, the game pauses; a click
 * or Esc skips (BossIntroService). What decides whether it plays, its
 * timeline and the shot live here, free of Angular and three.
 */

/** Metres a boss walks past the portal's front face before the cut, room for its body. */
export const BOSS_INTRO_CLEAR_MARGIN_M = 3;

/**
 * Route distance at which a boss out of a portal of `portalScale` stands in
 * front of it (m): the front face, half the portal's depth from the route
 * start, plus BOSS_INTRO_CLEAR_MARGIN_M. Before that it is inside the
 * portal's volume and hidden from every side (PORTAL_DEPTH).
 */
export function bossClearDistance(portalScale: number): number {
  return (PORTAL_DEPTH / 2) * portalDepthScale(portalScale) + BOSS_INTRO_CLEAR_MARGIN_M;
}

/**
 * One intro per boss type and wave: several bosses of one type in a wave (a
 * custom wave with five Herberts, the segments of a worm) get one, two types
 * get one each. A new wave number starts over; a restart has to reset(),
 * the next run counts from wave 1 again.
 */
export class BossIntroGate {
  private wave = -1;
  private readonly seen = new Set<string>();

  /** True for the first boss of `typeId` in `wave`. */
  admit(typeId: string, wave: number): boolean {
    if (wave !== this.wave) {
      this.wave = wave;
      this.seen.clear();
    }
    if (this.seen.has(typeId)) return false;
    this.seen.add(typeId);
    return true;
  }

  reset(): void {
    this.wave = -1;
    this.seen.clear();
  }
}

/** What the intro checks right before it starts. */
export interface BossIntroContext {
  /** The display option */
  enabled: boolean;
  photoMode: boolean;
  /** A training bot plays */
  botEnabled: boolean;
  /** The training backend picks the waves */
  trainingConnected: boolean;
  timescale: number;
  /** Headless training clients draw nothing */
  renderingEnabled: boolean;
  /** The intro flight owns the camera */
  introFlight: boolean;
}

export type BossIntroBlock =
  | 'disabled'
  | 'photo-mode'
  | 'bot'
  | 'training'
  | 'timescale'
  | 'no-rendering'
  | 'intro-flight';

/** Fastest speed the HUD offers; above it only a training run goes. */
const MAX_PLAYER_TIMESCALE = Math.max(...GAME_SPEEDS);

/**
 * Why the intro does not play now, null when it may. Photo mode keeps its
 * picture; bots and training runs have nobody watching, and above the HUD's
 * fastest speed the game is a training run too.
 */
export function bossIntroBlock(ctx: BossIntroContext): BossIntroBlock | null {
  if (!ctx.enabled) return 'disabled';
  if (ctx.photoMode) return 'photo-mode';
  if (ctx.botEnabled) return 'bot';
  if (ctx.trainingConnected) return 'training';
  if (ctx.timescale > MAX_PLAYER_TIMESCALE) return 'timescale';
  if (!ctx.renderingEnabled) return 'no-rendering';
  if (ctx.introFlight) return 'intro-flight';
  return null;
}

/**
 * Wall-clock timeline of an intro (ms). The game is paused throughout, so
 * game time cannot drive it. Each cut falls behind a dark veil: it fades in
 * (`dipMs`), stays dark for a beat (`blackMs`) so the cut lands on a fully
 * drawn veil, and fades out after the cut (`revealMs`).
 */
export const BOSS_INTRO_TIMING = {
  dipMs: 220,
  blackMs: 60,
  revealMs: 320,
  /** Portal shot with the title card, from the cut to the next dip */
  holdMs: 2800,
} as const;

export type BossIntroTiming = { readonly [K in keyof typeof BOSS_INTRO_TIMING]: number };

/**
 * Stages in order: veil fades in over the player's view; portal shot (the
 * veil fades out at its start); veil fades in over the portal; the player's
 * view is back and the veil fades out. The camera is on the portal during
 * `hold` and `dip-out` only.
 */
export type BossIntroStage = 'dip-in' | 'hold' | 'dip-out' | 'reveal';

/** Time of the cut to the portal (ms since the start). */
export function bossIntroCutMs(t: BossIntroTiming = BOSS_INTRO_TIMING): number {
  return t.dipMs + t.blackMs;
}

/** Time the camera comes back, the start of `reveal` (ms since the start). */
export function bossIntroReturnMs(t: BossIntroTiming = BOSS_INTRO_TIMING): number {
  return 2 * bossIntroCutMs(t) + t.holdMs;
}

/** Stage at `elapsedMs` since the start, null once the intro is over. */
export function bossIntroStage(elapsedMs: number, t: BossIntroTiming = BOSS_INTRO_TIMING): BossIntroStage | null {
  if (elapsedMs < bossIntroCutMs(t)) return 'dip-in';
  if (elapsedMs < bossIntroCutMs(t) + t.holdMs) return 'hold';
  const back = bossIntroReturnMs(t);
  if (elapsedMs < back) return 'dip-out';
  if (elapsedMs < back + t.revealMs) return 'reveal';
  return null;
}

/** Point in local scene coordinates. */
export interface ShotPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * The portal shot: the camera stands over the route in front of the portal,
 * looking back at the boss that just stepped out and at the portal behind
 * it, and pushes in a little over the hold (`position` to `dollyTo`).
 */
export interface PortalShot {
  position: ShotPoint;
  target: ShotPoint;
  dollyTo: ShotPoint;
}

export const BOSS_SHOT = {
  /** Horizontal distance from the camera to the boss, in heights of the boss */
  bossHeights: 2.5,
  /**
   * The boss's feet below the centre of the frame, share of the half field
   * of view: about 27 % up from the bottom edge, above the title card
   */
  feet: 0.5,
  /** Highest the portal's crown may reach, share of the half field of view above the centre */
  crown: 0.95,
  /** The camera looks down by this much (degrees) */
  pitchDeg: 14,
  /** Least height of the camera over the route under it (m) */
  minClearance: 6,
  /** Share of the way to the target the camera pushes in over the hold */
  dolly: 0.08,
} as const;

/**
 * Point `distance` metres along the route (horizontal length), written to
 * `out`, height interpolated. Held at the ends.
 */
export function pointAlongRoute(route: readonly ShotPoint[], distance: number, out: ShotPoint): ShotPoint {
  let left = Math.max(0, distance);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= length && length > 0) {
      const f = left / length;
      out.x = a.x + (b.x - a.x) * f;
      out.y = a.y + (b.y - a.y) * f;
      out.z = a.z + (b.z - a.z) * f;
      return out;
    }
    left -= length;
  }
  const last = route[route.length - 1];
  out.x = last.x;
  out.y = last.y;
  out.z = last.z;
  return out;
}

/**
 * The portal shot for a boss `bossDistance` metres out of its portal.
 *
 * The camera stands on the route beyond the boss, following the street
 * rather than a straight line, so it sits over the road and not in a
 * facade. It stands `bossHeights` heights of the boss away, but at least so
 * far that the portal's crown stays under `crown` of the upper half of the
 * frame, which keeps the whole portal readable behind the boss. It looks
 * down by `pitchDeg` and stands so high that the boss's feet sit `feet`
 * down the lower half, above the title card; the target is on that line of
 * sight above the boss. The crown's room is worked out along the route, as
 * if it ran straight. A route shorter than that holds the camera at its end.
 *
 * @param route Route from its start (the portal) on, local points on the ground
 * @param fovDeg Vertical field of view of the camera
 * @param portalScale Scale of the portal, see portalScaleForWidth
 * @param bossHeight Height of the boss over the ground (m)
 * @param dolly Push-in over the hold, 0 for a still shot
 * @returns null for a route without length
 */
export function portalShot(
  route: readonly ShotPoint[],
  fovDeg: number,
  portalScale: number,
  bossDistance: number,
  bossHeight: number,
  dolly: number = BOSS_SHOT.dolly,
): PortalShot | null {
  if (route.length < 2) return null;
  const halfFov = (fovDeg * Math.PI) / 360;
  const pitch = (BOSS_SHOT.pitchDeg * Math.PI) / 180;
  // Height of the camera over the boss's feet per metre away, and of the
  // highest point the crown may reach over the camera per metre to the portal
  const rise = Math.tan(pitch + BOSS_SHOT.feet * halfFov);
  const crownSlope = Math.tan(BOSS_SHOT.crown * halfFov - pitch);
  const boss = pointAlongRoute(route, bossDistance, { x: 0, y: 0, z: 0 });
  const crown = route[0].y + PORTAL_FRAME_TOP * portalScale - boss.y;
  const away = Math.max(
    bossHeight * BOSS_SHOT.bossHeights,
    (crown - crownSlope * bossDistance) / (rise + crownSlope),
  );

  const ground = pointAlongRoute(route, bossDistance + away, { x: 0, y: 0, z: 0 });
  const across = Math.hypot(ground.x - boss.x, ground.z - boss.z);
  if (across < 1) return null;

  const y = Math.max(boss.y + across * rise, ground.y + BOSS_SHOT.minClearance);
  const position = { x: ground.x, y, z: ground.z };
  const target = { x: boss.x, y: y - across * Math.tan(pitch), z: boss.z };
  return {
    position,
    target,
    dollyTo: {
      x: position.x + (target.x - position.x) * dolly,
      y: position.y + (target.y - position.y) * dolly,
      z: position.z + (target.z - position.z) * dolly,
    },
  };
}
