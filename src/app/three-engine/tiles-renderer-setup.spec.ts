import { MathUtils, type Group } from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { applyStreamingBudget, createTilesRenderer, type TilesRendererOptions } from './tiles-renderer-setup';

// Der echte TilesRenderer lädt Tilesets übers Netz. Die Fakes halten nur fest,
// wie das Setup ihn und seine Plugins konfiguriert.
vi.mock('3d-tiles-renderer', async () => {
  const { Group } = await vi.importActual<typeof import('three')>('three');
  class TilesRenderer {
    readonly group = new Group();
    readonly plugins: unknown[] = [];
    autoDisableRendererCulling = true;
    errorTarget = 16;
    errorFalloff = 0;
    errorFalloffDensity = 0;
    downloadQueue = { maxJobsPerOrigin: 25 };
    parseQueue = { maxJobs: 5 };
    lruCache = { minBytesSize: 0, maxBytesSize: 0 };
    registerPlugin(plugin: unknown): void {
      this.plugins.push(plugin);
    }
  }
  return { TilesRenderer };
});

vi.mock('3d-tiles-renderer/plugins', () => {
  class FakePlugin {
    constructor(readonly options?: unknown) {}
  }
  return {
    TileCompressionPlugin: class TileCompressionPlugin extends FakePlugin {},
    UpdateOnChangePlugin: class UpdateOnChangePlugin extends FakePlugin {},
    UnloadTilesPlugin: class UnloadTilesPlugin extends FakePlugin {},
    TilesFadePlugin: class TilesFadePlugin extends FakePlugin {},
    GLTFExtensionsPlugin: class GLTFExtensionsPlugin extends FakePlugin {},
    ReorientationPlugin: class ReorientationPlugin extends FakePlugin {},
    LoadRegionPlugin: class LoadRegionPlugin extends FakePlugin {},
  };
});

vi.mock('3d-tiles-renderer/core/plugins', () => {
  class FakePlugin {
    constructor(readonly options?: unknown) {}
  }
  return {
    CesiumIonAuthPlugin: class CesiumIonAuthPlugin extends FakePlugin {},
    GoogleCloudAuthPlugin: class GoogleCloudAuthPlugin extends FakePlugin {},
  };
});

/** Was die Fakes oben mitschreiben. */
interface FakePlugin {
  options?: Record<string, unknown>;
}
interface FakeTilesRenderer {
  group: Group;
  plugins: FakePlugin[];
  autoDisableRendererCulling: boolean;
  errorTarget: number;
  errorFalloff: number;
  errorFalloffDensity: number;
  downloadQueue: { maxJobsPerOrigin: number };
  parseQueue: { maxJobs: number };
  lruCache: { minBytesSize: number; maxBytesSize: number };
}

const OPTIONS: TilesRendererOptions = {
  provider: 'google',
  googleMapsApiKey: 'maps-key',
  cesiumIonToken: 'ion-token',
  cesiumAssetId: '2275207',
  origin: { lat: 48.78, lon: 9.18, height: 250 },
};

function create(options: Partial<TilesRendererOptions> = {}) {
  const setup = createTilesRenderer({ ...OPTIONS, ...options });
  const tiles = setup.tilesRenderer as unknown as FakeTilesRenderer;
  const names = tiles.plugins.map((plugin) => plugin.constructor.name);
  const plugin = (name: string) => tiles.plugins[names.indexOf(name)];
  return { setup, tiles, names, plugin };
}

describe('createTilesRenderer()', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registriert die Plugins in fester Reihenfolge, Google-Auth mit Token-Refresh', () => {
    const { names, plugin } = create();

    expect(names).toEqual([
      'GoogleCloudAuthPlugin',
      'TileCompressionPlugin',
      'UpdateOnChangePlugin',
      'UnloadTilesPlugin',
      'TilesFadePlugin',
      'GLTFExtensionsPlugin',
      'ReorientationPlugin',
      'LoadRegionPlugin',
    ]);
    expect(plugin('GoogleCloudAuthPlugin').options).toEqual({ apiToken: 'maps-key', autoRefreshToken: true });
    expect(log).toHaveBeenCalledWith('[ThreeTilesEngine] Using Google Cloud 3D Tiles (direct)');
  });

  it('nimmt für Cesium Ion dessen Auth-Plugin mit Token und Asset-ID', () => {
    const { names, plugin } = create({ provider: 'cesium' });

    expect(names[0]).toBe('CesiumIonAuthPlugin');
    expect(names).not.toContain('GoogleCloudAuthPlugin');
    expect(plugin('CesiumIonAuthPlugin').options).toEqual({ apiToken: 'ion-token', assetId: '2275207' });
    expect(log).toHaveBeenCalledWith('[ThreeTilesEngine] Using Cesium Ion 3D Tiles');
  });

  it('entlädt verzögert und dekodiert Draco aus dem eigenen draco/gltf/', () => {
    const { plugin } = create();

    expect(plugin('UnloadTilesPlugin').options).toEqual({ delay: 2000 });
    const dracoLoader = plugin('GLTFExtensionsPlugin').options?.['dracoLoader'] as DRACOLoader;
    expect(dracoLoader).toBeInstanceOf(DRACOLoader);
    // r186 legt die aufgelösten Dateien ab, nicht den Ordner.
    const { decoderPaths } = dracoLoader as unknown as { decoderPaths: { js: string; wasm: string } };
    expect(decoderPaths).toMatchObject({
      js: 'draco/gltf/draco_wasm_wrapper.js',
      wasm: 'draco/gltf/draco_decoder.wasm',
    });
  });

  it('zentriert per Reorientation auf den Origin und gibt Reorientation und Load-Regions zurück', () => {
    const { setup, plugin } = create();

    expect(plugin('ReorientationPlugin').options).toEqual({
      lat: 48.78 * MathUtils.DEG2RAD,
      lon: 9.18 * MathUtils.DEG2RAD,
      height: 250,
      recenter: true,
    });
    expect(setup.reorientationPlugin).toBe(plugin('ReorientationPlugin'));
    expect(setup.routeRegions).toBe(plugin('LoadRegionPlugin'));
  });

  it('dreht die Gruppe auf Y-oben und überlässt das Frustum-Culling three', () => {
    const { tiles } = create();

    expect(tiles.group.rotation.x).toBe(-Math.PI / 2);
    expect(tiles.group.rotation.y).toBe(0);
    expect(tiles.group.rotation.z).toBe(0);
    expect(tiles.autoDisableRendererCulling).toBe(false);
  });

  it('setzt das Streaming-Budget erst mit applyStreamingBudget()', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { setup, tiles } = create();
    expect(tiles.errorTarget).toBe(16);

    applyStreamingBudget(setup.tilesRenderer);

    expect(tiles.errorTarget).toBe(20);
    expect(tiles.errorFalloff).toBe(24);
    expect(tiles.errorFalloffDensity).toBe(2.5e-4);
    expect(tiles.downloadQueue.maxJobsPerOrigin).toBe(4);
    expect(tiles.parseQueue.maxJobs).toBe(1);
    expect(tiles.lruCache.minBytesSize).toBe(0.5 * 2 ** 30);
    expect(tiles.lruCache.maxBytesSize).toBe(0.7 * 2 ** 30);
  });
});
