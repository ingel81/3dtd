import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  SRGBColorSpace,
  TextureLoader,
  WebGLCubeRenderTarget,
  type Scene,
  type WebGLRenderer,
} from 'three';

/**
 * Szenen-Umgebung: die statischen Lichter und der Himmel.
 *
 * Vorher inline in `three-tiles-engine.ts` (`setupLighting`, `setupSky`, `skyTarget`).
 * Der Engine-Konstruktor ruft beides an derselben Stelle wie zuvor; Nebel und
 * Clear-Color setzt er weiter selbst, der Nebel hängt an der Sichtweite der Kamera.
 */

/** Hemisphere-, Sonnen-, Füll- und Ambient-Licht, einmal platziert und danach statisch. */
export function addSceneLights(scene: Scene): void {
  // Hemisphere light - warm sky/ground gradient
  const hemi = new HemisphereLight(
    0xffeedd, // Warm sky color
    0x806040, // Warm ground color
    1.5
  );
  scene.add(hemi);

  // Main sun light (key light) - warm bright sun
  const sun = new DirectionalLight(0xffeecc, 3.0); // Warm and bright
  sun.position.set(-50, 100, -30); // SW direction, high angle
  scene.add(sun);

  // Fill light - warm from opposite side
  const fill = new DirectionalLight(0xfff0e0, 1.5); // Warm
  fill.position.set(50, 50, 30); // NE direction
  scene.add(fill);

  // Warm ambient for overall brightness
  const ambient = new AmbientLight(0xffe8d0, 0.8); // Warm tint
  scene.add(ambient);

  // R1: lights never move after setup, compute their world matrix once and
  // opt out of the per-frame matrixWorld pass.
  for (const light of [hemi, sun, fill, ambient]) {
    light.updateMatrix();
    light.updateMatrixWorld(true);
    light.matrixAutoUpdate = false;
    light.matrixWorldAutoUpdate = false;
  }
}

/**
 * Sky background from an equirectangular texture.
 *
 * three converts an equirect background into a cube render target on its
 * own (WebGLEnvironments, face size = image height) and then keeps the
 * source texture on the GPU next to it, never read again. Running the same
 * conversion here lets the source go: same function, same size, same
 * filters, so the same pixels.
 */
export class SkyBackground {
  // Sky as a cube render target, converted from the equirect image
  private skyTarget: WebGLCubeRenderTarget | null = null;
  // The sky image can arrive after dispose(), it must not touch the renderer then
  private disposed = false;
  /** Removes the webglcontextrestored listener (convertAgainOnContextRestore). */
  private stopConvertOnRestore: (() => void) | null = null;

  /** Starts loading; the image sets `scene.background` when it arrives. */
  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
  ) {
    this.load();
  }

  /**
   * Convert the sky again whenever `canvas` gets its WebGL context back. A
   * restored context gives the cube target new, empty GL storage: its pixels
   * were drawn once from the image, and the image is freed after that. Loads
   * the image again (from the browser cache) into the same target. Nothing
   * happens while the fallback colour is the background. dispose() stops
   * listening.
   */
  convertAgainOnContextRestore(canvas: HTMLCanvasElement): void {
    this.stopConvertOnRestore?.();
    const onRestored = (): void => {
      if (this.skyTarget !== null) this.load();
    };
    canvas.addEventListener('webglcontextrestored', onRestored);
    this.stopConvertOnRestore = () => canvas.removeEventListener('webglcontextrestored', onRestored);
  }

  private load(): void {
    new TextureLoader().load(
      'assets/images/skybox/day.webp',
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = SRGBColorSpace;
        // Again after a context restore: the same image, so the same size
        this.skyTarget ??= new WebGLCubeRenderTarget(texture.image.height);
        this.skyTarget.fromEquirectangularTexture(this.renderer, texture);
        this.scene.background = this.skyTarget.texture;
        texture.dispose();
      },
      undefined,
      (error) => {
        console.warn('[ThreeTilesEngine] Failed to load sky texture, using fallback color', error);
        this.scene.background = new Color(0x87ceeb); // Light blue fallback
      }
    );
  }

  /** Frees the cube target; an image that arrives later is dropped. */
  dispose(): void {
    this.disposed = true;
    this.stopConvertOnRestore?.();
    this.stopConvertOnRestore = null;
    this.skyTarget?.dispose();
    this.skyTarget = null;
  }
}
