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
          type: 'research:started', playerId: 'local', local: true,
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
          type: 'research:completed', playerId: 'local', local: true,
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

    it('reports progress at most every 100 ms of wall time', () => {
      const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
      try {
        rm.onCenterPlaced();
        rm.startResearch(NO_PREREQ_ID);
        const handler = vi.fn();
        bus.on('research:progress', handler);

        rm.update(1000);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].elapsed.get(NO_PREREQ_ID)).toBe(1);

        rm.update(1000); // gleiche Wanduhr: gedrosselt
        expect(handler).toHaveBeenCalledTimes(1);

        now.mockReturnValue(1100);
        rm.update(1000);
        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler.mock.calls[1][0].elapsed.get(NO_PREREQ_ID)).toBe(3);
      } finally {
        now.mockRestore();
      }
    });

    it('reports no progress while nothing is researched', () => {
      const handler = vi.fn();
      bus.on('research:progress', handler);
      rm.onCenterPlaced();
      rm.update(1000);
      expect(handler).not.toHaveBeenCalled();
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
          type: 'research:cancelled', playerId: 'local', local: true,
          researchId: NO_PREREQ_ID,
          refund: expectedRefund,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Queue: waits for a slot and the credits, charged at the start
  // -------------------------------------------------------------------------
  describe('queue', () => {
    const QUEUE_ID = 'ice-magic'; // no prerequisites either
    let credits: number;
    const creditsNow = () => credits;
    const spend = (cost: number) => {
      if (credits < cost) return false;
      credits -= cost;
      return true;
    };

    beforeEach(() => {
      credits = 1000;
      rm.onCenterPlaced(); // 1 slot
    });

    it('queues an available research without charging it', () => {
      rm.startResearch(NO_PREREQ_ID);
      expect(rm.queueResearch(QUEUE_ID)).toBe(true);
      expect(rm.getQueuedResearches()).toEqual([QUEUE_ID]);
      rm.startQueued(creditsNow, spend); // slot still busy
      expect(credits).toBe(1000);
      expect(rm.isActive(QUEUE_ID)).toBe(false);
    });

    it('refuses what cannot go into the queue', () => {
      expect(rm.canQueueResearch(WITH_PREREQ_ID).reason).toMatch(/prerequisite/i);
      rm.startResearch(NO_PREREQ_ID);
      expect(rm.canQueueResearch(NO_PREREQ_ID).reason).toMatch(/progress/i);
      rm.queueResearch(QUEUE_ID);
      expect(rm.queueResearch(QUEUE_ID)).toBe(false);
      expect(rm.getQueuedResearches()).toEqual([QUEUE_ID]);

      const { rm: noCenter } = makeManager();
      expect(noCenter.canQueueResearch(QUEUE_ID).reason).toMatch(/Research Center/i);
    });

    it('starts the head once a slot frees and charges it then', () => {
      rm.startResearch(NO_PREREQ_ID);
      rm.queueResearch(QUEUE_ID);

      // The sub-step order: update() frees the slot, startQueued() takes it
      rm.update(getResearch(NO_PREREQ_ID)!.duration * 1000);
      rm.startQueued(creditsNow, spend);

      expect(rm.isActive(QUEUE_ID)).toBe(true);
      expect(rm.getQueuedResearches()).toEqual([]);
      expect(credits).toBe(1000 - getResearch(QUEUE_ID)!.cost);
    });

    it('lets the head wait for its credits, nothing behind it jumps ahead', () => {
      const pricier = 'tentacle-biology'; // costs more than QUEUE_ID
      rm.completeResearch('biology'); // its gate, so it is queueable here
      rm.queueResearch(pricier);
      rm.queueResearch(QUEUE_ID);
      credits = getResearch(pricier)!.cost - 1;
      expect(credits).toBeGreaterThanOrEqual(getResearch(QUEUE_ID)!.cost);

      rm.startQueued(creditsNow, spend);
      expect(rm.usedSlots).toBe(0);
      expect(rm.getQueuedResearches()).toEqual([pricier, QUEUE_ID]);

      credits += 1;
      rm.startQueued(creditsNow, spend);
      expect(rm.isActive(pricier)).toBe(true);
      expect(credits).toBe(0);
    });

    it('fills every free slot in queue order', () => {
      rm.upgradeCenter(); // 2 slots
      rm.queueResearch(NO_PREREQ_ID);
      rm.queueResearch(QUEUE_ID);
      rm.startQueued(creditsNow, spend);
      expect(rm.isActive(NO_PREREQ_ID)).toBe(true);
      expect(rm.isActive(QUEUE_ID)).toBe(true);
    });

    it('drops a head that got started some other way', () => {
      rm.upgradeCenter(); // 2 slots
      rm.queueResearch(NO_PREREQ_ID);
      rm.startResearch(NO_PREREQ_ID); // e.g. a click on the node after all
      const snapshots = vi.fn();
      bus.on('research:state-changed', snapshots);

      rm.startQueued(creditsNow, spend);
      expect(rm.getQueuedResearches()).toEqual([]);
      expect(snapshots).toHaveBeenCalledWith(expect.objectContaining({ queuedResearches: [] }));
      expect(credits).toBe(1000);
    });

    it('unqueues without a refund, and sends the queue in every snapshot', () => {
      const snapshots = vi.fn();
      bus.on('research:state-changed', snapshots);
      rm.queueResearch(QUEUE_ID);
      expect(snapshots).toHaveBeenLastCalledWith(expect.objectContaining({ queuedResearches: [QUEUE_ID] }));

      expect(rm.unqueueResearch(QUEUE_ID)).toBe(true);
      expect(rm.unqueueResearch(QUEUE_ID)).toBe(false);
      expect(snapshots).toHaveBeenLastCalledWith(expect.objectContaining({ queuedResearches: [] }));
      expect(credits).toBe(1000);
    });

    describe('moveQueued', () => {
      // Three that are open at once: the biology gate is done, so both behind
      // it are queueable next to QUEUE_ID.
      const THIRD_ID = 'tentacle-biology';

      const queueThree = () => {
        rm.completeResearch('biology');
        rm.startResearch(NO_PREREQ_ID); // takes the only slot
        rm.queueResearch(QUEUE_ID);
        rm.queueResearch('toxic-compounds');
        rm.queueResearch(THIRD_ID);
      };

      it('moves a research to the front, so it starts next', () => {
        queueThree();
        expect(rm.moveQueued(THIRD_ID, 0)).toBe(true);
        expect(rm.getQueuedResearches()).toEqual([THIRD_ID, QUEUE_ID, 'toxic-compounds']);
      });

      it('moves one back without dropping the others', () => {
        queueThree();
        expect(rm.moveQueued(QUEUE_ID, 2)).toBe(true);
        expect(rm.getQueuedResearches()).toEqual(['toxic-compounds', THIRD_ID, QUEUE_ID]);
      });

      it('clamps a position past either end instead of losing the entry', () => {
        queueThree();
        rm.moveQueued(QUEUE_ID, 99);
        expect(rm.getQueuedResearches()).toEqual(['toxic-compounds', THIRD_ID, QUEUE_ID]);
        rm.moveQueued(QUEUE_ID, -5);
        expect(rm.getQueuedResearches()).toEqual([QUEUE_ID, 'toxic-compounds', THIRD_ID]);
      });

      it('refuses a research that is not queued, and a move that changes nothing', () => {
        queueThree();
        expect(rm.moveQueued('fire-alchemy', 0)).toBe(false); // not in the queue
        expect(rm.moveQueued(QUEUE_ID, 0)).toBe(false); // already at 0
        expect(rm.getQueuedResearches()).toEqual([QUEUE_ID, 'toxic-compounds', THIRD_ID]);
      });

      it('sends the new order in the snapshot and charges nothing', () => {
        queueThree();
        const snapshots = vi.fn();
        bus.on('research:state-changed', snapshots);
        rm.moveQueued(THIRD_ID, 0);
        expect(snapshots).toHaveBeenLastCalledWith(
          expect.objectContaining({ queuedResearches: [THIRD_ID, QUEUE_ID, 'toxic-compounds'] }),
        );
        expect(credits).toBe(1000);
      });

      it('decides what startQueued takes next', () => {
        queueThree();
        rm.moveQueued(THIRD_ID, 0);
        rm.cancelResearch(NO_PREREQ_ID); // frees the slot
        rm.startQueued(creditsNow, spend);
        expect(rm.isActive(THIRD_ID)).toBe(true);
        expect(rm.isActive(QUEUE_ID)).toBe(false);
      });
    });

    it('is emptied by reset, a sold Research Center and the debug cheat', () => {
      rm.queueResearch(QUEUE_ID);
      rm.reset();
      expect(rm.getQueuedResearches()).toEqual([]);

      rm.onCenterPlaced();
      rm.queueResearch(QUEUE_ID);
      rm.onCenterRemoved();
      expect(rm.getQueuedResearches()).toEqual([]);

      rm.onCenterPlaced();
      rm.queueResearch(QUEUE_ID);
      rm.completeAllResearch();
      expect(rm.getQueuedResearches()).toEqual([]);
    });

    it('survives getState / restoreState', () => {
      rm.startResearch(NO_PREREQ_ID);
      rm.queueResearch(QUEUE_ID);
      const { rm: rm2 } = makeManager();
      rm2.restoreState(rm.getState());
      expect(rm2.getQueuedResearches()).toEqual([QUEUE_ID]);
    });
  });

  // -------------------------------------------------------------------------
  // completeResearch() (debug cheat, Nuke ready)
  // -------------------------------------------------------------------------
  describe('completeResearch()', () => {
    it('completes the research and its prerequisites, each before what needs it, each once', () => {
      const completed: string[] = [];
      bus.on('research:completed', (event) => completed.push(event.researchId));
      rm.completeResearch('nuclear-strike');

      expect(completed).toContain('advanced-weaponry');
      expect(completed[completed.length - 1]).toBe('nuclear-strike');
      expect(new Set(completed).size).toBe(completed.length);
      for (const id of completed) {
        for (const prerequisite of getResearch(id)!.prerequisites) {
          expect(completed.indexOf(prerequisite)).toBeGreaterThanOrEqual(0);
          expect(completed.indexOf(prerequisite)).toBeLessThan(completed.indexOf(id));
        }
      }
    });

    it('stops a running prerequisite, sends one snapshot and leaves what is done alone', () => {
      rm.onCenterPlaced();
      rm.startResearch(NO_PREREQ_ID);
      const snapshots = vi.fn();
      const completed = vi.fn();
      bus.on('research:state-changed', snapshots);
      bus.on('research:completed', completed);

      rm.completeResearch(WITH_PREREQ_ID);
      expect(rm.usedSlots).toBe(0);
      expect(completed).toHaveBeenCalledTimes(2);
      expect(snapshots).toHaveBeenCalledTimes(1);

      rm.completeResearch(WITH_PREREQ_ID);
      expect(completed).toHaveBeenCalledTimes(2);
      expect(snapshots).toHaveBeenCalledTimes(1);
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

  // The simulation reads this flag, not the ResearchStore (docs/SIMULATOR_PLAN.md, L8)
  describe('airTargetingUnlocked', () => {
    it('turns on with the research that enables air targeting, before research:completed goes out', () => {
      const seen: boolean[] = [];
      bus.on('research:completed', () => seen.push(rm.airTargetingUnlocked));
      expect(rm.airTargetingUnlocked).toBe(false);

      rm.completeResearch('gatling-tech');
      expect(rm.airTargetingUnlocked).toBe(false);
      rm.completeResearch('aa-retrofit');
      expect(rm.airTargetingUnlocked).toBe(true);
      expect(seen).toEqual([false, true]);
    });

    it('turns on when the running research finishes in a sub-step', () => {
      rm.restoreState({ completed: ['gatling-tech'], active: [], slots: 1, centerLevel: 1, queued: [] });
      expect(rm.startResearch('aa-retrofit')).toBe(true);
      rm.update(getResearch('aa-retrofit')!.duration * 1000);
      expect(rm.airTargetingUnlocked).toBe(true);
    });

    it('follows reset(), completeAllResearch() and restoreState()', () => {
      rm.completeAllResearch();
      expect(rm.airTargetingUnlocked).toBe(true);
      rm.reset();
      expect(rm.airTargetingUnlocked).toBe(false);
      rm.restoreState({ completed: ['gatling-tech', 'aa-retrofit'], active: [], slots: 1, centerLevel: 0, queued: [] });
      expect(rm.airTargetingUnlocked).toBe(true);
      rm.restoreState({ completed: ['gatling-tech'], active: [], slots: 1, centerLevel: 0, queued: [] });
      expect(rm.airTargetingUnlocked).toBe(false);
    });
  });
});
