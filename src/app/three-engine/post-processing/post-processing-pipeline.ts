import { Scene, PerspectiveCamera, WebGLRenderer, Vector2 } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createColorGradingPass, ColorGradingPreset } from './color-grading';

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
  private readonly colorGrading: ReturnType<typeof createColorGradingPass>;

  private bloomEnabled = false;
  private colorGradingPreset: ColorGradingPreset = 'none';

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    this.composer = new EffectComposer(renderer);

    this.composer.addPass(new RenderPass(scene, camera));

    this.bloomPass = new UnrealBloomPass(
      new Vector2(window.innerWidth, window.innerHeight),
      0.3,  // strength (subtle)
      0.4,  // radius
      0.85, // threshold (only bright things bloom)
    );
    this.composer.addPass(this.bloomPass);

    // Color grading LUT pass (inserted before output, disabled by default)
    this.colorGrading = createColorGradingPass();
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
  }
  isBloomEnabled(): boolean {
    return this.bloomEnabled;
  }
  setBloomStrength(strength: number): void {
    this.bloomPass.strength = strength;
  }
  setBloomThreshold(threshold: number): void {
    this.bloomPass.threshold = threshold;
  }

  // ── Color Grading ────────────────────────────────────────────────
  setColorGradingPreset(preset: ColorGradingPreset): void {
    this.colorGradingPreset = preset;
    this.colorGrading.setPreset(preset);
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
