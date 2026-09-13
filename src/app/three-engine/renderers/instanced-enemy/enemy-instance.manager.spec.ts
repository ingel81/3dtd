import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import { EnemyInstanceManager, type TypePool } from './enemy-instance.manager';
import { InstancedEnemyRenderer } from './instanced-enemy.renderer';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import type { VATData } from './vat-baker';
import type { VATAnimationEntry } from './vat-clips';

/** Minimal VAT data with the given clips: enough for a pool, nothing is drawn. */
function fakeVat(clips: string[]): VATData {
  const animations = new Map<string, VATAnimationEntry>();
  clips.forEach((name, i) =>
    animations.set(name, { name, frameStart: i * 10, frameCount: 10, duration: 1, totalTime: 1 }),
  );
  const frames = clips.length * 10;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  return {
    positionTexture: new DataTexture(new Float32Array(3 * frames * 4), 3, frames, RGBAFormat, FloatType),
    encoding: { type: FloatType, origin: [0, 0, 0], extent: [1, 1, 1], halfFloatError: 0 },
    vertexCount: 3,
    totalFrames: frames,
    animations,
    geometry,
    diffuseMap: null,
    isUnlit: false,
    alpha: { mode: 'opaque', cutoff: 0 },
    fps: 10,
    texWidth: 3,
    rowsPerFrame: 1,
    baseColor: { r: 1, g: 1, b: 1 },
    side: FrontSide,
    modelMinY: 0,
    modelMaxY: 1,
  };
}

// Has walk + run clips.
const CONFIG = ENEMY_TYPES['wallsmasher'];
const CLIPS = [CONFIG.walkAnimation!, CONFIG.runAnimation!];

