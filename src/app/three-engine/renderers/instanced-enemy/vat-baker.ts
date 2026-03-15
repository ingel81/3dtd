import {
  AnimationClip,
  AnimationMixer,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  SkinnedMesh,
  Vector3,
  Matrix4,
  Matrix3,
  Object3D,
  BufferGeometry,
  Texture,
  MeshStandardMaterial,
  MeshBasicMaterial,
  Mesh,
  BufferAttribute,
  LoopOnce,
} from 'three';

/** Registry entry for one animation clip within the VAT */
export interface VATAnimationEntry {
  name: string;
  frameStart: number;
  frameCount: number;
  duration: number; // seconds
  totalTime: number; // pre-computed: frameCount / fps (for animation loop)
}

/** Result of VAT baking for one enemy type */
export interface VATData {
  /** DataTexture: width=vertexCount, height=totalFrames, RGBA32F (xyz + padding) */
  positionTexture: DataTexture;
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
  /** Baking FPS */
  fps: number;
  /** Actual texture width (capped for GPU limits) */
  texWidth: number;
  /** Number of texture rows per animation frame (≥ 1) */
  rowsPerFrame: number;
  /** Material base color (fallback when no diffuse map) */
  baseColor: { r: number; g: number; b: number };
}

const DEFAULT_BAKE_FPS = 30;
const MAX_VAT_WIDTH = 8192;

/**
 * Bake skeletal animations into a Vertex Animation Texture (VAT).
 *
 * Baked positions are in SkinnedMesh bind space (same coordinate system
 * as geometry.attributes.position). The InstancedMesh's instance matrix
 * should include model scale to get correct world-space sizes.
 *
 * @param modelRoot - Cloned model root (with preserveSkeleton: true)
 * @param animations - AnimationClip array from CachedModel
 * @param clipNames - Animation clip names to bake (from EnemyTypeConfig)
 * @param fps - Baking framerate (default: 30)
 */
