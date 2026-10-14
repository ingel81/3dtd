import { createMapDocument } from '../../world/custom-map/map-create';
import type { MapObject } from '../../world/custom-map/map-document';
import { heightAt } from '../model/grid';
import { brushWeight, stepRadius } from './brush';
import { autoPaint, defaultAutoRules, dominantLayer, moveLayer, paintDab, readWeights, removeLayer } from './paint-ops';
import { erodeDab, flattenDab, noiseDab, raiseDab, rampBetween, smoothDab, terraceDab } from './terrain-ops';
import { basinSpillHeight, emptyWater, fillBasin, waterMaskDab } from './water-ops';
import { DEFAULT_SCATTER, MAX_SINK, ObjectGrid, ObjectIds, duplicateObjects, objectsInBox, scatterDab, settled, slopeTilt, alignedToSlope, undersideGap, variedTint, type RockShape } from './object-ops';
import { Euler, Quaternion, Vector3 } from 'three';
import { flattenUnderPaths, paintUnderPaths } from './path-terrain';
import { resizeMap } from './resize';

const flat = () => createMapDocument({ id: 'm', name: 'M', width: 200, depth: 200, cellSize: 2, starter: false });
const brush = { radius: 10, strength: 1, falloff: 0.5 };

function sum8(t: ReturnType<typeof flat>['terrain'], texel: number): number {
  const w = new Float32Array(8);
  readWeights(t, texel, w);
  return w.reduce((a, b) => a + b, 0);
}

describe('brush', () => {
  it('weighs full inside, fades to zero at the rim', () => {
    expect(brushWeight(0, 10, 0.5)).toBe(1);
    expect(brushWeight(5, 10, 0.5)).toBe(1);
    expect(brushWeight(7.5, 10, 0.5)).toBeCloseTo(0.5);
    expect(brushWeight(10, 10, 0.5)).toBe(0);
    expect(brushWeight(9.99, 10, 0)).toBe(1);
  });

  it('steps the radius and keeps it in bounds', () => {
    expect(stepRadius(10, 1)).toBeGreaterThan(10);
    expect(stepRadius(10, -1)).toBeLessThan(10);
    expect(stepRadius(1, -1)).toBe(1);
    expect(stepRadius(200, 1)).toBe(200);
  });
});

describe('terrain brushes', () => {
  it('raises the centre most and leaves the outside alone', () => {
    const t = flat().terrain;
    const rect = raiseDab(t, 0, 0, brush, 3);
    expect(heightAt(t, 0, 0)).toBeCloseTo(3);
    expect(heightAt(t, 30, 0)).toBe(0);
    expect(rect.i1 - rect.i0).toBeLessThanOrEqual(12);
  });

  it('smooths a spike', () => {
    const t = flat().terrain;
    raiseDab(t, 0, 0, { radius: 2, strength: 1, falloff: 0 }, 10);
    const before = heightAt(t, 0, 0);
    for (let k = 0; k < 5; k++) smoothDab(t, 0, 0, brush, 1);
    expect(heightAt(t, 0, 0)).toBeLessThan(before / 2);
  });

  it('flattens toward a height', () => {
    const t = flat().terrain;
    for (let k = 0; k < 30; k++) flattenDab(t, 0, 0, brush, 5, 0.5);
    expect(heightAt(t, 0, 0)).toBeCloseTo(5, 1);
  });

  it('roughens without moving the far ground', () => {
    const t = flat().terrain;
    noiseDab(t, 0, 0, { radius: 20, strength: 1, falloff: 0.2 }, 2, 3);
    let changed = 0;
    for (let x = -10; x <= 10; x += 2) if (heightAt(t, x, 3) !== 0) changed++;
    expect(changed).toBeGreaterThan(3);
    expect(heightAt(t, 60, 60)).toBe(0);
  });

  it('erodes a cliff into a gentler slope', () => {
    const t = flat().terrain;
    const g = t.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) if (i > g.columns / 2) g.heights[j * g.columns + i] = 20;
    const steepBefore = Math.abs(heightAt(t, 2, 0) - heightAt(t, 0, 0));
    for (let k = 0; k < 10; k++) erodeDab(t, 1, 0, { radius: 12, strength: 1, falloff: 0.3 });
    const steepAfter = Math.abs(heightAt(t, 2, 0) - heightAt(t, 0, 0));
    expect(steepAfter).toBeLessThan(steepBefore);
  });

  it('snaps heights to terrace levels', () => {
    const t = flat().terrain;
    raiseDab(t, 0, 0, { radius: 30, strength: 1, falloff: 1 }, 9);
    for (let k = 0; k < 20; k++) terraceDab(t, 0, 0, { radius: 30, strength: 1, falloff: 0 }, 4, 1);
    for (const x of [0, 5, 10, 15, 20]) {
      const h = heightAt(t, x, 0);
      // On the grid samples the heights sit on the levels
      if (x % 2 === 0) expect(Math.abs(h - Math.round(h / 4) * 4)).toBeLessThan(0.05);
    }
  });

  it('builds a ramp between two heights', () => {
    const t = flat().terrain;
    rampBetween(t, { x: -40, y: 0, h: 0 }, { x: 40, y: 0, h: 16 }, 10, 0.3);
    expect(heightAt(t, 0, 0)).toBeCloseTo(8, 0);
    expect(heightAt(t, 30, 0)).toBeCloseTo(14, 0);
    expect(heightAt(t, 0, 30)).toBe(0);
  });
});

