import {
  InstancedMesh,
  InstancedBufferAttribute,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  Scene,
  Camera,
  DoubleSide,
} from 'three';

const MAX_HEALTH_BARS = 20000;

// Shared GLSL for the health bar vertex shader.
//
// G3 (full): the billboard is built entirely on the GPU. Position and size are
// per-instance attributes; the quad is oriented to face the camera via the
// uCameraRight / uCameraUp uniforms (same pattern as FloatingText). Per frame
// the manager only writes 2 uniforms + the moving aCenter buffer — no Matrix4
// compose and no full instanceMatrix upload per instance.
const HEALTH_BAR_VERTEX = /* glsl */ `
  attribute vec3 aCenter;   // world-space (scene-local) bar center
  attribute vec2 aSize;     // bar width / height; aSize.x <= 0 → hidden slot
  attribute float aHealth;
  attribute vec3 aBarColor;
  attribute float aIsBoss;

  uniform vec3 uCameraRight;
  uniform vec3 uCameraUp;

  varying float vHealth;
  varying vec3 vBarColor;
  varying float vIsBoss;
  varying vec2 vUv;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    // Hidden / free slots collapse to a clipped vertex so they never rasterize.
    if (aSize.x <= 0.0) {
      gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      vUv = vec2(0.0);
      vHealth = 0.0;
      vBarColor = vec3(0.0);
      vIsBoss = 0.0;
      return;
    }

    vUv = uv;
    vHealth = aHealth;
    vBarColor = aBarColor;
    vIsBoss = aIsBoss;

    // Billboard: offset the unit-quad vertex (position.xy ∈ [-0.5, 0.5] from
    // PlaneGeometry(1,1)) along the camera-aligned axes. The InstancedMesh root
    // sits at the origin (identity), so aCenter is already in world space.
    vec3 worldPos = aCenter
                  + uCameraRight * (position.x * aSize.x)
                  + uCameraUp    * (position.y * aSize.y);

    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
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
 * G3 billboard optimization (full): orientation happens in the vertex shader
 * from uCameraRight / uCameraUp. Per slot we keep only the world center
 * (aCenter) and size (aSize) as instanced attributes — updateBillboard() sets
 * 2 uniforms and flushes the moving aCenter buffer instead of composing a
 * Matrix4 + uploading instanceMatrix per instance.
 */
export class HealthBarInstanceManager {
  /** Background pass — all bars with depth test */
  readonly instancedMesh: InstancedMesh;
  /** Foreground pass — damaged bars only, always on top */
  private readonly foregroundMesh: InstancedMesh;

  private instances = new Map<string, number>(); // enemyId → instanceIndex
  private freeIndices: number[] = [];
  private activeCount = 0;

  // Per-instance attributes (shared between both meshes via the same geometry)
  private centerAttribute: InstancedBufferAttribute; // world center (x, y, z)
  private sizeAttribute: InstancedBufferAttribute;   // width, height (0 = hidden)
  private healthAttribute: InstancedBufferAttribute;
  private barColorAttribute: InstancedBufferAttribute; // fixed color override (boss etc.)
  private isBossAttribute: InstancedBufferAttribute;

  // Billboard axes, shared by reference with both materials' uniforms so a
  // single set per frame updates both passes.
  private readonly cameraRight = new Vector3(1, 0, 0);
  private readonly cameraUp = new Vector3(0, 1, 0);

  // Dirty flags for batched per-frame uploads
  private centerDirty = false;
  private healthDirty = false;

  constructor(private readonly scene: Scene) {
    const geometry = new PlaneGeometry(1, 1);

    // Per-instance attributes
    const centerData = new Float32Array(MAX_HEALTH_BARS * 3);
    const sizeData = new Float32Array(MAX_HEALTH_BARS * 2); // 0 → hidden by default
    const healthData = new Float32Array(MAX_HEALTH_BARS);
    const barColorData = new Float32Array(MAX_HEALTH_BARS * 3);
    const isBossData = new Float32Array(MAX_HEALTH_BARS);

    this.centerAttribute = new InstancedBufferAttribute(centerData, 3);
    this.sizeAttribute = new InstancedBufferAttribute(sizeData, 2);
    this.healthAttribute = new InstancedBufferAttribute(healthData, 1);
    this.barColorAttribute = new InstancedBufferAttribute(barColorData, 3);
    this.isBossAttribute = new InstancedBufferAttribute(isBossData, 1);

    geometry.setAttribute('aCenter', this.centerAttribute);
    geometry.setAttribute('aSize', this.sizeAttribute);
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

    // Both roots stay at the identity origin (position comes from aCenter), so
    // their world matrix never changes → skip the per-frame matrixWorld pass
    // (R1). instanceMatrix is unused by the shader.
    this.instancedMesh.matrixAutoUpdate = false;
    this.instancedMesh.matrixWorldAutoUpdate = false;
    this.instancedMesh.updateMatrix();
    this.foregroundMesh.matrixAutoUpdate = false;
    this.foregroundMesh.matrixWorldAutoUpdate = false;
    this.foregroundMesh.updateMatrix();

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

    // Position + size
    this.centerAttribute.setXYZ(index, position.x, position.y + yOffset, position.z);
    this.sizeAttribute.setXY(index, barWidth, barHeight);

    // Health + color
    this.healthAttribute.setX(index, 1.0);
    this.isBossAttribute.setX(index, isBoss ? 1.0 : 0.0);
    if (fixedColor) {
      this.barColorAttribute.setXYZ(index, fixedColor.r, fixedColor.g, fixedColor.b);
    } else {
      // 0,0,0 = use dynamic green→yellow→red
      this.barColorAttribute.setXYZ(index, 0, 0, 0);
    }

    this.centerAttribute.needsUpdate = true;
    this.sizeAttribute.needsUpdate = true;
    this.healthAttribute.needsUpdate = true;
    this.barColorAttribute.needsUpdate = true;
    this.isBossAttribute.needsUpdate = true;
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

    // Position moves every frame → write into the instanced buffer; flushed
    // once per frame in updateBillboard().
    this.centerAttribute.setXYZ(index, position.x, position.y + yOffset, position.z);
    this.centerDirty = true;

    // Size may change (debug offset / scaling); cheap to keep in sync.
    this.sizeAttribute.setXY(index, barWidth, barHeight);
    this.sizeAttribute.needsUpdate = true;

    this.healthAttribute.setX(index, healthPercent);
    this.healthDirty = true;
  }

  /**
   * Update billboard orientation to face camera and flush dirty buffers.
   * Called once per frame before render. No per-instance compose — just two
   * uniform writes (shared by both passes) and at most two buffer flushes.
   */
  updateBillboard(camera: Camera): void {
    if (this.instances.size === 0) return;

    // Camera right (col 0) and up (col 1) from the world matrix.
    const e = camera.matrixWorld.elements;
    this.cameraRight.set(e[0], e[1], e[2]);
    this.cameraUp.set(e[4], e[5], e[6]);

    if (this.centerDirty) {
      this.centerAttribute.needsUpdate = true;
      this.centerDirty = false;
    }
    if (this.healthDirty) {
      this.healthAttribute.needsUpdate = true;
      this.healthDirty = false;
    }
  }

  /**
   * Hide a health bar (e.g. on enemy death)
   */
  hide(enemyId: string): void {
    const index = this.instances.get(enemyId);
    if (index === undefined) return;

    // Zero size → shader collapses the slot offscreen.
    this.sizeAttribute.setXY(index, 0, 0);
    this.sizeAttribute.needsUpdate = true;
  }

  /**
   * Remove a health bar instance
   */
  remove(enemyId: string): void {
    const index = this.instances.get(enemyId);
    if (index === undefined) return;

    this.sizeAttribute.setXY(index, 0, 0);
    this.sizeAttribute.needsUpdate = true;

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
    // Reset all sizes to hidden so stale slots never reappear after reuse.
    (this.sizeAttribute.array as Float32Array).fill(0);
    this.sizeAttribute.needsUpdate = true;
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
      uniforms: {
        // Shared Vector3 instances → one set per frame updates both passes.
        uCameraRight: { value: this.cameraRight },
        uCameraUp: { value: this.cameraUp },
      },
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
