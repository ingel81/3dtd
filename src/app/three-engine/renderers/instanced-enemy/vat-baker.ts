import {
  AnimationClip,
  AnimationMixer,
  DataTexture,
  SkinnedMesh,
  Vector3,
  Matrix4,
  Matrix3,
  Object3D,
  BufferGeometry,
  Texture,
  Mesh,
  LoopOnce,
  type Side,
} from 'three';
import type { EnemyTurret, EnemyTypeConfig } from '../../../configs/enemy-types.config';
import { clipFrom, DEFAULT_BAKE_FPS, vatClipRegistry, vatClips, type VATAnimationEntry, type VATClip } from './vat-clips';
import {
  createPositionTexture,
  positionTextureSteps,
  emptyBounds,
  growBounds,
  modelHeightRange,
  vatEncoding,
  vatLayout,
  type VATBounds,
  type VATEncoding,
} from './vat-encoding';
import { mergeBakedMeshes, texturePixels, vatAlpha, vatSide, type BakedMeshPart, type TexturePixels, type VATAlpha } from './vat-surface';
import { TURRET_MARKERS, TurretRig, type VATTurret } from './vat-turret';

/** Result of VAT baking for one enemy type */
export interface VATData {
  /** DataTexture: width=texWidth, height=totalFrames × rowsPerFrame, xyz + padding per texel (see encoding) */
  positionTexture: DataTexture;
  /** Texel type of positionTexture and how its texels map back to positions */
  encoding: VATEncoding;
  /** Number of vertices in the geometry */
  vertexCount: number;
  /** Total baked frames across all clips */
  totalFrames: number;
  /** Per-clip frame ranges */
  animations: Map<string, VATAnimationEntry>;
  /** Geometry for the InstancedMesh (rest-pose, with UVs, normals, aVertexIndex) */
  geometry: BufferGeometry;
  /** Diffuse texture from the original material (if any) */
  diffuseMap: Texture | null;
  /** Whether the material was unlit (MeshBasicMaterial) */
  isUnlit: boolean;
  /** How the shader treats alpha, from the materials of the baked meshes (vatAlpha) */
  alpha: VATAlpha;
  /** Baking FPS */
  fps: number;
  /** Actual texture width (capped for GPU limits) */
  texWidth: number;
  /** Number of texture rows per animation frame (≥ 1) */
  rowsPerFrame: number;
  /** Material base color (fallback when no diffuse map) */
  baseColor: { r: number; g: number; b: number };
  /** Faces the material draws, from the materials of the baked meshes (vatSide) */
  side: Side;
  /** Lowest baked vertex Y across all frames (unscaled bake/root space). */
  modelMinY: number;
  /** Highest baked vertex Y across all frames (unscaled bake/root space). */
  modelMaxY: number;
  /**
   * Turret joints (EnemyTypeConfig.turret, vat-turret.ts): their markers sit in the texture behind the
   * `vertexCount` vertices, the geometry has aTurretPart. Null for a model without a turret
   */
  turret: VATTurret | null;
}

/**
 * Bake an enemy type: its skinned meshes, else its object-animated meshes,
 * and a model without clips as one static frame. `model` is a clone of the
 * loaded model that keeps skeleton bindings (SkeletonUtils.clone); `pixels`
 * are its colour maps read beforehand where no canvas reads them (KTX2).
 */
export function bakeEnemyVAT(
  config: EnemyTypeConfig,
  model: Object3D,
  animations: AnimationClip[],
  pixels?: ReadonlyMap<Texture, TexturePixels | null>,
): VATData | null {
  return runBake(bakeEnemyVATSteps(config, model, animations, pixels));
}

/**
 * bakeEnemyVAT spread over tasks: it gives the thread back once a slice
 * took `budgetMs`, so the frames go on while a type bakes (the warlord's
 * bake held one frame 104 ms, the jumper's 78 ms, in the background warm-up
 * after the load). The same steps, the same result as bakeEnemyVAT.
 */
