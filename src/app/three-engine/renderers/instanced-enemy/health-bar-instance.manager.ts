import {
  InstancedMesh,
  InstancedBufferAttribute,
  PlaneGeometry,
  ShaderMaterial,
  Matrix4,
  Vector3,
  Quaternion,
  Scene,
  Camera,
  DoubleSide,
} from 'three';

const MAX_HEALTH_BARS = 20000;

// Shared GLSL for the health bar vertex shader
const HEALTH_BAR_VERTEX = /* glsl */ `
  attribute float aHealth;
  attribute vec3 aBarColor;
  attribute float aIsBoss;

  varying float vHealth;
  varying vec3 vBarColor;
  varying float vIsBoss;
  varying vec2 vUv;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vUv = uv;
    vHealth = aHealth;
    vBarColor = aBarColor;
    vIsBoss = aIsBoss;

    vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
    vec4 mvPosition = modelViewMatrix * worldPosition;
    gl_Position = projectionMatrix * mvPosition;

    #include <logdepthbuf_vertex>
  }
`;

// Shared GLSL for the health bar rendering logic (after discard check)
const HEALTH_BAR_BODY = /* glsl */ `
  // Aspect ratio correction (plane is ~6:1)
  float aspect = 6.0;

  // Thin outline in visual pixels (uniform thickness via aspect correction)
  float outlineY = 0.08;           // ~8% of height
  float outlineX = outlineY / aspect; // same visual thickness horizontally

  // Check if we're inside the bar area (with outline)
  bool inBarArea = vUv.x >= outlineX && vUv.x <= 1.0 - outlineX &&
                   vUv.y >= outlineY && vUv.y <= 1.0 - outlineY;

  if (!inBarArea) {
    // Outside bar: thin dark outline
    float dx = min(vUv.x, 1.0 - vUv.x);
    float dy = min(vUv.y, 1.0 - vUv.y);
    float edgeDist = min(dx / outlineX, dy / outlineY);
    float outlineAlpha = smoothstep(0.0, 0.5, edgeDist) * 0.6;
    gl_FragColor = vec4(0.0, 0.0, 0.0, outlineAlpha);
    return;
  }

  // Inside bar area: health fill or empty background
  float innerX = (vUv.x - outlineX) / (1.0 - 2.0 * outlineX);
  float healthFill = step(innerX, vHealth);

  if (healthFill > 0.5) {
    // Health fill color
    vec3 fillColor;
    if (dot(vBarColor, vBarColor) > 0.01) {
      fillColor = vBarColor;
    } else {
      // Dynamic: green → yellow → red
      if (vHealth > 0.6) {
        fillColor = vec3(0.133, 0.773, 0.369); // #22c55e
      } else if (vHealth > 0.3) {
        fillColor = vec3(0.918, 0.702, 0.031); // #eab308
      } else {
        fillColor = vec3(0.937, 0.267, 0.267); // #ef4444
      }
    }
    gl_FragColor = vec4(fillColor, 0.9);
  } else {
    // Empty part: dark background
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.4);
  }
`;

/**
 * HealthBarInstanceManager
 *
 * Renders ALL enemy health bars using InstancedMesh.
 * Two render passes sharing the same geometry & attributes:
 *   1) Background (renderOrder 999): all bars, depthTest true
 *   2) Foreground (renderOrder 1000): damaged bars only, depthTest false
 *
 * This ensures full-health bars render normally while damaged bars
 * are always visible in the foreground.
 *
 * Billboard optimization: position and scale are cached in flat arrays
 * so updateBillboard() only needs compose (no decompose per instance).
 */
export class HealthBarInstanceManager {
  /** Background pass — all bars with depth test */
  readonly instancedMesh: InstancedMesh;
  /** Foreground pass — damaged bars only, always on top */
  private readonly foregroundMesh: InstancedMesh;

  private instances = new Map<string, number>(); // enemyId → instanceIndex
  private freeIndices: number[] = [];
  private activeCount = 0;

  // Per-instance attributes (shared between both meshes via same geometry)
  private healthAttribute: InstancedBufferAttribute;
  private barColorAttribute: InstancedBufferAttribute; // fixed color override (boss etc.)
  private isBossAttribute: InstancedBufferAttribute;

  // Cached position/scale per slot (avoids decompose in updateBillboard)
  private readonly posCache: Float32Array;   // [x, y, z] per slot
  private readonly scaleCache: Float32Array; // [w, h] per slot

