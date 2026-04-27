/**
 * ResearchManager — Framework-agnostic research system manager.
 *
 * Tracks active/completed researches, ticks progress in GAME-TIME (sub-step
 * driven), and emits events on completion. Same pattern as TowerManager /
 * EnemyManager. With sub-stepping a research authored as "60s game-time"
 * always takes exactly 60s of game-time, regardless of training speed.
 */

import { GameEventBus } from '../game-engine';
import {
  ResearchId,
  ResearchConfig,
  ActiveResearch,
  ResearchSaveState,
} from '../configs/research/research.types';
import {
  RESEARCH_TREE,
  getResearch,
  getResearchForTower,
} from '../configs/research/research-tree.config';
import {
  RESEARCH_CENTER_CONFIG,
  getMaxResearchSlots,
} from '../configs/research/research-center.config';
import { TowerTypeId } from '../configs/tower-types.config';

export class ResearchManager {
  private completedResearches = new Set<ResearchId>();
  private activeResearches = new Map<ResearchId, ActiveResearch>();
  private _centerLevel = 0; // 0 = not placed, 1-3 = placed + level
  private _maxSlots = 1;

  constructor(private readonly eventBus: GameEventBus) {}

  // ==================== Queries ====================

  get centerLevel(): number {
    return this._centerLevel;
  }

  get maxSlots(): number {
    return this._maxSlots;
  }

  get usedSlots(): number {
    return this.activeResearches.size;
  }

  get availableSlots(): number {
    return Math.max(0, this._maxSlots - this.activeResearches.size);
  }

  isCompleted(id: ResearchId): boolean {
    return this.completedResearches.has(id);
  }

  isActive(id: ResearchId): boolean {
    return this.activeResearches.has(id);
  }

  /** Check if all prerequisites are met and research is not completed/active. */
  isAvailable(id: ResearchId): boolean {
    if (this.isCompleted(id) || this.isActive(id)) return false;
    const config = getResearch(id);
    if (!config) return false;
    return config.prerequisites.every(prereq => this.completedResearches.has(prereq));
  }

  /** Check if prerequisites are NOT met (locked in UI). */
  isLocked(id: ResearchId): boolean {
    if (this.isCompleted(id) || this.isActive(id)) return false;
    const config = getResearch(id);
    if (!config) return true;
    return !config.prerequisites.every(prereq => this.completedResearches.has(prereq));
  }

  /** Check if a specific tower is unlocked (either default or via completed research). */
  isTowerUnlocked(towerId: TowerTypeId): boolean {
    // Archer is always available, Research Center is always available
    if (towerId === 'archer' || towerId === 'research-center') return true;
    // Check if any completed research unlocks this tower
    for (const researchId of this.completedResearches) {
      const config = getResearch(researchId);
      if (config) {
        for (const effect of config.effects) {
          if (effect.kind === 'unlock-tower' && effect.towerId === towerId) return true;
        }
      }
    }
    return false;
  }

  /** Get the research needed to unlock a tower, or undefined if no research needed. */
  getRequiredResearchForTower(towerId: TowerTypeId): ResearchConfig | undefined {
    if (towerId === 'archer' || towerId === 'research-center') return undefined;
    return getResearchForTower(towerId);
  }

  /** Get snapshot of all active researches. */
  getActiveResearches(): ActiveResearch[] {
    return [...this.activeResearches.values()];
  }

  /** Get set of completed research IDs. */
  getCompletedResearches(): Set<ResearchId> {
    return new Set(this.completedResearches);
  }

  /** Get the highest unlocked upgrade tier. */
  getMaxUpgradeTier(): number {
    let maxTier = 1; // T1 is always available
    for (const researchId of this.completedResearches) {
      const config = getResearch(researchId);
      if (config) {
        for (const effect of config.effects) {
          if (effect.kind === 'unlock-upgrade-tier' && effect.tier > maxTier) {
            maxTier = effect.tier;
          }
        }
      }
    }
    return maxTier;
  }

  /** Check if a specific global perk is unlocked. */
  isPerkUnlocked(perkId: string): boolean {
    for (const researchId of this.completedResearches) {
      const config = getResearch(researchId);
      if (config) {
        for (const effect of config.effects) {
          if (effect.kind === 'global-perk' && effect.perkId === perkId) return true;
        }
      }
    }
    return false;
  }

  /** Check if air targeting is enabled via research. */
  isAirTargetingEnabled(): boolean {
    for (const researchId of this.completedResearches) {
      const config = getResearch(researchId);
      if (config) {
        for (const effect of config.effects) {
          if (effect.kind === 'enable-targeting' && effect.capability === 'air') return true;
        }
      }
    }
    return false;
  }

  // ==================== Actions ====================

