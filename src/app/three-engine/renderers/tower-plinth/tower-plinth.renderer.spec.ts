import { describe, expect, it, vi } from 'vitest';
import { Mesh, Scene, Vector3, type Material } from 'three';
import { TowerPlinthRenderer, createPlinthMesh } from './tower-plinth.renderer';
import { PLINTH_EMBED_M } from './plinth-geometry';

/** Local frame of the test: x = lon, z = lat, y = height. */
const sync = {
  geoToLocal: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat),
  geoToLocalSimple: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat),
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3) => target.set(lon, height, lat),
};

function setup() {
  const scene = new Scene();
  const renderer = new TowerPlinthRenderer(scene, sync);
  const plinthOf = (id: string) => renderer.getAllMeshes().find((entry) => entry.id === id)?.mesh as Mesh | undefined;
  return { scene, renderer, plinthOf };
}

describe('TowerPlinthRenderer', () => {
  it('stands the plinth on the lowest point of the footprint with its top at the foot', () => {
    const { scene, renderer, plinthOf } = setup();
    renderer.create('t1', 20, 10, 17, 3, 3.6);

    const mesh = plinthOf('t1')!;
    expect(scene.children).toContain(mesh);
    expect(mesh.position.toArray()).toEqual([10, 14, 20]);
    mesh.geometry.computeBoundingBox();
    expect(mesh.position.y + mesh.geometry.boundingBox!.max.y).toBeCloseTo(17, 6);
    expect(mesh.position.y + mesh.geometry.boundingBox!.min.y).toBeCloseTo(14 - PLINTH_EMBED_M, 6);
    expect(mesh.matrixAutoUpdate).toBe(false);
    expect(mesh.matrix.elements[13]).toBe(14);
  });

  it('gives every plinth its own geometry and the same material', () => {
    const { renderer, plinthOf } = setup();
    renderer.create('t1', 0, 0, 5, 1, 3.6);
    renderer.create('t2', 0, 30, 5, 2, 3.6);

    expect(plinthOf('t1')!.geometry).not.toBe(plinthOf('t2')!.geometry);
    expect(plinthOf('t1')!.material).toBe(plinthOf('t2')!.material);
    expect(renderer.count).toBe(2);
  });

  it('replaces the plinth of a tower created again', () => {
    const { scene, renderer, plinthOf } = setup();
    renderer.create('t1', 0, 0, 5, 1, 3.6);
    const first = plinthOf('t1')!;
    const dispose = vi.spyOn(first.geometry, 'dispose');
    renderer.create('t1', 0, 0, 6, 2, 3.6);

    expect(dispose).toHaveBeenCalled();
    expect(scene.children).not.toContain(first);
    expect(renderer.count).toBe(1);
  });

  it('removes a plinth with its geometry, and ignores a tower without one', () => {
    const { scene, renderer, plinthOf } = setup();
    renderer.create('t1', 0, 0, 5, 1, 3.6);
    const mesh = plinthOf('t1')!;
    const dispose = vi.spyOn(mesh.geometry, 'dispose');

    renderer.remove('t1');
    renderer.remove('never-had-one');

    expect(dispose).toHaveBeenCalled();
    expect(scene.children).not.toContain(mesh);
    expect(renderer.getAllMeshes()).toEqual([]);
  });

  it('clears all plinths and frees the material on dispose', () => {
    const { scene, renderer, plinthOf } = setup();
    renderer.create('t1', 0, 0, 5, 1, 3.6);
    renderer.create('t2', 0, 30, 5, 2, 3.6);
    const material = plinthOf('t1')!.material as Material;
    const dispose = vi.spyOn(material, 'dispose');

    renderer.clear();
    expect(scene.children).toHaveLength(0);
    renderer.dispose();
    expect(dispose).toHaveBeenCalled();
  });

  it('compiles its program ahead of the first plinth with the shared material', async () => {
    const { scene, renderer, plinthOf } = setup();
    renderer.create('t1', 0, 0, 5, 1, 3.6);
    const material = plinthOf('t1')!.material;
    const compileAsync = vi.fn(async () => undefined);

    await renderer.precompile({ compileAsync } as never, {} as never);

    const [warm, , target] = compileAsync.mock.calls[0] as unknown as [Mesh, unknown, Scene];
    expect(warm.material).toBe(material);
    expect(target).toBe(scene);
    expect(scene.children).not.toContain(warm);
  });

  it('builds meshes for the preview from any material', () => {
    const material = {} as Material;
    const mesh = createPlinthMesh(3, 2, material);
    expect(mesh.material).toBe(material);
    expect(mesh.name).toBe('tower-plinth');
  });
});
