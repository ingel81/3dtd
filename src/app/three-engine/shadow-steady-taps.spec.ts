import { ShaderChunk } from 'three';
import { describe, expect, it } from 'vitest';
import { installSteadyShadowTaps } from './shadow-steady-taps';

describe('steady shadow taps', () => {
  it('turns every PCF tap pattern the same way in every pixel, once', () => {
    const before = ShaderChunk.shadowmap_pars_fragment.match(/interleavedGradientNoise\( gl_FragCoord\.xy \)/g)?.length ?? 0;
    installSteadyShadowTaps();
    installSteadyShadowTaps();
    const chunk = ShaderChunk.shadowmap_pars_fragment;
    // Directional and spot (getShadow), point (getPointShadow)
    expect(before).toBe(2);
    expect(chunk).not.toContain('interleavedGradientNoise( gl_FragCoord.xy )');
    expect(chunk.match(/float phi = 0\.0;/g)).toHaveLength(2);
  });
});
