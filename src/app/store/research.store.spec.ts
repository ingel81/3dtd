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
    });

    it('starts with one research slot and tier 1 unlocked', () => {
      expect(store.researchSlots()).toBe(1);
      expect(store.maxUpgradeTier()).toBe(1);
    });

    it('starts with no perks unlocked', () => {
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
        { researchId: 'gatling-tech', duration: 10, elapsed: 0, cost: 40 },
        { researchId: 'ice-magic', duration: 10, elapsed: 0, cost: 40 },
      ]);
      expect(store.availableSlots()).toBe(1);
    });

    it('clamps at zero when active count exceeds slots', () => {
      store.researchSlots.set(1);
      store.activeResearches.set([
        { researchId: 'gatling-tech', duration: 10, elapsed: 0, cost: 40 },
        { researchId: 'ice-magic', duration: 10, elapsed: 0, cost: 40 },
      ]);
      expect(store.availableSlots()).toBe(0);
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

    it('unlocks the missile silo with the nuclear strike research', () => {
      expect(store.isTowerUnlocked('missile-silo')).toBe(false);
      store.completedResearches.set(new Set(['nuclear-strike']));
      expect(store.isTowerUnlocked('missile-silo')).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Effects derived from completedResearches
  // ────────────────────────────────────────────────────────────────
  describe('derived effects', () => {
    it('takes the highest upgrade tier of the completed research', () => {
      expect(store.maxUpgradeTier()).toBe(1);
      store.completedResearches.set(new Set(['advanced-weaponry', 'advanced-engineering', 'master-engineering']));
      expect(store.maxUpgradeTier()).toBe(4);
    });

    it('unlocks air targeting with the retrofit', () => {
      store.completedResearches.set(new Set(['gatling-tech']));
      expect(store.airTargetingUnlocked()).toBe(false);
      store.completedResearches.set(new Set(['gatling-tech', 'aa-retrofit']));
      expect(store.airTargetingUnlocked()).toBe(true);
    });

    it('follows a restored set without any research:completed event', () => {
      store.completedResearches.set(new Set(['aa-retrofit', 'master-engineering']));
      store.completedResearches.set(new Set(['gatling-tech']));
      expect(store.airTargetingUnlocked()).toBe(false);
      expect(store.maxUpgradeTier()).toBe(1);
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
        { researchId: 'tentacle-biology', duration: 10, elapsed: 5, cost: 45 },
      ]);
      store.centerLevel.set(2);
      store.researchSlots.set(3);

      store.resetResearchState();

      expect(store.completedResearches().size).toBe(0);
      expect(store.activeResearches().length).toBe(0);
      expect(store.centerLevel()).toBe(0);
      expect(store.researchSlots()).toBe(1);
      expect(store.maxUpgradeTier()).toBe(1);
      expect(store.airTargetingUnlocked()).toBe(false);
    });
  });
});
