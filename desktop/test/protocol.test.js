'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { describe, it } = require('node:test');
const {
  CONTENT_SECURITY_POLICY,
  TRANSCODER_WORKER_POLICY,
  AGENT_WORKER_POLICY,
  createAppProtocolHandler,
  mimeTypeFor,
  parseRange,
  resolveFilePath,
} = require('../src/protocol');

const root = path.join(path.sep === '\\' ? 'C:\\' : '/', 'game', 'app');
const inRoot = (...parts) => path.join(root, ...parts);

describe('resolveFilePath', () => {
  it('serves files below the root', () => {
    assert.equal(resolveFilePath(root, 'app://app/main-ABC.js'), inRoot('main-ABC.js'));
    assert.equal(
      resolveFilePath(root, 'app://app/assets/models/towers/silo.glb'),
      inRoot('assets', 'models', 'towers', 'silo.glb')
    );
  });

  it('ignores the query string', () => {
    assert.equal(resolveFilePath(root, 'app://app/data.json?v=2'), inRoot('data.json'));
  });

  it('decodes percent-encoded names', () => {
    assert.equal(resolveFilePath(root, 'app://app/assets/a%20b.mp3'), inRoot('assets', 'a b.mp3'));
  });

  it('falls back to index.html for routes without an extension', () => {
    assert.equal(resolveFilePath(root, 'app://app/'), inRoot('index.html'));
    assert.equal(resolveFilePath(root, 'app://app/?tokensetup'), inRoot('index.html'));
    assert.equal(resolveFilePath(root, 'app://app/devworld'), inRoot('index.html'));
  });

  it('keeps traversal inside the root or refuses it', () => {
    for (const url of [
      'app://app/../../secret.txt',
      'app://app/%2e%2e/%2e%2e/secret.txt',
      'app://app/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
    ]) {
      const resolved = resolveFilePath(root, url);
      if (resolved !== null) {
        assert.ok(!path.relative(root, resolved).startsWith('..'), `${url} left the root: ${resolved}`);
      }
    }
    assert.equal(resolveFilePath(root, 'app://app/..%5c..%5csecret.txt'), null);
    assert.equal(resolveFilePath(root, 'app://app/assets%5c..%5c..%5csecret.txt'), null);
    assert.equal(resolveFilePath(root, 'app://app/C:%2fWindows%2fwin.ini'), null);
    assert.equal(resolveFilePath(root, 'app://app/a%00.js'), null);
  });

  it('refuses other hosts, other schemes and broken encodings', () => {
    assert.equal(resolveFilePath(root, 'app://evil/main.js'), null);
    assert.equal(resolveFilePath(root, 'file:///C:/game/app/main.js'), null);
    assert.equal(resolveFilePath(root, 'app://app/%E0%A4%A.js'), null);
    assert.equal(resolveFilePath(root, 'not a url'), null);
  });
});

describe('mimeTypeFor', () => {
  it('knows what the build contains', () => {
    assert.equal(mimeTypeFor('draco_decoder.wasm'), 'application/wasm');
    assert.equal(mimeTypeFor('pathfinding.worker.mjs'), 'text/javascript; charset=utf-8');
    assert.equal(mimeTypeFor('silo.GLB'), 'model/gltf-binary');
    assert.equal(mimeTypeFor('theme.mp3'), 'audio/mpeg');
    assert.equal(mimeTypeFor('font.woff2'), 'font/woff2');
  });

  it('falls back to octet-stream', () => {
    assert.equal(mimeTypeFor('model.onnx'), 'application/octet-stream');
  });
});

describe('parseRange', () => {
  it('reads open, closed and suffix ranges', () => {
    assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 });
    assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 });
    assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 });
    assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
    assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
  });

  it('reports ranges past the end as unsatisfiable', () => {
    assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
    assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable');
  });

  it('ignores what it cannot read', () => {
    assert.equal(parseRange('bytes=20-10', 100), null);
    assert.equal(parseRange('bytes=-', 100), null);
    assert.equal(parseRange('bytes=0-1,5-6', 100), null);
    assert.equal(parseRange('items=0-1', 100), null);
  });
});

