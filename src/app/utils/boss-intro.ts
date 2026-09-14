import {
  PORTAL_DEPTH,
  PORTAL_FRAME_TOP,
  PORTAL_OPENING_HEIGHT,
  portalDepthScale,
} from '../configs/marker-geometry.config';
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
  /** A dialog is open (MatDialog: the location dialog, the key overview, any other) */
  dialogOpen: boolean;
}

export type BossIntroBlock =
  | 'disabled'
  | 'photo-mode'
  | 'bot'
  | 'training'
  | 'timescale'
  | 'no-rendering'
  | 'intro-flight'
  | 'dialog';

/** Fastest speed the HUD offers; above it only a training run goes. */
const MAX_PLAYER_TIMESCALE = Math.max(...GAME_SPEEDS);

/**
 * Why the intro does not play now, null when it may. Photo mode keeps its
 * picture; bots and training runs have nobody watching, and above the HUD's
 * fastest speed the game is a training run too. A player in a dialog keeps
 * the view behind it: no camera cut and no pause they did not ask for
 * (decided 2026-09-14).
 */
export function bossIntroBlock(ctx: BossIntroContext): BossIntroBlock | null {
  if (!ctx.enabled) return 'disabled';
  if (ctx.photoMode) return 'photo-mode';
  if (ctx.botEnabled) return 'bot';
  if (ctx.trainingConnected) return 'training';
  if (ctx.timescale > MAX_PLAYER_TIMESCALE) return 'timescale';
  if (!ctx.renderingEnabled) return 'no-rendering';
  if (ctx.introFlight) return 'intro-flight';
  if (ctx.dialogOpen) return 'dialog';
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
  /** Least room between the camera and the highest surface under it (m): not in a crown, not under a roof */
  headroom: 1,
  /**
   * Free space the camera keeps to its left and to its right (m), less the
   * half metre the game's rays stop short: no facade or tree right at the lens
   */
  sideRoom: 2.5,
} as const;

/** One row of BOSS_SHOT_FALLBACKS. */
export interface ShotFallback {
  pitchDeg: number;
  /** 'far' frames the whole portal as BOSS_SHOT does, 'near' only its opening and the boss, 'mid' half way */
  reach: 'far' | 'mid' | 'near';
  /** Turns off the line from the portal through the boss (degrees), each both ways */
  yawDeg: readonly number[];
}

/**
 * Where the camera may stand when the shot BOSS_SHOT composes has no clear
 * view, in the order PortalShotSearch tries them after it. Turning around
 * the boss keeps the composition, then closer (the crown is cut), then
 * higher (looking over hedges, crowns and roofs).
 */
export const BOSS_SHOT_FALLBACKS: readonly ShotFallback[] = [
  { pitchDeg: BOSS_SHOT.pitchDeg, reach: 'far', yawDeg: [0, 25] },
  { pitchDeg: BOSS_SHOT.pitchDeg, reach: 'mid', yawDeg: [0, 25] },
  { pitchDeg: BOSS_SHOT.pitchDeg, reach: 'near', yawDeg: [0, 25, 50] },
  { pitchDeg: 30, reach: 'far', yawDeg: [0, 25] },
  { pitchDeg: 30, reach: 'near', yawDeg: [0, 25, 50] },
  { pitchDeg: 50, reach: 'near', yawDeg: [0, 25, 50] },
];

/**
 * Rays a shot search casts at most (column probes included), and per frame
 * of the veil (BossIntroService): the search pauses between two rays, so at
 * 60 fps the whole budget fits into the veil before the cut.
 */
export const BOSS_SHOT_RAYS = { total: 64, perFrame: 4 } as const;

const DEG = Math.PI / 180;

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
  const halfFov = (fovDeg * Math.PI) / 360;
  const framing = routeFraming(route, halfFov, portalScale, bossDistance, bossHeight);
  if (!framing) return null;
  return aimShot(framing.boss, framing.ground, BOSS_SHOT.pitchDeg * DEG, halfFov, dolly);
}

/**
 * Horizontal distance from the boss at which a point `height` over its feet
 * and `behind` metres beyond it touches the highest the frame allows
 * (`crown` of the upper half), for a camera looking down by `pitch` that
 * holds the boss's feet at `feet` of the lower half. Closer, it leaves the
 * frame at the top.
 */