  /**
   * Validate whether a research can be started.
   * @returns Object with canStart flag and optional reason string.
   */
  canStartResearch(id: ResearchId, availableCredits: number): { canStart: boolean; reason?: string } {
    if (this._centerLevel === 0) {
      return { canStart: false, reason: 'No Research Center placed' };
    }
    if (this.isCompleted(id)) {
      return { canStart: false, reason: 'Already completed' };
    }
    if (this.isActive(id)) {
      return { canStart: false, reason: 'Already in progress' };
    }
    const config = getResearch(id);
    if (!config) {
      return { canStart: false, reason: 'Unknown research' };
    }
    if (!config.prerequisites.every(p => this.completedResearches.has(p))) {
      return { canStart: false, reason: 'Prerequisites not met' };
    }
    if (this.availableSlots <= 0) {
      return { canStart: false, reason: 'No available research slots' };
    }
    if (availableCredits < config.cost) {
      return { canStart: false, reason: 'Not enough credits' };
    }
    return { canStart: true };
  }

  /**
   * Start a research. Caller must deduct credits.
   * @returns true if started successfully.
   */
  startResearch(id: ResearchId): boolean {
    const config = getResearch(id);
    if (!config) return false;

    const active: ActiveResearch = {
      researchId: id,
      startTime: performance.now(),
      duration: config.duration,
      elapsed: 0,
      cost: config.cost,
    };

    this.activeResearches.set(id, active);

    this.eventBus.emit({
      type: 'research:started',
      researchId: id,
      cost: config.cost,
      duration: config.duration,
    });

    return true;
  }

  /**
   * Cancel an active research. Returns credit refund amount.
   */
  cancelResearch(id: ResearchId): number {
    const active = this.activeResearches.get(id);
    if (!active) return 0;

    this.activeResearches.delete(id);
    const refund = Math.floor(active.cost * RESEARCH_CENTER_CONFIG.cancellationRefundPercent);

    this.eventBus.emit({
      type: 'research:cancelled',
      researchId: id,
      refund,
    });

    return refund;
  }

  /**
   * Called when Research Center is placed.
   */
  onCenterPlaced(): void {
    this._centerLevel = 1;
    this._maxSlots = getMaxResearchSlots(1);
  }

  /**
   * Called when Research Center is upgraded.
   */
  upgradeCenter(): void {
    if (this._centerLevel >= RESEARCH_CENTER_CONFIG.maxLevel) return;
    this._centerLevel++;
    this._maxSlots = getMaxResearchSlots(this._centerLevel);
  }

  /**
   * Called when Research Center is sold (shouldn't happen, but safety).
   */
  onCenterRemoved(): void {
    this._centerLevel = 0;
    // Cancel all active researches
    for (const [id] of this.activeResearches) {
      this.cancelResearch(id);
    }
  }

  // ==================== Update Loop ====================

  /**
   * Tick all active researches. Called every gameplay sub-step with the
   * step's GAME-TIME delta in seconds (engine sub-step is ~16ms game-time).
   */
  update(gameDeltaSeconds: number): void {
    if (this.activeResearches.size === 0) return;

    const completed: ResearchId[] = [];

    for (const [id, active] of this.activeResearches) {
      active.elapsed += gameDeltaSeconds;

      if (active.elapsed >= active.duration) {
        completed.push(id);
      }
    }

    // Process completions
    for (const id of completed) {
      this.activeResearches.delete(id);
      this.completedResearches.add(id);

      const config = getResearch(id);
      if (config) {
        this.eventBus.emit({
          type: 'research:completed',
          researchId: id,
          effects: config.effects,
        });
      }
    }
  }

  // ==================== Lifecycle ====================

  reset(): void {
    this.completedResearches.clear();
    this.activeResearches.clear();
    this._centerLevel = 0;
    this._maxSlots = 1;
  }

  // ==================== Save/Load ====================

  getState(): ResearchSaveState {
    return {
      completed: [...this.completedResearches],
      active: [...this.activeResearches.values()].map(a => ({
        researchId: a.researchId,
        elapsed: a.elapsed,
      })),
      slots: this._maxSlots,
      centerLevel: this._centerLevel,
    };
  }

  restoreState(state: ResearchSaveState): void {
    this.completedResearches = new Set(state.completed);
    this._maxSlots = state.slots;
    this._centerLevel = state.centerLevel;

    this.activeResearches.clear();
    for (const active of state.active) {
      const config = getResearch(active.researchId);
      if (config) {
        this.activeResearches.set(active.researchId, {
          researchId: active.researchId,
          startTime: performance.now(),
          duration: config.duration,
          elapsed: active.elapsed,
          cost: config.cost,
        });
      }
    }
  }
}
