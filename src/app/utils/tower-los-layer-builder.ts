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
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';
import type { RouteCell } from './global-route-grid';

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
 * Ergebnis von `TowerLosLayerBuilder.build()`. Caller besitzt die Mesh und
 * muss `dispose()` aufrufen wenn die Viz entfernt wird.
 */
export interface TowerLosLayer {
  /** Die fertige InstancedMesh, dem Caller zum Adden in die Scene. */
  mesh: InstancedMesh;
  /** Animation-Tick — refresht das `uTime`-Uniform für Pulse. */
  tick(timeSeconds: number): void;
  /**
   * Tower-Tip / Far-Distance updaten ohne Mesh-Rebuild — der Caller
   * ruft das auf, nachdem der Mapper die Cubemap neu gerendert hat
   * (z.B. bei Build-Preview-Mouse-Move).
   */
  updateMapperReference(towerTip: Vector3, cubemapFarDistance: number): void;
  /** Frei die Mesh-Resourcen. */
  dispose(): void;
}

const CELL_FOOTPRINT_FACTOR = 0.85; // Plattenbreite = cellSize × Faktor

const VERTEX_SHADER = /* glsl */ `
  attribute float aGroundSampleY;
  attribute float aAirSampleY;

  varying vec3 vCellCenterWorld;
  varying float vGroundSampleY;
  varying float vAirSampleY;

  void main() {
    vec4 worldPos4 = modelMatrix * instanceMatrix * vec4(position, 1.0);

    // Cell-Center == 4. Spalte der instanceMatrix (Translation), in
    // Welt-Koordinaten via modelMatrix.
    vec4 center4 = modelMatrix * vec4(instanceMatrix[3].xyz, 1.0);
    vCellCenterWorld = center4.xyz;

    vGroundSampleY = aGroundSampleY;
    vAirSampleY = aAirSampleY;

    gl_Position = projectionMatrix * viewMatrix * worldPos4;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  #include <packing>

  uniform samplerCube uCubeMap;
  uniform vec3  uTowerTip;
  uniform float uFarDistance;
  uniform float uGroundRange;
  uniform float uAirRange;
  uniform float uHasGround;
  uniform float uHasAir;
  uniform float uVisibilityBias;
  uniform float uEmptyDepthEpsilon;
  uniform float uTime;
  uniform float uPulseSpeed;
  uniform float uPulseDepth;

  uniform vec3  uColorBoth;       uniform float uAlphaBoth;
  uniform vec3  uColorGroundOnly; uniform float uAlphaGroundOnly;
  uniform vec3  uColorAirOnly;    uniform float uAlphaAirOnly;
  uniform vec3  uColorNeither;    uniform float uAlphaNeither;

  varying vec3 vCellCenterWorld;
  varying float vGroundSampleY;
  varying float vAirSampleY;

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
    vec3 groundSampleWorld = vec3(vCellCenterWorld.x, vGroundSampleY, vCellCenterWorld.z);
    vec3 airSampleWorld    = vec3(vCellCenterWorld.x, vAirSampleY,    vCellCenterWorld.z);

    bool groundVis = (uHasGround > 0.5) && isVisible(groundSampleWorld);
    bool airVis    = (uHasAir > 0.5)    && isVisible(airSampleWorld);

    // Range-Falloff: horizontale Distanz zum Tower
    float horizDist = length(vCellCenterWorld.xz - uTowerTip.xz);
    if (horizDist > uGroundRange) groundVis = false;
    if (horizDist > uAirRange)    airVis = false;

    // 4-State-Coloring
    vec3 color;
    float alpha;
    if (groundVis && airVis) {
      color = uColorBoth;       alpha = uAlphaBoth;
    } else if (groundVis) {
      color = uColorGroundOnly; alpha = uAlphaGroundOnly;
    } else if (airVis) {
      color = uColorAirOnly;    alpha = uAlphaAirOnly;
    } else {
      color = uColorNeither;    alpha = uAlphaNeither;
    }

    // Pulse
    float pulse = sin(uTime * uPulseSpeed) * uPulseDepth + (1.0 - uPulseDepth * 0.5);
    gl_FragColor = vec4(color, alpha * pulse);
  }
`;

