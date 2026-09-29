/**
 * The seams between the parts of the main thread (docs/SIM_WORKER.md): the
 * SimClient (sim-client.service.ts) runs the transport and hands every packet
 * to the mirror and the presenter in this order:
 *
 *   mirror.applyState(packet)             tower states, removed towers, scalars, enemy/worm tables into the views
 *   presenter.applyOps(packet.ops)        renderer calls
 *   for each event: bus.emit(mirror.importEvent(event))   (live/show flags set on the bus around it)
 *   presenter.present(packet)             tables to the renderers, when packet.presented
 *   mirror.afterFrame(packet)             per-frame numbers other readers poll (tower aims already set in applyState)
 */
import type { SimFramePacket, SimScalars } from '../protocol/packet';
import type { ExportedEvent } from '../protocol/events';
import type { PresentationOp } from '../protocol/ops';
import type { ViewEvent } from './view-events';
import type { EnemyView } from './views';
import type { Tower } from '../../entities/tower.entity';

/** The main thread's picture of the simulation (sim/client/mirror). */
export interface SimMirrorApi {
  applyState(packet: SimFramePacket): void;
  importEvent(event: ExportedEvent): ViewEvent;
  afterFrame(packet: SimFramePacket): void;
  /** Everything forgotten (new run, new place, the worker restarted) */
  clear(): void;
  readonly scalars: SimScalars;
  towers(): readonly Tower[];
  tower(id: string): Tower | null;
  enemies(): readonly EnemyView[];
  enemy(id: string): EnemyView | null;
}

/** The renderers' side (presentation/). */
export interface SimPresenterApi {
  applyOps(ops: readonly PresentationOp[]): void;
  present(packet: SimFramePacket): void;
  /** Game time of the frame for what follows it on the main thread (ability sound tails, status sparks) */
  advance(gameTimeDeltaMs: number): void;
  clear(): void;
}
