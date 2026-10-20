import { ShaderChunk } from 'three';
import { describe, expect, it } from 'vitest';
import { installShadowEdgeFade } from './shadow-edge-fade';

describe('shadow edge fade', () => {
  it('fades the shadow of every getShadow towards its map border, once, and leaves point shadows alone', () => {
    installShadowEdgeFade();
    installShadowEdgeFade();
    const chunk = ShaderChunk.shadowmap_pars_fragment;
    const split = chunk.indexOf('getPointShadow');
    // One per shadow map type (PCF, VSM, basic), none twice
    expect(chunk.slice(0, split).match(/shadowIntensity \* shadowEdgeFade/g)).toHaveLength(3);
    expect(chunk.slice(0, split)).not.toContain('return mix( 1.0, shadow, shadowIntensity );');
    expect(chunk.slice(split)).not.toContain('shadowEdgeFade');
  });
});
