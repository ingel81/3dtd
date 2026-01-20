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
 * Larger buildings, moderate coverage
 */
export const BUILDINGS_SPARSE: BuildingConfig[] = [
  // Far north - large warehouses
  { id: 'b1', position: { x: 150, z: 350 }, size: { width: 60, height: 25, depth: 50 } },
  { id: 'b2', position: { x: -150, z: 350 }, size: { width: 55, height: 22, depth: 45 } },
  { id: 'b3', position: { x: 350, z: 350 }, size: { width: 50, height: 30, depth: 45 } },
  { id: 'b4', position: { x: -350, z: 350 }, size: { width: 50, height: 28, depth: 45 } },

  // North-central - office blocks
  { id: 'b5', position: { x: 100, z: 150 }, size: { width: 45, height: 35, depth: 40 } },
  { id: 'b6', position: { x: -100, z: 150 }, size: { width: 45, height: 32, depth: 40 } },
  { id: 'b7', position: { x: 300, z: 150 }, size: { width: 55, height: 28, depth: 50 } },
  { id: 'b8', position: { x: -300, z: 150 }, size: { width: 55, height: 30, depth: 50 } },

  // Central area - mixed use (around HQ at 0,0)
  { id: 'b9', position: { x: 100, z: 50 }, size: { width: 40, height: 20, depth: 35 } },
  { id: 'b10', position: { x: -100, z: 50 }, size: { width: 40, height: 22, depth: 35 } },
  { id: 'b11', position: { x: 100, z: -50 }, size: { width: 40, height: 18, depth: 35 } },
  { id: 'b12', position: { x: -100, z: -50 }, size: { width: 40, height: 24, depth: 35 } },

  // South-central - industrial
  { id: 'b13', position: { x: 100, z: -150 }, size: { width: 50, height: 20, depth: 45 } },
  { id: 'b14', position: { x: -100, z: -150 }, size: { width: 50, height: 22, depth: 45 } },
  { id: 'b15', position: { x: 300, z: -150 }, size: { width: 60, height: 25, depth: 55 } },
  { id: 'b16', position: { x: -300, z: -150 }, size: { width: 60, height: 28, depth: 55 } },

  // Far south - large factories
  { id: 'b17', position: { x: 150, z: -350 }, size: { width: 70, height: 22, depth: 60 } },
  { id: 'b18', position: { x: -150, z: -350 }, size: { width: 65, height: 25, depth: 55 } },
  { id: 'b19', position: { x: 350, z: -350 }, size: { width: 55, height: 30, depth: 50 } },
  { id: 'b20', position: { x: -350, z: -350 }, size: { width: 55, height: 26, depth: 50 } },

  // Extra corner buildings
  { id: 'b21', position: { x: 350, z: 100 }, size: { width: 45, height: 35, depth: 40 } },
  { id: 'b22', position: { x: -350, z: 100 }, size: { width: 45, height: 32, depth: 40 } },
  { id: 'b23', position: { x: 350, z: -100 }, size: { width: 45, height: 30, depth: 40 } },
  { id: 'b24', position: { x: -350, z: -100 }, size: { width: 45, height: 28, depth: 40 } },
];

/**
 * Dense preset: Many buildings for urban warfare
 * Tall skyscrapers and dense city blocks
 */
export const BUILDINGS_DENSE: BuildingConfig[] = [
  // Far north district - industrial zone
  { id: 'd1', position: { x: 350, z: 350 }, size: { width: 60, height: 35, depth: 55 } },
  { id: 'd2', position: { x: 200, z: 350 }, size: { width: 50, height: 40, depth: 45 } },
  { id: 'd3', position: { x: 50, z: 350 }, size: { width: 55, height: 45, depth: 50 } },
  { id: 'd4', position: { x: -50, z: 350 }, size: { width: 55, height: 42, depth: 50 } },
  { id: 'd5', position: { x: -200, z: 350 }, size: { width: 50, height: 38, depth: 45 } },
  { id: 'd6', position: { x: -350, z: 350 }, size: { width: 60, height: 36, depth: 55 } },

  // North district - office towers
  { id: 'd7', position: { x: 300, z: 200 }, size: { width: 45, height: 50, depth: 40 } },
  { id: 'd8', position: { x: 150, z: 200 }, size: { width: 40, height: 55, depth: 35 } },
  { id: 'd9', position: { x: 50, z: 200 }, size: { width: 42, height: 48, depth: 38 } },
  { id: 'd10', position: { x: -50, z: 200 }, size: { width: 42, height: 52, depth: 38 } },
  { id: 'd11', position: { x: -150, z: 200 }, size: { width: 40, height: 46, depth: 35 } },
  { id: 'd12', position: { x: -300, z: 200 }, size: { width: 45, height: 54, depth: 40 } },

  // Central north - commercial
  { id: 'd13', position: { x: 250, z: 100 }, size: { width: 35, height: 30, depth: 30 } },
  { id: 'd14', position: { x: 100, z: 100 }, size: { width: 38, height: 35, depth: 32 } },
  { id: 'd15', position: { x: -100, z: 100 }, size: { width: 38, height: 32, depth: 32 } },
  { id: 'd16', position: { x: -250, z: 100 }, size: { width: 35, height: 28, depth: 30 } },

  // Central - downtown skyscrapers
  { id: 'd17', position: { x: 150, z: 0 }, size: { width: 35, height: 60, depth: 30 } },
  { id: 'd18', position: { x: -150, z: 0 }, size: { width: 35, height: 65, depth: 30 } },
  { id: 'd19', position: { x: 300, z: 0 }, size: { width: 40, height: 45, depth: 35 } },
  { id: 'd20', position: { x: -300, z: 0 }, size: { width: 40, height: 48, depth: 35 } },

  // Central south
  { id: 'd21', position: { x: 250, z: -100 }, size: { width: 35, height: 32, depth: 30 } },
  { id: 'd22', position: { x: 100, z: -100 }, size: { width: 38, height: 28, depth: 32 } },
  { id: 'd23', position: { x: -100, z: -100 }, size: { width: 38, height: 34, depth: 32 } },
  { id: 'd24', position: { x: -250, z: -100 }, size: { width: 35, height: 30, depth: 30 } },

  // South district
  { id: 'd25', position: { x: 300, z: -200 }, size: { width: 45, height: 42, depth: 40 } },
  { id: 'd26', position: { x: 150, z: -200 }, size: { width: 40, height: 38, depth: 35 } },
  { id: 'd27', position: { x: 50, z: -200 }, size: { width: 42, height: 44, depth: 38 } },
  { id: 'd28', position: { x: -50, z: -200 }, size: { width: 42, height: 40, depth: 38 } },
  { id: 'd29', position: { x: -150, z: -200 }, size: { width: 40, height: 46, depth: 35 } },
  { id: 'd30', position: { x: -300, z: -200 }, size: { width: 45, height: 36, depth: 40 } },

  // Far south district
  { id: 'd31', position: { x: 350, z: -350 }, size: { width: 60, height: 30, depth: 55 } },
  { id: 'd32', position: { x: 200, z: -350 }, size: { width: 50, height: 35, depth: 45 } },
  { id: 'd33', position: { x: 50, z: -350 }, size: { width: 55, height: 38, depth: 50 } },
  { id: 'd34', position: { x: -50, z: -350 }, size: { width: 55, height: 40, depth: 50 } },
  { id: 'd35', position: { x: -200, z: -350 }, size: { width: 50, height: 32, depth: 45 } },
  { id: 'd36', position: { x: -350, z: -350 }, size: { width: 60, height: 34, depth: 55 } },

  // Extra fill buildings
  { id: 'd37', position: { x: 380, z: 280 }, size: { width: 35, height: 25, depth: 30 } },
  { id: 'd38', position: { x: -380, z: 280 }, size: { width: 35, height: 28, depth: 30 } },
  { id: 'd39', position: { x: 380, z: -280 }, size: { width: 35, height: 26, depth: 30 } },
  { id: 'd40', position: { x: -380, z: -280 }, size: { width: 35, height: 24, depth: 30 } },
];

