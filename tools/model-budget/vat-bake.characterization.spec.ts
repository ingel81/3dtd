/**
 * Characterization of the VAT bake for the split of vat-baker.ts: every enemy
 * model baked as the game does it (loaded like generate.spec.ts loads it), and
 * synthetic models for what the assets leave out (tiled frames past
 * MAX_VAT_WIDTH, own and shared textures, missing normals, UVs and indices,
 * float32 texels, the null cases). Each result is hashed field by field.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  FloatType,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  RGBAFormat,
  Skeleton,
  SkinnedMesh,
  Texture,
  Uint16BufferAttribute,
  Vector3,
  VectorKeyframeTrack,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

import { ENEMY_TYPES, type EnemyTypeConfig } from '../../src/app/configs/enemy-types.config';
import {
  bakeEnemyVAT,
  bakeObjectAnimVAT,
  bakeStaticVAT,
  bakeVAT,
  type VATData,
} from '../../src/app/three-engine/renderers/instanced-enemy/vat-baker';
import { decodePng, imageSize } from './model-inspect';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex').slice(0, 16);
const bytes = (array: ArrayBufferView) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

function textureId(texture: Texture | null): string | null {
  if (!texture) return null;
  const image = texture.image as { data?: ArrayBufferView; width?: number; height?: number } | undefined;
  return image?.data ? `${image.width}x${image.height}:${hash(bytes(image.data))}` : 'no-image';
}

/** Every field of a bake, hashed; the root's pose after the bake as well (the bakers move it). */
function fingerprint(vat: VATData | null, root?: Object3D): string {
  if (!vat) return 'null';
  const texture = vat.positionTexture;
  const data = texture.image.data as Float32Array | Uint16Array;
  const geometry = vat.geometry;
  const attributes = Object.entries(geometry.attributes).map(([name, attribute]) => {
    const array = attribute.array as Float32Array;
    return [name, attribute.itemSize, attribute.count, array.constructor.name, hash(bytes(array))];
  });
  const index = geometry.index ? [geometry.index.array.constructor.name, hash(bytes(geometry.index.array))] : null;
  const pose: number[][] = [];
  root?.traverse((node) => pose.push(node.matrixWorld.toArray()));
  return hash(JSON.stringify({
    texture: [texture.image.width, texture.image.height, texture.type, texture.format, texture.minFilter,
      texture.magFilter, texture.version, data.constructor.name, hash(bytes(data))],
    encoding: vat.encoding,
    vertexCount: vat.vertexCount,
    totalFrames: vat.totalFrames,
    texWidth: vat.texWidth,
    rowsPerFrame: vat.rowsPerFrame,
    fps: vat.fps,
    animations: [...vat.animations.entries()],
    attributes,
    index,
    groups: geometry.groups,
    diffuseMap: textureId(vat.diffuseMap),
    isUnlit: vat.isUnlit,
    alpha: vat.alpha,
    baseColor: vat.baseColor,
    side: vat.side,
    modelMinY: vat.modelMinY,
    modelMaxY: vat.modelMaxY,
    pose: hash(JSON.stringify(pose)),
  }));
}

/** Loads a model with the game's loaders, base colour PNGs decoded in Node, as generate.spec.ts does. */
async function loadModel(url: string) {
  const path = resolve(ROOT, 'public', url);
  const file = readFileSync(path);
  const buffer = new ArrayBuffer(file.length);
  new Uint8Array(buffer).set(file);
  const loader = new GLTFLoader();
  loader.register((parser) => ({
    name: 'characterization-base-colour',
    beforeRoot: () => {
      for (const texture of parser.json.textures ?? []) delete texture.extensions;
      return null;
    },
    loadTexture: async (index: number) => {
      const baseColour = (parser.json.materials ?? []).some(
        (m: { pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }) =>
          m.pbrMetallicRoughness?.baseColorTexture?.index === index,
      );
      const image = parser.json.images?.[parser.json.textures[index].source];
      if (!baseColour || !image) return null;
      const png: Buffer | null = image.bufferView !== undefined
        ? Buffer.from(await parser.getDependency('bufferView', image.bufferView))
        : image.uri ? readFileSync(resolve(dirname(path), decodeURIComponent(image.uri))) : null;
      if (png && imageSize(png)?.mimeType === 'image/jpeg') return null;
      const pixels = png ? decodePng(png) : null;
      return new Texture(pixels ?? undefined);
    },
  }));
  return loader.parseAsync(buffer, '');
}

/** An RGBA texture whose texels come from `texel`, readable by texturePixels. */
function pixelTexture(width: number, height: number, texel: (x: number, y: number) => number[]): DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(texel(x, y), (y * width + x) * 4);
  }
  return new DataTexture(data, width, height, RGBAFormat);
}

const shared = pixelTexture(4, 4, (x, y) => [40 * x, 50 * y, 200, x === 3 && y === 0 ? 128 : 255]);
const own = pixelTexture(8, 2, (x, y) => [30 * x, 120 * y, 17 * x + y, 255]);

