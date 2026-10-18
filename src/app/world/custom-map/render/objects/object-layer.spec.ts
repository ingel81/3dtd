import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Ray, Scene, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { MapObject } from '../../map-document';
import type { AssetCatalog } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { MapObjectLayer } from './object-layer';
import type { InstanceList } from './instance-list';

/**
 * A post 10 m high on a radius of 6 m (its height times 0.6) that takes its far model where it fills a screen
 * share of 6 / (100 tan 30°): 100 m from its bounds. Props keep the size they were placed at, so every post
 * switches at the same distance
 */
const catalog: AssetCatalog = {
  version: 1,
  materials: [],
  objects: [
    {
      id: 'post',
      name: 'Post',
      category: 'prop',
      file: 'post.glb',
      footprint: 1,
      height: 10,
      blocksLos: true,
      blocksBuild: true,
      scaleRange: [1, 1],
      randomRotation: false,
      wind: 0,
      drawDistance: 5000,
      lod: [{ file: 'post-far.glb', screen: 6 / (100 * Math.tan(Math.PI / 6)) }],
    },
  ],
};

function library(): MapAssetLibrary {
  return new MapAssetLibrary('base/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    loadModel: (url) => {
      const root = new Group();
      // Standing on the ground, 10 m high (the far model lower)
      const h = url.includes('far') ? 2 : 10;
      root.add(new Mesh(new BoxGeometry(1, h, 1).translate(0, h / 2, 0), new MeshStandardMaterial()));
      return Promise.resolve(root);
    },
  });
}

const field = (): HeightField => new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights: new Float32Array(4) }, 1000, 1000);
const post = (k: number, x: number, y = 0): MapObject => ({ id: `p${k}`, asset: 'post', x, y, z: 0, rotation: 0, scale: 1 });
/** Twenty posts along map x, 20 m apart */
const row = (): MapObject[] => Array.from({ length: 20 }, (_, k) => post(k, k * 20));
const meshes = (g: Group, name: string): InstancedMesh[] => g.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh && c.name === name);
const shown = (g: Group, name: string): number => meshes(g, name).filter((m) => m.visible).reduce((n, m) => n + m.count, 0);
const fades = (g: Group, name: string): number[] => {
  const m = meshes(g, name)[0];
  return [...(m.geometry.getAttribute('lodFade').array as Float32Array).subarray(0, m.count)];
};
/** A camera 5 m up, level with the posts' middles, over map x (scene x is minus map x) */
function viewer(layer: MapObjectLayer): (x: number, frames?: number, dt?: number) => void {
  const camera = new PerspectiveCamera(60);
  return (x, frames = 1, dt = 0.016) => {
    camera.position.set(-x, 5, 0);
    camera.updateMatrixWorld();
    for (let k = 0; k < frames; k++) layer.update(dt, camera);
  };
}