function shotReach(pitch: number, halfFov: number, height: number, behind: number): number {
  // Height of the camera over the boss's feet per metre away, and of the
  // highest point the frame shows over the camera per metre beyond it
  const rise = Math.tan(pitch + BOSS_SHOT.feet * halfFov);
  const top = Math.tan(BOSS_SHOT.crown * halfFov - pitch);
  return (height - top * behind) / (rise + top);
}

/**
 * The boss out of its portal and the ground under the camera of the shot
 * along the route (portalShot), null for a route without length or one that
 * ends at the boss.
 */
function routeFraming(
  route: readonly ShotPoint[],
  halfFov: number,
  portalScale: number,
  bossDistance: number,
  bossHeight: number,
): { boss: ShotPoint; ground: ShotPoint } | null {
  if (route.length < 2) return null;
  const boss = pointAlongRoute(route, bossDistance, { x: 0, y: 0, z: 0 });
  const crown = route[0].y + PORTAL_FRAME_TOP * portalScale - boss.y;
  const away = Math.max(
    bossHeight * BOSS_SHOT.bossHeights,
    shotReach(BOSS_SHOT.pitchDeg * DEG, halfFov, crown, bossDistance),
  );
  const ground = pointAlongRoute(route, bossDistance + away, { x: 0, y: 0, z: 0 });
  if (Math.hypot(ground.x - boss.x, ground.z - boss.z) < 1) return null;
  return { boss, ground };
}

/**
 * A camera over `ground` (its x and z, the ground's height under it) aimed
 * at `boss`: looking down by `pitch`, so high that the boss's feet sit
 * `feet` down the lower half of the frame, at least `minClearance` over the
 * ground; the target on that line of sight above the boss.
 */
