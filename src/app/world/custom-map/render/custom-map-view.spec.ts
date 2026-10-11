import { readFileSync } from 'node:fs';
import { InstancedMesh, Mesh, PerspectiveCamera, Ray, Scene, Vector3, type Object3D } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDemoMap } from '../demo-map';
import type { CustomMapDocument } from '../map-document';
import { CustomMapView } from './custom-map-view';
import { sunDirection } from './environment/map-environment';
import { HeightField } from './height-field';
import { MapAssetLibrary } from './map-asset-library';
import { mapToScene } from './map-coords';
import { pathMaskResolution, rasterizePathMask } from './paths/path-mask';
import { assignLayerSlots } from './terrain/map-terrain';

const catalog = JSON.parse(readFileSync('public/maps/assets/catalog.json', 'utf8')) as {
  materials: { id: string }[];
  objects: { id: string }[];
};

/** A library whose catalogue is the shipped one but whose files never load: flat materials, placeholder models */
function offlineLibrary(): MapAssetLibrary {
  return new MapAssetLibrary('maps/assets/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    decodeImage: () => Promise.reject(new Error('offline')),
    loadModel: () => Promise.reject(new Error('offline')),
    textureSize: 4,
  });
}

describe('path mask', () => {
  const paths = {
    nodes: [
      { id: 'a', x: -40, y: 0 },
      { id: 'b', x: 40, y: 0 },
      { id: 'c', x: 0, y: 40 },
    ],
    edges: [
      { id: 'road', a: 'a', b: 'b', width: 8, kind: 'road' as const },
      { id: 'path', a: 'b', b: 'c', width: 4, kind: 'path' as const, via: [{ x: 40, y: 40 }] },
      { id: 'bridge', a: 'a', b: 'c', width: 6, kind: 'bridge' as const },
    ],
  };
  const res = 100;
  const mask = rasterizePathMask(paths, 100, 100, res);
  const at = (x: number, y: number, ch: number): number =>
    mask[(Math.floor((y + 50) * (res / 100)) * res + Math.floor((x + 50) * (res / 100))) * 2 + ch];

  it('paints roads in red and paths in green, full inside and soft at the edge', () => {
    expect(at(0, 0, 0)).toBe(255);
    expect(at(0, 0, 1)).toBe(0);
    expect(at(0, 4.2, 0)).toBeGreaterThan(0);
    expect(at(0, 4.2, 0)).toBeLessThan(255);
    expect(at(0, 6, 0)).toBe(0);
    // The path runs over its via point (40, 40)
    expect(at(40, 20, 1)).toBe(255);
    expect(at(20, 20, 1)).toBe(0);
  });

  it('leaves bridges to the deck mesh', () => {
    expect(at(-20, 20, 0)).toBe(0);
    expect(at(-20, 20, 1)).toBe(0);
  });

  it('aims at half a metre per texel, even and capped', () => {
    expect(pathMaskResolution(512, 400)).toBe(1024);
    expect(pathMaskResolution(511, 100) % 2).toBe(0);
    expect(pathMaskResolution(5000, 5000)).toBe(2048);
  });
});

describe('terrain layer slots', () => {
  it('stacks each material once: splat layers, cliff, road, path', () => {
    const { ids, slots } = assignLayerSlots({
      layers: [{ material: 'grass' }, { material: 'dirt' }, { material: 'cobblestone' }],
      cliffMaterial: 'cliff',
    } as CustomMapDocument['terrain']);
    expect(ids).toEqual(['grass', 'dirt', 'cobblestone', 'cliff', 'dirt-path']);
    expect(slots.splat).toEqual([0, 1, 2]);
    expect(slots.road).toBe(2);
    expect(slots.cliff).toBe(3);
    expect(slots.path).toBe(4);
    expect(slots.count).toBe(5);
  });

  it('drops materials past the array limit', () => {
    const layers = Array.from({ length: 8 }, (_, k) => ({ material: `m${k}` }));
    const { ids, slots } = assignLayerSlots({ layers, cliffMaterial: 'c1' } as CustomMapDocument['terrain']);
    expect(ids.length).toBe(11);
    expect(slots.path).toBe(10);
  });
});

describe('sun direction', () => {
  it('follows map azimuth (from north, clockwise) into the scene frame', () => {
    const v = new Vector3();
    sunDirection(0, 0, v);
    expect(v.z).toBeCloseTo(1); // north = scene +z
    sunDirection(90, 0, v);
    expect(v.x).toBeCloseTo(-1); // east = scene -x
    sunDirection(0, 90, v);
    expect(v.y).toBeCloseTo(1);
  });
});

