import { describe, expect, it } from 'vitest';
import { modelLabel, modelsMissingText } from './model-label';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { en } from '../../i18n/messages/en';

describe('model labels for the notice', () => {
  it('names a tower by its name and another model by its file', () => {
    expect(modelLabel(en, TOWER_TYPES.archer.modelUrl)).toBe(en.names.towers.archer);
    expect(modelLabel(en, 'assets/models/portal-frame.glb')).toBe('portal-frame');
  });

  it('lists each name once', () => {
    const url = TOWER_TYPES.archer.modelUrl;
    expect(modelsMissingText(en, [url, url, 'assets/models/portal-frame.glb']))
      .toBe(`Models did not load: ${en.names.towers.archer}, portal-frame. They stay unseen until a reload.`);
  });
});
