import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  WebGLCubeRenderTarget,
  type Light,
  type WebGLRenderer,
} from 'three';
import { SkyBackground, addSceneLights } from './scene-environment';

describe('addSceneLights()', () => {
  it('hängt Hemisphere-, Sonnen-, Füll- und Ambient-Licht in die Szene', () => {
    const scene = new Scene();
    addSceneLights(scene);

    const [hemi, sun, fill, ambient] = scene.children as Light[];
    expect(scene.children).toHaveLength(4);
    expect(hemi).toBeInstanceOf(HemisphereLight);
    expect(sun).toBeInstanceOf(DirectionalLight);
    expect(fill).toBeInstanceOf(DirectionalLight);
    expect(ambient).toBeInstanceOf(AmbientLight);
    expect([hemi, sun, fill, ambient].map((light) => light.intensity)).toEqual([1.5, 3, 1.5, 0.8]);
    expect(sun.position.toArray()).toEqual([-50, 100, -30]);
    expect(fill.position.toArray()).toEqual([50, 50, 30]);
  });

  it('rechnet die Weltmatrizen einmal und nimmt die Lichter aus dem Matrix-Pass', () => {
    const scene = new Scene();
    addSceneLights(scene);

    for (const light of scene.children) {
      expect(light.matrixAutoUpdate).toBe(false);
      expect(light.matrixWorldAutoUpdate).toBe(false);
      expect(new Vector3().setFromMatrixPosition(light.matrixWorld).toArray()).toEqual(light.position.toArray());
    }
  });
});

describe('SkyBackground', () => {
  interface PendingLoad {
    url: string;
    onLoad: (texture: Texture<HTMLImageElement>) => void;
    onError: (error: unknown) => void;
  }

  function setup() {
    const loads: PendingLoad[] = [];
    vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((url, onLoad, _onProgress, onError) => {
      loads.push({ url, onLoad: onLoad!, onError: onError! });
      return new Texture();
    });
    // Die Umrechnung braucht WebGL; der Fake merkt sich nur die Zielgröße.
    const faceSizes: number[] = [];
    const convert = vi
      .spyOn(WebGLCubeRenderTarget.prototype, 'fromEquirectangularTexture')
      .mockImplementation(function (this: WebGLCubeRenderTarget) {
        faceSizes.push(this.width);
        return this;
      });
    const targetDispose = vi.spyOn(WebGLCubeRenderTarget.prototype, 'dispose');

    const scene = new Scene();
    const renderer = { name: 'renderer' } as unknown as WebGLRenderer;
    const sky = new SkyBackground(renderer, scene);
    return { scene, renderer, sky, loads, convert, faceSizes, targetDispose };
  }

  function equirect(height: number): Texture<HTMLImageElement> {
    const texture = new Texture<HTMLImageElement>();
    texture.image = { width: height * 2, height } as HTMLImageElement;
    return texture;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('macht aus day.webp eine Cube-Textur mit Kantenlänge = Bildhöhe und gibt das Quellbild frei', () => {
    const { scene, renderer, loads, convert, faceSizes } = setup();
    expect(loads.map((load) => load.url)).toEqual(['assets/images/skybox/day.webp']);

    const texture = equirect(512);
    const sourceDispose = vi.spyOn(texture, 'dispose');
    loads[0].onLoad(texture);

    expect(texture.colorSpace).toBe(SRGBColorSpace);
    expect(convert).toHaveBeenCalledWith(renderer, texture);
    expect(faceSizes).toEqual([512]);
    expect(scene.background).toBe((convert.mock.contexts[0] as WebGLCubeRenderTarget).texture);
    expect(sourceDispose).toHaveBeenCalledTimes(1);
  });

  it('nimmt bei einem Ladefehler die Ersatzfarbe und warnt', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { scene, loads } = setup();

    loads[0].onError('boom');

    expect(warn).toHaveBeenCalledWith('[ThreeTilesEngine] Failed to load sky texture, using fallback color', 'boom');
    expect(scene.background).toBeInstanceOf(Color);
    expect((scene.background as Color).getHex()).toBe(0x87ceeb);
  });

  it('verwirft ein Bild, das erst nach dispose() ankommt', () => {
    const { scene, sky, loads, convert } = setup();
    sky.dispose();

    const texture = equirect(512);
    const sourceDispose = vi.spyOn(texture, 'dispose');
    loads[0].onLoad(texture);

    expect(convert).not.toHaveBeenCalled();
    expect(scene.background).toBeNull();
    expect(sourceDispose).toHaveBeenCalledTimes(1);
  });

  it('dispose() gibt die Cube-Textur einmal frei', () => {
    const { sky, loads, targetDispose } = setup();
    loads[0].onLoad(equirect(256));

    sky.dispose();
    sky.dispose();
    expect(targetDispose).toHaveBeenCalledTimes(1);
  });
});
