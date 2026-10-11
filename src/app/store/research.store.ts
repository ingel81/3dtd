import { Injectable, signal, computed } from '@angular/core';
import { ResearchId, ActiveResearch, ResearchEffect } from '../configs/research/research.types';
import { TowerTypeId } from '../configs/tower-types.config';
import { getResearch, getResearchForTower } from '../configs/research/research-tree.config';
import { DEFAULT_RUN_RULES, towerUnlockedBy, type RunRules } from '../sim/protocol/run-rules';

/**
 * ResearchStore — Reactive state for the research system.
 *
 * Synced from GameEventBus via GameStateSyncService.
 * Read by UI components for reactive rendering.
 */
@Injectable({ providedIn: 'root' })
export class ResearchStore {
  /** The world's run rules: a tower type they leave out stays locked whatever the research (set at the start) */
  readonly runRules = signal<RunRules>(DEFAULT_RUN_RULES);

  /** Set of completed research IDs */
  readonly completedResearches = signal<Set<ResearchId>>(new Set());

  /** Currently active researches with progress */
  readonly activeResearches = signal<ActiveResearch[]>([]);

  /** Researches waiting for a slot and the credits, in start order */
  readonly queuedResearches = signal<ResearchId[]>([]);

  /**
   * Vergangene Spielzeit (s) je laufender Forschung. `ActiveResearch.elapsed`
   * zählt der ResearchManager am Objekt hoch, ohne Signal; dieses Signal kommt
   * per `research:progress` mit 10 Hz nach und treibt den Fortschrittsbalken.
   */
  readonly researchElapsed = signal<ReadonlyMap<ResearchId, number>>(new Map());

  /** Research Center building level (0 = not placed, 1-3 = placed) */
  readonly centerLevel = signal<number>(0);

  /** Maximum concurrent research slots */
  readonly researchSlots = signal<number>(1);

  /** The player's lanes, the factor on every research cost (researchCost) */
  readonly lanes = signal<number>(1);

  /** Number of available (free) research slots */
  readonly availableSlots = computed(() =>
    Math.max(0, this.researchSlots() - this.activeResearches().length)
  );

  /** Effects of the completed research, derived so a restore or resync cannot leave them stale */
  private readonly completedEffects = computed<readonly ResearchEffect[]>(() =>
    [...this.completedResearches()].flatMap((id) => getResearch(id)?.effects ?? []),
  );

  /** Highest unlocked upgrade tier (default: 1) */
  readonly maxUpgradeTier = computed(() =>
    this.completedEffects().reduce((tier, e) => (e.kind === 'unlock-upgrade-tier' ? Math.max(tier, e.tier) : tier), 1),
  );

  /** Whether air targeting is unlocked */
  readonly airTargetingUnlocked = computed(() =>
    this.completedEffects().some((e) => e.kind === 'enable-targeting' && e.capability === 'air'),
  );

  /**
   * Check if a tower is unlocked. Returns a computed signal.
   */
  isTowerUnlocked(towerId: TowerTypeId): boolean {
    return towerUnlockedBy(towerId, this.completedResearches(), this.runRules());
  }

  /**
   * Get the name of the research needed to unlock a tower.
   */
  getRequiredResearchName(towerId: TowerTypeId): string | null {
    const research = getResearchForTower(towerId);
    return research ? research.name : null;
  }

  /**
   * Reset all research state (on game restart).
   */
  resetResearchState(): void {
    this.completedResearches.set(new Set());
    this.activeResearches.set([]);
    this.queuedResearches.set([]);
    this.researchElapsed.set(new Map());
    this.centerLevel.set(0);
    this.researchSlots.set(1);
    this.lanes.set(1);
  }
}
