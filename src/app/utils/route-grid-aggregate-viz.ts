import {
  InstancedMesh,
  ShaderMaterial,
  InstancedBufferAttribute,
  BoxGeometry,
  Matrix4,
  DoubleSide,
  StaticDrawUsage,
  DynamicDrawUsage,
} from 'three';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';
import { RouteCell, getAirTargetY } from './route-cell';

/**
 * Visualisation geometry — decal-like flat plates that hug the surface.
 * Increase `HEIGHT_M` to give the cells perceptible thickness; raise
 * `Y_OFFSET_M` if Z-fighting reappears (currently depthTest is off, so
 * even +0.05m is safe). Modern-Minimal target: barely noticeable plates.
 */
const CELL_VIZ_HEIGHT_M = 0.02;
const CELL_VIZ_Y_OFFSET_M = 0.05;

/**
 * Globaler Debug-Route-Grid-Shader.
 *
 * Teilt sich die Layer-Farben mit der per-Tower-Viz (Ground grün, Air
 * blau, `LOS_VIZ_CONFIG.states`), single source of truth.
 * "Keine Coverage" hat im Aggregat
 * eine andere Semantik (kein Tower in Range) als im per-Tower-Viz (rot =
 * in Reichweite aber blockiert), daher hier ein neutrales Grau statt rot.
 *
 * State-Codes (von updateVisualization gesetzt, Farben siehe unten):
 *   0 → uncovered   (kein Tower in Range)
 *   1 → groundOnly
 *   2 → airOnly
 *   3 → both
 *   4 → enemyInCell (enemy hier, kein Tower sieht ihn)
 *   5 → enemyVisible(enemy + sichtbar = aktives Ziel)
 */
const LOS_CELL_VERTEX = /* glsl */ `
attribute float aCellState;
varying float vCellState;
varying vec3 vWorldPosition;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vCellState = aCellState;

  vec4 localPos = vec4(position, 1.0);

  #ifdef USE_INSTANCING
    localPos = instanceMatrix * localPos;
  #endif

  vec4 worldPos = modelMatrix * localPos;
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
  #include <logdepthbuf_vertex>
}
`;

/**
 * Build the per-cell fragment shader for the global aggregate viz.
 *
 * Strikt 2-State pro Layer: jede Aggregate-Mesh zeigt NUR ihre Layer-
 * Coverage (Layer-Primärfarbe) oder uncovered (grau). Eine eigene Both-
 * Farbe gibt es nicht, auch nicht in der per-Tower-Viz.
 *
 * Wenn beide Aggregate gleichzeitig sichtbar sind, sieht der Spieler
 * "both ground+air" implizit durch das visuelle Stapeln zweier
 * Schichten (grün am Boden + blau auf +15m für dieselbe Cell).
 *
 * Zukünftige Merged-View (gold in Aggregat) kann als dritte Variante
 * dieses Shaders gebaut werden — der State-Buffer enthält state 3
 * (both) weiterhin, nur die Interpretation hier collapsed ihn auf die
 * Layer-Primärfarbe.
 *
 *   Ground-Layer (gridLayer) — 2-State:
 *     state 0 (neither)       → grey
 *     state 1 (groundOnly)    → green (ground covered)
 *     state 2 (airOnly)       → grey  (ground NICHT covered)
 *     state 3 (both)          → green (ground IS covered, ignore air info)
 *     state 4 (enemyInCell)   → grey
 *     state 5 (enemyVisible)  → green (covered → use layer color)
 *
 *   Air-Layer (airLayer) — 2-State:
 *     state 0 → grey
 *     state 1 → grey  (air NICHT covered)
 *     state 2 → blue  (air covered)
 *     state 3 → blue  (air IS covered, ignore ground info)
 *     state 4 → grey
 *     state 5 → blue
 */
