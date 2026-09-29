import { Injectable } from '@angular/core';
import type { SimConfig, SimRpc, SimWorld } from '../protocol/messages';
import type { SimScalars } from '../protocol/packet';
import type { SimMirrorApi, SimPresenterApi } from './contracts';
import { createMainEventBus, type MainEventBus } from './view-events';

/**
 * The main thread's end of the simulation (docs/SIM_WORKER.md). Everything on
 * the main thread reaches the simulation through this service:
 *  - `bus`: the simulation's events as views; commands (`command:*`,
 *    cheat `debug:*`) emitted on it go to the simulation with the next tick.
 *  - `mirror`: what the simulation looked like after the last packet.
 *  - `rpc`: calls with an answer (replay file, snapshots, hashes).
 *
 * The transport (worker, or the same thread for the specs) and the frame loop
 * live here; the mirror and the presenter are handed in by who owns them.
 */
@Injectable({ providedIn: 'root' })
export class SimClient {
  readonly bus: MainEventBus = createMainEventBus();
  private mirrorImpl: SimMirrorApi | null = null;
  private presenterImpl: SimPresenterApi | null = null;

  get mirror(): SimMirrorApi {
    if (!this.mirrorImpl) throw new Error('SimClient: no mirror attached');
    return this.mirrorImpl;
  }

  /** The numbers of the last packet (shortcut for mirror.scalars). */
  get scalars(): SimScalars {
    return this.mirror.scalars;
  }

  attach(mirror: SimMirrorApi, presenter: SimPresenterApi): void {
    this.mirrorImpl = mirror;
    this.presenterImpl = presenter;
  }

  get presenter(): SimPresenterApi | null {
    return this.presenterImpl;
  }

  /** Settings of the run the simulation reads (wave source, roster, lanes, dev flags). */
  configure(_config: SimConfig): void {
    throw new Error('SimClient.configure: not wired yet');
  }

  /** The finished world; before it the simulation runs no sub-step. */
  loadWorld(_world: SimWorld): void {
    throw new Error('SimClient.loadWorld: not wired yet');
  }

  /** One frame of the main thread's loop. */
  frame(_now: number, _renderingEnabled: boolean): void {
    throw new Error('SimClient.frame: not wired yet');
  }

  rpc<K extends keyof SimRpc>(_method: K, ..._args: Parameters<SimRpc[K]>): Promise<ReturnType<SimRpc[K]>> {
    return Promise.reject(new Error('SimClient.rpc: not wired yet'));
  }
}
