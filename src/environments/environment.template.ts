// Copy this file to environment.ts and environment.prod.ts.
//
// Filling in a key here is optional and only convenient for local development:
// the app also asks for credentials at runtime and keeps them in localStorage,
// and a self-hosted deployment can put them into public/runtime-config.json
// instead of rebuilding. Production builds ship with these left empty.

export const environment = {
  production: false, // Set to true for environment.prod.ts
  tileProvider: 'cesium' as 'cesium' | 'google', // 'cesium' = Cesium Ion, 'google' = Google Maps API direct
  googleMapsApiKey: '',
  // Cesium Ion (the default route to the same Google 3D Tiles)
  cesiumIonToken: '',
  cesiumAssetId: '2275207', // Google Photorealistic 3D Tiles via Cesium
  // Own georeferenced 3D Tiles at a plain URL (no key), played with ?world=tileset:<id>,
  // docs/OWN_TILESETS.md. Example, served by tools/own-tiles/serve.mjs:
  // { id: 'kalasatama', name: 'Helsinki Kalasatama (2017)', url: 'http://localhost:4310/kalasatama/tileset/tileset.json',
  //   attribution: 'Helsingin kaupunki, Kalasataman kolmioverkkomalli 2017, CC BY 4.0',
  //   center: { lat: 60.18449, lon: 24.97745 }, radiusM: 1400, geometricErrorScale: 10 }
  ownTilesets: [] as unknown[],
};
