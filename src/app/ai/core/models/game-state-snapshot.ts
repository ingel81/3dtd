/**
 * Game State Snapshot - AI Input
 *
 * Represents the complete game state at a point in time.
 * Used as input for the Wave Director AI to decide the next wave.
 *
 * All values are raw (not normalized). Normalization happens in GameStateEncoder.
 */

import { GamePhase } from '../../../models/game.types';
import { PathDPSProfile } from '../dps-profile';
import { TowerTypeId } from '../../../configs/tower-types.config';
import { ArmorType, DamageType } from '../../../configs/combat/combat.types';

export interface GameStateSnapshot {
  // === META ===
  timestamp: number;
  waveNumber: number;
  gameTimeSeconds: number;
  phase: GamePhase;

  // === PLAYER STATE ===
  player: PlayerState;

  // === DEFENSE ANALYSIS ===
  defense: DefenseAnalysis;

  // === VULNERABILITIES ===
  vulnerabilities: VulnerabilityAnalysis;

  // === RECENT HISTORY ===
  recentHistory: RecentHistory;

  // === DPS PROFILE (spatial defense along path) ===
  dpsProfile: PathDPSProfile;

  // === RESEARCH STATE ===
  research: ResearchSnapshot;

  /** Expected armor distribution in current or next wave (used by Bot for tower picks) */
  expectedArmorDistribution?: Record<ArmorType, number>;

  /**
   * DPS aggregated by DamageType (normalized, pre-computed).
   * MUST be in the snapshot so the Python backend gets it via WebSocket.
   * If omitted, encoder falls back to computing from towerDistribution (frontend only).
   */
  dpsByDamageType?: Record<DamageType, number>;
}

export interface ResearchSnapshot {
  /** IDs of completed researches */
  completedIds: string[];
  completedCount: number;
  totalCount: number;
  /** IDs of currently-active (in-progress) researches */
  activeIds: string[];
  /** Research Center building level (0 = not placed, 1-3 = placed + level) */
  centerLevel: number;
  /** Currently running researches */
  slotsUsed: number;
  maxSlots: number;
  /** Perk flags derived from completed researches */
  airTargetingUnlocked: boolean;
  maxUpgradeTier: number;
  /** Per-tower unlock map (true = unlocked or always-free) */
  towerUnlocked: Record<TowerTypeId, boolean>;
}

export interface PlayerState {
  credits: number;
  lives: number;
  maxLives: number;

  /** Lives as percentage (0-1) */
  livesPercent: number;
}

export interface DefenseAnalysis {
  /** Total number of towers placed */
  towerCount: number;

  /** Total damage per second across all towers */
  totalDPS: number;

  /** DPS from towers that can target air units */
  antiAirDPS: number;

  /** Average tower level (1-5) */
  avgTowerLevel: number;

  /** Percentage of path covered by tower range (0-1) */
  pathCoverage: number;

  /** Furthest point on path reachable by any tower (0-1) */
  defenseReachPercent: number;

  /** Concentrated firepower score (0-1) - higher means kill zones exist */
  killZoneStrength: number;

  /** Variety of tower types (0-1) - higher means more diverse defense */
  towerVariety: number;

  /** Defense capabilities - what can the defense handle? */
  capabilities: DefenseCapabilities;

  /** Tower distribution by type */
  towerDistribution: TowerDistribution;

  /**
   * Armor-matrix weighted effective DPS per armor category.
   * Already multiplied with DAMAGE_MATRIX[towerDamageType][armor] so the
   * network sees "how hard do I actually hit a heavy unit at this defense
   * setup, separated by ground vs air targeting".
   */
  effectiveDPSPerArmor: EffectiveDPSPerArmor;

  /**
   * Share of DPS that comes from area-of-effect sources, ground and air.
   *
   * Splash, chain and beam-width are folded into each tower's DPS as a fixed
   * multiplier, which is independent of how many enemies are actually in the
   * blast — and enemy density is precisely what the wave director controls via
   * count and spawn delay. A cannon battery and an archer nest can show the
   * same DPS while behaving completely differently against a packed swarm.
   * This tells the net whether the defense scales with density at all.
   */
  aoeDpsShare: { ground: number; air: number };

  /**
   * Aggregate kill throughput ceiling, in targets per second.
   *
   * Raw DPS overstates what a defense can do against a swarm of individually
   * weak enemies, because a tower engages one target at a time and the surplus
   * damage of each shot is wasted. Two archers at 25 damage and 1 shot/s kill
   * two 3 HP rats per second, not the fifteen their 50 DPS suggests. Splash and
   * chain towers count for more than one target per shot.
   */
  killThroughput: { ground: number; air: number };
}

