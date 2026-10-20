import { describe, expect, it } from 'vitest';
import { NO_WORDS } from './no-words';

describe('NO_WORDS (TODO E245)', () => {
  it('has every key and says nothing, as text and as a sentence with values', () => {
    expect(`${NO_WORDS.editor.landscape.biomes.forest.label}`).toBe('');
    expect(NO_WORDS.editor.session.waits('a', 'b')).toBe('');
    expect(String(NO_WORDS.hud.hints.gotIt)).toBe('');
  });
});
