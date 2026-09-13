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
import type { EnemyTypeConfig } from '../../../configs/enemy-types.config';
import { DEFAULT_BAKE_FPS, vatClipRegistry, vatClips, type VATAnimationEntry, type VATClip } from './vat-clips';
import {
  createPositionTexture,
  emptyBounds,
  growBounds,
  modelHeightRange,
  vatEncoding,
  vatLayout,
  type VATEncoding,
} from './vat-encoding';
import { mergeBakedMeshes, texturePixels, vatAlpha, vatSide, type BakedMeshPart, type VATAlpha } from './vat-surface';

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
}

/**
 * Bake an enemy type: its skinned meshes, else its object-animated meshes,
 * and a model without clips as one static frame. `model` is a clone of the
 * loaded model that keeps skeleton bindings (SkeletonUtils.clone).
 */
export function bakeEnemyVAT(config: EnemyTypeConfig, model: Object3D, animations: AnimationClip[]): VATData | null {
  if (!config.hasAnimations || animations.length === 0) return bakeStaticVAT(model, config.scale);
  const clips = vatClips(config);
  return bakeVAT(model, animations, clips, config.scale) ?? bakeObjectAnimVAT(model, animations, clips, config.scale);
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
 */
export function bakeVAT(
  modelRoot: Object3D,
  animations: AnimationClip[],
  clips: VATClip[],
  worldScale: number,
  fps: number = DEFAULT_BAKE_FPS,
): VATData | null {
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

  // Clips that we need and exist, with their frame ranges
  const registry = vatClipRegistry(animations, clips, fps);
  if (!registry) {
    console.warn('[VATBaker] No matching animation clips found');
    return null;
  }
  const { clipMap, validClips, animEntries, totalFrames } = registry;

  // Compute tiled texture dimensions (cap width to GPU-safe limit)
  const { texWidth, rowsPerFrame } = vatLayout(totalVertices);
  const texHeight = totalFrames * rowsPerFrame;

  // Allocate VAT data (width=texWidth, height=texHeight, xyz + padding)
  const data = new Float32Array(texWidth * texHeight * 4);
  const tempVec = new Vector3();
  const bounds = emptyBounds();

  // Bake each clip using a fresh mixer
  for (const { name } of validClips) {
    const clip = clipMap.get(name)!;
    const entry = animEntries.get(name)!;

    // Fresh mixer per clip to avoid state leaking
    const mixer = new AnimationMixer(modelRoot);
    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    for (let frame = 0; frame < entry.frameCount; frame++) {
      const time = Math.min(frame / fps, clip.duration - 0.0001);

      // Set animation to exact time and update all transforms
      mixer.setTime(time);
      modelRoot.updateMatrixWorld(true);

      // Bake vertices from ALL skinned meshes
      for (const skin of skins) {
        const posAttr = skin.mesh.geometry.getAttribute('position');
        for (let v = 0; v < skin.vertexCount; v++) {
          tempVec.fromBufferAttribute(posAttr, v);
          skin.mesh.applyBoneTransform(v, tempVec);
          tempVec.applyMatrix4(skin.meshToRoot);
          growBounds(bounds, tempVec);

          const globalV = skin.vertexOffset + v;
          const col = globalV % texWidth;
          const localRow = Math.floor(globalV / texWidth);
          const globalRow = (entry.frameStart + frame) * rowsPerFrame + localRow;
          const offset = (globalRow * texWidth + col) * 4;
          data[offset] = tempVec.x;
          data[offset + 1] = tempVec.y;
          data[offset + 2] = tempVec.z;
          data[offset + 3] = 1.0;
        }
      }
    }

    // Clean up this mixer
    action.stop();
    mixer.stopAllAction();
    mixer.uncacheClip(clip);
    mixer.uncacheRoot(modelRoot);
  }

  const encoding = vatEncoding(bounds, worldScale);
  const positionTexture = createPositionTexture(data, texWidth, texHeight, encoding);

  // Merged rest-pose geometry with per-vertex material info
  const merged = mergeBakedMeshes(skins, totalVertices);

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
 */
export function bakeObjectAnimVAT(
  modelRoot: Object3D,
  animations: AnimationClip[],
  clips: VATClip[],
  worldScale: number,
  fps: number = DEFAULT_BAKE_FPS,
): VATData | null {
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

  // Clips that exist, with their frame ranges
  const registry = vatClipRegistry(animations, clips, fps);
  if (!registry) {
    console.warn('[VATBaker] No matching animation clips found for object-anim bake');
    return null;
  }
  const { clipMap, validClips, animEntries, totalFrames } = registry;

  // Compute tiled texture dimensions
  const { texWidth, rowsPerFrame } = vatLayout(totalVertices);
  const texHeight = totalFrames * rowsPerFrame;

  // Allocate VAT data
  const data = new Float32Array(texWidth * texHeight * 4);
  const tempVec = new Vector3();
  const meshToRoot = new Matrix4();
  const rootInverse = new Matrix4();
  const bounds = emptyBounds();

  // Bake each clip
  for (const { name } of validClips) {
    const clip = clipMap.get(name)!;
    const entry = animEntries.get(name)!;

    const mixer = new AnimationMixer(modelRoot);
    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    for (let frame = 0; frame < entry.frameCount; frame++) {
      const time = Math.min(frame / fps, clip.duration - 0.0001);

      mixer.setTime(time);
      modelRoot.updateMatrixWorld(true);
      rootInverse.copy(modelRoot.matrixWorld).invert();

      // Bake vertices from all meshes with current-frame transforms
      for (const info of meshInfos) {
        meshToRoot.multiplyMatrices(rootInverse, info.mesh.matrixWorld);
        const posAttr = info.mesh.geometry.getAttribute('position');

        for (let v = 0; v < info.vertexCount; v++) {
          tempVec.fromBufferAttribute(posAttr, v);
          tempVec.applyMatrix4(meshToRoot);
          growBounds(bounds, tempVec);

          const globalV = info.vertexOffset + v;
          const col = globalV % texWidth;
          const localRow = Math.floor(globalV / texWidth);
          const globalRow = (entry.frameStart + frame) * rowsPerFrame + localRow;
          const offset = (globalRow * texWidth + col) * 4;
          data[offset] = tempVec.x;
          data[offset + 1] = tempVec.y;
          data[offset + 2] = tempVec.z;
          data[offset + 3] = 1.0;
        }
      }
    }

    action.stop();
    mixer.stopAllAction();
    mixer.uncacheClip(clip);
    mixer.uncacheRoot(modelRoot);
  }

  const encoding = vatEncoding(bounds, worldScale);
  const positionTexture = createPositionTexture(data, texWidth, texHeight, encoding);

  // Compute rest-pose transforms for geometry merging
  modelRoot.updateMatrixWorld(true);
  const restRootInverse = new Matrix4().copy(modelRoot.matrixWorld).invert();
  const parts: BakedMeshPart[] = meshInfos.map((info) => {
    const restMeshToRoot = new Matrix4().multiplyMatrices(restRootInverse, info.mesh.matrixWorld);
    return { ...info, meshToRoot: restMeshToRoot, normalMatrix: new Matrix3().getNormalMatrix(restMeshToRoot) };
  });

  // Build merged geometry (rest-pose positions)
  const merged = mergeBakedMeshes(parts, totalVertices);

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
  };
}

/**
 * Bake a static (non-animated) model into a 1-frame VAT.
 * Used for enemy types without skeletal animations (e.g., tank).
 * Merges ALL meshes in the model into a single geometry to handle
 * multi-mesh models correctly.
 *
 * @param worldScale - Scale the model is shown at in game, picks the texel type (vatEncoding)
 */
export function bakeStaticVAT(modelRoot: Object3D, worldScale: number): VATData | null {
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
  const merged = mergeBakedMeshes(meshInfos, totalVertices, bounds);

  // VAT texture: 1-frame with tiled layout
  const { texWidth, rowsPerFrame } = vatLayout(totalVertices);
  const texHeight = rowsPerFrame;

  const data = new Float32Array(texWidth * texHeight * 4);
  for (let v = 0; v < totalVertices; v++) {
    const col = v % texWidth;
    const localRow = Math.floor(v / texWidth);
    const offset = (localRow * texWidth + col) * 4;
    data[offset] = merged.positions[v * 3];
    data[offset + 1] = merged.positions[v * 3 + 1];
    data[offset + 2] = merged.positions[v * 3 + 2];
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
  };
}
