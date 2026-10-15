import { readFileSync } from 'node:fs';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { MapLifeArea } from '../../map-document';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { LifeMovers } from './life-movers';

const catalog = JSON.parse(readFileSync('public/maps/assets/catalog.json', 'utf8')) as unknown;

/** The shipped catalogue with every model a small box */
function library(): MapAssetLibrary {
  return new MapAssetLibrary('maps/assets/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    decodeImage: () => Promise.reject(new Error('offline')),
    loadModel: () => {
      const g = new Group();
      g.add(new Mesh(new BoxGeometry(1, 0.5, 3), new MeshStandardMaterial()));
      return Promise.resolve(g);
    },
    textureSize: 4,
  });
}

/** Flat ground at 0, a lake at 2 m over the west half (map x < 0) */
const field = new HeightField({ columns: 3, rows: 3, cellSize: 100, heights: new Float32Array(9) }, 200, 200);
const water = (x: number): number | null => (x < 0 ? 2 : null);

function positions(boats: LifeMovers): Vector3[] {
  const out: Vector3[] = [];
  const m = new Matrix4();
  for (const mesh of boats.group.children as InstancedMesh[]) {
    for (let k = 0; k < mesh.count; k++) {
      mesh.getMatrixAt(k, m);
      out.push(new Vector3().setFromMatrixPosition(m));
    }
  }
  return out;
}

describe('LifeMovers', () => {
  it('drifts the boats of an area on its water, slowly, each on its own loop inside the outline', async () => {
    const boats = new LifeMovers(library(), field, water);
    const lake: MapLifeArea = { id: 'l', kind: 'boats', shape: 'area', points: [{ x: -90, y: -40 }, { x: -10, y: -40 }, { x: -10, y: 40 }, { x: -90, y: 40 }], density: 1.5 };
    await boats.set([lake, { id: 'f', kind: 'fog', shape: 'area', points: lake.points }], 1);
    const start = positions(boats);
    // Six at density 1.5, one draw call for the box
    expect(boats.group.children).toHaveLength(1);
    expect(start).toHaveLength(6);
    for (const p of start) {
      expect(p.y).toBeGreaterThan(1.85);
      expect(p.y).toBeLessThan(2.15);
      expect(-p.x).toBeGreaterThan(-90);
      expect(-p.x).toBeLessThan(-10);
    }
    boats.update(10);
    const later = positions(boats);
    const moved = later.map((p, k) => p.distanceTo(start[k]));
    expect(Math.min(...moved)).toBeGreaterThan(1);
    expect(Math.max(...moved)).toBeLessThan(13);
    // A still frame holds them
    boats.update(0);
    expect(positions(boats)).toEqual(later);
    boats.dispose();
  });

  it('runs movers over the ground, pitched with it, at their speed, none without an asset', async () => {
    // A slope rising 0.2 m per metre to the north
    const hill = new HeightField({ columns: 3, rows: 3, cellSize: 100, heights: new Float32Array([0, 0, 0, 20, 20, 20, 40, 40, 40]) }, 200, 200);
    const movers = new LifeMovers(library(), hill, () => null);
    const road: MapLifeArea = { id: 'm', kind: 'movers', shape: 'route', points: [{ x: 0, y: -80 }, { x: 0, y: 80 }], asset: 'rover', speed: 3 };
    await movers.set([road, { ...road, id: 'n', asset: undefined }], 1);
    const start = positions(movers);
    expect(start).toHaveLength(2);
    for (const p of start) expect(p.y).toBeCloseTo(hill.heightAt(-p.x, p.z), 1);
    movers.update(4);
    const later = positions(movers);
    // About 3 m/s along the line (10 % either way)
    for (let k = 0; k < 2; k++) {
      expect(later[k].distanceTo(start[k])).toBeGreaterThan(10);
      expect(later[k].distanceTo(start[k])).toBeLessThan(13.5);
    }
    // With a height it hangs from a straight line from 30 m over the start to 30 m over the end
    await movers.set([{ ...road, height: 30, speed: 1 }], 1);
    for (const p of positions(movers)) expect(p.y).toBeCloseTo(4 + 30 + ((p.z + 80) / 160) * 32, 0);
    movers.dispose();
  });

  it('runs boats along a route and back, fewer at a lower density, none without areas', async () => {
    const boats = new LifeMovers(library(), field, water);
    const route: MapLifeArea = { id: 'r', kind: 'boats', shape: 'route', points: [{ x: -50, y: -80 }, { x: -50, y: 80 }], asset: 'fishing-boat' };
    await boats.set([route], 1);
    expect(positions(boats)).toHaveLength(3);
    for (const p of positions(boats)) expect(Math.abs(-p.x + 50)).toBeLessThan(6);
    await boats.set([route], 0.34);
    expect(positions(boats)).toHaveLength(1);
    await boats.set([], 1);
    expect(boats.group.children).toHaveLength(0);
    boats.dispose();
  });
});