  // Reusable temp objects
  private readonly matrix = new Matrix4();
  private static readonly _tempPos = new Vector3();
  private static readonly _tempScale = new Vector3();
  private static readonly _billboardQuat = new Quaternion();

  constructor(private readonly scene: Scene) {
    const geometry = new PlaneGeometry(1, 1);

    // Per-instance attributes
    const healthData = new Float32Array(MAX_HEALTH_BARS);
    const barColorData = new Float32Array(MAX_HEALTH_BARS * 3);
    const isBossData = new Float32Array(MAX_HEALTH_BARS);

    this.healthAttribute = new InstancedBufferAttribute(healthData, 1);
    this.barColorAttribute = new InstancedBufferAttribute(barColorData, 3);
    this.isBossAttribute = new InstancedBufferAttribute(isBossData, 1);

    geometry.setAttribute('aHealth', this.healthAttribute);
    geometry.setAttribute('aBarColor', this.barColorAttribute);
    geometry.setAttribute('aIsBoss', this.isBossAttribute);

    // Pass 1: Background — all bars, depth tested (occluded by terrain normally)
    const bgMaterial = this.createMaterial(false);
    this.instancedMesh = new InstancedMesh(geometry, bgMaterial, MAX_HEALTH_BARS);
    this.instancedMesh.count = 0;
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.renderOrder = 999;

    // Pass 2: Foreground — damaged bars only, always on top
    const fgMaterial = this.createMaterial(true);
    this.foregroundMesh = new InstancedMesh(geometry, fgMaterial, MAX_HEALTH_BARS);
    this.foregroundMesh.count = 0;
    this.foregroundMesh.frustumCulled = false;
    this.foregroundMesh.renderOrder = 1000;

    // Position/scale caches
    this.posCache = new Float32Array(MAX_HEALTH_BARS * 3);
    this.scaleCache = new Float32Array(MAX_HEALTH_BARS * 2);

    this.scene.add(this.instancedMesh);
    this.scene.add(this.foregroundMesh);
  }