export async function bakeEnemyVATSliced(
  config: EnemyTypeConfig,
  model: Object3D,
  animations: AnimationClip[],
  pixels?: ReadonlyMap<Texture, TexturePixels | null>,
  budgetMs = BAKE_SLICE_MS,
): Promise<VATData | null> {
  const steps = bakeEnemyVATSteps(config, model, animations, pixels);
  for (;;) {
    const until = performance.now() + budgetMs;
    for (;;) {
      const next = steps.next();
      if (next.done) return next.value;
      if (performance.now() >= until) break;
    }
    await nextTask();
  }
}

/** Main-thread time a sliced bake takes before it gives the thread back, ms */
export const BAKE_SLICE_MS = 4;

/**
 * Vertices a bake skins or transforms before it may give the thread back: one
 * sampled frame of a large model took 20 to 28 ms at once, past the slice
 * (E272)
 */
const VERTICES_PER_STEP = 4096;

/** A bake's steps: each yield is a point where it may give the thread back (a sampled frame) */
type BakeSteps<T> = Generator<void, T, void>;

/** Runs a bake's steps through at once */
function runBake<T>(steps: BakeSteps<T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** A task after the ones queued now (a message, not a timer: nested timers wait 4 ms each) */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

function* bakeEnemyVATSteps(
  config: EnemyTypeConfig,
  model: Object3D,
  animations: AnimationClip[],
  pixels?: ReadonlyMap<Texture, TexturePixels | null>,
): BakeSteps<VATData | null> {
  if (!config.hasAnimations || animations.length === 0) return bakeStaticVAT(model, config.scale, pixels, config.turret);
  const clips = vatClips(config);
  const grounded = config.groundedBake === true;
  const skinned = yield* bakeVATSteps(model, animations, clips, config.scale, DEFAULT_BAKE_FPS, grounded, pixels);
  if (skinned && config.turret) console.warn(`[VATBaker] ${config.id}: turret joints take rigid parts, not a skinned mesh: no turret`);
  return skinned ?? (yield* bakeObjectAnimVATSteps(model, animations, clips, config.scale, DEFAULT_BAKE_FPS, grounded, pixels, config.turret));
}

/**
 * Bake skeletal animations into a Vertex Animation Texture (VAT).
 *
 * Baked positions are in SkinnedMesh bind space (same coordinate system
 * as geometry.attributes.position). The InstancedMesh's instance matrix
 * should include model scale to get correct world-space sizes.
 *
 * @param modelRoot - Cloned model root (with preserveSkeleton: true)
 * @param animations - AnimationClip array from CachedModel
 * @param clips - Clips to bake and how much of each (vatClips)
 * @param worldScale - Scale the model is shown at in game, picks the texel type (vatEncoding)
 * @param fps - Baking framerate (default: 30)
 * @param grounded - Each frame's lowest vertex at y 0 (EnemyTypeConfig.groundedBake)
 * @param pixels - Colour maps read beforehand (mergeBakedMeshes)
 */
export function bakeVAT(
  modelRoot: Object3D,
  animations: AnimationClip[],
  clips: VATClip[],
  worldScale: number,
  fps: number = DEFAULT_BAKE_FPS,
  grounded = false,
  pixels?: ReadonlyMap<Texture, TexturePixels | null>,
): VATData | null {
  return runBake(bakeVATSteps(modelRoot, animations, clips, worldScale, fps, grounded, pixels));
}

function* bakeVATSteps(
  modelRoot: Object3D,
  animations: AnimationClip[],
  clips: VATClip[],
  worldScale: number,
  fps: number,
  grounded: boolean,
  pixels?: ReadonlyMap<Texture, TexturePixels | null>,
): BakeSteps<VATData | null> {
  // Collect ALL SkinnedMeshes (multi-mesh support: body, hair, clothes, etc.)
  const skins: (BakedMeshPart & { mesh: SkinnedMesh })[] = [];
  modelRoot.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh) {
      const sm = node as SkinnedMesh;
      const count = sm.geometry.getAttribute('position')?.count ?? 0;
      if (count > 0) skins.push({ mesh: sm, vertexCount: count, meshToRoot: new Matrix4(), normalMatrix: new Matrix3(), vertexOffset: 0 });
    }
  });

  if (skins.length === 0) return null;

  // Compute per-mesh transforms and vertex offsets
  modelRoot.updateMatrixWorld(true);
  const rootInverse = new Matrix4().copy(modelRoot.matrixWorld).invert();
  let totalVertices = 0;
  for (const skin of skins) {
    skin.vertexOffset = totalVertices;
    skin.meshToRoot.multiplyMatrices(rootInverse, skin.mesh.matrixWorld);
    skin.normalMatrix.getNormalMatrix(skin.meshToRoot);
    totalVertices += skin.vertexCount;
  }

  const tempVec = new Vector3();
  const skinning = skins.map((skin) => new SkinningBake(skin.mesh, skin.meshToRoot));
  const baked = yield* bakeClips(modelRoot, animations, clips, fps, totalVertices, grounded, function* (scratch) {
    // Bake vertices from ALL skinned meshes
    for (let s = 0; s < skins.length; s++) {
      const skin = skins[s];
      const bake = skinning[s];
      bake.updateFrame();
      for (let v = 0; v < skin.vertexCount; v++) {
        bake.vertex(v, tempVec);
        scratch.set(skin.vertexOffset + v, tempVec);
        if (v % VERTICES_PER_STEP === VERTICES_PER_STEP - 1) yield;
      }
    }
  });
  if (!baked) {
    console.warn('[VATBaker] No matching animation clips found');
    return null;
  }
  const { data, bounds, texWidth, texHeight, rowsPerFrame, animEntries, totalFrames } = baked;

  const encoding = vatEncoding(bounds, worldScale);
  const positionTexture = yield* positionTextureSteps(data, texWidth, texHeight, encoding);
  yield;

  // Merged rest-pose geometry with per-vertex material info
  const merged = mergeBakedMeshes(skins, totalVertices, undefined, pixels);
  yield;

  return {
    positionTexture,
    encoding,
    vertexCount: totalVertices,
    totalFrames,
    texWidth,
    rowsPerFrame,
    animations: animEntries,
    alpha: vatAlpha(skins.map((s) => s.mesh.material), (map) => texturePixels(map, merged.pixelCache)),
    geometry: merged.geometry,
    diffuseMap: merged.diffuseMap,
    baseColor: merged.baseColor,
    side: vatSide(skins.map((s) => s.mesh.material)),
    isUnlit: merged.isUnlit,
    fps,
    ...modelHeightRange(bounds),
    turret: null,
  };
}