/** Bit pattern of 16 floats, so -0 and +0 (or any last-bit difference) count as different. */
function bits(array: Float32Array, offset: number): number[] {
  return Array.from(new Uint32Array(array.buffer, array.byteOffset + offset * 4, 16));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EnemyInstanceManager', () => {
  let manager: EnemyInstanceManager;

  beforeEach(() => {
    manager = new EnemyInstanceManager(new Scene());
    manager.createPool('wallsmasher', fakeVat(CLIPS), CONFIG);
  });

  it('switches between the walk and run clips', () => {
    const state = manager.addEnemy('a', 'wallsmasher', new Vector3(), 0)!;
    expect(state.isWalking).toBe(true);
    expect(state.currentAnim).toBe(CONFIG.walkAnimation);

    manager.startRunAnimation('a');
    expect(state.isWalking).toBe(false);
    expect(state.currentAnim).toBe(CONFIG.runAnimation);

    manager.startWalkAnimation('a');
    expect(state.isWalking).toBe(true);
    expect(state.currentAnim).toBe(CONFIG.walkAnimation);
  });

  it('glows every type through one shared uniform, pools created later included', () => {
    manager.createPool('zombie', fakeVat(CLIPS), ENEMY_TYPES['zombie']);
    manager.setBloodMoon(1, false);
    manager.createPool('bat', fakeVat(CLIPS), ENEMY_TYPES['bat']);
    const uniforms = ['wallsmasher', 'zombie', 'bat'].map((typeId) =>
      ((manager as unknown as { pools: Map<string, TypePool> }).pools.get(typeId)!.instancedMesh.material as ShaderMaterial).uniforms,
    );
    for (const u of uniforms) {
      expect(u['bloodMoonGlow']).toBe(uniforms[0]['bloodMoonGlow']);
      expect(u['bloodMoonGlow'].value).toBe(1);
    }
    const tint = uniforms[0]['bloodMoonTint'].value as Vector3;
    expect(tint.x).toBeLessThan(1);

    manager.setBloodMoon(0, false);
    expect(uniforms[2]['bloodMoonGlow'].value).toBe(0);
    expect(tint.toArray()).toEqual([1, 1, 1]);
  });

  it('ignores a run request on a dying instance', () => {
    const state = manager.addEnemy('a', 'wallsmasher', new Vector3(), 0)!;
    manager.playDeathAnimation('a');
    manager.startRunAnimation('a');
    expect(state.isWalking).toBe(true);
  });

  it('holds the last baked death frame instead of looping back', () => {
    const scene = new Scene();
    const deathManager = new EnemyInstanceManager(scene);
    // The death clip takes frames 20-29.
    deathManager.createPool('wallsmasher', fakeVat([...CLIPS, CONFIG.deathAnimation!]), CONFIG);
    const state = deathManager.addEnemy('a', 'wallsmasher', new Vector3(), 0)!;
    deathManager.playDeathAnimation('a');

    const frame = () => state.pool.animFrameAttr.getX(state.index);
    deathManager.updateAnimations(0.45 / CONFIG.animationSpeed!); // clip time 0.45 s
    expect(frame()).toBe(24);
    deathManager.updateAnimations(5);
    expect(frame()).toBe(29);
    deathManager.updateAnimations(5);
    expect(frame()).toBe(29);
  });

  it('plays the run clip at its natural rate while the enemy runs at run speed', () => {
    const state = manager.addEnemy('a', 'wallsmasher', new Vector3(), 0)!;
    manager.startRunAnimation('a');
    manager.updateEnemyState(state, new Vector3(), 0, CONFIG.baseSpeed * CONFIG.runSpeedMultiplier!);
    expect(state.speedMultiplier).toBeCloseTo(1, 9);
  });

  it('flags states released on removal and on clear', () => {
    const a = manager.addEnemy('a', 'wallsmasher', new Vector3(), 0)!;
    const b = manager.addEnemy('b', 'wallsmasher', new Vector3(), 0)!;
    expect(a.released).toBe(false);

    manager.removeEnemy('a');
    expect(a.released).toBe(true);
    expect(b.released).toBe(false);

    manager.clear();
    expect(b.released).toBe(true);
  });

  it('shrinks the draw count and the flush range when the top slots are released', () => {
    const a = manager.addEnemy('a', 'wallsmasher', new Vector3(), 0)!;
    manager.addEnemy('b', 'wallsmasher', new Vector3(), 0);
    manager.addEnemy('c', 'wallsmasher', new Vector3(), 0);
    const mesh = a.pool.instancedMesh;
    expect(mesh.count).toBe(3);

    manager.removeEnemy('b'); // a hole, c still holds the top slot
    expect(mesh.count).toBe(3);
    manager.removeEnemy('c'); // the top slot and the hole below it
    expect(mesh.count).toBe(1);

    manager.updateEnemyState(a, new Vector3(1, 2, 3), 0);
    manager.flushDirtyFlags();
    expect(mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 16 }]);

    // The pool grows again from the top, the cut-off slots are not reused out of order.
    expect(manager.addEnemy('d', 'wallsmasher', new Vector3(), 0)!.index).toBe(1);
    expect(mesh.count).toBe(2);

    manager.removeEnemy('a');
    manager.removeEnemy('d');
    expect(mesh.count).toBe(0);
  });

  it('adds no zero-length range once every slot is released', () => {
    const a = manager.addEnemy('a', 'wallsmasher', new Vector3(), 0)!;
    const matrix = a.pool.instancedMesh.instanceMatrix;
    manager.flushDirtyFlags();
    matrix.clearUpdateRanges(); // stands in for the upload

    const version = matrix.version;
    manager.updateEnemyState(a, new Vector3(), 0);
    manager.removeEnemy('a');
    manager.flushDirtyFlags();
    // Nothing is drawn; (0, 0) would make three upload the whole buffer.
    expect(matrix.updateRanges).toEqual([]);
    expect(matrix.version).toBe(version);
  });

  it('keeps the update ranges bounded while nothing uploads', () => {
    // Headless training: enemies come and go, no frame flush, no render.
    for (let i = 0; i < 500; i++) {
      manager.addEnemy(`e${i}`, 'wallsmasher', new Vector3(), 0);
      if (i >= 10) manager.removeEnemy(`e${i - 10}`);
    }
    const pool = manager.getState('e499')!.pool;
    const attributes = [
      pool.instancedMesh.instanceMatrix,
      pool.animFrameAttr,
      pool.tintColorAttr,
    ];
    for (const attribute of attributes) {
      expect(attribute.updateRanges.length).toBeLessThanOrEqual(64);
    }
  });

  it('drops the hit flash of a removed enemy without touching its old slot', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    manager.addEnemy('a', 'wallsmasher', new Vector3(), 0);
    manager.triggerHitFlash('a', 100);
    manager.removeEnemy('a');
    const b = manager.addEnemy('b', 'wallsmasher', new Vector3(), 0)!; // takes a's slot
    manager.setFreezeVisual('b', true);

    now.mockReturnValue(1200);
    manager.expireHitFlashes();
    const tint = b.pool.tintColorAttr;
    expect([tint.getX(b.index), tint.getY(b.index), tint.getZ(b.index)]).toEqual(
      [0.4, 0.8, 1.0].map(Math.fround),
    );
  });

  it('hides the freeze tint while it is off and brings it back on the enemies still slowed', () => {
    type State = NonNullable<ReturnType<EnemyInstanceManager['addEnemy']>>;
    const tintOf = (s: State) => [
      s.pool.tintColorAttr.getX(s.index),
      s.pool.tintColorAttr.getY(s.index),
      s.pool.tintColorAttr.getZ(s.index),
    ];
    const freeze = [0.4, 0.8, 1.0].map(Math.fround);
    const a = manager.addEnemy('a', 'wallsmasher', new Vector3(), 0)!;
    const b = manager.addEnemy('b', 'wallsmasher', new Vector3(), 0)!;
    manager.setFreezeVisual('a', true);
    manager.setFreezeVisual('b', true);
    manager.setPoisonVisual('b', true);

    manager.setFreezeTintEnabled(false);
    expect(tintOf(a)).toEqual([0, 0, 0]);
    expect(tintOf(b)).toEqual([0.2, 0.8, 0.1].map(Math.fround)); // poison shows through
    manager.setFreezeVisual('a', true); // slowed again while hidden
    expect(tintOf(a)).toEqual([0, 0, 0]);

    manager.setFreezeTintEnabled(true);
    expect(tintOf(a)).toEqual(freeze);
    expect(tintOf(b)).toEqual(freeze);
  });

  it('writes the matrix Matrix4.compose + setMatrixAt would, bit for bit', () => {
    const state = manager.addEnemy('a', 'wallsmasher', new Vector3(), 0)!;
    const array = state.pool.instancedMesh.instanceMatrix.array as Float32Array;
    const expected = new Float32Array(16);
    const up = new Vector3(0, 1, 0);
    const position = new Vector3(12.5, -3.25, 1e4 / 3);

    const check = (heading: number, extraRotation: number, scale: number, y: number) => {
      const q = new Quaternion().setFromAxisAngle(up, heading + (CONFIG.headingOffset ?? 0) + extraRotation);
      new Matrix4()
        .compose(new Vector3(position.x, y, position.z), q, new Vector3(scale, scale, scale))
        .toArray(expected);
      expect(bits(array, state.index * 16)).toEqual(bits(expected, 0));
    };

    for (const heading of [0, 0.3, -2.9, Math.PI, 1e-9, -0]) {
      manager.updateEnemyState(state, position, heading, 3);
      check(heading, 0, CONFIG.scale, position.y);
    }

    // Debug overrides take the other branches (scale, height delta, rotation).
    manager.applyDebugOverrides('a', { scale: 1.7, heightOffset: 2.5, rotation: 0.4 });
    for (const heading of [0.1, -1.2]) {
      manager.updateEnemyState(state, position, heading, 3);
      check(heading, 0.4, 1.7, position.y + (2.5 - CONFIG.heightOffset));
    }
  });
});

