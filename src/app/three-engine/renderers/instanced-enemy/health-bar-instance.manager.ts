import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  Scene,
  Camera,
  DoubleSide,
} from 'three';
import { InstanceSlotAllocator } from '../instance-slot-allocator';
import { DrawGate } from '../draw-gate';
import { DISPLAY_OUTPUT_GLSL } from '../display-output';
import { createPortalClipUniforms, PORTAL_CLIP_GLSL, type PortalClipUniforms } from '../portal-clip';

const MAX_HEALTH_BARS = 20000;

// Shared GLSL for the health bar vertex shader.
//
// G3 (full): the billboard is built entirely on the GPU. Position and size are
// per-instance attributes; the quad is oriented to face the camera via the
// uCameraRight / uCameraUp uniforms (same pattern as FloatingText). Per frame
// the manager only writes 2 uniforms + the moving aCenter buffer — no Matrix4
// compose and no full instanceMatrix upload per instance. A bar whose centre
// is still behind a spawn portal's plane is collapsed like a hidden one
// (portal-clip.ts): it shows whole once its enemy's origin is through.
const HEALTH_BAR_VERTEX = /* glsl */ `
  attribute vec3 aCenter;   // world-space (scene-local) bar center
  attribute vec2 aSize;     // bar width / height; aSize.x <= 0 → hidden slot
  attribute float aHealth;
  attribute vec3 aBarColor;

  uniform vec3 uCameraRight;
  uniform vec3 uCameraUp;

  varying float vHealth;
  varying vec3 vBarColor;
  varying vec2 vUv;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  ${PORTAL_CLIP_GLSL}

  void main() {
    // Hidden / free slots and bars behind a portal's plane collapse to a
    // clipped vertex so they never rasterize.
    if (aSize.x <= 0.0 || portalClipAhead(aCenter) < 0.0) {
      gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      vUv = vec2(0.0);
      vHealth = 0.0;
      vBarColor = vec3(0.0);
      return;
    }

    vUv = uv;
    vHealth = aHealth;
    vBarColor = aBarColor;

    // Billboard: offset the unit-quad vertex (position.xy ∈ [-0.5, 0.5] from
    // PlaneGeometry(1,1)) along the camera-aligned axes. The mesh root sits
    // at the origin (identity), so aCenter is already in world space.
    vec3 worldPos = aCenter
                  + uCameraRight * (position.x * aSize.x)
                  + uCameraUp    * (position.y * aSize.y);

    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    #include <logdepthbuf_vertex>
  }
`;

// Shared GLSL for the health bar rendering logic (after discard check). The
// fill colours are display values, written for the target (displayOutput,
// display-output.ts), so a bar looks alike with and without bloom; black is
// black in either target and is written as it is.
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
    gl_FragColor = vec4(displayOutput(fillColor), 0.9);
  } else {
    // Empty part: dark background
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.4);
  }