/**
 * Bake object/rigid-body animations into a Vertex Animation Texture (VAT).
 *
 * Used for models where animation moves Mesh nodes (via armature or direct
 * object transforms) rather than deforming vertices with bone weights
 * (SkinnedMesh). Examples: mech (limb parts), hornet (wing parts).
 *
 * Key difference to bakeVAT: recomputes meshToRoot per frame instead of
 * using applyBoneTransform, since the animation moves the meshes themselves.
 *
 * @param modelRoot - Cloned model root
 * @param animations - AnimationClip array from CachedModel
 * @param clips - Clips to bake and how much of each (vatClips)
 * @param worldScale - Scale the model is shown at in game, picks the texel type (vatEncoding)
 * @param fps - Baking framerate (default: 30)
 * @param grounded - Each frame's lowest vertex at y 0 (EnemyTypeConfig.groundedBake)
 * @param pixels - Colour maps read beforehand (mergeBakedMeshes)
 * @param turretConfig - Turret joints (vat-turret.ts): their markers go behind the vertices of every frame
 */
export function bakeObjectAnimVAT(
  modelRoot: Object3D,
  animations: AnimationClip[],
  clips: VATClip[],
  worldScale: number,
  fps: number = DEFAULT_BAKE_FPS,
  grounded = false,
  pixels?: ReadonlyMap<Texture, TexturePixels | null>,
  turretConfig?: EnemyTurret,
): VATData | null {
  return runBake(bakeObjectAnimVATSteps(modelRoot, animations, clips, worldScale, fps, grounded, pixels, turretConfig));
}

