/**
 * The street network of a world: OSM ways on the tiles, generated streets in
 * DevWorld. Where they come from and the routes on them: WorldStreetSource
 * (world/world-provider.ts).
 */

export interface StreetNode {
  id: number;
  lat: number;
  lon: number;
}

/** Name of an OSM way without a `name` tag */
export const UNNAMED_STREET = 'Unnamed Street';

export interface Street {
  id: number;
  name: string;
  type: string; // residential, primary, secondary, etc.
  nodes: StreetNode[];
  // OSM-Tags für Korridorbreite und Höhenmodell. Nur gesetzt, wenn der Way
  // sie trägt (OsmStreetService); die meisten Ways haben keinen davon.
  /** `width` in Metern, nur wenn der Tag eine reine Zahl ist */
  width?: number;
  lanes?: number;
  /** yes, viaduct, ... (`no` wird nicht übernommen) */
  bridge?: string;
  /** yes, building_passage, culvert, ... */
  tunnel?: string;
  /** yes, arcade, ... */
  covered?: string;
  layer?: number;
}

export interface StreetNetwork {
  streets: Street[];
  nodes: Map<number, StreetNode>;
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

export interface NearestStreetPoint {
  street: Street;
  nodeIndex: number;
  distance: number;
}
