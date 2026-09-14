import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Scene, type Vector2, type WebGLRenderer } from 'three';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { PostProcessingPipeline } from './post-processing-pipeline';
import { GUARDED_HIGH_PASS_FRAGMENT } from './bloom-guard';

/** Building the pipeline asks the renderer for its size only; nothing is drawn. */
function pipeline(): PostProcessingPipeline {
  const renderer = {
    getSize: (target: Vector2) => target.set(800, 600),
    getPixelRatio: () => 1,
  } as unknown as WebGLRenderer;
  return new PostProcessingPipeline(renderer, new Scene(), new PerspectiveCamera());
}

describe('PostProcessingPipeline', () => {
  it('gives the bloom the guarded high pass', () => {
    const { bloomPass } = pipeline() as unknown as { bloomPass: UnrealBloomPass };
    expect(bloomPass.materialHighPassFilter.fragmentShader).toBe(GUARDED_HIGH_PASS_FRAGMENT);
  });
});
