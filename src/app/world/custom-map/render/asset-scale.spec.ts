import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCatalog, type CatalogObject } from './asset-catalog';

/**
 * The catalogue's sizes against the world: what a thing is as high as, at
 * scale 1 and over its scale range. Placed among each other, a toadstool
 * as high as a knee or a lamp as thick as a column breaks the scale of
 * the whole map. Heights in metres (catalogue `height`, measured from the
 * model); a kind whose own models differ by design (a giant mushroom, a
 * tall chain-link fence) has its own line before the general one.
 */
const REFERENCE: readonly { kind: RegExp; height: readonly [number, number]; why: string }[] = [
  { kind: /^mushroom-giant$/, height: [2, 5], why: 'a fairy wood’s giant toadstool' },
  { kind: /^mushrooms-glow$/, height: [0.1, 0.4], why: 'glowing mushrooms, a little taller than a hand' },
  { kind: /^mushrooms/, height: [0.05, 0.25], why: 'a cluster of mushrooms, a hand high' },
  { kind: /^(lamp-post|street-lamp)$/, height: [3.4, 6], why: 'a street lamp, the lantern over a head' },
  { kind: /^lantern$/, height: [0.3, 0.6], why: 'a lantern to carry or hang' },
  { kind: /^bench$/, height: [0.7, 1.0], why: 'a bench, back included' },
  { kind: /^car-/, height: [1.2, 1.7], why: 'a car' },
  { kind: /^(barrel|toxic-barrel|barrel-wine|barrel-old|barrel-small|barrel-rusty|barrel-stove)$/, height: [0.6, 1.1], why: 'a barrel, hip high' },
  { kind: /^crate$/, height: [0.5, 1.1], why: 'a crate' },
  { kind: /^hydrant$/, height: [0.5, 1.0], why: 'a hydrant, knee high' },
  { kind: /^fence-chainlink/, height: [1.8, 3], why: 'a chain-link fence, over a head' },
  { kind: /^fence-/, height: [0.9, 1.6], why: 'a garden fence, chest high' },
  { kind: /^castle-door$/, height: [2.2, 4], why: 'a door a rider passes' },
  { kind: /^signpost$/, height: [2, 3.2], why: 'a signpost, its arms over a head' },
  { kind: /^bollards$/, height: [0.6, 1.1], why: 'bollards, thigh high' },
  { kind: /^tree-(oak|maple|birch|pine|fir|willow)(-autumn|-snow|-red)?$/, height: [8, 20], why: 'a grown tree' },
  { kind: /^tree-.*young/, height: [3, 9], why: 'a young tree' },
];

function catalogObjects(): CatalogObject[] {
  const json = JSON.parse(readFileSync(join(process.cwd(), 'public/maps/assets/catalog.json'), 'utf8'));
  return parseCatalog(json).objects;
}

describe('catalogue scale', () => {
  const objects = catalogObjects();

  it('keeps each kind of thing as high as it is in the world', () => {
    const wrong: string[] = [];
    for (const o of objects) {
      const ref = REFERENCE.find((r) => r.kind.test(o.id));
      if (!ref) continue;
      const [lo, hi] = ref.height;
      if (o.height < lo || o.height > hi) wrong.push(`${o.id}: ${o.height} m, ${ref.why} is ${lo} to ${hi} m`);
    }
    expect(wrong).toEqual([]);
  });

  it('keeps small things small over their whole scale range', () => {
    // At the largest scale a placer may pick, no cluster of mushrooms reaches a knee
    for (const o of objects.filter((x) => /^mushrooms/.test(x.id))) expect(o.height * o.scaleRange[1]).toBeLessThanOrEqual(0.5);
  });

  it('names a kind for every reference, so a renamed model does not slip past', () => {
    for (const r of REFERENCE) expect(objects.some((o) => r.kind.test(o.id))).toBe(true);
  });
});
