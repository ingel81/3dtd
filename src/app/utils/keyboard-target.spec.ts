import { afterEach, describe, expect, it } from 'vitest';
import { FocusOrigin, controlTakesKey, escapeBelongsToGame, ownsKey } from './keyboard-target';

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

describe('controlTakesKey', () => {
  const keyboard = () => true;
  const mouse = () => false;

  it('gives Tab and Enter to a control reached by keyboard', () => {
    const button = document.createElement('button');
    const link = document.createElement('a');
    link.href = '#';
    const radio = document.createElement('div');
    radio.setAttribute('role', 'radio');
    for (const el of [button, link, radio, input('checkbox')]) {
      expect(controlTakesKey(el, 'Tab', keyboard), el.tagName).toBe(true);
      expect(controlTakesKey(el, 'Enter', keyboard), el.tagName).toBe(true);
      expect(controlTakesKey(el, ' ', keyboard), el.tagName).toBe(true);
    }
  });

  it('leaves the keys to the game after a mouse click on the control', () => {
    const button = document.createElement('button');
    expect(controlTakesKey(button, 'Tab', mouse)).toBe(false);
    expect(controlTakesKey(button, 'Enter', mouse)).toBe(false);
    expect(controlTakesKey(button, ' ', mouse)).toBe(false);
  });

  it('leaves the other game keys, and plain elements, alone', () => {
    const button = document.createElement('button');
    for (const key of ['x', 'Escape', 'w']) expect(controlTakesKey(button, key, keyboard), key).toBe(false);
    expect(controlTakesKey(document.createElement('div'), 'Enter', keyboard)).toBe(false);
    expect(controlTakesKey(document.body, 'Tab', keyboard)).toBe(false);
    expect(controlTakesKey(null, 'Tab', keyboard)).toBe(false);
    expect(controlTakesKey(window, 'Tab', keyboard)).toBe(false);
  });
});

describe('FocusOrigin', () => {
  const origin = new FocusOrigin(document);
  const button = () => document.body.appendChild(document.createElement('button'));

  it('a focus without a pointer press belongs to the keyboard (Tab, a script)', () => {
    const el = button();
    el.focus();
    expect(origin.byKeyboardFocus(el)).toBe(true);
  });

  it('a focus right after a pointer press belongs to the mouse, also while keys follow', () => {
    const el = button();
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    el.focus();
    expect(origin.byKeyboardFocus(el)).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(origin.byKeyboardFocus(el)).toBe(false);
  });

  it('a key press between the click and the next focus hands the focus to the keyboard', () => {
    const clicked = button();
    clicked.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    clicked.focus();
    const next = button();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    next.focus();
    expect(origin.byKeyboardFocus(next)).toBe(true);
    expect(origin.byKeyboardFocus(clicked)).toBe(false);
  });

  it('knows whether the page has seen a pointer press at all', () => {
    const page = document.implementation.createHTMLDocument();
    const fresh = new FocusOrigin(page);
    expect(fresh.pointerUsed()).toBe(false);
    page.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(fresh.pointerUsed()).toBe(true);
  });
});

describe('escapeBelongsToGame', () => {
  const escape = (init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: 'Escape', ...init });

  // The page's own document: focus moves only in a rendered one
  afterEach(() => document.body.replaceChildren());

  function page(...panes: string[]): Document {
    const doc = document;
    doc.body.replaceChildren();
    for (const cls of panes) {
      const pane = doc.createElement('div');
      pane.className = `cdk-overlay-pane ${cls}`;
      pane.appendChild(doc.createElement('div'));
      doc.body.appendChild(pane);
    }
    return doc;
  }

  function trigger(doc: Document): HTMLButtonElement {
    const el = doc.createElement('button');
    el.className = 'mat-mdc-tooltip-trigger';
    doc.body.appendChild(el);
    el.focus();
    return el;
  }

  it('goes to the game while a tooltip opened by the pointer shows', () => {
    const doc = page('mat-mdc-tooltip-panel');
    trigger(doc);
    expect(escapeBelongsToGame(escape(), doc, () => false)).toBe(true);
  });

  it('stays with a tooltip whose trigger the keyboard is on', () => {
    const doc = page('mat-mdc-tooltip-panel');
    trigger(doc);
    expect(escapeBelongsToGame(escape(), doc, () => true)).toBe(false);
  });

  it('stays with a dialog or a menu that is open beside the tooltip', () => {
    expect(escapeBelongsToGame(escape(), page('mat-mdc-tooltip-panel', 'mat-mdc-dialog-panel'), () => false)).toBe(false);
  });

  it('is the normal way without a tooltip, an empty pane or another key', () => {
    expect(escapeBelongsToGame(escape(), page(), () => false)).toBe(false);
    const doc = page('mat-mdc-tooltip-panel');
    doc.querySelector('.cdk-overlay-pane')!.replaceChildren();
    expect(escapeBelongsToGame(escape(), doc, () => false)).toBe(false);
    expect(escapeBelongsToGame(new KeyboardEvent('keydown', { key: 'Enter' }), page('mat-mdc-tooltip-panel'), () => false)).toBe(false);
    expect(escapeBelongsToGame(escape({ shiftKey: true }), page('mat-mdc-tooltip-panel'), () => false)).toBe(false);
  });

  it('counts a rich tooltip card beside it as a tooltip', () => {
    expect(escapeBelongsToGame(escape(), page('mat-mdc-tooltip-panel', 'td-rich-tooltip-panel'), () => false)).toBe(true);
  });
});
