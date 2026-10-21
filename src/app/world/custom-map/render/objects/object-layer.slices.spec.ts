import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, Ray, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapObject } from '../../map-document';
import type { AssetCatalog } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';

/** The frame setObjects waits for between its slices, released by the test */
const frames = vi.hoisted(() => ({ waiting: [] as (() => void)[] }));
vi.mock('../../../../utils/next-frame', () => ({
  nextFrameOrTimeout: () => new Promise<void>((resolve) => frames.waiting.push(resolve)),
}));

import { MapObjectLayer } from './object-layer';

const entry = (id: string) => ({
  id,
  name: id,
  category: 'prop' as const,
  file: `${id}.glb`,
  footprint: 1,
  height: 4,
  blocksLos: true,
  blocksBuild: true,
  scaleRange: [1, 1] as [number, number],
  randomRotation: false,
  wind: 0,
});
const catalog: AssetCatalog = { version: 1, materials: [], objects: ['crate', 'barrel', 'sack'].map(entry) };

function library(): MapAssetLibrary {
  return new MapAssetLibrary('base/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    loadModel: () => {
      const root = new Group();
      root.add(new Mesh(new BoxGeometry(1, 4, 1).translate(0, 2, 0), new MeshStandardMaterial()));
      return Promise.resolve(root);
    },
  });
}

const field = (): HeightField => new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights: new Float32Array(4) }, 1000, 1000);
const put = (id: string, asset: string, x: number): MapObject => ({ id, asset, x, y: 0, z: 0, rotation: 0, scale: 1 });
const instances = (g: Group, name: string): number =>
  g.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh && c.name === name).reduce((n, m) => n + m.count, 0);
const meshCount = (g: Group, name: string): number => g.children.filter((c) => c instanceof InstancedMesh && c.name === name).length;

/** Until setObjects waits for a frame */
async function frameAsked(): Promise<void> {
  for (let k = 0; k < 50 && !frames.waiting.length; k++) await new Promise((r) => setTimeout(r));
}

/** Until setObjects waits for a frame, then lets it go on; false when it asks for none */
async function nextSlice(): Promise<boolean> {
  await frameAsked();
  const go = frames.waiting.shift();
  go?.();
  return !!go;
}

describe('MapObjectLayer.setObjects over frames', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    frames.waiting.length = 0;
  });

  // Each asset's batch takes "20 ms": a frame for the page after each
  const slow = () => {
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 20));
  };

  /** A town's assets were built in one frame; each slice now gives the page a frame */
  it('builds asset after asset with a frame between, edits meanwhile land once all are in', async () => {
    slow();
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    const done = layer.setObjects([put('a1', 'crate', 0), put('a2', 'crate', 10), put('b1', 'barrel', 20), put('b2', 'barrel', 30), put('c1', 'sack', 40)]);
    // The first frame: crates built, barrels and sacks still to come
    await frameAsked();
    expect(frames.waiting.length).toBe(1);
    const pick = (x: number) => layer.raycast(new Ray(new Vector3(-x, 100, 0), new Vector3(0, -1, 0)))?.object.id ?? null;
    expect(pick(0)).toBe('a1');
    expect(pick(20)).toBeNull();
    // Meanwhile a barrel not built yet goes, and one more comes (an edit while the map opens)
    layer.removeObjects(['b1']);
    const added = layer.addObjects([put('b3', 'barrel', 50)]);
    // Time for the addition to load its model before the build goes on
    for (let k = 0; k < 10; k++) await new Promise((r) => setTimeout(r));
    while (await nextSlice());
    await Promise.all([done, added]);
    // One batch per asset, the barrel removed gone, the one added in
    expect(meshCount(los, 'barrel')).toBe(1);
    expect(instances(los, 'barrel')).toBe(2);
    expect(instances(los, 'crate')).toBe(2);
    expect(instances(los, 'sack')).toBe(1);
    layer.dispose();
  });

  it('drops a build a newer setObjects replaced, at its next frame', async () => {
    slow();
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    const first = layer.setObjects([put('a1', 'crate', 0), put('b1', 'barrel', 20), put('c1', 'sack', 40)]);
    await frameAsked();
    const second = layer.setObjects([put('x1', 'sack', 0), put('x2', 'sack', 5)]);
    while (await nextSlice());
    await Promise.all([first, second]);
    expect(meshCount(los, 'crate')).toBe(0);
    expect(meshCount(los, 'barrel')).toBe(0);
    expect(instances(los, 'sack')).toBe(2);
    layer.dispose();
  });
});