/**
 * Maze preset: Long walls creating corridors
 */
export const BUILDINGS_MAZE: BuildingConfig[] = [
  // Outer perimeter walls (with gaps at streets)
  { id: 'm1', position: { x: 420, z: 250 }, size: { width: 20, height: 25, depth: 300 } },
  { id: 'm2', position: { x: 420, z: -250 }, size: { width: 20, height: 25, depth: 300 } },
  { id: 'm3', position: { x: -420, z: 250 }, size: { width: 20, height: 25, depth: 300 } },
  { id: 'm4', position: { x: -420, z: -250 }, size: { width: 20, height: 25, depth: 300 } },

  // Horizontal maze walls - north
  { id: 'm5', position: { x: 200, z: 300 }, size: { width: 300, height: 20, depth: 15 } },
  { id: 'm6', position: { x: -200, z: 300 }, size: { width: 300, height: 20, depth: 15 } },

  // Inner horizontal walls
  { id: 'm7', position: { x: 150, z: 150 }, size: { width: 250, height: 18, depth: 12 } },
  { id: 'm8', position: { x: -150, z: 150 }, size: { width: 250, height: 18, depth: 12 } },
  { id: 'm9', position: { x: 150, z: -150 }, size: { width: 250, height: 18, depth: 12 } },
  { id: 'm10', position: { x: -150, z: -150 }, size: { width: 250, height: 18, depth: 12 } },

  // Horizontal maze walls - south
  { id: 'm11', position: { x: 200, z: -300 }, size: { width: 300, height: 20, depth: 15 } },
  { id: 'm12', position: { x: -200, z: -300 }, size: { width: 300, height: 20, depth: 15 } },

  // Vertical maze walls
  { id: 'm13', position: { x: 100, z: 225 }, size: { width: 15, height: 18, depth: 150 } },
  { id: 'm14', position: { x: -100, z: 225 }, size: { width: 15, height: 18, depth: 150 } },
  { id: 'm15', position: { x: 100, z: -225 }, size: { width: 15, height: 18, depth: 150 } },
  { id: 'm16', position: { x: -100, z: -225 }, size: { width: 15, height: 18, depth: 150 } },

  // Central blockers - larger
  { id: 'm17', position: { x: 80, z: 0 }, size: { width: 80, height: 22, depth: 80 } },
  { id: 'm18', position: { x: -80, z: 0 }, size: { width: 80, height: 22, depth: 80 } },

  // Chokepoint blockers
  { id: 'm19', position: { x: 300, z: 50 }, size: { width: 60, height: 25, depth: 120 } },
  { id: 'm20', position: { x: -300, z: 50 }, size: { width: 60, height: 25, depth: 120 } },
  { id: 'm21', position: { x: 300, z: -50 }, size: { width: 60, height: 25, depth: 120 } },
  { id: 'm22', position: { x: -300, z: -50 }, size: { width: 60, height: 25, depth: 120 } },

  // Corner structures
  { id: 'm23', position: { x: 350, z: 350 }, size: { width: 70, height: 30, depth: 70 } },
  { id: 'm24', position: { x: -350, z: 350 }, size: { width: 70, height: 30, depth: 70 } },
  { id: 'm25', position: { x: 350, z: -350 }, size: { width: 70, height: 30, depth: 70 } },
  { id: 'm26', position: { x: -350, z: -350 }, size: { width: 70, height: 30, depth: 70 } },
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
