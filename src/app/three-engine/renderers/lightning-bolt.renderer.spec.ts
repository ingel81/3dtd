import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  AdditiveBlending,
  DoubleSide,
  InstancedBufferGeometry,
  InstancedMesh,
  InterleavedBufferAttribute,
  Mesh,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { LightningBoltRenderer, type BoltOptions } from './lightning-bolt.renderer';

describe('LightningBoltRenderer', () => {
  let scene: Scene;
  let bolts: LightningBoltRenderer;
  let mesh: Mesh;

  const geometry = () => mesh.geometry as InstancedBufferGeometry;
  const attribute = (name: string) => geometry().getAttribute(name) as InterleavedBufferAttribute;
  /** The interleaved buffer behind all four per-instance attributes. */
  const buffer = () => attribute('aStart').data;
  const halos = () => scene.children.filter((c): c is Sprite => c instanceof Sprite);
  const visibleHalos = () => halos().filter((h) => h.visible);
  const spawn = (now: number, opts: BoltOptions = {}) =>
    bolts.spawnBolt(new Vector3(0, 0, 0), new Vector3(10, 0, 0), now, opts);

  // jsdom has no 2D canvas context; the halo texture stays blank, which the
  // renderer already handles.
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    scene = new Scene();
    bolts = new LightningBoltRenderer(scene, 4);
    mesh = scene.children.find((c): c is Mesh => c instanceof Mesh)!;
  });

  it('draws every bolt from one mesh with one material, without an instanceMatrix', () => {
    expect(scene.children.filter((c) => c instanceof Mesh)).toHaveLength(1);
    expect(mesh).not.toBeInstanceOf(InstancedMesh);
    expect('instanceMatrix' in mesh).toBe(false);
    expect(mesh.geometry).toBeInstanceOf(InstancedBufferGeometry);
    expect(geometry().instanceCount).toBe(0);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.renderOrder).toBe(1001);

    const material = mesh.material as ShaderMaterial;
    expect(material).toBeInstanceOf(ShaderMaterial);
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.side).toBe(DoubleSide);
    expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
    expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');

    // One GPU buffer carries all per-instance data.
    for (const name of ['aEnd', 'aTiming', 'aShape']) {
      expect(attribute(name).data).toBe(buffer());
    }
    expect(buffer().stride).toBe(12);

    expect(halos()).toHaveLength(16);
    expect(visibleHalos()).toHaveLength(0);
  });

  it("writes endpoints, timing and shape into the bolt's slot", () => {
    bolts.spawnBolt(new Vector3(1, 2, 3), new Vector3(4, 5, 6), 10, {
      lifetime: 0.18,
      width: 0.18,
      jaggedness: 0.55,
      intensity: 1.8,
    });
    bolts.spawnBolt(new Vector3(7, 8, 9), new Vector3(10, 11, 12), 11);
    expect(geometry().instanceCount).toBe(2);
    expect(bolts.activeCount).toBe(2);

    const start = attribute('aStart');
    const end = attribute('aEnd');
    const timing = attribute('aTiming');
    const shape = attribute('aShape');

    expect([start.getX(0), start.getY(0), start.getZ(0)]).toEqual([1, 2, 3]);
    expect([end.getX(0), end.getY(0), end.getZ(0)]).toEqual([4, 5, 6]);
    expect(timing.getX(0)).toBe(10);
    expect(timing.getY(0)).toBeCloseTo(0.18, 6);
    expect(shape.getX(0)).toBeGreaterThanOrEqual(0);
    expect(shape.getX(0)).toBeLessThan(100);
    expect(shape.getY(0)).toBeCloseTo(0.18, 6);
    expect(shape.getZ(0)).toBeCloseTo(0.55, 6);
    expect(shape.getW(0)).toBeCloseTo(1.8, 6);

    // Defaults
    expect([start.getX(1), end.getZ(1)]).toEqual([7, 12]);
    expect(timing.getX(1)).toBe(11);
    expect(timing.getY(1)).toBeCloseTo(0.25, 6);
    expect(shape.getY(1)).toBeCloseTo(0.45, 6);
    expect(shape.getZ(1)).toBeCloseTo(0.9, 6);
    expect(shape.getW(1)).toBe(1);
  });

  it('drives the shared clock and releases a bolt once its lifetime has run out', () => {
    spawn(10, { lifetime: 0.25 });
    const uniforms = (mesh.material as ShaderMaterial).uniforms;

    bolts.update(10.2);
    expect(uniforms['uTime'].value).toBe(10.2);
    expect(bolts.activeCount).toBe(1);
    expect(geometry().instanceCount).toBe(1);

    bolts.update(10.25);
    expect(uniforms['uTime'].value).toBe(10.25);
    expect(bolts.activeCount).toBe(0);
    expect(geometry().instanceCount).toBe(0);
  });

  it('keeps drawing over a hole until the top slot expires, then reuses the hole', () => {
    spawn(10, { lifetime: 1 }); // slot 0
    spawn(10, { lifetime: 0.1 }); // slot 1
    spawn(10, { lifetime: 0.5 }); // slot 2

    bolts.update(10.2); // slot 1 expires, slot 2 still holds the top
    expect(bolts.activeCount).toBe(2);
    expect(geometry().instanceCount).toBe(3);

    spawn(10.3, { lifetime: 1 });
    expect(attribute('aTiming').getX(1)).toBeCloseTo(10.3, 5);
    expect(geometry().instanceCount).toBe(3);

    bolts.update(10.6); // slot 2 expires, slot 1 is live again
    expect(geometry().instanceCount).toBe(2);
    bolts.update(11.5);
    expect(geometry().instanceCount).toBe(0);
  });

  it('fades an attached halo with the bolt and returns it to the pool on expiry', () => {
    spawn(10, { lifetime: 1, attachLight: true, lightIntensity: 1.2, lightDistance: 30 });
    expect(visibleHalos()).toHaveLength(1);
    const halo = visibleHalos()[0];
    const material = halo.material as SpriteMaterial;
    expect(halo.position.toArray()).toEqual([10, 0, 0]);
    expect(halo.scale.x).toBe(30);
    expect(material.opacity).toBe(1.2);

    bolts.update(10.5); // (1 - age)^2 = 0.25
    expect(material.opacity).toBeCloseTo(0.3, 6);

    bolts.update(11);
    expect(halo.visible).toBe(false);
    expect(material.opacity).toBe(0);

    // All 16 halos are free again.
    for (let i = 0; i < 4; i++) spawn(12, { attachLight: true });
    expect(visibleHalos()).toHaveLength(4);
  });

  it('steals the oldest bolt when the pool is full', () => {
    spawn(10, { attachLight: true }); // slot 0, oldest
    spawn(11);
    spawn(12);
    spawn(13);
    expect(visibleHalos()).toHaveLength(1);

    spawn(14);
    expect(bolts.activeCount).toBe(4);
    expect(geometry().instanceCount).toBe(4);
    expect(attribute('aTiming').getX(0)).toBe(14);
    expect(visibleHalos()).toHaveLength(0); // the stolen bolt's halo went with it

    spawn(15); // next oldest: the bolt from 11 in slot 1
    expect(attribute('aTiming').getX(1)).toBe(15);
    expect([2, 3].map((s) => attribute('aTiming').getX(s))).toEqual([12, 13]);
  });

  it('uploads one range over the drawn slots, only after bolts spawned', () => {
    spawn(10, { lifetime: 1 });
    spawn(10, { lifetime: 1 });
    spawn(10, { lifetime: 0.1 });
    const version = buffer().version;
    expect(buffer().updateRanges).toEqual([]); // nothing uploads before the flush

    bolts.update(10);
    expect(buffer().version).toBe(version + 1);
    expect(buffer().updateRanges).toEqual([{ start: 0, count: 36 }]);

    bolts.update(10.05); // no spawn, nothing to upload
    expect(buffer().version).toBe(version + 1);

    bolts.update(10.2); // top slot expires
    spawn(10.2, { lifetime: 1 }); // reuses slot 2
    bolts.update(10.2);
    expect(buffer().version).toBe(version + 2);
    expect(buffer().updateRanges).toEqual([{ start: 0, count: 36 }]);
  });

  it('adds no zero-length range once every bolt is gone', () => {
    spawn(10, { lifetime: 0.1 });
    bolts.update(10);
    buffer().clearUpdateRanges(); // stands in for the upload
    const version = buffer().version;

    spawn(10.05, { lifetime: 0.01 });
    bolts.update(11); // both expire in the frame the second one is flushed
    // (0, 0) would make three upload the whole buffer.
    expect(buffer().updateRanges).toEqual([]);
    expect(buffer().version).toBe(version);
  });

  it('keeps the update ranges bounded while nothing renders', () => {
    // Headless training: chain fire keeps spawning, update() does not run.
    for (let i = 0; i < 500; i++) spawn(10 + i * 0.01);
    expect(buffer().updateRanges).toEqual([]);

    // Render loop running but nothing uploaded (no draw): still one range.
    for (let i = 0; i < 500; i++) {
      spawn(20 + i * 0.01);
      bolts.update(20 + i * 0.01);
    }
    expect(buffer().updateRanges).toHaveLength(1);
  });

  it('clear frees every slot and hides the halos', () => {
    spawn(10, { attachLight: true });
    spawn(10, { attachLight: true });
    spawn(10);
    bolts.clear();
    expect(bolts.activeCount).toBe(0);
    expect(geometry().instanceCount).toBe(0);
    expect(visibleHalos()).toHaveLength(0);

    spawn(20);
    expect(geometry().instanceCount).toBe(1);
    expect(attribute('aTiming').getX(0)).toBe(20);
    bolts.update(20);
    expect(buffer().updateRanges).toEqual([{ start: 0, count: 12 }]);
  });

  it('spawns idle-crackle micro-bolts around a registered tip until deregistered', () => {
    bolts.registerIdleCrackle('t1', new Vector3(0, 50, 0), 10);
    bolts.update(10.1); // first tick is due within 0.06 s
    expect(bolts.activeCount).toBe(2);
    for (const slot of [0, 1]) {
      expect(attribute('aTiming').getY(slot)).toBeCloseTo(0.18, 6);
      expect(attribute('aShape').getY(slot)).toBeCloseTo(0.18, 6);
      expect(Math.abs(attribute('aEnd').getX(slot))).toBeLessThanOrEqual(1.6);
      expect(Math.abs(attribute('aEnd').getY(slot) - 50)).toBeLessThanOrEqual(0.8);
    }

    bolts.deregisterIdleCrackle('t1');
    bolts.update(10.2);
    expect(bolts.activeCount).toBe(2); // no new ones, the two still live
    bolts.update(10.3);
    expect(bolts.activeCount).toBe(0);
  });

  it('dispose removes the mesh and the halos from the scene', () => {
    spawn(10, { attachLight: true });
    bolts.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
