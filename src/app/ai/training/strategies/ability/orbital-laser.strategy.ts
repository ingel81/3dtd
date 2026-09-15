/**
 * Orbital Laser Strategy
 *
 * Priority: 93, under the other abilities.
 *
 * Fires when: a wave runs, the laser is ready (researched, charged) and a
 * beam aimed at one of the enemies in the second half of its route (path
 * progress from 0.5) would burn at least MIN_HITS enemies.
 * Aims at: the spot that enemy reaches when the beam lands, for the enemy
 * whose beam burns most (expected share of max HP, summed over the enemies
 * it hits); at most MAX_AIM_CANDIDATES candidates, ties keep the first. The
 * AbilityManager snaps the aim to the route.
 *
 * The beam is the ability's own: AbilityManager.previewSweep gives the route
 * stretch it burns along, the config its warning, speed, time and radius.
 * The enemies walk on at their speed of the moment (slows and halts
 * included) along the stretch toward its start, head-on into the beam; see
 * beamOutcome().
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';
import { GameStateManager } from '../../../../managers/game-state.manager';
import {
  ABILITIES,
  type AbilityEffect,
  abilityBeamBurnMs,
  abilityBeamCap,
  abilityBeamFraction,
  abilityBeamReachM,
} from '../../../../configs/abilities.config';
import type { Enemy } from '../../../../entities/enemy.entity';
import type { GeoPosition } from '../../../../models/game.types';
import { geoDistanceFast } from '../../../../utils/geo-utils';
import { getRouteProfile } from '../../../../utils/route-corridor';
import { pointAlongSweep, sweepOffset, type RouteSweep } from '../../../../utils/route-sweep';
import { DecisionAim, MAX_AIM_CANDIDATES, enemiesFromProgress } from './ability-aim';

const LASER = ABILITIES['orbital-laser'];
const BEAM = LASER.effect.kind === 'beam' ? LASER.effect : null;
const REACH_M = BEAM ? abilityBeamReachM(BEAM) : 0;
const WARNING_S = LASER.warningMs / 1000;

type BeamEffect = Extract<AbilityEffect, { kind: 'beam' }>;

interface LaserAim {
  /** Where the beam is aimed */
  point: GeoPosition;
  /** Enemies it is expected to burn */
  hits: number;
  /** Their expected loss, as a share of max HP, summed */
  burnt: number;
}

export class OrbitalLaserStrategy extends BaseStrategy {
  /** Candidates count from this path progress on */
  static readonly FROM_PROGRESS = 0.5;
  /** Fewer enemies than this under the beam and the charge is kept */
  static readonly MIN_HITS = 10;

  private readonly decision = new DecisionAim<LaserAim>();
  /** Speed of each alive enemy, in getAlive() order; reused per aim */
  private readonly speeds: number[] = [];

  constructor(private readonly gameState: GameStateManager) {
    super('OrbitalLaser', 93);
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (state.phase !== 'wave') return false;
    if (this.gameState.abilityManager.checkUse(LASER.id) !== null) return false;
    return this.decision.find(state, () => this.aim()) !== null;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const aim = this.decision.take(state, () => this.aim());
    if (!aim) return null;
    return {
      type: 'use-ability',
      abilityId: LASER.id,
      position: { x: aim.point.lon, z: aim.point.lat },
      confidence: 0.85,
      reason: `Orbital laser down the route through ${aim.hits} enemies`,
    };
  }

