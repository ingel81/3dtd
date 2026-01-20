/**
 * DevWorld Building Presets
 *
 * Buildings are simple box meshes used as LOS blockers.
 * Position is in local coordinates (meters from origin).
 * Size is [width (X), height (Y), depth (Z)] in meters.
 *
 * Coordinate convention (same as EllipsoidSync):
 * - -X = East, +X = West
 * - +Z = North, -Z = South
 */

export interface BuildingConfig {
  id: string;
  position: { x: number; z: number };
  size: { width: number; height: number; depth: number };
  /** Optional rotation in radians */
  rotation?: number;
}

/**
 * Sparse preset: Buildings spread across 1km x 1km map
 * Good for basic LOS testing with clear sight lines
 */
export const BUILDINGS_SPARSE: BuildingConfig[] = [
  // Far north buildings
  { id: 'b1', position: { x: 150, z: 380 }, size: { width: 40, height: 20, depth: 35 } },
  { id: 'b2', position: { x: -150, z: 380 }, size: { width: 35, height: 18, depth: 30 } },

  // North-central area
  { id: 'b3', position: { x: 100, z: 220 }, size: { width: 30, height: 15, depth: 25 } },
  { id: 'b4', position: { x: -100, z: 220 }, size: { width: 30, height: 16, depth: 25 } },
  { id: 'b5', position: { x: 300, z: 220 }, size: { width: 35, height: 22, depth: 30 } },
  { id: 'b6', position: { x: -300, z: 220 }, size: { width: 35, height: 20, depth: 30 } },

  // Central area (around HQ)
  { id: 'b7', position: { x: 80, z: 50 }, size: { width: 25, height: 12, depth: 20 } },
  { id: 'b8', position: { x: -80, z: 50 }, size: { width: 25, height: 14, depth: 20 } },
  { id: 'b9', position: { x: 80, z: -50 }, size: { width: 25, height: 13, depth: 20 } },
  { id: 'b10', position: { x: -80, z: -50 }, size: { width: 25, height: 11, depth: 20 } },

  // South-central area
  { id: 'b11', position: { x: 100, z: -220 }, size: { width: 30, height: 15, depth: 25 } },
  { id: 'b12', position: { x: -100, z: -220 }, size: { width: 30, height: 17, depth: 25 } },
  { id: 'b13', position: { x: 300, z: -220 }, size: { width: 35, height: 19, depth: 30 } },
  { id: 'b14', position: { x: -300, z: -220 }, size: { width: 35, height: 21, depth: 30 } },

  // Far south buildings
  { id: 'b15', position: { x: 150, z: -380 }, size: { width: 40, height: 18, depth: 35 } },
  { id: 'b16', position: { x: -150, z: -380 }, size: { width: 35, height: 20, depth: 30 } },
];

/**
 * Dense preset: Many buildings for urban warfare, scaled for 1km map
 */
export const BUILDINGS_DENSE: BuildingConfig[] = [
  // Far north district (z = 350-400)
  { id: 'd1', position: { x: 300, z: 380 }, size: { width: 40, height: 25, depth: 35 } },
  { id: 'd2', position: { x: 150, z: 370 }, size: { width: 35, height: 22, depth: 30 } },
  { id: 'd3', position: { x: 0, z: 380 }, size: { width: 45, height: 28, depth: 40 } },
  { id: 'd4', position: { x: -150, z: 370 }, size: { width: 35, height: 20, depth: 30 } },
  { id: 'd5', position: { x: -300, z: 380 }, size: { width: 40, height: 24, depth: 35 } },

  // North district (z = 200-250)
  { id: 'd6', position: { x: 250, z: 220 }, size: { width: 35, height: 18, depth: 30 } },
  { id: 'd7', position: { x: 100, z: 230 }, size: { width: 30, height: 20, depth: 25 } },
  { id: 'd8', position: { x: -100, z: 230 }, size: { width: 30, height: 19, depth: 25 } },
  { id: 'd9', position: { x: -250, z: 220 }, size: { width: 35, height: 21, depth: 30 } },

  // Central north (z = 80-120)
  { id: 'd10', position: { x: 150, z: 100 }, size: { width: 25, height: 15, depth: 20 } },
  { id: 'd11', position: { x: 50, z: 90 }, size: { width: 28, height: 16, depth: 22 } },
  { id: 'd12', position: { x: -50, z: 90 }, size: { width: 28, height: 17, depth: 22 } },
  { id: 'd13', position: { x: -150, z: 100 }, size: { width: 25, height: 14, depth: 20 } },

  // Central south (z = -80 to -120)
  { id: 'd14', position: { x: 150, z: -100 }, size: { width: 25, height: 16, depth: 20 } },
  { id: 'd15', position: { x: 50, z: -90 }, size: { width: 28, height: 15, depth: 22 } },
  { id: 'd16', position: { x: -50, z: -90 }, size: { width: 28, height: 18, depth: 22 } },
  { id: 'd17', position: { x: -150, z: -100 }, size: { width: 25, height: 14, depth: 20 } },

  // South district (z = -200 to -250)
  { id: 'd18', position: { x: 250, z: -220 }, size: { width: 35, height: 19, depth: 30 } },
  { id: 'd19', position: { x: 100, z: -230 }, size: { width: 30, height: 17, depth: 25 } },
  { id: 'd20', position: { x: -100, z: -230 }, size: { width: 30, height: 20, depth: 25 } },
  { id: 'd21', position: { x: -250, z: -220 }, size: { width: 35, height: 18, depth: 30 } },

  // Far south district (z = -350 to -400)
  { id: 'd22', position: { x: 300, z: -380 }, size: { width: 40, height: 23, depth: 35 } },
  { id: 'd23', position: { x: 150, z: -370 }, size: { width: 35, height: 21, depth: 30 } },
  { id: 'd24', position: { x: 0, z: -380 }, size: { width: 45, height: 26, depth: 40 } },
  { id: 'd25', position: { x: -150, z: -370 }, size: { width: 35, height: 19, depth: 30 } },
  { id: 'd26', position: { x: -300, z: -380 }, size: { width: 40, height: 22, depth: 35 } },
];

