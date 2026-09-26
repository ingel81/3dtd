import type { ActiveResearch, ResearchId } from '../configs/research/research.types';
import { SubscriptionBag, type GameEventBus } from '../game-engine/game-event-bus';

/**
 * What one player's research holds, read from their ResearchManager. The
 * research dialog builds it for a coop partner, whose research is not in the
 * ResearchStore (that one is this player's, COOP_PLAN D20).
 */
export interface ResearchSnapshot {
  completed: ReadonlySet<ResearchId>;
  active: readonly ActiveResearch[];
  queued: readonly ResearchId[];
  elapsed: ReadonlyMap<ResearchId, number>;
  /** Level of their research center, 0 without one */
  centerLevel: number;
  maxSlots: number;
}

/** The parts of a ResearchManager the snapshot reads */
export interface ResearchSource {
  getCompletedResearches(): Set<ResearchId>;
  getActiveResearches(): ActiveResearch[];
  getQueuedResearches(): ResearchId[];
  readonly centerLevel: number;
  readonly maxSlots: number;
}

/**
 * A copy of `research` as it stands. The manager counts `elapsed` up on its
 * active entries in place, so the entries are copied too.
 */
export function researchSnapshotOf(research: ResearchSource): ResearchSnapshot {
  const active = research.getActiveResearches().map((a) => ({ ...a }));
  return {
    completed: research.getCompletedResearches(),
    active,
    queued: research.getQueuedResearches(),
    elapsed: new Map(active.map((a) => [a.researchId, a.elapsed])),
    centerLevel: research.centerLevel,
    maxSlots: research.maxSlots,
  };
}

/**
 * Calls `changed` whenever `playerId`'s research moves: after every change
 * (research:state-changed) and with the progress, 10 times a second. Like the
 * ResearchStore's sync it hears the live game only. Returns the unsubscribe.
 */
export function watchResearchOf(bus: GameEventBus, playerId: string, changed: () => void): () => void {
  const subs = new SubscriptionBag();
  subs.add(bus.onLive('research:state-changed', (e) => { if (e.playerId === playerId) changed(); }));
  subs.add(bus.onLive('research:progress', (e) => { if (e.playerId === playerId) changed(); }));
  return () => subs.disposeAll();
}
