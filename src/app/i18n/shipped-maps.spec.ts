import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en } from './messages/en';
import { de } from './messages/de';
import { shippedMapDescription } from './shipped-maps';
import { bold, splitBold } from './format';

/** The shipped maps' words (docs/I18N_PLAN.md 4.7): index.json stays English, the dictionary says the same */
describe('shipped maps in the dictionary (TODO E245)', () => {
  const index = JSON.parse(readFileSync(resolve(__dirname, '../../../public/maps/index.json'), 'utf8')) as {
    maps: { id: string; name: string; description?: string }[];
  };

  it('every map of the index has its description in English as the index has it, and in German', () => {
    expect(Object.keys(en.maps).sort()).toEqual(index.maps.map((m) => m.id).sort());
    for (const map of index.maps) {
      expect(shippedMapDescription(en, map.id), map.id).toBe(map.description ?? '');
      expect(shippedMapDescription(de, map.id)?.trim(), map.id).not.toBe('');
    }
    expect(shippedMapDescription(de, 'my-own')).toBeNull();
  });

  it('never translates a map name: the dictionary holds none', () => {
    for (const t of [en, de]) for (const words of Object.values(t.maps)) expect(Object.keys(words)).toEqual(['description']);
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