/** Renderer with a wallsmasher pool from fakeVat(); nothing is loaded. */
function rendererWithPool(scene = new Scene()): InstancedEnemyRenderer {
  const sync = { geoToLocal: () => new Vector3() };
  const renderer = new InstancedEnemyRenderer(scene, sync as never, {} as never);
  (renderer as unknown as { instanceManager: EnemyInstanceManager }).instanceManager.createPool(
    'wallsmasher',
    fakeVat(CLIPS),
    CONFIG,
  );
  return renderer;
}

describe('InstancedEnemyRenderer slots', () => {
  it('keeps the health-bar slot on the state and releases the state on remove', async () => {
    const renderer = rendererWithPool();

    await renderer.create('a', 'wallsmasher', 0, 0, 0);
    await renderer.create('b', 'wallsmasher', 0, 0, 0);
    const a = renderer.resolveSlot('a')!;
    const b = renderer.resolveSlot('b')!;
    expect([a.healthBarIndex, b.healthBarIndex]).toEqual([0, 1]);

    renderer.remove('a');
    expect(a.released).toBe(true);
    expect(renderer.resolveSlot('a')).toBeNull();

    // The freed slots are handed to the next enemy, which gets a fresh state.
    await renderer.create('c', 'wallsmasher', 0, 0, 0);
    const c = renderer.resolveSlot('c')!;
    expect(c).not.toBe(a);
    expect(c.healthBarIndex).toBe(0);
  });

  it('keeps flushing positions and health bars with animations off', async () => {
    const scene = new Scene();
    const renderer = rendererWithPool(scene);
    await renderer.create('a', 'wallsmasher', 0, 0, 0);
    const slot = renderer.resolveSlot('a')!;
    const bars = scene.children.find((o) => (o as Mesh).geometry?.getAttribute('aCenter')) as Mesh;
    const center = bars.geometry.getAttribute('aCenter') as InstancedBufferAttribute;
    const matrix = slot.pool.instancedMesh.instanceMatrix;
    const camera = new PerspectiveCamera();

    renderer.updateAnimations(0.016, camera); // flush what create() left behind
    renderer.setAnimationsEnabled(false);
    const versions = [matrix.version, center.version, slot.pool.animFrameAttr.version];

    renderer.updateSlot(slot, new Vector3(5, 0, 5), 0.5, 0.8, CONFIG.baseSpeed);
    renderer.updateAnimations(0.5, camera);

    expect(matrix.version).toBeGreaterThan(versions[0]);
    expect(center.version).toBeGreaterThan(versions[1]);
    // Only the VAT frame stands still.
    expect(slot.pool.animFrameAttr.version).toBe(versions[2]);
  });

  it('lets a hit flash run out with animations off', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const renderer = rendererWithPool();
    await renderer.create('a', 'wallsmasher', 0, 0, 0);
    const slot = renderer.resolveSlot('a')!;
    const tint = slot.pool.tintColorAttr;
    renderer.setAnimationsEnabled(false);

    renderer.triggerHitFlash('a', 100);
    expect(tint.getX(slot.index)).toBe(Math.fround(0.85));

    now.mockReturnValue(1200);
    renderer.updateAnimations(0.016, new PerspectiveCamera());
    expect([tint.getX(slot.index), tint.getY(slot.index), tint.getZ(slot.index)]).toEqual([0, 0, 0]);
  });

  describe('setRenderType (a worm segment becoming a head)', () => {
    const withSecondPool = (): InstancedEnemyRenderer => {
      const renderer = rendererWithPool();
      (renderer as unknown as { instanceManager: EnemyInstanceManager }).instanceManager.createPool(
        'zombie',
        fakeVat(CLIPS),
        ENEMY_TYPES['zombie'],
      );
      return renderer;
    };

    it('moves the enemy into the other pool with its place, health bar and tints', async () => {
      const renderer = withSecondPool();
      await renderer.create('b', 'wallsmasher', 0, 0, 0);
      await renderer.create('a', 'wallsmasher', 0, 0, 0);
      const old = renderer.resolveSlot('a')!;
      renderer.updateSlot(old, new Vector3(5, 1, 7), 0.5, 1, CONFIG.baseSpeed);
      renderer.setPoisonVisual('a', true);
      const before = new Matrix4();
      old.pool.instancedMesh.getMatrixAt(old.index, before);

      renderer.setRenderType('a', 'zombie');

      const moved = renderer.resolveSlot('a')!;
      expect(old.released).toBe(true);
      expect(old.pool.instances.has('a')).toBe(false);
      expect(moved.typeId).toBe('zombie');
      expect(moved.healthBarIndex).toBe(old.healthBarIndex);
      expect(moved.poisoned).toBe(true);
      expect(moved.pool.tintColorAttr.getY(moved.index)).toBe(Math.fround(0.8));
      const after = new Matrix4();
      moved.pool.instancedMesh.getMatrixAt(moved.index, after);
      expect(after.elements).toEqual(before.elements);
      expect(renderer.count).toBe(2);
    });

    it('leaves the enemy where it is without a pool for the type', async () => {
      const renderer = rendererWithPool();
      await renderer.create('a', 'wallsmasher', 0, 0, 0);
      const slot = renderer.resolveSlot('a')!;
      renderer.setRenderType('a', 'mech');
      expect(renderer.resolveSlot('a')).toBe(slot);
      expect(slot.released).toBe(false);
    });
  });
});