function buildLosCellFragment(opts: { airLayer: boolean }): string {
  const s = LOS_VIZ_CONFIG.states;
  const g = LOS_VIZ_CONFIG.globalStates;
  const c = (col: { color: { r: number; g: number; b: number } }) =>
    `vec3(${col.color.r.toFixed(4)}, ${col.color.g.toFixed(4)}, ${col.color.b.toFixed(4)})`;

  const grey = `color = ${c(g.uncovered)}; alpha = ${g.uncovered.alpha.toFixed(3)};`;
  // Layer-Primärfarbe (green für Ground-Layer, blue für Air-Layer):
  const primary = opts.airLayer
    ? `color = ${c(s.air)}; alpha = ${s.air.alpha.toFixed(3)};`
    : `color = ${c(s.ground)}; alpha = ${s.ground.alpha.toFixed(3)};`;

  // Per-Layer-Coverage-Test: ground-grid zeigt primary für state 1 (groundOnly)
  // UND state 3 (both); air-grid zeigt primary für state 2 (airOnly) UND state
  // 3 (both). state 5 (enemyVisible) = covered → primary auf beiden Layern.
  // Alle anderen States → grey.
  const groundLayerOnly = opts.airLayer ? grey : primary;
  const airLayerOnly    = opts.airLayer ? primary : grey;
  const both            = primary;          // beide Layer covered → ihre primary
  const enemyVisible    = primary;          // enemy + covered → covered

  return /* glsl */ `
precision highp float;
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
varying float vCellState;
varying vec3 vWorldPosition;

void main() {
  #include <logdepthbuf_fragment>
  vec3 color;
  float alpha;

  // 0 → uncovered
  if (vCellState < 0.5) {
    ${grey}
  }
  // 1 → groundOnly
  else if (vCellState < 1.5) {
    ${groundLayerOnly}
  }
  // 2 → airOnly
  else if (vCellState < 2.5) {
    ${airLayerOnly}
  }
  // 3 → both ground+air (Aggregate: collapsed auf Layer-Primärfarbe)
  else if (vCellState < 3.5) {
    ${both}
  }
  // 4 → enemyInCell (kein Tower covered → grey auf jeder Layer)
  else if (vCellState < 4.5) {
    ${grey}
  }
  // 5 → enemyVisible (Enemy + covered → Layer-Primärfarbe)
  else {
    ${enemyVisible}
  }

  float pulse = sin(uTime * ${LOS_VIZ_CONFIG.pulseSpeed.toFixed(2)}) *
                ${LOS_VIZ_CONFIG.pulseDepth.toFixed(3)} +
                (1.0 - ${LOS_VIZ_CONFIG.pulseDepth.toFixed(3)} * 0.5);
  gl_FragColor = vec4(color, alpha * pulse);
  // Config-Farben sind sRGB-Hex: gleiche Wandlung wie im per-Tower-Shader
  #include <colorspace_fragment>
}
`;
}

const LOS_CELL_FRAGMENT = buildLosCellFragment({ airLayer: false });
const LOS_CELL_FRAGMENT_AIR = buildLosCellFragment({ airLayer: true });

/**
 * Aggregat-Debug-Viz des Route-Grids (Toggles `grid` / `gridAir`): eine
 * Ground- und eine Air-InstancedMesh über dieselben Cells, mit geteiltem
 * State-Buffer. Liest Höhe und Visibility-Maps der Cells und schreibt
 * nichts zurück. `GlobalRouteGrid` hält eine Instanz, reicht die
 * öffentlichen Methoden durch und ruft `refreshPositions()`, sobald
 * Cells neu gesampelt wurden.
 */
export class RouteGridAggregateViz {
  /** Cell-Map des Grids. Dieselbe Instanz: das Grid leert sie, ersetzt sie aber nie. */
  private readonly cells: ReadonlyMap<number, RouteCell>;

  /** Kantenlänge einer Cell in Metern. */
  private readonly cellSize: number;

  /** Visualization mesh */
  private visualization: InstancedMesh | null = null;
  private visualizationMaterial: ShaderMaterial | null = null;
  private cellStateAttribute: InstancedBufferAttribute | null = null;

