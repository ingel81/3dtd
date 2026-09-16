/**
 * ResearchManager — Framework-agnostic research system manager.
 *
 * Tracks active/completed researches, ticks progress in GAME-TIME (sub-step
 * driven), and emits events on completion. Same pattern as TowerManager /
 * EnemyManager. With sub-stepping a research authored as "60s game-time"
 * always takes exactly 60s of game-time, regardless of training speed.
 */

import { GameEventBus, IGameManager } from '../game-engine';
import {
  ResearchId,
  ActiveResearch,
  ResearchSaveState,
} from '../configs/research/research.types';
import {
  RESEARCH_TREE,
  getResearch,
} from '../configs/research/research-tree.config';
import {
  RESEARCH_CENTER_CONFIG,
  getMaxResearchSlots,
} from '../configs/research/research-center.config';
import { TowerTypeId } from '../configs/tower-types.config';

export class ResearchManager implements IGameManager {
  private completedResearches = new Set<ResearchId>();
  private activeResearches = new Map<ResearchId, ActiveResearch>();
  /** Waiting for a slot and the credits, in start order, see startQueued(). */
  private queue: ResearchId[] = [];
  private _centerLevel = 0; // 0 = not placed, 1-3 = placed + level
  private _maxSlots = 1;

  /** Mindestabstand zweier `research:progress`-Events (Wanduhr, 10 Hz). */
  private static readonly PROGRESS_INTERVAL_MS = 100;
  private lastProgressEmitAt = -Infinity;

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

  /** Get snapshot of all active researches. */
  getActiveResearches(): ActiveResearch[] {
    return [...this.activeResearches.values()];
  }

  /** Get set of completed research IDs. */
  getCompletedResearches(): Set<ResearchId> {
    return new Set(this.completedResearches);
  }

  /** Queued research IDs in start order (copy). */
  getQueuedResearches(): ResearchId[] {
    return [...this.queue];
  }

  isQueued(id: ResearchId): boolean {
    return this.queue.includes(id);
  }

  /** Emit a `research:state-changed` snapshot covering every store-relevant field. */
  private emitStateSnapshot(): void {
    this.eventBus.emit({
      type: 'research:state-changed',
      activeResearches: this.getActiveResearches(),
      completedResearches: this.getCompletedResearches(),
      queuedResearches: this.getQueuedResearches(),
      centerLevel: this._centerLevel,
      maxSlots: this._maxSlots,
    });
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
    this.emitStateSnapshot();

    return true;
  }

  /**
   * Whether a research can go into the queue: a Research Center stands, the
   * prerequisites are done, and it is not done, running or queued already.
   * Slots and credits do not matter here, waiting for them is the point.
   */
  canQueueResearch(id: ResearchId): { canQueue: boolean; reason?: string } {
    if (this._centerLevel === 0) return { canQueue: false, reason: 'No Research Center placed' };
    if (this.isCompleted(id)) return { canQueue: false, reason: 'Already completed' };
    if (this.isActive(id)) return { canQueue: false, reason: 'Already in progress' };
    if (this.isQueued(id)) return { canQueue: false, reason: 'Already queued' };
    const config = getResearch(id);
    if (!config) return { canQueue: false, reason: 'Unknown research' };
    if (!config.prerequisites.every(p => this.completedResearches.has(p))) {
      return { canQueue: false, reason: 'Prerequisites not met' };
    }
    return { canQueue: true };
  }

  /** Append to the queue. Nothing is charged, see startQueued(). */
  queueResearch(id: ResearchId): boolean {
    if (!this.canQueueResearch(id).canQueue) return false;
    this.queue.push(id);
    this.emitStateSnapshot();
    return true;
  }

  /** Take a research out of the queue. Nothing was paid, so nothing is refunded. */
  unqueueResearch(id: ResearchId): boolean {
    const index = this.queue.indexOf(id);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    this.emitStateSnapshot();
    return true;
  }

  /**
   * Start queued researches while slots are free, in queue order. Runs in
   * the sub-step right after update(), so a slot a completion frees is taken
   * in the same game-time step at every timescale, and not at all while the
   * game is paused. The credits are charged here, at the start. The head
   * waits for its credits: a cheaper research further back does not jump it.
   * A head that got done or started some other way meanwhile is dropped.
   *
   * @param credits current credits, read again after each start
   * @param spend   charges the credits, false when they are short
   */
  startQueued(credits: () => number, spend: (cost: number) => boolean): void {
    if (this.queue.length === 0) return;

    let dropped = false;
    while (this.queue.length > 0 && this.availableSlots > 0) {
      const head = this.queue[0];
      const config = getResearch(head);
      if (!config || this.isCompleted(head) || this.isActive(head)) {
        this.queue.shift();
        dropped = true;
        continue;
      }
      if (!this.canStartResearch(head, credits()).canStart || !spend(config.cost)) break;
      this.queue.shift();
      // Emits the snapshot, the queue already without the head
      this.startResearch(head);
      dropped = false;
    }
    if (dropped) this.emitStateSnapshot();
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
    this.emitStateSnapshot();

    return refund;
  }

