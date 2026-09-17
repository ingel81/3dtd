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
import {
  createPortalClipUniforms,
  PORTAL_CLIP_DISCARD,
  PORTAL_CLIP_GLSL,
  PORTAL_CLIP_VARYING,
  type PortalClipUniforms,
} from '../three-engine/renderers/portal-clip';
import { RouteCell } from './route-cell';

/**
 * Visualisation geometry: flat plates that hug the surface, 90 % of a cell
 * with a contour (LOS_VIZ_CONFIG.gridOverlay). Raise `Y_OFFSET_M` if
 * Z-fighting reappears (the ground layer draws without depth test, so even
 * +0.05 m is safe).
 */
const CELL_VIZ_HEIGHT_M = 0.02;
export const CELL_VIZ_Y_OFFSET_M = 0.05;

/**
 * State of a cell for the overlay contour (`aCellKind`): 0 sampled on the
 * ground, 1 on a bridge deck or on the stretch off its end (`approach`,
 * whichever hit its column gave it), 2 without a height sample (the
 * fallback height; a tower's LOS display leaves these out), 3 in a tunnel or
 * covered passage. Plus 8 when the route centre line runs through the cell.
 */
export function overlayCellKind(cell: RouteCell): number {
  const kind = !cell.heightSampled ? 2
    : cell.surface === 'deck' || cell.surface === 'approach' ? 1
    : cell.surface === 'tunnel' ? 3
    : 0;
  return cell.axisX === cell.x && cell.axisZ === cell.z ? kind + 8 : kind;
}

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
 *
 * Dazu `aCellKind` (overlayCellKind) für die Kontur, `vPlate`, die
 * Lage des Fragments auf der Platte, für den Abstand zum Plattenrand, und
 * `vPortalClipPos` für den Clip der Spawn-Portale (portal-clip.ts).
 */
const LOS_CELL_VERTEX = /* glsl */ `
attribute float aCellState;
attribute float aCellKind;
varying float vCellState;
varying float vCellKind;
varying vec2 vPlate;
${PORTAL_CLIP_VARYING}

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vCellState = aCellState;
  vCellKind = aCellKind;
  vPlate = position.xz;

  vec4 localPos = vec4(position, 1.0);

  #ifdef USE_INSTANCING
    localPos = instanceMatrix * localPos;
  #endif

  vec4 worldPos = modelMatrix * localPos;
  vPortalClipPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
  #include <logdepthbuf_vertex>
}
`;

/**
 * Build the per-cell fragment shader for the global aggregate viz.
 *
 * Fläche strikt 2-State pro Layer: jede Aggregate-Mesh zeigt NUR ihre
 * Layer-Coverage (Layer-Primärfarbe) oder uncovered (grau). Eine eigene
 * Both-Farbe gibt es nicht, auch nicht in der per-Tower-Viz.
 *
 * Wenn beide Aggregate gleichzeitig sichtbar sind, sieht der Spieler
 * "both ground+air" implizit durch das visuelle Stapeln zweier
 * Schichten (grün am Boden + blau auf +15m für dieselbe Cell).
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
 *
 * Kontur: am Plattenrand, `gridOverlay.borderWidthMeters` breit, aber nie
 * schmaler als 1,5 Pixel, in der Farbe des Zell-Zustands.
 *
 * Hinter der Ebene eines Spawn-Portals fällt die Platte weg wie die Gegner,
 * ohne Saum (PORTAL_CLIP_DISCARD); die Cells selbst bleiben.
 */