function* bakeObjectAnimVATSteps(
  modelRoot: Object3D,
  animations: AnimationClip[],
  clips: VATClip[],
  worldScale: number,
  fps: number,
  grounded: boolean,
  pixels?: ReadonlyMap<Texture, TexturePixels | null>,
  turretConfig?: EnemyTurret,
): BakeSteps<VATData | null> {
  // Collect all non-skinned Mesh nodes
  interface ObjMeshInfo {
    mesh: Mesh;
    vertexCount: number;
    vertexOffset: number;
  }
  const meshInfos: ObjMeshInfo[] = [];
  modelRoot.traverse((node) => {
    if ((node as Mesh).isMesh && !(node as SkinnedMesh).isSkinnedMesh) {
      const m = node as Mesh;
      const count = m.geometry.getAttribute('position')?.count ?? 0;
      if (count > 0) meshInfos.push({ mesh: m, vertexCount: count, vertexOffset: 0 });
    }
  });

  if (meshInfos.length === 0) return null;

  // Compute vertex offsets
  let totalVertices = 0;
  for (const info of meshInfos) {
    info.vertexOffset = totalVertices;
    totalVertices += info.vertexCount;
  }

  if (totalVertices === 0) return null;

  const rig = turretConfig ? TurretRig.find(modelRoot, turretConfig) : null;
  const tempVec = new Vector3();
  const meshToRoot = new Matrix4();
  const rootInverse = new Matrix4();
  const setMarker = (scratch: FrameScratch) => (i: number, p: Vector3) => scratch.set(totalVertices + i, p);
  const texels = totalVertices + (rig ? TURRET_MARKERS : 0);
  const baked = yield* bakeClips(modelRoot, animations, clips, fps, texels, grounded, function* (scratch) {
    rootInverse.copy(modelRoot.matrixWorld).invert();
    // Bake vertices from all meshes with current-frame transforms
    for (const info of meshInfos) {
      meshToRoot.multiplyMatrices(rootInverse, info.mesh.matrixWorld);
      const posAttr = info.mesh.geometry.getAttribute('position');
      for (let v = 0; v < info.vertexCount; v++) {
        tempVec.fromBufferAttribute(posAttr, v);
        tempVec.applyMatrix4(meshToRoot);
        scratch.set(info.vertexOffset + v, tempVec);
        if (v % VERTICES_PER_STEP === VERTICES_PER_STEP - 1) yield;
      }
    }
    rig?.markers(rootInverse, setMarker(scratch));
  });
  if (!baked) {
    console.warn('[VATBaker] No matching animation clips found for object-anim bake');
    return null;
  }
  const { data, bounds, texWidth, texHeight, rowsPerFrame, animEntries, totalFrames } = baked;

  const encoding = vatEncoding(bounds, worldScale);
  const positionTexture = yield* positionTextureSteps(data, texWidth, texHeight, encoding);
  yield;

  // Compute rest-pose transforms for geometry merging
  modelRoot.updateMatrixWorld(true);
  const restRootInverse = new Matrix4().copy(modelRoot.matrixWorld).invert();
  const parts: BakedMeshPart[] = meshInfos.map((info) => {
    const restMeshToRoot = new Matrix4().multiplyMatrices(restRootInverse, info.mesh.matrixWorld);
    return { ...info, meshToRoot: restMeshToRoot, normalMatrix: new Matrix3().getNormalMatrix(restMeshToRoot) };
  });

  // Build merged geometry (rest-pose positions)
  const merged = mergeBakedMeshes(parts, totalVertices, undefined, pixels);
  if (rig) merged.geometry.setAttribute('aTurretPart', rig.partAttribute(meshInfos, totalVertices));
  yield;

  return {
    positionTexture,
    encoding,
    vertexCount: totalVertices,
    totalFrames,
    texWidth,
    rowsPerFrame,
    animations: animEntries,
    alpha: vatAlpha(meshInfos.map((m) => m.mesh.material), (map) => texturePixels(map, merged.pixelCache)),
    geometry: merged.geometry,
    diffuseMap: merged.diffuseMap,
    baseColor: merged.baseColor,
    side: vatSide(meshInfos.map((m) => m.mesh.material)),
    isUnlit: merged.isUnlit,
    fps,
    ...modelHeightRange(bounds),
    turret: rig ? rig.vatTurret(modelRoot, totalVertices) : null,
  };
}

