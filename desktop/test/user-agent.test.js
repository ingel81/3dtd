'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { CONNECT_HOSTS, CONTENT_SECURITY_POLICY } = require('../src/protocol');
const { IDENTIFIED_HOSTS, identifiedUrlPatterns, identifyingUserAgent } = require('../src/user-agent');

describe('identifyingUserAgent', () => {
  it('names the app, its version and where to find it', () => {
    assert.equal(identifyingUserAgent('0.3.0'), '3DTD/0.3.0 (+https://github.com/ingel81/3dtd)');
  });
});

describe('identified hosts', () => {
  it('are hosts the CSP lets the page reach', () => {
    for (const host of IDENTIFIED_HOSTS) assert.ok(CONNECT_HOSTS.includes(host), host);
  });

  it('become webRequest patterns', () => {
    assert.ok(identifiedUrlPatterns().includes('https://overpass-api.de/*'));
    assert.equal(identifiedUrlPatterns().length, IDENTIFIED_HOSTS.length);
  });

  it('leave the tile providers alone', () => {
    const patterns = identifiedUrlPatterns().join(' ');
    assert.ok(!patterns.includes('cesium'));
    assert.ok(!patterns.includes('googleapis'));
  });
});

describe('connect-src', () => {
  it('allows blob: and data: for loaders that fetch embedded assets', () => {
    const connect = CONTENT_SECURITY_POLICY.split('; ').find((d) => d.startsWith('connect-src'));
    assert.ok(connect.includes(' blob: '));
    assert.ok(connect.includes(' data: '));
  });
});
