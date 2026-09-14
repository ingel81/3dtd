import { describe, it, expect } from 'vitest';
import { Texture } from 'three';
import { createFloatingTextMaterial } from './floating-text-material';
import { DISPLAY_OUTPUT_GLSL } from '../display-output';

describe('createFloatingTextMaterial', () => {
  it('writes the atlas colour for the target, with log depth', () => {
    const material = createFloatingTextMaterial(new Texture());
    expect(material.fragmentShader).toContain(DISPLAY_OUTPUT_GLSL);
    expect(material.fragmentShader).toContain('gl_FragColor = displayOutput(vec4(texColor.rgb, texColor.a * vOpacity));');
    expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
    expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
  });
});
