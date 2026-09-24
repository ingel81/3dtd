import type { GameClockState } from '../managers/game-state/game-clock';
import type { GameRngState } from '../utils/game-rng';
import type { ResearchSaveState } from '../configs/research/research.types';
import type { AbilitySaveState } from '../managers/ability.manager';
import type { HeroSaveState } from '../managers/hero.manager';
import type { TowerSimState } from '../entities/tower.entity';
import type { TowerTypeId, UpgradeId } from '../configs/tower-types.config';
import type { LosMaskJson } from '../utils/los-mask';
import type { GamePhase } from '../models/game.types';

/** Bumped whenever the shape changes; an export with another version is refused. */
export const SIM_SNAPSHOT_VERSION = 1;

/**
 * The simulation between two waves, as plain data: the state a wave is
 * re-simulated from (docs/SIMULATOR_PLAN.md, section 3 and P4).
 *
 * Between waves the simulation is nearly empty: no enemy, no spawner, no
 * pending strike. What is left fits in a few KB and is taken when a wave
 * starts (GameStateManager.captureSnapshot). The world (cells, heights,
 * routes) is not in it: a snapshot is only valid on the world it was taken
 * on; an export carries a key of the world with it.
 */
export interface SimSnapshot {
  version: number;
  clock: GameClockState;
  rng: GameRngState;
  /** GameObject id counter */
  idCounter: number;
  credits: number;
  baseHealth: number;
  waveNumber: number;
  phase: GamePhase;
  /** A wave has started in this run (game:started went out) */
  runStarted: boolean;
  economyPerfectStreak: number;
  research: ResearchSaveState;
  abilities: AbilitySaveState;
  hero: HeroSaveState;
  /** In the order the tower manager holds them, which is the order combat walks them */
  towers: SavedTower[];
  /** Id of the tower the player sits in */
  mannedTowerId: string | null;
  /** Towers waiting for their line of sight retrofit, oldest first */
  losQueue: string[];
}

export interface SavedTower {
  id: string;
  typeId: TowerTypeId;
  lat: number;
  lon: number;
  height: number;
  customRotation: number;
  plinthHeight: number;
  plinthOverhang: number[];
  upgrades: [UpgradeId, number][];
  /** Its line of sight; null for a passive building or a tower that never got one */
  losMask: LosMaskJson | null;
  state: TowerSimState;
}

/**
 * Why the state at a wave start cannot be re-simulated, or null when it can.
 * A snapshot is taken between waves, where nothing is in flight; a manned
 * tower's shot still flying or a debug enemy would be lost.
 */
export type SnapshotRefusal = 'enemies' | 'projectiles' | 'pending-strike' | 'not-setup';
