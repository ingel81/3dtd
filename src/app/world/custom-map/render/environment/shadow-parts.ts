import {
  DepthFormat,
  DepthTexture,
  DirectionalLight,
  LessEqualCompare,
  LinearFilter,
  Object3D,
  RedFormat,
  Scene as ThreeScene,
  UnsignedByteType,
  UnsignedIntType,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';

/** Frames a build of the sun's shadow map is spread over, a part of the scene's objects each */
export const SHADOW_PARTS = 4;

/**
 * Renders the sun's cached shadow map again over a few frames into a
 * second map and swaps it in once it is whole: the sun keeps the map it
 * shows (and the matrix it was drawn with) until then. Rendered in one
 * frame, every pan that moved the shadow box or changed a caster held that
 * frame up with the whole shadow pass (TODO PF-K2).
 *
 * The scene's objects are split into SHADOW_PARTS runs (in scene order, so
 * the detail levels of a cell stay in one run); each frame draws one run
 * with three's own shadow pass (the casters' depth materials, wind sway and
 * alpha cards included) through a staging light that sees the whole box.
 * The depth buffer keeps the nearest caster whatever the order, so the runs
 * add up to the map one pass would draw; three clears its target before a
 * shadow pass, here only the first run does. Split by area instead, every
 * tile drew most casters again: an asset packed into one instanced mesh
 * reaches across the whole map.
 */
export class ShadowParts {
  private readonly stage = new DirectionalLight();
  private back: WebGLRenderTarget | null = null;
  /** An empty scene and a target of one texel: the render the parts draw in (step) */
  private readonly host = new ThreeScene();
  private readonly texel = new WebGLRenderTarget(1, 1, { depthBuffer: false });
  /** Stands in for the scene in a part's pass: its children are the part's objects (not their parent) */
  private readonly run = new Object3D();
  /** The scene's objects in scene order, split into the parts at a build's start */
  private roots: Object3D[] = [];
  /** The scene the build draws: a caster that left it meanwhile makes the build stale */
  private scene: Object3D | null = null;
  private next = -1;
  /** Where the build's box lies (the sun's target when it began) and its radius */
  readonly center = new Vector3();
  radius = 0;

  constructor() {
    this.stage.castShadow = true;
    this.stage.shadow.autoUpdate = true;
  }

  /** A build is under way */
  get busy(): boolean {
    return this.next >= 0;
  }

  /** Begins a build for the box the sun has now (its position, target and shadow camera) and the objects `scene` holds now */
  start(sun: DirectionalLight, scene: Scene): void {
    const from = sun.shadow.camera;
    const cam = this.stage.shadow.camera;
    cam.left = from.left;
    cam.right = from.right;
    cam.top = from.top;
    cam.bottom = from.bottom;
    cam.near = from.near;
    cam.far = from.far;
    cam.updateProjectionMatrix();
    this.stage.position.copy(sun.position);
    this.stage.target.position.copy(sun.target.position);
    this.stage.updateMatrixWorld();
    this.stage.target.updateMatrixWorld();
    // The matrix the finished map is read with (each pass sets it the same)
    this.stage.shadow.updateMatrices(this.stage);
    this.center.copy(sun.target.position);
    this.radius = from.right;
    this.scene = scene;
    this.roots = [];
    collectRoots(scene, this.roots);
    this.next = 0;
  }

  /** Drops the build under way (a new sun, a new map size): the next start begins afresh */
  cancel(): void {
    this.next = -1;
    this.roots = [];
    this.scene = null;
  }

  /**
   * Draws up to `parts` parts of the build; when the last is in, the new map
   * and its matrix go to the sun and true comes back. `camera` is the view's
   * (an object it does not see casts nothing, as in three's own pass).
   */
  step(renderer: WebGLRenderer, camera: Camera, sun: DirectionalLight, parts: number): boolean {
    if (this.next < 0) return false;
    const size = sun.shadow.mapSize.x;
    const back = this.target(size);
    const shadow = this.stage.shadow;
    shadow.mapSize.set(size, size);
    shadow.map = back;
    const clear = renderer.clear;
    const draw = (): void => {
      for (let n = 0; n < parts && this.next < SHADOW_PARTS; n++, this.next++) {
        if (this.next === 0) {
          renderer.setRenderTarget(back);
          clear.call(renderer, false, true, false);
        }
        const from = Math.floor((this.roots.length * this.next) / SHADOW_PARTS);
        const to = Math.floor((this.roots.length * (this.next + 1)) / SHADOW_PARTS);
        this.run.children = this.roots.slice(from, to).filter(shown);
        // The pass clears its whole target first: only the first part may
        renderer.clear = () => undefined;
        try {
          renderer.shadowMap.needsUpdate = true;
          renderer.shadowMap.render([this.stage], this.run as unknown as Scene, camera);
        } finally {
          renderer.clear = clear;
          this.run.children = [];
        }
      }
    };
    // three draws a shadow pass only inside a render (it needs the render's state): an empty scene
    // rendered into a texel draws the parts after it, while that state still holds
    const previous = renderer.getRenderTarget();
    this.host.onAfterRender = draw;
    try {
      renderer.setRenderTarget(this.texel);
      renderer.render(this.host, camera);
    } finally {
      this.host.onAfterRender = () => undefined;
      shadow.map = null;
      renderer.setRenderTarget(previous);
    }
    if (this.next < SHADOW_PARTS) return false;
    // A caster left the scene while the parts drew (a cell of trees rebuilt for new ones): the map lacks it and
    // its replacement, and swapped in it would drop those shadows for a build (they flickered under a brush).
    // The sun keeps the map it shows; the build begins again with the scene as it is now
    if (this.scene && this.roots.some((root) => !inside(root, this.scene!))) {
      this.roots = [];
      collectRoots(this.scene, this.roots);
      this.next = 0;
      return false;
    }
    this.next = -1;
    this.scene = null;
    this.roots = [];
    // Swap: the sun reads the new map with the matrix it was drawn for, the old one is the next build's
    // (three makes the sun's own map, at the warm-up, a WebGLRenderTarget as well)
    const old = sun.shadow.map as WebGLRenderTarget | null;
    this.back = old && old.width === size ? old : null;
    if (!this.back) old?.dispose();
    sun.shadow.map = back;
    sun.shadow.matrix.copy(shadow.matrix);
    return true;
  }

  dispose(): void {
    this.back?.dispose();
    this.back = null;
    this.texel.dispose();
    this.roots = [];
  }

  /** The second map, as three makes a shadow map (a compared depth texture), `size` texels a side */
  private target(size: number): WebGLRenderTarget {
    if (this.back && this.back.width === size) return this.back;
    this.back?.dispose();
    // The colour attachment is never drawn: one byte a texel instead of four
    const target = new WebGLRenderTarget(size, size, { format: RedFormat, type: UnsignedByteType });
    const depth = new DepthTexture(size, size, UnsignedIntType);
    depth.format = DepthFormat;
    depth.compareFunction = LessEqualCompare;
    depth.minFilter = LinearFilter;
    depth.magFilter = LinearFilter;
    depth.name = 'custom-map-sun.shadowMap';
    target.depthTexture = depth;
    this.back = target;
    return target;
  }
}

/**
 * The objects a part's pass starts from, in scene order: every mesh (and
 * line, points) with what hangs under it, found through the groups.
 * Visibility, casting and the camera's layers are read when a part draws.
 */
function collectRoots(node: Object3D, out: Object3D[]): void {
  for (const child of node.children) {
    if ((child as { isLight?: boolean }).isLight) continue;
    if ((child as { isMesh?: boolean }).isMesh || (child as { isLine?: boolean }).isLine || (child as { isPoints?: boolean }).isPoints) {
      out.push(child);
    } else if (child.children.length) {
      collectRoots(child, out);
    }
  }
}

/** Whether `node` still hangs under `scene` */
function inside(node: Object3D, scene: Object3D): boolean {
  let o: Object3D | null = node.parent;
  while (o && o !== scene) o = o.parent;
  return o === scene;
}

/** Still in the scene and every group above it shown: three's pass checks only the object itself */
function shown(root: Object3D): boolean {
  let o: Object3D | null = root.parent;
  if (!o) return false;
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}
