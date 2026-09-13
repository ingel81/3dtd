import {
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';

/**
 * The overlays ThreeTowerRenderer puts around a tower besides its model:
 * the range indicator (disc and gold edge) and the debug markers for the
 * shoot height and the LOS origin.
 */

/**
 * Function type for direct terrain raycasting at local coordinates.
 * More accurate than TerrainHeightSampler — uses actual mesh intersection.
 */
export type TerrainRaycaster = (localX: number, localZ: number) => number | null;

// Configuration for terrain-conforming range indicator
const RANGE_SEGMENTS = 48; // Number of segments around the circle
const RANGE_RINGS = 8; // Number of concentric rings

/**
 * Create a terrain-conforming range indicator disc with visible edge
 * Uses direct raycasting for accurate terrain conformance
 *
 * @param range Radius in metres
 * @param localCenter Tower position at terrain level
 * @param rangeMaterial Fill of the disc, shared by all towers of a renderer
 * @param terrainRaycaster Terrain probe; without one the disc lies flat
 */
export function createRangeIndicator(
  range: number,
  localCenter: Vector3,
  rangeMaterial: MeshBasicMaterial,
  terrainRaycaster: TerrainRaycaster | null,
): Mesh {
  // If no raycaster available, use simple flat circle with edge
  if (!terrainRaycaster) {
    const group = new Group() as unknown as Mesh;

    // Filled disc
    const discGeometry = new CircleGeometry(range, RANGE_SEGMENTS);
    const discMesh = new Mesh(discGeometry, rangeMaterial);
    discMesh.rotation.x = -Math.PI / 2;
    group.add(discMesh);

    // Edge ring (gold border)
    const edgeGeometry = new RingGeometry(range - 2, range, RANGE_SEGMENTS);
    const edgeMaterial = new MeshBasicMaterial({
      color: 0xc9a44c, // TD gold
      transparent: true,
      opacity: 0.7,
      side: DoubleSide,
      depthWrite: false,
    });
    const edgeMesh = new Mesh(edgeGeometry, edgeMaterial);
    edgeMesh.rotation.x = -Math.PI / 2;
    edgeMesh.position.y = 0.1; // Slightly above disc
    group.add(edgeMesh);

    group.position.copy(localCenter);
    group.position.y += 0.5;
    return group;
  }

  // Create terrain-conforming group with disc and edge rings using raycasting
  const group = new Group() as unknown as Mesh;

  // Create terrain-conforming disc geometry using direct raycasts
  const geometry = createTerrainDiscGeometryRaycast(terrainRaycaster, localCenter.x, localCenter.z, range);

  const discMesh = new Mesh(geometry, rangeMaterial);
  discMesh.renderOrder = 1;
  group.add(discMesh);

  // Create terrain-following edge rings using raycasting
  const edgePoints = createTerrainEdgePointsRaycast(terrainRaycaster, localCenter.x, localCenter.z, range);

  if (edgePoints.length > 0) {
    // Gold edge at the range boundary
    const edgeGeometry = new BufferGeometry().setFromPoints([...edgePoints, edgePoints[0]]);
    const edgeMaterial = new LineBasicMaterial({
      color: 0xc9a44c, // TD gold
      linewidth: 2,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    const edgeLine = new Line(edgeGeometry, edgeMaterial);
    edgeLine.renderOrder = 2;
    group.add(edgeLine);
  }

  return group;
}

/**
 * Create terrain-following edge points using direct raycasting
 * Much more accurate than geo-coordinate based sampling
 */
function createTerrainEdgePointsRaycast(
  terrainRaycaster: TerrainRaycaster,
  centerX: number,
  centerZ: number,
  radius: number
): Vector3[] {
  const EDGE_OFFSET = 2.0; // Height above terrain for visibility
  const points: Vector3[] = [];

  for (let seg = 0; seg < RANGE_SEGMENTS; seg++) {
    const angle = (seg / RANGE_SEGMENTS) * Math.PI * 2;

    // Local offset from center
    const dx = Math.cos(angle) * radius;
    const dz = Math.sin(angle) * radius;

    // World position (note: Z is flipped in local coords)
    const worldX = centerX + dx;
    const worldZ = centerZ - dz;

    // Raycast to get actual terrain height at this position
    const terrainY = terrainRaycaster(worldX, worldZ);

    if (terrainY !== null) {
      points.push(new Vector3(worldX, terrainY + EDGE_OFFSET, worldZ));
    }
  }

  return points;
}

/**
 * Create disc geometry using direct raycasting for terrain conformance
 * Each vertex is placed exactly on the terrain surface via raycasting
 */
function createTerrainDiscGeometryRaycast(
  terrainRaycaster: TerrainRaycaster,
  centerX: number,
  centerZ: number,
  range: number
): BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];

  // Small offset above terrain for visibility
  const TERRAIN_OFFSET = 1.5;

  // Get center terrain height via raycast
  const centerY = terrainRaycaster(centerX, centerZ);
  if (centerY === null) {
    // Fallback to flat circle if center raycast fails
    return new CircleGeometry(range, RANGE_SEGMENTS);
  }

  // Add center vertex
  vertices.push(centerX, centerY + TERRAIN_OFFSET, centerZ);

  // Sample points in concentric rings
  for (let ring = 1; ring <= RANGE_RINGS; ring++) {
    const ringRadius = (range * ring) / RANGE_RINGS;

    for (let seg = 0; seg < RANGE_SEGMENTS; seg++) {
      const angle = (seg / RANGE_SEGMENTS) * Math.PI * 2;

      // Local offset from center
      const dx = Math.cos(angle) * ringRadius;
      const dz = Math.sin(angle) * ringRadius;

      // World position (note: Z is flipped in local coords)
      const worldX = centerX + dx;
      const worldZ = centerZ - dz;

      // Raycast to get actual terrain height
      const terrainY = terrainRaycaster(worldX, worldZ);
      const worldY = terrainY !== null ? terrainY + TERRAIN_OFFSET : centerY + TERRAIN_OFFSET;

      vertices.push(worldX, worldY, worldZ);
    }
  }

  // Create triangles
  // Center to first ring
  for (let seg = 0; seg < RANGE_SEGMENTS; seg++) {
    const next = (seg + 1) % RANGE_SEGMENTS;
    indices.push(0, 1 + seg, 1 + next);
  }

  // Between rings
  for (let ring = 1; ring < RANGE_RINGS; ring++) {
    const innerOffset = 1 + (ring - 1) * RANGE_SEGMENTS;
    const outerOffset = 1 + ring * RANGE_SEGMENTS;

    for (let seg = 0; seg < RANGE_SEGMENTS; seg++) {
      const nextSeg = (seg + 1) % RANGE_SEGMENTS;

      // Two triangles per quad
      indices.push(
        innerOffset + seg,
        outerOffset + seg,
        outerOffset + nextSeg
      );
      indices.push(
        innerOffset + seg,
        outerOffset + nextSeg,
        innerOffset + nextSeg
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

/** Tip marker: magenta sphere at the tower's shoot position (projectile origin). */
export function createTipMarker(x: number, tipY: number, z: number, visible: boolean): Mesh {
  const tipMarkerGeometry = new SphereGeometry(2, 16, 16);
  const tipMarkerMaterial = new MeshBasicMaterial({
    color: 0xff00ff, // Magenta
    transparent: true,
    opacity: 0.5, // Semi-transparent so tower is visible
    depthTest: false, // Always visible, even inside tower mesh
  });
  const tipMarker = new Mesh(tipMarkerGeometry, tipMarkerMaterial);
  tipMarker.position.set(x, tipY, z);
  tipMarker.renderOrder = 999; // Render on top
  tipMarker.visible = visible;
  return tipMarker;
}

/** LOS ring: cyan circle of `radius` at the shoot height, where LOS raycasts originate. */
export function createLosRing(x: number, tipY: number, z: number, radius: number, visible: boolean): LineLoop {
  const losRingPoints: Vector3[] = [];
  const losRingSegments = 32;
  for (let i = 0; i <= losRingSegments; i++) {
    const angle = (i / losRingSegments) * Math.PI * 2;
    losRingPoints.push(new Vector3(
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius
    ));
  }
  const losRingGeometry = new BufferGeometry().setFromPoints(losRingPoints);
  const losRingMaterial = new LineBasicMaterial({
    color: 0x00ffff, // Cyan
    depthTest: false,
  });
  const losRing = new LineLoop(losRingGeometry, losRingMaterial);
  losRing.position.set(x, tipY, z);
  losRing.renderOrder = 999;
  losRing.visible = visible;
  return losRing;
}