describe('createAppProtocolHandler', () => {
  const files = new Map([
    [inRoot('index.html'), Buffer.from('<!doctype html>')],
    [inRoot('main.js'), Buffer.from('console.log(1)')],
    [inRoot('music.mp3'), Buffer.from('0123456789')],
    [inRoot('basis/ktx2-worker.js'), Buffer.from('new Function()')],
    [inRoot('agent/script-worker.js'), Buffer.from('new Function()')],
  ]);
  const readFile = async (filePath) => {
    if (files.has(filePath)) return files.get(filePath);
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  };
  const handler = createAppProtocolHandler({ root, readFile });
  const request = (url, headers = {}) => ({ url, headers: new Headers(headers) });

  it('serves a file with type, length and the CSP', async () => {
    const response = await handler(request('app://app/main.js'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(response.headers.get('content-length'), '14');
    assert.equal(response.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
    assert.equal(await response.text(), 'console.log(1)');
  });

  it('lets only the transcoder worker evaluate strings', async () => {
    const worker = await handler(request('app://app/basis/ktx2-worker.js'));
    assert.equal(worker.headers.get('content-security-policy'), TRANSCODER_WORKER_POLICY);
    assert.match(TRANSCODER_WORKER_POLICY, /script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'/);
    assert.equal(TRANSCODER_WORKER_POLICY.replace(" 'unsafe-eval'", ''), CONTENT_SECURITY_POLICY);
    assert.doesNotMatch(CONTENT_SECURITY_POLICY, /'unsafe-eval'/);
    const elsewhere = await handler(request('app://app/assets/basis/ktx2-worker.js?x'));
    assert.equal(elsewhere.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
  });

  it('lets the agent script sandbox evaluate strings and nothing else', async () => {
    const worker = await handler(request('app://app/agent/script-worker.js'));
    assert.equal(worker.headers.get('content-security-policy'), AGENT_WORKER_POLICY);
    const directives = Object.fromEntries(AGENT_WORKER_POLICY.split(';').map((d) => d.trim().split(' ')).map(([k, ...v]) => [k, v.join(' ')]));
    assert.deepEqual(directives, { 'default-src': "'none'", 'script-src': "'unsafe-eval'", 'connect-src': "'none'", 'worker-src': "'none'" });
    // Still isolated, or the isolated page could not start it
    assert.equal(worker.headers.get('cross-origin-embedder-policy'), 'credentialless');
    const elsewhere = await handler(request('app://app/assets/agent/script-worker.js'));
    assert.equal(elsewhere.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
  });

  it('answers routes with index.html', async () => {
    const response = await handler(request('app://app/some/route?x=1'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await response.text(), '<!doctype html>');
  });

  it('answers a missing file with an extension with 404, not index.html', async () => {
    const response = await handler(request('app://app/assets/missing.json'));
    assert.equal(response.status, 404);
    assert.equal(await response.text(), '');
  });

  it('answers a refused path with 404 without reading anything', async () => {
    let reads = 0;
    const counting = createAppProtocolHandler({
      root,
      readFile: async (p) => {
        reads++;
        return readFile(p);
      },
    });
    const response = await counting(request('app://app/..%5csecret.txt'));
    assert.equal(response.status, 404);
    assert.equal(reads, 0);
  });

  it('answers other read errors with 500', async () => {
    const failing = createAppProtocolHandler({
      root,
      readFile: async () => {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      },
    });
    assert.equal((await failing(request('app://app/main.js'))).status, 500);
  });

  it('serves byte ranges for media', async () => {
    const response = await handler(request('app://app/music.mp3', { range: 'bytes=2-5' }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(response.headers.get('content-length'), '4');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(await response.text(), '2345');
  });

  it('answers an unsatisfiable range with 416', async () => {
    const response = await handler(request('app://app/music.mp3', { range: 'bytes=10-' }));
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */10');
  });
});

describe('createAppProtocolHandler with the map data of a checkout', () => {
  const publicDir = path.join(path.dirname(path.dirname(root)), 'repo', 'public');
  const files = new Map([
    [inRoot('index.html'), Buffer.from('<!doctype html>')],
    [inRoot('maps', 'own.json'), Buffer.from('build')],
    [path.join(publicDir, 'maps', 'assets', 'catalog.json'), Buffer.from('{"objects":[]}')],
    [path.join(publicDir, 'maps', 'own.json'), Buffer.from('checkout')],
    [path.join(publicDir, 'secret.json'), Buffer.from('no')],
  ]);
  const readFile = async (filePath) => {
    if (files.has(filePath)) return files.get(filePath);
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  };
  const request = (url) => ({ url, headers: new Headers() });

  it('serves a map data file the build left out from the checkout', async () => {
    const handler = createAppProtocolHandler({ root, readFile, mapDataRoot: publicDir });
    const response = await handler(request('app://app/maps/assets/catalog.json'));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"objects":[]}');
    // The build's own file wins
    assert.equal(await (await handler(request('app://app/maps/own.json'))).text(), 'build');
  });

  it('serves nothing else of the checkout, and nothing without it', async () => {
    const handler = createAppProtocolHandler({ root, readFile, mapDataRoot: publicDir });
    assert.equal((await handler(request('app://app/secret.json'))).status, 404);
    assert.equal((await handler(request('app://app/maps/../secret.json'))).status, 404);
    assert.equal((await handler(request('app://app/maps/%2e%2e/secret.json'))).status, 404);
    const without = createAppProtocolHandler({ root, readFile });
    assert.equal((await without(request('app://app/maps/assets/catalog.json'))).status, 404);
  });
});
