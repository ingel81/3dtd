import { describe, expect, it } from 'vitest';
import { modelLabel, modelsMissingText } from './model-label';
import { TOWER_TYPES } from '../../configs/tower-types.config';

describe('model labels for the notice', () => {
  it('names a tower by its name and another model by its file', () => {
    expect(modelLabel(TOWER_TYPES.archer.modelUrl)).toBe(TOWER_TYPES.archer.name);
    expect(modelLabel('assets/models/portal-frame.glb')).toBe('portal-frame');
  });

  it('lists each name once', () => {
    const url = TOWER_TYPES.archer.modelUrl;
    expect(modelsMissingText([url, url, 'assets/models/portal-frame.glb']))
      .toBe(`Models did not load: ${TOWER_TYPES.archer.name}, portal-frame. They stay unseen until a reload.`);
  });
});
