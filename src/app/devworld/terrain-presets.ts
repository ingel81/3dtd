/**
 * DevWorld terrain presets, by category. The generator has one config per
 * preset (terrain-generator.ts); the debug panel and the ?terrain= URL
 * parameter pick from this list.
 */
export const TERRAIN_PRESETS = [
  // Basic
  'flat', 'gentle', 'default',
  // Slopes
  'slope_ns', 'slope_ew', 'slope_diag',
  // Mountains
  'mountains', 'peaks',
  // Valleys
  'crater', 'bowl', 'dome',
  // Plateaus
  'mesa', 'terraces', 'steps',
  // Cellular
  'canyon', 'cells', 'cracks',
  // Waves
  'waves', 'dunes', 'ripples',
  // Patterns
  'spiral', 'rings',
  // Eroded
  'eroded', 'weathered',
  // Biomes
  'islands', 'highlands', 'badlands',
  // Extreme
  'chaos', 'alien', 'fractal',
] as const;

export type TerrainPreset = typeof TERRAIN_PRESETS[number];