function aimShot(boss: ShotPoint, ground: ShotPoint, pitch: number, halfFov: number, dolly: number): PortalShot {
  const across = Math.hypot(ground.x - boss.x, ground.z - boss.z);
  const y = Math.max(
    boss.y + across * Math.tan(pitch + BOSS_SHOT.feet * halfFov),
    ground.y + BOSS_SHOT.minClearance,
  );
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

/**
 * What the shot search asks of the world. In the game TerrainQueries
 * answers against the loaded tiles (in DevWorld its terrain and buildings).
 */
export interface ShotProbe {
  /**
   * True when a surface lies on the straight line from `from` to `to`. The
   * game's ray stops half a metre short of `to` and, like the tiles' own
   * materials, sees surfaces only from their front: cast from the subject
   * to the camera, it also meets the facade of a building the camera stands in.
   */
  blocked(from: ShotPoint, to: ShotPoint): boolean;
  /** Lowest and highest surface in the column at (x, z), null where no tile is. */
  column(x: number, z: number): { groundY: number; topY: number } | null;
}

/** The shot the search settled on. */
export interface ShotChoice {
  shot: PortalShot;
  /** 'route' for the shot portalShot composes, else pitch, reach and turn, e.g. 'p14-near+25' */
  label: string;
  /** All checks passed (SHOT_CHECKS) */
  clear: boolean;
  /** Checks passed in order before the first that failed, see PortalShotSearch */
  score: number;
  /** Rays cast, column probes included */
  rays: number;
  /** Candidates looked at */
  tried: number;
}

/** Checks per candidate: camera free, chest, feet, head, lintel, crown, room at the sides. */
export const SHOT_CHECKS = 7;

/** Most rays one candidate costs: the column, five sight lines, two to the sides. */
export const SHOT_CANDIDATE_RAYS = 8;

/** Two candidates of one pitch closer than this (m) are one: the first counts. */
const SAME_SPOT_M = 1.5;

/** Where on the boss the camera must see it, share of its height; the feet at least half a metre up. */
const BOSS_SIGHT = { feet: 0.15, chest: 0.55, head: 0.95, feetLeast: 0.5 } as const;

/** Just under the tip of the crown, share of the portal's frame top. */
const CROWN_SIGHT = 0.9;

interface ShotCandidate {
  label: string;
  x: number;
  z: number;
  pitch: number;
  /** Ground under the camera along the route (the shot portalShot composes); others read their column */
  routeGround: number | null;
  /** The whole portal is in the frame, so its crown has to be seen as well */
  crown: boolean;
}

/**
 * Picks a portal shot with a clear view (night-2 playtest 366, 2026-09-14:
 * in a narrow street the shot along the route looked through the houses
 * after a bend, or over a hedge that hid the boss).
 *
 * Candidates in order: the shot portalShot composes, then BOSS_SHOT_FALLBACKS
 * (turned, closer, higher). Each is checked in this order, the first failing
 * check ends it: the camera stands at least `headroom` above the highest
 * surface of its column (not inside a building, a crown or under a roof); a
 * clear line from the boss's chest, feet and head, from the portal's lintel
 * and, where the whole portal is framed, from its crown to the camera; free
 * `sideRoom` to its left and right. The first candidate that passes all
 * SHOT_CHECKS wins. Without one the one that got furthest does, the earlier
 * on a tie, so with nothing clear at all it is the shot portalShot composes.
 *
 * Bounded: BOSS_SHOT_RAYS.total rays in all; step() spreads them over the
 * frames of the veil, result() casts the rest. Free of three: the rays come
 * from `probe`.
 */
export class PortalShotSearch {
  private readonly candidates: ShotCandidate[] = [];
  private readonly tried: ShotCandidate[] = [];
  private next = 0;
  private rays = 0;
  private best: { candidate: ShotCandidate; shot: PortalShot; score: number } | null = null;
  /** The candidate being looked at, paused before its next ray */
  private looking: Generator<void, void> | null = null;
  /** The boss's feet on the route */
  private readonly boss: ShotPoint;
  private readonly sight: { chest: ShotPoint; feet: ShotPoint; head: ShotPoint; lintel: ShotPoint; crown: ShotPoint };

  /**
   * Arguments as portalShot's, plus the probe.
   *
   * @returns null where portalShot has no shot: then there is no intro
   */
  static create(
    route: readonly ShotPoint[],
    fovDeg: number,
    portalScale: number,
    bossDistance: number,
    bossHeight: number,
    probe: ShotProbe,
    dolly: number = BOSS_SHOT.dolly,
  ): PortalShotSearch | null {
    const halfFov = (fovDeg * Math.PI) / 360;
    const framing = routeFraming(route, halfFov, portalScale, bossDistance, bossHeight);
    if (!framing) return null;
    return new PortalShotSearch(route[0], framing, halfFov, portalScale, bossHeight, probe, dolly);
  }

  private constructor(
    portal: ShotPoint,
    framing: { boss: ShotPoint; ground: ShotPoint },
    private readonly halfFov: number,
    portalScale: number,
    bossHeight: number,
    private readonly probe: ShotProbe,
    private readonly dolly: number,
  ) {
    const { boss, ground } = framing;
    this.boss = boss;
    const at = (p: ShotPoint, up: number) => ({ x: p.x, y: p.y + up, z: p.z });
    this.sight = {
      chest: at(boss, BOSS_SIGHT.chest * bossHeight),
      feet: at(boss, Math.max(BOSS_SIGHT.feetLeast, BOSS_SIGHT.feet * bossHeight)),
      head: at(boss, BOSS_SIGHT.head * bossHeight),
      lintel: at(portal, PORTAL_OPENING_HEIGHT * portalScale),
      crown: at(portal, CROWN_SIGHT * PORTAL_FRAME_TOP * portalScale),
    };
    const basePitch = BOSS_SHOT.pitchDeg * DEG;
    this.candidates.push({ label: 'route', x: ground.x, z: ground.z, pitch: basePitch, routeGround: ground.y, crown: true });

    // Heights over the boss's feet, as shotReach takes them
    const crown = portal.y + PORTAL_FRAME_TOP * portalScale - boss.y;
    const lintel = portal.y + PORTAL_OPENING_HEIGHT * portalScale - boss.y;
    const chord = Math.hypot(boss.x - portal.x, boss.z - portal.z);
    if (chord < 1) return;
    const ux = (boss.x - portal.x) / chord;
    const uz = (boss.z - portal.z) / chord;
    for (const row of BOSS_SHOT_FALLBACKS) {
      const pitch = row.pitchDeg * DEG;
      for (const turn of row.yawDeg.flatMap((deg) => (deg === 0 ? [0] : [deg, -deg]))) {
        const yaw = turn * DEG;
        // The portal beyond the boss, along the view
        const behind = chord * Math.cos(yaw);
        const far = Math.max(bossHeight * BOSS_SHOT.bossHeights, shotReach(pitch, halfFov, crown, behind));
        const near = Math.min(
          far,
          Math.max(shotReach(pitch, halfFov, lintel, behind), shotReach(pitch, halfFov, bossHeight, 0)),
        );
        const reach = row.reach === 'far' ? far : row.reach === 'near' ? near : (far + near) / 2;
        const dx = ux * Math.cos(yaw) - uz * Math.sin(yaw);
        const dz = ux * Math.sin(yaw) + uz * Math.cos(yaw);
        this.candidates.push({
          label: `p${row.pitchDeg}-${row.reach}${turn === 0 ? '' : turn > 0 ? `+${turn}` : turn}`,
          x: boss.x + dx * reach,
          z: boss.z + dz * reach,
          pitch,
          routeGround: null,
          crown: row.reach === 'far',
        });
      }
    }
  }

  /** Rays cast so far, column probes included. */
  get raysCast(): number {
    return this.rays;
  }

  /**
   * A clear shot was found, every candidate was looked at, or the rays left
   * would not do for one more. A candidate once started runs to its end.
   */
  get done(): boolean {
    if (this.best?.score === SHOT_CHECKS) return true;
    if (this.looking) return false;
    return this.next >= this.candidates.length || this.rays + SHOT_CANDIDATE_RAYS > BOSS_SHOT_RAYS.total;
  }

  /** Look at candidates until `rays` more have been cast or the search is done. */
  step(rays: number): void {
    const stop = this.rays + rays;
    while (this.rays < stop) {
      if (!this.looking) {
        if (this.done) return;
        this.looking = this.look(this.candidates[this.next++]);
      }
      // Up to its next ray, or to its end
      if (this.looking.next().done) this.looking = null;
    }
  }

  /** The search to its end, and its pick. */
  result(): ShotChoice {
    this.step(Infinity);
    // The route candidate comes first and fits the budget, so there is a best
    const { candidate, shot, score } = this.best!;
    return { shot, label: candidate.label, clear: score === SHOT_CHECKS, score, rays: this.rays, tried: this.tried.length };
  }

  /** One candidate, pausing before each ray (step). */
  private *look(candidate: ShotCandidate): Generator<void, void> {
    const same = this.tried.some(
      (t) => t.pitch === candidate.pitch && Math.hypot(t.x - candidate.x, t.z - candidate.z) < SAME_SPOT_M,
    );
    if (same) return;
    this.tried.push(candidate);
    const column = yield* this.column(candidate.x, candidate.z);
    const ground = { x: candidate.x, y: candidate.routeGround ?? column?.groundY ?? this.boss.y, z: candidate.z };
    const shot = aimShot(this.boss, ground, candidate.pitch, this.halfFov, this.dolly);
    const score = yield* this.score(candidate, shot, column);
    if (!this.best || score > this.best.score) this.best = { candidate, shot, score };
  }

  /** Checks passed in order before the first that failed. */
  private *score(
    candidate: ShotCandidate,
    shot: PortalShot,
    column: { topY: number } | null,
  ): Generator<void, number> {
    const eye = shot.position;
    let passed = 0;
    if (column && column.topY > eye.y - BOSS_SHOT.headroom) return passed;
    passed++;
    const { chest, feet, head, lintel, crown } = this.sight;
    for (const from of [chest, feet, head, lintel]) {
      if (yield* this.blocked(from, eye)) return passed;
      passed++;
    }
    if (candidate.crown && (yield* this.blocked(crown, eye))) return passed;
    passed++;
    // Horizontal, square to the view
    const viewX = shot.target.x - eye.x;
    const viewZ = shot.target.z - eye.z;
    const length = Math.hypot(viewX, viewZ);
    for (const side of [1, -1]) {
      const reach = (side * BOSS_SHOT.sideRoom) / length;
      if (yield* this.blocked(eye, { x: eye.x - viewZ * reach, y: eye.y, z: eye.z + viewX * reach })) return passed;
    }
    return passed + 1;
  }

  private *blocked(from: ShotPoint, to: ShotPoint): Generator<void, boolean> {
    yield;
    this.rays++;
    return this.probe.blocked(from, to);
  }

  private *column(x: number, z: number): Generator<void, { groundY: number; topY: number } | null> {
    yield;
    this.rays++;
    return this.probe.column(x, z);
  }
}
