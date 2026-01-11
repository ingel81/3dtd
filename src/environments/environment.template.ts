// Copy this file to environment.ts and environment.prod.ts
// and replace the placeholders with your actual API keys

export const environment = {
  production: false, // Set to true for environment.prod.ts
  googleMapsApiKey: 'YOUR_GOOGLE_MAPS_API_KEY',
  // Cesium Ion (alternative to Google 3D Tiles)
  cesiumIonToken: 'YOUR_CESIUM_ION_ACCESS_TOKEN',
  cesiumAssetId: '2275207', // Google Photorealistic 3D Tiles via Cesium
};
