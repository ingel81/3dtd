/**
 * The shapes the road network is drawn from (road-network.ts and its
 * parts): a chain of edges with its sections, a vertex, an end at a
 * junction, a point of a junction's outline.
 */
import type { MapPathEdge, MapPoint } from '../../map-document';

export interface Chain {
  /** Its least edge id: the same whatever else changes */
  id: string;
  edge: MapPathEdge;
  edges: string[];
  nodes: [string, string];
  line: MapPoint[];
  /** Distance along at each point of `line` */
  at: number[];
  length: number;
  /** Half the ribbon's width: the carriageway's and the pavement beyond it */
  half: number;
  /** Metres of pavement either side */
  walk: number;
  style: number;
  trim: [number, number];
  /** Cross sections at both ends of the drawn ribbon, right to left seen along the ribbon */
  ends: [Section | null, Section | null];
  cap: [boolean, boolean];
  /**
   * The first metres of a bridge's deck at a junction (bridgeStub): an arm of the junction whose surface the deck
   * is, never drawn here; its end section lies at the node
   */
  stub?: boolean;
  /** Inside a junction of several nodes (too short for a ribbon between them): the junction's surface covers it */
  inner: boolean;
}

export interface Vertex {
  x: number;
  y: number;
  across: number;
  along: number;
  edge: number;
  style: number;
  dx: number;
  dy: number;
  /** In a junction: across and along in the frame of the road it runs into, that frame's turn, its wear and weight (ARM_WEIGHT_BASE) */
  arm?: [number, number, number, number];
}

export type Section = Vertex[];

export interface End {
  chain: Chain;
  start: boolean;
  /** Its node */
  x: number;
  y: number;
  /** Unit direction away from the node */
  dx: number;
  dy: number;
  angle: number;
}

/** A point of a junction's outline: its distance to the edge, the road it belongs to, whether on that road's end section */
export interface RingPoint {
  x: number;
  y: number;
  edge: number;
  arm: number;
  side: boolean;
}
