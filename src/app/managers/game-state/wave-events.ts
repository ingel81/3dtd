import type { GameEventBus } from '../../game-engine/game-event-bus';
import type { SimSink } from '../../sim/core/sim-sink';
import type { RunEventObject, RunWaveEvent } from '../../sim/protocol/run-rules';
import { MAP_METERS_PER_DEGREE } from '../../world/custom-map/map-document';
import { hiddenObjectsAt, portalWaves } from '../../world/custom-map/wave-events';

/**
 * A custom map's wave events in the simulation (TODO E170, RunRules.events,
 * world/custom-map/wave-events.ts): the events of wave N happen when the
 * build phase before it begins. What they change is a function of the wave
 * reached, so a snapshot, a replay's seek and a coop resync need no state of
 * their own; `sync` makes it so after each of them.
 *
 * - A spawn with a portal event is no lane before its wave (`laneOpen`,
 *   read by CoopRoom): its spawn brings no enemies, its lane no start
 *   credits and no research price
 * - Objects shown or hidden: the towers near one that changed see anew
 *   (`onObjectChanged`, a world change like a fallen structure)
 * - The main thread hears the wave reached (op `waveEvents.setReached`: sky,
 *   weather, objects of the world) and, as it happens, `map:wave-events`
 *   with the messages and the spawns that opened (a banner)
 */
export class WaveEvents {
  private list: readonly RunWaveEvent[] = [];
  private opens = new Map<string, number>();
  private objects = new Map<string, RunEventObject>();
  /** The wave whose events happened last; 0 before the first sync */
  private reached = 0;
  private hidden = new Set<string>();

  constructor(
    private readonly sink: SimSink,
    private readonly bus: GameEventBus,
    /** Lanes opened or closed: research prices follow (CoopRoom reads laneOpen) */
    private readonly onLanesChanged: () => void,
    /** An object appeared or went: map metres and its radius, for the towers whose sight it changes */
    private readonly onObjectChanged: (x: number, y: number, radius: number) => void,
    /** A spawn's name for the players (its id where the world has none) */
    private readonly spawnName: (spawnId: string) => string = (id) => id,
  ) {}

  /** The world's events; none for a world without */
  load(events: readonly RunWaveEvent[] | null | undefined): void {
    this.list = events ?? [];
    this.opens = portalWaves(this.list);
    this.objects = new Map(this.list.flatMap((e) => (e.kind === 'objects' ? e.objects.map((o) => [o.id, o] as const) : [])));
    this.reached = 0;
    this.hidden = new Set();
  }

  get size(): number {
    return this.list.length;
  }

  /** The wave whose events happened last */
  get reachedWave(): number {
    return this.reached;
  }

  /** Whether spawn `spawnId` is a lane now: no portal event, or its wave reached (before the first sync, as at wave 1) */
  laneOpen(spawnId: string): boolean {
    const wave = this.opens.get(spawnId);
    return wave === undefined || wave <= Math.max(1, this.reached);
  }

  /**
   * The events up to wave `wave` have happened. `live`: as the game runs
   * into it (one wave on): towers near a changed object see anew and the
   * main thread hears the messages; otherwise (a start, a restore, a jump)
   * the state is set quietly.
   */
  sync(wave: number, live: boolean): void {
    if (this.list.length === 0 || wave === this.reached) return;
    const before = this.reached;
    const lanesBefore = [...this.opens.keys()].filter((id) => this.laneOpen(id)).join(',');
    this.reached = wave;
    const hidden = hiddenObjectsAt(this.list, wave);
    const changed = [...this.objects.keys()].filter((id) => hidden.has(id) !== this.hidden.has(id));
    this.hidden = hidden;
    this.sink.waveEvents.setReached(wave);
    if ([...this.opens.keys()].filter((id) => this.laneOpen(id)).join(',') !== lanesBefore) this.onLanesChanged();
    if (!live || wave !== before + 1) return;
    for (const id of changed) {
      const o = this.objects.get(id)!;
      this.onObjectChanged(o.lon * MAP_METERS_PER_DEGREE, o.lat * MAP_METERS_PER_DEGREE, o.radius);
    }
    const now = this.list.filter((e) => e.wave === wave);
    const messages = now.flatMap((e) => (e.kind === 'message' ? [e.text] : []));
    const opened = now.flatMap((e) => (e.kind === 'portal' && this.opens.get(e.spawn) === wave ? [this.spawnName(e.spawn)] : []));
    if (messages.length || opened.length) this.bus.emit({ type: 'map:wave-events', wave, messages, opened });
  }

  /** Tell the main thread the wave reached again (after a restore or a seek) */
  publish(): void {
    if (this.list.length > 0) this.sink.waveEvents.setReached(this.reached);
  }
}
