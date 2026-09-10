import {
  BoxGeometry,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  StaticDrawUsage,
  Vector3,
  WebGLCubeRenderTarget,
} from 'three';
import { LOS_VIZ_CONFIG, StateAppearance } from '../configs/los-viz.config';
import type { RouteCell } from './global-route-grid';
import { getAirTargetY } from './global-route-grid';
import { losPerf } from './los-perf';

/**
 * Eingang für `TowerLosLayerBuilder.build()`.
 */
export interface TowerLosLayerOptions {
  /** Cells im Range, vorgefiltert (heightSampled === true). */
  cells: RouteCell[];
  /** Welt-Position des Tower-Tips. */
  towerTip: Vector3;
  /** Horizontale Reichweite für Ground-Targets (m). */
  groundRange: number;
  /** Horizontale Reichweite für Air-Targets (m). Bei pure-Air > groundRange. */
  airRange: number;
  /** Tower kann Ground-Enemies treffen. */
  canTargetGround: boolean;
  /** Tower kann Air-Enemies treffen. */
  canTargetAir: boolean;
  /** Cubemap mit gepackten Distanzen vom Tower-Tip. */
  cubemap: WebGLCubeRenderTarget;
  /** Far-Distance mit der die Cubemap encoded wurde (= range). */
  cubemapFarDistance: number;
  /** Grid-Cell-Size (m). Steuert die Plattenbreite der Cell-Mesh. */
  gridCellSize: number;
}

/**
 * Ergebnis von `TowerLosLayerBuilder.build()`. Caller besitzt die Meshes
 * und muss `dispose()` aufrufen wenn die Viz entfernt wird.
 *
 * Die Layer enthält ZWEI InstancedMeshes, jede zeigt NUR ihre eigene
 * Coverage (siehe Farbsemantik in `LOS_VIZ_CONFIG.states`):
 *  - `groundMesh` auf `terrainHeight + cellYOffset`: Ground-Sample,
 *    `ground` (grün) oder `blocked` (rot)
 *  - `airMesh` auf `getAirTargetY(cell)`: Air-Sample, `air` (blau) oder
 *    `blocked` (rot)
 *
 * Ein Mixed-Tower (Archer) zeigt beide Layer übereinander: grün unten,
 * blau schwebend. Ein Layer, den der Tower nicht bekämpfen kann, wird gar
 * nicht erst sichtbar.
 */
export interface TowerLosLayer {
  /** Ground-Layer InstancedMesh (auf Boden-Niveau). */
  groundMesh: InstancedMesh;
  /** Air-Layer InstancedMesh (auf +airSampleYOffset). */
  airMesh: InstancedMesh;
  /**
   * Cells in der gleichen Reihenfolge wie die InstancedMesh-Instanzen.
   * `cells[instanceId]` ist die zur Instance gehörige RouteCell — wird vom
   * LOS-Debug-Panel für Reverse-Hover-Picking gebraucht.
   */
  cells: readonly RouteCell[];
  /** Animation-Tick — refresht das `uTime`-Uniform für Pulse. */
  tick(timeSeconds: number): void;
  /**
   * Tower-Tip / Far-Distance updaten ohne Mesh-Rebuild — der Caller
   * ruft das auf, nachdem der Mapper die Cubemap neu gerendert hat
   * (z.B. bei Build-Preview-Mouse-Move).
   */
  updateMapperReference(towerTip: Vector3, cubemapFarDistance: number): void;
  /**
   * Filter-Mode setzen: 'both' / 'ground' / 'air'. Steuert nur die
   * Mesh-Visibility; ein Layer ist sichtbar, wenn der Filter ihn zulässt
   * UND der Tower ihn bekämpfen kann.
   */
  setFilterMode(mode: 'both' | 'ground' | 'air'): void;
  /** Frei die Mesh-Resourcen. */
  dispose(): void;
}

const CELL_FOOTPRINT_FACTOR = 0.85; // Plattenbreite = cellSize × Faktor

/**
 * Welche Layer der per-Tower-Viz sichtbar sind. Capability-Gating: ein
 * Pure-Ground-Tower zeigt nie den Air-Layer, ein Pure-Air-Tower nie den
 * Ground-Layer; der Filter kann nur weiter einschränken. Einzige Quelle
 * für Mesh-Visibility UND Legende.
 */
export function visibleLosLayers(
  mode: 'both' | 'ground' | 'air',
  canTargetGround: boolean,
  canTargetAir: boolean,
): { ground: boolean; air: boolean } {
  return {
    ground: canTargetGround && mode !== 'air',
    air: canTargetAir && mode !== 'ground',
  };
}

