import { describe, expect, it } from 'vitest';
import type { MapObject } from './map-document';
import { lowBarriersUnder } from './tower-cover';

const entries = new Map([
  // A 6 m hedge along model x, 0.5 m thick
  ['hedge-long', { footprint: 3, blocksBuild: false, category: 'wall' as const, box: [0, 0, 3, 0.25] as [number, number, number, number] }],
  ['wall-castle', { footprint: 4, blocksBuild: true, category: 'wall' as const }],
  ['tree', { footprint: 2, blocksBuild: true, category: 'tree' as const }],
]);
const at = (id: string, asset: string, x: number, y: number, rotation = 0): MapObject => ({ id, asset, x, y, z: 0, rotation, scale: 1 });

describe('lowBarriersUnder', () => {
  it('covers the low barriers a plinth reaches, by their ground rectangle', () => {
    const objects = [
      at('under', 'hedge-long', 0, 0),
      // Its end 2.8 m off the middle along x: the plinth of 3 m reaches it
      at('end', 'hedge-long', 5.8, 0),
      // Beside, 3.4 m off across its thickness: out of reach
      at('beside', 'hedge-long', 0, 3.4),
      // Turned across: its rectangle runs towards the tower
      at('turned', 'hedge-long', 0, -5.5, Math.PI / 2),
    ];
    expect(lowBarriersUnder(objects, entries, 0, 0, 3).sort()).toEqual(['end', 'turned', 'under']);
  });

  it('leaves what blocks building, by its entry or by the object, and what is no barrier', () => {
    const objects = [at('castle', 'wall-castle', 0, 0), at('tree', 'tree', 0, 0), { ...at('kept', 'hedge-long', 0, 0), blocksBuild: true }];
    expect(lowBarriersUnder(objects, entries, 0, 0, 3)).toEqual([]);
  });
});