/** Index into the VAT data of a vertex in a frame (tiled: rowsPerFrame rows of texWidth texels per frame) */
function vatOffset(vertex: number, frame: number, texWidth: number, rowsPerFrame: number): number {
  const row = frame * rowsPerFrame + Math.floor(vertex / texWidth);
  return (row * texWidth + (vertex % texWidth)) * 4;
}

/**
 * One frame's vertices as baked, in full precision, before they go into the
 * VAT. Grounded, the frame moves down (or up) until its lowest vertex lies at
 * y 0. The bounds the encoding is chosen from grow with the values before
 * they are stored in float32, as they always did.
 */
/** Clip time short of a clip's end the bake samples its last pose at: at the end the mixer would already loop */
const END_EPSILON = 0.0001;

/**
 * A loop closes by itself when its end pose lies within this share of one
 * frame's motion from its start pose (the end is frame 0 again)
 */
const CLOSED_LOOP_SHARE = 0.25;

/**
 * Beyond this many frames of motion between its end and its start a clip is
 * no cycle with a missing closing key but a cut that does not loop (root
 * motion, a pose elsewhere): it gets no tail, the asset needs the fix
 */
const MAX_TAIL_FRAMES = 3;

/** The baked clips of a model: texels, their bounds and layout, the clips' frame ranges */
interface BakedClips {
  data: Float32Array;
  bounds: VATBounds;
  texWidth: number;
  texHeight: number;
  rowsPerFrame: number;
  animEntries: Map<string, VATAnimationEntry>;
  totalFrames: number;
}

/**
 * Every clip of `clips` the model has, frame by frame into one VAT: a fresh
 * mixer per clip (state would leak), the pose at each frame's time read by
 * `fill` into the scratch after the transforms are updated. A loop whose end
 * does not come back to its start (loopTail) runs on past its end until it
 * does. Null when the model has none of the clips.
 */
function* bakeClips(
  modelRoot: Object3D,
  animations: AnimationClip[],
  clips: VATClip[],
  fps: number,
  vertices: number,
  grounded: boolean,
  fill: (scratch: FrameScratch) => BakeSteps<void>,
): BakeSteps<BakedClips | null> {
  const scratch = new FrameScratch(vertices);
  // A clip on a mixer of its own while `use` samples it (steps: the bake may give the thread back in between)
  function* withClip(clip: AnimationClip, use: (sample: (time: number) => BakeSteps<void>) => BakeSteps<void>): BakeSteps<void> {
    const mixer = new AnimationMixer(modelRoot);
    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    try {
      yield* use(function* (time) {
        mixer.setTime(time);
        modelRoot.updateMatrixWorld(true);
        yield* fill(scratch);
      });
    } finally {
      action.stop();
      mixer.stopAllAction();
      mixer.uncacheClip(clip);
      mixer.uncacheRoot(modelRoot);
    }
  }

  const asked = vatClipRegistry(animations, clips, fps);
  if (!asked) return null;
  // How long each loop runs on past its end to come back to its start
  const measured: VATClip[] = [];
  for (const vatClip of asked.validClips) {
    if (vatClip.seconds !== Infinity || vatClip.from) {
      measured.push(vatClip);
      continue;
    }
    let tail = 0;
    const clip = asked.clipMap.get(vatClip.name)!;
    yield* withClip(clip, function* (sample) {
      tail = yield* loopTail(sample, scratch, clip.duration, fps);
    });
    measured.push(tail > 0 ? { ...vatClip, tail } : vatClip);
  }
  const { clipMap, validClips, animEntries, totalFrames } = vatClipRegistry(animations, measured, fps)!;

  // Compute tiled texture dimensions (cap width to GPU-safe limit)
  const { texWidth, rowsPerFrame } = vatLayout(vertices);
  const texHeight = totalFrames * rowsPerFrame;
  // Allocate VAT data (width=texWidth, height=texHeight, xyz + padding)
  const data = new Float32Array(texWidth * texHeight * 4);
  const bounds = emptyBounds();

  for (const vatClip of validClips) {
    const clip = clipMap.get(vatClip.name)!;
    const entry = animEntries.get(vatClip.name)!;
    const from = clipFrom(clip.duration, vatClip);
    const tail = vatClip.tail ?? 0;
    yield* withClip(clip, function* (sample) {
      // Past the end of an open loop: the end pose blends into the start pose over the tail
      let end: Float64Array | null = null;
      let start: Float64Array | null = null;
      if (tail > 0) {
        yield* sample(clip.duration - END_EPSILON);
        end = scratch.copy();
        yield* sample(from);
        start = scratch.copy();
      }
      for (let frame = 0; frame < entry.frameCount; frame++) {
        const time = from + frame / fps;
        if (end && start && time > clip.duration) scratch.blend(end, start, Math.min(1, (time - clip.duration) / tail));
        else yield* sample(Math.min(time, clip.duration - END_EPSILON));
        scratch.write(data, entry.frameStart + frame, texWidth, rowsPerFrame, grounded, bounds);
        yield;
      }
    });
  }
  return { data, bounds, texWidth, texHeight, rowsPerFrame, animEntries, totalFrames };
}