export interface EffectiveDPSPerArmor {
  ground: Record<ArmorType, number>;
  air: Record<ArmorType, number>;
}

export interface DefenseCapabilities {
  /** Has towers that can target flying enemies */
  hasAntiAir: boolean;

  /** Has towers with splash/area damage */
  hasSplash: boolean;

  /** Has towers with slow effect */
  hasSlow: boolean;

  /** Has towers with damage over time */
  hasDoT: boolean;

  /**
   * Has towers that hurt ethereal enemies (armor multiplier >= 1.0).
   * Physical, pierce and fire all read 0.15 against ethereal, so a defense
   * built purely from archers and gatlings is effectively unarmed against
   * ghosts and wraiths no matter how much raw DPS it has.
   */
  hasAntiEthereal: boolean;
}

export type TowerDistribution = Record<string, TowerTypeStats>;

export interface TowerTypeStats {
  count: number;
  avgLevel: number;
  totalDamage: number;
  totalDPS: number;
}

export interface VulnerabilityAnalysis {
  /** No anti-air defense - vulnerable to flying */
  airDefenseGap: boolean;

  /** No splash damage - vulnerable to swarms */
  splashGap: boolean;

  /** No slow towers - vulnerable to fast enemies */
  slowGap: boolean;

  /** No tower deals meaningful damage to ethereal enemies */
  etherealGap: boolean;

  /** Path segments not covered by any tower (indices) */
  uncoveredPathSegments: number[];

  /** Overall vulnerability score (0-1) - higher means more vulnerable */
  overallVulnerability: number;
}

export interface RecentHistory {
  /** Damage taken in last N waves (percentage, 0-1 each) */
  damagePerWave: number[];

  /** Average enemy path progress per wave (0-1 each) */
  progressPerWave: number[];

  /** Near-miss ratio per wave (fraction of enemies reaching >0.8 path, 0-1 each) */
  nearMissPerWave: number[];

  /** Enemy types used in last N waves */
  enemyTypesUsed: string[][];

  /** Threat rating of last wave (1.0 = baseline Zombie, 3.5 = Tank, 25.0 = Herbert) */
  lastWaveThreat: number;

  /** Average wave duration in seconds */
  avgWaveDuration: number;

  /** Number of consecutive waves with no damage */
  winStreak: number;

  /** Number of consecutive "close call" waves */
  closeCallStreak: number;
}

/**
 * Default empty snapshot for initialization
 */
export function createEmptySnapshot(): GameStateSnapshot {
  return {
    timestamp: Date.now(),
    waveNumber: 0,
    gameTimeSeconds: 0,
    phase: 'setup',
    player: {
      credits: 0,
      lives: 100,
      maxLives: 100,
      livesPercent: 1,
    },
    defense: {
      towerCount: 0,
      totalDPS: 0,
      antiAirDPS: 0,
      avgTowerLevel: 0,
      pathCoverage: 0,
      defenseReachPercent: 0,
      killZoneStrength: 0,
      towerVariety: 0,
      capabilities: {
        hasAntiAir: false,
        hasSplash: false,
        hasSlow: false,
        hasDoT: false,
        hasAntiEthereal: false,
      },
      towerDistribution: {},
      effectiveDPSPerArmor: {
        ground: { unarmored: 0, light: 0, heavy: 0, fortified: 0, ethereal: 0 },
        air: { unarmored: 0, light: 0, heavy: 0, fortified: 0, ethereal: 0 },
      },
      aoeDpsShare: { ground: 0, air: 0 },
      killThroughput: { ground: 0, air: 0 },
    },
    vulnerabilities: {
      airDefenseGap: true,
      splashGap: true,
      slowGap: true,
      etherealGap: true,
      uncoveredPathSegments: [],
      overallVulnerability: 1,
    },
    recentHistory: {
      damagePerWave: [],
      progressPerWave: [],
      nearMissPerWave: [],
      enemyTypesUsed: [],
      lastWaveThreat: 0,
      avgWaveDuration: 0,
      winStreak: 0,
      closeCallStreak: 0,
    },
    dpsProfile: {
      groundDPS: new Array(20).fill(0),
      airDPS: new Array(20).fill(0),
      binPositions: [],
    },
    research: {
      completedIds: [],
      completedCount: 0,
      totalCount: 0,
      activeIds: [],
      centerLevel: 0,
      slotsUsed: 0,
      maxSlots: 0,
      airTargetingUnlocked: false,
      maxUpgradeTier: 1,
      towerUnlocked: {
        archer: true,
        cannon: false,
        magic: false,
        'dual-gatling': false,
        rocket: false,
        ice: false,
        fire: false,
        tentacle: false,
        poison: false,
        lightning: false,
        'research-center': true,
      },
    },
  };
}
