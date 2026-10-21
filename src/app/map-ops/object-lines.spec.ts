import { describe, expect, it } from 'vitest';
import type { MapObject } from '../world/custom-map/map-document';
import { createMapDocument } from '../world/custom-map/map-create';
import { duplicateObjects, lineOf, linesOfGroups, ObjectIds } from './object-ops';

const piece = (id: string, asset: string, x: number, group?: string): MapObject => ({ id, asset, x, y: 0, z: 0, rotation: 0, scale: 1, ...(group ? { group } : {}) });
const isWall = (asset: string) => asset === 'wall';

describe('lines of pieces', () => {
  it('makes a line of the pieces that lay as one, a row of others stays objects', () => {
    const pieces = [piece('o1', 'wall', 0), piece('o2', 'wall', 4), piece('o3', 'lamp', 8)];
    expect(lineOf('l1', [{ x: -2, y: 0 }, { x: 10, y: 0 }], pieces, isWall)).toEqual({ id: 'l1', points: [{ x: -2, y: 0 }, { x: 10, y: 0 }] });
    expect(pieces.map((o) => o.line)).toEqual(['l1', 'l1', undefined]);
    expect(lineOf('l2', [{ x: 0, y: 0 }, { x: 1, y: 0 }], [piece('o4', 'lamp', 0)], isWall)).toBeNull();
  });

  it("makes a line of each group's walls in the list's order, its pieces naming it", () => {
    const objects = [piece('a', 'wall', 0, 'osm-w1'), piece('b', 'lamp', 2, 'osm-w1'), piece('c', 'wall', 4, 'osm-w1'), piece('d', 'wall', 9, 'osm-a2'), piece('e', 'wall', 20)];
    expect(linesOfGroups(objects, isWall)).toEqual([
      { id: 'osm-w1', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }] },
      { id: 'osm-a2', points: [{ x: 9, y: 0 }, { x: 9, y: 0 }] },
    ]);
    expect(objects.map((o) => o.line)).toEqual(['osm-w1', undefined, 'osm-w1', 'osm-a2', undefined]);
  });

  it('lets a duplicated piece stand alone', () => {
    const doc = createMapDocument({ id: 't', name: 'T', width: 64, depth: 64, cellSize: 4, seed: 1, now: new Date(0) });
    doc.objects = [{ ...piece('o1', 'wall', 0), line: 'l1' }];
    const [copy] = duplicateObjects(doc, ['o1'], { x: 2, y: 0 }, new ObjectIds(doc.objects));
    expect(copy.line).toBeUndefined();
  });
});
