// Serves a folder of own 3D Tiles to the dev game, with the headers a page
// under COEP credentialless needs for cross-origin fetches.
//
//   npm run own-tiles                      # serves tmp/own-tiles on :4310
//   node tools/own-tiles/serve.mjs [dir] [--port 4310] [--host localhost]
//
// Tileset URL then: http://localhost:4310/<folder>/<path to tileset.json>,
// for Kalasatama http://localhost:4310/kalasatama/tileset/tileset.json.
// No dependencies.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const port = Number(option('--port', 4310));
const host = option('--host', 'localhost');
const root = path.resolve(args[0] ?? 'tmp/own-tiles');

const TYPES = {
  '.json': 'application/json',
  '.b3dm': 'application/octet-stream',
  '.i3dm': 'application/octet-stream',
  '.pnts': 'application/octet-stream',
  '.cmpt': 'application/octet-stream',
  '.subtree': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ktx2': 'image/ktx2',
  '.webp': 'image/webp',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, CORS).end();
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400, CORS).end();
    return;
  }
  const file = path.join(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403, CORS).end();
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, CORS).end();
      return;
    }
    const lastModified = stat.mtime.toUTCString();
    const headers = {
      ...CORS,
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Last-Modified': lastModified,
      'Cache-Control': 'no-cache',
    };
    if (req.headers['if-modified-since'] === lastModified) {
      res.writeHead(304, headers).end();
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });
});

server.listen(port, host, () => {
  console.log(`own tiles: ${root} on http://${host}:${port}/`);
});
