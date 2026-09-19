'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { describe, it } = require('node:test');
const { tagMatchesVersion } = require('../scripts/check-version');

describe('tagMatchesVersion', () => {
  it('accepts the tag of the version, with or without v', () => {
    assert.equal(tagMatchesVersion('v0.4.0', '0.4.0'), true);
    assert.equal(tagMatchesVersion('0.4.0', '0.4.0'), true);
  });

  it('refuses another version', () => {
    assert.equal(tagMatchesVersion('v0.4.0', '0.3.0'), false);
    assert.equal(tagMatchesVersion('v0.4', '0.4.0'), false);
    assert.equal(tagMatchesVersion('release-0.4.0', '0.4.0'), false);
  });
});

describe('check-version.js', () => {
  const script = path.join(__dirname, '..', 'scripts', 'check-version.js');
  const { version } = require('../../package.json');

  it('passes for the current version and fails for another', () => {
    assert.match(execFileSync(process.execPath, [script, `v${version}`]).toString(), /matches/);
    assert.throws(() => execFileSync(process.execPath, [script, 'v999.0.0'], { stdio: 'pipe' }));
  });
});