describe('MapObjectLayer levels of detail', () => {
  it('draws each level in one mesh for the whole map, each object at the level of its own distance', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    const objects = row();
    await layer.setObjects(objects);
    const look = viewer(layer);
    look(4);
    expect(meshes(los, 'post')).toHaveLength(1);
    expect(meshes(los, 'post-lod1')).toHaveLength(1);
    // Within 100 m of their bounds near, the rest far: map x 0..100 is six posts
    expect(shown(los, 'post')).toBe(6);
    expect(shown(los, 'post-lod1')).toBe(14);
    const version = layer.version;
    look(395);
    expect(shown(los, 'post')).toBe(5);
    expect(shown(los, 'post') + shown(los, 'post-lod1')).toBe(20);
    expect(layer.version).toBeGreaterThan(version);
    // In the band around 100 m (94 to 106 m) a post shows both levels: the one at map x 300 is 97 m away, a quarter in
    look(403);
    expect(shown(los, 'post')).toBe(5);
    expect(shown(los, 'post-lod1')).toBe(16);
    const dissolving = fades(los, 'post').filter((f) => f !== 0);
    expect(dissolving).toEqual([expect.closeTo(0.25, 5)]);
    expect(fades(los, 'post-lod1').filter((f) => f !== 0)).toEqual([expect.closeTo(-0.75, 5)]);
    // The editor still picks a far post: it tests the full model of every object its ray crosses
    look(395);
    const hit = layer.raycast(new Ray(new Vector3(-380, 1, -10), new Vector3(0, 0, 1)));
    expect(hit?.object.id).toBe('p19');
    // Moved in place, anywhere on the map: sorted again with its new position
    expect(layer.updateObjects([{ ...objects[0], x: 370 }])).toEqual([]);
    expect(shown(los, 'post')).toBe(6);
    layer.dispose();
  });

  it('takes a level by the object size: a post twice the size switches twice as far out', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    await layer.setObjects([post(0, 0), { ...post(1, 0, 40), scale: 2 }]);
    const look = viewer(layer);
    // 150 m off: the small one (radius 6) is 144 m from its bounds, past 100 m; the big one (radius 12) 138 m, short of 200
    look(-150);
    expect(shown(los, 'post')).toBe(1);
    expect(shown(los, 'post-lod1')).toBe(1);
    layer.dispose();
  });

  it('looks at an object again only once the camera moved as far as its nearest band, and does nothing at rest', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    await layer.setObjects(row());
    const look = viewer(layer);
    look(-400, 60);
    const lists = new Set(los.children.map((c) => c.userData['list'] as InstanceList));
    const versions = () => [...lists].map((l) => l.matrices.version);
    const before = versions();
    const version = layer.version;
    // At rest nothing is written
    look(-400, 30);
    expect(layer.version).toBe(version);
    expect(versions()).toEqual(before);
    // A step that brings no post to a band (the nearest is 106 m off its bounds' band) writes nothing either
    look(-399, 1);
    expect(versions()).toEqual(before);
    layer.dispose();
  });

  it('lets a band settle on a camera at rest, so nothing dithers there, and opens it again on a move', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    await layer.setObjects(row());
    const at = viewer(layer);
    const mesh = (name: string) => meshes(los, name)[0];
    const dithered = (name: string) => fades(los, name).filter((f) => f !== 0);
    // The post at map x 300, 97 m away, in the band at a quarter: both levels, dithered
    at(403, 1, 0.05);
    expect(dithered('post')).toHaveLength(1);
    expect(mesh('post-lod1').count).toBe(16);
    // At rest: after a moment it stands in its nearer level alone
    at(403, 12, 0.05);
    expect(dithered('post')).toEqual([]);
    expect(dithered('post-lod1')).toEqual([]);
    expect(mesh('post').count).toBe(5);
    expect(mesh('post-lod1').count).toBe(15);
    // Moving again the band opens over a few frames, no jump
    at(402.9, 1, 0.05);
    at(402.8, 1, 0.05);
    at(402.7, 1, 0.05);
    expect(dithered('post')).toHaveLength(1);
    layer.dispose();
  });

  it("casts an object's shadow with the level that covers more of it, and only near the focus", async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    layer.shadowRadius = 150;
    await layer.setObjects(row());
    viewer(layer)(403);
    const mesh = (name: string) => meshes(los, name)[0];
    /** How many instances the shadow pass draws of a level's mesh */
    const inShadow = (m: InstancedMesh) => {
      const call = (hook: 'onBeforeShadow' | 'onAfterShadow') => (m[hook] as unknown as () => void)();
      call('onBeforeShadow');
      const n = m.count;
      call('onAfterShadow');
      return n;
    };
    // Within 150 m of the focus (map x 403, 5 m up): the posts from map x 260 on. Near: map x 300 to 380, the one at
    // 300 in the band at a quarter, so still near; far: 260 and 280. The band post casts once
    expect(mesh('post').count).toBe(5);
    expect(mesh('post-lod1').count).toBe(16);
    expect(inShadow(mesh('post'))).toBe(5);
    expect(inShadow(mesh('post-lod1'))).toBe(2);
    // The main pass still draws every instance
    expect(mesh('post-lod1').count).toBe(16);
    layer.dispose();
  });

  it('merges the plain-coloured parts of a model into one draw', async () => {
    const lib = new MapAssetLibrary('base/', {
      fetch: (() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...catalog, objects: [{ ...catalog.objects[0], lod: undefined }] }) } as Response)) as typeof fetch,
      loadModel: () => {
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(1, 10, 1), new MeshStandardMaterial({ color: 0x884422 })));
        root.add(new Mesh(new BoxGeometry(3, 3, 3), new MeshStandardMaterial({ color: 0x22aa22 })));
        root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffaa00 })));
        return Promise.resolve(root);
      },
    });
    const los = new Group();
    const layer = new MapObjectLayer(field(), lib, los);
    await layer.setObjects([post(0, 0)]);
    const all = los.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
    // Trunk and crown share a look apart from colour: one mesh with vertex colours; the glowing part keeps its own
    expect(all).toHaveLength(2);
    const mergedMesh = all.find((m) => (m.material as MeshStandardMaterial).vertexColors)!;
    expect(mergedMesh.geometry.getAttribute('color').count).toBe(48);
    layer.dispose();
  });
});

