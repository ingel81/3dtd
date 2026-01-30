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

/** Favorite location */
export interface StoreFavoriteLocation {
  id: string;
  name: string;
  hq: GeoCoord;
  spawns: GeoCoord[];
}

/** Tile loading statistics */
export interface TileStats {
  parsing: number;
  downloading: number;
  total: number;
  visible: number;
}

/** Camera debug info */
export interface CameraDebugInfo {
  posX: number; posY: number; posZ: number;
  rotX: number; rotY: number; rotZ: number;
  heading: number; pitch: number; altitude: number;
  distanceToCenter: number; fov: number; terrainHeight: number;
}

/** Loading step for init sequence */
export interface LoadingStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
}
