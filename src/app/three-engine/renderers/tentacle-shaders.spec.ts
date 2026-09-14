import { describe, it, expect } from 'vitest';
import { TENTACLE_FRAGMENT, TENTACLE_VERTEX } from './tentacle-shaders';
import { DISPLAY_OUTPUT_GLSL } from './display-output';

describe('tentacle shaders', () => {
  it('write the lit flesh for the target, with log depth', () => {
    expect(TENTACLE_FRAGMENT).toContain(DISPLAY_OUTPUT_GLSL);
    expect(TENTACLE_FRAGMENT).toContain('gl_FragColor = vec4(displayOutput(finalColor), 1.0);');
    expect(TENTACLE_FRAGMENT).toContain('#include <logdepthbuf_fragment>');
    expect(TENTACLE_VERTEX).toContain('#include <logdepthbuf_vertex>');
  });
});