describe('MapObjectLayer floating objects', () => {
  it('puts a floating object at the water level, on dry ground at the terrain', async () => {
    const low = new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights: new Float32Array(4).fill(-3) }, 1000, 1000);
    const boat = { ...catalog.objects[0], id: 'boat', float: true, lod: undefined, file: 'boat.glb' };
    const lib = new MapAssetLibrary('base/', {
      fetch: (() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...catalog, objects: [boat] }) } as Response)) as typeof fetch,
      loadModel: () => {
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
        return Promise.resolve(root);
      },
    });
    let level: number | null = 1.5;
    const los = new Group();
    const layer = new MapObjectLayer(low, lib, los, { waterLevelAt: () => level });
    await layer.setObjects([{ id: 'b', asset: 'boat', x: 0, y: 0, z: 0.2, rotation: 0, scale: 1 }]);
    const mesh = (): InstancedMesh =>
      [...layer.group.children, ...los.children].find((c): c is InstancedMesh => c instanceof InstancedMesh)!;
    const y = (): number => mesh().instanceMatrix.array[13];
    expect(y()).toBeCloseTo(1.7);
    level = null;
    layer.refreshHeights(undefined, true);
    expect(y()).toBeCloseTo(-2.8);
    // Boats rock: their own program that moves the vertices with time
    const material = mesh().material as MeshStandardMaterial;
    expect(material.customProgramCacheKey()).toMatch(/^custom-map-object-b-/);
    layer.dispose();
  });

  it('reseats only objects whose ground moved, the height alone, as writing them anew would', async () => {
    const heights = new Float32Array(4).fill(2);
    const ground = new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights }, 1000, 1000);
    const rock = { ...catalog.objects[0], id: 'rock', lod: undefined, file: 'rock.glb' };
    const lib = new MapAssetLibrary('base/', {
      fetch: (() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...catalog, objects: [rock] }) } as Response)) as typeof fetch,
      loadModel: () => {
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
        return Promise.resolve(root);
      },
    });
    const object = { id: 'r', asset: 'rock', x: 10, y: 20, z: 0.5, rotation: 1.2, scale: 1.5, pitch: 0.1 };
    const los = new Group();
    const layer = new MapObjectLayer(ground, lib, los);
    await layer.setObjects([object]);
    const matrix = (...groups: Group[]): number[] => {
      const found: InstancedMesh[] = [];
      for (const g of groups) g.traverse((c) => c instanceof InstancedMesh && found.push(c));
      return Array.from(found[0].instanceMatrix.array.slice(0, 16));
    };
    const rect = { minX: 0, minY: 0, maxX: 30, maxY: 30 };
    const version = layer.version;
    layer.refreshHeights(rect);
    // Nothing moved: no upload, no new shadow frame
    expect(layer.version).toBe(version);
    heights.fill(5);
    layer.refreshHeights(rect);
    expect(layer.version).toBeGreaterThan(version);
    // The same matrix a fresh layer writes for the object on the new ground
    const freshLos = new Group();
    const fresh = new MapObjectLayer(ground, lib, freshLos);
    await fresh.setObjects([object]);
    expect(matrix(layer.group, los)).toEqual(matrix(fresh.group, freshLos));
    layer.dispose();
    fresh.dispose();
  });

  it('lights the window glass of a floating ship at night while it rocks', async () => {
    const ship = { ...catalog.objects[0], id: 'ship', category: 'building' as const, float: true, lod: undefined, file: 'ship.glb' };
    const lib = new MapAssetLibrary('base/', {
      fetch: (() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...catalog, objects: [ship] }) } as Response)) as typeof fetch,
      loadModel: () => {
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ name: 'hull' })));
        root.add(new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshStandardMaterial({ name: 'window-glass-ship', color: 0x111111 })));
        return Promise.resolve(root);
      },
    });
    const los = new Group();
    const layer = new MapObjectLayer(field(), lib, los);
    await layer.setObjects([{ id: 's', asset: 'ship', x: 0, y: 0, z: 0, rotation: 0, scale: 1 }]);
    const keys = [...layer.group.children, ...los.children]
      .filter((c): c is InstancedMesh => c instanceof InstancedMesh)
      .map((m) => (m.material as MeshStandardMaterial).customProgramCacheKey());
    // Hull and glass merge into one rocking mesh; the glass in it glows at night (per vertex)
    expect(keys).toEqual([expect.stringMatching(/^custom-map-object-b.*night-windows-v/)]);
    layer.dispose();
  });
});