  /**
   * Optional air-altitude mirror of the global Aggregate-Viz — same cell
   * set, same `aCellState` buffer (shared!), positioned at
   * `cell.terrainHeight + airSampleYOffset` with the air-layer fragment shader.
   * Built lazily by `createAirVisualization()` when the corresponding
   * toggle goes ON.
   */
  private airVisualization: InstancedMesh | null = null;
  private airVisualizationMaterial: ShaderMaterial | null = null;

  /** Animation time accumulator */
  private animationTime = 0;

  /**
   * Safety hard-limit for the viz InstancedMesh capacity. Real cell counts
   * are passed directly via `this.cells.size` — this cap only fires if the
   * grid grows pathologically (e.g. a Manhattan-scale route fan-out) and
   * keeps the buffer allocation bounded. 50k × (Matrix4 + Float32) ≈ 4 MB
   * per layer worst-case, which is fine.
   *
   * Three.js InstancedMesh cannot grow at runtime; if a grid genuinely
   * needs more than this, `disposeVisualization` + `createVisualization`
   * is the path forward (already invoked on toggle / location change).
   */
  private readonly MAX_VIZ_CELLS_HARDLIMIT = 50_000;

  constructor(cells: ReadonlyMap<number, RouteCell>, cellSize: number) {
    this.cells = cells;
    this.cellSize = cellSize;
  }

  /**
   * Create visualization mesh (InstancedMesh with shader)
   * Call once, then use updateVisualization() each frame for color updates only
   */
  createVisualization(): InstancedMesh {
    this.disposeVisualization();

    const cellSize = this.cellSize * 0.85;
    const geometry = new BoxGeometry(cellSize, CELL_VIZ_HEIGHT_M, cellSize);

    this.visualizationMaterial = new ShaderMaterial({
      vertexShader: LOS_CELL_VERTEX,
      fragmentShader: LOS_CELL_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
      },
      defines: {
        USE_INSTANCING: '',
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });

    const maxCells = Math.min(this.cells.size, this.MAX_VIZ_CELLS_HARDLIMIT);
    this.visualization = new InstancedMesh(geometry, this.visualizationMaterial, maxCells);
    this.visualization.frustumCulled = false;
    this.visualization.renderOrder = 3;
    // Static usage - positions set once and don't change
    this.visualization.instanceMatrix.setUsage(StaticDrawUsage);

    // Create cell state attribute (updated each frame for colors)
    const stateArray = new Float32Array(maxCells);
    this.cellStateAttribute = new InstancedBufferAttribute(stateArray, 1);
    this.cellStateAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aCellState', this.cellStateAttribute);

    // Initialize positions ONCE with live terrain sampling (ground Y)
    this.initializePositions(this.visualization, /* airLayer */ false);

    // If an air visualization already exists (toggle ordering: air ON
    // before ground), keep it consistent with the same instance order.
    if (this.airVisualization) {
      this.initializePositions(this.airVisualization, /* airLayer */ true);
      this.airVisualization.geometry.setAttribute('aCellState', this.cellStateAttribute);
    }

    // Initial state update
    this.updateVisualization();

    return this.visualization;
  }

