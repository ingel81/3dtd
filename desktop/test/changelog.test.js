'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { changelogSection } = require('../scripts/changelog');

const markdown = `# Changelog

Intro text.

## 0.4.0 (2026-10-01)

### New
- Something new

## 0.3.1 (2026-09-19)

### New
- The Windows app

### Fixed
- A bug

## 0.3.0
`;

describe('changelogSection', () => {
  it('returns the body of a version, up to the next version', () => {
    assert.equal(changelogSection(markdown, '0.3.1'), '### New\n- The Windows app\n\n### Fixed\n- A bug');
    assert.equal(changelogSection(markdown, '0.4.0'), '### New\n- Something new');
  });

  it('takes a tag as well', () => {
    assert.equal(changelogSection(markdown, 'v0.4.0'), '### New\n- Something new');
  });

  it('is null for a missing or empty section', () => {
    assert.equal(changelogSection(markdown, '0.5.0'), null);
    assert.equal(changelogSection(markdown, '0.3.0'), null);
    assert.equal(changelogSection('', '0.3.1'), null);
  });

  it('does not match a version that only starts the same', () => {
    assert.equal(changelogSection('## 0.3.10\n- x\n', '0.3.1'), null);
  });

  it('reads Windows line endings', () => {
    assert.equal(changelogSection('## 0.3.1\r\n- a\r\n', '0.3.1'), '- a');
  });
});