/** A strip of `quads` quads, non-indexed, with UVs running past 1 and no normals. */
function strip(quads: number, withUv = true): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i < quads; i++) {
    const x = i * 0.01;
    const y = Math.sin(i * 0.37) * 0.2;
    positions.push(x, y, 0, x + 0.01, y, 0, x, y + 0.5, 0.1, x + 0.01, y, 0, x + 0.01, y + 0.5, 0.1, x, y + 0.5, 0.1);
    const u = i * 0.013 - 0.4;
    uvs.push(u, 0.2, u + 0.01, 0.2, u, 1.3, u + 0.01, 0.2, u + 0.01, 1.3, u, 1.3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  if (withUv) geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  return geometry;
}

/** Four meshes under a moved, turned and scaled parent: shared map, own map, no UV, a second copy of the shared map. */
function rigidModel(): { root: Group; partA: Mesh; partB: Mesh } {
  const root = new Group();
  root.position.set(3, -1, 2);
  root.rotation.set(0.2, 1.1, -0.3);
  const body = new Group();
  body.scale.set(1.5, 0.8, 1.2);
  root.add(body);

  const blending = new MeshStandardMaterial({ map: shared, transparent: true });
  blending.color.setRGB(0.9, 0.6, 0.3);
  const partA = new Mesh(new BoxGeometry(1, 2, 0.5, 3, 4, 2), blending);
  partA.name = 'partA';
  partA.position.set(0, 1, 0);

  const masked = new MeshBasicMaterial({ map: own, alphaTest: 0.4 });
  masked.color.setRGB(0.2, 0.7, 0.4);
  // 1400 quads: 8400 vertices with the others, a frame spans two rows
  const partB = new Mesh(strip(1400), masked);
  partB.name = 'partB';
  partB.position.set(0.5, 0.2, -0.3);
  partB.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.4);

  const tinted = new MeshStandardMaterial({ opacity: 0.7, side: DoubleSide });
  tinted.color.setRGB(0.1, 0.2, 0.9);
  const partC = new Mesh(strip(12, false), tinted);
  partC.position.set(-1, 0, 0);

  const sameSource = shared.clone();
  const partD = new Mesh(new BoxGeometry(0.3, 0.3, 0.3), new MeshStandardMaterial({ map: sameSource }));
  partD.position.set(0, 2.5, 0.2);

  body.add(partA, partB, partC, partD);
  return { root, partA, partB };
}

/** Two skinned meshes on a two-bone chain: one indexed with the shared map, one strip with its own map. */
function skinnedModel(): Group {
  const root = new Group();
  root.position.set(0, 0.5, 0);
  const hip = new Bone();
  hip.name = 'hip';
  const knee = new Bone();
  knee.name = 'knee';
  knee.position.set(0, 1, 0);
  hip.add(knee);

  const skin = (geometry: BufferGeometry, material: MeshStandardMaterial | MeshBasicMaterial) => {
    const count = geometry.getAttribute('position').count;
    const index: number[] = [];
    const weight: number[] = [];
    for (let v = 0; v < count; v++) {
      const y = geometry.getAttribute('position').getY(v);
      const k = Math.min(1, Math.max(0, y));
      index.push(0, 1, 0, 0);
      weight.push(1 - k, k, 0, 0);
    }
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(index, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(weight, 4));
    return new SkinnedMesh(geometry, material);
  };
  const body = skin(new BoxGeometry(0.6, 2, 0.4, 2, 6, 2).translate(0, 1, 0), new MeshStandardMaterial({ map: shared }));
  const cloak = skin(strip(1380), new MeshStandardMaterial({ map: own, color: 0x88aa66 }));
  cloak.position.set(0.1, 0, 0.2);
  root.add(hip, body, cloak);
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton([hip, knee]);
  body.bind(skeleton);
  cloak.bind(skeleton);
  return root;
}

const walk = new AnimationClip('walk', 0.5, [
  new VectorKeyframeTrack('hip.position', [0, 0.5], [0, 0, 0, 0.4, 0.1, 0]),
  new QuaternionKeyframeTrack('knee.quaternion', [0, 0.5], [
    ...new Quaternion().toArray(), ...new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.8).toArray(),
  ]),
]);
const die = new AnimationClip('die', 5, [new VectorKeyframeTrack('hip.position', [0, 5], [0, 0, 0, 0, -5, 0])]);
const partWalk = new AnimationClip('walk', 0.5, [
  new VectorKeyframeTrack('partA.position', [0, 0.5], [0, 1, 0, 0.3, 1.2, 0]),
  new QuaternionKeyframeTrack('partB.quaternion', [0, 0.5], [
    ...new Quaternion().toArray(), ...new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.2).toArray(),
  ]),
]);
const partDie = new AnimationClip('die', 5, [new VectorKeyframeTrack('partA.position', [0, 5], [0, 1, 0, 0, -4, 0])]);

const animated = { hasAnimations: true, walkAnimation: 'walk', deathAnimation: 'die', animationSpeed: 1, scale: 1 } as
  EnemyTypeConfig;
const still = { hasAnimations: false, scale: 2.5 } as EnemyTypeConfig;

