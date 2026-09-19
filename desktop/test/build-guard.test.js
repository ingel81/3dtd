'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { filesContaining, secretValuesIn } = require('../scripts/build-guard');

describe('secretValuesIn', () => {
  it('returns the keys that are set and skips empty ones', () => {
    const source = `export const environment = {
      production: true,
      tileProvider: 'cesium' as 'cesium' | 'google',
      googleMapsApiKey: '',
      cesiumIonToken: "eyJhbGciOiJIUzI1NiJ9.secret",
      cesiumAssetId: '2275207',
    };`;
    assert.deepEqual(secretValuesIn(source), ['eyJhbGciOiJIUzI1NiJ9.secret']);
  });

  it('finds nothing in the template', () => {
    assert.deepEqual(secretValuesIn("cesiumIonToken: '', googleMapsApiKey: ``"), []);
  });
});

describe('filesContaining', () => {
  it('names the files a key ended up in', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '3dtd-guard-'));
    try {
      fs.mkdirSync(path.join(dir, 'assets'));
      fs.writeFileSync(path.join(dir, 'main.js'), 'const t="KEY-123";');
      fs.writeFileSync(path.join(dir, 'assets', 'clean.json'), '{}');
      fs.writeFileSync(path.join(dir, 'assets', 'model.glb'), 'KEY-123');
      assert.deepEqual(filesContaining(dir, ['KEY-123']), ['main.js']);
      assert.deepEqual(filesContaining(dir, []), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
