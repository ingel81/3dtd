import { describe, expect, it } from 'vitest';
import { ownsKey } from './keyboard-target';

function input(type?: string): HTMLInputElement {
  const el = document.createElement('input');
  if (type) el.type = type;
  return el;
}

const SLIDER_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
/** Game keys: pan, tower cards, start wave, pause, cancel */
const GAME_KEYS = ['w', 'a', 's', 'd', '1', ' ', 'p', 'Escape'];

describe('ownsKey', () => {
  it('takes every key in text fields, selects and editable elements', () => {
    for (const key of [...GAME_KEYS, ...SLIDER_KEYS]) {
      expect(ownsKey(input(), key), key).toBe(true);
      for (const type of ['text', 'search', 'number', 'email', 'password', 'url', 'tel']) {
        expect(ownsKey(input(type), key), `${type} ${key}`).toBe(true);
      }
      expect(ownsKey(document.createElement('textarea'), key)).toBe(true);
      expect(ownsKey(document.createElement('select'), key)).toBe(true);
      // jsdom does not implement isContentEditable
      expect(ownsKey({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget, key)).toBe(true);
    }
  });

  it('takes the slider keys on a range input and leaves it the game keys', () => {
    for (const key of SLIDER_KEYS) {
      expect(ownsKey(input('range'), key), key).toBe(true);
    }
    for (const key of GAME_KEYS) {
      expect(ownsKey(input('range'), key), key).toBe(false);
    }
  });

  it('takes no key on inputs without text, like the auto-start checkbox', () => {
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'color']) {
      for (const key of [...GAME_KEYS, ...SLIDER_KEYS]) {
        expect(ownsKey(input(type), key), `${type} ${key}`).toBe(false);
      }
    }
  });

  it('takes no key on buttons, the canvas, the window and no target', () => {
    for (const key of [...GAME_KEYS, ...SLIDER_KEYS]) {
      expect(ownsKey(document.createElement('button'), key)).toBe(false);
      expect(ownsKey(document.createElement('canvas'), key)).toBe(false);
      expect(ownsKey(window, key)).toBe(false);
      expect(ownsKey(null, key)).toBe(false);
    }
  });
});
