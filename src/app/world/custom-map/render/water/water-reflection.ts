import {
  HalfFloatType,
  LinearFilter,
  Matrix4,
  PerspectiveCamera,
  Plane,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';

/**
 * The scene mirrored in one flat water level (the waterReflection effect,
 * High and Ultra): banks, trees, houses, towers and the sky as they stand
 * over the water, rendered once per frame from a camera mirrored in the
 * plane at a fraction of the frame's size (`scale`), into a half-float
 * target the water reads by its projected position (`uReflection`,
 * `uReflectMatrix`). The near plane is tilted into the water plane (an
 * oblique projection), so nothing under the water shows in the mirror.
 *
 * At most one level per frame: the view picks the body in view (custom-map-view.ts)
 * and arms the reflection each update; the first of that body's tiles to
 * draw renders it (`render`, from the tile's onBeforeRender, inside the
 * frame's draw, so the GPU time is the frame's). Other bodies and rivers
 * keep the sky and the land traced over the heights.
 *
 * Only the map mirrors: of the scene's children those in `keep` (the map's
 * group, its sight blockers, sky and lights) and any that holds a light
 * (hiding a light would compile every material anew); towers, enemies and
 * the game's overlays stay out. Within the map `hide` (water, grass, decals,
 * the map's particles and the objects that block no sight: scatter, props,
 * small plants) is hidden. Nothing beyond `far` is drawn and the shadow map
 * is not updated.
 */
export class WaterReflection {
  readonly uniforms = {
    uReflection: { value: null as WebGLRenderTarget['texture'] | null },
    uReflectMatrix: { value: new Matrix4() },
  };
  /** Share of the frame's size the mirror renders at; 0 off */
  scale = 0;
  /**
   * Renders every this many armed frames; between, the water reads the last
   * mirror by its own matrix, so it stays in place on the world and only its
   * parallax lags a frame
   */
  every = 1;
  /** Drawn objects of the reflected frame at most this far, m */
  far = 400;
  private skipped = 0;
  private target: WebGLRenderTarget | null = null;
  private readonly mirror = new PerspectiveCamera();
  private armed: { camera: Camera; level: number; owner: object } | null = null;
  private readonly size = new Vector2();
  private readonly eye = new Vector3();

  /** Whether a child of the scene holds a light, by child (the scene's children rarely change) */
  private readonly lit = new WeakMap<Object3D, boolean>();

  constructor(
    private readonly hide: () => Object3D[],
    private readonly keep: () => Object3D[],
  ) {}

  /**
   * This frame mirrors the scene in the plane at `level` (scene y), for the
   * body `owner`'s tiles; `camera` the frame's camera. Null: no mirror
   */
  arm(camera: Camera | null, level: number, owner: object | null): void {
    this.armed = camera && owner && this.scale > 0 ? { camera, level, owner } : null;
  }

  /** Renders the armed mirror once, when `owner`'s tile is the first to draw with the armed camera */
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera, owner: object): void {
    const a = this.armed;
    if (!a || a.owner !== owner || a.camera !== camera || !(camera instanceof PerspectiveCamera)) return;
    this.armed = null;
    if (this.target && ++this.skipped < this.every) return;
    this.skipped = 0;
    camera.getWorldPosition(this.eye);
    // Under the plane (a camera dipping into the water) nothing to mirror
    if (this.eye.y <= a.level + 0.05) return;
    const current = renderer.getRenderTarget();
    if (current) this.size.set(current.width, current.height);
    else renderer.getDrawingBufferSize(this.size);
    const w = Math.max(64, Math.floor(this.size.x * this.scale));
    const h = Math.max(64, Math.floor(this.size.y * this.scale));
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new WebGLRenderTarget(w, h, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false });
      this.uniforms.uReflection.value = this.target.texture;
    }

    placeMirror(camera, a.level, this.mirror, this.uniforms.uReflectMatrix.value, Math.min(camera.far, this.far));
    this.mirror.layers.mask = camera.layers.mask;
    const m = this.mirror;

    const keep = new Set(this.keep());
    const hidden = this.hide().filter((o) => o.visible);
    for (const child of scene.children) {
      if (child.visible && !keep.has(child) && !this.holdsLight(child)) hidden.push(child);
    }
    for (const o of hidden) o.visible = false;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    const shadowDue = renderer.shadowMap.needsUpdate;
    const xr = renderer.xr.enabled;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.xr.enabled = false;
    try {
      renderer.setRenderTarget(this.target);
      renderer.state.buffers.depth.setMask(true);
      renderer.clear(true, true, false);
      renderer.render(scene, m);
    } finally {
      renderer.setRenderTarget(current);
      renderer.shadowMap.autoUpdate = shadowAuto;
      renderer.shadowMap.needsUpdate = shadowDue;
      renderer.xr.enabled = xr;
      for (const o of hidden) o.visible = true;
    }
  }

  private holdsLight(o: Object3D): boolean {
    let lit = this.lit.get(o);
    if (lit === undefined) {
      lit = false;
      o.traverse((c) => {
        if ((c as { isLight?: boolean }).isLight) lit = true;
      });
      this.lit.set(o, lit);
    }
    return lit;
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.uniforms.uReflection.value = null;
    this.armed = null;
  }
}

const onPlane = new Vector3();
const eye = new Vector3();
const look = new Vector3();
const turn = new Matrix4();
const up = new Vector3(0, 1, 0);
const plane = new Plane();
const clip = new Vector4();
const q = new Vector4();

/**
 * Puts `mirror` where `camera` stands mirrored in the horizontal plane at
 * `level` (scene y): position, view direction and up reflected, the same
 * projection (but its far plane at `far`) with its near plane tilted into
 * the water plane (Lengyel's oblique frustum), so whatever lies under the
 * surface is clipped. Writes
 * into `toTexture` the transform from scene position to the mirror's
 * texture coordinates (projective, divide by w).
 */
export function placeMirror(camera: PerspectiveCamera, level: number, mirror: PerspectiveCamera, toTexture: Matrix4, far = camera.far): void {
  camera.getWorldPosition(eye);
  onPlane.set(eye.x, level, eye.z);
  mirror.position.set(eye.x, 2 * level - eye.y, eye.z);
  turn.extractRotation(camera.matrixWorld);
  look.set(0, 0, -1).applyMatrix4(turn);
  look.y = -look.y;
  mirror.up.set(0, 1, 0).applyMatrix4(turn);
  mirror.up.y = -mirror.up.y;
  mirror.lookAt(look.add(mirror.position));
  mirror.fov = camera.fov;
  mirror.aspect = camera.aspect;
  mirror.zoom = camera.zoom;
  mirror.filmGauge = camera.filmGauge;
  mirror.filmOffset = camera.filmOffset;
  mirror.view = camera.view ? { ...camera.view } : null;
  mirror.near = camera.near;
  mirror.far = far;
  mirror.updateMatrixWorld();
  mirror.updateProjectionMatrix();
  // Bias and scale into texture coordinates, by the mirror's projection before the tilt
  toTexture.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

  plane.setFromNormalAndCoplanarPoint(up, onPlane).applyMatrix4(mirror.matrixWorldInverse);
  clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const e = mirror.projectionMatrix.elements;
  q.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
  clip.multiplyScalar(2 / clip.dot(q));
  e[2] = clip.x;
  e[6] = clip.y;
  e[10] = clip.z + 1;
  e[14] = clip.w;
  mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
}
