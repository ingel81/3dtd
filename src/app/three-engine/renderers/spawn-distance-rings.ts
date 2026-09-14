import { Group, type Vector2, type Vector3 } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';

/** What the rings need of the engine; ThreeTilesEngine has both. */
export interface RingGround {
  readonly sync: { geoToLocalSimple(lat: number, lon: number, height: number): Vector3 };
  getTerrainHeightAtGeo(lat: number, lon: number): number | null;
}

/** One ring: its radius around the centre and its colour. */
export interface DistanceRing {
  radiusM: number;
  color: number;
}

/** Points around a ring: at 1500 m some 98 m apart, the chord less than a metre off the circle */
const SEGMENTS = 96;
/** Lift above the ground sample so the line clears small bumps, m */
const LIFT_M = 2;
/** Dashes around every ring, whatever its size */
const DASHES = 48;
/** Share of a dash period that is dash */
const DASH_SHARE = 0.6;
/** Width of the coloured line and of the dark halo under it, CSS px */
const LINE_WIDTH_PX = 3;
const HALO_WIDTH_PX = 7;
/** --td-panel-shadow: keeps the line readable over bright concrete and dark trees alike */
const HALO_COLOR = 0x0b0f0c;
const HALO_OPACITY = 0.6;
/** Drawn after the tiles and the other overlays, the halo first */
const RENDER_ORDER = 998;

/**
 * Points of a circle of `radiusM` around `center`, in local coordinates as
 * flat [x, y, z, ...], closed (the last point repeats the first). Laid out
 * in geo space, like the distance the placement checks, each point on the
 * ground sample under it, on the centre's ground where no tile answers.
 */
export function groundCirclePositions(
  ground: RingGround,
  center: { lat: number; lon: number },
  radiusM: number,
): number[] {
  const fallbackY = ground.getTerrainHeightAtGeo(center.lat, center.lon) ?? 0;
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(center.lat * DEG_TO_RAD);
  const positions: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const angle = (i / SEGMENTS) * Math.PI * 2;
    const lat = center.lat + (radiusM * Math.cos(angle)) / METERS_PER_DEGREE_LAT;
    const lon = center.lon + (radiusM * Math.sin(angle)) / metersPerDegreeLon;
    const local = ground.sync.geoToLocalSimple(lat, lon, 0);
    const y = ground.getTerrainHeightAtGeo(lat, lon) ?? fallbackY;
    positions.push(local.x, y + LIFT_M, local.z);
  }
  positions.push(positions[0], positions[1], positions[2]);
  return positions;
}

/** Length of the polyline through flat [x, y, z, ...] positions. */
function pathLength(positions: readonly number[]): number {
  let length = 0;
  for (let i = 3; i < positions.length; i += 3) {
    length += Math.hypot(
      positions[i] - positions[i - 3],
      positions[i + 1] - positions[i - 2],
      positions[i + 2] - positions[i - 1],
    );
  }
  return length;
}

/**
 * The rings around the HQ while a spawn is placed (MapPlacementService):
 * the spawn has to stand between them.
 *
 * Each ring lies on the ground, one column sample per point, and is a
 * dashed line LINE_WIDTH_PX wide over a continuous dark halo: Line2,
 * because it keeps its pixel width at any distance. Depth test off, like
 * the ability markers: a ring runs through blocks of houses and has to
 * stay readable between them. LineMaterial writes logarithmic depth
 * (logdepthbuf chunks), the tiles ignore lights anyway.
 *
 * Until playtest 531 the rings were 1 px dashed lines 30 m above the
 * HQ's ground: hard to see, and at the default camera tilt (70 degrees
 * from the vertical, CAMERA_ANGLE) drawn some 80 m off the boundary they
 * mark.
 */
export class SpawnDistanceRings {
  readonly group = new Group();

  /**
   * @param resolution Size of the canvas in CSS px, for the pixel width
   */
  constructor(ground: RingGround, center: { lat: number; lon: number }, rings: readonly DistanceRing[], resolution: Vector2) {
    this.group.name = 'spawnDistanceRings';
    for (const ring of rings) {
      const positions = groundCirclePositions(ground, center, ring.radiusM);
      const period = pathLength(positions) / DASHES;
      this.group.add(
        this.line(positions, new LineMaterial({
          color: HALO_COLOR,
          linewidth: HALO_WIDTH_PX,
          transparent: true,
          opacity: HALO_OPACITY,
          depthTest: false,
          depthWrite: false,
          worldUnits: false,
          resolution,
        }), RENDER_ORDER),
        this.line(positions, new LineMaterial({
          color: ring.color,
          linewidth: LINE_WIDTH_PX,
          transparent: true,
          opacity: 1,
          depthTest: false,
          depthWrite: false,
          worldUnits: false,
          dashed: true,
          dashSize: period * DASH_SHARE,
          gapSize: period * (1 - DASH_SHARE),
          resolution,
        }), RENDER_ORDER + 1),
      );
    }
  }

  /** Free every line's geometry and material; the caller takes the group out of the scene. */
  dispose(): void {
    for (const child of this.group.children) {
      const line = child as Line2;
      line.geometry.dispose();
      line.material.dispose();
    }
    this.group.clear();
  }

  private line(positions: number[], material: LineMaterial, renderOrder: number): Line2 {
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    const line = new Line2(geometry, material);
    line.computeLineDistances(); // the dashes need them
    line.renderOrder = renderOrder;
    line.frustumCulled = false;
    return line;
  }
}
