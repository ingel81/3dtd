import { createMapDocument } from './map-create';
import type { CustomMapDocument, MapObject } from './map-document';

/**
 * A large test map for performance: `samples` height samples a side at 2 m
 * (1025 = 2 km), noise relief, and `objects` catalogue objects scattered at
 * random (trees, bushes, grass, rocks, houses). Deterministic. Used by the
 * renderer's perf spec and by `/map-preview?big=1025&objects=50000`.
 */
export function createPerfMap(samples: number, objects: number): CustomMapDocument {
  const size = (samples - 1) * 2;
  const doc = createMapDocument({ id: `perf-${samples}`, name: 'Perf', width: size, depth: size, ground: 'noise', seed: 3 });
  const ids = ['tree-oak', 'tree-pine', 'tree-birch', 'bush', 'grass-clump', 'rock-small', 'house'];
  let s = 1;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const list: MapObject[] = [];
  for (let k = 0; k < objects; k++) {
    list.push({
      id: `o${k}`,
      asset: ids[k % ids.length],
      x: (rnd() - 0.5) * size * 0.95,
      y: (rnd() - 0.5) * size * 0.95,
      z: 0,
      rotation: rnd() * 6.28,
      scale: 1,
    });
  }
  doc.objects = list;
  return doc;
}