const VERTEX_SHADER = /* glsl */ `
  attribute float aSampleY;

  varying vec3 vCellCenterWorld;
  varying float vSampleY;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vec4 worldPos4 = modelMatrix * instanceMatrix * vec4(position, 1.0);

    // Cell-Center == 4. Spalte der instanceMatrix (Translation), in
    // Welt-Koordinaten via modelMatrix.
    vec4 center4 = modelMatrix * vec4(instanceMatrix[3].xyz, 1.0);
    vCellCenterWorld = center4.xyz;

    vSampleY = aSampleY;

    gl_Position = projectionMatrix * viewMatrix * worldPos4;
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  #include <common>
  #include <packing>
  #include <logdepthbuf_pars_fragment>

  uniform samplerCube uCubeMap;
  uniform vec3  uTowerTip;
  uniform float uFarDistance;
  uniform float uRange;
  uniform float uVisibilityBias;
  uniform float uEmptyDepthEpsilon;
  uniform float uTime;
  uniform float uPulseSpeed;
  uniform float uPulseDepth;

  // Pro Layer ein Material: covered = Layer-Farbe (ground grün / air
  // blau), blocked = rot. Die Alphas sind beim Air-Layer schon mit
  // airCells.alphaScale verrechnet.
  uniform vec3  uColorCovered; uniform float uAlphaCovered;
  uniform vec3  uColorBlocked; uniform float uAlphaBlocked;

  varying vec3 vCellCenterWorld;
  varying float vSampleY;

  // Entpacken: gibt Distanz (Meter) zurück. Empty-texel-Safeguard hebt
  // depth < epsilon auf 1.0 (= farDistance) — gegen Clear-Color-Leaks.
  float sampleBlockerDistance(vec3 sampleWorld) {
    vec3 dir = sampleWorld - uTowerTip;
    float dirLen = length(dir);
    if (dirLen < 1e-4) return uFarDistance;
    vec3 dirN = dir / dirLen;
    float packed = unpackRGBAToDepth(textureCube(uCubeMap, dirN));
    if (packed < uEmptyDepthEpsilon) packed = 1.0;
    return packed * uFarDistance;
  }

  bool isVisible(vec3 sampleWorld) {
    float blockerDist = sampleBlockerDistance(sampleWorld);
    float cellDist = length(sampleWorld - uTowerTip);
    return cellDist < blockerDist - uVisibilityBias;
  }

  void main() {
    // logdepthbuf_fragment VOR jeglicher Farblogik, damit gl_FragDepth
    // korrekt geschrieben wird.
    #include <logdepthbuf_fragment>
    vec3 sampleWorld = vec3(vCellCenterWorld.x, vSampleY, vCellCenterWorld.z);

    // Range-Falloff: horizontale Distanz zum Tower
    float horizDist = length(vCellCenterWorld.xz - uTowerTip.xz);
    bool covered = horizDist <= uRange && isVisible(sampleWorld);

    vec3 color = covered ? uColorCovered : uColorBlocked;
    float alpha = covered ? uAlphaCovered : uAlphaBlocked;

    float pulse = sin(uTime * uPulseSpeed) * uPulseDepth + (1.0 - uPulseDepth * 0.5);
    gl_FragColor = vec4(color, alpha * pulse);
    // Config-Farben sind sRGB-Hex (in three linear gespeichert). Ohne die
    // Konvertierung landen sie im Default-Pfad (ohne Composer) roh im
    // Framebuffer und sehen anders aus als die Legende.
    #include <colorspace_fragment>
  }
`;

/**
 * Baut die InstancedMesh + ShaderMaterial-Pipeline für die per-Tower-
 * LOS-Visualisierung. Stateless static-Class — der Caller hält die
 * gebaute `TowerLosLayer` und ist für `dispose()` zuständig.
 */