  /**
   * Called when Research Center is placed.
   */
  onCenterPlaced(): void {
    this._centerLevel = 1;
    this._maxSlots = getMaxResearchSlots(1);
    this.emitStateSnapshot();
  }

  /**
   * Called when Research Center is upgraded.
   */
  upgradeCenter(): void {
    if (this._centerLevel >= RESEARCH_CENTER_CONFIG.maxLevel) return;
    this._centerLevel++;
    this._maxSlots = getMaxResearchSlots(this._centerLevel);
    this.emitStateSnapshot();
  }

  /**
   * Called when Research Center is sold (shouldn't happen, but safety).
   */
  onCenterRemoved(): void {
    this._centerLevel = 0;
    this.queue = [];
    // Cancel all active researches
    for (const [id] of this.activeResearches) {
      this.cancelResearch(id);
    }
    this.emitStateSnapshot();
  }

  // ==================== Update Loop ====================

  /**
   * Tick all active researches. Called every gameplay sub-step. `stepMs` is
   * the GAME-TIME delta of the current sub-step (engine sub-step is ~16ms
   * game-time). Signature kept compatible with `IGameManager.update`.
   */
  update(stepMs: number): void {
    if (this.activeResearches.size === 0) return;

    const gameDeltaSeconds = stepMs / 1000;
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

    if (completed.length > 0) {
      this.emitStateSnapshot();
    }
    this.emitProgress();
  }

  /**
   * Fortschritt für die UI, höchstens alle 100 ms. Nach Wanduhr statt
   * Spielzeit gedrosselt, damit es auch bei x4 und Training-Timescales bei
   * 10 Updates pro Sekunde bleibt; die Spiellogik liest das Event nicht.
   */
  private emitProgress(): void {
    if (this.activeResearches.size === 0) return;
    const now = performance.now();
    if (now - this.lastProgressEmitAt < ResearchManager.PROGRESS_INTERVAL_MS) return;
    this.lastProgressEmitAt = now;

    const elapsed = new Map<ResearchId, number>();
    for (const [id, active] of this.activeResearches) {
      elapsed.set(id, active.elapsed);
    }
    this.eventBus.emit({ type: 'research:progress', elapsed });
  }

  /**
   * Debug: instantly complete every research in the tree. Cancels any
   * in-flight research without refund and emits research:completed for each
   * newly-finished node so listeners (research store, max-upgrade-tier sync,
   * etc.) update correctly. Used by the trailer/recording cheat — gold
   * spending still applies normally afterwards.
   */
  completeAllResearch(): void {
    this.activeResearches.clear();
    this.queue = [];
    for (const id of Object.keys(RESEARCH_TREE)) {
      if (this.completedResearches.has(id)) continue;
      this.completedResearches.add(id);
      const config = RESEARCH_TREE[id];
      this.eventBus.emit({
        type: 'research:completed',
        researchId: id,
        effects: config.effects,
      });
    }
    this.emitStateSnapshot();
  }

  /**
   * Debug: complete `id` and everything it needs, prerequisites first, each
   * with its research:completed. One of them that is running or queued stops
   * without refund, as in completeAllResearch. What is done already stays
   * as it is.
   */
  completeResearch(id: ResearchId): void {
    if (this.completeWithPrerequisites(id)) this.emitStateSnapshot();
  }

  /** Whether `id` was completed now. */
  private completeWithPrerequisites(id: ResearchId): boolean {
    if (this.completedResearches.has(id)) return false;
    const config = getResearch(id);
    if (!config) return false;
    for (const prerequisite of config.prerequisites) this.completeWithPrerequisites(prerequisite);
    this.activeResearches.delete(id);
    this.queue = this.queue.filter((queued) => queued !== id);
    this.completedResearches.add(id);
    this.eventBus.emit({ type: 'research:completed', researchId: id, effects: config.effects });
    return true;
  }

  // ==================== Lifecycle (IGameManager) ====================

  /** No-op — ResearchManager has no setup work beyond the constructor. */
  initialize(): void { /* nothing to do */ }

  reset(): void {
    this.completedResearches.clear();
    this.activeResearches.clear();
    this.queue = [];
    this._centerLevel = 0;
    this._maxSlots = 1;
    this.lastProgressEmitAt = -Infinity;
  }

  /** IGameManager.destroy — alias for `reset()`. */
  destroy(): void {
    this.reset();
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
      queued: [...this.queue],
    };
  }

  restoreState(state: ResearchSaveState): void {
    this.completedResearches = new Set(state.completed);
    this._maxSlots = state.slots;
    this._centerLevel = state.centerLevel;
    this.queue = [...(state.queued ?? [])];

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
