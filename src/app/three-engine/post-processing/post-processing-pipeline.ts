import { Scene, PerspectiveCamera, WebGLRenderer, Vector2, WebGLRenderTarget, HalfFloatType } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { createColorGradingPass, ColorGradingPreset } from './color-grading';
import { BloomKick, type BloomValues } from './bloom-kick';
import { guardBloomHighPass } from './bloom-guard';
import { createPixelMarksPass } from './pixel-marks';
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

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
  private readonly pixelMarks: ShaderPass;
  private readonly fxaa: FXAAPass;

  private bloomEnabled = false;
  private colorGradingPreset: ColorGradingPreset = 'none';
  /**
   * The quality level's antialiasing needs the composer: FXAA, or MSAA on a
   * canvas made without it (render-quality.ts, setAntialias)
   */
  private antialiasNeedsComposer = false;

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

    // Diagnostic, off: marks what the scene wrote, before the bloom reads it
    this.pixelMarks = createPixelMarksPass();
    this.composer.addPass(this.pixelMarks);

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
    // A NaN or infinite pixel of the frame would spread into a black block
    // hundreds of pixels wide (bloom-guard.ts)
    guardBloomHighPass(this.bloomPass);
    this.composer.addPass(this.bloomPass);
    this.bloomKick = new BloomKick(this.bloomPass);

    // Color grading LUT pass (inserted before output, disabled by default)
    this.colorGrading = createColorGradingPass();
    this.colorGrading.pass.enabled = false;
    this.composer.addPass(this.colorGrading.pass);

    this.composer.addPass(new OutputPass());

    // The Low and Medium levels' antialiasing, on the finished picture
    this.fxaa = new FXAAPass();
    this.fxaa.enabled = false;
    this.composer.addPass(this.fxaa);
  }

  /** Whether at least one post-processing pass is active. */
  needsRender(): boolean {
    return this.bloomEnabled || this.colorGradingPreset !== 'none' || this.pixelMarks.enabled || this.antialiasNeedsComposer;
  }

  /**
   * Antialiasing of the quality level: MSAA (the canvas', and four samples
   * on the composer's scene target while a pass runs) or FXAA after the
   * output pass, through the composer. The canvas' MSAA is fixed when its
   * context is made (`canvasMsaa`): a level that wants MSAA on a canvas
   * without it gets FXAA until the next load, as MSAA on the composer's
   * half-float target cost about three times the canvas' (RTX 5080, demo
   * valley: 4.4 against 1.3 ms GPU).
   */
  setAntialias(mode: 'msaa' | 'fxaa', canvasMsaa: boolean): void {
    const msaa = mode === 'msaa' && canvasMsaa;
    const samples = msaa ? 4 : 0;
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (target.samples === samples) continue;
      target.samples = samples;
      // A target allocates its buffers on first use; disposed it does so again with the new samples
      target.dispose();
    }
    this.fxaa.enabled = !msaa;
    this.antialiasNeedsComposer = !msaa;
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

  // ── Diagnostics (__bloom) ────────────────────────────────────────
  /**
   * Mark NaN pixels of the frame magenta and infinite ones cyan
   * (pixel-marks.ts). While on, the frame goes through the composer with
   * bloom off as well, and the marks replace the bad pixels, so the bloom
   * no longer sees them.
   */
  setPixelMarks(on: boolean): void {
    this.pixelMarks.enabled = on;
  }

  /** The bloom's guard against NaN and infinite pixels (bloom-guard.ts); off only to compare. */
  setBloomGuard(on: boolean): void {
    guardBloomHighPass(this.bloomPass, on);
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