  /**
   * Create the air-layer mirror of the global aggregate viz. Same cell
   * set, same state buffer (shared with `visualization`), positioned at
   * `terrainHeight + airSampleYOffset` with the air-layer fragment shader.
   *
   * Lazily created on first toggle; if `createVisualization()` has not
   * been called yet (no ground layer), the state attribute is created
   * here and re-used when the ground layer comes online later.
   */
  createAirVisualization(): InstancedMesh {
    this.disposeAirVisualization();

    const cellSize = this.cellSize * 0.85;
    const geometry = new BoxGeometry(cellSize, CELL_VIZ_HEIGHT_M, cellSize);

    this.airVisualizationMaterial = new ShaderMaterial({
      vertexShader: LOS_CELL_VERTEX,
      fragmentShader: LOS_CELL_FRAGMENT_AIR,
      uniforms: {
        uTime: { value: 0 },
      },
      defines: {
        USE_INSTANCING: '',
      },
      transparent: true,
      // Air-Plate auf gleicher Y wie Air-Enemies (terrainHeight + 15m).
      // depthTest:true + polygonOffset schiebt die Plate hinter den vor-
      // gerenderten Enemy, sonst paint-over → Enemy unsichtbar. Siehe
      // Begründung in tower-los-layer-builder.ts.
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1.0,
      polygonOffsetUnits: 1.0,
      side: DoubleSide,
    });

    const maxCells = Math.min(this.cells.size, this.MAX_VIZ_CELLS_HARDLIMIT);
    this.airVisualization = new InstancedMesh(geometry, this.airVisualizationMaterial, maxCells);
    this.airVisualization.frustumCulled = false;
    this.airVisualization.renderOrder = 4;
    this.airVisualization.instanceMatrix.setUsage(StaticDrawUsage);

    // State attribute: re-use the ground-layer buffer if it exists, else
    // create it here. Ground-layer-creation will re-bind when it runs.
    if (!this.cellStateAttribute) {
      const stateArray = new Float32Array(maxCells);
      this.cellStateAttribute = new InstancedBufferAttribute(stateArray, 1);
      this.cellStateAttribute.setUsage(DynamicDrawUsage);
    }
    geometry.setAttribute('aCellState', this.cellStateAttribute);

    this.initializePositions(this.airVisualization, /* airLayer */ true);
    this.updateVisualization();

    return this.airVisualization;
  }

  /**
   * Refresh the cell positions of WHICHEVER aggregate-viz meshes are
   * currently built (ground, air, both, or neither). Cheap idempotent
   * helper for the three "cells were re-sampled, sync the viz" sites
   * in registerTower / refineCellsInRadius / registerTowerIncremental.
   */
  refreshPositions(): void {
    if (this.visualization) {
      this.initializePositions(this.visualization, /* airLayer */ false);
    }
    if (this.airVisualization) {
      this.initializePositions(this.airVisualization, /* airLayer */ true);
      // Re-bind the (possibly re-built) state attribute so both layers
      // stay aligned.
      if (this.cellStateAttribute) {
        this.airVisualization.geometry.setAttribute('aCellState', this.cellStateAttribute);
      }
    }
  }

