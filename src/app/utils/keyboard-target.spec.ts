import { describe, expect, it } from 'vitest';
import { isTypingTarget } from './keyboard-target';

function input(type?: string): HTMLInputElement {
  const el = document.createElement('input');
  if (type) el.type = type;
  return el;
}

describe('isTypingTarget', () => {
  it('is true for text fields, selects and editable elements', () => {
    expect(isTypingTarget(input())).toBe(true);
    for (const type of ['text', 'search', 'number', 'email', 'password', 'url', 'tel']) {
      expect(isTypingTarget(input(type)), type).toBe(true);
    }
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
    // jsdom does not implement isContentEditable
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it('is false for inputs that take no text, like the auto-start checkbox', () => {
    for (const type of ['checkbox', 'radio', 'range', 'button', 'submit', 'color']) {
      expect(isTypingTarget(input(type)), type).toBe(false);
    }
  });

  it('is false for buttons, the canvas, the window and no target', () => {
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(document.createElement('canvas'))).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