describe('ground paint', () => {
  it('keeps every texel summing to 255 while painting and erasing', () => {
    const t = flat().terrain;
    t.layers.push({ material: 'dirt' }, { material: 'rock' });
    paintDab(t, 0, 0, brush, 1, 0.6);
    paintDab(t, 3, 0, brush, 2, 0.4);
    paintDab(t, 0, 0, brush, 1, 0.5, true);
    const res = t.splat.resolution;
    for (let k = 0; k < res * res; k += 37) expect(sum8(t, k)).toBe(255);
    expect(dominantLayer(t, 0, 0)).not.toBe(1);
  });

  it('auto paints rock on slopes from the layer names', () => {
    const t = flat().terrain;
    t.layers.push({ material: 'rock-cliff' });
    // A steep wall at x > 0
    const g = t.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = Math.max(0, (i - g.columns / 2) * 3);
    autoPaint(t, defaultAutoRules(t));
    expect(dominantLayer(t, -50, 0)).toBe(0);
    expect(dominantLayer(t, 50, 0)).toBe(1);
  });

  it('moves and removes layers with their weights', () => {
    const t = flat().terrain;
    t.layers.push({ material: 'dirt' });
    paintDab(t, 0, 0, { radius: 10, strength: 1, falloff: 0 }, 1, 1);
    expect(dominantLayer(t, 0, 0)).toBe(1);
    moveLayer(t, 1, 0);
    expect(t.layers[0].material).toBe('dirt');
    expect(dominantLayer(t, 0, 0)).toBe(0);
    expect(dominantLayer(t, 80, 80)).toBe(1);
    removeLayer(t, 0);
    expect(t.layers.map((l) => l.material)).toEqual(['grass']);
    expect(sum8(t, 0)).toBe(255);
  });
});

describe('water', () => {
  it('fills a basin up to the level and not beyond the rim', () => {
    const t = flat().terrain;
    raiseDab(t, 0, 0, { radius: 30, strength: 1, falloff: 0 }, -5);
    t.water = emptyWater(t, -2);
    const rect = fillBasin(t, t.grid.columns >> 1, t.grid.rows >> 1);
    expect(rect).not.toBeNull();
    const g = t.grid;
    const at = (x: number, y: number) => t.water!.mask[Math.round((y + 100) / 2) * g.columns + Math.round((x + 100) / 2)];
    expect(at(0, 0)).toBe(255);
    expect(at(60, 60)).toBe(0);
    expect(fillBasin(t, 0, 0)).toBeNull();
  });

  it('paints and clears the mask', () => {
    const t = flat().terrain;
    t.water = emptyWater(t, 1);
    waterMaskDab(t, 0, 0, brush, true);
    expect(t.water.mask.reduce((a, b) => a + (b ? 1 : 0), 0)).toBeGreaterThan(10);
    waterMaskDab(t, 0, 0, { ...brush, radius: 20 }, false);
    expect(t.water.mask.every((b) => b === 0)).toBe(true);
  });
});

