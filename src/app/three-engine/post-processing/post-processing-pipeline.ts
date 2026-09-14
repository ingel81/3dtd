import { Scene, PerspectiveCamera, WebGLRenderer, Vector2, WebGLRenderTarget, HalfFloatType } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createColorGradingPass, ColorGradingPreset } from './color-grading';
import { BloomKick, type BloomValues } from './bloom-kick';

/**
 * PostProcessingPipeline — kapselt EffectComposer + Render-/Bloom-/ColorGrading-/Output-Pass.
 *
 * Vorher inline in `three-tiles-engine.ts` (`setupPostProcessing` + 5 Felder + ~9 Setter).
 * Hier zusammengezogen, damit der Engine-Mainfile die Pipeline nur noch wie eine Black-Box
 * benutzt: `pipeline.render()`, `pipeline.setSize(w, h)`, `pipeline.needsRender()`.
 *
 * Bloom und Color-Grading lassen sich zur Laufzeit unabhängig (de-)aktivieren —
 * `needsRender()` liefert false, wenn beide Pässe inaktiv sind, sodass der Caller
 * direkt rendern kann (cheaper als Composer-Roundtrip).
 */
export class PostProcessingPipeline {
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly bloomKick: BloomKick;
  private readonly colorGrading: ReturnType<typeof createColorGradingPass>;

  private bloomEnabled = false;
  private colorGradingPreset: ColorGradingPreset = 'none';

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    // The composer's default target has no MSAA, so the canvas antialiasing
    // was lost as soon as a pass was on. Four samples on the scene target.
    // A stencil buffer like the canvas: the tower range rings need it
    // (range-ring.ts); the composer's second target is a clone of this one.
    const size = renderer.getSize(new Vector2());
    const pixelRatio = renderer.getPixelRatio();
    const target = new WebGLRenderTarget(size.width * pixelRatio, size.height * pixelRatio, {
      type: HalfFloatType,
      samples: 4,
      stencilBuffer: true,
    });
    this.composer = new EffectComposer(renderer, target);
    // A supplied target sets the composer's logical size to its pixel size.
    this.composer.setSize(size.width, size.height);

    this.composer.addPass(new RenderPass(scene, camera));

    this.bloomPass = new UnrealBloomPass(
      new Vector2(window.innerWidth, window.innerHeight),
      0.3,  // strength (subtle)
      0.4,  // radius
      0.85, // threshold (only bright things bloom)
    );
    // Disabled until explicitly turned on — otherwise the 5 bloom mip passes
    // would run on every composer.render() even when only color grading is
    // active (the bloomEnabled flag was previously not wired to pass.enabled).
    this.bloomPass.enabled = false;
    this.composer.addPass(this.bloomPass);
    this.bloomKick = new BloomKick(this.bloomPass);

    // Color grading LUT pass (inserted before output, disabled by default)
    this.colorGrading = createColorGradingPass();
    this.colorGrading.pass.enabled = false;
    this.composer.addPass(this.colorGrading.pass);

    this.composer.addPass(new OutputPass());
  }

  /** Whether at least one post-processing pass is active. */
  needsRender(): boolean {
    return this.bloomEnabled || this.colorGradingPreset !== 'none';
  }

  /** Render the scene through the composer. */
  render(): void {
    this.composer.render();
  }

  /** Resize all internal render targets. */
  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  // ── Bloom ────────────────────────────────────────────────────────
  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
    this.bloomPass.enabled = enabled;
    if (!enabled) this.bloomKick.reset();
  }

  /**
   * Brighter bloom for a moment: `amount` 0..1 of the way from the set-up
   * strength and threshold to `peak`, 0 puts them back exactly. Only while
   * bloom is on (VFX settings); a kick never turns the pass on.
   */
  setBloomKick(amount: number, peak: BloomValues): void {
    if (this.bloomEnabled) {
      this.bloomKick.set(amount, peak);
    } else {
      this.bloomKick.reset();
    }
  }

  // ── Color Grading ────────────────────────────────────────────────
  setColorGradingPreset(preset: ColorGradingPreset): void {
    this.colorGradingPreset = preset;
    this.colorGrading.setPreset(preset);
    this.colorGrading.pass.enabled = preset !== 'none';
  }
  getColorGradingPreset(): ColorGradingPreset {
    return this.colorGradingPreset;
  }
  setColorGradingIntensity(value: number): void {
    this.colorGrading.setIntensity(value);
  }

  /** Dispose composer + LUT textures. Called from engine dispose(). */
  dispose(): void {
    this.colorGrading.dispose();
    this.composer.dispose();
  }
}
