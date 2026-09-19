'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { classifyNavigation, isPermissionAllowed } = require('../src/security');

describe('classifyNavigation', () => {
  const app = 'app://app';
  const dev = 'http://localhost:4200';

  it('keeps navigation on the app origin', () => {
    assert.equal(classifyNavigation('app://app/?lat=48.1&lon=11.5', app), 'allow');
    assert.equal(classifyNavigation('app://app/', app), 'allow');
    assert.equal(classifyNavigation('http://localhost:4200/?tokensetup', dev), 'allow');
  });

  it('sends web links to the system browser', () => {
    assert.equal(classifyNavigation('https://ion.cesium.com/signup', app), 'external');
    assert.equal(classifyNavigation('https://github.com/ingel81/3dtd', app), 'external');
    assert.equal(classifyNavigation('http://localhost:4200/', app), 'external');
  });

  it('drops everything else', () => {
    assert.equal(classifyNavigation('app://other/', app), 'deny');
    assert.equal(classifyNavigation('file:///C:/Windows/System32/calc.exe', app), 'deny');
    assert.equal(classifyNavigation('javascript:alert(1)', app), 'deny');
    assert.equal(classifyNavigation('ms-settings:privacy', app), 'deny');
    assert.equal(classifyNavigation('smb://host/share', app), 'deny');
    assert.equal(classifyNavigation('not a url', app), 'deny');
  });
});

describe('isPermissionAllowed', () => {
  it('allows writing to the clipboard only', () => {
    assert.equal(isPermissionAllowed('clipboard-sanitized-write'), true);
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal', 'hid']) {
      assert.equal(isPermissionAllowed(permission), false, permission);
    }
  });
});
