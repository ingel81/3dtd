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

/** Width (m) of a brace across, about one stone. */
export const BRACE_WIDTH_M = 0.5;
/** Thickness (m) of a brace, at right angles to its slant. */
export const BRACE_THICKNESS_M = 0.45;
/** How steeply a brace falls towards the building: metres down per metre inwards, 1 = 45°. */
export const BRACE_SLOPE = 1;
/**
 * Top of a brace (local y), 0.2 m above the plinth's underside
 * (-PLINTH_EMBED_M): it reaches up into the plinth, the joint stays closed.
 */
export const BRACE_TOP_Y = -PLINTH_EMBED_M + 0.2;
/** Width (m) of a brace's horizontal top cut, from its thickness across the slant. */
export const BRACE_TOP_CUT_M = (BRACE_THICKNESS_M * Math.hypot(1, BRACE_SLOPE)) / BRACE_SLOPE;
/** Height (m) of a brace's vertical foot cut. */
const BRACE_FOOT_CUT_M = BRACE_THICKNESS_M * Math.hypot(1, BRACE_SLOPE);

/**
 * A diagonal stone brace under a plinth that hangs over a drop: from just
 * inside the wall under the rim down and inwards at BRACE_SLOPE into the
 * building below. plinthBraces (plinth-braces.ts) lays them out.
 */
export interface PlinthBrace {
  /** Direction from the plinth's axis (radians), the wall's theta: 0 = +x, π/2 = +z */
  angle: number;
  /** Distance (m) of its outer top edge from the axis, at BRACE_TOP_Y */
  topReach: number;
  /** Distance (m) of its foot from the axis, inside the roof's edge */
  footReach: number;
}

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
 * Distance (m) of the plinth wall from its axis at angle `theta` and height
 * `y` (see createPlinthGeometry): the top radius, the lean towards the foot
 * and the bulge.
 */
export function plinthWallRadius(footprintRadius: number, height: number, theta: number, y: number): number {
  const wallHeight = height + PLINTH_EMBED_M;
  const batter = Math.min(BATTER_PER_M * wallHeight, MAX_BATTER_M);
  const lean = batter * ((height - y) / wallHeight);
  return (footprintRadius + PLINTH_RIM_M + lean) * (1 + BULGE * bulge(theta, y));
}

/**
 * Wall and top face of a tower plinth: a round column, slightly battered
 * and bulging like stacked rubble, from y = -PLINTH_EMBED_M to y = `height`.
 * y = 0 is the lowest point of the footprint, y = `height` the tower's foot.
 * The top radius is `footprintRadius` + PLINTH_RIM_M. Open at the bottom,
 * which sits in the ground. The stones come from the material
 * (plinth-material.ts); the geometry has positions and normals only.
 *
 * With `braces` the plinth hangs over a drop somewhere: its bottom gets a
 * face, seen from below there, and the braces go under it. Each face of a
 * brace has vertices of its own, so its edges stay hard.
 */
export function createPlinthGeometry(
  footprintRadius: number,
  height: number,
  braces: readonly PlinthBrace[] = [],
): BufferGeometry {
  const topRadius = footprintRadius + PLINTH_RIM_M;
  const bottomY = -PLINTH_EMBED_M;
  const wallHeight = height - bottomY;

  const segments = Math.max(16, Math.ceil((2 * Math.PI * topRadius) / SEGMENT_M));
  const rows = Math.max(2, Math.ceil(wallHeight / SEGMENT_M));

  const positions: number[] = [];
  const indices: number[] = [];
  const ringPoint = (theta: number, y: number): [number, number, number] => {
    const r = plinthWallRadius(footprintRadius, height, theta, y);
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

  if (braces.length > 0) {
    // Bottom face the same way, turned down
    const bottomCenter = positions.length / 3;
    positions.push(0, bottomY, 0);
    for (let i = 0; i < segments; i++) {
      positions.push(...ringPoint((i / segments) * Math.PI * 2, bottomY));
    }
    for (let i = 0; i < segments; i++) {
      indices.push(bottomCenter, bottomCenter + 1 + i, bottomCenter + 1 + ((i + 1) % segments));
    }
    for (const brace of braces) {
      appendBrace(positions, indices, brace);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

type Point3 = readonly [number, number, number];

/**
 * A brace as a slanted stone prism, BRACE_WIDTH_M across. Its side profile
 * runs from the outer top edge under the rim down the underside to the
 * foot, up the vertical foot cut, back up the inner edge and along the
 * horizontal top cut. Six faces.
 */
function appendBrace(positions: number[], indices: number[], brace: PlinthBrace): void {
  const ux = Math.cos(brace.angle);
  const uz = Math.sin(brace.angle);
  const half = BRACE_WIDTH_M / 2;
  const footY = BRACE_TOP_Y - (brace.topReach - brace.footReach) * BRACE_SLOPE;
  // Side profile as (distance from the axis, y): outer top, foot below, foot above, inner top
  const profile: readonly (readonly [number, number])[] = [
    [brace.topReach, BRACE_TOP_Y],
    [brace.footReach, footY],
    [brace.footReach, footY + BRACE_FOOT_CUT_M],
    [brace.topReach - BRACE_TOP_CUT_M, BRACE_TOP_Y],
  ];
  // Corner k of the profile on side `side` (-1 or 1) across the brace
  const corner = (k: number, side: number): Point3 => {
    const [reach, y] = profile[k];
    return [ux * reach - uz * half * side, y, uz * reach + ux * half * side];
  };

  // Its middle: every face turns away from it
  const midReach = (profile[0][0] + profile[1][0] + profile[2][0] + profile[3][0]) / 4;
  const midY = (profile[0][1] + profile[1][1] + profile[2][1] + profile[3][1]) / 4;
  const middle: Point3 = [ux * midReach, midY, uz * midReach];

  for (const side of [-1, 1]) {
    appendQuad(positions, indices, [corner(0, side), corner(1, side), corner(2, side), corner(3, side)], middle);
  }
  for (let k = 0; k < 4; k++) {
    const next = (k + 1) % 4;
    appendQuad(positions, indices, [corner(k, -1), corner(next, -1), corner(next, 1), corner(k, 1)], middle);
  }
}

/** A flat quad with vertices of its own, its front turned away from `inside`. */
function appendQuad(positions: number[], indices: number[], quad: readonly Point3[], inside: Point3): void {
  const [a, b, c] = quad;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  let outward = 0;
  for (let axis = 0; axis < 3; axis++) {
    const centre = (quad[0][axis] + quad[1][axis] + quad[2][axis] + quad[3][axis]) / 4;
    outward += normal[axis] * (centre - inside[axis]);
  }

  const base = positions.length / 3;
  for (const p of quad) positions.push(p[0], p[1], p[2]);
  if (outward > 0) {
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  } else {
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}