`;

/**
 * HealthBarInstanceManager
 *
 * Renders ALL enemy health bars with GPU instancing.
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
 *
 * The passes are plain Meshes over one InstancedBufferGeometry, not
 * InstancedMeshes: the shader never reads instanceMatrix, and an
 * InstancedMesh allocates and uploads one anyway (20 000 × 16 floats,
 * 1.28 MB per pass). geometry.instanceCount is the draw count of both.
 */
export class HealthBarInstanceManager {
  /** Shared by both passes; instanceCount is their draw count. */
  private readonly geometry: InstancedBufferGeometry;
  /** Background pass, all bars with depth test */
  private readonly backgroundMesh: Mesh;
  /** Foreground pass, damaged bars only, always on top */
  private readonly foregroundMesh: Mesh;
  /** Hides both passes while no bar is drawn (R6); setVisible() goes through it. */
  private readonly gate: DrawGate;

  private instances = new Map<string, number>(); // enemyId → instanceIndex
  private readonly slots = new InstanceSlotAllocator(MAX_HEALTH_BARS);

  // Per-instance attributes (shared between both meshes via the same geometry)
  private centerAttribute: InstancedBufferAttribute; // world center (x, y, z)
  private sizeAttribute: InstancedBufferAttribute;   // width, height (0 = hidden)
  private healthAttribute: InstancedBufferAttribute;
  private barColorAttribute: InstancedBufferAttribute; // fixed color override (boss etc.)

  // Billboard axes, shared by reference with both materials' uniforms so a
  // single set per frame updates both passes.
  private readonly cameraRight = new Vector3(1, 0, 0);
  private readonly cameraUp = new Vector3(0, 1, 0);

  // Dirty flags for batched per-frame uploads
  private centerDirty = false;
  private healthDirty = false;

  /**
   * 1 = slot deliberately hidden (enemy died). `update()` skips those slots
   * entirely, so a per-frame call for a corpse neither resurrects the bar nor
   * piles up update ranges. Only `add()` clears the flag — the GLOBAL
   * health-bar toggle is mesh-level (`setVisible`), not per slot.
   */
  private readonly hiddenFlags = new Uint8Array(MAX_HEALTH_BARS);

  /** @param portalClip The spawn portals' clip, shared with the enemies (portal-clip.ts) */
  constructor(
    private readonly scene: Scene,
    private readonly portalClip: PortalClipUniforms = createPortalClipUniforms(),
  ) {
    // Unit quad for the billboard; the shaders read only position and uv.
    const plane = new PlaneGeometry(1, 1);
    const geometry = new InstancedBufferGeometry();
    geometry.setIndex(plane.getIndex());
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.setAttribute('uv', plane.getAttribute('uv'));
    geometry.instanceCount = 0;
    this.geometry = geometry;

    // Per-instance attributes
    const centerData = new Float32Array(MAX_HEALTH_BARS * 3);
    const sizeData = new Float32Array(MAX_HEALTH_BARS * 2); // 0 → hidden by default
    const healthData = new Float32Array(MAX_HEALTH_BARS);
    const barColorData = new Float32Array(MAX_HEALTH_BARS * 3);

    this.centerAttribute = new InstancedBufferAttribute(centerData, 3);
    this.sizeAttribute = new InstancedBufferAttribute(sizeData, 2);
    this.healthAttribute = new InstancedBufferAttribute(healthData, 1);
    this.barColorAttribute = new InstancedBufferAttribute(barColorData, 3);

    geometry.setAttribute('aCenter', this.centerAttribute);
    geometry.setAttribute('aSize', this.sizeAttribute);
    geometry.setAttribute('aHealth', this.healthAttribute);
    geometry.setAttribute('aBarColor', this.barColorAttribute);

    // Pass 1: Background — all bars, depth tested (occluded by terrain normally)
    // frustumCulled stays off on both passes: the geometry's bounding sphere
    // is the unit quad at the origin, not where the bars are.
    const bgMaterial = this.createMaterial(false);
    this.backgroundMesh = new Mesh(geometry, bgMaterial);
    this.backgroundMesh.frustumCulled = false;
    this.backgroundMesh.renderOrder = 999;

    // Pass 2: Foreground — damaged bars only, always on top
    const fgMaterial = this.createMaterial(true);
    this.foregroundMesh = new Mesh(geometry, fgMaterial);
    this.foregroundMesh.frustumCulled = false;
    this.foregroundMesh.renderOrder = 1000;

    // Both roots stay at the identity origin (position comes from aCenter), so
    // their world matrix never changes → skip the per-frame matrixWorld pass
    // (R1).
    this.backgroundMesh.matrixAutoUpdate = false;
    this.backgroundMesh.matrixWorldAutoUpdate = false;
    this.backgroundMesh.updateMatrix();
    this.foregroundMesh.matrixAutoUpdate = false;
    this.foregroundMesh.matrixWorldAutoUpdate = false;
    this.foregroundMesh.updateMatrix();

    this.gate = new DrawGate([this.backgroundMesh, this.foregroundMesh]);
    this.scene.add(this.backgroundMesh);
    this.scene.add(this.foregroundMesh);
  }

  /**
   * Add a health bar for an enemy. Returns its slot index (the existing one
   * if the enemy already has a bar), or -1 when all MAX_HEALTH_BARS slots
   * are taken.
   */
  add(
    enemyId: string,
    position: Vector3,
    yOffset: number,
    fixedColor: { r: number; g: number; b: number } | null,
    barWidth: number,
    barHeight: number,
  ): number {
    const existing = this.instances.get(enemyId);
    if (existing !== undefined) return existing;

    const index = this.slots.alloc();
    if (index < 0) return -1;

    this.instances.set(enemyId, index);
    this.syncDrawCount();

    // Position + size
    this.hiddenFlags[index] = 0;
    this.centerAttribute.setXYZ(index, position.x, position.y + yOffset, position.z);
    this.sizeAttribute.setXY(index, barWidth, barHeight);

    // Health + color
    this.healthAttribute.setX(index, 1.0);
    if (fixedColor) {
      this.barColorAttribute.setXYZ(index, fixedColor.r, fixedColor.g, fixedColor.b);
    } else {
      // 0,0,0 = use dynamic green→yellow→red
      this.barColorAttribute.setXYZ(index, 0, 0, 0);
    }

    // Center and health go out with the frame flush in updateBillboard().
    // The rest has none and queues just this slot (without a range Three.js
    // re-uploads the full MAX_HEALTH_BARS-sized buffer on needsUpdate).
    this.centerDirty = true;
    this.healthDirty = true;
    this.slots.uploadSlot(this.sizeAttribute, index);
    this.slots.uploadSlot(this.barColorAttribute, index);
    return index;
  }

  /**
   * Update health bar position and health value by slot index: the index
   * add() returned, which the caller keeps (InstancedEnemyRenderer stores it
   * on the instance state) so the per-frame push needs no id lookup. Only
   * valid while that bar has not been removed.
   */
  updateAt(
    index: number,
    position: Vector3,
    yOffset: number,
    healthPercent: number,
    barWidth: number,
    barHeight: number,
  ): void {
    // A hidden slot is a corpse whose bar was retired — writing to it would
    // both resurrect the bar and pile up update ranges for nothing.
    if (this.hiddenFlags[index]) return;

    // Position moves every frame → write into the instanced buffer; flushed
    // once per frame in updateBillboard().
    this.centerAttribute.setXYZ(index, position.x, position.y + yOffset, position.z);
    this.centerDirty = true;

    // Size only changes via debug scaling, so write it ONLY when it actually
    // moved. An unconditional per-enemy-per-frame write would queue a range
    // per enemy per frame, and that many collapse into an upload of the
    // whole drawn slice every frame (see uploadSlot).
    const si = index * 2;
    const sizes = this.sizeAttribute.array as Float32Array;
    if (sizes[si] !== barWidth || sizes[si + 1] !== barHeight) {
      this.sizeAttribute.setXY(index, barWidth, barHeight);
      this.slots.uploadSlot(this.sizeAttribute, index);
    }

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

    // The (0, activeCount) ranges cover every drawn slot. Clearing first
    // drops the range of a flush the renderer never uploaded (bars toggled
    // invisible), so the ranges array cannot grow. Without a range Three.js
    // would push the full MAX_HEALTH_BARS-sized buffer every frame.
    if (this.centerDirty) {
      this.centerAttribute.clearUpdateRanges();
      this.centerAttribute.addUpdateRange(0, this.slots.activeCount * 3);
      this.centerAttribute.needsUpdate = true;
      this.centerDirty = false;
    }
    if (this.healthDirty) {
      this.healthAttribute.clearUpdateRanges();
      this.healthAttribute.addUpdateRange(0, this.slots.activeCount);
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
    this.hiddenFlags[index] = 1;
    this.sizeAttribute.setXY(index, 0, 0);
    this.slots.uploadSlot(this.sizeAttribute, index);
  }

  /**
   * Remove a health bar instance
   */
  remove(enemyId: string): void {
    const index = this.instances.get(enemyId);
    if (index === undefined) return;

    this.hiddenFlags[index] = 1;
    this.sizeAttribute.setXY(index, 0, 0);
    this.slots.uploadSlot(this.sizeAttribute, index);

    this.instances.delete(enemyId);
    this.slots.release(index);
    this.syncDrawCount();
  }

  /**
   * Set visibility of all health bars
   */
  setVisible(visible: boolean): void {
    this.gate.setShown(visible);
  }

  get count(): number {
    return this.instances.size;
  }

  /** Draw count of both passes follows the slot allocator; the gate hides them while empty. */
  private syncDrawCount(): void {
    this.geometry.instanceCount = this.slots.activeCount;
    this.gate.setCount(this.slots.activeCount);
  }

  clear(): void {
    this.instances.clear();
    this.slots.reset();
    this.syncDrawCount();
    // Reset all sizes to hidden so stale slots never reappear after reuse.
    // Drop the pending per-slot ranges first — this one is a full upload.
    (this.sizeAttribute.array as Float32Array).fill(0);
    this.hiddenFlags.fill(1);
    this.sizeAttribute.clearUpdateRanges();
    this.sizeAttribute.needsUpdate = true;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.backgroundMesh);
    this.scene.remove(this.foregroundMesh);
    this.geometry.dispose();
    (this.backgroundMesh.material as ShaderMaterial).dispose();
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
        // The same objects as the enemies' materials
        ...this.portalClip,
      },
      vertexShader: HEALTH_BAR_VERTEX,
      fragmentShader: /* glsl */ `
        precision highp float;

        varying float vHealth;
        varying vec3 vBarColor;
        varying vec2 vUv;

        #include <logdepthbuf_pars_fragment>

        ${DISPLAY_OUTPUT_GLSL}

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
