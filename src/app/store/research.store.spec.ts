import { describe, it, expect, beforeEach, vi } from 'vitest';

// Angular's inject() must be no-op for a pure store test — providedIn: 'root'
// services don't need the platform here.
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
  };
});

import { ResearchStore } from './research.store';
import { ResearchEffect } from '../configs/research/research.types';

describe('ResearchStore', () => {
  let store: ResearchStore;

  beforeEach(() => {
    store = new ResearchStore();
  });

  // ────────────────────────────────────────────────────────────────
  // Initial defaults
  // ────────────────────────────────────────────────────────────────
  describe('initial state', () => {
    it('starts with empty completed/active sets', () => {
      expect(store.completedResearches().size).toBe(0);
      expect(store.activeResearches().length).toBe(0);
    });

    it('starts with no Research Center placed', () => {
      expect(store.centerLevel()).toBe(0);
      expect(store.centerPlaced()).toBe(false);
    });

    it('starts with one research slot and tier 1 unlocked', () => {
      expect(store.researchSlots()).toBe(1);
      expect(store.maxUpgradeTier()).toBe(1);
    });

    it('starts with no perks unlocked', () => {
      expect(store.unlockedPerks().size).toBe(0);
      expect(store.airTargetingUnlocked()).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Computed: availableSlots
  // ────────────────────────────────────────────────────────────────
  describe('availableSlots', () => {
    it('equals researchSlots when no active researches', () => {
      store.researchSlots.set(3);
      expect(store.availableSlots()).toBe(3);
    });

    it('subtracts active research count', () => {
      store.researchSlots.set(3);
      store.activeResearches.set([
        { researchId: 'gatling-tech', startTime: 0, duration: 10, elapsed: 0, cost: 40 },
        { researchId: 'ice-magic', startTime: 0, duration: 10, elapsed: 0, cost: 40 },
      ]);
      expect(store.availableSlots()).toBe(1);
    });

    it('clamps at zero when active count exceeds slots', () => {
      store.researchSlots.set(1);
      store.activeResearches.set([
        { researchId: 'gatling-tech', startTime: 0, duration: 10, elapsed: 0, cost: 40 },
        { researchId: 'ice-magic', startTime: 0, duration: 10, elapsed: 0, cost: 40 },
      ]);
      expect(store.availableSlots()).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Computed: centerPlaced
  // ────────────────────────────────────────────────────────────────
  describe('centerPlaced', () => {
    it('flips true when centerLevel becomes positive', () => {
      expect(store.centerPlaced()).toBe(false);
      store.centerLevel.set(1);
      expect(store.centerPlaced()).toBe(true);
      store.centerLevel.set(0);
      expect(store.centerPlaced()).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // isTowerUnlocked
  // ────────────────────────────────────────────────────────────────
  describe('isTowerUnlocked', () => {
    it('unlocks the starter tower (archer) without research', () => {
      expect(store.isTowerUnlocked('archer')).toBe(true);
    });

    it('unlocks the research-center without research', () => {
      expect(store.isTowerUnlocked('research-center')).toBe(true);
    });

    it('returns false for a researched tower before its prerequisite is completed', () => {
      expect(store.isTowerUnlocked('dual-gatling')).toBe(false);
    });

    it('returns true once the matching research completes', () => {
      store.completedResearches.set(new Set(['gatling-tech']));
      expect(store.isTowerUnlocked('dual-gatling')).toBe(true);
    });

    it('does not bleed across unlock-tower effects (ice-magic ≠ tentacle)', () => {
      store.completedResearches.set(new Set(['ice-magic']));
      expect(store.isTowerUnlocked('ice')).toBe(true);
      expect(store.isTowerUnlocked('tentacle')).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // applyResearchEffects
  // ────────────────────────────────────────────────────────────────
  describe('applyResearchEffects', () => {
    it('raises maxUpgradeTier on unlock-upgrade-tier', () => {
      store.applyResearchEffects([{ kind: 'unlock-upgrade-tier', tier: 3 }]);
      expect(store.maxUpgradeTier()).toBe(3);
    });

    it('does not regress maxUpgradeTier when a lower tier is applied later', () => {
      store.applyResearchEffects([{ kind: 'unlock-upgrade-tier', tier: 4 }]);
      store.applyResearchEffects([{ kind: 'unlock-upgrade-tier', tier: 2 }]);
      expect(store.maxUpgradeTier()).toBe(4);
    });

    it('adds perk IDs to unlockedPerks on global-perk', () => {
      const effects: ResearchEffect[] = [{ kind: 'global-perk', perkId: 'income-boost' }];
      store.applyResearchEffects(effects);
      expect(store.unlockedPerks().has('income-boost')).toBe(true);
    });

    it('flips airTargetingUnlocked on enable-targeting:air', () => {
      store.applyResearchEffects([{ kind: 'enable-targeting', capability: 'air' }]);
      expect(store.airTargetingUnlocked()).toBe(true);
    });

    it('ignores unlock-tower at the store level (handled via completedResearches)', () => {
      const before = store.unlockedPerks().size;
      store.applyResearchEffects([{ kind: 'unlock-tower', towerId: 'ice' }]);
      expect(store.unlockedPerks().size).toBe(before);
      expect(store.airTargetingUnlocked()).toBe(false);
    });

    it('processes multiple effects in one call', () => {
      store.applyResearchEffects([
        { kind: 'unlock-upgrade-tier', tier: 2 },
        { kind: 'global-perk', perkId: 'commerce' },
        { kind: 'enable-targeting', capability: 'air' },
      ]);
      expect(store.maxUpgradeTier()).toBe(2);
      expect(store.unlockedPerks().has('commerce')).toBe(true);
      expect(store.airTargetingUnlocked()).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // resetResearchState
  // ────────────────────────────────────────────────────────────────
  describe('resetResearchState', () => {
    it('clears every signal back to its initial value', () => {
      // Pollute every field
      store.completedResearches.set(new Set(['gatling-tech', 'ice-magic']));
      store.activeResearches.set([
        { researchId: 'tentacle-biology', startTime: 0, duration: 10, elapsed: 5, cost: 45 },
      ]);
      store.centerLevel.set(2);
      store.researchSlots.set(3);
      store.maxUpgradeTier.set(4);
      store.unlockedPerks.set(new Set(['income-boost']));
      store.airTargetingUnlocked.set(true);

      store.resetResearchState();

      expect(store.completedResearches().size).toBe(0);
      expect(store.activeResearches().length).toBe(0);
      expect(store.centerLevel()).toBe(0);
      expect(store.centerPlaced()).toBe(false);
      expect(store.researchSlots()).toBe(1);
      expect(store.maxUpgradeTier()).toBe(1);
      expect(store.unlockedPerks().size).toBe(0);
      expect(store.airTargetingUnlocked()).toBe(false);
    });
  });
});
