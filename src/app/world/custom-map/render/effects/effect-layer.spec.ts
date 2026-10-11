import { Mesh, PointLight, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../map-document';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { EffectLayer, lightCap, POINT_LIGHTS } from './effect-layer';
import { particleCount } from './particle-field';

const base: Omit<CatalogObject, 'id' | 'name'> = {
  category: 'fx',
  file: '',
  footprint: 1,
  height: 2,
  blocksLos: false,
  blocksBuild: false,
  scaleRange: [1, 1],
  randomRotation: false,
  wind: 0,
  drawDistance: 1000,
};

const catalog: AssetCatalog = {
  version: 1,
  materials: [],
  objects: [
    {
      ...base,
      id: 'torch',
      name: 'Torch',
      effects: [{ kind: 'fire', height: 2 }, { kind: 'embers' }],
      light: { color: '#ff9040', intensity: 1, distance: 10, height: 2.5, flicker: true },
    },
    { ...base, id: 'falls', name: 'Falls', footprint: 3, height: 12, effects: [{ kind: 'waterfall' }] },
    { ...base, id: 'rock', name: 'Rock', category: 'rock' },
  ],
};

function flat(): HeightField {
  return new HeightField({ columns: 3, rows: 3, cellSize: 50, heights: new Float32Array(9).fill(4) }, 100, 100);
}

const place = (id: string, asset: string, x: number): MapObject => ({ id, asset, x, y: 0, z: 0, rotation: 0, scale: 1 });

describe('EffectLayer', () => {
  it('builds one particle field per kind, waterfalls with spray, and glows', () => {
    const layer = new EffectLayer(flat());
    const objects = [place('a', 'torch', 0), place('b', 'torch', 10), place('c', 'falls', -20), place('d', 'rock', 5)];
    layer.set(objects, catalog);
    const names = layer.group.children.filter((c) => c instanceof Mesh).map((c) => c.name).sort();
    expect(names).toEqual([
      'custom-map-glows',
      'custom-map-particles-embers',
      'custom-map-particles-fire',
      'custom-map-particles-spray',
      'custom-map-waterfalls',
    ]);
    layer.dispose();
  });

  it('lights point lights only in the dark, nearest first, never more than the pool', () => {
    const layer = new EffectLayer(flat());
    const torches = Array.from({ length: 10 }, (_, k) => place(`t${k}`, 'torch', k * 4 - 20));
    layer.set(torches, catalog);
    const lights = layer.group.children.filter((c): c is PointLight => c instanceof PointLight);
    expect(lights.length).toBe(POINT_LIGHTS);

    layer.setDarkness(0);
    layer.update(0.1, new Vector3());
    expect(lights.every((l) => l.intensity === 0)).toBe(true);
    // By day the pool is hidden: hidden lights do not count in three's light setup of every material
    expect(lights.every((l) => !l.visible)).toBe(true);

    layer.setDarkness(1);
    layer.update(0.1, new Vector3(20, 0, 0)); // scene x = -map x: near the torches at map x -20 .. 0
    const lit = lights.filter((l) => l.intensity > 0);
    expect(lit.length).toBe(POINT_LIGHTS);
    expect(Math.max(...lit.map((l) => l.position.x))).toBeLessThanOrEqual(20);
    expect(Math.min(...lit.map((l) => l.position.x))).toBeGreaterThanOrEqual(0);
    // In use, all six count (a changing number would recompile every lit material)
    expect(lights.every((l) => l.visible)).toBe(true);
    layer.dispose();
  });

  it('keeps the pool hidden at night on a map without lights, and picks the nearest without allocating', () => {
    const layer = new EffectLayer(flat());
    layer.set([place('r', 'rock', 0)], catalog);
    const lights = layer.group.children.filter((c): c is PointLight => c instanceof PointLight);
    layer.setDarkness(1);
    layer.update(0.1, new Vector3());
    expect(lights.every((l) => !l.visible)).toBe(true);

    // Lava lights at known spots: the six nearest light up, nearest first
    layer.setLavaLights(Array.from({ length: 10 }, (_, k) => new Vector3(k * 10, 0, 0)));
    layer.update(0.1, new Vector3(31, 0, 0));
    const xs = lights.filter((l) => l.intensity > 0).map((l) => l.position.x);
    expect(xs).toEqual([30, 40, 20, 50, 10, 60]);
    layer.dispose();
  });

  it('caps a low strong light so it does not burn a white disc into the ground under it', () => {
    const pool = { ...base, id: 'pool', name: 'Pool', light: { color: '#ff5a1e', intensity: 1.8, distance: 16, height: 1 } };
    const layer = new EffectLayer(flat());
    layer.set([place('p', 'pool', 0), place('t', 'torch', 2)], { ...catalog, objects: [...catalog.objects, pool] });
    layer.setDarkness(1);
    layer.update(0.1, new Vector3());
    const lights = layer.group.children.filter((c): c is PointLight => c instanceof PointLight && c.intensity > 0);
    const low = lights.find((l) => Math.abs(l.position.y - 5) < 0.01)!;
    expect(low.intensity).toBeCloseTo(lightCap(1));
    // A torch at 2.5 m stays under its cap and keeps its catalogue strength (18, flickering)
    expect(lights.find((l) => Math.abs(l.position.y - 6.5) < 0.01)!.intensity).toBeGreaterThan(15);
    expect(lightCap(0.1)).toBe(lightCap(0.75));
    layer.dispose();
  });

  it('sizes particle counts from rate and life, capped', () => {
    expect(particleCount('fire', 10)).toBe(9);
    expect(particleCount('fire', 10000)).toBe(400);
    expect(particleCount('fog', undefined)).toBeGreaterThanOrEqual(1);
  });
});
