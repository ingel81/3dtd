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
 * Die Layer enthält ZWEI InstancedMeshes:
 *  - `groundMesh` auf `terrainHeight + cellYOffset` (flache Plates)
 *  - `airMesh` auf `terrainHeight + airSampleYOffset` (gestreifte Plates)
 *
 * Beide nutzen dasselbe Shader-Material (mit `uIsAirLayer` Branch) und
 * dieselben Cell-State-Uniforms — d.h. dieselbe Cell ist auf beiden
 * Layern denselben State (z.B. `airOnly` → cyan auf BEIDEN), aber das
 * Air-Mesh ist elevated und mit Stripes overlaid um beide Layer im 3D
 * unterscheidbar zu machen.
 */
export interface TowerLosLayer {
  /** Ground-Layer InstancedMesh (auf Boden-Niveau). */
  groundMesh: InstancedMesh;
  /** Air-Layer InstancedMesh (auf +airSampleYOffset, mit Stripe-Pattern). */
  airMesh: InstancedMesh;
  /** Animation-Tick — refresht das `uTime`-Uniform für Pulse. */
  tick(timeSeconds: number): void;
  /**
   * Tower-Tip / Far-Distance updaten ohne Mesh-Rebuild — der Caller
   * ruft das auf, nachdem der Mapper die Cubemap neu gerendert hat
   * (z.B. bei Build-Preview-Mouse-Move).
   */
  updateMapperReference(towerTip: Vector3, cubemapFarDistance: number): void;
  /**
   * Filter-Mode setzen: 'both' / 'ground' / 'air' — steuert sowohl
   * Mesh-Visibility (hidden mesh in single-layer modes) als auch die
   * Shader-Paletten-Reduktion (4-state → 2-state).
   */
  setFilterMode(mode: 'both' | 'ground' | 'air'): void;
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

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vec4 worldPos4 = modelMatrix * instanceMatrix * vec4(position, 1.0);

    // Cell-Center == 4. Spalte der instanceMatrix (Translation), in
    // Welt-Koordinaten via modelMatrix.
    vec4 center4 = modelMatrix * vec4(instanceMatrix[3].xyz, 1.0);
    vCellCenterWorld = center4.xyz;

    vGroundSampleY = aGroundSampleY;
    vAirSampleY = aAirSampleY;

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
  uniform float uGroundRange;
  uniform float uAirRange;
  uniform float uHasGround;
  uniform float uHasAir;
  uniform float uVisibilityBias;
  uniform float uEmptyDepthEpsilon;
  uniform float uTime;
  uniform float uPulseSpeed;
  uniform float uPulseDepth;

  // Layer mode: 0 = ground plate, 1 = air plate (no texture difference,
  // just used for the air-alpha-scale).
  uniform float uIsAirLayer;
  uniform float uAirAlphaScale;
  // Filter-Mode: 0 = both (4-state), 1 = ground-only, 2 = air-only.
  // In single-layer modes the shader collapses to a 2-state palette
  // (covered → green/blue, blocked → red) — single source of truth for
  // the per-tower coloring.
  uniform float uFilterMode;

  uniform vec3  uColorBoth;       uniform float uAlphaBoth;
  uniform vec3  uColorGroundOnly; uniform float uAlphaGroundOnly;
  uniform vec3  uColorAirOnly;    uniform float uAlphaAirOnly;
  uniform vec3  uColorNeither;    uniform float uAlphaNeither;

  varying vec3 vCellCenterWorld;
  varying float vGroundSampleY;
  varying float vAirSampleY;

  // Vorwärts-Deklaration des isVisible/sampleBlockerDistance erfolgt
  // weiter unten; logdepthbuf_fragment wird im main() VOR jeglicher
  // Diskardierung eingebunden damit gl_FragDepth korrekt geschrieben
  // wird.

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
    #include <logdepthbuf_fragment>
    vec3 groundSampleWorld = vec3(vCellCenterWorld.x, vGroundSampleY, vCellCenterWorld.z);
    vec3 airSampleWorld    = vec3(vCellCenterWorld.x, vAirSampleY,    vCellCenterWorld.z);

    bool groundVis = (uHasGround > 0.5) && isVisible(groundSampleWorld);
    bool airVis    = (uHasAir > 0.5)    && isVisible(airSampleWorld);

    // Range-Falloff: horizontale Distanz zum Tower
    float horizDist = length(vCellCenterWorld.xz - uTowerTip.xz);
    if (horizDist > uGroundRange) groundVis = false;
    if (horizDist > uAirRange)    airVis = false;

