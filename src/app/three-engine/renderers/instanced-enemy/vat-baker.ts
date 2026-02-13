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
  Material,
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
  // Find the largest SkinnedMesh (most vertices = main body)
  let skinnedMesh: SkinnedMesh | null = null;
  let maxSkinnedVertices = 0;
  modelRoot.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh) {
      const sm = node as SkinnedMesh;
      const count = sm.geometry.getAttribute('position')?.count ?? 0;
      if (count > maxSkinnedVertices) {
        maxSkinnedVertices = count;
        skinnedMesh = sm;
      }
    }
  });

  if (!skinnedMesh) {
    return null;
  }

  const sm = skinnedMesh as SkinnedMesh;
  const geometry = sm.geometry;
  const posAttr = geometry.getAttribute('position');
  const vertexCount = posAttr.count;

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
    });
    totalFrames += frameCount;
  }

  // Compute mesh-to-root transform: applyBoneTransform returns positions
  // in SkinnedMesh local space. If the mesh is nested inside groups with
  // transforms, we need to convert to model-root space.
  modelRoot.updateMatrixWorld(true);
  const meshToRoot = new Matrix4();
  const rootInverse = new Matrix4().copy(modelRoot.matrixWorld).invert();
  meshToRoot.multiplyMatrices(rootInverse, sm.matrixWorld);

  // Also transform normals in the cloned geometry later
  const normalMatrix = new Matrix3().getNormalMatrix(meshToRoot);

  // Compute tiled texture dimensions (cap width to GPU-safe limit)
  const texWidth = Math.min(vertexCount, MAX_VAT_WIDTH);
  const rowsPerFrame = Math.ceil(vertexCount / texWidth);
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

      // Bake each vertex position (tiled layout for large vertex counts)
      for (let v = 0; v < vertexCount; v++) {
        tempVec.fromBufferAttribute(posAttr, v);
        sm.applyBoneTransform(v, tempVec);
        // Transform from mesh-local to model-root space
        tempVec.applyMatrix4(meshToRoot);

        const col = v % texWidth;
        const localRow = Math.floor(v / texWidth);
        const globalRow = (entry.frameStart + frame) * rowsPerFrame + localRow;
        const offset = (globalRow * texWidth + col) * 4;
        data[offset] = tempVec.x;
        data[offset + 1] = tempVec.y;
        data[offset + 2] = tempVec.z;
        data[offset + 3] = 1.0;
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

  // Extract material properties
  let diffuseMap: Texture | null = null;
  let isUnlit = false;
  let baseColor = { r: 1.0, g: 1.0, b: 1.0 };
  const meshMaterial = (sm as Mesh).material as Material;
  if (meshMaterial) {
    const typed = meshMaterial as MeshStandardMaterial & MeshBasicMaterial;
    if (typed.map) {
      diffuseMap = typed.map;
    }
    if (typed.color) {
      baseColor = { r: typed.color.r, g: typed.color.g, b: typed.color.b };
    }
    isUnlit = meshMaterial instanceof MeshBasicMaterial;
  }

  // Clone geometry and add vertex index attribute
  const clonedGeometry = geometry.clone();
  const vertexIndices = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) vertexIndices[i] = i;
  clonedGeometry.setAttribute('aVertexIndex', new BufferAttribute(vertexIndices, 1));

  // Transform normals from mesh-local to model-root space
  const normalAttr = clonedGeometry.getAttribute('normal');
  if (normalAttr) {
    const tempNormal = new Vector3();
    for (let i = 0; i < normalAttr.count; i++) {
      tempNormal.fromBufferAttribute(normalAttr, i);
      tempNormal.applyMatrix3(normalMatrix).normalize();
      (normalAttr as BufferAttribute).setXYZ(i, tempNormal.x, tempNormal.y, tempNormal.z);
    }
    normalAttr.needsUpdate = true;
  }

  // Remove skinning attributes (not needed for VAT rendering)
  clonedGeometry.deleteAttribute('skinIndex');
  clonedGeometry.deleteAttribute('skinWeight');

  // Per-vertex color and texture flag (for shader: use texture vs vertex color)
  const vertexColorData = new Float32Array(vertexCount * 3);
  const useMapData = new Float32Array(vertexCount);
  const hasMap = diffuseMap !== null;
  for (let i = 0; i < vertexCount; i++) {
    vertexColorData[i * 3] = baseColor.r;
    vertexColorData[i * 3 + 1] = baseColor.g;
    vertexColorData[i * 3 + 2] = baseColor.b;
    useMapData[i] = hasMap ? 1.0 : 0.0;
  }
  clonedGeometry.setAttribute('aVertexColor', new BufferAttribute(vertexColorData, 3));
  clonedGeometry.setAttribute('aUseMap', new BufferAttribute(useMapData, 1));

  return {
    positionTexture,
    vertexCount,
    totalFrames,
    texWidth,
    rowsPerFrame,
    animations: animEntries,
    geometry: clonedGeometry,
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
  const mergedUseMap = new Float32Array(totalVertices);
  const mergedIndices: number[] = [];
  const tempVec = new Vector3();
  const tempNormal = new Vector3();

  let vertexOffset = 0;
  for (const info of meshInfos) {
    const geo = info.mesh.geometry;
    const posAttr = geo.getAttribute('position');
    const normalAttr = geo.getAttribute('normal');
    const uvAttr = geo.getAttribute('uv');

    // Per-mesh material color and texture flag
    const mat = info.mesh.material as MeshStandardMaterial & MeshBasicMaterial;
    const meshHasSharedMap = !!(mat && mat.map && mat.map === diffuseMap);
    const cr = mat && mat.color ? mat.color.r : 1.0;
    const cg = mat && mat.color ? mat.color.g : 1.0;
    const cb = mat && mat.color ? mat.color.b : 1.0;

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

      // Per-vertex color and texture flag
      if (meshHasSharedMap) {
        // This mesh uses the shared texture → white vertex color, flag=1
        mergedColors[vi * 3] = 1.0;
        mergedColors[vi * 3 + 1] = 1.0;
        mergedColors[vi * 3 + 2] = 1.0;
        mergedUseMap[vi] = 1.0;
      } else {
        // No texture for this mesh → use material color
        mergedColors[vi * 3] = cr;
        mergedColors[vi * 3 + 1] = cg;
        mergedColors[vi * 3 + 2] = cb;
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