  /**
   * Initialize cell positions for one of the two layer-meshes. Ground
   * uses `terrainHeight + CELL_VIZ_Y_OFFSET_M`, Air uses
   * `terrainHeight + airSampleYOffset`. Both layers walk `cells` in the
   * same order and skip the same unsampled cells, so instance N on both
   * meshes refers to the same `RouteCell` and the shared state attribute
   * aligns correctly.
   */
  private initializePositions(mesh: InstancedMesh, airLayer: boolean): void {
    const maxCells = mesh.instanceMatrix.count;
    const matrix = new Matrix4();
    let index = 0;

    for (const cell of this.cells.values()) {
      if (index >= maxCells) break;

      // Only include cells whose terrainHeight came from a real raycast.
      // Unsampled cells (fallback to anchorY at gen-time) would otherwise
      // render far below the map until tiles stream in. They re-enter
      // the viz once updateTerrainHeights promotes them.
      if (!cell.heightSampled) continue;

      const y = airLayer
        ? getAirTargetY(cell)
        : cell.terrainHeight + CELL_VIZ_Y_OFFSET_M;
      matrix.setPosition(cell.x, y, cell.z);
      mesh.setMatrixAt(index, matrix);
      index++;
    }

    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Update visualization colors only (call each frame when visible)
   * FAST: Only updates state attribute, no terrain sampling or matrix updates
   */
  updateVisualization(): void {
    if (!this.cellStateAttribute) return;
    // State buffer is shared between ground & air meshes — write once,
    // both layers read it. We need at least one of the two meshes for
    // the per-mesh `count` (cap of the loop).
    const meshCount = this.visualization?.count ?? this.airVisualization?.count ?? 0;
    if (meshCount === 0) return;

    let index = 0;
    for (const cell of this.cells.values()) {
      if (index >= meshCount) break;
      // Same skip-rule as initializePositions — keeps the state buffer
      // aligned with the matrix buffer (both indexed by sampled cells only).
      if (!cell.heightSampled) continue;

      // 4-State Aggregate (shared palette with per-tower viz) + Enemy-Overlays.
      // State-Codes siehe buildLosCellFragment() oben.
      const hasEnemies = cell.enemies.size > 0;
      const groundByAny = this.isGroundVisibleByAnyTower(cell);
      const airByAny = this.isAirVisibleByAnyTower(cell);

      let state: number;
      if (hasEnemies && (groundByAny || airByAny)) {
        state = 5; // enemyVisible — aktives Ziel
      } else if (hasEnemies) {
        state = 4; // enemyInCell — Enemy, kein Tower sieht ihn
      } else if (groundByAny && airByAny) {
        state = 3; // both
      } else if (groundByAny) {
        state = 1; // groundOnly
      } else if (airByAny) {
        state = 2; // airOnly
      } else {
        state = 0; // neither
      }

      this.cellStateAttribute.setX(index, state);
      index++;
    }

    this.cellStateAttribute.needsUpdate = true;
  }

  /**
   * Check if cell has ground LoS from any registered tower
   */
  private isGroundVisibleByAnyTower(cell: RouteCell): boolean {
    for (const visible of cell.towerVisibility.values()) {
      if (visible) return true;
    }
    return false;
  }

  /**
   * Check if cell has air LoS from any registered tower
   */
  private isAirVisibleByAnyTower(cell: RouteCell): boolean {
    for (const visible of cell.airVisibility.values()) {
      if (visible) return true;
    }
    return false;
  }

  /**
   * Update animation time (call each frame)
   * @param deltaTime Delta time in milliseconds
   */
  updateAnimation(deltaTime: number): void {
    this.animationTime += deltaTime * 0.001;
    // Wrap animation time to avoid floating point precision issues over time
    // 2*PI ensures seamless looping of sin() based animations
    if (this.animationTime > Math.PI * 2000) {
      this.animationTime = this.animationTime % (Math.PI * 2);
    }
    if (this.visualizationMaterial?.uniforms?.['uTime']) {
      this.visualizationMaterial.uniforms['uTime'].value = this.animationTime;
    }
    if (this.airVisualizationMaterial?.uniforms?.['uTime']) {
      this.airVisualizationMaterial.uniforms['uTime'].value = this.animationTime;
    }
  }

  /**
   * Get visualization mesh
   */
  getVisualization(): InstancedMesh | null {
    return this.visualization;
  }

  /**
   * Dispose ground visualization resources. The shared state attribute
   * stays alive as long as the air layer references it — only cleared
   * when BOTH layers are disposed.
   */
  disposeVisualization(): void {
    if (this.visualization) {
      this.visualization.geometry.dispose();
      this.visualization = null;
    }
    if (this.visualizationMaterial) {
      this.visualizationMaterial.dispose();
      this.visualizationMaterial = null;
    }
    if (!this.airVisualization) {
      // No more consumers of the shared state buffer → safe to drop.
      this.cellStateAttribute = null;
    }
  }

  /** Dispose air-layer aggregate viz (mirror of disposeVisualization). */
  disposeAirVisualization(): void {
    if (this.airVisualization) {
      this.airVisualization.geometry.dispose();
      this.airVisualization = null;
    }
    if (this.airVisualizationMaterial) {
      this.airVisualizationMaterial.dispose();
      this.airVisualizationMaterial = null;
    }
    if (!this.visualization) {
      this.cellStateAttribute = null;
    }
  }
}