  /** The candidate whose beam burns most of those with at least MIN_HITS hits, or null. */
  private aim(): LaserAim | null {
    if (!BEAM) return null;
    const candidates = enemiesFromProgress(this.gameState, OrbitalLaserStrategy.FROM_PROGRESS);
    if (candidates.length === 0) return null;

    const now = this.gameState.gameTimeMs;
    const alive = this.gameState.enemyManager.getAlive();
    const speeds = this.speeds;
    speeds.length = 0;
    let fastest = 0;
    for (const enemy of alive) {
      const speed = enemy.movement.getEffectiveSpeed(now);
      speeds.push(speed);
      if (speed > fastest) fastest = speed;
    }
    // The stretch looked at runs on past the beam's reach as far as the
    // fastest enemy walks until the beam goes out: it walks into the beam.
    const lookM = REACH_M + fastest * (WARNING_S + BEAM.durationMs / 1000) + LASER.radiusM;

    const stride = Math.ceil(candidates.length / MAX_AIM_CANDIDATES);
    let best: LaserAim | null = null;
    for (let i = 0; i < candidates.length; i += stride) {
      const candidate = candidates[i];
      const point = pointAhead(candidate, candidate.movement.getEffectiveSpeed(now) * WARNING_S);
      const sweep = this.gameState.abilityManager.previewSweep(LASER.id, point, lookM);
      if (!sweep) continue;
      const aim = beamOutcome(BEAM, sweep, alive, speeds, point);
      if (aim.hits < OrbitalLaserStrategy.MIN_HITS) continue;
      if (best === null || aim.burnt > best.burnt) best = aim;
    }
    return best;
  }
}

/**
 * The point `aheadM` further along `enemy`'s path centre line than it
 * stands, clamped to the path's end. The path with its profile's lengths is
 * a stretch like a sweep, so pointAlongSweep walks it.
 */
function pointAhead(enemy: Enemy, aheadM: number): GeoPosition {
  const path = enemy.movement.path;
  const profile = getRouteProfile(path);
  const route: RouteSweep = { points: path, cumulative: profile.cumulativeLength, length: profile.totalLength };
  return pointAlongSweep(route, enemy.movement.getDistanceAlongPath() + aheadM, { lat: 0, lon: 0 });
}

/**
 * What a beam aimed at `point` does to `enemies` (their speeds in `speeds`,
 * same order). `sweep` is its route stretch, run on past the reach.
 *
 * The beam lands on the stretch's start after the warning and runs toward
 * the spawn at `speedMps` until its burn time is up (abilityBeamBurnMs). An
 * enemy within the radius of the stretch walks along it toward the start at
 * its speed from now on, so the two close at the sum of their speeds, and it
 * stays under the beam while their gap along the stretch is within
 * sqrt(r² - off²) of zero, `off` its distance from the stretch. It loses its
 * share of max HP for that time (abilityBeamFraction), at most the cap and
 * what it has left. An enemy that stays under the beam for no time at all is
 * no hit, like one the manager deals nothing to.
 */
function beamOutcome(
  effect: BeamEffect,
  sweep: RouteSweep,
  enemies: readonly Enemy[],
  speeds: readonly number[],
  point: GeoPosition,
): LaserAim {
  const radius = LASER.radiusM;
  const burnS = abilityBeamBurnMs(effect, Math.min(REACH_M, sweep.length)) / 1000;
  const start = sweep.points[0];
  let hits = 0;
  let burnt = 0;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    // No point of the stretch lies farther from its start than its length
    if (geoDistanceFast(start, enemy.position) > sweep.length + radius) continue;
    const at = sweepOffset(sweep, enemy.position, radius);
    if (!at) continue;

    const speed = speeds[i];
    const closing = effect.speedMps + speed;
    if (closing <= 0) continue;
    const halfM = Math.sqrt(radius * radius - at.offM * at.offM);
    // Along the stretch from its start to the enemy when the beam lands
    const gapM = at.alongM - speed * WARNING_S;
    const enterS = Math.max(0, (gapM - halfM) / closing);
    const leaveS = Math.min(burnS, (gapM + halfM) / closing);
    if (leaveS <= enterS) continue;

    const share = Math.min(
      abilityBeamFraction(effect, enemy.typeConfig, enemy.getEffectiveArmorType(), (leaveS - enterS) * 1000),
      abilityBeamCap(effect, enemy.typeConfig),
      enemy.health.hp / enemy.health.maxHp,
    );
    if (share <= 0) continue;
    hits++;
    burnt += share;
  }
  return { point, hits, burnt };
}
