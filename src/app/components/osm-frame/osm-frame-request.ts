import type { GeoPoint } from '../../world/osm/osm-frame-core';

/** The place a frame is for: where the HQ goes, and what the player searched for */
export interface OsmFramePlace extends GeoPoint {
  name: string;
  /** The search line, for the map's name and its source */
  address?: string;
}

/** A frame to open: the place, and spawns to start from (a running real place's) */
export interface OsmFrameRequest {
  place: OsmFramePlace;
  spawnsAt: GeoPoint[];
}