describe('VAT bake, characterized for the split of vat-baker.ts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bakes every enemy model as before', async () => {
    const prints: Record<string, string> = {};
    for (const [id, config] of Object.entries(ENEMY_TYPES)) {
      if (!config.modelUrl || !existsSync(resolve(ROOT, 'public', config.modelUrl))) continue;
      const gltf = await loadModel(config.modelUrl);
      prints[id] = fingerprint(bakeEnemyVAT(config, SkeletonUtils.clone(gltf.scene), gltf.animations));
    }
    // The worm boss's head and ring go through the static path
    expect(Object.keys(prints)).toContain('worm');
    expect(Object.keys(prints)).toContain('worm-segment');
    expect(prints).toEqual({
      bat: '42e6d1469559dd2b',
      bear: '5871df4ac22aa369',
      dragon: 'd9dba274d0fbb808',
      ghost: 'd73f07e7dda9aea8',
      herbert: 'a494a9d0b0c3c0ad',
      hornet: '57b05cd0973df34a',
      mammoth: '605813843db92336',
      mech: '7cbe68ec7643ff74',
      ooze: '1fc7b204fadda49a',
      penguin: 'b7c78d23bccee2a6',
      rat: '7503c41fc3f4751e',
      skeleton: '688241a2bfd542e4',
      'skeleton-minion': '2278f53f15fda412',
      'slime-clump': '8d551daa82cc905f',
      spider: '5e1536978a345e1e',
      'stone-golem': 'ab553a73df4a64be',
      tank: '90c62788ee78c78f',
      wallsmasher: 'd65e717f78475fb8',
      worm: '5e6c635fd31e7648',
      'worm-segment': 'a05aac8e8c8efb0c',
      wraith: '857d7bc36e8fb197',
      zombie: '1808c223b8da58da',
      'zombie-soldier': 'ce8f3da57d5148c4',
      'zombie-v2': 'f3b5e2365e6ff153',
    });
  }, 120_000);

  it('bakes the synthetic models as before', () => {
    const prints: Record<string, string> = {};
    let model = rigidModel();
    const baked = bakeEnemyVAT(still, model.root, [])!;
    // Past MAX_VAT_WIDTH vertices: a frame spans two rows
    expect(baked.rowsPerFrame).toBe(2);
    expect([...baked.animations.keys()]).toEqual(['static']);
    prints['static'] = fingerprint(baked, model.root);
    model = rigidModel();
    const staticFloat = bakeStaticVAT(model.root, 1e6)!;
    expect(staticFloat.encoding.type).toBe(FloatType);
    prints['staticFloat32'] = fingerprint(staticFloat, model.root);
    model = rigidModel();
    // No skinned mesh: bakeEnemyVAT falls back to the object-animation bake
    const object = bakeEnemyVAT(animated, model.root, [partWalk, partDie])!;
    expect([...object.animations.keys()]).toEqual(['walk', 'die']);
    expect(object.rowsPerFrame).toBe(2);
    prints['object'] = fingerprint(object, model.root);
    model = rigidModel();
    prints['objectFloat32'] = fingerprint(
      bakeObjectAnimVAT(model.root, [partWalk, partDie], [{ name: 'walk', seconds: Infinity }], 1e6), model.root,
    );
    let skinned = skinnedModel();
    const skin = bakeEnemyVAT(animated, skinned, [walk, die])!;
    expect([...skin.animations.keys()]).toEqual(['walk', 'die']);
    expect(skin.rowsPerFrame).toBe(2);
    prints['skinned'] = fingerprint(skin, skinned);
    skinned = skinnedModel();
    const skinFloat = bakeVAT(skinned, [walk, die], [{ name: 'die', seconds: 1 }], 1e6, 24)!;
    expect(skinFloat.fps).toBe(24);
    expect(skinFloat.encoding.type).toBe(FloatType);
    prints['skinnedFloat32'] = fingerprint(skinFloat, skinned);
    expect(prints).toEqual({
      static: '1137c544d02cddf1',
      staticFloat32: '441d2e583abf03d5',
      object: '4adb0f9ea96f30e5',
      objectFloat32: 'f606905ea5b2e6e6',
      skinned: 'cb291ab7d46d29fa',
      skinnedFloat32: '2703ed06c672ab67',
    });
  });

  it('returns null where it did', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(bakeStaticVAT(new Group(), 1)).toBeNull();
    expect(bakeVAT(rigidModel().root, [walk], [{ name: 'walk', seconds: Infinity }], 1)).toBeNull();
    expect(bakeVAT(skinnedModel(), [walk], [{ name: 'run', seconds: Infinity }], 1)).toBeNull();
    expect(bakeObjectAnimVAT(new Group(), [partWalk], [{ name: 'walk', seconds: Infinity }], 1)).toBeNull();
    expect(bakeObjectAnimVAT(rigidModel().root, [partWalk], [{ name: 'run', seconds: Infinity }], 1)).toBeNull();
    expect(warn.mock.calls).toEqual([
      ['[VATBaker] No matching animation clips found'],
      ['[VATBaker] No matching animation clips found for object-anim bake'],
    ]);
  });
});
