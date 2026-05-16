import { beforeEach, describe, it, expect, vi } from 'vitest';

// Three.js is a transitive dependency via game-engine imports; mock it to avoid
// WebGL-specific code failing under jsdom.
vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { GameEventBus } from '../game-engine';
import { ResearchManager } from './research.manager';
import { RESEARCH_CENTER_CONFIG } from '../configs/research/research-center.config';
import { getResearch } from '../configs/research/research-tree.config';

// ---------------------------------------------------------------------------
// Known research IDs from research-tree.config.ts used throughout these tests.
// They have no prerequisites so we can start them without setup.
// ---------------------------------------------------------------------------
const NO_PREREQ_ID = 'gatling-tech';   // cost:40, duration:15s, prereqs:[]
const WITH_PREREQ_ID = 'siege-engineering'; // cost:50, duration:20s, prereqs:['gatling-tech']

function makeManager(): { bus: GameEventBus; rm: ResearchManager } {
  const bus = new GameEventBus();
  const rm = new ResearchManager(bus);
  return { bus, rm };
}

describe('ResearchManager', () => {
  let bus: GameEventBus;
  let rm: ResearchManager;

  beforeEach(() => {
    ({ bus, rm } = makeManager());
  });

  // -------------------------------------------------------------------------
  // canStartResearch() — each rejection condition independently
  // -------------------------------------------------------------------------
  describe('canStartResearch()', () => {
    it('rejects when no Research Center has been placed (centerLevel 0)', () => {
      const cfg = getResearch(NO_PREREQ_ID)!;
      const result = rm.canStartResearch(NO_PREREQ_ID, cfg.cost * 10);
      expect(result.canStart).toBe(false);
      expect(result.reason).toMatch(/Research Center/i);
    });

    it('rejects already-completed research', () => {
      rm.onCenterPlaced();
      // Force completion via startResearch + update
      const cfg = getResearch(NO_PREREQ_ID)!;
      rm.startResearch(NO_PREREQ_ID);
      // tick past the full duration (in ms)
      rm.update(cfg.duration * 1000 + 100);

      const result = rm.canStartResearch(NO_PREREQ_ID, 9999);
      expect(result.canStart).toBe(false);
      expect(result.reason).toMatch(/completed/i);
    });

    it('rejects already-active research', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);

      const result = rm.canStartResearch(NO_PREREQ_ID, 9999);
      expect(result.canStart).toBe(false);
      expect(result.reason).toMatch(/progress/i);
    });

    it('rejects when prerequisites are not met', () => {
      rm.onCenterPlaced();
      const cfg = getResearch(WITH_PREREQ_ID)!;
      const result = rm.canStartResearch(WITH_PREREQ_ID, cfg.cost * 10);
      expect(result.canStart).toBe(false);
      expect(result.reason).toMatch(/prerequisite/i);
    });

    it('rejects when credits are insufficient', () => {
      rm.onCenterPlaced();
      const result = rm.canStartResearch(NO_PREREQ_ID, 0);
      expect(result.canStart).toBe(false);
      expect(result.reason).toMatch(/credits/i);
    });

    it('rejects when no research slots are free', () => {
      rm.onCenterPlaced(); // level 1 → 1 slot
      // Fill the single slot
      rm.startResearch(NO_PREREQ_ID);
      expect(rm.availableSlots).toBe(0);

      // Any other no-prereq research (ice-magic also has prereqs:[])
      const result = rm.canStartResearch('ice-magic', 9999);
      expect(result.canStart).toBe(false);
      expect(result.reason).toMatch(/slot/i);
    });

    it('returns canStart:true when all conditions are satisfied', () => {
      rm.onCenterPlaced();
      const cfg = getResearch(NO_PREREQ_ID)!;
      const result = rm.canStartResearch(NO_PREREQ_ID, cfg.cost);
      expect(result.canStart).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // startResearch()
  // -------------------------------------------------------------------------
  describe('startResearch()', () => {
    it('returns false for an unknown research id', () => {
      rm.onCenterPlaced();
      expect(rm.startResearch('non-existent-id')).toBe(false);
    });

    it('returns true and marks research as active', () => {
      rm.onCenterPlaced();
      const ok = rm.startResearch(NO_PREREQ_ID);
      expect(ok).toBe(true);
      expect(rm.isActive(NO_PREREQ_ID)).toBe(true);
    });

    it('occupies one slot', () => {
      rm.onCenterPlaced();
      expect(rm.availableSlots).toBe(1);
      rm.startResearch(NO_PREREQ_ID);
      expect(rm.usedSlots).toBe(1);
      expect(rm.availableSlots).toBe(0);
    });

    it('emits research:started with correct researchId, cost, and duration', () => {
      rm.onCenterPlaced();
      const handler = vi.fn();
      bus.on('research:started', handler);
      rm.startResearch(NO_PREREQ_ID);

      const cfg = getResearch(NO_PREREQ_ID)!;
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'research:started',
          researchId: NO_PREREQ_ID,
          cost: cfg.cost,
          duration: cfg.duration,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // update(stepMs) — progress accumulation and completion
  // -------------------------------------------------------------------------
  describe('update(stepMs)', () => {
    it('does not complete research before the duration has elapsed', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      const cfg = getResearch(NO_PREREQ_ID)!;

      // Advance to just under the duration
      rm.update((cfg.duration - 1) * 1000);

      expect(rm.isActive(NO_PREREQ_ID)).toBe(true);
      expect(rm.isCompleted(NO_PREREQ_ID)).toBe(false);
    });

    it('completes research once the duration has elapsed', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      const cfg = getResearch(NO_PREREQ_ID)!;

      rm.update(cfg.duration * 1000);

      expect(rm.isCompleted(NO_PREREQ_ID)).toBe(true);
      expect(rm.isActive(NO_PREREQ_ID)).toBe(false);
    });

    it('frees the slot after completion', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      expect(rm.availableSlots).toBe(0);

      const cfg = getResearch(NO_PREREQ_ID)!;
      rm.update(cfg.duration * 1000);

      expect(rm.availableSlots).toBe(1);
    });

    it('emits research:completed on completion', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      const handler = vi.fn();
      bus.on('research:completed', handler);

      const cfg = getResearch(NO_PREREQ_ID)!;
      rm.update(cfg.duration * 1000);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'research:completed',
          researchId: NO_PREREQ_ID,
        }),
      );
    });

    it('accumulates elapsed across multiple update() calls (sub-stepping)', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);

      // NO_PREREQ_ID has duration 15s — 14 ticks of 1000ms = 14s, not done yet
      for (let i = 0; i < 14; i++) rm.update(1000);
      expect(rm.isCompleted(NO_PREREQ_ID)).toBe(false);

      // One more tick of 1000ms → 15s → done
      rm.update(1000);
      expect(rm.isCompleted(NO_PREREQ_ID)).toBe(true);
    });

    it('is a no-op when there are no active researches', () => {
      rm.onCenterPlaced();
      expect(() => rm.update(16)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // cancelResearch()
  // -------------------------------------------------------------------------
  describe('cancelResearch()', () => {
    it('returns 0 refund if research is not active', () => {
      expect(rm.cancelResearch(NO_PREREQ_ID)).toBe(0);
    });

    it('removes the research from active set', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      expect(rm.isActive(NO_PREREQ_ID)).toBe(true);

      rm.cancelResearch(NO_PREREQ_ID);
      expect(rm.isActive(NO_PREREQ_ID)).toBe(false);
    });

    it('refunds 50% of the cost (floor)', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      const cfg = getResearch(NO_PREREQ_ID)!;

      const refund = rm.cancelResearch(NO_PREREQ_ID);
      const expected = Math.floor(cfg.cost * RESEARCH_CENTER_CONFIG.cancellationRefundPercent);
      expect(refund).toBe(expected);
    });

    it('frees the slot after cancellation', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      expect(rm.availableSlots).toBe(0);

      rm.cancelResearch(NO_PREREQ_ID);
      expect(rm.availableSlots).toBe(1);
    });

    it('emits research:cancelled with correct refund amount', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      const handler = vi.fn();
      bus.on('research:cancelled', handler);

      const cfg = getResearch(NO_PREREQ_ID)!;
      const expectedRefund = Math.floor(cfg.cost * RESEARCH_CENTER_CONFIG.cancellationRefundPercent);
      rm.cancelResearch(NO_PREREQ_ID);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'research:cancelled',
          researchId: NO_PREREQ_ID,
          refund: expectedRefund,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getMaxUpgradeTier()
  // -------------------------------------------------------------------------
  describe('getMaxUpgradeTier()', () => {
    it('returns 1 before any research is completed', () => {
      expect(rm.getMaxUpgradeTier()).toBe(1);
    });

    it('returns 2 after completing advanced-weaponry (tier 2 unlock)', () => {
      rm.onCenterPlaced();
      // advanced-weaponry needs: siege-engineering + arcane-studies
      // siege-engineering needs: gatling-tech
      // arcane-studies needs: ice-magic
      // We'll use completeAllResearch() which force-completes everything.
      rm.completeAllResearch();

      // After all completions, advanced-weaponry is done → tier 2 at minimum
      expect(rm.getMaxUpgradeTier()).toBeGreaterThanOrEqual(2);
    });

    it('remains 1 after completing a tower-unlock research (no tier effect)', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      const cfg = getResearch(NO_PREREQ_ID)!;
      rm.update(cfg.duration * 1000);

      // gatling-tech has effect kind:unlock-tower, not unlock-upgrade-tier
      expect(rm.getMaxUpgradeTier()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getState() / restoreState() roundtrip
  // -------------------------------------------------------------------------
  describe('getState() / restoreState()', () => {
    it('restores completed and center level', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      const cfg = getResearch(NO_PREREQ_ID)!;
      rm.update(cfg.duration * 1000);

      const state = rm.getState();

      const { rm: rm2 } = makeManager();
      rm2.restoreState(state);

      expect(rm2.isCompleted(NO_PREREQ_ID)).toBe(true);
      expect(rm2.centerLevel).toBe(1);
    });

    it('restores active research with elapsed progress', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      // Advance halfway
      const cfg = getResearch(NO_PREREQ_ID)!;
      const halfMs = (cfg.duration / 2) * 1000;
      rm.update(halfMs);

      const state = rm.getState();
      expect(state.active.length).toBe(1);
      expect(state.active[0].researchId).toBe(NO_PREREQ_ID);
      expect(state.active[0].elapsed).toBeGreaterThan(0);

      const { rm: rm2 } = makeManager();
      rm2.restoreState(state);

      expect(rm2.isActive(NO_PREREQ_ID)).toBe(true);
      // Completing the remaining half should finish the research
      rm2.update(halfMs);
      expect(rm2.isCompleted(NO_PREREQ_ID)).toBe(true);
    });

    it('restores slot count and centerLevel', () => {
      rm.onCenterPlaced();
      rm.upgradeCenter(); // level 2 → 2 slots

      const state = rm.getState();
      const { rm: rm2 } = makeManager();
      rm2.restoreState(state);

      expect(rm2.centerLevel).toBe(2);
      expect(rm2.maxSlots).toBe(2);
    });

    it('roundtrip with no active or completed researches', () => {
      const state = rm.getState();
      expect(state.completed).toEqual([]);
      expect(state.active).toEqual([]);

      const { rm: rm2 } = makeManager();
      rm2.restoreState(state);
      expect(rm2.getMaxUpgradeTier()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // reset()
  // -------------------------------------------------------------------------
  describe('reset()', () => {
    it('clears completed researches', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      const cfg = getResearch(NO_PREREQ_ID)!;
      rm.update(cfg.duration * 1000);
      expect(rm.isCompleted(NO_PREREQ_ID)).toBe(true);

      rm.reset();
      expect(rm.isCompleted(NO_PREREQ_ID)).toBe(false);
    });

    it('clears active researches', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      expect(rm.isActive(NO_PREREQ_ID)).toBe(true);

      rm.reset();
      expect(rm.isActive(NO_PREREQ_ID)).toBe(false);
    });

    it('resets centerLevel to 0', () => {
      rm.onCenterPlaced();
      rm.reset();
      expect(rm.centerLevel).toBe(0);
    });

    it('resets maxSlots to 1', () => {
      rm.onCenterPlaced();
      rm.upgradeCenter(); // level 2 → 2 slots
      expect(rm.maxSlots).toBe(2);

      rm.reset();
      expect(rm.maxSlots).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Center placement and slots
  // -------------------------------------------------------------------------
  describe('center placement and slots', () => {
    it('centerLevel starts at 0 (no center placed)', () => {
      expect(rm.centerLevel).toBe(0);
    });

    it('onCenterPlaced() sets centerLevel to 1 and opens 1 slot', () => {
      rm.onCenterPlaced();
      expect(rm.centerLevel).toBe(1);
      expect(rm.maxSlots).toBe(1);
    });

    it('upgradeCenter() increases level and slot count', () => {
      rm.onCenterPlaced();
      rm.upgradeCenter();
      expect(rm.centerLevel).toBe(2);
      expect(rm.maxSlots).toBe(2);
    });

    it('upgradeCenter() is capped at maxLevel', () => {
      rm.onCenterPlaced();
      rm.upgradeCenter(); // → 2
      rm.upgradeCenter(); // → 3 (max)
      rm.upgradeCenter(); // → should stay at 3
      expect(rm.centerLevel).toBe(RESEARCH_CENTER_CONFIG.maxLevel);
    });
  });

  // -------------------------------------------------------------------------
  // isAvailable() / isLocked()
  // -------------------------------------------------------------------------
  describe('isAvailable() and isLocked()', () => {
    it('is not available when prereqs are missing', () => {
      rm.onCenterPlaced();
      expect(rm.isAvailable(WITH_PREREQ_ID)).toBe(false);
      expect(rm.isLocked(WITH_PREREQ_ID)).toBe(true);
    });

    it('becomes available once prereqs are completed', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      rm.update(getResearch(NO_PREREQ_ID)!.duration * 1000);

      expect(rm.isAvailable(WITH_PREREQ_ID)).toBe(true);
      expect(rm.isLocked(WITH_PREREQ_ID)).toBe(false);
    });

    it('is not available once completed', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      rm.update(getResearch(NO_PREREQ_ID)!.duration * 1000);
      expect(rm.isCompleted(NO_PREREQ_ID)).toBe(true);
      expect(rm.isAvailable(NO_PREREQ_ID)).toBe(false);
    });

    it('is not available when already active', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      expect(rm.isAvailable(NO_PREREQ_ID)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isTowerUnlocked()
  // -------------------------------------------------------------------------
  describe('isTowerUnlocked()', () => {
    it('archer is always unlocked', () => {
      expect(rm.isTowerUnlocked('archer')).toBe(true);
    });

    it('research-center is always unlocked', () => {
      expect(rm.isTowerUnlocked('research-center')).toBe(true);
    });

    it('dual-gatling is locked before completing gatling-tech', () => {
      expect(rm.isTowerUnlocked('dual-gatling')).toBe(false);
    });

    it('dual-gatling is unlocked after completing gatling-tech', () => {
      rm.onCenterPlaced();
      rm.startResearch('gatling-tech');
      rm.update(getResearch('gatling-tech')!.duration * 1000);
      expect(rm.isTowerUnlocked('dual-gatling')).toBe(true);
    });
  });
});