describe('demo map', () => {
  let doc: CustomMapDocument;
  beforeAll(() => {
    doc = createDemoMap();
  });

  it('is consistent with the document contract', () => {
    const g = doc.terrain.grid;
    expect(g.heights.length).toBe(g.columns * g.rows);
    expect((g.columns - 1) * g.cellSize).toBe(doc.terrain.width);
    const r = doc.terrain.splat.resolution;
    expect(doc.terrain.splat.maps[0].length).toBe(r * r * 4);
    expect(doc.terrain.water?.mask.length).toBe(g.columns * g.rows);
    expect(doc.terrain.layers.length).toBeLessThanOrEqual(8);
    const nodes = new Set(doc.paths.nodes.map((n) => n.id));
    for (const e of doc.paths.edges) expect(nodes.has(e.a) && nodes.has(e.b)).toBe(true);
    for (const p of [...doc.spawns, doc.hq]) {
      expect(Math.abs(p.x)).toBeLessThan(doc.terrain.width / 2);
      expect(Math.abs(p.y)).toBeLessThan(doc.terrain.depth / 2);
    }
  });

  it('uses only catalogue materials and assets', () => {
    const materials = new Set(catalog.materials.map((m) => m.id));
    const objects = new Set(catalog.objects.map((o) => o.id));
    for (const l of doc.terrain.layers) expect(materials.has(l.material)).toBe(true);
    expect(materials.has(doc.terrain.cliffMaterial)).toBe(true);
    const unknown = doc.objects.filter((o) => !objects.has(o.asset)).map((o) => o.asset);
    expect(unknown).toEqual([]);
  });

  it('keeps objects out of the water and spawns, HQ on dry land', () => {
    const field = new HeightField(doc.terrain.grid, doc.terrain.width, doc.terrain.depth);
    const level = doc.terrain.water?.level ?? -Infinity;
    const wet = doc.objects.filter((o) => o.asset !== 'rock-small' && field.heightAt(o.x, o.y) < level);
    expect(wet).toEqual([]);
    for (const p of [...doc.spawns, doc.hq]) expect(field.heightAt(p.x, p.y)).toBeGreaterThan(level);
    expect(doc.objects.length).toBeGreaterThan(5000);
  });

  it('is the same map for the same seed', () => {
    const again = createDemoMap();
    expect(again.terrain.grid.heights).toEqual(doc.terrain.grid.heights);
    expect(again.objects.length).toBe(doc.objects.length);
  });
});

describe('CustomMapView', () => {
  it('renders the demo map offline with placeholders and answers queries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const doc = createDemoMap();
    const view = new CustomMapView(doc, offlineLibrary());
    await view.ready;

    // Height queries are the height field's
    const field = new HeightField(doc.terrain.grid, doc.terrain.width, doc.terrain.depth);
    expect(view.heightAt(12.3, -45.6)).toBe(field.heightAt(12.3, -45.6));

    // A ray straight down lands on the surface at that map point
    const top = mapToScene(30, -100, 500, new Vector3());
    const hit = view.raycast(new Ray(top, new Vector3(0, -1, 0)));
    expect(hit?.x).toBeCloseTo(30, 3);
    expect(hit?.y).toBeCloseTo(-100, 3);
    expect(hit?.height).toBeCloseTo(view.heightAt(30, -100), 2);

    // LOS: terrain and sight-blocking objects in the blocker group, water outside and transparent
    const inLos: Object3D[] = [];
    view.losBlockers.traverse((o) => inLos.push(o));
    expect(inLos.some((o) => o.name.startsWith('terrain-chunk'))).toBe(true);
    const losTrees = inLos.filter((o) => o instanceof InstancedMesh && o.name === 'tree-oak');
    expect(losTrees.length).toBeGreaterThan(0);
    expect(inLos.some((o) => o.name === 'grass-clump-decor')).toBe(false);
    let water: Mesh | null = null;
    view.group.traverse((o) => {
      if (o.name === 'custom-map-water') water = o as Mesh;
    });
    expect(water).not.toBeNull();
    expect(water!.userData['losTransparent']).toBe(true);
    expect(inLos.includes(water!)).toBe(false);

    // Every asset of the map has its instanced meshes, as many instances as objects
    const counts = new Map<string, number>();
    for (const o of doc.objects) counts.set(o.asset, (counts.get(o.asset) ?? 0) + 1);
    for (const [asset, n] of counts) {
      let mesh: InstancedMesh | null = null;
      view.group.traverse((o) => {
        if (o instanceof InstancedMesh && (o.name === asset || o.name === `${asset}-decor`)) mesh = o;
      });
      expect(mesh, asset).not.toBeNull();
      expect(mesh!.instanceMatrix.count).toBe(n);
    }

    // attach() puts the blockers beside the group, as the LOS cube needs a direct scene child
    const scene = new Scene();
    view.attach(scene);
    expect(view.group.parent).toBe(scene);
    expect(view.losBlockers.parent).toBe(scene);

    // Frame update and editor updates run
    const camera = new PerspectiveCamera(55, 1.6, 0.5, 8000);
    camera.position.copy(mapToScene(0, -300, 200, new Vector3()));
    camera.lookAt(mapToScene(0, 0, 0, new Vector3()));
    camera.updateMatrixWorld();
    view.update(0.016, camera);
    doc.terrain.grid.heights.fill(5);
    view.updateHeights({ minX: -10, minY: -10, maxX: 10, maxY: 10 });
    expect(view.heightAt(0, 0)).toBe(5);
    view.updateSplat();
    view.updatePaths();
    view.setEnvironment({ ...doc.environment, sky: 'dusk' });
    view.dispose();
    expect(scene.children.length).toBe(0);
  }, 30_000);
});
