import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en } from './messages/en';
import { de } from './messages/de';
import { shippedMap, shippedMapName } from './shipped-maps';
import { bold, splitBold } from './format';

/** The shipped maps' words (docs/I18N_PLAN.md 4.7): index.json stays English, the dictionary says the same */
describe('shipped maps in the dictionary (TODO E245)', () => {
  const index = JSON.parse(readFileSync(resolve(__dirname, '../../../public/maps/index.json'), 'utf8')) as {
    maps: { id: string; name: string; description?: string }[];
  };

  it('every map of the index has its name and description in English as the index has them, and in German', () => {
    expect(Object.keys(en.maps).sort()).toEqual(index.maps.map((m) => m.id).sort());
    for (const map of index.maps) {
      expect(shippedMap(en, map.id), map.id).toEqual({ name: map.name, description: map.description ?? '' });
      expect(shippedMap(de, map.id)?.name.trim(), map.id).not.toBe('');
    }
  });

  it('names a shipped map by its English name in the player language, any other name as it is', () => {
    expect(shippedMapName(de, 'Demo Valley')).toBe(de.maps['demo-valley'].name);
    expect(shippedMapName(de, 'My own map')).toBe('My own map');
    expect(shippedMap(de, 'my-own')).toBeNull();
  });
});

describe('bold parts of a line', () => {
  it('takes a line apart around its bold part, the part without the marks', () => {
    expect(splitBold(`Waiting for ${bold('Bob')} to catch up`)).toEqual({ lead: 'Waiting for ', bold: 'Bob', text: ' to catch up' });
    expect(splitBold('No bold here')).toEqual({ lead: '', bold: '', text: 'No bold here' });
    // A name cannot bring marks of its own
    expect(splitBold(`${bold(bold('A'))}!`)).toEqual({ lead: '', bold: 'A', text: '!' });
  });
});
