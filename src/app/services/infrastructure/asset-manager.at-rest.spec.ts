import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from 'three';
import { AssetManagerService } from './asset-manager.service';
import { isSharedGpu } from '../../three-engine/shared-gpu';

/** A model of a plain mesh and a flag with one morph target, as the archer's */
function flagModel() {
  const flagGeometry = new BoxGeometry();
  const count = flagGeometry.attributes['position'].count;
  flagGeometry.morphAttributes['position'] = [new Float32BufferAttribute(new Float32Array(count * 3), 3)];
  flagGeometry.morphTargetsRelative = true;
  const flag = new Mesh(flagGeometry, new MeshStandardMaterial());
  flag.name = 'flag';
  flag.updateMorphTargets();
  const tower = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  tower.name = 'tower';
  const scene = new Group();
  scene.add(tower, flag);
  return { scene, flagGeometry, towerGeometry: tower.geometry };
}

async function loaded() {
  const model = flagModel();
  const assets = new AssetManagerService();
  const loadAsync = vi.fn(async () => ({ scene: model.scene, animations: [] }));
  (assets as unknown as { gltfLoader: { loadAsync: typeof loadAsync } }).gltfLoader = { loadAsync };
  await assets.loadModel('archer.glb');
  return { assets, ...model };
}

const mesh = (root: Group | null, name: string) => root!.getObjectByName(name) as Mesh;

describe('AssetManagerService clones a model at rest', () => {
  afterEach(() => vi.restoreAllMocks());

  it('draws its meshes without morph targets, on the same buffers, one twin per geometry', async () => {
    const { assets, flagGeometry, towerGeometry } = await loaded();
    const first = assets.cloneModel('archer.glb', { atRest: true }) as Group;
    const second = assets.cloneModel('archer.glb', { atRest: true }) as Group;

    const rest = mesh(first, 'flag').geometry;
    expect(rest).not.toBe(flagGeometry);
    expect(rest.morphAttributes).toEqual({});
    expect(rest.attributes['position']).toBe(flagGeometry.attributes['position']);
    expect(rest.attributes['normal']).toBe(flagGeometry.attributes['normal']);
    expect(rest.index).toBe(flagGeometry.index);
    expect(rest.groups).toEqual(flagGeometry.groups);
    expect(mesh(first, 'flag').morphTargetInfluences).toBeUndefined();
    expect(mesh(second, 'flag').geometry).toBe(rest);
    // A mesh without morph targets keeps its geometry
    expect(mesh(first, 'tower').geometry).toBe(towerGeometry);
    // The page's like the model, so a lease's end leaves the shared buffers uploaded
    expect(isSharedGpu(rest)).toBe(true);
  });

  it('leaves the morph targets to a clone that animates them (a placed archer waves its flag)', async () => {
    const { assets, flagGeometry } = await loaded();
    assets.cloneModel('archer.glb', { atRest: true });
    const placed = assets.cloneModel('archer.glb') as Group;

    expect(mesh(placed, 'flag').geometry).toBe(flagGeometry);
    expect(mesh(placed, 'flag').morphTargetInfluences).toEqual([0]);
    expect(flagGeometry.morphAttributes['position']).toHaveLength(1);
  });

  it('frees the twins with the model', async () => {
    const { assets } = await loaded();
    const rest = mesh(assets.cloneModel('archer.glb', { atRest: true }) as Group, 'flag').geometry;
    const disposed = vi.fn();
    rest.addEventListener('dispose', disposed);

    assets.releaseModel('archer.glb');

    expect(disposed).toHaveBeenCalledOnce();
    expect(isSharedGpu(rest)).toBe(false);
  });
});