/**
 * Seconds a loop clip needs past its end to come back to its start pose, at
 * the pace its vertices move at the seam (the mean of its first and last
 * frame's motion): 0 where the end pose is the start pose (within
 * CLOSED_LOOP_SHARE of a frame's motion), about one key step where the
 * cycle was exported without its closing key (zombie V1's walk). Without
 * it the bake skipped that last step and the loop jumped at its seam. A
 * seam wider than MAX_TAIL_FRAMES is left as it is.
 */
function* loopTail(sample: (time: number) => BakeSteps<void>, scratch: FrameScratch, duration: number, fps: number): BakeSteps<number> {
  const step = 1 / fps;
  if (duration <= 2 * step) return 0;
  yield* sample(0);
  const first = scratch.copy();
  yield* sample(step);
  const second = scratch.copy();
  yield* sample(duration - step);
  const beforeEnd = scratch.copy();
  yield* sample(duration - END_EPSILON);
  const end = scratch.copy();
  const motion = (poseDistance(first, second) + poseDistance(beforeEnd, end)) / 2;
  if (motion <= 0) return 0;
  const frames = poseDistance(end, first) / motion;
  return frames < CLOSED_LOOP_SHARE || frames > MAX_TAIL_FRAMES ? 0 : frames * step;
}

/** Root mean square distance of the vertices of two poses */
function poseDistance(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / (a.length / 3));
}

class FrameScratch {
  private readonly xyz: Float64Array;
  private readonly point = new Vector3();

  constructor(private readonly vertices: number) {
    this.xyz = new Float64Array(vertices * 3);
  }

  /** The pose set so far, as a copy */
  copy(): Float64Array {
    return this.xyz.slice();
  }

  /** The pose `share` of the way from pose `a` to pose `b` */
  blend(a: Float64Array, b: Float64Array, share: number): void {
    for (let i = 0; i < this.xyz.length; i++) this.xyz[i] = a[i] + (b[i] - a[i]) * share;
  }

  set(vertex: number, p: Vector3): void {
    this.xyz[vertex * 3] = p.x;
    this.xyz[vertex * 3 + 1] = p.y;
    this.xyz[vertex * 3 + 2] = p.z;
  }

  write(data: Float32Array, frame: number, texWidth: number, rowsPerFrame: number, grounded: boolean, bounds: VATBounds): void {
    const xyz = this.xyz;
    let shift = 0;
    if (grounded) {
      let lowest = Infinity;
      for (let v = 0; v < this.vertices; v++) lowest = Math.min(lowest, xyz[v * 3 + 1]);
      if (Number.isFinite(lowest)) shift = lowest;
    }
    for (let v = 0; v < this.vertices; v++) {
      const p = this.point.set(xyz[v * 3], xyz[v * 3 + 1] - shift, xyz[v * 3 + 2]);
      growBounds(bounds, p);
      const o = vatOffset(v, frame, texWidth, rowsPerFrame);
      data[o] = p.x;
      data[o + 1] = p.y;
      data[o + 2] = p.z;
      data[o + 3] = 1.0;
    }
  }
}

