import { BufferGeometry, DataTexture } from 'three';
import { describe, expect, it } from 'vitest';
import { isSharedGpu } from '../../shared-gpu';
import type { VATData } from './vat-baker';
import { keepVAT, pageVAT, replaceVAT } from './vat-cache';

function vat(): VATData {
  return { positionTexture: new DataTexture(), geometry: new BufferGeometry(), encoding: 'float' } as unknown as VATData;
}

describe('the page\'s VATs', () => {
  it('keeps a baked VAT for the next engine, its texture and geometry the page\'s, until its texture goes', () => {
    const a = vat();
    keepVAT('zombie', a);
    expect(pageVAT('zombie')).toBe(a);
    expect(isSharedGpu(a.positionTexture) && isSharedGpu(a.geometry)).toBe(true);
    // Baked again after a context loss: same geometry, the new texture
    const again = vat();
    replaceVAT('zombie', again);
    const now = pageVAT('zombie')!;
    expect(now.geometry).toBe(a.geometry);
    expect(now.positionTexture).toBe(again.positionTexture);
    expect(isSharedGpu(a.positionTexture)).toBe(false);
    // The page's renderer replaced (everything freed): the next engine bakes anew
    now.positionTexture.dispose();
    expect(pageVAT('zombie')).toBeNull();
    expect(isSharedGpu(a.geometry)).toBe(false);
  });
});
