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
  // Sky as a cube render target, converted once from the equirect image
  private skyTarget: WebGLCubeRenderTarget | null = null;
  // The sky image can arrive after dispose(), it must not touch the renderer then
  private disposed = false;

  /** Starts loading; the image sets `scene.background` when it arrives. */
  constructor(renderer: WebGLRenderer, scene: Scene) {
    const loader = new TextureLoader();

    loader.load(
      'assets/images/skybox/day.webp',
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = SRGBColorSpace;
        this.skyTarget = new WebGLCubeRenderTarget(texture.image.height).fromEquirectangularTexture(
          renderer,
          texture
        );
        scene.background = this.skyTarget.texture;
        texture.dispose();
      },
      undefined,
      (error) => {
        console.warn('[ThreeTilesEngine] Failed to load sky texture, using fallback color', error);
        scene.background = new Color(0x87ceeb); // Light blue fallback
      }
    );
  }

  /** Frees the cube target; an image that arrives later is dropped. */
  dispose(): void {
    this.disposed = true;
    this.skyTarget?.dispose();
    this.skyTarget = null;
  }
}