export function bakeVAT(
  modelRoot: Object3D,
  animations: AnimationClip[],
  clipNames: string[],
  fps: number = DEFAULT_BAKE_FPS,
): VATData | null {
  // Collect ALL SkinnedMeshes (multi-mesh support: body, hair, clothes, etc.)
  interface SkinInfo {
    mesh: SkinnedMesh;
    vertexCount: number;
    meshToRoot: Matrix4;
    normalMatrix: Matrix3;
    vertexOffset: number;
  }
  const skins: SkinInfo[] = [];
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

  // Filter to clips that we need and exist
  const clipMap = new Map<string, AnimationClip>();
  for (const clip of animations) {
    clipMap.set(clip.name, clip);
  }

  const validClipNames = clipNames.filter((name) => clipMap.has(name));
  if (validClipNames.length === 0) {
    console.warn('[VATBaker] No matching animation clips found');
    return null;
  }

  // Calculate total frames and build registry
  let totalFrames = 0;
  const animEntries = new Map<string, VATAnimationEntry>();

  for (const name of validClipNames) {
    const clip = clipMap.get(name)!;
    const frameCount = Math.max(1, Math.ceil(clip.duration * fps));
    animEntries.set(name, {
      name,
      frameStart: totalFrames,
      frameCount,
      duration: clip.duration,
      totalTime: frameCount / fps,
    });
    totalFrames += frameCount;
  }

  // Compute tiled texture dimensions (cap width to GPU-safe limit)
  const texWidth = Math.min(totalVertices, MAX_VAT_WIDTH);
  const rowsPerFrame = Math.ceil(totalVertices / texWidth);
  const texHeight = totalFrames * rowsPerFrame;

  // Allocate VAT data (width=texWidth, height=texHeight, RGBA32F)
  const data = new Float32Array(texWidth * texHeight * 4);
  const tempVec = new Vector3();

  // Bake each clip using a fresh mixer
  for (const name of validClipNames) {
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

  // Create DataTexture
  const positionTexture = new DataTexture(data, texWidth, texHeight, RGBAFormat, FloatType);
  positionTexture.minFilter = NearestFilter;
  positionTexture.magFilter = NearestFilter;
  positionTexture.needsUpdate = true;

  // Extract material properties from all meshes (pick best diffuse map + track per-mesh materials)
  let diffuseMap: Texture | null = null;
  let bestMapVertices = 0;
  let isUnlit = false;
  let baseColor = { r: 1.0, g: 1.0, b: 1.0 };
  let bestColorVertices = 0;

  for (const skin of skins) {
    const mat = skin.mesh.material as MeshStandardMaterial & MeshBasicMaterial;
    if (mat) {
      if (mat.map && skin.vertexCount > bestMapVertices) {
        diffuseMap = mat.map;
        bestMapVertices = skin.vertexCount;
      }
      if (mat.color && skin.vertexCount > bestColorVertices) {
        baseColor = { r: mat.color.r, g: mat.color.g, b: mat.color.b };
        bestColorVertices = skin.vertexCount;
      }
      if (skin.mesh.material instanceof MeshBasicMaterial) isUnlit = true;
    }
  }

  // Build merged geometry with per-vertex material info
  const mergedPositions = new Float32Array(totalVertices * 3);
  const mergedNormals = new Float32Array(totalVertices * 3);
  const mergedUVs = new Float32Array(totalVertices * 2);
  const mergedColors = new Float32Array(totalVertices * 3);
  const mergedAlpha = new Float32Array(totalVertices).fill(1.0);
  const mergedUseMap = new Float32Array(totalVertices);
  const mergedIndices: number[] = [];
  const tempNormal = new Vector3();

  // Cache CPU texture samplers for meshes with unique textures
  const samplerCache = new Map<Texture, Uint8ClampedArray | null>();
  const samplerSizes = new Map<Texture, { w: number; h: number }>();

  for (const skin of skins) {
    const geo = skin.mesh.geometry;
    const posAttr = geo.getAttribute('position');
    const normalAttr = geo.getAttribute('normal');
    const uvAttr = geo.getAttribute('uv');

    const mat = skin.mesh.material as MeshStandardMaterial & MeshBasicMaterial;
    // Check shared texture via reference OR source (glTF shared atlas)
    const meshSharesTexture = !!(mat && mat.map && diffuseMap &&
      (mat.map === diffuseMap || mat.map.source === diffuseMap.source));
    const meshHasOwnTexture = !meshSharesTexture && !!(mat && mat.map);
    const cr = mat && mat.color ? mat.color.r : 1.0;
    const cg = mat && mat.color ? mat.color.g : 1.0;
    const cb = mat && mat.color ? mat.color.b : 1.0;
    const matOpacity = mat ? mat.opacity ?? 1.0 : 1.0;

    // For meshes with their own unique texture: sample on CPU and bake into vertex colors
    let texPixels: Uint8ClampedArray | null = null;
    let texW = 0, texH = 0;
    if (meshHasOwnTexture && uvAttr) {
      const tex = mat.map!;
      if (!samplerCache.has(tex)) {
        try {
          const img = tex.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement;
          const w = (img as HTMLImageElement).naturalWidth || img.width || 0;
          const h = (img as HTMLImageElement).naturalHeight || img.height || 0;
          if (w > 0 && h > 0) {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img as CanvasImageSource, 0, 0);
            samplerCache.set(tex, ctx.getImageData(0, 0, w, h).data);
            samplerSizes.set(tex, { w, h });
          } else {
            samplerCache.set(tex, null);
          }
        } catch {
          samplerCache.set(tex, null);
        }
      }
      texPixels = samplerCache.get(tex) ?? null;
      const size = samplerSizes.get(tex);
      if (size) { texW = size.w; texH = size.h; }
    }

    for (let i = 0; i < skin.vertexCount; i++) {
      const vi = skin.vertexOffset + i;

      // Rest-pose position (for geometry reference, VAT overrides at runtime)
      tempVec.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      tempVec.applyMatrix4(skin.meshToRoot);
      mergedPositions[vi * 3] = tempVec.x;
      mergedPositions[vi * 3 + 1] = tempVec.y;
      mergedPositions[vi * 3 + 2] = tempVec.z;

      // Normal → root space
      if (normalAttr) {
        tempNormal.set(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i));
        tempNormal.applyMatrix3(skin.normalMatrix).normalize();
        mergedNormals[vi * 3] = tempNormal.x;
        mergedNormals[vi * 3 + 1] = tempNormal.y;
        mergedNormals[vi * 3 + 2] = tempNormal.z;
      } else {
        mergedNormals[vi * 3 + 1] = 1.0;
      }

      // UV
      if (uvAttr) {
        mergedUVs[vi * 2] = uvAttr.getX(i);
        mergedUVs[vi * 2 + 1] = uvAttr.getY(i);
      }

      // Per-vertex color, alpha and texture flag
      if (meshSharesTexture) {
        // Shares the main diffuse map → shader samples color + alpha at runtime
        mergedColors[vi * 3] = 1.0;
        mergedColors[vi * 3 + 1] = 1.0;
        mergedColors[vi * 3 + 2] = 1.0;
        mergedAlpha[vi] = matOpacity;
        mergedUseMap[vi] = 1.0;
      } else if (texPixels && uvAttr) {
        // Own texture → bake sampled color + alpha into vertex attributes
        let u = uvAttr.getX(i);
        let v = uvAttr.getY(i);
        u = u - Math.floor(u); // wrap to [0,1]
        v = v - Math.floor(v);
        const px = Math.min(Math.floor(u * texW), texW - 1);
        const py = Math.min(Math.floor((1 - v) * texH), texH - 1); // flip V
        const idx = (py * texW + px) * 4;
        mergedColors[vi * 3] = texPixels[idx] / 255;
        mergedColors[vi * 3 + 1] = texPixels[idx + 1] / 255;
        mergedColors[vi * 3 + 2] = texPixels[idx + 2] / 255;
        mergedAlpha[vi] = (texPixels[idx + 3] / 255) * matOpacity;
        mergedUseMap[vi] = 0.0;
      } else {
        // No texture → material color + opacity
        mergedColors[vi * 3] = cr;
        mergedColors[vi * 3 + 1] = cg;
        mergedColors[vi * 3 + 2] = cb;
        mergedAlpha[vi] = matOpacity;
        mergedUseMap[vi] = 0.0;
      }
    }

    // Indices (offset by vertexOffset)
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) {
        mergedIndices.push(geo.index.getX(i) + skin.vertexOffset);
      }
    } else {
      for (let i = 0; i < skin.vertexCount; i++) {
        mergedIndices.push(skin.vertexOffset + i);
      }
    }
  }

  // Create merged BufferGeometry
  const mergedGeometry = new BufferGeometry();
  mergedGeometry.setAttribute('position', new BufferAttribute(mergedPositions, 3));
  mergedGeometry.setAttribute('normal', new BufferAttribute(mergedNormals, 3));
  mergedGeometry.setAttribute('uv', new BufferAttribute(mergedUVs, 2));
  mergedGeometry.setIndex(mergedIndices);

  // Add vertex index attribute
  const vertexIndices = new Float32Array(totalVertices);
  for (let i = 0; i < totalVertices; i++) vertexIndices[i] = i;
  mergedGeometry.setAttribute('aVertexIndex', new BufferAttribute(vertexIndices, 1));
  mergedGeometry.setAttribute('aVertexColor', new BufferAttribute(mergedColors, 3));
  mergedGeometry.setAttribute('aVertexAlpha', new BufferAttribute(mergedAlpha, 1));
  mergedGeometry.setAttribute('aUseMap', new BufferAttribute(mergedUseMap, 1));

  return {
    positionTexture,
    vertexCount: totalVertices,
    totalFrames,
    texWidth,
    rowsPerFrame,
    animations: animEntries,
    geometry: mergedGeometry,
    diffuseMap,
    baseColor,
    isUnlit,
    fps,
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
 * @param clipNames - Animation clip names to bake (from EnemyTypeConfig)
 * @param fps - Baking framerate (default: 30)
 */
export function bakeObjectAnimVAT(
  modelRoot: Object3D,
  animations: AnimationClip[],
  clipNames: string[],
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

  // Filter to clips that exist
  const clipMap = new Map<string, AnimationClip>();
  for (const clip of animations) {
    clipMap.set(clip.name, clip);
  }

  const validClipNames = clipNames.filter((name) => clipMap.has(name));
  if (validClipNames.length === 0) {
    console.warn('[VATBaker] No matching animation clips found for object-anim bake');
    return null;
  }

  // Calculate total frames and build registry
  let totalFrames = 0;
  const animEntries = new Map<string, VATAnimationEntry>();

  for (const name of validClipNames) {
    const clip = clipMap.get(name)!;
    const frameCount = Math.max(1, Math.ceil(clip.duration * fps));
    animEntries.set(name, {
      name,
      frameStart: totalFrames,
      frameCount,
      duration: clip.duration,
      totalTime: frameCount / fps,
    });
    totalFrames += frameCount;
  }

  // Compute tiled texture dimensions
  const texWidth = Math.min(totalVertices, MAX_VAT_WIDTH);
  const rowsPerFrame = Math.ceil(totalVertices / texWidth);
  const texHeight = totalFrames * rowsPerFrame;

  // Allocate VAT data
  const data = new Float32Array(texWidth * texHeight * 4);
  const tempVec = new Vector3();
  const meshToRoot = new Matrix4();
  const rootInverse = new Matrix4();

  // Bake each clip
  for (const name of validClipNames) {
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

  // Create DataTexture
  const positionTexture = new DataTexture(data, texWidth, texHeight, RGBAFormat, FloatType);
  positionTexture.minFilter = NearestFilter;
  positionTexture.magFilter = NearestFilter;
  positionTexture.needsUpdate = true;

  // Compute rest-pose transforms for geometry merging
  modelRoot.updateMatrixWorld(true);
  const restRootInverse = new Matrix4().copy(modelRoot.matrixWorld).invert();

  // Extract material properties
  let diffuseMap: Texture | null = null;
  let bestMapVertices = 0;
  let baseColor = { r: 1.0, g: 1.0, b: 1.0 };
  let bestColorVertices = 0;
  let isUnlit = false;

  for (const info of meshInfos) {
    const mat = info.mesh.material as MeshStandardMaterial & MeshBasicMaterial;
    if (mat) {
      if (mat.map && info.vertexCount > bestMapVertices) {
        diffuseMap = mat.map;
        bestMapVertices = info.vertexCount;
      }
      if (mat.color && info.vertexCount > bestColorVertices) {
        baseColor = { r: mat.color.r, g: mat.color.g, b: mat.color.b };
        bestColorVertices = info.vertexCount;
      }
      if (info.mesh.material instanceof MeshBasicMaterial) isUnlit = true;
    }
  }

  // Build merged geometry (rest-pose positions)
  const mergedPositions = new Float32Array(totalVertices * 3);
  const mergedNormals = new Float32Array(totalVertices * 3);
  const mergedUVs = new Float32Array(totalVertices * 2);
  const mergedColors = new Float32Array(totalVertices * 3);
  const mergedAlpha = new Float32Array(totalVertices).fill(1.0);
  const mergedUseMap = new Float32Array(totalVertices);
  const mergedIndices: number[] = [];
  const tempNormal = new Vector3();

  const samplerCache = new Map<Texture, Uint8ClampedArray | null>();
  const samplerSizes = new Map<Texture, { w: number; h: number }>();

  for (const info of meshInfos) {
    const geo = info.mesh.geometry;
    const posAttr = geo.getAttribute('position');
    const normalAttr = geo.getAttribute('normal');
    const uvAttr = geo.getAttribute('uv');

    // Rest-pose mesh-to-root transform
    const restMeshToRoot = new Matrix4().multiplyMatrices(restRootInverse, info.mesh.matrixWorld);
    const restNormalMatrix = new Matrix3().getNormalMatrix(restMeshToRoot);

    const mat = info.mesh.material as MeshStandardMaterial & MeshBasicMaterial;
    const meshSharesTexture = !!(mat && mat.map && diffuseMap &&
      (mat.map === diffuseMap || mat.map.source === diffuseMap.source));
    const meshHasOwnTexture = !meshSharesTexture && !!(mat && mat.map);
    const cr = mat && mat.color ? mat.color.r : 1.0;
    const cg = mat && mat.color ? mat.color.g : 1.0;
    const cb = mat && mat.color ? mat.color.b : 1.0;
    const matOpacity = mat ? mat.opacity ?? 1.0 : 1.0;

    let texPixels: Uint8ClampedArray | null = null;
    let texW = 0, texH = 0;
    if (meshHasOwnTexture && uvAttr) {
      const tex = mat.map!;
      if (!samplerCache.has(tex)) {
        try {
          const img = tex.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement;
          const w = (img as HTMLImageElement).naturalWidth || img.width || 0;
          const h = (img as HTMLImageElement).naturalHeight || img.height || 0;
          if (w > 0 && h > 0) {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img as CanvasImageSource, 0, 0);
            samplerCache.set(tex, ctx.getImageData(0, 0, w, h).data);
            samplerSizes.set(tex, { w, h });
          } else {
            samplerCache.set(tex, null);
          }
        } catch {
          samplerCache.set(tex, null);
        }
      }
      texPixels = samplerCache.get(tex) ?? null;
      const size = samplerSizes.get(tex);
      if (size) { texW = size.w; texH = size.h; }
    }

    for (let i = 0; i < info.vertexCount; i++) {
      const vi = info.vertexOffset + i;

      // Rest-pose position
      tempVec.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      tempVec.applyMatrix4(restMeshToRoot);
      mergedPositions[vi * 3] = tempVec.x;
      mergedPositions[vi * 3 + 1] = tempVec.y;
      mergedPositions[vi * 3 + 2] = tempVec.z;

      // Normal
      if (normalAttr) {
        tempNormal.set(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i));
        tempNormal.applyMatrix3(restNormalMatrix).normalize();
        mergedNormals[vi * 3] = tempNormal.x;
        mergedNormals[vi * 3 + 1] = tempNormal.y;
        mergedNormals[vi * 3 + 2] = tempNormal.z;
      } else {
        mergedNormals[vi * 3 + 1] = 1.0;
      }

      // UV
      if (uvAttr) {
        mergedUVs[vi * 2] = uvAttr.getX(i);
        mergedUVs[vi * 2 + 1] = uvAttr.getY(i);
      }

      // Per-vertex color, alpha and texture flag
      if (meshSharesTexture) {
        mergedColors[vi * 3] = 1.0;
        mergedColors[vi * 3 + 1] = 1.0;
        mergedColors[vi * 3 + 2] = 1.0;
        mergedAlpha[vi] = matOpacity;
        mergedUseMap[vi] = 1.0;
      } else if (texPixels && uvAttr) {
        let u = uvAttr.getX(i);
        let v = uvAttr.getY(i);
        u = u - Math.floor(u);
        v = v - Math.floor(v);
        const px = Math.min(Math.floor(u * texW), texW - 1);
        const py = Math.min(Math.floor((1 - v) * texH), texH - 1);
        const idx = (py * texW + px) * 4;
        mergedColors[vi * 3] = texPixels[idx] / 255;
        mergedColors[vi * 3 + 1] = texPixels[idx + 1] / 255;
        mergedColors[vi * 3 + 2] = texPixels[idx + 2] / 255;
        mergedAlpha[vi] = (texPixels[idx + 3] / 255) * matOpacity;
        mergedUseMap[vi] = 0.0;
      } else {
        mergedColors[vi * 3] = cr;
        mergedColors[vi * 3 + 1] = cg;
        mergedColors[vi * 3 + 2] = cb;
        mergedAlpha[vi] = matOpacity;
        mergedUseMap[vi] = 0.0;
      }
    }

    // Indices
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) {
        mergedIndices.push(geo.index.getX(i) + info.vertexOffset);
      }
    } else {
      for (let i = 0; i < info.vertexCount; i++) {
        mergedIndices.push(info.vertexOffset + i);
      }
    }
  }

  // Create merged BufferGeometry
  const mergedGeometry = new BufferGeometry();
  mergedGeometry.setAttribute('position', new BufferAttribute(mergedPositions, 3));
  mergedGeometry.setAttribute('normal', new BufferAttribute(mergedNormals, 3));
  mergedGeometry.setAttribute('uv', new BufferAttribute(mergedUVs, 2));
  mergedGeometry.setIndex(mergedIndices);

  const vertexIndices = new Float32Array(totalVertices);
  for (let i = 0; i < totalVertices; i++) vertexIndices[i] = i;
  mergedGeometry.setAttribute('aVertexIndex', new BufferAttribute(vertexIndices, 1));
  mergedGeometry.setAttribute('aVertexColor', new BufferAttribute(mergedColors, 3));
  mergedGeometry.setAttribute('aVertexAlpha', new BufferAttribute(mergedAlpha, 1));
  mergedGeometry.setAttribute('aUseMap', new BufferAttribute(mergedUseMap, 1));

  return {
    positionTexture,
    vertexCount: totalVertices,
    totalFrames,
    texWidth,
    rowsPerFrame,
    animations: animEntries,
    geometry: mergedGeometry,
    diffuseMap,
    baseColor,
    isUnlit,
    fps,
  };
}

