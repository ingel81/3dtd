import { createMapDocument } from '../../map-create';
import { HeightField } from '../height-field';
import { apronPaintWeights, APRON_PAINT_SAMPLES } from './apron-paint';
import { APRON_RINGS, ApronProfile } from './terrain-apron';
import { MAX_GROUND_LAYERS } from '../../map-document';
import { edgeTreeObjects } from '../objects/edge-trees';

/** 101 x 101 samples of 2 m, flat at 5 */
function flatField(): HeightField {
  const n = 101;
  return new HeightField({ columns: n, rows: n, cellSize: 2, heights: new Float32Array(n * n).fill(5) }, 200, 200);
}

describe('ApronProfile', () => {
  it('meets the map at its border and reads between the rings beyond it', () => {
    const field = flatField();
    const apron = new ApronProfile(field);
    // Inside: the map's own height; on the border: ring 0, the border's height
    expect(apron.heightAt(0, 0)).toBe(5);
    expect(apron.heightAt(100.001, 0)).toBeCloseTo(5, 2);
    // Half way to the second ring: between the two rings' heights there
    const half = apron.heightAt(100 + APRON_RINGS[1] / 2, 0);
    expect(half).toBeLessThanOrEqual(5 + 1e-6);
    expect(half).toBeGreaterThanOrEqual(Math.min(5, apron.heightAt(100 + APRON_RINGS[1], 0)) - 1e-6);
  });

  it('raises a range of mountains far out by the backdrop height, not near the border', () => {
    const field = flatField();
    const flat = new ApronProfile(field);
    const high = new ApronProfile(field, null, 400);
    for (const [x, y] of [[0, -100 - 1600], [100 + 3000, 50], [-30, 100 + 1600]] as const) {
      const rise = high.heightAt(x, y) - flat.heightAt(x, y);
      expect(rise).toBeGreaterThanOrEqual(0.3 * 400 - 1e-3);
      expect(rise).toBeLessThanOrEqual(400 + 1e-3);
    }
    expect(high.heightAt(100 + APRON_RINGS[1], 0)).toBeCloseTo(flat.heightAt(100 + APRON_RINGS[1], 0), 5);
  });
});

describe('apronPaintWeights', () => {
  it("carries the border's natural ground on, a paved border as the map's natural ground", () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 200, depth: 200, baseMaterial: 'pavers', starter: false });
    const t = doc.terrain;
    t.layers.push({ material: 'grass-leafy' }, { material: 'forest-floor' });
    const res = t.splat.resolution;
    // Paving everywhere, a forest floor along the west border, grass in a patch in the middle
    for (let v = 0; v < res; v++) {
      for (let u = 0; u < res; u++) {
        const texel = (v * res + u) * 4;
        const x = ((u + 0.5) / res) * 200 - 100;
        const y = ((v + 0.5) / res) * 200 - 100;
        const layer = x < -70 ? 2 : Math.hypot(x, y) < 30 ? 1 : 0;
        for (let k = 0; k < 4; k++) t.splat.maps[0][texel + k] = k === layer ? 255 : 0;
      }
    }
    const natural = (k: number) => k > 0;
    const w = apronPaintWeights(t, natural);
    const at = (s: number, k: number) => w[s * MAX_GROUND_LAYERS + k];
    // Every sample sums to 1, the paving never shows
    for (let s = 0; s < APRON_PAINT_SAMPLES; s++) {
      let sum = 0;
      for (let k = 0; k < MAX_GROUND_LAYERS; k++) sum += at(s, k);
      expect(sum).toBeCloseTo(1, 5);
      expect(at(s, 0)).toBe(0);
    }
    // The west side (the last quarter, counter-clockwise from the south-west corner) is forest floor
    const west = Math.floor(APRON_PAINT_SAMPLES * 0.875);
    expect(at(west, 2)).toBeGreaterThan(0.95);
    // The paved east side takes the natural ground the map holds most of: here the forest strip
    const east = Math.floor(APRON_PAINT_SAMPLES * 0.375);
    expect(at(east, 2)).toBe(1);
  });
});

describe('edgeTreeObjects', () => {
  it('mirrors the trees of the border band across the border, the rest stays', () => {
    const tree = (id: string, x: number, y: number) => ({ id, asset: 'tree-oak', x, y, z: 0, rotation: 1, scale: 1.2 });
    const objects = [tree('a', 90, 0), tree('b', 0, 0), tree('c', -95, -95), { ...tree('d', 95, 10), asset: 'house' }];
    const out = edgeTreeObjects(objects, (a) => a.startsWith('tree'), 200, 200);
    expect(out.map((o) => [o.id, o.x, o.y])).toEqual([
      ['edge:e:a', 110, 0],
      ['edge:w:c', -105, -95],
      ['edge:s:c', -95, -105],
    ]);
    expect(out[0]).toMatchObject({ asset: 'tree-oak', rotation: 1, scale: 1.2 });
  });
});
