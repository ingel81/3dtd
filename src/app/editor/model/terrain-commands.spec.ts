import { describe, expect, it } from 'vitest';
import { createMapDocument } from '../../world/custom-map/map-create';
import { contentBytes } from '../../world/custom-map/map-file';
import { RiverListCommand } from './terrain-commands';

describe('RiverListCommand', () => {
  it('gives back the river list exactly as it was, an empty one too', () => {
    const doc = createMapDocument({ id: 'r', name: 'R', width: 64, depth: 64 });
    // A map whose last river went: the list stays, empty
    doc.terrain.rivers = [];
    const before = contentBytes(doc);
    const river = { id: 'r1', kind: 'water' as const, points: [{ x: 0, y: 0, width: 6 }, { x: 20, y: 0, width: 6 }] };
    const command = new RiverListCommand('River', [], [river] as never);
    command.apply(doc);
    expect(doc.terrain.rivers).toHaveLength(1);
    command.revert(doc);
    expect(doc.terrain.rivers).toEqual([]);
    expect(contentBytes(doc)).toEqual(before);
    // A map that never had one keeps none
    delete doc.terrain.rivers;
    new RiverListCommand('River', undefined, [river] as never).revert(doc);
    expect(doc.terrain.rivers).toBeUndefined();
  });
});
