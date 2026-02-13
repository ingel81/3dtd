import {
  AnimationClip,
  AnimationMixer,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  SkinnedMesh,
  Vector3,
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
}

const DEFAULT_BAKE_FPS = 30;

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
  // Find the primary SkinnedMesh
  let skinnedMesh: SkinnedMesh | null = null;
  modelRoot.traverse((node) => {
    if (!skinnedMesh && (node as SkinnedMesh).isSkinnedMesh) {
      skinnedMesh = node as SkinnedMesh;
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

  // Allocate VAT data (width=vertexCount, height=totalFrames, RGBA32F)
  const data = new Float32Array(vertexCount * totalFrames * 4);
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

      // Bake each vertex position
      const rowOffset = (entry.frameStart + frame) * vertexCount * 4;

      for (let v = 0; v < vertexCount; v++) {
        tempVec.fromBufferAttribute(posAttr, v);
        sm.applyBoneTransform(v, tempVec);

        const offset = rowOffset + v * 4;
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
  const positionTexture = new DataTexture(data, vertexCount, totalFrames, RGBAFormat, FloatType);
  positionTexture.minFilter = NearestFilter;
  positionTexture.magFilter = NearestFilter;
  positionTexture.needsUpdate = true;

  // Extract diffuse texture from material
  let diffuseMap: Texture | null = null;
  let isUnlit = false;
  const meshMaterial = (sm as Mesh).material as Material;
  if (meshMaterial) {
    const typed = meshMaterial as MeshStandardMaterial & MeshBasicMaterial;
    if (typed.map) {
      diffuseMap = typed.map;
    }
    isUnlit = meshMaterial instanceof MeshBasicMaterial;
  }

  // Clone geometry and add vertex index attribute
  const clonedGeometry = geometry.clone();
  const vertexIndices = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) vertexIndices[i] = i;
  clonedGeometry.setAttribute('aVertexIndex', new BufferAttribute(vertexIndices, 1));

  // Remove skinning attributes (not needed for VAT rendering)
  clonedGeometry.deleteAttribute('skinIndex');
  clonedGeometry.deleteAttribute('skinWeight');

  return {
    positionTexture,
    vertexCount,
    totalFrames,
    animations: animEntries,
    geometry: clonedGeometry,
    diffuseMap,
    isUnlit,
    fps,
  };
}

/**
 * Bake a static (non-animated) mesh into a 1-frame VAT.
 * Used for enemy types without skeletal animations (e.g., tank).
 */
export function bakeStaticVAT(modelRoot: Object3D): VATData | null {
  // Find first Mesh
  let mesh: Mesh | null = null;
  modelRoot.traverse((node) => {
    if (!mesh && (node as Mesh).isMesh) {
      mesh = node as Mesh;
    }
  });

  if (!mesh) return null;

  const geometry = (mesh as Mesh).geometry;
  const posAttr = geometry.getAttribute('position');
  const vertexCount = posAttr.count;

  // Create 1-frame VAT with rest-pose positions
  const data = new Float32Array(vertexCount * 1 * 4);
  for (let v = 0; v < vertexCount; v++) {
    data[v * 4] = posAttr.getX(v);
    data[v * 4 + 1] = posAttr.getY(v);
    data[v * 4 + 2] = posAttr.getZ(v);
    data[v * 4 + 3] = 1.0;
  }

  const positionTexture = new DataTexture(data, vertexCount, 1, RGBAFormat, FloatType);
  positionTexture.minFilter = NearestFilter;
  positionTexture.magFilter = NearestFilter;
  positionTexture.needsUpdate = true;

  // Extract diffuse texture
  let diffuseMap: Texture | null = null;
  let isUnlit = false;
  const meshMaterial = (mesh as Mesh).material as Material;
  if (meshMaterial) {
    const typed = meshMaterial as MeshStandardMaterial & MeshBasicMaterial;
    if (typed.map) diffuseMap = typed.map;
    isUnlit = meshMaterial instanceof MeshBasicMaterial;
  }

  // Clone geometry and add vertex index attribute
  const clonedGeometry = geometry.clone();
  const vertexIndices = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) vertexIndices[i] = i;
  clonedGeometry.setAttribute('aVertexIndex', new BufferAttribute(vertexIndices, 1));
  clonedGeometry.deleteAttribute('skinIndex');
  clonedGeometry.deleteAttribute('skinWeight');

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
    vertexCount,
    totalFrames: 1,
    animations,
    geometry: clonedGeometry,
    diffuseMap,
    isUnlit,
    fps: DEFAULT_BAKE_FPS,
  };
}
