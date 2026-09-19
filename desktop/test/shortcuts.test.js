'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { shortcutFor } = require('../src/shortcuts');

const key = (key, extra = {}) => ({ type: 'keyDown', key, control: false, alt: false, meta: false, shift: false, ...extra });

describe('shortcutFor', () => {
  it('takes F11 and F12', () => {
    assert.equal(shortcutFor(key('F11')), 'toggle-fullscreen');
    assert.equal(shortcutFor(key('F12')), 'toggle-devtools');
  });

  it('opens the log folder on Ctrl+Shift+L', () => {
    assert.equal(shortcutFor(key('L', { control: true, shift: true })), 'open-logs');
    assert.equal(shortcutFor(key('l', { control: true, shift: true })), 'open-logs');
    assert.equal(shortcutFor(key('l', { control: true })), null);
    assert.equal(shortcutFor(key('L', { shift: true })), null);
    assert.equal(shortcutFor(key('L', { control: true, shift: true, alt: true })), null);
  });

  it('leaves every other key to the game', () => {
    for (const name of ['Escape', 'r', 'F5', ' ', '1', 'Tab']) assert.equal(shortcutFor(key(name)), null, name);
    assert.equal(shortcutFor(key('F11', { control: true })), null);
    assert.equal(shortcutFor(key('F12', { shift: true })), null);
  });

  it('ignores key-up and auto-repeat, so holding F11 does not flicker', () => {
    assert.equal(shortcutFor(key('F11', { type: 'keyUp' })), null);
    assert.equal(shortcutFor(key('F11', { isAutoRepeat: true })), null);
  });
});