describe('MapObjectLayer glowing surfaces', () => {
  it('caps a strong emissive so a lava pool does not burn into a flat disc at night', async () => {
    const pool = { ...catalog.objects[0], id: 'pool', category: 'rock' as const, lod: undefined, file: 'pool.glb' };
    const melt = new MeshStandardMaterial({ emissive: 0xff4c08, emissiveIntensity: 1 });
    const lib = new MapAssetLibrary('base/', {
      fetch: (() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...catalog, objects: [pool] }) } as Response)) as typeof fetch,
      loadModel: () => {
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(1, 1, 1), melt));
        return Promise.resolve(root);
      },
    });
    const los = new Group();
    const layer = new MapObjectLayer(field(), lib, los);
    await layer.setObjects([{ id: 'p', asset: 'pool', x: 0, y: 0, z: 0, rotation: 0, scale: 1 }]);
    const mesh = [...layer.group.children, ...los.children].find((c): c is InstancedMesh => c instanceof InstancedMesh)!;
    const m = mesh.material as MeshStandardMaterial;
    expect(m.emissive.r * m.emissiveIntensity).toBeLessThanOrEqual(0.551);
    expect(m.emissive.r * m.emissiveIntensity).toBeGreaterThan(0.5);
    // The library's own material stays as it was and is not disposed with the layer
    expect(m).not.toBe(melt);
    expect(melt.emissiveIntensity).toBe(1);
    const disposed = vi.fn();
    melt.addEventListener('dispose', disposed);
    layer.dispose();
    expect(disposed).not.toHaveBeenCalled();
  });
});

describe('MapObjectLayer in the editor', () => {
  it('adds and removes objects in place, grows its lists once past their room, and picks the right objects after', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    await layer.setObjects([post(0, 10), post(1, 30), post(2, 50)]);
    viewer(layer)(30);
    const [mesh] = meshes(los, 'post');
    expect(mesh.count).toBe(3);
    // A few more: the same mesh, more instances
    await layer.addObjects([post(3, 70), post(4, 900)]);
    expect(meshes(los, 'post')).toEqual([mesh]);
    expect(shown(los, 'post') + shown(los, 'post-lod1')).toBe(5);
    // Out of the middle: the list's last moves into the gap, the asset's last into the index
    layer.removeObjects(['p1']);
    expect(shown(los, 'post') + shown(los, 'post-lod1')).toBe(4);
    // A ray down onto each post still names that post
    const pick = (x: number) => layer.raycast(new Ray(new Vector3(-x, 100, 0), new Vector3(0, -1, 0)))?.object.id ?? null;
    for (const [id, x] of [['p0', 10], ['p2', 50], ['p3', 70], ['p4', 900]] as const) expect(pick(x)).toBe(id);
    expect(pick(30)).toBeNull();
    // The moved object is still found by id and can move in place
    expect(layer.updateObjects([{ ...post(4, 905) }])).toEqual([]);
    expect(pick(905)).toBe('p4');
    // More than the lists have room for (16): built once anew with room again
    // (past the band round 100 m from the camera, so each shows one level)
    await layer.addObjects(Array.from({ length: 30 }, (_, k) => post(10 + k, 160 + k * 2, 5)));
    const [grown] = meshes(los, 'post');
    expect(grown).not.toBe(mesh);
    expect(grown.instanceMatrix.count).toBeGreaterThan(34);
    expect(shown(los, 'post') + shown(los, 'post-lod1')).toBe(34);
    expect(pick(50)).toBe('p2');
    // The last ones out: the asset's meshes go
    layer.removeObjects(['p0', 'p2', 'p3', 'p4', ...Array.from({ length: 30 }, (_, k) => `p${10 + k}`)]);
    expect(los.children.filter((c) => c instanceof InstancedMesh)).toHaveLength(0);
    layer.dispose();
  });

  it('keeps the upload ranges of a hidden level from piling up while a brush works', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    await layer.setObjects(row());
    // Every post near: the far level is empty and hidden, three never uploads it
    viewer(layer)(200);
    for (let k = 0; k < 50; k++) layer.refreshHeights({ minX: 0, minY: -10, maxX: 400, maxY: 10 });
    for (const m of los.children as InstancedMesh[]) expect(m.instanceMatrix.updateRanges.length).toBeLessThanOrEqual(1);
    layer.dispose();
  });
});

