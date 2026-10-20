'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { WORDS, pickLocale, setLocale, words } = require('../src/i18n');

describe('desktop i18n', () => {
  it('takes the first system language it has words for, by its main tag', () => {
    assert.equal(pickLocale(['fr-FR', 'de-AT', 'en-US']), 'de');
    assert.equal(pickLocale(['ja']), 'en');
    assert.equal(pickLocale(undefined), 'en');
  });

  it('follows the game, and keeps its language for one it has no words for', () => {
    setLocale('de');
    assert.equal(words().reload, 'Neu laden');
    setLocale('xx');
    assert.equal(words().reload, 'Neu laden');
    setLocale('en');
    assert.equal(words().reload, 'Reload');
  });

  it('has the same words in every language, each saying something', () => {
    const keys = Object.keys(WORDS.en).sort();
    for (const [locale, w] of Object.entries(WORDS)) {
      assert.deepEqual(Object.keys(w).sort(), keys, locale);
      for (const key of keys) {
        const text = typeof w[key] === 'function' ? w[key]('x') : w[key];
        assert.ok(typeof text === 'string' && text.trim() !== '', `${locale}.${key}`);
      }
    }
  });
});