/**
 * Bake a static (non-animated) model into a 1-frame VAT.
 * Used for enemy types without skeletal animations (e.g., tank).
 * Merges ALL meshes in the model into a single geometry to handle
 * multi-mesh models correctly.
 *
 * @param worldScale - Scale the model is shown at in game, picks the texel type (vatEncoding)
 * @param pixels - Colour maps read beforehand (mergeBakedMeshes)
 * @param turretConfig - Turret joints (vat-turret.ts): their markers go behind the vertices
 */
export function bakeStaticVAT(
  modelRoot: Object3D,
  worldScale: number,
  pixels?: ReadonlyMap<Texture, TexturePixels | null>,
  turretConfig?: EnemyTurret,
): VATData | null {
  // Collect all non-skinned meshes
  const meshes: Mesh[] = [];
  modelRoot.traverse((node) => {
    if ((node as Mesh).isMesh && !(node as SkinnedMesh).isSkinnedMesh) {
      meshes.push(node as Mesh);
    }
  });

  if (meshes.length === 0) return null;

  modelRoot.updateMatrixWorld(true);
  const rootInverse = new Matrix4().copy(modelRoot.matrixWorld).invert();

  // Collect per-mesh transforms and vertex offsets
  const meshInfos: BakedMeshPart[] = [];
  let totalVertices = 0;

  for (const m of meshes) {
    const posAttr = m.geometry.getAttribute('position');
    if (!posAttr) continue;

    const count = posAttr.count;
    const meshToRoot = new Matrix4();
    meshToRoot.multiplyMatrices(rootInverse, m.matrixWorld);
    const normalMatrix = new Matrix3().getNormalMatrix(meshToRoot);

    meshInfos.push({ mesh: m, meshToRoot, normalMatrix, vertexCount: count, vertexOffset: totalVertices });
    totalVertices += count;
  }

  if (totalVertices === 0) return null;

  // Merged geometry; its root-space positions are the one frame and give the bounds
  const bounds = emptyBounds();
  const merged = mergeBakedMeshes(meshInfos, totalVertices, bounds, pixels);

  const rig = turretConfig ? TurretRig.find(modelRoot, turretConfig) : null;
  const positions = merged.positions;
  const markers = new Float32Array(rig ? TURRET_MARKERS * 3 : 0);
  rig?.markers(rootInverse, (i, p) => {
    markers.set([p.x, p.y, p.z], i * 3);
    growBounds(bounds, p);
  });
  if (rig) merged.geometry.setAttribute('aTurretPart', rig.partAttribute(meshInfos, totalVertices));
  const texels = totalVertices + (rig ? TURRET_MARKERS : 0);

  // VAT texture: 1-frame with tiled layout
  const { texWidth, rowsPerFrame } = vatLayout(texels);
  const texHeight = rowsPerFrame;

  const data = new Float32Array(texWidth * texHeight * 4);
  for (let v = 0; v < texels; v++) {
    const col = v % texWidth;
    const localRow = Math.floor(v / texWidth);
    const offset = (localRow * texWidth + col) * 4;
    const source = v < totalVertices ? positions : markers;
    const k = (v < totalVertices ? v : v - totalVertices) * 3;
    data[offset] = source[k];
    data[offset + 1] = source[k + 1];
    data[offset + 2] = source[k + 2];
    data[offset + 3] = 1.0;
  }

  const encoding = vatEncoding(bounds, worldScale);
  const positionTexture = createPositionTexture(data, texWidth, texHeight, encoding);

  // Single "static" animation entry
  const animations = new Map<string, VATAnimationEntry>();
  animations.set('static', {
    name: 'static',
    frameStart: 0,
    frameCount: 1,
    duration: 0,
    totalTime: 1, // Static: single frame
  });

  return {
    positionTexture,
    encoding,
    vertexCount: totalVertices,
    totalFrames: 1,
    texWidth,
    rowsPerFrame,
    animations,
    alpha: vatAlpha(meshInfos.map((m) => m.mesh.material), (map) => texturePixels(map, merged.pixelCache)),
    geometry: merged.geometry,
    diffuseMap: merged.diffuseMap,
    baseColor: merged.baseColor,
    side: vatSide(meshInfos.map((m) => m.mesh.material)),
    isUnlit: merged.isUnlit,
    fps: DEFAULT_BAKE_FPS,
    ...modelHeightRange(bounds),
    turret: rig ? rig.vatTurret(modelRoot, totalVertices) : null,
  };
}

