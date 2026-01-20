/**
 * DevWorld Street Network Configuration
 *
 * Hardcoded street network for DevWorld.
 * Streets are defined as segments with start/end points in local coordinates.
 */

export interface StreetSegment {
  id: string;
  from: [number, number]; // [x, z] in meters
  to: [number, number];
  type: 'primary' | 'secondary' | 'residential';
}

/**
 * Street type weights for A* pathfinding
 * Lower = preferred
 */
export const STREET_TYPE_WEIGHTS: Record<string, number> = {
  primary: 1.0,
  secondary: 1.2,
  residential: 1.5,
};

/**
 * DevWorld street network layout (1000m x 1000m)
 *
 * Simple grid layout - all streets extend edge to edge
 * No diagonal shortcuts - clean intersections only
 *
 * Coordinate convention:
 * - -X = East, +X = West
 * - +Z = North, -Z = South
 *
 *     +400    +200      0     -200    -400
 *       │       │       │       │       │
 * +400 ─┼═══════╪═══════╪═══════╪═══════┼─ row-n2
 *       │       │       │       │       │
 * +200 ─┼═══════╪═══════╪═══════╪═══════┼─ row-n1
 *       │       │       │       │       │
 *   0  ─╪═══════╪═══════⬟═══════╪═══════╪═ row-m (HQ at center)
 *       │       │      HQ       │       │
 * -200 ─┼═══════╪═══════╪═══════╪═══════┼─ row-s1
 *       │       │       │       │       │
 * -400 ─┼═══════╪═══════╪═══════╪═══════┼─ row-s2
 *
 *     col-w2  col-w1  col-c  col-e1  col-e2
 */
export const DEV_STREETS: StreetSegment[] = [
  // ========================================
  // HORIZONTAL STREETS (Ost-West) - all primary
  // ========================================
  { id: 'row-n2', from: [480, 400], to: [-480, 400], type: 'primary' },
  { id: 'row-n1', from: [480, 200], to: [-480, 200], type: 'primary' },
  { id: 'row-m', from: [480, 0], to: [-480, 0], type: 'primary' },
  { id: 'row-s1', from: [480, -200], to: [-480, -200], type: 'primary' },
  { id: 'row-s2', from: [480, -400], to: [-480, -400], type: 'primary' },

  // ========================================
  // VERTICAL STREETS (Nord-Süd) - all primary
  // ========================================
  { id: 'col-w2', from: [400, 480], to: [400, -480], type: 'primary' },
  { id: 'col-w1', from: [200, 480], to: [200, -480], type: 'primary' },
  { id: 'col-c', from: [0, 480], to: [0, -480], type: 'primary' },
  { id: 'col-e1', from: [-200, 480], to: [-200, -480], type: 'primary' },
  { id: 'col-e2', from: [-400, 480], to: [-400, -480], type: 'primary' },
];

/**
 * Spawn point configurations
 */
export interface SpawnPointConfig {
  id: string;
  name: string;
  position: { x: number; z: number };
  /** Expected route description for debugging */
  description: string;
}

export const DEV_SPAWN_POINTS: SpawnPointConfig[] = [
  {
    id: 'north',
    name: 'North',
    position: { x: 200, z: 400 },  // Intersection col-w1 × row-n2
    description: 'Long route south through the city',
  },
  {
    id: 'south',
    name: 'South',
    position: { x: -200, z: -400 }, // Intersection col-e1 × row-s2
    description: 'Long route north through the city',
  },
  {
    id: 'east',
    name: 'East',
    position: { x: -400, z: 200 },  // Intersection col-e2 × row-n1
    description: 'Long route west through the city',
  },
  {
    id: 'west',
    name: 'West',
    position: { x: 400, z: -200 },  // Intersection col-w2 × row-s1
    description: 'Long route east through the city',
  },
];

/**
 * HQ position (enemy target)
 */
export const DEV_HQ_POSITION = { x: 0, z: 0 };
