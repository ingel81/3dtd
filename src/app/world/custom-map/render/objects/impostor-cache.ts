import type { WebGLRenderer } from 'three';
import type { ObjectModel } from '../map-asset-library';
import { bakeImpostor, bakeImpostorAsync, type Impostor } from './impostor';
import { ImpostorArrays, type ImpostorSlot } from './impostor-array';

/**
 * The impostors of a map's view, one bake per asset for every object layer
 * that draws it (the map's objects and the border's trees mirrored onto the
 * apron showed the same trees, and each baked its own: two atlases of a
 * tree twice in memory). A fresh bake goes into a layer of the view's
 * texture arrays (impostor-array.ts), where the layers draw all impostors
 * of one view size at once; its own atlases are freed then.
 */
export class ImpostorCache {
  private readonly baked = new Map<string, ImpostorSlot | null>();
  /** Bakes under way, by asset */
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly arrays: ImpostorArrays;
  private disposed = false;

  constructor(readonly renderer: WebGLRenderer) {
    this.arrays = new ImpostorArrays(renderer);
  }

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
          else this.baked.set(id, this.store(imp));
        })
        .catch(() => undefined)
        .finally(() => this.jobs.delete(id));
      this.jobs.set(id, job);
    }
    return job;
  }

  /** The asset's place in the arrays, baked now if `prepare` has not (its programs then link in this frame); null for none */
  get(model: ObjectModel): ImpostorSlot | null {
    if (!this.wants(model)) return null;
    const id = model.entry.id;
    let slot = this.baked.get(id);
    if (slot === undefined) {
      slot = this.store(bakeImpostor(this.renderer, model));
      this.baked.set(id, slot);
    }
    return slot;
  }

  dispose(): void {
    this.disposed = true;
    this.baked.clear();
    this.arrays.dispose();
  }

  /** A fresh bake into the arrays, its own atlases and materials freed */
  private store(imp: Impostor | null): ImpostorSlot | null {
    if (!imp) return null;
    const slot = this.arrays.add(imp);
    imp.dispose();
    return slot;
  }
}