/**
 * SkinnedMesh.applyBoneTransform followed by `meshToRoot`, for every vertex
 * of a frame, without its per-vertex work: three builds each influence's
 * bone matrix (bone.matrixWorld x boneInverse) per vertex and goes through
 * Vector3 and Matrix4 calls; here every bone's whole transform from the
 * bind pose (boneMatrix x bindMatrix) is composed once per frame, the
 * vertex attributes are read into plain arrays once, and the vertex loop is
 * plain arithmetic. Same result up to float rounding; the bake of all enemy
 * types took some 3 s of the main thread while a map loaded.
 */
class SkinningBake {
  private readonly positions: Float32Array;
  private readonly indices: Uint16Array;
  private readonly weights: Float32Array;
  /** Per bone, the 12 affine entries (column-major, as Matrix4.elements) of boneMatrix x bindMatrix */
  private readonly bones: Float64Array;
  /** meshToRoot x bindMatrixInverse, applied after the weighted sum */
  private readonly post = new Matrix4();
  private readonly boneMatrix = new Matrix4();

  constructor(
    private readonly mesh: SkinnedMesh,
    private readonly meshToRoot: Matrix4,
  ) {
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    const idx = g.getAttribute('skinIndex');
    const wgt = g.getAttribute('skinWeight');
    const n = pos.count;
    this.positions = new Float32Array(n * 3);
    this.indices = new Uint16Array(n * 4);
    this.weights = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      this.positions[v * 3] = pos.getX(v);
      this.positions[v * 3 + 1] = pos.getY(v);
      this.positions[v * 3 + 2] = pos.getZ(v);
      for (let k = 0; k < 4; k++) {
        this.indices[v * 4 + k] = idx ? idx.getComponent(v, k) : 0;
        this.weights[v * 4 + k] = wgt ? wgt.getComponent(v, k) : k === 0 ? 1 : 0;
      }
    }
    this.bones = new Float64Array(mesh.skeleton.bones.length * 12);
  }

  /** Compose the bones' transforms for the pose the mixer just set (after updateMatrixWorld) */
  updateFrame(): void {
    const { skeleton, bindMatrix } = this.mesh;
    for (let b = 0; b < skeleton.bones.length; b++) {
      const m = this.boneMatrix.multiplyMatrices(skeleton.bones[b].matrixWorld, skeleton.boneInverses[b]).multiply(bindMatrix).elements;
      const o = b * 12;
      this.bones[o] = m[0];
      this.bones[o + 1] = m[1];
      this.bones[o + 2] = m[2];
      this.bones[o + 3] = m[4];
      this.bones[o + 4] = m[5];
      this.bones[o + 5] = m[6];
      this.bones[o + 6] = m[8];
      this.bones[o + 7] = m[9];
      this.bones[o + 8] = m[10];
      this.bones[o + 9] = m[12];
      this.bones[o + 10] = m[13];
      this.bones[o + 11] = m[14];
    }
    this.post.multiplyMatrices(this.meshToRoot, this.mesh.bindMatrixInverse);
  }

  /** Vertex `v` in the model root's space for the current frame */
  vertex(v: number, target: Vector3): Vector3 {
    const x = this.positions[v * 3];
    const y = this.positions[v * 3 + 1];
    const z = this.positions[v * 3 + 2];
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let k = 0; k < 4; k++) {
      const w = this.weights[v * 4 + k];
      if (w === 0) continue;
      const o = this.indices[v * 4 + k] * 12;
      const m = this.bones;
      ox += w * (m[o] * x + m[o + 3] * y + m[o + 6] * z + m[o + 9]);
      oy += w * (m[o + 1] * x + m[o + 4] * y + m[o + 7] * z + m[o + 10]);
      oz += w * (m[o + 2] * x + m[o + 5] * y + m[o + 8] * z + m[o + 11]);
    }
    return target.set(ox, oy, oz).applyMatrix4(this.post);
  }
}