  /**
   * Add a health bar for an enemy
   */
  add(
    enemyId: string,
    position: Vector3,
    yOffset: number,
    isBoss: boolean,
    fixedColor: { r: number; g: number; b: number } | null,
    barWidth: number,
    barHeight: number,
  ): void {
    if (this.instances.has(enemyId)) return;

    let index: number;
    if (this.freeIndices.length > 0) {
      index = this.freeIndices.pop()!;
    } else {
      index = this.activeCount;
    }

    this.instances.set(enemyId, index);
    this.activeCount = Math.max(this.activeCount, index + 1);
    this.instancedMesh.count = this.activeCount;
    this.foregroundMesh.count = this.activeCount;

    // Cache position and scale
    const pi = index * 3;
    this.posCache[pi] = position.x;
    this.posCache[pi + 1] = position.y + yOffset;
    this.posCache[pi + 2] = position.z;
    const si = index * 2;
    this.scaleCache[si] = barWidth;
    this.scaleCache[si + 1] = barHeight;

    // Build matrix
    this.composeFromCache(index);
    this.instancedMesh.setMatrixAt(index, this.matrix);
    this.foregroundMesh.setMatrixAt(index, this.matrix);

    // Set attributes
    this.healthAttribute.setX(index, 1.0);
    this.isBossAttribute.setX(index, isBoss ? 1.0 : 0.0);

    if (fixedColor) {
      this.barColorAttribute.setXYZ(index, fixedColor.r, fixedColor.g, fixedColor.b);
    } else {
      // 0,0,0 = use dynamic green→yellow→red
      this.barColorAttribute.setXYZ(index, 0, 0, 0);
    }

    this.healthAttribute.needsUpdate = true;
    this.barColorAttribute.needsUpdate = true;
    this.isBossAttribute.needsUpdate = true;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.foregroundMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Update health bar position and health value
   */
  update(
    enemyId: string,
    position: Vector3,
    yOffset: number,
    healthPercent: number,
    barWidth: number,
    barHeight: number,
  ): void {
    const index = this.instances.get(enemyId);
    if (index === undefined) return;

    // Update cache
    const pi = index * 3;
    this.posCache[pi] = position.x;
    this.posCache[pi + 1] = position.y + yOffset;
    this.posCache[pi + 2] = position.z;
    const si = index * 2;
    this.scaleCache[si] = barWidth;
    this.scaleCache[si + 1] = barHeight;

    // Rebuild matrix from cache
    this.composeFromCache(index);
    this.instancedMesh.setMatrixAt(index, this.matrix);
    this.foregroundMesh.setMatrixAt(index, this.matrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.foregroundMesh.instanceMatrix.needsUpdate = true;

    // Update health
    this.healthAttribute.setX(index, healthPercent);
    this.healthAttribute.needsUpdate = true;
  }

  /**
   * Update billboard orientation to face camera.
   * Called once per frame before render.
   * Uses cached position/scale — no decompose needed.
   */
  updateBillboard(camera: Camera): void {
    if (this.instances.size === 0) return;

    // Extract camera quaternion for billboard
    camera.getWorldQuaternion(HealthBarInstanceManager._billboardQuat);

    // Rebuild matrices from cache with new billboard quaternion (no decompose)
    for (const [, index] of this.instances) {
      this.composeFromCache(index);
      this.instancedMesh.setMatrixAt(index, this.matrix);
      this.foregroundMesh.setMatrixAt(index, this.matrix);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.foregroundMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Hide a health bar (e.g. on enemy death)
   */
  hide(enemyId: string): void {
    const index = this.instances.get(enemyId);
    if (index === undefined) return;

    // Update cache to hidden position
    const pi = index * 3;
    this.posCache[pi] = 0;
    this.posCache[pi + 1] = -10000;
    this.posCache[pi + 2] = 0;

    this.composeFromCache(index);
    this.instancedMesh.setMatrixAt(index, this.matrix);
    this.foregroundMesh.setMatrixAt(index, this.matrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.foregroundMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Remove a health bar instance
   */
  remove(enemyId: string): void {
    const index = this.instances.get(enemyId);
    if (index === undefined) return;

    // Update cache to hidden position
    const pi = index * 3;
    this.posCache[pi] = 0;
    this.posCache[pi + 1] = -10000;
    this.posCache[pi + 2] = 0;

    this.composeFromCache(index);
    this.instancedMesh.setMatrixAt(index, this.matrix);
    this.foregroundMesh.setMatrixAt(index, this.matrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.foregroundMesh.instanceMatrix.needsUpdate = true;

    this.instances.delete(enemyId);
    this.freeIndices.push(index);
  }

  /**
   * Set visibility of all health bars
   */
  setVisible(visible: boolean): void {
    this.instancedMesh.visible = visible;
    this.foregroundMesh.visible = visible;
  }

  get count(): number {
    return this.instances.size;
  }

  clear(): void {
    this.instances.clear();
    this.freeIndices = [];
    this.activeCount = 0;
    this.instancedMesh.count = 0;
    this.foregroundMesh.count = 0;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.instancedMesh);
    this.scene.remove(this.foregroundMesh);
    this.instancedMesh.geometry.dispose();
    (this.instancedMesh.material as ShaderMaterial).dispose();
    (this.foregroundMesh.material as ShaderMaterial).dispose();
  }

  // =====================================================
  // PRIVATE
  // =====================================================

  /** Compose matrix from cached position + scale + current billboard quaternion */
  private composeFromCache(index: number): void {
    const pi = index * 3;
    const si = index * 2;
    HealthBarInstanceManager._tempPos.set(
      this.posCache[pi],
      this.posCache[pi + 1],
      this.posCache[pi + 2],
    );
    HealthBarInstanceManager._tempScale.set(
      this.scaleCache[si],
      this.scaleCache[si + 1],
      1,
    );
    this.matrix.compose(
      HealthBarInstanceManager._tempPos,
      HealthBarInstanceManager._billboardQuat,
      HealthBarInstanceManager._tempScale,
    );
  }

  // =====================================================
  // SHADER
  // =====================================================

  /**
   * Create health bar material.
   * @param foregroundOnly If true, discards full-health bars (foreground pass)
   */
  private createMaterial(foregroundOnly: boolean): ShaderMaterial {
    const discardLine = foregroundOnly
      ? 'if (vHealth >= 0.999) discard;'
      : '';

    return new ShaderMaterial({
      vertexShader: HEALTH_BAR_VERTEX,
      fragmentShader: /* glsl */ `
        precision highp float;

        varying float vHealth;
        varying vec3 vBarColor;
        varying float vIsBoss;
        varying vec2 vUv;

        #include <logdepthbuf_pars_fragment>

        void main() {
          #include <logdepthbuf_fragment>

          ${discardLine}

          ${HEALTH_BAR_BODY}
        }
      `,
      transparent: true,
      depthTest: !foregroundOnly,
      depthWrite: false,
      side: DoubleSide,
    });
  }
}