/**
 * Baut die InstancedMesh + ShaderMaterial-Pipeline für die per-Tower-
 * LOS-Visualisierung. Stateless static-Class — der Caller hält die
 * gebaute `TowerLosLayer` und ist für `dispose()` zuständig.
 */
export class TowerLosLayerBuilder {
  static build(opts: TowerLosLayerOptions): TowerLosLayer | null {
    const { cells, towerTip, groundRange, airRange, canTargetGround, canTargetAir,
            cubemap, cubemapFarDistance, gridCellSize } = opts;

    if (cells.length === 0) return null;

    const cellFootprint = gridCellSize * CELL_FOOTPRINT_FACTOR;
    const geometry = new BoxGeometry(
      cellFootprint,
      LOS_VIZ_CONFIG.cellHeightMeters,
      cellFootprint,
    );

    const states = LOS_VIZ_CONFIG.states;

    const material = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uCubeMap:              { value: cubemap.texture },
        uTowerTip:             { value: towerTip.clone() },
        uFarDistance:          { value: cubemapFarDistance },
        uGroundRange:          { value: groundRange },
        uAirRange:             { value: airRange },
        uHasGround:            { value: canTargetGround ? 1 : 0 },
        uHasAir:               { value: canTargetAir ? 1 : 0 },
        uVisibilityBias:       { value: LOS_VIZ_CONFIG.visibilityBiasMeters },
        uEmptyDepthEpsilon:    { value: LOS_VIZ_CONFIG.emptyDepthEpsilon },
        uTime:                 { value: 0 },
        uPulseSpeed:           { value: LOS_VIZ_CONFIG.pulseSpeed },
        uPulseDepth:           { value: LOS_VIZ_CONFIG.pulseDepth },

        uColorBoth:            { value: states.both.color },
        uAlphaBoth:            { value: states.both.alpha },
        uColorGroundOnly:      { value: states.groundOnly.color },
        uAlphaGroundOnly:      { value: states.groundOnly.alpha },
        uColorAirOnly:         { value: states.airOnly.color },
        uAlphaAirOnly:         { value: states.airOnly.alpha },
        uColorNeither:         { value: states.neither.color },
        uAlphaNeither:         { value: states.neither.alpha },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });

    const mesh = new InstancedMesh(geometry, material, cells.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.instanceMatrix.setUsage(StaticDrawUsage);

    const groundSampleYArr = new Float32Array(cells.length);
    const airSampleYArr = new Float32Array(cells.length);
    const matrix = new Matrix4();

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const cellMeshY = cell.terrainHeight + LOS_VIZ_CONFIG.cellYOffset;
      matrix.setPosition(cell.x, cellMeshY, cell.z);
      mesh.setMatrixAt(i, matrix);

      groundSampleYArr[i] = cell.terrainHeight + LOS_VIZ_CONFIG.groundSampleYOffset;
      airSampleYArr[i]    = cell.terrainHeight + LOS_VIZ_CONFIG.airSampleYOffset;
    }

    const groundAttr = new InstancedBufferAttribute(groundSampleYArr, 1);
    groundAttr.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aGroundSampleY', groundAttr);

    const airAttr = new InstancedBufferAttribute(airSampleYArr, 1);
    airAttr.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aAirSampleY', airAttr);

    mesh.instanceMatrix.needsUpdate = true;

    return {
      mesh,
      tick: (timeSeconds: number) => {
        material.uniforms['uTime'].value = timeSeconds;
      },
      updateMapperReference: (tip: Vector3, far: number) => {
        material.uniforms['uTowerTip'].value.copy(tip);
        material.uniforms['uFarDistance'].value = far;
      },
      dispose: () => {
        geometry.dispose();
        material.dispose();
      },
    };
  }
}
