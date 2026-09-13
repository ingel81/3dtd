import { PORTAL_DEPTH, portalDepthScale } from '../configs/marker-geometry.config';
import { GAME_SPEEDS } from '../configs/game-speed.config';

/**
 * Boss intro: once a wave's boss has stepped out of its spawn portal, the
 * camera cuts to the portal, the boss's name shows, the game pauses; a click
 * or Esc skips (BossIntroService). What decides whether it plays lives here,
 * free of Angular and three.
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
