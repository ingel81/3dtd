import { CompressedTexture, RGBA_S3TC_DXT5_Format } from 'three';
import { describe, expect, it } from 'vitest';
import { keepOnGpuOnly } from './model-loader';

describe('keepOnGpuOnly', () => {
  it('lets the transcoded levels go once the renderer has uploaded them', () => {
    const levels = [{ data: new Uint8Array(64), width: 4, height: 4 }];
    const texture = new CompressedTexture(levels as unknown as ImageData[], 4, 4, RGBA_S3TC_DXT5_Format);
    keepOnGpuOnly(texture);
    // A copy made before the upload keeps them until its own
    const copy = texture.clone();
    texture.onUpdate!(texture);
    expect(texture.mipmaps).toEqual([]);
    expect(texture.userData['released']).toBe(true);
    expect(texture.onUpdate).toBeNull();
    expect(copy.mipmaps).toHaveLength(1);
  });
});
