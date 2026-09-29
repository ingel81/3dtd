export type GamePhase = 'setup' | 'wave' | 'gameover';

/** Geo coordinate (minimal) */
export interface GeoCoord {
  lat: number;
  lon: number;
}

/** Geo coordinate with height */
export interface GeoCoordWithHeight extends GeoCoord {
  height: number;
}

/** Spawn point definition */
export interface StoreSpawnPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  color: number;
}

/** Tile loading statistics */
export interface TileStats {
  parsing: number;
  downloading: number;
  total: number;
  visible: number;
  /** Tile cache in MiB, everything downloaded, not only what is on the GPU. */
  cacheMB: number;
}

/**
 * Sound one-shots since the page loaded: asked for, and started past the
 * limits (SpatialAudioPlayback.getSoundCounts). The FPS display shows them
 * per second.
 */
export interface SoundCounts {
  requested: number;
  played: number;
}

/** Camera debug info */
export interface CameraDebugInfo {
  posX: number; posY: number; posZ: number;
  rotX: number; rotY: number; rotZ: number;
  heading: number; pitch: number; altitude: number;
  distanceToCenter: number; fov: number; terrainHeight: number;
}