describe('objects', () => {
  it('scatters with the minimum distance and fresh ids', () => {
    const doc = flat();
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const grid = new ObjectGrid(8);
    const ids = new ObjectIds(doc.objects);
    const placed = [];
    for (let k = 0; k < 20; k++) {
      placed.push(...scatterDab(doc.terrain, { x: 0, y: 0 }, { radius: 30, strength: 1, falloff: 0.3 }, { ...DEFAULT_SCATTER, assets: ['tree'], density: 40 }, grid, ids, random));
    }
    expect(placed.length).toBeGreaterThan(10);
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        expect(Math.hypot(placed[a].x - placed[b].x, placed[a].y - placed[b].y)).toBeGreaterThanOrEqual(DEFAULT_SCATTER.minDistance - 0.02);
      }
    }
    expect(new Set(placed.map((o) => o.id)).size).toBe(placed.length);
  });

  it('tints scattered objects when asked, each its own shade', () => {
    const doc = flat();
    let seed = 3;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const placed = scatterDab(doc.terrain, { x: 0, y: 0 }, { radius: 30, strength: 1, falloff: 0.3 }, { ...DEFAULT_SCATTER, assets: ['rock'], density: 40, tint: '#a08060', tintVariation: 0.5 }, new ObjectGrid(8), new ObjectIds([]), random);
    expect(placed.length).toBeGreaterThan(3);
    expect(placed.every((o) => /^#[0-9a-f]{6}$/.test(o.tint ?? ''))).toBe(true);
    expect(new Set(placed.map((o) => o.tint)).size).toBeGreaterThan(1);
    const plain = scatterDab(doc.terrain, { x: 0, y: 0 }, { radius: 30, strength: 1, falloff: 0.3 }, { ...DEFAULT_SCATTER, assets: ['rock'], density: 40 }, new ObjectGrid(8), new ObjectIds([]), random);
    expect(plain.some((o) => o.tint)).toBe(false);
  });

  it('selects by box and duplicates with new ids', () => {
    const doc = flat();
    doc.objects.push({ id: 'o4', asset: 'a', x: 1, y: 1, z: 0, rotation: 0, scale: 1 }, { id: 'o9', asset: 'a', x: 50, y: 1, z: 0, rotation: 0, scale: 1 });
    expect(objectsInBox(doc, { x: -5, y: -5 }, { x: 5, y: 5 })).toEqual(['o4']);
    const copies = duplicateObjects(doc, ['o4', 'o9'], { x: 2, y: 0 });
    expect(copies.map((o) => o.id)).toEqual(['o10', 'o11']);
    expect(copies[0].x).toBe(3);
  });
});

describe('path terrain', () => {
  it('flattens a road across a bump and paints under it', () => {
    const doc = flat();
    const t = doc.terrain;
    t.layers.push({ material: 'road' });
    raiseDab(t, 0, 3, { radius: 6, strength: 1, falloff: 0.2 }, 4);
    doc.paths = { nodes: [{ id: 'n1', x: -60, y: 0 }, { id: 'n2', x: 60, y: 0 }], edges: [{ id: 'e1', a: 'n1', b: 'n2', width: 8, kind: 'road' }] };
    const across = () => Math.abs(heightAt(t, 0, 3) - heightAt(t, 0, -3));
    const before = across();
    flattenUnderPaths(t, doc.paths);
    expect(across()).toBeLessThan(before * 0.2);
    paintUnderPaths(t, doc.paths, 1);
    expect(dominantLayer(t, 0, 0)).toBe(1);
    expect(dominantLayer(t, 0, 30)).toBe(0);
  });
});