function buildLosCellFragment(opts: { airLayer: boolean }): string {
  const s = LOS_VIZ_CONFIG.states;
  const g = LOS_VIZ_CONFIG.globalStates;
  const o = LOS_VIZ_CONFIG.gridOverlay;
  const vec = (color: { r: number; g: number; b: number }) =>
    `vec3(${color.r.toFixed(4)}, ${color.g.toFixed(4)}, ${color.b.toFixed(4)})`;

  const grey = `color = ${vec(g.uncovered.color)}; alpha = ${g.uncovered.alpha.toFixed(3)};`;
  // Layer-Primärfarbe (green für Ground-Layer, blue für Air-Layer):
  const primary = `color = ${vec(opts.airLayer ? s.air.color : s.ground.color)}; alpha = ${o.coveredAlpha.toFixed(3)};`;

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
uniform float uHalfSize;
varying float vCellState;
varying float vCellKind;
varying vec2 vPlate;
${PORTAL_CLIP_GLSL}
${PORTAL_CLIP_VARYING}

void main() {
  ${PORTAL_CLIP_DISCARD}
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
  alpha *= pulse;

  // Zellen der Mittellinie etwas kräftiger (kind + 8).
  float kind = floor(vCellKind + 0.5);
  if (kind > 7.5) {
    alpha = min(1.0, alpha + ${o.centreAlphaBoost.toFixed(3)});
    kind -= 8.0;
  }

  // Kontur: Abstand zum Plattenrand in Metern, mindestens 1,5 Pixel.
  float toEdge = uHalfSize - max(abs(vPlate.x), abs(vPlate.y));
  if (toEdge < max(${o.borderWidthMeters.toFixed(3)}, fwidth(toEdge) * 1.5)) {
    color = kind < 0.5 ? ${vec(o.borders.normal)}
          : kind < 1.5 ? ${vec(o.borders.deck)}
          : kind < 2.5 ? ${vec(o.borders.unsampled)}
          : ${vec(o.borders.tunnel)};
    alpha = ${o.borderAlpha.toFixed(3)};
  }

  gl_FragColor = vec4(color, alpha);
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
 * State-Buffer. Zeichnet jede Cell, auch ohne Höhenprobe, damit man sieht,
 * ob Zellen fehlen oder nur die LOS-Anzeige eines Towers sie auslässt.
 * Liest Höhe und Visibility-Maps der Cells und schreibt nichts zurück.
 * `GlobalRouteGrid` hält eine Instanz, reicht die öffentlichen Methoden
 * durch und ruft `refreshPositions()`, sobald Cells neu gesampelt wurden.
 */
export class RouteGridAggregateViz {
  /** Cell-Map des Grids. Dieselbe Instanz: das Grid leert sie, ersetzt sie aber nie. */
  private readonly cells: ReadonlyMap<number, RouteCell>;

  /** Kantenlänge einer Cell in Metern. */
  private readonly cellSize: number;

  /**
   * Höhe, auf der eine Cell gezeichnet wird: ihre Höhenprobe, ohne eine
   * solche eine Schätzung aus den Nachbarn (vom Grid gestellt).
   */
  private readonly displayHeight: (cell: RouteCell) => number;

  /** Visualization mesh */
  private visualization: InstancedMesh | null = null;
  private visualizationMaterial: ShaderMaterial | null = null;
  private cellStateAttribute: InstancedBufferAttribute | null = null;

  /**
   * Optional air-altitude mirror of the global Aggregate-Viz — same cell
   * set, same `aCellState` buffer (shared!), positioned at
   * `displayHeight + airSampleYOffset` with the air-layer fragment shader.
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
   * keeps the buffer allocation bounded. 50k × (Matrix4 + 2 Float32) ≈ 4 MB
   * per layer worst-case, which is fine.
   *
   * Three.js InstancedMesh cannot grow at runtime; if a grid genuinely
   * needs more than this, `disposeVisualization` + `createVisualization`
   * is the path forward (already invoked on toggle / location change).
   */
  private readonly MAX_VIZ_CELLS_HARDLIMIT = 50_000;

  constructor(cells: ReadonlyMap<number, RouteCell>, cellSize: number, displayHeight: (cell: RouteCell) => number) {
    this.cells = cells;
    this.cellSize = cellSize;
    this.displayHeight = displayHeight;
  }

  /**
   * Material of either layer; they differ in fragment shader and depth
   * handling. `portalClip`: the spawn portals' clip the enemies share
   * (ThreeTilesEngine.portalClip).
   */
  private createMaterial(airLayer: boolean, portalClip: PortalClipUniforms): ShaderMaterial {
    const material = new ShaderMaterial({
      vertexShader: LOS_CELL_VERTEX,
      fragmentShader: airLayer ? LOS_CELL_FRAGMENT_AIR : LOS_CELL_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uHalfSize: { value: (this.cellSize * LOS_VIZ_CONFIG.gridOverlay.plateScale) / 2 },
        ...portalClip,
      },
      defines: {
        USE_INSTANCING: '',
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });
    if (airLayer) {
      // Air-Plate auf gleicher Y wie Air-Enemies (terrainHeight + 15m).
      // depthTest:true + polygonOffset schiebt die Plate hinter den vor-
      // gerenderten Enemy, sonst paint-over → Enemy unsichtbar. Siehe
      // Begründung in tower-los-layer-builder.ts.
      material.depthTest = true;
      material.polygonOffset = true;
      material.polygonOffsetFactor = 1.0;
      material.polygonOffsetUnits = 1.0;
    }
    return material;
  }

  /** Plate geometry of one layer, with the per-instance cell kind for the contour. */
  private createGeometry(maxCells: number): BoxGeometry {
    const plate = this.cellSize * LOS_VIZ_CONFIG.gridOverlay.plateScale;
    const geometry = new BoxGeometry(plate, CELL_VIZ_HEIGHT_M, plate);
    geometry.setAttribute('aCellKind', new InstancedBufferAttribute(new Float32Array(maxCells), 1));
    return geometry;
  }

  /**
   * Create visualization mesh (InstancedMesh with shader)
   * Call once, then use updateVisualization() each frame for color updates only.
   * Its plates end at the spawn portals' planes (`portalClip`).
   */
  createVisualization(portalClip: PortalClipUniforms = createPortalClipUniforms()): InstancedMesh {
    this.disposeVisualization();

    const maxCells = Math.min(this.cells.size, this.MAX_VIZ_CELLS_HARDLIMIT);
    const geometry = this.createGeometry(maxCells);
    this.visualizationMaterial = this.createMaterial(false, portalClip);
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
   * `displayHeight + airSampleYOffset` with the air-layer fragment shader.
   *
   * Lazily created on first toggle; if `createVisualization()` has not
   * been called yet (no ground layer), the state attribute is created
   * here and re-used when the ground layer comes online later. Its plates
   * end at the spawn portals' planes (`portalClip`) as well.
   */
  createAirVisualization(portalClip: PortalClipUniforms = createPortalClipUniforms()): InstancedMesh {
    this.disposeAirVisualization();

    const maxCells = Math.min(this.cells.size, this.MAX_VIZ_CELLS_HARDLIMIT);
    const geometry = this.createGeometry(maxCells);
    this.airVisualizationMaterial = this.createMaterial(true, portalClip);
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
   * Initialize cell positions and kinds for one of the two layer-meshes.
   * Ground uses `displayHeight + CELL_VIZ_Y_OFFSET_M`, Air uses
   * `displayHeight + airSampleYOffset`. Both layers walk every cell in the
   * same order, so instance N on both meshes refers to the same `RouteCell`
   * and the shared state attribute aligns correctly. A cell without a
   * height sample is drawn as well, at the height its neighbours give it:
   * those are the cells a tower's LOS display leaves out.
   */
  private initializePositions(mesh: InstancedMesh, airLayer: boolean): void {
    const maxCells = mesh.instanceMatrix.count;
    const kinds = mesh.geometry.getAttribute('aCellKind') as InstancedBufferAttribute;
    const matrix = new Matrix4();
    let index = 0;

    for (const cell of this.cells.values()) {
      if (index >= maxCells) break;
      const y = this.displayHeight(cell) + (airLayer ? LOS_VIZ_CONFIG.airSampleYOffset : CELL_VIZ_Y_OFFSET_M);
      matrix.setPosition(cell.x, y, cell.z);
      mesh.setMatrixAt(index, matrix);
      kinds.setX(index, overlayCellKind(cell));
      index++;
    }

    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
    kinds.needsUpdate = true;
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

    // Same order as initializePositions, every cell: the state buffer stays
    // aligned with the matrix buffer.
    let index = 0;
    for (const cell of this.cells.values()) {
      if (index >= meshCount) break;

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
