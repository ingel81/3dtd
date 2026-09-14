import { describe, it, expect } from 'vitest';
import { AdditiveBlending, NormalBlending, Texture } from 'three';
import { createParticleShaderMaterials } from './particle-shaders';
import { DISPLAY_OUTPUT_GLSL } from './display-output';

describe('createParticleShaderMaterials', () => {
  const { additive, normal } = createParticleShaderMaterials(new Texture(), new Texture(), 4, 4);

  it('writes the glow as additive light for the target, circle and atlas alike', () => {
    expect(additive.blending).toBe(AdditiveBlending);
    const shader = additive.fragmentShader;
    expect(shader).toContain(DISPLAY_OUTPUT_GLSL);
    expect(shader).toContain('gl_FragColor = displayLight(vec4(vColor * alpha, alpha));');
    expect(shader).toContain('gl_FragColor = displayLight(vec4(texel.rgb * vColor, texel.a));');
    expect(shader).toContain('#include <logdepthbuf_fragment>');
  });

  it('writes smoke and dust as a colour for the target', () => {
    expect(normal.blending).toBe(NormalBlending);
    const shader = normal.fragmentShader;
    expect(shader).toContain(DISPLAY_OUTPUT_GLSL);
    expect(shader).toContain('gl_FragColor = displayOutput(vec4(vColor, alpha));');
    expect(shader).toContain('gl_FragColor = displayOutput(vec4(texel.rgb * vColor, texel.a * 0.85));');
    expect(shader).toContain('#include <logdepthbuf_fragment>');
  });
});