describe('resize', () => {
  it('keeps the shared middle and drops what falls outside', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 200, depth: 200, cellSize: 2 });
    raiseDab(doc.terrain, 0, 0, { radius: 10, strength: 1, falloff: 0 }, 5);
    doc.objects.push({ id: 'o1', asset: 'a', x: 90, y: 90, z: 0, rotation: 0, scale: 1 }, { id: 'o2', asset: 'a', x: 1, y: 1, z: 0, rotation: 0, scale: 1 });
    const result = resizeMap(doc, 100, 120);
    expect(doc.terrain.width).toBe(100);
    expect(doc.terrain.depth).toBe(120);
    expect(doc.terrain.grid.heights.length).toBe(51 * 61);
    expect(heightAt(doc.terrain, 0, 0)).toBeCloseTo(5);
    expect(result.droppedObjects).toBe(1);
    expect(Math.abs(doc.spawns[0].x)).toBeLessThanOrEqual(50);
    // The starter road loses its west end
    expect(doc.paths.edges).toHaveLength(0);
    const bigger = createMapDocument({ id: 'b', name: 'B', width: 40, depth: 40, cellSize: 2 });
    raiseDab(bigger.terrain, 19, 0, { radius: 2, strength: 1, falloff: 0 }, 3);
    resizeMap(bigger, 80, 40);
    // New ground takes the edge height
    expect(heightAt(bigger.terrain, 30, 0)).toBeCloseTo(heightAt(bigger.terrain, 20, 0));
  });

  it('resizes the masks of further water bodies with the grid', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 100, depth: 100, cellSize: 2 });
    const lake = emptyWater(doc.terrain, 2);
    lake.mask[25 * 51 + 25] = 255;
    doc.terrain.waterBodies = [lake];
    resizeMap(doc, 60, 40);
    const g = doc.terrain.grid;
    expect(doc.terrain.waterBodies![0].mask).toHaveLength(g.columns * g.rows);
    expect(doc.terrain.waterBodies![0].mask[10 * g.columns + 15]).toBe(255);
  });
});

describe('basin rim', () => {
  it('finds the height where a hollow overflows', () => {
    const t = flat().terrain;
    // A bowl 5 m deep with a 3 m wall around it
    raiseDab(t, 0, 0, { radius: 40, strength: 1, falloff: 0 }, 3);
    raiseDab(t, 0, 0, { radius: 25, strength: 1, falloff: 0 }, -8);
    const g = t.grid;
    const centre = { i: g.columns >> 1, j: g.rows >> 1 };
    expect(basinSpillHeight(t, centre.i, centre.j)).toBeCloseTo(3, 1);
    // On open flat ground the rim is the ground
    expect(basinSpillHeight(t, 2, 2)).toBeCloseTo(0, 5);
  });
});

describe('tints', () => {
  it('varies a tint around its colour, and leaves objects untinted without one', () => {
    let k = 0;
    const random = () => [0.1, 0.9, 0.5, 0.3, 0.7][k++ % 5];
    expect(variedTint(null, 0, random)).toBeUndefined();
    expect(variedTint('#806040', 0, random)).toBe('#806040');
    const varied = variedTint('#806040', 1, random)!;
    expect(varied).toMatch(/^#[0-9a-f]{6}$/);
    expect(varied).not.toBe('#806040');
    const white = variedTint(null, 0.5, random)!;
    expect(parseInt(white.slice(1, 3), 16)).toBeGreaterThan(200);
  });
});

describe('align to slope', () => {
  it('stands an object turned any way square on a slope, as the renderer composes turn and tilt', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 200, depth: 200, cellSize: 4 });
    const g = doc.terrain.grid;
    // A plane rising 0.3 m per metre east and 0.2 per metre north
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = 0.3 * (i * 4) + 0.2 * (j * 4);
    const len = Math.hypot(0.3, 1, 0.2);
    const normal = new Vector3(0.3 / len, 1 / len, -0.2 / len);
    for (const rotation of [0, 0.7, 2.5, -1.2]) {
      const { pitch, roll } = slopeTilt(doc.terrain, 0, 0, rotation, 4);
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotation);
      q.multiply(new Quaternion().setFromEuler(new Euler(pitch, 0, roll, 'XZY')));
      const up = new Vector3(0, 1, 0).applyQuaternion(q);
      expect(up.distanceTo(normal)).toBeLessThan(0.003);
    }
    const flatDoc = createMapDocument({ id: 'f', name: 'F', width: 100, depth: 100 });
    const o = { id: 'o', asset: 'rock', x: 0, y: 0, z: 0, rotation: 1, scale: 1, pitch: 0.4 };
    expect(alignedToSlope(flatDoc.terrain, o)).toEqual({ id: 'o', asset: 'rock', x: 0, y: 0, z: 0, rotation: 1, scale: 1 });
  });
});