describe('EnemyInstanceManager pool visibility', () => {
  const poolMeshes = (scene: Scene) =>
    scene.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh);

  it('keeps a pool out of the render list while no enemy of its type is drawn', () => {
    const scene = new Scene();
    const manager = new EnemyInstanceManager(scene);
    manager.createPool('wallsmasher', fakeVat(CLIPS), CONFIG);
    const [mesh] = poolMeshes(scene);
    expect(mesh.visible).toBe(false);

    manager.addEnemy('a', 'wallsmasher', new Vector3(), 0);
    manager.addEnemy('b', 'wallsmasher', new Vector3(), 0);
    expect(mesh.visible).toBe(true);
    manager.removeEnemy('b');
    expect(mesh.visible).toBe(true);
    manager.removeEnemy('a');
    expect(mesh.visible).toBe(false);

    manager.addEnemy('c', 'wallsmasher', new Vector3(), 0);
    manager.clear();
    expect(mesh.visible).toBe(false);
  });

  it('hides filled pools while enemies are toggled off, also pools baked afterwards', () => {
    const scene = new Scene();
    const manager = new EnemyInstanceManager(scene);
    manager.createPool('wallsmasher', fakeVat(CLIPS), CONFIG);
    manager.addEnemy('a', 'wallsmasher', new Vector3(), 0);

    manager.setVisible(false);
    manager.createPool('zombie', fakeVat(CLIPS), ENEMY_TYPES['zombie']);
    manager.addEnemy('b', 'zombie', new Vector3(), 0);
    expect(poolMeshes(scene).map((m) => m.visible)).toEqual([false, false]);

    manager.setVisible(true);
    expect(poolMeshes(scene).map((m) => m.visible)).toEqual([true, true]);
  });
});