export class TowerLosLayerBuilder {
  static build(opts: TowerLosLayerOptions): TowerLosLayer | null {
    const tBuildStart = performance.now();
    const { cells, towerTip, groundRange, airRange, canTargetGround, canTargetAir,
            cubemap, cubemapFarDistance, gridCellSize } = opts;

    if (cells.length === 0) return null;

    const cellFootprint = gridCellSize * CELL_FOOTPRINT_FACTOR;

    const states = LOS_VIZ_CONFIG.states;
    const airCfg = LOS_VIZ_CONFIG.airCells;

    // Beide Layer teilen sich Cubemap und Tower-Tip, unterscheiden sich
    // aber in Range, Covered-Farbe und Alpha-Skalierung.
    const buildMaterial = (
      range: number,
      coveredState: StateAppearance,
      alphaScale: number,
    ): ShaderMaterial => new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uCubeMap:              { value: cubemap.texture },
        uTowerTip:             { value: towerTip.clone() },
        uFarDistance:          { value: cubemapFarDistance },
        uRange:                { value: range },
        uVisibilityBias:       { value: LOS_VIZ_CONFIG.visibilityBiasMeters },
        uEmptyDepthEpsilon:    { value: LOS_VIZ_CONFIG.emptyDepthEpsilon },
        uTime:                 { value: 0 },
        uPulseSpeed:           { value: LOS_VIZ_CONFIG.pulseSpeed },
        uPulseDepth:           { value: LOS_VIZ_CONFIG.pulseDepth },

        uColorCovered:         { value: coveredState.color },
        uAlphaCovered:         { value: coveredState.alpha * alphaScale },
        uColorBlocked:         { value: states.blocked.color },
        uAlphaBlocked:         { value: states.blocked.alpha * alphaScale },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });

    const groundMaterial = buildMaterial(groundRange, states.ground, 1);
    const airMaterial = buildMaterial(airRange, states.air, airCfg.alphaScale);

    // Air-Plates sitzen auf exakt der gleichen Y-Höhe wie die Air-
    // Enemies (beide `terrainHeight + 15m`). Mit `depthTest:false` würde
    // der transparente Plate beim Render immer ÜBER dem Enemy landen
    // → Air-Enemy unsichtbar. Lösung: depthTest:true + polygonOffset
    // schiebt die Plate-Tiefe minimal zurück, sodass die LEQUAL-Tests
    // gegen den vor-gerenderten Enemy fehlschlagen. Ground-Plates
    // brauchen das NICHT, weil Ground-Enemies vertikal ausgedehnt sind
    // — die Plate bedeckt nur die Füße, der Körper ragt sichtbar oben
    // raus.
    airMaterial.depthTest = true;
    airMaterial.polygonOffset = true;
    airMaterial.polygonOffsetFactor = 1.0;
    airMaterial.polygonOffsetUnits = 1.0;

    // Jedes Mesh hat sein eigenes Geometry-Objekt, weil `aSampleY` pro
    // Layer verschieden ist (Ground- vs. Air-Sample-Höhe).
    const groundGeometry = new BoxGeometry(
      cellFootprint,
      LOS_VIZ_CONFIG.cellHeightMeters,
      cellFootprint,
    );
    const airGeometry = new BoxGeometry(
      cellFootprint,
      LOS_VIZ_CONFIG.cellHeightMeters,
      cellFootprint,
    );

    const groundMesh = new InstancedMesh(groundGeometry, groundMaterial, cells.length);
    groundMesh.frustumCulled = false;
    groundMesh.renderOrder = 3;
    groundMesh.instanceMatrix.setUsage(StaticDrawUsage);

    const airMesh = new InstancedMesh(airGeometry, airMaterial, cells.length);
    airMesh.frustumCulled = false;
    airMesh.renderOrder = 4;  // Air zuletzt: die schwebende Plate blendet über die Ground-Plate
    airMesh.instanceMatrix.setUsage(StaticDrawUsage);

    const groundSampleYArr = new Float32Array(cells.length);
    const airSampleYArr = new Float32Array(cells.length);
    const matrix = new Matrix4();

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      // Ground-Mesh sitzt knapp über dem Boden (z-fighting-Schutz)
      const groundMeshY = cell.terrainHeight + LOS_VIZ_CONFIG.cellYOffset;
      matrix.setPosition(cell.x, groundMeshY, cell.z);
      groundMesh.setMatrixAt(i, matrix);

      // Air-Mesh sitzt direkt auf dem Air-Sample-Punkt — visualisiert
      // EXAKT wo die Cubemap-Sample-Position liegt. Single source of
      // truth: getAirTargetY (siehe global-route-grid.ts).
      const airMeshY = getAirTargetY(cell);
      matrix.setPosition(cell.x, airMeshY, cell.z);
      airMesh.setMatrixAt(i, matrix);

      groundSampleYArr[i] = cell.terrainHeight + LOS_VIZ_CONFIG.groundSampleYOffset;
      airSampleYArr[i]    = airMeshY;
    }

    const groundSampleAttr = new InstancedBufferAttribute(groundSampleYArr, 1);
    groundSampleAttr.setUsage(DynamicDrawUsage);
    groundGeometry.setAttribute('aSampleY', groundSampleAttr);

    const airSampleAttr = new InstancedBufferAttribute(airSampleYArr, 1);
    airSampleAttr.setUsage(DynamicDrawUsage);
    airGeometry.setAttribute('aSampleY', airSampleAttr);

    groundMesh.instanceMatrix.needsUpdate = true;
    airMesh.instanceMatrix.needsUpdate = true;

    // Ausgeblendete Layer sparen außerdem ihren Draw-Call.
    const applyFilterMode = (mode: 'both' | 'ground' | 'air'): void => {
      const visible = visibleLosLayers(mode, canTargetGround, canTargetAir);
      groundMesh.visible = visible.ground;
      airMesh.visible = visible.air;
    };
    applyFilterMode('both');

    losPerf.sample('mesh/build', performance.now() - tBuildStart, cells.length);

    return {
      groundMesh,
      airMesh,
      cells,
      tick: (timeSeconds: number) => {
        groundMaterial.uniforms['uTime'].value = timeSeconds;
        airMaterial.uniforms['uTime'].value = timeSeconds;
      },
      updateMapperReference: (tip: Vector3, far: number) => {
        groundMaterial.uniforms['uTowerTip'].value.copy(tip);
        groundMaterial.uniforms['uFarDistance'].value = far;
        airMaterial.uniforms['uTowerTip'].value.copy(tip);
        airMaterial.uniforms['uFarDistance'].value = far;
      },
      setFilterMode: applyFilterMode,
      dispose: () => {
        groundGeometry.dispose();
        airGeometry.dispose();
        groundMaterial.dispose();
        airMaterial.dispose();
      },
    };
  }
}
