'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { describe, it } = require('node:test');
const { safeFileName, savesSilently, uniqueDownloadPath } = require('../src/downloads');

const dir = path.join(path.sep === '\\' ? 'C:\\' : '/', 'Users', 'player', 'Downloads');

describe('safeFileName', () => {
  it('keeps the names the game gives', () => {
    assert.equal(safeFileName('3dtd-new-york-20260919-101500.png'), '3dtd-new-york-20260919-101500.png');
    assert.equal(safeFileName('3dtd-state-unknown-2026-09-12T15-52-17-458Z.json'), '3dtd-state-unknown-2026-09-12T15-52-17-458Z.json');
  });

  it('never leaves the folder or uses characters Windows refuses', () => {
    assert.equal(safeFileName('..\\..\\evil.exe'), 'evil.exe');
    assert.equal(safeFileName('../../evil.exe'), 'evil.exe');
    assert.equal(safeFileName('a:b*c?.txt'), 'a_b_c_.txt');
    assert.equal(safeFileName('name\u0007.txt'), 'name_.txt');
  });

  it('falls back to a plain name', () => {
    assert.equal(safeFileName(''), 'download');
    assert.equal(safeFileName(undefined), 'download');
    assert.equal(safeFileName('...'), 'download');
  });
});

describe('uniqueDownloadPath', () => {
  it('uses the name when it is free', () => {
    assert.equal(uniqueDownloadPath(dir, 'shot.png', () => false), path.join(dir, 'shot.png'));
  });

  it('numbers the name like a browser when it is taken', () => {
    const taken = new Set([path.join(dir, 'shot.png'), path.join(dir, 'shot (1).png')]);
    assert.equal(uniqueDownloadPath(dir, 'shot.png', (p) => taken.has(p)), path.join(dir, 'shot (2).png'));
  });

  it('numbers a name without an extension', () => {
    const taken = new Set([path.join(dir, 'report')]);
    assert.equal(uniqueDownloadPath(dir, 'report', (p) => taken.has(p)), path.join(dir, 'report (1)'));
  });
});

describe('savesSilently', () => {
  it('saves a picture straight away and asks where a log or a dump goes', () => {
    assert.equal(savesSilently('3dtd-new-york-20260919-101500.png'), true);
    assert.equal(savesSilently('photo.JPG'), true);
    assert.equal(savesSilently('3dtd-run-2026-09-26T13-16-46-891Z-world.jsonl'), false);
    assert.equal(savesSilently('3dtd-state-unknown.json'), false);
  });
});
