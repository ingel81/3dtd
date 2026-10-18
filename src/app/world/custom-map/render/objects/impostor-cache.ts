import type { WebGLRenderer } from 'three';
import type { ObjectModel } from '../map-asset-library';
import { bakeImpostor, bakeImpostorAsync, type Impostor } from './impostor';

/**
 * The impostors of a map's view, one bake per asset for every object layer
 * that draws it (the map's objects and the border's trees mirrored onto the
 * apron showed the same trees, and each baked its own: two atlases of a
 * tree twice in memory). `finish` readies a fresh impostor's materials as
 * the layers draw them, once.
 */
export class ImpostorCache {
  private readonly baked = new Map<string, Impostor | null>();
  /** Bakes under way, by asset */
  private readonly jobs = new Map<string, Promise<void>>();
  private disposed = false;

  constructor(
    readonly renderer: WebGLRenderer,
    private readonly finish: (imp: Impostor) => void,
  ) {}

  /** Whether an asset's far level is an impostor: trees and big rocks (buildings get hand-made far models through the catalogue's lod) */
  wants(model: ObjectModel): boolean {
    const entry = model.entry;
    return (entry.category === 'tree' || (entry.category === 'rock' && entry.height >= 1.5)) && !model.placeholder;
  }

  /**
   * Bakes an asset's impostor ahead, its programs built first off the main
   * thread (bakeImpostorAsync): `get` then finds it
   */
  prepare(model: ObjectModel): Promise<void> {
    const id = model.entry.id;
    if (!this.wants(model) || this.baked.has(id)) return Promise.resolve();
    let job = this.jobs.get(id);
    if (!job) {
      job = bakeImpostorAsync(this.renderer, model)
        .then((imp) => {
          if (this.disposed || this.baked.has(id)) imp?.dispose();
          else this.baked.set(id, this.ready(imp));
        })
        .catch(() => undefined)
        .finally(() => this.jobs.delete(id));
      this.jobs.set(id, job);
    }
    return job;
  }

  /** The asset's impostor, baked now if `prepare` has not (its programs then link in this frame); null for none */
  get(model: ObjectModel): Impostor | null {
    if (!this.wants(model)) return null;
    const id = model.entry.id;
    let imp = this.baked.get(id);
    if (imp === undefined) {
      imp = this.ready(bakeImpostor(this.renderer, model));
      this.baked.set(id, imp);
    }
    return imp;
  }

  dispose(): void {
    this.disposed = true;
    for (const imp of this.baked.values()) imp?.dispose();
    this.baked.clear();
  }

  private ready(imp: Impostor | null): Impostor | null {
    if (imp) this.finish(imp);
    return imp;
  }
}
