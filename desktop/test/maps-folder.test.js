'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const { createMapsFolder, folderNameFor, mapFileArg, mapFileName } = require('../src/maps-folder');

describe('mapFileName', () => {
  it('takes any map file name of the folder itself, as the player or Explorer gave it', () => {
    for (const ok of ['mountain-pass.3dtdmap', 'My_Map-2.3DTDMAP', 'Marsh - Copy.3dtdmap', 'Grün (2).3dtdmap']) assert.equal(mapFileName(ok), ok);
  });

  it('refuses names that leave the folder or that Windows refuses', () => {
    for (const bad of ['../x.3dtdmap', '..\\x.3dtdmap', 'a/b.3dtdmap', 'a:b.3dtdmap', 'con.3dtdmap', 'x.exe', '.3dtdmap', 'x.3dtdmap.part', 42, null]) {
      assert.equal(mapFileName(bad), null, String(bad));
    }
  });
});

describe('mapFileArg', () => {
  it('finds the double-clicked file among the arguments', () => {
    assert.equal(mapFileArg(['3DTD.exe', '--flag', 'C:\\Users\\p\\Desktop\\Marsh.3dtdmap']), 'C:\\Users\\p\\Desktop\\Marsh.3dtdmap');
    assert.equal(mapFileArg(['3DTD.exe', '--dev']), null);
    assert.equal(mapFileArg(undefined), null);
  });
});

describe('folderNameFor', () => {
  it('makes a slug of the stem and numbers it while taken', () => {
    assert.equal(folderNameFor('/x/Witch Marsh!.3dtdmap', () => false), 'witch-marsh.3dtdmap');
    const taken = new Set(['witch-marsh.3dtdmap', 'witch-marsh-2.3dtdmap']);
    assert.equal(folderNameFor('/x/Witch Marsh.3dtdmap', (n) => taken.has(n)), 'witch-marsh-3.3dtdmap');
    assert.equal(folderNameFor('/x/###.3dtdmap', () => false), 'map.3dtdmap');
  });
});

describe('createMapsFolder', () => {
  let root;
  let folder;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), '3dtd-maps-'));
    folder = createMapsFolder({ dir: path.join(root, 'Maps'), fs });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes, lists, reads and removes map files', async () => {
    assert.deepEqual(await folder.list(), []);
    const written = await folder.write('a.3dtdmap', new Uint8Array([1, 2, 3]));
    assert.equal(typeof written.mtime, 'number');
    // Not a map file: never listed
    await fs.writeFile(path.join(folder.dir, 'notes.txt'), 'x');
    const list = await folder.list();
    assert.deepEqual(
      list.map((f) => [f.name, f.size]),
      [['a.3dtdmap', 3]],
    );
    assert.equal(list[0].mtime, written.mtime);
    assert.deepEqual([...(await folder.read('a.3dtdmap'))], [1, 2, 3]);
    assert.equal(await folder.remove('a.3dtdmap'), true);
    assert.equal(await folder.read('a.3dtdmap'), null);
  });

  it('refuses names that leave the folder', async () => {
    assert.equal(await folder.write('../evil.3dtdmap', new Uint8Array([1])), null);
    assert.equal(await folder.read('../evil.3dtdmap'), null);
    assert.equal(await folder.remove('..\\evil.3dtdmap'), false);
    await assert.rejects(fs.stat(path.join(root, 'evil.3dtdmap')));
  });

  it('copies a double-clicked map in under a free name, takes one in the folder as it is', async () => {
    const outside = path.join(root, 'Witch Marsh.3dtdmap');
    await fs.writeFile(outside, new Uint8Array([9]));
    assert.equal(await folder.adopt(outside), 'witch-marsh.3dtdmap');
    assert.equal(await folder.adopt(outside), 'witch-marsh-2.3dtdmap');
    assert.equal(await folder.adopt(path.join(folder.dir, 'witch-marsh.3dtdmap')), 'witch-marsh.3dtdmap');
    assert.equal(await folder.adopt(path.join(root, 'missing.3dtdmap')), null);
    assert.equal(await folder.adopt(path.join(root, 'x.exe')), null);
  });
});