describe('settling rocks', () => {
  /** A slope rising `rise` metres per metre east */
  const slope = (rise: number) => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 200, depth: 200, cellSize: 2, starter: false });
    const g = doc.terrain.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = rise * (i * 2);
    return doc.terrain;
  };
  // A flat-bottomed heap: plate 4 m by 2 m, 2.6 m high
  const heap: RockShape = { base: [4, 2, 0], height: 2.6 };
  const at = (rotation: number): MapObject => ({ id: 'o1', asset: 'heap', x: 0, y: 0, z: 0, rotation, scale: 1 });

  it('measures how far a level plate hangs over a slope, by the plate turned with the rock', () => {
    const t = slope(0.2);
    // Long side across the slope (east-west is the model's x at no turn, map x runs the other way): 4 m * 0.2
    expect(undersideGap(t, at(0), heap.base)).toBeCloseTo(0.8, 1);
    expect(undersideGap(t, at(Math.PI / 2), heap.base)).toBeCloseTo(0.4, 1);
    expect(undersideGap(t, { ...at(0), z: -0.8 }, heap.base)).toBe(0);
    // Tilted with the slope it lies on it, however it is turned
    for (const r of [0, 0.7, 2.5]) expect(undersideGap(t, alignedToSlope(t, at(r), 4), heap.base)).toBeLessThan(0.03);
    expect(undersideGap(slope(0), at(1), heap.base)).toBe(0);
  });

  it('sinks a rock on a gentle slope and tilts it on a steep one instead of burying it', () => {
    const gentle = settled(slope(0.1), at(0), heap);
    expect(gentle.z).toBeCloseTo(-0.4, 1);
    expect(gentle.pitch ?? 0).toBe(0);
    expect(gentle.roll ?? 0).toBe(0);
    const steepGround = slope(0.7);
    const steep = settled(steepGround, at(0), heap);
    expect(steep.roll ?? steep.pitch).toBeTruthy();
    expect(steep.z).toBeGreaterThanOrEqual(-MAX_SINK * heap.height - 0.01);
    expect(undersideGap(steepGround, steep, heap.base)).toBe(0);
    // A rock already in the ground stays where it is
    const deep = { ...at(0), z: -2 };
    expect(settled(slope(0.1), deep, heap)).toBe(deep);
  });

  it('scatters rocks settled on their plates, other objects sunk by the slope', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 200, depth: 200, cellSize: 2, starter: false });
    const g = doc.terrain.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = 0.2 * (i * 2);
    let seed = 5;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const placed = scatterDab(doc.terrain, { x: 0, y: 0 }, { radius: 30, strength: 1, falloff: 0.3 }, { ...DEFAULT_SCATTER, assets: ['heap', 'bush'], density: 40 }, new ObjectGrid(8), new ObjectIds([]), random, 1, (a) => (a === 'heap' ? heap : undefined));
    const heaps = placed.filter((o) => o.asset === 'heap');
    expect(heaps.length).toBeGreaterThan(3);
    for (const o of heaps) expect(undersideGap(doc.terrain, o, heap.base)).toBe(0);
    expect(placed.filter((o) => o.asset === 'bush').every((o) => o.z < 0)).toBe(true);
  });
});
