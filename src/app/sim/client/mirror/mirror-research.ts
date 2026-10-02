import type { ActiveResearch, ResearchId } from '../../../configs/research/research.types';
import { getResearch } from '../../../configs/research/research-tree.config';
import type { ResearchSource } from '../../../managers/research-snapshot';
import { SubscriptionBag } from '../../../game-engine/game-event-bus';
import type { MainEventBus } from '../view-events';

/**
 * One player's research as the main thread has it (sim/client/mirror): the
 * last research:state-changed, the elapsed times of research:progress on top.
 * Reads like the ResearchManager for what the UI, the bot and the wave
 * source ask of it (ResearchSource, airTargetingUnlocked).
 */
export class MirrorResearch implements ResearchSource {
  private completed = new Set<ResearchId>();
  private active: ActiveResearch[] = [];
  private queued: ResearchId[] = [];
  private _centerLevel = 0;
  private _maxSlots = 1;
  private _airTargetingUnlocked = false;
  private _lanes = 1;

  constructor(readonly playerId: string) {}

  get centerLevel(): number {
    return this._centerLevel;
  }

  get maxSlots(): number {
    return this._maxSlots;
  }

  /** The player's lanes, the factor on every research cost (researchCost) */
  get lanes(): number {
    return this._lanes;
  }

  get availableSlots(): number {
    return Math.max(0, this._maxSlots - this.active.length);
  }

  /** The AA retrofit is done: the combat counts air targets for this player's towers */
  get airTargetingUnlocked(): boolean {
    return this._airTargetingUnlocked;
  }

  isCompleted(id: ResearchId): boolean {
    return this.completed.has(id);
  }

  getCompletedResearches(): Set<ResearchId> {
    return this.completed;
  }

  getActiveResearches(): ActiveResearch[] {
    return this.active;
  }

  getQueuedResearches(): ResearchId[] {
    return this.queued;
  }

  /** research:state-changed */
  setState(
    active: readonly ActiveResearch[],
    completed: ReadonlySet<ResearchId>,
    queued: readonly ResearchId[],
    centerLevel: number,
    maxSlots: number,
    lanes = 1,
  ): void {
    this._lanes = lanes;
    this.active = active.map((a) => ({ ...a }));
    this.completed = new Set(completed);
    this.queued = [...queued];
    this._centerLevel = centerLevel;
    this._maxSlots = maxSlots;
    this._airTargetingUnlocked = [...this.completed].some((id) =>
      getResearch(id)?.effects.some((e) => e.kind === 'enable-targeting' && e.capability === 'air'),
    );
  }

  /** research:progress */
  setElapsed(elapsed: ReadonlyMap<ResearchId, number>): void {
    for (const a of this.active) {
      const t = elapsed.get(a.researchId);
      if (t !== undefined) a.elapsed = t;
    }
  }
}

/**
 * Calls `changed` whenever `playerId`'s research moves, as the mirror hears
 * it: after every change (research:state-changed) and with the progress, 10
 * times a second. The live game only, like the ResearchStore's sync.
 * Returns the unsubscribe.
 */
export function watchResearchOf(bus: MainEventBus, playerId: string, changed: () => void): () => void {
  const subs = new SubscriptionBag();
  subs.add(bus.onLive('research:state-changed', (e) => { if (e.playerId === playerId) changed(); }));
  subs.add(bus.onLive('research:progress', (e) => { if (e.playerId === playerId) changed(); }));
  return () => subs.disposeAll();
}
