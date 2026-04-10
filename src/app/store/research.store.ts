import { Injectable, signal, computed } from '@angular/core';
import { ResearchId, ActiveResearch, ResearchEffect } from '../configs/research/research.types';
import { TowerTypeId } from '../configs/tower-types.config';
import { getResearch, getResearchForTower } from '../configs/research/research-tree.config';

/**
 * ResearchStore — Reactive state for the research system.
 *
 * Synced from GameEventBus via GameStateSyncService.
 * Read by UI components for reactive rendering.
 */
@Injectable({ providedIn: 'root' })
export class ResearchStore {
  /** Set of completed research IDs */
  readonly completedResearches = signal<Set<ResearchId>>(new Set());

  /** Currently active researches with progress */
  readonly activeResearches = signal<ActiveResearch[]>([]);

  /** Research Center building level (0 = not placed, 1-3 = placed) */
  readonly centerLevel = signal<number>(0);

  /** Maximum concurrent research slots */
  readonly researchSlots = signal<number>(1);

  /** Whether the Research Center has been placed */
  readonly centerPlaced = computed(() => this.centerLevel() > 0);

  /** Number of available (free) research slots */
  readonly availableSlots = computed(() =>
    Math.max(0, this.researchSlots() - this.activeResearches().length)
  );

  /** Highest unlocked upgrade tier (default: 1) */
  readonly maxUpgradeTier = signal<number>(1);

  /** Set of unlocked global perk IDs */
  readonly unlockedPerks = signal<Set<string>>(new Set());

  /** Whether air targeting perk is unlocked */
  readonly airTargetingUnlocked = signal<boolean>(false);

  /**
   * Check if a tower is unlocked. Returns a computed signal.
   */
  isTowerUnlocked(towerId: TowerTypeId): boolean {
    if (towerId === 'archer' || towerId === 'research-center') return true;
    const completed = this.completedResearches();
    for (const researchId of completed) {
      const config = getResearch(researchId);
      if (config) {
        for (const effect of config.effects) {
          if (effect.kind === 'unlock-tower' && effect.towerId === towerId) return true;
        }
      }
    }
    return false;
  }

  /**
   * Get the name of the research needed to unlock a tower.
   */
  getRequiredResearchName(towerId: TowerTypeId): string | null {
    const research = getResearchForTower(towerId);
    return research ? research.name : null;
  }

  /**
   * Apply effects from a completed research.
   */
  applyResearchEffects(effects: ResearchEffect[]): void {
    for (const effect of effects) {
      switch (effect.kind) {
        case 'unlock-upgrade-tier':
          if (effect.tier > this.maxUpgradeTier()) {
            this.maxUpgradeTier.set(effect.tier);
          }
          break;
        case 'global-perk':
          this.unlockedPerks.update(perks => {
            const next = new Set(perks);
            next.add(effect.perkId);
            return next;
          });
          break;
        case 'enable-targeting':
          if (effect.capability === 'air') {
            this.airTargetingUnlocked.set(true);
          }
          break;
        // unlock-tower is handled implicitly via completedResearches
      }
    }
  }

  /**
   * Reset all research state (on game restart).
   */
  resetResearchState(): void {
    this.completedResearches.set(new Set());
    this.activeResearches.set([]);
    this.centerLevel.set(0);
    this.researchSlots.set(1);
    this.maxUpgradeTier.set(1);
    this.unlockedPerks.set(new Set());
    this.airTargetingUnlocked.set(false);
  }
}
