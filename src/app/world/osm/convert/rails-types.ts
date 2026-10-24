/** The plan of an OSM world's railways as its phases pass it on (rails.ts, rails-ground.ts, rails-pieces.ts) */
import type { MapPathEdge, MapPoint } from '../../custom-map/map-document';
import type { OsmWay } from '../osm-parse';
import type { TunnelLine, TunnelMouth } from './roads';

/** A line of track: its ways joined end to end */
export interface RailChain {
  line: MapPoint[];
  /** Metres along the line at each point */
  at: number[];
  length: number;
  /** OSM node of each point (null where the way had none) */
  nodes: (number | null)[];
  /** The way of each segment (line[k] to line[k + 1]) */
  ways: OsmWay[];
  /** The ground's height every PROFILE_STEP metres along it as the bed is laid (levelRails), null before */
  profile: Float32Array | null;
}

/** Where a line crosses a road on its level */
export interface RailCrossing {
  chain: number;
  along: number;
  at: MapPoint;
  /** Half the length of track the panels cover, metres */
  half: number;
  /** Unit direction of the road and its width */
  roadDir: MapPoint;
  roadWidth: number;
  /** Width of the road's pavement either side (0 without one): the panels reach over it, the signals stand past it */
  pavement: number;
  /** What stands at each approach */
  saltire: boolean;
  light: boolean;
  barrier: boolean;
}

/** What passes under a rail bridge: the ground there and the headroom it needs */
export interface RailUnder {
  along: number;
  at: MapPoint;
  clear: number;
}

/** A stretch of line on a bridge: one the data name, or the track's own over an underpass */
export interface RailBridge {
  chain: number;
  from: number;
  to: number;
  implicit: boolean;
  under: RailUnder[];
}

/** A stretch of line in a road: its rails in the road's asphalt, flush with it */
export interface RailStreet {
  chain: number;
  from: number;
  to: number;
}

/** A road bridge over a line */
export interface RailOverpass {
  chain: number;
  along: number;
  at: MapPoint;
  /** Half the length of track under the deck, metres */
  half: number;
  edge: MapPathEdge;
}

export interface RailStats {
  lines: number;
  km: number;
  crossings: number;
  /** Of them, with a cross, lights, a barrier */
  saltires: number;
  lights: number;
  barriers: number;
  bridges: number;
  /** Of them, the track's own over an underpass */
  underpasses: number;
  overpasses: number;
  tunnels: number;
}

export interface RailPlan {
  chains: RailChain[];
  crossings: RailCrossing[];
  bridges: RailBridge[];
  overpasses: RailOverpass[];
  /** Stretches on a line's lattice where it runs in a road */
  streets: RailStreet[];
  /** Tunnels of MIN_TUNNEL_M or more and their mouths, for buildTunnels */
  tunnels: TunnelLine[];
  mouths: TunnelMouth[];
  stats: RailStats;
}

/** What levelling the beds did */
export interface RailGroundReport {
  /** Ground samples levelled */
  samples: number;
  /** Most the profile rose over the ground's average for a bridge, and sank under it for a road bridge, metres */
  raisedM: number;
  loweredM: number;
}
