import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Scene, type Vector2, type WebGLRenderer } from 'three';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { LuminosityHighPassShader } from 'three/examples/jsm/shaders/LuminosityHighPassShader.js';
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
  it('gives the bloom the guarded high pass, three\'s own only while the guard is off', () => {
    const pp = pipeline();
    const { bloomPass } = pp as unknown as { bloomPass: UnrealBloomPass };
    expect(bloomPass.materialHighPassFilter.fragmentShader).toBe(GUARDED_HIGH_PASS_FRAGMENT);

    pp.setBloomGuard(false);
    expect(bloomPass.materialHighPassFilter.fragmentShader).toBe(LuminosityHighPassShader.fragmentShader);
    pp.setBloomGuard(true);
    expect(bloomPass.materialHighPassFilter.fragmentShader).toBe(GUARDED_HIGH_PASS_FRAGMENT);
  });

  it('marks the pixels right after the scene, and sends the frame through the composer while it does', () => {
    const pp = pipeline();
    const { composer, pixelMarks } = pp as unknown as { composer: EffectComposer; pixelMarks: ShaderPass };
    expect(composer.passes[0]).toBeInstanceOf(RenderPass);
    expect(composer.passes[1]).toBe(pixelMarks);

    expect([pixelMarks.enabled, pp.needsRender()]).toEqual([false, false]);
    pp.setPixelMarks(true);
    expect([pixelMarks.enabled, pp.needsRender()]).toEqual([true, true]);
    pp.setPixelMarks(false);
    expect(pp.needsRender()).toBe(false);
  });
});