describe('MapObjectLayer tilt', () => {
  it('tilts an object by pitch and roll after its turn', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    await layer.setObjects([{ id: 'g', asset: 'post', x: 0, y: 0, z: 0, rotation: 0, pitch: Math.PI / 2, scale: 1 }]);
    const mesh = meshes(los, 'post')[0];
    const m = new Matrix4().fromArray(mesh.instanceMatrix.array, 0);
    // The model's up axis now lies along +z (a quarter turn around x)
    const up = new Vector3(0, 1, 0).transformDirection(m);
    expect(Math.abs(up.y)).toBeLessThan(1e-6);
    expect(Math.abs(up.z)).toBeCloseTo(1);
    layer.dispose();
  });
});

describe('MapObjectLayer spinning parts', () => {
  it('turns parts named spin-… in a program of their own, apart from the still parts', async () => {
    const radar = { ...catalog.objects[0], id: 'radar', lod: undefined, file: 'radar.glb', wind: 0, spin: 5 };
    const lib = new MapAssetLibrary('base/', {
      fetch: (() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...catalog, objects: [radar] }) } as Response)) as typeof fetch,
      loadModel: () => {
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ name: 'mast' })));
        root.add(new Mesh(new BoxGeometry(2, 0.2, 2), new MeshStandardMaterial({ name: 'spin-dish' })));
        return Promise.resolve(root);
      },
    });
    const los = new Group();
    const layer = new MapObjectLayer(field(), lib, los, {});
    await layer.setObjects([{ id: 'r', asset: 'radar', x: 0, y: 0, z: 0, rotation: 0, scale: 1 }]);
    const all = [...layer.group.children, ...los.children].filter((c): c is InstancedMesh => c instanceof InstancedMesh);
    const keys = all.map((m) => (m.material as MeshStandardMaterial).customProgramCacheKey());
    // The dish has its own draw and program, the mast is merged and still
    expect(keys.filter((k) => k.startsWith('custom-map-object-s'))).toHaveLength(1);
    expect(all.length).toBeGreaterThanOrEqual(2);
    layer.dispose();
  });
});

describe('MapObjectLayer warm-up', () => {
  it('shows every level with an instance and shadows for one render, then the normal choice again', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    await layer.setObjects([post(0, 0)]);
    viewer(layer)(0);
    expect(meshes(los, 'post-lod1')[0].visible).toBe(false);
    layer.showAllForWarmUp(true);
    for (const m of los.children as InstancedMesh[]) {
      expect(m.visible).toBe(true);
      expect(m.count).toBe(1);
      expect(m.castShadow).toBe(true);
    }
    layer.showAllForWarmUp(false);
    expect(meshes(los, 'post-lod1')[0].visible).toBe(false);
    expect(meshes(los, 'post')[0].count).toBe(1);
    layer.dispose();
  });
});

describe('MapObjectLayer in a scene', () => {
  it('culls each mesh by the bounds of all its objects', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    await layer.setObjects([post(0, 0), post(1, 400)]);
    const scene = new Scene();
    scene.add(los, layer.group);
    viewer(layer)(0);
    const sphere = meshes(los, 'post')[0].boundingSphere!;
    // From map x -6 to 406 at least: both posts and their radius of 6 m
    expect(sphere.radius).toBeGreaterThanOrEqual(206);
    layer.dispose();
  });
});

describe('MapObjectLayer uploads', () => {
  it('keeps one upload range per attribute on levels that never draw, however often objects move', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    const objects: MapObject[] = Array.from({ length: 20 }, (_, k) => post(k, k * 5));
    await layer.setObjects(objects);
    // A brush: every frame each object moves a little; nothing renders, so three never empties the ranges
    for (let frame = 1; frame <= 50; frame++) {
      expect(layer.updateObjects(objects.map((o) => ({ ...o, rotation: frame * 0.01 })))).toEqual([]);
    }
    const all: InstancedMesh[] = [];
    los.traverse((obj) => {
      if ((obj as InstancedMesh).isInstancedMesh) all.push(obj as InstancedMesh);
    });
    expect(all.length).toBeGreaterThan(1);
    for (const m of all) {
      expect(m.instanceMatrix.updateRanges.length).toBeLessThanOrEqual(1);
      // The one range covers every slot written
      const range = m.instanceMatrix.updateRanges[0];
      if (range) expect(range.start + range.count).toBeGreaterThanOrEqual(m.count * 16);
    }
    layer.dispose();
  });
});
