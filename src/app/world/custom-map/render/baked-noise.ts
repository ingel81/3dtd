/**
 * The custom maps' tiling noise textures (the ground's variation, the
 * water's waves, the shore foam, the lava), worked out once per page in a
 * worker (baked-noise.worker.ts). Each is there at once, shared, holding an
 * even neutral texel until its bake is in: a view or a material made
 * meanwhile does not work it out in the frame it opens (the variation alone
 * 100 to 140 ms in a dev build). A view's `ready` waits for the bakes
 * (prepareNoise), the loading screen covers them.
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';
import { shareGpu } from '../../../three-engine/shared-gpu';

/** The noises by name, as the worker knows them (noise-bakes.ts) */
export type NoiseName = 'variation' | 'waves' | 'foam' | 'lava';

export interface NoiseSpec {
  /** Texels per side (RGBA8, tiling, mipmapped) */
  size: number;
  /** The even texel shown until the bake is in */
  neutral: readonly [number, number, number, number];
}

export class BakedNoise {
  private shared: DataTexture | null = null;
  private baked: Promise<void> | null = null;

  constructor(
    readonly name: NoiseName,
    private readonly spec: NoiseSpec,
    /** The bake itself, for a page without workers (or a worker that failed) */
    private readonly bakeHere: () => Uint8Array,
  ) {}

  /** The shared texture, at once: neutral until prepare's bake is in */
  texture(): DataTexture {
    if (this.shared) return this.shared;
    const { size, neutral } = this.spec;
    const data = new Uint8Array(size * size * 4);
    // One 32-bit word per texel, in the page's byte order
    const word = new Uint32Array(new Uint8Array(neutral).buffer)[0];
    new Uint32Array(data.buffer).fill(word);
    const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
    t.colorSpace = NoColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    this.shared = shareGpu(t);
    return t;
  }

  /** Bakes the texels once, in a worker where there are workers, here where not; settles when they are in */
  prepare(): Promise<void> {
    if (this.baked) return this.baked;
    const fill = (data: Uint8Array): void => {
      const t = this.texture();
      (t.image.data as Uint8Array).set(data);
      t.needsUpdate = true;
    };
    if (typeof Worker === 'undefined') {
      fill(this.bakeHere());
      return (this.baked = Promise.resolve());
    }
    this.baked = new Promise<void>((resolve) => {
      const worker = new Worker(new URL('./baked-noise.worker', import.meta.url), { type: 'module' });
      const done = (data: Uint8Array): void => {
        fill(data);
        worker.terminate();
        resolve();
      };
      worker.onmessage = (e: MessageEvent<Uint8Array>) => done(e.data);
      worker.onerror = () => done(this.bakeHere());
      worker.postMessage(this.name);
    });
    return this.baked;
  }
}
