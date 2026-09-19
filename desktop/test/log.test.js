'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createRepeatFilter, describeGpus, maskSecrets, maskValue, rendererLine } = require('../src/log');

describe('maskSecrets', () => {
  it('hides the keys tile requests carry', () => {
    assert.equal(
      maskSecrets('GET https://api.cesium.com/v1/assets/2275207/endpoint?access_token=eyJhbGciOi.abc-123_x failed'),
      'GET https://api.cesium.com/v1/assets/2275207/endpoint?access_token=*** failed'
    );
    assert.equal(
      maskSecrets('https://tile.googleapis.com/v1/3dtiles/datasets/x/files/y.glb?key=AIzaSyA-1&session=CJK_2x'),
      'https://tile.googleapis.com/v1/3dtiles/datasets/x/files/y.glb?key=***&session=***'
    );
    assert.equal(maskSecrets('apiKey=abc token=def sig=ghi'), 'apiKey=*** token=*** sig=***');
    assert.equal(maskSecrets('Authorization: Bearer eyJ0eXAi.x.y'), 'Authorization: Bearer ***');
  });

  it('keeps everything else, the location included', () => {
    const line = '[OSM] streets from overpass-api.de failed after 35ms; app://app/?l=40.75701,-73.98597&s=40.76693,-73.97898';
    assert.equal(maskSecrets(line), line);
    assert.equal(maskSecrets('monkey=banana hotkey'), 'monkey=banana hotkey');
  });
});

describe('maskValue', () => {
  it('masks strings and errors, leaves other values', () => {
    assert.equal(maskValue('x?key=1'), 'x?key=***');
    const error = new Error('fetch https://a/?access_token=zzz failed');
    assert.ok(maskValue(error).includes('access_token=***'));
    assert.ok(!maskValue(error).includes('zzz'));
    assert.equal(maskValue(42), 42);
  });
});

describe('rendererLine', () => {
  it('keeps warnings and errors of the page, with where they came from', () => {
    assert.deepEqual(rendererLine({ level: 'warning', message: 'Could not find street points', sourceId: 'app://app/chunk-A.js', lineNumber: 3254 }), {
      level: 'warn',
      text: '[page] Could not find street points (app://app/chunk-A.js:3254)',
    });
    assert.equal(rendererLine({ level: 'error', message: 'boom', sourceId: '' }).text, '[page] boom');
  });

  it('drops info and debug', () => {
    assert.equal(rendererLine({ level: 'info', message: '[Camera] 434 camera.startPosition' }), null);
    assert.equal(rendererLine({ level: 'debug', message: 'x' }), null);
  });

  it('masks a failed tile request', () => {
    const line = rendererLine({ level: 'error', message: 'Failed to load resource https://tile.googleapis.com/x?key=SECRET', sourceId: '' });
    assert.ok(!line.text.includes('SECRET'));
  });
});

describe('createRepeatFilter', () => {
  const warn = (text) => ({ level: 'warn', text });

  it('writes a repeated line once and then how often it came', () => {
    const filter = createRepeatFilter();
    assert.deepEqual(filter.accept(warn('a')), [warn('a')]);
    assert.deepEqual(filter.accept(warn('a')), []);
    assert.deepEqual(filter.accept(warn('a')), []);
    assert.deepEqual(filter.accept(warn('b')), [warn('[page] (previous message repeated 2 times)'), warn('b')]);
  });

  it('flushes a pending count', () => {
    const filter = createRepeatFilter();
    filter.accept(warn('a'));
    filter.accept(warn('a'));
    assert.deepEqual(filter.flush(), [warn('[page] (previous message repeated 1 times)')]);
    assert.deepEqual(filter.flush(), []);
  });
});

describe('describeGpus', () => {
  it('names each GPU and marks the one that draws', () => {
    const info = {
      gpuDevice: [
        { vendorId: 0x10de, deviceId: 0x2c02, vendorString: 'NVIDIA', deviceString: 'GeForce RTX 5080', driverVersion: '32.0.16.1062', active: true },
        { vendorId: 0x1002, deviceId: 0x164e, driverVersion: '32.0.21030.2001', active: false },
      ],
      auxAttributes: { glRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11)' },
    };
    assert.equal(
      describeGpus(info),
      'GPU: NVIDIA GeForce RTX 5080, driver 32.0.16.1062 (active); vendor 0x1002 device 0x164e, driver 32.0.21030.2001; ' +
        'renderer ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11)'
    );
  });

  it('copes with nothing', () => {
    assert.equal(describeGpus(undefined), 'GPU: unknown');
  });
});
