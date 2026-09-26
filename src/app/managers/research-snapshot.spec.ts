import { describe, expect, it, vi } from 'vitest';
import { GameEventBus } from '../game-engine/game-event-bus';
import { ResearchManager } from './research.manager';
import { researchSnapshotOf, watchResearchOf } from './research-snapshot';

/**
 * The coop view of a partner's research (TODO E35) reads their
 * ResearchManager and reads it again when their research moves. Two players'
 * managers on one bus, as GameStateManager holds them.
 */
describe('research snapshot of a coop partner', () => {
  const setup = () => {
    const bus = new GameEventBus();
    const mine = new ResearchManager(bus, { playerId: 'p1', local: () => true });
    const theirs = new ResearchManager(bus, { playerId: 'p2', local: () => false });
    return { bus, mine, theirs };
  };

  it('copies completed, running, queued, the elapsed time and the center', () => {
    const { theirs } = setup();
    theirs.onCenterPlaced();
    theirs.completeResearch('biology');
    theirs.startResearch('gatling-tech');
    theirs.update(4000);

    const snapshot = researchSnapshotOf(theirs);
    expect([...snapshot.completed]).toEqual(['biology']);
    expect(snapshot.active.map((a) => a.researchId)).toEqual(['gatling-tech']);
    expect(snapshot.elapsed.get('gatling-tech')).toBeCloseTo(4);
    expect(snapshot.centerLevel).toBe(1);
    expect(snapshot.maxSlots).toBe(theirs.maxSlots);

    // The manager counts on in place; what was read stays as it was read
    theirs.update(2000);
    expect(snapshot.active[0].elapsed).toBeCloseTo(4);
    expect(snapshot.elapsed.get('gatling-tech')).toBeCloseTo(4);
  });

  it('calls back for that player only, until unsubscribed', () => {
    const { bus, mine, theirs } = setup();
    const changed = vi.fn();
    const stop = watchResearchOf(bus, 'p2', changed);

    mine.startResearch('biology');
    expect(changed).not.toHaveBeenCalled();

    theirs.startResearch('biology');
    expect(changed).toHaveBeenCalled();

    // Their progress comes on its own event, between the snapshots
    changed.mockClear();
    vi.spyOn(performance, 'now').mockReturnValue(1e9);
    theirs.update(100);
    expect(changed).toHaveBeenCalled();
    vi.restoreAllMocks();

    stop();
    changed.mockClear();
    theirs.completeResearch('gatling-tech');
    expect(changed).not.toHaveBeenCalled();
  });
});
