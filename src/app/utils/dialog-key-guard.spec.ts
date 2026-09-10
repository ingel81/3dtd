import { describe, it, expect } from 'vitest';
import { isEscapeForDialog } from './dialog-key-guard';

describe('isEscapeForDialog', () => {
  it('leaves Escape to the game when no dialog is open', () => {
    expect(isEscapeForDialog('Escape', false, 0)).toBe(false);
  });

  it('claims Escape while a dialog is open', () => {
    expect(isEscapeForDialog('Escape', false, 1)).toBe(true);
  });

  it('claims Escape a closing dialog already consumed', () => {
    // Ohne Animationen ist der Dialog beim window-Listener schon aus openDialogs raus
    expect(isEscapeForDialog('Escape', true, 0)).toBe(true);
  });

  it('never claims other keys', () => {
    expect(isEscapeForDialog('r', false, 1)).toBe(false);
    expect(isEscapeForDialog('w', true, 1)).toBe(false);
  });
});
