import {
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';
import { getAirTargetY, GlobalRouteGrid } from './global-route-grid';

/**
 * Debug overlay: a magenta tube along every enemy route at the air
 * flight altitude (= `getAirTargetY(cell)` = `cell.terrainHeight +
 * airSampleYOffset`). Shows the user "where air enemies actually fly"
 * without placing a tower.
 *
 * Implemented as a chain of short instanced cylinders along the route
 * — a robust polyline that, unlike a spline-based TubeGeometry, never
 * overshoots between waypoints with different Y values. The fragment
 * shader applies a longitudinal dash pattern so the tube reads as
 * "path", not "wall", and the magenta colour stays distinct from the
 * 4-state LOS palette (green/cyan/gold/red).
 */
export function buildRouteAltitudeTubes(grid: GlobalRouteGrid): Group {
  const cfg = LOS_VIZ_CONFIG.airRouteTube;

  const group = new Group();
  group.name = 'AirRouteTube';

  const sync = grid.getCoordinateSync();
  if (!sync) return group;

  const routes = grid.getCachedRoutes();
  if (routes.length === 0) return group;

  // One material — depthTest:false so the tube renders on top of world
  // geometry; the dash modulation lives in the fragment shader (uses
  // local Y along each unit-cylinder, which the InstanceMatrix scales
  // to segment length in world units).
  const material = new ShaderMaterial({
    uniforms: {
      uColor:      { value: cfg.color },
      uFrequency:  { value: cfg.dashFrequency },
      uDuty:       { value: cfg.dashDuty },
      uOpacityOn:  { value: cfg.opacityOn },
      uOpacityOff: { value: cfg.opacityOff },
    },
    vertexShader: /* glsl */ `
      attribute float aSegLength;
      varying float vLengthAlong;
      void main() {
        // Unit cylinder is built along +Y, length 1 → instanceMatrix
        // scales Y to segment-length. position.y is in [-0.5, +0.5]
        // BEFORE the scale, so (position.y + 0.5) * segLen gives the
        // world-space length along the tube for the dash modulation.
        vLengthAlong = (position.y + 0.5) * aSegLength;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3  uColor;
      uniform float uFrequency;
      uniform float uDuty;
      uniform float uOpacityOn;
      uniform float uOpacityOff;
      varying float vLengthAlong;
      void main() {
        float phase = fract(vLengthAlong * uFrequency);
        float onMask = step(phase, uDuty);
        float opacity = mix(uOpacityOff, uOpacityOn, onMask);
        gl_FragColor = vec4(uColor, opacity);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });

  // Collect per-route polyline, then build the instanced cylinder chain
  // in one draw call.
  const polylines: Vector3[][] = [];
  for (const route of routes) {
    if (route.length < 2) continue;

    const pts: Vector3[] = [];

    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i];
      const b = route[i + 1];
      const aLocal = sync.geoToLocalSimple(a.lat, a.lon, a.height ?? 0);
      const bLocal = sync.geoToLocalSimple(b.lat, b.lon, b.height ?? 0);
      for (let s = 0; s < cfg.samplesPerWaypoint; s++) {
        const t = s / cfg.samplesPerWaypoint;
        const x = aLocal.x + (bLocal.x - aLocal.x) * t;
        const z = aLocal.z + (bLocal.z - aLocal.z) * t;
        addSample(x, z, aLocal.y);
      }
    }
    const last = route[route.length - 1];
    const lastLocal = sync.geoToLocalSimple(last.lat, last.lon, last.height ?? 0);
    addSample(lastLocal.x, lastLocal.z, lastLocal.y);

    if (pts.length >= 2) polylines.push(pts);

    function addSample(x: number, z: number, fallbackY: number): void {
      const cell = grid.getCellAt(x, z);
      let targetY: number;
      if (cell && cell.heightSampled) {
        // Reliable: cell has a real terrain raycast.
        targetY = getAirTargetY(cell);
      } else {
        // Cell missing (endpoint past corridor) or unsampled (tile-gap /
        // pre-streaming race). Reading `cell.terrainHeight` here would
        // yield `routeAnchorY`, which is often 0 on height-less routes —
        // producing a 165m downward kink in the tube. Interpolate from
        // sampled neighbours instead; only if no neighbour exists do we
        // fall back to the polyline Y.
        const interpolated = grid.estimateTerrainY(x, z);
        targetY = (interpolated ?? fallbackY) + LOS_VIZ_CONFIG.airSampleYOffset;
      }
      pts.push(new Vector3(x, targetY, z));
    }
  }

  buildPolylineInstanced(group, polylines, cfg.radius, material, /* renderOrder */ 5);
  return group;
}

/**
 * Build one InstancedMesh of short cylinders covering every segment of
 * every polyline — single draw call. Each instance carries an
 * `aSegLength` attribute so the fragment shader can modulate the dash
 * pattern by world-distance, not by uv.
 */
function buildPolylineInstanced(
  parent: Group,
  polylines: Vector3[][],
  radius: number,
  material: ShaderMaterial,
  renderOrder: number,
): void {
  let totalSegments = 0;
  for (const pl of polylines) totalSegments += pl.length - 1;
  if (totalSegments === 0) return;

  // Unit cylinder along +Y of length 1 — instance matrix scales/rotates
  // it into each segment.
  const geo = new CylinderGeometry(radius, radius, 1, 8, 1, false);
  const segLengths = new Float32Array(totalSegments);
  const mesh = new InstancedMesh(geo, material, totalSegments);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.name = 'AirRouteTube.segments';

  const tmpMat = new Matrix4();
  const tmpScale = new Vector3();
  const tmpQuat = new Quaternion();
  const tmpPos = new Vector3();
  const up = new Vector3(0, 1, 0);
  const dir = new Vector3();

  let idx = 0;
  for (const pl of polylines) {
    for (let i = 0; i < pl.length - 1; i++) {
      const a = pl[i];
      const b = pl[i + 1];
      dir.copy(b).sub(a);
      const len = dir.length();
      if (len < 1e-4) continue;
      dir.divideScalar(len);

      tmpPos.copy(a).add(b).multiplyScalar(0.5);
      tmpScale.set(1, len, 1);
      tmpQuat.setFromUnitVectors(up, dir);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      mesh.setMatrixAt(idx, tmpMat);
      segLengths[idx] = len;
      idx++;
    }
  }
  mesh.count = idx;
  mesh.instanceMatrix.needsUpdate = true;

  // Attach per-instance segment length so the fragment shader can
  // modulate the dash pattern in world units rather than UV.
  const segLengthAttr = new InstancedBufferAttribute(segLengths, 1);
  geo.setAttribute('aSegLength', segLengthAttr);

  parent.add(mesh);
}

/**
 * Convenience: dispose a tube-group's GPU resources. The material is
 * shared across all instances — dispose it once at the group level.
 */
export function disposeRouteAltitudeTubes(group: Group): void {
  const disposedMaterials = new Set<ShaderMaterial>();
  group.traverse(obj => {
    const m = obj as InstancedMesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (mat instanceof ShaderMaterial && !disposedMaterials.has(mat)) {
          mat.dispose();
          disposedMaterials.add(mat);
        }
      }
    }
  });
  group.removeFromParent();
}
