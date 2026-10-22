import { readFileSync } from 'node:fs';
import { BackSide, BoxGeometry, Group, Mesh, MeshDepthMaterial, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, Plane, Scene, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createMapDocument } from '../map-create';
import { CustomMapView } from './custom-map-view';
import { MapAssetLibrary } from './map-asset-library';

const catalog = JSON.parse(readFileSync('public/maps/assets/catalog.json', 'utf8')) as { objects: { id: string }[] };

function offlineLibrary(): MapAssetLibrary {
  return new MapAssetLibrary('maps/assets/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    decodeImage: () => Promise.reject(new Error('offline')),
    loadModel: () => Promise.reject(new Error('offline')),
    textureSize: 4,
  });
}

describe('effect stand-ins', () => {
  it('stand in for every water kind, lava with its shimmer, particles and halos, built once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const doc = createMapDocument({ id: 'm', name: 'M', width: 100, depth: 100, cellSize: 2 });
    const view = new CustomMapView(doc, offlineLibrary(), { grass: false, effects: { lavaGlow: true } });
    await view.ready;
    const twins = view.effectTwins();
    const names = twins.map((m) => (m.material as { name: string }).name);
    for (const kind of ['water', 'sea', 'swamp', 'ice', 'lava']) expect(names).toContain(`custom-map-water-${kind}`);
    expect(names.filter((n) => n === 'custom-map-water-lava')).toHaveLength(2);
    expect(names).toContain('custom-map-particles-smoke');
    expect(names).toContain('custom-map-glows');
    const lava = twins.find((m) => (m.material as { name: string }).name === 'custom-map-water-lava')!;
    expect(lava.children.map((c) => c.name)).toContain('custom-map-heat-haze');
    expect(view.effectTwins()).toBe(twins);
    view.dispose();
  });
});

describe("the LOS cube's stand-ins", () => {
  it('hangs the parked ruins that block sight back for the run, shown, and takes them out again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const doc = createMapDocument({ id: 'm', name: 'M', width: 100, depth: 100, cellSize: 2 });
    const view = new CustomMapView(doc, offlineLibrary(), { grass: false });
    await view.ready;
    const inner = new Group();
    view.losBlockers.add(inner);
    const blocking = new Mesh();
    blocking.visible = false;
    const other = new Mesh();
    // As parkRuins leaves them: out of the scene, with where each hung
    (view as unknown as { parked: { mesh: Mesh; parent: Group }[] }).parked = [
      { mesh: blocking, parent: inner },
      { mesh: other, parent: view.group },
    ];
    const during = view.withLosStandIns(() => ({ parent: blocking.parent, visible: blocking.visible, other: other.parent }));
    expect(during).toEqual({ parent: inner, visible: true, other: null });
    expect(blocking.parent).toBeNull();
    expect(blocking.visible).toBe(false);
    view.dispose();
  });
});

describe("the casters' shadow programs", () => {
  it('builds depth twins of what casts among the objects, clipped as theirs, for the lit scene and the lightless parts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const doc = createMapDocument({ id: 'm', name: 'M', width: 100, depth: 100, cellSize: 2 });
    const view = new CustomMapView(doc, offlineLibrary(), { grass: false });
    await view.ready;
    const compiled: { object: Group; scene: Scene }[] = [];
    const renderer = {
      shadowMap: { enabled: true, type: PCFSoftShadowMap },
      getRenderTarget: () => null,
      setRenderTarget: vi.fn(),
      compileAsync: (object: Group, _camera: unknown, scene: Scene) => {
        compiled.push({ object, scene });
        return Promise.resolve(object);
      },
    } as unknown as WebGLRenderer;
    const scene = new Scene();
    // A tower under its scaffold: its material clipped by a plane; its turret casts nothing
    const plane = new Plane();
    const body = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ clippingPlanes: [plane] }));
    body.castShadow = true;
    const turret = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    const tower = new Group().add(body, turret);
    const built = await view.compileCasters(renderer, scene, new PerspectiveCamera(), [tower]);
    expect(compiled.map((c) => c.scene === scene)).toEqual([true, false]);
    const [twin] = compiled[0].object.children as Mesh<BoxGeometry, MeshDepthMaterial>[];
    expect(compiled[0].object.children).toHaveLength(1);
    expect(twin.geometry).toBe(body.geometry);
    expect(twin.material.clippingPlanes).toEqual([plane]);
    expect(twin.material.side).toBe(BackSide);
    // What it resolves with is what it compiled: the engine uses those programs first, not the renderer's all
    expect(built).toEqual([twin]);
    view.dispose();
  });
});