/**
 * Bake a static (non-animated) model into a 1-frame VAT.
 * Used for enemy types without skeletal animations (e.g., tank).
 * Merges ALL meshes in the model into a single geometry to handle
 * multi-mesh models correctly.
 */
export function bakeStaticVAT(modelRoot: Object3D): VATData | null {
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

  // Collect per-mesh info and find best material source
  interface MeshInfo {
    mesh: Mesh;
    meshToRoot: Matrix4;
    normalMatrix: Matrix3;
    vertexCount: number;
  }
  const meshInfos: MeshInfo[] = [];
  let totalVertices = 0;
  let diffuseMap: Texture | null = null;
  let bestMapVertices = 0;
  let baseColor = { r: 1.0, g: 1.0, b: 1.0 };
  let bestColorVertices = 0;
  let isUnlit = false;

  for (const m of meshes) {
    const posAttr = m.geometry.getAttribute('position');
    if (!posAttr) continue;

    const count = posAttr.count;
    const meshToRoot = new Matrix4();
    meshToRoot.multiplyMatrices(rootInverse, m.matrixWorld);
    const normalMatrix = new Matrix3().getNormalMatrix(meshToRoot);

    meshInfos.push({ mesh: m, meshToRoot, normalMatrix, vertexCount: count });
    totalVertices += count;

    // Track best texture and color (prefer mesh with most vertices)
    const mat = m.material as MeshStandardMaterial & MeshBasicMaterial;
    if (mat) {
      if (mat.map && count > bestMapVertices) {
        diffuseMap = mat.map;
        bestMapVertices = count;
      }
      if (mat.color && count > bestColorVertices) {
        baseColor = { r: mat.color.r, g: mat.color.g, b: mat.color.b };
        bestColorVertices = count;
      }
      if (m.material instanceof MeshBasicMaterial) isUnlit = true;
    }

  }

  if (totalVertices === 0) return null;

  // Build merged geometry: positions, normals, UVs, vertex colors, indices
  const mergedPositions = new Float32Array(totalVertices * 3);
  const mergedNormals = new Float32Array(totalVertices * 3);
  const mergedUVs = new Float32Array(totalVertices * 2);
  const mergedColors = new Float32Array(totalVertices * 3);
  const mergedStaticAlpha = new Float32Array(totalVertices).fill(1.0);
  const mergedUseMap = new Float32Array(totalVertices);
  const mergedIndices: number[] = [];
  const tempVec = new Vector3();
  const tempNormal = new Vector3();

  // Cache CPU texture samplers for meshes with unique textures
  const staticSamplerCache = new Map<Texture, Uint8ClampedArray | null>();
  const staticSamplerSizes = new Map<Texture, { w: number; h: number }>();

  let vertexOffset = 0;
  for (const info of meshInfos) {
    const geo = info.mesh.geometry;
    const posAttr = geo.getAttribute('position');
    const normalAttr = geo.getAttribute('normal');
    const uvAttr = geo.getAttribute('uv');

    // Per-mesh material color and texture flag
    const mat = info.mesh.material as MeshStandardMaterial & MeshBasicMaterial;
    const meshSharesTexture = !!(mat && mat.map && diffuseMap &&
      (mat.map === diffuseMap || mat.map.source === diffuseMap.source));
    const meshHasOwnTexture = !meshSharesTexture && !!(mat && mat.map);
    const cr = mat && mat.color ? mat.color.r : 1.0;
    const cg = mat && mat.color ? mat.color.g : 1.0;
    const cb = mat && mat.color ? mat.color.b : 1.0;
    const matOpacity = mat ? mat.opacity ?? 1.0 : 1.0;

    // For meshes with their own unique texture: sample on CPU
    let texPixels: Uint8ClampedArray | null = null;
    let texW = 0, texH = 0;
    if (meshHasOwnTexture && uvAttr) {
      const tex = mat.map!;
      if (!staticSamplerCache.has(tex)) {
        try {
          const img = tex.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement;
          const w = (img as HTMLImageElement).naturalWidth || img.width || 0;
          const h = (img as HTMLImageElement).naturalHeight || img.height || 0;
          if (w > 0 && h > 0) {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img as CanvasImageSource, 0, 0);
            staticSamplerCache.set(tex, ctx.getImageData(0, 0, w, h).data);
            staticSamplerSizes.set(tex, { w, h });
          } else {
            staticSamplerCache.set(tex, null);
          }
        } catch {
          staticSamplerCache.set(tex, null);
        }
      }
      texPixels = staticSamplerCache.get(tex) ?? null;
      const size = staticSamplerSizes.get(tex);
      if (size) { texW = size.w; texH = size.h; }
    }

    for (let i = 0; i < info.vertexCount; i++) {
      const vi = vertexOffset + i;

      // Position → root space
      tempVec.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      tempVec.applyMatrix4(info.meshToRoot);
      mergedPositions[vi * 3] = tempVec.x;
      mergedPositions[vi * 3 + 1] = tempVec.y;
      mergedPositions[vi * 3 + 2] = tempVec.z;

      // Normal → root space
      if (normalAttr) {
        tempNormal.set(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i));
        tempNormal.applyMatrix3(info.normalMatrix).normalize();
        mergedNormals[vi * 3] = tempNormal.x;
        mergedNormals[vi * 3 + 1] = tempNormal.y;
        mergedNormals[vi * 3 + 2] = tempNormal.z;
      } else {
        mergedNormals[vi * 3 + 1] = 1.0; // default up normal
      }

      // UV (pass through)
      if (uvAttr) {
        mergedUVs[vi * 2] = uvAttr.getX(i);
        mergedUVs[vi * 2 + 1] = uvAttr.getY(i);
      }

      // Per-vertex color, alpha and texture flag
      if (meshSharesTexture) {
        mergedColors[vi * 3] = 1.0;
        mergedColors[vi * 3 + 1] = 1.0;
        mergedColors[vi * 3 + 2] = 1.0;
        mergedStaticAlpha[vi] = matOpacity;
        mergedUseMap[vi] = 1.0;
      } else if (texPixels && uvAttr) {
        // Own texture → bake sampled color + alpha into vertex attributes
        let u = uvAttr.getX(i);
        let v = uvAttr.getY(i);
        u = u - Math.floor(u);
        v = v - Math.floor(v);
        const px = Math.min(Math.floor(u * texW), texW - 1);
        const py = Math.min(Math.floor((1 - v) * texH), texH - 1);
        const idx = (py * texW + px) * 4;
        mergedColors[vi * 3] = texPixels[idx] / 255;
        mergedColors[vi * 3 + 1] = texPixels[idx + 1] / 255;
        mergedColors[vi * 3 + 2] = texPixels[idx + 2] / 255;
        mergedStaticAlpha[vi] = (texPixels[idx + 3] / 255) * matOpacity;
        mergedUseMap[vi] = 0.0;
      } else {
        mergedColors[vi * 3] = cr;
        mergedColors[vi * 3 + 1] = cg;
        mergedColors[vi * 3 + 2] = cb;
        mergedStaticAlpha[vi] = matOpacity;
        mergedUseMap[vi] = 0.0;
      }
    }

    // Indices (offset by vertexOffset)
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) {
        mergedIndices.push(geo.index.getX(i) + vertexOffset);
      }
    } else {
      for (let i = 0; i < info.vertexCount; i++) {
        mergedIndices.push(vertexOffset + i);
      }
    }

    vertexOffset += info.vertexCount;
  }

  // Create merged BufferGeometry
  const mergedGeometry = new BufferGeometry();
  mergedGeometry.setAttribute('position', new BufferAttribute(mergedPositions, 3));
  mergedGeometry.setAttribute('normal', new BufferAttribute(mergedNormals, 3));
  mergedGeometry.setAttribute('uv', new BufferAttribute(mergedUVs, 2));
  mergedGeometry.setIndex(mergedIndices);

  // Add vertex index, vertex color, and texture flag attributes
  const vertexIndices = new Float32Array(totalVertices);
  for (let i = 0; i < totalVertices; i++) vertexIndices[i] = i;
  mergedGeometry.setAttribute('aVertexIndex', new BufferAttribute(vertexIndices, 1));
  mergedGeometry.setAttribute('aVertexColor', new BufferAttribute(mergedColors, 3));
  mergedGeometry.setAttribute('aVertexAlpha', new BufferAttribute(mergedStaticAlpha, 1));
  mergedGeometry.setAttribute('aUseMap', new BufferAttribute(mergedUseMap, 1));

  // VAT texture: 1-frame with tiled layout
  const texWidth = Math.min(totalVertices, MAX_VAT_WIDTH);
  const rowsPerFrame = Math.ceil(totalVertices / texWidth);
  const texHeight = rowsPerFrame;

  const data = new Float32Array(texWidth * texHeight * 4);
  for (let v = 0; v < totalVertices; v++) {
    const col = v % texWidth;
    const localRow = Math.floor(v / texWidth);
    const offset = (localRow * texWidth + col) * 4;
    data[offset] = mergedPositions[v * 3];
    data[offset + 1] = mergedPositions[v * 3 + 1];
    data[offset + 2] = mergedPositions[v * 3 + 2];
    data[offset + 3] = 1.0;
  }

  const positionTexture = new DataTexture(data, texWidth, texHeight, RGBAFormat, FloatType);
  positionTexture.minFilter = NearestFilter;
  positionTexture.magFilter = NearestFilter;
  positionTexture.needsUpdate = true;

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
    vertexCount: totalVertices,
    totalFrames: 1,
    texWidth,
    rowsPerFrame,
    animations,
    geometry: mergedGeometry,
    diffuseMap,
    baseColor,
    isUnlit,
    fps: DEFAULT_BAKE_FPS,
  };
}
