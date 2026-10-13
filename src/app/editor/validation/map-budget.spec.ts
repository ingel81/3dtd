import { MAX_MAP_BYTES } from '../../coop/protocol';
import { OBJECT_BUDGET, mapBudget } from './map-budget';

describe('mapBudget', () => {
  it('spends objects against the budget and the file against what coop sends', () => {
    const [objects, file] = mapBudget(3000, 6 * 2 ** 20);
    expect(objects).toMatchObject({ label: 'Objects', text: '3,000 of 15,000', state: 'ok' });
    expect(objects.share).toBeCloseTo(0.2);
    expect(file).toMatchObject({ label: 'File', text: '6.0 MB of 32.0 MB', state: 'ok' });
  });

  it('warns from 80 % and says when a line is over', () => {
    expect(mapBudget(OBJECT_BUDGET * 0.8, null)[0].state).toBe('warn');
    expect(mapBudget(OBJECT_BUDGET + 1, null)[0].state).toBe('over');
    expect(mapBudget(0, MAX_MAP_BYTES + 1)[1].state).toBe('over');
    // Before the first save the file's size is not known
    expect(mapBudget(0, null)).toHaveLength(1);
  });
});
