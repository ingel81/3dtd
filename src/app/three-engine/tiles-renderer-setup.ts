import { isDevMode } from '@angular/core';
import { MathUtils } from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import {
  TilesFadePlugin,
  TileCompressionPlugin,
  UpdateOnChangePlugin,
  UnloadTilesPlugin,
  GLTFExtensionsPlugin,
  ReorientationPlugin,
  LoadRegionPlugin,
} from '3d-tiles-renderer/plugins';
import { CesiumIonAuthPlugin, GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/** Woher die Tiles kommen und wo der Origin liegt. */
export interface TilesRendererOptions {
  provider: 'cesium' | 'google';
  googleMapsApiKey: string;
  cesiumIonToken: string;
  cesiumAssetId: string;
  /** Origin in Grad und Metern; der ReorientationPlugin legt ihn auf (0, 0, 0). */
  origin: { lat: number; lon: number; height: number };
}

/** Der fertige TilesRenderer und die Plugins, die der Engine danach noch anspricht. */
export interface TilesRendererSetup {
  tilesRenderer: TilesRenderer;
  /** setOrigin() verschiebt darüber den Origin. */
  reorientationPlugin: ReorientationPlugin;
  /** setRouteCorridor() hält darüber den Routen-Korridor auf feiner LOD. */
  routeRegions: LoadRegionPlugin;
}

/**
 * Baut den TilesRenderer des Tiles-Pfads: Auth-Plugin je Provider, Kompression,
 * Update-on-Change, verzögertes Entladen, Fade, glTF mit Draco, Reorientation auf
 * den Origin, Load-Regions für den Routen-Korridor, Gruppe auf Y-oben gedreht.
 *
 * Vorher inline am Anfang von `initialize()` in `three-tiles-engine.ts`. Der Engine
 * hängt die Gruppe danach in die Szene, setzt Controls, Auflösung und Kamera und ruft
 * dann {@link applyStreamingBudget}, in derselben Reihenfolge wie zuvor.
 */
export function createTilesRenderer(options: TilesRendererOptions): TilesRendererSetup {
  // Create TilesRenderer
  const tilesRenderer = new TilesRenderer();
  // Let three frustum-cull tile meshes. The renderer's own culling only
  // covers the main camera, but the route corridor keeps off-screen tiles
  // visible and the tower LOS cubemap renders from cameras of its own.
  tilesRenderer.autoDisableRendererCulling = false;

  // Register auth plugin based on tile provider
  if (options.provider === 'google') {
    if (isDevMode()) console.log('[ThreeTilesEngine] Using Google Cloud 3D Tiles (direct)');
    tilesRenderer.registerPlugin(
      // Sessions expire. Without the refresh, tiles start failing mid-game
      // with per-tile errors, which the auth-error check of the
      // TileLoadingTracker never sees.
      new GoogleCloudAuthPlugin({ apiToken: options.googleMapsApiKey, autoRefreshToken: true })
    );
  } else {
    if (isDevMode()) console.log('[ThreeTilesEngine] Using Cesium Ion 3D Tiles');
    tilesRenderer.registerPlugin(
      new CesiumIonAuthPlugin({
        apiToken: options.cesiumIonToken,
        assetId: options.cesiumAssetId,
      })
    );
  }
  tilesRenderer.registerPlugin(new TileCompressionPlugin());
  tilesRenderer.registerPlugin(new UpdateOnChangePlugin());
  // Hidden tiles keep their GPU upload for 2 s, so turning the camera back
  // does not re-upload what just left the view.
  tilesRenderer.registerPlugin(new UnloadTilesPlugin({ delay: 2000 }));
  tilesRenderer.registerPlugin(new TilesFadePlugin());
  tilesRenderer.registerPlugin(
    new GLTFExtensionsPlugin({
      // Selbst ausgeliefert aus public/draco/gltf/. Ueber ein Fremd-CDN ginge
      // die IP jedes Spielers dorthin, und das Spiel haenge an dessen Uptime.
      dracoLoader: new DRACOLoader().setDecoderPath('draco/gltf/'),
    })
  );

  // Reorientation plugin - centers tiles on origin
  const origin = options.origin;
  const reorientationPlugin = new ReorientationPlugin({
    lat: origin.lat * MathUtils.DEG2RAD,
    lon: origin.lon * MathUtils.DEG2RAD,
    height: origin.height,
    recenter: true,
  });
  tilesRenderer.registerPlugin(reorientationPlugin);

  // Keeps the enemy route corridor at fine LOD, see setRouteCorridor().
  const routeRegions = new LoadRegionPlugin();
  tilesRenderer.registerPlugin(routeRegions);

  // Important: rotate tiles group so Y is up (default is Z-up)
  tilesRenderer.group.rotation.x = -Math.PI / 2;

  return { tilesRenderer, reorientationPlugin, routeRegions };
}

/**
 * Streaming budget: refinement error, distance falloff, download and parse
 * queues, LRU cache size. Called once from `initialize()`, after the camera is set.
 */
export function applyStreamingBudget(tilesRenderer: TilesRenderer): void {
  // Max screen-space error in px before a tile is refined. Higher = coarser.
  // Lib default is 16. GoogleCloudAuthPlugin sets 20 on its own; this keeps
  // the Cesium path on the same budget.
  tilesRenderer.errorTarget = 20;
  // Distant tiles refine less, fog-style (Cesium's dynamic screen-space
  // error). Takes up to 24 px off the error: about 5 px at 2 km, 15 px at
  // 4 km, 21 px at 6 km. Only bites when the camera tilts towards the
  // horizon; load regions are exempt. Experimental in the library.
  tilesRenderer.errorFalloff = 24;
  tilesRenderer.errorFalloffDensity = 2.5e-4;

  // Lib defaults: 25 downloads per server origin, 5 parses. Google serves all
  // tiles from one origin, so the per-origin cap is the global cap. Parsing is
  // async but finalization lands on the main thread, so one at a time keeps
  // frame times flat.
  tilesRenderer.downloadQueue.maxJobsPerOrigin = 4;
  tilesRenderer.parseQueue.maxJobs = 1;

  // Item caps stay at the lib defaults (6000/8000); on photorealistic tiles
  // the byte cap binds first. Raised from 0.3/0.4 GiB so the route corridor
  // does not crowd out the view; the info overlay shows the cache size.
  // Every TilesRenderer shares this cache module-wide, which is fine with
  // the one engine per page we run.
  tilesRenderer.lruCache.minBytesSize = 0.5 * 2 ** 30;
  tilesRenderer.lruCache.maxBytesSize = 0.7 * 2 ** 30;
}
