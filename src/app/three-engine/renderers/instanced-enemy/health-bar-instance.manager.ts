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

const MAX_HEALTH_BARS = 512;

/**
 * HealthBarInstanceManager
 *
 * Renders ALL enemy health bars in a single draw call using InstancedMesh.
 * Each health bar is a PlaneGeometry billboard with a procedural shader
 * that draws a colored health bar based on per-instance healthPercent.
 *
 * Replaces individual Sprites (1 draw call per enemy → 1 draw call total).
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

  // Reusable temp objects
  private readonly matrix = new Matrix4();
  private static readonly _tempPos = new Vector3();
  private static readonly _tempQuat = new Quaternion();
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

    // Hide all initially
    for (let i = 0; i < MAX_HEALTH_BARS; i++) {
      this.matrix.makeTranslation(0, -10000, 0);
      this.instancedMesh.setMatrixAt(i, this.matrix);
    }

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

    // Set initial matrix (position + billboard scale)
    HealthBarInstanceManager._tempPos.copy(position);
    HealthBarInstanceManager._tempPos.y += yOffset;
    HealthBarInstanceManager._tempScale.set(barWidth, barHeight, 1);

    this.matrix.compose(
      HealthBarInstanceManager._tempPos,
      HealthBarInstanceManager._billboardQuat,
      HealthBarInstanceManager._tempScale,
    );
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

    // Update matrix with billboard orientation
    HealthBarInstanceManager._tempPos.copy(position);
    HealthBarInstanceManager._tempPos.y += yOffset;
    HealthBarInstanceManager._tempScale.set(barWidth, barHeight, 1);

    this.matrix.compose(
      HealthBarInstanceManager._tempPos,
      HealthBarInstanceManager._billboardQuat,
      HealthBarInstanceManager._tempScale,
    );
    this.instancedMesh.setMatrixAt(index, this.matrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    // Update health
    this.healthAttribute.setX(index, healthPercent);
    this.healthAttribute.needsUpdate = true;
  }

  /**
   * Update billboard orientation to face camera.
   * Called once per frame before render.
   */
  updateBillboard(camera: Camera): void {
    if (this.instances.size === 0) return;

    // Extract camera quaternion for billboard
    camera.getWorldQuaternion(HealthBarInstanceManager._billboardQuat);

    // Rebuild matrices with new camera quaternion
    for (const [, index] of this.instances) {
      this.instancedMesh.getMatrixAt(index, this.matrix);
      this.matrix.decompose(
        HealthBarInstanceManager._tempPos,
        HealthBarInstanceManager._tempQuat,
        HealthBarInstanceManager._tempScale,
      );

      this.matrix.compose(
        HealthBarInstanceManager._tempPos,
        HealthBarInstanceManager._billboardQuat,
        HealthBarInstanceManager._tempScale,
      );
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

    this.matrix.makeTranslation(0, -10000, 0);
    this.instancedMesh.setMatrixAt(index, this.matrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Remove a health bar instance
   */
  remove(enemyId: string): void {
    const index = this.instances.get(enemyId);
    if (index === undefined) return;

    this.matrix.makeTranslation(0, -10000, 0);
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
    for (const id of Array.from(this.instances.keys())) {
      this.remove(id);
    }
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

          // Bar layout: 5% padding each side
          float barStart = 0.05;
          float barEnd = 0.95;
          float barTop = 0.2;
          float barBottom = 0.8;

          // Background (dark semi-transparent)
          vec4 color = vec4(0.0, 0.0, 0.0, 0.7);

          // Border (1 pixel white)
          float borderSize = 0.03;
          if (vUv.x < borderSize || vUv.x > 1.0 - borderSize ||
              vUv.y < borderSize || vUv.y > 1.0 - borderSize) {
            color = vec4(1.0, 1.0, 1.0, 0.8);
          }

          // Health fill
          float healthWidth = barStart + (barEnd - barStart) * vHealth;
          if (vUv.x >= barStart && vUv.x <= healthWidth &&
              vUv.y >= barTop && vUv.y <= barBottom) {
            vec3 fillColor;
            // Check if fixed color is set (non-zero)
            if (dot(vBarColor, vBarColor) > 0.01) {
              fillColor = vBarColor;
            } else {
              // Dynamic color: green → yellow → red
              if (vHealth > 0.6) {
                fillColor = vec3(0.133, 0.773, 0.369); // #22c55e green
              } else if (vHealth > 0.3) {
                fillColor = vec3(0.918, 0.702, 0.031); // #eab308 yellow
              } else {
                fillColor = vec3(0.937, 0.267, 0.267); // #ef4444 red
              }
            }
            color = vec4(fillColor, 1.0);
          }

          gl_FragColor = color;
        }
      `,
      transparent: true,
      depthTest: false, // Always visible (like the original Sprites)
      side: DoubleSide,
    });
  }
}