/**
 * Maze preset: Long walls creating corridors, scaled for 1km map
 */
export const BUILDINGS_MAZE: BuildingConfig[] = [
  // Outer perimeter walls (with gaps at streets)
  { id: 'm1', position: { x: 420, z: 250 }, size: { width: 15, height: 18, depth: 300 } },
  { id: 'm2', position: { x: 420, z: -250 }, size: { width: 15, height: 18, depth: 300 } },
  { id: 'm3', position: { x: -420, z: 250 }, size: { width: 15, height: 18, depth: 300 } },
  { id: 'm4', position: { x: -420, z: -250 }, size: { width: 15, height: 18, depth: 300 } },

  // Horizontal maze walls
  { id: 'm5', position: { x: 200, z: 300 }, size: { width: 300, height: 15, depth: 12 } },
  { id: 'm6', position: { x: -200, z: 300 }, size: { width: 300, height: 15, depth: 12 } },
  { id: 'm7', position: { x: 150, z: 100 }, size: { width: 250, height: 12, depth: 10 } },
  { id: 'm8', position: { x: -150, z: 100 }, size: { width: 250, height: 12, depth: 10 } },
  { id: 'm9', position: { x: 150, z: -100 }, size: { width: 250, height: 12, depth: 10 } },
  { id: 'm10', position: { x: -150, z: -100 }, size: { width: 250, height: 12, depth: 10 } },
  { id: 'm11', position: { x: 200, z: -300 }, size: { width: 300, height: 15, depth: 12 } },
  { id: 'm12', position: { x: -200, z: -300 }, size: { width: 300, height: 15, depth: 12 } },

  // Vertical maze walls
  { id: 'm13', position: { x: 100, z: 200 }, size: { width: 12, height: 12, depth: 150 } },
  { id: 'm14', position: { x: -100, z: 200 }, size: { width: 12, height: 12, depth: 150 } },
  { id: 'm15', position: { x: 100, z: -200 }, size: { width: 12, height: 12, depth: 150 } },
  { id: 'm16', position: { x: -100, z: -200 }, size: { width: 12, height: 12, depth: 150 } },

  // Central obstacles
  { id: 'm17', position: { x: 50, z: 0 }, size: { width: 60, height: 12, depth: 60 } },
  { id: 'm18', position: { x: -50, z: 0 }, size: { width: 60, height: 12, depth: 60 } },

  // Chokepoint blockers
  { id: 'm19', position: { x: 300, z: 0 }, size: { width: 50, height: 18, depth: 100 } },
  { id: 'm20', position: { x: -300, z: 0 }, size: { width: 50, height: 18, depth: 100 } },
];

/**
 * No buildings preset (empty)
 */
export const BUILDINGS_NONE: BuildingConfig[] = [];

/**
 * Get building preset by name
 */
export function getBuildingPreset(name: string): BuildingConfig[] {
  switch (name) {
    case 'none':
      return BUILDINGS_NONE;
    case 'dense':
      return BUILDINGS_DENSE;
    case 'maze':
      return BUILDINGS_MAZE;
    case 'sparse':
    default:
      return BUILDINGS_SPARSE;
  }
}