describe('VAT CPU copy', () => {
  const texelsOf = (texture: DataTexture): unknown => (texture.image as { data: unknown }).data;
  /** What three does right after uploading a texture. */
  const upload = (texture: DataTexture): void => texture.onUpdate?.(texture);
  const poolOf = (manager: EnemyInstanceManager, typeId: string): TypePool =>
    (manager as unknown as { pools: Map<string, TypePool> }).pools.get(typeId)!;

  it('drops the CPU copy of a VAT once three has uploaded it', () => {
    const manager = new EnemyInstanceManager(new Scene());
    const vat = fakeVat(CLIPS);
    manager.createPool('wallsmasher', vat, CONFIG);
    expect(texelsOf(vat.positionTexture)).toBeInstanceOf(Float32Array);
    expect(manager.typesWithReleasedVAT()).toEqual([]);

    upload(vat.positionTexture);
    expect(texelsOf(vat.positionTexture)).toBeNull();
    expect(manager.typesWithReleasedVAT()).toEqual(['wallsmasher']);
  });

  it('never asks three to upload a pooled VAT a second time', () => {
    const manager = new EnemyInstanceManager(new Scene());
    const vat = fakeVat(CLIPS);
    manager.createPool('wallsmasher', vat, CONFIG);
    const version = vat.positionTexture.version;

    const a = manager.addEnemy('a', 'wallsmasher', new Vector3(), 0)!;
    manager.updateEnemyState(a, new Vector3(1, 0, 0), 0.5, 3);
    manager.setFreezeVisual('a', true);
    manager.triggerHitFlash('a');
    manager.setFreezeTintEnabled(false);
    manager.playDeathAnimation('a');
    manager.updateAnimations(0.5);
    manager.flushDirtyFlags();
    manager.setVisible(false);
    manager.setVisible(true);
    manager.removeEnemy('a');
    manager.clear();
    // A second bake of a pooled type does not replace the pool.
    manager.createPool('wallsmasher', fakeVat(CLIPS), CONFIG);

    expect(vat.positionTexture.version).toBe(version);
    expect(poolOf(manager, 'wallsmasher').vatData.positionTexture).toBe(vat.positionTexture);
  });

  it('swaps a VAT baked again after a context loss into the material', () => {
    const manager = new EnemyInstanceManager(new Scene());
    const vat = fakeVat(CLIPS);
    manager.createPool('wallsmasher', vat, CONFIG);
    upload(vat.positionTexture);

    const again = fakeVat(CLIPS);
    again.encoding = { ...again.encoding, origin: [1, 2, 3], extent: [4, 5, 6] };
    manager.replaceVATAfterContextLoss('wallsmasher', again);

    const pool = poolOf(manager, 'wallsmasher');
    const uniforms = (pool.instancedMesh.material as ShaderMaterial).uniforms;
    expect(uniforms['vatTexture'].value).toBe(again.positionTexture);
    expect((uniforms['vatOrigin'].value as Vector3).toArray()).toEqual([1, 2, 3]);
    expect((uniforms['vatExtent'].value as Vector3).toArray()).toEqual([4, 5, 6]);
    expect(pool.vatData.positionTexture).toBe(again.positionTexture);
    expect(manager.typesWithReleasedVAT()).toEqual([]);

    upload(again.positionTexture);
    expect(texelsOf(again.positionTexture)).toBeNull();
  });
});

