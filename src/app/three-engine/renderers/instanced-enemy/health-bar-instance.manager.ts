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

/**
 * HealthBarInstanceManager
 *
 * Renders ALL enemy health bars in a single draw call using InstancedMesh.
 * Each health bar is a PlaneGeometry billboard with a procedural shader
 * that draws a colored health bar based on per-instance healthPercent.
 *
 * Replaces individual Sprites (1 draw call per enemy → 1 draw call total).
 *
 * Billboard optimization: position and scale are cached in flat arrays
 * so updateBillboard() only needs compose (no decompose per instance).
 */
export class HealthBarInstanceManager {
  readonly instancedMesh: InstancedMesh;

  private instances = new Map<string, number>(); // enemyId → instanceIndex
  private freeIndices: number[] = [];
  private activeCount = 0;

  // Per-instance attributes
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
    const material = this.createMaterial();

    this.instancedMesh = new InstancedMesh(geometry, material, MAX_HEALTH_BARS);
    this.instancedMesh.count = 0;
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.renderOrder = 1000; // Render after everything else

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

    // Position/scale caches
    this.posCache = new Float32Array(MAX_HEALTH_BARS * 3);
    this.scaleCache = new Float32Array(MAX_HEALTH_BARS * 2);

    this.scene.add(this.instancedMesh);
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
    this.instancedMesh.instanceMatrix.needsUpdate = true;

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
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
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
    this.instancedMesh.instanceMatrix.needsUpdate = true;
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
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    this.instances.delete(enemyId);
    this.freeIndices.push(index);
  }

  /**
   * Set visibility of all health bars
   */
  setVisible(visible: boolean): void {
    this.instancedMesh.visible = visible;
  }

  get count(): number {
    return this.instances.size;
  }

  clear(): void {
    this.instances.clear();
    this.freeIndices = [];
    this.activeCount = 0;
    this.instancedMesh.count = 0;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.instancedMesh);
    this.instancedMesh.geometry.dispose();
    (this.instancedMesh.material as ShaderMaterial).dispose();
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

  private createMaterial(): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: /* glsl */ `
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
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        varying float vHealth;
        varying vec3 vBarColor;
        varying float vIsBoss;
        varying vec2 vUv;

        #include <logdepthbuf_pars_fragment>

        void main() {
          #include <logdepthbuf_fragment>

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
            // Use smooth edge for anti-aliasing
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
        }
      `,
      transparent: true,
      depthTest: false, // Always visible (like the original Sprites)
      depthWrite: false, // Don't pollute depth buffer
      side: DoubleSide,
    });
  }
}
