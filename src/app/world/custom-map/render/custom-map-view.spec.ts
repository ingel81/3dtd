import { readFileSync } from 'node:fs';
import { InstancedMesh, Mesh, PerspectiveCamera, Ray, Scene, Vector3, WebGLRenderTarget, type Object3D } from 'three';
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
    mask[(Math.floor((y + 50) * (res / 100)) * res + Math.floor((x + 50) * (res / 100))) * 4 + ch];

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

  it('records the position across the road: centre line 0.5, sides apart', () => {
    expect(at(0, 0.2, 2)).toBeGreaterThan(108);
    expect(at(0, 0.2, 2)).toBeLessThan(148);
    const left = at(0, 3, 2);
    const right = at(0, -3, 2);
    expect(Math.abs(left - 128)).toBeGreaterThan(40);
    expect(Math.sign(left - 128)).toBe(-Math.sign(right - 128));
  });

  it('marks river banks in alpha, not lava flows', () => {
    const river = (kind: 'water' | 'lava') => ({
      id: kind,
      kind,
      points: [
        { x: -40, y: -30, width: 6, height: 0 },
        { x: 40, y: -30, width: 6, height: 0 },
      ],
    });
    const m = rasterizePathMask({ nodes: [], edges: [] }, 100, 100, res, [river('water')]);
    const a = (x: number, y: number): number => m[(Math.floor(y + 50) * res + Math.floor(x + 50)) * 4 + 3];
    expect(a(0, -30)).toBe(255);
    // The bank's width wanders along the river: somewhere 7 m out it is still wet, 16 m out never
    expect([-30, -20, -10, 0, 10, 20, 30].some((x) => a(x, -30 + 7) > 0)).toBe(true);
    expect([-30, -20, -10, 0, 10, 20, 30].every((x) => a(x, -30 + 16) === 0)).toBe(true);
    const lava = rasterizePathMask({ nodes: [], edges: [] }, 100, 100, res, [river('lava')]);
    expect(lava.some((v, k) => k % 4 === 3 && v > 0)).toBe(false);
  });

  it('makes the bank wider on the inside of a bend than on the outside', () => {
    // A quarter circle of 25 m around (0, 0), bending left (counter-clockwise)
    const points = Array.from({ length: 7 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
      return { x: Math.cos(a) * 25, y: Math.sin(a) * 25, width: 6, height: 0 };
    });
    const m = rasterizePathMask({ nodes: [], edges: [] }, 100, 100, res, [{ id: 'r', kind: 'water', points }]);
    const a = (x: number, y: number): number => m[(Math.floor(y + 50) * res + Math.floor(x + 50)) * 4 + 3];
    // At 45 degrees: the inside lies towards the centre, the outside away from it
    const wet = (r: number): number => a(Math.cos(-Math.PI / 4) * r, Math.sin(-Math.PI / 4) * r);
    let inside = 0;
    let outside = 0;
    for (let d = 3; d < 15; d += 0.5) {
      if (wet(25 - d) > 0) inside = d;
      if (wet(25 + d) > 0) outside = d;
    }
    expect(inside).toBeGreaterThan(outside);
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

    // Every object sits in one cell mesh of its asset (level 0 meshes, summed over the cells)
    const counts = new Map<string, number>();
    for (const o of doc.objects) counts.set(o.asset, (counts.get(o.asset) ?? 0) + 1);
    for (const [asset, n] of counts) {
      // A model has one mesh per part: count each cell once
      const cells = new Set<unknown>();
      let total = 0;
      view.group.traverse((o) => {
        const cell = o.userData['cell'];
        if (o instanceof InstancedMesh && (o.name === asset || o.name === `${asset}-decor`) && !cells.has(cell)) {
          cells.add(cell);
          total += o.count;
        }
      });
      expect(total, asset).toBe(n);
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

describe('grass blades', () => {
  it('stay off on a map without grass layers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const doc = createDemoMap();
    doc.terrain.layers = [{ material: 'sand' }, { material: 'dirt' }];
    const view = new CustomMapView(doc, offlineLibrary());
    await view.ready;
    let grass: Mesh | null = null;
    view.group.traverse((o) => {
      if (o.name === 'custom-map-grass') grass = o as Mesh;
    });
    expect(grass).not.toBeNull();
    expect(grass!.visible).toBe(false);
    view.dispose();
  }, 30_000);
});

describe('CustomMapView warm-up', () => {
  it('compiles and renders the shadow pass into the target the frames draw to', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = new CustomMapView(createDemoMap(), offlineLibrary());
    const scene = new Scene();
    view.attach(scene);
    let current: unknown = null;
    const seen: { call: string; target: unknown }[] = [];
    const target = { isWebGLRenderTarget: true };
    const renderer = {
      info: { programs: [] },
      shadowMap: { enabled: true, autoUpdate: false, needsUpdate: false },
      getRenderTarget: () => current,
      setRenderTarget: (t: unknown) => (current = t),
      compileAsync: () => {
        seen.push({ call: 'compile', target: current });
        return Promise.resolve();
      },
      render: () => seen.push({ call: 'render', target: current }),
    };
    await view.warmUp(renderer as never, scene, new PerspectiveCamera(), target as never);
    // The scene for the frames, then the shadow pass's depth programs off the main thread (into a target of
    // their own, as the shadow map has no fog), then one frame that draws the shadow map
    expect(seen.map((s) => s.call)).toEqual(['compile', 'compile', 'render']);
    expect(seen[0].target).toBe(target);
    expect(seen[1].target).toBeInstanceOf(WebGLRenderTarget);
    expect(seen[2].target).toBe(target);
    // Back to where it was, the shadow map renders again for the real frame
    expect(current).toBe(null);
    expect(renderer.shadowMap.autoUpdate).toBe(false);
    view.dispose();
  });
});

describe('CustomMapView warm-up waits for every program', () => {
  it('draws its shadow frame only once the programs compiling meanwhile are built', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const view = new CustomMapView(createDemoMap(), offlineLibrary());
      const scene = new Scene();
      view.attach(scene);
      let ready = false;
      const rendered: number[] = [];
      const renderer = {
        info: { programs: [{ isReady: () => ready }] },
        shadowMap: { enabled: true, autoUpdate: false, needsUpdate: false },
        getRenderTarget: () => null,
        setRenderTarget: () => undefined,
        // compileAsync settled, although a program it asked for is still compiling
        compileAsync: () => Promise.resolve(),
        render: () => rendered.push(1),
      };
      const done = view.warmUp(renderer as never, scene, new PerspectiveCamera());
      await vi.advanceTimersByTimeAsync(2000);
      expect(rendered).toHaveLength(0);
      ready = true;
      await vi.advanceTimersByTimeAsync(50);
      await done;
      expect(rendered).toHaveLength(1);
      view.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CustomMapView heights near water', () => {
  it('rebuilds only the water bodies a height brush reaches', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const doc = createDemoMap();
    const g = doc.terrain.grid;
    // A pond in the south-west corner of the map
    const mask = new Uint8Array(g.columns * g.rows);
    for (let j = 2; j < 8; j++) for (let i = 2; i < 8; i++) mask[j * g.columns + i] = 255;
    doc.terrain.waterBodies = [{ level: 50, mask, color: '' }];
    const view = new CustomMapView(doc, offlineLibrary());
    await view.ready;
    const waters = (view as unknown as { waters: ({ set: (...a: unknown[]) => void } | null)[] }).waters;
    const main = vi.spyOn(waters[0]!, 'set');
    const pond = vi.spyOn(waters[1]!, 'set');
    const x0 = -doc.terrain.width / 2;
    const y0 = -doc.terrain.depth / 2;
    const cell = g.cellSize;
    view.updateHeights({ minX: x0 + 3 * cell, minY: y0 + 3 * cell, maxX: x0 + 5 * cell, maxY: y0 + 5 * cell });
    expect(pond).toHaveBeenCalledTimes(1);
    expect(main).not.toHaveBeenCalled();
    view.dispose();
  });
});