    vec3 color;
    float alpha;
    if (uFilterMode < 0.5) {
      // Both — 4-State: gold (both) / green (ground) / blue (air) / red (blocked)
      if (groundVis && airVis) {
        color = uColorBoth;       alpha = uAlphaBoth;
      } else if (groundVis) {
        color = uColorGroundOnly; alpha = uAlphaGroundOnly;
      } else if (airVis) {
        color = uColorAirOnly;    alpha = uAlphaAirOnly;
      } else {
        color = uColorNeither;    alpha = uAlphaNeither;
      }
    } else if (uFilterMode < 1.5) {
      // Ground-only — 2-State: green (covered) / red (blocked)
      if (groundVis) {
        color = uColorGroundOnly; alpha = uAlphaGroundOnly;
      } else {
        color = uColorNeither;    alpha = uAlphaNeither;
      }
    } else {
      // Air-only — 2-State: blue (covered) / red (blocked)
      if (airVis) {
        color = uColorAirOnly;    alpha = uAlphaAirOnly;
      } else {
        color = uColorNeither;    alpha = uAlphaNeither;
      }
    }

    float pulse = sin(uTime * uPulseSpeed) * uPulseDepth + (1.0 - uPulseDepth * 0.5);
    float finalAlpha = alpha * pulse;
    if (uIsAirLayer > 0.5) finalAlpha *= uAirAlphaScale;
    gl_FragColor = vec4(color, finalAlpha);
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

    // Beide Layer teilen sich die LOS-State-Uniforms (Cubemap, Tower-
    // Tip, 4-State-Farben). Pro Layer ein eigenes Material — sonst
    // würde uIsAirLayer für beide Meshes simultan ein- oder ausgeschaltet.
    const buildMaterial = (isAirLayer: boolean): ShaderMaterial => new ShaderMaterial({
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

        uIsAirLayer:           { value: isAirLayer ? 1 : 0 },
        uAirAlphaScale:        { value: airCfg.alphaScale },
        uFilterMode:           { value: 0 },  // 0=both, set by setFilterMode

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

    const groundMaterial = buildMaterial(false);
    const airMaterial = buildMaterial(true);

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

    // Ground- und Air-Mesh teilen sich KEINE Geometry (jedes Mesh hat
    // sein eigenes Geometry-Objekt damit die instance-attributes
    // unabhängig bleiben würden falls man später per-Layer-Attribute
    // einführt). Beide tragen die selben aGroundSampleY/aAirSampleY-
    // Attribute, denn der Shader sampelt BEIDE pro Cell.
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
    airMesh.renderOrder = 4;  // Air zuletzt damit Stripes über Ground sichtbar bleiben
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
      // EXAKT wo die Cubemap-Sample-Position liegt.
      const airMeshY = cell.terrainHeight + LOS_VIZ_CONFIG.airSampleYOffset;
      matrix.setPosition(cell.x, airMeshY, cell.z);
      airMesh.setMatrixAt(i, matrix);

      groundSampleYArr[i] = cell.terrainHeight + LOS_VIZ_CONFIG.groundSampleYOffset;
      airSampleYArr[i]    = cell.terrainHeight + LOS_VIZ_CONFIG.airSampleYOffset;
    }

    // beide Meshes brauchen aGroundSampleY/aAirSampleY damit der Shader
    // die Cell-State per LOS-Cubemap-Sample berechnen kann — Air-Mesh
    // soll dieselbe State-Farbe zeigen wie das darunter liegende Ground-
    // Mesh (consistent legibility), nur elevated + striped.
    const groundAttrA = new InstancedBufferAttribute(groundSampleYArr, 1);
    groundAttrA.setUsage(DynamicDrawUsage);
    groundGeometry.setAttribute('aGroundSampleY', groundAttrA);

    const airAttrA = new InstancedBufferAttribute(airSampleYArr, 1);
    airAttrA.setUsage(DynamicDrawUsage);
    groundGeometry.setAttribute('aAirSampleY', airAttrA);

    const groundAttrB = new InstancedBufferAttribute(groundSampleYArr, 1);
    groundAttrB.setUsage(DynamicDrawUsage);
    airGeometry.setAttribute('aGroundSampleY', groundAttrB);

    const airAttrB = new InstancedBufferAttribute(airSampleYArr, 1);
    airAttrB.setUsage(DynamicDrawUsage);
    airGeometry.setAttribute('aAirSampleY', airAttrB);

    groundMesh.instanceMatrix.needsUpdate = true;
    airMesh.instanceMatrix.needsUpdate = true;

    losPerf.sample('mesh/build', performance.now() - tBuildStart, cells.length);

    return {
      groundMesh,
      airMesh,
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
      setFilterMode: (mode: 'both' | 'ground' | 'air') => {
        const modeNum = mode === 'both' ? 0 : mode === 'ground' ? 1 : 2;
        groundMaterial.uniforms['uFilterMode'].value = modeNum;
        airMaterial.uniforms['uFilterMode'].value = modeNum;
        // Hide the irrelevant mesh in single-layer modes — saves draw
        // calls and keeps the 3D-stack visually focused.
        groundMesh.visible = mode !== 'air';
        airMesh.visible = mode !== 'ground';
      },
      dispose: () => {
        groundGeometry.dispose();
        airGeometry.dispose();
        groundMaterial.dispose();
        airMaterial.dispose();
      },
    };
  }
}
