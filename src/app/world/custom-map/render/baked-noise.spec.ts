import { BakedNoise } from './baked-noise';

describe('BakedNoise', () => {
  /** A view opening worked the ground's variation out in its frame (100 to 140 ms in a dev build) */
  it('is there at once with its neutral texel, filled by the bake, shared and baked once', async () => {
    let bakes = 0;
    const noise = new BakedNoise('variation', { size: 4, neutral: [128, 255, 0, 7] }, () => {
      bakes++;
      return new Uint8Array(4 * 4 * 4).fill(9);
    });
    const t = noise.texture();
    expect(Array.from((t.image.data as Uint8Array).slice(0, 8))).toEqual([128, 255, 0, 7, 128, 255, 0, 7]);
    expect(Array.from((t.image.data as Uint8Array).slice(-4))).toEqual([128, 255, 0, 7]);
    // No Worker under jsdom: baked here
    await Promise.all([noise.prepare(), noise.prepare()]);
    expect(bakes).toBe(1);
    expect(noise.texture()).toBe(t);
    expect((t.image.data as Uint8Array).every((v) => v === 9)).toBe(true);
  });
});
