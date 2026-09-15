import {
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  StaticDrawUsage,
} from 'three';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';
import { CELL_VIZ_Y_OFFSET_M } from './route-grid-aggregate-viz';

/** A grid spot to frame: its centre and the height to draw it at. */
export interface FramedCellSpot {
  x: number;
  y: number;
  z: number;
}

/** Instances the mesh starts with; it grows when a selection needs more. */
const INITIAL_CAPACITY = 32;

const SELECTION_VERTEX = /* glsl */ `
varying vec2 vPlate;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vPlate = position.xz;

  vec4 localPos = vec4(position, 1.0);

  #ifdef USE_INSTANCING
    localPos = instanceMatrix * localPos;
  #endif

  vec4 worldPos = modelMatrix * localPos;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
  #include <logdepthbuf_vertex>
}
`;

function buildSelectionFragment(): string {
  const s = LOS_VIZ_CONFIG.gridOverlay.selection;
  return /* glsl */ `
precision highp float;
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uHalfSize;
uniform vec3 uColor;
varying vec2 vPlate;

void main() {
  #include <logdepthbuf_fragment>
  // Frame at the edge of the cell, borderWidthMeters wide but never
  // narrower than 3 pixels, over a faint fill.
  float toEdge = uHalfSize - max(abs(vPlate.x), abs(vPlate.y));
  float alpha = toEdge < max(${s.borderWidthMeters.toFixed(3)}, fwidth(toEdge) * 3.0)
    ? ${s.borderAlpha.toFixed(3)}
    : ${s.fillAlpha.toFixed(3)};
  gl_FragColor = vec4(uColor, alpha);
  // Config colours are sRGB hex, as in the overlay shader
  #include <colorspace_fragment>
}
`;
}

/**
 * Frames around the grid cells the cell report has selected
 * (CellReportService, `__corridor.report()`): one flat plate per cell, as
 * large as the whole cell, so the frame lies over the gap and the contour of
 * the Route Grid Overlay's plate (90 % of the cell) and shows as well where
 * the overlay is off. Drawn like the overlay's ground layer, without depth
 * test and after it. GlobalRouteGridService owns the one instance and takes
 * it down with the overlays.
 */
export class RouteGridSelectionViz {
  /** Added to the scene once; the mesh inside is replaced when it has to grow. */
  readonly object = new Group();

  private readonly geometry: PlaneGeometry;
  private readonly material: ShaderMaterial;
  private mesh: InstancedMesh;

  constructor(cellSize: number) {
    // Flat in x/z: the plane's own y becomes -z, the frame reads |x| and |z| alike.
    this.geometry = new PlaneGeometry(cellSize, cellSize).rotateX(-Math.PI / 2);
    this.material = new ShaderMaterial({
      vertexShader: SELECTION_VERTEX,
      fragmentShader: buildSelectionFragment(),
      uniforms: {
        uHalfSize: { value: cellSize / 2 },
        uColor: { value: LOS_VIZ_CONFIG.gridOverlay.selection.color.clone() },
      },
      defines: {
        USE_INSTANCING: '',
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });
    this.object.name = 'cell-report-selection';
    this.mesh = this.createMesh(INITIAL_CAPACITY);
  }

  /** The mesh that draws the frames, for tests and diagnostics. */
  getMesh(): InstancedMesh {
    return this.mesh;
  }

  /** Frame these spots, just above the overlay's plates. */
  setSpots(spots: readonly FramedCellSpot[]): void {
    if (spots.length > this.mesh.instanceMatrix.count) {
      this.object.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = this.createMesh(Math.max(spots.length, this.mesh.instanceMatrix.count * 2));
    }
    const matrix = new Matrix4();
    spots.forEach((spot, i) => {
      matrix.setPosition(spot.x, spot.y + CELL_VIZ_Y_OFFSET_M, spot.z);
      this.mesh.setMatrixAt(i, matrix);
    });
    this.mesh.count = spots.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Free geometry and material and leave the scene. */
  dispose(): void {
    this.object.removeFromParent();
    this.object.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  private createMesh(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(StaticDrawUsage);
    mesh.frustumCulled = false;
    // After the overlay's ground (3) and air (4) layers
    mesh.renderOrder = 5;
    mesh.count = 0;
    this.object.add(mesh);
    return mesh;
  }
}
