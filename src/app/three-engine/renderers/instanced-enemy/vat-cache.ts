import { shareGpu, unshareGpu } from '../../shared-gpu';
import type { VATData } from './vat-baker';

/**
 * The VATs baked for the page, by enemy type: every engine (world after
 * world, the editor's test runs) draws the same ones, on the page's renderer
 * (RendererHost), which keeps their texture and geometry uploaded
 * (shareGpu). A bake took 0.5 to 0.8 s of the main thread per engine, and
 * the upload again after it.
 *
 * A VAT keeps no CPU copy once uploaded (releaseTexels): when its texture is
 * disposed (the page's renderer replaced for another MSAA setting, which
 * frees everything) the entry goes and the next engine bakes it again. After
 * a context loss the engine swaps a fresh bake in (`replace`).
 */
const baked = new Map<string, VATData>();

/** The page's VAT of `typeId`, null before its first bake or after its texture went */
export function pageVAT(typeId: string): VATData | null {
  return baked.get(typeId) ?? null;
}

/** Keeps `vat` for the page as `typeId`'s (shareGpu: texture and geometry stay uploaded) */
export function keepVAT(typeId: string, vat: VATData): void {
  const old = baked.get(typeId);
  if (old) forget(old);
  baked.set(typeId, vat);
  shareGpu(vat.positionTexture);
  shareGpu(vat.geometry);
  const onDispose = (): void => {
    vat.positionTexture.removeEventListener('dispose', onDispose);
    if (baked.get(typeId) === vat) {
      baked.delete(typeId);
      forget(vat);
    }
  };
  vat.positionTexture.addEventListener('dispose', onDispose);
}

/** `typeId`'s VAT baked again after a context loss: same geometry, a new texture */
export function replaceVAT(typeId: string, vat: VATData): void {
  const old = baked.get(typeId);
  if (old) keepVAT(typeId, { ...old, positionTexture: vat.positionTexture, encoding: vat.encoding });
}

function forget(vat: VATData): void {
  unshareGpu(vat.positionTexture);
  unshareGpu(vat.geometry);
}
