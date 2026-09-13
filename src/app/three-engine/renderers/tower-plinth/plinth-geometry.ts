import { BufferGeometry, Float32BufferAttribute } from 'three';

/**
 * How far (m) the plinth reaches below the lowest footprint probe: the
 * ground between the probes may lie a little lower.
 */
export const PLINTH_EMBED_M = 0.4;

/** Plinth radius beyond the footprint (m), so the corners of a square base stay on it. */
export const PLINTH_RIM_M = 0.2;

/** The wall leans out towards the foot like a rubble wall, this much per metre of height. */
const BATTER_PER_M = 0.05;
/** Upper limit of that lean (m). */
const MAX_BATTER_M = 0.5;
/** Target edge length (m) of the wall grid, around and up. */
const SEGMENT_M = 0.5;
/** Largest bulge of the wall, as a share of the radius. */
const BULGE = 0.025;

/**
 * Bulge of the wall at angle `theta` and height `y`, -1..1. Integer
 * frequencies in theta keep it periodic, so the ring closes without a seam.
 */
function bulge(theta: number, y: number): number {
  return 0.5 * Math.sin(3 * theta + 1.3 + 0.9 * y)
    + 0.3 * Math.sin(7 * theta + 0.4 - 1.7 * y)
    + 0.2 * Math.sin(13 * theta + 2.1 + 2.3 * y);
}

/**
 * Wall and top face of a tower plinth: a round column, slightly battered
 * and bulging like stacked rubble, from y = -PLINTH_EMBED_M to y = `height`.
 * y = 0 is the lowest point of the footprint, y = `height` the tower's foot.
 * The top radius is `footprintRadius` + PLINTH_RIM_M. Open at the bottom,
 * which sits in the ground. The stones come from the material
 * (plinth-material.ts); the geometry has positions and normals only.
 */
export function createPlinthGeometry(footprintRadius: number, height: number): BufferGeometry {
  const topRadius = footprintRadius + PLINTH_RIM_M;
  const bottomY = -PLINTH_EMBED_M;
  const wallHeight = height - bottomY;
  const batter = Math.min(BATTER_PER_M * wallHeight, MAX_BATTER_M);

  const segments = Math.max(16, Math.ceil((2 * Math.PI * topRadius) / SEGMENT_M));
  const rows = Math.max(2, Math.ceil(wallHeight / SEGMENT_M));

  const positions: number[] = [];
  const indices: number[] = [];
  const ringPoint = (theta: number, y: number): [number, number, number] => {
    const lean = batter * ((height - y) / wallHeight);
    const r = (topRadius + lean) * (1 + BULGE * bulge(theta, y));
    return [Math.cos(theta) * r, y, Math.sin(theta) * r];
  };

  // Wall: rows + 1 rings from the bottom up, `segments` vertices each, the
  // last one joined to the first.
  for (let j = 0; j <= rows; j++) {
    const y = bottomY + (wallHeight * j) / rows;
    for (let i = 0; i < segments; i++) {
      positions.push(...ringPoint((i / segments) * Math.PI * 2, y));
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * segments + i;
      const b = j * segments + ((i + 1) % segments);
      const c = b + segments;
      const d = a + segments;
      // Counter-clockwise seen from outside
      indices.push(a, c, b, a, d, c);
    }
  }

  // Top face: its own vertices, so the edge to the wall stays hard.
  const center = positions.length / 3;
  positions.push(0, height, 0);
  for (let i = 0; i < segments; i++) {
    positions.push(...ringPoint((i / segments) * Math.PI * 2, height));
  }
  for (let i = 0; i < segments; i++) {
    // Counter-clockwise seen from above
    indices.push(center, center + 1 + ((i + 1) % segments), center + 1 + i);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