describe('InstancedEnemyRenderer after a context loss', () => {
  /** A renderer with a tank and a wallsmasher pool and an asset cache holding a one-triangle model. */
  function setup() {
    const model = (): Group => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      return new Group().add(new Mesh(geometry, new MeshBasicMaterial()));
    };
    const assets = { getCachedModel: vi.fn(() => ({ animations: [] })), cloneModel: vi.fn(model) };
    const sync = { geoToLocal: () => new Vector3() };
    const renderer = new InstancedEnemyRenderer(new Scene(), sync as never, assets as never);
    const manager = (renderer as unknown as { instanceManager: EnemyInstanceManager }).instanceManager;
    const tank = fakeVat(['static']);
    const wallsmasher = fakeVat(CLIPS);
    manager.createPool('tank', tank, ENEMY_TYPES['tank']);
    manager.createPool('wallsmasher', wallsmasher, CONFIG);
    const pool = (typeId: string): TypePool =>
      (manager as unknown as { pools: Map<string, TypePool> }).pools.get(typeId)!;
    return { renderer, assets, tank, wallsmasher, pool };
  }

  it('bakes the released VATs again from the asset cache', () => {
    const { renderer, assets, tank, wallsmasher, pool } = setup();
    tank.positionTexture.onUpdate?.(tank.positionTexture); // uploaded, CPU copy gone

    renderer.rebakeAfterContextRestore();

    expect(assets.cloneModel).toHaveBeenCalledTimes(1);
    expect(assets.cloneModel).toHaveBeenCalledWith(ENEMY_TYPES['tank'].modelUrl, { preserveSkeleton: true });
    const baked = pool('tank').vatData.positionTexture;
    expect(baked).not.toBe(tank.positionTexture);
    expect((baked.image as { data: unknown }).data).not.toBeNull();
    expect((pool('tank').instancedMesh.material as ShaderMaterial).uniforms['vatTexture'].value).toBe(baked);
    // Never uploaded, still has its CPU copy: left alone.
    expect(pool('wallsmasher').vatData.positionTexture).toBe(wallsmasher.positionTexture);
  });

  it('bakes again when the canvas gets its WebGL context back, until disposed', () => {
    const { renderer } = setup();
    const canvas = document.createElement('canvas');
    renderer.rebakeOnContextRestore(canvas);
    const rebake = vi.spyOn(renderer, 'rebakeAfterContextRestore');

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(rebake).toHaveBeenCalledTimes(1);

    renderer.dispose();
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(rebake).toHaveBeenCalledTimes(1);
  });
});
